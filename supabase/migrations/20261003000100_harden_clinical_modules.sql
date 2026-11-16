create or replace function public.can_access_hospital_workflow_module(module_code text, user_role text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when lower(coalesce(user_role, '')) in ('admin', 'administrator') then true
    when module_code = 'payroll' then lower(coalesce(user_role, '')) in ('accountant', 'finance officer')
    when module_code = 'procurement' then lower(coalesce(user_role, '')) in ('accountant', 'finance officer', 'pharmacist', 'senior pharmacist', 'pharmaceutical technologist', 'pharmacy technician')
    when module_code = 'biomedical' then lower(coalesce(user_role, '')) in ('lab technician', 'lab scientist', 'medical laboratory technician', 'mlt', 'microbiologist', 'biomedical engineer')
    when module_code = 'hivtb' then lower(coalesce(user_role, '')) in ('doctor', 'nurse', 'midwife', 'clinical officer', 'medical officer', 'consultant', 'specialist', 'general practitioner', 'nursing officer', 'senior nursing officer', 'registered nurse', 'nursing officer i', 'nursing officer ii')
    when module_code = 'quality-safety' then lower(coalesce(user_role, '')) in ('doctor', 'nurse', 'midwife', 'clinical officer', 'medical officer', 'consultant', 'specialist', 'general practitioner', 'nursing officer', 'senior nursing officer', 'registered nurse', 'nursing officer i', 'nursing officer ii', 'accountant', 'finance officer', 'quality officer')
    when module_code = 'blood-bank' then lower(coalesce(user_role, '')) in ('lab technician', 'lab scientist', 'medical laboratory technician', 'mlt', 'microbiologist', 'transfusion officer')
    when module_code = 'morgue' then lower(coalesce(user_role, '')) in ('doctor', 'nurse', 'midwife', 'clinical officer', 'medical officer', 'consultant', 'specialist', 'general practitioner', 'nursing officer', 'senior nursing officer', 'registered nurse', 'nursing officer i', 'nursing officer ii', 'mortuary attendant')
    else lower(coalesce(user_role, '')) in ('doctor', 'nurse', 'midwife', 'clinical officer', 'medical officer', 'consultant', 'specialist', 'general practitioner', 'nursing officer', 'senior nursing officer', 'registered nurse', 'nursing officer i', 'nursing officer ii')
  end;
$$;

grant execute on function public.can_access_hospital_workflow_module(text, text) to authenticated;

alter table public.hospital_workflow_records
  add column if not exists visit_id uuid;

alter table public.hospital_workflow_records
  drop constraint if exists hospital_workflow_records_patient_id_fkey;
alter table public.hospital_workflow_records
  add constraint hospital_workflow_records_patient_id_fkey
  foreign key (patient_id) references public.patients(id) on delete restrict;
alter table public.hospital_workflow_records
  add constraint hospital_workflow_records_visit_id_fkey
  foreign key (visit_id) references public.visits(id) on delete restrict;

create index if not exists hospital_workflow_records_hospital_visit_idx
  on public.hospital_workflow_records (hospital_id, visit_id)
  where visit_id is not null;

drop policy if exists "Active hospital members can read workflow records" on public.hospital_workflow_records;
drop policy if exists "Authorized hospital staff can add workflow records" on public.hospital_workflow_records;
drop policy if exists "Authorized hospital staff can update workflow records" on public.hospital_workflow_records;

create policy "Active authorized staff can read workflow records"
  on public.hospital_workflow_records for select to authenticated
  using (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = hospital_workflow_records.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and public.can_access_hospital_workflow_module(hospital_workflow_records.module_code, hu.role)
  ));

create policy "Active authorized staff can add workflow records"
  on public.hospital_workflow_records for insert to authenticated
  with check (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = hospital_workflow_records.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and public.can_access_hospital_workflow_module(hospital_workflow_records.module_code, hu.role)
  ));

create policy "Active authorized staff can update workflow records"
  on public.hospital_workflow_records for update to authenticated
  using (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = hospital_workflow_records.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and public.can_access_hospital_workflow_module(hospital_workflow_records.module_code, hu.role)
  ))
  with check (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = hospital_workflow_records.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and public.can_access_hospital_workflow_module(hospital_workflow_records.module_code, hu.role)
  ));

alter table public.hospital_workflow_records
  drop constraint if exists hospital_workflow_records_status_check;
alter table public.hospital_workflow_records
  add constraint hospital_workflow_records_status_check
  check (status in ('Open', 'Pending', 'In Progress', 'Completed', 'Release Requested', 'Released', 'Received', 'Cancelled'));

alter table public.blood_bank_units
  add column if not exists created_by uuid,
  add column if not exists issued_to_patient_id uuid references public.patients(id) on delete restrict,
  add column if not exists issued_by uuid,
  add column if not exists issued_at timestamptz;

drop policy if exists "Blood bank staff can add units" on public.blood_bank_units;
drop policy if exists "Blood bank staff can update units" on public.blood_bank_units;

create policy "Authorized blood bank staff can add units"
  on public.blood_bank_units for insert to authenticated
  with check (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = blood_bank_units.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and public.can_access_hospital_workflow_module('blood-bank', hu.role)
  ));

create policy "Authorized blood bank staff can update units"
  on public.blood_bank_units for update to authenticated
  using (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = blood_bank_units.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and public.can_access_hospital_workflow_module('blood-bank', hu.role)
  ))
  with check (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = blood_bank_units.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and public.can_access_hospital_workflow_module('blood-bank', hu.role)
  ));

create or replace function public.blood_groups_compatible(donor_group text, recipient_group text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case upper(replace(coalesce(donor_group, ''), ' ', ''))
    when 'O-' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')
    when 'O+' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('O+', 'A+', 'B+', 'AB+')
    when 'A-' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('A-', 'A+', 'AB-', 'AB+')
    when 'A+' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('A+', 'AB+')
    when 'B-' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('B-', 'B+', 'AB-', 'AB+')
    when 'B+' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('B+', 'AB+')
    when 'AB-' then upper(replace(coalesce(recipient_group, ''), ' ', '')) in ('AB-', 'AB+')
    when 'AB+' then upper(replace(coalesce(recipient_group, ''), ' ', '')) = 'AB+'
    else false
  end;
$$;

create table if not exists public.blood_crossmatches (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  blood_unit_id uuid not null references public.blood_bank_units(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  result text not null check (result in ('Compatible', 'Incompatible')),
  method text not null check (method in ('Tube', 'Gel card', 'Solid phase')),
  performed_by uuid,
  performed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '72 hours'),
  created_at timestamptz not null default now()
);

alter table public.blood_bank_units
  add column if not exists issued_crossmatch_id uuid references public.blood_crossmatches(id) on delete restrict;

create index if not exists blood_crossmatches_lookup_idx
  on public.blood_crossmatches (hospital_id, blood_unit_id, patient_id, performed_at desc);

alter table public.blood_crossmatches enable row level security;
revoke all on public.blood_crossmatches from anon, authenticated;
grant select, insert on public.blood_crossmatches to authenticated;

create policy "Authorized blood bank staff can read crossmatches"
  on public.blood_crossmatches for select to authenticated
  using (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = blood_crossmatches.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and public.can_access_hospital_workflow_module('blood-bank', hu.role)
  ));

create policy "Authorized blood bank staff can record crossmatches"
  on public.blood_crossmatches for insert to authenticated
  with check (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = blood_crossmatches.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and public.can_access_hospital_workflow_module('blood-bank', hu.role)
  ));

create or replace function public.prevent_blood_crossmatch_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Crossmatch results are immutable; record a new test instead';
end;
$$;

drop trigger if exists blood_crossmatches_immutable on public.blood_crossmatches;
create trigger blood_crossmatches_immutable
  before update or delete on public.blood_crossmatches
  for each row execute function public.prevent_blood_crossmatch_mutation();

create or replace function public.validate_blood_crossmatch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  unit_row public.blood_bank_units%rowtype;
  recipient_group text;
begin
  select * into unit_row from public.blood_bank_units
  where id = new.blood_unit_id and hospital_id = new.hospital_id;
  if not found then raise exception 'Blood unit must belong to the selected hospital'; end if;
  if unit_row.component <> 'Packed Red Cells'
    or unit_row.status <> 'Available'
    or unit_row.screening_status not in ('clear', 'negative')
    or unit_row.expiry_at <= now() then
    raise exception 'Crossmatch requires available, screened, unexpired packed red cells';
  end if;
  select p.blood_group into recipient_group from public.patients p
  where p.id = new.patient_id and p.hospital_id = new.hospital_id;
  if recipient_group is null then raise exception 'Recipient patient must belong to this hospital and have ABO/Rh recorded'; end if;
  if new.result = 'Compatible' and not public.blood_groups_compatible(unit_row.blood_group, recipient_group) then
    raise exception 'A serologic crossmatch cannot be recorded Compatible when ABO/Rh groups are incompatible';
  end if;
  new.performed_by := auth.uid();
  new.performed_at := now();
  new.expires_at := now() + interval '72 hours';
  return new;
end;
$$;

drop trigger if exists blood_crossmatches_validate on public.blood_crossmatches;
create trigger blood_crossmatches_validate
  before insert on public.blood_crossmatches
  for each row execute function public.validate_blood_crossmatch();

create or replace function public.enforce_blood_bank_unit_safety()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recipient_group text;
  matching_crossmatch_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('Pending', 'Quarantine') then
      raise exception 'New blood units must enter inventory as Pending or Quarantine';
    end if;
    new.created_by := auth.uid();
    new.issued_to_patient_id := null;
    new.issued_by := null;
    new.issued_at := null;
    new.issued_crossmatch_id := null;
  else
    new.created_by := old.created_by;
    if new.id is distinct from old.id or new.hospital_id is distinct from old.hospital_id then
      raise exception 'Blood unit identity and hospital cannot be changed';
    end if;
    if old.status in ('Issued', 'Discarded') then
      raise exception 'Issued and discarded blood units are final and cannot be changed';
    end if;
    if new.unit_reference is distinct from old.unit_reference
      or new.blood_group is distinct from old.blood_group
      or new.component is distinct from old.component
      or new.expiry_at is distinct from old.expiry_at then
      raise exception 'Blood unit identity, component, group, and expiry are immutable after registration';
    end if;
    if old.status = 'Pending' and new.status not in ('Pending', 'Quarantine', 'Available', 'Discarded') then
      raise exception 'Invalid status transition from Pending';
    elsif old.status = 'Quarantine' and new.status not in ('Quarantine', 'Available', 'Discarded') then
      raise exception 'Invalid status transition from Quarantine';
    elsif old.status = 'Available' and new.status not in ('Available', 'Reserved', 'Issued', 'Quarantine', 'Discarded') then
      raise exception 'Invalid status transition from Available';
    elsif old.status = 'Reserved' and new.status not in ('Reserved', 'Available', 'Issued', 'Quarantine', 'Discarded') then
      raise exception 'Invalid status transition from Reserved';
    end if;
    if new.screening_status is distinct from old.screening_status
      and old.status in ('Available', 'Reserved')
      and new.screening_status not in ('clear', 'negative') then
      new.status := 'Quarantine';
    end if;
  end if;

  if new.status in ('Available', 'Reserved', 'Issued') then
    if new.screening_status not in ('clear', 'negative') then
      raise exception 'Blood unit screening must be clear before availability or issue';
    end if;
    if new.expiry_at <= now() then
      raise exception 'Expired blood units cannot be made available or issued';
    end if;
  end if;

  if new.status = 'Issued' then
    if new.issued_to_patient_id is null then
      raise exception 'Select and record the recipient patient before issuing blood';
    end if;
    select p.blood_group into recipient_group
    from public.patients p
    where p.id = new.issued_to_patient_id and p.hospital_id = new.hospital_id;
    if recipient_group is null then
      raise exception 'Recipient patient must belong to this hospital and have a blood group recorded';
    end if;
    if new.component <> 'Packed Red Cells' then
      raise exception 'This issue workflow supports packed red cells only; component-specific compatibility review is required';
    end if;
    if not public.blood_groups_compatible(new.blood_group, recipient_group) then
      raise exception 'Blood group is incompatible with the selected patient';
    end if;
    if new.issued_crossmatch_id is null then
      raise exception 'Select a current Compatible crossmatch before issuing this unit';
    end if;
    select crossmatch.id into matching_crossmatch_id
    from public.blood_crossmatches crossmatch
    where crossmatch.id = new.issued_crossmatch_id
      and crossmatch.hospital_id = new.hospital_id
      and crossmatch.blood_unit_id = new.id
      and crossmatch.patient_id = new.issued_to_patient_id
      and crossmatch.result = 'Compatible'
      and crossmatch.expires_at > now();
    if matching_crossmatch_id is null then
      raise exception 'The selected Compatible crossmatch is missing, expired, or belongs to another unit or patient';
    end if;
    new.issued_by := auth.uid();
    new.issued_at := now();
  elsif tg_op = 'UPDATE' then
    new.issued_by := old.issued_by;
    new.issued_at := old.issued_at;
    new.issued_crossmatch_id := old.issued_crossmatch_id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists blood_bank_units_safety_guard on public.blood_bank_units;
create trigger blood_bank_units_safety_guard
  before insert or update on public.blood_bank_units
  for each row execute function public.enforce_blood_bank_unit_safety();

create or replace function public.enforce_hospital_workflow_safety()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  scheduled_start timestamptz;
  scheduled_end timestamptz;
  requested_release_by uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'Open' then
      raise exception 'New workflow records must start Open';
    end if;
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
    if new.id is distinct from old.id
      or new.hospital_id is distinct from old.hospital_id
      or new.module_code is distinct from old.module_code
      or new.patient_id is distinct from old.patient_id
      or new.visit_id is distinct from old.visit_id then
      raise exception 'Workflow record identity, hospital, module, patient, and visit links are immutable';
    end if;
    if old.status in ('Completed', 'Cancelled', 'Released', 'Received') then
      raise exception 'Completed, released, received, and cancelled workflow records are final';
    end if;
  end if;
  new.updated_at := now();

  if new.patient_id is not null and not exists (
    select 1 from public.patients p
    where p.id = new.patient_id and p.hospital_id = new.hospital_id
  ) then
    raise exception 'Patient must belong to the selected hospital';
  end if;
  if new.visit_id is not null and not exists (
    select 1 from public.visits v
    where v.id = new.visit_id
      and v.hospital_id = new.hospital_id
      and v.patient_id = new.patient_id
  ) then
    raise exception 'Linked visit must belong to this hospital and patient';
  end if;

  if new.module_code = 'theatre' and new.status not in ('Completed', 'Cancelled') then
    if new.patient_id is null or nullif(new.details ->> 'surgeon', '') is null
      or nullif(new.details ->> 'room_id', '') is null
      or nullif(new.details ->> 'start_time', '') is null
      or nullif(new.details ->> 'end_time', '') is null then
      raise exception 'Theatre patient, surgeon, room, and case times are required';
    end if;
    scheduled_start := (new.details ->> 'start_time')::timestamptz;
    scheduled_end := (new.details ->> 'end_time')::timestamptz;
    if scheduled_end <= scheduled_start then
      raise exception 'The case end time must be after its start time';
    end if;
    if new.status in ('In Progress', 'Completed') and (
      new.details ->> 'checklist_sign_in' is distinct from 'Yes'
      or new.details ->> 'checklist_time_out' is distinct from 'Yes'
    ) then
      raise exception 'Sign-in and time-out must be completed before the case starts';
    end if;
    if new.status = 'Completed' and new.details ->> 'checklist_sign_out' is distinct from 'Yes' then
      raise exception 'Sign-out must be completed before the case is completed';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(new.hospital_id::text || ':theatre-schedule', 0));
    if exists (
      select 1 from public.hospital_workflow_records other
      where other.hospital_id = new.hospital_id
        and other.module_code = 'theatre'
        and other.id <> new.id
        and other.status not in ('Completed', 'Cancelled')
        and (
          other.details ->> 'room_id' = new.details ->> 'room_id'
          or lower(trim(other.details ->> 'surgeon')) = lower(trim(new.details ->> 'surgeon'))
          or (nullif(other.details ->> 'anaesthetist', '') is not null
            and lower(trim(other.details ->> 'anaesthetist')) = lower(trim(new.details ->> 'anaesthetist')))
        )
        and scheduled_start < (other.details ->> 'end_time')::timestamptz
        and scheduled_end > (other.details ->> 'start_time')::timestamptz
    ) then
      raise exception 'The room, surgeon, or anaesthetist is already booked during the selected time';
    end if;
  end if;

  if new.module_code = 'morgue' and new.status = 'Release Requested' then
    if new.details ->> 'id_verified' is distinct from 'true' then
      raise exception 'Identity verification is required before requesting release';
    end if;
    if new.details ->> 'medico_legal' = 'true'
      and nullif(new.details ->> 'authority_document', '') is null then
      raise exception 'Authority document required for medico-legal release';
    end if;
    if tg_op = 'UPDATE' and old.status = 'Release Requested' then
      new.details := jsonb_set(new.details, '{release_requested_by_user_id}', old.details -> 'release_requested_by_user_id', true);
      new.details := jsonb_set(new.details, '{release_requested_at}', old.details -> 'release_requested_at', true);
    else
      new.details := jsonb_set(new.details, '{release_requested_by_user_id}', to_jsonb(auth.uid()::text), true);
      new.details := jsonb_set(new.details, '{release_requested_at}', to_jsonb(now()), true);
    end if;
  elsif new.module_code = 'morgue' and new.status = 'Released' then
    if tg_op <> 'UPDATE' or old.status <> 'Release Requested' then
      raise exception 'Mortuary release must follow a release request';
    end if;
    if new.details ->> 'id_verified' is distinct from 'true' then
      raise exception 'Identity verification is required before release';
    end if;
    if new.details ->> 'medico_legal' = 'true'
      and nullif(new.details ->> 'authority_document', '') is null then
      raise exception 'Authority document required for medico-legal release';
    end if;
    requested_release_by := nullif(old.details ->> 'release_requested_by_user_id', '')::uuid;
    if requested_release_by is null or requested_release_by = auth.uid() then
      raise exception 'A different authenticated staff member must approve the release request';
    end if;
    if not exists (
      select 1 from public.hospital_users hu
      where hu.user_id = requested_release_by
        and hu.hospital_id = new.hospital_id
        and hu.active is distinct from false
    ) then
      raise exception 'Release requester is not an active member of this hospital';
    end if;
    new.details := jsonb_set(new.details, '{release_verified_by_user_id}', to_jsonb(auth.uid()::text), true);
    new.details := jsonb_set(new.details, '{release_verified_at}', to_jsonb(now()), true);
  end if;
  return new;
end;
$$;

drop trigger if exists hospital_workflow_records_safety_guard on public.hospital_workflow_records;
create trigger hospital_workflow_records_safety_guard
  before insert or update on public.hospital_workflow_records
  for each row execute function public.enforce_hospital_workflow_safety();

create unique index if not exists hospital_workflow_payroll_employee_period_uidx
  on public.hospital_workflow_records (
    hospital_id,
    (lower(trim((details ->> 'employee_name')::text))),
    ((details ->> 'pay_period')::text)
  )
  where module_code = 'payroll';

create table if not exists public.clinical_workflow_audit (
  id bigint generated always as identity primary key,
  hospital_id uuid not null,
  source_table text not null check (source_table in ('hospital_workflow_records', 'blood_bank_units', 'blood_crossmatches')),
  source_id uuid not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid,
  old_row jsonb,
  new_row jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists clinical_workflow_audit_hospital_time_idx
  on public.clinical_workflow_audit (hospital_id, occurred_at desc);

alter table public.clinical_workflow_audit enable row level security;
revoke all on public.clinical_workflow_audit from anon, authenticated;
revoke update, delete, truncate on public.clinical_workflow_audit from public, anon, authenticated;
grant select on public.clinical_workflow_audit to authenticated;

create policy "Hospital admins can read clinical workflow audit"
  on public.clinical_workflow_audit for select to authenticated
  using (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = clinical_workflow_audit.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and lower(coalesce(hu.role, '')) in ('admin', 'administrator')
  ));

create or replace function public.prevent_clinical_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Clinical workflow audit rows are immutable';
end;
$$;

drop trigger if exists clinical_workflow_audit_immutable on public.clinical_workflow_audit;
create trigger clinical_workflow_audit_immutable
  before update or delete on public.clinical_workflow_audit
  for each row execute function public.prevent_clinical_audit_mutation();

create or replace function public.audit_clinical_workflow_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_data jsonb;
  new_data jsonb;
  target_row jsonb;
begin
  if tg_op = 'DELETE' then
    old_data := to_jsonb(old);
    target_row := old_data;
  elsif tg_op = 'UPDATE' then
    old_data := to_jsonb(old);
    new_data := to_jsonb(new);
    target_row := new_data;
  else
    new_data := to_jsonb(new);
    target_row := new_data;
  end if;

  insert into public.clinical_workflow_audit (
    hospital_id, source_table, source_id, operation, actor_id, old_row, new_row
  ) values (
    (target_row ->> 'hospital_id')::uuid,
    tg_table_name,
    (target_row ->> 'id')::uuid,
    tg_op,
    auth.uid(),
    old_data,
    new_data
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists hospital_workflow_records_audit on public.hospital_workflow_records;
create trigger hospital_workflow_records_audit
  after insert or update or delete on public.hospital_workflow_records
  for each row execute function public.audit_clinical_workflow_change();

drop trigger if exists blood_bank_units_audit on public.blood_bank_units;
create trigger blood_bank_units_audit
  after insert or update or delete on public.blood_bank_units
  for each row execute function public.audit_clinical_workflow_change();

drop trigger if exists blood_crossmatches_audit on public.blood_crossmatches;
create trigger blood_crossmatches_audit
  after insert or update or delete on public.blood_crossmatches
  for each row execute function public.audit_clinical_workflow_change();

create table if not exists public.workflow_events (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  patient_id uuid references public.patients(id) on delete restrict,
  visit_id uuid,
  source_module text not null check (source_module in (
    'blood-bank', 'theatre', 'morgue', 'icu', 'emergency', 'dialysis',
    'maternity', 'telemedicine', 'biomedical', 'hivtb', 'nutrition',
    'quality-safety', 'payroll', 'procurement'
  )),
  event_type text not null,
  record_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists workflow_events_hospital_patient_time_idx
  on public.workflow_events (hospital_id, patient_id, created_at desc)
  where patient_id is not null;

create index if not exists workflow_events_hospital_time_idx
  on public.workflow_events (hospital_id, created_at desc);

alter table public.workflow_events enable row level security;
revoke all on public.workflow_events from anon, authenticated;
grant select on public.workflow_events to authenticated;

create policy "Authorized hospital staff can read workflow events"
  on public.workflow_events for select to authenticated
  using (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = workflow_events.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and public.can_access_hospital_workflow_module(workflow_events.source_module, hu.role)
  ));

create or replace function public.prevent_workflow_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Workflow events are immutable';
end;
$$;

drop trigger if exists workflow_events_immutable on public.workflow_events;
create trigger workflow_events_immutable
  before update or delete on public.workflow_events
  for each row execute function public.prevent_workflow_event_mutation();

create or replace function public.emit_hospital_workflow_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  emitted_type text;
  event_payload jsonb;
  patient_id_value uuid;
  visit_id_value uuid;
begin
  if tg_op = 'UPDATE'
    and new.status is not distinct from old.status
    and new.details is not distinct from old.details then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    emitted_type := case
      when new.module_code = 'theatre' and new.status = 'Completed' then 'theatre.completed'
      when new.module_code = 'theatre' and new.status = 'In Progress' then 'theatre.started'
      when new.module_code = 'morgue' and new.status = 'Release Requested' then 'morgue.release_requested'
      when new.module_code = 'morgue' and new.status = 'Released' then 'morgue.released'
      when new.module_code = 'procurement' and new.status = 'Received' then 'procurement.received'
      when new.module_code = 'quality-safety' and new.status = 'Open' then 'safety.incident_opened'
      else new.module_code || '.status_changed'
    end;
  elsif new.module_code = 'emergency' and upper(coalesce(new.details ->> 'severity', '')) = 'RED' then
    emitted_type := 'emergency.red_triage';
  elsif new.module_code = 'maternity' and lower(coalesce(new.details ->> 'care_stage', '')) = 'delivery' then
    emitted_type := 'maternity.delivery_recorded';
  elsif new.module_code = 'theatre' then
    emitted_type := 'theatre.scheduled';
  elsif new.module_code = 'morgue' then
    emitted_type := 'morgue.death_recorded';
  elsif new.module_code = 'quality-safety' then
    emitted_type := 'safety.incident_opened';
  else
    emitted_type := new.module_code || case when tg_op = 'INSERT' then '.record_created' else '.record_updated' end;
  end if;

  patient_id_value := new.patient_id;
  visit_id_value := new.visit_id;
  event_payload := jsonb_build_object(
    'record_id', new.id,
    'status', new.status,
    'title', case when new.module_code in ('hivtb', 'payroll') then null else new.title end
  );
  if new.module_code = 'emergency' then
    event_payload := event_payload || jsonb_build_object('triage_category', new.details ->> 'triage_category');
  end if;

  insert into public.workflow_events (
    hospital_id, patient_id, visit_id, source_module, event_type,
    record_id, payload, created_by
  ) values (
    new.hospital_id, patient_id_value, visit_id_value, new.module_code,
    emitted_type, new.id, event_payload, auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists hospital_workflow_records_emit_event on public.hospital_workflow_records;
create trigger hospital_workflow_records_emit_event
  after insert or update on public.hospital_workflow_records
  for each row execute function public.emit_hospital_workflow_event();

create or replace function public.emit_blood_bank_workflow_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  emitted_type text;
  event_payload jsonb;
  patient_id_value uuid;
begin
  if tg_op = 'INSERT' then
    emitted_type := 'blood.unit_registered';
  elsif new.status is distinct from old.status then
    emitted_type := case when new.status = 'Issued' then 'blood.issued' else 'blood.status_changed' end;
  elsif new.screening_status is distinct from old.screening_status then
    emitted_type := 'blood.screening_updated';
  else
    return new;
  end if;

  patient_id_value := case when new.status = 'Issued' then new.issued_to_patient_id else null end;
  event_payload := jsonb_build_object(
    'unit_id', new.id,
    'blood_group', new.blood_group,
    'component', new.component,
    'status', new.status
  );
  if new.status = 'Issued' then
    event_payload := event_payload || jsonb_build_object('issued_at', new.issued_at);
  end if;

  insert into public.workflow_events (
    hospital_id, patient_id, source_module, event_type, record_id, payload, created_by
  ) values (
    new.hospital_id, patient_id_value, 'blood-bank', emitted_type,
    new.id, event_payload, auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists blood_bank_units_emit_event on public.blood_bank_units;
create trigger blood_bank_units_emit_event
  after insert or update on public.blood_bank_units
  for each row execute function public.emit_blood_bank_workflow_event();

create or replace function public.emit_blood_crossmatch_workflow_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.workflow_events (
    hospital_id, patient_id, source_module, event_type, record_id, payload, created_by
  ) values (
    new.hospital_id,
    new.patient_id,
    'blood-bank',
    'blood.crossmatch_recorded',
    new.id,
    jsonb_build_object(
      'unit_id', new.blood_unit_id,
      'crossmatch_result', new.result,
      'method', new.method,
      'expires_at', new.expires_at
    ),
    auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists blood_crossmatches_emit_event on public.blood_crossmatches;
create trigger blood_crossmatches_emit_event
  after insert on public.blood_crossmatches
  for each row execute function public.emit_blood_crossmatch_workflow_event();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workflow_events'
    ) then
    execute 'alter publication supabase_realtime add table public.workflow_events';
  end if;
end;
$$;