-- ============================================================
-- Compatibilidade pra rodar o WhatsAppInbox completo (portado do CRM).
--
-- Estratégia: criar VIEW `instancias` mapeando `wpp_instances` +
-- TABELAS STUB pra tudo que o CRM espera mas o OSManager não tem
-- como conceito principal (tags, funnels, funnel_stages).
--
-- O usuário pode preencher essas tabelas depois se quiser usar
-- o sistema de tags/funis. Por padrão ficam vazias e a UI mostra
-- "Nenhuma tag", "Nenhum funil", etc.
-- ============================================================

-- ───────── VIEW instancias ─────────
-- Mapeia status canônico → enum legado (CONNECTED/WAITING_QR/etc)
drop view if exists public.instancias;
create view public.instancias as
  select
    i.id,
    i.instance_name           as instance_name,
    i.instance_name           as instance_key,
    i.instance_name           as token_id,
    i.phone_number,
    case i.status
      when 'connected'    then 'CONNECTED'
      when 'connecting'   then 'CONNECTING'
      when 'waiting_qr'   then 'WAITING_QR'
      when 'warning_qr'   then 'WARNING_QR'
      when 'disconnected' then 'DISCONNECTED'
      when 'closed'       then 'CLOSED'
      when 'error'        then 'ERROR'
      else 'DISCONNECTED'
    end                       as status,
    i.company_id,
    null::uuid                as user_id,
    i.is_default,
    null::uuid                as default_funnel_id,
    i.created_at
  from public.wpp_instances i;

grant select on public.instancias to authenticated, anon;

-- ───────── tags ─────────
create table if not exists public.tags (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  color       text default '#64748b',
  created_at  timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists tags_company_idx on public.tags(company_id);

alter table public.tags enable row level security;
drop policy if exists tags_rw on public.tags;
create policy tags_rw on public.tags for all
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

grant select, insert, update, delete on public.tags to authenticated;

-- ───────── lead_tags (M:N) ─────────
create table if not exists public.lead_tags (
  lead_id     uuid not null references public.leads(id) on delete cascade,
  tag_id      uuid not null references public.tags(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (lead_id, tag_id)
);
alter table public.lead_tags enable row level security;
drop policy if exists lead_tags_rw on public.lead_tags;
create policy lead_tags_rw on public.lead_tags for all
  using (exists (select 1 from public.leads l where l.id = lead_id and l.company_id = public.current_company_id()))
  with check (exists (select 1 from public.leads l where l.id = lead_id and l.company_id = public.current_company_id()));
grant select, insert, update, delete on public.lead_tags to authenticated;

-- ───────── funnels ─────────
create table if not exists public.funnels (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  active      boolean not null default true,
  position    int default 0,
  created_at  timestamptz not null default now()
);
create index if not exists funnels_company_idx on public.funnels(company_id);

alter table public.funnels enable row level security;
drop policy if exists funnels_rw on public.funnels;
create policy funnels_rw on public.funnels for all
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
grant select, insert, update, delete on public.funnels to authenticated;

-- ───────── funnel_stages ─────────
create table if not exists public.funnel_stages (
  id          uuid primary key default gen_random_uuid(),
  funnel_id   uuid not null references public.funnels(id) on delete cascade,
  name        text not null,
  position    int default 0,
  color       text default '#64748b',
  created_at  timestamptz not null default now()
);
create index if not exists funnel_stages_funnel_idx on public.funnel_stages(funnel_id);

alter table public.funnel_stages enable row level security;
drop policy if exists funnel_stages_rw on public.funnel_stages;
create policy funnel_stages_rw on public.funnel_stages for all
  using (exists (select 1 from public.funnels f where f.id = funnel_id and f.company_id = public.current_company_id()))
  with check (exists (select 1 from public.funnels f where f.id = funnel_id and f.company_id = public.current_company_id()));
grant select, insert, update, delete on public.funnel_stages to authenticated;

-- ───────── leads: colunas extras que o CRM espera ─────────
alter table public.leads
  add column if not exists assigned_user_id        uuid references auth.users(id) on delete set null,
  add column if not exists current_funnel_id       uuid references public.funnels(id) on delete set null,
  add column if not exists current_stage_id        uuid references public.funnel_stages(id) on delete set null,
  add column if not exists waiting_since           timestamptz,
  add column if not exists last_message_at         timestamptz,
  add column if not exists chat_summary            text,
  add column if not exists chat_summary_updated_at timestamptz,
  add column if not exists chat_summary_html_url   text,
  add column if not exists fonte                   text;

create index if not exists leads_assigned_idx on public.leads(assigned_user_id);
create index if not exists leads_last_msg_idx on public.leads(last_message_at desc);

-- ───────── wpp_conversations: colunas extras ─────────
alter table public.wpp_conversations
  add column if not exists wa_sent_at            timestamptz,
  add column if not exists wa_delivered_at       timestamptz,
  add column if not exists wa_read_at            timestamptz,
  add column if not exists transcription         text,
  add column if not exists transcription_status  text,
  add column if not exists provider              text,
  add column if not exists ack                   int,
  add column if not exists wa_message_id         text;

-- ───────── RPC get_last_message_per_jid ─────────
-- Devolve a última mensagem (ou só metadados) por (instance_id, remote_jid) pra empresa.
create or replace function public.get_last_message_per_jid(p_company_id uuid)
returns table (
  remote_jid       text,
  instance_id      text,
  last_message     text,
  last_message_at  timestamptz,
  from_me          boolean,
  unread_count     int,
  message_type     text,
  media_url        text
)
language sql stable security definer set search_path = public as $$
  with ranked as (
    select
      m.*,
      row_number() over (
        partition by m.instance_id, m.remote_jid
        order by m.created_at desc
      ) as rn
    from public.wpp_conversations m
    where m.company_id = p_company_id
  ),
  unread as (
    select instance_id, remote_jid, count(*)::int as cnt
      from public.wpp_conversations
     where company_id = p_company_id
       and from_me = false
       and read_at is null
     group by instance_id, remote_jid
  )
  select
    r.remote_jid,
    r.instance_id,
    r.message       as last_message,
    r.created_at    as last_message_at,
    r.from_me,
    coalesce(u.cnt, 0) as unread_count,
    r.message_type,
    r.media_url
  from ranked r
  left join unread u
    on u.instance_id = r.instance_id and u.remote_jid = r.remote_jid
  where r.rn = 1
  order by r.created_at desc;
$$;

grant execute on function public.get_last_message_per_jid(uuid) to authenticated;
