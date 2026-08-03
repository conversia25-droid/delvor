-- ============================================================
-- Caixa PDV + Comissão de vendedores.
--
--  • cash_sessions  — sessão de caixa (1 por vendedor por vez)
--  • cash_movements — sangrias e suprimentos
--  • profiles.commission_rate — % fixo de comissão do vendedor
--  • sales.cash_session_id / commission_* — venda vinculada ao caixa
-- ============================================================

-- ───────── 1. Comissão no profile ─────────
alter table public.profiles
  add column if not exists commission_rate numeric(5,2) not null default 0;
comment on column public.profiles.commission_rate is
  'Percentual de comissão do vendedor (ex: 5.00 = 5%). Aplicado sobre o total da venda.';

-- ───────── 2. cash_sessions ─────────
create table if not exists public.cash_sessions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete restrict,
  -- abertura
  opened_at       timestamptz not null default now(),
  opening_amount  numeric(12,2) not null default 0,   -- fundo de troco
  -- fechamento
  closed_at       timestamptz,
  closing_amount  numeric(12,2),                       -- dinheiro físico contado
  expected_cash   numeric(12,2),                       -- esperado em dinheiro
  difference      numeric(12,2),                       -- closing - expected
  status          text not null default 'aberto'
                    check (status in ('aberto','fechado')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists cash_sessions_company_idx on public.cash_sessions(company_id);
create index if not exists cash_sessions_user_idx    on public.cash_sessions(user_id);
-- Garante no máximo 1 caixa ABERTO por usuário
create unique index if not exists cash_sessions_one_open_per_user
  on public.cash_sessions(user_id) where status = 'aberto';

-- updated_at automático
create or replace function public.tg_cash_sessions_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists tg_cash_sessions_touch on public.cash_sessions;
create trigger tg_cash_sessions_touch
  before update on public.cash_sessions
  for each row execute function public.tg_cash_sessions_touch();

-- ───────── 3. cash_movements (sangria/suprimento) ─────────
create table if not exists public.cash_movements (
  id               uuid primary key default gen_random_uuid(),
  cash_session_id  uuid not null references public.cash_sessions(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,
  type             text not null check (type in ('sangria','suprimento')),
  amount           numeric(12,2) not null check (amount > 0),
  reason           text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists cash_movements_session_idx on public.cash_movements(cash_session_id);

-- ───────── 4. sales: vínculo com caixa + comissão ─────────
alter table public.sales
  add column if not exists cash_session_id   uuid references public.cash_sessions(id) on delete set null,
  add column if not exists commission_rate   numeric(5,2),
  add column if not exists commission_amount numeric(12,2);

create index if not exists sales_cash_session_idx on public.sales(cash_session_id);

-- ───────── 5. Trigger: calcula comissão da venda ─────────
-- Pega o commission_rate do vendedor (profiles) e calcula sobre o total.
create or replace function public.tg_sales_commission()
returns trigger
language plpgsql
as $$
declare
  v_rate numeric(5,2);
begin
  -- Só calcula se ainda não foi informado manualmente
  if new.seller_id is not null then
    select commission_rate into v_rate
      from public.profiles where id = new.seller_id;
    new.commission_rate := coalesce(new.commission_rate, v_rate, 0);
  else
    new.commission_rate := coalesce(new.commission_rate, 0);
  end if;

  new.commission_amount := round(
    coalesce(new.total, 0) * coalesce(new.commission_rate, 0) / 100.0, 2
  );
  return new;
end $$;

drop trigger if exists tg_sales_commission on public.sales;
create trigger tg_sales_commission
  before insert or update of total, seller_id, commission_rate on public.sales
  for each row execute function public.tg_sales_commission();

-- ───────── 6. RPC: sessão de caixa aberta do usuário ─────────
create or replace function public.get_open_cash_session(p_user_id uuid)
returns public.cash_sessions
language sql stable security definer set search_path = public as $$
  select * from public.cash_sessions
   where user_id = p_user_id and status = 'aberto'
   order by opened_at desc
   limit 1;
$$;
grant execute on function public.get_open_cash_session(uuid) to authenticated;

-- ───────── 7. RPC: resumo do caixa (totais por forma de pagamento) ─────────
create or replace function public.cash_session_summary(p_session_id uuid)
returns table (
  total_sales        numeric,
  sales_count        bigint,
  cash_in            numeric,   -- vendas em dinheiro
  card_in            numeric,   -- vendas em cartão
  pix_in             numeric,   -- vendas em pix
  other_in           numeric,
  suprimentos        numeric,
  sangrias           numeric,
  expected_cash      numeric    -- opening + cash_in + suprimentos - sangrias
)
language sql stable security definer set search_path = public as $$
  with sess as (
    select * from public.cash_sessions where id = p_session_id
  ),
  pays as (
    select sp.method, sp.amount
      from public.sale_payments sp
      join public.sales s on s.id = sp.sale_id
     where s.cash_session_id = p_session_id
  ),
  movs as (
    select type, sum(amount) as total
      from public.cash_movements
     where cash_session_id = p_session_id
     group by type
  )
  select
    coalesce((select sum(amount) from pays), 0)                                          as total_sales,
    (select count(distinct s.id) from public.sales s where s.cash_session_id = p_session_id) as sales_count,
    coalesce((select sum(amount) from pays where method = 'dinheiro'), 0)                  as cash_in,
    coalesce((select sum(amount) from pays where method in ('cartao_credito','cartao_debito')), 0) as card_in,
    coalesce((select sum(amount) from pays where method = 'pix'), 0)                       as pix_in,
    coalesce((select sum(amount) from pays where method in (
      'boleto','transferencia','crediario','outro'
    )), 0)                                                                                 as other_in,
    coalesce((select total from movs where type = 'suprimento'), 0)                        as suprimentos,
    coalesce((select total from movs where type = 'sangria'), 0)                           as sangrias,
    (select opening_amount from sess)
      + coalesce((select sum(amount) from pays where method = 'dinheiro'), 0)
      + coalesce((select total from movs where type = 'suprimento'), 0)
      - coalesce((select total from movs where type = 'sangria'), 0)                       as expected_cash;
$$;
grant execute on function public.cash_session_summary(uuid) to authenticated;

-- ============================================================
-- RLS
-- ============================================================
alter table public.cash_sessions  enable row level security;
alter table public.cash_movements enable row level security;

-- cash_sessions: vendedor vê o seu; admin/gerente vê todos da empresa
drop policy if exists cash_sessions_select on public.cash_sessions;
create policy cash_sessions_select on public.cash_sessions
  for select using (
    company_id = public.current_company_id()
    and (
      user_id = auth.uid()
      or public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'gerente')
    )
  );

-- INSERT/UPDATE: o próprio dono do caixa (ou admin/gerente)
drop policy if exists cash_sessions_write on public.cash_sessions;
create policy cash_sessions_write on public.cash_sessions
  for all using (
    company_id = public.current_company_id()
    and (
      user_id = auth.uid()
      or public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'gerente')
    )
  ) with check (
    company_id = public.current_company_id()
  );

-- cash_movements: quem vê a sessão, vê os movimentos
drop policy if exists cash_movements_select on public.cash_movements;
create policy cash_movements_select on public.cash_movements
  for select using (company_id = public.current_company_id());

drop policy if exists cash_movements_write on public.cash_movements;
create policy cash_movements_write on public.cash_movements
  for all using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

grant select, insert, update, delete on public.cash_sessions  to authenticated;
grant select, insert, update, delete on public.cash_movements to authenticated;
