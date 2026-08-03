-- =====================================================================
-- OSManager — Clientes e Equipamentos
-- =====================================================================

-- ---------------------------------------------------------------------
-- CUSTOMERS (Clientes — PF/PJ)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.person_type as enum ('PF','PJ');
exception when duplicate_object then null; end $$;

create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  person_type  public.person_type not null default 'PJ',

  -- Identificação
  name         text not null,                 -- razão social ou nome
  trade_name   text,                           -- nome fantasia
  document     text,                           -- CPF ou CNPJ (sem máscara)
  state_reg    text,                           -- inscrição estadual
  muni_reg     text,                           -- inscrição municipal
  birthdate    date,

  -- Contato
  email        text,
  phone        text,
  whatsapp     text,                           -- número formatado E.164 (ex: 5511999999999)
  remote_jid   text,                           -- jid Evolution (ex: 5511999999999@s.whatsapp.net) — facilita abrir chat

  -- Endereço
  zipcode      text,
  street       text,
  number       text,
  complement   text,
  district     text,
  city         text,
  state        text,
  country      text default 'BR',

  -- Comercial
  notes        text,
  tags         text[] default '{}',
  source       text,                           -- ex: indicação, site, instagram
  active       boolean not null default true,
  blocked      boolean not null default false, -- bloqueio comercial (inadimplência etc)
  block_reason text,

  -- Vinculação ao funil/atendente (reaproveita)
  assigned_user_id uuid references public.profiles(id) on delete set null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, document)
);

create index if not exists customers_company_idx     on public.customers(company_id);
create index if not exists customers_remote_jid_idx  on public.customers(remote_jid);
create index if not exists customers_assigned_idx    on public.customers(assigned_user_id);
create index if not exists customers_search_idx
  on public.customers using gin (to_tsvector('portuguese',
    coalesce(name,'') || ' ' ||
    coalesce(trade_name,'') || ' ' ||
    coalesce(document,'') || ' ' ||
    coalesce(email,'') || ' ' ||
    coalesce(phone,'')
  ));

drop trigger if exists trg_customers_updated on public.customers;
create trigger trg_customers_updated
  before update on public.customers
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- CUSTOMER CONTACTS (contatos adicionais — comprador, financeiro, TI)
-- ---------------------------------------------------------------------
create table if not exists public.customer_contacts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  name         text not null,
  role_label   text,                  -- ex: Comprador, Financeiro, TI
  email        text,
  phone        text,
  whatsapp     text,
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists customer_contacts_customer_idx on public.customer_contacts(customer_id);

-- ---------------------------------------------------------------------
-- CUSTOMER EQUIPMENTS (frota do cliente — impressoras, PCs etc)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.equipment_status as enum ('ativo','manutencao','baixado','locacao');
exception when duplicate_object then null; end $$;

create table if not exists public.customer_equipments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,

  -- Identificação
  brand           text,                          -- HP, Epson, Canon, etc
  model           text,
  serial_number   text,
  asset_tag       text,                          -- patrimônio do cliente
  category        text,                          -- impressora, multifuncional, scanner, PC...

  -- Localização no cliente
  location        text,                          -- ex: "Filial Centro - Sala 2"

  -- Estado
  status          public.equipment_status not null default 'ativo',
  purchase_date   date,
  warranty_until  date,

  -- Locação / contrato
  is_rental       boolean not null default false,
  rental_value    numeric(12,2),
  rental_start    date,
  rental_end      date,
  contract_url    text,

  -- Contadores (impressoras)
  current_counter_bw     bigint,
  current_counter_color  bigint,
  last_counter_at        timestamptz,

  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists equip_customer_idx on public.customer_equipments(customer_id);
create index if not exists equip_company_idx  on public.customer_equipments(company_id);
create index if not exists equip_serial_idx   on public.customer_equipments(serial_number);

drop trigger if exists trg_equip_updated on public.customer_equipments;
create trigger trg_equip_updated
  before update on public.customer_equipments
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.customers          enable row level security;
alter table public.customer_contacts  enable row level security;
alter table public.customer_equipments enable row level security;

-- customers
drop policy if exists "customers_company_rw" on public.customers;
create policy "customers_company_rw" on public.customers for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

drop policy if exists "ccontacts_company_rw" on public.customer_contacts;
create policy "ccontacts_company_rw" on public.customer_contacts for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

drop policy if exists "equip_company_rw" on public.customer_equipments;
create policy "equip_company_rw" on public.customer_equipments for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
