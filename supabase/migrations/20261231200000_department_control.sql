-- Departments run their own work. HR or an administrator names department managers (ward in-charge, HOD, matron)
-- with two rights: run the duty roster and approve leave for that department's staff.
--   department_managers           who manages which department, and with which rights
--   dept_manages(h, dept, what)   true for HR / admin, a named manager of that department, or (roster only) a member whose
--                                 role is in-charge / HOD / matron / supervisor AND whose own department is that department
--   shift_editable(h, staff, unit) a shift can be changed by whoever manages the staff member's department or the unit
-- Changes: the roster was editable by any in-charge for the whole hospital; it is now limited to their own department.
-- Leave can now be approved by the department's named leave approver as well as HR (never by the person on leave).

do $$ begin
  if to_regprocedure('public.department_canonical(text)') is null then raise exception 'Run 47_merge_duplicate_departments.sql first. Nothing was changed.'; end if;
  if to_regprocedure('public.hr_can_manage(uuid)') is null or to_regclass('public.staff_shifts') is null then raise exception 'Run 36_hr_roster_leave.sql first. Nothing was changed.'; end if;
end $$;

create table if not exists public.department_managers (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid not null,
  department        text not null,
  staff_id          uuid not null,
  can_roster        boolean not null default true,
  can_approve_leave boolean not null default true,
  added_by          uuid default auth.uid(),
  created_at        timestamptz not null default now()
);
create unique index if not exists department_managers_key on public.department_managers(hospital_id, lower(department), staff_id);

create or replace function public.department_managers_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.department := public.department_canonical(new.department);
  if coalesce(new.department, '') = '' then raise exception 'Choose the department'; end if;
  if not exists (select 1 from public.staff s where s.id = new.staff_id and s.hospital_id::text = new.hospital_id::text) then
    raise exception 'That staff member is not in this hospital';
  end if;
  if tg_op = 'INSERT' then new.added_by := auth.uid(); new.created_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_department_managers_before on public.department_managers;
create trigger trg_department_managers_before before insert or update on public.department_managers
  for each row execute function public.department_managers_before();

create or replace function public.dept_manages(p_hospital uuid, p_department text, p_what text default 'roster')
returns boolean language sql stable security definer set search_path = public as $$
  select public.hr_can_manage(p_hospital)
    or exists (
      select 1 from public.department_managers m
       where m.hospital_id = p_hospital and m.staff_id = public.hr_my_staff_id(p_hospital)
         and lower(m.department) = lower(public.department_canonical(p_department))
         and case when p_what = 'leave' then m.can_approve_leave else m.can_roster end)
    or (coalesce(p_what, 'roster') = 'roster'
        and coalesce((select c.member and c.staff_active
                              and lower(coalesce(c.raw_role, '')) ~ '(in-charge|in charge|matron|supervisor|nursing officer in charge|head of department|hod)'
                         from public.pay_user_context(p_hospital, auth.uid()) c), false)
        and exists (select 1 from public.staff s
                     where s.id = public.hr_my_staff_id(p_hospital)
                       and lower(public.department_canonical(s.department)) = lower(public.department_canonical(p_department))))
$$;

create or replace function public.shift_editable(p_hospital uuid, p_staff uuid, p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.hr_can_manage(p_hospital)
      or public.dept_manages(p_hospital, (select s.department from public.staff s where s.id = p_staff), 'roster')
      or (coalesce(p_unit, '') <> '' and public.dept_manages(p_hospital, p_unit, 'roster'))
$$;

-- roster: per department instead of hospital-wide
drop policy if exists staff_shifts_write on public.staff_shifts;
create policy staff_shifts_write on public.staff_shifts for all to authenticated
  using (public.shift_editable(hospital_id, staff_id, unit)) with check (public.shift_editable(hospital_id, staff_id, unit));

-- leave: the department's leave approver sees and decides its staff's requests
drop policy if exists staff_leave_dept on public.staff_leave;
create policy staff_leave_dept on public.staff_leave for select to authenticated
  using (public.dept_manages(public.ref_try_uuid(hospital_id::text), (select s.department from public.staff s where s.id = staff_id), 'leave'));
drop policy if exists staff_leave_dept_decide on public.staff_leave;
create policy staff_leave_dept_decide on public.staff_leave for update to authenticated
  using (public.dept_manages(public.ref_try_uuid(hospital_id::text), (select s.department from public.staff s where s.id = staff_id), 'leave'))
  with check (public.dept_manages(public.ref_try_uuid(hospital_id::text), (select s.department from public.staff s where s.id = staff_id), 'leave'));

create or replace function public.staff_leave_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare cal boolean; overlap record; me uuid := public.hr_my_staff_id(new.hospital_id::uuid);
  v_dept text := (select s.department from public.staff s where s.id = new.staff_id);
begin
  if new.end_date::date < new.start_date::date then raise exception 'The leave ends before it starts'; end if;
  select calendar_days into cal from public.hr_leave_entitlements where leave_type = new.leave_type and (hospital_id::text = new.hospital_id::text or hospital_id is null) order by hospital_id nulls last limit 1;
  new.working_days := case when coalesce(cal, false) then new.end_date::date - new.start_date::date + 1 else public.working_days(new.start_date::date, new.end_date::date) end;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.requested_by := auth.uid();
      if not public.hr_can_manage(new.hospital_id::uuid) then
        if me is null or me <> new.staff_id then raise exception 'You can only request leave for yourself'; end if;
        new.status := 'requested';
      else
        new.status := coalesce(new.status, 'requested');
      end if;
    end if;
    new.status := coalesce(new.status, 'requested');
  else
    if old.status in ('rejected', 'cancelled') then raise exception 'This leave request is closed'; end if;
    if new.status is distinct from old.status then
      if new.status in ('approved', 'rejected') then
        if not public.dept_manages(new.hospital_id::uuid, v_dept, 'leave') then
          raise exception 'Only HR, an administrator or the department''s leave approver can approve or reject leave';
        end if;
        if me is not null and me = new.staff_id then raise exception 'You cannot approve your own leave'; end if;
        new.decided_by := auth.uid(); new.decided_at := now();
        if new.status = 'rejected' and coalesce(trim(new.decision_note), '') = '' then raise exception 'Give the reason for rejecting'; end if;
      elsif new.status = 'cancelled' then
        if not (public.hr_can_manage(new.hospital_id::uuid) or me = new.staff_id) then raise exception 'Only the staff member or HR can cancel leave'; end if;
      end if;
    elsif old.status = 'approved' and (new.start_date, new.end_date, new.leave_type) is distinct from (old.start_date, old.end_date, old.leave_type) then
      raise exception 'Approved leave cannot be changed; cancel it and request again';
    end if;
  end if;
  if new.status = 'approved' then
    select l.start_date, l.end_date into overlap from public.staff_leave l where l.staff_id = new.staff_id and l.id <> new.id and l.status = 'approved'
       and daterange(l.start_date::date, l.end_date::date, '[]') && daterange(new.start_date::date, new.end_date::date, '[]') limit 1;
    if overlap.start_date is not null then raise exception 'Overlaps approved leave % to %', overlap.start_date, overlap.end_date; end if;
  end if;
  return new;
end $$;

alter table public.department_managers enable row level security;
drop policy if exists department_managers_read on public.department_managers;
drop policy if exists department_managers_write on public.department_managers;
create policy department_managers_read on public.department_managers for select to authenticated using (public.pay_is_member(hospital_id));
create policy department_managers_write on public.department_managers for all to authenticated using (public.hr_can_manage(hospital_id)) with check (public.hr_can_manage(hospital_id));
revoke all on public.department_managers from anon;
grant select, insert, update, delete on public.department_managers to authenticated;
grant all on public.department_managers to service_role;
revoke execute on function public.department_managers_before(), public.dept_manages(uuid, text, text), public.shift_editable(uuid, uuid, text) from public, anon;
grant execute on function public.dept_manages(uuid, text, text), public.shift_editable(uuid, uuid, text) to authenticated, service_role;
