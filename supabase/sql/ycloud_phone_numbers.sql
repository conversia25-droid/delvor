-- YCloud: cadastro dos numeros WhatsApp oficiais (WABA) por empresa
-- Cada empresa pode ter 1+ numeros oficiais cadastrados no YCloud.

create table if not exists public.ycloud_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,

  -- Identificadores YCloud / Meta
  waba_id text,                    -- WhatsApp Business Account ID
  phone_number_id text not null,   -- Phone Number ID no Graph API / YCloud
  display_phone text,              -- Numero formatado ex: +55 11 99999-9999
  verified_name text,              -- Nome verificado pela Meta

  -- Status
  active boolean not null default true,
  quality_rating text,             -- GREEN / YELLOW / RED (da Meta)

  -- Notas internas
  notes text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ycloud_phone_numbers_phoneid_unique unique (phone_number_id)
);

create index if not exists idx_ycloud_phone_numbers_company
  on public.ycloud_phone_numbers (company_id, active);

alter table public.ycloud_phone_numbers enable row level security;

-- Admin da empresa pode gerenciar (e super_admin ve tudo)
drop policy if exists "company_admin_can_manage_ycloud_phone_numbers"
  on public.ycloud_phone_numbers;
create policy "company_admin_can_manage_ycloud_phone_numbers"
on public.ycloud_phone_numbers
for all
to authenticated
using (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = ycloud_phone_numbers.company_id
  )
)
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'super_admin'
  )
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = ycloud_phone_numbers.company_id
  )
);

drop trigger if exists trg_ycloud_phone_numbers_updated_at
  on public.ycloud_phone_numbers;
create trigger trg_ycloud_phone_numbers_updated_at
before update on public.ycloud_phone_numbers
for each row execute function public.set_current_timestamp_updated_at();

-- ─────────────── PROVIDER em wpp_conversations ───────────────
-- 'evolution' (Lite) ou 'ycloud' (API oficial)
alter table public.wpp_conversations
  add column if not exists provider text not null default 'evolution'
  check (provider in ('evolution', 'ycloud'));

create index if not exists idx_wpp_conversations_provider
  on public.wpp_conversations (company_id, provider, created_at desc);

-- Link opcional para o numero oficial YCloud usado
alter table public.wpp_conversations
  add column if not exists ycloud_phone_number_id uuid
  references public.ycloud_phone_numbers (id) on delete set null;

NOTIFY pgrst, 'reload schema';
