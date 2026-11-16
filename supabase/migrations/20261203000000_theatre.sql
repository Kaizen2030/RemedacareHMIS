-- Theatre: case booking with room clash check, the WHO Surgical Safety Checklist enforced by the database
-- (sign in → time out → sign out, item by item), operating timestamps, structured operation note, recovery
-- (modified Aldrete score; discharge from recovery at 9 or more), implants and consumables register,
-- complications register (Clavien–Dindo grade) and utilisation figures. Clinical staff only.

create table if not exists public.theatre_rooms (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  name        text not null,
  active      boolean not null default true,
  unique (hospital_id, name)
);

create table if not exists public.theatre_cases (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null,
  patient_id         uuid not null,
  visit_id           text,
  room_id            uuid references public.theatre_rooms(id),
  procedure          text not null,
  laterality         text check (laterality in ('left', 'right', 'bilateral', 'midline', 'na')),
  urgency            text not null default 'elective' check (urgency in ('elective', 'urgent', 'emergency')),
  surgeon            text not null,
  assistant          text,
  anaesthetist       text,
  scrub_nurse        text,
  anaesthesia        text check (anaesthesia in ('general', 'spinal', 'epidural', 'regional_block', 'local', 'sedation')),
  asa                text check (asa ~ '^[1-6]E?$'),
  scheduled_start    timestamptz not null,
  scheduled_end      timestamptz not null,
  status             text not null default 'booked' check (status in ('booked', 'in_theatre', 'operating', 'closing', 'recovery', 'completed', 'cancelled', 'postponed')),
  cancel_reason      text,
  sign_in            jsonb not null default '{}'::jsonb,
  time_out           jsonb not null default '{}'::jsonb,
  sign_out           jsonb not null default '{}'::jsonb,
  sign_in_at         timestamptz,
  sign_in_by         uuid,
  time_out_at        timestamptz,
  time_out_by        uuid,
  sign_out_at        timestamptz,
  sign_out_by        uuid,
  in_theatre_at      timestamptz,
  anaesthesia_start  timestamptz,
  knife_to_skin      timestamptz,
  closure_at         timestamptz,
  out_of_theatre     timestamptz,
  recovery_out_at    timestamptz,
  op_note            jsonb not null default '{}'::jsonb,
  recovery           jsonb not null default '[]'::jsonb check (jsonb_typeof(recovery) = 'array'),
  complication_grade text check (complication_grade in ('none', 'I', 'II', 'IIIa', 'IIIb', 'IVa', 'IVb', 'V')),
  complications      text,
  addendum           text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (scheduled_end > scheduled_start)
);
create index if not exists theatre_cases_day on public.theatre_cases(hospital_id, scheduled_start);

create table if not exists public.theatre_items (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  case_id      uuid not null references public.theatre_cases(id) on delete cascade,
  kind         text not null check (kind in ('implant', 'consumable', 'instrument_set')),
  name         text not null,
  manufacturer text,
  lot_number   text,
  serial       text,
  quantity     numeric not null default 1 check (quantity > 0),
  site         text,
  recorded_by  uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  check (kind <> 'implant' or coalesce(lot_number, serial, '') <> '')
);
create index if not exists theatre_items_case on public.theatre_items(case_id);

-- WHO checklist: each item and the answers that count as "done" ('no' on a safety item blocks the phase)
create or replace function public.theatre_phase_items(p_phase text)
returns jsonb language sql immutable as $$
  select case p_phase
    when 'sign_in' then '{
      "identity_confirmed": ["yes"], "site_marked": ["yes", "na"], "consent": ["yes"], "anaesthesia_check": ["yes"],
      "pulse_oximeter": ["yes"], "allergy": ["no", "yes"], "difficult_airway": ["no", "yes_ready"], "blood_loss_risk": ["no", "yes_planned"]}'::jsonb
    when 'time_out' then '{
      "team_introduced": ["yes"], "patient_site_procedure": ["yes"], "antibiotics": ["yes", "na"],
      "critical_events": ["yes"], "sterility": ["yes"], "imaging": ["yes", "na"]}'::jsonb
    when 'sign_out' then '{
      "procedure_recorded": ["yes"], "counts_correct": ["yes"], "specimens_labelled": ["yes", "na"],
      "equipment_problems": ["none", "reported"], "recovery_concerns": ["yes"]}'::jsonb
  end
$$;

-- '' when the phase is complete, otherwise the first item that is missing or not acceptable
create or replace function public.theatre_phase_problem(p_phase text, p_answers jsonb)
returns text language sql immutable as $$
  select coalesce((
    select k from jsonb_each(public.theatre_phase_items(p_phase)) i(k, allowed)
     where not (allowed ? coalesce(p_answers->>k, '')) order by k limit 1), '')
$$;

create or replace function public.theatre_aldrete_ok(p_recovery jsonb)
returns boolean language sql immutable as $$
  select coalesce((select (e->>'total')::int >= 9 from jsonb_array_elements(p_recovery) with ordinality t(e, n) order by n desc limit 1), false)
$$;

create or replace function public.theatre_cases_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_problem text; v_clash text;
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.status in ('completed', 'cancelled') then
    if (to_jsonb(new) - array['addendum', 'updated_at', 'complication_grade', 'complications'])
       is distinct from (to_jsonb(old) - array['addendum', 'updated_at', 'complication_grade', 'complications']) then
      raise exception 'This case is closed; add an addendum or record a later complication instead';
    end if;
    return new;
  end if;

  -- room clash (booked cases only)
  if new.room_id is not null and new.status not in ('cancelled', 'postponed', 'completed') then
    select c.procedure into v_clash from public.theatre_cases c
     where c.room_id = new.room_id and c.id <> new.id and c.status not in ('cancelled', 'postponed', 'completed')
       and tstzrange(c.scheduled_start, c.scheduled_end) && tstzrange(new.scheduled_start, new.scheduled_end) limit 1;
    if v_clash is not null then raise exception 'This room is already booked at that time (%)', v_clash; end if;
  end if;

  -- WHO checklist, in order; a completed phase is stamped and cannot change once the next one has started
  if public.theatre_phase_problem('sign_in', new.sign_in) = '' then
    new.sign_in_at := coalesce(new.sign_in_at, case when tg_op = 'UPDATE' then old.sign_in_at end, now());
    new.sign_in_by := coalesce(new.sign_in_by, case when tg_op = 'UPDATE' then old.sign_in_by end, auth.uid());
  else new.sign_in_at := null; new.sign_in_by := null;
  end if;
  if new.time_out <> '{}'::jsonb and new.sign_in_at is null then raise exception 'Complete the sign in before the time out'; end if;
  if public.theatre_phase_problem('time_out', new.time_out) = '' then
    new.time_out_at := coalesce(case when tg_op = 'UPDATE' then old.time_out_at end, now());
    new.time_out_by := coalesce(case when tg_op = 'UPDATE' then old.time_out_by end, auth.uid());
  else new.time_out_at := null; new.time_out_by := null;
  end if;
  if new.sign_out <> '{}'::jsonb and new.time_out_at is null then raise exception 'Complete the time out before the sign out'; end if;
  if public.theatre_phase_problem('sign_out', new.sign_out) = '' then
    new.sign_out_at := coalesce(case when tg_op = 'UPDATE' then old.sign_out_at end, now());
    new.sign_out_by := coalesce(case when tg_op = 'UPDATE' then old.sign_out_by end, auth.uid());
  else new.sign_out_at := null; new.sign_out_by := null;
  end if;
  if tg_op = 'UPDATE' then
    if old.time_out_at is not null and new.sign_in is distinct from old.sign_in then raise exception 'The sign in cannot change after the time out'; end if;
    if old.sign_out_at is not null and new.time_out is distinct from old.time_out then raise exception 'The time out cannot change after the sign out'; end if;
  end if;

  if new.anaesthesia_start is not null and new.sign_in_at is null then raise exception 'Complete the sign in before anaesthesia starts'; end if;
  if new.knife_to_skin is not null and new.time_out_at is null then raise exception 'Complete the time out before the incision'; end if;
  if new.out_of_theatre is not null and new.sign_out_at is null then raise exception 'Complete the sign out before the patient leaves theatre'; end if;

  if new.status = 'operating' and new.time_out_at is null then raise exception 'Complete the time out before operating'; end if;
  if new.status = 'recovery' then
    if new.sign_out_at is null then raise exception 'Complete the sign out before the patient leaves theatre'; end if;
    new.out_of_theatre := coalesce(new.out_of_theatre, now());
  end if;
  if new.status = 'completed' then
    if new.sign_out_at is null then raise exception 'The WHO checklist is not complete'; end if;
    if coalesce(new.op_note->>'procedure_performed', '') = '' or coalesce(new.op_note->>'findings', '') = '' or coalesce(new.op_note->>'post_op_plan', '') = '' then
      raise exception 'Write the operation note (procedure performed, findings, post-operative plan) before completing';
    end if;
    if not public.theatre_aldrete_ok(new.recovery) then raise exception 'Recovery discharge needs a modified Aldrete score of 9 or more'; end if;
    new.recovery_out_at := coalesce(new.recovery_out_at, now());
    new.complication_grade := coalesce(new.complication_grade, 'none');
  end if;
  if new.status in ('cancelled', 'postponed') and coalesce(trim(new.cancel_reason), '') = '' then
    raise exception 'Give the reason for cancelling or postponing';
  end if;
  return new;
end $$;
drop trigger if exists trg_theatre_cases_before on public.theatre_cases;
create trigger trg_theatre_cases_before before insert or update on public.theatre_cases for each row execute function public.theatre_cases_before();

-- Utilisation and quality for a period
create or replace function public.theatre_stats(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Only clinical staff can see theatre statistics'; end if;
  with c as (
    select * from public.theatre_cases where hospital_id = p_hospital and scheduled_start >= p_from and scheduled_start < p_to + 1
  ), done as (select * from c where status = 'completed'),
  turn as (
    select extract(epoch from (in_theatre_at - lag(out_of_theatre) over (partition by room_id, scheduled_start::date order by in_theatre_at))) / 60 as gap
      from done where in_theatre_at is not null
  )
  select jsonb_build_object(
    'booked', (select count(*) from c),
    'completed', (select count(*) from done),
    'cancelled', (select count(*) from c where status in ('cancelled', 'postponed')),
    'cancel_reasons', (select coalesce(jsonb_object_agg(cancel_reason, n), '{}'::jsonb) from (select cancel_reason, count(*) n from c where status in ('cancelled', 'postponed') group by 1) x),
    'emergency_pct', (select round(100.0 * count(*) filter (where urgency = 'emergency') / nullif(count(*), 0), 1) from done),
    'on_time_start_pct', (select round(100.0 * count(*) filter (where in_theatre_at <= scheduled_start + interval '15 minutes') / nullif(count(*), 0), 1) from done where urgency = 'elective' and in_theatre_at is not null),
    'median_turnover_min', (select round((percentile_cont(0.5) within group (order by gap))::numeric, 0) from turn where gap between 0 and 240),
    'checklist_complete_pct', (select round(100.0 * count(*) filter (where sign_in_at is not null and time_out_at is not null and sign_out_at is not null) / nullif(count(*), 0), 1) from done),
    'complications', (select count(*) from done where complication_grade not in ('none')),
    'by_room', (select coalesce(jsonb_object_agg(coalesce(rm.name, 'No room'), jsonb_build_object('cases', x.n, 'hours', x.h)), '{}'::jsonb) from (
        select room_id, count(*) n, round((sum(extract(epoch from out_of_theatre - in_theatre_at)) / 3600)::numeric, 1) h from done group by room_id) x
        left join public.theatre_rooms rm on rm.id = x.room_id),
    'implants', (select count(*) from public.theatre_items i join done on done.id = i.case_id where i.kind = 'implant')
  ) into r;
  return r;
end $$;

alter table public.theatre_rooms enable row level security;
alter table public.theatre_cases enable row level security;
alter table public.theatre_items enable row level security;
drop policy if exists theatre_rooms_clinical on public.theatre_rooms;
drop policy if exists theatre_cases_clinical on public.theatre_cases;
drop policy if exists theatre_items_clinical on public.theatre_items;
create policy theatre_rooms_clinical on public.theatre_rooms for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy theatre_cases_clinical on public.theatre_cases for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy theatre_items_clinical on public.theatre_items for all to authenticated using (public.clin_can_access(hospital_id))
  with check (public.clin_can_access(hospital_id) and exists (select 1 from public.theatre_cases c where c.id = case_id and c.hospital_id = theatre_items.hospital_id));

revoke all on public.theatre_rooms, public.theatre_cases, public.theatre_items from anon;
grant select, insert, update on public.theatre_rooms, public.theatre_cases to authenticated;
grant select, insert on public.theatre_items to authenticated;   -- implant records are permanent
grant all on public.theatre_rooms, public.theatre_cases, public.theatre_items to service_role;
revoke execute on function public.theatre_cases_before() from public, anon, authenticated;
revoke execute on function public.theatre_stats(uuid, date, date) from public, anon;
grant execute on function public.theatre_stats(uuid, date, date) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['theatre_cases', 'theatre_items'] loop
    if to_regprocedure('public.audit_row_change()') is not null then
      execute format('drop trigger if exists trg_audit_change on public.%I', t);
      execute format('create trigger trg_audit_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
    end if;
  end loop;
end $$;
