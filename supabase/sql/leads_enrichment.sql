-- ============================================================
-- Adiciona email (opcional) na tabela de leads.
-- Idempotente — pode rodar quantas vezes quiser.
-- Rode no SQL Editor do Supabase.
-- ============================================================

-- Coluna email (opcional)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS email text;

-- Validação básica de formato (só pra barrar lixo óbvio)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_email_shape'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_email_shape
      CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
  END IF;
END $$;

-- Email único por empresa (quando preenchido)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_leads_company_email
  ON public.leads (company_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

-- ─────────────────────────────────────────────────────────────
-- Checa se rodou:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='leads' AND column_name='email';
-- ─────────────────────────────────────────────────────────────
