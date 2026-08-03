-- =====================================================================
-- OSManager — Catálogo, Estoque, Fornecedores, Compras
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
-- PRODUCTS (impressoras, suprimentos, peças, periféricos)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.product_type as enum ('equipamento','suprimento','peca','acessorio','servico_avulso');
exception when duplicate_object then null; end $$;

create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  category_id   uuid references public.product_categories(id) on delete set null,
  supplier_id   uuid references public.suppliers(id) on delete set null,

  sku           text,                          -- código interno
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

  -- Compatibilidade (impressoras → suprimentos compatíveis)
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
-- SERVICES CATALOG (catálogo de serviços avulsos: limpeza, recarga, etc)
-- ---------------------------------------------------------------------
create table if not exists public.services_catalog (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  code          text,
  name          text not null,
  description   text,
  default_price numeric(12,2) default 0,
  default_duration_min integer,                 -- duração média em minutos
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
  qty          numeric(14,3) not null,           -- positivo sempre, o move_type define direção
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
    when 'reserva'        then  0          -- reserva não muda qty
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
  number        bigserial,                        -- numeração interna
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
