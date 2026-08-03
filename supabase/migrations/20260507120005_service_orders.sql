-- =====================================================================
-- OSManager — Ordens de Serviço (OS)
-- Workflow: aberta → diagnostico → aguardando_peca → em_execucao → concluida → entregue → faturada
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
  number          bigserial,                        -- número humano (#12345)

  -- Quem
  customer_id     uuid not null references public.customers(id) on delete restrict,
  equipment_id    uuid references public.customer_equipments(id) on delete set null,
  technician_id   uuid references public.profiles(id) on delete set null,
  opened_by       uuid references public.profiles(id) on delete set null,

  -- O quê
  status          public.os_status   not null default 'aberta',
  priority        public.os_priority not null default 'normal',
  origin          public.os_origin   not null default 'balcao',

  -- Descrições
  reported_issue  text,                              -- defeito relatado pelo cliente
  diagnosis       text,                              -- laudo técnico
  solution        text,                              -- o que foi feito
  internal_notes  text,                              -- não aparece pro cliente

  -- Coleta / entrega
  pickup_required boolean not null default false,
  pickup_address  text,
  delivery_address text,
  scheduled_at    timestamptz,
  finished_at     timestamptz,
  delivered_at    timestamptz,

  -- Garantia (após entrega)
  warranty_days   integer default 90,
  warranty_until  date,

  -- Totais (denormalizados)
  parts_total     numeric(14,2) not null default 0,
  labor_total     numeric(14,2) not null default 0,
  discount        numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,

  -- Vínculos
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
-- SERVICE_ORDER_ITEMS  (peças usadas + serviços executados)
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
  consumed        boolean not null default false,    -- já deu baixa no estoque?
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
  is_public       boolean not null default false,    -- se é mensagem que pode ser enviada ao cliente
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
-- TRIGGER: registra mudança de status no histórico
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
            'Status: ' || coalesce(old.status::text,'-') || ' → ' || new.status::text);
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
-- TRIGGER: ao consumir peça (consumed=true), gera saída de estoque
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
