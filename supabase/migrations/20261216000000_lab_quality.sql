-- Laboratory quality: per-analyte rules (reference range, critical limits, delta-check limits; defaults below, any
-- hospital can override), a delta check against the patient's previous result for every structured result, opt-in
-- auto-validation (all values in range, nothing critical, no delta flag — otherwise the result waits for review), a
-- review step that records who validated, and turnaround-time statistics against targets per priority.
-- The rule logic never blocks saving a result. Defaults mirror src/utils/labQuality.js (a test compares them).

do $$ begin
  if to_regclass('public.lab_tests') is null then raise exception 'lab_tests not found: the laboratory tables come with the original RemedacareHMS schema.'; end if;
end $$;

alter table public.lab_tests add column if not exists priority text;
alter table public.lab_tests add column if not exists sample_collected_at timestamptz;
alter table public.lab_tests add column if not exists resulted_at timestamptz;
alter table public.lab_tests add column if not exists results_ready_at timestamptz;
alter table public.lab_tests add column if not exists reviewed_at timestamptz;
alter table public.lab_tests add column if not exists result_json jsonb;
alter table public.lab_tests add column if not exists result_template_key text;
alter table public.lab_tests add column if not exists delta_flags jsonb not null default '[]'::jsonb;
alter table public.lab_tests add column if not exists validation_status text check (validation_status in ('auto_validated', 'needs_review', 'validated'));
alter table public.lab_tests add column if not exists validated_by uuid;
alter table public.lab_tests add column if not exists validated_at timestamptz;

create table if not exists public.lab_analyte_rules (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid,                       -- null = built-in default
  template_key  text not null,
  analyte       text not null,
  low           numeric, high numeric,
  critical_low  numeric, critical_high numeric,
  delta_abs     numeric,                    -- flag when |change| ≥ this, or
  delta_pct     numeric,                    -- when |change| ≥ this % of the previous value
  delta_days    integer not null default 7, -- compare with a previous result no older than this
  updated_at    timestamptz not null default now()
);
create unique index if not exists lab_analyte_rules_key on public.lab_analyte_rules(coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), template_key, analyte);

insert into public.lab_analyte_rules(hospital_id, template_key, analyte, low, high, critical_low, critical_high, delta_abs, delta_pct, delta_days) values
  (null, 'fbc', 'haemoglobin', 11.5, 17.5, 6, 22, 2, null, 7),
  (null, 'fbc', 'wbc', 4, 11, 1, 50, null, 50, 7),
  (null, 'fbc', 'platelets', 150, 400, 20, 1000, null, 50, 7),
  (null, 'rfts', 'urea', 2.5, 7.8, null, null, null, 50, 7),
  (null, 'rfts', 'creatinine', 45, 110, null, null, null, 50, 7),
  (null, 'rfts', 'sodium', 135, 145, 120, 160, 8, null, 7),
  (null, 'rfts', 'potassium', 3.5, 5.1, 2.5, 6.5, 1, null, 7),
  (null, 'rfts', 'chloride', 98, 107, null, null, 10, null, 7),
  (null, 'rfts', 'egfr', null, null, null, null, null, 25, 7),
  (null, 'lft', 'alt', 0, 56, null, null, null, 100, 14),
  (null, 'lft', 'ast', 0, 40, null, null, null, 100, 14),
  (null, 'lft', 'bilirubin', 5, 21, null, null, null, 50, 14),
  (null, 'lft', 'albumin', 35, 50, null, null, 8, null, 14)
on conflict do nothing;

create table if not exists public.lab_quality_settings (
  hospital_id   uuid primary key,
  autoverify    boolean not null default false,
  tat_targets   jsonb not null default '{"STAT": 60, "Urgent": 240, "Routine": 1440}'::jsonb,   -- minutes, order to result
  updated_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now()
);

create or replace function public.lab_num(v text)
returns numeric language sql immutable as $$
  select case when trim(coalesce(v, '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then trim(v)::numeric end
$$;

-- Effective rules for a hospital and template: the hospital's own row, else the default
create or replace function public.lab_rules(p_hospital uuid, p_template text)
returns setof public.lab_analyte_rules language sql stable security definer set search_path = public as $$
  select distinct on (analyte) * from public.lab_analyte_rules
   where template_key = p_template and (hospital_id = p_hospital or hospital_id is null)
   order by analyte, hospital_id nulls last
$$;

create or replace function public.lab_tests_quality()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); prev record; rr public.lab_analyte_rules; v numeric; p numeric; flags jsonb := '[]'; ok boolean := true; any_value boolean := false;
        hosp uuid := public.ref_try_uuid(j->>'hospital_id'); auto boolean;
begin
  -- review recorded (the existing "reviewed" step, or an explicit validation)
  if tg_op = 'UPDATE' and ((new.reviewed_at is not null and old.reviewed_at is null) or (new.validation_status = 'validated' and old.validation_status is distinct from 'validated')) then
    new.validation_status := 'validated'; new.validated_by := coalesce(new.validated_by, auth.uid()); new.validated_at := coalesce(new.validated_at, now());
    new.reviewed_at := coalesce(new.reviewed_at, now());
    return new;
  end if;
  if new.result_json is null or new.result_template_key is null then return new; end if;
  if tg_op = 'UPDATE' and new.result_json is not distinct from old.result_json then return new; end if;

  begin
    select l.result_json, coalesce(l.results_ready_at, l.resulted_at, l.created_at) at_time into prev
      from public.lab_tests l
     where l.patient_id::text = new.patient_id::text and l.result_template_key = new.result_template_key and l.id <> new.id and l.result_json is not null
       and coalesce(l.results_ready_at, l.resulted_at, l.created_at) < coalesce(new.results_ready_at, new.resulted_at, now())
     order by coalesce(l.results_ready_at, l.resulted_at, l.created_at) desc limit 1;

    for rr in select * from public.lab_rules(hosp, new.result_template_key) loop
      v := public.lab_num(new.result_json->>rr.analyte);
      if v is null then continue; end if;
      any_value := true;
      if (rr.low is not null and v < rr.low) or (rr.high is not null and v > rr.high) then ok := false; end if;
      if (rr.critical_low is not null and v <= rr.critical_low) or (rr.critical_high is not null and v >= rr.critical_high) then ok := false; end if;
      p := public.lab_num(prev.result_json->>rr.analyte);
      if p is not null and prev.at_time >= coalesce(new.results_ready_at, new.resulted_at, now()) - make_interval(days => rr.delta_days)
         and ((rr.delta_abs is not null and abs(v - p) >= rr.delta_abs) or (rr.delta_pct is not null and p <> 0 and abs(v - p) / abs(p) * 100 >= rr.delta_pct)) then
        flags := flags || jsonb_build_object('analyte', rr.analyte, 'previous', p, 'current', v, 'change', v - p, 'previous_at', prev.at_time);
        ok := false;
      end if;
    end loop;

    new.delta_flags := flags;
    select coalesce((select s.autoverify from public.lab_quality_settings s where s.hospital_id = hosp), false) into auto;
    if auto and ok and any_value then
      new.validation_status := 'auto_validated'; new.validated_at := now(); new.validated_by := null;
    else
      new.validation_status := 'needs_review'; new.validated_at := null; new.validated_by := null;
    end if;
  exception when others then
    raise warning 'lab quality check skipped: %', sqlerrm;   -- never block a result
  end;
  return new;
end $$;
drop trigger if exists trg_lab_tests_quality on public.lab_tests;
create trigger trg_lab_tests_quality before insert or update on public.lab_tests for each row execute function public.lab_tests_quality();

-- Turnaround times (order → result) against targets, and what is overdue now
create or replace function public.lab_tat(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; targets jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Only clinical and laboratory staff can see turnaround times'; end if;
  targets := coalesce((select tat_targets from public.lab_quality_settings where hospital_id = p_hospital), '{"STAT": 60, "Urgent": 240, "Routine": 1440}'::jsonb);
  with t as (
    select l.*, coalesce(nullif(l.priority, ''), 'Routine') pr,
           extract(epoch from coalesce(l.results_ready_at, l.resulted_at) - l.created_at) / 60 as tat,
           extract(epoch from coalesce(l.results_ready_at, l.resulted_at) - l.sample_collected_at) / 60 as lab_tat
      from public.lab_tests l
     where l.hospital_id::text = p_hospital::text and l.created_at >= p_from and l.created_at < p_to + 1
  ), tt as (select t.*, coalesce((targets->>t.pr)::numeric, (targets->>'Routine')::numeric) target from t)
  select jsonb_build_object(
    'targets', targets,
    'ordered', (select count(*) from tt),
    'resulted', (select count(*) from tt where tat is not null),
    'by_priority', (select coalesce(jsonb_object_agg(pr, x), '{}'::jsonb) from (
        select pr, jsonb_build_object('ordered', count(*), 'resulted', count(tat),
          'median_min', round((percentile_cont(0.5) within group (order by tat))::numeric),
          'median_lab_min', round((percentile_cont(0.5) within group (order by lab_tat))::numeric),
          'within_target_pct', round(100.0 * count(*) filter (where tat <= target) / nullif(count(tat), 0))) x
          from tt group by pr) q),
    'by_test', (select coalesce(jsonb_agg(x order by (x->>'ordered')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('test', test_type, 'ordered', count(*), 'median_min', round((percentile_cont(0.5) within group (order by tat))::numeric),
          'within_target_pct', round(100.0 * count(*) filter (where tat <= target) / nullif(count(tat), 0))) x
          from tt group by test_type order by count(*) desc limit 15) q),
    'overdue', (select coalesce(jsonb_agg(x order by (x->>'minutes')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('id', l.id, 'test', l.test_type, 'patient', l.patient_name, 'priority', coalesce(nullif(l.priority, ''), 'Routine'),
               'minutes', round(extract(epoch from now() - l.created_at) / 60), 'target', coalesce((targets->>coalesce(nullif(l.priority, ''), 'Routine'))::numeric, 1440)) x
          from public.lab_tests l
         where l.hospital_id::text = p_hospital::text and coalesce(l.results_ready_at, l.resulted_at) is null
           and coalesce(l.status, '') !~* '^(cancel|reject|referred)'
           and extract(epoch from now() - l.created_at) / 60 > coalesce((targets->>coalesce(nullif(l.priority, ''), 'Routine'))::numeric, 1440)
         limit 50) q),
    'awaiting_review', (select count(*) from public.lab_tests l where l.hospital_id::text = p_hospital::text and l.validation_status = 'needs_review'),
    'auto_validated', (select count(*) from tt where validation_status = 'auto_validated'),
    'delta_flagged', (select count(*) from tt where jsonb_array_length(delta_flags) > 0)
  ) into r;
  return r;
end $$;

create or replace function public.lab_quality_settings_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not coalesce((select c.member and c.staff_active and (c.canonical = 'admin' or lower(coalesce(c.raw_role, '')) ~ '(lab|scientist|pathologist|mlt)')
                     from public.pay_user_context(new.hospital_id, auth.uid()) c), false) then
    raise exception 'Only the laboratory manager or an administrator can change laboratory rules';
  end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_lab_quality_settings_guard on public.lab_quality_settings;
create trigger trg_lab_quality_settings_guard before insert or update on public.lab_quality_settings for each row execute function public.lab_quality_settings_guard();
create or replace function public.lab_analyte_rules_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- installer / service: seeds the built-in defaults
  if coalesce(new.hospital_id, old.hospital_id) is null then raise exception 'Built-in default rules cannot be changed; add a rule for your hospital'; end if;
  if not coalesce((select c.member and c.staff_active and (c.canonical = 'admin' or lower(coalesce(c.raw_role, '')) ~ '(lab|scientist|pathologist|mlt)')
                     from public.pay_user_context(new.hospital_id, auth.uid()) c), false) then
    raise exception 'Only the laboratory manager or an administrator can change laboratory rules';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_lab_analyte_rules_guard on public.lab_analyte_rules;
create trigger trg_lab_analyte_rules_guard before insert or update on public.lab_analyte_rules for each row execute function public.lab_analyte_rules_guard();

alter table public.lab_analyte_rules enable row level security;
alter table public.lab_quality_settings enable row level security;
drop policy if exists lab_analyte_rules_read on public.lab_analyte_rules;
drop policy if exists lab_analyte_rules_write on public.lab_analyte_rules;
drop policy if exists lab_quality_settings_rw on public.lab_quality_settings;
create policy lab_analyte_rules_read on public.lab_analyte_rules for select to authenticated using (hospital_id is null or public.clin_can_access(hospital_id));
create policy lab_analyte_rules_write on public.lab_analyte_rules for all to authenticated using (hospital_id is not null and public.clin_can_access(hospital_id)) with check (hospital_id is not null and public.clin_can_access(hospital_id));
create policy lab_quality_settings_rw on public.lab_quality_settings for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
revoke all on public.lab_analyte_rules, public.lab_quality_settings from anon;
grant select, insert, update on public.lab_analyte_rules, public.lab_quality_settings to authenticated;
grant all on public.lab_analyte_rules, public.lab_quality_settings to service_role;
revoke execute on function public.lab_tests_quality(), public.lab_quality_settings_guard(), public.lab_analyte_rules_guard() from public, anon, authenticated;
revoke execute on function public.lab_tat(uuid, date, date), public.lab_rules(uuid, text) from public, anon;
grant execute on function public.lab_tat(uuid, date, date), public.lab_rules(uuid, text) to authenticated, service_role;
