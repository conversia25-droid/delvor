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
