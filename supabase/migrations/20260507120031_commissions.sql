-- ============================================================================
-- COMISSÕES — pagamento / fechamento de comissão por vendedor
-- ----------------------------------------------------------------------------
--  Já existem (migration _30):
--   • profiles.commission_rate         → % fixo de comissão do vendedor
--   • sales.commission_rate / amount   → comissão calculada por venda (trigger)
--
--  Esta migration adiciona o CONTROLE DE PAGAMENTO das comissões:
--   • commission_payouts               → cada "fechamento" pago a um vendedor
--   • sales.commission_paid_at / payout_id → marca a venda como comissão paga
--   • RPC pay_seller_commission        → paga (fecha) a comissão pendente
--   • RPC recalc_pending_commissions   → reaplica as taxas nas comissões não pagas
-- ============================================================================

-- ───────── 1. tabela de pagamentos de comissão ─────────
create table if not exists public.commission_payouts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  seller_id     uuid not null references public.profiles(id) on delete restrict,
  paid_at       timestamptz not null default now(),
  period_start  date,
  period_end    date,
  total_amount  numeric(12,2) not null default 0,
  sales_count   integer not null default 0,
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists commission_payouts_company_idx on public.commission_payouts(company_id);
create index if not exists commission_payouts_seller_idx  on public.commission_payouts(seller_id);

-- ───────── 2. sales: marca comissão como paga ─────────
alter table public.sales
  add column if not exists commission_paid_at   timestamptz,
  add column if not exists commission_payout_id uuid references public.commission_payouts(id) on delete set null;

create index if not exists sales_commission_pending_idx
  on public.sales(company_id, seller_id) where commission_paid_at is null;

-- ───────── 3. RLS ─────────
alter table public.commission_payouts enable row level security;

drop policy if exists "commission_payouts_select" on public.commission_payouts;
create policy "commission_payouts_select" on public.commission_payouts for select using (
  public.is_super_admin() or company_id = public.current_company_id()
);

drop policy if exists "commission_payouts_write" on public.commission_payouts;
create policy "commission_payouts_write" on public.commission_payouts for all using (
  public.is_super_admin()
  or (company_id = public.current_company_id()
      and (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gerente')))
) with check (
  public.is_super_admin()
  or (company_id = public.current_company_id()
      and (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gerente')))
);

-- ───────── 4. RPC: pagar (fechar) a comissão pendente do vendedor ─────────
-- Soma as comissões NÃO pagas do vendedor no período, registra um payout
-- e marca essas vendas como comissão paga. Tudo numa transação só.
create or replace function public.pay_seller_commission(
  p_seller_id     uuid,
  p_period_start  date,
  p_period_end    date,
  p_notes         text default null
) returns public.commission_payouts
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_total   numeric(12,2);
  v_count   integer;
  v_payout  public.commission_payouts;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gerente')) then
    raise exception 'Sem permissão para pagar comissões.';
  end if;
  v_company := public.current_company_id();

  select coalesce(sum(commission_amount), 0), count(*)
    into v_total, v_count
    from public.sales
   where company_id = v_company
     and seller_id  = p_seller_id
     and commission_paid_at is null
     and commission_amount > 0
     and status in ('faturado','entregue')
     and issue_date between p_period_start and p_period_end;

  if v_count = 0 then
    raise exception 'Nenhuma comissão pendente para esse vendedor no período.';
  end if;

  insert into public.commission_payouts
    (company_id, seller_id, paid_at, period_start, period_end, total_amount, sales_count, notes, created_by)
  values
    (v_company, p_seller_id, now(), p_period_start, p_period_end, v_total, v_count, p_notes, auth.uid())
  returning * into v_payout;

  update public.sales
     set commission_paid_at   = now(),
         commission_payout_id = v_payout.id
   where company_id = v_company
     and seller_id  = p_seller_id
     and commission_paid_at is null
     and commission_amount > 0
     and status in ('faturado','entregue')
     and issue_date between p_period_start and p_period_end;

  return v_payout;
end $$;
grant execute on function public.pay_seller_commission(uuid, date, date, text) to authenticated;

-- ───────── 5. RPC: recalcular comissões ainda NÃO pagas ─────────
-- Reaplica a % atual de cada vendedor (profiles.commission_rate) nas vendas
-- cuja comissão ainda não foi paga. Útil depois de ajustar as taxas.
create or replace function public.recalc_pending_commissions()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_count   integer;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gerente')) then
    raise exception 'Sem permissão.';
  end if;
  v_company := public.current_company_id();

  update public.sales s
     set commission_rate   = coalesce(p.commission_rate, 0),
         commission_amount = round(coalesce(s.total,0) * coalesce(p.commission_rate,0) / 100.0, 2)
    from public.profiles p
   where s.seller_id = p.id
     and s.company_id = v_company
     and s.commission_paid_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end $$;
grant execute on function public.recalc_pending_commissions() to authenticated;
