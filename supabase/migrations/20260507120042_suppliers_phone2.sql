-- =====================================================================
-- Adiciona segundo telefone ao cadastro de fornecedores.
-- Muitos fornecedores têm um telefone comercial + celular do contato.
-- =====================================================================

alter table public.suppliers
  add column if not exists phone2 text;
