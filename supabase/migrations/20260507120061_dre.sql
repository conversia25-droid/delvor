-- =====================================================================
-- DRE gerencial por mês (regime de competência simplificado)
--
--   receita   = vendas faturadas/entregues (mês da emissão)
--   cmv       = qtd vendida × custo ATUAL do produto (não há custo histórico)
--   comissao  = comissão das vendas do mês
--   taxa      = taxas de recebimento (antecipação de cartão, descontos) no mês da baixa
--   despesa   = por categoria: contas a pagar (mês do vencimento, valor pago se
--               já paga), despesas variáveis (mês do pagamento) e fixas pagas na
--               tela antiga em mês sem conta a pagar gerada (mês de referência)
--
-- O front monta: receita − cmv = lucro bruto; − comissões − taxas − despesas
-- = resultado. Depende da migration 60.
-- =====================================================================

create or replace function public.dre_monthly(p_from date, p_to date)
returns table (
  month  date,
  line   text,
  label  text,
  amount numeric
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_from    date := date_trunc('month', p_from)::date;
  v_to      date := (date_trunc('month', p_to) + interval '1 month - 1 day')::date;
  v_m       date;
begin
  if v_company is null or not public.has_financial_access() then
    raise exception 'Sem permissão para consultar o DRE' using errcode = '42501';
  end if;
  if v_to - v_from > 750 then
    raise exception 'Período muito longo (máximo de 24 meses)';
  end if;
  v_m := v_from;
  while v_m <= v_to loop
    perform public._generate_fixed_payables(v_company, v_m);
    v_m := (v_m + interval '1 month')::date;
  end loop;

  return query
  with vendas as (
    select s.id, date_trunc('month', s.issue_date)::date m, s.total, coalesce(s.commission_amount, 0) com
      from public.sales s
     where s.company_id = v_company and s.hidden_at is null
       and s.status in ('faturado', 'entregue')
       and s.issue_date between v_from and v_to
  )
  select v.m, 'receita'::text, 'Receita de vendas'::text, sum(v.total) from vendas v group by v.m
  union all
  select v.m, 'cmv'::text, 'Custo das mercadorias vendidas'::text,
         sum(si.qty * coalesce(pr.cost_price, 0))
    from vendas v
    join public.sale_items si on si.sale_id = v.id
    join public.products pr on pr.id = si.product_id
   group by v.m
  union all
  select v.m, 'comissao'::text, 'Comissões'::text, sum(v.com) from vendas v group by v.m having sum(v.com) <> 0
  union all
  select date_trunc('month', (sp.paid_at at time zone 'America/Sao_Paulo'))::date, 'taxa'::text,
         'Taxas de recebimento'::text, sum(sp.fee_amount)
    from public.sale_payments sp
    join public.sales s on s.id = sp.sale_id
   where s.company_id = v_company and sp.status = 'pago' and sp.fee_amount > 0
     and (sp.paid_at at time zone 'America/Sao_Paulo')::date between v_from and v_to
   group by 1
  union all
  select x.m, 'despesa'::text, coalesce(ec.name, 'Sem categoria')::text, sum(x.v)
    from (
      select date_trunc('month', p.due_date)::date m, p.category_id cat,
             case when p.status = 'paga' then coalesce(p.paid_amount, p.amount) else p.amount end v
        from public.payables p
       where p.company_id = v_company and p.status <> 'cancelada'
         and p.due_date between v_from and v_to
      union all
      select date_trunc('month', ve.paid_on)::date, ve.category_id, ve.amount_cents / 100.0
        from public.variable_expenses ve
       where ve.company_id = v_company and ve.paid_on between v_from and v_to
      union all
      select fep.month_ref, fe.category_id, fep.amount_cents / 100.0
        from public.fixed_expense_payments fep
        join public.fixed_expenses fe on fe.id = fep.fixed_expense_id
       where fep.company_id = v_company and fep.month_ref between v_from and v_to
         and not exists (select 1 from public.payables p2
                          where p2.source = 'fixa' and p2.source_id = fep.fixed_expense_id
                            and p2.month_ref = fep.month_ref)
    ) x
    left join public.expense_categories ec on ec.id = x.cat
   group by x.m, coalesce(ec.name, 'Sem categoria')
   order by 1, 2, 3;
end $$;
grant execute on function public.dre_monthly(date, date) to authenticated;
