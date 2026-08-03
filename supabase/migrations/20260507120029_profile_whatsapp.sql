-- ============================================================
-- WhatsApp do técnico/atendente — pra notificar atribuições de OS.
-- ============================================================

alter table public.profiles
  add column if not exists whatsapp text;

-- Toggle por empresa pra ligar/desligar a notificação
alter table public.companies
  add column if not exists notify_technician_new_os boolean not null default true;

comment on column public.profiles.whatsapp is
  'Número de WhatsApp do usuário (E.164 sem +, ex: 5511999999999). Usado pra notificações automáticas.';
comment on column public.companies.notify_technician_new_os is
  'Se true, ao criar/transferir OS, o técnico atribuído recebe notificação no WhatsApp dele.';
