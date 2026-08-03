-- =====================================================================
-- OSManager — Trigger: ao marcar compra como "recebida", adiciona ao estoque
--
-- Quando purchases.status muda PARA 'recebida' (e não estava antes),
-- cria um stock_movements tipo 'entrada' para cada purchase_items, com
-- unit_cost preservado pra histórico.
--
-- Também atualiza products.cost_price com o ÚLTIMO custo de compra
-- (decisão de produto: ajuda a manter o custo do estoque sempre atual).
-- =====================================================================

create or replace function public.tg_purchase_received_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  it record;
begin
  if new.status = 'recebida' and (old.status is distinct from 'recebida') then
    -- Se receive_date não foi preenchida, usa hoje
    if new.receive_date is null then
      new.receive_date := current_date;
    end if;

    for it in
      select product_id, qty, unit_cost
        from public.purchase_items
       where purchase_id = new.id
    loop
      -- Entrada de estoque
      insert into public.stock_movements(
        company_id, product_id, move_type, qty, unit_cost,
        ref_table, ref_id, reference,
        notes
      ) values (
        new.company_id, it.product_id, 'entrada', it.qty, it.unit_cost,
        'purchases', new.id, 'Compra #' || new.number,
        case when new.invoice_key is not null then 'NF: ' || new.invoice_key else null end
      );

      -- Atualiza o custo do produto pra refletir a última compra
      update public.products
         set cost_price = it.unit_cost,
             updated_at = now()
       where id = it.product_id;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists trg_purchase_received on public.purchases;
create trigger trg_purchase_received
  before update on public.purchases
  for each row execute function public.tg_purchase_received_inventory();

-- ---------------------------------------------------------------------
-- Trigger pra recalcular o total da compra automaticamente quando
-- itens forem adicionados/removidos/alterados.
-- ---------------------------------------------------------------------
create or replace function public.tg_purchase_recalc_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid;
  v_total numeric(14,2);
begin
  v_pid := coalesce(new.purchase_id, old.purchase_id);
  select coalesce(sum(qty * unit_cost), 0) into v_total
    from public.purchase_items where purchase_id = v_pid;
  update public.purchases set total = v_total, updated_at = now() where id = v_pid;
  return null;
end $$;

drop trigger if exists trg_purchase_items_recalc on public.purchase_items;
create trigger trg_purchase_items_recalc
  after insert or update or delete on public.purchase_items
  for each row execute function public.tg_purchase_recalc_total();
