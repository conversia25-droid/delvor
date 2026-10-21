-- =====================================================================
-- Boleto em duas etapas + anexos do financeiro
--
-- Boleto vendido nasce "A EMITIR". Alguém gera no banco e registra a
-- emissão (linha digitável, banco, PDF anexado) → "EMITIDO". Só boleto
-- emitido aceita baixa de pagamento (com comprovante anexado, opcional).
--
--   1. sale_payments: issue_status, issued_at/by, boleto_line/bank/number, sent_at
--   2. trigger: boleto pendente novo nasce 'a_emitir'
--   3. finance_attachments (anexos genéricos: recebíveis e contas a pagar)
--   4. RPCs: register_boleto_issue, revert_boleto_issue, mark_boleto_sent
--   5. receivables_overview / list_receivables com os campos novos
--   6. register_payment_receipts recusa boleto ainda não emitido
--
-- Legado: boletos já em aberto antes desta migration viram 'emitido'
-- (o sistema não sabe se foram gerados; não inunda o alerta "a emitir").
-- O arquivo em si fica no bucket privado 'finance-files' (migration 59).
-- =====================================================================

-- ───────── 1. Colunas ─────────
alter table public.sale_payments
  add column if not exists issue_status  text check (issue_status in ('a_emitir', 'emitido')),
  add column if not exists issued_at     timestamptz,
  add column if not exists issued_by     uuid references auth.users(id) on delete set null,
  add column if not exists boleto_line   text,
  add column if not exists boleto_bank   text,
  add column if not exists boleto_number text,
  add column if not exists sent_at       timestamptz;

create index if not exists sale_pay_issue_idx
  on public.sale_payments(issue_status) where issue_status = 'a_emitir';

update public.sale_payments
   set issue_status = 'emitido'
 where method = 'boleto'
   and status in ('pendente', 'parcial')
   and issue_status is null;

-- ───────── 2. Boleto novo nasce "a emitir" ─────────
create or replace function public.tg_sale_payment_boleto_issue()
returns trigger
language plpgsql
as $$
begin
  if new.method = 'boleto' then
    if new.issue_status is null and new.status in ('pendente', 'parcial') then
      new.issue_status := 'a_emitir';
    end if;
  elsif tg_op = 'UPDATE' and old.method = 'boleto' then
    -- deixou de ser boleto: some o controle de emissão
    new.issue_status  := null;
    new.issued_at     := null;
    new.issued_by     := null;
    new.boleto_line   := null;
    new.boleto_bank   := null;
    new.boleto_number := null;
    new.sent_at       := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_sale_payment_boleto_issue on public.sale_payments;
create trigger trg_sale_payment_boleto_issue
  before insert or update on public.sale_payments
  for each row execute function public.tg_sale_payment_boleto_issue();

-- ───────── 3. Anexos ─────────
create table if not exists public.finance_attachments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  entity        text not null check (entity in ('sale_payment', 'payable')),
  entity_id     uuid not null,
  kind          text not null default 'outro' check (kind in ('boleto', 'comprovante', 'nota', 'outro')),
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  uploaded_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists finance_attachments_entity_idx on public.finance_attachments(entity, entity_id);
create index if not exists finance_attachments_company_idx on public.finance_attachments(company_id);

alter table public.finance_attachments enable row level security;
drop policy if exists "fa_select" on public.finance_attachments;
create policy "fa_select" on public.finance_attachments for select
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()));
drop policy if exists "fa_insert" on public.finance_attachments;
create policy "fa_insert" on public.finance_attachments for insert
  with check (company_id = public.current_company_id() and public.has_financial_access());
drop policy if exists "fa_delete" on public.finance_attachments;
create policy "fa_delete" on public.finance_attachments for delete
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.has_financial_access()));

-- ───────── 4. Emissão ─────────
-- Linha digitável: guarda só os dígitos (47 = bancário, 48 = convênio/concessionária).
create or replace function public.register_boleto_issue(
  p_id       uuid,
  p_due_date date default null,
  p_line     text default null,
  p_bank     text default null,
  p_number   text default null,
  p_notes    text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_method  public.payment_method;
  v_status  public.payment_status;
  v_issue   text;
  v_due     date;
  v_line    text := nullif(regexp_replace(coalesce(p_line, ''), '\D', '', 'g'), '');
  v_note    text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para registrar emissão' using errcode = '42501';
  end if;

  select sp.method, sp.status, sp.issue_status, sp.due_date
    into v_method, v_status, v_issue, v_due
    from public.sale_payments sp
    join public.sales s on s.id = sp.sale_id
   where sp.id = p_id and s.company_id = v_company;

  if not found then raise exception 'Pagamento não encontrado'; end if;
  if v_method <> 'boleto' then raise exception 'Esse pagamento não é boleto'; end if;
  if v_status not in ('pendente', 'parcial') then raise exception 'Esse boleto já foi baixado'; end if;
  if v_line is not null and length(v_line) not in (47, 48) then
    raise exception 'A linha digitável tem 47 dígitos (ou 48 em boleto de convênio). Confira e tente de novo.';
  end if;
  if coalesce(p_due_date, v_due) is null then
    raise exception 'Informe o vencimento do boleto';
  end if;

  update public.sale_payments
     set issue_status  = 'emitido',
         issued_at     = now(),
         issued_by     = auth.uid(),
         due_date      = coalesce(p_due_date, due_date),
         boleto_line   = v_line,
         boleto_bank   = nullif(btrim(coalesce(p_bank, '')), ''),
         boleto_number = nullif(btrim(coalesce(p_number, '')), ''),
         notes         = case when v_note is null then notes else coalesce(notes || E'\n', '') || v_note end
   where id = p_id;
end $$;
grant execute on function public.register_boleto_issue(uuid, date, text, text, text, text) to authenticated;

create or replace function public.revert_boleto_issue(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
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
   where sp.id = p_id and s.company_id = v_company;
  if not found then raise exception 'Pagamento não encontrado'; end if;
  if v_status = 'pago' then raise exception 'Boleto já pago: desfaça a baixa antes'; end if;
  if v_issue is distinct from 'emitido' then raise exception 'Esse boleto não está emitido'; end if;

  update public.sale_payments
     set issue_status = 'a_emitir', issued_at = null, issued_by = null,
         boleto_line = null, boleto_bank = null, boleto_number = null, sent_at = null
   where id = p_id;
end $$;
grant execute on function public.revert_boleto_issue(uuid) to authenticated;

create or replace function public.mark_boleto_sent(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_company uuid := public.current_company_id();
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  update public.sale_payments sp
     set sent_at = now()
    from public.sales s
   where sp.id = p_id and s.id = sp.sale_id and s.company_id = v_company
     and sp.issue_status = 'emitido';
  if not found then raise exception 'Boleto emitido não encontrado'; end if;
end $$;
grant execute on function public.mark_boleto_sent(uuid) to authenticated;

-- ───────── 5a. Visão geral com "a emitir" ─────────
drop function if exists public.receivables_overview();
create function public.receivables_overview()
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
  fees_month              numeric,
  to_issue_count          bigint,
  to_issue_total          numeric,
  to_issue_late_count     bigint
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
           sp.issue_status as iss,
           (sp.created_at at time zone 'America/Sao_Paulo')::date as created_day,
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
    coalesce(sum(fee)        filter (where st = 'pago' and paid_day >= v_month), 0),
    count(*)                 filter (where st in ('pendente','parcial') and iss = 'a_emitir'),
    coalesce(sum(amt)        filter (where st in ('pendente','parcial') and iss = 'a_emitir'), 0),
    count(*)                 filter (where st in ('pendente','parcial') and iss = 'a_emitir' and created_day < v_today)
  from base;
end $$;
grant execute on function public.receivables_overview() to authenticated;

-- ───────── 5b. Lista com emissão, anexos e contato do cliente ─────────
drop function if exists public.list_receivables(date, date);
create function public.list_receivables(p_paid_from date, p_paid_to date)
returns table (
  id                 uuid,
  sale_id            uuid,
  sale_number        bigint,
  customer_id        uuid,
  customer_name      text,
  customer_whatsapp  text,
  customer_remote_jid text,
  seller_name        text,
  method             text,
  status             text,
  amount             numeric,
  due_date           date,
  created_at         timestamptz,
  paid_at            timestamptz,
  received_amount    numeric,
  fee_amount         numeric,
  anticipated        boolean,
  cash_session_id    uuid,
  cash_session_open  boolean,
  paid_by_name       text,
  notes              text,
  issue_status       text,
  issued_at          timestamptz,
  issued_by_name     text,
  boleto_line        text,
  boleto_bank        text,
  boleto_number      text,
  sent_at            timestamptz,
  attachments_count  bigint
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
           c.id,
           coalesce(c.trade_name, c.name)::text,
           coalesce(c.whatsapp, c.phone)::text,
           c.remote_jid::text,
           seller.nome::text,
           sp.method::text,
           sp.status::text,
           sp.amount,
           sp.due_date,
           sp.created_at,
           sp.paid_at,
           coalesce(sp.received_amount, case when sp.status = 'pago' then sp.amount end),
           sp.fee_amount,
           sp.anticipated,
           sp.cash_session_id,
           (cs.status = 'aberto'),
           payer.nome::text,
           sp.notes,
           sp.issue_status,
           sp.issued_at,
           issuer.nome::text,
           sp.boleto_line,
           sp.boleto_bank,
           sp.boleto_number,
           sp.sent_at,
           (select count(*) from public.finance_attachments fa
             where fa.entity = 'sale_payment' and fa.entity_id = sp.id)
      from public.sale_payments sp
      join public.sales s            on s.id = sp.sale_id
      left join public.customers c   on c.id = s.customer_id
      left join public.profiles seller on seller.id = s.seller_id
      left join public.profiles payer  on payer.id = sp.paid_by
      left join public.profiles issuer on issuer.id = sp.issued_by
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

-- ───────── 6. Baixa recusa boleto não emitido ─────────
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

  if exists (select 1 from public.sale_payments sp
              where sp.id = any(v_ids) and sp.method = 'boleto' and sp.issue_status = 'a_emitir') then
    raise exception 'Tem boleto ainda não emitido na seleção. Registre a emissão antes de dar baixa no pagamento.';
  end if;

  if p_received_total is not null and p_received_total <= 0 then
    raise exception 'O valor recebido precisa ser maior que zero';
  end if;

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
