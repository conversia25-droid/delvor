-- =====================================================================
-- Fix: super-admin (Ivan) precisa poder criar rental_contracts em
-- QUALQUER empresa quando estiver acessando pelo painel master.
--
-- A policy de INSERT anterior só checava roles (admin/manager/vendedor/
-- user) da company atual — super-admin não caía em nenhuma, resultado
-- 403 "new row violates row-level security".
-- =====================================================================

drop policy if exists "rental_contracts_insert" on public.rental_contracts;
create policy "rental_contracts_insert" on public.rental_contracts for insert
  with check (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (
        public.is_admin_or_manager()
        or public.has_role(auth.uid(),'vendedor'::public.app_role)
        or public.has_role(auth.uid(),'user'::public.app_role)
      )
    )
  );
