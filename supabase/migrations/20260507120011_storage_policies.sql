-- =====================================================================
-- OSManager — Policies de Storage
-- Permite que usuários autenticados façam upload/update/delete nos
-- buckets product-images e os-attachments. Leitura é pública (buckets
-- foram criados como `public = true` no config.toml e seed.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- product-images
-- ---------------------------------------------------------------------
drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-images');

drop policy if exists "product_images_auth_insert" on storage.objects;
create policy "product_images_auth_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images');

drop policy if exists "product_images_auth_update" on storage.objects;
create policy "product_images_auth_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images');

drop policy if exists "product_images_auth_delete" on storage.objects;
create policy "product_images_auth_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images');

-- ---------------------------------------------------------------------
-- os-attachments
-- ---------------------------------------------------------------------
drop policy if exists "os_attach_public_read" on storage.objects;
create policy "os_attach_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'os-attachments');

drop policy if exists "os_attach_auth_insert" on storage.objects;
create policy "os_attach_auth_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'os-attachments');

drop policy if exists "os_attach_auth_update" on storage.objects;
create policy "os_attach_auth_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'os-attachments');

drop policy if exists "os_attach_auth_delete" on storage.objects;
create policy "os_attach_auth_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'os-attachments');
