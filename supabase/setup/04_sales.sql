-- =====================================================================
-- OSManager — Vendas: Orçamento → Pedido → Pagamento
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
-- SALES (Vendas / Orçamentos)
-- ---------------------------------------------------------------------
create table if not exists public.sales (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  number        bigserial,                       -- numeração interna do orçamento/pedido
  customer_id   uuid not null references public.customers(id) on delete restrict,
  seller_id     uuid references public.profiles(id) on delete set null,

  status        public.sale_status not null default 'orcamento',

  -- Datas
  issue_date    date not null default current_date,
  approved_at   timestamptz,
  delivery_date date,

  -- Totais (denormalizados para listagem rápida)
  subtotal      numeric(14,2) not null default 0,
  discount      numeric(14,2) not null default 0,
  freight       numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,

  -- Documentação
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

  -- Pode referenciar produto OU serviço (um dos dois)
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
  asaas_charge_id text,                          -- integração Asaas (já existe edge function)
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
  -- só baixa quando muda PARA faturado pela primeira vez
  if new.status = 'faturado' and (old.status is distinct from 'faturado') then
    for it in select product_id, qty from public.sale_items where sale_id = new.id and product_id is not null
    loop
      insert into public.stock_movements (company_id, product_id, move_type, qty, ref_table, ref_id, reference, notes)
      values (new.company_id, it.product_id, 'baixa_venda', it.qty, 'sales', new.id,
              'Venda #' || new.number, 'Baixa automática por faturamento da venda');
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
