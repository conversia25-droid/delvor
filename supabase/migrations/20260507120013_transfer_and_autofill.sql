-- =====================================================================
-- OSManager — Transferências de propriedade + auto-fill ao criar
--
-- 1) Triggers de auto-fill:
--    - service_orders.opened_by  ← auth.uid() ao inserir
--    - sales.seller_id           ← auth.uid() ao inserir (se não vier)
--
-- 2) RPCs SECURITY DEFINER:
--    - transfer_service_order(os_id, new_technician_id, reason)
--    - transfer_sale(sale_id, new_seller_id, reason)
--
--    Ambas validam que o usuário é o atual responsável (ou
--    admin/gerente) e gravam o evento na timeline / audit_log.
-- =====================================================================

-- ---------------------------------------------------------------------
-- AUTO-FILL: opened_by da OS
-- ---------------------------------------------------------------------
create or replace function public.tg_os_set_opened_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.opened_by is null then
    new.opened_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_os_set_opened_by on public.service_orders;
create trigger trg_os_set_opened_by
  before insert on public.service_orders
  for each row execute function public.tg_os_set_opened_by();

-- ---------------------------------------------------------------------
-- AUTO-FILL: seller_id da venda
-- ---------------------------------------------------------------------
create or replace function public.tg_sale_set_seller()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.seller_id is null then
    new.seller_id := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_sale_set_seller on public.sales;
create trigger trg_sale_set_seller
  before insert on public.sales
  for each row execute function public.tg_sale_set_seller();

-- ---------------------------------------------------------------------
-- RPC: transferir OS para outro técnico
-- ---------------------------------------------------------------------
create or replace function public.transfer_service_order(
  p_os_id           uuid,
  p_new_technician  uuid,
  p_reason          text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller       uuid := auth.uid();
  v_company      uuid;
  v_old_tech     uuid;
  v_old_name     text;
  v_new_name     text;
  v_can_transfer boolean;
begin
  if v_caller is null then
    raise exception 'Não autenticado';
  end if;

  select company_id, technician_id
    into v_company, v_old_tech
  from public.service_orders
  where id = p_os_id;

  if v_company is null then
    raise exception 'OS não encontrada';
  end if;

  -- Permissão: admin/gerente OU técnico atual OU quem abriu a OS
  v_can_transfer :=
    public.is_super_admin()
    or public.is_admin_or_manager()
    or v_caller = v_old_tech
    or v_caller = (select opened_by from public.service_orders where id = p_os_id);

  if not v_can_transfer then
    raise exception 'Sem permissão para transferir esta OS';
  end if;

  -- Novo técnico precisa estar na mesma empresa
  if not exists (
    select 1 from public.profiles p
    where p.id = p_new_technician and p.company_id = v_company
  ) then
    raise exception 'Técnico de destino não pertence à empresa';
  end if;

  -- Nomes para a mensagem
  select nome into v_old_name from public.profiles where id = v_old_tech;
  select nome into v_new_name from public.profiles where id = p_new_technician;

  update public.service_orders
     set technician_id = p_new_technician,
         updated_at    = now()
   where id = p_os_id;

  insert into public.service_order_history(
    service_order_id, user_id, message, is_public
  ) values (
    p_os_id,
    v_caller,
    format(
      'OS transferida de %s → %s%s',
      coalesce(v_old_name, 'Sem responsável'),
      coalesce(v_new_name, 'Sem responsável'),
      case when p_reason is not null and btrim(p_reason) <> '' then ' • Motivo: ' || p_reason else '' end
    ),
    false
  );
end $$;

grant execute on function public.transfer_service_order(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- RPC: transferir Venda para outro vendedor
-- ---------------------------------------------------------------------
create or replace function public.transfer_sale(
  p_sale_id    uuid,
  p_new_seller uuid,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller       uuid := auth.uid();
  v_company      uuid;
  v_old_seller   uuid;
  v_old_name     text;
  v_new_name     text;
  v_number       bigint;
  v_can_transfer boolean;
begin
  if v_caller is null then
    raise exception 'Não autenticado';
  end if;

  select company_id, seller_id, number
    into v_company, v_old_seller, v_number
  from public.sales
  where id = p_sale_id;

  if v_company is null then
    raise exception 'Venda não encontrada';
  end if;

  v_can_transfer :=
    public.is_super_admin()
    or public.is_admin_or_manager()
    or v_caller = v_old_seller;

  if not v_can_transfer then
    raise exception 'Sem permissão para transferir esta venda';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_new_seller and p.company_id = v_company
  ) then
    raise exception 'Vendedor de destino não pertence à empresa';
  end if;

  select nome into v_old_name from public.profiles where id = v_old_seller;
  select nome into v_new_name from public.profiles where id = p_new_seller;

  update public.sales
     set seller_id  = p_new_seller,
         updated_at = now()
   where id = p_sale_id;

  insert into public.audit_log(
    company_id, user_id, entity, entity_id, action, message, diff
  ) values (
    v_company,
    v_caller,
    'sales',
    p_sale_id,
    'transfer',
    format(
      'Venda #%s transferida de %s → %s%s',
      coalesce(v_number::text, '?'),
      coalesce(v_old_name, 'Sem responsável'),
      coalesce(v_new_name, 'Sem responsável'),
      case when p_reason is not null and btrim(p_reason) <> '' then ' • Motivo: ' || p_reason else '' end
    ),
    jsonb_build_object(
      'from_seller_id', v_old_seller,
      'to_seller_id',   p_new_seller,
      'reason',         p_reason
    )
  );
end $$;

grant execute on function public.transfer_sale(uuid, uuid, text) to authenticated;
