-- =============================================================================
-- RemedacareHMS — NCD / chronic care registry with recall and tracing
--   ncd_condition_config  per-condition targets (hospital override or global default), review interval,
--                         overdue (7 d) and lost-to-follow-up (28 d) thresholds
--   ncd_enrolments        one per patient per condition: baseline, risk, clinician, status, next visit due,
--                         control status, refill due, care plan; per-patient target overrides
--   ncd_visits            structured BP, glucose, HbA1c, weight, VL, ACT, seizures…; control status computed
--   ncd_tracing_tasks / ncd_tracing_attempts   defaulter tracing with attempts and outcomes
--   ncd_recall_sweep()    overdue → tracing task; LTFU after 28 d (run by the appointments-reminders sweep)
--   ncd_summary() / ncd_cohort()  dashboards and 6 / 12-month cohort outcomes
-- Existing chronic_disease_records are copied in once (idempotent). Requires the payments migration
-- (pay_is_member). Safe to re-run.
-- =============================================================================

create table if not exists public.ncd_condition_config (
  id                   uuid primary key default gen_random_uuid(),
  hospital_id          uuid,                         -- null = default for every hospital
  code                 text not null,
  label                text not null,
  targets              jsonb not null default '{}',  -- {"bp_sys_max":139,"hba1c_max":6.9} : field + _max / _min
  review_interval_days integer not null default 30 check (review_interval_days between 1 and 365),
  overdue_after_days   integer not null default 7,
  ltfu_after_days      integer not null default 28,
  active               boolean not null default true
);
create unique index if not exists ncd_condition_config_uq on public.ncd_condition_config(coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

-- Defaults from Kenyan national guidelines (hospital rows with the same code override these).
-- Targets are inclusive limits: bp_sys_max 139 means "below 140".
insert into public.ncd_condition_config(hospital_id, code, label, targets, review_interval_days) values
  (null, 'htn',      'Hypertension',            '{"bp_sys_max":139,"bp_dia_max":89}', 30),
  (null, 'dm',       'Diabetes',                '{"hba1c_max":6.9,"fbs_max":7.0}', 30),
  (null, 'ckd',      'Chronic kidney disease',  '{"bp_sys_max":129,"bp_dia_max":79}', 90),
  (null, 'asthma',   'Asthma',                  '{"act_score_min":20}', 90),
  (null, 'copd',     'COPD',                    '{}', 90),
  (null, 'epilepsy', 'Epilepsy',                '{"seizures_max":0}', 90),
  (null, 'sickle',   'Sickle cell disease',     '{"crises_max":0}', 90),
  (null, 'hf',       'Heart failure',           '{"bp_sys_max":139,"bp_dia_max":89}', 30),
  (null, 'cancer',   'Cancer',                  '{}', 30),
  (null, 'hiv',      'HIV',                     '{"viral_load_max":199}', 90),
  (null, 'tb',       'Tuberculosis',            '{}', 14),
  (null, 'mental',   'Mental health',           '{}', 30)
on conflict do nothing;

create table if not exists public.ncd_enrolments (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  patient_id       uuid not null,
  condition_code   text not null,
  condition_label  text not null,
  enrolled_on      date not null default current_date,
  diagnosis_date   date,
  baseline         jsonb not null default '{}',
  risk_class       text check (risk_class in ('low', 'medium', 'high')),
  clinician_id     text,
  clinician_name   text,
  targets          jsonb not null default '{}',     -- per-patient overrides, e.g. {"hba1c_max":7.9} for the elderly
  care_plan        jsonb not null default '{}',     -- {"review_interval_days":30,"medications":"…","screenings":{…}}
  status           text not null default 'active' check (status in ('active', 'ltfu', 'transferred_out', 'died', 'discharged', 'refused')),
  status_date      date,
  status_reason    text,
  last_visit_date  date,
  next_visit_due   date,
  control_status   text not null default 'unknown' check (control_status in ('controlled', 'uncontrolled', 'unknown')),
  last_values      jsonb not null default '{}',
  refill_due       date,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);
create unique index if not exists ncd_enrolments_one_active on public.ncd_enrolments(hospital_id, patient_id, condition_code) where status in ('active', 'ltfu');
create index if not exists ncd_enrolments_due on public.ncd_enrolments(hospital_id, status, next_visit_due);
create index if not exists ncd_enrolments_patient on public.ncd_enrolments(patient_id);
do $$ begin
  alter table public.ncd_enrolments add constraint ncd_enrolments_patient_fk foreign key (patient_id) references public.patients(id) on delete cascade;
exception when duplicate_object then null; when others then raise notice 'patient FK not added: %', sqlerrm; end $$;

create table if not exists public.ncd_visits (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  enrolment_id     uuid not null references public.ncd_enrolments(id) on delete cascade,
  patient_id       uuid not null,
  visit_date       date not null default current_date,
  bp_sys           numeric, bp_dia numeric,
  fbs              numeric, rbs numeric, hba1c numeric,     -- mmol/L, mmol/L, %
  weight_kg        numeric, height_cm numeric,
  viral_load       numeric,                                -- copies/ml; LDL = 0
  act_score        numeric, peak_flow numeric,
  seizures         numeric, crises numeric, egfr numeric,
  medications      text,
  adherence        text check (adherence in ('good', 'fair', 'poor')),
  screening        jsonb not null default '{}',            -- {"eye_exam":true,"foot_exam":true,"urine_albumin":"normal"}
  complications    text,
  next_visit_date  date,
  refill_days      integer check (refill_days between 1 and 365),
  notes            text,
  control_status   text not null default 'unknown',
  legacy_record_id text unique,
  recorded_by      uuid default auth.uid(),
  created_at       timestamptz not null default now()
);
create index if not exists ncd_visits_enrolment on public.ncd_visits(enrolment_id, visit_date desc);

create table if not exists public.ncd_tracing_tasks (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  enrolment_id  uuid not null references public.ncd_enrolments(id) on delete cascade,
  patient_id    uuid not null,
  reason        text not null check (reason in ('overdue', 'ltfu', 'missed_appointment', 'uncontrolled', 'lab_due')),
  due_since     date,
  status        text not null default 'open' check (status in ('open', 'closed')),
  outcome       text check (outcome in ('returned', 'rebooked', 'transferred', 'died', 'refused', 'not_found', 'other')),
  outcome_note  text,
  closed_at     timestamptz,
  closed_by     uuid,
  assigned_to   text,
  created_at    timestamptz not null default now()
);
create unique index if not exists ncd_tracing_one_open on public.ncd_tracing_tasks(enrolment_id) where status = 'open';

create table if not exists public.ncd_tracing_attempts (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.ncd_tracing_tasks(id) on delete cascade,
  hospital_id uuid not null,
  method      text not null check (method in ('call', 'sms', 'home_visit', 'chw', 'whatsapp')),
  result      text not null check (result in ('reached', 'no_answer', 'wrong_number', 'switched_off', 'message_left', 'visited')),
  notes       text,
  attempted_by uuid default auth.uid(),
  attempted_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- control evaluation
/** Effective targets: global default ← hospital override ← patient override. */
create or replace function public.ncd_targets(p_hospital uuid, p_code text, p_patient_targets jsonb default '{}')
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select targets from public.ncd_condition_config where hospital_id is null and code = p_code), '{}'::jsonb)
      || coalesce((select targets from public.ncd_condition_config where hospital_id = p_hospital and code = p_code), '{}'::jsonb)
      || coalesce(p_patient_targets, '{}'::jsonb)
$$;

/** 'controlled' when every target that has a value passes; 'unknown' when nothing could be compared. */
create or replace function public.ncd_evaluate(p_values jsonb, p_targets jsonb)
returns text language plpgsql immutable as $$
declare k text; lim numeric; field text; val numeric; compared int := 0; failed int := 0;
begin
  for k, lim in select key, (value #>> '{}')::numeric from jsonb_each(coalesce(p_targets, '{}')) where key ~ '_(max|min)$' loop
    field := regexp_replace(k, '_(max|min)$', '');
    if p_values ? field and nullif(p_values->>field, '') is not null then
      val := (p_values->>field)::numeric;
      compared := compared + 1;
      if (k like '%\_max' and val > lim) or (k like '%\_min' and val < lim) then failed := failed + 1; end if;
    end if;
  end loop;
  return case when compared = 0 then 'unknown' when failed = 0 then 'controlled' else 'uncontrolled' end;
end $$;

create or replace function public.ncd_interval(p_hospital uuid, p_code text, p_plan jsonb)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(nullif(p_plan->>'review_interval_days', '')::int,
    (select review_interval_days from public.ncd_condition_config where hospital_id = p_hospital and code = p_code),
    (select review_interval_days from public.ncd_condition_config where hospital_id is null and code = p_code), 30)
$$;

create or replace function public.ncd_visit_values(v public.ncd_visits)
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('bp_sys', v.bp_sys, 'bp_dia', v.bp_dia, 'fbs', v.fbs, 'rbs', v.rbs, 'hba1c', v.hba1c,
    'weight_kg', v.weight_kg, 'height_cm', v.height_cm, 'viral_load', v.viral_load, 'act_score', v.act_score, 'peak_flow', v.peak_flow,
    'seizures', v.seizures, 'crises', v.crises, 'egfr', v.egfr,
    'bmi', case when v.weight_kg > 0 and v.height_cm > 0 then round(v.weight_kg / ((v.height_cm / 100) ^ 2), 1) end))
$$;

create or replace function public.ncd_visits_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare e public.ncd_enrolments;
begin
  select * into e from public.ncd_enrolments where id = new.enrolment_id;
  if not found then raise exception 'Enrolment not found'; end if;
  new.hospital_id := e.hospital_id;
  new.patient_id := e.patient_id;
  new.control_status := public.ncd_evaluate(public.ncd_visit_values(new), public.ncd_targets(e.hospital_id, e.condition_code, e.targets));
  return new;
end $$;

-- The latest visit drives the enrolment: last values, control, next visit due, refill due; a returning
-- patient closes the open tracing task and comes back from LTFU.
create or replace function public.ncd_refresh_enrolment(p_enrolment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e public.ncd_enrolments; v public.ncd_visits;
begin
  select * into e from public.ncd_enrolments where id = p_enrolment for update;
  if not found then return; end if;
  select * into v from public.ncd_visits where enrolment_id = p_enrolment order by visit_date desc, created_at desc limit 1;
  if not found then
    update public.ncd_enrolments set last_visit_date = null, control_status = 'unknown', last_values = '{}',
           next_visit_due = enrolled_on + public.ncd_interval(hospital_id, condition_code, care_plan) where id = p_enrolment;
    return;
  end if;
  update public.ncd_enrolments set
    last_visit_date = v.visit_date,
    control_status  = v.control_status,
    last_values     = public.ncd_visit_values(v) || jsonb_build_object('visit_date', v.visit_date, 'adherence', v.adherence),
    next_visit_due  = coalesce(v.next_visit_date, v.visit_date + public.ncd_interval(e.hospital_id, e.condition_code, e.care_plan)),
    refill_due      = case when v.refill_days is not null then v.visit_date + v.refill_days else refill_due end,
    status          = case when status = 'ltfu' then 'active' else status end,
    status_date     = case when status = 'ltfu' then v.visit_date else status_date end,
    status_reason   = case when status = 'ltfu' then 'Returned to care' else status_reason end
  where id = p_enrolment;
  update public.ncd_tracing_tasks set status = 'closed', outcome = 'returned', closed_at = now(),
         outcome_note = coalesce(outcome_note, 'Visit recorded ' || v.visit_date)
   where enrolment_id = p_enrolment and status = 'open' and reason in ('overdue', 'ltfu', 'missed_appointment');
end $$;

create or replace function public.ncd_visits_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ncd_refresh_enrolment(coalesce(new.enrolment_id, old.enrolment_id));
  return null;
end $$;

drop trigger if exists trg_ncd_visits_before on public.ncd_visits;
create trigger trg_ncd_visits_before before insert or update on public.ncd_visits
  for each row execute function public.ncd_visits_before();
drop trigger if exists trg_ncd_visits_after on public.ncd_visits;
create trigger trg_ncd_visits_after after insert or update or delete on public.ncd_visits
  for each row execute function public.ncd_visits_after();

create or replace function public.ncd_enrolments_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.condition_label := coalesce(nullif(new.condition_label, ''),
      (select label from public.ncd_condition_config where code = new.condition_code order by hospital_id nulls last limit 1), new.condition_code);
    new.next_visit_due := coalesce(new.next_visit_due, new.enrolled_on + public.ncd_interval(new.hospital_id, new.condition_code, new.care_plan));
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_date := coalesce(new.status_date, current_date);
    if new.status not in ('active', 'ltfu') then
      update public.ncd_tracing_tasks set status = 'closed', closed_at = now(),
             outcome = case new.status when 'died' then 'died' when 'transferred_out' then 'transferred' when 'refused' then 'refused' else 'other' end
       where enrolment_id = new.id and status = 'open';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_ncd_enrolments_before on public.ncd_enrolments;
create trigger trg_ncd_enrolments_before before insert or update on public.ncd_enrolments
  for each row execute function public.ncd_enrolments_before();

-- ---------------------------------------------------------------- recall engine
create or replace function public.ncd_recall_sweep(p_today date default (now() at time zone 'Africa/Nairobi')::date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_overdue int := 0; v_ltfu int := 0; r record; has_appts boolean := to_regclass('public.appointments') is not null;
begin
  for r in
    select e.*, coalesce(h.overdue_after_days, d.overdue_after_days, 7) as od, coalesce(h.ltfu_after_days, d.ltfu_after_days, 28) as lf
      from public.ncd_enrolments e
      left join public.ncd_condition_config h on h.hospital_id = e.hospital_id and h.code = e.condition_code
      left join public.ncd_condition_config d on d.hospital_id is null and d.code = e.condition_code
     where e.status in ('active', 'ltfu') and e.next_visit_due is not null
       and e.next_visit_due + coalesce(h.overdue_after_days, d.overdue_after_days, 7) < p_today
  loop
    -- a future booking means the patient is already rebooked: not a defaulter
    if has_appts and exists (select 1 from public.appointments a where a.patient_id::text = r.patient_id::text
          and a.hospital_id = r.hospital_id and a.starts_at > now()
          and coalesce(a.status, 'Scheduled') in ('Scheduled', 'Confirmed')) then
      continue;
    end if;
    if r.next_visit_due + r.lf < p_today then
      if r.status = 'active' then
        update public.ncd_enrolments set status = 'ltfu', status_date = p_today, status_reason = 'No visit ' || r.lf || ' days after due date'
         where id = r.id;
        v_ltfu := v_ltfu + 1;
      end if;
      insert into public.ncd_tracing_tasks(hospital_id, enrolment_id, patient_id, reason, due_since)
      values (r.hospital_id, r.id, r.patient_id, 'ltfu', r.next_visit_due)
      on conflict (enrolment_id) where status = 'open' do update set reason = 'ltfu' where ncd_tracing_tasks.reason <> 'ltfu';
    else
      insert into public.ncd_tracing_tasks(hospital_id, enrolment_id, patient_id, reason, due_since)
      values (r.hospital_id, r.id, r.patient_id, 'overdue', r.next_visit_due)
      on conflict (enrolment_id) where status = 'open' do nothing;
      if found then v_overdue := v_overdue + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('new_overdue_tasks', v_overdue, 'new_ltfu', v_ltfu);
end $$;

-- A missed chronic-care appointment opens a tracing task straight away.
create or replace function public.ncd_on_missed_appointment()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); e record;
begin
  if coalesce(j->>'status', '') <> 'No-Show' or coalesce(to_jsonb(old)->>'status', '') = 'No-Show' then return null; end if;
  for e in select * from public.ncd_enrolments x
            where x.hospital_id = new.hospital_id and x.patient_id::text = j->>'patient_id' and x.status = 'active'
              and (nullif(j->>'care_plan_ref', '') is null or x.id::text = j->>'care_plan_ref') loop
    insert into public.ncd_tracing_tasks(hospital_id, enrolment_id, patient_id, reason, due_since)
    values (e.hospital_id, e.id, e.patient_id, 'missed_appointment', nullif(j->>'appointment_date', '')::date)
    on conflict (enrolment_id) where status = 'open' do nothing;
  end loop;
  return null;
end $$;
do $$ begin
  if to_regclass('public.appointments') is not null then
    execute 'drop trigger if exists trg_ncd_missed_appointment on public.appointments';
    execute 'create trigger trg_ncd_missed_appointment after update on public.appointments for each row execute function public.ncd_on_missed_appointment()';
  end if;
end $$;

-- ---------------------------------------------------------------- dashboards and cohorts
create or replace function public.ncd_summary(p_hospital uuid)
returns table(condition_code text, condition_label text, active bigint, controlled bigint, uncontrolled bigint, unknown bigint,
              overdue bigint, ltfu bigint, new_this_month bigint, refills_due_7d bigint, open_tracing bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pay_is_member(p_hospital) then raise exception 'Not a member of this hospital'; end if;
  return query
  select e.condition_code, max(e.condition_label),
         count(*) filter (where e.status = 'active'),
         count(*) filter (where e.status = 'active' and e.control_status = 'controlled'),
         count(*) filter (where e.status = 'active' and e.control_status = 'uncontrolled'),
         count(*) filter (where e.status = 'active' and e.control_status = 'unknown'),
         count(*) filter (where e.status = 'active' and e.next_visit_due < (now() at time zone 'Africa/Nairobi')::date),
         count(*) filter (where e.status = 'ltfu'),
         count(*) filter (where e.enrolled_on >= date_trunc('month', now() at time zone 'Africa/Nairobi')::date),
         count(*) filter (where e.status = 'active' and e.refill_due between (now() at time zone 'Africa/Nairobi')::date and (now() at time zone 'Africa/Nairobi')::date + 7),
         (select count(*) from public.ncd_tracing_tasks t join public.ncd_enrolments x on x.id = t.enrolment_id
           where x.hospital_id = p_hospital and x.condition_code = e.condition_code and t.status = 'open')
    from public.ncd_enrolments e
   where e.hospital_id = p_hospital
   group by e.condition_code
   order by 3 desc;
end $$;

/** Outcomes of patients enrolled between p_from and p_to, measured p_months after each enrolment. */
create or replace function public.ncd_cohort(p_hospital uuid, p_condition text, p_from date, p_to date, p_months integer)
returns table(enrolled bigint, in_care bigint, controlled bigint, ltfu bigint, died bigint, transferred bigint, not_yet_due bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pay_is_member(p_hospital) then raise exception 'Not a member of this hospital'; end if;
  return query
  with c as (
    select e.*, (e.enrolled_on + make_interval(months => p_months))::date as at_date from public.ncd_enrolments e
     where e.hospital_id = p_hospital and (p_condition is null or e.condition_code = p_condition)
       and e.enrolled_on between p_from and p_to
  ), s as (
    select c.*,
      case
        when c.at_date > (now() at time zone 'Africa/Nairobi')::date then 'not_yet_due'
        when c.status = 'died' and c.status_date <= c.at_date then 'died'
        when c.status = 'transferred_out' and c.status_date <= c.at_date then 'transferred'
        when c.status in ('ltfu', 'refused', 'discharged') and c.status_date <= c.at_date then 'ltfu'
        else 'in_care' end as outcome,
      (select v.control_status from public.ncd_visits v where v.enrolment_id = c.id and v.visit_date <= c.at_date
         and v.visit_date > c.at_date - 120 order by v.visit_date desc limit 1) as last_control
    from c
  )
  select count(*), count(*) filter (where outcome = 'in_care'),
         count(*) filter (where outcome = 'in_care' and last_control = 'controlled'),
         count(*) filter (where outcome = 'ltfu'), count(*) filter (where outcome = 'died'),
         count(*) filter (where outcome = 'transferred'), count(*) filter (where outcome = 'not_yet_due')
    from s;
end $$;

-- ---------------------------------------------------------------- copy the old free-text register in (once)
create or replace function public.ncd_condition_code(p_text text)
returns text language sql immutable as $$
  select case
    when p_text ~* 'diabet|\mdm\M|t2dm|t1dm' then 'dm'
    when p_text ~* 'hypertens|high blood pressure|\mhtn\M' then 'htn'
    when p_text ~* 'kidney|renal|\mckd\M' then 'ckd'
    when p_text ~* 'asthma' then 'asthma'
    when p_text ~* 'copd|obstructive pulmonary' then 'copd'
    when p_text ~* 'epilep|seizure' then 'epilepsy'
    when p_text ~* 'sickle' then 'sickle'
    when p_text ~* 'heart failure|cardiac failure|\mchf\M' then 'hf'
    when p_text ~* 'cancer|carcinoma|lymphoma|leuk|tumou?r|oncolog' then 'cancer'
    when p_text ~* '\mhiv\M|\mplhiv\M|\mart\M' then 'hiv'
    when p_text ~* 'tubercul|\mtb\M' then 'tb'
    when p_text ~* 'depress|psych|bipolar|schizo|mental|anxiety' then 'mental'
    else null end
$$;

do $$
declare r record; v_enrol uuid; j jsonb; v_code text;
  num constant text := '^\s*([0-9]+(\.[0-9]+)?)';
begin
  if to_regclass('public.chronic_disease_records') is null then return; end if;
  for r in execute 'select * from public.chronic_disease_records order by visit_date nulls last' loop
    j := to_jsonb(r);
    continue when nullif(j->>'patient_id', '') is null or nullif(j->>'hospital_id', '') is null;
    continue when exists (select 1 from public.ncd_visits where legacy_record_id = j->>'id');
    continue when not exists (select 1 from public.patients p where p.id::text = j->>'patient_id');
    v_code := coalesce(public.ncd_condition_code(j->>'condition'), 'other_' || left(lower(regexp_replace(coalesce(j->>'condition', 'chronic'), '[^a-z0-9]+', '_', 'gi')), 40));
    select id into v_enrol from public.ncd_enrolments
     where hospital_id = (j->>'hospital_id')::uuid and patient_id = (j->>'patient_id')::uuid and condition_code = v_code
     order by created_at limit 1;
    if v_enrol is null then
      insert into public.ncd_enrolments(hospital_id, patient_id, condition_code, condition_label, enrolled_on, created_by)
      values ((j->>'hospital_id')::uuid, (j->>'patient_id')::uuid, v_code, coalesce(nullif(j->>'condition', ''), v_code),
              coalesce(nullif(j->>'visit_date', '')::date, (j->>'created_at')::date, current_date), null)
      returning id into v_enrol;
    end if;
    insert into public.ncd_visits(enrolment_id, hospital_id, patient_id, visit_date, bp_sys, bp_dia, hba1c, viral_load,
                                  medications, adherence, notes, legacy_record_id, recorded_by)
    values (v_enrol, (j->>'hospital_id')::uuid, (j->>'patient_id')::uuid,
            coalesce(nullif(j->>'visit_date', '')::date, (j->>'created_at')::date, current_date),
            nullif(j->>'bp_systolic', '')::numeric, nullif(j->>'bp_diastolic', '')::numeric,
            (substring(coalesce(j->>'hba1c', '') from num))::numeric,
            case when coalesce(j->>'viral_load', '') ~* 'ldl|undetect|tnd' then 0
                 else (substring(replace(coalesce(j->>'viral_load', ''), ',', '') from num))::numeric end,
            nullif(concat_ws(' | ', nullif(j->>'current_meds', ''), nullif(j->>'oral_meds', ''), nullif(j->>'arv_regimen', '')), ''),
            case when nullif(j->>'adherence_score', '') is null then null
                 when (j->>'adherence_score')::numeric >= 4 then 'good' when (j->>'adherence_score')::numeric >= 3 then 'fair' else 'poor' end,
            nullif(j->>'notes', ''), j->>'id', null);
  end loop;
end $$;

-- ---------------------------------------------------------------- security
alter table public.ncd_condition_config enable row level security;
alter table public.ncd_enrolments enable row level security;
alter table public.ncd_visits enable row level security;
alter table public.ncd_tracing_tasks enable row level security;
alter table public.ncd_tracing_attempts enable row level security;

drop policy if exists ncd_condition_config_read on public.ncd_condition_config;
create policy ncd_condition_config_read on public.ncd_condition_config for select
  using (hospital_id is null or public.pay_is_member(hospital_id));
drop policy if exists ncd_condition_config_write on public.ncd_condition_config;
create policy ncd_condition_config_write on public.ncd_condition_config for all
  using (hospital_id is not null and public.pay_canonical_role(public.pay_member_role(hospital_id)) = 'admin')
  with check (hospital_id is not null and public.pay_canonical_role(public.pay_member_role(hospital_id)) = 'admin');

do $$
declare t text;
begin
  foreach t in array array['ncd_enrolments', 'ncd_visits', 'ncd_tracing_tasks', 'ncd_tracing_attempts'] loop
    execute format('drop policy if exists %I on public.%I', t || '_member', t);
    execute format('create policy %I on public.%I for all using (public.pay_is_member(hospital_id)) with check (public.pay_is_member(hospital_id))', t || '_member', t);
  end loop;
end $$;

grant select, insert, update, delete on public.ncd_enrolments, public.ncd_visits, public.ncd_tracing_tasks,
  public.ncd_tracing_attempts, public.ncd_condition_config to authenticated;
grant all on public.ncd_enrolments, public.ncd_visits, public.ncd_tracing_tasks, public.ncd_tracing_attempts,
  public.ncd_condition_config to service_role;

revoke execute on function public.ncd_recall_sweep(date), public.ncd_refresh_enrolment(uuid) from public, anon, authenticated;
grant execute on function public.ncd_recall_sweep(date), public.ncd_refresh_enrolment(uuid) to service_role;
revoke execute on function public.ncd_summary(uuid), public.ncd_cohort(uuid, text, date, date, integer) from public, anon;
grant execute on function public.ncd_summary(uuid), public.ncd_cohort(uuid, text, date, date, integer) to authenticated, service_role;
grant execute on function public.ncd_evaluate(jsonb, jsonb), public.ncd_targets(uuid, text, jsonb) to authenticated, service_role;
