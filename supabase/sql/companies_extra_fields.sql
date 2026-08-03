-- Adiciona campos opcionais de contato/identificação na tabela companies.
-- Usado pelo painel master pra mostrar dados completos da empresa.
-- Rode UMA vez no SQL editor. Idempotente (IF NOT EXISTS).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS document text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS asaas_customer_id text;

-- Índice pra lookup por asaas_customer_id (usado pelo webhook do Asaas)
CREATE INDEX IF NOT EXISTS idx_companies_asaas_customer_id
  ON public.companies (asaas_customer_id)
  WHERE asaas_customer_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
