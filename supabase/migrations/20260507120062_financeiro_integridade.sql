-- =====================================================================
-- Financeiro — integridade
--
--   1. finance_periods  — fechamento de mês (fecha/reabre com motivo)
--   2. guardas          — mês fechado congela o que mexe no DRE/saldo dele:
--                         recebimentos, contas a pagar, transferências,
--                         despesas variáveis/fixas pagas e vendas faturadas.
--                         Conta VENCIDA em mês fechado ainda pode ser PAGA
--                         hoje (o juro do atraso cai no mês do pagamento).
--   3. permissões finas — estornar, excluir recebido, mudar valor de algo
--                         pago, cancelar conta e reabrir mês: só financeiro
--                         ou admin (can_reverse_finance). Reabrir: só admin.
--   4. finance_audit    — histórico automático (gatilhos) de cada lançamento
--   5. pagamento parcial — divide em "pago" + "saldo em aberto" (parent_id)
--   6. trava de linha (FOR UPDATE) nas baixas/pagamentos contra clique duplo
--
-- RPCs que precisam alterar valor/data por regra (parcial, geração de fixas,
-- sincronia) ligam a flag de sessão delvor.finance_rpc = '1' pra passar
-- pelas guardas de permissão — nunca pelas de mês fechado.
-- Depende das migrations 56–61.
-- =====================================================================

-- ───────── 0. Helpers ─────────
create or replace function public.can_reverse_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin()
      or public.has_role(auth.uid(), 'admin'::public.app_role)
      or public.has_role(auth.uid(), 'financeiro'::public.app_role);
$$;

create or replace function public._finance_rpc() returns boolean
language sql stable as $$ select coalesce(current_setting('delvor.finance_rpc', true), '') = '1' $$;

create or replace function public._local_day(p_ts timestamptz) returns date
language sql immutable as $$ select (p_ts at time zone 'America/Sao_Paulo')::date $$;

-- Valor em reais pra mensagens (independe do locale do banco): 9600 -> R$ 9.600,00
create or replace function public._brl(p numeric) returns text language sql immutable as
$f$ select 'R$ ' || translate(to_char(coalesce(p, 0), 'FM999,999,999,990.00'), ',.', '.,') $f$;

-- ───────── 1. Fechamento de mês ─────────
create table if not exists public.finance_periods (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  month          date not null check (month = date_trunc('month', month)::date),
  closed_at      timestamptz,
  closed_by      uuid references auth.users(id) on delete set null,
  reopened_at    timestamptz,
  reopened_by    uuid references auth.users(id) on delete set null,
  reopen_reason  text,
  created_at     timestamptz not null default now(),
  unique (company_id, month)
);
alter table public.finance_periods enable row level security;
drop policy if exists "fper_select" on public.finance_periods;
create policy "fper_select" on public.finance_periods for select
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()));
-- escrita só pelas RPCs (security definer)

create or replace function public._finance_month_closed(p_company uuid, p_day date)
returns boolean language sql stable security definer set search_path = public as $$
  select p_day is not null and exists (
    select 1 from public.finance_periods fp
     where fp.company_id = p_company
       and fp.month = date_trunc('month', p_day)::date
       and fp.closed_at is not null and fp.reopened_at is null
  );
$$;

create or replace function public._closed_msg(p_day date) returns text language sql immutable as $$
  select 'O mês ' || to_char(p_day, 'MM/YYYY') || ' está fechado. Peça a um administrador para reabrir o mês se precisar mudar algo nele.'
$$;

-- ───────── 2a. Guarda: recebimentos (sale_payments) ─────────
create or replace function public.tg_guard_sale_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_old_day date;
  v_new_day date;
  v_bypass  boolean := public._finance_rpc();
begin
  select s.company_id into v_company from public.sales s
   where s.id = coalesce(case when tg_op <> 'INSERT' then old.sale_id end, new.sale_id);

  if tg_op <> 'INSERT' and old.status = 'pago' then v_old_day := public._local_day(old.paid_at); end if;
  if tg_op <> 'DELETE' and new.status = 'pago' then v_new_day := public._local_day(new.paid_at); end if;

  if tg_op = 'DELETE' then
    if old.status = 'pago' then
      if public._finance_month_closed(v_company, v_old_day) then raise exception '%', public._closed_msg(v_old_day); end if;
      if not v_bypass and not public.can_reverse_finance() then
        raise exception 'Só o financeiro ou um administrador pode excluir um pagamento já recebido.';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_new_day is not null and public._finance_month_closed(v_company, v_new_day) then
      raise exception '%', public._closed_msg(v_new_day);
    end if;
    return new;
  end if;

  -- UPDATE: recebimento antigo em mês fechado não pode mudar
  if v_old_day is not null and public._finance_month_closed(v_company, v_old_day)
     and (new.status is distinct from old.status or new.amount is distinct from old.amount
          or new.received_amount is distinct from old.received_amount or new.paid_at is distinct from old.paid_at
          or new.account_id is distinct from old.account_id) then
    raise exception '%', public._closed_msg(v_old_day);
  end if;
  -- nova data de recebimento não pode cair em mês fechado
  if v_new_day is not null and (old.status is distinct from 'pago' or new.paid_at is distinct from old.paid_at)
     and public._finance_month_closed(v_company, v_new_day) then
    raise exception '%', public._closed_msg(v_new_day);
  end if;
  -- estorno e mudança de valor de algo já pago
  if not v_bypass and old.status = 'pago' and not public.can_reverse_finance() then
    if new.status is distinct from 'pago' then
      raise exception 'Só o financeiro ou um administrador pode desfazer um recebimento.';
    end if;
    if new.amount is distinct from old.amount or new.received_amount is distinct from old.received_amount then
      raise exception 'Só o financeiro ou um administrador pode mudar o valor de um pagamento já recebido.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_sale_payment on public.sale_payments;
create trigger trg_guard_sale_payment before insert or update or delete on public.sale_payments
  for each row execute function public.tg_guard_sale_payment();

-- ───────── 2b. Guarda: contas a pagar ─────────
create or replace function public.tg_guard_payable()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := coalesce(case when tg_op <> 'DELETE' then new.company_id end, old.company_id);
  v_bypass  boolean := public._finance_rpc();
  v_old_paid date;
  v_new_paid date;
begin
  if tg_op <> 'INSERT' and old.status = 'paga' then v_old_paid := public._local_day(old.paid_at); end if;
  if tg_op <> 'DELETE' and new.status = 'paga' then v_new_paid := public._local_day(new.paid_at); end if;

  if tg_op = 'DELETE' then
    if old.status = 'paga' then raise exception 'Conta paga não pode ser excluída. Desfaça o pagamento ou cancele.'; end if;
    if public._finance_month_closed(v_company, old.due_date) then raise exception '%', public._closed_msg(old.due_date); end if;
    if not v_bypass and not public.can_reverse_finance() then
      raise exception 'Só o financeiro ou um administrador pode excluir conta a pagar.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if not v_bypass and public._finance_month_closed(v_company, new.due_date) then
      raise exception '%', public._closed_msg(new.due_date);
    end if;
    return new;
  end if;

  -- competência (vencimento) e valor de mês fechado ficam congelados
  -- (a flag de RPC só é usada pelo pagamento parcial, que mantém o total do mês)
  if not v_bypass and (new.amount is distinct from old.amount or new.due_date is distinct from old.due_date
      or new.category_id is distinct from old.category_id
      or (new.status = 'cancelada') <> (old.status = 'cancelada'))
     and (public._finance_month_closed(v_company, old.due_date) or public._finance_month_closed(v_company, new.due_date)) then
    raise exception '%', public._closed_msg(case when public._finance_month_closed(v_company, old.due_date) then old.due_date else new.due_date end);
  end if;
  -- pagamento antigo em mês fechado
  if v_old_paid is not null and public._finance_month_closed(v_company, v_old_paid)
     and (new.status is distinct from old.status or new.paid_amount is distinct from old.paid_amount
          or new.paid_at is distinct from old.paid_at or new.account_id is distinct from old.account_id) then
    raise exception '%', public._closed_msg(v_old_paid);
  end if;
  if v_new_paid is not null and (old.status is distinct from 'paga' or new.paid_at is distinct from old.paid_at)
     and public._finance_month_closed(v_company, v_new_paid) then
    raise exception '%', public._closed_msg(v_new_paid);
  end if;
  -- permissões
  if not v_bypass and not public.can_reverse_finance() then
    if old.status = 'paga' and new.status is distinct from 'paga' then
      raise exception 'Só o financeiro ou um administrador pode desfazer um pagamento.';
    end if;
    if new.status = 'cancelada' and old.status is distinct from 'cancelada' then
      raise exception 'Só o financeiro ou um administrador pode cancelar uma conta.';
    end if;
    if old.status = 'paga' and (new.amount is distinct from old.amount or new.paid_amount is distinct from old.paid_amount) then
      raise exception 'Só o financeiro ou um administrador pode mudar o valor de uma conta paga.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_payable on public.payables;
create trigger trg_guard_payable before insert or update or delete on public.payables
  for each row execute function public.tg_guard_payable();

-- ───────── 2c. Guardas: transferências, despesas do add-on, vendas ─────────
create or replace function public.tg_guard_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record := case when tg_op = 'DELETE' then old else new end;
begin
  if public._finance_month_closed(r.company_id, r.transfer_date)
     or (tg_op = 'UPDATE' and public._finance_month_closed(old.company_id, old.transfer_date)) then
    raise exception '%', public._closed_msg(r.transfer_date);
  end if;
  if tg_op <> 'INSERT' and not public.can_reverse_finance() then
    raise exception 'Só o financeiro ou um administrador pode alterar ou excluir uma transferência.';
  end if;
  return r;
end $$;
drop trigger if exists trg_guard_transfer on public.finance_transfers;
create trigger trg_guard_transfer before insert or update or delete on public.finance_transfers
  for each row execute function public.tg_guard_transfer();

create or replace function public.tg_guard_variable_expense()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record := case when tg_op = 'DELETE' then old else new end;
begin
  if public._finance_month_closed(r.company_id, r.paid_on)
     or (tg_op = 'UPDATE' and public._finance_month_closed(old.company_id, old.paid_on)) then
    raise exception '%', public._closed_msg(r.paid_on);
  end if;
  return r;
end $$;
drop trigger if exists trg_guard_variable_expense on public.variable_expenses;
create trigger trg_guard_variable_expense before insert or update or delete on public.variable_expenses
  for each row execute function public.tg_guard_variable_expense();

create or replace function public.tg_guard_fixed_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record := case when tg_op = 'DELETE' then old else new end;
begin
  -- espelho vindo de contas a pagar (conta de mês fechado paga hoje): o DRE ignora esse espelho
  if public._finance_rpc() then return r; end if;
  if public._finance_month_closed(r.company_id, r.month_ref) or public._finance_month_closed(r.company_id, r.paid_on)
     or (tg_op = 'UPDATE' and (public._finance_month_closed(old.company_id, old.month_ref) or public._finance_month_closed(old.company_id, old.paid_on))) then
    raise exception '%', public._closed_msg(r.month_ref);
  end if;
  return r;
end $$;
drop trigger if exists trg_guard_fixed_payment on public.fixed_expense_payments;
create trigger trg_guard_fixed_payment before insert or update or delete on public.fixed_expense_payments
  for each row execute function public.tg_guard_fixed_payment();

-- Venda faturada em mês fechado: total, data e "faturada ou não" congelados.
create or replace function public.tg_guard_sale_closed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_inv boolean := old.status in ('faturado', 'entregue');
  v_new_inv boolean := new.status in ('faturado', 'entregue');
begin
  if (new.total is distinct from old.total or new.issue_date is distinct from old.issue_date or v_old_inv <> v_new_inv)
     and (v_old_inv or v_new_inv)
     and (public._finance_month_closed(old.company_id, old.issue_date) or public._finance_month_closed(new.company_id, new.issue_date)) then
    raise exception '%', public._closed_msg(case when public._finance_month_closed(old.company_id, old.issue_date) then old.issue_date else new.issue_date end);
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_sale_closed on public.sales;
create trigger trg_guard_sale_closed before update on public.sales
  for each row execute function public.tg_guard_sale_closed();

-- ───────── 3. Histórico ─────────
create table if not exists public.finance_audit (
  id          bigserial primary key,
  company_id  uuid not null,
  entity      text not null,      -- sale_payment | payable | transfer | account | period
  entity_id   uuid not null,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb,
  reason      text,
  user_id     uuid,
  created_at  timestamptz not null default now()
);
create index if not exists finance_audit_entity_idx on public.finance_audit(entity, entity_id, created_at desc);
create index if not exists finance_audit_company_idx on public.finance_audit(company_id, created_at desc);
alter table public.finance_audit enable row level security;
drop policy if exists "faud_select" on public.finance_audit;
create policy "faud_select" on public.finance_audit for select
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()));
-- sem policy de escrita: só os gatilhos (security definer) gravam

create or replace function public._audit(p_company uuid, p_entity text, p_id uuid, p_action text, p_old jsonb, p_new jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.finance_audit (company_id, entity, entity_id, action, old_data, new_data, reason, user_id)
  values (p_company, p_entity, p_id, p_action, p_old, p_new,
          nullif(current_setting('delvor.finance_reason', true), ''), auth.uid());
$$;

create or replace function public.tg_audit_sale_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_action  text;
  keys text[] := array['status','amount','received_amount','fee_amount','due_date','paid_at','method',
                       'issue_status','boleto_line','account_id','cash_session_id','parent_id'];
  o jsonb; n jsonb;
begin
  select s.company_id into v_company from public.sales s where s.id = coalesce(new.sale_id, old.sale_id);
  if tg_op = 'DELETE' then
    if old.status = 'pago' then
      perform public._audit(v_company, 'sale_payment', old.id, 'exclusao', to_jsonb(old), null);
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.parent_id is not null then
      perform public._audit(v_company, 'sale_payment', new.id, 'saldo_de_parcial', null,
        jsonb_build_object('amount', new.amount, 'due_date', new.due_date, 'parent_id', new.parent_id));
    end if;
    return new;
  end if;
  select jsonb_object_agg(k, to_jsonb(old) -> k) into o from unnest(keys) k where (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k);
  if o is null then return new; end if;
  select jsonb_object_agg(k, to_jsonb(new) -> k) into n from unnest(keys) k where (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k);
  v_action := case
    when old.status is distinct from 'pago' and new.status = 'pago' then 'baixa'
    when old.status = 'pago' and new.status is distinct from 'pago' then 'estorno'
    when old.issue_status is distinct from 'emitido' and new.issue_status = 'emitido' then 'emissao'
    when old.issue_status = 'emitido' and new.issue_status is distinct from 'emitido' then 'emissao_desfeita'
    when new.amount is distinct from old.amount then 'valor_alterado'
    when new.due_date is distinct from old.due_date then 'vencimento_alterado'
    else 'alteracao' end;
  perform public._audit(v_company, 'sale_payment', new.id, v_action, o, n);
  return new;
end $$;
drop trigger if exists trg_audit_sale_payment on public.sale_payments;
create trigger trg_audit_sale_payment after insert or update or delete on public.sale_payments
  for each row execute function public.tg_audit_sale_payment();

create or replace function public.tg_audit_payable()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  keys text[] := array['description','amount','due_date','status','paid_at','paid_amount','account_id',
                       'payment_method','category_id','supplier_id','document_number'];
  o jsonb; n jsonb; v_action text;
begin
  if tg_op = 'INSERT' then
    perform public._audit(new.company_id, 'payable', new.id, 'criacao', null,
      jsonb_build_object('description', new.description, 'amount', new.amount, 'due_date', new.due_date, 'source', new.source));
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform public._audit(old.company_id, 'payable', old.id, 'exclusao', to_jsonb(old), null);
    return old;
  end if;
  select jsonb_object_agg(k, to_jsonb(old) -> k) into o from unnest(keys) k where (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k);
  if o is null then return new; end if;
  select jsonb_object_agg(k, to_jsonb(new) -> k) into n from unnest(keys) k where (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k);
  v_action := case
    when old.status is distinct from 'paga' and new.status = 'paga' then 'pagamento'
    when old.status = 'paga' and new.status is distinct from 'paga' then 'pagamento_desfeito'
    when new.status = 'cancelada' and old.status is distinct from 'cancelada' then 'cancelamento'
    when new.amount is distinct from old.amount then 'valor_alterado'
    when new.due_date is distinct from old.due_date then 'vencimento_alterado'
    else 'alteracao' end;
  perform public._audit(new.company_id, 'payable', new.id, v_action, o, n);
  return new;
end $$;
drop trigger if exists trg_audit_payable on public.payables;
create trigger trg_audit_payable after insert or update or delete on public.payables
  for each row execute function public.tg_audit_payable();

create or replace function public.tg_audit_transfer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public._audit(new.company_id, 'transfer', new.id, 'criacao', null, to_jsonb(new));
    return new;
  end if;
  perform public._audit(old.company_id, 'transfer', old.id, case when tg_op = 'DELETE' then 'exclusao' else 'alteracao' end,
                        to_jsonb(old), case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end $$;
drop trigger if exists trg_audit_transfer on public.finance_transfers;
create trigger trg_audit_transfer after insert or update or delete on public.finance_transfers
  for each row execute function public.tg_audit_transfer();

create or replace function public.tg_audit_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.opening_balance is distinct from old.opening_balance or new.opening_date is distinct from old.opening_date
     or new.active is distinct from old.active or new.name is distinct from old.name then
    perform public._audit(new.company_id, 'account', new.id, 'alteracao',
      jsonb_build_object('name', old.name, 'opening_balance', old.opening_balance, 'opening_date', old.opening_date, 'active', old.active),
      jsonb_build_object('name', new.name, 'opening_balance', new.opening_balance, 'opening_date', new.opening_date, 'active', new.active));
  end if;
  return new;
end $$;
drop trigger if exists trg_audit_account on public.finance_accounts;
create trigger trg_audit_account after update on public.finance_accounts
  for each row execute function public.tg_audit_account();

-- Leitura do histórico de um lançamento
create or replace function public.finance_history(p_entity text, p_entity_id uuid)
returns table (
  created_at timestamptz,
  action     text,
  user_name  text,
  old_data   jsonb,
  new_data   jsonb,
  reason     text
)
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
    select fa.created_at, fa.action, coalesce(p.nome, 'sistema')::text, fa.old_data, fa.new_data, fa.reason
      from public.finance_audit fa
      left join public.profiles p on p.id = fa.user_id
     where fa.company_id = v_company and fa.entity = p_entity
       and (fa.entity_id = p_entity_id
            -- pagamento parcial: mostra também o histórico das partes ligadas
            or (p_entity = 'sale_payment' and fa.entity_id in (
                  select id from public.sale_payments where parent_id = p_entity_id
                  union select parent_id from public.sale_payments where id = p_entity_id and parent_id is not null))
            or (p_entity = 'payable' and fa.entity_id in (
                  select id from public.payables where parent_id = p_entity_id
                  union select parent_id from public.payables where id = p_entity_id and parent_id is not null)))
     order by fa.created_at desc, fa.id desc;
end $$;
grant execute on function public.finance_history(text, uuid) to authenticated;

-- ───────── 4. Fechar / reabrir mês ─────────
create or replace function public.close_finance_month(p_month date)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_m       date := date_trunc('month', p_month)::date;
  v_cur     date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_id      uuid;
begin
  if v_company is null or not public.can_reverse_finance() then
    raise exception 'Só o financeiro ou um administrador pode fechar o mês' using errcode = '42501';
  end if;
  if v_m >= v_cur then raise exception 'Só dá para fechar meses que já terminaram.'; end if;
  insert into public.finance_periods (company_id, month, closed_at, closed_by)
  values (v_company, v_m, now(), auth.uid())
  on conflict (company_id, month) do update
     set closed_at = now(), closed_by = auth.uid(), reopened_at = null, reopened_by = null, reopen_reason = null
   where public.finance_periods.closed_at is null or public.finance_periods.reopened_at is not null
  returning id into v_id;
  if v_id is null then raise exception 'Esse mês já está fechado.'; end if;
  perform public._audit(v_company, 'period', v_id, 'fechamento', null, jsonb_build_object('month', v_m));
end $$;
grant execute on function public.close_finance_month(date) to authenticated;

create or replace function public.reopen_finance_month(p_month date, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_m       date := date_trunc('month', p_month)::date;
  v_id      uuid;
begin
  if v_company is null or not (public.is_super_admin() or public.has_role(auth.uid(), 'admin'::public.app_role)) then
    raise exception 'Só um administrador pode reabrir um mês fechado' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Informe o motivo da reabertura (fica no histórico).';
  end if;
  update public.finance_periods
     set reopened_at = now(), reopened_by = auth.uid(), reopen_reason = btrim(p_reason)
   where company_id = v_company and month = v_m and closed_at is not null and reopened_at is null
  returning id into v_id;
  if v_id is null then raise exception 'Esse mês não está fechado.'; end if;
  perform set_config('delvor.finance_reason', btrim(p_reason), true);
  perform public._audit(v_company, 'period', v_id, 'reabertura', null, jsonb_build_object('month', v_m));
end $$;
grant execute on function public.reopen_finance_month(date, text) to authenticated;

-- Situação dos meses + pendências que valem conferir antes de fechar
create or replace function public.finance_months(p_months integer default 12)
returns table (
  month                date,
  closed               boolean,
  closed_at            timestamptz,
  closed_by_name       text,
  reopened_at          timestamptz,
  reopened_by_name     text,
  reopen_reason        text,
  receivables_open     bigint,
  payables_open        bigint,
  boletos_to_issue     bigint,
  payments_no_account  bigint,
  cash_sessions_open   bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_cur     date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
  with m as (
    select (v_cur - make_interval(months => g))::date as mm
      from generate_series(1, greatest(1, least(p_months, 36))) g
  )
  select m.mm,
         (fp.closed_at is not null and fp.reopened_at is null),
         fp.closed_at, pc.nome::text, fp.reopened_at, pr.nome::text, fp.reopen_reason,
         (select count(*) from public.sale_payments sp join public.sales s on s.id = sp.sale_id
           where s.company_id = v_company and s.hidden_at is null and s.status not in ('orcamento','cancelado','perdido')
             and sp.status in ('pendente','parcial') and date_trunc('month', sp.due_date)::date = m.mm),
         (select count(*) from public.payables p
           where p.company_id = v_company and p.status = 'aberta' and date_trunc('month', p.due_date)::date = m.mm),
         (select count(*) from public.sale_payments sp join public.sales s on s.id = sp.sale_id
           where s.company_id = v_company and sp.issue_status = 'a_emitir' and sp.status in ('pendente','parcial')
             and date_trunc('month', s.issue_date)::date = m.mm),
         (select count(*) from public.sale_payments sp join public.sales s on s.id = sp.sale_id
           where s.company_id = v_company and sp.status = 'pago' and sp.account_id is null
             and date_trunc('month', public._local_day(sp.paid_at))::date = m.mm),
         (select count(*) from public.cash_sessions cs
           where cs.company_id = v_company and cs.status = 'aberto'
             and date_trunc('month', public._local_day(cs.opened_at))::date <= m.mm)
    from m
    left join public.finance_periods fp on fp.company_id = v_company and fp.month = m.mm
    left join public.profiles pc on pc.id = fp.closed_by
    left join public.profiles pr on pr.id = fp.reopened_by
   order by m.mm desc;
end $$;
grant execute on function public.finance_months(integer) to authenticated;

-- ───────── 5. Pagamento parcial ─────────
alter table public.sale_payments add column if not exists parent_id uuid references public.sale_payments(id) on delete set null;
alter table public.payables      add column if not exists parent_id uuid references public.payables(id) on delete set null;

create or replace function public.register_partial_receipt(
  p_id         uuid,
  p_amount     numeric,
  p_paid_on    date default null,
  p_account_id uuid default null,
  p_notes      text default null
)
returns uuid  -- id do saldo que continua em aberto
language plpgsql volatile security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_today   date := (now() at time zone 'America/Sao_Paulo')::date;
  sp        public.sale_payments%rowtype;
  v_rest    numeric;
  v_new     uuid;
  v_paid_at timestamptz;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para dar baixa' using errcode = '42501';
  end if;
  select p.* into sp from public.sale_payments p join public.sales s on s.id = p.sale_id
   where p.id = p_id and s.company_id = v_company
   for update of p;
  if not found then raise exception 'Pagamento não encontrado'; end if;
  if sp.status not in ('pendente', 'parcial') then raise exception 'Esse pagamento já foi baixado. Atualize a tela.'; end if;
  if sp.method = 'boleto' and sp.issue_status = 'a_emitir' then
    raise exception 'Registre a emissão do boleto antes de dar baixa.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount >= sp.amount then
    raise exception 'No pagamento parcial o valor recebido tem que ser maior que zero e menor que %', public._brl(sp.amount);
  end if;
  if p_paid_on is not null and p_paid_on > v_today then raise exception 'A data do recebimento não pode ser no futuro'; end if;
  if p_account_id is not null and not exists (select 1 from public.finance_accounts where id = p_account_id and company_id = v_company and active) then
    raise exception 'Conta de destino inválida';
  end if;
  v_rest := sp.amount - p_amount;
  v_paid_at := case when p_paid_on is null or p_paid_on = v_today then now()
                    else (p_paid_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo' end;

  perform set_config('delvor.finance_rpc', '1', true);
  insert into public.sale_payments (sale_id, method, status, amount, due_date, issue_status, issued_at, issued_by,
                                    boleto_line, boleto_bank, boleto_number, sent_at, parent_id, notes)
  values (sp.sale_id, sp.method, 'pendente', v_rest, sp.due_date, sp.issue_status, sp.issued_at, sp.issued_by,
          sp.boleto_line, sp.boleto_bank, sp.boleto_number, sp.sent_at, sp.id,
          'Saldo do pagamento parcial de ' || to_char(public._local_day(v_paid_at), 'DD/MM/YYYY'))
  returning id into v_new;

  update public.sale_payments
     set amount = p_amount, status = 'pago', paid_at = v_paid_at, received_amount = p_amount,
         account_id = coalesce(p_account_id, account_id),
         notes = coalesce(notes || E'\n', '') || 'Pagamento parcial; saldo de ' || public._brl(v_rest) || ' continua em aberto'
                 || coalesce(E'\n' || nullif(btrim(coalesce(p_notes, '')), ''), '')
   where id = sp.id;
  perform set_config('delvor.finance_rpc', '', true);
  return v_new;
end $$;
grant execute on function public.register_partial_receipt(uuid, numeric, date, uuid, text) to authenticated;

create or replace function public.pay_payable_partial(
  p_id         uuid,
  p_amount     numeric,
  p_paid_on    date default null,
  p_account_id uuid default null,
  p_method     text default null,
  p_notes      text default null
)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_today   date := (now() at time zone 'America/Sao_Paulo')::date;
  p         public.payables%rowtype;
  v_rest    numeric;
  v_new     uuid;
  v_paid_at timestamptz;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para pagar contas' using errcode = '42501';
  end if;
  select * into p from public.payables where id = p_id and company_id = v_company for update;
  if not found then raise exception 'Conta não encontrada'; end if;
  if p.status <> 'aberta' then raise exception 'Essa conta já foi paga ou cancelada. Atualize a tela.'; end if;
  if p.source = 'fixa' then raise exception 'Despesa fixa não aceita pagamento parcial; pague o valor do mês.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount >= p.amount then
    raise exception 'No pagamento parcial o valor pago tem que ser maior que zero e menor que %', public._brl(p.amount);
  end if;
  if p_paid_on is not null and p_paid_on > v_today then raise exception 'A data do pagamento não pode ser no futuro'; end if;
  if p_account_id is not null and not exists (select 1 from public.finance_accounts where id = p_account_id and company_id = v_company and active) then
    raise exception 'Conta de saída inválida';
  end if;
  v_rest := p.amount - p_amount;
  v_paid_at := case when p_paid_on is null or p_paid_on = v_today then now()
                    else (p_paid_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo' end;

  perform set_config('delvor.finance_rpc', '1', true);
  insert into public.payables (company_id, description, supplier_id, category_id, amount, due_date, document_number,
                               boleto_line, source, source_id, installment_no, installment_total, group_id, parent_id, notes)
  values (p.company_id, p.description || ' (saldo)', p.supplier_id, p.category_id, v_rest, p.due_date, p.document_number,
          p.boleto_line, p.source, p.source_id, p.installment_no, p.installment_total, p.group_id, p.id,
          'Saldo do pagamento parcial de ' || to_char(public._local_day(v_paid_at), 'DD/MM/YYYY'))
  returning id into v_new;

  update public.payables
     set amount = p_amount, status = 'paga', paid_at = v_paid_at, paid_amount = p_amount, paid_by = auth.uid(),
         payment_method = coalesce(nullif(btrim(coalesce(p_method, '')), ''), payment_method),
         account_id = coalesce(p_account_id, account_id,
           (select fa.id from public.finance_accounts fa where fa.company_id = v_company and fa.active
              and coalesce(nullif(btrim(coalesce(p_method, '')), ''), p.payment_method) = any(fa.default_methods)
            order by fa.created_at limit 1)),
         notes = coalesce(notes || E'\n', '') || 'Pagamento parcial; saldo de ' || public._brl(v_rest) || ' continua em aberto'
                 || coalesce(E'\n' || nullif(btrim(coalesce(p_notes, '')), ''), '')
   where id = p.id;
  perform set_config('delvor.finance_rpc', '', true);
  return v_new;
end $$;
grant execute on function public.pay_payable_partial(uuid, numeric, date, uuid, text, text) to authenticated;

-- ───────── 6. Sincronia e geração de fixas passam pela "porta de serviço" ─────────
create or replace function public.tg_payable_fixed_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.source <> 'fixa' or new.source_id is null or new.month_ref is null then return new; end if;
  perform set_config('delvor.finance_rpc', '1', true);
  if new.status = 'paga' and old.status is distinct from 'paga' then
    insert into public.fixed_expense_payments (company_id, fixed_expense_id, month_ref, paid_on, amount_cents)
    select new.company_id, new.source_id, new.month_ref,
           coalesce((new.paid_at at time zone 'America/Sao_Paulo')::date, current_date),
           round(coalesce(new.paid_amount, new.amount) * 100)::integer
     where exists (select 1 from public.fixed_expenses where id = new.source_id)
    on conflict (fixed_expense_id, month_ref)
      do update set paid_on = excluded.paid_on, amount_cents = excluded.amount_cents;
  elsif old.status = 'paga' and new.status is distinct from 'paga' then
    delete from public.fixed_expense_payments
     where fixed_expense_id = new.source_id and month_ref = new.month_ref;
  end if;
  perform set_config('delvor.finance_rpc', '', true);
  return new;
end $$;

create or replace function public._generate_fixed_payables(p_company uuid, p_month date)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_m     date := date_trunc('month', p_month)::date;
  v_cur   date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_last  integer := extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::integer;
  v_n     integer;
begin
  if public._finance_month_closed(p_company, v_m) then return 0; end if;  -- mês fechado não ganha conta nova
  perform set_config('delvor.finance_rpc', '1', true);
  insert into public.payables (company_id, description, category_id, amount, due_date, status,
                               paid_at, paid_amount, source, source_id, month_ref)
  select fe.company_id, fe.name, fe.category_id, fe.amount_cents / 100.0,
         make_date(extract(year from v_m)::integer, extract(month from v_m)::integer, least(fe.due_day, v_last)),
         case when fep.id is not null then 'paga' else 'aberta' end,
         case when fep.id is not null then (fep.paid_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo' end,
         case when fep.id is not null then fep.amount_cents / 100.0 end,
         'fixa', fe.id, v_m
    from public.fixed_expenses fe
    left join public.fixed_expense_payments fep
           on fep.fixed_expense_id = fe.id and fep.month_ref = v_m
   where fe.company_id = p_company
     and fe.active
     and fe.amount_cents > 0
     and (fe.starts_on is null or fe.starts_on <= (v_m + interval '1 month - 1 day')::date)
     and (fe.ends_on is null or fe.ends_on >= v_m)
     and (v_m >= v_cur or fep.id is not null)
  on conflict (source_id, month_ref) where source = 'fixa' do nothing;
  get diagnostics v_n = row_count;
  perform set_config('delvor.finance_rpc', '', true);
  return v_n;
end $$;

-- ───────── 7. Trava de linha nas baixas (clique duplo / duas pessoas) ─────────
create or replace function public.register_payment_receipts(
  p_ids            uuid[],
  p_paid_on        date    default null,
  p_received_total numeric default null,
  p_notes          text    default null,
  p_account_id     uuid    default null
)
returns table (updated_count integer, cash_session_id uuid, gross_total numeric, received_total numeric, fee_total numeric)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_today   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ids     uuid[];
  v_count   integer;
  v_gross   numeric;
  v_paid_at timestamptz;
  v_note    text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para dar baixa' using errcode = '42501';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_ids, '{}')) as x;
  if v_ids is null or cardinality(v_ids) = 0 then raise exception 'Selecione ao menos um pagamento'; end if;
  -- trava as linhas: a 2ª baixa simultânea espera e depois vê que já está paga
  perform 1 from public.sale_payments sp where sp.id = any(v_ids) order by sp.id for update;
  if p_paid_on is not null and p_paid_on > v_today then raise exception 'A data do recebimento não pode ser no futuro'; end if;
  if p_account_id is not null and not exists (
       select 1 from public.finance_accounts fa where fa.id = p_account_id and fa.company_id = v_company and fa.active) then
    raise exception 'Conta de destino inválida';
  end if;
  v_paid_at := case when p_paid_on is null or p_paid_on = v_today then now()
                    else (p_paid_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo' end;
  select count(*), coalesce(sum(sp.amount), 0) into v_count, v_gross
    from public.sale_payments sp join public.sales s on s.id = sp.sale_id
   where sp.id = any(v_ids) and s.company_id = v_company and sp.status in ('pendente', 'parcial');
  if v_count <> cardinality(v_ids) then
    raise exception 'Algum pagamento selecionado já foi baixado ou não pertence à empresa. Atualize a tela e tente de novo.';
  end if;
  if exists (select 1 from public.sale_payments sp where sp.id = any(v_ids) and sp.method = 'boleto' and sp.issue_status = 'a_emitir') then
    raise exception 'Tem boleto ainda não emitido na seleção. Registre a emissão antes de dar baixa no pagamento.';
  end if;
  if p_received_total is not null and p_received_total <= 0 then raise exception 'O valor recebido precisa ser maior que zero'; end if;

  with sel as (
    select sp.id, sp.amount, sum(sp.amount) over (order by sp.id rows between unbounded preceding and current row) as cum
      from public.sale_payments sp where sp.id = any(v_ids)
  ),
  dist as (
    select sel.id,
           case when p_received_total is null then sel.amount
                else round(sel.cum * p_received_total / v_gross, 2) - round((sel.cum - sel.amount) * p_received_total / v_gross, 2)
           end as received
      from sel
  )
  update public.sale_payments sp
     set status = 'pago', paid_at = v_paid_at, received_amount = dist.received,
         account_id = coalesce(p_account_id, sp.account_id),
         notes = case when v_note is null then sp.notes else coalesce(sp.notes || E'\n', '') || v_note end
    from dist where dist.id = sp.id;

  return query
    select count(*)::integer, max(sp.cash_session_id::text)::uuid,
           coalesce(sum(sp.amount), 0), coalesce(sum(sp.received_amount), 0), coalesce(sum(sp.fee_amount), 0)
      from public.sale_payments sp where sp.id = any(v_ids);
end $$;

create or replace function public.pay_payables(
  p_ids uuid[], p_paid_on date default null, p_paid_total numeric default null,
  p_account_id uuid default null, p_method text default null, p_notes text default null
)
returns table (updated_count integer, gross_total numeric, paid_total numeric)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_today   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ids     uuid[];
  v_count   integer;
  v_gross   numeric;
  v_paid_at timestamptz;
  v_note    text := nullif(btrim(coalesce(p_notes, '')), '');
  v_method  text := nullif(btrim(coalesce(p_method, '')), '');
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para pagar contas' using errcode = '42501';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_ids, '{}')) as x;
  if v_ids is null or cardinality(v_ids) = 0 then raise exception 'Selecione ao menos uma conta'; end if;
  perform 1 from public.payables p where p.id = any(v_ids) order by p.id for update;
  if p_paid_on is not null and p_paid_on > v_today then raise exception 'A data do pagamento não pode ser no futuro'; end if;
  if p_paid_total is not null and p_paid_total <= 0 then raise exception 'O valor pago precisa ser maior que zero'; end if;
  if p_account_id is not null and not exists (
       select 1 from public.finance_accounts fa where fa.id = p_account_id and fa.company_id = v_company and fa.active) then
    raise exception 'Conta de saída inválida';
  end if;
  select count(*), coalesce(sum(p.amount), 0) into v_count, v_gross
    from public.payables p where p.id = any(v_ids) and p.company_id = v_company and p.status = 'aberta';
  if v_count <> cardinality(v_ids) then
    raise exception 'Alguma conta selecionada já foi paga ou cancelada. Atualize a tela e tente de novo.';
  end if;
  v_paid_at := case when p_paid_on is null or p_paid_on = v_today then now()
                    else (p_paid_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo' end;
  with sel as (
    select p.id, p.amount, sum(p.amount) over (order by p.id rows between unbounded preceding and current row) as cum
      from public.payables p where p.id = any(v_ids)
  ),
  dist as (
    select sel.id,
           case when p_paid_total is null then sel.amount
                else round(sel.cum * p_paid_total / v_gross, 2) - round((sel.cum - sel.amount) * p_paid_total / v_gross, 2)
           end as paid
      from sel
  )
  update public.payables p
     set status = 'paga', paid_at = v_paid_at, paid_amount = dist.paid, paid_by = auth.uid(),
         payment_method = coalesce(v_method, p.payment_method),
         account_id = coalesce(p_account_id, p.account_id,
           (select fa.id from public.finance_accounts fa where fa.company_id = v_company and fa.active
              and coalesce(v_method, p.payment_method) = any(fa.default_methods) order by fa.created_at limit 1)),
         notes = case when v_note is null then p.notes else coalesce(p.notes || E'\n', '') || v_note end
    from dist where dist.id = p.id;
  return query
    select count(*)::integer, coalesce(sum(p.amount), 0), coalesce(sum(p.paid_amount), 0)
      from public.payables p where p.id = any(v_ids);
end $$;

-- ───────── 8. Estornos com motivo (só financeiro/admin) ─────────
drop function if exists public.revert_payment_receipt(uuid);
create or replace function public.revert_payment_receipt(p_id uuid, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_status  public.payment_status;
  v_session uuid;
  v_sess    text;
begin
  if v_company is null or not public.can_reverse_finance() then
    raise exception 'Só o financeiro ou um administrador pode desfazer um recebimento.' using errcode = '42501';
  end if;
  select sp.status, sp.cash_session_id into v_status, v_session
    from public.sale_payments sp join public.sales s on s.id = sp.sale_id
   where sp.id = p_id and s.company_id = v_company
   for update of sp;
  if not found then raise exception 'Pagamento não encontrado'; end if;
  if v_status <> 'pago' then raise exception 'Esse pagamento não está baixado'; end if;
  if v_session is not null then
    select cs.status into v_sess from public.cash_sessions cs where cs.id = v_session;
    if v_sess = 'fechado' then raise exception 'Essa baixa entrou num caixa que já foi fechado e não pode ser desfeita.'; end if;
  end if;
  perform set_config('delvor.finance_reason', coalesce(btrim(p_reason), ''), true);
  update public.sale_payments set status = 'pendente' where id = p_id;
end $$;
grant execute on function public.revert_payment_receipt(uuid, text) to authenticated;

drop function if exists public.revert_payable(uuid);
create or replace function public.revert_payable(p_id uuid, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.can_reverse_finance() then
    raise exception 'Só o financeiro ou um administrador pode desfazer um pagamento.' using errcode = '42501';
  end if;
  perform set_config('delvor.finance_reason', coalesce(btrim(p_reason), ''), true);
  update public.payables
     set status = 'aberta', paid_at = null, paid_amount = null, paid_by = null, account_id = null
   where id = p_id and company_id = v_company and status = 'paga';
  if not found then raise exception 'Conta paga não encontrada'; end if;
end $$;
grant execute on function public.revert_payable(uuid, text) to authenticated;

create or replace function public.cancel_payable(p_id uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.can_reverse_finance() then
    raise exception 'Só o financeiro ou um administrador pode cancelar uma conta.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Informe o motivo do cancelamento'; end if;
  perform set_config('delvor.finance_reason', btrim(p_reason), true);
  update public.payables set status = 'cancelada'
   where id = p_id and company_id = v_company and status = 'aberta';
  if not found then raise exception 'Conta em aberto não encontrada'; end if;
end $$;
grant execute on function public.cancel_payable(uuid, text) to authenticated;

drop function if exists public.revert_boleto_issue(uuid);
create or replace function public.revert_boleto_issue(p_id uuid, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_status  public.payment_status;
  v_issue   text;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  select sp.status, sp.issue_status into v_status, v_issue
    from public.sale_payments sp join public.sales s on s.id = sp.sale_id
   where sp.id = p_id and s.company_id = v_company for update of sp;
  if not found then raise exception 'Pagamento não encontrado'; end if;
  if v_status = 'pago' then raise exception 'Boleto já pago: desfaça a baixa antes'; end if;
  if v_issue is distinct from 'emitido' then raise exception 'Esse boleto não está emitido'; end if;
  perform set_config('delvor.finance_reason', coalesce(btrim(p_reason), ''), true);
  update public.sale_payments
     set issue_status = 'a_emitir', issued_at = null, issued_by = null,
         boleto_line = null, boleto_bank = null, boleto_number = null, sent_at = null
   where id = p_id;
end $$;
grant execute on function public.revert_boleto_issue(uuid, text) to authenticated;
