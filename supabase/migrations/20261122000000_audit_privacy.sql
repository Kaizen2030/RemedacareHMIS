-- =============================================================================
-- RemedacareHMS — audit trail, access logging, break-glass and Data Protection Act requests
--   audit_log          becomes append-only (no edits or deletes, even through the API); every row is
--                      stamped with the real user id / email; readable by admins only
--   change audit       insert / update / delete on clinical tables is written to audit_log by trigger
--                      (which fields changed, old → new), so it cannot be skipped by a screen
--   patient_access_log who opened / printed / exported which patient, when and from which screen
--   confidential patients  opening one needs a stated reason (break-glass, valid 2 h), logged for review
--   data_subject_requests  access / correction / erasure requests with due dates; admin export of all of a
--                      patient's data, and de-identification of contact details (clinical records are kept —
--                      medical-record retention law applies)
-- Requires 20261114000000_payments_ledger.sql. Safe to re-run.
-- =============================================================================

create or replace function public.ref_try_uuid(p text)
returns uuid language sql immutable as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

create or replace function public.priv_is_admin(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.member and c.canonical = 'admin' from public.pay_user_context(p_hospital, auth.uid()) c), false)
$$;

-- ---------------------------------------------------------------- 1. append-only audit log
alter table public.audit_log add column if not exists user_id uuid;
alter table public.audit_log add column if not exists user_email text;

create or replace function public.audit_log_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if coalesce(current_setting('app.audit_maintenance', true), '') <> 'on' then
      raise exception 'The audit log is append-only';
    end if;
    return coalesce(new, old);
  end if;
  new.user_id := coalesce(auth.uid(), new.user_id);
  if new.user_email is null and auth.uid() is not null then
    select lower(email) into new.user_email from auth.users where id = auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists trg_audit_log_guard on public.audit_log;
create trigger trg_audit_log_guard before insert or update or delete on public.audit_log
  for each row execute function public.audit_log_guard();

alter table public.audit_log enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'audit_log' loop
    execute format('drop policy if exists %I on public.audit_log', p.policyname);
  end loop;
end $$;
create policy audit_log_insert_member on public.audit_log for insert
  with check (public.ref_try_uuid(hospital_id::text) is not null and public.pay_is_member(public.ref_try_uuid(hospital_id::text)));
create policy audit_log_read_admin on public.audit_log for select
  using (public.ref_try_uuid(hospital_id::text) is not null and public.priv_is_admin(public.ref_try_uuid(hospital_id::text)));
revoke update, delete on public.audit_log from anon, authenticated;
grant select, insert on public.audit_log to authenticated;

-- ---------------------------------------------------------------- 2. change audit on clinical tables
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; v_h uuid; v_changes jsonb := '{}'; k text; v_id uuid;
begin
  o := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_h := public.ref_try_uuid(coalesce(n, o)->>'hospital_id');
  if v_h is null then return null; end if;
  v_id := public.ref_try_uuid(coalesce(n, o)->>'id');
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at', 'last_checked_at', 'search_text') and (n->k) is distinct from (o->k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', left(coalesce(o->>k, ''), 300), 'to', left(coalesce(n->>k, ''), 300)));
      end if;
    end loop;
    if v_changes = '{}' then return null; end if;
  end if;
  perform public.payments_audit(v_h, lower(tg_op) || ':' || tg_table_name, v_id,
    case tg_op when 'UPDATE' then jsonb_build_object('changes', v_changes)
               when 'DELETE' then jsonb_build_object('deleted_row', o)
               else jsonb_build_object('created', true) end);
  return null;
exception when others then
  raise warning 'audit_row_change skipped: %', sqlerrm;   -- auditing must never block clinical work
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['patients', 'visits', 'consultations', 'prescriptions', 'lab_tests', 'admissions', 'staff',
                           'hiv_art', 'tb_episodes', 'anc_pregnancies', 'deliveries', 'ncd_enrolments', 'mar_doses'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_audit_change on public.%I', t);
      execute format('create trigger trg_audit_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- 3. access log, confidential patients, break-glass
alter table public.patients add column if not exists confidential boolean not null default false;

create table if not exists public.patient_access_log (
  id          bigserial primary key,
  hospital_id uuid not null,
  patient_id  uuid not null,
  user_id     uuid not null,
  user_email  text,
  user_role   text,
  action      text not null check (action in ('view', 'print', 'export', 'break_glass', 'anonymise')),
  context     text,
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists patient_access_log_patient on public.patient_access_log(hospital_id, patient_id, created_at desc);
create index if not exists patient_access_log_user on public.patient_access_log(hospital_id, user_id, created_at desc);

create or replace function public.patient_access_log_guard()
returns trigger language plpgsql as $$
begin raise exception 'The access log is append-only'; end $$;
drop trigger if exists trg_patient_access_log_guard on public.patient_access_log;
create trigger trg_patient_access_log_guard before update or delete on public.patient_access_log
  for each row execute function public.patient_access_log_guard();

/**
 * Record that the current user opened / printed / exported a patient. For a confidential patient a
 * non-admin must state a reason first (break-glass, valid 2 hours). Returns { allowed, needs_reason }.
 */
create or replace function public.log_patient_access(p_hospital uuid, p_patient uuid, p_action text default 'view',
                                                     p_context text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_conf boolean; v_role text; v_email text; v_ok boolean;
begin
  if v_uid is null or not public.pay_is_member(p_hospital) then raise exception 'Not a member of this hospital'; end if;
  if p_action not in ('view', 'print', 'export', 'break_glass') then raise exception 'Unknown access action'; end if;
  select coalesce(p.confidential, false) into v_conf from public.patients p where p.id = p_patient and p.hospital_id = p_hospital;
  if v_conf is null then raise exception 'Patient not found in this hospital'; end if;
  v_role := public.pay_member_role(p_hospital);
  select lower(email) into v_email from auth.users where id = v_uid;

  if p_action = 'break_glass' then
    if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Give a clear reason (at least 10 characters)'; end if;
    insert into public.patient_access_log(hospital_id, patient_id, user_id, user_email, user_role, action, context, reason)
    values (p_hospital, p_patient, v_uid, v_email, v_role, 'break_glass', p_context, trim(p_reason));
    return jsonb_build_object('allowed', true, 'expires_at', now() + interval '2 hours');
  end if;

  v_ok := not v_conf or public.priv_is_admin(p_hospital) or exists (
    select 1 from public.patient_access_log l where l.patient_id = p_patient and l.user_id = v_uid
       and l.action = 'break_glass' and l.created_at > now() - interval '2 hours');
  if not v_ok then return jsonb_build_object('allowed', false, 'needs_reason', true); end if;

  -- one 'view' per user / patient / screen per 10 minutes keeps the log readable
  if p_action <> 'view' or not exists (select 1 from public.patient_access_log l where l.patient_id = p_patient and l.user_id = v_uid
       and l.action = 'view' and coalesce(l.context, '') = coalesce(p_context, '') and l.created_at > now() - interval '10 minutes') then
    insert into public.patient_access_log(hospital_id, patient_id, user_id, user_email, user_role, action, context, reason)
    values (p_hospital, p_patient, v_uid, v_email, v_role, p_action, p_context, nullif(trim(coalesce(p_reason, '')), ''));
  end if;
  return jsonb_build_object('allowed', true);
end $$;

-- ---------------------------------------------------------------- 4. Data Protection Act requests
create table if not exists public.data_subject_requests (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  patient_id    uuid not null,
  request_type  text not null check (request_type in ('access', 'correction', 'erasure', 'objection', 'portability')),
  received_on   date not null default current_date,
  due_on        date not null default (current_date + 7),
  status        text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'refused')),
  verified_identity boolean not null default false,
  details       text,
  outcome       text,
  handled_by    uuid default auth.uid(),
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

/** Everything held about a patient, as JSON (admin only, logged as an export). */
create or replace function public.dsr_export_patient(p_hospital uuid, p_patient uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_out jsonb := '{}'; t text; v_rows jsonb;
begin
  if not public.priv_is_admin(p_hospital) then raise exception 'Only an administrator can export a patient''s data'; end if;
  if not exists (select 1 from public.patients where id = p_patient and hospital_id = p_hospital) then raise exception 'Patient not found'; end if;
  select to_jsonb(p) into v_rows from public.patients p where p.id = p_patient;
  v_out := jsonb_build_object('patient', v_rows, 'exported_at', now());
  foreach t in array array['visits', 'vitals', 'consultations', 'prescriptions', 'lab_tests', 'radiology_orders', 'admissions', 'appointments',
                           'invoices', 'payments', 'ncd_enrolments', 'ncd_visits', 'hiv_art', 'tb_episodes', 'anc_pregnancies', 'deliveries',
                           'pnc_visits', 'immunisations', 'referrals', 'patient_access_log'] loop
    if to_regclass('public.' || t) is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'patient_id') then
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from (select * from public.%I where patient_id::text = $1 limit 5000) x', t) into v_rows using p_patient::text;
      v_out := v_out || jsonb_build_object(t, v_rows);
    end if;
  end loop;
  insert into public.patient_access_log(hospital_id, patient_id, user_id, user_email, user_role, action, context)
  values (p_hospital, p_patient, auth.uid(), (select lower(email) from auth.users where id = auth.uid()), public.pay_member_role(p_hospital), 'export', 'data subject request');
  return v_out;
end $$;

/** Erasure request: remove contact / identity details that are not part of the clinical record. */
create or replace function public.dsr_deidentify_patient(p_hospital uuid, p_patient uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c text; v_cleared text[] := '{}';
begin
  if not public.priv_is_admin(p_hospital) then raise exception 'Only an administrator can process an erasure request'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Record the request reference / reason'; end if;
  foreach c in array array['phone', 'alt_phone', 'email', 'address', 'physical_address', 'postal_address', 'residence', 'national_id', 'id_number',
                           'passport_number', 'next_of_kin', 'next_of_kin_name', 'next_of_kin_phone', 'next_of_kin_relationship', 'employer', 'photo_url'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'patients' and column_name = c) then
      execute format('update public.patients set %I = null where id = $1 and hospital_id = $2', c) using p_patient, p_hospital;
      v_cleared := v_cleared || c;
    end if;
  end loop;
  update public.patients set confidential = true where id = p_patient and hospital_id = p_hospital;
  insert into public.patient_access_log(hospital_id, patient_id, user_id, user_email, user_role, action, context, reason)
  values (p_hospital, p_patient, auth.uid(), (select lower(email) from auth.users where id = auth.uid()), public.pay_member_role(p_hospital), 'anonymise', 'data subject request', trim(p_reason));
  return jsonb_build_object('cleared', v_cleared, 'kept', 'clinical records (legal retention)');
end $$;

-- ---------------------------------------------------------------- security
alter table public.patient_access_log enable row level security;
alter table public.data_subject_requests enable row level security;
drop policy if exists patient_access_log_admin on public.patient_access_log;
create policy patient_access_log_admin on public.patient_access_log for select using (public.priv_is_admin(hospital_id));
drop policy if exists dsr_admin on public.data_subject_requests;
create policy dsr_admin on public.data_subject_requests for all using (public.priv_is_admin(hospital_id)) with check (public.priv_is_admin(hospital_id));
grant select on public.patient_access_log to authenticated;
revoke insert, update, delete on public.patient_access_log from anon, authenticated;
grant select, insert, update on public.data_subject_requests to authenticated;
grant all on public.patient_access_log, public.data_subject_requests to service_role;
grant usage, select on sequence public.patient_access_log_id_seq to service_role;

revoke execute on function public.audit_row_change(), public.audit_log_guard() from public, anon, authenticated;
grant execute on function public.log_patient_access(uuid, uuid, text, text, text), public.dsr_export_patient(uuid, uuid),
  public.dsr_deidentify_patient(uuid, uuid, text), public.priv_is_admin(uuid), public.ref_try_uuid(text) to authenticated, service_role;
