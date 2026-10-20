-- =====================================================================
-- Contas a receber: baixa de pagamentos pendentes
--
-- Regra de negócio
--   • Boleto, crediário, transferência e cartão de crédito nascem PENDENTES.
--     Não entram no caixa nem no "Recebido" até alguém dar baixa.
--   • A venda continua concluída normalmente (conta no "Vendido").
--   • Na baixa, o valor entra no caixa ABERTO de quem deu baixa, na data
--     informada. Sem caixa aberto, conta no Recebido mas em caixa nenhum.
--   • Cartão de crédito: a baixa informa o valor LÍQUIDO que caiu. A
--     diferença vira taxa; se caiu antes da previsão, fica "antecipado".
--
-- O que muda
--   1. sale_payments: cash_session_id, received_amount, fee_amount,
--      anticipated, paid_by
--   2. backfill: pagamentos já pagos de venda do PDV ficam no caixa da venda
--   3. trigger: preenche tudo isso na transição → pago e limpa no estorno
--   4. cash_session_summary: só soma pagamento PAGO que entrou naquele caixa
--   5. RPCs: receivables_overview, list_receivables, received_summary,
--      register_payment_receipts, revert_payment_receipt
--
-- Datas "de hoje" usam America/Sao_Paulo (o banco roda em UTC).
-- =====================================================================

-- ───────── 1. Colunas ─────────
alter table public.sale_payments
  add column if not exists cash_session_id uuid references public.cash_sessions(id) on delete set null,
  add column if not exists received_amount numeric(12,2),
  add column if not exists fee_amount      numeric(12,2) not null default 0,
  add column if not exists anticipated     boolean not null default false,
  add column if not exists paid_by         uuid references auth.users(id) on delete set null;

comment on column public.sale_payments.cash_session_id is
  'Caixa em que o dinheiro entrou. PDV: o caixa da venda. Baixa posterior: o caixa aberto de quem deu baixa.';
comment on column public.sale_payments.received_amount is
  'Valor líquido que efetivamente entrou (null = igual a amount).';
comment on column public.sale_payments.fee_amount is
  'amount − received_amount quando positivo (taxa de antecipação / desconto).';
comment on column public.sale_payments.anticipated is
  'Cartão de crédito recebido antes do vencimento previsto.';

create index if not exists sale_pay_cash_session_idx on public.sale_payments(cash_session_id);
create index if not exists sale_pay_open_due_idx
  on public.sale_payments(due_date) where status in ('pendente', 'parcial');
create index if not exists sale_pay_paid_at_idx
  on public.sale_payments(paid_at) where status = 'pago';

-- ───────── 2. Backfill (antes do trigger, pra não disparar regra nova) ─────────
update public.sale_payments sp
   set cash_session_id = s.cash_session_id
  from public.sales s
 where s.id = sp.sale_id
   and sp.status = 'pago'
   and sp.cash_session_id is null
   and s.cash_session_id is not null;

-- ───────── 3. Trigger de baixa / estorno ─────────
create or replace function public.tg_sale_payment_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pago' and (tg_op = 'INSERT' or old.status is distinct from 'pago') then
    -- Virou pago agora.
    new.paid_at         := coalesce(new.paid_at, now());
    new.received_amount := coalesce(new.received_amount, new.amount);
    new.fee_amount      := greatest(new.amount - new.received_amount, 0);
    new.anticipated     := new.method = 'cartao_credito'
                           and new.due_date is not null
                           and (new.paid_at at time zone 'America/Sao_Paulo')::date < new.due_date;
    new.paid_by         := coalesce(new.paid_by, auth.uid());

    if new.cash_session_id is null then
      if tg_op = 'INSERT' then
        -- Pago na hora da venda: entra no caixa da própria venda (PDV).
        select s.cash_session_id into new.cash_session_id
          from public.sales s
         where s.id = new.sale_id;
      elsif auth.uid() is not null then
        -- Baixa posterior: entra no caixa aberto de quem deu baixa.
        select cs.id into new.cash_session_id
          from public.cash_sessions cs
         where cs.user_id = auth.uid()
           and cs.status = 'aberto'
         order by cs.opened_at desc
         limit 1;
      end if;
    end if;

  elsif tg_op = 'UPDATE' and old.status = 'pago' and new.status is distinct from 'pago' then
    -- Estorno da baixa: volta a ser recebível em aberto.
    new.paid_at         := null;
    new.received_amount := null;
    new.fee_amount      := 0;
    new.anticipated     := false;
    new.cash_session_id := null;
    new.paid_by         := null;

  elsif tg_op = 'UPDATE' and new.status = 'pago' then
    -- Continua pago. Se o bruto foi editado e não havia taxa, o líquido acompanha.
    if new.amount is distinct from old.amount
       and coalesce(old.received_amount, old.amount) = old.amount then
      new.received_amount := new.amount;
    end if;
    new.fee_amount := greatest(new.amount - coalesce(new.received_amount, new.amount), 0);
  end if;

  return new;
end $$;

drop trigger if exists trg_sale_payment_receipt on public.sale_payments;
create trigger trg_sale_payment_receipt
  before insert or update on public.sale_payments
  for each row execute function public.tg_sale_payment_receipt();

-- ───────── 4. Resumo do caixa: só o que foi PAGO e entrou NESTE caixa ─────────
-- Mesma assinatura e colunas de antes (o front e o PDF de fechamento não mudam).
-- total_sales agora = total recebido no caixa (inclui baixas de vendas antigas).
create or replace function public.cash_session_summary(p_session_id uuid)
returns table (
  total_sales        numeric,
  sales_count        bigint,
  cash_in            numeric,
  card_in            numeric,
  pix_in             numeric,
  other_in           numeric,
  suprimentos        numeric,
  sangrias           numeric,
  expected_cash      numeric
)
language sql stable security definer set search_path = public as $$
  with sess as (
    select * from public.cash_sessions where id = p_session_id
  ),
  pays as (
    select sp.method, coalesce(sp.received_amount, sp.amount) as amount
      from public.sale_payments sp
     where sp.cash_session_id = p_session_id
       and sp.status = 'pago'
  ),
  movs as (
    select type, sum(amount) as total
      from public.cash_movements
     where cash_session_id = p_session_id
     group by type
  )
  select
    coalesce((select sum(amount) from pays), 0)                                          as total_sales,
    (select count(distinct s.id) from public.sales s where s.cash_session_id = p_session_id) as sales_count,
    coalesce((select sum(amount) from pays where method = 'dinheiro'), 0)                  as cash_in,
    coalesce((select sum(amount) from pays where method in ('cartao_credito','cartao_debito')), 0) as card_in,
    coalesce((select sum(amount) from pays where method = 'pix'), 0)                       as pix_in,
    coalesce((select sum(amount) from pays where method in (
      'boleto','transferencia','crediario','outro'
    )), 0)                                                                                 as other_in,
    coalesce((select total from movs where type = 'suprimento'), 0)                        as suprimentos,
    coalesce((select total from movs where type = 'sangria'), 0)                           as sangrias,
    (select opening_amount from sess)
      + coalesce((select sum(amount) from pays where method = 'dinheiro'), 0)
      + coalesce((select total from movs where type = 'suprimento'), 0)
      - coalesce((select total from movs where type = 'sangria'), 0)                       as expected_cash;
$$;
grant execute on function public.cash_session_summary(uuid) to authenticated;

-- ───────── 5a. Visão geral (badge do menu, Dashboard, topo da tela) ─────────
create or replace function public.receivables_overview()
returns table (
  open_count              bigint,
  open_total              numeric,
  overdue_count           bigint,
  overdue_total           numeric,
  due_today_count         bigint,
  due_today_total         numeric,
  next7_total             numeric,
  received_today          numeric,
  received_month          numeric,
  anticipated_month_count bigint,
  anticipated_month_gross numeric,
  fees_month              numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_today   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_month   date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para consultar recebíveis' using errcode = '42501';
  end if;

  return query
  with base as (
    select sp.status    as st,
           sp.amount    as amt,
           coalesce(sp.received_amount, sp.amount) as net,
           sp.fee_amount as fee,
           sp.anticipated as ant,
           sp.due_date  as due,
           (sp.paid_at at time zone 'America/Sao_Paulo')::date as paid_day
      from public.sale_payments sp
      join public.sales s on s.id = sp.sale_id
     where s.company_id = v_company
       and s.hidden_at is null
       and s.status not in ('orcamento', 'cancelado', 'perdido')
  )
  select
    count(*)                 filter (where st in ('pendente','parcial')),
    coalesce(sum(amt)        filter (where st in ('pendente','parcial')), 0),
    count(*)                 filter (where st in ('pendente','parcial') and due < v_today),
    coalesce(sum(amt)        filter (where st in ('pendente','parcial') and due < v_today), 0),
    count(*)                 filter (where st in ('pendente','parcial') and due = v_today),
    coalesce(sum(amt)        filter (where st in ('pendente','parcial') and due = v_today), 0),
    coalesce(sum(amt)        filter (where st in ('pendente','parcial') and due > v_today and due <= v_today + 7), 0),
    coalesce(sum(net)        filter (where st = 'pago' and paid_day = v_today), 0),
    coalesce(sum(net)        filter (where st = 'pago' and paid_day >= v_month), 0),
    count(*)                 filter (where st = 'pago' and ant and paid_day >= v_month),
    coalesce(sum(amt)        filter (where st = 'pago' and ant and paid_day >= v_month), 0),
    coalesce(sum(fee)        filter (where st = 'pago' and paid_day >= v_month), 0)
  from base;
end $$;
grant execute on function public.receivables_overview() to authenticated;

-- ───────── 5b. Lista da tela "Contas a receber" ─────────
-- Todos os em aberto (qualquer vencimento) + os recebidos no intervalo.
create or replace function public.list_receivables(p_paid_from date, p_paid_to date)
returns table (
  id                uuid,
  sale_id           uuid,
  sale_number       bigint,
  customer_name     text,
  seller_name       text,
  method            text,
  status            text,
  amount            numeric,
  due_date          date,
  paid_at           timestamptz,
  received_amount   numeric,
  fee_amount        numeric,
  anticipated       boolean,
  cash_session_id   uuid,
  cash_session_open boolean,
  paid_by_name      text,
  notes             text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para consultar recebíveis' using errcode = '42501';
  end if;

  return query
    select sp.id,
           s.id,
           s.number::bigint,
           coalesce(c.trade_name, c.name)::text,
           seller.nome::text,
           sp.method::text,
           sp.status::text,
           sp.amount,
           sp.due_date,
           sp.paid_at,
           coalesce(sp.received_amount, case when sp.status = 'pago' then sp.amount end),
           sp.fee_amount,
           sp.anticipated,
           sp.cash_session_id,
           (cs.status = 'aberto'),
           payer.nome::text,
           sp.notes
      from public.sale_payments sp
      join public.sales s           on s.id = sp.sale_id
      left join public.customers c  on c.id = s.customer_id
      left join public.profiles seller on seller.id = s.seller_id
      left join public.profiles payer  on payer.id = sp.paid_by
      left join public.cash_sessions cs on cs.id = sp.cash_session_id
     where s.company_id = v_company
       and s.hidden_at is null
       and s.status not in ('orcamento', 'cancelado', 'perdido')
       and (
             sp.status in ('pendente', 'parcial')
          or (sp.status = 'pago'
              and (sp.paid_at at time zone 'America/Sao_Paulo')::date between p_paid_from and p_paid_to)
       )
     order by (sp.status = 'pago'), sp.due_date nulls last, sp.paid_at desc nulls last;
end $$;
grant execute on function public.list_receivables(date, date) to authenticated;

-- ───────── 5c. Recebido no período (Relatórios) ─────────
-- Pela data do RECEBIMENTO, não da venda: baixa de hoje de venda antiga entra hoje.
create or replace function public.received_summary(p_from date, p_to date, p_seller uuid default null)
returns table (
  received_total    numeric,
  received_count    bigint,
  fee_total         numeric,
  anticipated_gross numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para consultar recebimentos' using errcode = '42501';
  end if;

  return query
    select coalesce(sum(coalesce(sp.received_amount, sp.amount)), 0),
           count(*),
           coalesce(sum(sp.fee_amount), 0),
           coalesce(sum(sp.amount) filter (where sp.anticipated), 0)
      from public.sale_payments sp
      join public.sales s on s.id = sp.sale_id
     where s.company_id = v_company
       and s.hidden_at is null
       and s.status not in ('orcamento', 'cancelado', 'perdido')
       and sp.status = 'pago'
       and (sp.paid_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
       and (p_seller is null or s.seller_id = p_seller);
end $$;
grant execute on function public.received_summary(date, date, uuid) to authenticated;

-- ───────── 5d. Dar baixa (um ou vários) ─────────
-- p_paid_on:        data do recebimento (null = agora). Não aceita data futura.
-- p_received_total: valor LÍQUIDO que caiu para o conjunto (null = valor cheio).
--                   Rateado proporcionalmente ao bruto; a diferença vira taxa.
create or replace function public.register_payment_receipts(
  p_ids            uuid[],
  p_paid_on        date    default null,
  p_received_total numeric default null,
  p_notes          text    default null
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
  v_paid_at := case
                 when p_paid_on is null or p_paid_on = v_today then now()
                 else (p_paid_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo'
               end;

  select count(*), coalesce(sum(sp.amount), 0)
    into v_count, v_gross
    from public.sale_payments sp
    join public.sales s on s.id = sp.sale_id
   where sp.id = any(v_ids)
     and s.company_id = v_company
     and sp.status in ('pendente', 'parcial');

  if v_count <> cardinality(v_ids) then
    raise exception 'Algum pagamento selecionado já foi baixado ou não pertence à empresa. Atualize a tela e tente de novo.';
  end if;

  if p_received_total is not null and p_received_total <= 0 then
    raise exception 'O valor recebido precisa ser maior que zero';
  end if;

  -- Rateio do líquido por arredondamento acumulado (a soma fecha no centavo).
  with sel as (
    select sp.id,
           sp.amount,
           sum(sp.amount) over (order by sp.id rows between unbounded preceding and current row) as cum
      from public.sale_payments sp
     where sp.id = any(v_ids)
  ),
  dist as (
    select sel.id,
           case
             when p_received_total is null then sel.amount
             else round(sel.cum * p_received_total / v_gross, 2)
                - round((sel.cum - sel.amount) * p_received_total / v_gross, 2)
           end as received
      from sel
  )
  update public.sale_payments sp
     set status          = 'pago',
         paid_at         = v_paid_at,
         received_amount = dist.received,
         notes           = case
                             when v_note is null then sp.notes
                             else coalesce(sp.notes || E'\n', '') || v_note
                           end
    from dist
   where dist.id = sp.id;

  return query
    select count(*)::integer,
           max(sp.cash_session_id::text)::uuid,
           coalesce(sum(sp.amount), 0),
           coalesce(sum(sp.received_amount), 0),
           coalesce(sum(sp.fee_amount), 0)
      from public.sale_payments sp
     where sp.id = any(v_ids);
end $$;
grant execute on function public.register_payment_receipts(uuid[], date, numeric, text) to authenticated;

-- ───────── 5e. Desfazer baixa ─────────
create or replace function public.revert_payment_receipt(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company    uuid := public.current_company_id();
  v_status     public.payment_status;
  v_session    uuid;
  v_sess_state text;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para desfazer baixa' using errcode = '42501';
  end if;

  select sp.status, sp.cash_session_id
    into v_status, v_session
    from public.sale_payments sp
    join public.sales s on s.id = sp.sale_id
   where sp.id = p_id
     and s.company_id = v_company;

  if not found then
    raise exception 'Pagamento não encontrado';
  end if;
  if v_status <> 'pago' then
    raise exception 'Esse pagamento não está baixado';
  end if;

  if v_session is not null then
    select status into v_sess_state from public.cash_sessions where id = v_session;
    if v_sess_state = 'fechado' then
      raise exception 'Essa baixa entrou num caixa que já foi fechado e não pode ser desfeita.';
    end if;
  end if;

  update public.sale_payments set status = 'pendente' where id = p_id;
end $$;
grant execute on function public.revert_payment_receipt(uuid) to authenticated;
