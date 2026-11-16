-- Private hospital documents attached to clinical guides.
-- Supported preview formats are enforced by the bucket MIME allow-list.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinical-content-files',
  'clinical-content-files',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.clinical_content_documents (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  guide_id     text not null,
  object_path  text not null unique,
  file_name    text not null,
  content_type text not null check (content_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/webp'
  )),
  file_size    bigint not null check (file_size between 1 and 26214400),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  check (object_path like (hospital_id::text || '/' || guide_id || '/%'))
);
create index if not exists clinical_content_documents_guide
  on public.clinical_content_documents(hospital_id, guide_id, created_at desc);

create or replace function public.clinical_content_documents_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.guide_can_approve(new.hospital_id) then
    raise exception 'Only an authorised clinical lead, consultant, head of department, pharmacist or administrator can attach files to clinical guides';
  end if;
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end $$;

drop trigger if exists trg_clinical_content_documents_before on public.clinical_content_documents;
create trigger trg_clinical_content_documents_before before insert on public.clinical_content_documents
  for each row execute function public.clinical_content_documents_before();

alter table public.clinical_content_documents enable row level security;
drop policy if exists clinical_content_documents_read on public.clinical_content_documents;
drop policy if exists clinical_content_documents_write on public.clinical_content_documents;
create policy clinical_content_documents_read on public.clinical_content_documents
  for select to authenticated using (public.pay_is_member(hospital_id));
create policy clinical_content_documents_write on public.clinical_content_documents
  for insert to authenticated with check (public.guide_can_approve(hospital_id));
drop policy if exists clinical_content_documents_delete on public.clinical_content_documents;
create policy clinical_content_documents_delete on public.clinical_content_documents
  for delete to authenticated using (public.guide_can_approve(hospital_id));

revoke all on public.clinical_content_documents from anon;
grant select, insert, delete on public.clinical_content_documents to authenticated;
grant all on public.clinical_content_documents to service_role;
revoke execute on function public.clinical_content_documents_before() from public, anon, authenticated;

drop policy if exists clinical_content_files_read on storage.objects;
create policy clinical_content_files_read on storage.objects
  for select to authenticated using (
    bucket_id = 'clinical-content-files'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.pay_is_member(((storage.foldername(name))[1])::uuid)
      else false
    end
  );
drop policy if exists clinical_content_files_insert on storage.objects;
create policy clinical_content_files_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'clinical-content-files'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.guide_can_approve(((storage.foldername(name))[1])::uuid)
      else false
    end
  );
drop policy if exists clinical_content_files_delete on storage.objects;
create policy clinical_content_files_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'clinical-content-files'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.guide_can_approve(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

