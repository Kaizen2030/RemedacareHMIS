-- =============================================================================
-- RemedacareHMS - HIV / TB PROGRAMME: HTS REGISTER, ART VISITS WITH TB SCREENING, DEFAULTER TRACING, CASCADE AND NATIONAL INDICATORS
-- Generated from supabase/migrations/20261219000000_hiv_programme.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.clin_can_access(uuid)') is null then
    raise exception 'Run 08_hiv_tb_maternity.sql first. Nothing was changed.';
  end if;
end $$;

create or replace function public.pay_canonical_role(p_role text)
returns text language plpgsql immutable as $$
declare r text := lower(trim(coalesce(p_role, '')));
begin
  if r = '' or r = 'staff' then return 'unknown'; end if;  -- deliberately NOT receptionist
  if r in ('admin','owner') then return 'admin'; end if;
  if r in ('doctor','nurse','pharmacist','hr','transfusion officer','mortuary attendant','lab technician') then return 'clinical'; end if;
  if r in ('medical officer','consultant','specialist','general practitioner','registrar','intern','medical intern','microbiologist','radiographer',
           'sonographer','anaesthetist','anesthetist','paediatrician','pediatrician','obstetrician','gynaecologist','gynecologist','dentist',
           'physiotherapist','optometrist','nutritionist','dietitian','psychologist','counsellor','hiv counsellor') then return 'clinical'; end if;
  if r = 'receptionist' then return 'receptionist'; end if;
  if r = 'accountant' then return 'accountant'; end if;
  if r in ('finance officer','cashier','billing officer') then return 'accountant'; end if;
  if r in ('front desk','patient coordinator') then return 'receptionist'; end if;
  if r ~ '(doctor|physician|surgeon|clinical|nurse|nursing|midwife|pharma|lab|technician|radiolog|mlt)' then return 'clinical'; end if;
  if r ~ '(medical officer|practitioner|anaesth|anesth|paediatrician|pediatrician|obstetric|gynaec|gynec|microbiolog|radiograph|sonograph|physiotherap|optomet|dietit|dentist)' then return 'clinical'; end if;
  if r ~ '(counsel|\yhts\y|\yccc\y)' then return 'clinical'; end if;
  if r ~ '(account|finance|cashier|billing)' then return 'accountant'; end if;
  if r ~ '(reception|front desk|coordinator)' then return 'receptionist'; end if;
  if r ~ 'admin' then return 'admin'; end if;
  return 'unknown';
end $$;

create table if not exists public.hts_tests (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  patient_id    uuid not null,
  tested_on     date not null default current_date,
  entry_point   text not null default 'opd' check (entry_point in ('opd', 'ipd', 'emergency', 'anc', 'maternity', 'pnc', 'paediatric', 'vct', 'tb', 'sti', 'index', 'other')),
  test_kind     text not null default 'initial' check (test_kind in ('initial', 'retest')),
  consent       boolean not null default false,
  test1_kit     text not null default 'Determine',
  test1_result  text not null check (test1_result in ('reactive', 'non_reactive', 'invalid')),
  test2_kit     text default 'First Response',
  test2_result  text check (test2_result in ('reactive', 'non_reactive', 'invalid')),
  final_result  text not null check (final_result in ('negative', 'positive', 'inconclusive')),
  linked_art_id uuid references public.hiv_art(id) on delete set null,
  linked_on     date,
  referred_to   text,
  counsellor    text,
  notes         text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (patient_id, tested_on, test_kind)
);
create index if not exists hts_tests_hospital_date on public.hts_tests(hospital_id, tested_on);

/** Kenya serial HTS algorithm: final result from the screening and confirmatory kits (null = cannot record). */
create or replace function public.hts_final_result(p_test1 text, p_test2 text)
returns text language sql immutable as $$
  select case
    when p_test1 = 'non_reactive' and p_test2 is null then 'negative'
    when p_test1 = 'reactive' and p_test2 = 'reactive' then 'positive'
    when p_test1 = 'reactive' and p_test2 = 'non_reactive' then 'inconclusive' end
$$;

create or replace function public.hts_tests_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if not coalesce(new.consent, false) then raise exception 'Record the client''s consent before testing'; end if;
  if new.tested_on > current_date then raise exception 'The test date cannot be in the future'; end if;
  if new.test1_result = 'invalid' then raise exception 'Screening test invalid: repeat it with a new kit, then record the valid result'; end if;
  if new.test1_result = 'non_reactive' and new.test2_result is not null then
    raise exception 'Screening test non-reactive: no confirmatory test is done (the result is negative)';
  end if;
  if new.test1_result = 'reactive' and new.test2_result is null then
    raise exception 'Screening test reactive: do the confirmatory test (First Response) before recording a result';
  end if;
  if new.test2_result = 'invalid' then raise exception 'Confirmatory test invalid: repeat it with a new kit'; end if;
  new.final_result := public.hts_final_result(new.test1_result, new.test2_result);
  if new.test1_result = 'non_reactive' then new.test2_kit := null; end if;
  if new.final_result <> 'positive' then
    new.linked_art_id := null; new.linked_on := null;
  elsif new.linked_art_id is null then
    select id, enrolled_on into a from public.hiv_art where hospital_id = new.hospital_id and patient_id = new.patient_id;
    if a.id is not null then new.linked_art_id := a.id; new.linked_on := greatest(a.enrolled_on, new.tested_on); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_hts_tests_before on public.hts_tests;
create trigger trg_hts_tests_before before insert or update on public.hts_tests
  for each row execute function public.hts_tests_before();

/** Enrolling a client on ART links their unlinked positive tests. */
create or replace function public.hiv_art_link_hts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.hts_tests set linked_art_id = new.id, linked_on = greatest(new.enrolled_on, tested_on)
   where hospital_id = new.hospital_id and patient_id = new.patient_id and final_result = 'positive' and linked_art_id is null;
  return null;
end $$;
drop trigger if exists trg_hiv_art_link_hts on public.hiv_art;
create trigger trg_hiv_art_link_hts after insert on public.hiv_art
  for each row execute function public.hiv_art_link_hts();

alter table public.hiv_art add column if not exists last_visit_date date;
alter table public.hiv_art add column if not exists next_appointment date;

create table if not exists public.hiv_visits (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  art_id           uuid not null references public.hiv_art(id) on delete cascade,
  visit_date       date not null default current_date,
  weight_kg        numeric check (weight_kg > 0 and weight_kg < 400),
  tb_cough         boolean,
  tb_fever         boolean,
  tb_weight_loss   boolean,
  tb_night_sweats  boolean,
  tb_screen        text not null default 'not_screened' check (tb_screen in ('no_signs', 'presumptive', 'on_tb_treatment', 'not_screened')),
  adherence        text check (adherence in ('good', 'fair', 'poor')),
  months_dispensed smallint check (months_dispensed between 1 and 6),
  next_appointment date not null,
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (art_id, visit_date)
);
create index if not exists hiv_visits_hospital_date on public.hiv_visits(hospital_id, visit_date);

/** TB symptom screen: any symptom = presumptive; all four answered 'no' = no signs; none answered = not screened. */
create or replace function public.tb_screen_result(p_cough boolean, p_fever boolean, p_weight_loss boolean, p_night_sweats boolean, p_on_treatment boolean default false)
returns text language sql immutable as $$
  select case
    when coalesce(p_on_treatment, false) then 'on_tb_treatment'
    when coalesce(p_cough, false) or coalesce(p_fever, false) or coalesce(p_weight_loss, false) or coalesce(p_night_sweats, false) then 'presumptive'
    when p_cough is not null and p_fever is not null and p_weight_loss is not null and p_night_sweats is not null then 'no_signs'
    when p_cough is null and p_fever is null and p_weight_loss is null and p_night_sweats is null then 'not_screened' end
$$;

create or replace function public.hiv_visits_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare a public.hiv_art; v_on_tb boolean;
begin
  select * into a from public.hiv_art where id = new.art_id;
  if a.id is null then raise exception 'ART record not found'; end if;
  new.hospital_id := a.hospital_id;
  if new.visit_date > current_date then raise exception 'The visit date cannot be in the future'; end if;
  if new.next_appointment is null then raise exception 'Give the next appointment date'; end if;
  if new.next_appointment <= new.visit_date then raise exception 'The next appointment must be after the visit'; end if;
  if new.next_appointment > new.visit_date + 200 then raise exception 'The next appointment is more than 6 months away'; end if;
  v_on_tb := exists (select 1 from public.tb_episodes e where e.hospital_id = a.hospital_id and e.patient_id = a.patient_id
                       and e.outcome is null and e.treatment_start is not null and e.treatment_start <= new.visit_date);
  new.tb_screen := public.tb_screen_result(new.tb_cough, new.tb_fever, new.tb_weight_loss, new.tb_night_sweats, v_on_tb);
  if new.tb_screen is null then raise exception 'Answer all four TB screening questions (cough, fever, weight loss, night sweats)'; end if;
  return new;
end $$;
drop trigger if exists trg_hiv_visits_before on public.hiv_visits;
create trigger trg_hiv_visits_before before insert or update on public.hiv_visits
  for each row execute function public.hiv_visits_before();

/** Keeps last visit and next appointment on the ART record; a visit after LTFU makes the client active again. */
create or replace function public.hiv_visit_refresh(p_art uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.hiv_art; v record;
begin
  select * into a from public.hiv_art where id = p_art for update;
  if a.id is null then return; end if;
  select visit_date, next_appointment into v from public.hiv_visits where art_id = p_art order by visit_date desc limit 1;
  update public.hiv_art set
    last_visit_date  = v.visit_date,
    next_appointment = v.next_appointment,
    status      = case when a.status = 'ltfu' and v.visit_date > coalesce(a.status_date, '-infinity'::date) then 'active' else a.status end,
    status_date = case when a.status = 'ltfu' and v.visit_date > coalesce(a.status_date, '-infinity'::date) then v.visit_date else a.status_date end
  where id = p_art;
end $$;

create or replace function public.hiv_visits_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.hiv_visit_refresh(coalesce(new.art_id, old.art_id)); return null; end $$;
drop trigger if exists trg_hiv_visits_after on public.hiv_visits;
create trigger trg_hiv_visits_after after insert or update or delete on public.hiv_visits
  for each row execute function public.hiv_visits_after();

create table if not exists public.programme_tracing (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  programme     text not null check (programme in ('hiv', 'tb')),
  art_id        uuid references public.hiv_art(id) on delete cascade,
  tb_episode_id uuid references public.tb_episodes(id) on delete cascade,
  traced_on     date not null default current_date,
  method        text not null check (method in ('phone', 'sms', 'home_visit', 'treatment_supporter', 'other')),
  outcome       text not null check (outcome in ('reached_will_return', 'returned', 'not_reached', 'wrong_contact', 'refused', 'transferred_out', 'died')),
  promised_date date,
  notes         text,
  traced_by     uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  check ((programme = 'hiv' and art_id is not null and tb_episode_id is null) or (programme = 'tb' and tb_episode_id is not null and art_id is null))
);
create index if not exists programme_tracing_art on public.programme_tracing(art_id, traced_on desc);
create index if not exists programme_tracing_tb on public.programme_tracing(tb_episode_id, traced_on desc);

create or replace function public.programme_tracing_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_h uuid;
begin
  if new.programme = 'hiv' then select hospital_id into v_h from public.hiv_art where id = new.art_id;
  else select hospital_id into v_h from public.tb_episodes where id = new.tb_episode_id; end if;
  if v_h is null then raise exception 'Record not found'; end if;
  new.hospital_id := v_h;
  if new.traced_on > current_date then raise exception 'The tracing date cannot be in the future'; end if;
  if new.outcome = 'reached_will_return' and new.promised_date is null then raise exception 'Give the date the client promised to come back'; end if;
  if new.promised_date is not null and new.promised_date < new.traced_on then raise exception 'The promised date must be on or after the tracing date'; end if;
  return new;
end $$;
drop trigger if exists trg_programme_tracing_before on public.programme_tracing;
create trigger trg_programme_tracing_before before insert on public.programme_tracing
  for each row execute function public.programme_tracing_before();

create or replace function public.programme_tracing_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.outcome in ('died', 'transferred_out') then
    if new.programme = 'hiv' then
      update public.hiv_art set status = new.outcome, status_date = new.traced_on where id = new.art_id and status in ('active', 'ltfu');
    else
      update public.tb_episodes set outcome = new.outcome, outcome_date = new.traced_on where id = new.tb_episode_id and outcome is null;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_programme_tracing_after on public.programme_tracing;
create trigger trg_programme_tracing_after after insert on public.programme_tracing
  for each row execute function public.programme_tracing_after();

/** Band for days past a missed ART appointment. */
create or replace function public.hiv_defaulter_band(p_days int)
returns text language sql immutable as $$
  select case when p_days is null or p_days < 1 then null when p_days <= 7 then 'missed' when p_days <= 30 then 'defaulter' else 'iit' end
$$;

/** HIV clients past their appointment and TB patients with no dose recorded for 14+ days, with the last tracing attempt. */
create or replace function public.programme_defaulters(p_hospital uuid, p_as_of date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Clinical access required'; end if;
  with hiv as (
    select 'hiv'::text as programme, a.id as record_id, a.patient_id, p.full_name, to_jsonb(p)->>'phone' as phone, a.ccc_number as number,
           a.next_appointment as due_date, (p_as_of - a.next_appointment) as days,
           public.hiv_defaulter_band(p_as_of - a.next_appointment) as band
      from public.hiv_art a left join public.patients p on p.id = a.patient_id
     where a.hospital_id = p_hospital and a.status = 'active' and a.next_appointment < p_as_of
  ), tb as (
    select 'tb'::text, e.id, e.patient_id, p.full_name, coalesce(to_jsonb(p)->>'phone', e.dot_supporter_phone), e.tb_number,
           ld.last_dose, (p_as_of - ld.last_dose), case when p_as_of - ld.last_dose >= 56 then 'ltfu' else 'interrupted' end
      from public.tb_episodes e left join public.patients p on p.id = e.patient_id
      cross join lateral (select coalesce((select max(dose_date) from public.tb_dot_log l where l.episode_id = e.id and l.taken), e.treatment_start) as last_dose) ld
     where e.hospital_id = p_hospital and e.outcome is null and e.treatment_start is not null
       and p_as_of < (e.treatment_start + make_interval(months => e.treatment_months))::date
       and p_as_of - ld.last_dose >= 14
  ), all_rows as (select * from hiv union all select * from tb)
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
           'attempts', (select count(*) from public.programme_tracing t
                         where (t.art_id = r.record_id or t.tb_episode_id = r.record_id) and t.traced_on >= r.due_date),
           'last_trace', (select jsonb_build_object('on', t.traced_on, 'method', t.method, 'outcome', t.outcome, 'promised_date', t.promised_date)
                            from public.programme_tracing t where t.art_id = r.record_id or t.tb_episode_id = r.record_id
                           order by t.traced_on desc, t.created_at desc limit 1))
         order by r.days desc), '[]'::jsonb)
    into v from all_rows r;
  return v;
end $$;

create or replace function public.hiv_programme_indicators(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_cascade jsonb; v_entry jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Clinical access required'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'Give a valid period'; end if;

  with t as (select h.*, a.art_start_date from public.hts_tests h left join public.hiv_art a on a.id = h.linked_art_id
              where h.hospital_id = p_hospital and h.tested_on between p_from and p_to),
       cur as (select a.* from public.hiv_art a
                where a.hospital_id = p_hospital and a.status = 'active' and a.art_start_date <= p_to
                  and (a.next_appointment is null or a.next_appointment >= p_to - 30)),
       vl as (select c.id, c.art_start_date, lv.copies_ml from cur c
                left join lateral (select v.copies_ml from public.hiv_viral_loads v where v.art_id = c.id and v.sample_date > p_to - 365 and v.sample_date <= p_to
                                    order by v.sample_date desc, v.created_at desc limit 1) lv on true
               where c.art_start_date <= p_to - 90),
       e as (select * from public.tb_episodes where hospital_id = p_hospital and diagnosis_date between p_from and p_to),
  r(ord, grp, key, label, num, den) as (
  select 1, 'Testing', 'hts_tst', 'Tested for HIV (HTS_TST)', count(*), null from t
  union all select 2, 'Testing', 'hts_tst_pos', 'Tested positive (HTS_TST_POS) — yield', count(*) filter (where final_result = 'positive'), count(*) from t
  union all select 3, 'Testing', 'hts_inconclusive', 'Inconclusive — retest in 14 days', count(*) filter (where final_result = 'inconclusive'), count(*) from t
  union all select 4, 'Testing', 'linked', 'Positives linked to care', count(*) filter (where final_result = 'positive' and linked_art_id is not null), count(*) filter (where final_result = 'positive') from t
  union all select 5, 'Testing', 'started_art', 'Positives started on ART', count(*) filter (where final_result = 'positive' and art_start_date is not null), count(*) filter (where final_result = 'positive') from t
  union all select 6, 'Testing', 'same_day_art', 'Started ART within 14 days of diagnosis', count(*) filter (where final_result = 'positive' and art_start_date between tested_on - 1 and tested_on + 14), count(*) filter (where final_result = 'positive' and art_start_date is not null) from t
  union all
  select 7, 'Testing', 'index_tested', 'Index contacts tested', count(*) filter (where c.tested_on is not null), count(*)
    from public.case_contacts c where c.hospital_id = p_hospital and c.programme = 'hiv' and c.created_at::date between p_from and p_to
  union all
  select 8, 'Testing', 'index_pos', 'Index contacts newly positive', count(*) filter (where c.test_result = 'positive'), count(*) filter (where c.tested_on is not null)
    from public.case_contacts c where c.hospital_id = p_hospital and c.programme = 'hiv' and c.created_at::date between p_from and p_to
  union all
  select 10, 'Treatment', 'tx_new', 'Started ART (TX_NEW)', (select count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.art_start_date between p_from and p_to), null
  union all select 11, 'Treatment', 'tx_curr', 'Currently on ART (TX_CURR, interruptions > 30 days excluded)', (select count(*) from cur), null
  union all select 12, 'Treatment', 'tx_ml_iit', 'Interrupted treatment > 30 days (TX_ML)',
    (select count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.status = 'active' and a.next_appointment + 31 between p_from and p_to), null
  union all select 13, 'Treatment', 'tx_ml_died', 'Died (TX_ML)',
    (select count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.status = 'died' and a.status_date between p_from and p_to), null
  union all select 14, 'Treatment', 'tx_ml_to', 'Transferred out (TX_ML)',
    (select count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.status = 'transferred_out' and a.status_date between p_from and p_to), null
  union all select 15, 'Treatment', 'tx_rtt', 'Returned after an interruption > 30 days (TX_RTT)',
    (select count(*) from (select v.visit_date, lag(v.next_appointment) over (partition by v.art_id order by v.visit_date) as prev_due
                             from public.hiv_visits v where v.hospital_id = p_hospital) x
      where x.visit_date between p_from and p_to and x.prev_due < x.visit_date - 30), null
  union all select 16, 'Treatment', 'mmd', 'Clients given 3+ months of ARVs (MMD)',
    (select count(distinct v.art_id) from public.hiv_visits v where v.hospital_id = p_hospital and v.visit_date between p_from and p_to and v.months_dispensed >= 3),
    (select count(distinct v.art_id) from public.hiv_visits v where v.hospital_id = p_hospital and v.visit_date between p_from and p_to)
  union all select 20, 'Viral load', 'vl_coverage', 'VL result in last 12 months (on ART 3+ months)', (select count(*) from vl where copies_ml is not null), (select count(*) from vl)
  union all select 21, 'Viral load', 'tx_pvls', 'Suppressed < 200 copies/ml (TX_PVLS)', (select count(*) from vl where copies_ml < 200), (select count(*) from vl where copies_ml is not null)
  union all select 22, 'Viral load', 'ldl', 'Undetectable < 50 copies/ml (LDL)', (select count(*) from vl where copies_ml < 50), (select count(*) from vl where copies_ml is not null)
  union all select 30, 'TB in HIV care', 'tx_tb_screened', 'ART clients screened for TB at a visit (TX_TB)',
    (select count(distinct v.art_id) from public.hiv_visits v where v.hospital_id = p_hospital and v.visit_date between p_from and p_to and v.tb_screen <> 'not_screened'),
    (select count(distinct v.art_id) from public.hiv_visits v where v.hospital_id = p_hospital and v.visit_date between p_from and p_to)
  union all select 31, 'TB in HIV care', 'tb_presumptive', 'Screened presumptive TB',
    (select count(distinct v.art_id) from public.hiv_visits v where v.hospital_id = p_hospital and v.visit_date between p_from and p_to and v.tb_screen = 'presumptive'),
    (select count(distinct v.art_id) from public.hiv_visits v where v.hospital_id = p_hospital and v.visit_date between p_from and p_to and v.tb_screen in ('presumptive', 'no_signs'))
  union all select 32, 'TB in HIV care', 'tpt_coverage', 'Ever started TPT (of current clients)',
    (select count(*) from cur where tpt_status in ('on_tpt', 'completed')), (select count(*) from cur where coalesce(tpt_status, '') <> 'not_eligible')
  union all select 33, 'TB in HIV care', 'tb_prev', 'Completed TPT (started 6–12 months earlier, TB_PREV)',
    (select count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.tpt_start between (p_from - interval '6 months')::date and (p_to - interval '6 months')::date and a.tpt_status = 'completed'),
    (select count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.tpt_start between (p_from - interval '6 months')::date and (p_to - interval '6 months')::date)
  union all
  select 40, 'TB', 'tb_notified', 'TB cases notified', count(*), null from e
  union all select 41, 'TB', 'tb_bact', 'Bacteriologically confirmed (of pulmonary)', count(*) filter (where disease_site = 'pulmonary' and confirmation = 'bacteriological'), count(*) filter (where disease_site = 'pulmonary') from e
  union all select 42, 'TB', 'tb_hiv_known', 'TB patients with known HIV status', count(*) filter (where hiv_status in ('positive', 'negative')), count(*) from e
  union all select 43, 'TB', 'tb_hiv_pos', 'TB patients HIV positive', count(*) filter (where hiv_status = 'positive'), count(*) filter (where hiv_status in ('positive', 'negative')) from e
  union all select 44, 'TB', 'tb_hiv_art', 'HIV-positive TB patients on ART',
    count(*) filter (where hiv_status = 'positive' and exists (select 1 from public.hiv_art a where a.hospital_id = p_hospital and a.patient_id = e.patient_id and a.art_start_date is not null)),
    count(*) filter (where hiv_status = 'positive') from e
  union all select 45, 'TB', 'tb_success', 'Treatment success (cured + completed, outcomes in period)',
    (select count(*) from public.tb_episodes x where x.hospital_id = p_hospital and x.outcome_date between p_from and p_to and x.outcome in ('cured', 'completed')),
    (select count(*) from public.tb_episodes x where x.hospital_id = p_hospital and x.outcome_date between p_from and p_to and x.outcome is not null)
  union all select 46, 'TB', 'tb_contacts', 'TB contacts screened',
    (select count(*) from public.case_contacts c where c.hospital_id = p_hospital and c.programme = 'tb' and c.screened_on between p_from and p_to), null
  )
  select jsonb_agg(jsonb_build_object('group', grp, 'key', key, 'label', label, 'numerator', num, 'denominator', den,
                                      'percent', case when den > 0 then round(100.0 * num / den, 1) end) order by ord),
         jsonb_build_array(
           jsonb_build_object('step', 'Tested', 'value', max(num) filter (where key = 'hts_tst')),
           jsonb_build_object('step', 'Positive', 'value', max(num) filter (where key = 'hts_tst_pos')),
           jsonb_build_object('step', 'Linked', 'value', max(num) filter (where key = 'linked')),
           jsonb_build_object('step', 'Started ART', 'value', max(num) filter (where key = 'started_art')),
           jsonb_build_object('step', 'Current on ART', 'value', max(num) filter (where key = 'tx_curr')),
           jsonb_build_object('step', 'VL done', 'value', max(num) filter (where key = 'vl_coverage')),
           jsonb_build_object('step', 'Suppressed', 'value', max(num) filter (where key = 'tx_pvls')))
    into v_rows, v_cascade from r;

  select coalesce(jsonb_agg(jsonb_build_object('entry_point', entry_point, 'tested', n, 'positive', pos,
                                               'yield', case when n > 0 then round(100.0 * pos / n, 1) end) order by n desc), '[]'::jsonb)
    into v_entry from (select entry_point, count(*) n, count(*) filter (where final_result = 'positive') pos
                         from public.hts_tests where hospital_id = p_hospital and tested_on between p_from and p_to group by entry_point) x;

  return jsonb_build_object('period', jsonb_build_object('from', p_from, 'to', p_to), 'indicators', v_rows, 'cascade', v_cascade, 'by_entry_point', v_entry);
end $$;

do $$
declare t text;
begin
  foreach t in array array['hts_tests', 'hiv_visits', 'programme_tracing'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_clinical', t);
    execute format('create policy %I on public.%I for all using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id))', t || '_clinical', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke update, delete on public.programme_tracing from authenticated;

revoke execute on function public.hiv_visit_refresh(uuid) from public, anon, authenticated;
grant execute on function public.hiv_visit_refresh(uuid) to service_role;
revoke execute on function public.programme_defaulters(uuid, date), public.hiv_programme_indicators(uuid, date, date) from public, anon;
grant execute on function public.programme_defaulters(uuid, date), public.hiv_programme_indicators(uuid, date, date),
  public.hts_final_result(text, text), public.tb_screen_result(boolean, boolean, boolean, boolean, boolean), public.hiv_defaulter_band(int) to authenticated, service_role;

commit;

select 'HTS, visits and tracing' as check_name, case when to_regclass('public.hts_tests') is not null and to_regclass('public.hiv_visits') is not null and to_regclass('public.programme_tracing') is not null and to_regprocedure('public.hiv_programme_indicators(uuid,date,date)') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'HTS algorithm and TB screen', case when public.hts_final_result('reactive', 'reactive') = 'positive' and public.hts_final_result('reactive', 'non_reactive') = 'inconclusive' and public.tb_screen_result(false, false, true, false) = 'presumptive' and public.pay_canonical_role('HTS Counsellor') = 'clinical' then 'OK' else 'PROBLEM' end;
