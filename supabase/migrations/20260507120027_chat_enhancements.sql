-- ============================================================
-- Chat: campos extras pra quote, leitura e busca rápida.
-- (read_at já existe na _10 legacy — só adicionamos os que faltam.)
-- ============================================================

alter table public.wpp_conversations
  add column if not exists context_quoted_message_id text;

-- Pra busca textual rápida dentro de uma conversa
create index if not exists wpp_conversations_message_trgm_idx
  on public.wpp_conversations using gin (message gin_trgm_ops)
  where message is not null;
-- Esta extension geralmente já está habilitada no Supabase. Se não:
-- create extension if not exists pg_trgm;

-- Index pra "marcar como lida" rápido (vai filtrar por conv + read_at IS NULL)
create index if not exists wpp_conversations_unread_idx
  on public.wpp_conversations (company_id, instance_id, remote_jid)
  where from_me = false and read_at is null;
