-- =====================================================================
-- 72 — Expedição + entregas/coletas com motoqueiro
--
-- couriers            motoqueiros da empresa (WhatsApp, valor por entrega
--                     e por coleta). Cada um tem um link próprio
--                     (access_token) para ver e baixar as tarefas dele,
--                     sem login.
-- delivery_tasks      uma entrega (venda ou OS) ou coleta (OS) a fazer.
--                     Etapas: separar → pronto → atribuida → em_rota →
--                     concluida | falhou ; cancelada ; retirada (balcão)
-- courier_settlements acerto do motoqueiro: soma as taxas das tarefas
--                     feitas e gera uma conta a pagar.
--
-- RPCs públicas (link do motoqueiro, token): courier_tasks_by_token,
-- courier_update_task. Ao concluir a entrega de uma venda faturada, a
-- venda vira "entregue"; entrega de OS concluída vira "entregue".
-- =====================================================================

-- ───────── motoqueiros ─────────
create table if not exists public.couriers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null,
  whatsapp      text,
  fee_delivery  numeric(12,2) not null default 0,
  fee_pickup    numeric(12,2) not null default 0,
  active        boolean not null default true,
  notes         text,
  access_token  uuid not null default gen_random_uuid() unique,
  created_at    timestamptz not null default now()
);
create index if not exists couriers_company_idx on public.couriers(company_id);

alter table public.couriers enable row level security;
drop policy if exists "couriers_select" on public.couriers;
create policy "couriers_select" on public.couriers for select
  using (public.is_super_admin() or company_id = public.current_company_id());
drop policy if exists "couriers_write" on public.couriers;
create policy "couriers_write" on public.couriers for all
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()))
  with check (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()));

-- ───────── acertos ─────────
create table if not exists public.courier_settlements (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  courier_id      uuid not null references public.couriers(id) on delete cascade,
  settled_on      date not null default (now() at time zone 'America/Sao_Paulo')::date,
  tasks_count     integer not null default 0,
  fees_total      numeric(12,2) not null default 0,
  collected_total numeric(12,2) not null default 0,
  payable_id      uuid references public.payables(id) on delete set null,
  notes           text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists courier_settlements_company_idx on public.courier_settlements(company_id, settled_on desc);
alter table public.courier_settlements enable row level security;
drop policy if exists "courier_settlements_select" on public.courier_settlements;
create policy "courier_settlements_select" on public.courier_settlements for select
  using (public.is_super_admin() or company_id = public.current_company_id());
-- escrita só pela RPC settle_courier

-- ───────── tarefas ─────────
create table if not exists public.delivery_tasks (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  kind             text not null default 'entrega' check (kind in ('entrega', 'coleta')),
  sale_id          uuid references public.sales(id) on delete cascade,
  service_order_id uuid references public.service_orders(id) on delete cascade,
  customer_id      uuid references public.customers(id) on delete set null,
  customer_name    text,
  phone            text,
  address          text,
  address_notes    text,
  stage            text not null default 'separar'
                   check (stage in ('separar', 'pronto', 'atribuida', 'em_rota', 'concluida', 'falhou', 'cancelada', 'retirada')),
  due_date         date,
  collect_amount   numeric(12,2) not null default 0,
  courier_id       uuid references public.couriers(id) on delete set null,
  fee              numeric(12,2) not null default 0,
  assigned_at      timestamptz,
  started_at       timestamptz,
  done_at          timestamptz,
  received_by      text,
  collected_amount numeric(12,2),
  collected_method text,
  fail_reason      text,
  notes            text,
  settlement_id    uuid references public.courier_settlements(id) on delete set null,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists delivery_tasks_company_stage_idx on public.delivery_tasks(company_id, stage);
create index if not exists delivery_tasks_courier_idx on public.delivery_tasks(courier_id) where courier_id is not null;
create index if not exists delivery_tasks_sale_idx on public.delivery_tasks(sale_id) where sale_id is not null;
create index if not exists delivery_tasks_os_idx on public.delivery_tasks(service_order_id) where service_order_id is not null;

drop trigger if exists trg_delivery_tasks_updated on public.delivery_tasks;
create trigger trg_delivery_tasks_updated before update on public.delivery_tasks
  for each row execute function public.tg_set_updated_at();

alter table public.delivery_tasks enable row level security;
drop policy if exists "delivery_tasks_select" on public.delivery_tasks;
create policy "delivery_tasks_select" on public.delivery_tasks for select
  using (public.is_super_admin() or company_id = public.current_company_id());
drop policy if exists "delivery_tasks_insert" on public.delivery_tasks;
create policy "delivery_tasks_insert" on public.delivery_tasks for insert
  with check (public.is_super_admin() or company_id = public.current_company_id());
drop policy if exists "delivery_tasks_update" on public.delivery_tasks;
create policy "delivery_tasks_update" on public.delivery_tasks for update
  using (public.is_super_admin() or company_id = public.current_company_id())
  with check (public.is_super_admin() or company_id = public.current_company_id());
drop policy if exists "delivery_tasks_delete" on public.delivery_tasks;
create policy "delivery_tasks_delete" on public.delivery_tasks for delete
  using (public.is_super_admin() or (company_id = public.current_company_id() and public.is_admin_or_manager()));

-- Tarefa já acertada não muda mais valor/taxa/motoqueiro.
create or replace function public.tg_guard_delivery_task()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.settlement_id is not null and current_setting('delvor.courier_rpc', true) is distinct from '1'
     and (new.fee is distinct from old.fee or new.courier_id is distinct from old.courier_id
          or new.collected_amount is distinct from old.collected_amount or new.stage is distinct from old.stage) then
    raise exception 'Esta tarefa já entrou num acerto do motoqueiro e não pode mais ser alterada.';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_delivery_task on public.delivery_tasks;
create trigger trg_guard_delivery_task before update on public.delivery_tasks
  for each row execute function public.tg_guard_delivery_task();

-- ───────── link do motoqueiro (sem login) ─────────
create or replace function public.courier_tasks_by_token(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c public.couriers%rowtype;
begin
  select * into v_c from public.couriers where access_token = p_token and active;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'courier', jsonb_build_object('name', v_c.name),
    'company', (select name from public.companies where id = v_c.company_id),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'kind', t.kind, 'stage', t.stage,
               'customer_name', t.customer_name, 'phone', t.phone,
               'address', t.address, 'address_notes', t.address_notes,
               'due_date', t.due_date, 'collect_amount', t.collect_amount,
               'notes', t.notes, 'done_at', t.done_at,
               'collected_amount', t.collected_amount, 'collected_method', t.collected_method,
               'ref', case when t.sale_id is not null then 'Venda ' || lpad(s.number::text, 6, '0')
                           when t.service_order_id is not null then 'OS ' || lpad(o.number::text, 6, '0') end,
               'items', case
                 when t.sale_id is not null then (
                   select string_agg(trim(to_char(si.qty, 'FM999990.###')) || 'x ' || si.description, ' · ' order by si.position)
                     from public.sale_items si where si.sale_id = t.sale_id)
                 when t.service_order_id is not null then (
                   select nullif(trim(concat_ws(' ', e.brand, e.model)), '')
                     from public.customer_equipments e where e.id = o.equipment_id)
               end
             ) order by (t.stage in ('concluida', 'falhou')), t.due_date nulls last, t.assigned_at)
        from public.delivery_tasks t
        left join public.sales s on s.id = t.sale_id
        left join public.service_orders o on o.id = t.service_order_id
       where t.courier_id = v_c.id
         and (t.stage in ('atribuida', 'em_rota')
              or (t.stage in ('concluida', 'falhou') and t.done_at > now() - interval '18 hours'))
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.courier_update_task(
  p_token       uuid,
  p_task        uuid,
  p_action      text,             -- saiu | concluida | falhou
  p_collected   numeric default null,
  p_method      text default null,
  p_received_by text default null,
  p_reason      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.couriers%rowtype;
  v_t public.delivery_tasks%rowtype;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into v_c from public.couriers where access_token = p_token and active;
  if not found then raise exception 'Link inválido ou desativado.'; end if;
  select * into v_t from public.delivery_tasks where id = p_task and courier_id = v_c.id for update;
  if not found then raise exception 'Tarefa não encontrada para este motoqueiro.'; end if;
  if v_t.settlement_id is not null then raise exception 'Tarefa já acertada.'; end if;

  if p_action = 'saiu' then
    if v_t.stage <> 'atribuida' then raise exception 'Esta tarefa não está aguardando saída.'; end if;
    update public.delivery_tasks set stage = 'em_rota', started_at = now() where id = v_t.id;

  elsif p_action = 'concluida' then
    if v_t.stage not in ('atribuida', 'em_rota') then raise exception 'Esta tarefa já foi finalizada.'; end if;
    if coalesce(p_collected, 0) < 0 then raise exception 'Valor recebido inválido.'; end if;
    update public.delivery_tasks
       set stage = 'concluida', done_at = now(), started_at = coalesce(started_at, now()),
           collected_amount = coalesce(p_collected, 0),
           collected_method = case when coalesce(p_collected, 0) > 0 then nullif(btrim(p_method), '') end,
           received_by = nullif(btrim(p_received_by), ''),
           fail_reason = null
     where id = v_t.id;
    if v_t.kind = 'entrega' and v_t.sale_id is not null then
      update public.sales set status = 'entregue', delivery_date = coalesce(delivery_date, v_today)
       where id = v_t.sale_id and status = 'faturado';
    elsif v_t.kind = 'entrega' and v_t.service_order_id is not null then
      update public.service_orders set status = 'entregue'
       where id = v_t.service_order_id and status = 'concluida';
    end if;

  elsif p_action = 'falhou' then
    if v_t.stage not in ('atribuida', 'em_rota') then raise exception 'Esta tarefa já foi finalizada.'; end if;
    if nullif(btrim(p_reason), '') is null then raise exception 'Informe o motivo.'; end if;
    update public.delivery_tasks
       set stage = 'falhou', done_at = now(), fail_reason = btrim(p_reason)
     where id = v_t.id;
  else
    raise exception 'Ação inválida.';
  end if;
end $$;

grant execute on function public.courier_tasks_by_token(uuid) to anon, authenticated;
grant execute on function public.courier_update_task(uuid, uuid, text, numeric, text, text, text) to anon, authenticated;

-- ───────── acerto do motoqueiro ─────────
-- Soma as taxas das tarefas concluídas (e das coletas/entregas que falharam,
-- se o admin incluir) e gera UMA conta a pagar. Devolve o id do acerto.
create or replace function public.settle_courier(p_courier uuid, p_tasks uuid[], p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c       public.couriers%rowtype;
  v_n       integer;
  v_fees    numeric;
  v_cash    numeric;
  v_set     uuid;
  v_pay     uuid;
  v_today   date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into v_c from public.couriers where id = p_courier;
  if not found then raise exception 'Motoqueiro não encontrado.'; end if;
  if not (public.is_super_admin() or (v_c.company_id = public.current_company_id()
          and (public.is_admin_or_manager() or public.has_financial_access()))) then
    raise exception 'Só admin, gerente ou financeiro faz o acerto.' using errcode = '42501';
  end if;

  perform 1 from public.delivery_tasks
   where id = any(p_tasks) for update;
  select count(*), coalesce(sum(fee), 0), coalesce(sum(collected_amount), 0)
    into v_n, v_fees, v_cash
    from public.delivery_tasks
   where id = any(p_tasks) and courier_id = p_courier and company_id = v_c.company_id
     and settlement_id is null and stage in ('concluida', 'falhou');
  if v_n = 0 then raise exception 'Nenhuma tarefa pendente de acerto nessa seleção.'; end if;
  if v_n <> coalesce(array_length(p_tasks, 1), 0) then
    raise exception 'Algumas tarefas não podem entrar no acerto (de outro motoqueiro, não finalizadas ou já acertadas).';
  end if;

  if v_fees > 0 then
    insert into public.payables (company_id, description, amount, due_date, notes)
    values (v_c.company_id,
            'Entregas — ' || v_c.name || ' (' || v_n || ' tarefa' || case when v_n > 1 then 's' else '' end || ')',
            v_fees, v_today, nullif(btrim(p_notes), ''))
    returning id into v_pay;
  end if;

  insert into public.courier_settlements (company_id, courier_id, settled_on, tasks_count, fees_total, collected_total, payable_id, notes)
  values (v_c.company_id, p_courier, v_today, v_n, v_fees, v_cash, v_pay, nullif(btrim(p_notes), ''))
  returning id into v_set;

  perform set_config('delvor.courier_rpc', '1', true);
  update public.delivery_tasks set settlement_id = v_set where id = any(p_tasks);
  perform set_config('delvor.courier_rpc', '', true);
  return v_set;
end $$;

grant execute on function public.settle_courier(uuid, uuid[], text) to authenticated;
