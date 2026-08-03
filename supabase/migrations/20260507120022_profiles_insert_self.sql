-- =====================================================================
-- OSManager — Permite user inserir o próprio profile no signup
--
-- Antes: só policy de UPDATE existia. Quando o trigger handle_new_user
--   não criava o profile (perdido em algum reset, ou timing do
--   PostgREST), o upsert do cliente fazia INSERT e batia em RLS.
--
-- Agora: profiles aceita INSERT do próprio user (id = auth.uid()).
-- =====================================================================

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- Garante que o trigger que cria profile automaticamente existe.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
