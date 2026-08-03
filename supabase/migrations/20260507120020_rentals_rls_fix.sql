-- =====================================================================
-- OSManager — Fix RLS recursivo entre rental_contracts e rental_contract_items
--
-- Problema: a policy SELECT de cada tabela consulta a outra (com
-- subquery EXISTS), criando ciclo. Postgres detecta e barra.
--
-- Solução: helper SECURITY DEFINER que decide visibilidade em uma
-- chamada, ignorando RLS internamente. As policies passam a chamar
-- a função em vez de subqueries cruzadas.
-- =====================================================================

create or replace function public.can_view_rental_contract(p_contract_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company    uuid;
  v_seller     uuid;
  v_uid        uuid := auth.uid();
  v_my_company uuid := public.current_company_id();
begin
  if public.is_super_admin() then return true; end if;
  if v_uid is null then return false; end if;

  select company_id, seller_id
    into v_company, v_seller
    from public.rental_contracts
   where id = p_contract_id;

  if v_company is null then return false; end if;
  if v_company <> v_my_company then return false; end if;

  -- admin/gerente da própria empresa: vê tudo
  if public.is_admin_or_manager() then return true; end if;

  -- vendedor dono do contrato
  if v_seller = v_uid then return true; end if;

  -- técnico com item atribuído nesse contrato
  if exists (
    select 1 from public.rental_contract_items
     where contract_id = p_contract_id and technician_id = v_uid
  ) then return true; end if;

  return false;
end $$;

grant execute on function public.can_view_rental_contract(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Reescreve as policies de SELECT pra usar a função (sem recursão)
-- ---------------------------------------------------------------------

drop policy if exists "rental_contracts_select" on public.rental_contracts;
create policy "rental_contracts_select" on public.rental_contracts for select
  using (public.can_view_rental_contract(id));

drop policy if exists "rental_items_select" on public.rental_contract_items;
create policy "rental_items_select" on public.rental_contract_items for select
  using (public.can_view_rental_contract(contract_id));

drop policy if exists "rental_readings_select" on public.rental_meter_readings;
create policy "rental_readings_select" on public.rental_meter_readings for select
  using (
    exists (
      select 1 from public.rental_contract_items rci
       where rci.id = rental_meter_readings.contract_item_id
         and public.can_view_rental_contract(rci.contract_id)
    )
  );

-- A insert de leituras também precisa do mesmo path sem recursão
drop policy if exists "rental_readings_insert" on public.rental_meter_readings;
create policy "rental_readings_insert" on public.rental_meter_readings for insert
  with check (
    exists (
      select 1 from public.rental_contract_items rci
       where rci.id = rental_meter_readings.contract_item_id
         and public.can_view_rental_contract(rci.contract_id)
    )
  );

-- Itens INSERT/UPDATE/DELETE: também passam a usar a função (consistência)
drop policy if exists "rental_items_insert" on public.rental_contract_items;
create policy "rental_items_insert" on public.rental_contract_items for insert
  with check (public.can_view_rental_contract(contract_id));

drop policy if exists "rental_items_update" on public.rental_contract_items;
create policy "rental_items_update" on public.rental_contract_items for update
  using (public.can_view_rental_contract(contract_id));

drop policy if exists "rental_items_delete" on public.rental_contract_items;
create policy "rental_items_delete" on public.rental_contract_items for delete
  using (public.can_view_rental_contract(contract_id));

-- Faturas: select continua via lookup direto pra evitar tocar em items.
drop policy if exists "rental_invoices_select" on public.rental_invoices;
create policy "rental_invoices_select" on public.rental_invoices for select
  using (public.can_view_rental_contract(contract_id));
