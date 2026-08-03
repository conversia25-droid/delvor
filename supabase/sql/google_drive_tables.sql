-- Google Drive OAuth tables (multi-tenant: one connection per company)
-- Run this in Supabase SQL editor.

-- 1) Connections table (stores tokens + basic profile + root folder)
create table if not exists public.company_google_drive (
  id uuid primary key default gen_random_uuid(),

  company_id uuid not null references public.companies (id) on delete cascade,
  connected_by_user_id uuid references auth.users (id) on delete set null,

  -- Google profile
  google_email text,
  display_name text,
  avatar_url text,

  -- OAuth tokens
  access_token text not null,
  refresh_token text not null,
  scope text,
  token_type text,

  -- Expiration
  expires_at timestamptz,
  obtained_at timestamptz not null default now(),

  -- Drive-specific: root folder created automatically by app in user's Drive
  root_folder_id text,
  root_folder_name text default 'Infinity CRM',

  raw_token_response jsonb,
  raw_user_response jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists company_google_drive_company_ux
  on public.company_google_drive (company_id);

-- 2) OAuth state table (short-lived; stores PKCE verifier)
create table if not exists public.google_oauth_states (
  state text primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_verifier text not null,
  return_to text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists google_oauth_states_expires_at_idx
  on public.google_oauth_states (expires_at);

-- 3) updated_at trigger (reusing helper from tiktok_tables.sql)
drop trigger if exists trg_company_google_drive_updated_at on public.company_google_drive;
create trigger trg_company_google_drive_updated_at
before update on public.company_google_drive
for each row execute function public.set_updated_at();

-- 4) RLS
alter table public.company_google_drive enable row level security;
alter table public.google_oauth_states enable row level security;

-- Anyone in the company can SEE the connection status (to show "Connected as X" in UI)
drop policy if exists "company_google_drive_select_same_company" on public.company_google_drive;
create policy "company_google_drive_select_same_company"
on public.company_google_drive
for select
to authenticated
using (
  company_id in (
    select company_id from public.profiles where id = auth.uid()
  )
);

-- Only admins can connect/disconnect (insert/update/delete)
drop policy if exists "company_google_drive_manage_admin" on public.company_google_drive;
create policy "company_google_drive_manage_admin"
on public.company_google_drive
for all
to authenticated
using (
  company_id in (
    select company_id from public.profiles where id = auth.uid()
  )
  and exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  )
)
with check (
  company_id in (
    select company_id from public.profiles where id = auth.uid()
  )
  and exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  )
);

-- OAuth states: only owner can read/insert/delete (callback uses service role, bypasses RLS)
drop policy if exists "google_oauth_states_select_own" on public.google_oauth_states;
create policy "google_oauth_states_select_own"
on public.google_oauth_states
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "google_oauth_states_insert_own" on public.google_oauth_states;
create policy "google_oauth_states_insert_own"
on public.google_oauth_states
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "google_oauth_states_delete_own" on public.google_oauth_states;
create policy "google_oauth_states_delete_own"
on public.google_oauth_states
for delete to authenticated
using (user_id = auth.uid());
