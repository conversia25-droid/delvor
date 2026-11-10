-- =====================================================================
-- 65 — Fix: "new row violates row-level security policy for table
-- rental_contracts" ao criar contrato de locação.
--
-- O front faz insert(...).select() (INSERT ... RETURNING), e o Postgres
-- exige que a linha nova passe também na policy de SELECT. Essa policy
-- chamava can_view_rental_contract(id), que RELÊ a tabela — e a leitura
-- não enxerga a linha que o próprio comando está inserindo. Resultado:
-- todo mundo (menos super admin) levava o erro.
--
-- Agora a policy olha as colunas da própria linha; só a parte do técnico
-- (que depende dos itens) usa um helper SECURITY DEFINER, sem recursão.
-- can_view_rental_contract continua servindo itens, leituras e faturas.
-- =====================================================================

create or replace function public.rental_is_technician(p_contract_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rental_contract_items
     where contract_id = p_contract_id and technician_id = auth.uid()
  );
$$;

grant execute on function public.rental_is_technician(uuid) to authenticated;

drop policy if exists "rental_contracts_select" on public.rental_contracts;
create policy "rental_contracts_select" on public.rental_contracts for select
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (
        public.is_admin_or_manager()
        or seller_id = auth.uid()
        or public.rental_is_technician(id)
      )
    )
  );
