-- InfinityBot (MVP) - Briefing por Lead + Empresa
-- Rode este SQL no Supabase (SQL Editor)

-- 1) Tabela
create table if not exists public.lead_briefings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  lead_id uuid not null,
  content text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, lead_id)
);

create index if not exists lead_briefings_company_id_idx on public.lead_briefings (company_id);
create index if not exists lead_briefings_lead_id_idx on public.lead_briefings (lead_id);

-- 2) RLS
alter table public.lead_briefings enable row level security;

-- Regra base: usuário só acessa registros da sua empresa
-- (assume que public.profiles tem id = auth.uid() e company_id)

do $$
begin
  -- SELECT
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='lead_briefings' and policyname='lead_briefings_select_by_company'
  ) then
    create policy lead_briefings_select_by_company
      on public.lead_briefings
      for select
      using (
        exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.company_id = lead_briefings.company_id
        )
      );
  end if;

  -- INSERT
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='lead_briefings' and policyname='lead_briefings_insert_by_company'
  ) then
    create policy lead_briefings_insert_by_company
      on public.lead_briefings
      for insert
      with check (
        exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.company_id = lead_briefings.company_id
        )
      );
  end if;

  -- UPDATE
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='lead_briefings' and policyname='lead_briefings_update_by_company'
  ) then
    create policy lead_briefings_update_by_company
      on public.lead_briefings
      for update
      using (
        exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.company_id = lead_briefings.company_id
        )
      )
      with check (
        exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.company_id = lead_briefings.company_id
        )
      );
  end if;

  -- DELETE (opcional) - mantém fechado por padrão
  -- Se quiser liberar, descomente e ajuste.
end $$;
