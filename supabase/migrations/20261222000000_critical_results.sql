-- =============================================================================
-- RemedacareHMS — critical results loop, drug–lab interaction alerts and therapeutic drug monitoring (TDM).
--   * Critical values (lab_analyte_rules critical limits) create an alert the moment a result is saved.
--     The lab records who it told, how, and that the value was READ BACK; a clinician (not the person who
--     phoned it) acknowledges with the action taken. Overdue alerts escalate (default: notify within 30 min,
--     acknowledge within 60 min). Accreditation standards (e.g. Joint Commission NPSG.02.03.01) require a
--     written protocol, a time frame and documentation of who was told — this is that protocol.
--   * Drug–lab rules: an abnormal result in a patient on a drug that causes or is endangered by it (e.g. high
--     potassium on an ACE inhibitor, low potassium on digoxin, rising creatinine on gentamicin / vancomycin /
--     metformin) creates an advisory alert naming the drug. Rules are data; hospitals can add their own.
--   * TDM: levels are interpreted against target ranges (common adult ranges from standard references —
--     hospitals should confirm against their own laboratory and formulary), with sample-timing checks, SI unit
--     conversion, eGFR (CKD-EPI 2021, race-free) and Cockcroft–Gault CrCl, deterministic advice text, and a
--     critical alert for toxic levels. The system does not calculate doses: a pharmacist or prescriber decides.
-- Requires 20261216000000_lab_quality.sql (lab_analyte_rules, lab_rules). Safe to re-run.
-- =============================================================================

-- ================================================================= settings
create table if not exists public.lab_critical_settings (
  hospital_id     uuid primary key,
  notify_minutes  integer not null default 30 check (notify_minutes between 5 and 240),
  ack_minutes     integer not null default 60 check (ack_minutes between 5 and 480),
  escalate_to     text not null default 'Ward in-charge and duty consultant',
  updated_at      timestamptz not null default now()
);

-- ================================================================= alerts
create table if not exists public.lab_critical_alerts (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  kind             text not null check (kind in ('critical', 'interaction', 'tdm')),
  lab_test_id      text,
  tdm_level_id     uuid,
  patient_id       uuid,
  patient_name     text,
  visit_id         text,
  test_name        text,
  analyte          text not null,
  value            numeric,
  unit             text,
  limit_text       text,
  message          text not null,
  drug_notes       jsonb not null default '[]'::jsonb,
  ordered_by       text,
  detected_at      timestamptz not null default now(),
  notify_due_at    timestamptz,
  notified_at      timestamptz,
  notified_to      text,
  notify_method    text check (notify_method in ('phone', 'in_person', 'system')),
  read_back        boolean,
  notified_by      uuid,
  ack_due_at       timestamptz,
  acknowledged_at  timestamptz,
  acknowledged_by  uuid,
  action_taken     text,
  escalation_level smallint not null default 0,
  escalated_at     timestamptz,
  status           text not null default 'open' check (status in ('open', 'notified', 'acknowledged')),
  created_at       timestamptz not null default now()
);
create unique index if not exists lab_critical_alerts_once on public.lab_critical_alerts(lab_test_id, analyte, kind) where lab_test_id is not null;
create unique index if not exists lab_critical_alerts_tdm_once on public.lab_critical_alerts(tdm_level_id) where tdm_level_id is not null;
create index if not exists lab_critical_alerts_open on public.lab_critical_alerts(hospital_id, status, detected_at);

-- ================================================================= drug–lab rules
create table if not exists public.lab_drug_rules (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid,
  analyte     text not null,                 -- lab_analyte_rules analyte key
  direction   text not null check (direction in ('high', 'low')),
  drug_regex  text not null,                 -- matched case-insensitively against the medicine name
  message     text not null,
  active      boolean not null default true
);
create unique index if not exists lab_drug_rules_key on public.lab_drug_rules(coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), analyte, direction, drug_regex);

insert into public.lab_drug_rules(hospital_id, analyte, direction, drug_regex, message) values
  (null, 'potassium', 'high', '(pril\y|sartan\y|spironolactone|eplerenone|amiloride|triamterene|aliskiren)', 'Raises potassium (RAAS blocker / potassium-sparing diuretic): review the dose, stop if K is critical'),
  (null, 'potassium', 'high', '(potassium chloride|\ykcl\y|slow-k|potassium citrate)', 'Potassium supplement: stop while potassium is high'),
  (null, 'potassium', 'high', '(trimethoprim|co-?trimoxazole|septrin|bactrim|sulfamethoxazole)', 'Trimethoprim raises potassium'),
  (null, 'potassium', 'high', '(heparin|enoxaparin|dalteparin)', 'Heparins can raise potassium (aldosterone suppression)'),
  (null, 'potassium', 'high', '(ciclosporin|cyclosporin|tacrolimus)', 'Calcineurin inhibitor raises potassium'),
  (null, 'potassium', 'high', '(ibuprofen|diclofenac|naproxen|indomethacin|meloxicam|celecoxib|ketorolac|aspirin)', 'NSAID raises potassium and worsens kidney function'),
  (null, 'potassium', 'low', '(digoxin)', 'Low potassium increases digoxin toxicity: correct potassium, consider a digoxin level and ECG'),
  (null, 'potassium', 'low', '(furosemide|frusemide|bumetanide|torsemide|hydrochlorothiazide|bendroflumethiazide|chlorthalidone|indapamide)', 'Diuretic lowers potassium'),
  (null, 'potassium', 'low', '(insulin|salbutamol|albuterol|amphotericin|prednisolone|dexamethasone|hydrocortisone)', 'Lowers potassium'),
  (null, 'sodium', 'low', '(carbamazepine|oxcarbazepine|fluoxetine|sertraline|citalopram|escitalopram|paroxetine|desmopressin)', 'Causes hyponatraemia (SIADH)'),
  (null, 'sodium', 'low', '(furosemide|frusemide|hydrochlorothiazide|bendroflumethiazide|chlorthalidone|indapamide)', 'Diuretic lowers sodium'),
  (null, 'creatinine', 'high', '(gentamicin|amikacin|tobramycin|streptomycin)', 'Aminoglycoside: nephrotoxic — check the level and extend the interval or stop'),
  (null, 'creatinine', 'high', '(vancomycin)', 'Vancomycin: nephrotoxic — check the level, review the dose'),
  (null, 'creatinine', 'high', '(metformin)', 'Metformin: risk of lactic acidosis — review (stop if eGFR < 30)'),
  (null, 'creatinine', 'high', '(ibuprofen|diclofenac|naproxen|indomethacin|meloxicam|celecoxib|ketorolac)', 'NSAID: nephrotoxic — stop'),
  (null, 'creatinine', 'high', '(pril\y|sartan\y)', 'ACE inhibitor / ARB: review in acute kidney injury'),
  (null, 'creatinine', 'high', '(tenofovir|\ytdf\y|\ytld\y|amphotericin|colistin|polymyxin|cisplatin|methotrexate|acyclovir|aciclovir)', 'Nephrotoxic drug: review the dose'),
  (null, 'creatinine', 'high', '(meropenem|imipenem|piperacillin|tazocin|cefepime|ceftazidime|enoxaparin|digoxin|lithium|levetiracetam|fluconazole|ciprofloxacin|levofloxacin)', 'Renally cleared: the dose may need adjusting'),
  (null, 'platelets', 'low', '(heparin|enoxaparin|dalteparin|fondaparinux)', 'Heparin: consider heparin-induced thrombocytopenia if platelets fell > 50 %'),
  (null, 'platelets', 'low', '(linezolid|valpro|co-?trimoxazole|septrin|carboplatin|cyclophosphamide)', 'Can lower platelets'),
  (null, 'wbc', 'low', '(clozapine|carbimazole|methimazole|propylthiouracil|carbamazepine|co-?trimoxazole|septrin|zidovudine|azathioprine|methotrexate|cyclophosphamide|mercaptopurine)', 'Can cause neutropenia / agranulocytosis: review and check the differential'),
  (null, 'haemoglobin', 'low', '(warfarin|heparin|enoxaparin|rivaroxaban|apixaban|dabigatran|aspirin|clopidogrel|ticagrelor)', 'Anticoagulant / antiplatelet: look for bleeding'),
  (null, 'haemoglobin', 'low', '(zidovudine|\yazt\y)', 'Zidovudine causes anaemia'),
  (null, 'alt', 'high', '(isoniazid|rifampicin|rifampin|pyrazinamide|\yrhze\y|\yrh\y)', 'Anti-TB drugs: hepatotoxic — stop if ALT > 3 x ULN with symptoms or > 5 x ULN'),
  (null, 'alt', 'high', '(nevirapine|efavirenz|\ytle\y|fluconazole|ketoconazole|valpro|methotrexate|statin|paracetamol|acetaminophen|amoxicillin-clavulan|augmentin)', 'Hepatotoxic drug: review'),
  (null, 'ast', 'high', '(isoniazid|rifampicin|rifampin|pyrazinamide|\yrhze\y)', 'Anti-TB drugs: hepatotoxic'),
  (null, 'bilirubin', 'high', '(rifampicin|rifampin|isoniazid|atazanavir|ceftriaxone)', 'Raises bilirubin')
on conflict do nothing;

-- ================================================================= helpers
create or replace function public.crit_uuid(p text)
returns uuid language sql immutable as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

/** eGFR, CKD-EPI 2021 (race-free), creatinine in µmol/L. */
create or replace function public.egfr_ckd_epi_2021(p_creatinine_umol numeric, p_age numeric, p_female boolean)
returns numeric language sql immutable as $$
  select case when p_creatinine_umol is null or p_creatinine_umol <= 0 or p_age is null or p_age < 18 then null else round((
    142 * power(least(p_creatinine_umol / 88.4 / case when p_female then 0.7 else 0.9 end, 1), case when p_female then -0.241 else -0.302 end)
        * power(greatest(p_creatinine_umol / 88.4 / case when p_female then 0.7 else 0.9 end, 1), -1.200)
        * power(0.9938, p_age) * case when p_female then 1.012 else 1 end)::numeric, 0) end
$$;

/** Creatinine clearance, Cockcroft–Gault (mL/min), creatinine in µmol/L, weight in kg. */
create or replace function public.crcl_cockcroft_gault(p_creatinine_umol numeric, p_age numeric, p_female boolean, p_weight_kg numeric)
returns numeric language sql immutable as $$
  select case when p_creatinine_umol is null or p_creatinine_umol <= 0 or p_age is null or p_weight_kg is null then null
              else round(((140 - p_age) * p_weight_kg * case when p_female then 0.85 else 1 end / (72 * p_creatinine_umol / 88.4))::numeric, 0) end
$$;

create or replace function public.crit_settings(p_hospital uuid)
returns public.lab_critical_settings language sql stable security definer set search_path = public as $$
  select coalesce((select s from public.lab_critical_settings s where s.hospital_id = p_hospital),
                  row(p_hospital, 30, 60, 'Ward in-charge and duty consultant', now())::public.lab_critical_settings)
$$;

/** Active medicines matching drug–lab rules for one analyte / direction. */
create or replace function public.crit_drug_notes(p_hospital uuid, p_patient uuid, p_analyte text, p_direction text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '[]'::jsonb;
begin
  if p_patient is null or to_regclass('public.patient_medications') is null then return v; end if;
  execute $q$
    select coalesce(jsonb_agg(distinct jsonb_build_object('drug', m.drug, 'message', r.message)), '[]'::jsonb)
      from public.patient_medications m
      join public.lab_drug_rules r on r.active and r.analyte = $3 and r.direction = $4 and (r.hospital_id is null or r.hospital_id = $1)
                                  and lower(m.drug) ~ r.drug_regex
     where m.hospital_id = $1 and m.patient_id = $2 and m.status = 'active'$q$
    into v using p_hospital, p_patient, p_analyte, p_direction;
  return v;
end $$;

-- ================================================================= detection on lab results
create or replace function public.lab_tests_critical()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); hosp uuid := public.crit_uuid(j->>'hospital_id'); pat uuid := public.crit_uuid(j->>'patient_id');
        rr public.lab_analyte_rules; v numeric; st public.lab_critical_settings; notes jsonb; dir text; crit boolean; msg text; n int := 0;
begin
  if hosp is null or new.result_json is null or new.result_template_key is null then return null; end if;
  if tg_op = 'UPDATE' and new.result_json is not distinct from old.result_json then return null; end if;
  st := public.crit_settings(hosp);
  for rr in select * from public.lab_rules(hosp, new.result_template_key) loop
    v := public.lab_num(new.result_json->>rr.analyte);
    if v is null then continue; end if;
    crit := (rr.critical_low is not null and v <= rr.critical_low) or (rr.critical_high is not null and v >= rr.critical_high);
    dir := case when (rr.critical_low is not null and v <= rr.critical_low) or (rr.low is not null and v < rr.low) then 'low'
                when (rr.critical_high is not null and v >= rr.critical_high) or (rr.high is not null and v > rr.high) then 'high' end;
    if dir is null then continue; end if;
    notes := public.crit_drug_notes(hosp, pat, rr.analyte, dir);
    if crit then
      msg := initcap(rr.analyte) || ' ' || v || ' is critically ' || dir || ' (critical ' || case when dir = 'low' then '≤ ' || rr.critical_low else '≥ ' || rr.critical_high end || ')';
      insert into public.lab_critical_alerts(hospital_id, kind, lab_test_id, patient_id, patient_name, visit_id, test_name, analyte, value, limit_text, message, drug_notes, ordered_by, notify_due_at, ack_due_at)
      values (hosp, 'critical', new.id::text, pat, j->>'patient_name', j->>'visit_id', j->>'test_type', rr.analyte, v,
              case when dir = 'low' then '≤ ' || rr.critical_low else '≥ ' || rr.critical_high end, msg, notes, j->>'ordered_by',
              now() + make_interval(mins => st.notify_minutes), now() + make_interval(mins => st.ack_minutes))
      on conflict do nothing;
      n := n + 1;
    elsif jsonb_array_length(notes) > 0 then
      insert into public.lab_critical_alerts(hospital_id, kind, lab_test_id, patient_id, patient_name, visit_id, test_name, analyte, value, limit_text, message, drug_notes, ordered_by, ack_due_at)
      values (hosp, 'interaction', new.id::text, pat, j->>'patient_name', j->>'visit_id', j->>'test_type', rr.analyte, v,
              case when dir = 'low' then '< ' || rr.low else '> ' || rr.high end,
              initcap(rr.analyte) || ' ' || v || ' is ' || dir || ' in a patient taking ' || (select string_agg(distinct x->>'drug', ', ') from jsonb_array_elements(notes) x),
              notes, j->>'ordered_by', now() + make_interval(mins => st.ack_minutes * 4))
      on conflict do nothing;
    end if;
  end loop;
  if n > 0 then
    begin
      execute 'insert into public.notifications(hospital_id, notification_type, title, message, target_path, payload_json) values ($1, ''alert'', $2, $3, ''/critical-results'', $4)'
        using hosp, 'Critical result: ' || coalesce(j->>'patient_name', 'patient'), coalesce(j->>'test_type', 'Laboratory result') || ' — notify the clinician and record read-back',
              jsonb_build_object('lab_test_id', new.id, 'patient_id', pat);
    exception when others then null;
    end;
  end if;
  return null;
exception when others then
  raise warning 'critical result check skipped: %', sqlerrm;   -- never block saving a result
  return null;
end $$;
drop trigger if exists trg_lab_tests_critical on public.lab_tests;
create trigger trg_lab_tests_critical after insert or update on public.lab_tests for each row execute function public.lab_tests_critical();

-- ================================================================= notify / acknowledge / escalate
create or replace function public.critical_notify(p_alert uuid, p_notified_to text, p_method text, p_read_back boolean)
returns public.lab_critical_alerts language plpgsql security definer set search_path = public as $$
declare a public.lab_critical_alerts;
begin
  select * into a from public.lab_critical_alerts where id = p_alert for update;
  if a.id is null then raise exception 'Alert not found'; end if;
  if not public.clin_can_access(a.hospital_id) then raise exception 'Clinical or laboratory staff only'; end if;
  if a.status = 'acknowledged' then raise exception 'Already acknowledged'; end if;
  if coalesce(trim(p_notified_to), '') = '' then raise exception 'Record the name of the clinician or nurse you told'; end if;
  if p_method not in ('phone', 'in_person', 'system') then raise exception 'Choose how they were told'; end if;
  if p_method in ('phone', 'in_person') and not coalesce(p_read_back, false) then
    raise exception 'The person receiving a verbal critical result must read it back; confirm read-back before saving';
  end if;
  update public.lab_critical_alerts set notified_at = now(), notified_to = trim(p_notified_to), notify_method = p_method, read_back = coalesce(p_read_back, false),
         notified_by = auth.uid(), status = 'notified'
   where id = p_alert returning * into a;
  return a;
end $$;

create or replace function public.critical_acknowledge(p_alert uuid, p_action text)
returns public.lab_critical_alerts language plpgsql security definer set search_path = public as $$
declare a public.lab_critical_alerts;
begin
  select * into a from public.lab_critical_alerts where id = p_alert for update;
  if a.id is null then raise exception 'Alert not found'; end if;
  if not public.clin_can_access(a.hospital_id) then raise exception 'Clinical staff only'; end if;
  if a.status = 'acknowledged' then raise exception 'Already acknowledged'; end if;
  if coalesce(trim(p_action), '') = '' then raise exception 'Record the action taken (e.g. repeat test, treatment given, dose held, reviewed — no change)'; end if;
  if a.notified_by is not null and a.notified_by = auth.uid() then
    raise exception 'The clinician who received the result acknowledges it, not the person who reported it';
  end if;
  update public.lab_critical_alerts set acknowledged_at = now(), acknowledged_by = auth.uid(), action_taken = trim(p_action), status = 'acknowledged'
   where id = p_alert returning * into a;
  return a;
end $$;

/** Escalate overdue alerts (called by the board and, when pg_cron is available, every 5 minutes). */
create or replace function public.critical_escalate(p_hospital uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare a record; n int := 0;
begin
  if auth.uid() is not null and (p_hospital is null or not public.clin_can_access(p_hospital)) then raise exception 'Clinical staff only'; end if;   -- all hospitals: scheduler only
  for a in select * from public.lab_critical_alerts
            where (p_hospital is null or hospital_id = p_hospital) and status <> 'acknowledged' and kind in ('critical', 'tdm') and escalation_level < 3
              and ((status = 'open' and notify_due_at < now()) or (status = 'notified' and ack_due_at < now()))
              and (escalated_at is null or escalated_at < now() - interval '30 minutes')
            for update skip locked loop
    update public.lab_critical_alerts set escalation_level = escalation_level + 1, escalated_at = now() where id = a.id;
    begin
      execute 'insert into public.notifications(hospital_id, notification_type, title, message, target_path, payload_json) values ($1, ''alert'', $2, $3, ''/critical-results'', $4)'
        using a.hospital_id, 'ESCALATION ' || (a.escalation_level + 1) || ': critical result ' || case when a.status = 'open' then 'not yet reported' else 'not acknowledged' end,
              coalesce(a.patient_name, 'Patient') || ' — ' || a.message || '. Inform ' || (public.crit_settings(a.hospital_id)).escalate_to,
              jsonb_build_object('alert_id', a.id, 'level', a.escalation_level + 1);
    exception when others then null;
    end;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.critical_stats(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Clinical staff only'; end if;
  with a as (
    select *, extract(epoch from notified_at - detected_at) / 60 as to_notify, extract(epoch from acknowledged_at - detected_at) / 60 as to_ack
      from public.lab_critical_alerts where hospital_id = p_hospital and kind in ('critical', 'tdm') and detected_at >= p_from and detected_at < p_to + 1
  )
  select jsonb_build_object(
    'critical', count(*), 'acknowledged', count(*) filter (where status = 'acknowledged'), 'open', count(*) filter (where status <> 'acknowledged'),
    'read_back_pct', round(100.0 * count(*) filter (where read_back) / nullif(count(*) filter (where notify_method in ('phone', 'in_person')), 0)),
    'median_minutes_to_notify', round((percentile_cont(0.5) within group (order by to_notify))::numeric, 0),
    'median_minutes_to_acknowledge', round((percentile_cont(0.5) within group (order by to_ack))::numeric, 0),
    'notified_on_time_pct', round(100.0 * count(*) filter (where notified_at <= notify_due_at) / nullif(count(*) filter (where notified_at is not null), 0)),
    'acknowledged_on_time_pct', round(100.0 * count(*) filter (where acknowledged_at <= ack_due_at) / nullif(count(*) filter (where acknowledged_at is not null), 0)),
    'escalated', count(*) filter (where escalation_level > 0),
    'by_analyte', (select coalesce(jsonb_object_agg(analyte, c), '{}') from (select analyte, count(*) c from a group by 1) x))
    into r from a;
  return r;
end $$;

-- ================================================================= TDM
create table if not exists public.tdm_targets (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid,
  drug           text not null,
  sample         text not null check (sample in ('trough', 'peak', 'random', 'auc')),
  indication     text not null default 'general',
  low            numeric,
  high           numeric,
  high_exclusive boolean not null default false,   -- "< 2" style targets: a value equal to high is already too high
  critical_high  numeric,
  unit           text not null,
  si_unit        text,
  si_factor      numeric,                          -- multiply an SI value by this to get the target unit
  min_hours_after_dose numeric,
  max_hours_after_dose numeric,
  advice_low     text,
  advice_high    text,
  note           text,
  active         boolean not null default true
);
create unique index if not exists tdm_targets_key on public.tdm_targets(coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), drug, sample, indication);

insert into public.tdm_targets(hospital_id, drug, sample, indication, low, high, high_exclusive, critical_high, unit, si_unit, si_factor, min_hours_after_dose, max_hours_after_dose, advice_low, advice_high, note) values
  (null, 'Gentamicin', 'trough', 'traditional dosing', null, 2, true, 2, 'mg/L', null, null, null, null, null,
   'Trough too high: hold the next dose, repeat the level, extend the interval; check creatinine and hearing', 'Draw just before the next dose (within 30 min)'),
  (null, 'Gentamicin', 'peak', 'traditional dosing', 5, 10, false, null, 'mg/L', null, null, 0.5, 1.5,
   'Peak low: the dose may be too small for the infection', 'Peak high: reduce the dose', 'Draw 30 min after a 30-min infusion ends'),
  (null, 'Tobramycin', 'trough', 'traditional dosing', null, 2, true, 2, 'mg/L', null, null, null, null, null,
   'Trough too high: hold the next dose, repeat the level, extend the interval; check creatinine', 'Draw just before the next dose'),
  (null, 'Tobramycin', 'peak', 'traditional dosing', 5, 10, false, null, 'mg/L', null, null, 0.5, 1.5, 'Peak low: dose may be too small', 'Peak high: reduce the dose', null),
  (null, 'Vancomycin', 'trough', 'serious infection', 15, 20, false, 20, 'mg/L', 'µmol/L', 1.449, null, null,
   'Trough low: check timing and adherence, then increase the dose (AUC-guided dosing preferred)', 'Trough high: hold / reduce the dose, check creatinine; AUC/MIC 400–600 is the preferred target',
   'Serious infections (pneumonia, endocarditis, osteomyelitis, meningitis, bacteraemia)'),
  (null, 'Vancomycin', 'trough', 'other infection', 10, 15, false, 20, 'mg/L', 'µmol/L', 1.449, null, null, 'Trough low: review the dose', 'Trough high: reduce the dose, check creatinine', null),
  (null, 'Vancomycin', 'auc', 'serious infection', 400, 600, false, null, 'mg·h/L', null, null, null, null, 'AUC low: increase the dose', 'AUC high: reduce the dose (nephrotoxicity)', 'AUC/MIC with MIC 1 mg/L'),
  (null, 'Digoxin', 'random', 'atrial fibrillation', 0.8, 2, false, 2, 'µg/L', 'nmol/L', 0.781, 6, null,
   'Level low: check adherence before increasing', 'Level high: hold digoxin, check potassium, renal function and ECG', 'Draw at least 6 h after the dose (same as ng/mL)'),
  (null, 'Digoxin', 'random', 'heart failure', 0.5, 0.9, false, 2, 'µg/L', 'nmol/L', 0.781, 6, null,
   'Level low: check adherence', 'Level above the heart-failure range: reduce the dose; hold if symptoms, check potassium and ECG', 'Draw at least 6 h after the dose'),
  (null, 'Lithium', 'trough', 'general', 0.6, 1.2, false, 1.5, 'mmol/L', null, null, 10, 14,
   'Level low: check adherence', 'Level high: hold lithium, check sodium, creatinine and for toxicity (tremor, confusion, vomiting)', 'Draw 12 h after the last dose; up to 1.5 mmol/L may be used for acute symptoms'),
  (null, 'Phenytoin', 'trough', 'general', 10, 20, false, 30, 'mg/L', 'µmol/L', 0.2523, null, null,
   'Level low: check adherence; correct for low albumin before increasing', 'Level high: reduce the dose (small increases raise levels sharply); look for nystagmus and ataxia', 'Correct the level when albumin is low'),
  (null, 'Phenytoin (free)', 'trough', 'general', 1, 2, false, 3, 'mg/L', null, null, null, null, 'Free level low: review the dose', 'Free level high: reduce the dose', null),
  (null, 'Carbamazepine', 'trough', 'general', 4, 12, false, 15, 'mg/L', 'µmol/L', 0.2363, null, null, 'Level low: check adherence (autoinduction in the first weeks)', 'Level high: reduce the dose; check sodium and full blood count', null),
  (null, 'Valproic acid', 'trough', 'general', 50, 100, false, 150, 'mg/L', 'µmol/L', 0.1442, null, null, 'Level low: check adherence', 'Level high: reduce the dose; check ammonia, LFTs and platelets', 'Up to 150 mg/L in some patients'),
  (null, 'Theophylline', 'random', 'general', 5, 15, false, 20, 'mg/L', 'µmol/L', 0.1802, null, null, 'Level low: review the dose', 'Level high: hold / reduce; risk of arrhythmia and seizures', null)
on conflict do nothing;

create table if not exists public.tdm_levels (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null,
  patient_id      uuid not null,
  visit_id        text,
  drug            text not null,
  sample          text not null check (sample in ('trough', 'peak', 'random', 'auc')),
  indication      text not null default 'general',
  value           numeric not null check (value >= 0),
  unit            text not null,
  value_target_unit numeric,
  target_id       uuid,
  target_text     text,
  last_dose_at    timestamptz,
  next_dose_at    timestamptz,
  sample_at       timestamptz not null default now(),
  dose_text       text,
  interpretation  text check (interpretation in ('subtherapeutic', 'therapeutic', 'supratherapeutic', 'toxic', 'no_target')),
  advice          text,
  warnings        text[] not null default '{}',
  creatinine_umol numeric,
  egfr            numeric,
  crcl            numeric,
  weight_kg       numeric,
  recorded_by     uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists tdm_levels_patient on public.tdm_levels(patient_id, drug, sample_at desc);

/** low / therapeutic / high / toxic for a value already in the target unit. */
create or replace function public.tdm_classify(p_value numeric, p_low numeric, p_high numeric, p_high_exclusive boolean, p_critical numeric)
returns text language sql immutable as $$
  select case
    when p_value is null then null
    when p_critical is not null and (p_value > p_critical or (p_high_exclusive and p_value >= p_critical)) then 'toxic'
    when p_high is not null and (p_value > p_high or (p_high_exclusive and p_value >= p_high)) then 'supratherapeutic'
    when p_low is not null and p_value < p_low then 'subtherapeutic'
    else 'therapeutic' end
$$;

create or replace function public.tdm_levels_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.tdm_targets; pj jsonb; age numeric; female boolean; cr numeric; hrs numeric; w text[] := '{}';
begin
  if new.sample_at > now() + interval '5 minutes' then raise exception 'The sample time cannot be in the future'; end if;
  select * into t from public.tdm_targets
   where active and lower(drug) = lower(trim(new.drug)) and sample = new.sample and (hospital_id = new.hospital_id or hospital_id is null)
   order by (hospital_id is null), (indication = new.indication) desc, (indication = 'general') desc limit 1;
  new.target_id := t.id;
  if t.id is null then
    new.interpretation := 'no_target'; new.value_target_unit := new.value; new.advice := 'No target range set for this drug and sample: interpret with the pharmacist';
  else
    new.indication := t.indication;
    new.value_target_unit := case when lower(new.unit) = lower(t.unit) or (t.unit = 'µg/L' and lower(new.unit) in ('ng/ml', 'ug/l', 'mcg/l'))
                                    or (t.unit = 'mg/L' and lower(new.unit) in ('mcg/ml', 'ug/ml', 'µg/ml')) or (t.unit = 'mmol/L' and lower(new.unit) in ('meq/l')) then new.value
                                  when t.si_unit is not null and lower(new.unit) = lower(t.si_unit) then round(new.value * t.si_factor, 2) end;
    if new.value_target_unit is null then raise exception 'Enter % in % % — % is not recognised', t.drug, t.unit, coalesce('or ' || t.si_unit, ''), new.unit; end if;
    new.interpretation := public.tdm_classify(new.value_target_unit, t.low, t.high, t.high_exclusive, t.critical_high);
    new.target_text := t.drug || ' ' || t.sample || ' (' || t.indication || '): ' ||
                       case when t.low is null then '< ' || t.high else t.low || '–' || t.high end || ' ' || t.unit;
    new.advice := case new.interpretation when 'subtherapeutic' then t.advice_low when 'therapeutic' then 'Within the target range' else t.advice_high end;
    -- sample timing
    if new.last_dose_at is not null then
      hrs := extract(epoch from new.sample_at - new.last_dose_at) / 3600;
      if hrs < 0 then w := w || 'The sample is recorded before the last dose'::text; end if;
      if t.min_hours_after_dose is not null and hrs >= 0 and hrs < t.min_hours_after_dose then
        w := w || format('Drawn %s h after the dose; this level needs at least %s h — it may read falsely high', round(hrs, 1), t.min_hours_after_dose);
      end if;
      if t.max_hours_after_dose is not null and hrs > t.max_hours_after_dose then
        w := w || format('Drawn %s h after the dose; expected within %s h', round(hrs, 1), t.max_hours_after_dose);
      end if;
    end if;
    if new.sample = 'trough' and new.next_dose_at is not null then
      if new.sample_at > new.next_dose_at then w := w || 'Trough drawn after the next dose was due: confirm the dose was not given before the sample'::text;
      elsif new.next_dose_at - new.sample_at > interval '60 minutes' then w := w || 'Trough drawn more than 1 h before the next dose: it may read falsely high'::text; end if;
    end if;
    if new.interpretation in ('supratherapeutic', 'toxic') and cardinality(w) > 0 then
      new.advice := new.advice || ' — but check the sample timing first';
    end if;
  end if;
  -- renal function from the latest creatinine
  begin
    execute 'select public.lab_num(l.result_json->>''creatinine'') from public.lab_tests l
              where l.patient_id::text = $1 and l.result_json ? ''creatinine'' order by coalesce(l.results_ready_at, l.resulted_at, l.created_at) desc limit 1'
      into cr using new.patient_id::text;
  exception when others then cr := null;
  end;
  select to_jsonb(p) into pj from public.patients p where p.id = new.patient_id;
  age := coalesce(case when pj->>'date_of_birth' is not null then extract(year from age(current_date, (pj->>'date_of_birth')::date)) end,
                  nullif(substring(coalesce(pj->>'age', '') from '^\s*([0-9]+)'), '')::numeric);
  female := lower(coalesce(pj->>'gender', pj->>'sex', '')) like 'f%';
  new.creatinine_umol := coalesce(new.creatinine_umol, cr);
  new.egfr := public.egfr_ckd_epi_2021(new.creatinine_umol, age, female);
  new.crcl := public.crcl_cockcroft_gault(new.creatinine_umol, age, female, new.weight_kg);
  if new.creatinine_umol is null and lower(new.drug) ~ '(gentamicin|tobramycin|amikacin|vancomycin|digoxin|lithium)' then
    w := w || 'No creatinine on record: check renal function'::text;
  end if;
  new.warnings := w;
  return new;
end $$;
drop trigger if exists trg_tdm_levels_before on public.tdm_levels;
create trigger trg_tdm_levels_before before insert or update on public.tdm_levels for each row execute function public.tdm_levels_before();

create or replace function public.tdm_levels_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare st public.lab_critical_settings; pname text;
begin
  if new.interpretation <> 'toxic' then return null; end if;
  st := public.crit_settings(new.hospital_id);
  select full_name into pname from public.patients where id = new.patient_id;
  insert into public.lab_critical_alerts(hospital_id, kind, tdm_level_id, patient_id, patient_name, visit_id, test_name, analyte, value, unit, limit_text, message, notify_due_at, ack_due_at,
                                         notified_at, notify_method, read_back, notified_by, status)
  values (new.hospital_id, 'tdm', new.id, new.patient_id, pname, new.visit_id, new.drug || ' level', lower(new.drug), new.value_target_unit,
          (select unit from public.tdm_targets where id = new.target_id), '> ' || (select critical_high from public.tdm_targets where id = new.target_id),
          new.drug || ' ' || new.sample || ' ' || new.value_target_unit || ' is in the toxic range. ' || coalesce(new.advice, ''),
          now(), now() + make_interval(mins => st.ack_minutes), now(), 'system', null, new.recorded_by, 'notified')
  on conflict do nothing;
  return null;
end $$;
drop trigger if exists trg_tdm_levels_after on public.tdm_levels;
create trigger trg_tdm_levels_after after insert on public.tdm_levels for each row execute function public.tdm_levels_after();

-- ================================================================= pg_cron escalation (when the extension is installed)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('critical-results-escalation');
    exception when others then null;
    end;
    perform cron.schedule('critical-results-escalation', '*/5 * * * *', 'select public.critical_escalate(null)');
  end if;
exception when others then raise notice 'pg_cron schedule not created (%); the board escalates on refresh', sqlerrm;
end $$;

-- ================================================================= security
alter table public.lab_critical_settings enable row level security;
alter table public.lab_critical_alerts enable row level security;
alter table public.lab_drug_rules enable row level security;
alter table public.tdm_targets enable row level security;
alter table public.tdm_levels enable row level security;
drop policy if exists lab_critical_settings_rw on public.lab_critical_settings;
drop policy if exists lab_critical_alerts_read on public.lab_critical_alerts;
drop policy if exists lab_drug_rules_read on public.lab_drug_rules;
drop policy if exists lab_drug_rules_write on public.lab_drug_rules;
drop policy if exists tdm_targets_read on public.tdm_targets;
drop policy if exists tdm_targets_write on public.tdm_targets;
drop policy if exists tdm_levels_clinical on public.tdm_levels;
create policy lab_critical_settings_rw on public.lab_critical_settings for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
create policy lab_critical_alerts_read on public.lab_critical_alerts for select to authenticated using (public.clin_can_access(hospital_id));
create policy lab_drug_rules_read on public.lab_drug_rules for select to authenticated using (hospital_id is null or public.clin_can_access(hospital_id));
create policy lab_drug_rules_write on public.lab_drug_rules for all to authenticated using (hospital_id is not null and public.clin_can_access(hospital_id)) with check (hospital_id is not null and public.clin_can_access(hospital_id));
create policy tdm_targets_read on public.tdm_targets for select to authenticated using (hospital_id is null or public.clin_can_access(hospital_id));
create policy tdm_targets_write on public.tdm_targets for all to authenticated using (hospital_id is not null and public.clin_can_access(hospital_id)) with check (hospital_id is not null and public.clin_can_access(hospital_id));
create policy tdm_levels_clinical on public.tdm_levels for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
revoke all on public.lab_critical_settings, public.lab_critical_alerts, public.lab_drug_rules, public.tdm_targets, public.tdm_levels from anon;
grant select on public.lab_critical_alerts to authenticated;          -- alerts change only through critical_notify / critical_acknowledge
grant select, insert, update on public.lab_critical_settings, public.lab_drug_rules, public.tdm_targets to authenticated;
grant select, insert on public.tdm_levels to authenticated;            -- a level is a record: correct it by entering a new one
grant all on public.lab_critical_settings, public.lab_critical_alerts, public.lab_drug_rules, public.tdm_targets, public.tdm_levels to service_role;

revoke execute on function public.lab_tests_critical(), public.tdm_levels_before(), public.tdm_levels_after(), public.crit_drug_notes(uuid, uuid, text, text),
  public.crit_settings(uuid) from public, anon, authenticated;
revoke execute on function public.critical_notify(uuid, text, text, boolean), public.critical_acknowledge(uuid, text), public.critical_escalate(uuid),
  public.critical_stats(uuid, date, date) from public, anon;
grant execute on function public.critical_notify(uuid, text, text, boolean), public.critical_acknowledge(uuid, text), public.critical_escalate(uuid),
  public.critical_stats(uuid, date, date), public.egfr_ckd_epi_2021(numeric, numeric, boolean), public.crcl_cockcroft_gault(numeric, numeric, boolean, numeric),
  public.tdm_classify(numeric, numeric, numeric, boolean, numeric) to authenticated, service_role;
