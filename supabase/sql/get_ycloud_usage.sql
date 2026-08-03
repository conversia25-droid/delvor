-- Contador de uso YCloud por empresa em um período.
-- Usado pelo painel "Uso do mês" no dialog de WhatsApp Business API.
--
-- Retorna JSON com:
--   msgs_received       - mensagens recebidas (cliente → empresa)
--   msgs_sent           - mensagens enviadas (empresa → cliente)
--   templates_sent      - templates enviados (subset de msgs_sent)
--   unique_contacts     - quantos clientes diferentes interagiram
--   service_conversations - aproximação de conversas service (cliente iniciou)
--   service_quota_used_pct - percentual da cota grátis (1000/mês) usado
--
-- security invoker = respeita RLS de wpp_conversations (admin da empresa só vê a sua).

create or replace function public.get_ycloud_usage(
  p_company_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      remote_jid,
      from_me,
      message_type,
      created_at
    from public.wpp_conversations
    where company_id = p_company_id
      and provider = 'ycloud'
      and created_at >= p_from
      and created_at < p_to
  ),
  -- Conversation service ≈ um número que mandou mensagem pra empresa em um dia distinto
  -- (aproximação simples; o cálculo exato Meta é por janela de 24h, mas assim já dá noção)
  service_convs as (
    select count(distinct date_trunc('day', created_at) || '|' || remote_jid) as cnt
    from base
    where from_me = false
  )
  select json_build_object(
    'msgs_received', (select count(*) from base where from_me = false),
    'msgs_sent', (select count(*) from base where from_me = true),
    'templates_sent', (select count(*) from base where from_me = true and message_type = 'template'),
    'unique_contacts', (select count(distinct remote_jid) from base),
    'service_conversations', (select cnt from service_convs),
    'service_quota_free', 1000,
    'service_quota_used_pct',
      case
        when (select cnt from service_convs) >= 1000 then 100
        else round(((select cnt from service_convs)::numeric / 1000.0) * 100, 1)
      end,
    'period_from', p_from,
    'period_to', p_to
  );
$$;

grant execute on function public.get_ycloud_usage(uuid, timestamptz, timestamptz) to authenticated;

NOTIFY pgrst, 'reload schema';
