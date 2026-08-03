create table if not exists public.tv_pairing_sessions (
  token text primary key,
  created_at timestamptz not null default now(),
  approved_at timestamptz null,
  consumed_at timestamptz null,
  access_token text null,
  refresh_token text null
);

alter table public.tv_pairing_sessions enable row level security;

-- leitura/inserção/atualização controladas pelo token temporário da TV.
drop policy if exists "tv_pairing_insert_anon" on public.tv_pairing_sessions;
create policy "tv_pairing_insert_anon"
on public.tv_pairing_sessions
for insert
to anon, authenticated
with check (
  token is not null
  and length(token) >= 16
  and access_token is null
  and refresh_token is null
);

drop policy if exists "tv_pairing_select_by_token" on public.tv_pairing_sessions;
create policy "tv_pairing_select_by_token"
on public.tv_pairing_sessions
for select
to anon, authenticated
using (
  token is not null
);

drop policy if exists "tv_pairing_update_by_token" on public.tv_pairing_sessions;
create policy "tv_pairing_update_by_token"
on public.tv_pairing_sessions
for update
to anon, authenticated
using (
  token is not null
)
with check (
  token is not null
);

create index if not exists idx_tv_pairing_sessions_created_at
on public.tv_pairing_sessions (created_at desc);
