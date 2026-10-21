-- =====================================================================
-- Financeiro completo — contas/carteiras, contas a pagar, fluxo de caixa
--
--   1. finance_accounts  (caixa, bancos, carteiras digitais) + saldo inicial
--   2. finance_transfers (entre contas: depósito do caixa no banco etc.)
--   3. sale_payments.account_id — onde o recebimento caiu
--   4. payables          (contas a pagar: fornecedor, conta de luz, fixas…)
--   5. despesas FIXAS viram conta a pagar do mês (só mês atual em diante;
--      mês passado só se já estava pago) e ficam SINCRONIZADAS nos dois
--      sentidos com fixed_expense_payments (tela antiga continua valendo).
--      Despesas VARIÁVEIS continuam onde estão e entram como "já pagas".
--   6. conta padrão por forma de pagamento (ex.: dinheiro → Caixa da loja)
--   7. RPCs: pay_payables, revert_payable, list_payables, payables_overview,
--            account_balances, account_statement, cash_flow,
--            register_payment_receipts (+ conta de destino)
--
-- Valores novos em numeric (reais), como vendas. As tabelas antigas do
-- add-on (fixas/variáveis) seguem em centavos; a conversão é feita aqui.
-- Datas "do dia" em America/Sao_Paulo.
-- =====================================================================

-- ───────── 1. Contas / carteiras ─────────
create table if not exists public.finance_accounts (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  name             text not null,
  kind             text not null default 'banco' check (kind in ('caixa', 'banco', 'digital', 'outro')),
  bank_name        text,
  opening_balance  numeric(14,2) not null default 0,
  opening_date     date not null default current_date,
  default_methods  text[] not null default '{}',
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists finance_accounts_company_idx on public.finance_accounts(company_id);
drop trigger if exists trg_finance_accounts_updated on public.finance_accounts;
create trigger trg_finance_accounts_updated before update on public.finance_accounts
  for each row execute function public.tg_set_updated_at();

alter table public.finance_accounts enable row level security;
drop policy if exists "fac_select" on public.finance_accounts;
create policy "fac_select" on public.finance_accounts for select
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()));
drop policy if exists "fac_write" on public.finance_accounts;
create policy "fac_write" on public.finance_accounts for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()))
  with check (company_id = public.current_company_id() and public.has_financial_access());

-- Toda empresa começa com o caixa físico, recebendo o dinheiro do PDV.
insert into public.finance_accounts (company_id, name, kind, default_methods)
select c.id, 'Caixa da loja', 'caixa', array['dinheiro'] from public.companies c
on conflict (company_id, name) do nothing;

create or replace function public.on_company_created_seed_accounts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.finance_accounts (company_id, name, kind, default_methods)
  values (new.id, 'Caixa da loja', 'caixa', array['dinheiro'])
  on conflict (company_id, name) do nothing;
  return new;
end $$;
drop trigger if exists trg_company_seed_accounts on public.companies;
create trigger trg_company_seed_accounts after insert on public.companies
  for each row execute function public.on_company_created_seed_accounts();

-- ───────── 2. Transferências entre contas ─────────
create table if not exists public.finance_transfers (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  from_account_id  uuid not null references public.finance_accounts(id) on delete restrict,
  to_account_id    uuid not null references public.finance_accounts(id) on delete restrict,
  amount           numeric(14,2) not null check (amount > 0),
  transfer_date    date not null default current_date,
  notes            text,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);
create index if not exists finance_transfers_company_idx on public.finance_transfers(company_id, transfer_date);

alter table public.finance_transfers enable row level security;
drop policy if exists "ftr_select" on public.finance_transfers;
create policy "ftr_select" on public.finance_transfers for select
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()));
drop policy if exists "ftr_write" on public.finance_transfers;
create policy "ftr_write" on public.finance_transfers for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()))
  with check (company_id = public.current_company_id() and public.has_financial_access());

-- ───────── 3. Onde o recebimento caiu ─────────
alter table public.sale_payments
  add column if not exists account_id uuid references public.finance_accounts(id) on delete set null;
create index if not exists sale_pay_account_idx on public.sale_payments(account_id) where account_id is not null;

-- ───────── 4. Contas a pagar ─────────
create table if not exists public.payables (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  description        text not null,
  supplier_id        uuid references public.suppliers(id) on delete set null,
  category_id        uuid references public.expense_categories(id) on delete set null,
  amount             numeric(12,2) not null check (amount > 0),
  due_date           date not null,
  status             text not null default 'aberta' check (status in ('aberta', 'paga', 'cancelada')),
  paid_at            timestamptz,
  paid_amount        numeric(12,2),
  paid_by            uuid references auth.users(id) on delete set null,
  account_id         uuid references public.finance_accounts(id) on delete set null,
  payment_method     text,
  document_number    text,
  boleto_line        text,
  source             text not null default 'manual' check (source in ('manual', 'fixa', 'compra')),
  source_id          uuid,
  month_ref          date,
  installment_no     integer,
  installment_total  integer,
  group_id           uuid,
  notes              text,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists payables_company_status_idx on public.payables(company_id, status, due_date);
create index if not exists payables_paid_idx on public.payables(company_id, paid_at) where status = 'paga';
create unique index if not exists payables_fixa_month_uq on public.payables(source_id, month_ref) where source = 'fixa';
drop trigger if exists trg_payables_updated on public.payables;
create trigger trg_payables_updated before update on public.payables
  for each row execute function public.tg_set_updated_at();

alter table public.payables enable row level security;
drop policy if exists "pay_select" on public.payables;
create policy "pay_select" on public.payables for select
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()));
drop policy if exists "pay_write" on public.payables;
create policy "pay_write" on public.payables for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()))
  with check (company_id = public.current_company_id() and public.has_financial_access());

-- ───────── 5a. Fixas → contas a pagar do mês ─────────
-- Interna (sem checagem de papel): chamada pelas RPCs abaixo, que checam.
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
     and (v_m >= v_cur or fep.id is not null)   -- não inventa dívida de mês passado
  on conflict (source_id, month_ref) where source = 'fixa' do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ───────── 5b. Sincronia fixas ⇄ contas a pagar (sem efeito em loop) ─────────
create or replace function public.tg_payable_fixed_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.source <> 'fixa' or new.source_id is null or new.month_ref is null then return new; end if;

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
  return new;
end $$;
drop trigger if exists trg_payable_fixed_sync on public.payables;
create trigger trg_payable_fixed_sync after update of status on public.payables
  for each row execute function public.tg_payable_fixed_sync();

create or replace function public.tg_fixed_payment_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.payables
       set status = 'paga',
           paid_at = (new.paid_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo',
           paid_amount = new.amount_cents / 100.0,
           paid_by = coalesce(paid_by, auth.uid())
     where source = 'fixa' and source_id = new.fixed_expense_id and month_ref = new.month_ref;
  else
    update public.payables
       set status = 'aberta', paid_at = null, paid_amount = null, paid_by = null, account_id = null
     where source = 'fixa' and source_id = old.fixed_expense_id and month_ref = old.month_ref
       and status = 'paga';
  end if;
  return null;
end $$;
drop trigger if exists trg_fixed_payment_sync on public.fixed_expense_payments;
create trigger trg_fixed_payment_sync after insert or update or delete on public.fixed_expense_payments
  for each row execute function public.tg_fixed_payment_sync();

-- ───────── 6. Conta padrão por forma de pagamento (recebimentos) ─────────
create or replace function public.tg_sale_payment_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pago' and new.account_id is null then
    select fa.id into new.account_id
      from public.finance_accounts fa
      join public.sales s on s.company_id = fa.company_id
     where s.id = new.sale_id and fa.active and new.method::text = any(fa.default_methods)
     order by fa.created_at
     limit 1;
  elsif tg_op = 'UPDATE' and old.status = 'pago' and new.status is distinct from 'pago' then
    new.account_id := null;
  end if;
  return new;
end $$;
-- nome com "z" pra rodar depois do trigger de baixa (ordem alfabética)
drop trigger if exists trg_sale_payment_zaccount on public.sale_payments;
create trigger trg_sale_payment_zaccount before insert or update on public.sale_payments
  for each row execute function public.tg_sale_payment_account();

-- ───────── 7a. Baixa de recebíveis com conta de destino ─────────
drop function if exists public.register_payment_receipts(uuid[], date, numeric, text);
create function public.register_payment_receipts(
  p_ids            uuid[],
  p_paid_on        date    default null,
  p_received_total numeric default null,
  p_notes          text    default null,
  p_account_id     uuid    default null
)
returns table (
  updated_count   integer,
  cash_session_id uuid,
  gross_total     numeric,
  received_total  numeric,
  fee_total       numeric
)
language plpgsql
volatile
security definer
set search_path = public
as $$
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
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'Selecione ao menos um pagamento';
  end if;
  if p_paid_on is not null and p_paid_on > v_today then
    raise exception 'A data do recebimento não pode ser no futuro';
  end if;
  if p_account_id is not null and not exists (
       select 1 from public.finance_accounts where id = p_account_id and company_id = v_company and active) then
    raise exception 'Conta de destino inválida';
  end if;
  v_paid_at := case
                 when p_paid_on is null or p_paid_on = v_today then now()
                 else (p_paid_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo'
               end;

  select count(*), coalesce(sum(sp.amount), 0) into v_count, v_gross
    from public.sale_payments sp join public.sales s on s.id = sp.sale_id
   where sp.id = any(v_ids) and s.company_id = v_company and sp.status in ('pendente', 'parcial');
  if v_count <> cardinality(v_ids) then
    raise exception 'Algum pagamento selecionado já foi baixado ou não pertence à empresa. Atualize a tela e tente de novo.';
  end if;
  if exists (select 1 from public.sale_payments sp
              where sp.id = any(v_ids) and sp.method = 'boleto' and sp.issue_status = 'a_emitir') then
    raise exception 'Tem boleto ainda não emitido na seleção. Registre a emissão antes de dar baixa no pagamento.';
  end if;
  if p_received_total is not null and p_received_total <= 0 then
    raise exception 'O valor recebido precisa ser maior que zero';
  end if;

  with sel as (
    select sp.id, sp.amount,
           sum(sp.amount) over (order by sp.id rows between unbounded preceding and current row) as cum
      from public.sale_payments sp where sp.id = any(v_ids)
  ),
  dist as (
    select sel.id,
           case when p_received_total is null then sel.amount
                else round(sel.cum * p_received_total / v_gross, 2)
                   - round((sel.cum - sel.amount) * p_received_total / v_gross, 2)
           end as received
      from sel
  )
  update public.sale_payments sp
     set status          = 'pago',
         paid_at         = v_paid_at,
         received_amount = dist.received,
         account_id      = coalesce(p_account_id, sp.account_id),
         notes           = case when v_note is null then sp.notes
                                else coalesce(sp.notes || E'\n', '') || v_note end
    from dist
   where dist.id = sp.id;

  return query
    select count(*)::integer, max(sp.cash_session_id::text)::uuid,
           coalesce(sum(sp.amount), 0), coalesce(sum(sp.received_amount), 0), coalesce(sum(sp.fee_amount), 0)
      from public.sale_payments sp where sp.id = any(v_ids);
end $$;
grant execute on function public.register_payment_receipts(uuid[], date, numeric, text, uuid) to authenticated;

-- ───────── 7b. Pagar contas (uma ou várias; valor pago rateado) ─────────
create or replace function public.pay_payables(
  p_ids        uuid[],
  p_paid_on    date    default null,
  p_paid_total numeric default null,
  p_account_id uuid    default null,
  p_method     text    default null,
  p_notes      text    default null
)
returns table (updated_count integer, gross_total numeric, paid_total numeric)
language plpgsql
volatile
security definer
set search_path = public
as $$
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
  if p_paid_on is not null and p_paid_on > v_today then
    raise exception 'A data do pagamento não pode ser no futuro';
  end if;
  if p_paid_total is not null and p_paid_total <= 0 then
    raise exception 'O valor pago precisa ser maior que zero';
  end if;
  if p_account_id is not null and not exists (
       select 1 from public.finance_accounts where id = p_account_id and company_id = v_company and active) then
    raise exception 'Conta de saída inválida';
  end if;

  select count(*), coalesce(sum(amount), 0) into v_count, v_gross
    from public.payables where id = any(v_ids) and company_id = v_company and status = 'aberta';
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
     set status = 'paga',
         paid_at = v_paid_at,
         paid_amount = dist.paid,
         paid_by = auth.uid(),
         payment_method = coalesce(v_method, p.payment_method),
         account_id = coalesce(
           p_account_id, p.account_id,
           (select fa.id from public.finance_accounts fa
             where fa.company_id = v_company and fa.active
               and coalesce(v_method, p.payment_method) = any(fa.default_methods)
             order by fa.created_at limit 1)),
         notes = case when v_note is null then p.notes else coalesce(p.notes || E'\n', '') || v_note end
    from dist
   where dist.id = p.id;

  return query
    select count(*)::integer, coalesce(sum(p.amount), 0), coalesce(sum(p.paid_amount), 0)
      from public.payables p where p.id = any(v_ids);
end $$;
grant execute on function public.pay_payables(uuid[], date, numeric, uuid, text, text) to authenticated;

create or replace function public.revert_payable(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  update public.payables
     set status = 'aberta', paid_at = null, paid_amount = null, paid_by = null, account_id = null
   where id = p_id and company_id = v_company and status = 'paga';
  if not found then raise exception 'Conta paga não encontrada'; end if;
end $$;
grant execute on function public.revert_payable(uuid) to authenticated;

-- ───────── 7c. Lista de contas a pagar (+ variáveis já pagas) ─────────
create or replace function public.list_payables(p_paid_from date, p_paid_to date)
returns table (
  id                 uuid,
  kind               text,
  description        text,
  supplier_id        uuid,
  supplier_name      text,
  category_id        uuid,
  category_name      text,
  amount             numeric,
  due_date           date,
  status             text,
  paid_at            timestamptz,
  paid_amount        numeric,
  account_id         uuid,
  account_name       text,
  payment_method     text,
  document_number    text,
  boleto_line        text,
  source             text,
  month_ref          date,
  installment_no     integer,
  installment_total  integer,
  notes              text,
  attachments_count  bigint,
  created_at         timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_cur     date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para consultar contas a pagar' using errcode = '42501';
  end if;
  perform public._generate_fixed_payables(v_company, v_cur);
  perform public._generate_fixed_payables(v_company, (v_cur + interval '1 month')::date);

  return query
    select p.id, 'payable'::text, p.description, p.supplier_id, sup.name::text, p.category_id, ec.name::text,
           p.amount, p.due_date, p.status, p.paid_at, p.paid_amount, p.account_id, fa.name::text,
           p.payment_method, p.document_number, p.boleto_line, p.source, p.month_ref,
           p.installment_no, p.installment_total, p.notes,
           (select count(*) from public.finance_attachments a where a.entity = 'payable' and a.entity_id = p.id),
           p.created_at
      from public.payables p
      left join public.suppliers sup on sup.id = p.supplier_id
      left join public.expense_categories ec on ec.id = p.category_id
      left join public.finance_accounts fa on fa.id = p.account_id
     where p.company_id = v_company
       and (p.status = 'aberta'
            or (p.status = 'paga' and (p.paid_at at time zone 'America/Sao_Paulo')::date between p_paid_from and p_paid_to))
    union all
    select ve.id, 'variavel'::text, ve.name, null::uuid, null::text, ve.category_id, ec.name::text,
           ve.amount_cents / 100.0, ve.paid_on, 'paga'::text,
           (ve.paid_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo',
           ve.amount_cents / 100.0, null::uuid, null::text, null::text, null::text, null::text,
           'variavel'::text, null::date, null::integer, null::integer, ve.notes, 0::bigint, ve.created_at
      from public.variable_expenses ve
      left join public.expense_categories ec on ec.id = ve.category_id
     where ve.company_id = v_company and ve.paid_on between p_paid_from and p_paid_to
     order by 10, 9;
end $$;
grant execute on function public.list_payables(date, date) to authenticated;

-- ───────── 7d. Visão geral das contas a pagar ─────────
create or replace function public.payables_overview()
returns table (
  open_count      bigint,
  open_total      numeric,
  overdue_count   bigint,
  overdue_total   numeric,
  due_today_count bigint,
  due_today_total numeric,
  next7_total     numeric,
  month_open      numeric,
  paid_month      numeric
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_today   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_month   date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para consultar contas a pagar' using errcode = '42501';
  end if;
  perform public._generate_fixed_payables(v_company, v_month);

  return query
  with b as (
    select p.status st, p.amount amt, p.paid_amount paid, p.due_date due,
           (p.paid_at at time zone 'America/Sao_Paulo')::date paid_day
      from public.payables p where p.company_id = v_company
  )
  select count(*) filter (where st = 'aberta'),
         coalesce(sum(amt) filter (where st = 'aberta'), 0),
         count(*) filter (where st = 'aberta' and due < v_today),
         coalesce(sum(amt) filter (where st = 'aberta' and due < v_today), 0),
         count(*) filter (where st = 'aberta' and due = v_today),
         coalesce(sum(amt) filter (where st = 'aberta' and due = v_today), 0),
         coalesce(sum(amt) filter (where st = 'aberta' and due > v_today and due <= v_today + 7), 0),
         coalesce(sum(amt) filter (where st = 'aberta' and due >= v_month and due < (v_month + interval '1 month')::date), 0),
         coalesce(sum(paid) filter (where st = 'paga' and paid_day >= v_month), 0)
           + coalesce((select sum(ve.amount_cents) / 100.0 from public.variable_expenses ve
                        where ve.company_id = v_company and ve.paid_on >= v_month), 0)
    from b;
end $$;
grant execute on function public.payables_overview() to authenticated;

-- ───────── 7e. Saldo das contas ─────────
-- Movimento conta a partir do opening_date de cada conta.
create or replace function public.account_balances()
returns table (
  id               uuid,
  name             text,
  kind             text,
  bank_name        text,
  default_methods  text[],
  opening_balance  numeric,
  opening_date     date,
  inflow           numeric,
  outflow          numeric,
  transfers_in     numeric,
  transfers_out    numeric,
  balance          numeric,
  active           boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
  with ins as (
    select sp.account_id aid, sum(coalesce(sp.received_amount, sp.amount)) v
      from public.sale_payments sp
      join public.finance_accounts fa on fa.id = sp.account_id
     where fa.company_id = v_company and sp.status = 'pago'
       and (sp.paid_at at time zone 'America/Sao_Paulo')::date >= fa.opening_date
     group by 1
  ),
  outs as (
    select p.account_id aid, sum(coalesce(p.paid_amount, p.amount)) v
      from public.payables p
      join public.finance_accounts fa on fa.id = p.account_id
     where p.company_id = v_company and p.status = 'paga'
       and (p.paid_at at time zone 'America/Sao_Paulo')::date >= fa.opening_date
     group by 1
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
grant execute on function public.account_balances() to authenticated;

-- ───────── 7f. Extrato de uma conta ─────────
create or replace function public.account_statement(p_account_id uuid, p_from date, p_to date)
returns table (
  moved_on    date,
  kind        text,
  description text,
  amount      numeric,
  ref_id      uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if not exists (select 1 from public.finance_accounts where id = p_account_id and company_id = v_company) then
    raise exception 'Conta não encontrada';
  end if;
  return query
    select (sp.paid_at at time zone 'America/Sao_Paulo')::date, 'recebimento'::text,
           ('Venda #' || s.number || coalesce(' · ' || coalesce(c.trade_name, c.name), ''))::text,
           coalesce(sp.received_amount, sp.amount), s.id
      from public.sale_payments sp
      join public.sales s on s.id = sp.sale_id
      left join public.customers c on c.id = s.customer_id
     where sp.account_id = p_account_id and sp.status = 'pago'
       and (sp.paid_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
    union all
    select (p.paid_at at time zone 'America/Sao_Paulo')::date, 'pagamento'::text,
           p.description, -coalesce(p.paid_amount, p.amount), p.id
      from public.payables p
     where p.account_id = p_account_id and p.status = 'paga'
       and (p.paid_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
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
     order by 1 desc, 2;
end $$;
grant execute on function public.account_statement(uuid, date, date) to authenticated;

-- ───────── 7g. Fluxo de caixa (realizado × previsto por dia) ─────────
create or replace function public.cash_flow(p_from date, p_to date)
returns table (
  day          date,
  in_realized  numeric,
  out_realized numeric,
  in_expected  numeric,
  out_expected numeric
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
    raise exception 'Sem permissão para consultar o fluxo de caixa' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Período inválido (máximo de 400 dias)';
  end if;
  v_m := date_trunc('month', p_from)::date;
  while v_m <= p_to loop
    perform public._generate_fixed_payables(v_company, v_m);
    v_m := (v_m + interval '1 month')::date;
  end loop;

  return query
  with days as (
    select g::date d from generate_series(p_from, p_to, interval '1 day') g
  ),
  rec as (  -- recebimentos de vendas
    select (sp.paid_at at time zone 'America/Sao_Paulo')::date d_paid, sp.due_date d_due, sp.status st,
           coalesce(sp.received_amount, sp.amount) net, sp.amount amt
      from public.sale_payments sp
      join public.sales s on s.id = sp.sale_id
     where s.company_id = v_company and s.hidden_at is null
       and s.status not in ('orcamento', 'cancelado', 'perdido')
  ),
  ir as (select d_paid d, sum(net) v from rec where st = 'pago' and d_paid between p_from and p_to group by 1),
  ie as (
    select x.d, sum(x.v) v from (
      select d_due d, amt v from rec where st in ('pendente', 'parcial') and d_due between p_from and p_to
      union all
      select ri.due_date, ri.total from public.rental_invoices ri
       where ri.company_id = v_company and ri.status = 'pendente' and ri.sale_id is null
         and ri.due_date between p_from and p_to
    ) x group by 1
  ),
  orr as (
    select x.d, sum(x.v) v from (
      select (p.paid_at at time zone 'America/Sao_Paulo')::date d, coalesce(p.paid_amount, p.amount) v
        from public.payables p
       where p.company_id = v_company and p.status = 'paga'
         and (p.paid_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
      union all
      select ve.paid_on, ve.amount_cents / 100.0 from public.variable_expenses ve
       where ve.company_id = v_company and ve.paid_on between p_from and p_to
      union all  -- fixas pagas na tela antiga em mês sem conta a pagar gerada
      select fep.paid_on, fep.amount_cents / 100.0 from public.fixed_expense_payments fep
       where fep.company_id = v_company and fep.paid_on between p_from and p_to
         and not exists (select 1 from public.payables p2
                          where p2.source = 'fixa' and p2.source_id = fep.fixed_expense_id
                            and p2.month_ref = fep.month_ref)
    ) x group by 1
  ),
  oe as (
    select p.due_date d, sum(p.amount) v from public.payables p
     where p.company_id = v_company and p.status = 'aberta' and p.due_date between p_from and p_to
     group by 1
  )
  select days.d, coalesce(ir.v, 0), coalesce(orr.v, 0), coalesce(ie.v, 0), coalesce(oe.v, 0)
    from days
    left join ir  on ir.d  = days.d
    left join ie  on ie.d  = days.d
    left join orr on orr.d = days.d
    left join oe  on oe.d  = days.d
   order by days.d;
end $$;
grant execute on function public.cash_flow(date, date) to authenticated;
