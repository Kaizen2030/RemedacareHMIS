create table if not exists public.hospital_workflow_records (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  module_code text not null check (module_code in (
    'theatre', 'morgue', 'icu', 'emergency', 'dialysis', 'maternity',
    'telemedicine', 'biomedical', 'hivtb', 'nutrition', 'quality-safety',
    'payroll', 'procurement'
  )),
  patient_id uuid references public.patients(id) on delete set null,
  title text not null,
  status text not null default 'Open'
    check (status in ('Open', 'Pending', 'In Progress', 'Completed', 'Released', 'Cancelled')),
  details jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hospital_workflow_records_hospital_module_created_idx
  on public.hospital_workflow_records (hospital_id, module_code, created_at desc);

create index if not exists hospital_workflow_records_patient_idx
  on public.hospital_workflow_records (hospital_id, patient_id)
  where patient_id is not null;

alter table public.hospital_workflow_records enable row level security;

create or replace function public.enforce_hospital_workflow_safety()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  scheduled_start timestamptz;
  scheduled_end timestamptz;
begin
  if new.patient_id is not null and not exists (
    select 1 from public.patients p
    where p.id = new.patient_id and p.hospital_id = new.hospital_id
  ) then
    raise exception 'Patient must belong to the selected hospital';
  end if;

  if new.module_code = 'theatre' and new.status not in ('Completed', 'Cancelled') then
    if nullif(new.details ->> 'room_id', '') is null
      or nullif(new.details ->> 'start_time', '') is null
      or nullif(new.details ->> 'end_time', '') is null then
      raise exception 'Theatre room and case times are required';
    end if;
    scheduled_start := (new.details ->> 'start_time')::timestamptz;
    scheduled_end := (new.details ->> 'end_time')::timestamptz;
    if scheduled_end <= scheduled_start then
      raise exception 'The case end time must be after its start time';
    end if;
    if exists (
      select 1 from public.hospital_workflow_records other
      where other.hospital_id = new.hospital_id
        and other.module_code = 'theatre'
        and other.id <> new.id
        and other.status not in ('Completed', 'Cancelled')
        and other.details ->> 'room_id' = new.details ->> 'room_id'
        and scheduled_start < (other.details ->> 'end_time')::timestamptz
        and scheduled_end > (other.details ->> 'start_time')::timestamptz
    ) then
      raise exception 'This operating room is already booked during the selected time';
    end if;
  end if;

  if new.module_code = 'morgue' and new.status = 'Released' then
    if new.details ->> 'id_verified' is distinct from 'true' then
      raise exception 'Identity verification is required before release';
    end if;
    if new.details ->> 'medico_legal' = 'true'
      and nullif(new.details ->> 'authority_document', '') is null then
      raise exception 'Authority document required for medico-legal release';
    end if;
    if nullif(new.details ->> 'released_by', '') is null
      or nullif(new.details ->> 'verified_by', '') is null
      or lower(new.details ->> 'released_by') = lower(new.details ->> 'verified_by') then
      raise exception 'Two different staff identities are required for release';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists hospital_workflow_records_safety_guard on public.hospital_workflow_records;
create trigger hospital_workflow_records_safety_guard
  before insert or update on public.hospital_workflow_records
  for each row execute function public.enforce_hospital_workflow_safety();

create policy "Active hospital members can read workflow records"
  on public.hospital_workflow_records for select to authenticated
  using (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = hospital_workflow_records.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and case hospital_workflow_records.module_code
        when 'payroll' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'accountant', 'finance officer', 'cashier', 'billing officer')
        when 'procurement' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'accountant', 'finance officer', 'cashier', 'billing officer', 'pharmacist', 'senior pharmacist', 'pharmaceutical technologist', 'pharmacy technician')
        when 'biomedical' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'lab technician', 'lab scientist', 'medical laboratory technician', 'mlt', 'biomedical engineer')
        when 'hivtb' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'doctor', 'nurse', 'midwife', 'clinical officer', 'medical officer', 'consultant', 'specialist', 'general practitioner', 'nursing officer', 'senior nursing officer', 'registered nurse', 'nursing officer i', 'nursing officer ii')
        when 'quality-safety' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'doctor', 'nurse', 'accountant', 'finance officer', 'cashier', 'billing officer', 'clinical officer', 'medical officer', 'consultant', 'specialist', 'general practitioner', 'midwife', 'registered nurse', 'nursing officer', 'senior nursing officer', 'nursing officer i', 'nursing officer ii')
        else lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'doctor', 'nurse', 'midwife', 'clinical officer', 'medical officer', 'consultant', 'specialist', 'general practitioner', 'registered nurse', 'nursing officer', 'senior nursing officer', 'nursing officer i', 'nursing officer ii')
      end
  ));

create policy "Authorized hospital staff can add workflow records"
  on public.hospital_workflow_records for insert to authenticated
  with check (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = hospital_workflow_records.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and case hospital_workflow_records.module_code
        when 'payroll' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'accountant', 'finance officer', 'cashier', 'billing officer')
        when 'procurement' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'accountant', 'finance officer', 'cashier', 'billing officer', 'pharmacist', 'senior pharmacist', 'pharmaceutical technologist', 'pharmacy technician')
        when 'biomedical' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'lab technician', 'lab scientist', 'medical laboratory technician', 'mlt', 'biomedical engineer')
        when 'quality-safety' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'doctor', 'nurse', 'accountant', 'finance officer', 'cashier', 'billing officer', 'quality officer', 'clinical officer', 'medical officer', 'consultant', 'specialist', 'general practitioner', 'registered nurse', 'nursing officer', 'senior nursing officer', 'nursing officer i', 'nursing officer ii')
        else lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'doctor', 'nurse', 'midwife', 'clinical officer', 'medical officer', 'consultant', 'specialist', 'general practitioner', 'registered nurse', 'nursing officer', 'senior nursing officer', 'nursing officer i', 'nursing officer ii')
      end
  ));

create policy "Authorized hospital staff can update workflow records"
  on public.hospital_workflow_records for update to authenticated
  using (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = hospital_workflow_records.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and case hospital_workflow_records.module_code
        when 'payroll' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'accountant', 'finance officer', 'cashier', 'billing officer')
        when 'procurement' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'accountant', 'finance officer', 'cashier', 'billing officer', 'pharmacist', 'senior pharmacist', 'pharmaceutical technologist', 'pharmacy technician')
        when 'biomedical' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'lab technician', 'lab scientist', 'medical laboratory technician', 'mlt', 'biomedical engineer')
        when 'quality-safety' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'doctor', 'nurse', 'accountant', 'finance officer', 'cashier', 'billing officer', 'quality officer', 'clinical officer', 'medical officer', 'consultant', 'specialist', 'general practitioner', 'registered nurse', 'nursing officer', 'senior nursing officer', 'nursing officer i', 'nursing officer ii')
        else lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'doctor', 'nurse', 'midwife', 'clinical officer', 'medical officer', 'consultant', 'specialist', 'general practitioner', 'registered nurse', 'nursing officer', 'senior nursing officer', 'nursing officer i', 'nursing officer ii')
      end
  ))
  with check (exists (
    select 1 from public.hospital_users hu
    where hu.hospital_id = hospital_workflow_records.hospital_id
      and hu.user_id = (select auth.uid())
      and hu.active is distinct from false
      and case hospital_workflow_records.module_code
        when 'payroll' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'accountant', 'finance officer', 'cashier', 'billing officer')
        when 'procurement' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'accountant', 'finance officer', 'cashier', 'billing officer', 'pharmacist', 'senior pharmacist', 'pharmaceutical technologist', 'pharmacy technician')
        when 'biomedical' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'lab technician', 'lab scientist', 'medical laboratory technician', 'mlt', 'biomedical engineer')
        when 'quality-safety' then lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'doctor', 'nurse', 'accountant', 'finance officer', 'cashier', 'billing officer', 'quality officer', 'clinical officer', 'medical officer', 'consultant', 'specialist', 'general practitioner', 'registered nurse', 'nursing officer', 'senior nursing officer', 'nursing officer i', 'nursing officer ii')
        else lower(coalesce(hu.role, '')) in ('admin', 'administrator', 'doctor', 'nurse', 'midwife', 'clinical officer', 'medical officer', 'consultant', 'specialist', 'general practitioner', 'registered nurse', 'nursing officer', 'senior nursing officer', 'nursing officer i', 'nursing officer ii')
      end
  ));