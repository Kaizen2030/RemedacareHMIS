-- A patient-facing workflow item must always be tied to the active clinical visit.
-- This preserves a traceable handoff between the service board and the care record.
create or replace function public.enforce_patient_workflow_visit_link()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.module_code in (
    'theatre',
    'icu',
    'emergency',
    'dialysis',
    'maternity',
    'telemedicine',
    'hivtb',
    'nutrition'
  ) and new.patient_id is not null and new.visit_id is null then
    raise exception 'A visit is required for patient workflow module "%"', new.module_code;
  end if;

  return new;
end;
$$;

drop trigger if exists a_enforce_patient_workflow_visit_link on public.hospital_workflow_records;
create trigger a_enforce_patient_workflow_visit_link
before insert on public.hospital_workflow_records
for each row execute function public.enforce_patient_workflow_visit_link();
