-- =====================================================================
-- OSManager / InfnityServices — Setup completo para Supabase Cloud
-- =====================================================================
-- Este arquivo agrega todas as migrations em ordem cronológica.
-- Idempotente — pode ser re-aplicado em base limpa ou existente.
-- =====================================================================

-- =====================================================================
-- [migration] 20260507120001_core.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” Schema Core (multi-tenant)
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
  nome         text,                              -- mantÃ©m campo "nome" usado em todo o cÃ³digo legado
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
-- USER ROLES (papel do usuÃ¡rio dentro da empresa)
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
-- AUDIT LOG (genÃ©rico)
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
-- AUTO-CRIA profile quando user Ã© criado em auth.users
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

-- companies: cada user vÃª sÃ³ a sua. Super admin vÃª todas.
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

-- profiles: cada user vÃª o seu profile e os colegas da mesma empresa.
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

-- audit_log: sÃ³ leitura por admin/gerente da prÃ³pria company
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


-- =====================================================================
-- [migration] 20260507120002_customers.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” Clientes e Equipamentos
-- =====================================================================

-- ---------------------------------------------------------------------
-- CUSTOMERS (Clientes â€” PF/PJ)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.person_type as enum ('PF','PJ');
exception when duplicate_object then null; end $$;

create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  person_type  public.person_type not null default 'PJ',

  -- IdentificaÃ§Ã£o
  name         text not null,                 -- razÃ£o social ou nome
  trade_name   text,                           -- nome fantasia
  document     text,                           -- CPF ou CNPJ (sem mÃ¡scara)
  state_reg    text,                           -- inscriÃ§Ã£o estadual
  muni_reg     text,                           -- inscriÃ§Ã£o municipal
  birthdate    date,

  -- Contato
  email        text,
  phone        text,
  whatsapp     text,                           -- nÃºmero formatado E.164 (ex: 5511999999999)
  remote_jid   text,                           -- jid Evolution (ex: 5511999999999@s.whatsapp.net) â€” facilita abrir chat

  -- EndereÃ§o
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
  source       text,                           -- ex: indicaÃ§Ã£o, site, instagram
  active       boolean not null default true,
  blocked      boolean not null default false, -- bloqueio comercial (inadimplÃªncia etc)
  block_reason text,

  -- VinculaÃ§Ã£o ao funil/atendente (reaproveita)
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
-- CUSTOMER CONTACTS (contatos adicionais â€” comprador, financeiro, TI)
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
-- CUSTOMER EQUIPMENTS (frota do cliente â€” impressoras, PCs etc)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.equipment_status as enum ('ativo','manutencao','baixado','locacao');
exception when duplicate_object then null; end $$;

create table if not exists public.customer_equipments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,

  -- IdentificaÃ§Ã£o
  brand           text,                          -- HP, Epson, Canon, etc
  model           text,
  serial_number   text,
  asset_tag       text,                          -- patrimÃ´nio do cliente
  category        text,                          -- impressora, multifuncional, scanner, PC...

  -- LocalizaÃ§Ã£o no cliente
  location        text,                          -- ex: "Filial Centro - Sala 2"

  -- Estado
  status          public.equipment_status not null default 'ativo',
  purchase_date   date,
  warranty_until  date,

  -- LocaÃ§Ã£o / contrato
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


-- =====================================================================
-- [migration] 20260507120003_inventory.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” CatÃ¡logo, Estoque, Fornecedores, Compras
-- =====================================================================

-- ---------------------------------------------------------------------
-- SUPPLIERS
-- ---------------------------------------------------------------------
create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  document    text,           -- CNPJ
  email       text,
  phone       text,
  contact_name text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, document)
);
create index if not exists suppliers_company_idx on public.suppliers(company_id);
drop trigger if exists trg_suppliers_updated on public.suppliers;
create trigger trg_suppliers_updated before update on public.suppliers
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- PRODUCT CATEGORIES (toner, cartucho, fusor, cabo, etc)
-- ---------------------------------------------------------------------
create table if not exists public.product_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  parent_id   uuid references public.product_categories(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (company_id, name)
);

-- ---------------------------------------------------------------------
-- PRODUCTS (impressoras, suprimentos, peÃ§as, perifÃ©ricos)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.product_type as enum ('equipamento','suprimento','peca','acessorio','servico_avulso');
exception when duplicate_object then null; end $$;

create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  category_id   uuid references public.product_categories(id) on delete set null,
  supplier_id   uuid references public.suppliers(id) on delete set null,

  sku           text,                          -- cÃ³digo interno
  barcode       text,                          -- EAN/UPC
  name          text not null,
  brand         text,
  model         text,
  type          public.product_type not null default 'suprimento',

  description   text,
  image_url     text,

  -- Comercial
  cost_price    numeric(12,2) default 0,
  sale_price    numeric(12,2) default 0,
  tax_ncm       text,                          -- NCM fiscal
  tax_cest      text,

  -- Estoque
  stock_qty     numeric(14,3) not null default 0,
  stock_min     numeric(14,3) default 0,
  stock_max     numeric(14,3),
  unit          text default 'UN',             -- UN, CX, M, KG

  -- Compatibilidade (impressoras â†’ suprimentos compatÃ­veis)
  compatibility text[],                        -- ex: {'HP M428','HP M404'}

  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, sku)
);

create index if not exists products_company_idx  on public.products(company_id);
create index if not exists products_category_idx on public.products(category_id);
create index if not exists products_type_idx     on public.products(type);
create index if not exists products_search_idx
  on public.products using gin (to_tsvector('portuguese',
    coalesce(name,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(model,'') || ' ' || coalesce(sku,'')
  ));

drop trigger if exists trg_products_updated on public.products;
create trigger trg_products_updated before update on public.products
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- SERVICES CATALOG (catÃ¡logo de serviÃ§os avulsos: limpeza, recarga, etc)
-- ---------------------------------------------------------------------
create table if not exists public.services_catalog (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  code          text,
  name          text not null,
  description   text,
  default_price numeric(12,2) default 0,
  default_duration_min integer,                 -- duraÃ§Ã£o mÃ©dia em minutos
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, code)
);
create index if not exists services_company_idx on public.services_catalog(company_id);
drop trigger if exists trg_services_updated on public.services_catalog;
create trigger trg_services_updated before update on public.services_catalog
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- STOCK MOVEMENTS
-- ---------------------------------------------------------------------
do $$ begin
  create type public.stock_move_type as enum ('entrada','saida','ajuste','transferencia','reserva','baixa_os','baixa_venda');
exception when duplicate_object then null; end $$;

create table if not exists public.stock_movements (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete restrict,
  move_type    public.stock_move_type not null,
  qty          numeric(14,3) not null,           -- positivo sempre, o move_type define direÃ§Ã£o
  unit_cost    numeric(12,2),
  reference    text,                              -- ex: "Compra #1234", "OS #5678"
  ref_table    text,                              -- ex: 'service_orders','sales','purchases'
  ref_id       uuid,
  user_id      uuid references public.profiles(id) on delete set null,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists stock_mov_product_idx on public.stock_movements(product_id);
create index if not exists stock_mov_company_idx on public.stock_movements(company_id);
create index if not exists stock_mov_ref_idx     on public.stock_movements(ref_table, ref_id);

-- ---------------------------------------------------------------------
-- TRIGGER: aplicar movimento de estoque automaticamente em products.stock_qty
-- ---------------------------------------------------------------------
create or replace function public.apply_stock_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  delta numeric(14,3);
begin
  delta := case new.move_type
    when 'entrada'        then  new.qty
    when 'ajuste'         then  new.qty
    when 'saida'          then -new.qty
    when 'baixa_os'       then -new.qty
    when 'baixa_venda'    then -new.qty
    when 'reserva'        then  0          -- reserva nÃ£o muda qty
    when 'transferencia'  then  0          -- multi-deposito (fase futura)
  end;

  if delta <> 0 then
    update public.products
       set stock_qty = stock_qty + delta,
           updated_at = now()
     where id = new.product_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_stock_apply on public.stock_movements;
create trigger trg_stock_apply
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- ---------------------------------------------------------------------
-- PURCHASES (compras de fornecedor)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.purchase_status as enum ('rascunho','pedido','recebida','cancelada');
exception when duplicate_object then null; end $$;

create table if not exists public.purchases (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  supplier_id   uuid references public.suppliers(id) on delete set null,
  number        bigserial,                        -- numeraÃ§Ã£o interna
  invoice_key   text,                              -- chave NF
  status        public.purchase_status not null default 'rascunho',
  issue_date    date,
  receive_date  date,
  total         numeric(14,2) default 0,
  notes         text,
  user_id       uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists purchases_company_idx on public.purchases(company_id);

drop trigger if exists trg_purchases_updated on public.purchases;
create trigger trg_purchases_updated before update on public.purchases
  for each row execute function public.tg_set_updated_at();

create table if not exists public.purchase_items (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references public.purchases(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete restrict,
  qty          numeric(14,3) not null,
  unit_cost    numeric(12,2) not null,
  total        numeric(14,2) generated always as (qty * unit_cost) stored
);
create index if not exists purchase_items_purchase_idx on public.purchase_items(purchase_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.suppliers          enable row level security;
alter table public.product_categories enable row level security;
alter table public.products           enable row level security;
alter table public.services_catalog   enable row level security;
alter table public.stock_movements    enable row level security;
alter table public.purchases          enable row level security;
alter table public.purchase_items     enable row level security;

drop policy if exists "suppliers_rw" on public.suppliers;
create policy "suppliers_rw" on public.suppliers for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

drop policy if exists "pcats_rw" on public.product_categories;
create policy "pcats_rw" on public.product_categories for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

drop policy if exists "products_rw" on public.products;
create policy "products_rw" on public.products for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

drop policy if exists "services_rw" on public.services_catalog;
create policy "services_rw" on public.services_catalog for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

drop policy if exists "stock_mov_rw" on public.stock_movements;
create policy "stock_mov_rw" on public.stock_movements for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

drop policy if exists "purchases_rw" on public.purchases;
create policy "purchases_rw" on public.purchases for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

drop policy if exists "purchase_items_rw" on public.purchase_items;
create policy "purchase_items_rw" on public.purchase_items for all
  using (public.is_super_admin() or exists (
    select 1 from public.purchases p
    where p.id = purchase_items.purchase_id and p.company_id = public.current_company_id()
  ))
  with check (exists (
    select 1 from public.purchases p
    where p.id = purchase_items.purchase_id and p.company_id = public.current_company_id()
  ));


-- =====================================================================
-- [migration] 20260507120004_sales.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” Vendas: OrÃ§amento â†’ Pedido â†’ Pagamento
-- =====================================================================

do $$ begin
  create type public.sale_status as enum
    ('orcamento','aprovado','faturado','entregue','cancelado','perdido');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum
    ('dinheiro','pix','boleto','cartao_credito','cartao_debito','transferencia','crediario','outro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('pendente','pago','parcial','cancelado','estornado');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- SALES (Vendas / OrÃ§amentos)
-- ---------------------------------------------------------------------
create table if not exists public.sales (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  number        bigserial,                       -- numeraÃ§Ã£o interna do orÃ§amento/pedido
  customer_id   uuid not null references public.customers(id) on delete restrict,
  seller_id     uuid references public.profiles(id) on delete set null,

  status        public.sale_status not null default 'orcamento',

  -- Datas
  issue_date    date not null default current_date,
  approved_at   timestamptz,
  delivery_date date,

  -- Totais (denormalizados para listagem rÃ¡pida)
  subtotal      numeric(14,2) not null default 0,
  discount      numeric(14,2) not null default 0,
  freight       numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,

  -- DocumentaÃ§Ã£o
  notes         text,
  internal_notes text,
  payment_terms text,                            -- texto livre, ex: "30/60/90"

  -- Origem
  source        text,                            -- ex: 'whatsapp','balcao','site'
  remote_jid    text,                            -- pra abrir chat WhatsApp do cliente direto da venda

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists sales_company_idx  on public.sales(company_id);
create index if not exists sales_customer_idx on public.sales(customer_id);
create index if not exists sales_status_idx   on public.sales(status);

drop trigger if exists trg_sales_updated on public.sales;
create trigger trg_sales_updated before update on public.sales
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- SALE ITEMS
-- ---------------------------------------------------------------------
create table if not exists public.sale_items (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references public.sales(id) on delete cascade,

  -- Pode referenciar produto OU serviÃ§o (um dos dois)
  product_id   uuid references public.products(id) on delete restrict,
  service_id   uuid references public.services_catalog(id) on delete restrict,

  description  text not null,                    -- snapshot do nome
  qty          numeric(14,3) not null default 1,
  unit_price   numeric(12,2) not null default 0,
  discount     numeric(12,2) not null default 0,
  total        numeric(14,2) generated always as (qty * unit_price - discount) stored,

  position     integer not null default 0,
  created_at   timestamptz not null default now(),

  check (product_id is not null or service_id is not null)
);
create index if not exists sale_items_sale_idx on public.sale_items(sale_id);

-- ---------------------------------------------------------------------
-- SALE PAYMENTS (parcelas)
-- ---------------------------------------------------------------------
create table if not exists public.sale_payments (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references public.sales(id) on delete cascade,
  method       public.payment_method not null,
  status       public.payment_status not null default 'pendente',
  amount       numeric(12,2) not null,
  due_date     date,
  paid_at      timestamptz,
  asaas_charge_id text,                          -- integraÃ§Ã£o Asaas (jÃ¡ existe edge function)
  receipt_url  text,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists sale_pay_sale_idx on public.sale_payments(sale_id);

-- ---------------------------------------------------------------------
-- TRIGGER: ao mudar venda para 'faturado', baixa estoque
-- ---------------------------------------------------------------------
create or replace function public.tg_sale_status_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  it record;
begin
  -- sÃ³ baixa quando muda PARA faturado pela primeira vez
  if new.status = 'faturado' and (old.status is distinct from 'faturado') then
    for it in select product_id, qty from public.sale_items where sale_id = new.id and product_id is not null
    loop
      insert into public.stock_movements (company_id, product_id, move_type, qty, ref_table, ref_id, reference, notes)
      values (new.company_id, it.product_id, 'baixa_venda', it.qty, 'sales', new.id,
              'Venda #' || new.number, 'Baixa automÃ¡tica por faturamento da venda');
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists trg_sale_inventory on public.sales;
create trigger trg_sale_inventory
  after update on public.sales
  for each row execute function public.tg_sale_status_inventory();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.sales          enable row level security;
alter table public.sale_items     enable row level security;
alter table public.sale_payments  enable row level security;

drop policy if exists "sales_rw" on public.sales;
create policy "sales_rw" on public.sales for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

drop policy if exists "sale_items_rw" on public.sale_items;
create policy "sale_items_rw" on public.sale_items for all
  using (public.is_super_admin() or exists (
    select 1 from public.sales s where s.id = sale_items.sale_id and s.company_id = public.current_company_id()
  ))
  with check (exists (
    select 1 from public.sales s where s.id = sale_items.sale_id and s.company_id = public.current_company_id()
  ));

drop policy if exists "sale_pay_rw" on public.sale_payments;
create policy "sale_pay_rw" on public.sale_payments for all
  using (public.is_super_admin() or exists (
    select 1 from public.sales s where s.id = sale_payments.sale_id and s.company_id = public.current_company_id()
  ))
  with check (exists (
    select 1 from public.sales s where s.id = sale_payments.sale_id and s.company_id = public.current_company_id()
  ));


-- =====================================================================
-- [migration] 20260507120005_service_orders.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” Ordens de ServiÃ§o (OS)
-- Workflow: aberta â†’ diagnostico â†’ aguardando_peca â†’ em_execucao â†’ concluida â†’ entregue â†’ faturada
-- =====================================================================

do $$ begin
  create type public.os_status as enum
    ('aberta','diagnostico','aguardando_aprovacao','aguardando_peca','em_execucao',
     'concluida','entregue','faturada','cancelada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.os_priority as enum ('baixa','normal','alta','urgente');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.os_origin as enum ('balcao','visita','remoto','whatsapp','telefone','email','outro');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- SERVICE_ORDERS
-- ---------------------------------------------------------------------
create table if not exists public.service_orders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  number          bigserial,                        -- nÃºmero humano (#12345)

  -- Quem
  customer_id     uuid not null references public.customers(id) on delete restrict,
  equipment_id    uuid references public.customer_equipments(id) on delete set null,
  technician_id   uuid references public.profiles(id) on delete set null,
  opened_by       uuid references public.profiles(id) on delete set null,

  -- O quÃª
  status          public.os_status   not null default 'aberta',
  priority        public.os_priority not null default 'normal',
  origin          public.os_origin   not null default 'balcao',

  -- DescriÃ§Ãµes
  reported_issue  text,                              -- defeito relatado pelo cliente
  diagnosis       text,                              -- laudo tÃ©cnico
  solution        text,                              -- o que foi feito
  internal_notes  text,                              -- nÃ£o aparece pro cliente

  -- Coleta / entrega
  pickup_required boolean not null default false,
  pickup_address  text,
  delivery_address text,
  scheduled_at    timestamptz,
  finished_at     timestamptz,
  delivered_at    timestamptz,

  -- Garantia (apÃ³s entrega)
  warranty_days   integer default 90,
  warranty_until  date,

  -- Totais (denormalizados)
  parts_total     numeric(14,2) not null default 0,
  labor_total     numeric(14,2) not null default 0,
  discount        numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,

  -- VÃ­nculos
  sale_id         uuid references public.sales(id) on delete set null,   -- se virar fatura
  remote_jid      text,                              -- pra abrir chat direto

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists os_company_idx     on public.service_orders(company_id);
create index if not exists os_customer_idx    on public.service_orders(customer_id);
create index if not exists os_technician_idx  on public.service_orders(technician_id);
create index if not exists os_status_idx      on public.service_orders(status);
create index if not exists os_equipment_idx   on public.service_orders(equipment_id);

drop trigger if exists trg_os_updated on public.service_orders;
create trigger trg_os_updated before update on public.service_orders
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- SERVICE_ORDER_ITEMS  (peÃ§as usadas + serviÃ§os executados)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.os_item_kind as enum ('peca','servico');
exception when duplicate_object then null; end $$;

create table if not exists public.service_order_items (
  id              uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  kind            public.os_item_kind not null,
  product_id      uuid references public.products(id) on delete restrict,
  service_id      uuid references public.services_catalog(id) on delete restrict,
  description     text not null,
  qty             numeric(14,3) not null default 1,
  unit_price      numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0,
  total           numeric(14,2) generated always as (qty * unit_price - discount) stored,
  consumed        boolean not null default false,    -- jÃ¡ deu baixa no estoque?
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  check (
    (kind = 'peca'    and product_id is not null) or
    (kind = 'servico' and service_id is not null)
  )
);
create index if not exists os_items_os_idx on public.service_order_items(service_order_id);

-- ---------------------------------------------------------------------
-- SERVICE_ORDER_HISTORY (linha do tempo da OS)
-- ---------------------------------------------------------------------
create table if not exists public.service_order_history (
  id              uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  user_id         uuid references public.profiles(id) on delete set null,
  from_status     public.os_status,
  to_status       public.os_status,
  message         text,
  is_public       boolean not null default false,    -- se Ã© mensagem que pode ser enviada ao cliente
  created_at      timestamptz not null default now()
);
create index if not exists os_history_os_idx on public.service_order_history(service_order_id);

-- ---------------------------------------------------------------------
-- SERVICE_ORDER_ATTACHMENTS (fotos, laudos, comprovantes, assinatura)
-- ---------------------------------------------------------------------
create table if not exists public.service_order_attachments (
  id              uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  file_name       text not null,
  file_url        text not null,
  mime_type       text,
  size_bytes      bigint,
  kind            text,                                  -- foto_entrada, laudo, assinatura, comprovante
  uploaded_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists os_attach_os_idx on public.service_order_attachments(service_order_id);

-- ---------------------------------------------------------------------
-- TRIGGER: registra mudanÃ§a de status no histÃ³rico
-- ---------------------------------------------------------------------
create or replace function public.tg_os_log_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.service_order_history(service_order_id, user_id, to_status, message)
    values (new.id, auth.uid(), new.status, 'OS criada');
  elsif (tg_op = 'UPDATE' and old.status is distinct from new.status) then
    insert into public.service_order_history(service_order_id, user_id, from_status, to_status, message)
    values (new.id, auth.uid(), old.status, new.status,
            'Status: ' || coalesce(old.status::text,'-') || ' â†’ ' || new.status::text);
    if new.status = 'entregue' then
      new.delivered_at := coalesce(new.delivered_at, now());
      if new.warranty_until is null and new.warranty_days is not null then
        new.warranty_until := (current_date + new.warranty_days);
      end if;
    elsif new.status = 'concluida' then
      new.finished_at := coalesce(new.finished_at, now());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_os_log_ins on public.service_orders;
create trigger trg_os_log_ins after insert on public.service_orders
  for each row execute function public.tg_os_log_status();

drop trigger if exists trg_os_log_upd on public.service_orders;
create trigger trg_os_log_upd before update on public.service_orders
  for each row execute function public.tg_os_log_status();

-- ---------------------------------------------------------------------
-- TRIGGER: ao consumir peÃ§a (consumed=true), gera saÃ­da de estoque
-- ---------------------------------------------------------------------
create or replace function public.tg_os_consume_part()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c_company uuid;
begin
  if new.kind = 'peca' and new.consumed = true and (old.consumed is null or old.consumed = false) then
    select company_id into c_company from public.service_orders where id = new.service_order_id;
    insert into public.stock_movements(company_id, product_id, move_type, qty, ref_table, ref_id, reference)
    values (c_company, new.product_id, 'baixa_os', new.qty, 'service_orders', new.service_order_id,
            'OS #' || (select number from public.service_orders where id = new.service_order_id));
  end if;
  return new;
end $$;

drop trigger if exists trg_os_consume_ins on public.service_order_items;
create trigger trg_os_consume_ins after insert on public.service_order_items
  for each row when (new.kind = 'peca' and new.consumed = true)
  execute function public.tg_os_consume_part();

drop trigger if exists trg_os_consume_upd on public.service_order_items;
create trigger trg_os_consume_upd after update of consumed on public.service_order_items
  for each row execute function public.tg_os_consume_part();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.service_orders             enable row level security;
alter table public.service_order_items        enable row level security;
alter table public.service_order_history      enable row level security;
alter table public.service_order_attachments  enable row level security;

drop policy if exists "os_rw" on public.service_orders;
create policy "os_rw" on public.service_orders for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

drop policy if exists "os_items_rw" on public.service_order_items;
create policy "os_items_rw" on public.service_order_items for all
  using (public.is_super_admin() or exists (
    select 1 from public.service_orders o
    where o.id = service_order_items.service_order_id and o.company_id = public.current_company_id()
  ))
  with check (exists (
    select 1 from public.service_orders o
    where o.id = service_order_items.service_order_id and o.company_id = public.current_company_id()
  ));

drop policy if exists "os_history_rw" on public.service_order_history;
create policy "os_history_rw" on public.service_order_history for all
  using (public.is_super_admin() or exists (
    select 1 from public.service_orders o
    where o.id = service_order_history.service_order_id and o.company_id = public.current_company_id()
  ))
  with check (exists (
    select 1 from public.service_orders o
    where o.id = service_order_history.service_order_id and o.company_id = public.current_company_id()
  ));

drop policy if exists "os_attach_rw" on public.service_order_attachments;
create policy "os_attach_rw" on public.service_order_attachments for all
  using (public.is_super_admin() or exists (
    select 1 from public.service_orders o
    where o.id = service_order_attachments.service_order_id and o.company_id = public.current_company_id()
  ))
  with check (exists (
    select 1 from public.service_orders o
    where o.id = service_order_attachments.service_order_id and o.company_id = public.current_company_id()
  ));


-- =====================================================================
-- [migration] 20260507120006_views.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” Views Ãºteis e seed inicial
-- =====================================================================

-- View: estoque baixo
create or replace view public.v_low_stock as
  select p.*, p.stock_min - p.stock_qty as deficit
    from public.products p
   where p.active = true
     and p.stock_min is not null
     and p.stock_qty < p.stock_min;

-- View: KPIs do dashboard (por empresa)
create or replace view public.v_dashboard_kpis as
  select
    c.id as company_id,
    (select count(*) from public.customers x where x.company_id = c.id and x.active) as customers_active,
    (select count(*) from public.service_orders o
        where o.company_id = c.id
          and o.status not in ('entregue','faturada','cancelada')) as os_open,
    (select count(*) from public.service_orders o
        where o.company_id = c.id and o.status = 'aguardando_peca') as os_waiting_part,
    (select count(*) from public.products p where p.company_id = c.id and p.stock_qty < coalesce(p.stock_min,0)) as products_low_stock,
    (select coalesce(sum(s.total),0) from public.sales s
        where s.company_id = c.id
          and s.status in ('faturado','entregue')
          and s.issue_date >= date_trunc('month', current_date)) as revenue_month
  from public.companies c;

-- ---------------------------------------------------------------------
-- SEED de demonstraÃ§Ã£o â€” descomente para popular apÃ³s criar 1 empresa
-- ---------------------------------------------------------------------
/*
-- exemplo: depois de criar sua company, pegue o id e rode:
--   insert categorias e serviÃ§os padrÃ£o
do $seed$
declare cid uuid;
begin
  select id into cid from public.companies limit 1;
  if cid is null then
    raise notice 'Nenhuma company cadastrada. Crie uma antes.';
    return;
  end if;

  insert into public.product_categories(company_id, name) values
    (cid,'Toner'), (cid,'Cartucho'), (cid,'Cilindro/Fusor'),
    (cid,'Cabo'), (cid,'PerifÃ©rico'), (cid,'Impressora'), (cid,'Multifuncional')
  on conflict do nothing;

  insert into public.services_catalog(company_id, code, name, default_price, default_duration_min) values
    (cid,'LIMP', 'Limpeza geral de impressora',     120.00, 60),
    (cid,'RECG', 'Recarga de toner',                 80.00, 30),
    (cid,'INST', 'InstalaÃ§Ã£o de impressora em rede', 150.00, 60),
    (cid,'MANT', 'ManutenÃ§Ã£o preventiva',            200.00, 90),
    (cid,'LOC',  'LocaÃ§Ã£o mensal',                   150.00, 0)
  on conflict do nothing;
end
$seed$;
*/


-- =====================================================================
-- [migration] 20260507120007_signup_policies.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” Policies pra permitir o fluxo de signup pÃºblico
-- O signup (anon) precisa criar uma empresa antes de criar o user.
-- ApÃ³s o signup, profile + user_role 'admin' sÃ£o criados pelo client
-- e pelo trigger handle_new_user.
-- =====================================================================

-- Permite QUALQUER UM (anon) criar uma empresa nova durante o signup.
drop policy if exists "companies_signup_insert" on public.companies;
create policy "companies_signup_insert"
  on public.companies for insert
  to anon, authenticated
  with check (true);

-- Permite o user autenticado criar seu prÃ³prio user_role na company que
-- acabou de criar (ele serÃ¡ o admin dessa company).
drop policy if exists "user_roles_self_insert_after_signup" on public.user_roles;
create policy "user_roles_self_insert_after_signup"
  on public.user_roles for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (company_id is null or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.company_id = user_roles.company_id
    ))
  );

-- Para o profile.upsert do signup funcionar (handle_new_user jÃ¡ cria
-- o profile via trigger; o cliente sÃ³ precisa atualizar com company_id e
-- demais campos). A policy "profiles_update_self" jÃ¡ existe.


-- =====================================================================
-- [migration] 20260507120008_legacy_compat.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” Compatibilidade com componentes legados do CRM original
-- Cria stubs vazios das tabelas/views referenciadas por SubscriptionContext,
-- Sidebar e outros componentes herdados, evitando erros no console.
--
-- Quando os mÃ³dulos correspondentes forem refeitos para o OSManager,
-- estas estruturas podem ser ampliadas ou substituÃ­das.
-- =====================================================================

-- billing_plans: planos de assinatura (vazio por padrÃ£o)
create table if not exists public.billing_plans (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  price_cents   integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

insert into public.billing_plans (code, name, price_cents) values
  ('free',  'Free',  0),
  ('elite', 'Elite', 0)
on conflict (code) do nothing;

-- company_subscriptions: status de assinatura por empresa
create table if not exists public.company_subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null unique references public.companies(id) on delete cascade,
  plan_id               uuid references public.billing_plans(id) on delete set null,
  status                text not null default 'active',
  trial_ends_at         timestamptz,
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- View de billing summary (usada em Sidebar, MasterBilling etc.)
create or replace view public.v_company_billing_summary as
select
  c.id                              as company_id,
  c.name                            as company_name,
  bp.code                           as plan_code,
  bp.name                           as plan_name,
  cs.status                         as subscription_status,
  cs.trial_ends_at                  as trial_ends_at,
  null::text                        as latest_invoice_status,
  null::date                        as latest_invoice_due_date,
  coalesce(bp.price_cents, 0)       as monthly_amount_cents
from public.companies c
left join public.company_subscriptions cs on cs.company_id = c.id
left join public.billing_plans bp on bp.id = cs.plan_id;

-- RLS
alter table public.billing_plans          enable row level security;
alter table public.company_subscriptions  enable row level security;

drop policy if exists "billing_plans_read" on public.billing_plans;
create policy "billing_plans_read" on public.billing_plans for select to anon, authenticated using (true);

drop policy if exists "subs_company_rw" on public.company_subscriptions;
create policy "subs_company_rw" on public.company_subscriptions for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- ---------------------------------------------------------------------
-- Tabelas / views diversas usadas por componentes herdados que nÃ£o
-- pertencem ao escopo OSManager â€” criadas como vazias sÃ³ pra evitar
-- erros ao montar a UI.
-- ---------------------------------------------------------------------

create table if not exists public.affiliate_codes (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,
  current_uses integer not null default 0,
  max_uses     integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.affiliate_referrals (
  id                  uuid primary key default gen_random_uuid(),
  affiliate_code_id   uuid references public.affiliate_codes(id) on delete cascade,
  code                text,
  referred_company_id uuid references public.companies(id) on delete cascade,
  referred_email      text,
  created_at          timestamptz not null default now()
);

alter table public.affiliate_codes     enable row level security;
alter table public.affiliate_referrals enable row level security;

drop policy if exists "aff_codes_read" on public.affiliate_codes;
create policy "aff_codes_read" on public.affiliate_codes for select to anon, authenticated using (true);

drop policy if exists "aff_codes_super" on public.affiliate_codes;
create policy "aff_codes_super" on public.affiliate_codes for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "aff_ref_rw" on public.affiliate_referrals;
create policy "aff_ref_rw" on public.affiliate_referrals for all using (public.is_super_admin()) with check (true);


-- =====================================================================
-- [migration] 20260507120009_signup_rpc.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” RPC de signup
-- O cliente anon nÃ£o pode SELECT em companies (a policy sÃ³ libera quem
-- pertence Ã  company). Uma RPC SECURITY DEFINER cria a company e
-- devolve o id, permitindo o fluxo de cadastro funcionar.
-- =====================================================================

-- Remove a policy de INSERT anÃ´nimo que ficou inÃºtil.
drop policy if exists "companies_signup_insert" on public.companies;

create or replace function public.signup_create_company(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Nome da empresa Ã© obrigatÃ³rio';
  end if;

  insert into public.companies (name)
  values (btrim(p_name))
  returning id into v_id;

  return v_id;
end $$;

-- Permite chamar a RPC tanto antes do signup (anon) quanto depois (authenticated)
grant execute on function public.signup_create_company(text) to anon, authenticated;


-- =====================================================================
-- [migration] 20260507120010_legacy_stubs.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” Stubs adicionais de tabelas/colunas usadas por hooks
-- e contexts herdados do CRM original (App.tsx, OnboardingContext,
-- useClaudeAgent, NotificationToast).
--
-- Sem essas estruturas o app funciona, mas inunda o console de erros
-- 404/400 que confundem na hora de depurar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- companies: campos extras lidos pelo OnboardingContext e MasterBilling
-- ---------------------------------------------------------------------
alter table public.companies
  add column if not exists onboarding_completed boolean not null default true;

-- ---------------------------------------------------------------------
-- leads (App.tsx faz um SELECT pra montar mapa de remote_jid â†’ nome)
-- Esta Ã© a tabela do CRM antigo. Vai ficar vazia no OSManager.
-- ---------------------------------------------------------------------
create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies(id) on delete cascade,
  remote_jid   text,
  lead_code    text,
  lead_name    text,
  created_at   timestamptz not null default now()
);
create index if not exists leads_company_idx on public.leads(company_id);
create index if not exists leads_jid_idx     on public.leads(remote_jid);

alter table public.leads enable row level security;
drop policy if exists "leads_rw" on public.leads;
create policy "leads_rw" on public.leads for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- ---------------------------------------------------------------------
-- tasks (App.tsx faz polling pra alertas de tarefas vencidas/vencendo)
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id) on delete cascade,
  title         text not null,
  description   text,
  done          boolean not null default false,
  due_at        timestamptz,
  assigned_to   uuid references public.profiles(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists tasks_company_idx on public.tasks(company_id);
create index if not exists tasks_assigned_idx on public.tasks(assigned_to);
create index if not exists tasks_due_idx     on public.tasks(due_at);

drop trigger if exists trg_tasks_updated on public.tasks;
create trigger trg_tasks_updated before update on public.tasks
  for each row execute function public.tg_set_updated_at();

alter table public.tasks enable row level security;
drop policy if exists "tasks_rw" on public.tasks;
create policy "tasks_rw" on public.tasks for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- ---------------------------------------------------------------------
-- wpp_conversations (App.tsx + useClaudeAgent + Sidebar usam Realtime)
-- ---------------------------------------------------------------------
create table if not exists public.wpp_conversations (
  id                bigserial primary key,
  company_id        uuid references public.companies(id) on delete cascade,
  remote_jid        text,
  message           text,
  from_me           boolean not null default false,
  read_at           timestamptz,
  assigned_user_id  uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists wpp_conv_company_idx on public.wpp_conversations(company_id);
create index if not exists wpp_conv_jid_idx     on public.wpp_conversations(remote_jid);

alter table public.wpp_conversations enable row level security;
drop policy if exists "wpp_conv_rw" on public.wpp_conversations;
create policy "wpp_conv_rw" on public.wpp_conversations for all
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (company_id = public.current_company_id());


-- =====================================================================
-- [migration] 20260507120011_storage_policies.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” Policies de Storage
-- Permite que usuÃ¡rios autenticados faÃ§am upload/update/delete nos
-- buckets product-images e os-attachments. Leitura Ã© pÃºblica (buckets
-- foram criados como `public = true` no config.toml e seed.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- product-images
-- ---------------------------------------------------------------------
drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-images');

drop policy if exists "product_images_auth_insert" on storage.objects;
create policy "product_images_auth_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images');

drop policy if exists "product_images_auth_update" on storage.objects;
create policy "product_images_auth_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images');

drop policy if exists "product_images_auth_delete" on storage.objects;
create policy "product_images_auth_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images');

-- ---------------------------------------------------------------------
-- os-attachments
-- ---------------------------------------------------------------------
drop policy if exists "os_attach_public_read" on storage.objects;
create policy "os_attach_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'os-attachments');

drop policy if exists "os_attach_auth_insert" on storage.objects;
create policy "os_attach_auth_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'os-attachments');

drop policy if exists "os_attach_auth_update" on storage.objects;
create policy "os_attach_auth_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'os-attachments');

drop policy if exists "os_attach_auth_delete" on storage.objects;
create policy "os_attach_auth_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'os-attachments');


-- =====================================================================
-- [migration] 20260507120012_rbac_policies.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” RBAC: policies por papel
--
-- Regras:
--   admin / gerente / super_admin â†’ enxergam tudo da empresa
--   vendedor                       â†’ vÃª sÃ³ vendas com seller_id = ele
--                                    e OS abertas por ele (opened_by)
--   tecnico                        â†’ vÃª sÃ³ OS atribuÃ­das a ele
--                                    (technician_id) e itens / histÃ³rico
--                                    / anexos dessas OS
--                                    Sem acesso a vendas.
--
-- TransferÃªncias de propriedade sÃ£o feitas via RPCs (prÃ³xima migration)
-- que rodam SECURITY DEFINER, contornando RLS de forma controlada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------
create or replace function public.is_admin_or_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_super_admin()
      or public.has_role(auth.uid(), 'admin'::public.app_role)
      or public.has_role(auth.uid(), 'gerente'::public.app_role);
$$;

create or replace function public.has_any_role(_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = any (_roles)
  );
$$;

-- ---------------------------------------------------------------------
-- SERVICE_ORDERS
-- ---------------------------------------------------------------------
drop policy if exists "os_rw" on public.service_orders;

drop policy if exists "os_select" on public.service_orders;
create policy "os_select" on public.service_orders for select
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (
        public.is_admin_or_manager()
        or technician_id = auth.uid()
        or opened_by    = auth.uid()
      )
    )
  );

drop policy if exists "os_insert" on public.service_orders;
create policy "os_insert" on public.service_orders for insert
  with check (
    company_id = public.current_company_id()
  );

drop policy if exists "os_update" on public.service_orders;
create policy "os_update" on public.service_orders for update
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (
        public.is_admin_or_manager()
        or technician_id = auth.uid()
        or opened_by    = auth.uid()
      )
    )
  );

drop policy if exists "os_delete" on public.service_orders;
create policy "os_delete" on public.service_orders for delete
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and public.is_admin_or_manager()
    )
  );

-- ---------------------------------------------------------------------
-- SERVICE_ORDER_ITEMS
-- ---------------------------------------------------------------------
drop policy if exists "os_items_rw" on public.service_order_items;
drop policy if exists "os_items_all" on public.service_order_items;
create policy "os_items_all" on public.service_order_items for all
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.service_orders o
      where o.id = service_order_items.service_order_id
        and o.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or o.technician_id = auth.uid() or o.opened_by = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.service_orders o
      where o.id = service_order_items.service_order_id
        and o.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or o.technician_id = auth.uid() or o.opened_by = auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- SERVICE_ORDER_HISTORY
-- ---------------------------------------------------------------------
drop policy if exists "os_history_rw" on public.service_order_history;
drop policy if exists "os_history_all" on public.service_order_history;
create policy "os_history_all" on public.service_order_history for all
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.service_orders o
      where o.id = service_order_history.service_order_id
        and o.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or o.technician_id = auth.uid() or o.opened_by = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.service_orders o
      where o.id = service_order_history.service_order_id
        and o.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or o.technician_id = auth.uid() or o.opened_by = auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- SERVICE_ORDER_ATTACHMENTS
-- ---------------------------------------------------------------------
drop policy if exists "os_attach_rw" on public.service_order_attachments;
drop policy if exists "os_attach_all" on public.service_order_attachments;
create policy "os_attach_all" on public.service_order_attachments for all
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.service_orders o
      where o.id = service_order_attachments.service_order_id
        and o.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or o.technician_id = auth.uid() or o.opened_by = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.service_orders o
      where o.id = service_order_attachments.service_order_id
        and o.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or o.technician_id = auth.uid() or o.opened_by = auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- SALES (vendas) â€” vendedor vÃª sÃ³ as prÃ³prias
-- ---------------------------------------------------------------------
drop policy if exists "sales_rw" on public.sales;

drop policy if exists "sales_select" on public.sales;
create policy "sales_select" on public.sales for select
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (public.is_admin_or_manager() or seller_id = auth.uid())
    )
  );

drop policy if exists "sales_insert" on public.sales;
create policy "sales_insert" on public.sales for insert
  with check (
    company_id = public.current_company_id()
    and (
      public.is_admin_or_manager()
      or public.has_role(auth.uid(),'vendedor'::public.app_role)
      or public.has_role(auth.uid(),'user'::public.app_role)
    )
  );

drop policy if exists "sales_update" on public.sales;
create policy "sales_update" on public.sales for update
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (public.is_admin_or_manager() or seller_id = auth.uid())
    )
  );

drop policy if exists "sales_delete" on public.sales;
create policy "sales_delete" on public.sales for delete
  using (
    public.is_super_admin()
    or (company_id = public.current_company_id() and public.is_admin_or_manager())
  );

-- ---------------------------------------------------------------------
-- SALE_ITEMS / SALE_PAYMENTS
-- ---------------------------------------------------------------------
drop policy if exists "sale_items_rw" on public.sale_items;
drop policy if exists "sale_items_all" on public.sale_items;
create policy "sale_items_all" on public.sale_items for all
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.sales s
      where s.id = sale_items.sale_id
        and s.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or s.seller_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.sales s
      where s.id = sale_items.sale_id
        and s.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or s.seller_id = auth.uid())
    )
  );

drop policy if exists "sale_pay_rw" on public.sale_payments;
drop policy if exists "sale_pay_all" on public.sale_payments;
create policy "sale_pay_all" on public.sale_payments for all
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.sales s
      where s.id = sale_payments.sale_id
        and s.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or s.seller_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.sales s
      where s.id = sale_payments.sale_id
        and s.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or s.seller_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------
-- PRODUCTS / SUPPLIERS / PURCHASES â€” leitura para todos da empresa,
-- escrita sÃ³ admin/gerente.
-- ---------------------------------------------------------------------
drop policy if exists "products_rw" on public.products;
drop policy if exists "products_select" on public.products;
create policy "products_select" on public.products for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "products_write" on public.products;
create policy "products_write" on public.products for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());

drop policy if exists "suppliers_rw" on public.suppliers;
drop policy if exists "suppliers_select" on public.suppliers;
create policy "suppliers_select" on public.suppliers for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "suppliers_write" on public.suppliers;
create policy "suppliers_write" on public.suppliers for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());

drop policy if exists "purchases_rw" on public.purchases;
drop policy if exists "purchases_all" on public.purchases;
create policy "purchases_all" on public.purchases for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id() and public.is_admin_or_manager());

-- stock_movements: leitura toda empresa, escrita admin/gerente OU baixas automÃ¡ticas via OS/Venda (security definer triggers).
drop policy if exists "stock_mov_rw" on public.stock_movements;
drop policy if exists "stock_mov_select" on public.stock_movements;
create policy "stock_mov_select" on public.stock_movements for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "stock_mov_insert" on public.stock_movements;
create policy "stock_mov_insert" on public.stock_movements for insert
  with check (
    company_id = public.current_company_id()
    and (
      public.is_admin_or_manager()
      -- baixa automÃ¡tica referenciando OS/venda permitida pra qualquer um da empresa
      or ref_table in ('service_orders','sales')
    )
  );

-- categorias e catÃ¡logo de serviÃ§os: ler todos, escrever admin/gerente
drop policy if exists "pcats_rw" on public.product_categories;
drop policy if exists "pcats_select" on public.product_categories;
create policy "pcats_select" on public.product_categories for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "pcats_write" on public.product_categories;
create policy "pcats_write" on public.product_categories for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());

drop policy if exists "services_rw" on public.services_catalog;
drop policy if exists "services_select" on public.services_catalog;
create policy "services_select" on public.services_catalog for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "services_write" on public.services_catalog;
create policy "services_write" on public.services_catalog for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());


-- =====================================================================
-- [migration] 20260507120013_transfer_and_autofill.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” TransferÃªncias de propriedade + auto-fill ao criar
--
-- 1) Triggers de auto-fill:
--    - service_orders.opened_by  â† auth.uid() ao inserir
--    - sales.seller_id           â† auth.uid() ao inserir (se nÃ£o vier)
--
-- 2) RPCs SECURITY DEFINER:
--    - transfer_service_order(os_id, new_technician_id, reason)
--    - transfer_sale(sale_id, new_seller_id, reason)
--
--    Ambas validam que o usuÃ¡rio Ã© o atual responsÃ¡vel (ou
--    admin/gerente) e gravam o evento na timeline / audit_log.
-- =====================================================================

-- ---------------------------------------------------------------------
-- AUTO-FILL: opened_by da OS
-- ---------------------------------------------------------------------
create or replace function public.tg_os_set_opened_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.opened_by is null then
    new.opened_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_os_set_opened_by on public.service_orders;
create trigger trg_os_set_opened_by
  before insert on public.service_orders
  for each row execute function public.tg_os_set_opened_by();

-- ---------------------------------------------------------------------
-- AUTO-FILL: seller_id da venda
-- ---------------------------------------------------------------------
create or replace function public.tg_sale_set_seller()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.seller_id is null then
    new.seller_id := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_sale_set_seller on public.sales;
create trigger trg_sale_set_seller
  before insert on public.sales
  for each row execute function public.tg_sale_set_seller();

-- ---------------------------------------------------------------------
-- RPC: transferir OS para outro tÃ©cnico
-- ---------------------------------------------------------------------
create or replace function public.transfer_service_order(
  p_os_id           uuid,
  p_new_technician  uuid,
  p_reason          text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller       uuid := auth.uid();
  v_company      uuid;
  v_old_tech     uuid;
  v_old_name     text;
  v_new_name     text;
  v_can_transfer boolean;
begin
  if v_caller is null then
    raise exception 'NÃ£o autenticado';
  end if;

  select company_id, technician_id
    into v_company, v_old_tech
  from public.service_orders
  where id = p_os_id;

  if v_company is null then
    raise exception 'OS nÃ£o encontrada';
  end if;

  -- PermissÃ£o: admin/gerente OU tÃ©cnico atual OU quem abriu a OS
  v_can_transfer :=
    public.is_super_admin()
    or public.is_admin_or_manager()
    or v_caller = v_old_tech
    or v_caller = (select opened_by from public.service_orders where id = p_os_id);

  if not v_can_transfer then
    raise exception 'Sem permissÃ£o para transferir esta OS';
  end if;

  -- Novo tÃ©cnico precisa estar na mesma empresa
  if not exists (
    select 1 from public.profiles p
    where p.id = p_new_technician and p.company_id = v_company
  ) then
    raise exception 'TÃ©cnico de destino nÃ£o pertence Ã  empresa';
  end if;

  -- Nomes para a mensagem
  select nome into v_old_name from public.profiles where id = v_old_tech;
  select nome into v_new_name from public.profiles where id = p_new_technician;

  update public.service_orders
     set technician_id = p_new_technician,
         updated_at    = now()
   where id = p_os_id;

  insert into public.service_order_history(
    service_order_id, user_id, message, is_public
  ) values (
    p_os_id,
    v_caller,
    format(
      'OS transferida de %s â†’ %s%s',
      coalesce(v_old_name, 'Sem responsÃ¡vel'),
      coalesce(v_new_name, 'Sem responsÃ¡vel'),
      case when p_reason is not null and btrim(p_reason) <> '' then ' â€¢ Motivo: ' || p_reason else '' end
    ),
    false
  );
end $$;

grant execute on function public.transfer_service_order(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- RPC: transferir Venda para outro vendedor
-- ---------------------------------------------------------------------
create or replace function public.transfer_sale(
  p_sale_id    uuid,
  p_new_seller uuid,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller       uuid := auth.uid();
  v_company      uuid;
  v_old_seller   uuid;
  v_old_name     text;
  v_new_name     text;
  v_number       bigint;
  v_can_transfer boolean;
begin
  if v_caller is null then
    raise exception 'NÃ£o autenticado';
  end if;

  select company_id, seller_id, number
    into v_company, v_old_seller, v_number
  from public.sales
  where id = p_sale_id;

  if v_company is null then
    raise exception 'Venda nÃ£o encontrada';
  end if;

  v_can_transfer :=
    public.is_super_admin()
    or public.is_admin_or_manager()
    or v_caller = v_old_seller;

  if not v_can_transfer then
    raise exception 'Sem permissÃ£o para transferir esta venda';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_new_seller and p.company_id = v_company
  ) then
    raise exception 'Vendedor de destino nÃ£o pertence Ã  empresa';
  end if;

  select nome into v_old_name from public.profiles where id = v_old_seller;
  select nome into v_new_name from public.profiles where id = p_new_seller;

  update public.sales
     set seller_id  = p_new_seller,
         updated_at = now()
   where id = p_sale_id;

  insert into public.audit_log(
    company_id, user_id, entity, entity_id, action, message, diff
  ) values (
    v_company,
    v_caller,
    'sales',
    p_sale_id,
    'transfer',
    format(
      'Venda #%s transferida de %s â†’ %s%s',
      coalesce(v_number::text, '?'),
      coalesce(v_old_name, 'Sem responsÃ¡vel'),
      coalesce(v_new_name, 'Sem responsÃ¡vel'),
      case when p_reason is not null and btrim(p_reason) <> '' then ' â€¢ Motivo: ' || p_reason else '' end
    ),
    jsonb_build_object(
      'from_seller_id', v_old_seller,
      'to_seller_id',   p_new_seller,
      'reason',         p_reason
    )
  );
end $$;

grant execute on function public.transfer_sale(uuid, uuid, text) to authenticated;


-- =====================================================================
-- [migration] 20260507120014_os_delivered_on_faturada.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” `delivered_at` tambÃ©m Ã© setado ao virar "faturada"
--
-- Antes: trigger sÃ³ setava delivered_at quando status virava 'entregue'.
--   Problema: a OS pode ir direto de 'concluida' â†’ 'faturada' (via
--   "Converter em Venda" no editor), deixando delivered_at NULL.
--   ConsequÃªncia: KPI "ConcluÃ­das no mÃªs" nÃ£o conta essas OS.
--
-- Agora: setamos delivered_at quando vira 'entregue' OU 'faturada'.
-- TambÃ©m rodamos backfill para corrigir registros existentes.
-- =====================================================================

create or replace function public.tg_os_log_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.service_order_history(service_order_id, user_id, to_status, message)
    values (new.id, auth.uid(), new.status, 'OS criada');
  elsif (tg_op = 'UPDATE' and old.status is distinct from new.status) then
    insert into public.service_order_history(service_order_id, user_id, from_status, to_status, message)
    values (new.id, auth.uid(), old.status, new.status,
            'Status: ' || coalesce(old.status::text,'-') || ' â†’ ' || new.status::text);

    -- 'concluida' marca o tÃ©rmino tÃ©cnico
    if new.status = 'concluida' then
      new.finished_at := coalesce(new.finished_at, now());

    -- 'entregue' OU 'faturada' marcam a entrega comercial ao cliente
    elsif new.status in ('entregue', 'faturada') then
      new.delivered_at := coalesce(new.delivered_at, now());
      if new.warranty_until is null and new.warranty_days is not null then
        new.warranty_until := (current_date + new.warranty_days);
      end if;
      -- Se a OS pulou 'concluida', ainda assim marca finished_at
      if new.finished_at is null then
        new.finished_at := now();
      end if;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Backfill â€” corrige OS jÃ¡ existentes em 'faturada' sem delivered_at
-- ---------------------------------------------------------------------
update public.service_orders
   set delivered_at = coalesce(delivered_at, finished_at, updated_at, created_at),
       finished_at  = coalesce(finished_at, updated_at, created_at)
 where status in ('entregue', 'faturada')
   and (delivered_at is null or finished_at is null);


-- =====================================================================
-- [migration] 20260507120015_os_due_visit_split.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” SeparaÃ§Ã£o semÃ¢ntica de "agendamento" em duas datas
--
-- Antes: campo Ãºnico `scheduled_at` cumpria dois papÃ©is ambÃ­guos
--   (data prometida ao cliente vs. visita tÃ©cnica agendada).
--
-- Agora:
--   â€¢ due_at        â†’ PRAZO de entrega prometido ao cliente
--                     (Ã© o que dispara o KPI de OS em atraso)
--   â€¢ scheduled_at  â†’ VISITA agendada (tÃ©cnico vai ao cliente)
--                     Continua existindo, mas agora Ã© opcional e
--                     usado pela agenda do tÃ©cnico (prÃ³xima fase).
--
-- Backfill: como historicamente o filtro de atraso usava scheduled_at
-- como prazo, copiamos o valor para due_at.
-- =====================================================================

alter table public.service_orders
  add column if not exists due_at timestamptz;

create index if not exists os_due_idx on public.service_orders(due_at);

-- Backfill: assumimos que o scheduled_at existente era usado como prazo.
update public.service_orders
   set due_at = scheduled_at
 where due_at is null
   and scheduled_at is not null;

comment on column public.service_orders.due_at       is 'Prazo de entrega prometido ao cliente (deadline). Define se a OS estÃ¡ em atraso.';
comment on column public.service_orders.scheduled_at is 'Visita tÃ©cnica agendada (opcional). Aparece na agenda do tÃ©cnico.';


-- =====================================================================
-- [migration] 20260507120016_company_logos.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” Bucket e policies pra logos das empresas
-- (tambÃ©m usado nos PDFs de OS e venda)
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', true)
on conflict (id) do nothing;

drop policy if exists "company_logos_public_read" on storage.objects;
create policy "company_logos_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'company-logos');

drop policy if exists "company_logos_admin_write" on storage.objects;
create policy "company_logos_admin_write"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'company-logos')
  with check (bucket_id = 'company-logos');


-- =====================================================================
-- [migration] 20260507120017_purchase_received_inventory.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” Trigger: ao marcar compra como "recebida", adiciona ao estoque
--
-- Quando purchases.status muda PARA 'recebida' (e nÃ£o estava antes),
-- cria um stock_movements tipo 'entrada' para cada purchase_items, com
-- unit_cost preservado pra histÃ³rico.
--
-- TambÃ©m atualiza products.cost_price com o ÃšLTIMO custo de compra
-- (decisÃ£o de produto: ajuda a manter o custo do estoque sempre atual).
-- =====================================================================

create or replace function public.tg_purchase_received_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  it record;
begin
  if new.status = 'recebida' and (old.status is distinct from 'recebida') then
    -- Se receive_date nÃ£o foi preenchida, usa hoje
    if new.receive_date is null then
      new.receive_date := current_date;
    end if;

    for it in
      select product_id, qty, unit_cost
        from public.purchase_items
       where purchase_id = new.id
    loop
      -- Entrada de estoque
      insert into public.stock_movements(
        company_id, product_id, move_type, qty, unit_cost,
        ref_table, ref_id, reference,
        notes
      ) values (
        new.company_id, it.product_id, 'entrada', it.qty, it.unit_cost,
        'purchases', new.id, 'Compra #' || new.number,
        case when new.invoice_key is not null then 'NF: ' || new.invoice_key else null end
      );

      -- Atualiza o custo do produto pra refletir a Ãºltima compra
      update public.products
         set cost_price = it.unit_cost,
             updated_at = now()
       where id = it.product_id;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists trg_purchase_received on public.purchases;
create trigger trg_purchase_received
  before update on public.purchases
  for each row execute function public.tg_purchase_received_inventory();

-- ---------------------------------------------------------------------
-- Trigger pra recalcular o total da compra automaticamente quando
-- itens forem adicionados/removidos/alterados.
-- ---------------------------------------------------------------------
create or replace function public.tg_purchase_recalc_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid;
  v_total numeric(14,2);
begin
  v_pid := coalesce(new.purchase_id, old.purchase_id);
  select coalesce(sum(qty * unit_cost), 0) into v_total
    from public.purchase_items where purchase_id = v_pid;
  update public.purchases set total = v_total, updated_at = now() where id = v_pid;
  return null;
end $$;

drop trigger if exists trg_purchase_items_recalc on public.purchase_items;
create trigger trg_purchase_items_recalc
  after insert or update or delete on public.purchase_items
  for each row execute function public.tg_purchase_recalc_total();


-- =====================================================================
-- [migration] 20260507120018_rentals.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” LocaÃ§Ã£o de equipamentos
--
-- Modelo:
--   rental_contracts            cabeÃ§alho do contrato (cliente, datas, status, dia de vencimento)
--   rental_contract_items       N equipamentos no contrato, cada um com regras prÃ³prias
--                               (mensalidade + opcional franquia P&B/color e valor por excedente)
--   rental_meter_readings       leituras de contadores (impressoras), por item
--   rental_invoices             faturas mensais geradas, vinculadas opcionalmente a uma sale
--   rental_invoice_items        breakdown da fatura (mensalidade + excedentes por equipamento)
-- =====================================================================

do $$ begin
  create type public.rental_status as enum ('ativo','suspenso','encerrado','cancelado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.rental_invoice_status as enum ('pendente','faturada','paga','cancelada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meter_reading_source as enum ('visita','remoto','cliente_informou','tecnico');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- RENTAL_CONTRACTS
-- ---------------------------------------------------------------------
create table if not exists public.rental_contracts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  number          bigserial,
  customer_id     uuid not null references public.customers(id) on delete restrict,
  status          public.rental_status not null default 'ativo',
  start_date      date not null,
  end_date        date,                                  -- null = sem data fim (vigente indefinidamente)
  billing_day     integer not null default 1,            -- dia do mÃªs de vencimento (1â€“28)
  notes           text,
  contract_url    text,                                  -- pdf assinado, opcional
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (billing_day between 1 and 28)
);

create index if not exists rental_contracts_company_idx  on public.rental_contracts(company_id);
create index if not exists rental_contracts_customer_idx on public.rental_contracts(customer_id);
create index if not exists rental_contracts_status_idx   on public.rental_contracts(status);

drop trigger if exists trg_rental_contracts_updated on public.rental_contracts;
create trigger trg_rental_contracts_updated before update on public.rental_contracts
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- RENTAL_CONTRACT_ITEMS â€” equipamentos no contrato
-- ---------------------------------------------------------------------
create table if not exists public.rental_contract_items (
  id                          uuid primary key default gen_random_uuid(),
  contract_id                 uuid not null references public.rental_contracts(id) on delete cascade,
  equipment_id                uuid not null references public.customer_equipments(id) on delete restrict,

  -- Mensalidade fixa do equipamento
  monthly_value               numeric(12,2) not null default 0,

  -- Franquia + excedente â€” campos opcionais. Se franquia for null, NÃƒO cobra excedente.
  franchise_bw                integer,                   -- pÃ¡ginas P&B inclusas no mÃªs
  overage_bw_unit_price       numeric(10,4),             -- R$ por pÃ¡gina excedente P&B
  franchise_color             integer,                   -- pÃ¡ginas color inclusas
  overage_color_unit_price    numeric(10,4),             -- R$ por pÃ¡gina excedente color

  -- Contadores na hora da assinatura (baseline pra cobrar excedente)
  baseline_counter_bw         bigint default 0,
  baseline_counter_color      bigint default 0,

  notes                       text,
  created_at                  timestamptz not null default now()
);

create index if not exists rental_items_contract_idx on public.rental_contract_items(contract_id);
create index if not exists rental_items_equip_idx    on public.rental_contract_items(equipment_id);

-- ---------------------------------------------------------------------
-- RENTAL_METER_READINGS â€” leituras de contadores
-- ---------------------------------------------------------------------
create table if not exists public.rental_meter_readings (
  id                  uuid primary key default gen_random_uuid(),
  contract_item_id    uuid not null references public.rental_contract_items(id) on delete cascade,
  reading_date        date not null default current_date,
  counter_bw          bigint,
  counter_color       bigint,
  source              public.meter_reading_source not null default 'visita',
  user_id             uuid references public.profiles(id) on delete set null,
  notes               text,
  created_at          timestamptz not null default now()
);
create index if not exists rental_readings_item_idx on public.rental_meter_readings(contract_item_id);
create index if not exists rental_readings_date_idx on public.rental_meter_readings(reading_date);

-- Quando uma leitura Ã© registrada, atualiza os contadores no equipment
create or replace function public.tg_meter_update_equipment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_equip_id uuid;
begin
  select equipment_id into v_equip_id from public.rental_contract_items where id = new.contract_item_id;
  if v_equip_id is null then return new; end if;
  update public.customer_equipments
     set current_counter_bw    = coalesce(new.counter_bw, current_counter_bw),
         current_counter_color = coalesce(new.counter_color, current_counter_color),
         last_counter_at       = now(),
         updated_at            = now()
   where id = v_equip_id;
  return new;
end $$;

drop trigger if exists trg_meter_update_equip on public.rental_meter_readings;
create trigger trg_meter_update_equip
  after insert on public.rental_meter_readings
  for each row execute function public.tg_meter_update_equipment();

-- ---------------------------------------------------------------------
-- RENTAL_INVOICES â€” fatura mensal
-- ---------------------------------------------------------------------
create table if not exists public.rental_invoices (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  contract_id     uuid not null references public.rental_contracts(id) on delete cascade,
  number          bigserial,
  reference_month date not null,                          -- 1Âº dia do mÃªs de referÃªncia
  due_date        date not null,                          -- vencimento calculado
  base_total      numeric(14,2) not null default 0,       -- soma das mensalidades
  overage_total   numeric(14,2) not null default 0,       -- soma dos excedentes
  total           numeric(14,2) not null default 0,       -- base + excedente
  status          public.rental_invoice_status not null default 'pendente',
  sale_id         uuid references public.sales(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (contract_id, reference_month)                    -- uma fatura por contrato/mÃªs
);
create index if not exists rental_invoices_company_idx  on public.rental_invoices(company_id);
create index if not exists rental_invoices_contract_idx on public.rental_invoices(contract_id);
create index if not exists rental_invoices_status_idx   on public.rental_invoices(status);

drop trigger if exists trg_rental_invoices_updated on public.rental_invoices;
create trigger trg_rental_invoices_updated before update on public.rental_invoices
  for each row execute function public.tg_set_updated_at();

-- Itens da fatura: detalha mensalidade + excedentes por equipamento
create table if not exists public.rental_invoice_items (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid not null references public.rental_invoices(id) on delete cascade,
  contract_item_id    uuid references public.rental_contract_items(id) on delete set null,
  description         text not null,
  qty                 numeric(14,3) not null default 1,
  unit_price          numeric(12,4) not null default 0,
  total               numeric(14,2) generated always as (qty * unit_price) stored,
  kind                text not null default 'mensalidade'   -- 'mensalidade' | 'excedente_bw' | 'excedente_color' | 'outro'
);
create index if not exists rental_invoice_items_invoice_idx on public.rental_invoice_items(invoice_id);

-- ---------------------------------------------------------------------
-- RPC: gera fatura do mÃªs para um contrato
-- ---------------------------------------------------------------------
create or replace function public.generate_rental_invoice(
  p_contract_id    uuid,
  p_reference_month date     -- primeiro dia do mÃªs de referÃªncia (ex: 2026-05-01)
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company       uuid;
  v_billing_day   integer;
  v_due           date;
  v_invoice_id    uuid;
  v_base_total    numeric(14,2) := 0;
  v_over_total    numeric(14,2) := 0;
  v_existing      uuid;
  it              record;
  v_last_bw       bigint;
  v_last_color    bigint;
  v_used_bw       bigint;
  v_used_color    bigint;
  v_excess_bw     bigint;
  v_excess_color  bigint;
  v_over_bw_val   numeric(14,2);
  v_over_color_val numeric(14,2);
begin
  -- ValidaÃ§Ãµes iniciais
  select company_id, billing_day into v_company, v_billing_day
    from public.rental_contracts where id = p_contract_id;
  if v_company is null then
    raise exception 'Contrato nÃ£o encontrado';
  end if;

  -- JÃ¡ existe fatura para esse mÃªs?
  select id into v_existing
    from public.rental_invoices
   where contract_id = p_contract_id
     and reference_month = date_trunc('month', p_reference_month)::date;
  if v_existing is not null then
    raise exception 'JÃ¡ existe fatura desse contrato para esse mÃªs (id %)', v_existing;
  end if;

  -- Calcula vencimento: dia do contrato no mÃªs de referÃªncia
  v_due := (date_trunc('month', p_reference_month)::date + (v_billing_day - 1));

  -- Cria header da fatura
  insert into public.rental_invoices(
    company_id, contract_id, reference_month, due_date, status
  ) values (
    v_company, p_contract_id, date_trunc('month', p_reference_month)::date, v_due, 'pendente'
  )
  returning id into v_invoice_id;

  -- Para cada equipamento do contrato
  for it in
    select rci.id, rci.equipment_id, rci.monthly_value,
           rci.franchise_bw, rci.overage_bw_unit_price,
           rci.franchise_color, rci.overage_color_unit_price,
           rci.baseline_counter_bw, rci.baseline_counter_color,
           ce.brand, ce.model, ce.serial_number
      from public.rental_contract_items rci
      join public.customer_equipments ce on ce.id = rci.equipment_id
     where rci.contract_id = p_contract_id
  loop
    -- 1) Mensalidade fixa (sempre cobra)
    if it.monthly_value > 0 then
      insert into public.rental_invoice_items(
        invoice_id, contract_item_id, description, qty, unit_price, kind
      ) values (
        v_invoice_id, it.id,
        format('LocaÃ§Ã£o â€” %s %s%s',
               coalesce(it.brand, ''), coalesce(it.model, ''),
               case when it.serial_number is not null then ' (SN ' || it.serial_number || ')' else '' end),
        1, it.monthly_value, 'mensalidade'
      );
      v_base_total := v_base_total + it.monthly_value;
    end if;

    -- 2) Excedente P&B (se contrato tem franquia)
    if it.franchise_bw is not null and it.overage_bw_unit_price is not null then
      -- Pega Ãºltima leitura ANTES do fim do mÃªs de referÃªncia
      select counter_bw into v_last_bw
        from public.rental_meter_readings
       where contract_item_id = it.id
         and counter_bw is not null
         and reading_date < (date_trunc('month', p_reference_month) + interval '1 month')::date
       order by reading_date desc, created_at desc
       limit 1;

      if v_last_bw is not null then
        v_used_bw := greatest(0, v_last_bw - coalesce(it.baseline_counter_bw, 0));
        v_excess_bw := greatest(0, v_used_bw - it.franchise_bw);
        if v_excess_bw > 0 then
          v_over_bw_val := round(v_excess_bw * it.overage_bw_unit_price, 2);
          insert into public.rental_invoice_items(
            invoice_id, contract_item_id, description, qty, unit_price, kind
          ) values (
            v_invoice_id, it.id,
            format('Excedente P&B â€” %s %s', coalesce(it.brand,''), coalesce(it.model,'')),
            v_excess_bw, it.overage_bw_unit_price, 'excedente_bw'
          );
          v_over_total := v_over_total + v_over_bw_val;
        end if;
      end if;
    end if;

    -- 3) Excedente Color
    if it.franchise_color is not null and it.overage_color_unit_price is not null then
      select counter_color into v_last_color
        from public.rental_meter_readings
       where contract_item_id = it.id
         and counter_color is not null
         and reading_date < (date_trunc('month', p_reference_month) + interval '1 month')::date
       order by reading_date desc, created_at desc
       limit 1;

      if v_last_color is not null then
        v_used_color := greatest(0, v_last_color - coalesce(it.baseline_counter_color, 0));
        v_excess_color := greatest(0, v_used_color - it.franchise_color);
        if v_excess_color > 0 then
          v_over_color_val := round(v_excess_color * it.overage_color_unit_price, 2);
          insert into public.rental_invoice_items(
            invoice_id, contract_item_id, description, qty, unit_price, kind
          ) values (
            v_invoice_id, it.id,
            format('Excedente Color â€” %s %s', coalesce(it.brand,''), coalesce(it.model,'')),
            v_excess_color, it.overage_color_unit_price, 'excedente_color'
          );
          v_over_total := v_over_total + v_over_color_val;
        end if;
      end if;
    end if;
  end loop;

  -- Atualiza totais da fatura
  update public.rental_invoices
     set base_total    = v_base_total,
         overage_total = v_over_total,
         total         = v_base_total + v_over_total
   where id = v_invoice_id;

  return v_invoice_id;
end $$;

grant execute on function public.generate_rental_invoice(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.rental_contracts       enable row level security;
alter table public.rental_contract_items  enable row level security;
alter table public.rental_meter_readings  enable row level security;
alter table public.rental_invoices        enable row level security;
alter table public.rental_invoice_items   enable row level security;

-- contracts: admin/gerente edita; vendedor lÃª tudo da empresa
drop policy if exists "rental_contracts_select" on public.rental_contracts;
create policy "rental_contracts_select" on public.rental_contracts for select
  using (public.is_super_admin() or company_id = public.current_company_id());

drop policy if exists "rental_contracts_write" on public.rental_contracts;
create policy "rental_contracts_write" on public.rental_contracts for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());

-- itens, leituras, faturas: amarra ao contrato
drop policy if exists "rental_items_all" on public.rental_contract_items;
create policy "rental_items_all" on public.rental_contract_items for all
  using (public.is_super_admin() or exists (
    select 1 from public.rental_contracts c
    where c.id = rental_contract_items.contract_id and c.company_id = public.current_company_id()
  ))
  with check (exists (
    select 1 from public.rental_contracts c
    where c.id = rental_contract_items.contract_id and c.company_id = public.current_company_id()
  ));

-- Leituras: tÃ©cnicos podem inserir (atendimento em campo)
drop policy if exists "rental_readings_select" on public.rental_meter_readings;
create policy "rental_readings_select" on public.rental_meter_readings for select
  using (public.is_super_admin() or exists (
    select 1 from public.rental_contract_items rci
    join public.rental_contracts c on c.id = rci.contract_id
    where rci.id = rental_meter_readings.contract_item_id
      and c.company_id = public.current_company_id()
  ));

drop policy if exists "rental_readings_insert" on public.rental_meter_readings;
create policy "rental_readings_insert" on public.rental_meter_readings for insert
  with check (exists (
    select 1 from public.rental_contract_items rci
    join public.rental_contracts c on c.id = rci.contract_id
    where rci.id = rental_meter_readings.contract_item_id
      and c.company_id = public.current_company_id()
  ));

drop policy if exists "rental_readings_admin_write" on public.rental_meter_readings;
create policy "rental_readings_admin_write" on public.rental_meter_readings for all
  using (public.is_super_admin() or (public.is_admin_or_manager() and exists (
    select 1 from public.rental_contract_items rci
    join public.rental_contracts c on c.id = rci.contract_id
    where rci.id = rental_meter_readings.contract_item_id
      and c.company_id = public.current_company_id()
  )));

drop policy if exists "rental_invoices_all" on public.rental_invoices;
create policy "rental_invoices_all" on public.rental_invoices for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id());

drop policy if exists "rental_invoice_items_all" on public.rental_invoice_items;
create policy "rental_invoice_items_all" on public.rental_invoice_items for all
  using (public.is_super_admin() or exists (
    select 1 from public.rental_invoices ri
    where ri.id = rental_invoice_items.invoice_id and ri.company_id = public.current_company_id()
  ))
  with check (exists (
    select 1 from public.rental_invoices ri
    where ri.id = rental_invoice_items.invoice_id and ri.company_id = public.current_company_id()
  ));


-- =====================================================================
-- [migration] 20260507120019_rentals_rbac.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” RBAC de LocaÃ§Ãµes + Cliente Interno
--
-- MudanÃ§as:
--   â€¢ customers.is_internal â€” flag "ativo da prÃ³pria empresa"
--                              (nÃ£o Ã© cliente real, sÃ³ pra controle interno)
--   â€¢ rental_contracts.seller_id â€” quem fechou o contrato (auto via trigger)
--   â€¢ rental_contract_items.technician_id â€” tÃ©cnico responsÃ¡vel pelo equipamento
--
-- Regras:
--   admin/gerente   â†’ tudo
--   vendedor        â†’ sÃ³ seus prÃ³prios contratos (seller_id = ele)
--   tecnico         â†’ vÃª contratos que tenham AO MENOS UM equipamento atribuÃ­do a ele;
--                     edita sÃ³ os itens onde technician_id = ele;
--                     pode registrar leituras de contadores nos itens dele.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Coluna nova em customers
-- ---------------------------------------------------------------------
alter table public.customers
  add column if not exists is_internal boolean not null default false;

comment on column public.customers.is_internal is
  'Cliente "interno" â€” representa a prÃ³pria empresa para registrar equipamentos prÃ³prios e atribuiÃ§Ã£o a tÃ©cnicos. NÃ£o aparece no comercial.';

create index if not exists customers_is_internal_idx on public.customers(is_internal);

-- ---------------------------------------------------------------------
-- 2) Colunas novas em rental_contracts e rental_contract_items
-- ---------------------------------------------------------------------
alter table public.rental_contracts
  add column if not exists seller_id uuid references public.profiles(id) on delete set null;

create index if not exists rental_contracts_seller_idx on public.rental_contracts(seller_id);

alter table public.rental_contract_items
  add column if not exists technician_id uuid references public.profiles(id) on delete set null;

create index if not exists rental_items_tech_idx on public.rental_contract_items(technician_id);

-- ---------------------------------------------------------------------
-- 3) Trigger: auto-fill seller_id ao criar contrato
-- ---------------------------------------------------------------------
create or replace function public.tg_rental_set_seller()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.seller_id is null then
    new.seller_id := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_rental_set_seller on public.rental_contracts;
create trigger trg_rental_set_seller
  before insert on public.rental_contracts
  for each row execute function public.tg_rental_set_seller();

-- ---------------------------------------------------------------------
-- 4) RLS â€” substitui as policies antigas
-- ---------------------------------------------------------------------

-- ---- rental_contracts ----
drop policy if exists "rental_contracts_select" on public.rental_contracts;
create policy "rental_contracts_select" on public.rental_contracts for select
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (
        public.is_admin_or_manager()
        or seller_id = auth.uid()
        or exists (
          select 1 from public.rental_contract_items rci
          where rci.contract_id = rental_contracts.id
            and rci.technician_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "rental_contracts_write" on public.rental_contracts;

drop policy if exists "rental_contracts_insert" on public.rental_contracts;
create policy "rental_contracts_insert" on public.rental_contracts for insert
  with check (
    company_id = public.current_company_id()
    and (
      public.is_admin_or_manager()
      or public.has_role(auth.uid(),'vendedor'::public.app_role)
      or public.has_role(auth.uid(),'user'::public.app_role)
    )
  );

drop policy if exists "rental_contracts_update" on public.rental_contracts;
create policy "rental_contracts_update" on public.rental_contracts for update
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (public.is_admin_or_manager() or seller_id = auth.uid())
    )
  );

drop policy if exists "rental_contracts_delete" on public.rental_contracts;
create policy "rental_contracts_delete" on public.rental_contracts for delete
  using (
    public.is_super_admin()
    or (company_id = public.current_company_id() and public.is_admin_or_manager())
  );

-- ---- rental_contract_items ----
drop policy if exists "rental_items_all" on public.rental_contract_items;

drop policy if exists "rental_items_select" on public.rental_contract_items;
create policy "rental_items_select" on public.rental_contract_items for select
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.rental_contracts c
      where c.id = rental_contract_items.contract_id
        and c.company_id = public.current_company_id()
        and (
          public.is_admin_or_manager()
          or c.seller_id = auth.uid()
          or rental_contract_items.technician_id = auth.uid()
        )
    )
  );

drop policy if exists "rental_items_insert" on public.rental_contract_items;
create policy "rental_items_insert" on public.rental_contract_items for insert
  with check (
    exists (
      select 1 from public.rental_contracts c
      where c.id = rental_contract_items.contract_id
        and c.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or c.seller_id = auth.uid())
    )
  );

drop policy if exists "rental_items_update" on public.rental_contract_items;
create policy "rental_items_update" on public.rental_contract_items for update
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.rental_contracts c
      where c.id = rental_contract_items.contract_id
        and c.company_id = public.current_company_id()
        and (
          public.is_admin_or_manager()
          or c.seller_id = auth.uid()
          or rental_contract_items.technician_id = auth.uid()  -- tÃ©cnico pode atualizar campos do prÃ³prio item
        )
    )
  );

drop policy if exists "rental_items_delete" on public.rental_contract_items;
create policy "rental_items_delete" on public.rental_contract_items for delete
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.rental_contracts c
      where c.id = rental_contract_items.contract_id
        and c.company_id = public.current_company_id()
        and (public.is_admin_or_manager() or c.seller_id = auth.uid())
    )
  );

-- ---- rental_meter_readings: tÃ©cnico do item pode inserir/ler ----
drop policy if exists "rental_readings_select" on public.rental_meter_readings;
create policy "rental_readings_select" on public.rental_meter_readings for select
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.rental_contract_items rci
      join public.rental_contracts c on c.id = rci.contract_id
      where rci.id = rental_meter_readings.contract_item_id
        and c.company_id = public.current_company_id()
        and (
          public.is_admin_or_manager()
          or c.seller_id = auth.uid()
          or rci.technician_id = auth.uid()
        )
    )
  );

drop policy if exists "rental_readings_insert" on public.rental_meter_readings;
create policy "rental_readings_insert" on public.rental_meter_readings for insert
  with check (
    exists (
      select 1 from public.rental_contract_items rci
      join public.rental_contracts c on c.id = rci.contract_id
      where rci.id = rental_meter_readings.contract_item_id
        and c.company_id = public.current_company_id()
        and (
          public.is_admin_or_manager()
          or c.seller_id = auth.uid()
          or rci.technician_id = auth.uid()
        )
    )
  );

-- ---- rental_invoices: sÃ³ admin/gerente gerencia (vendedor lÃª as prÃ³prias) ----
drop policy if exists "rental_invoices_all" on public.rental_invoices;

drop policy if exists "rental_invoices_select" on public.rental_invoices;
create policy "rental_invoices_select" on public.rental_invoices for select
  using (
    public.is_super_admin()
    or (
      company_id = public.current_company_id()
      and (
        public.is_admin_or_manager()
        or exists (
          select 1 from public.rental_contracts c
          where c.id = rental_invoices.contract_id and c.seller_id = auth.uid()
        )
      )
    )
  );

drop policy if exists "rental_invoices_write" on public.rental_invoices;
create policy "rental_invoices_write" on public.rental_invoices for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (company_id = public.current_company_id() and public.is_admin_or_manager());

-- rental_invoice_items: idem invoice
drop policy if exists "rental_invoice_items_all" on public.rental_invoice_items;
create policy "rental_invoice_items_all" on public.rental_invoice_items for all
  using (public.is_super_admin() or exists (
    select 1 from public.rental_invoices ri
    where ri.id = rental_invoice_items.invoice_id
      and ri.company_id = public.current_company_id()
      and public.is_admin_or_manager()
  ))
  with check (exists (
    select 1 from public.rental_invoices ri
    where ri.id = rental_invoice_items.invoice_id
      and ri.company_id = public.current_company_id()
      and public.is_admin_or_manager()
  ));


-- =====================================================================
-- [migration] 20260507120020_rentals_rls_fix.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” Fix RLS recursivo entre rental_contracts e rental_contract_items
--
-- Problema: a policy SELECT de cada tabela consulta a outra (com
-- subquery EXISTS), criando ciclo. Postgres detecta e barra.
--
-- SoluÃ§Ã£o: helper SECURITY DEFINER que decide visibilidade em uma
-- chamada, ignorando RLS internamente. As policies passam a chamar
-- a funÃ§Ã£o em vez de subqueries cruzadas.
-- =====================================================================

create or replace function public.can_view_rental_contract(p_contract_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company    uuid;
  v_seller     uuid;
  v_uid        uuid := auth.uid();
  v_my_company uuid := public.current_company_id();
begin
  if public.is_super_admin() then return true; end if;
  if v_uid is null then return false; end if;

  select company_id, seller_id
    into v_company, v_seller
    from public.rental_contracts
   where id = p_contract_id;

  if v_company is null then return false; end if;
  if v_company <> v_my_company then return false; end if;

  -- admin/gerente da prÃ³pria empresa: vÃª tudo
  if public.is_admin_or_manager() then return true; end if;

  -- vendedor dono do contrato
  if v_seller = v_uid then return true; end if;

  -- tÃ©cnico com item atribuÃ­do nesse contrato
  if exists (
    select 1 from public.rental_contract_items
     where contract_id = p_contract_id and technician_id = v_uid
  ) then return true; end if;

  return false;
end $$;

grant execute on function public.can_view_rental_contract(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Reescreve as policies de SELECT pra usar a funÃ§Ã£o (sem recursÃ£o)
-- ---------------------------------------------------------------------

drop policy if exists "rental_contracts_select" on public.rental_contracts;
create policy "rental_contracts_select" on public.rental_contracts for select
  using (public.can_view_rental_contract(id));

drop policy if exists "rental_items_select" on public.rental_contract_items;
create policy "rental_items_select" on public.rental_contract_items for select
  using (public.can_view_rental_contract(contract_id));

drop policy if exists "rental_readings_select" on public.rental_meter_readings;
create policy "rental_readings_select" on public.rental_meter_readings for select
  using (
    exists (
      select 1 from public.rental_contract_items rci
       where rci.id = rental_meter_readings.contract_item_id
         and public.can_view_rental_contract(rci.contract_id)
    )
  );

-- A insert de leituras tambÃ©m precisa do mesmo path sem recursÃ£o
drop policy if exists "rental_readings_insert" on public.rental_meter_readings;
create policy "rental_readings_insert" on public.rental_meter_readings for insert
  with check (
    exists (
      select 1 from public.rental_contract_items rci
       where rci.id = rental_meter_readings.contract_item_id
         and public.can_view_rental_contract(rci.contract_id)
    )
  );

-- Itens INSERT/UPDATE/DELETE: tambÃ©m passam a usar a funÃ§Ã£o (consistÃªncia)
drop policy if exists "rental_items_insert" on public.rental_contract_items;
create policy "rental_items_insert" on public.rental_contract_items for insert
  with check (public.can_view_rental_contract(contract_id));

drop policy if exists "rental_items_update" on public.rental_contract_items;
create policy "rental_items_update" on public.rental_contract_items for update
  using (public.can_view_rental_contract(contract_id));

drop policy if exists "rental_items_delete" on public.rental_contract_items;
create policy "rental_items_delete" on public.rental_contract_items for delete
  using (public.can_view_rental_contract(contract_id));

-- Faturas: select continua via lookup direto pra evitar tocar em items.
drop policy if exists "rental_invoices_select" on public.rental_invoices;
create policy "rental_invoices_select" on public.rental_invoices for select
  using (public.can_view_rental_contract(contract_id));


-- =====================================================================
-- [migration] 20260507120021_legacy_extra_stubs.sql
-- =====================================================================
-- =====================================================================
-- OSManager â€” Stubs adicionais de tabelas/colunas usadas por componentes
-- legados do CRM (Sidebar bell, SystemAnnouncementBanner, etc).
--
-- Sem essas estruturas o app funciona, mas inunda o console de erros
-- 400/404 que confundem o user.
-- =====================================================================

-- ---------------------------------------------------------------------
-- wpp_conversations.message_type
-- ---------------------------------------------------------------------
alter table public.wpp_conversations
  add column if not exists message_type text default 'text';

-- ---------------------------------------------------------------------
-- notifications (in-app)
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,
  user_id     uuid references public.profiles(id)  on delete cascade,
  type        text,
  title       text,
  body        text,
  meta        jsonb,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, read);

alter table public.notifications enable row level security;
drop policy if exists "notifications_self_rw" on public.notifications;
create policy "notifications_self_rw" on public.notifications for all
  using (
    public.is_super_admin()
    or (company_id = public.current_company_id() and (user_id = auth.uid() or public.is_admin_or_manager()))
  )
  with check (company_id = public.current_company_id());

-- ---------------------------------------------------------------------
-- system_announcements (banner / popup global do super_admin)
-- ---------------------------------------------------------------------
create table if not exists public.system_announcements (
  id                 uuid primary key default gen_random_uuid(),
  title              text,
  message            text,
  severity           text default 'info',
  active             boolean not null default false,
  pinned             boolean not null default false,
  display_type       text default 'banner',     -- 'banner' | 'popup' | 'both'
  allow_hide_forever boolean default true,
  starts_at          timestamptz default now(),
  ends_at            timestamptz,
  created_at         timestamptz not null default now()
);

alter table public.system_announcements enable row level security;
drop policy if exists "sys_ann_read_all" on public.system_announcements;
create policy "sys_ann_read_all" on public.system_announcements for select
  using (true);
drop policy if exists "sys_ann_super_write" on public.system_announcements;
create policy "sys_ann_super_write" on public.system_announcements for all
  using (public.is_super_admin())
  with check (public.is_super_admin());


-- Recarrega schema cache do PostgREST
notify pgrst, 'reload schema';

