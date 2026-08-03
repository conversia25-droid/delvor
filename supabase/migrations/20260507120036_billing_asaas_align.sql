-- ============================================================================
-- Cobrança automatizada (Asaas) — FASE 1: alinhamento de schema
-- ----------------------------------------------------------------------------
-- As edge functions asaas-subscribe / asaas-webhook / asaas-proxy esperam
-- colunas e uma tabela (master_settings) que o schema de billing ainda não
-- tinha. Esta migration reconcilia tudo. Idempotente.
-- ============================================================================

-- ───────── 1. billing_invoices: vínculo com o gateway de pagamento ─────────
alter table public.billing_invoices
  add column if not exists gateway           text,
  add column if not exists gateway_charge_id text;

create index if not exists billing_invoices_gateway_charge_idx
  on public.billing_invoices(gateway_charge_id) where gateway_charge_id is not null;

-- ───────── 2. billing_events: colunas usadas pelas funções e pelo painel ─────────
alter table public.billing_events
  add column if not exists action    text,
  add column if not exists new_value jsonb,
  add column if not exists notes     text;

-- ───────── 3. company_subscriptions: 1 assinatura por empresa ─────────
-- As funções fazem upsert com onConflict=company_id → precisa de índice único.
-- Remove duplicadas antes (mantém a mais recente), pra o índice não falhar.
delete from public.company_subscriptions a
using public.company_subscriptions b
where a.company_id = b.company_id
  and (a.created_at < b.created_at
       or (a.created_at = b.created_at and a.ctid < b.ctid));

create unique index if not exists company_subscriptions_company_uidx
  on public.company_subscriptions(company_id);

-- ───────── 4. master_settings — guarda a chave da API do Asaas ─────────
-- key/value. Lida pela tela MasterAsaas e pelas edge functions.
create table if not exists public.master_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);
alter table public.master_settings
  add column if not exists value      text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.master_settings enable row level security;

-- Só super admin pode ver/editar (a chave da API é segredo da plataforma).
-- As edge functions usam a service role, que ignora RLS — então funcionam normal.
drop policy if exists master_settings_super on public.master_settings;
create policy master_settings_super on public.master_settings for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

grant select, insert, update, delete on public.master_settings to authenticated;
