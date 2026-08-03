-- ============================================================================
-- Painel Master — Cobrança (planos, assinaturas, faturas)
-- ----------------------------------------------------------------------------
-- Schema usado por MasterCompanies / MasterBilling / MasterBillingCompany.
--
-- IMPORTANTE: cada tabela usa `create table if not exists` (cria se não houver)
-- + um bloco `alter table ... add column if not exists` (reconcilia colunas
-- caso a tabela já exista de uma versão anterior, parcial). Idempotente.
-- ============================================================================

-- ───────── 1. companies: campos do painel master ─────────
alter table public.companies
  add column if not exists plan_tier         text,
  add column if not exists cnpj              text,
  add column if not exists document          text,
  add column if not exists email             text,
  add column if not exists phone             text,
  add column if not exists asaas_customer_id text;

create index if not exists idx_companies_asaas_customer_id
  on public.companies (asaas_customer_id) where asaas_customer_id is not null;

-- ───────── 2. planos ─────────
create table if not exists public.billing_plans (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  price_cents   integer not null default 0,
  max_users     integer,
  max_instances integer,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.billing_plans
  add column if not exists code          text,
  add column if not exists name          text,
  add column if not exists price_cents   integer,
  add column if not exists max_users     integer,
  add column if not exists max_instances integer,
  add column if not exists active        boolean,
  add column if not exists created_at    timestamptz;

-- ───────── 3. assinaturas das empresas ─────────
create table if not exists public.company_subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  plan_id              uuid references public.billing_plans(id) on delete set null,
  status               text not null default 'trialing',
  current_period_start timestamptz,
  current_period_end   timestamptz,
  trial_ends_at        timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at          timestamptz,
  suspended_at         timestamptz,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table public.company_subscriptions
  add column if not exists company_id           uuid,
  add column if not exists plan_id              uuid,
  add column if not exists status               text,
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end   timestamptz,
  add column if not exists trial_ends_at        timestamptz,
  add column if not exists cancel_at_period_end boolean,
  add column if not exists canceled_at          timestamptz,
  add column if not exists suspended_at         timestamptz,
  add column if not exists notes                text,
  add column if not exists created_at           timestamptz,
  add column if not exists updated_at           timestamptz;
create index if not exists company_subscriptions_company_idx on public.company_subscriptions(company_id);

-- ───────── 4. faturas ─────────
create table if not exists public.billing_invoices (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  subscription_id uuid references public.company_subscriptions(id) on delete set null,
  amount_cents    integer not null default 0,
  status          text not null default 'open',
  due_date        date,
  paid_at         timestamptz,
  payment_link    text,
  created_at      timestamptz not null default now()
);
alter table public.billing_invoices
  add column if not exists company_id      uuid,
  add column if not exists subscription_id uuid,
  add column if not exists amount_cents    integer,
  add column if not exists status          text,
  add column if not exists due_date        date,
  add column if not exists paid_at         timestamptz,
  add column if not exists payment_link    text,
  add column if not exists created_at      timestamptz;
create index if not exists billing_invoices_company_idx on public.billing_invoices(company_id);

-- ───────── 5. eventos de cobrança (histórico) ─────────
create table if not exists public.billing_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  event_type  text not null default 'info',
  description text,
  metadata    jsonb,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.billing_events
  add column if not exists company_id  uuid,
  add column if not exists event_type  text,
  add column if not exists description text,
  add column if not exists metadata    jsonb,
  add column if not exists created_by  uuid,
  add column if not exists created_at  timestamptz;
create index if not exists billing_events_company_idx on public.billing_events(company_id);

-- ───────── 6. RLS ─────────
alter table public.billing_plans         enable row level security;
alter table public.company_subscriptions enable row level security;
alter table public.billing_invoices      enable row level security;
alter table public.billing_events        enable row level security;

drop policy if exists billing_plans_select on public.billing_plans;
create policy billing_plans_select on public.billing_plans for select to authenticated using (true);
drop policy if exists billing_plans_write on public.billing_plans;
create policy billing_plans_write on public.billing_plans for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists company_subscriptions_select on public.company_subscriptions;
create policy company_subscriptions_select on public.company_subscriptions for select to authenticated
  using (public.is_super_admin() or company_id = public.current_company_id());
drop policy if exists company_subscriptions_write on public.company_subscriptions;
create policy company_subscriptions_write on public.company_subscriptions for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists billing_invoices_select on public.billing_invoices;
create policy billing_invoices_select on public.billing_invoices for select to authenticated
  using (public.is_super_admin() or company_id = public.current_company_id());
drop policy if exists billing_invoices_write on public.billing_invoices;
create policy billing_invoices_write on public.billing_invoices for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists billing_events_select on public.billing_events;
create policy billing_events_select on public.billing_events for select to authenticated
  using (public.is_super_admin() or company_id = public.current_company_id());
drop policy if exists billing_events_write on public.billing_events;
create policy billing_events_write on public.billing_events for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

grant select, insert, update, delete on public.billing_plans         to authenticated;
grant select, insert, update, delete on public.company_subscriptions to authenticated;
grant select, insert, update, delete on public.billing_invoices      to authenticated;
grant select, insert, update, delete on public.billing_events        to authenticated;

-- ───────── 7. view-resumo (1 linha por empresa) ─────────
-- drop antes de recriar: "create or replace view" não consegue reordenar nem
-- renomear colunas se já existir uma versão antiga da view.
drop view if exists public.v_company_billing_summary;
create view public.v_company_billing_summary as
select
  c.id                       as company_id,
  c.name                     as company_name,
  pl.code                    as plan_code,
  pl.name                    as plan_name,
  s.status                   as subscription_status,
  s.current_period_end       as current_period_end,
  s.trial_ends_at            as trial_ends_at,
  (select count(*) from public.profiles p       where p.company_id  = c.id) as users_count,
  (select count(*) from public.wpp_instances wi where wi.company_id = c.id) as instances_count,
  pl.max_users               as max_users,
  pl.max_instances           as max_instances,
  inv.status                 as latest_invoice_status,
  inv.due_date               as latest_invoice_due_date,
  pl.price_cents             as monthly_amount_cents
from public.companies c
left join lateral (
  select cs.* from public.company_subscriptions cs
  where cs.company_id = c.id
  order by cs.created_at desc
  limit 1
) s on true
left join public.billing_plans pl on pl.id = s.plan_id
left join lateral (
  select bi.* from public.billing_invoices bi
  where bi.company_id = c.id
  order by bi.created_at desc
  limit 1
) inv on true
where public.is_super_admin() or c.id = public.current_company_id();

grant select on public.v_company_billing_summary to authenticated;

-- ───────── 8. planos iniciais ─────────
-- Lançamento com plano único: Profissional a R$ 197/mês. + um Trial grátis.
insert into public.billing_plans (code, name, price_cents, max_users, max_instances)
select v.code, v.name, v.price_cents, v.max_users, v.max_instances
from (values
  ('trial', 'Teste Grátis', 0,     3,  1),
  ('pro',   'Profissional', 19700, 15, 3)
) as v(code, name, price_cents, max_users, max_instances)
where not exists (select 1 from public.billing_plans bp where bp.code = v.code);
