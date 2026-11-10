-- =====================================================================
-- 66 — Apagar venda
--
-- delete_sale(p_id): só admin/gerente (ou super admin).
--  • Bloqueia se algum pagamento já foi recebido (pago/parcial): primeiro
--    desfaz a baixa em Contas a receber, pra não sumir dinheiro do caixa.
--  • Bloqueia se o mês da venda estiver fechado (quando a migration 62
--    estiver aplicada).
--  • Se a venda já baixou estoque (faturada), devolve as quantidades com
--    um movimento de 'entrada' referenciando a venda.
--  • Apaga itens, pagamentos pendentes e a venda. OS/locação/matrícula
--    que apontavam pra ela ficam sem venda (on delete set null).
-- =====================================================================

create or replace function public.delete_sale(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale    public.sales%rowtype;
  v_closed  boolean := false;
  it        record;
begin
  select * into v_sale from public.sales where id = p_id for update;
  if not found then
    raise exception 'Venda não encontrada.';
  end if;

  if not (
    public.is_super_admin()
    or (v_sale.company_id = public.current_company_id() and public.is_admin_or_manager())
  ) then
    raise exception 'Só administrador ou gerente pode apagar venda.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.sale_payments
     where sale_id = p_id and status in ('pago', 'parcial')
  ) then
    raise exception 'Esta venda tem pagamento recebido. Desfaça a baixa em Contas a receber antes de apagar.';
  end if;

  -- Mês fechado (migration 62). Sem a 62, a checagem é pulada.
  if to_regprocedure('public._finance_month_closed(uuid,date)') is not null then
    execute 'select public._finance_month_closed($1, $2)' into v_closed using v_sale.company_id, v_sale.issue_date;
    if v_closed then
      raise exception 'O mês desta venda está fechado. Peça a um administrador para reabrir em Financeiro → Fechamento.';
    end if;
  end if;

  -- Devolve ao estoque o que a venda baixou (saldo líquido por produto).
  for it in
    select product_id,
           sum(case when move_type = 'baixa_venda' then qty when move_type = 'entrada' then -qty else 0 end) as qty
      from public.stock_movements
     where ref_table = 'sales' and ref_id = p_id
     group by product_id
  loop
    if it.qty > 0 then
      insert into public.stock_movements (company_id, product_id, move_type, qty, ref_table, ref_id, reference, user_id, notes)
      values (v_sale.company_id, it.product_id, 'entrada', it.qty, 'sales', p_id,
              'Venda #' || v_sale.number, auth.uid(), 'Estorno de estoque: venda apagada');
    end if;
  end loop;

  delete from public.sale_payments where sale_id = p_id;
  delete from public.sale_items where sale_id = p_id;
  delete from public.sales where id = p_id;
end $$;

grant execute on function public.delete_sale(uuid) to authenticated;
