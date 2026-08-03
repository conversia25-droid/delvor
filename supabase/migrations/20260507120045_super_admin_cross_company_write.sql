-- =====================================================================
-- Fix: super-admin (Ivan) precisa poder atualizar linhas de QUALQUER
-- empresa pra usar o painel /master/empresas/:id/arquivo.
--
-- As policies existentes tinham `using` que aceita super-admin, mas o
-- `with check` só permitia se company_id = current_company_id() —
-- resultado: SELECT/UPDATE viam a linha mas o CHECK barrava (403).
--
-- Aqui só refazemos o with check pra incluir is_super_admin().
-- =====================================================================

-- SALES
drop policy if exists "sales_rw" on public.sales;
create policy "sales_rw" on public.sales for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (public.is_super_admin() or company_id = public.current_company_id());

-- PRODUCTS (patch da policy _write do 20260507120012)
drop policy if exists "products_write" on public.products;
create policy "products_write" on public.products for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()));

-- SERVICE ORDERS
drop policy if exists "os_rw" on public.service_orders;
create policy "os_rw" on public.service_orders for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (public.is_super_admin() or company_id = public.current_company_id());

-- PURCHASES (patch da policy _all do 20260507120012)
drop policy if exists "purchases_all" on public.purchases;
create policy "purchases_all" on public.purchases for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()));
