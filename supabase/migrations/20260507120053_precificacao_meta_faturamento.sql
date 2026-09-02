-- =====================================================================
-- Precificação — modo "meta de faturamento" (loja nova)
--
-- Loja sem histórico não sabe quantas unidades vende/mês, mas sabe quanto
-- precisa faturar. Nesse modo as fixas viram uma % de cada venda
-- (fixas ÷ meta de faturamento) em vez de R$ por unidade — método clássico
-- de markup. Mantém os modos 'auto' e 'manual' como estão.
-- =====================================================================

alter table public.financial_settings
  drop constraint if exists financial_settings_volume_mode_check;

alter table public.financial_settings
  add constraint financial_settings_volume_mode_check
  check (volume_mode in ('auto', 'manual', 'meta'));

alter table public.financial_settings
  add column if not exists monthly_revenue_target_cents integer not null default 0
    check (monthly_revenue_target_cents >= 0);
