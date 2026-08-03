-- =====================================================================
-- OSManager — RBAC de Locações + Cliente Interno
--
-- Mudanças:
--   • customers.is_internal — flag "ativo da própria empresa"
--                              (não é cliente real, só pra controle interno)
--   • rental_contracts.seller_id — quem fechou o contrato (auto via trigger)
--   • rental_contract_items.technician_id — técnico responsável pelo equipamento
--
-- Regras:
--   admin/gerente   → tudo
--   vendedor        → só seus próprios contratos (seller_id = ele)
--   tecnico         → vê contratos que tenham AO MENOS UM equipamento atribuído a ele;
--                     edita só os itens onde technician_id = ele;
--                     pode registrar leituras de contadores nos itens dele.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Coluna nova em customers
-- ---------------------------------------------------------------------
alter table public.customers
  add column if not exists is_internal boolean not null default false;

comment on column public.customers.is_internal is
  'Cliente "interno" — representa a própria empresa para registrar equipamentos próprios e atribuição a técnicos. Não aparece no comercial.';

create index if not exists customers_is_internal_idx on public.customers(is_internal);

-- ---------------------------------------------------------------------
-- 2) Colunas novas em rental_contracts e rental_contract_items
-- ---------------------------------------------------------------------
alter table public.rental_contracts
  add column if not exists seller_id uuid references public.profiles(id) on delete set null;

create index if not exists rental_contracts_seller_idx on public.rental_contracts(seller_id);

alter table public.rental_contract_items
  add column if not exists technician_id uuid references public.profiles(id) on delete set null;

create index if not exists rental_items_tech_idx on public.rental_contract_items(technician_id);

-- ---------------------------------------------------------------------
-- 3) Trigger: auto-fill seller_id ao criar contrato
-- ---------------------------------------------------------------------
create or replace function public.tg_rental_set_seller()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.seller_id is null then
    new.seller_id := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_rental_set_seller on public.rental_contracts;
create trigger trg_rental_set_seller
  before insert on public.rental_contracts
  for each row execute function public.tg_rental_set_seller();

-- ---------------------------------------------------------------------
-- 4) RLS — substitui as policies antigas
-- ---------------------------------------------------------------------

-- ---- rental_contracts ----
drop policy if exists "rental_contracts_select" on public.rental_contracts;
create policy "rental_contracts_select" on public.rental_contracts for select
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (
        public.is_admin_or_manager()
        or seller_id = auth.uid()
        or exists (
          select 1 from public.rental_contract_items rci
          where rci.contract_id = rental_contracts.id
            and rci.technician_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "rental_contracts_write" on public.rental_contracts;

drop policy if exists "rental_contracts_insert" on public.rental_contracts;
create policy "rental_contracts_insert" on public.rental_contracts for insert
  with check (
    company_id = public.current_company_id()
    and (
      public.is_admin_or_manager()
      or public.has_role(auth.uid(),'vendedor'::public.app_role)
      or public.has_role(auth.uid(),'user'::public.app_role)
    )
  );

drop policy if exists "rental_contracts_update" on public.rental_contracts;
create policy "rental_contracts_update" on public.rental_contracts for update
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (public.is_admin_or_manager() or seller_id = auth.uid())
    )
  );

drop policy if exists "rental_contracts_delete" on public.rental_contracts;
create policy "rental_contracts_delete" on public.rental_contracts for delete
  using (
    public.is_super_admin()
    or (company_id = public.current_company_id() and public.is_admin_or_manager())
  );

-- ---- rental_contract_items ----
drop policy if exists "rental_items_all" on public.rental_contract_items;

drop policy if exists "rental_items_select" on public.rental_contract_items;
create policy "rental_items_select" on public.rental_contract_items for select
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.rental_contracts c
      where c.id = rental_contract_items.contract_id
        and c.company_id = public.current_company_id()
        and (
          public.is_admin_or_manager()
          or c.seller_id = auth.uid()
          or rental_contract_items.technician_id = auth.uid()
        )
    )
  );

drop policy if exists "rental_items_insert" on public.rental_contract_items;
create policy "rental_items_insert" on public.rental_contract_items for insert
  with check (
    exists (
      select 1 from public.rental_contracts c
      where c.id = rental_contract_items.contract_id
        and c.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or c.seller_id = auth.uid())
    )
  );

drop policy if exists "rental_items_update" on public.rental_contract_items;
create policy "rental_items_update" on public.rental_contract_items for update
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.rental_contracts c
      where c.id = rental_contract_items.contract_id
        and c.company_id = public.current_company_id()
        and (
          public.is_admin_or_manager()
          or c.seller_id = auth.uid()
          or rental_contract_items.technician_id = auth.uid()  -- técnico pode atualizar campos do próprio item
        )
    )
  );

drop policy if exists "rental_items_delete" on public.rental_contract_items;
create policy "rental_items_delete" on public.rental_contract_items for delete
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.rental_contracts c
      where c.id = rental_contract_items.contract_id
        and c.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or c.seller_id = auth.uid())
    )
  );

-- ---- rental_meter_readings: técnico do item pode inserir/ler ----
drop policy if exists "rental_readings_select" on public.rental_meter_readings;
create policy "rental_readings_select" on public.rental_meter_readings for select
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.rental_contract_items rci
      join public.rental_contracts c on c.id = rci.contract_id
      where rci.id = rental_meter_readings.contract_item_id
        and c.company_id = public.current_company_id()
        and (
          public.is_admin_or_manager()
          or c.seller_id = auth.uid()
          or rci.technician_id = auth.uid()
        )
    )
  );

drop policy if exists "rental_readings_insert" on public.rental_meter_readings;
create policy "rental_readings_insert" on public.rental_meter_readings for insert
  with check (
    exists (
      select 1 from public.rental_contract_items rci
      join public.rental_contracts c on c.id = rci.contract_id
      where rci.id = rental_meter_readings.contract_item_id
        and c.company_id = public.current_company_id()
        and (
          public.is_admin_or_manager()
          or c.seller_id = auth.uid()
          or rci.technician_id = auth.uid()
        )
    )
  );

-- ---- rental_invoices: só admin/gerente gerencia (vendedor lê as próprias) ----
drop policy if exists "rental_invoices_all" on public.rental_invoices;

drop policy if exists "rental_invoices_select" on public.rental_invoices;
create policy "rental_invoices_select" on public.rental_invoices for select
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (
        public.is_admin_or_manager()
        or exists (
          select 1 from public.rental_contracts c
          where c.id = rental_invoices.contract_id and c.seller_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "rental_invoices_write" on public.rental_invoices;
create policy "rental_invoices_write" on public.rental_invoices for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id() and public.is_admin_or_manager());

-- rental_invoice_items: idem invoice
drop policy if exists "rental_invoice_items_all" on public.rental_invoice_items;
create policy "rental_invoice_items_all" on public.rental_invoice_items for all
  using (public.is_super_admin() or exists (
    select 1 from public.rental_invoices ri
    where ri.id = rental_invoice_items.invoice_id
      and ri.company_id = public.current_company_id()
      and public.is_admin_or_manager()
  ))
  with check (exists (
    select 1 from public.rental_invoices ri
    where ri.id = rental_invoice_items.invoice_id
      and ri.company_id = public.current_company_id()
      and public.is_admin_or_manager()
  ));
