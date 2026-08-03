-- TikTok OAuth tables (multi-tenant: company_id + user_id)
-- Run this in Supabase SQL editor.

-- 1) Connections table (stores tokens + basic profile)
create table if not exists public.tiktok_connections (
  id uuid primary key default gen_random_uuid(),

  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  -- TikTok identifiers / profile
  open_id text,
  union_id text,
  display_name text,
  avatar_url text,

  -- OAuth tokens
  access_token text not null,
  refresh_token text,
  scope text,
  token_type text,

  -- Expiration
  expires_at timestamptz,
  obtained_at timestamptz not null default now(),

  raw_token_response jsonb,
  raw_user_response jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tiktok_connections_company_user_ux
  on public.tiktok_connections (company_id, user_id);

create unique index if not exists tiktok_connections_company_openid_ux
  on public.tiktok_connections (company_id, coalesce(open_id, ''));

-- 2) OAuth state table (short-lived; stores PKCE verifier)
create table if not exists public.tiktok_oauth_states (
  state text primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_verifier text not null,
  return_to text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists tiktok_oauth_states_expires_at_idx
  on public.tiktok_oauth_states (expires_at);

-- 3) updated_at helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tiktok_connections_updated_at on public.tiktok_connections;
create trigger trg_tiktok_connections_updated_at
before update on public.tiktok_connections
for each row execute function public.set_updated_at();

-- 4) RLS
alter table public.tiktok_connections enable row level security;
alter table public.tiktok_oauth_states enable row level security;

-- Connections: only the owner (user) can see/manage their own rows inside a company
drop policy if exists "tiktok_connections_select_own" on public.tiktok_connections;
create policy "tiktok_connections_select_own"
on public.tiktok_connections
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "tiktok_connections_insert_own" on public.tiktok_connections;
create policy "tiktok_connections_insert_own"
on public.tiktok_connections
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "tiktok_connections_update_own" on public.tiktok_connections;
create policy "tiktok_connections_update_own"
on public.tiktok_connections
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "tiktok_connections_delete_own" on public.tiktok_connections;
create policy "tiktok_connections_delete_own"
on public.tiktok_connections
for delete
to authenticated
using (user_id = auth.uid());

-- OAuth states: only owner can create/read their state rows (callback uses service role, bypassing RLS)
drop policy if exists "tiktok_oauth_states_select_own" on public.tiktok_oauth_states;
create policy "tiktok_oauth_states_select_own"
on public.tiktok_oauth_states
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "tiktok_oauth_states_insert_own" on public.tiktok_oauth_states;
create policy "tiktok_oauth_states_insert_own"
on public.tiktok_oauth_states
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "tiktok_oauth_states_delete_own" on public.tiktok_oauth_states;
create policy "tiktok_oauth_states_delete_own"
on public.tiktok_oauth_states
for delete
to authenticated
using (user_id = auth.uid());
