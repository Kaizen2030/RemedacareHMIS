-- Hospital control over clinical content: care pathways become editable like guides, built-in items can be removed
-- (hidden) or the whole set started fresh for a new hospital, hospital-written items can be deleted, and a hospital
-- library holds documents and links that are not tied to one guide.
--   clinical_content_revisions: content_type adds 'pathway' and 'setting'; delete allowed for approvers, with a
--     tombstone written to the append-only history so a deleted wording is never lost.
--   clinical_content_documents: library entries (guide_id '_library'), titles / category / tags / description,
--     link entries (no file), files up to 50 MB, metadata editable by approvers.

alter table public.clinical_content_revisions drop constraint if exists clinical_content_revisions_content_type_check;
alter table public.clinical_content_revisions add constraint clinical_content_revisions_content_type_check
  check (content_type in ('guide', 'reference', 'pathway', 'setting'));

-- A delete keeps a tombstone in the history (revision + 1) with the wording that was removed.
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

-- Library entries and link entries
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

-- Approvers may correct the title, category, tags and description; the file itself and its owner never change.
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
