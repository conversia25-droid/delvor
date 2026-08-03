-- ============================================================================
-- Acompanhamento de OS — link direto por TOKEN + itens do orçamento
-- ----------------------------------------------------------------------------
--  • service_orders.public_token  → UUID único e não adivinhável por OS
--  • o link de WhatsApp passa a usar ?t=<token> → abre a OS direto, sem CPF
--  • o payload público agora inclui os ITENS (peças/serviços) e os totais,
--    pro cliente ver o que será feito e o valor (caso "aguardando aprovação")
-- ============================================================================

-- ───────── 1. token público na OS ─────────
alter table public.service_orders
  add column if not exists public_token uuid not null default gen_random_uuid();

create unique index if not exists service_orders_public_token_idx
  on public.service_orders(public_token);

-- ───────── 2. helper interno: monta o JSON público de uma OS ─────────
-- NÃO é exposto ao anon (revoke abaixo) — só as funções de consulta o chamam.
create or replace function public._os_public_payload(p_os_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_os       record;
  v_items    jsonb;
  v_timeline jsonb;
begin
  select
    o.id, o.number, o.status, o.priority, o.reported_issue,
    o.created_at, o.scheduled_at, o.finished_at, o.delivered_at, o.warranty_until,
    o.parts_total, o.labor_total, o.discount, o.total,
    co.name as company_name, c.name as customer_name,
    e.brand, e.model, e.category
  into v_os
  from public.service_orders o
  join public.customers  c  on c.id  = o.customer_id
  join public.companies  co on co.id = o.company_id
  left join public.customer_equipments e on e.id = o.equipment_id
  where o.id = p_os_id
  limit 1;

  if v_os.id is null then
    return jsonb_build_object('found', false);
  end if;

  -- itens (peças + serviços) — o que será / foi feito
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', i.kind,
           'description', i.description,
           'qty', i.qty,
           'total', i.total
         ) order by i.position), '[]'::jsonb)
  into v_items
  from public.service_order_items i
  where i.service_order_id = p_os_id;

  -- linha do tempo: mudanças de status + mensagens marcadas como públicas
  select coalesce(jsonb_agg(t order by t.created_at), '[]'::jsonb)
  into v_timeline
  from (
    select h.to_status, h.created_at,
           case when h.is_public then h.message else null end as message
    from public.service_order_history h
    where h.service_order_id = p_os_id
      and (h.to_status is not null or h.is_public)
  ) t;

  return jsonb_build_object(
    'found', true,
    'os', jsonb_build_object(
      'number',             v_os.number,
      'status',             v_os.status,
      'priority',           v_os.priority,
      'reported_issue',     v_os.reported_issue,
      'created_at',         v_os.created_at,
      'scheduled_at',       v_os.scheduled_at,
      'finished_at',        v_os.finished_at,
      'delivered_at',       v_os.delivered_at,
      'warranty_until',     v_os.warranty_until,
      'parts_total',        v_os.parts_total,
      'labor_total',        v_os.labor_total,
      'discount',           v_os.discount,
      'total',              v_os.total,
      'company_name',       v_os.company_name,
      'customer_name',      v_os.customer_name,
      'equipment',          nullif(trim(coalesce(v_os.brand,'') || ' ' || coalesce(v_os.model,'')), ''),
      'equipment_category', v_os.category
    ),
    'items', v_items,
    'timeline', v_timeline
  );
end $$;

revoke execute on function public._os_public_payload(uuid) from public;

-- ───────── 3. consulta por TOKEN (link direto, sem CPF) ─────────
create or replace function public.track_service_order_by_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_os_id uuid;
begin
  if p_token is null then
    return jsonb_build_object('found', false);
  end if;
  select id into v_os_id from public.service_orders where public_token = p_token limit 1;
  if v_os_id is null then
    return jsonb_build_object('found', false);
  end if;
  return public._os_public_payload(v_os_id);
end $$;
grant execute on function public.track_service_order_by_token(uuid) to anon, authenticated;

-- ───────── 4. consulta por número + contato (fallback manual) ─────────
-- Recriada pra reaproveitar o helper (agora também devolve os itens).
create or replace function public.track_service_order(p_number bigint, p_contact text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits text;
  v_os_id  uuid;
begin
  v_digits := regexp_replace(coalesce(p_contact, ''), '\D', '', 'g');
  if p_number is null or length(v_digits) < 6 then
    return jsonb_build_object('found', false);
  end if;

  select o.id into v_os_id
  from public.service_orders o
  join public.customers c on c.id = o.customer_id
  where o.number = p_number
    and (
      regexp_replace(coalesce(c.phone,''),    '\D', '', 'g') like '%' || v_digits || '%'
      or regexp_replace(coalesce(c.whatsapp,''), '\D', '', 'g') like '%' || v_digits || '%'
      or regexp_replace(coalesce(c.document,''), '\D', '', 'g') = v_digits
    )
  limit 1;

  if v_os_id is null then
    return jsonb_build_object('found', false);
  end if;
  return public._os_public_payload(v_os_id);
end $$;
grant execute on function public.track_service_order(bigint, text) to anon, authenticated;
