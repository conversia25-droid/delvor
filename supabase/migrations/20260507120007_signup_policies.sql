-- =====================================================================
-- OSManager — Policies pra permitir o fluxo de signup público
-- O signup (anon) precisa criar uma empresa antes de criar o user.
-- Após o signup, profile + user_role 'admin' são criados pelo client
-- e pelo trigger handle_new_user.
-- =====================================================================

-- Permite QUALQUER UM (anon) criar uma empresa nova durante o signup.
drop policy if exists "companies_signup_insert" on public.companies;
create policy "companies_signup_insert"
  on public.companies for insert
  to anon, authenticated
  with check (true);

-- Permite o user autenticado criar seu próprio user_role na company que
-- acabou de criar (ele será o admin dessa company).
drop policy if exists "user_roles_self_insert_after_signup" on public.user_roles;
create policy "user_roles_self_insert_after_signup"
  on public.user_roles for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (company_id is null or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.company_id = user_roles.company_id
    ))
  );

-- Para o profile.upsert do signup funcionar (handle_new_user já cria
-- o profile via trigger; o cliente só precisa atualizar com company_id e
-- demais campos). A policy "profiles_update_self" já existe.
