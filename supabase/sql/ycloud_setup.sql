-- YCloud (WhatsApp Business API oficial) — configurações globais (master).
-- Apenas super_admin pode ler/escrever via RLS.
-- Rodar no SQL editor do Supabase.

create table if not exists public.ycloud_settings (
  id boolean primary key default true,
  api_key text,
  n8n_webhook_url text,
  shared_secret text,
  env text not null default 'production' check (env in ('sandbox', 'production')),
  updated_at timestamptz not null default now(),
  constraint ycloud_settings_singleton check (id = true)
);

-- Garante a linha singleton
insert into public.ycloud_settings (id) values (true)
on conflict (id) do nothing;

alter table public.ycloud_settings enable row level security;

drop policy if exists "super_admin_can_read_ycloud_settings" on public.ycloud_settings;
create policy "super_admin_can_read_ycloud_settings"
on public.ycloud_settings
for select
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
);

drop policy if exists "super_admin_can_update_ycloud_settings" on public.ycloud_settings;
create policy "super_admin_can_update_ycloud_settings"
on public.ycloud_settings
for update
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
);

drop trigger if exists trg_ycloud_settings_updated_at on public.ycloud_settings;
create trigger trg_ycloud_settings_updated_at
before update on public.ycloud_settings
for each row
execute function public.set_current_timestamp_updated_at();
