-- =============================================================================
-- RemedacareHMS - DEPARTMENT SERVICES (ADD, EDIT, RETIRE, DELETE; ONLY ADMIN OR FINANCE CHANGE PRICES) AND DEPARTMENT PROTOCOLS (DOCUMENTS, RULES, REVISIONS, WHO HAS READ THEM)
-- Generated from supabase/migrations/20261231300000_department_services_protocols.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.dept_manages(uuid,text,text)') is null then
    raise exception 'Run 51_department_control.sql first. Nothing was changed.';
  end if;
end $$;

do $$ begin
  if to_regprocedure('public.dept_manages(uuid,text,text)') is null then raise exception 'Run 51_department_control.sql first. Nothing was changed.'; end if;
  if to_regclass('public.charge_codes') is null then raise exception 'The charge_codes table is missing. Run 14_configuration.sql first. Nothing was changed.'; end if;
end $$;

alter table public.charge_codes add column if not exists description    text;
alter table public.charge_codes add column if not exists department     text;
alter table public.charge_codes add column if not exists category       text;
alter table public.charge_codes add column if not exists is_active      boolean default true;
alter table public.charge_codes add column if not exists retired_reason text;
alter table public.charge_codes add column if not exists retired_at     timestamptz;

create or replace function public.services_can_manage(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.priv_is_admin(p_hospital), false) or coalesce(public.can_manage_payments(p_hospital), false)
$$;

create or replace function public.charge_codes_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.name := nullif(trim(coalesce(new.name, '')), '');
  new.code := upper(nullif(trim(coalesce(new.code, '')), ''));
  if new.name is null then raise exception 'Give the service a name'; end if;
  if new.code is null then raise exception 'Give the service a code'; end if;
  if coalesce(new.unit_price_kes, 0) < 0 then raise exception 'The price cannot be negative'; end if;
  if new.department is not null and to_regprocedure('public.department_canonical(text)') is not null then
    new.department := public.department_canonical(new.department);
  end if;
  if exists (select 1 from public.charge_codes c where c.hospital_id::text = new.hospital_id::text and upper(c.code) = new.code and c.id <> new.id) then
    raise exception 'The code % is already used by another service', new.code;
  end if;
  if coalesce(new.is_active, true) then new.retired_reason := null; new.retired_at := null;
  elsif tg_op = 'INSERT' or coalesce(old.is_active, true) then new.retired_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_charge_codes_before on public.charge_codes;
create trigger trg_charge_codes_before before insert or update on public.charge_codes for each row execute function public.charge_codes_before();

create or replace function public.service_remove(p_id uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare c record; billed boolean := false;
begin
  select * into c from public.charge_codes where id = p_id;
  if not found then raise exception 'That service no longer exists'; end if;
  if not public.services_can_manage(public.ref_try_uuid(c.hospital_id::text)) then
    raise exception 'Only an administrator or a finance manager can remove services';
  end if;
  if to_regclass('public.invoices') is not null then
    execute 'select exists (select 1 from public.invoices i where i.hospital_id::text = $1 and strpos(upper(i::text), $2) > 0)'
      into billed using c.hospital_id::text, upper(c.code);
  end if;
  if billed then
    update public.charge_codes set is_active = false, retired_reason = coalesce(nullif(trim(p_reason), ''), 'Removed from the price list') where id = p_id;
    return 'retired';
  end if;
  delete from public.charge_codes where id = p_id;
  return 'deleted';
end $$;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'charge_codes' loop
    execute format('drop policy %I on public.charge_codes', p.policyname);
  end loop;
end $$;
alter table public.charge_codes enable row level security;
create policy charge_codes_read on public.charge_codes for select to authenticated
  using (public.pay_is_member(public.ref_try_uuid(hospital_id::text)));
create policy charge_codes_write on public.charge_codes for all to authenticated
  using (public.services_can_manage(public.ref_try_uuid(hospital_id::text)))
  with check (public.services_can_manage(public.ref_try_uuid(hospital_id::text)));
revoke all on public.charge_codes from anon;
grant select, insert, update, delete on public.charge_codes to authenticated;
grant all on public.charge_codes to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('department-documents', 'department-documents', false, 26214400, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel', 'text/csv', 'text/plain', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.department_documents (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  department    text not null,
  title         text not null,
  kind          text not null default 'protocol' check (kind in ('protocol', 'sop', 'policy', 'rules', 'form', 'other')),
  summary       text,
  body          text,
  file_path     text,
  file_name     text,
  file_type     text,
  file_size     bigint,
  revision      integer not null default 1,
  version_label text,
  effective_on  date,
  review_on     date,
  must_read     boolean not null default true,
  status        text not null default 'active' check (status in ('active', 'archived')),
  change_note   text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_by    uuid,
  updated_at    timestamptz not null default now()
);
create index if not exists department_documents_dept on public.department_documents(hospital_id, lower(department), status);

create table if not exists public.department_document_history (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.department_documents(id) on delete cascade,
  hospital_id  uuid not null,
  revision     integer not null,
  title        text,
  body         text,
  file_path    text,
  file_name    text,
  version_label text,
  change_note  text,
  changed_by   uuid,
  changed_at   timestamptz not null default now()
);
create index if not exists department_document_history_doc on public.department_document_history(document_id, revision desc);

create table if not exists public.department_document_reads (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.department_documents(id) on delete cascade,
  hospital_id uuid not null,
  revision    integer not null,
  user_id     uuid not null default auth.uid(),
  staff_id    uuid,
  read_at     timestamptz not null default now()
);
create unique index if not exists department_document_reads_once on public.department_document_reads(document_id, revision, user_id);

create or replace function public.dept_can_publish(p_hospital uuid, p_department text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.dept_manages(p_hospital, p_department, 'roster') or coalesce(public.priv_is_admin(p_hospital), false)
$$;

create or replace function public.department_documents_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.department := public.department_canonical(new.department);
  new.title := nullif(trim(coalesce(new.title, '')), '');
  if coalesce(new.department, '') = '' then raise exception 'Choose the department'; end if;
  if new.title is null then raise exception 'Give the document a title'; end if;
  if new.review_on is not null and new.effective_on is not null and new.review_on < new.effective_on then raise exception 'The review date is before the start date'; end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now(); new.revision := 1;
  else
    if new.department is distinct from old.department or new.hospital_id is distinct from old.hospital_id then
      raise exception 'A document stays in its department; add it again in the other department';
    end if;
    new.created_by := old.created_by; new.created_at := old.created_at;
    if (new.title, coalesce(new.body, ''), coalesce(new.file_path, '')) is distinct from (old.title, coalesce(old.body, ''), coalesce(old.file_path, '')) then
      if not (old.file_path is null and coalesce(old.body, '') = '' and old.revision = 1 and new.title = old.title and coalesce(new.body, '') = '') then
        insert into public.department_document_history(document_id, hospital_id, revision, title, body, file_path, file_name, version_label, change_note, changed_by)
        values (old.id, old.hospital_id, old.revision, old.title, old.body, old.file_path, old.file_name, old.version_label, old.change_note, auth.uid());
        new.revision := old.revision + 1;
      else
        new.revision := old.revision;
      end if;
    else
      new.revision := old.revision;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_department_documents_before on public.department_documents;
create trigger trg_department_documents_before before insert or update on public.department_documents
  for each row execute function public.department_documents_before();

create or replace function public.department_document_reads_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.department_documents where id = new.document_id;
  if not found then raise exception 'That document no longer exists'; end if;
  new.hospital_id := d.hospital_id;
  new.revision := d.revision;
  new.user_id := auth.uid();
  new.staff_id := public.hr_my_staff_id(d.hospital_id);
  new.read_at := now();
  return new;
end $$;
drop trigger if exists trg_department_document_reads_before on public.department_document_reads;
create trigger trg_department_document_reads_before before insert on public.department_document_reads
  for each row execute function public.department_document_reads_before();

alter table public.department_documents enable row level security;
alter table public.department_document_history enable row level security;
alter table public.department_document_reads enable row level security;
drop policy if exists department_documents_read on public.department_documents;
drop policy if exists department_documents_write on public.department_documents;
drop policy if exists department_document_history_read on public.department_document_history;
drop policy if exists department_document_reads_read on public.department_document_reads;
drop policy if exists department_document_reads_add on public.department_document_reads;
create policy department_documents_read on public.department_documents for select to authenticated using (public.pay_is_member(hospital_id));
create policy department_documents_write on public.department_documents for all to authenticated
  using (public.dept_can_publish(hospital_id, department)) with check (public.dept_can_publish(hospital_id, department));
create policy department_document_history_read on public.department_document_history for select to authenticated using (public.pay_is_member(hospital_id));
create policy department_document_reads_read on public.department_document_reads for select to authenticated using (public.pay_is_member(hospital_id));
create policy department_document_reads_add on public.department_document_reads for insert to authenticated
  with check (public.pay_is_member(hospital_id) and user_id = auth.uid());
revoke all on public.department_documents, public.department_document_history, public.department_document_reads from anon;
grant select, insert, update, delete on public.department_documents to authenticated;
grant select on public.department_document_history to authenticated;
grant select, insert on public.department_document_reads to authenticated;
grant all on public.department_documents, public.department_document_history, public.department_document_reads to service_role;

drop policy if exists department_documents_files_read on storage.objects;
create policy department_documents_files_read on storage.objects for select to authenticated using (
  bucket_id = 'department-documents' and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.pay_is_member(((storage.foldername(name))[1])::uuid) else false end);
drop policy if exists department_documents_files_insert on storage.objects;
create policy department_documents_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'department-documents' and exists (
    select 1 from public.department_documents d
     where d.id::text = (storage.foldername(name))[2] and d.hospital_id::text = (storage.foldername(name))[1]
       and public.dept_can_publish(d.hospital_id, d.department)));
drop policy if exists department_documents_files_delete on storage.objects;
create policy department_documents_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'department-documents' and exists (
    select 1 from public.department_documents d
     where d.id::text = (storage.foldername(name))[2] and d.hospital_id::text = (storage.foldername(name))[1]
       and public.dept_can_publish(d.hospital_id, d.department)));

revoke execute on function public.charge_codes_before(), public.department_documents_before(), public.department_document_reads_before() from public, anon, authenticated;
revoke execute on function public.services_can_manage(uuid), public.service_remove(uuid, text), public.dept_can_publish(uuid, text) from public, anon;
grant execute on function public.services_can_manage(uuid), public.service_remove(uuid, text), public.dept_can_publish(uuid, text) to authenticated, service_role;

commit;

select 'price list protected' as check_name, case when exists (select 1 from pg_policies where tablename = 'charge_codes' and policyname = 'charge_codes_write') and not exists (select 1 from pg_policies where tablename = 'charge_codes' and policyname not in ('charge_codes_read', 'charge_codes_write')) then 'OK' else 'PROBLEM' end as result
    union all select 'department protocols', case when to_regclass('public.department_documents') is not null and to_regclass('public.department_document_reads') is not null then 'OK' else 'PROBLEM' end
    union all select 'protocol file storage (private)', case when exists (select 1 from storage.buckets where id = 'department-documents' and not public) then 'OK' else 'PROBLEM' end;
