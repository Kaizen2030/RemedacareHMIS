-- Payroll is stored as a period snapshot in hospital_workflow_records. This guard
-- keeps it tied to staff and prevents a preparer from approving their own work.

create unique index if not exists hospital_workflow_payroll_staff_period_uidx
  on public.hospital_workflow_records (
    hospital_id,
    (details ->> 'staff_id'),
    (details ->> 'pay_period')
  )
  where module_code = 'payroll' and details ? 'staff_id';

create or replace function public.enforce_payroll_record_safety()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  staff_status text;
  gross_pay numeric;
  deductions_value numeric;
  net_pay numeric;
  actor_is_admin boolean;
begin
  if new.module_code <> 'payroll' then
    return new;
  end if;

  if nullif(new.details ->> 'staff_id', '') is null
    or nullif(new.details ->> 'employee_name', '') is null
    or (new.details ->> 'pay_period') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Payroll records require a staff member, employee name, and valid pay period';
  end if;

  select lower(coalesce(status, '')) into staff_status
  from public.staff
  where id = (new.details ->> 'staff_id')::uuid
    and hospital_id = new.hospital_id;

  if staff_status is distinct from 'active' then
    raise exception 'Payroll can only be prepared for an active staff member in this hospital';
  end if;

  begin
    gross_pay := (new.details ->> 'gross_pay')::numeric;
    deductions_value := coalesce((new.details ->> 'deductions')::numeric, 0);
    net_pay := (new.details ->> 'net_pay')::numeric;
  exception when invalid_text_representation then
    raise exception 'Payroll gross pay, deductions, and net pay must be numeric';
  end;

  if gross_pay < 0 or deductions_value < 0 or net_pay < 0 or net_pay <> gross_pay - deductions_value then
    raise exception 'Payroll net pay must equal gross pay less deductions';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'Open' and new.status not in ('Open', 'Pending', 'Cancelled') then
      raise exception 'Payroll drafts may only be submitted or cancelled';
    elsif old.status = 'Pending' and new.status not in ('Pending', 'Completed', 'Cancelled') then
      raise exception 'Submitted payroll may only be approved or cancelled';
    end if;

    if old.status = 'Pending' and new.status = 'Completed' then
      select lower(coalesce(role, '')) in ('admin', 'administrator') into actor_is_admin
      from public.hospital_users
      where hospital_id = new.hospital_id
        and user_id = auth.uid()
        and active is distinct from false;
      if actor_is_admin is distinct from true then
        raise exception 'Only an administrator may approve payroll';
      end if;
      if old.created_by = auth.uid() then
        raise exception 'Payroll must be approved by a different user than the preparer';
      end if;
    end if;

    if old.status in ('Pending', 'Completed') and new.details is distinct from old.details then
      raise exception 'Submitted and approved payroll snapshots cannot be changed';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists a_payroll_record_safety on public.hospital_workflow_records;
create trigger a_payroll_record_safety
  before insert or update on public.hospital_workflow_records
  for each row execute function public.enforce_payroll_record_safety();
