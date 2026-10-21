-- =====================================================================
-- Recebido por dia (gráfico "Vendido × Recebido" do Dashboard)
--
-- Soma o que entrou (pagamentos PAGOS, valor líquido) por dia da baixa,
-- no fuso America/Sao_Paulo. Depende da migration 56 (received_amount).
-- Mesmo filtro das outras RPCs de recebíveis: empresa atual, venda não
-- arquivada e não orçamento/cancelada/perdida. Gate: has_financial_access().
-- =====================================================================

create or replace function public.received_daily(p_from date, p_to date)
returns table (
  day   date,
  total numeric
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
    select (sp.paid_at at time zone 'America/Sao_Paulo')::date as d,
           coalesce(sum(coalesce(sp.received_amount, sp.amount)), 0)
      from public.sale_payments sp
      join public.sales s on s.id = sp.sale_id
     where s.company_id = v_company
       and s.hidden_at is null
       and s.status not in ('orcamento', 'cancelado', 'perdido')
       and sp.status = 'pago'
       and (sp.paid_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
     group by 1
     order by 1;
end $$;
grant execute on function public.received_daily(date, date) to authenticated;
