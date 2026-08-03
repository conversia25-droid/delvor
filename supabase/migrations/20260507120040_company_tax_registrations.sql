-- =====================================================================
-- Adiciona Inscrição Estadual e Municipal à empresa.
--
-- IE: identificação fiscal estadual (quem vende produto físico — ICMS)
--     Pode ser "ISENTO" ou em branco pra Simples/MEI sem IE.
-- IM: identificação fiscal municipal (quem presta serviço — ISS)
--     Pode ser em branco se a empresa só vende produto.
--
-- Os clientes (PJ) já têm os mesmos campos (state_reg / muni_reg) desde
-- a migration 20260507120002_customers.sql — agora a empresa também tem,
-- pra aparecer no cabeçalho da nota fiscal e dos PDFs.
-- =====================================================================

alter table public.companies
  add column if not exists state_reg text,
  add column if not exists muni_reg  text;
