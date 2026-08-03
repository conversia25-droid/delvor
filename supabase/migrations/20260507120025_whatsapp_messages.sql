-- ============================================================
-- WhatsApp: histórico de mensagens (envio + recebimento) + mídia.
--
-- IMPORTANTE: a tabela `wpp_conversations` já existe (stub da
-- migration _10). Esta migration ESTENDE ela em vez de recriar,
-- pra preservar dados eventuais e não quebrar refs externas.
-- ============================================================

-- ───────── 1. Adições em wpp_instances ─────────
alter table public.wpp_instances
  add column if not exists phone_number bigint;

-- ───────── 2. Colunas novas em wpp_conversations ─────────
alter table public.wpp_conversations
  add column if not exists instance_id     text,
  add column if not exists message_id      text,
  add column if not exists media_url       text,
  add column if not exists sent_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists raw_payload     jsonb,
  add column if not exists status          text default 'sent';

-- ───────── 3. message_type: migra 'text' → 'conversation' e aplica CHECK ─────────
-- A _21 adicionou message_type com default 'text'. Padronizamos pro
-- vocabulário da Evolution (conversation/imageMessage/...).
update public.wpp_conversations
   set message_type = 'conversation'
 where message_type is null or message_type = 'text';

alter table public.wpp_conversations
  alter column message_type set default 'conversation';

alter table public.wpp_conversations
  drop constraint if exists wpp_conversations_message_type_check;
alter table public.wpp_conversations
  add constraint wpp_conversations_message_type_check
  check (message_type in (
    'conversation','extendedTextMessage',
    'imageMessage','audioMessage','videoMessage',
    'documentMessage','stickerMessage',
    'locationMessage','contactMessage',
    'reactionMessage','systemMessage'
  ));

-- ───────── 4. CHECK no status ─────────
alter table public.wpp_conversations
  drop constraint if exists wpp_conversations_status_check;
alter table public.wpp_conversations
  add constraint wpp_conversations_status_check
  check (status is null or status in ('queued','sent','delivered','read','failed'));

-- ───────── 5. Índices novos ─────────
create index if not exists wpp_conversations_jid_inst_idx
  on public.wpp_conversations (instance_id, remote_jid);
create index if not exists wpp_conversations_message_id_idx
  on public.wpp_conversations (message_id);
create index if not exists wpp_conversations_created_idx
  on public.wpp_conversations (created_at desc);

-- ───────── 6. Bucket de mídia (Storage) ─────────
insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', true)
on conflict (id) do update set public = true;

drop policy if exists wpp_media_select on storage.objects;
create policy wpp_media_select on storage.objects
  for select using (bucket_id = 'whatsapp-media');

drop policy if exists wpp_media_insert on storage.objects;
create policy wpp_media_insert on storage.objects
  for insert with check (
    bucket_id = 'whatsapp-media'
    and (auth.role() = 'authenticated' or auth.role() = 'service_role')
  );

drop policy if exists wpp_media_delete on storage.objects;
create policy wpp_media_delete on storage.objects
  for delete using (
    bucket_id = 'whatsapp-media'
    and (auth.role() = 'service_role' or auth.role() = 'authenticated')
  );

-- ───────── 7. Realtime ─────────
-- Idempotente: se já estiver na publication, ignora o erro
do $$
begin
  begin
    alter publication supabase_realtime add table public.wpp_conversations;
  exception
    when duplicate_object then null;
    when others then null;
  end;
end $$;
