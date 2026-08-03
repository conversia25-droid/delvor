-- =====================================================================
-- Onboarding — força contas novas a passarem pelo fluxo
--
-- A migration legacy (20260507120010_legacy_stubs.sql) criou a coluna
-- `companies.onboarding_completed` com DEFAULT TRUE — herdado de quando
-- a feature era opcional. Isso faz toda empresa nova nascer "completed"
-- e o overlay nunca dispara.
--
-- Aqui mudamos só o DEFAULT pra FALSE. Empresas existentes ficam como
-- estão (escolha do produto: não bombardear quem já está usando).
-- =====================================================================

alter table public.companies
  alter column onboarding_completed set default false;
