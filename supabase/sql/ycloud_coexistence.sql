-- YCloud Coexistence Mode: status do pareamento por QR Code
-- Cada numero (ycloud_phone_numbers) pode estar em 4 estados:
--   unlinked  - ainda nao pareado via Coexistence
--   pending   - QR foi gerado, aguardando o cliente escanear
--   linked    - pareado, recebendo/enviando via API
--   failed    - tentativa de pareamento falhou (QR expirou, etc)

alter table public.ycloud_phone_numbers
  add column if not exists coexistence_status text not null default 'unlinked';

-- Drop e recria a constraint pra cobrir os 4 estados
alter table public.ycloud_phone_numbers
  drop constraint if exists ycloud_phone_numbers_coexistence_status_check;

alter table public.ycloud_phone_numbers
  add constraint ycloud_phone_numbers_coexistence_status_check
  check (coexistence_status in ('unlinked', 'pending', 'linked', 'failed'));

alter table public.ycloud_phone_numbers
  add column if not exists coexistence_linked_at timestamptz;

alter table public.ycloud_phone_numbers
  add column if not exists coexistence_pending_at timestamptz;

NOTIFY pgrst, 'reload schema';
