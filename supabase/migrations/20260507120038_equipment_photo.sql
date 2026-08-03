-- ============================================================================
-- Foto do equipamento (armazenada no MinIO via webhook do n8n)
-- ----------------------------------------------------------------------------
-- photo_url guarda a URL pública da imagem no MinIO (bucket services.infnity).
-- ============================================================================
alter table public.customer_equipments
  add column if not exists photo_url text;
