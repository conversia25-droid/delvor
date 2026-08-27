-- =====================================================================
-- Papel 'financeiro' — RLS + vínculo com colaborador
-- 1. Helper has_financial_access() (admin OR gerente OR financeiro OR super_admin)
-- 2. Recria policies das 4 tabelas de financeiro pra aceitar o papel novo
-- 3. Adiciona linked_user_id em fixed_expenses e variable_expenses
-- =====================================================================

-- ───────── 1. Helper ─────────
create or replace function public.has_financial_access()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_super_admin()
      or public.has_role(auth.uid(), 'admin'::public.app_role)
      or public.has_role(auth.uid(), 'gerente'::public.app_role)
      or public.has_role(auth.uid(), 'financeiro'::public.app_role);
$$;


-- ───────── 2. Recria policies com o helper novo ─────────
-- expense_categories: escrita = has_financial_access
drop policy if exists "ec_write" on public.expense_categories;
create policy "ec_write" on public.expense_categories for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()))
  with check (company_id = public.current_company_id());

-- fixed_expenses
drop policy if exists "fe_write" on public.fixed_expenses;
create policy "fe_write" on public.fixed_expenses for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()))
  with check (company_id = public.current_company_id());

-- fixed_expense_payments
drop policy if exists "fep_write" on public.fixed_expense_payments;
create policy "fep_write" on public.fixed_expense_payments for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()))
  with check (company_id = public.current_company_id());

-- variable_expenses
drop policy if exists "ve_write" on public.variable_expenses;
create policy "ve_write" on public.variable_expenses for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()))
  with check (company_id = public.current_company_id());


-- ───────── 3. Vínculo com colaborador ─────────
-- Nullable — a maior parte das despesas não é ligada a pessoa. Usa on delete
-- set null pra não perder o histórico quando o funcionário é removido.
alter table public.fixed_expenses
  add column if not exists linked_user_id uuid
    references public.profiles(id) on delete set null;

alter table public.variable_expenses
  add column if not exists linked_user_id uuid
    references public.profiles(id) on delete set null;

create index if not exists fixed_expenses_linked_user_idx
  on public.fixed_expenses(linked_user_id) where linked_user_id is not null;
create index if not exists variable_expenses_linked_user_idx
  on public.variable_expenses(linked_user_id) where linked_user_id is not null;
