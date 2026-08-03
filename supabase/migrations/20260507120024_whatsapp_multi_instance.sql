-- ============================================================
-- WhatsApp Multi-instância (estilo CRM).
--
-- Mudanças sobre a migration _23:
--   • Remove o índice UNIQUE(company_id) — agora uma empresa pode
--     ter N instâncias (suporte, comercial, cobrança...)
--   • Adiciona `label` (apelido amigável p/ mostrar na UI)
--   • Adiciona `is_default` — exatamente uma instância padrão por
--     empresa, usada quando o caller não especifica qual usar
--   • Estende o CHECK de `status` para cobrir os 6 estados que o
--     Evolution reporta (CONNECTED, WAITING_QR, etc.)
--   • Índice parcial UNIQUE pra garantir 1 default por empresa
--   • Trigger antes-de-insert/update pra:
--       - garantir que existe pelo menos 1 default por empresa
--         (auto-promove a primeira inserida)
--       - desmarcar as outras quando uma vira default
-- ============================================================

-- ───────── 1. Drop do UNIQUE antigo ─────────
drop index if exists public.wpp_instances_company_uidx;

-- ───────── 2. Novas colunas ─────────
alter table public.wpp_instances
  add column if not exists label text,
  add column if not exists is_default boolean not null default false;

-- ───────── 3. Status: aceita os estados detalhados ─────────
-- O check original era ('disconnected','connecting','connected','error').
-- Migrando pra incluir WAITING_QR / WARNING_QR / CLOSED como no CRM —
-- mas mantendo os antigos pra compat retroativa.
alter table public.wpp_instances drop constraint if exists wpp_instances_status_check;
alter table public.wpp_instances
  add constraint wpp_instances_status_check
  check (status in (
    'disconnected', 'connecting', 'connected', 'error',
    'waiting_qr', 'warning_qr', 'closed'
  ));

-- ───────── 4. Backfill: cada empresa que tem instância vira default ─────────
-- (a primeira criada de cada empresa)
update public.wpp_instances i
   set is_default = true
 where i.id = (
   select id
     from public.wpp_instances
    where company_id = i.company_id
    order by created_at asc
    limit 1
 )
   and not exists (
     select 1 from public.wpp_instances d
      where d.company_id = i.company_id and d.is_default = true
   );

-- ───────── 5. Índice parcial: 1 default por empresa ─────────
create unique index if not exists wpp_instances_default_uidx
  on public.wpp_instances (company_id)
  where is_default = true;

-- ───────── 6. Trigger: desmarca as outras quando uma vira default ─────────
create or replace function public.tg_wpp_instances_single_default()
returns trigger
language plpgsql
as $$
begin
  if new.is_default = true then
    update public.wpp_instances
       set is_default = false
     where company_id = new.company_id
       and id <> new.id
       and is_default = true;
  end if;
  return new;
end $$;

drop trigger if exists tg_wpp_instances_single_default on public.wpp_instances;
create trigger tg_wpp_instances_single_default
  before insert or update of is_default on public.wpp_instances
  for each row
  when (new.is_default = true)
  execute function public.tg_wpp_instances_single_default();

-- ───────── 7. Trigger: auto-promove a 1ª da empresa pra default ─────────
create or replace function public.tg_wpp_instances_auto_default()
returns trigger
language plpgsql
as $$
declare
  has_default boolean;
begin
  -- Se a nova já é default, ok (o outro trigger cuida)
  if new.is_default = true then
    return new;
  end if;

  -- Se a empresa ainda não tem nenhuma default, esta vira a default
  select exists (
    select 1 from public.wpp_instances
     where company_id = new.company_id
       and is_default = true
       and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) into has_default;

  if not has_default then
    new.is_default := true;
  end if;
  return new;
end $$;

drop trigger if exists tg_wpp_instances_auto_default on public.wpp_instances;
create trigger tg_wpp_instances_auto_default
  before insert on public.wpp_instances
  for each row
  execute function public.tg_wpp_instances_auto_default();

-- ───────── 8. Trigger: ao deletar a default, promove outra ─────────
create or replace function public.tg_wpp_instances_promote_on_delete()
returns trigger
language plpgsql
as $$
begin
  if old.is_default = true then
    update public.wpp_instances
       set is_default = true
     where id = (
       select id from public.wpp_instances
        where company_id = old.company_id
          and id <> old.id
        order by created_at asc
        limit 1
     );
  end if;
  return old;
end $$;

drop trigger if exists tg_wpp_instances_promote_on_delete on public.wpp_instances;
create trigger tg_wpp_instances_promote_on_delete
  after delete on public.wpp_instances
  for each row
  execute function public.tg_wpp_instances_promote_on_delete();
