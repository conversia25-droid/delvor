-- =====================================================================
-- OSManager — Bucket e policies pra logos das empresas
-- (também usado nos PDFs de OS e venda)
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', true)
on conflict (id) do nothing;

drop policy if exists "company_logos_public_read" on storage.objects;
create policy "company_logos_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'company-logos');

drop policy if exists "company_logos_admin_write" on storage.objects;
create policy "company_logos_admin_write"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'company-logos')
  with check (bucket_id = 'company-logos');
