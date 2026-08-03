-- ============================================================================
-- Painel Master — flags de acesso da empresa
-- ----------------------------------------------------------------------------
-- access_blocked: empresa com acesso bloqueado (inadimplência, suspensão...)
-- free_access:    acesso liberado de cortesia (parceria, teste estendido...)
-- Usadas pela tela MasterAsaas e pelo controle de cobrança.
-- ============================================================================
alter table public.companies
  add column if not exists access_blocked boolean not null default false,
  add column if not exists free_access    boolean not null default false;
