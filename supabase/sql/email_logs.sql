-- Audit trail de todos os emails enviados pelo CRM via Edge Function send-email.
-- Permite rastrear, reenviar manualmente, e debugar entregas.

create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  sent_by_user_id uuid references auth.users (id) on delete set null,

  -- Endereçamento
  from_email text not null,
  to_emails text[] not null,
  cc_emails text[],
  bcc_emails text[],
  subject text not null,

  -- Status
  status text not null default 'pending',
  error_message text,

  -- Metadados de contexto (de onde veio o disparo)
  context_type text,    -- ex: 'boleto', 'lembrete', 'manual', 'recovery'
  context_id uuid,      -- id do recurso relacionado (cobrança, lead, etc)

  sent_at timestamptz,
  created_at timestamptz not null default now(),

  constraint email_logs_status_check check (status in ('pending', 'sending', 'sent', 'failed'))
);

create index if not exists idx_email_logs_company
  on public.email_logs (company_id, created_at desc);

create index if not exists idx_email_logs_status_pending
  on public.email_logs (status, created_at desc) where status in ('pending', 'failed');

create index if not exists idx_email_logs_context
  on public.email_logs (context_type, context_id) where context_id is not null;

alter table public.email_logs enable row level security;

-- super_admin lê tudo; usuários da empresa veem só os da própria empresa
drop policy if exists "company_users_can_view_email_logs" on public.email_logs;
create policy "company_users_can_view_email_logs"
on public.email_logs
for select
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = email_logs.company_id
  )
);

-- INSERT/UPDATE são feitos pela Edge Function via service_role (bypass RLS),
-- não precisamos de policies de write pra usuários normais.

NOTIFY pgrst, 'reload schema';
