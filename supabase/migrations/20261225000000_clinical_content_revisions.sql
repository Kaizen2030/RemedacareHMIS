-- Hospital-scoped editable revisions for the shipped clinical guides and references.
-- Revisions are limited to the same clinical roles that can approve guides.

create table if not exists public.clinical_content_revisions (
  hospital_id  uuid not null,
  content_type text not null check (content_type in ('guide', 'reference')),
  content_id   text not null,
  content      jsonb not null check (jsonb_typeof(content) = 'object'),
  revision     integer not null default 1 check (revision > 0),
  updated_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  primary key (hospital_id, content_type, content_id)
);

create or replace function public.clinical_content_revisions_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.guide_can_approve(new.hospital_id) then
    raise exception 'Only an authorised clinical lead, consultant, head of department, pharmacist or administrator can edit clinical content';
  end if;
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := old.revision + 1;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_clinical_content_revisions_before on public.clinical_content_revisions;
create trigger trg_clinical_content_revisions_before
  before insert or update on public.clinical_content_revisions
  for each row execute function public.clinical_content_revisions_before();

-- Every saved revision is kept (append-only), so the exact wording behind each approval can be shown later.
create table if not exists public.clinical_content_revision_history (
  id           bigserial primary key,
  hospital_id  uuid not null,
  content_type text not null,
  content_id   text not null,
  revision     integer not null,
  content      jsonb not null,
  updated_by   uuid,
  updated_at   timestamptz not null,
  unique (hospital_id, content_type, content_id, revision)
);

create or replace function public.clinical_content_revisions_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.clinical_content_revision_history(hospital_id, content_type, content_id, revision, content, updated_by, updated_at)
  values (new.hospital_id, new.content_type, new.content_id, new.revision, new.content, new.updated_by, new.updated_at)
  on conflict do nothing;
  return null;
end $$;

drop trigger if exists trg_clinical_content_revisions_after on public.clinical_content_revisions;
create trigger trg_clinical_content_revisions_after after insert or update on public.clinical_content_revisions
  for each row execute function public.clinical_content_revisions_after();

-- keep the current text of revisions saved before the history table existed
insert into public.clinical_content_revision_history(hospital_id, content_type, content_id, revision, content, updated_by, updated_at)
select hospital_id, content_type, content_id, revision, content, updated_by, updated_at from public.clinical_content_revisions
on conflict do nothing;

alter table public.clinical_content_revision_history enable row level security;
drop policy if exists clinical_content_revision_history_read on public.clinical_content_revision_history;
create policy clinical_content_revision_history_read on public.clinical_content_revision_history
  for select to authenticated using (public.pay_is_member(hospital_id));
revoke all on public.clinical_content_revision_history from anon, authenticated;
grant select on public.clinical_content_revision_history to authenticated;
grant all on public.clinical_content_revision_history to service_role;
revoke execute on function public.clinical_content_revisions_after() from public, anon, authenticated;

alter table public.clinical_content_revisions enable row level security;
drop policy if exists clinical_content_revisions_read on public.clinical_content_revisions;
drop policy if exists clinical_content_revisions_write on public.clinical_content_revisions;
create policy clinical_content_revisions_read on public.clinical_content_revisions
  for select to authenticated using (public.pay_is_member(hospital_id));
create policy clinical_content_revisions_write on public.clinical_content_revisions
  for all to authenticated using (public.guide_can_approve(hospital_id))
  with check (public.guide_can_approve(hospital_id));

revoke all on public.clinical_content_revisions from anon;
grant select, insert, update on public.clinical_content_revisions to authenticated;
grant all on public.clinical_content_revisions to service_role;
revoke execute on function public.clinical_content_revisions_before() from public, anon, authenticated;

