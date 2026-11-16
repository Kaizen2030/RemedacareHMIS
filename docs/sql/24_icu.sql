-- =============================================================================
-- RemedacareHMS - ICU / HDU: CRITICAL-CARE CHART, VENTILATOR, INFUSIONS, SEDATION, SOFA, DAILY GOALS, FAMILY LOG
-- Generated from supabase/migrations/20261206000000_icu.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.clin_can_access(uuid)') is null then
    raise exception 'Run 08_hiv_tb_maternity.sql first. Nothing was changed.';
  end if;
end $$;

create table if not exists public.icu_admissions (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null,
  patient_id     uuid not null,
  visit_id       text,
  unit           text not null default 'ICU' check (unit in ('ICU', 'HDU', 'NICU', 'PICU', 'CCU')),
  bed_label      text,
  source         text check (source in ('emergency', 'theatre', 'ward', 'other_facility', 'maternity', 'other')),
  diagnosis      text not null,
  reason         text,
  code_status    text not null default 'full' check (code_status in ('full', 'dnar', 'limited')),
  isolation      text,
  weight_kg      numeric,
  height_cm      numeric,
  sex            text check (sex in ('male', 'female')),
  admitted_at    timestamptz not null default now(),
  admitted_by    uuid default auth.uid(),
  consultant     text,
  readmission_48h boolean not null default false,
  discharged_at  timestamptz,
  outcome        text check (outcome in ('ward', 'step_down', 'transfer', 'died', 'discharged_against_advice')),
  discharge_note text,
  created_at     timestamptz not null default now()
);
create index if not exists icu_admissions_open on public.icu_admissions(hospital_id, discharged_at);
create unique index if not exists icu_admissions_one_open on public.icu_admissions(patient_id) where discharged_at is null;

create table if not exists public.icu_entries (
  id               uuid primary key default gen_random_uuid(),
  admission_id     uuid not null references public.icu_admissions(id) on delete cascade,
  hospital_id      uuid not null,
  patient_id       uuid not null,
  kind             text not null check (kind in ('vitals', 'ventilator', 'infusion', 'sedation', 'sofa', 'goals', 'family')),
  recorded_at      timestamptz not null default now(),
  data             jsonb not null default '{}'::jsonb,
  calc             jsonb not null default '{}'::jsonb,    -- computed by the database
  flags            jsonb not null default '[]'::jsonb,    -- warnings computed by the database
  recorded_by      uuid default auth.uid(),
  recorded_by_name text,
  struck_out_at    timestamptz,
  struck_out_reason text,
  created_at       timestamptz not null default now()
);
create index if not exists icu_entries_admission on public.icu_entries(admission_id, kind, recorded_at desc);

create or replace function public.sofa_score(d jsonb)
returns jsonb language plpgsql immutable as $$
declare
  n jsonb := '{}'; v int;
  pao2 numeric := coalesce(nullif(d->>'pao2', '')::numeric, nullif(d->>'pao2_kpa', '')::numeric * 7.50062);
  fio2 numeric := nullif(d->>'fio2', '')::numeric;
  support boolean := coalesce((d->>'resp_support')::boolean, false);
  plt numeric := nullif(d->>'platelets', '')::numeric; bili numeric := nullif(d->>'bilirubin', '')::numeric;
  map numeric := nullif(d->>'map', '')::numeric; dopa numeric := coalesce(nullif(d->>'dopamine', '')::numeric, 0);
  dobu numeric := coalesce(nullif(d->>'dobutamine', '')::numeric, 0); adr numeric := coalesce(nullif(d->>'adrenaline', '')::numeric, 0);
  nor numeric := coalesce(nullif(d->>'noradrenaline', '')::numeric, 0); gcs numeric := nullif(d->>'gcs', '')::numeric;
  cr numeric := nullif(d->>'creatinine', '')::numeric; uo numeric := nullif(d->>'urine_24h', '')::numeric; pf numeric;
begin
  if fio2 is not null and fio2 > 1 then fio2 := fio2 / 100; end if;
  pf := case when pao2 is not null and fio2 > 0 then pao2 / fio2 end;
  v := case when pf is null then null when pf < 100 and support then 4 when pf < 200 and support then 3 when pf < 300 then 2 when pf < 400 then 1 else 0 end;
  n := n || jsonb_build_object('respiration', v);
  v := case when plt is null then null when plt < 20 then 4 when plt < 50 then 3 when plt < 100 then 2 when plt < 150 then 1 else 0 end;
  n := n || jsonb_build_object('coagulation', v);
  v := case when bili is null then null when bili > 204 then 4 when bili >= 102 then 3 when bili >= 33 then 2 when bili >= 20 then 1 else 0 end;
  n := n || jsonb_build_object('liver', v);
  v := case when dopa > 15 or adr > 0.1 or nor > 0.1 then 4
            when dopa > 5 or adr > 0 or nor > 0 then 3
            when dopa > 0 or dobu > 0 then 2
            when map is null then null when map < 70 then 1 else 0 end;
  n := n || jsonb_build_object('cardiovascular', v);
  v := case when gcs is null then null when gcs < 6 then 4 when gcs <= 9 then 3 when gcs <= 12 then 2 when gcs <= 14 then 1 else 0 end;
  n := n || jsonb_build_object('cns', v);
  v := case when cr is null and uo is null then null
            when cr > 440 or uo < 200 then 4 when cr >= 300 or uo < 500 then 3 when cr >= 171 then 2 when cr >= 110 then 1
            when cr is null then null else 0 end;
  n := n || jsonb_build_object('renal', v);
  return jsonb_build_object('parts', n, 'pf_ratio', round(pf, 0),
    'total', (select coalesce(sum(value::text::int), 0) from jsonb_each(n) where jsonb_typeof(value) = 'number'),
    'missing', (select coalesce(jsonb_agg(key), '[]'::jsonb) from jsonb_each(n) where jsonb_typeof(value) = 'null'));
end $$;

create or replace function public.icu_pbw(p_height numeric, p_sex text)
returns numeric language sql immutable as $$
  select case when p_height is null or p_height < 100 then null
              else round((case when p_sex = 'female' then 45.5 else 50 end) + 0.91 * (p_height - 152.4), 1) end
$$;

create or replace function public.icu_infusion_rate(p_dose numeric, p_unit text, p_amount numeric, p_volume numeric, p_weight numeric)
returns numeric language sql immutable as $$
  select round(case
    when p_dose is null then null
    when p_unit = 'mL/h' then p_dose
    when p_amount is null or p_volume is null or p_amount <= 0 or p_volume <= 0 then null
    when p_unit = 'mcg/kg/min' then case when p_weight > 0 then p_dose * p_weight * 60 / (p_amount * 1000 / p_volume) end
    when p_unit = 'mcg/min' then p_dose * 60 / (p_amount * 1000 / p_volume)
    when p_unit = 'mg/h' then p_dose / (p_amount / p_volume)
    when p_unit = 'units/h' then p_dose / (p_amount / p_volume)
    when p_unit = 'mg/kg/h' then case when p_weight > 0 then p_dose * p_weight / (p_amount / p_volume) end
  end, 1)
$$;

create or replace function public.icu_high_alert(p_drug text)
returns boolean language sql immutable as $$
  select coalesce(p_drug, '') ~* '(noradrenalin|norepinephrin|adrenalin|epinephrin|dopamin|dobutamin|vasopressin|insulin|heparin|potassium|kcl|magnesium|midazolam|fentanyl|morphine|propofol|ketamine|oxytocin)'
$$;

create or replace function public.icu_entries_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d jsonb := new.data; a public.icu_admissions; c jsonb := '{}'; f jsonb := '[]'; r jsonb;
  w numeric; pbw numeric; vt numeric; num numeric; x numeric; y numeric;
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['struck_out_at', 'struck_out_reason']) is distinct from (to_jsonb(old) - array['struck_out_at', 'struck_out_reason']) then
      raise exception 'Chart entries cannot be changed; strike it out as entered in error and record it again';
    end if;
    if old.struck_out_at is not null then raise exception 'Already struck out'; end if;
    if new.struck_out_at is not null and coalesce(trim(new.struck_out_reason), '') = '' then raise exception 'Give the reason for striking out'; end if;
    return new;
  end if;

  select * into a from public.icu_admissions where id = new.admission_id;
  if a.id is null then raise exception 'ICU admission not found'; end if;
  if a.discharged_at is not null and new.recorded_at > a.discharged_at then raise exception 'The patient has left the unit; this admission is closed'; end if;
  new.hospital_id := a.hospital_id; new.patient_id := a.patient_id;
  w := coalesce(nullif(d->>'weight_kg', '')::numeric, a.weight_kg);

  if new.kind = 'vitals' then
    x := nullif(d->>'sbp', '')::numeric; y := nullif(d->>'dbp', '')::numeric;
    num := coalesce(nullif(d->>'map', '')::numeric, case when x is not null and y is not null then round((x + 2 * y) / 3) end);
    if num is not null then c := c || jsonb_build_object('map', num); end if;
    if num < 65 then f := f || '["MAP below 65 mmHg"]'; end if;
    if nullif(d->>'spo2', '')::numeric < 92 then f := f || '["SpO₂ below 92%"]'; end if;
    if nullif(d->>'hr', '')::numeric > 130 or nullif(d->>'hr', '')::numeric < 45 then f := f || '["Heart rate out of range"]'; end if;
    if nullif(d->>'glucose', '')::numeric < 4 then f := f || '["Hypoglycaemia (glucose below 4 mmol/L)"]'; end if;
    if nullif(d->>'glucose', '')::numeric > 10 then f := f || '["Glucose above 10 mmol/L"]'; end if;
    if nullif(d->>'temp', '')::numeric >= 38.3 then f := f || '["Fever"]'; end if;
    x := nullif(d->>'urine_ml', '')::numeric;
    if x is not null and w > 0 then
      c := c || jsonb_build_object('urine_ml_kg_h', round(x / w / greatest(coalesce(nullif(d->>'hours', '')::numeric, 1), 0.5), 2));
      if x / w / greatest(coalesce(nullif(d->>'hours', '')::numeric, 1), 0.5) < 0.5 then f := f || '["Urine output below 0.5 mL/kg/h"]'; end if;
    end if;

  elsif new.kind = 'ventilator' then
    if coalesce(d->>'mode', '') = '' then raise exception 'Record the ventilation mode'; end if;
    pbw := public.icu_pbw(a.height_cm, a.sex);
    vt := nullif(d->>'vt', '')::numeric;
    c := c || jsonb_build_object('pbw', pbw);
    if vt is not null and pbw > 0 then
      c := c || jsonb_build_object('vt_ml_kg', round(vt / pbw, 1));
      if vt / pbw > 8 then f := f || '["Tidal volume above 8 mL/kg predicted body weight (lung-protective 6–8)"]'; end if;
    elsif vt is not null then f := f || '["Add height and sex on the admission to check mL/kg"]';
    end if;
    x := nullif(d->>'pplat', '')::numeric; y := nullif(d->>'peep', '')::numeric;
    if x > 30 then f := f || '["Plateau pressure above 30 cmH₂O"]'; end if;
    if x is not null and y is not null then
      c := c || jsonb_build_object('driving_pressure', x - y);
      if x - y > 15 then f := f || '["Driving pressure above 15 cmH₂O"]'; end if;
    end if;
    x := nullif(d->>'fio2', '')::numeric; if x is not null and x <= 1 then x := x * 100; end if;
    if x >= 60 then f := f || '["FiO₂ 60% or more"]'; end if;
    if x is not null and nullif(d->>'pao2', '')::numeric > 0 then c := c || jsonb_build_object('pf_ratio', round(nullif(d->>'pao2', '')::numeric / (x / 100))); end if;

  elsif new.kind = 'infusion' then
    if coalesce(trim(d->>'drug'), '') = '' then raise exception 'Name the drug'; end if;
    if coalesce(d->>'action', '') not in ('start', 'change', 'stop') then raise exception 'Action must be start, change or stop'; end if;
    if d->>'action' <> 'stop' then
      num := public.icu_infusion_rate(nullif(d->>'dose', '')::numeric, d->>'dose_unit', nullif(d->>'amount', '')::numeric, nullif(d->>'volume_ml', '')::numeric, w);
      if num is null then raise exception 'Give the dose, unit, amount in the syringe/bag, volume and (for per-kg doses) the weight'; end if;
      c := c || jsonb_build_object('rate_ml_h', num, 'weight_kg', w);
      x := nullif(d->>'pump_rate', '')::numeric;
      if x is not null and abs(x - num) > greatest(num * 0.1, 0.1) then
        raise exception 'The pump rate % mL/h does not match the calculated % mL/h — check the dose, weight and concentration', x, num;
      end if;
      if public.icu_high_alert(d->>'drug') then
        if coalesce(trim(d->>'second_checker'), '') = '' then raise exception '% is a high-alert drug: a second nurse must check the dose and pump', d->>'drug'; end if;
        c := c || '{"high_alert":true}';
      end if;
    end if;

  elsif new.kind = 'sedation' then
    x := nullif(d->>'rass', '')::numeric; y := nullif(d->>'rass_target', '')::numeric;
    if x is not null and (x < -5 or x > 4) then raise exception 'RASS runs from -5 to +4'; end if;
    if x is not null and y is not null and abs(x - y) > 1 then f := f || jsonb_build_array(case when x < y then 'Deeper than the sedation target' else 'Lighter / more agitated than the target' end); end if;
    if x >= 2 then f := f || '["Agitated (RASS +2 or more)"]'; end if;
    x := nullif(d->>'cpot', '')::numeric;
    if x is not null and (x < 0 or x > 8) then raise exception 'CPOT runs from 0 to 8'; end if;
    if x >= 3 then f := f || '["Pain likely (CPOT 3 or more)"]'; end if;
    if nullif(d->>'pain_nrs', '')::numeric >= 4 then f := f || '["Pain score 4 or more"]'; end if;
    if d->>'cam_icu' = 'positive' then f := f || '["Delirium (CAM-ICU positive)"]'; end if;

  elsif new.kind = 'sofa' then
    r := public.sofa_score(d);
    c := r;
    if jsonb_array_length(r->'missing') > 0 then f := f || jsonb_build_array('Not scored: ' || (select string_agg(value #>> '{}', ', ') from jsonb_array_elements(r->'missing'))); end if;

  elsif new.kind = 'goals' then
    c := jsonb_build_object('open', (select coalesce(jsonb_agg(key), '[]'::jsonb) from jsonb_each_text(coalesce(d->'items', '{}')) where value = 'no'));
    if jsonb_array_length(c->'open') > 0 then f := f || jsonb_build_array(jsonb_array_length(c->'open') || ' daily goal(s) not met'); end if;

  elsif new.kind = 'family' then
    if coalesce(trim(d->>'member'), '') = '' or coalesce(trim(d->>'discussed'), '') = '' then raise exception 'Record who you spoke with and what was discussed'; end if;
  end if;

  new.calc := c; new.flags := f;
  return new;
end $$;
drop trigger if exists trg_icu_entries_before on public.icu_entries;
create trigger trg_icu_entries_before before insert or update on public.icu_entries for each row execute function public.icu_entries_before();

create or replace function public.icu_admissions_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.readmission_48h := exists (select 1 from public.icu_admissions p where p.patient_id = new.patient_id and p.hospital_id = new.hospital_id
                                     and p.discharged_at is not null and p.outcome in ('ward', 'step_down') and p.discharged_at > new.admitted_at - interval '48 hours');
    return new;
  end if;
  if old.discharged_at is not null then
    if (to_jsonb(new) - 'discharge_note') is distinct from (to_jsonb(old) - 'discharge_note') then raise exception 'This ICU admission is closed'; end if;
    return new;
  end if;
  if new.discharged_at is not null then
    if new.outcome is null then raise exception 'Record where the patient went (or that they died)'; end if;
    if new.discharged_at < new.admitted_at then raise exception 'Discharge is before admission'; end if;
  elsif new.outcome is not null then
    new.discharged_at := now();
  end if;
  new.readmission_48h := old.readmission_48h; new.admitted_by := old.admitted_by;
  return new;
end $$;
drop trigger if exists trg_icu_admissions_before on public.icu_admissions;
create trigger trg_icu_admissions_before before insert or update on public.icu_admissions for each row execute function public.icu_admissions_before();

create or replace function public.icu_stats(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Only clinical staff can see ICU statistics'; end if;
  with a as (
    select *, extract(epoch from (coalesce(discharged_at, now()) - admitted_at)) / 86400 as los
      from public.icu_admissions where hospital_id = p_hospital and admitted_at >= p_from and admitted_at < p_to + 1
  ), vent as (
    select e.admission_id, count(distinct (e.recorded_at at time zone 'Africa/Nairobi')::date) days
      from public.icu_entries e join a on a.id = e.admission_id where e.kind = 'ventilator' and e.struck_out_at is null group by e.admission_id
  ), first_sofa as (
    select distinct on (e.admission_id) e.admission_id, (e.calc->>'total')::int total
      from public.icu_entries e join a on a.id = e.admission_id where e.kind = 'sofa' and e.struck_out_at is null order by e.admission_id, e.recorded_at
  )
  select jsonb_build_object(
    'admissions', (select count(*) from a),
    'by_unit', (select coalesce(jsonb_object_agg(unit, n), '{}'::jsonb) from (select unit, count(*) n from a group by unit) x),
    'still_in_unit', (select count(*) from a where discharged_at is null),
    'deaths', (select count(*) from a where outcome = 'died'),
    'mortality_pct', (select round(100.0 * count(*) filter (where outcome = 'died') / nullif(count(*) filter (where discharged_at is not null), 0), 1) from a),
    'median_los_days', (select round((percentile_cont(0.5) within group (order by los))::numeric, 1) from a where discharged_at is not null),
    'patient_days', (select round(coalesce(sum(los), 0)::numeric, 1) from a),
    'ventilated', (select count(*) from vent),
    'ventilator_days', (select coalesce(sum(days), 0) from vent),
    'readmissions_48h', (select count(*) from a where readmission_48h),
    'median_admission_sofa', (select percentile_cont(0.5) within group (order by total) from first_sofa),
    'by_source', (select coalesce(jsonb_object_agg(coalesce(source, 'unknown'), n), '{}'::jsonb) from (select source, count(*) n from a group by source) x)
  ) into r;
  return r;
end $$;

alter table public.icu_admissions enable row level security;
alter table public.icu_entries enable row level security;
drop policy if exists icu_admissions_clinical on public.icu_admissions;
drop policy if exists icu_entries_clinical on public.icu_entries;
create policy icu_admissions_clinical on public.icu_admissions for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy icu_entries_clinical on public.icu_entries for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
revoke all on public.icu_admissions, public.icu_entries from anon;
grant select, insert, update on public.icu_admissions, public.icu_entries to authenticated;
grant all on public.icu_admissions, public.icu_entries to service_role;
revoke execute on function public.icu_entries_before(), public.icu_admissions_before() from public, anon, authenticated;
revoke execute on function public.icu_stats(uuid, date, date) from public, anon;
grant execute on function public.icu_stats(uuid, date, date) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['icu_admissions', 'icu_entries'] loop
    if to_regprocedure('public.audit_row_change()') is not null then
      execute format('drop trigger if exists trg_audit_change on public.%I', t);
      execute format('create trigger trg_audit_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
    end if;
  end loop;
end $$;

commit;

select 'tables' as check_name, case when to_regclass('public.icu_admissions') is not null and to_regclass('public.icu_entries') is not null and exists (select 1 from pg_trigger where tgname = 'trg_icu_entries_before') then 'OK' else 'PROBLEM' end as result
    union all select 'SOFA and pump-rate checks', case when (public.sofa_score('{"pao2":80,"fio2":0.5,"resp_support":true,"platelets":40,"bilirubin":110,"noradrenaline":0.2,"gcs":8,"creatinine":350}')->>'total')::int = 19 and public.icu_infusion_rate(0.1, 'mcg/kg/min', 4, 50, 70) = 5.3 then 'OK' else 'PROBLEM' end;
