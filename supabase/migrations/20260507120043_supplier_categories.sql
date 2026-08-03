-- =====================================================================
-- Categorias de fornecedor (impressoras, toners, peças, etc).
-- Segue o mesmo padrão de product_categories: 1 tabela por company,
-- com relação opcional em suppliers via category_id.
-- =====================================================================

create table if not exists public.supplier_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (company_id, name)
);

create index if not exists supplier_categories_company_idx
  on public.supplier_categories(company_id);

alter table public.suppliers
  add column if not exists category_id uuid
    references public.supplier_categories(id) on delete set null;

create index if not exists suppliers_category_idx
  on public.suppliers(category_id);

-- RLS + policies (mesmo modelo de product_categories: leitura pra qualquer
-- usuário da company, escrita só admin/gerente).
alter table public.supplier_categories enable row level security;

drop policy if exists "scats_select" on public.supplier_categories;
create policy "scats_select" on public.supplier_categories for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "scats_write" on public.supplier_categories;
create policy "scats_write" on public.supplier_categories for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());
