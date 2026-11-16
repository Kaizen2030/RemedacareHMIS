-- =============================================================================
-- RemedacareHMS - MOH REPORTS 711 / 710 / 731 / 717, KHIS EXPORT AND REPORT SCHEDULES
-- Generated from supabase/migrations/20261121000000_moh_reports.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.clin_can_access(uuid)') is null then
    raise exception 'Run 08_hiv_tb_maternity.sql first. Nothing was changed.';
  end if;
end $$;

create or replace function public.rpt_patient_sex(p_patient uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when lower(coalesce(to_jsonb(p)->>'gender', to_jsonb(p)->>'sex', '')) like 'f%' then 'F'
              when lower(coalesce(to_jsonb(p)->>'gender', to_jsonb(p)->>'sex', '')) like 'm%' then 'M' else 'U' end
    from public.patients p where p.id = p_patient
$$;

create or replace function public.rpt_band(p_age numeric, p_scheme text)
returns text language sql immutable as $$
  select case
    when p_age is null then 'unknown age'
    when p_scheme = '711' then case when p_age < 15 then '10-14' when p_age < 20 then '15-19' when p_age < 25 then '20-24' else '25+' end
    when p_scheme = '710' then case when p_age < 1 then 'under 1' else '1 year+' end
    when p_scheme = '717' then case when p_age < 5 then 'under 5' when p_age < 60 then '5-59' else '60+' end
    when p_scheme = '731' then case when p_age < 1 then '<1' when p_age < 5 then '1-4' when p_age < 10 then '5-9' when p_age < 15 then '10-14'
      when p_age < 20 then '15-19' when p_age < 25 then '20-24' when p_age < 30 then '25-29' when p_age < 35 then '30-34' when p_age < 40 then '35-39'
      when p_age < 45 then '40-44' when p_age < 50 then '45-49' else '50+' end
    else 'all' end
$$;

create or replace function public.moh_report(p_hospital uuid, p_form text, p_from date, p_to date)
returns table(section text, indicator text, disaggregation text, value bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.clin_can_access(p_hospital) then raise exception 'Clinical access required'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid period'; end if;

  if p_form = '711' then
    return query
    with c as (select ac.*, ap.patient_id, ap.hiv_status, ap.syphilis, public.clin_patient_age(ap.patient_id, ac.visit_date) as age
                 from public.anc_contacts ac join public.anc_pregnancies ap on ap.id = ac.pregnancy_id
                where ap.hospital_id = p_hospital and ac.visit_date between p_from and p_to)
    select 'ANC', 'New ANC clients (1st contact)', public.rpt_band(age, '711'), count(*) from c where contact_number = 1 group by 3
    union all select 'ANC', 'ANC revisits', 'all', count(*) from c where contact_number > 1
    union all select 'ANC', '1st contact before 12 weeks', 'all', count(*) from c where contact_number = 1 and ga_weeks <= 12
    union all select 'ANC', 'Clients with 4th contact', 'all', count(*) from c where contact_number = 4
    union all select 'ANC', 'Clients with 8th contact', 'all', count(*) from c where contact_number = 8
    union all select 'ANC', 'IPTp-SP dose ' || iptp_dose, 'all', count(*) from c where iptp_dose between 1 and 3 group by iptp_dose
    union all select 'ANC', 'Td dose ' || td_dose, 'all', count(*) from c where td_dose is not null group by td_dose
    union all select 'ANC', 'Given IFAS', 'all', count(*) from c where ifas_given
    union all select 'ANC', 'Given LLIN (mosquito net)', 'all', count(*) from c where llin_given and contact_number = 1
    union all select 'ANC', 'Anaemic (Hb < 11)', 'all', count(*) from c where hb < 11
    union all select 'ANC', 'Syphilis positive (new clients)', 'all', count(*) from c where contact_number = 1 and syphilis = 'positive'
    union all select 'ANC', 'HIV positive (new clients)', 'all', count(*) from c where contact_number = 1 and hiv_status in ('positive', 'known_positive')
    union all
    (with d as (select dl.*, public.clin_patient_age(dl.patient_id, dl.delivered_at::date) as age from public.deliveries dl
                 where dl.hospital_id = p_hospital and dl.delivered_at::date between p_from and p_to)
     select 'Maternity', 'Deliveries — ' || case mode when 'svd' then 'normal (SVD)' when 'assisted_vaginal' then 'assisted vaginal' when 'breech' then 'breech' else 'caesarean section' end, 'all', count(*) from d group by mode
     union all select 'Maternity', 'Deliveries', public.rpt_band(age, '711'), count(*) from d group by 3
     union all select 'Maternity', 'AMTSL (oxytocin within 1 minute)', 'all', count(*) from d where amtsl_oxytocin
     union all select 'Maternity', 'Postpartum haemorrhage (≥ 500 ml)', 'all', count(*) from d where blood_loss_ml >= 500
     union all select 'Maternity', 'Maternal deaths', 'all', count(*) from d where maternal_outcome = 'died')
    union all
    (with n as (select nb.* from public.newborns nb join public.deliveries dl on dl.id = nb.delivery_id
                 where dl.hospital_id = p_hospital and dl.delivered_at::date between p_from and p_to)
     select 'Newborn', case outcome when 'live_birth' then 'Live births' when 'fresh_stillbirth' then 'Fresh stillbirths'
                            when 'macerated_stillbirth' then 'Macerated stillbirths' else 'Early neonatal deaths' end, 'all', count(*) from n group by outcome
     union all select 'Newborn', 'Low birth weight (< 2500 g)', 'all', count(*) from n where outcome = 'live_birth' and birth_weight_g < 2500
     union all select 'Newborn', 'Breastfed within 1 hour', 'all', count(*) from n where breastfed_1h
     union all select 'Newborn', 'Given vitamin K', 'all', count(*) from n where vitamin_k
     union all select 'Newborn', 'Given TEO', 'all', count(*) from n where teo
     union all select 'Newborn', 'Resuscitated', 'all', count(*) from n where resuscitated)
    union all
    select 'Postnatal', 'PNC visits — ' || coalesce(timing, 'other'), 'all', count(*) from public.pnc_visits
     where hospital_id = p_hospital and visit_date between p_from and p_to group by timing
    union all
    select 'Postnatal', 'Family planning started at PNC', 'all', count(*) from public.pnc_visits
     where hospital_id = p_hospital and visit_date between p_from and p_to and nullif(trim(coalesce(fp_method, '')), '') is not null;

  elsif p_form = '710' then
    return query
    with i as (select im.*, public.clin_patient_age(im.patient_id, im.given_on) as age from public.immunisations im
                where im.hospital_id = p_hospital and im.given_on between p_from and p_to)
    select 'Immunisation', vaccine, public.rpt_band(age, '710'), count(*) from i group by 2, 3
    union all
    select 'Immunisation', 'Fully immunised child (MR1 + BCG, OPV3, Penta3, PCV3 by 1 year)', 'under 1', count(*)
      from i where vaccine = 'MR1' and age < 1
       and (select count(distinct x.vaccine) from public.immunisations x where x.patient_id = i.patient_id and x.vaccine in ('BCG', 'OPV3', 'PENTA3', 'PCV3')) = 4;

  elsif p_form = '731' then
    return query
    select 'HIV treatment', 'Started ART (TX_NEW)', public.rpt_band(public.clin_patient_age(a.patient_id, a.art_start_date), '731') || ' ' || public.rpt_patient_sex(a.patient_id), count(*)
      from public.hiv_art a where a.hospital_id = p_hospital and a.art_start_date between p_from and p_to group by 3
    union all
    select 'HIV treatment', 'Currently on ART (TX_CURR)', public.rpt_band(public.clin_patient_age(a.patient_id, p_to), '731') || ' ' || public.rpt_patient_sex(a.patient_id), count(*)
      from public.hiv_art a where a.hospital_id = p_hospital and a.status = 'active' and a.art_start_date <= p_to group by 3
    union all select 'Viral load', 'VL result in last 12 months (TX_PVLS D)', 'all', count(*) from public.hiv_art a
      where a.hospital_id = p_hospital and a.status = 'active' and a.last_vl_date > p_to - 365
    union all select 'Viral load', 'Suppressed < 200 copies (TX_PVLS N)', 'all', count(*) from public.hiv_art a
      where a.hospital_id = p_hospital and a.status = 'active' and a.last_vl_date > p_to - 365 and a.last_vl_value < 200
    union all select 'Viral load', 'LDL < 50 copies', 'all', count(*) from public.hiv_art a
      where a.hospital_id = p_hospital and a.status = 'active' and a.last_vl_date > p_to - 365 and a.last_vl_value < 50
    union all select 'HIV treatment', 'Lost to follow-up', 'all', count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.status = 'ltfu' and a.status_date between p_from and p_to
    union all select 'HIV treatment', 'Died', 'all', count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.status = 'died' and a.status_date between p_from and p_to
    union all select 'HIV treatment', 'Transferred out', 'all', count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.status = 'transferred_out' and a.status_date between p_from and p_to
    union all select 'TB preventive therapy', 'Started TPT', 'all', count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.tpt_start between p_from and p_to
    union all select 'TB preventive therapy', 'Completed TPT', 'all', count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.tpt_end between p_from and p_to and a.tpt_status = 'completed'
    union all select 'Index testing', 'Contacts elicited', 'all', count(*) from public.case_contacts c where c.hospital_id = p_hospital and c.programme = 'hiv' and c.created_at::date between p_from and p_to
    union all select 'Index testing', 'Contacts tested', 'all', count(*) from public.case_contacts c where c.hospital_id = p_hospital and c.programme = 'hiv' and c.tested_on between p_from and p_to
    union all select 'Index testing', 'Contacts positive (new)', 'all', count(*) from public.case_contacts c where c.hospital_id = p_hospital and c.programme = 'hiv' and c.tested_on between p_from and p_to and c.test_result = 'positive'
    union all select 'Index testing', 'Linked to care', 'all', count(*) from public.case_contacts c where c.hospital_id = p_hospital and c.programme = 'hiv' and c.linked and c.tested_on between p_from and p_to
    union all select 'PMTCT', 'HIV positive at ANC (new clients)', 'all', count(*) from public.anc_contacts ac join public.anc_pregnancies ap on ap.id = ac.pregnancy_id
      where ap.hospital_id = p_hospital and ac.contact_number = 1 and ac.visit_date between p_from and p_to and ap.hiv_status in ('positive', 'known_positive')
    union all select 'PMTCT', 'HIV-exposed infants given ARV prophylaxis', 'all', count(*) from public.newborns n join public.deliveries d on d.id = n.delivery_id
      where d.hospital_id = p_hospital and d.delivered_at::date between p_from and p_to and nullif(trim(coalesce(n.arv_prophylaxis, '')), '') is not null
    union all select 'TB', 'TB cases notified — ' || patient_type, 'all', count(*) from public.tb_episodes e where e.hospital_id = p_hospital and e.diagnosis_date between p_from and p_to group by patient_type
    union all select 'TB', 'Bacteriologically confirmed pulmonary', 'all', count(*) from public.tb_episodes e where e.hospital_id = p_hospital and e.diagnosis_date between p_from and p_to and e.disease_site = 'pulmonary' and e.confirmation = 'bacteriological'
    union all select 'TB', 'TB/HIV co-infected', 'all', count(*) from public.tb_episodes e where e.hospital_id = p_hospital and e.diagnosis_date between p_from and p_to and e.hiv_status = 'positive'
    union all select 'TB', 'Treatment outcome — ' || outcome, 'all', count(*) from public.tb_episodes e where e.hospital_id = p_hospital and e.outcome_date between p_from and p_to and e.outcome is not null group by outcome
    union all select 'TB', 'Contacts screened', 'all', count(*) from public.case_contacts c where c.hospital_id = p_hospital and c.programme = 'tb' and c.screened_on between p_from and p_to;

  elsif p_form = '717' then
    if to_regclass('public.visits') is not null then
      return query execute $q$
        with v as (select x.id, nullif(to_jsonb(x)->>'patient_id', '')::uuid as patient_id, (to_jsonb(x)->>'created_at')::timestamptz as at
                     from public.visits x where x.hospital_id = $1 and (to_jsonb(x)->>'created_at')::date between $2 and $3)
        select 'Outpatient', case when exists (select 1 from public.visits y where y.hospital_id = $1 and to_jsonb(y)->>'patient_id' = v.patient_id::text
                                                 and (to_jsonb(y)->>'created_at')::timestamptz < v.at) then 'Revisits' else 'New attendances' end,
               public.rpt_band(public.clin_patient_age(v.patient_id, v.at::date), '717'), count(*)
          from v group by 2, 3 $q$ using p_hospital, p_from, p_to;
    end if;
    if to_regclass('public.admissions') is not null then
      return query execute $q$
        select 'Inpatient', 'Admissions', 'all', count(*) from public.admissions a where a.hospital_id = $1
           and coalesce(to_jsonb(a)->>'admission_date', to_jsonb(a)->>'created_at')::date between $2 and $3
        union all select 'Inpatient', 'Discharges', 'all', count(*) from public.admissions a where a.hospital_id = $1
           and nullif(to_jsonb(a)->>'discharge_date', '')::date between $2 and $3
        union all select 'Inpatient', 'Deaths', 'all', count(*) from public.admissions a where a.hospital_id = $1
           and lower(coalesce(to_jsonb(a)->>'status', '') || ' ' || coalesce(to_jsonb(a)->>'discharge_outcome', '') || ' ' || coalesce(to_jsonb(a)->>'outcome', '')) ~ '(died|dead|deceased|death)'
           and coalesce(nullif(to_jsonb(a)->>'discharge_date', ''), to_jsonb(a)->>'created_at')::date between $2 and $3
        union all select 'Inpatient', 'Bed days (discharged patients)', 'all',
           coalesce(sum(greatest(1, nullif(to_jsonb(a)->>'discharge_date', '')::date - coalesce(to_jsonb(a)->>'admission_date', to_jsonb(a)->>'created_at')::date)), 0)::bigint
           from public.admissions a where a.hospital_id = $1 and nullif(to_jsonb(a)->>'discharge_date', '')::date between $2 and $3 $q$ using p_hospital, p_from, p_to;
    end if;
    if to_regclass('public.lab_tests') is not null then
      return query execute $q$ select 'Laboratory', 'Tests done', 'all', count(*) from public.lab_tests t where t.hospital_id = $1
        and coalesce(to_jsonb(t)->>'status', '') in ('Complete', 'Completed', 'Critical') and (to_jsonb(t)->>'ordered_at')::date between $2 and $3 $q$ using p_hospital, p_from, p_to;
    end if;
    if to_regclass('public.prescriptions') is not null then
      return query execute $q$ select 'Pharmacy', 'Prescriptions dispensed', 'all', count(*) from public.prescriptions r where r.hospital_id = $1
        and coalesce(to_jsonb(r)->>'status', '') = 'Released' and coalesce(nullif(to_jsonb(r)->>'dispensed_at', ''), to_jsonb(r)->>'created_at')::date between $2 and $3 $q$ using p_hospital, p_from, p_to;
    end if;
    return query
    select 'Maternal & child', 'ANC contacts', 'all', count(*) from public.anc_contacts ac join public.anc_pregnancies ap on ap.id = ac.pregnancy_id where ap.hospital_id = p_hospital and ac.visit_date between p_from and p_to
    union all select 'Maternal & child', 'Deliveries', 'all', count(*) from public.deliveries d where d.hospital_id = p_hospital and d.delivered_at::date between p_from and p_to
    union all select 'Maternal & child', 'Immunisation doses', 'all', count(*) from public.immunisations i where i.hospital_id = p_hospital and i.given_on between p_from and p_to;
  else
    raise exception 'Unknown MOH form %', p_form;
  end if;
end $$;

create table if not exists public.khis_settings (
  hospital_id   uuid primary key,
  org_unit_uid  text,
  mfl_code      text,
  updated_at    timestamptz not null default now()
);
create table if not exists public.khis_mappings (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid not null,
  form               text not null,
  indicator          text not null,
  disaggregation     text not null default 'all',
  data_set_uid       text,
  data_element_uid   text not null,
  category_option_combo_uid text,
  unique (hospital_id, form, indicator, disaggregation)
);

create table if not exists public.report_schedules (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  form         text not null check (form in ('711', '710', '731', '717')),
  frequency    text not null default 'monthly' check (frequency in ('monthly', 'weekly')),
  run_day      smallint not null default 5 check (run_day between 1 and 28),
  recipients   text[] not null default '{}',
  active       boolean not null default true,
  last_run_at  timestamptz,
  next_run_at  timestamptz,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);

create table if not exists public.report_runs (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  schedule_id  uuid references public.report_schedules(id) on delete set null,
  form         text not null,
  period_from  date not null,
  period_to    date not null,
  rows         jsonb not null default '[]',
  csv          text,
  recipients   text[] not null default '{}',
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'skipped', 'failed', 'not_requested')),
  email_error  text,
  generated_at timestamptz not null default now()
);
create index if not exists report_runs_hospital on public.report_runs(hospital_id, generated_at desc);

create or replace function public.report_next_run(p_frequency text, p_day int, p_after timestamptz)
returns timestamptz language plpgsql immutable as $$
declare d date := (p_after at time zone 'Africa/Nairobi')::date;
begin
  if p_frequency = 'weekly' then
    d := d + 1;
    while extract(isodow from d)::int <> greatest(1, least(p_day, 7)) loop d := d + 1; end loop;
  else
    d := make_date(extract(year from d)::int, extract(month from d)::int, least(p_day, 28));
    if (d::timestamp + time '06:00') at time zone 'Africa/Nairobi' <= p_after then d := (d + interval '1 month')::date; end if;
  end if;
  return (d::timestamp + time '06:00') at time zone 'Africa/Nairobi';
end $$;

create or replace function public.report_schedules_before()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.frequency is distinct from old.frequency or new.run_day is distinct from old.run_day or new.next_run_at is null then
    new.next_run_at := public.report_next_run(new.frequency, new.run_day, now());
  end if;
  return new;
end $$;
drop trigger if exists trg_report_schedules_before on public.report_schedules;
create trigger trg_report_schedules_before before insert or update on public.report_schedules
  for each row execute function public.report_schedules_before();

/** Generate every due scheduled report (previous month / previous 7 days). Called by the sweep. */
create or replace function public.report_run_due()
returns integer language plpgsql security definer set search_path = public as $$
declare s record; v_from date; v_to date; v_rows jsonb; v_csv text; n int := 0; v_today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  for s in select * from public.report_schedules where active and next_run_at <= now() for update skip locked loop
    if s.frequency = 'weekly' then v_to := v_today - 1; v_from := v_today - 7;
    else v_from := (date_trunc('month', v_today) - interval '1 month')::date; v_to := (date_trunc('month', v_today) - interval '1 day')::date; end if;
    select coalesce(jsonb_agg(jsonb_build_object('section', r.section, 'indicator', r.indicator, 'disaggregation', r.disaggregation, 'value', r.value)
                              order by r.section, r.indicator, r.disaggregation), '[]'),
           'section,indicator,disaggregation,value' || chr(10) || coalesce(string_agg(
              format('"%s","%s","%s",%s', replace(r.section, '"', '""'), replace(r.indicator, '"', '""'), replace(r.disaggregation, '"', '""'), r.value),
              chr(10) order by r.section, r.indicator, r.disaggregation), '')
      into v_rows, v_csv
      from public.moh_report(s.hospital_id, s.form, v_from, v_to) r;
    insert into public.report_runs(hospital_id, schedule_id, form, period_from, period_to, rows, csv, recipients, email_status)
    values (s.hospital_id, s.id, s.form, v_from, v_to, v_rows, v_csv, s.recipients, case when cardinality(s.recipients) = 0 then 'not_requested' else 'pending' end);
    update public.report_schedules set last_run_at = now(), next_run_at = public.report_next_run(frequency, run_day, now()) where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
declare t text;
begin
  foreach t in array array['khis_settings', 'khis_mappings', 'report_schedules', 'report_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_clinical', t);
    execute format('create policy %I on public.%I for all using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id))', t || '_clinical', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke insert, update on public.report_runs from authenticated;

revoke execute on function public.report_run_due(), public.rpt_patient_sex(uuid) from public, anon, authenticated;
grant execute on function public.report_run_due(), public.rpt_patient_sex(uuid) to service_role;
grant execute on function public.moh_report(uuid, text, date, date), public.rpt_band(numeric, text) to authenticated, service_role;
grant execute on function public.clin_patient_age(uuid, date) to service_role;

commit;

select 'tables' as check_name, case when (select count(*) from pg_class where oid in (to_regclass('public.khis_mappings'), to_regclass('public.khis_settings'),
      to_regclass('public.report_schedules'), to_regclass('public.report_runs'))) = 4 then 'OK' else 'PROBLEM' end as result
    union all select 'MOH age bands', case when public.rpt_band(17, '711') = '15-19' and public.rpt_band(0.5, '710') = 'under 1' and public.rpt_band(52, '731') = '50+' then 'OK' else 'PROBLEM' end;
