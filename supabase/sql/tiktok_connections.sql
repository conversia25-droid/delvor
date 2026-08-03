-- Table to store TikTok OAuth tokens per CRM user/company
-- WARNING: This stores access_token/refresh_token in plaintext.
-- If you prefer, encrypt at rest (pgcrypto) or encrypt in the server before writing.

create table if not exists public.tiktok_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid not null,

  open_id text,
  union_id text,
  display_name text,
  avatar_url text,

  scope text,
  token_type text,
  access_token text not null,
  refresh_token text not null,
  expires_in integer,
  refresh_expires_in integer,
  obtained_at timestamptz not null default now(),

  raw jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, company_id)
);

-- Auto-update updated_at
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
for each row
execute function public.set_updated_at();

-- Basic RLS: allow users to read their own connection for their company.
alter table public.tiktok_connections enable row level security;

drop policy if exists "tiktok_connections_select_own" on public.tiktok_connections;
create policy "tiktok_connections_select_own"
on public.tiktok_connections
for select
using (
  auth.uid() = user_id
);

-- No client-side insert/update by default (server uses service role).
