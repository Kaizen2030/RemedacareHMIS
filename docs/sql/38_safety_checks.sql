-- =============================================================================
-- RemedacareHMS - SAFETY CHECKS: DIALYSIS WATER LOG, ISOLATION AND BED PLACEMENT, VISITOR PASSES, ROOM / EQUIPMENT CLASHES
-- Generated from supabase/migrations/20261220000000_safety_checks.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.dialysis_adequacy(numeric,numeric,numeric,numeric,numeric)') is null then
    raise exception 'Run 29_dialysis_mortuary.sql first. Nothing was changed.';
  end if;
end $$;

create table if not exists public.dialysis_water_tests (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  tested_at    timestamptz not null default now(),
  sample_point text not null default 'ro_outlet' check (sample_point in ('feed', 'post_softener', 'post_carbon', 'ro_outlet', 'loop_return', 'dialysate')),
  parameter    text not null check (parameter in ('total_chlorine', 'hardness', 'conductivity', 'bacteria', 'endotoxin')),
  value        numeric not null check (value >= 0),
  status       text not null check (status in ('pass', 'action', 'fail')),
  action_taken text,
  tested_by    uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists dialysis_water_tests_latest on public.dialysis_water_tests(hospital_id, parameter, tested_at desc);

/** pass / action / fail for one water result. */
create or replace function public.dialysis_water_grade(p_parameter text, p_value numeric)
returns text language sql immutable as $$
  select case p_parameter
    when 'total_chlorine' then case when p_value < 0.1 then 'pass' else 'fail' end
    when 'hardness'       then case when p_value <= 17.1 then 'pass' else 'fail' end
    when 'conductivity'   then case when p_value < 10 then 'pass' when p_value <= 20 then 'action' else 'fail' end
    when 'bacteria'       then case when p_value < 50 then 'pass' when p_value < 100 then 'action' else 'fail' end
    when 'endotoxin'      then case when p_value < 0.125 then 'pass' when p_value < 0.25 then 'action' else 'fail' end end
$$;

create or replace function public.dialysis_water_tests_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tested_at > now() + interval '5 minutes' then raise exception 'The test time cannot be in the future'; end if;
  new.status := public.dialysis_water_grade(new.parameter, new.value);
  if new.status = 'fail' and coalesce(trim(new.action_taken), '') = '' then
    raise exception 'Out of limits: record the action taken (e.g. carbon tank changed, loop disinfected, retest booked)';
  end if;
  return new;
end $$;
drop trigger if exists trg_dialysis_water_tests_before on public.dialysis_water_tests;
create trigger trg_dialysis_water_tests_before before insert on public.dialysis_water_tests
  for each row execute function public.dialysis_water_tests_before();

/** Latest result, next due date and whether dialysis is blocked, per parameter. */
create or replace function public.dialysis_water_status(p_hospital uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Clinical access required'; end if;
  select jsonb_agg(jsonb_build_object(
           'parameter', p.parameter, 'unit', p.unit, 'every_days', p.every_days,
           'value', l.value, 'status', l.status, 'tested_at', l.tested_at, 'sample_point', l.sample_point,
           'next_due', (coalesce(l.tested_at, now()) + make_interval(days => p.every_days))::date,
           'overdue', l.tested_at is null or l.tested_at < now() - make_interval(days => p.every_days),
           'blocks_dialysis', p.parameter = 'total_chlorine' and l.status = 'fail') order by p.ord)
    into v
    from (values (1, 'total_chlorine', 'mg/L', 1), (2, 'hardness', 'mg/L', 1), (3, 'conductivity', 'µS/cm', 1),
                 (4, 'bacteria', 'CFU/mL', 30), (5, 'endotoxin', 'EU/mL', 30)) p(ord, parameter, unit, every_days)
    left join lateral (select t.* from public.dialysis_water_tests t where t.hospital_id = p_hospital and t.parameter = p.parameter
                        order by t.tested_at desc, t.created_at desc limit 1) l on true;
  return v;
end $$;

/** A session cannot start while the latest chlorine test (before it) failed. */
create or replace function public.dialysis_sessions_water()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.dialysis_water_tests;
begin
  if new.status not in ('in_progress', 'completed') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('in_progress', 'completed') then return new; end if;
  select * into t from public.dialysis_water_tests w
   where w.hospital_id = new.hospital_id and w.parameter = 'total_chlorine' and w.tested_at <= coalesce(new.started_at, now())
   order by w.tested_at desc, w.created_at desc limit 1;
  if t.id is not null and t.status = 'fail' then
    raise exception 'Water not safe: total chlorine % mg/L at %. Fix the carbon filter and record a passing chlorine test before dialysing',
      t.value, to_char(t.tested_at at time zone 'Africa/Nairobi', 'DD Mon HH24:MI') using hint = 'water_unsafe';
  end if;
  return new;
end $$;
drop trigger if exists trg_dialysis_sessions_water on public.dialysis_sessions;
create trigger trg_dialysis_sessions_water before insert or update on public.dialysis_sessions
  for each row execute function public.dialysis_sessions_water();

create table if not exists public.patient_isolation (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  patient_id  uuid not null,
  precaution  text not null check (precaution in ('contact', 'droplet', 'airborne', 'protective')),
  reason      text not null,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  end_reason  text,
  set_by      uuid default auth.uid(),
  ended_by    uuid,
  created_at  timestamptz not null default now()
);
create unique index if not exists patient_isolation_one_active on public.patient_isolation(hospital_id, patient_id, precaution) where ended_at is null;

create or replace function public.patient_isolation_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(new.reason), '') = '' then raise exception 'Give the reason (organism or suspected condition)'; end if;
  if tg_op = 'UPDATE' then
    if old.ended_at is not null then raise exception 'This isolation has ended; start a new one if needed'; end if;
    if (new.precaution, new.patient_id, new.started_at) is distinct from (old.precaution, old.patient_id, old.started_at) then
      raise exception 'End this isolation and start a new one to change it';
    end if;
    if new.ended_at is not null then
      if coalesce(trim(new.end_reason), '') = '' then raise exception 'Give the reason for ending isolation (e.g. cultures negative, 14 days completed)'; end if;
      new.ended_by := auth.uid();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_patient_isolation_before on public.patient_isolation;
create trigger trg_patient_isolation_before before insert or update on public.patient_isolation
  for each row execute function public.patient_isolation_before();

/** What is wrong with putting these precautions in this kind of bed (null = suitable). */
create or replace function public.bed_isolation_problem(p_bed_isolation text, p_precautions text[])
returns text language sql immutable as $$
  select case
    when p_precautions is null or cardinality(p_precautions) = 0 then null
    when 'airborne' = any(p_precautions) and coalesce(p_bed_isolation, '') not in ('negative_pressure', 'single_room') then 'airborne isolation: a negative-pressure or single room'
    when 'protective' = any(p_precautions) and coalesce(p_bed_isolation, '') <> 'single_room' then 'protective isolation: a single room'
    when (p_precautions && array['contact', 'droplet']) and p_bed_isolation is null then 'contact / droplet isolation: a single room or cohort bay'
  end
$$;

create or replace function public.patient_precautions(p_hospital text, p_patient text)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct i.precaution order by i.precaution), '{}') from public.patient_isolation i
   where i.hospital_id::text = p_hospital and i.patient_id::text = p_patient and i.ended_at is null
$$;

do $$ begin
  if to_regclass('public.beds') is null then raise notice 'beds table not found: isolation bed checks skipped'; return; end if;
  alter table public.beds add column if not exists isolation_type text;
  alter table public.beds add column if not exists isolation_override_reason text;
  begin
    alter table public.beds add constraint beds_isolation_type_check check (isolation_type in ('single_room', 'negative_pressure', 'cohort'));
  exception when duplicate_object then null;
  end;
end $$;

create or replace function public.beds_isolation_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); v_pat text := nullif(j->>'patient_id', ''); v_moved boolean; v_problem text; v_name text;
begin
  if v_pat is null then new.isolation_override_reason := null; return new; end if;
  v_moved := tg_op = 'INSERT' or v_pat is distinct from nullif(to_jsonb(old)->>'patient_id', '');
  if not v_moved then return new; end if;
  v_problem := public.bed_isolation_problem(new.isolation_type, public.patient_precautions(j->>'hospital_id', v_pat));
  if v_problem is null then new.isolation_override_reason := null; return new; end if;
  if coalesce(trim(new.isolation_override_reason), '') = '' then
    select full_name into v_name from public.patients where id::text = v_pat;
    raise exception '% needs %. Choose a suitable bed, or record why this bed is used', coalesce(v_name, 'This patient'), v_problem using hint = 'isolation_bed';
  end if;
  return new;
end $$;
do $$ begin
  if to_regclass('public.beds') is null then return; end if;
  drop trigger if exists trg_beds_isolation_before on public.beds;
  create trigger trg_beds_isolation_before before insert or update on public.beds for each row execute function public.beds_isolation_before();
end $$;

/** For the admit / transfer screens: null if the bed suits the patient's precautions, otherwise what is needed. */
create or replace function public.bed_isolation_check(p_bed text, p_patient text)
returns text language plpgsql stable security definer set search_path = public as $$
declare b jsonb;
begin
  if to_regclass('public.beds') is null then return null; end if;
  execute 'select to_jsonb(b) from public.beds b where b.id::text = $1' into b using p_bed;
  if b is null or not public.pay_is_member((b->>'hospital_id')::uuid) then return null; end if;
  return public.bed_isolation_problem(b->>'isolation_type', public.patient_precautions(b->>'hospital_id', p_patient));
end $$;

/** Everyone in isolation now, with their bed and whether it is suitable. */
create or replace function public.isolation_board(p_hospital uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Clinical access required'; end if;
  with iso as (
    select i.patient_id, array_agg(i.precaution order by i.precaution) precautions,
           string_agg(i.precaution || ': ' || i.reason, '; ' order by i.precaution) reasons, min(i.started_at) since,
           jsonb_agg(jsonb_build_object('id', i.id, 'precaution', i.precaution, 'reason', i.reason, 'started_at', i.started_at) order by i.precaution) items
      from public.patient_isolation i where i.hospital_id = p_hospital and i.ended_at is null group by i.patient_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'patient_id', iso.patient_id, 'full_name', p.full_name, 'precautions', iso.precautions, 'reasons', iso.reasons, 'since', iso.since, 'items', iso.items,
           'bed_number', bj->>'bed_number', 'ward_id', bj->>'ward_id', 'bed_isolation', bj->>'isolation_type', 'override_reason', bj->>'isolation_override_reason',
           'problem', case when bj is not null then public.bed_isolation_problem(bj->>'isolation_type', iso.precautions) end) order by iso.since), '[]'::jsonb)
    into v
    from iso left join public.patients p on p.id = iso.patient_id
    left join lateral (select to_jsonb(x) bj from public.beds x where (to_jsonb(x)->>'patient_id') = iso.patient_id::text limit 1) bb on true;
  return v;
exception when undefined_table then
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', i.patient_id, 'precautions', array[i.precaution], 'reasons', i.reason)), '[]'::jsonb) into v
    from public.patient_isolation i where i.hospital_id = p_hospital and i.ended_at is null;
  return v;
end $$;

create table if not exists public.visitor_settings (
  hospital_id     uuid primary key,
  max_per_patient smallint not null default 2 check (max_per_patient between 1 and 10),
  windows         jsonb not null default '[{"from":"06:00","to":"07:00"},{"from":"12:30","to":"14:00"},{"from":"16:00","to":"19:00"}]'::jsonb,
  timezone        text not null default 'Africa/Nairobi'
);

create table if not exists public.visitor_restrictions (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  patient_id  uuid not null,
  reason      text not null,
  until       date,
  set_by      uuid default auth.uid(),
  lifted_at   timestamptz,
  lifted_by   uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.visitor_passes (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null,
  pass_no        text not null,
  patient_id     uuid not null,
  ward_name      text,
  bed_number     text,
  visitor_name   text not null,
  id_number      text,
  phone          text,
  relationship   text,
  status         text not null default 'issued' check (status in ('issued', 'in', 'out', 'revoked')),
  issued_at      timestamptz not null default now(),
  checked_in_at  timestamptz,
  checked_out_at timestamptz,
  override_reason text,
  issued_by      uuid default auth.uid(),
  checked_in_by  uuid,
  checked_out_by uuid,
  revoke_reason  text,
  created_at     timestamptz not null default now(),
  unique (hospital_id, pass_no)
);
create index if not exists visitor_passes_patient on public.visitor_passes(hospital_id, patient_id, status);

create or replace function public.visitor_settings_for(p_hospital uuid)
returns public.visitor_settings language sql stable security definer set search_path = public as $$
  select coalesce((select s from public.visitor_settings s where s.hospital_id = p_hospital),
                  row(p_hospital, 2::smallint, '[{"from":"06:00","to":"07:00"},{"from":"12:30","to":"14:00"},{"from":"16:00","to":"19:00"}]'::jsonb, 'Africa/Nairobi')::public.visitor_settings)
$$;

/** Why visits to this patient need approval (no organism shown), or null. */
create or replace function public.visitor_block_reason(p_hospital uuid, p_patient uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select 'Visits restricted by the clinical team' from public.visitor_restrictions r
      where r.hospital_id = p_hospital and r.patient_id = p_patient and r.lifted_at is null and (r.until is null or r.until >= current_date) limit 1),
    (select 'Patient is in ' || string_agg(distinct i.precaution, ' / ') || ' isolation — the nurse in charge must approve and give PPE' from public.patient_isolation i
      where i.hospital_id = p_hospital and i.patient_id = p_patient and i.ended_at is null and i.precaution in ('airborne', 'protective')))
$$;

create or replace function public.visitor_passes_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare b jsonb; w jsonb; v_block text; n int; tz text := (public.visitor_settings_for(new.hospital_id)).timezone;
begin
  if coalesce(trim(new.visitor_name), '') = '' then raise exception 'Enter the visitor''s name'; end if;
  if to_regclass('public.beds') is not null then
    execute 'select to_jsonb(x) from public.beds x where x.hospital_id::text = $1 and (to_jsonb(x)->>''patient_id'') = $2 limit 1' into b using new.hospital_id::text, new.patient_id::text;
  end if;
  if b is null then raise exception 'This patient is not in a ward bed; visitor passes are for admitted patients'; end if;
  if b ? 'ward_id' and to_regclass('public.wards') is not null then
    execute 'select to_jsonb(x) from public.wards x where x.id::text = $1' into w using b->>'ward_id';
  end if;
  new.ward_name := w->>'name'; new.bed_number := b->>'bed_number';
  v_block := public.visitor_block_reason(new.hospital_id, new.patient_id);
  if v_block is not null and coalesce(trim(new.override_reason), '') = '' then
    raise exception '%. Record who approved the visit to issue a pass', v_block using hint = 'visit_restricted';
  end if;
  perform pg_advisory_xact_lock(hashtext('vpass|' || new.hospital_id::text));
  select coalesce(max(substring(pass_no from '-([0-9]+)$')::int), 0) + 1 into n from public.visitor_passes
   where hospital_id = new.hospital_id and pass_no like 'VP-' || to_char(now() at time zone tz, 'YYMMDD') || '-%';
  new.pass_no := 'VP-' || to_char(now() at time zone tz, 'YYMMDD') || '-' || lpad(n::text, 3, '0');
  new.status := 'issued'; new.issued_at := now(); new.checked_in_at := null; new.checked_out_at := null; new.issued_by := auth.uid();
  return new;
end $$;
drop trigger if exists trg_visitor_passes_before on public.visitor_passes;
create trigger trg_visitor_passes_before before insert on public.visitor_passes
  for each row execute function public.visitor_passes_before();

/** Is this local time inside one of the visiting windows? */
create or replace function public.visitor_in_hours(p_windows jsonb, p_time time)
returns boolean language sql immutable as $$
  select coalesce(bool_or(p_time >= (w->>'from')::time and p_time < (w->>'to')::time), false) from jsonb_array_elements(coalesce(p_windows, '[]'::jsonb)) w
$$;

/** Check a visitor in or out, or revoke a pass. Gate staff scan or type the pass number. */
create or replace function public.visitor_pass_action(p_hospital uuid, p_pass_no text, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.visitor_passes; st public.visitor_settings := public.visitor_settings_for(p_hospital); n int; b jsonb;
begin
  if not public.pay_is_member(p_hospital) then raise exception 'Not a member of this hospital'; end if;
  select * into v from public.visitor_passes where hospital_id = p_hospital and upper(pass_no) = upper(trim(p_pass_no)) for update;
  if v.id is null then raise exception 'Pass % not found', p_pass_no; end if;
  if p_action = 'in' then
    if v.status <> 'issued' then raise exception 'Pass % is already %: issue a new pass for a new visit', v.pass_no, v.status; end if;
    if (v.issued_at at time zone st.timezone)::date <> (now() at time zone st.timezone)::date then raise exception 'Pass % has expired (passes are valid the day they are issued)', v.pass_no; end if;
    if to_regclass('public.beds') is not null then
      execute 'select to_jsonb(x) from public.beds x where x.hospital_id::text = $1 and (to_jsonb(x)->>''patient_id'') = $2 limit 1' into b using p_hospital::text, v.patient_id::text;
    end if;
    if b is null then raise exception 'The patient is no longer in a ward bed'; end if;
    if not public.visitor_in_hours(st.windows, (now() at time zone st.timezone)::time) and coalesce(trim(p_reason), '') = '' then
      raise exception 'Outside visiting hours. Record who allowed the visit to let the visitor in' using hint = 'outside_hours';
    end if;
    perform pg_advisory_xact_lock(hashtext('vpat|' || v.patient_id::text));
    select count(*) into n from public.visitor_passes where hospital_id = p_hospital and patient_id = v.patient_id and status = 'in';
    if n >= st.max_per_patient and coalesce(trim(p_reason), '') = '' then
      raise exception 'Already % visitor(s) with this patient (maximum %). Ask one to come out first', n, st.max_per_patient using hint = 'too_many';
    end if;
    update public.visitor_passes set status = 'in', checked_in_at = now(), checked_in_by = auth.uid(),
           override_reason = coalesce(nullif(trim(p_reason), ''), override_reason) where id = v.id returning * into v;
  elsif p_action = 'out' then
    if v.status <> 'in' then raise exception 'Pass % is not checked in', v.pass_no; end if;
    update public.visitor_passes set status = 'out', checked_out_at = now(), checked_out_by = auth.uid() where id = v.id returning * into v;
  elsif p_action = 'revoke' then
    if v.status not in ('issued', 'in') then raise exception 'Pass % is already closed', v.pass_no; end if;
    if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason for revoking the pass'; end if;
    update public.visitor_passes set status = 'revoked', revoke_reason = trim(p_reason), checked_out_at = case when status = 'in' then now() end,
           checked_out_by = auth.uid() where id = v.id returning * into v;
  else
    raise exception 'Unknown action %', p_action;
  end if;
  return to_jsonb(v);
end $$;

create table if not exists public.scheduling_resources (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  name        text not null,
  kind        text not null default 'room' check (kind in ('room', 'equipment')),
  quantity    smallint not null default 1 check (quantity between 1 and 50),
  active      boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);
create unique index if not exists scheduling_resources_name on public.scheduling_resources(hospital_id, lower(name));

do $$ begin
  if to_regclass('public.appointments') is null then raise notice 'appointments table not found: resource checks skipped'; return; end if;
  alter table public.appointments add column if not exists room text;
  alter table public.appointments add column if not exists resources text[] not null default '{}';
end $$;

create or replace function public.sched_resources_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); o jsonb; v_type text[]; r text; res public.scheduling_resources; v_used int; v_first record; v_names text[];
begin
  if coalesce(current_setting('app.sched_backfill', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' or (j->>'appointment_type') is distinct from (to_jsonb(old)->>'appointment_type') then
    select t.resources into v_type from public.appointment_types t
     where t.hospital_id::text = new.hospital_id::text and lower(t.name) = lower(coalesce(j->>'appointment_type', '')) and t.active limit 1;
    if v_type is not null then
      select coalesce(array_agg(distinct x), '{}') into new.resources from unnest(coalesce(new.resources, '{}') || v_type) x where coalesce(trim(x), '') <> '';
    end if;
  end if;
  new.room := nullif(trim(new.room), '');
  if new.starts_at is null or new.ends_at is null or not public.sched_active_status(j->>'status') then return new; end if;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    if new.starts_at is not distinct from old.starts_at and new.ends_at is not distinct from old.ends_at and new.room is not distinct from old.room
       and new.resources is not distinct from old.resources and public.sched_active_status(o->>'status') then return new; end if;
  end if;
  v_names := array_remove(array[new.room], null) || coalesce(new.resources, '{}');
  foreach r in array v_names loop
    select * into res from public.scheduling_resources s where s.hospital_id::text = new.hospital_id::text and lower(s.name) = lower(r) and s.active;
    if res.id is null then continue; end if;
    perform pg_advisory_xact_lock(hashtext('sres|' || res.id::text || '|' || (new.starts_at at time zone 'Africa/Nairobi')::date::text));
    select count(*) into v_used from public.appointments a
     where a.hospital_id = new.hospital_id and a.id <> new.id and public.sched_active_status(to_jsonb(a)->>'status')
       and a.starts_at < new.ends_at and a.ends_at > new.starts_at
       and (lower(coalesce(a.room, '')) = lower(res.name) or exists (select 1 from unnest(a.resources) x where lower(x) = lower(res.name)));
    if v_used >= res.quantity then
      select a.starts_at, a.ends_at, to_jsonb(a)->>'doctor_name' doc into v_first from public.appointments a
       where a.hospital_id = new.hospital_id and a.id <> new.id and public.sched_active_status(to_jsonb(a)->>'status')
         and a.starts_at < new.ends_at and a.ends_at > new.starts_at
         and (lower(coalesce(a.room, '')) = lower(res.name) or exists (select 1 from unnest(a.resources) x where lower(x) = lower(res.name)))
       order by a.starts_at limit 1;
      raise exception '%', res.name || ' is already booked from ' || to_char(v_first.starts_at at time zone 'Africa/Nairobi', 'HH24:MI')
        || ' to ' || to_char(v_first.ends_at at time zone 'Africa/Nairobi', 'HH24:MI') || coalesce(' (' || v_first.doc || ')', '')
        || ' — choose another time or ' || case when res.kind = 'room' then 'another room' else 'another item' end
        using errcode = 'P0001', hint = 'resource_clash';
    end if;
  end loop;
  return new;
end $$;
do $$ begin
  if to_regclass('public.appointments') is null then return; end if;
  drop trigger if exists trg_sched_resources_before on public.appointments;
  create trigger trg_sched_resources_before before insert or update on public.appointments for each row execute function public.sched_resources_before();
end $$;

do $$
declare t text;
begin
  foreach t in array array['dialysis_water_tests', 'patient_isolation'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_clinical', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id))', t || '_clinical', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke update, delete on public.dialysis_water_tests from authenticated;

alter table public.visitor_settings enable row level security;
alter table public.visitor_restrictions enable row level security;
alter table public.visitor_passes enable row level security;
alter table public.scheduling_resources enable row level security;
drop policy if exists visitor_settings_read on public.visitor_settings;
drop policy if exists visitor_settings_admin on public.visitor_settings;
drop policy if exists visitor_restrictions_clinical on public.visitor_restrictions;
drop policy if exists visitor_passes_members on public.visitor_passes;
drop policy if exists scheduling_resources_read on public.scheduling_resources;
drop policy if exists scheduling_resources_write on public.scheduling_resources;
create policy visitor_settings_read on public.visitor_settings for select to authenticated using (public.pay_is_member(hospital_id));
create policy visitor_settings_admin on public.visitor_settings for all to authenticated
  using (coalesce((select c.member and c.canonical = 'admin' from public.pay_user_context(hospital_id, auth.uid()) c), false))
  with check (coalesce((select c.member and c.canonical = 'admin' from public.pay_user_context(hospital_id, auth.uid()) c), false));
create policy visitor_restrictions_clinical on public.visitor_restrictions for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy visitor_passes_members on public.visitor_passes for all to authenticated using (public.pay_is_member(hospital_id)) with check (public.pay_is_member(hospital_id));
create policy scheduling_resources_read on public.scheduling_resources for select to authenticated using (public.pay_is_member(hospital_id));
create policy scheduling_resources_write on public.scheduling_resources for all to authenticated
  using (coalesce((select c.member and c.canonical in ('admin', 'receptionist') from public.pay_user_context(hospital_id, auth.uid()) c), false))
  with check (coalesce((select c.member and c.canonical in ('admin', 'receptionist') from public.pay_user_context(hospital_id, auth.uid()) c), false));
revoke all on public.visitor_settings, public.visitor_restrictions, public.visitor_passes, public.scheduling_resources, public.dialysis_water_tests, public.patient_isolation from anon;
grant select, insert, update on public.visitor_settings, public.visitor_restrictions, public.scheduling_resources to authenticated;
grant select, insert on public.visitor_passes to authenticated;
grant all on public.visitor_settings, public.visitor_restrictions, public.visitor_passes, public.scheduling_resources to service_role;

revoke execute on function public.dialysis_water_tests_before(), public.dialysis_sessions_water(), public.patient_isolation_before(), public.beds_isolation_before(),
  public.visitor_passes_before(), public.sched_resources_before(), public.patient_precautions(text, text), public.visitor_settings_for(uuid),
  public.visitor_block_reason(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.dialysis_water_status(uuid), public.bed_isolation_check(text, text), public.isolation_board(uuid),
  public.visitor_pass_action(uuid, text, text, text) from public, anon;
grant execute on function public.dialysis_water_status(uuid), public.bed_isolation_check(text, text), public.isolation_board(uuid),
  public.visitor_pass_action(uuid, text, text, text), public.dialysis_water_grade(text, numeric), public.bed_isolation_problem(text, text[]),
  public.visitor_in_hours(jsonb, time) to authenticated, service_role;

commit;

select 'tables' as check_name, case when to_regclass('public.dialysis_water_tests') is not null and to_regclass('public.patient_isolation') is not null and to_regclass('public.visitor_passes') is not null and to_regclass('public.scheduling_resources') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'rules', case when public.dialysis_water_grade('total_chlorine', 0.2) = 'fail' and public.bed_isolation_problem(null, array['airborne']) is not null and public.visitor_in_hours('[{"from":"12:30","to":"14:00"}]', '13:00') then 'OK' else 'PROBLEM' end
    union all select 'bed isolation check', case when to_regclass('public.beds') is null then 'beds table not found - not installed' when exists (select 1 from pg_trigger where tgname = 'trg_beds_isolation_before') then 'OK' else 'PROBLEM' end
    union all select 'appointment room / equipment check', case when to_regclass('public.appointments') is null then 'appointments table not found - not installed' when exists (select 1 from pg_trigger where tgname = 'trg_sched_resources_before') then 'OK' else 'PROBLEM' end;
