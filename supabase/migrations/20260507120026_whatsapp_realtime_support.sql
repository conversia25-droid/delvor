-- ============================================================
-- Suporte ao workflow de recebimento de WhatsApp (n8n realtime).
--
-- O workflow grava em `leads` quando recebe mensagem de um número
-- novo. Usa upsert por (company_id, remote_jid) — precisamos do
-- UNIQUE pra suportar `on_conflict`. Também grava `number_lead`,
-- que falta na stub legacy.
-- ============================================================

-- ───────── 1. Colunas faltantes em leads ─────────
alter table public.leads
  add column if not exists number_lead text;

-- ───────── 2. UNIQUE pra suportar upsert (company_id, remote_jid) ─────────
-- Antes de criar, limpa duplicatas (mantém só a mais antiga de cada par)
delete from public.leads l
 where l.id in (
   select id
     from (
       select id,
              row_number() over (partition by company_id, remote_jid order by created_at asc) as rn
         from public.leads
        where company_id is not null and remote_jid is not null
     ) sub
    where rn > 1
 );

create unique index if not exists leads_company_jid_uidx
  on public.leads (company_id, remote_jid)
  where company_id is not null and remote_jid is not null;
