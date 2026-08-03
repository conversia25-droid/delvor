-- =====================================================================
-- OSManager — Locação de equipamentos
--
-- Modelo:
--   rental_contracts            cabeçalho do contrato (cliente, datas, status, dia de vencimento)
--   rental_contract_items       N equipamentos no contrato, cada um com regras próprias
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
  billing_day     integer not null default 1,            -- dia do mês de vencimento (1–28)
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
-- RENTAL_CONTRACT_ITEMS — equipamentos no contrato
-- ---------------------------------------------------------------------
create table if not exists public.rental_contract_items (
  id                          uuid primary key default gen_random_uuid(),
  contract_id                 uuid not null references public.rental_contracts(id) on delete cascade,
  equipment_id                uuid not null references public.customer_equipments(id) on delete restrict,

  -- Mensalidade fixa do equipamento
  monthly_value               numeric(12,2) not null default 0,

  -- Franquia + excedente — campos opcionais. Se franquia for null, NÃO cobra excedente.
  franchise_bw                integer,                   -- páginas P&B inclusas no mês
  overage_bw_unit_price       numeric(10,4),             -- R$ por página excedente P&B
  franchise_color             integer,                   -- páginas color inclusas
  overage_color_unit_price    numeric(10,4),             -- R$ por página excedente color

  -- Contadores na hora da assinatura (baseline pra cobrar excedente)
  baseline_counter_bw         bigint default 0,
  baseline_counter_color      bigint default 0,

  notes                       text,
  created_at                  timestamptz not null default now()
);

create index if not exists rental_items_contract_idx on public.rental_contract_items(contract_id);
create index if not exists rental_items_equip_idx    on public.rental_contract_items(equipment_id);

-- ---------------------------------------------------------------------
-- RENTAL_METER_READINGS — leituras de contadores
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

-- Quando uma leitura é registrada, atualiza os contadores no equipment
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
-- RENTAL_INVOICES — fatura mensal
-- ---------------------------------------------------------------------
create table if not exists public.rental_invoices (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  contract_id     uuid not null references public.rental_contracts(id) on delete cascade,
  number          bigserial,
  reference_month date not null,                          -- 1º dia do mês de referência
  due_date        date not null,                          -- vencimento calculado
  base_total      numeric(14,2) not null default 0,       -- soma das mensalidades
  overage_total   numeric(14,2) not null default 0,       -- soma dos excedentes
  total           numeric(14,2) not null default 0,       -- base + excedente
  status          public.rental_invoice_status not null default 'pendente',
  sale_id         uuid references public.sales(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (contract_id, reference_month)                    -- uma fatura por contrato/mês
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
-- RPC: gera fatura do mês para um contrato
-- ---------------------------------------------------------------------
create or replace function public.generate_rental_invoice(
  p_contract_id    uuid,
  p_reference_month date     -- primeiro dia do mês de referência (ex: 2026-05-01)
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
  -- Validações iniciais
  select company_id, billing_day into v_company, v_billing_day
    from public.rental_contracts where id = p_contract_id;
  if v_company is null then
    raise exception 'Contrato não encontrado';
  end if;

  -- Já existe fatura para esse mês?
  select id into v_existing
    from public.rental_invoices
   where contract_id = p_contract_id
     and reference_month = date_trunc('month', p_reference_month)::date;
  if v_existing is not null then
    raise exception 'Já existe fatura desse contrato para esse mês (id %)', v_existing;
  end if;

  -- Calcula vencimento: dia do contrato no mês de referência
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
        format('Locação — %s %s%s',
               coalesce(it.brand, ''), coalesce(it.model, ''),
               case when it.serial_number is not null then ' (SN ' || it.serial_number || ')' else '' end),
        1, it.monthly_value, 'mensalidade'
      );
      v_base_total := v_base_total + it.monthly_value;
    end if;

    -- 2) Excedente P&B (se contrato tem franquia)
    if it.franchise_bw is not null and it.overage_bw_unit_price is not null then
      -- Pega última leitura ANTES do fim do mês de referência
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
            format('Excedente P&B — %s %s', coalesce(it.brand,''), coalesce(it.model,'')),
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
            format('Excedente Color — %s %s', coalesce(it.brand,''), coalesce(it.model,'')),
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

-- contracts: admin/gerente edita; vendedor lê tudo da empresa
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

-- Leituras: técnicos podem inserir (atendimento em campo)
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
