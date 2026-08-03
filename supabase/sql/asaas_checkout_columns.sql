-- Garante colunas pro checkout Asaas em billing_invoices
-- Rodar UMA vez no SQL Editor do Supabase.

-- ── 1) Colunas pra rastrear cobrança no gateway ──
ALTER TABLE public.billing_invoices
  ADD COLUMN IF NOT EXISTS gateway text,
  ADD COLUMN IF NOT EXISTS gateway_charge_id text;

-- Índice pra lookup rápido por charge_id (usado no webhook)
CREATE INDEX IF NOT EXISTS idx_billing_invoices_gateway_charge_id
  ON public.billing_invoices (gateway_charge_id)
  WHERE gateway_charge_id IS NOT NULL;

-- ── 2) Coluna CNPJ/CPF da empresa pra mandar pro Asaas ──
-- (Opcional — o checkout tenta mandar se existir)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS cnpj text;

-- ── 3) Garante asaas_customer_id em companies ──
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS asaas_customer_id text;

-- ── 4) Policies pra admin da empresa ler as próprias invoices ──
-- Já deve existir via RLS geral; esta é uma salvaguarda.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'billing_invoices'
      AND policyname = 'admins read own company invoices'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "admins read own company invoices"
      ON public.billing_invoices
      FOR SELECT
      USING (
        company_id IN (
          SELECT company_id FROM public.profiles WHERE id = auth.uid()
        )
      )
    $policy$;
  END IF;
END $$;
