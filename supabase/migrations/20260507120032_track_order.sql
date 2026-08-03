-- ============================================================================
-- Acompanhamento PÚBLICO de OS
-- ----------------------------------------------------------------------------
-- O cliente consulta o status da OS dele sem login, informando:
--   • número da OS  +  telefone OU CPF/CNPJ
-- A função é SECURITY DEFINER (ignora RLS) mas só devolve UMA OS, e somente
-- quando o contato confere — então não dá pra varrer dados de outras pessoas.
-- Campos internos (internal_notes, diagnóstico, custos, técnico) NÃO são expostos.
-- ============================================================================

create or replace function public.track_service_order(
  p_number  bigint,
  p_contact text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits   text;
  v_os       record;
  v_timeline jsonb;
begin
  v_digits := regexp_replace(coalesce(p_contact, ''), '\D', '', 'g');

  -- precisa do número e de um contato com pelo menos 6 dígitos
  if p_number is null or length(v_digits) < 6 then
    return jsonb_build_object('found', false);
  end if;

  select
    o.id, o.number, o.status, o.priority, o.reported_issue,
    o.created_at, o.scheduled_at, o.finished_at, o.delivered_at, o.warranty_until,
    co.name as company_name,
    c.name  as customer_name,
    e.brand, e.model, e.category
  into v_os
  from public.service_orders o
  join public.customers  c  on c.id  = o.customer_id
  join public.companies  co on co.id = o.company_id
  left join public.customer_equipments e on e.id = o.equipment_id
  where o.number = p_number
    and (
      regexp_replace(coalesce(c.phone,''),    '\D', '', 'g') like '%' || v_digits || '%'
      or regexp_replace(coalesce(c.whatsapp,''), '\D', '', 'g') like '%' || v_digits || '%'
      or regexp_replace(coalesce(c.document,''), '\D', '', 'g') = v_digits
    )
  limit 1;

  if v_os.id is null then
    return jsonb_build_object('found', false);
  end if;

  -- linha do tempo: mudanças de status (sempre) + mensagens marcadas como públicas
  select coalesce(jsonb_agg(t order by t.created_at), '[]'::jsonb)
  into v_timeline
  from (
    select
      h.to_status,
      h.created_at,
      case when h.is_public then h.message else null end as message
    from public.service_order_history h
    where h.service_order_id = v_os.id
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
      'company_name',       v_os.company_name,
      'customer_name',      v_os.customer_name,
      'equipment',          nullif(trim(coalesce(v_os.brand,'') || ' ' || coalesce(v_os.model,'')), ''),
      'equipment_category', v_os.category
    ),
    'timeline', v_timeline
  );
end $$;

-- pode ser chamada por visitante não logado (página pública)
grant execute on function public.track_service_order(bigint, text) to anon, authenticated;
