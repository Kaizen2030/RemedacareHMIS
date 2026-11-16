-- =============================================================================
-- RemedacareHMS — Scheduling engine
--   * provider_schedules / provider_schedule_exceptions: weekly working hours, leave, extra sessions
--   * appointment_types: default duration, department, resources, charge code
--   * appointments: starts_at / ends_at / clinician_key maintained by trigger; a clinician can never be
--     double-booked (trigger with advisory lock + exclusion constraint when the data allows it), and
--     bookings outside working hours / during leave are refused unless an override reason is given
--   * appointment_reminders: SMS queue (48 h, 2 h, missed visit, waiting-list offer) with confirm tokens,
--     sent by the appointments-reminders Edge Function
--   * appointment_waitlist: freed slots are offered automatically to the first matching patient
-- Works with the existing appointments table whatever the exact column types are (reads via to_jsonb).
-- Safe to re-run. Requires 20261114000000_payments_ledger.sql (pay_is_member).
-- =============================================================================

-- ---------------------------------------------------------------- 1. reference tables
create table if not exists public.appointment_types (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null,
  name            text not null,
  default_minutes integer not null default 30 check (default_minutes between 5 and 480),
  department      text,
  color           text,
  resources       text[] not null default '{}',
  charge_code     text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create unique index if not exists appointment_types_name_uq on public.appointment_types(hospital_id, lower(name));

create table if not exists public.provider_schedules (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  staff_id     text not null,                    -- staff.id as text (matches appointments.doctor_id)
  weekday      smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time   time not null,
  end_time     time not null,
  slot_minutes integer not null default 30 check (slot_minutes between 5 and 240),
  location     text,
  valid_from   date,
  valid_to     date,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists provider_schedules_lookup on public.provider_schedules(hospital_id, staff_id, weekday) where active;

create table if not exists public.provider_schedule_exceptions (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  staff_id    text not null,
  kind        text not null check (kind in ('leave', 'off', 'extra')),
  starts_on   date not null,
  ends_on     date not null,
  start_time  time,          -- null = the whole day
  end_time    time,
  reason      text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on),
  check ((start_time is null and end_time is null) or (start_time is not null and end_time is not null and end_time > start_time))
);
create index if not exists provider_schedule_exceptions_lookup on public.provider_schedule_exceptions(hospital_id, staff_id, starts_on, ends_on);

-- ---------------------------------------------------------------- 2. appointment columns
alter table public.appointments add column if not exists starts_at timestamptz;
alter table public.appointments add column if not exists ends_at timestamptz;
alter table public.appointments add column if not exists clinician_key text;
alter table public.appointments add column if not exists confirmed_at timestamptz;
alter table public.appointments add column if not exists confirmation_channel text;
alter table public.appointments add column if not exists reminder_opt_out boolean not null default false;
alter table public.appointments add column if not exists schedule_override_reason text;
alter table public.appointments add column if not exists recurrence_parent_id text;
alter table public.appointments add column if not exists recurrence_rule jsonb;
alter table public.appointments add column if not exists care_plan_ref text;
alter table public.appointments add column if not exists missed_flagged_at timestamptz;
alter table public.appointments add column if not exists telehealth_url text;
create index if not exists appointments_clinician_time on public.appointments(hospital_id, clinician_key, starts_at);
create index if not exists appointments_starts_at on public.appointments(starts_at) where starts_at is not null;

create or replace function public.sched_active_status(p_status text)
returns boolean language sql immutable as $$
  select coalesce(p_status, 'Scheduled') in ('Scheduled', 'Confirmed', 'Arrived')
$$;

-- Weekly template for a weekday, or none. Exceptions are checked separately.
create or replace function public.sched_has_template(p_hospital uuid, p_staff text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.provider_schedules s where s.hospital_id = p_hospital and s.staff_id = p_staff and s.active)
$$;

/** Why a clinician cannot work at [p_from, p_to) on p_date, or null when they can. */
create or replace function public.sched_unavailable_reason(p_hospital uuid, p_staff text, p_date date, p_from time, p_to time)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_exc record; v_hours text;
begin
  -- leave / off (whole day or overlapping hours)
  select * into v_exc from public.provider_schedule_exceptions e
   where e.hospital_id = p_hospital and e.staff_id = p_staff and e.kind in ('leave', 'off')
     and p_date between e.starts_on and e.ends_on
     and (e.start_time is null or (e.start_time < p_to and e.end_time > p_from))
   order by e.start_time nulls first limit 1;
  if found then
    return case when v_exc.kind = 'leave' then 'on leave' else 'not available' end
           || coalesce(' (' || v_exc.reason || ')', '');
  end if;
  if not public.sched_has_template(p_hospital, p_staff) then return null; end if;  -- no template = open hours
  -- an extra session covering the slot
  if exists (select 1 from public.provider_schedule_exceptions e
              where e.hospital_id = p_hospital and e.staff_id = p_staff and e.kind = 'extra'
                and p_date between e.starts_on and e.ends_on
                and (e.start_time is null or (e.start_time <= p_from and e.end_time >= p_to))) then
    return null;
  end if;
  if exists (select 1 from public.provider_schedules s
              where s.hospital_id = p_hospital and s.staff_id = p_staff and s.active
                and s.weekday = extract(dow from p_date)::int
                and (s.valid_from is null or p_date >= s.valid_from) and (s.valid_to is null or p_date <= s.valid_to)
                and s.start_time <= p_from and s.end_time >= p_to) then
    return null;
  end if;
  select string_agg(to_char(s.start_time, 'HH24:MI') || '–' || to_char(s.end_time, 'HH24:MI'), ', ' order by s.start_time) into v_hours
    from public.provider_schedules s
   where s.hospital_id = p_hospital and s.staff_id = p_staff and s.active and s.weekday = extract(dow from p_date)::int
     and (s.valid_from is null or p_date >= s.valid_from) and (s.valid_to is null or p_date <= s.valid_to);
  return 'outside working hours (' || coalesce(v_hours, 'no clinic on ' || trim(to_char(p_date, 'Day'))) || ')';
end $$;

-- ---------------------------------------------------------------- 3. booking guard
create or replace function public.sched_appointments_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  j jsonb := to_jsonb(new); o jsonb; v_date date; v_start time; v_end time; v_dur int; v_reason text;
  v_clash record; v_changed boolean;
begin
  new.clinician_key := nullif(trim(j->>'doctor_id'), '');
  begin
    v_date := nullif(j->>'appointment_date', '')::date;
    v_start := nullif(j->>'start_time', '')::time;
  exception when others then v_date := null; v_start := null; end;
  begin v_end := nullif(j->>'end_time', '')::time; exception when others then v_end := null; end;
  v_dur := coalesce(nullif(j->>'duration_minutes', '')::int, 30);
  if v_start is not null and (v_end is null or v_end <= v_start) then v_end := v_start + make_interval(mins => v_dur); end if;

  if v_date is null or v_start is null then
    new.starts_at := null; new.ends_at := null;
  else
    new.starts_at := (v_date + v_start) at time zone 'Africa/Nairobi';
    new.ends_at := (v_date + v_end) at time zone 'Africa/Nairobi';
    if new.ends_at <= new.starts_at then new.ends_at := new.starts_at + make_interval(mins => v_dur); end if;
  end if;

  if coalesce(current_setting('app.sched_backfill', true), '') = 'on' then return new; end if;
  if not public.sched_active_status(j->>'status') or new.clinician_key is null or new.starts_at is null then return new; end if;

  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    v_changed := new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
              or new.clinician_key is distinct from old.clinician_key
              or not public.sched_active_status(o->>'status');
    if not v_changed then return new; end if;
  end if;

  -- one booking at a time per clinician and day, so two receptionists cannot take the same slot
  perform pg_advisory_xact_lock(hashtext('sched|' || new.hospital_id::text || '|' || new.clinician_key || '|' || v_date::text));

  select a.* into v_clash from public.appointments a
   where a.hospital_id = new.hospital_id and a.clinician_key = new.clinician_key and a.id <> new.id
     and public.sched_active_status(to_jsonb(a)->>'status')
     and a.starts_at < new.ends_at and a.ends_at > new.starts_at
   order by a.starts_at limit 1;
  if found then
    raise exception '% already has an appointment from % to % — choose another time',
      coalesce(nullif(j->>'doctor_name', ''), 'This clinician'),
      to_char(v_clash.starts_at at time zone 'Africa/Nairobi', 'HH24:MI'),
      to_char(v_clash.ends_at at time zone 'Africa/Nairobi', 'HH24:MI')
      using errcode = 'P0001', hint = 'double_booking';
  end if;

  if coalesce(trim(j->>'schedule_override_reason'), '') = '' then
    v_reason := public.sched_unavailable_reason(new.hospital_id, new.clinician_key, v_date, v_start, v_end);
    if v_reason is not null then
      raise exception '% is % on % — pick another time or record an override reason',
        coalesce(nullif(j->>'doctor_name', ''), 'This clinician'), v_reason, to_char(v_date, 'Dy DD Mon')
        using errcode = 'P0001', hint = 'outside_schedule';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_sched_appointments_before on public.appointments;
create trigger trg_sched_appointments_before
  before insert or update on public.appointments
  for each row execute function public.sched_appointments_before();

-- back-fill starts_at / ends_at / clinician_key for existing rows without re-checking old bookings
do $$ begin
  perform set_config('app.sched_backfill', 'on', true);
  update public.appointments set clinician_key = clinician_key where starts_at is null or clinician_key is null;
  perform set_config('app.sched_backfill', '', true);
end $$;

-- Belt and braces: an exclusion constraint, when btree_gist is available and existing data has no clashes.
do $$
declare v_overlaps int;
begin
  begin
    create extension if not exists btree_gist;
  exception when others then
    raise notice 'btree_gist not available; the booking trigger alone prevents double-booking';
    return;
  end;
  if exists (select 1 from pg_constraint where conname = 'appointments_no_clinician_overlap') then return; end if;
  select count(*) into v_overlaps from public.appointments a join public.appointments b
    on a.hospital_id = b.hospital_id and a.clinician_key = b.clinician_key and a.id::text < b.id::text
   and a.starts_at < b.ends_at and a.ends_at > b.starts_at
   where public.sched_active_status(to_jsonb(a)->>'status') and public.sched_active_status(to_jsonb(b)->>'status');
  if v_overlaps > 0 then
    raise notice '% existing double-bookings found; exclusion constraint skipped (the trigger still blocks new ones)', v_overlaps;
    return;
  end if;
  execute $c$alter table public.appointments add constraint appointments_no_clinician_overlap
    exclude using gist (hospital_id with =, clinician_key with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (clinician_key is not null and starts_at is not null and ends_at > starts_at
           and coalesce(status, 'Scheduled') in ('Scheduled', 'Confirmed', 'Arrived'))$c$;
exception when others then
  raise notice 'exclusion constraint not added (%); the trigger still blocks double-booking', sqlerrm;
end $$;

-- ---------------------------------------------------------------- 4. available slots for the booking screen
create or replace function public.sched_available_slots(p_hospital uuid, p_clinician text, p_date date, p_minutes integer default 30)
returns table(slot time, slot_end time, available boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
declare v_step int; v_now timestamptz := now(); w record; v_has boolean;
begin
  if not public.pay_is_member(p_hospital) then raise exception 'Not a member of this hospital'; end if;
  p_minutes := greatest(5, least(coalesce(p_minutes, 30), 480));
  v_has := public.sched_has_template(p_hospital, p_clinician);
  for w in
    select distinct x.ws, x.we, x.step from (
      select s.start_time as ws, s.end_time as we, s.slot_minutes as step from public.provider_schedules s
       where v_has and s.hospital_id = p_hospital and s.staff_id = p_clinician and s.active and s.weekday = extract(dow from p_date)::int
         and (s.valid_from is null or p_date >= s.valid_from) and (s.valid_to is null or p_date <= s.valid_to)
      union all
      select e.start_time, e.end_time, 30 from public.provider_schedule_exceptions e
       where v_has and e.hospital_id = p_hospital and e.staff_id = p_clinician and e.kind = 'extra'
         and p_date between e.starts_on and e.ends_on and e.start_time is not null
      union all
      select time '08:00', time '18:00', 30 where not v_has
    ) x order by x.ws
  loop
    v_step := greatest(5, least(w.step, p_minutes));
    return query
      select g.t::time, (g.t + make_interval(mins => p_minutes))::time,
             r.why is null, r.why
        from generate_series(p_date + w.ws, p_date + w.we - make_interval(mins => p_minutes), make_interval(mins => v_step)) as g(t)
        cross join lateral (
          select case
            when (g.t at time zone 'Africa/Nairobi') < v_now then 'in the past'
            when exists (select 1 from public.appointments a
                          where a.hospital_id = p_hospital and a.clinician_key = p_clinician
                            and public.sched_active_status(to_jsonb(a)->>'status')
                            and a.starts_at < ((g.t + make_interval(mins => p_minutes)) at time zone 'Africa/Nairobi')
                            and a.ends_at > (g.t at time zone 'Africa/Nairobi')) then 'booked'
            else public.sched_unavailable_reason(p_hospital, p_clinician, p_date, g.t::time, (g.t + make_interval(mins => p_minutes))::time)
          end as why) r;
  end loop;
end $$;

-- ---------------------------------------------------------------- 5. reminders
create table if not exists public.appointment_reminders (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null,
  appointment_id text not null,
  kind           text not null check (kind in ('48h', '2h', 'missed', 'offer')),
  channel        text not null default 'sms',
  due_at         timestamptz not null,
  phone          text,
  message        text,
  confirm_token  text unique default replace(gen_random_uuid()::text, '-', ''),
  status         text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled', 'skipped')),
  attempts       integer not null default 0,
  last_error     text,
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  unique (appointment_id, kind, due_at)
);
create index if not exists appointment_reminders_due on public.appointment_reminders(due_at) where status = 'queued';

create or replace function public.sched_patient_phone(p_patient text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p_patient is null or p_patient = '' then return null; end if;
  select to_jsonb(p)->>'phone' into v from public.patients p where p.id::text = p_patient;
  return nullif(trim(v), '');
end $$;

create or replace function public.sched_appointments_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); v_active boolean; v_phone text; v_old_active boolean := false;
        v_wait record; v_note text;
begin
  v_active := public.sched_active_status(j->>'status') and new.starts_at is not null
              and not coalesce((j->>'reminder_opt_out')::boolean, false);
  if tg_op = 'UPDATE' then v_old_active := public.sched_active_status(to_jsonb(old)->>'status'); end if;

  if tg_op = 'UPDATE' and (new.starts_at is distinct from old.starts_at or not v_active) then
    update public.appointment_reminders set status = 'cancelled'
     where appointment_id = new.id::text and status = 'queued' and kind in ('48h', '2h');
  end if;

  if v_active and (j->>'status') <> 'Arrived' and new.starts_at > now() then
    v_phone := public.sched_patient_phone(j->>'patient_id');
    insert into public.appointment_reminders(hospital_id, appointment_id, kind, due_at, phone)
    select new.hospital_id, new.id::text, k.kind, k.due, v_phone
      from (values ('48h', new.starts_at - interval '48 hours'), ('2h', new.starts_at - interval '2 hours')) as k(kind, due)
     where k.due > now()
    on conflict (appointment_id, kind, due_at) do update set status = 'queued', phone = excluded.phone
      where public.appointment_reminders.status = 'cancelled';
  end if;

  -- A future booking was cancelled: offer the freed slot to the first matching patient on the waiting list.
  if tg_op = 'UPDATE' and v_old_active and (j->>'status') = 'Cancelled'
     and new.starts_at is not null and new.starts_at > now() + interval '1 hour' then
    select * into v_wait from public.appointment_waitlist w
     where w.hospital_id = new.hospital_id and w.status = 'waiting'
       and (w.staff_id is null or w.staff_id = new.clinician_key)
       and (w.department is null or w.department = '' or lower(w.department) = lower(coalesce(j->>'department', '')))
       and (w.earliest_date is null or w.earliest_date <= (new.starts_at at time zone 'Africa/Nairobi')::date)
       and (w.latest_date is null or w.latest_date >= (new.starts_at at time zone 'Africa/Nairobi')::date)
     order by w.priority desc, w.created_at
     limit 1 for update skip locked;
    if found then
      update public.appointment_waitlist set status = 'offered', offered_at = now(),
             offer_expires_at = least(new.starts_at - interval '1 hour', now() + interval '4 hours'),
             offered_slot = jsonb_build_object('doctor_id', j->>'doctor_id', 'doctor_name', j->>'doctor_name',
               'department', j->>'department', 'appointment_type', j->>'appointment_type',
               'appointment_date', j->>'appointment_date', 'start_time', j->>'start_time',
               'end_time', j->>'end_time', 'duration_minutes', j->>'duration_minutes', 'freed_from', new.id::text)
       where id = v_wait.id;
      v_note := 'A slot is free on ' || to_char(new.starts_at at time zone 'Africa/Nairobi', 'Dy DD Mon "at" HH24:MI')
                || coalesce(' with ' || nullif(j->>'doctor_name', ''), '') || '. Call us to take it.';
      insert into public.appointment_reminders(hospital_id, appointment_id, kind, due_at, phone, message)
      values (new.hospital_id, new.id::text, 'offer', now(), coalesce(v_wait.phone, public.sched_patient_phone(v_wait.patient_id)), v_note)
      on conflict do nothing;
    end if;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- 6. waiting list
create table if not exists public.appointment_waitlist (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  patient_id       text,
  patient_name     text not null,
  phone            text,
  staff_id         text,               -- null = any clinician
  department       text,
  appointment_type text,
  earliest_date    date,
  latest_date      date,
  preferred_times  text,
  priority         smallint not null default 0,
  status           text not null default 'waiting' check (status in ('waiting', 'offered', 'booked', 'cancelled', 'expired')),
  offered_slot     jsonb,
  offered_at       timestamptz,
  offer_expires_at timestamptz,
  booked_appointment_id text,
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);
create index if not exists appointment_waitlist_open on public.appointment_waitlist(hospital_id, status, created_at);

drop trigger if exists trg_sched_appointments_after on public.appointments;
create trigger trg_sched_appointments_after
  after insert or update on public.appointments
  for each row execute function public.sched_appointments_after();

-- ---------------------------------------------------------------- 7. missed visits + expired offers (run by the sweep)
create or replace function public.sched_flag_missed(p_grace interval default interval '60 minutes')
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in
    update public.appointments a set status = 'No-Show', missed_flagged_at = now()
     where coalesce(a.status, 'Scheduled') in ('Scheduled', 'Confirmed')
       and a.ends_at is not null and a.ends_at + p_grace < now()
       and a.ends_at > now() - interval '7 days'
    returning a.id, a.hospital_id, to_jsonb(a) as j
  loop
    n := n + 1;
    if not coalesce((r.j->>'reminder_opt_out')::boolean, false) then
      insert into public.appointment_reminders(hospital_id, appointment_id, kind, due_at, phone)
      values (r.hospital_id, r.id::text, 'missed', now(), public.sched_patient_phone(r.j->>'patient_id'))
      on conflict do nothing;
    end if;
  end loop;
  update public.appointment_waitlist set status = 'waiting', offered_slot = null, offered_at = null, offer_expires_at = null
   where status = 'offered' and offer_expires_at < now();
  return n;
end $$;

-- Confirm link from the SMS (called by the Edge Function with the token only).
create or replace function public.sched_confirm_by_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rem record; v_appt jsonb;
begin
  if p_token is null or length(p_token) < 16 then return jsonb_build_object('ok', false, 'error', 'invalid link'); end if;
  select * into v_rem from public.appointment_reminders where confirm_token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid link'); end if;
  update public.appointments a set status = case when a.status = 'Scheduled' then 'Confirmed' else a.status end,
         confirmed_at = coalesce(a.confirmed_at, now()), confirmation_channel = 'sms_link'
   where a.id::text = v_rem.appointment_id and coalesce(a.status, 'Scheduled') in ('Scheduled', 'Confirmed')
  returning to_jsonb(a) into v_appt;
  if v_appt is null then return jsonb_build_object('ok', false, 'error', 'This appointment can no longer be confirmed. Please call the hospital.'); end if;
  return jsonb_build_object('ok', true, 'date', v_appt->>'appointment_date', 'time', left(v_appt->>'start_time', 5),
                            'doctor', v_appt->>'doctor_name');
end $$;

-- ---------------------------------------------------------------- 8. security
alter table public.appointment_types enable row level security;
alter table public.provider_schedules enable row level security;
alter table public.provider_schedule_exceptions enable row level security;
alter table public.appointment_waitlist enable row level security;
alter table public.appointment_reminders enable row level security;

do $$
declare t text;
begin
  foreach t in array array['appointment_types', 'provider_schedules', 'provider_schedule_exceptions', 'appointment_waitlist'] loop
    execute format('drop policy if exists %I on public.%I', t || '_member', t);
    execute format('create policy %I on public.%I for all using (public.pay_is_member(hospital_id)) with check (public.pay_is_member(hospital_id))', t || '_member', t);
  end loop;
end $$;
drop policy if exists appointment_reminders_read on public.appointment_reminders;
create policy appointment_reminders_read on public.appointment_reminders for select using (public.pay_is_member(hospital_id));

grant select, insert, update, delete on public.appointment_types, public.provider_schedules,
  public.provider_schedule_exceptions, public.appointment_waitlist to authenticated;
grant select on public.appointment_reminders to authenticated;
grant all on public.appointment_types, public.provider_schedules, public.provider_schedule_exceptions,
  public.appointment_waitlist, public.appointment_reminders to service_role;

revoke execute on function public.sched_flag_missed(interval), public.sched_confirm_by_token(text),
  public.sched_patient_phone(text), public.sched_has_template(uuid, text),
  public.sched_unavailable_reason(uuid, text, date, time, time) from public, anon, authenticated;
grant execute on function public.sched_flag_missed(interval), public.sched_confirm_by_token(text),
  public.sched_patient_phone(text), public.sched_has_template(uuid, text),
  public.sched_unavailable_reason(uuid, text, date, time, time) to service_role;
revoke execute on function public.sched_available_slots(uuid, text, date, integer) from public, anon;
grant execute on function public.sched_available_slots(uuid, text, date, integer) to authenticated, service_role;

-- Default appointment types (only for hospitals that have none yet).
insert into public.appointment_types(hospital_id, name, default_minutes)
select h.id, t.name, t.mins from public.hospitals h
cross join (values ('Consultation', 20), ('Follow-up', 15), ('Procedure', 45), ('Lab Review', 15), ('Antenatal', 30),
                   ('Vaccination', 10), ('Dental', 30), ('Chronic care review', 20), ('Telehealth', 20), ('Other', 30)) as t(name, mins)
where not exists (select 1 from public.appointment_types x where x.hospital_id = h.id)
on conflict do nothing;
