-- =============================================================================
-- RemedacareHMS - HR: DUTY ROSTER, LEAVE APPROVAL AND BALANCES, LICENCES AND CPD
-- Generated from supabase/migrations/20261218000000_hr_roster_leave.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.ref_try_uuid(text)') is null then
    raise exception 'Run 11_audit_privacy.sql first. Nothing was changed.';
  end if;
end $$;

do $$ begin
  if to_regclass('public.staff') is null then raise exception 'staff table not found: HR needs the original RemedacareHMS schema.'; end if;
end $$;

create or replace function public.hr_can_manage(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.member and c.staff_active and (c.canonical = 'admin' or lower(coalesce(c.raw_role, '')) ~ '(^hr$|human resource|hr manager|hr officer)')
                     from public.pay_user_context(p_hospital, auth.uid()) c), false)
$$;
create or replace function public.hr_can_roster(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.hr_can_manage(p_hospital) or coalesce((select c.member and c.staff_active and lower(coalesce(c.raw_role, '')) ~ '(in-charge|in charge|matron|supervisor|nursing officer in charge|head of department|hod)'
                     from public.pay_user_context(p_hospital, auth.uid()) c), false)
$$;
create or replace function public.hr_my_staff_id(p_hospital uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.id from public.staff s join auth.users u on lower(u.email) = lower(s.email) where u.id = auth.uid() and s.hospital_id::text = p_hospital::text limit 1
$$;

create table if not exists public.hr_shift_types (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid,
  code        text not null,
  label       text not null,
  start_time  time,
  hours       numeric not null default 0 check (hours >= 0 and hours <= 24),
  counts_as_work boolean not null default true
);
create unique index if not exists hr_shift_types_key on public.hr_shift_types(coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
insert into public.hr_shift_types(hospital_id, code, label, start_time, hours, counts_as_work) values
  (null, 'D', 'Day 07:00–19:00', '07:00', 12, true),
  (null, 'N', 'Night 19:00–07:00', '19:00', 12, true),
  (null, 'AM', 'Morning 07:00–13:00', '07:00', 6, true),
  (null, 'PM', 'Afternoon 13:00–19:00', '13:00', 6, true),
  (null, 'OC', 'On call (24 h)', '07:00', 24, false),
  (null, 'OFF', 'Off duty', null, 0, false)
on conflict do nothing;

create table if not exists public.hr_settings (
  hospital_id     uuid primary key,
  min_rest_hours  numeric not null default 11,
  max_week_hours  numeric not null default 60,
  timezone        text not null default 'Africa/Nairobi'
);

create table if not exists public.staff_shifts (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  staff_id    uuid not null,
  shift_date  date not null,
  shift_code  text not null,
  unit        text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  flags       jsonb not null default '[]'::jsonb,
  notes       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create unique index if not exists staff_shifts_one_per_day on public.staff_shifts(staff_id, shift_date, shift_code);
create index if not exists staff_shifts_roster on public.staff_shifts(hospital_id, shift_date);

create or replace function public.staff_shifts_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.hr_shift_types; st jsonb; tz text; rest numeric; maxh numeric; clash record; lv record; prev_end timestamptz; next_start timestamptz; wk numeric; f jsonb := '[]';
begin
  select to_jsonb(s) into st from public.staff s where s.id = new.staff_id;
  if st is null or (st->>'hospital_id') is distinct from new.hospital_id::text then raise exception 'Staff member not found in this hospital'; end if;
  select * into t from public.hr_shift_types where code = upper(new.shift_code) and (hospital_id = new.hospital_id or hospital_id is null) order by hospital_id nulls last limit 1;
  if t.id is null then raise exception 'Unknown shift code %', new.shift_code; end if;
  new.shift_code := t.code;
  select coalesce(min_rest_hours, 11), coalesce(max_week_hours, 60), coalesce(timezone, 'Africa/Nairobi') into rest, maxh, tz from public.hr_settings where hospital_id = new.hospital_id;
  rest := coalesce(rest, 11); maxh := coalesce(maxh, 60); tz := coalesce(tz, 'Africa/Nairobi');
  if t.start_time is not null and t.hours > 0 then
    new.starts_at := (new.shift_date + t.start_time) at time zone tz;
    new.ends_at := new.starts_at + make_interval(hours => t.hours::int, mins => ((t.hours - floor(t.hours)) * 60)::int);
  else
    new.starts_at := null; new.ends_at := null;
  end if;

  select * into lv from public.staff_leave l where l.staff_id = new.staff_id and coalesce(l.status, 'approved') = 'approved'
     and new.shift_date between l.start_date::date and l.end_date::date limit 1;
  if lv.leave_type is not null and t.code <> 'OFF' then raise exception '% is on approved % that day', st->>'full_name', lv.leave_type; end if;

  if new.starts_at is not null then
    select s.shift_code, s.shift_date into clash from public.staff_shifts s
     where s.staff_id = new.staff_id and s.id <> new.id and s.starts_at is not null
       and tstzrange(s.starts_at, s.ends_at) && tstzrange(new.starts_at, new.ends_at) limit 1;
    if clash.shift_code is not null then raise exception '% is already rostered % on % at that time', st->>'full_name', clash.shift_code, clash.shift_date; end if;
    if t.counts_as_work then
      select max(s.ends_at) into prev_end from public.staff_shifts s join public.hr_shift_types ty on ty.code = s.shift_code and (ty.hospital_id = s.hospital_id or ty.hospital_id is null)
       where s.staff_id = new.staff_id and s.id <> new.id and s.ends_at <= new.starts_at and ty.counts_as_work;
      select min(s.starts_at) into next_start from public.staff_shifts s join public.hr_shift_types ty on ty.code = s.shift_code and (ty.hospital_id = s.hospital_id or ty.hospital_id is null)
       where s.staff_id = new.staff_id and s.id <> new.id and s.starts_at >= new.ends_at and ty.counts_as_work;
      if (prev_end is not null and extract(epoch from new.starts_at - prev_end) / 3600 < rest) or (next_start is not null and extract(epoch from next_start - new.ends_at) / 3600 < rest) then
        f := f || jsonb_build_array('Less than ' || rest || ' hours of rest between shifts');
      end if;
      select coalesce(sum(extract(epoch from s.ends_at - s.starts_at) / 3600), 0) into wk from public.staff_shifts s
       where s.staff_id = new.staff_id and s.id <> new.id and s.starts_at is not null and s.shift_date between new.shift_date - 6 and new.shift_date;
      if wk + t.hours > maxh then f := f || jsonb_build_array(round(wk + t.hours) || ' hours in 7 days (over ' || maxh || ')'); end if;
    end if;
  end if;
  new.flags := f;
  return new;
end $$;
drop trigger if exists trg_staff_shifts_before on public.staff_shifts;
create trigger trg_staff_shifts_before before insert or update on public.staff_shifts for each row execute function public.staff_shifts_before();

create table if not exists public.staff_leave (
  id uuid primary key default gen_random_uuid(), hospital_id uuid not null, staff_id uuid not null, leave_type text not null,
  start_date date not null, end_date date not null, reason text, created_at timestamptz not null default now());
alter table public.staff_leave add column if not exists status text;
alter table public.staff_leave add column if not exists working_days numeric;
alter table public.staff_leave add column if not exists requested_by uuid;
alter table public.staff_leave add column if not exists decided_by uuid;
alter table public.staff_leave add column if not exists decided_at timestamptz;
alter table public.staff_leave add column if not exists decision_note text;
update public.staff_leave set status = 'approved' where status is null;     -- leave recorded before approval existed
do $$ begin
  alter table public.staff_leave add constraint staff_leave_status_check check (status in ('requested', 'approved', 'rejected', 'cancelled'));
exception when duplicate_object then null;
end $$;

create table if not exists public.hr_leave_entitlements (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid,
  leave_type  text not null,
  days        numeric not null,
  calendar_days boolean not null default false
);
create unique index if not exists hr_leave_entitlements_key on public.hr_leave_entitlements(coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), leave_type);
insert into public.hr_leave_entitlements(hospital_id, leave_type, days, calendar_days) values
  (null, 'Annual Leave', 21, false), (null, 'Sick Leave', 14, false), (null, 'Maternity Leave', 90, true), (null, 'Paternity Leave', 14, true)
on conflict do nothing;

create or replace function public.working_days(p_from date, p_to date)
returns integer language sql immutable as $$
  select count(*)::int from generate_series(p_from, p_to, interval '1 day') d where extract(isodow from d) < 6
$$;

create or replace function public.staff_leave_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare cal boolean; overlap record; me uuid := public.hr_my_staff_id(new.hospital_id::uuid);
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
        if not public.hr_can_manage(new.hospital_id::uuid) then raise exception 'Only HR or an administrator can approve or reject leave'; end if;
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
drop trigger if exists trg_staff_leave_before on public.staff_leave;
create trigger trg_staff_leave_before before insert or update on public.staff_leave for each row execute function public.staff_leave_before();

create or replace function public.staff_leave_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') and current_date between new.start_date::date and new.end_date::date then
    update public.staff set status = 'On Leave' where id = new.staff_id and status = 'Active';
  end if;
  if new.status = 'cancelled' and tg_op = 'UPDATE' and old.status = 'approved' then
    update public.staff set status = 'Active' where id = new.staff_id and status = 'On Leave';
  end if;
  return null;
end $$;
drop trigger if exists trg_staff_leave_after on public.staff_leave;
create trigger trg_staff_leave_after after insert or update on public.staff_leave for each row execute function public.staff_leave_after();

create or replace function public.leave_balances(p_hospital uuid, p_staff uuid, p_year integer default extract(year from current_date)::int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not (public.hr_can_manage(p_hospital) or public.hr_my_staff_id(p_hospital) = p_staff) then raise exception 'Not allowed'; end if;
  select coalesce(jsonb_object_agg(e.leave_type, jsonb_build_object('entitled', e.days,
           'used', coalesce((select sum(l.working_days) from public.staff_leave l where l.staff_id = p_staff and l.leave_type = e.leave_type and l.status = 'approved' and extract(year from l.start_date::date) = p_year), 0),
           'pending', coalesce((select sum(l.working_days) from public.staff_leave l where l.staff_id = p_staff and l.leave_type = e.leave_type and l.status = 'requested' and extract(year from l.start_date::date) = p_year), 0))), '{}'::jsonb)
    into r
    from (select distinct on (leave_type) * from public.hr_leave_entitlements where hospital_id = p_hospital or hospital_id is null order by leave_type, hospital_id nulls last) e;
  return r;
end $$;

create table if not exists public.staff_licences (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  staff_id     uuid not null,
  body         text not null,
  number       text not null,
  issued_on    date,
  expires_on   date not null,
  verified_by  uuid,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists staff_licences_staff on public.staff_licences(hospital_id, staff_id, expires_on desc);

create table if not exists public.staff_cpd (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  staff_id    uuid not null,
  activity    text not null,
  provider    text,
  done_on     date not null,
  points      numeric not null check (points > 0),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists staff_cpd_staff on public.staff_cpd(hospital_id, staff_id, done_on);

create table if not exists public.hr_cpd_requirements (
  hospital_id uuid not null,
  body        text not null,
  points_per_year numeric not null check (points_per_year >= 0),
  primary key (hospital_id, body)
);

create or replace function public.staff_licences_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(new.number), '') = '' then raise exception 'Record the licence / registration number'; end if;
  if new.issued_on is not null and new.expires_on < new.issued_on then raise exception 'Expiry is before the issue date'; end if;
  if new.verified_by is not null and (tg_op = 'INSERT' or old.verified_by is null) then new.verified_by := auth.uid(); new.verified_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_staff_licences_before on public.staff_licences;
create trigger trg_staff_licences_before before insert or update on public.staff_licences for each row execute function public.staff_licences_before();

create or replace function public.hr_compliance(p_hospital uuid, p_days integer default 60)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.hr_can_manage(p_hospital) then raise exception 'Only HR or an administrator can see the compliance list'; end if;
  with st as (select s.id, s.full_name, s.role, coalesce(to_jsonb(s)->>'status', 'Active') status, nullif(to_jsonb(s)->>'registration_expiry', '')::date reg_expiry
                from public.staff s where s.hospital_id::text = p_hospital::text and coalesce(to_jsonb(s)->>'status', 'Active') not in ('Terminated', 'Deceased', 'Rejected')),
       lic as (select distinct on (l.staff_id, l.body) l.* from public.staff_licences l where l.hospital_id = p_hospital order by l.staff_id, l.body, l.expires_on desc),
       cpd as (select staff_id, sum(points) pts from public.staff_cpd where hospital_id = p_hospital and extract(year from done_on) = extract(year from current_date) group by staff_id)
  select jsonb_build_object(
    'expired', (select coalesce(jsonb_agg(jsonb_build_object('staff', st.full_name, 'role', st.role, 'body', lic.body, 'number', lic.number, 'expires_on', lic.expires_on) order by lic.expires_on), '[]'::jsonb)
                  from lic join st on st.id = lic.staff_id where lic.expires_on < current_date),
    'expiring', (select coalesce(jsonb_agg(jsonb_build_object('staff', st.full_name, 'role', st.role, 'body', lic.body, 'number', lic.number, 'expires_on', lic.expires_on, 'days', lic.expires_on - current_date) order by lic.expires_on), '[]'::jsonb)
                  from lic join st on st.id = lic.staff_id where lic.expires_on between current_date and current_date + p_days),
    'no_licence', (select coalesce(jsonb_agg(jsonb_build_object('staff', st.full_name, 'role', st.role, 'registration_expiry', st.reg_expiry) order by st.full_name), '[]'::jsonb)
                  from st where public.pay_canonical_role(st.role) = 'clinical' and not exists (select 1 from lic where lic.staff_id = st.id)),
    'cpd', (select coalesce(jsonb_agg(jsonb_build_object('staff', st.full_name, 'role', st.role, 'points', coalesce(cpd.pts, 0),
               'required', (select max(q.points_per_year) from public.hr_cpd_requirements q join lic on lic.body = q.body where q.hospital_id = p_hospital and lic.staff_id = st.id)) order by coalesce(cpd.pts, 0)), '[]'::jsonb)
                  from st left join cpd on cpd.staff_id = st.id where public.pay_canonical_role(st.role) = 'clinical')
  ) into r;
  return r;
end $$;

alter table public.hr_shift_types enable row level security;
alter table public.hr_settings enable row level security;
alter table public.staff_shifts enable row level security;
alter table public.staff_leave enable row level security;
alter table public.hr_leave_entitlements enable row level security;
alter table public.staff_licences enable row level security;
alter table public.staff_cpd enable row level security;
alter table public.hr_cpd_requirements enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'staff_leave' loop
    execute format('drop policy if exists %I on public.staff_leave', p.policyname);
  end loop;
end $$;
drop policy if exists hr_shift_types_read on public.hr_shift_types;
drop policy if exists hr_shift_types_write on public.hr_shift_types;
drop policy if exists hr_settings_rw on public.hr_settings;
drop policy if exists staff_shifts_read on public.staff_shifts;
drop policy if exists staff_shifts_write on public.staff_shifts;
drop policy if exists hr_leave_entitlements_read on public.hr_leave_entitlements;
drop policy if exists hr_leave_entitlements_write on public.hr_leave_entitlements;
drop policy if exists staff_licences_rw on public.staff_licences;
drop policy if exists staff_licences_own on public.staff_licences;
drop policy if exists staff_cpd_rw on public.staff_cpd;
drop policy if exists hr_cpd_requirements_rw on public.hr_cpd_requirements;

create policy hr_shift_types_read on public.hr_shift_types for select to authenticated using (hospital_id is null or public.pay_is_member(hospital_id));
create policy hr_shift_types_write on public.hr_shift_types for all to authenticated using (hospital_id is not null and public.hr_can_manage(hospital_id)) with check (hospital_id is not null and public.hr_can_manage(hospital_id));
create policy hr_settings_rw on public.hr_settings for all to authenticated using (public.pay_is_member(hospital_id)) with check (public.hr_can_manage(hospital_id));
create policy staff_shifts_read on public.staff_shifts for select to authenticated using (public.pay_is_member(hospital_id));
create policy staff_shifts_write on public.staff_shifts for all to authenticated using (public.hr_can_roster(hospital_id)) with check (public.hr_can_roster(hospital_id));
create policy staff_leave_hr on public.staff_leave for all to authenticated
  using (public.hr_can_manage(public.ref_try_uuid(hospital_id::text)) or staff_id = public.hr_my_staff_id(public.ref_try_uuid(hospital_id::text)))
  with check (public.hr_can_manage(public.ref_try_uuid(hospital_id::text)) or staff_id = public.hr_my_staff_id(public.ref_try_uuid(hospital_id::text)));
create policy hr_leave_entitlements_read on public.hr_leave_entitlements for select to authenticated using (hospital_id is null or public.pay_is_member(hospital_id));
create policy hr_leave_entitlements_write on public.hr_leave_entitlements for all to authenticated using (hospital_id is not null and public.hr_can_manage(hospital_id)) with check (hospital_id is not null and public.hr_can_manage(hospital_id));
create policy staff_licences_rw on public.staff_licences for all to authenticated using (public.hr_can_manage(hospital_id)) with check (public.hr_can_manage(hospital_id));
create policy staff_licences_own on public.staff_licences for select to authenticated using (staff_id = public.hr_my_staff_id(hospital_id));
create policy staff_cpd_rw on public.staff_cpd for all to authenticated
  using (public.hr_can_manage(hospital_id) or staff_id = public.hr_my_staff_id(hospital_id)) with check (public.hr_can_manage(hospital_id) or staff_id = public.hr_my_staff_id(hospital_id));
create policy hr_cpd_requirements_rw on public.hr_cpd_requirements for all to authenticated using (public.pay_is_member(hospital_id)) with check (public.hr_can_manage(hospital_id));

revoke all on public.hr_shift_types, public.hr_settings, public.staff_shifts, public.hr_leave_entitlements, public.staff_licences, public.staff_cpd, public.hr_cpd_requirements from anon;
revoke all on public.staff_leave from anon;
grant select, insert, update, delete on public.staff_shifts to authenticated;
grant select, insert, update on public.hr_shift_types, public.hr_settings, public.staff_leave, public.hr_leave_entitlements, public.staff_licences, public.staff_cpd, public.hr_cpd_requirements to authenticated;
grant all on public.hr_shift_types, public.hr_settings, public.staff_shifts, public.hr_leave_entitlements, public.staff_licences, public.staff_cpd, public.hr_cpd_requirements, public.staff_leave to service_role;
revoke execute on function public.staff_shifts_before(), public.staff_leave_before(), public.staff_leave_after(), public.staff_licences_before() from public, anon, authenticated;
revoke execute on function public.hr_can_manage(uuid), public.hr_can_roster(uuid), public.hr_my_staff_id(uuid), public.leave_balances(uuid, uuid, integer), public.hr_compliance(uuid, integer) from public, anon;
grant execute on function public.hr_can_manage(uuid), public.hr_can_roster(uuid), public.hr_my_staff_id(uuid), public.leave_balances(uuid, uuid, integer), public.hr_compliance(uuid, integer) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['staff_shifts', 'staff_leave', 'staff_licences', 'staff_cpd'] loop
    if to_regprocedure('public.audit_row_change()') is not null then
      execute format('drop trigger if exists trg_audit_change on public.%I', t);
      execute format('create trigger trg_audit_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
    end if;
  end loop;
end $$;

commit;

select 'roster, leave and licences' as check_name, case when to_regclass('public.staff_shifts') is not null and to_regclass('public.staff_licences') is not null and exists (select 1 from pg_trigger where tgname = 'trg_staff_leave_before') then 'OK' else 'PROBLEM' end as result
    union all select 'existing leave records kept as approved', (select count(*) || ' records' from public.staff_leave where status = 'approved');
