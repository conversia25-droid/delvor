-- =====================================================================
-- Delvor — Ramo da empresa (multi-vertical)
-- Cada empresa (tenant) pertence a um ramo. A UI, o menu e a terminologia
-- se adaptam a partir deste campo. Empresas existentes = assistência técnica.
-- =====================================================================

do $$ begin
  create type public.company_vertical as enum
    ('assistencia_tecnica','auto_escola','deposito_construcao');
exception when duplicate_object then null; end $$;

alter table public.companies
  add column if not exists vertical public.company_vertical
  not null default 'assistencia_tecnica';
