-- =====================================================================
-- Bucket privado dos anexos do financeiro (boleto, comprovante, nota)
--
-- Separado da 58 de propósito: política de storage é a parte que mais
-- falha em ambiente diferente; se falhar aqui, a 58 continua aplicada.
--
-- Caminho do arquivo: <company_id>/<entity>/<entity_id>/<uuid>-<nome>
-- Acesso: só quem tem acesso ao financeiro e só na pasta da própria
-- empresa. Download sempre por URL assinada (bucket NÃO é público).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'finance-files', 'finance-files', false, 15728640,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "finance_files_select" on storage.objects;
create policy "finance_files_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'finance-files'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.has_financial_access()
  );

drop policy if exists "finance_files_insert" on storage.objects;
create policy "finance_files_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'finance-files'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.has_financial_access()
  );

drop policy if exists "finance_files_delete" on storage.objects;
create policy "finance_files_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'finance-files'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and public.has_financial_access()
  );
