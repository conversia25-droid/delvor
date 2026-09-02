-- =====================================================================
-- Recebíveis previstos (pra faixa "Previsão de caixa" do Dashboard)
--
-- Junta o que a empresa tem a receber num intervalo de datas:
--   - sale_payments pendentes/parciais (boleto, pix, crediário…) de vendas
--     não canceladas/perdidas/orçamento e não arquivadas
--   - rental_invoices pendentes/faturadas (locação)
--
-- SECURITY DEFINER porque o papel 'financeiro' não passa nas policies de
-- sales/sale_payments (só admin/gerente/vendedor dono). Gate: has_financial_access().
-- =====================================================================

create or replace function public.get_upcoming_receivables(p_from date, p_to date)
returns table (
  source        text,     -- 'sale' | 'rental'
  id            uuid,     -- id do pagamento / da fatura
  link_id       uuid,     -- id da venda / do contrato (pra abrir a tela)
  ref           text,     -- 'Venda #123' / 'Locação #45'
  customer_name text,
  amount        numeric,
  due_date      date,
  method        text,
  status        text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_id uuid := public.current_company_id();
begin
  if v_company_id is null or not public.has_financial_access() then
    raise exception 'Sem permissão para consultar recebíveis' using errcode = '42501';
  end if;

  return query
    select 'sale'::text,
           sp.id,
           s.id,
           ('Venda #' || s.number)::text,
           c.name,
           sp.amount,
           sp.due_date,
           sp.method::text,
           sp.status::text
      from public.sale_payments sp
      join public.sales s on s.id = sp.sale_id
      left join public.customers c on c.id = s.customer_id
     where s.company_id = v_company_id
       and s.hidden_at is null
       and s.status not in ('orcamento', 'cancelado', 'perdido')
       and sp.status in ('pendente', 'parcial')
       and sp.due_date is not null
       and sp.due_date between p_from and p_to
    union all
    select 'rental'::text,
           ri.id,
           rc.id,
           ('Locação #' || rc.number)::text,
           c.name,
           ri.total,
           ri.due_date,
           'locacao'::text,
           ri.status::text
      from public.rental_invoices ri
      join public.rental_contracts rc on rc.id = ri.contract_id
      left join public.customers c on c.id = rc.customer_id
     where ri.company_id = v_company_id
       and ri.status in ('pendente', 'faturada')
       and ri.due_date between p_from and p_to
    order by 7, 5;
end;
$$;

grant execute on function public.get_upcoming_receivables(date, date) to authenticated;
