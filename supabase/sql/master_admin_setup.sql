-- Painel master compatível com a estrutura atual do projeto
-- Usa public.user_roles.role em texto, sem depender de app_role.

create extension if not exists pgcrypto;

create table if not exists public.system_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical', 'success')),
  display_type text not null default 'banner' check (display_type in ('banner', 'popup', 'both')),
  allow_hide_forever boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz null,
  active boolean not null default true,
  pinned boolean not null default false,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.system_announcements add column if not exists display_type text not null default 'banner';
alter table public.system_announcements add column if not exists allow_hide_forever boolean not null default true;

create table if not exists public.system_announcement_companies (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.system_announcements(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint system_announcement_companies_unique unique (announcement_id, company_id)
);

create table if not exists public.system_announcement_views (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.system_announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  dismissed_at timestamptz null,
  dont_show_again boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_announcement_views_unique unique (announcement_id, user_id)
);

create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid null references auth.users(id) on delete set null,
  subject text not null,
  status text not null default 'open' check (status in ('open', 'waiting_admin', 'waiting_company', 'resolved')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  last_message_at timestamptz null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  sender_user_id uuid null references auth.users(id) on delete set null,
  sender_type text not null check (sender_type in ('company_user', 'super_admin')),
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_system_announcements_active_dates on public.system_announcements (active, starts_at desc, ends_at);
create index if not exists idx_system_announcement_views_user on public.system_announcement_views (user_id, announcement_id);
create index if not exists idx_system_announcement_companies_company on public.system_announcement_companies (company_id, announcement_id);
create index if not exists idx_support_conversations_company on public.support_conversations (company_id, last_message_at desc);
create index if not exists idx_support_messages_conversation on public.support_messages (conversation_id, created_at asc);

alter table public.system_announcements enable row level security;
alter table public.system_announcement_companies enable row level security;
alter table public.system_announcement_views enable row level security;
alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists "authenticated_users_can_read_active_announcements" on public.system_announcements;
drop policy if exists "super_admin_can_insert_announcements" on public.system_announcements;
drop policy if exists "super_admin_can_update_announcements" on public.system_announcements;
drop policy if exists "super_admin_can_delete_announcements" on public.system_announcements;
drop policy if exists "users_can_read_own_announcement_views" on public.system_announcement_views;
drop policy if exists "users_can_upsert_own_announcement_views" on public.system_announcement_views;
drop policy if exists "users_can_update_own_announcement_views" on public.system_announcement_views;
drop policy if exists "super_admin_can_delete_announcement_views" on public.system_announcement_views;
drop policy if exists "users_can_read_relevant_announcement_companies" on public.system_announcement_companies;
drop policy if exists "super_admin_can_manage_announcement_companies" on public.system_announcement_companies;
drop policy if exists "users_can_read_support_conversations" on public.support_conversations;
drop policy if exists "company_users_can_insert_support_conversations" on public.support_conversations;
drop policy if exists "participants_can_update_support_conversations" on public.support_conversations;
drop policy if exists "users_can_read_support_messages" on public.support_messages;
drop policy if exists "participants_can_insert_support_messages" on public.support_messages;

create policy "authenticated_users_can_read_active_announcements"
on public.system_announcements
for select
to authenticated
using (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
);

create policy "super_admin_can_insert_announcements"
on public.system_announcements
for insert
to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
);

create policy "super_admin_can_update_announcements"
on public.system_announcements
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

create policy "super_admin_can_delete_announcements"
on public.system_announcements
for delete
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
);

create policy "users_can_read_relevant_announcement_companies"
on public.system_announcement_companies
for select
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = system_announcement_companies.company_id
  )
);

create policy "super_admin_can_manage_announcement_companies"
on public.system_announcement_companies
for all
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

create policy "users_can_read_own_announcement_views"
on public.system_announcement_views
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
);

create policy "users_can_upsert_own_announcement_views"
on public.system_announcement_views
for insert
to authenticated
with check (user_id = auth.uid());

create policy "users_can_update_own_announcement_views"
on public.system_announcement_views
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "super_admin_can_delete_announcement_views"
on public.system_announcement_views
for delete
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
);

create policy "users_can_read_support_conversations"
on public.support_conversations
for select
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = support_conversations.company_id
  )
);

create policy "company_users_can_insert_support_conversations"
on public.support_conversations
for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = support_conversations.company_id
  )
  or exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
);

create policy "participants_can_update_support_conversations"
on public.support_conversations
for update
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = support_conversations.company_id
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = support_conversations.company_id
  )
);

create policy "users_can_read_support_messages"
on public.support_messages
for select
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = support_messages.company_id
  )
);

create policy "participants_can_insert_support_messages"
on public.support_messages
for insert
to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = support_messages.company_id
  )
);

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_system_announcements_updated_at on public.system_announcements;
create trigger trg_system_announcements_updated_at
before update on public.system_announcements
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists trg_system_announcement_views_updated_at on public.system_announcement_views;
create trigger trg_system_announcement_views_updated_at
before update on public.system_announcement_views
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists trg_support_conversations_updated_at on public.support_conversations;
create trigger trg_support_conversations_updated_at
before update on public.support_conversations
for each row
execute function public.set_current_timestamp_updated_at();

create or replace function public.sync_support_conversation_last_message()
returns trigger
language plpgsql
as $$
begin
  update public.support_conversations
     set last_message_at = new.created_at,
         updated_at = now(),
         status = case when new.sender_type = 'super_admin' then 'waiting_company' else 'waiting_admin' end
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_support_messages_sync_conversation on public.support_messages;
create trigger trg_support_messages_sync_conversation
after insert on public.support_messages
for each row
execute function public.sync_support_conversation_last_message();

-- Promove um usuário existente para super admin
-- Troque o e-mail abaixo pelo seu e execute este trecho.
insert into public.user_roles (user_id, role)
select id, 'super_admin'
from auth.users
where email = 'SEU_EMAIL_AQUI'
on conflict (user_id)
do update set role = 'super_admin';
