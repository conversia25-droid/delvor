-- =====================================================================
-- ADD-ON FINANCEIRO — Fase A (parte 1: tabelas + RLS)
-- Cria estrutura para controle de:
--   - Despesas fixas (recorrentes mensais)
--   - Pagamentos das fixas por mês (pra saber o que foi pago de verdade)
--   - Despesas variáveis (lançamentos pontuais)
--   - Categorias de despesa
--   - Controle de ativação de add-ons por empresa
--
-- RLS igual ao padrão do resto do projeto:
--   select: super_admin OR company_matches
--   write:  super_admin OR (company_matches AND admin/gerente)
-- Exceção: company_addons só super_admin escreve (ele é quem cobra).
-- =====================================================================

-- ───────── 1. Categorias de despesa/receita ─────────
create table if not exists public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  kind        text not null default 'despesa' check (kind in ('despesa', 'receita')),
  created_at  timestamptz not null default now(),
  unique (company_id, name)
);

create index if not exists expense_categories_company_idx
  on public.expense_categories(company_id);

alter table public.expense_categories enable row level security;

drop policy if exists "ec_select" on public.expense_categories;
create policy "ec_select" on public.expense_categories for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "ec_write" on public.expense_categories;
create policy "ec_write" on public.expense_categories for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());


-- ───────── 2. Despesas fixas (recorrentes) ─────────
create table if not exists public.fixed_expenses (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  amount_cents  integer not null check (amount_cents >= 0),
  due_day       smallint not null check (due_day between 1 and 31),
  category_id   uuid references public.expense_categories(id) on delete set null,
  active        boolean not null default true,
  starts_on     date,
  ends_on       date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists fixed_expenses_company_idx
  on public.fixed_expenses(company_id);
create index if not exists fixed_expenses_category_idx
  on public.fixed_expenses(category_id);
create index if not exists fixed_expenses_active_idx
  on public.fixed_expenses(company_id, active) where active;

alter table public.fixed_expenses enable row level security;

drop policy if exists "fe_select" on public.fixed_expenses;
create policy "fe_select" on public.fixed_expenses for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "fe_write" on public.fixed_expenses;
create policy "fe_write" on public.fixed_expenses for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());


-- ───────── 3. Pagamentos das despesas fixas (mês a mês) ─────────
-- Toda fixa "gera" uma cobrança pra cada mês. Quando paga, cria row aqui.
-- month_ref formato YYYY-MM-01 (dia sempre 01, agrupador do mês).
create table if not exists public.fixed_expense_payments (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  fixed_expense_id  uuid not null references public.fixed_expenses(id) on delete cascade,
  month_ref         date not null,
  paid_on           date not null default current_date,
  amount_cents      integer not null check (amount_cents >= 0),
  notes             text,
  created_at        timestamptz not null default now(),
  unique (fixed_expense_id, month_ref)
);

create index if not exists fixed_expense_payments_company_idx
  on public.fixed_expense_payments(company_id);
create index if not exists fixed_expense_payments_paid_on_idx
  on public.fixed_expense_payments(paid_on);
create index if not exists fixed_expense_payments_month_idx
  on public.fixed_expense_payments(month_ref);

alter table public.fixed_expense_payments enable row level security;

drop policy if exists "fep_select" on public.fixed_expense_payments;
create policy "fep_select" on public.fixed_expense_payments for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "fep_write" on public.fixed_expense_payments;
create policy "fep_write" on public.fixed_expense_payments for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());


-- ───────── 4. Despesas variáveis (pontuais / uma-vez) ─────────
create table if not exists public.variable_expenses (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  amount_cents  integer not null check (amount_cents >= 0),
  paid_on       date not null default current_date,
  category_id   uuid references public.expense_categories(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists variable_expenses_company_idx
  on public.variable_expenses(company_id);
create index if not exists variable_expenses_paid_on_idx
  on public.variable_expenses(paid_on);
create index if not exists variable_expenses_category_idx
  on public.variable_expenses(category_id);

alter table public.variable_expenses enable row level security;

drop policy if exists "ve_select" on public.variable_expenses;
create policy "ve_select" on public.variable_expenses for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "ve_write" on public.variable_expenses;
create policy "ve_write" on public.variable_expenses for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());


-- ───────── 5. Controle de add-ons por empresa ─────────
-- Só o super-admin liga/desliga add-on (é ele quem cobra).
-- Usuários da company só leem pra saber se addon está ativo (gate na UI).
create table if not exists public.company_addons (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  addon_code           text not null,
  active               boolean not null default false,
  activated_at         timestamptz,
  cancelled_at         timestamptz,
  monthly_price_cents  integer not null default 0,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, addon_code)
);

create index if not exists company_addons_company_idx
  on public.company_addons(company_id);
create index if not exists company_addons_active_idx
  on public.company_addons(company_id, active) where active;

alter table public.company_addons enable row level security;

drop policy if exists "ca_select" on public.company_addons;
create policy "ca_select" on public.company_addons for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "ca_write" on public.company_addons;
create policy "ca_write" on public.company_addons for all
  using (public.is_super_admin())
  with check (public.is_super_admin());


-- ───────── 6. Trigger de updated_at ─────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_fixed_expenses on public.fixed_expenses;
create trigger trg_touch_fixed_expenses
  before update on public.fixed_expenses
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_company_addons on public.company_addons;
create trigger trg_touch_company_addons
  before update on public.company_addons
  for each row execute function public.touch_updated_at();
