-- =====================================================================
-- OSManager — `delivered_at` também é setado ao virar "faturada"
--
-- Antes: trigger só setava delivered_at quando status virava 'entregue'.
--   Problema: a OS pode ir direto de 'concluida' → 'faturada' (via
--   "Converter em Venda" no editor), deixando delivered_at NULL.
--   Consequência: KPI "Concluídas no mês" não conta essas OS.
--
-- Agora: setamos delivered_at quando vira 'entregue' OU 'faturada'.
-- Também rodamos backfill para corrigir registros existentes.
-- =====================================================================

create or replace function public.tg_os_log_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.service_order_history(service_order_id, user_id, to_status, message)
    values (new.id, auth.uid(), new.status, 'OS criada');
  elsif (tg_op = 'UPDATE' and old.status is distinct from new.status) then
    insert into public.service_order_history(service_order_id, user_id, from_status, to_status, message)
    values (new.id, auth.uid(), old.status, new.status,
            'Status: ' || coalesce(old.status::text,'-') || ' → ' || new.status::text);

    -- 'concluida' marca o término técnico
    if new.status = 'concluida' then
      new.finished_at := coalesce(new.finished_at, now());

    -- 'entregue' OU 'faturada' marcam a entrega comercial ao cliente
    elsif new.status in ('entregue', 'faturada') then
      new.delivered_at := coalesce(new.delivered_at, now());
      if new.warranty_until is null and new.warranty_days is not null then
        new.warranty_until := (current_date + new.warranty_days);
      end if;
      -- Se a OS pulou 'concluida', ainda assim marca finished_at
      if new.finished_at is null then
        new.finished_at := now();
      end if;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Backfill — corrige OS já existentes em 'faturada' sem delivered_at
-- ---------------------------------------------------------------------
update public.service_orders
   set delivered_at = coalesce(delivered_at, finished_at, updated_at, created_at),
       finished_at  = coalesce(finished_at, updated_at, created_at)
 where status in ('entregue', 'faturada')
   and (delivered_at is null or finished_at is null);
