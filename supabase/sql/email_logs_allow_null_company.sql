-- Migration: permite company_id null em email_logs.
-- Necessário pra que usuários master (sem company_id no profile) possam
-- enviar emails de teste pela Edge Function send-email.

alter table public.email_logs
  alter column company_id drop not null;

-- Atualiza policy: super_admin (do user_roles ou role='master' no profile)
-- continua vendo tudo, inclusive logs orfaos (company_id null).
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
    where p.id = auth.uid()
      and (p.role = 'master' or p.role = 'super_admin' or p.role = 'admin')
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = email_logs.company_id
  )
);

NOTIFY pgrst, 'reload schema';
