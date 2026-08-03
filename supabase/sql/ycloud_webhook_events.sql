-- Log bruto de eventos do webhook YCloud (fase 2.1).
-- O n8n grava aqui TODOS os eventos recebidos para a gente inspecionar
-- o payload real e depois parsear para tabelas finais.

create table if not exists public.ycloud_webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  event_type text,
  event_id text,
  payload jsonb not null,
  processed_at timestamptz,
  process_error text
);

create index if not exists idx_ycloud_webhook_events_type
  on public.ycloud_webhook_events (event_type, received_at desc);

create index if not exists idx_ycloud_webhook_events_unprocessed
  on public.ycloud_webhook_events (processed_at) where processed_at is null;

alter table public.ycloud_webhook_events enable row level security;

-- Apenas super_admin pode ler via painel (n8n escreve com service_role, bypass RLS)
drop policy if exists "super_admin_can_read_ycloud_events" on public.ycloud_webhook_events;
create policy "super_admin_can_read_ycloud_events"
on public.ycloud_webhook_events for select to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
);

NOTIFY pgrst, 'reload schema';
