-- =====================================================================
-- OSManager — Schema Core (multi-tenant)
-- Rode este arquivo PRIMEIRO no SQL Editor do Supabase.
-- Cria: companies, profiles, user_roles, helpers de RLS, audit log.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- COMPANIES (tenant)
-- ---------------------------------------------------------------------
create table if not exists public.companies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  cnpj         text,
  phone        text,
  email        text,
  address      jsonb default '{}'::jsonb,
  logo_url     text,
  active       boolean not null default true,
  trial_ends_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- PROFILES (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  company_id   uuid references public.companies(id) on delete set null,
  nome         text,                              -- mantém campo "nome" usado em todo o código legado
  email        text,
  phone        text,
  avatar_url   text,
  theme        text default 'light',              -- 'light' | 'dark' | 'whatsapp'
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists profiles_company_idx on public.profiles(company_id);

-- ---------------------------------------------------------------------
-- USER ROLES (papel do usuário dentro da empresa)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('super_admin','admin','gerente','user','tecnico','vendedor');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.app_role not null,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, role, company_id)
);

create index if not exists user_roles_user_idx    on public.user_roles(user_id);
create index if not exists user_roles_company_idx on public.user_roles(company_id);

-- ---------------------------------------------------------------------
-- HELPERS DE RLS
-- ---------------------------------------------------------------------
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = _user_id and ur.role = _role
  );
$$;

create or replace function public.current_company_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_role(auth.uid(), 'super_admin'::public.app_role);
$$;

-- ---------------------------------------------------------------------
-- AUDIT LOG (genérico)
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigserial primary key,
  company_id  uuid,
  user_id     uuid,
  entity      text not null,        -- ex: service_orders, sales, products
  entity_id   uuid,
  action      text not null,        -- ex: create, update, status_change, delete
  diff        jsonb,
  message     text,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_company_idx on public.audit_log(company_id);
create index if not exists audit_log_entity_idx  on public.audit_log(entity, entity_id);

-- ---------------------------------------------------------------------
-- TRIGGER: updated_at
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_companies_updated on public.companies;
create trigger trg_companies_updated
  before update on public.companies
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- AUTO-CRIA profile quando user é criado em auth.users
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.companies   enable row level security;
alter table public.profiles    enable row level security;
alter table public.user_roles  enable row level security;
alter table public.audit_log   enable row level security;

-- companies: cada user vê só a sua. Super admin vê todas.
drop policy if exists "companies_select" on public.companies;
create policy "companies_select" on public.companies for select using (
  public.is_super_admin() or id = public.current_company_id()
);
drop policy if exists "companies_update" on public.companies;
create policy "companies_update" on public.companies for update using (
  public.is_super_admin() or (id = public.current_company_id() and public.has_role(auth.uid(),'admin'))
);
drop policy if exists "companies_insert_super" on public.companies;
create policy "companies_insert_super" on public.companies for insert with check (public.is_super_admin());

-- profiles: cada user vê o seu profile e os colegas da mesma empresa.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select using (
  public.is_super_admin() or id = auth.uid() or company_id = public.current_company_id()
);
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update using (id = auth.uid());
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles for update using (
  public.is_super_admin() or (company_id = public.current_company_id() and public.has_role(auth.uid(),'admin'))
);

-- user_roles
drop policy if exists "user_roles_select" on public.user_roles;
create policy "user_roles_select" on public.user_roles for select using (
  public.is_super_admin() or user_id = auth.uid() or company_id = public.current_company_id()
);
drop policy if exists "user_roles_admin_write" on public.user_roles;
create policy "user_roles_admin_write" on public.user_roles for all using (
  public.is_super_admin() or (company_id = public.current_company_id() and public.has_role(auth.uid(),'admin'))
) with check (
  public.is_super_admin() or (company_id = public.current_company_id() and public.has_role(auth.uid(),'admin'))
);

-- audit_log: só leitura por admin/gerente da própria company
drop policy if exists "audit_select" on public.audit_log;
create policy "audit_select" on public.audit_log for select using (
  public.is_super_admin() or (
    company_id = public.current_company_id() and (
      public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gerente')
    )
  )
);
drop policy if exists "audit_insert" on public.audit_log;
create policy "audit_insert" on public.audit_log for insert with check (
  company_id = public.current_company_id() or public.is_super_admin()
);
