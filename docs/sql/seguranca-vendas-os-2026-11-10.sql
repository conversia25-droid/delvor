-- =====================================================================
-- DELVOR — Fix de segurança: vendas e OS por papel — 10/11/2026
-- Projeto: wggvhxtfeucntdunhocn
-- Abrir em: https://supabase.com/dashboard/project/wggvhxtfeucntdunhocn/sql/new
--
-- Hoje qualquer usuário da empresa vê, altera e apaga QUALQUER venda e OS.
-- Depois deste SQL:
--   • admin/gerente: tudo, como hoje
--   • vendedor/usuário: só as próprias vendas; não apaga venda
--   • técnico: só OS atribuídas a ele ou abertas por ele; não apaga OS
--   • financeiro: lê todas as vendas (para Contas a receber), não altera
--   • super admin: continua entrando em qualquer empresa
-- Pode rodar mais de uma vez. Se der erro, nada é aplicado.
-- =====================================================================

-- ───────── TRAVA: só roda no banco do Delvor ─────────
do $$ begin
  if to_regclass('public.sales') is null
     or to_regclass('public.service_orders') is null
     or to_regclass('public.finance_periods') is null then
    raise exception 'TRAVA: este SQL é do Delvor (projeto wggvhxtfeucntdunhocn). Banco errado — nada foi alterado.';
  end if;
end $$;

-- =====================================================================
-- 68 — Fix de segurança: vendas e OS voltam a respeitar o papel
--
-- A 45 (super admin escrevendo em qualquer empresa) recriou as policies
-- antigas "sales_rw" e "os_rw" (FOR ALL, só checando a empresa). Como
-- policies se SOMAM (basta uma liberar), elas anulavam as regras por
-- papel da 12: qualquer usuário da empresa via, alterava e apagava
-- qualquer venda/OS.
--
-- Aqui: remove as duas e refaz as policies por papel já incluindo o
-- super admin no WITH CHECK (o motivo da 45). Regras:
--   Vendas: admin/gerente tudo; vendedor/usuário só as próprias
--           (seller_id); financeiro LÊ todas (Contas a receber abre a
--           venda); apagar só admin/gerente.
--   OS:     admin/gerente tudo; técnico as atribuídas a ele; quem abriu
--           a OS (opened_by) também; apagar só admin/gerente.
-- Transferência de venda/OS continua pelas RPCs (security definer).
-- =====================================================================

-- ───────── VENDAS ─────────
drop policy if exists "sales_rw" on public.sales;

drop policy if exists "sales_select" on public.sales;
create policy "sales_select" on public.sales for select
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (public.is_admin_or_manager() or seller_id = auth.uid() or public.has_financial_access())
    )
  );

drop policy if exists "sales_insert" on public.sales;
create policy "sales_insert" on public.sales for insert
  with check (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (
        public.is_admin_or_manager()
        or public.has_role(auth.uid(), 'vendedor'::public.app_role)
        or public.has_role(auth.uid(), 'user'::public.app_role)
      )
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
  )
  with check (
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

-- Financeiro só LÊ itens e pagamentos (baixa/estorno seguem pelas RPCs).
drop policy if exists "sale_items_fin_select" on public.sale_items;
create policy "sale_items_fin_select" on public.sale_items for select
  using (
    public.has_financial_access()
    and exists (
      select 1 from public.sales s
       where s.id = sale_items.sale_id and s.company_id = public.current_company_id()
    )
  );

drop policy if exists "sale_pay_fin_select" on public.sale_payments;
create policy "sale_pay_fin_select" on public.sale_payments for select
  using (
    public.has_financial_access()
    and exists (
      select 1 from public.sales s
       where s.id = sale_payments.sale_id and s.company_id = public.current_company_id()
    )
  );

-- ───────── ORDENS DE SERVIÇO ─────────
drop policy if exists "os_rw" on public.service_orders;

drop policy if exists "os_select" on public.service_orders;
create policy "os_select" on public.service_orders for select
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (public.is_admin_or_manager() or technician_id = auth.uid() or opened_by = auth.uid())
    )
  );

drop policy if exists "os_insert" on public.service_orders;
create policy "os_insert" on public.service_orders for insert
  with check (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "os_update" on public.service_orders;
create policy "os_update" on public.service_orders for update
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (public.is_admin_or_manager() or technician_id = auth.uid() or opened_by = auth.uid())
    )
  )
  with check (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (public.is_admin_or_manager() or technician_id = auth.uid() or opened_by = auth.uid())
    )
  );

drop policy if exists "os_delete" on public.service_orders;
create policy "os_delete" on public.service_orders for delete
  using (
    public.is_super_admin()
    or (company_id = public.current_company_id() and public.is_admin_or_manager())
  );

-- ───────── CONFERÊNCIA (o Studio mostra só este resultado) ─────────
-- Esperado: nenhuma linha com sales_rw / os_rw, e as regras por papel listadas.
select tablename as tabela, policyname as regra, cmd as operacao
  from pg_policies
 where schemaname = 'public' and tablename in ('sales', 'service_orders', 'sale_items', 'sale_payments')
 order by tablename, policyname;
