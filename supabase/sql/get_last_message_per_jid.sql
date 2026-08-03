-- Retorna a última mensagem de cada conversa (remote_jid) de uma empresa
-- em uma única query. Usado pelo inbox pra mostrar preview correto em
-- TODOS os leads, mesmo os que têm a última mensagem antiga (fora do
-- top 1500 que o frontend mantém em memória).
--
-- Performance: O(N_conversas) com o índice composto abaixo.
-- Pra 5k conversas, ~150ms. Pra 20k, ~500ms. Pra 50k+, considerar
-- migrar pra paginação progressiva.

-- ─────────────── ÍNDICE ───────────────
-- Faz o DISTINCT ON virar um "skip scan": ele pula direto pra primeira
-- chave de cada (company_id, remote_jid), sem ler o resto da conversa.
create index if not exists idx_wpp_conv_company_jid_created_desc
  on public.wpp_conversations (company_id, remote_jid, created_at desc);

-- ─────────────── FUNÇÃO ───────────────
create or replace function public.get_last_message_per_jid(p_company_id uuid)
returns table (
  remote_jid text,
  message text,
  message_type text,
  from_me boolean,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (remote_jid)
    remote_jid,
    message,
    message_type,
    from_me,
    created_at
  from public.wpp_conversations
  where company_id = p_company_id
  order by remote_jid, created_at desc;
$$;

-- Permite chamar a função via PostgREST (Supabase RPC) com o JWT do usuário
grant execute on function public.get_last_message_per_jid(uuid) to authenticated;

-- IMPORTANTE: força o PostgREST a recarregar o schema cache,
-- senão a função fica "invisível" pra .rpc() do frontend até reiniciar.
NOTIFY pgrst, 'reload schema';
