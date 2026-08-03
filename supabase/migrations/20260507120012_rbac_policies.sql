-- =====================================================================
-- OSManager — RBAC: policies por papel
--
-- Regras:
--   admin / gerente / super_admin → enxergam tudo da empresa
--   vendedor                       → vê só vendas com seller_id = ele
--                                    e OS abertas por ele (opened_by)
--   tecnico                        → vê só OS atribuídas a ele
--                                    (technician_id) e itens / histórico
--                                    / anexos dessas OS
--                                    Sem acesso a vendas.
--
-- Transferências de propriedade são feitas via RPCs (próxima migration)
-- que rodam SECURITY DEFINER, contornando RLS de forma controlada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------
create or replace function public.is_admin_or_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_super_admin()
      or public.has_role(auth.uid(), 'admin'::public.app_role)
      or public.has_role(auth.uid(), 'gerente'::public.app_role);
$$;

create or replace function public.has_any_role(_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = any (_roles)
  );
$$;

-- ---------------------------------------------------------------------
-- SERVICE_ORDERS
-- ---------------------------------------------------------------------
drop policy if exists "os_rw" on public.service_orders;

drop policy if exists "os_select" on public.service_orders;
create policy "os_select" on public.service_orders for select
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (
        public.is_admin_or_manager()
        or technician_id = auth.uid()
        or opened_by    = auth.uid()
      )
    )
  );

drop policy if exists "os_insert" on public.service_orders;
create policy "os_insert" on public.service_orders for insert
  with check (
    company_id = public.current_company_id()
  );

drop policy if exists "os_update" on public.service_orders;
create policy "os_update" on public.service_orders for update
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (
        public.is_admin_or_manager()
        or technician_id = auth.uid()
        or opened_by    = auth.uid()
      )
    )
  );

drop policy if exists "os_delete" on public.service_orders;
create policy "os_delete" on public.service_orders for delete
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and public.is_admin_or_manager()
    )
  );

-- ---------------------------------------------------------------------
-- SERVICE_ORDER_ITEMS
-- ---------------------------------------------------------------------
drop policy if exists "os_items_rw" on public.service_order_items;
drop policy if exists "os_items_all" on public.service_order_items;
create policy "os_items_all" on public.service_order_items for all
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.service_orders o
      where o.id = service_order_items.service_order_id
        and o.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or o.technician_id = auth.uid() or o.opened_by = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.service_orders o
      where o.id = service_order_items.service_order_id
        and o.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or o.technician_id = auth.uid() or o.opened_by = auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- SERVICE_ORDER_HISTORY
-- ---------------------------------------------------------------------
drop policy if exists "os_history_rw" on public.service_order_history;
drop policy if exists "os_history_all" on public.service_order_history;
create policy "os_history_all" on public.service_order_history for all
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.service_orders o
      where o.id = service_order_history.service_order_id
        and o.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or o.technician_id = auth.uid() or o.opened_by = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.service_orders o
      where o.id = service_order_history.service_order_id
        and o.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or o.technician_id = auth.uid() or o.opened_by = auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- SERVICE_ORDER_ATTACHMENTS
-- ---------------------------------------------------------------------
drop policy if exists "os_attach_rw" on public.service_order_attachments;
drop policy if exists "os_attach_all" on public.service_order_attachments;
create policy "os_attach_all" on public.service_order_attachments for all
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.service_orders o
      where o.id = service_order_attachments.service_order_id
        and o.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or o.technician_id = auth.uid() or o.opened_by = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.service_orders o
      where o.id = service_order_attachments.service_order_id
        and o.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or o.technician_id = auth.uid() or o.opened_by = auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- SALES (vendas) — vendedor vê só as próprias
-- ---------------------------------------------------------------------
drop policy if exists "sales_rw" on public.sales;

drop policy if exists "sales_select" on public.sales;
create policy "sales_select" on public.sales for select
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (public.is_admin_or_manager() or seller_id = auth.uid())
    )
  );

drop policy if exists "sales_insert" on public.sales;
create policy "sales_insert" on public.sales for insert
  with check (
    company_id = public.current_company_id()
    and (
      public.is_admin_or_manager()
      or public.has_role(auth.uid(),'vendedor'::public.app_role)
      or public.has_role(auth.uid(),'user'::public.app_role)
    )
  );

drop policy if exists "sales_update" on public.sales;
create policy "sales_update" on public.sales for update
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (public.is_admin_or_manager() or seller_id = auth.uid())
    )
  );

drop policy if exists "sales_delete" on public.sales;
create policy "sales_delete" on public.sales for delete
  using (
    public.is_super_admin()
    or (company_id = public.current_company_id() and public.is_admin_or_manager())
  );

-- ---------------------------------------------------------------------
-- SALE_ITEMS / SALE_PAYMENTS
-- ---------------------------------------------------------------------
drop policy if exists "sale_items_rw" on public.sale_items;
drop policy if exists "sale_items_all" on public.sale_items;
create policy "sale_items_all" on public.sale_items for all
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.sales s
      where s.id = sale_items.sale_id
        and s.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or s.seller_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.sales s
      where s.id = sale_items.sale_id
        and s.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or s.seller_id = auth.uid())
    )
  );

drop policy if exists "sale_pay_rw" on public.sale_payments;
drop policy if exists "sale_pay_all" on public.sale_payments;
create policy "sale_pay_all" on public.sale_payments for all
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.sales s
      where s.id = sale_payments.sale_id
        and s.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or s.seller_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.sales s
      where s.id = sale_payments.sale_id
        and s.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or s.seller_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- PRODUCTS / SUPPLIERS / PURCHASES — leitura para todos da empresa,
-- escrita só admin/gerente.
-- ---------------------------------------------------------------------
drop policy if exists "products_rw" on public.products;
drop policy if exists "products_select" on public.products;
create policy "products_select" on public.products for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "products_write" on public.products;
create policy "products_write" on public.products for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());

drop policy if exists "suppliers_rw" on public.suppliers;
drop policy if exists "suppliers_select" on public.suppliers;
create policy "suppliers_select" on public.suppliers for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "suppliers_write" on public.suppliers;
create policy "suppliers_write" on public.suppliers for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());

drop policy if exists "purchases_rw" on public.purchases;
drop policy if exists "purchases_all" on public.purchases;
create policy "purchases_all" on public.purchases for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id() and public.is_admin_or_manager());

-- stock_movements: leitura toda empresa, escrita admin/gerente OU baixas automáticas via OS/Venda (security definer triggers).
drop policy if exists "stock_mov_rw" on public.stock_movements;
drop policy if exists "stock_mov_select" on public.stock_movements;
create policy "stock_mov_select" on public.stock_movements for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "stock_mov_insert" on public.stock_movements;
create policy "stock_mov_insert" on public.stock_movements for insert
  with check (
    company_id = public.current_company_id()
    and (
      public.is_admin_or_manager()
      -- baixa automática referenciando OS/venda permitida pra qualquer um da empresa
      or ref_table in ('service_orders','sales')
    )
  );

-- categorias e catálogo de serviços: ler todos, escrever admin/gerente
drop policy if exists "pcats_rw" on public.product_categories;
drop policy if exists "pcats_select" on public.product_categories;
create policy "pcats_select" on public.product_categories for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "pcats_write" on public.product_categories;
create policy "pcats_write" on public.product_categories for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());

drop policy if exists "services_rw" on public.services_catalog;
drop policy if exists "services_select" on public.services_catalog;
create policy "services_select" on public.services_catalog for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "services_write" on public.services_catalog;
create policy "services_write" on public.services_catalog for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());
