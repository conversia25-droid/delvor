-- =====================================================================
-- ADD-ON — Catálogo + RPCs de auto-serviço
-- Permite que o próprio cliente (admin da empresa) ative/desative
-- add-ons pela UI, sem precisar do super-admin.
--
-- Segurança:
--   - Só o super-admin escreve em company_addons diretamente.
--   - Cliente ativa/desativa via RPC SECURITY DEFINER que valida:
--     * usuário está autenticado
--     * usuário é admin da company (via is_admin_or_manager + current_company_id)
--     * addon existe e está ativo no catálogo
--   - RPC também cria notificação pro super-admin e faz log em company_addons.notes.
-- =====================================================================

-- ───────── 1. Catálogo global de add-ons ─────────
create table if not exists public.addon_catalog (
  code                text primary key,
  name                text not null,
  description         text,
  default_price_cents integer not null default 0 check (default_price_cents >= 0),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.addon_catalog enable row level security;

-- Leitura: qualquer usuário autenticado (pra ver a lista de add-ons disponíveis)
drop policy if exists "addon_catalog_select" on public.addon_catalog;
create policy "addon_catalog_select" on public.addon_catalog for select
  using (auth.role() = 'authenticated');

-- Escrita: só super-admin
drop policy if exists "addon_catalog_write" on public.addon_catalog;
create policy "addon_catalog_write" on public.addon_catalog for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- Seed do add-on Financeiro
insert into public.addon_catalog (code, name, description, default_price_cents, active)
values (
  'financeiro',
  'Financeiro',
  'Fluxo de caixa, contas fixas, margem de produtos e calculadora de precificação.',
  9700,
  true
)
on conflict (code) do nothing;


-- ───────── 2. RPC: ativar add-on ─────────
-- Cliente (admin/gerente) ativa o add-on pra sua própria empresa.
-- Retorna { active, monthly_price_cents, activated_at }.
create or replace function public.activate_addon(p_code text)
returns table (
  active boolean,
  monthly_price_cents integer,
  activated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.current_company_id();
  v_catalog record;
  v_row record;
begin
  if v_company_id is null then
    raise exception 'Sem empresa associada ao usuário' using errcode = '42501';
  end if;

  if not public.is_admin_or_manager() then
    raise exception 'Apenas administradores podem contratar add-ons' using errcode = '42501';
  end if;

  select * into v_catalog from public.addon_catalog where code = p_code and active = true;
  if not found then
    raise exception 'Add-on % não disponível', p_code using errcode = 'P0001';
  end if;

  -- Upsert
  insert into public.company_addons (
    company_id, addon_code, active, activated_at, cancelled_at,
    monthly_price_cents, notes
  ) values (
    v_company_id, p_code, true, now(), null,
    v_catalog.default_price_cents,
    'Contratado pelo cliente em ' || to_char(now(), 'DD/MM/YYYY HH24:MI')
  )
  on conflict (company_id, addon_code) do update
    set active = true,
        activated_at = coalesce(public.company_addons.activated_at, now()),
        cancelled_at = null,
        -- mantém o preço personalizado se houver, se não usa default do catálogo
        monthly_price_cents = case
          when public.company_addons.monthly_price_cents > 0 then public.company_addons.monthly_price_cents
          else v_catalog.default_price_cents
        end,
        notes = coalesce(public.company_addons.notes, '') ||
                E'\nReativado pelo cliente em ' || to_char(now(), 'DD/MM/YYYY HH24:MI'),
        updated_at = now()
  returning * into v_row;

  -- Notifica super-admins (se a tabela notifications existir)
  begin
    insert into public.notifications (company_id, user_id, title, body, read)
    select v_company_id, p.id,
           'Add-on contratado: ' || v_catalog.name,
           'Uma empresa ativou o add-on ' || v_catalog.name || ' — não esqueça de somar na próxima fatura.',
           false
    from public.profiles p
    where p.role = 'super_admin';
  exception when others then
    null; -- notifications é opcional, não trava a ativação
  end;

  return query select v_row.active, v_row.monthly_price_cents, v_row.activated_at;
end;
$$;

grant execute on function public.activate_addon(text) to authenticated;


-- ───────── 3. RPC: desativar add-on ─────────
-- Cliente cancela o add-on pra sua própria empresa.
create or replace function public.deactivate_addon(p_code text)
returns table (active boolean, cancelled_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.current_company_id();
  v_row record;
  v_catalog record;
begin
  if v_company_id is null then
    raise exception 'Sem empresa associada ao usuário' using errcode = '42501';
  end if;

  if not public.is_admin_or_manager() then
    raise exception 'Apenas administradores podem cancelar add-ons' using errcode = '42501';
  end if;

  select * into v_catalog from public.addon_catalog where code = p_code;

  update public.company_addons
     set active = false,
         cancelled_at = now(),
         notes = coalesce(notes, '') ||
                 E'\nCancelado pelo cliente em ' || to_char(now(), 'DD/MM/YYYY HH24:MI'),
         updated_at = now()
   where company_id = v_company_id
     and addon_code = p_code
  returning * into v_row;

  if not found then
    raise exception 'Add-on % não estava ativo', p_code using errcode = 'P0001';
  end if;

  -- Notifica super-admins
  begin
    insert into public.notifications (company_id, user_id, title, body, read)
    select v_company_id, p.id,
           'Add-on cancelado: ' || coalesce(v_catalog.name, p_code),
           'Uma empresa cancelou o add-on. Remova da próxima cobrança.',
           false
    from public.profiles p
    where p.role = 'super_admin';
  exception when others then
    null;
  end;

  return query select v_row.active, v_row.cancelled_at;
end;
$$;

grant execute on function public.deactivate_addon(text) to authenticated;


-- ───────── 4. touch_updated_at pro addon_catalog ─────────
drop trigger if exists trg_touch_addon_catalog on public.addon_catalog;
create trigger trg_touch_addon_catalog
  before update on public.addon_catalog
  for each row execute function public.touch_updated_at();
