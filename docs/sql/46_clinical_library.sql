-- =============================================================================
-- RemedacareHMS - CLINICAL CONTENT CONTROL: EDITABLE CARE PATHWAYS, REMOVE / RESTORE / START FRESH, HOSPITAL LIBRARY (FILES UP TO 50 MB AND LINKS). THEN RUN 45 AGAIN
-- Generated from supabase/migrations/20261228000000_clinical_library.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.clinical_content_documents_before()') is null then
    raise exception 'Run 43_clinical_content_documents.sql first. Nothing was changed.';
  end if;
end $$;

alter table public.clinical_content_revisions drop constraint if exists clinical_content_revisions_content_type_check;
alter table public.clinical_content_revisions add constraint clinical_content_revisions_content_type_check
  check (content_type in ('guide', 'reference', 'pathway', 'setting'));

create or replace function public.clinical_content_revisions_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.guide_can_approve(old.hospital_id) then
    raise exception 'Only an authorised clinical lead, consultant, head of department, pharmacist or administrator can delete clinical content';
  end if;
  insert into public.clinical_content_revision_history(hospital_id, content_type, content_id, revision, content, updated_by, updated_at)
  values (old.hospital_id, old.content_type, old.content_id, old.revision + 1,
          jsonb_build_object('deleted', true, 'previous', old.content), auth.uid(), now())
  on conflict do nothing;
  return old;
end $$;
drop trigger if exists trg_clinical_content_revisions_deleted on public.clinical_content_revisions;
create trigger trg_clinical_content_revisions_deleted before delete on public.clinical_content_revisions
  for each row execute function public.clinical_content_revisions_deleted();
revoke execute on function public.clinical_content_revisions_deleted() from public, anon, authenticated;
grant delete on public.clinical_content_revisions to authenticated;

alter table public.clinical_content_documents add column if not exists title       text;
alter table public.clinical_content_documents add column if not exists category    text;
alter table public.clinical_content_documents add column if not exists description text;
alter table public.clinical_content_documents add column if not exists tags        text[] not null default '{}';
alter table public.clinical_content_documents add column if not exists kind        text not null default 'file';
alter table public.clinical_content_documents add column if not exists link_url    text;
alter table public.clinical_content_documents add column if not exists updated_at  timestamptz;
alter table public.clinical_content_documents alter column object_path drop not null;
alter table public.clinical_content_documents alter column content_type drop not null;
alter table public.clinical_content_documents alter column file_size drop not null;
alter table public.clinical_content_documents drop constraint if exists clinical_content_documents_file_size_check;
alter table public.clinical_content_documents add constraint clinical_content_documents_file_size_check
  check (file_size is null or file_size between 1 and 52428800);
alter table public.clinical_content_documents drop constraint if exists clinical_content_documents_kind_check;
alter table public.clinical_content_documents add constraint clinical_content_documents_kind_check check (
  (kind = 'file' and object_path is not null and content_type is not null and file_size is not null and link_url is null)
  or (kind = 'link' and object_path is null and link_url is not null
      and coalesce(link_url ~* '^https?://[^\s]+$' and length(link_url) <= 2000, false)));
alter table public.clinical_content_documents drop constraint if exists clinical_content_documents_text_check;
alter table public.clinical_content_documents add constraint clinical_content_documents_text_check check (
  coalesce(length(title), 0) <= 300 and coalesce(length(category), 0) <= 100 and coalesce(length(description), 0) <= 4000
  and cardinality(tags) <= 30);
alter table public.clinical_content_documents drop constraint if exists clinical_content_documents_guide_check;
alter table public.clinical_content_documents add constraint clinical_content_documents_guide_check
  check (guide_id ~ '^[A-Za-z0-9_.:-]{1,120}$');
create index if not exists clinical_content_documents_library
  on public.clinical_content_documents(hospital_id, category) where guide_id = '_library';

update storage.buckets set file_size_limit = 52428800 where id = 'clinical-content-files';

create or replace function public.clinical_content_documents_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.guide_can_approve(old.hospital_id) then
    raise exception 'Only an authorised clinical lead, consultant, head of department, pharmacist or administrator can edit library entries';
  end if;
  if new.hospital_id is distinct from old.hospital_id or new.object_path is distinct from old.object_path
     or new.kind is distinct from old.kind or new.content_type is distinct from old.content_type
     or new.file_size is distinct from old.file_size or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the title, category, tags, description, link and guide of a library entry can be changed';
  end if;
  if new.kind = 'file' and new.guide_id is distinct from old.guide_id then
    raise exception 'A stored file cannot be moved to another guide; upload it again there';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_clinical_content_documents_update on public.clinical_content_documents;
create trigger trg_clinical_content_documents_update before update on public.clinical_content_documents
  for each row execute function public.clinical_content_documents_update();
revoke execute on function public.clinical_content_documents_update() from public, anon, authenticated;

drop policy if exists clinical_content_documents_update on public.clinical_content_documents;
create policy clinical_content_documents_update on public.clinical_content_documents
  for update to authenticated using (public.guide_can_approve(hospital_id)) with check (public.guide_can_approve(hospital_id));
grant update (title, category, description, tags, link_url, guide_id) on public.clinical_content_documents to authenticated;

commit;

select 'pathways and settings allowed' as check_name, case when pg_get_constraintdef((select oid from pg_constraint where conname = 'clinical_content_revisions_content_type_check')) ~ 'pathway' and has_table_privilege('authenticated', 'public.clinical_content_revisions', 'delete') then 'OK' else 'PROBLEM' end as result
    union all select 'library and links', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinical_content_documents' and column_name = 'link_url') and (select file_size_limit from storage.buckets where id = 'clinical-content-files') = 52428800 then 'OK' else 'PROBLEM' end;
