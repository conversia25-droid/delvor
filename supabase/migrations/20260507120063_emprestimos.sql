-- =====================================================================
-- Empréstimos e financiamentos + movimentos avulsos de conta
--
--   1. finance_movements — entrada/saída avulsa numa conta (entrada do
--                          empréstimo, ajuste). Entra no saldo e no fluxo,
--                          NÃO entra no DRE.
--   2. loans             — empréstimo: valor, conta onde caiu, parcelas,
--                          taxa mensal (Price) ou valor da parcela (taxa é
--                          calculada), juros totais.
--   3. payables          — cada parcela vira conta a pagar (source
--                          'emprestimo') com principal_part / interest_part.
--   4. RPCs: create_loan, list_loans, delete_loan
--   5. saldos, extrato e fluxo passam a contar os movimentos
--   6. DRE: despesas por competência (valor da conta, não o pago); juros de
--      empréstimo, juros/multas pagos, descontos obtidos e juros recebidos
--      em linhas próprias, no mês do pagamento — mês fechado não muda.
-- Depende da 62.
-- =====================================================================

-- ───────── 1. Empréstimos ─────────
create table if not exists public.loans (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  description         text not null,
  lender              text,
  principal           numeric(14,2) not null check (principal > 0),
  received_on         date not null,
  account_id          uuid references public.finance_accounts(id) on delete set null,
  installments        integer not null check (installments between 1 and 360),
  installment_amount  numeric(14,2) not null,
  monthly_rate        numeric(12,8) not null default 0,   -- fração: 0.0199 = 1,99% a.m.
  total_interest      numeric(14,2) not null default 0,
  first_due           date not null,
  category_id         uuid references public.expense_categories(id) on delete set null,
  notes               text,
  created_by          uuid references auth.users(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now()
);
create index if not exists loans_company_idx on public.loans(company_id);
alter table public.loans enable row level security;
drop policy if exists "loans_select" on public.loans;
create policy "loans_select" on public.loans for select
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()));
-- escrita só pelas RPCs

-- ───────── 2. Movimentos avulsos de conta ─────────
create table if not exists public.finance_movements (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  account_id   uuid not null references public.finance_accounts(id) on delete restrict,
  kind         text not null check (kind in ('emprestimo', 'ajuste', 'entrada', 'saida')),
  amount       numeric(14,2) not null check (amount <> 0),   -- + entra, − sai
  moved_on     date not null default current_date,
  description  text not null,
  loan_id      uuid references public.loans(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists finance_movements_account_idx on public.finance_movements(account_id, moved_on);
alter table public.finance_movements enable row level security;
drop policy if exists "fmov_select" on public.finance_movements;
create policy "fmov_select" on public.finance_movements for select
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()));
drop policy if exists "fmov_insert" on public.finance_movements;
create policy "fmov_insert" on public.finance_movements for insert
  with check (company_id = public.current_company_id() and public.has_financial_access());
drop policy if exists "fmov_delete" on public.finance_movements;
create policy "fmov_delete" on public.finance_movements for delete
  using (company_id = public.current_company_id() and public.can_reverse_finance());

create or replace function public.tg_guard_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record := case when tg_op = 'DELETE' then old else new end;
begin
  if public._finance_month_closed(r.company_id, r.moved_on)
     or (tg_op = 'UPDATE' and public._finance_month_closed(old.company_id, old.moved_on)) then
    raise exception '%', public._closed_msg(r.moved_on);
  end if;
  if tg_op <> 'INSERT' and not public._finance_rpc() and not public.can_reverse_finance() then
    raise exception 'Só o financeiro ou um administrador pode alterar ou excluir um movimento.';
  end if;
  if tg_op = 'INSERT' then
    perform public._audit(new.company_id, 'movement', new.id, 'criacao', null, to_jsonb(new));
  elsif tg_op = 'DELETE' then
    perform public._audit(old.company_id, 'movement', old.id, 'exclusao', to_jsonb(old), null);
  end if;
  return r;
end $$;
drop trigger if exists trg_guard_movement on public.finance_movements;
create trigger trg_guard_movement before insert or update or delete on public.finance_movements
  for each row execute function public.tg_guard_movement();

-- ───────── 3. Parcelas = contas a pagar ─────────
alter table public.payables
  add column if not exists loan_id        uuid references public.loans(id) on delete cascade,
  add column if not exists principal_part numeric(14,2),
  add column if not exists interest_part  numeric(14,2);
create index if not exists payables_loan_idx on public.payables(loan_id) where loan_id is not null;
alter table public.payables drop constraint if exists payables_source_check;
alter table public.payables add constraint payables_source_check
  check (source in ('manual', 'fixa', 'compra', 'emprestimo'));

-- ───────── 4a. Criar empréstimo ─────────
-- Informe a taxa mensal (%) OU o valor da parcela (a taxa é calculada).
-- Nenhum dos dois = sem juros (valor ÷ parcelas).
create or replace function public.create_loan(
  p_description        text,
  p_principal          numeric,
  p_received_on        date,
  p_account_id         uuid,
  p_installments       integer,
  p_first_due          date,
  p_monthly_rate_pct   numeric default null,
  p_installment_amount numeric default null,
  p_lender             text    default null,
  p_category_id        uuid    default null,
  p_notes              text    default null
)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_n       integer := p_installments;
  v_p       numeric := round(p_principal, 2);
  v_i       numeric;
  v_pmt     numeric;
  v_lo      numeric; v_hi numeric; v_mid numeric; v_f numeric;
  v_bal     numeric;
  v_int     numeric;
  v_princ   numeric;
  v_amt     numeric;
  v_total_i numeric := 0;
  v_loan    uuid;
  k         integer;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para lançar empréstimo' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null then raise exception 'Informe a descrição do empréstimo'; end if;
  if v_p is null or v_p <= 0 then raise exception 'Informe o valor recebido'; end if;
  if v_n is null or v_n < 1 or v_n > 360 then raise exception 'Número de parcelas entre 1 e 360'; end if;
  if p_first_due is null then raise exception 'Informe o vencimento da 1ª parcela'; end if;
  if p_received_on is null then raise exception 'Informe a data em que o dinheiro caiu'; end if;
  if p_account_id is null or not exists (select 1 from public.finance_accounts fa where fa.id = p_account_id and fa.company_id = v_company and fa.active) then
    raise exception 'Escolha a conta onde o dinheiro caiu';
  end if;
  if p_monthly_rate_pct is not null and p_installment_amount is not null then
    raise exception 'Informe a taxa OU o valor da parcela, não os dois';
  end if;

  if p_installment_amount is not null then
    v_pmt := round(p_installment_amount, 2);
    if v_pmt * v_n < v_p - 0.01 then
      raise exception 'As parcelas somam % e ficam abaixo do valor recebido (%). Confira o valor da parcela.',
        public._brl(v_pmt * v_n), public._brl(v_p);
    end if;
    if v_pmt * v_n <= v_p + 0.005 then
      v_i := 0;
    else
      -- taxa que faz o valor presente das parcelas = valor recebido (Price), por bisseção
      v_lo := 0.0000001; v_hi := 1;
      for k in 1..120 loop
        v_mid := (v_lo + v_hi) / 2;
        v_f := v_pmt * (1 - power(1 + v_mid, -v_n)) / v_mid - v_p;
        if v_f > 0 then v_lo := v_mid; else v_hi := v_mid; end if;
      end loop;
      v_i := round((v_lo + v_hi) / 2, 8);
    end if;
  elsif p_monthly_rate_pct is not null then
    if p_monthly_rate_pct < 0 or p_monthly_rate_pct > 100 then raise exception 'Taxa mensal inválida'; end if;
    v_i := p_monthly_rate_pct / 100.0;
    v_pmt := case when v_i = 0 then round(v_p / v_n, 2)
                  else round(v_p * v_i / (1 - power(1 + v_i, -v_n)), 2) end;
  else
    v_i := 0;
    v_pmt := round(v_p / v_n, 2);
  end if;

  insert into public.loans (company_id, description, lender, principal, received_on, account_id, installments,
                            installment_amount, monthly_rate, first_due, category_id, notes)
  values (v_company, btrim(p_description), nullif(btrim(coalesce(p_lender, '')), ''), v_p, p_received_on, p_account_id,
          v_n, v_pmt, v_i, p_first_due, p_category_id, nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_loan;

  -- tabela Price: juros sobre o saldo, amortização = parcela − juros; a última fecha o saldo
  v_bal := v_p;
  for k in 1..v_n loop
    v_int := round(v_bal * v_i, 2);
    if k < v_n then
      v_princ := v_pmt - v_int;
      v_amt := v_pmt;
    else
      v_princ := v_bal;
      v_amt := v_princ + v_int;
    end if;
    v_bal := v_bal - v_princ;
    v_total_i := v_total_i + v_int;
    insert into public.payables (company_id, description, category_id, amount, due_date, source, source_id,
                                 installment_no, installment_total, group_id, loan_id, principal_part, interest_part, notes)
    values (v_company, btrim(p_description) || ' (' || k || '/' || v_n || ')', p_category_id, v_amt,
            (p_first_due + make_interval(months => k - 1))::date, 'emprestimo', v_loan,
            k, v_n, v_loan, v_loan, v_princ, v_int,
            case when nullif(btrim(coalesce(p_lender, '')), '') is not null then 'Credor: ' || btrim(p_lender) end);
  end loop;

  update public.loans set total_interest = v_total_i where id = v_loan;

  insert into public.finance_movements (company_id, account_id, kind, amount, moved_on, description, loan_id)
  values (v_company, p_account_id, 'emprestimo', v_p, p_received_on,
          'Empréstimo recebido: ' || btrim(p_description) || coalesce(' · ' || nullif(btrim(coalesce(p_lender, '')), ''), ''),
          v_loan);
  return v_loan;
end $$;
grant execute on function public.create_loan(text, numeric, date, uuid, integer, date, numeric, numeric, text, uuid, text) to authenticated;

-- ───────── 4b. Lista de empréstimos com saldo devedor ─────────
create or replace function public.list_loans()
returns table (
  id                 uuid,
  description        text,
  lender             text,
  principal          numeric,
  received_on        date,
  account_name       text,
  installments       integer,
  installment_amount numeric,
  monthly_rate       numeric,
  total_interest     numeric,
  first_due          date,
  paid_count         bigint,
  open_count         bigint,
  overdue_count      bigint,
  balance_principal  numeric,
  open_total         numeric,
  interest_paid      numeric,
  next_due           date,
  next_amount        numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_today   date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
    select l.id, l.description, l.lender, l.principal, l.received_on, fa.name::text, l.installments,
           l.installment_amount, l.monthly_rate, l.total_interest, l.first_due,
           count(p.id) filter (where p.status = 'paga'),
           count(p.id) filter (where p.status = 'aberta'),
           count(p.id) filter (where p.status = 'aberta' and p.due_date < v_today),
           coalesce(sum(p.principal_part) filter (where p.status = 'aberta'), 0),
           coalesce(sum(p.amount) filter (where p.status = 'aberta'), 0),
           coalesce(sum(p.interest_part) filter (where p.status = 'paga'), 0),
           min(p.due_date) filter (where p.status = 'aberta'),
           (select p2.amount from public.payables p2 where p2.loan_id = l.id and p2.status = 'aberta' order by p2.due_date limit 1)
      from public.loans l
      left join public.finance_accounts fa on fa.id = l.account_id
      left join public.payables p on p.loan_id = l.id and p.status <> 'cancelada'
     where l.company_id = v_company
     group by l.id, fa.name
     order by (count(p.id) filter (where p.status = 'aberta') = 0), l.received_on desc;
end $$;
grant execute on function public.list_loans() to authenticated;

-- ───────── 4c. Excluir empréstimo lançado errado (sem parcela paga) ─────────
create or replace function public.delete_loan(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.can_reverse_finance() then
    raise exception 'Só o financeiro ou um administrador pode excluir um empréstimo.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.loans where id = p_id and company_id = v_company) then
    raise exception 'Empréstimo não encontrado';
  end if;
  if exists (select 1 from public.payables where loan_id = p_id and status = 'paga') then
    raise exception 'Esse empréstimo já tem parcela paga. Desfaça os pagamentos antes de excluir.';
  end if;
  perform set_config('delvor.finance_rpc', '1', true);
  delete from public.loans where id = p_id;   -- leva parcelas e a entrada junto
  perform set_config('delvor.finance_rpc', '', true);
end $$;
grant execute on function public.delete_loan(uuid) to authenticated;

-- ───────── 5a. Saldos com movimentos ─────────
create or replace function public.account_balances()
returns table (
  id uuid, name text, kind text, bank_name text, default_methods text[], opening_balance numeric, opening_date date,
  inflow numeric, outflow numeric, transfers_in numeric, transfers_out numeric, balance numeric, active boolean
)
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
  with ins as (
    select x.aid, sum(x.v) v from (
      select sp.account_id aid, coalesce(sp.received_amount, sp.amount) v
        from public.sale_payments sp join public.finance_accounts fa on fa.id = sp.account_id
       where fa.company_id = v_company and sp.status = 'pago'
         and public._local_day(sp.paid_at) >= fa.opening_date
      union all
      select m.account_id, m.amount from public.finance_movements m join public.finance_accounts fa on fa.id = m.account_id
       where m.company_id = v_company and m.amount > 0 and m.moved_on >= fa.opening_date
    ) x group by x.aid
  ),
  outs as (
    select x.aid, sum(x.v) v from (
      select p.account_id aid, coalesce(p.paid_amount, p.amount) v
        from public.payables p join public.finance_accounts fa on fa.id = p.account_id
       where p.company_id = v_company and p.status = 'paga'
         and public._local_day(p.paid_at) >= fa.opening_date
      union all
      select m.account_id, -m.amount from public.finance_movements m join public.finance_accounts fa on fa.id = m.account_id
       where m.company_id = v_company and m.amount < 0 and m.moved_on >= fa.opening_date
    ) x group by x.aid
  ),
  tin as (
    select t.to_account_id aid, sum(t.amount) v from public.finance_transfers t
      join public.finance_accounts fa on fa.id = t.to_account_id
     where t.company_id = v_company and t.transfer_date >= fa.opening_date group by 1
  ),
  tout as (
    select t.from_account_id aid, sum(t.amount) v from public.finance_transfers t
      join public.finance_accounts fa on fa.id = t.from_account_id
     where t.company_id = v_company and t.transfer_date >= fa.opening_date group by 1
  )
  select fa.id, fa.name, fa.kind, fa.bank_name, fa.default_methods, fa.opening_balance, fa.opening_date,
         coalesce(ins.v, 0), coalesce(outs.v, 0), coalesce(tin.v, 0), coalesce(tout.v, 0),
         fa.opening_balance + coalesce(ins.v, 0) - coalesce(outs.v, 0) + coalesce(tin.v, 0) - coalesce(tout.v, 0),
         fa.active
    from public.finance_accounts fa
    left join ins  on ins.aid  = fa.id
    left join outs on outs.aid = fa.id
    left join tin  on tin.aid  = fa.id
    left join tout on tout.aid = fa.id
   where fa.company_id = v_company
   order by fa.active desc, fa.kind = 'caixa' desc, fa.name;
end $$;

-- ───────── 5b. Extrato com movimentos ─────────
create or replace function public.account_statement(p_account_id uuid, p_from date, p_to date)
returns table (moved_on date, kind text, description text, amount numeric, ref_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if not exists (select 1 from public.finance_accounts fa where fa.id = p_account_id and fa.company_id = v_company) then
    raise exception 'Conta não encontrada';
  end if;
  return query
    select public._local_day(sp.paid_at), 'recebimento'::text,
           ('Venda #' || s.number || coalesce(' · ' || coalesce(c.trade_name, c.name), ''))::text,
           coalesce(sp.received_amount, sp.amount), s.id
      from public.sale_payments sp
      join public.sales s on s.id = sp.sale_id
      left join public.customers c on c.id = s.customer_id
     where sp.account_id = p_account_id and sp.status = 'pago'
       and public._local_day(sp.paid_at) between p_from and p_to
    union all
    select public._local_day(p.paid_at), 'pagamento'::text, p.description, -coalesce(p.paid_amount, p.amount), p.id
      from public.payables p
     where p.account_id = p_account_id and p.status = 'paga'
       and public._local_day(p.paid_at) between p_from and p_to
    union all
    select t.transfer_date, 'transferencia'::text,
           ('Transferência ' || case when t.to_account_id = p_account_id then 'de ' || fo.name else 'para ' || ft.name end
             || coalesce(' · ' || t.notes, ''))::text,
           case when t.to_account_id = p_account_id then t.amount else -t.amount end, t.id
      from public.finance_transfers t
      join public.finance_accounts fo on fo.id = t.from_account_id
      join public.finance_accounts ft on ft.id = t.to_account_id
     where (t.from_account_id = p_account_id or t.to_account_id = p_account_id)
       and t.transfer_date between p_from and p_to
    union all
    select m.moved_on, 'movimento'::text, m.description, m.amount, m.id
      from public.finance_movements m
     where m.account_id = p_account_id and m.moved_on between p_from and p_to
     order by 1 desc, 2;
end $$;

-- ───────── 5c. Fluxo com movimentos ─────────
create or replace function public.cash_flow(p_from date, p_to date)
returns table (day date, in_realized numeric, out_realized numeric, in_expected numeric, out_expected numeric)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_m       date;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para consultar o fluxo de caixa' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Período inválido (máximo de 400 dias)'; end if;
  v_m := date_trunc('month', p_from)::date;
  while v_m <= p_to loop
    perform public._generate_fixed_payables(v_company, v_m);
    v_m := (v_m + interval '1 month')::date;
  end loop;

  return query
  with days as (select g::date d from generate_series(p_from, p_to, interval '1 day') g),
  rec as (
    select public._local_day(sp.paid_at) d_paid, sp.due_date d_due, sp.status st,
           coalesce(sp.received_amount, sp.amount) net, sp.amount amt
      from public.sale_payments sp join public.sales s on s.id = sp.sale_id
     where s.company_id = v_company and s.hidden_at is null and s.status not in ('orcamento', 'cancelado', 'perdido')
  ),
  ir as (
    select x.d, sum(x.v) v from (
      select d_paid d, net v from rec where st = 'pago' and d_paid between p_from and p_to
      union all
      select m.moved_on, m.amount from public.finance_movements m
       where m.company_id = v_company and m.amount > 0 and m.moved_on between p_from and p_to
    ) x group by 1
  ),
  ie as (
    select x.d, sum(x.v) v from (
      select d_due d, amt v from rec where st in ('pendente', 'parcial') and d_due between p_from and p_to
      union all
      select ri.due_date, ri.total from public.rental_invoices ri
       where ri.company_id = v_company and ri.status = 'pendente' and ri.sale_id is null and ri.due_date between p_from and p_to
    ) x group by 1
  ),
  orr as (
    select x.d, sum(x.v) v from (
      select public._local_day(p.paid_at) d, coalesce(p.paid_amount, p.amount) v
        from public.payables p
       where p.company_id = v_company and p.status = 'paga' and public._local_day(p.paid_at) between p_from and p_to
      union all
      select ve.paid_on, ve.amount_cents / 100.0 from public.variable_expenses ve
       where ve.company_id = v_company and ve.paid_on between p_from and p_to
      union all
      select fep.paid_on, fep.amount_cents / 100.0 from public.fixed_expense_payments fep
       where fep.company_id = v_company and fep.paid_on between p_from and p_to
         and not exists (select 1 from public.payables p2 where p2.source = 'fixa' and p2.source_id = fep.fixed_expense_id and p2.month_ref = fep.month_ref)
      union all
      select m.moved_on, -m.amount from public.finance_movements m
       where m.company_id = v_company and m.amount < 0 and m.moved_on between p_from and p_to
    ) x group by 1
  ),
  oe as (
    select p.due_date d, sum(p.amount) v from public.payables p
     where p.company_id = v_company and p.status = 'aberta' and p.due_date between p_from and p_to group by 1
  )
  select days.d, coalesce(ir.v, 0), coalesce(orr.v, 0), coalesce(ie.v, 0), coalesce(oe.v, 0)
    from days
    left join ir  on ir.d  = days.d
    left join ie  on ie.d  = days.d
    left join orr on orr.d = days.d
    left join oe  on oe.d  = days.d
   order by days.d;
end $$;

-- ───────── 6. DRE (competência + encargos no mês do pagamento) ─────────
create or replace function public.dre_monthly(p_from date, p_to date)
returns table (month date, line text, label text, amount numeric)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_from    date := date_trunc('month', p_from)::date;
  v_to      date := (date_trunc('month', p_to) + interval '1 month - 1 day')::date;
  v_m       date;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para consultar o DRE' using errcode = '42501';
  end if;
  if v_to - v_from > 750 then raise exception 'Período muito longo (máximo de 24 meses)'; end if;
  v_m := v_from;
  while v_m <= v_to loop
    perform public._generate_fixed_payables(v_company, v_m);
    v_m := (v_m + interval '1 month')::date;
  end loop;

  return query
  with vendas as (
    select s.id, date_trunc('month', s.issue_date)::date m, s.total, coalesce(s.commission_amount, 0) com
      from public.sales s
     where s.company_id = v_company and s.hidden_at is null and s.status in ('faturado', 'entregue')
       and s.issue_date between v_from and v_to
  ),
  pagas as (
    select date_trunc('month', public._local_day(p.paid_at))::date m, p.amount amt, p.paid_amount paid
      from public.payables p
     where p.company_id = v_company and p.status = 'paga' and p.paid_amount is not null
       and public._local_day(p.paid_at) between v_from and v_to
  )
  select v.m, 'receita'::text, 'Receita de vendas'::text, sum(v.total) from vendas v group by v.m
  union all
  select v.m, 'cmv'::text, 'Custo das mercadorias vendidas'::text, sum(si.qty * coalesce(pr.cost_price, 0))
    from vendas v join public.sale_items si on si.sale_id = v.id join public.products pr on pr.id = si.product_id
   group by v.m
  union all
  select v.m, 'comissao'::text, 'Comissões'::text, sum(v.com) from vendas v group by v.m having sum(v.com) <> 0
  union all
  select date_trunc('month', public._local_day(sp.paid_at))::date, 'taxa'::text, 'Taxas de recebimento'::text, sum(sp.fee_amount)
    from public.sale_payments sp join public.sales s on s.id = sp.sale_id
   where s.company_id = v_company and sp.status = 'pago' and sp.fee_amount > 0
     and public._local_day(sp.paid_at) between v_from and v_to
   group by 1
  union all
  select date_trunc('month', public._local_day(sp.paid_at))::date, 'receita_financeira'::text, 'Juros e multas recebidos'::text,
         sum(sp.received_amount - sp.amount)
    from public.sale_payments sp join public.sales s on s.id = sp.sale_id
   where s.company_id = v_company and sp.status = 'pago' and sp.received_amount > sp.amount
     and public._local_day(sp.paid_at) between v_from and v_to
   group by 1
  union all
  select x.m, 'despesa'::text, coalesce(ec.name, 'Sem categoria')::text, sum(x.v)
    from (
      select date_trunc('month', p.due_date)::date m, p.category_id cat, p.amount v
        from public.payables p
       where p.company_id = v_company and p.status <> 'cancelada' and p.loan_id is null
         and p.due_date between v_from and v_to
      union all
      select date_trunc('month', ve.paid_on)::date, ve.category_id, ve.amount_cents / 100.0
        from public.variable_expenses ve
       where ve.company_id = v_company and ve.paid_on between v_from and v_to
      union all
      select fep.month_ref, fe.category_id, fep.amount_cents / 100.0
        from public.fixed_expense_payments fep join public.fixed_expenses fe on fe.id = fep.fixed_expense_id
       where fep.company_id = v_company and fep.month_ref between v_from and v_to
         and not exists (select 1 from public.payables p2 where p2.source = 'fixa' and p2.source_id = fep.fixed_expense_id and p2.month_ref = fep.month_ref)
    ) x
    left join public.expense_categories ec on ec.id = x.cat
   group by x.m, coalesce(ec.name, 'Sem categoria')
  union all
  select date_trunc('month', p.due_date)::date, 'juros_emprestimo'::text, 'Juros de empréstimos'::text, sum(p.interest_part)
    from public.payables p
   where p.company_id = v_company and p.loan_id is not null and p.status <> 'cancelada' and p.interest_part > 0
     and p.due_date between v_from and v_to
   group by 1
  union all
  select pg.m, 'encargos'::text, 'Juros e multas pagos'::text, sum(pg.paid - pg.amt) from pagas pg where pg.paid > pg.amt group by pg.m
  union all
  select pg.m, 'descontos'::text, 'Descontos obtidos'::text, sum(pg.amt - pg.paid) from pagas pg where pg.paid < pg.amt group by pg.m
   order by 1, 2, 3;
end $$;
