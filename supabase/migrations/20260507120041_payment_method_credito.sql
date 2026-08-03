-- =====================================================================
-- Adiciona dois métodos de pagamento ao enum payment_method:
--   • credito_avista     — cartão de crédito pago em 1x
--   • credito_parcelado  — cartão de crédito parcelado (N parcelas)
--
-- ALTER TYPE ADD VALUE não roda dentro de transação no Postgres,
-- então cada um vai em comando separado, com IF NOT EXISTS pra ser
-- idempotente.
-- =====================================================================

alter type public.payment_method add value if not exists 'credito_avista';
alter type public.payment_method add value if not exists 'credito_parcelado';
