-- Emergency department: arrivals, triage (adult SATS / TEWS, child ETAT+), target times by colour, time-critical
-- pathways (stroke, STEMI, sepsis, trauma) with timed steps, trauma sheet, dispositions including "left without
-- being seen", and department times. Clinical staff only. The colour is always recomputed here from the score and
-- the emergency signs, so it cannot be set lower than the findings.

create table if not exists public.ed_attendances (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null,
  patient_id      uuid,
  visit_id        text,
  unknown_label   text,                 -- e.g. "Unknown male, ~30 y" until identified
  arrival_at      timestamptz not null default now(),
  arrival_mode    text check (arrival_mode in ('walk_in', 'ambulance', 'police', 'referral', 'private_car', 'other')),
  age_group       text not null default 'adult' check (age_group in ('adult', 'child')),
  complaint       text,
  triage_at       timestamptz,
  triage_by       uuid,
  vitals          jsonb not null default '{}'::jsonb,
  tews_score      smallint check (tews_score between 0 and 30),
  discriminators  text[] not null default '{}',   -- 'red:Seizure - current', 'orange:Chest pain', 'yellow:…'
  triage_colour   text check (triage_colour in ('red', 'orange', 'yellow', 'green', 'blue')),
  see_by          timestamptz,
  bay             text,
  seen_at         timestamptz,
  seen_by         uuid,
  clinician       text,
  pathways        text[] not null default '{}',
  trauma_sheet    jsonb not null default '{}'::jsonb,
  disposition     text check (disposition in ('admitted', 'discharged', 'referred', 'theatre', 'died', 'lwbs', 'left_against_advice', 'transferred')),
  disposition_at  timestamptz,
  departed_at     timestamptz,
  notes           text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (patient_id is not null or coalesce(unknown_label, '') <> '')
);
create index if not exists ed_attendances_board on public.ed_attendances(hospital_id, departed_at, arrival_at desc);

create table if not exists public.ed_pathway_events (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  attendance_id uuid not null references public.ed_attendances(id) on delete cascade,
  pathway       text not null check (pathway in ('stroke', 'stemi', 'sepsis', 'trauma')),
  step          text not null,
  done_at       timestamptz not null default now(),
  done_by       uuid default auth.uid(),
  note          text,
  unique (attendance_id, pathway, step)
);

-- SATS colour from the TEWS score (adults) and the emergency signs. Children (ETAT+): emergency sign → red,
-- priority sign → orange, otherwise green (the score is not used). The worst wins.
create or replace function public.ed_colour(p_score integer, p_signs text[], p_child boolean)
returns text language sql immutable as $$
  select case
    when exists (select 1 from unnest(coalesce(p_signs, '{}')) s where s like 'blue:%') then 'blue'
    when exists (select 1 from unnest(coalesce(p_signs, '{}')) s where s like 'red:%') or (not p_child and coalesce(p_score, 0) >= 7) then 'red'
    when exists (select 1 from unnest(coalesce(p_signs, '{}')) s where s like 'orange:%') or (not p_child and coalesce(p_score, 0) >= 5) then 'orange'
    when exists (select 1 from unnest(coalesce(p_signs, '{}')) s where s like 'yellow:%') or (not p_child and coalesce(p_score, 0) >= 3) then 'yellow'
    else 'green' end
$$;

-- SATS target time to be seen: red immediately, orange 10 min, yellow 60 min, green 4 h
create or replace function public.ed_target_minutes(p_colour text)
returns integer language sql immutable as $$
  select case p_colour when 'red' then 0 when 'orange' then 10 when 'yellow' then 60 when 'green' then 240 else null end
$$;

create or replace function public.ed_attendances_before()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.departed_at is not null then
    -- after departure only the notes and trauma sheet may be completed
    if (to_jsonb(new) - array['notes', 'trauma_sheet', 'updated_at']) is distinct from (to_jsonb(old) - array['notes', 'trauma_sheet', 'updated_at']) then
      raise exception 'This attendance is closed; add notes instead';
    end if;
    return new;
  end if;
  if new.triage_at is not null or new.tews_score is not null or array_length(new.discriminators, 1) > 0 then
    new.triage_colour := public.ed_colour(new.tews_score, new.discriminators, new.age_group = 'child');
    new.triage_at := coalesce(new.triage_at, now());
    new.triage_by := coalesce(new.triage_by, auth.uid());
    new.see_by := new.arrival_at + make_interval(mins => coalesce(public.ed_target_minutes(new.triage_colour), 0));
  end if;
  if new.seen_at is not null and (tg_op = 'INSERT' or old.seen_at is null) then new.seen_by := coalesce(new.seen_by, auth.uid()); end if;
  if new.seen_at is not null and new.seen_at < new.arrival_at then raise exception 'Seen time cannot be before arrival'; end if;
  if new.disposition is not null and (tg_op = 'INSERT' or old.disposition is null) then
    new.disposition_at := coalesce(new.disposition_at, now());
    new.departed_at := coalesce(new.departed_at, now());
    if new.disposition not in ('lwbs', 'died') and new.seen_at is null then
      raise exception 'Record when the patient was seen before a % disposition', new.disposition;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_ed_attendances_before on public.ed_attendances;
create trigger trg_ed_attendances_before before insert or update on public.ed_attendances for each row execute function public.ed_attendances_before();

-- Department times for a period (medians in minutes)
create or replace function public.ed_stats(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Only clinical staff can see emergency statistics'; end if;
  with a as (
    select * from public.ed_attendances
     where hospital_id = p_hospital and arrival_at >= p_from and arrival_at < p_to + 1
  )
  select jsonb_build_object(
    'attendances', (select count(*) from a),
    'by_colour', (select coalesce(jsonb_object_agg(coalesce(triage_colour, 'untriaged'), n), '{}'::jsonb) from (select triage_colour, count(*) n from a group by 1) x),
    'door_to_triage_min', (select percentile_cont(0.5) within group (order by extract(epoch from triage_at - arrival_at) / 60) from a where triage_at is not null),
    'door_to_seen_min', (select coalesce(jsonb_object_agg(triage_colour, m), '{}'::jsonb) from (
        select triage_colour, round((percentile_cont(0.5) within group (order by extract(epoch from seen_at - arrival_at) / 60))::numeric, 1) m
          from a where seen_at is not null and triage_colour is not null group by 1) x),
    'seen_within_target_pct', (select round(100.0 * count(*) filter (where seen_at <= see_by) / nullif(count(*), 0), 1) from a where seen_at is not null and see_by is not null),
    'length_of_stay_min', (select percentile_cont(0.5) within group (order by extract(epoch from departed_at - arrival_at) / 60) from a where departed_at is not null),
    'lwbs_pct', (select round(100.0 * count(*) filter (where disposition = 'lwbs') / nullif(count(*) filter (where disposition is not null), 0), 1) from a),
    'admitted_pct', (select round(100.0 * count(*) filter (where disposition = 'admitted') / nullif(count(*) filter (where disposition is not null), 0), 1) from a),
    'deaths', (select count(*) from a where disposition = 'died'),
    'pathway_steps', (select coalesce(jsonb_object_agg(k, m), '{}'::jsonb) from (
        select e.pathway || ':' || e.step as k, round((percentile_cont(0.5) within group (order by extract(epoch from e.done_at - a.arrival_at) / 60))::numeric, 1) m
          from public.ed_pathway_events e join a on a.id = e.attendance_id group by 1) x)
  ) into r;
  return r;
end $$;

alter table public.ed_attendances enable row level security;
alter table public.ed_pathway_events enable row level security;
drop policy if exists ed_attendances_clinical on public.ed_attendances;
drop policy if exists ed_pathway_events_clinical on public.ed_pathway_events;
create policy ed_attendances_clinical on public.ed_attendances for all to authenticated
  using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy ed_pathway_events_clinical on public.ed_pathway_events for all to authenticated
  using (public.clin_can_access(hospital_id))
  with check (public.clin_can_access(hospital_id) and exists (select 1 from public.ed_attendances a where a.id = attendance_id and a.hospital_id = ed_pathway_events.hospital_id));

revoke all on public.ed_attendances, public.ed_pathway_events from anon;
grant select, insert, update on public.ed_attendances to authenticated;
grant select, insert, delete on public.ed_pathway_events to authenticated;   -- a step ticked by mistake can be undone
grant all on public.ed_attendances, public.ed_pathway_events to service_role;
revoke execute on function public.ed_attendances_before() from public, anon, authenticated;
revoke execute on function public.ed_stats(uuid, date, date) from public, anon;
grant execute on function public.ed_stats(uuid, date, date) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['ed_attendances', 'ed_pathway_events'] loop
    if to_regprocedure('public.audit_row_change()') is not null then
      execute format('drop trigger if exists trg_audit_change on public.%I', t);
      execute format('create trigger trg_audit_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
    end if;
  end loop;
end $$;
