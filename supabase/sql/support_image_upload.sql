alter table public.support_messages
  add column if not exists attachment_url text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_size bigint;

insert into storage.buckets (id, name, public)
values ('support_uploads', 'support_uploads', true)
on conflict (id) do nothing;

create policy "support_uploads_public_read"
on storage.objects
for select
using (bucket_id = 'support_uploads');

create policy "support_uploads_authenticated_insert"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'support_uploads');

create policy "support_uploads_authenticated_update"
on storage.objects
for update
to authenticated
using (bucket_id = 'support_uploads')
with check (bucket_id = 'support_uploads');

create policy "support_uploads_authenticated_delete"
on storage.objects
for delete
to authenticated
using (bucket_id = 'support_uploads');
