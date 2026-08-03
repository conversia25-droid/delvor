-- ============================================================
-- WhatsApp via Evolution API — uma instância por empresa.
--
-- A coluna `instance_name` é o identificador que vai para a Evolution
-- (geralmente o company_id sem hífens, prefixado pra evitar colisão
-- com outras instalações da mesma Evolution).
--
-- Como o token mestre da Evolution vive no env do front, esta tabela
-- é puro cache de status pra exibição rápida — fonte de verdade é
-- sempre a chamada `connectionState` à API.
-- ============================================================

create table if not exists public.wpp_instances (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  instance_name   text not null unique,
  -- estado em cache (sincronizado pelo front depois de cada ação)
  status          text not null default 'disconnected'
                    check (status in ('disconnected','connecting','connected','error')),
  connected_phone text,
  connected_name  text,
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Uma instância por empresa
create unique index if not exists wpp_instances_company_uidx
  on public.wpp_instances (company_id);

-- updated_at automático
create or replace function public.tg_wpp_instances_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tg_wpp_instances_touch on public.wpp_instances;
create trigger tg_wpp_instances_touch
  before update on public.wpp_instances
  for each row execute function public.tg_wpp_instances_touch();

-- ============================================================
-- RLS
-- ============================================================
alter table public.wpp_instances enable row level security;

-- SELECT: qualquer usuário autenticado da empresa pode ver
drop policy if exists wpp_instances_select on public.wpp_instances;
create policy wpp_instances_select on public.wpp_instances
  for select using (
    company_id = public.current_company_id()
  );

-- INSERT/UPDATE/DELETE: apenas admin/gerente da empresa
drop policy if exists wpp_instances_write on public.wpp_instances;
create policy wpp_instances_write on public.wpp_instances
  for all using (
    company_id = public.current_company_id()
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gerente'))
  ) with check (
    company_id = public.current_company_id()
    and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gerente'))
  );

-- Grants pro PostgREST
grant select, insert, update, delete on public.wpp_instances to authenticated;
