-- =====================================================================
-- 67 — Despesa fixa "a partir de"
-- (depende da 62: usa _finance_month_closed e a porta delvor.finance_rpc)
--
-- Antes: uma fixa criada hoje com vencimento dia 5 já nascia com a conta
-- deste mês vencida (dia 5 já passou), e a tela mostrava a fixa em todos
-- os meses anteriores como atrasada.
--
-- Regra nova: a primeira conta é o primeiro vencimento NA DATA DE INÍCIO
-- OU DEPOIS dela (starts_on). Ex.: começa 10/11, vence dia 5 → primeira
-- conta 05/12; vence dia 20 → 20/11. ends_on idem pelo vencimento.
-- Fixa sem starts_on continua como antes (vale desde sempre).
--
-- Ao mudar início/fim de uma fixa, as contas EM ABERTO que caíram fora do
-- período somem (pagas nunca são tocadas; mês fechado também não).
-- =====================================================================

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
         d.due,
         case when fep.id is not null then 'paga' else 'aberta' end,
         case when fep.id is not null then (fep.paid_on::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo' end,
         case when fep.id is not null then fep.amount_cents / 100.0 end,
         'fixa', fe.id, v_m
    from public.fixed_expenses fe
    cross join lateral (
      select make_date(extract(year from v_m)::integer, extract(month from v_m)::integer, least(fe.due_day, v_last)) as due
    ) d
    left join public.fixed_expense_payments fep
           on fep.fixed_expense_id = fe.id and fep.month_ref = v_m
   where fe.company_id = p_company
     and fe.active
     and fe.amount_cents > 0
     and (fe.starts_on is null or d.due >= fe.starts_on or fep.id is not null)
     and (fe.ends_on is null or d.due <= fe.ends_on or fep.id is not null)
     and (v_m >= v_cur or fep.id is not null)
  on conflict (source_id, month_ref) where source = 'fixa' do nothing;
  get diagnostics v_n = row_count;
  perform set_config('delvor.finance_rpc', '', true);
  return v_n;
end $$;

-- Mudou o período da fixa: tira as contas em aberto que ficaram fora dele.
create or replace function public.tg_fixed_period_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.starts_on is not distinct from old.starts_on and new.ends_on is not distinct from old.ends_on then
    return new;
  end if;
  perform set_config('delvor.finance_rpc', '1', true);
  delete from public.payables p
   where p.source = 'fixa'
     and p.source_id = new.id
     and p.status = 'aberta'
     and ((new.starts_on is not null and p.due_date < new.starts_on)
       or (new.ends_on   is not null and p.due_date > new.ends_on))
     and not public._finance_month_closed(p.company_id, p.month_ref);
  perform set_config('delvor.finance_rpc', '', true);
  return new;
end $$;

drop trigger if exists trg_fixed_period_cleanup on public.fixed_expenses;
create trigger trg_fixed_period_cleanup
  after update of starts_on, ends_on on public.fixed_expenses
  for each row execute function public.tg_fixed_period_cleanup();
