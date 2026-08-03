-- =====================================================================
-- OSManager — RPC de signup
-- O cliente anon não pode SELECT em companies (a policy só libera quem
-- pertence à company). Uma RPC SECURITY DEFINER cria a company e
-- devolve o id, permitindo o fluxo de cadastro funcionar.
-- =====================================================================

-- Remove a policy de INSERT anônimo que ficou inútil.
drop policy if exists "companies_signup_insert" on public.companies;

create or replace function public.signup_create_company(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Nome da empresa é obrigatório';
  end if;

  insert into public.companies (name)
  values (btrim(p_name))
  returning id into v_id;

  return v_id;
end $$;

-- Permite chamar a RPC tanto antes do signup (anon) quanto depois (authenticated)
grant execute on function public.signup_create_company(text) to anon, authenticated;
