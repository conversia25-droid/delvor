-- =====================================================================
-- 69 — Equipe: remover/reativar membro + travas de papel e perfil
--
-- 1) Remover da equipe (remove_team_member / reactivate_team_member)
--    Não apaga o usuário: tira os papéis e marca profiles.active = false.
--    current_company_id() passa a exigir perfil ativo, então quem foi
--    removido perde acesso a TUDO da empresa na hora (todas as regras
--    passam por ela), mas o nome continua nas vendas/OS antigas.
--
-- 2) Fecha brechas de escalada de privilégio (achadas em 10/11/2026):
--    • "user_roles_self_insert_after_signup" aceitava company_id nulo e
--      qualquer papel: qualquer usuário logado podia se dar admin ou
--      super_admin. Agora só vale no cadastro: papel admin, na própria
--      empresa, e só se a empresa ainda não tem ninguém.
--    • Admin podia dar papel (até super_admin) a usuário de outra empresa.
--    • "profiles_update_self" deixava cada um trocar a própria empresa,
--      a própria comissão e o próprio "ativo".
--    Serviço (edge function com service role) e super admin continuam livres.
-- =====================================================================

-- Empresa já tem alguém com papel? (security definer: enxerga além do RLS)
create or replace function public._company_has_members(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where company_id = p_company);
$$;

-- Perfil desativado = sem empresa para o RLS.
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid() and active;
$$;

-- ───────── trava de perfil (empresa, ativo, comissão) ─────────
create or replace function public.tg_guard_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
begin
  if v_uid is null or current_setting('delvor.team_rpc', true) = '1' or public.is_super_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.company_id is not null and public._company_has_members(new.company_id) then
      raise exception 'Não é possível entrar numa empresa existente por aqui. Peça ao administrador para cadastrar você.' using errcode = '42501';
    end if;
    new.active := true;
    new.commission_rate := 0;
    return new;
  end if;

  v_admin := old.company_id is not null
             and old.company_id = public.current_company_id()
             and public.has_role(v_uid, 'admin'::public.app_role);

  if new.company_id is distinct from old.company_id then
    -- única exceção: o próprio usuário no cadastro, entrando na empresa que acabou de criar
    if not (new.id = v_uid and old.company_id is null and new.company_id is not null
            and not public._company_has_members(new.company_id)) then
      raise exception 'Só o suporte pode mudar a empresa de um usuário.' using errcode = '42501';
    end if;
  end if;

  if new.active is distinct from old.active and not (v_admin and new.id <> v_uid) then
    raise exception 'Só um administrador da empresa ativa ou desativa membros (e não a si mesmo).' using errcode = '42501';
  end if;

  if new.commission_rate is distinct from old.commission_rate and not v_admin then
    raise exception 'Só um administrador altera a comissão.' using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_profile on public.profiles;
create trigger trg_guard_profile
  before insert or update on public.profiles
  for each row execute function public.tg_guard_profile();

-- ───────── trava de papéis ─────────
create or replace function public.tg_guard_user_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or current_setting('delvor.team_rpc', true) = '1' or public.is_super_admin() then
    return new;
  end if;
  if new.role = 'super_admin'::public.app_role then
    raise exception 'O papel Super Admin só é dado pelo suporte.' using errcode = '42501';
  end if;
  if new.company_id is null then
    raise exception 'Papel precisa estar ligado a uma empresa.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.user_id and p.company_id = new.company_id and p.active) then
    raise exception 'Esse usuário não faz parte desta empresa.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_user_role on public.user_roles;
create trigger trg_guard_user_role
  before insert or update on public.user_roles
  for each row execute function public.tg_guard_user_role();

-- Cadastro: o dono da empresa nova se dá admin — e só isso.
drop policy if exists "user_roles_self_insert_after_signup" on public.user_roles;
create policy "user_roles_self_insert_after_signup"
  on public.user_roles for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'admin'::public.app_role
    and company_id is not null
    and company_id = public.current_company_id()
    and not public._company_has_members(company_id)
  );

-- ───────── remover / reativar membro ─────────
create or replace function public.remove_team_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.profiles where id = p_user_id;
  if v_company is null then
    raise exception 'Membro não encontrado.';
  end if;
  if not (public.is_super_admin()
          or (v_company = public.current_company_id() and public.has_role(auth.uid(), 'admin'::public.app_role))) then
    raise exception 'Só um administrador pode remover alguém da equipe.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Você não pode remover a si mesmo.';
  end if;
  if public.has_role(p_user_id, 'super_admin'::public.app_role) and not public.is_super_admin() then
    raise exception 'Esse usuário é do suporte e não pode ser removido por aqui.';
  end if;

  perform set_config('delvor.team_rpc', '1', true);
  delete from public.user_roles where user_id = p_user_id and company_id = v_company;
  update public.profiles set active = false where id = p_user_id;
  perform set_config('delvor.team_rpc', '', true);
end $$;

create or replace function public.reactivate_team_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.profiles where id = p_user_id;
  if v_company is null then
    raise exception 'Membro não encontrado.';
  end if;
  if not (public.is_super_admin()
          or (v_company = public.current_company_id() and public.has_role(auth.uid(), 'admin'::public.app_role))) then
    raise exception 'Só um administrador pode reativar alguém da equipe.' using errcode = '42501';
  end if;

  perform set_config('delvor.team_rpc', '1', true);
  update public.profiles set active = true where id = p_user_id;
  -- volta como vendedor; o admin ajusta os papéis depois
  if not exists (select 1 from public.user_roles where user_id = p_user_id and company_id = v_company) then
    insert into public.user_roles (user_id, role, company_id) values (p_user_id, 'vendedor'::public.app_role, v_company);
  end if;
  perform set_config('delvor.team_rpc', '', true);
end $$;

grant execute on function public.remove_team_member(uuid) to authenticated;
grant execute on function public.reactivate_team_member(uuid) to authenticated;
