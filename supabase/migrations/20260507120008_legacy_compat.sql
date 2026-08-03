-- =====================================================================
-- OSManager — Compatibilidade com componentes legados do CRM original
-- Cria stubs vazios das tabelas/views referenciadas por SubscriptionContext,
-- Sidebar e outros componentes herdados, evitando erros no console.
--
-- Quando os módulos correspondentes forem refeitos para o OSManager,
-- estas estruturas podem ser ampliadas ou substituídas.
-- =====================================================================

-- billing_plans: planos de assinatura (vazio por padrão)
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
-- Tabelas / views diversas usadas por componentes herdados que não
-- pertencem ao escopo OSManager — criadas como vazias só pra evitar
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
