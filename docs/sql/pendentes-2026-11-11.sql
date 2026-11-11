-- =====================================================================
-- DELVOR — SQL pendente (tudo junto) — 11/11/2026
-- Projeto: wggvhxtfeucntdunhocn
-- Abrir em: https://supabase.com/dashboard/project/wggvhxtfeucntdunhocn/sql/new
--
-- SUBSTITUI os arquivos "seguranca-vendas-os" e "seguranca-equipe" (já vêm
-- aqui dentro). Se já rodou algum deles, pode rodar este mesmo assim.
--
--   68  vendas e OS voltam a respeitar o papel
--   69  remover/reativar membro + fecha brechas de admin/super admin
--   70  relatório de despesas por categoria
--
-- Pode rodar mais de uma vez. Se der erro, nada é aplicado.
-- Se o Studio avisar de "destructive operations", pode clicar no verde.
-- =====================================================================

-- ───────── TRAVA: só roda no banco do Delvor ─────────
do $$ begin
  if to_regclass('public.sales') is null
     or to_regclass('public.service_orders') is null
     or to_regclass('public.finance_periods') is null then
    raise exception 'TRAVA: este SQL é do Delvor (projeto wggvhxtfeucntdunhocn). Banco errado — nada foi alterado.';
  end if;
end $$;


-- ##################################################################
-- 20260507120068_rbac_vendas_os_fix
-- ##################################################################
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


-- ##################################################################
-- 20260507120069_equipe_remover_e_travas
-- ##################################################################
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


-- ##################################################################
-- 20260507120070_relatorio_despesas
-- ##################################################################
-- =====================================================================
-- 70 — Relatório de despesas (por categoria)
-- (depende da 60–63: payables, fixas, variáveis, empréstimos)
--
-- expense_report(p_from, p_to): uma linha por despesa do período, pelo
-- critério do DRE (competência):
--   • contas a pagar / compras / fixas → pelo vencimento
--   • despesas variáveis → pela data do pagamento
--   • fixas pagas antes da 60 (sem conta gerada) → vencimento do mês
--   • empréstimos → só os JUROS da parcela (amortização não é despesa)
-- Canceladas ficam de fora. Só quem tem acesso ao financeiro.
-- =====================================================================

create or replace function public.expense_report(p_from date, p_to date)
returns table (
  id          uuid,
  kind        text,      -- conta | compra | fixa | variavel | juros
  description text,
  category    text,
  supplier    text,
  ref_date    date,      -- data de competência
  amount      numeric,
  status      text,      -- paga | aberta
  paid_on     date,
  paid_amount numeric
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_m       date;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para ver o relatório de despesas' using errcode = '42501';
  end if;
  if p_to < p_from then raise exception 'Período inválido'; end if;
  if p_to - p_from > 750 then raise exception 'Período muito longo (máximo de 24 meses)'; end if;

  -- garante que as fixas dos meses do período já viraram conta
  v_m := date_trunc('month', p_from)::date;
  while v_m <= p_to loop
    perform public._generate_fixed_payables(v_company, v_m);
    v_m := (v_m + interval '1 month')::date;
  end loop;

  return query
  select p.id,
         case p.source when 'fixa' then 'fixa' when 'compra' then 'compra' else 'conta' end::text,
         p.description,
         coalesce(ec.name, 'Sem categoria')::text,
         s.name::text,
         p.due_date,
         p.amount,
         case when p.status = 'paga' then 'paga' else 'aberta' end::text,
         case when p.status = 'paga' then public._local_day(p.paid_at) end,
         case when p.status = 'paga' then p.paid_amount end
    from public.payables p
    left join public.expense_categories ec on ec.id = p.category_id
    left join public.suppliers s on s.id = p.supplier_id
   where p.company_id = v_company
     and p.status <> 'cancelada'
     and p.loan_id is null
     and p.due_date between p_from and p_to

  union all
  select ve.id, 'variavel'::text, ve.name, coalesce(ec.name, 'Sem categoria')::text, null::text,
         ve.paid_on, ve.amount_cents / 100.0, 'paga'::text, ve.paid_on, ve.amount_cents / 100.0
    from public.variable_expenses ve
    left join public.expense_categories ec on ec.id = ve.category_id
   where ve.company_id = v_company
     and ve.paid_on between p_from and p_to

  union all
  select fep.id, 'fixa'::text, fe.name, coalesce(ec.name, 'Sem categoria')::text, null::text,
         d.due, fep.amount_cents / 100.0, 'paga'::text, fep.paid_on, fep.amount_cents / 100.0
    from public.fixed_expense_payments fep
    join public.fixed_expenses fe on fe.id = fep.fixed_expense_id
    left join public.expense_categories ec on ec.id = fe.category_id
    cross join lateral (
      select (fep.month_ref + (least(fe.due_day,
              extract(day from (date_trunc('month', fep.month_ref) + interval '1 month - 1 day'))::integer) - 1))::date as due
    ) d
   where fep.company_id = v_company
     and d.due between p_from and p_to
     and not exists (
       select 1 from public.payables p2
        where p2.source = 'fixa' and p2.source_id = fep.fixed_expense_id and p2.month_ref = fep.month_ref
     )

  union all
  select p.id, 'juros'::text, p.description, 'Juros de empréstimos'::text, l.lender::text,
         p.due_date, p.interest_part,
         case when p.status = 'paga' then 'paga' else 'aberta' end::text,
         case when p.status = 'paga' then public._local_day(p.paid_at) end,
         case when p.status = 'paga' then p.interest_part end
    from public.payables p
    left join public.loans l on l.id = p.loan_id
   where p.company_id = v_company
     and p.loan_id is not null
     and p.status <> 'cancelada'
     and p.interest_part > 0
     and p.due_date between p_from and p_to

   order by 6, 4, 3;
end $$;

grant execute on function public.expense_report(date, date) to authenticated;


-- ───────── CONFERÊNCIA (o Studio mostra só este resultado) ─────────
select 'vendas/OS por papel (68)' as item,
       not exists (select 1 from pg_policies where schemaname='public' and policyname in ('sales_rw','os_rw')) as ok
union all select 'financeiro lê itens da venda (68)', exists (select 1 from pg_policies where schemaname='public' and policyname='sale_items_fin_select')
union all select 'remover/reativar membro (69)', to_regprocedure('public.remove_team_member(uuid)') is not null and to_regprocedure('public.reactivate_team_member(uuid)') is not null
union all select 'trava de perfil e papéis (69)', exists (select 1 from pg_trigger where tgname = 'trg_guard_profile') and exists (select 1 from pg_trigger where tgname = 'trg_guard_user_role')
union all select 'cadastro só cria admin da empresa nova (69)',
       exists (select 1 from pg_policies where schemaname='public' and policyname='user_roles_self_insert_after_signup' and with_check like '%_company_has_members%')
union all select 'relatório de despesas (70)', to_regprocedure('public.expense_report(date,date)') is not null;
