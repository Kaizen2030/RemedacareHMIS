-- =============================================================================
-- RemedacareHMS - HIV, TB AND MATERNITY (ART & viral load, TB treatment, ANC, labour, delivery, PNC, immunisation)
-- Generated from supabase/migrations/20261119000000_hiv_tb_maternity.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.pay_is_member(uuid)') is null then
    raise exception 'Run 02_install_payments.sql first. Nothing was changed.';
  end if;
end $$;

create or replace function public.clin_can_access(p_hospital uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select c.member and c.staff_active and c.canonical in ('admin', 'clinical')
                          and lower(coalesce(c.raw_role, '')) !~ '(^hr$|human resource|hr manager|hr officer|mortuary)'
                     from public.pay_user_context(p_hospital, auth.uid()) c), false)
$$;

create or replace function public.clin_patient_age(p_patient uuid, p_on date default current_date)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare j jsonb;
begin
  select to_jsonb(p) into j from public.patients p where p.id = p_patient;
  if j is null then return null; end if;
  if nullif(j->>'date_of_birth', '') is not null then
    return extract(epoch from age(p_on, (j->>'date_of_birth')::date)) / (365.25 * 86400);
  end if;
  return nullif(substring(coalesce(j->>'age', '') from '^\s*([0-9]+(\.[0-9]+)?)'), '')::numeric;
end $$;

create table if not exists public.hiv_art (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null,
  patient_id      uuid not null,
  ccc_number      text,
  enrolled_on     date not null default current_date,
  art_start_date  date,
  current_regimen text,
  regimen_line    text check (regimen_line in ('first', 'second', 'third')),
  who_stage       smallint check (who_stage between 1 and 4),
  status          text not null default 'active' check (status in ('active', 'ltfu', 'transferred_out', 'died', 'stopped')),
  status_date     date,
  pregnant_or_breastfeeding boolean not null default false,
  tpt_status      text check (tpt_status in ('not_started', 'on_tpt', 'completed', 'not_eligible', 'stopped')),
  tpt_start       date,
  tpt_end         date,
  last_vl_value   numeric,
  last_vl_date    date,
  vl_status       text not null default 'unknown' check (vl_status in ('suppressed', 'llv', 'unsuppressed', 'unknown')),
  next_vl_due     date,
  eac_required    boolean not null default false,
  notes           text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create unique index if not exists hiv_art_one_per_patient on public.hiv_art(hospital_id, patient_id);
create unique index if not exists hiv_art_ccc on public.hiv_art(hospital_id, ccc_number) where ccc_number is not null;

create table if not exists public.hiv_regimen_changes (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  art_id      uuid not null references public.hiv_art(id) on delete cascade,
  changed_on  date not null default current_date,
  from_regimen text,
  to_regimen  text not null,
  to_line     text check (to_line in ('first', 'second', 'third')),
  reason      text not null,
  changed_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.hiv_viral_loads (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  art_id      uuid not null references public.hiv_art(id) on delete cascade,
  sample_date date not null,
  copies_ml   numeric not null check (copies_ml >= 0),
  eac_sessions smallint,
  notes       text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists hiv_viral_loads_art on public.hiv_viral_loads(art_id, sample_date desc);

create or replace function public.hiv_vl_status(p_copies numeric)
returns text language sql immutable as $$
  select case when p_copies is null then 'unknown' when p_copies < 50 then 'suppressed'
              when p_copies < 200 then 'llv' else 'unsuppressed' end
$$;

/** Next viral load due, following the Kenya 2022 schedule. */
create or replace function public.hiv_next_vl_due(p_art_start date, p_last_date date, p_last_copies numeric, p_age numeric, p_pbf boolean)
returns date language sql immutable as $$
  select case
    when p_last_date is null then (p_art_start + interval '3 months')::date
    when p_last_copies >= 50 then (p_last_date + interval '3 months')::date
    when coalesce(p_pbf, false) or coalesce(p_age, 0) < 25 then (p_last_date + interval '6 months')::date
    else (p_last_date + interval '12 months')::date end
$$;

create or replace function public.hiv_refresh(p_art uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.hiv_art; v public.hiv_viral_loads;
begin
  select * into a from public.hiv_art where id = p_art for update;
  if not found then return; end if;
  select * into v from public.hiv_viral_loads where art_id = p_art order by sample_date desc, created_at desc limit 1;
  update public.hiv_art set
    last_vl_value = v.copies_ml,
    last_vl_date  = v.sample_date,
    vl_status     = public.hiv_vl_status(v.copies_ml),
    eac_required  = coalesce(v.copies_ml >= 50, false),
    next_vl_due   = case when a.art_start_date is null and v.sample_date is null then null
                         else public.hiv_next_vl_due(coalesce(a.art_start_date, a.enrolled_on), v.sample_date, v.copies_ml,
                                public.clin_patient_age(a.patient_id), a.pregnant_or_breastfeeding) end
  where id = p_art;
end $$;

create or replace function public.hiv_vl_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.hiv_refresh(coalesce(new.art_id, old.art_id)); return null; end $$;
drop trigger if exists trg_hiv_vl_after on public.hiv_viral_loads;
create trigger trg_hiv_vl_after after insert or update or delete on public.hiv_viral_loads
  for each row execute function public.hiv_vl_after();

create or replace function public.hiv_art_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.current_regimen is distinct from old.current_regimen and old.current_regimen is not null
     and coalesce(current_setting('app.hiv_regimen_logged', true), '') <> 'on' then
    raise exception 'Change the regimen with a reason (Regimen change), so the history is kept';
  end if;
  declare v_recalc boolean := tg_op = 'INSERT';
  begin
    if tg_op = 'UPDATE' then
      if new.status is distinct from old.status then new.status_date := coalesce(new.status_date, current_date); end if;
      v_recalc := new.art_start_date is distinct from old.art_start_date or new.pregnant_or_breastfeeding is distinct from old.pregnant_or_breastfeeding;
    end if;
    if v_recalc then
      new.next_vl_due := case when new.art_start_date is null then null
        else public.hiv_next_vl_due(new.art_start_date, new.last_vl_date, new.last_vl_value, public.clin_patient_age(new.patient_id), new.pregnant_or_breastfeeding) end;
    end if;
  end;
  return new;
end $$;
drop trigger if exists trg_hiv_art_before on public.hiv_art;
create trigger trg_hiv_art_before before insert or update on public.hiv_art
  for each row execute function public.hiv_art_before();

/** Switch regimen with a reason; keeps history. */
create or replace function public.hiv_change_regimen(p_art uuid, p_to text, p_line text, p_reason text, p_on date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare a public.hiv_art;
begin
  select * into a from public.hiv_art where id = p_art for update;
  if not found then raise exception 'ART record not found'; end if;
  if not public.clin_can_access(a.hospital_id) then raise exception 'Only clinical staff can change ART regimens'; end if;
  if coalesce(trim(p_to), '') = '' or coalesce(trim(p_reason), '') = '' then raise exception 'New regimen and reason are required'; end if;
  insert into public.hiv_regimen_changes(hospital_id, art_id, changed_on, from_regimen, to_regimen, to_line, reason)
  values (a.hospital_id, a.id, coalesce(p_on, current_date), a.current_regimen, trim(p_to), p_line, trim(p_reason));
  perform set_config('app.hiv_regimen_logged', 'on', true);
  update public.hiv_art set current_regimen = trim(p_to), regimen_line = coalesce(p_line, regimen_line) where id = a.id;
  perform set_config('app.hiv_regimen_logged', '', true);
end $$;

create table if not exists public.tb_episodes (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  patient_id       uuid not null,
  tb_number        text,
  diagnosis_date   date not null default current_date,
  disease_site     text not null default 'pulmonary' check (disease_site in ('pulmonary', 'extrapulmonary')),
  confirmation     text not null default 'bacteriological' check (confirmation in ('bacteriological', 'clinical')),
  patient_type     text not null default 'new' check (patient_type in ('new', 'relapse', 'treatment_after_failure', 'treatment_after_ltfu', 'transfer_in', 'other')),
  regimen          text not null default '2RHZE/4RH',
  treatment_start  date,
  treatment_months smallint not null default 6 check (treatment_months between 2 and 24),
  hiv_status       text check (hiv_status in ('positive', 'negative', 'unknown')),
  dot_supporter    text,
  dot_supporter_phone text,
  outcome          text check (outcome in ('cured', 'completed', 'failed', 'died', 'ltfu', 'not_evaluated', 'transferred_out')),
  outcome_date     date,
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);
create unique index if not exists tb_one_open_episode on public.tb_episodes(hospital_id, patient_id) where outcome is null;

create table if not exists public.tb_sputum_results (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  episode_id  uuid not null references public.tb_episodes(id) on delete cascade,
  month       smallint not null check (month between 0 and 24),
  sample_date date not null,
  method      text not null default 'smear' check (method in ('smear', 'genexpert', 'culture')),
  result      text not null check (result in ('negative', 'positive', 'mtb_detected', 'mtb_not_detected', 'rif_resistant', 'contaminated')),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (episode_id, month, method)
);

create table if not exists public.tb_dot_log (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  episode_id  uuid not null references public.tb_episodes(id) on delete cascade,
  dose_date   date not null,
  taken       boolean not null,
  observed_by text,
  notes       text,
  created_at  timestamptz not null default now(),
  unique (episode_id, dose_date)
);

/** Phase, follow-up sputum due, adherence and suggested outcome for one episode. */
create or replace function public.tb_status(p_episode uuid, p_today date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e public.tb_episodes; v_days int; v_phase text; v_due int; v_taken int; v_expected int; m int;
begin
  select * into e from public.tb_episodes where id = p_episode;
  if not found or not public.clin_can_access(e.hospital_id) then return null; end if;
  if e.treatment_start is null then return jsonb_build_object('phase', 'not_started'); end if;
  v_days := p_today - e.treatment_start;
  v_phase := case when e.outcome is not null then 'closed' when v_days < 56 then 'intensive'
                  when p_today < (e.treatment_start + make_interval(months => e.treatment_months))::date then 'continuation' else 'course_complete' end;
  if e.disease_site = 'pulmonary' and e.confirmation = 'bacteriological' then
    foreach m in array array[2, 5, 6] loop
      if not exists (select 1 from public.tb_sputum_results s where s.episode_id = e.id and s.month = m) then v_due := m; exit; end if;
    end loop;
  end if;
  select count(*) filter (where taken), count(*) into v_taken, v_expected from public.tb_dot_log where episode_id = e.id;
  return jsonb_build_object(
    'phase', v_phase,
    'day', v_days,
    'next_sputum_month', v_due,
    'next_sputum_date', case when v_due is not null then (e.treatment_start + make_interval(months => v_due))::date end,
    'dot_recorded', v_expected,
    'dot_taken', v_taken,
    'adherence_pct', case when v_expected > 0 then round(100.0 * v_taken / v_expected) end,
    'suggested_outcome', case
      when exists (select 1 from public.tb_sputum_results s where s.episode_id = e.id and s.month >= 5 and s.result in ('positive', 'mtb_detected')) then 'failed'
      when v_phase = 'course_complete' and e.confirmation = 'bacteriological' and e.disease_site = 'pulmonary'
           and exists (select 1 from public.tb_sputum_results s where s.episode_id = e.id and s.month >= 5 and s.result in ('negative', 'mtb_not_detected')) then 'cured'
      when v_phase = 'course_complete' then 'completed' end);
end $$;

create table if not exists public.case_contacts (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  index_patient_id uuid not null,
  programme        text not null check (programme in ('hiv', 'tb')),
  contact_name     text not null,
  relationship     text,
  age_years        numeric,
  sex              text,
  phone            text,
  screened_on      date,
  screening_result text,
  tested_on        date,
  test_result      text check (test_result in ('positive', 'negative', 'known_positive', 'declined', 'pending')),
  linked           boolean not null default false,
  linked_patient_id uuid,
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);

create table if not exists public.anc_pregnancies (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  patient_id    uuid not null,
  anc_number    text,
  lmp           date,
  edd           date,
  gravida       smallint,
  parity        smallint,
  manual_flags  text[] not null default '{}',     -- e.g. previous caesarean, multiple pregnancy
  risk_flags    text[] not null default '{}',     -- computed + manual
  hiv_status    text check (hiv_status in ('positive', 'negative', 'known_positive', 'unknown')),
  syphilis      text check (syphilis in ('positive', 'negative', 'unknown')),
  hb_first      numeric,
  blood_group   text,
  pmtct         jsonb not null default '{}',      -- {"on_art": true, "art_start": "…", "infant_prophylaxis": "AZT+NVP"}
  status        text not null default 'active' check (status in ('active', 'delivered', 'loss', 'transferred_out')),
  outcome_date  date,
  next_contact_due date,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create unique index if not exists anc_one_active_pregnancy on public.anc_pregnancies(hospital_id, patient_id) where status = 'active';

create table if not exists public.anc_contacts (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null,
  pregnancy_id    uuid not null references public.anc_pregnancies(id) on delete cascade,
  visit_date      date not null default current_date,
  contact_number  smallint,
  ga_weeks        smallint,
  bp_sys          numeric, bp_dia numeric,
  weight_kg       numeric,
  fundal_height_cm numeric,
  fetal_heart_rate numeric,
  presentation    text,
  urine_protein   text,
  hb              numeric,
  iptp_dose       smallint,
  td_dose         smallint,
  ifas_given      boolean,
  llin_given      boolean,
  danger_signs    text,
  notes           text,
  risk_flags      text[] not null default '{}',
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists anc_contacts_preg on public.anc_contacts(pregnancy_id, visit_date);

create or replace function public.anc_contact_flags(c public.anc_contacts)
returns text[] language sql immutable as $$
  select array_remove(array[
    case when c.bp_sys >= 160 or c.bp_dia >= 110 then 'severe hypertension'
         when c.bp_sys >= 140 or c.bp_dia >= 90 then 'hypertension' end,
    case when (c.bp_sys >= 140 or c.bp_dia >= 90) and coalesce(c.urine_protein, '') ~ '\+' then 'pre-eclampsia (BP + proteinuria)' end,
    case when c.hb < 7 then 'severe anaemia' when c.hb < 11 then 'anaemia' end,
    case when c.fetal_heart_rate is not null and (c.fetal_heart_rate < 110 or c.fetal_heart_rate > 160) then 'abnormal fetal heart rate' end,
    case when nullif(trim(coalesce(c.danger_signs, '')), '') is not null and lower(trim(c.danger_signs)) not in ('none', 'nil', 'no') then 'danger signs reported' end
  ], null)
$$;

/** WHO 8-contact schedule: weeks of gestation for contacts 1..8. */
create or replace function public.anc_schedule_weeks()
returns int[] language sql immutable as $$ select array[12, 20, 26, 30, 34, 36, 38, 40] $$;

create or replace function public.anc_refresh(p_pregnancy uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p public.anc_pregnancies; v_flags text[]; v_age numeric; v_count int; v_ga int; w int; v_next date;
begin
  select * into p from public.anc_pregnancies where id = p_pregnancy for update;
  if not found then return; end if;
  select coalesce(array_agg(distinct f), '{}') into v_flags
    from public.anc_contacts c, unnest(c.risk_flags) f where c.pregnancy_id = p_pregnancy;
  v_age := public.clin_patient_age(p.patient_id);
  if v_age < 18 then v_flags := array_append(v_flags, 'adolescent (<18)'::text); elsif v_age >= 35 then v_flags := array_append(v_flags, 'age 35+'::text); end if;
  if p.parity >= 5 then v_flags := array_append(v_flags, 'grand multipara'::text); end if;
  if p.hiv_status in ('positive', 'known_positive') then v_flags := array_append(v_flags, 'HIV positive (PMTCT)'::text); end if;
  if p.syphilis = 'positive' then v_flags := array_append(v_flags, 'syphilis positive'::text); end if;
  if p.hb_first < 11 then v_flags := array_append(v_flags, 'anaemia at booking'::text); end if;
  v_flags := v_flags || coalesce(p.manual_flags, '{}');
  select count(*) into v_count from public.anc_contacts where pregnancy_id = p_pregnancy;
  if p.lmp is not null and p.status = 'active' then
    select max(ga_weeks) into v_ga from public.anc_contacts where pregnancy_id = p_pregnancy;
    if v_ga is null then v_ga := greatest((current_date - p.lmp) / 7 - 1, 0); end if;
    foreach w in array public.anc_schedule_weeks() loop
      if w > v_ga then v_next := p.lmp + w * 7; exit; end if;
    end loop;
  end if;
  update public.anc_pregnancies set
    risk_flags = (select coalesce(array_agg(distinct x), '{}') from unnest(v_flags) x),
    next_contact_due = v_next
  where id = p_pregnancy;
end $$;

create or replace function public.anc_contacts_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.anc_pregnancies;
begin
  select * into p from public.anc_pregnancies where id = new.pregnancy_id;
  if not found then raise exception 'Pregnancy not found'; end if;
  new.hospital_id := p.hospital_id;
  if p.lmp is not null then new.ga_weeks := (new.visit_date - p.lmp) / 7; end if;
  if tg_op = 'INSERT' and new.contact_number is null then
    new.contact_number := (select count(*) + 1 from public.anc_contacts where pregnancy_id = new.pregnancy_id);
  end if;
  new.risk_flags := public.anc_contact_flags(new);
  return new;
end $$;
drop trigger if exists trg_anc_contacts_before on public.anc_contacts;
create trigger trg_anc_contacts_before before insert or update on public.anc_contacts
  for each row execute function public.anc_contacts_before();

create or replace function public.anc_contacts_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.anc_refresh(coalesce(new.pregnancy_id, old.pregnancy_id)); return null; end $$;
drop trigger if exists trg_anc_contacts_after on public.anc_contacts;
create trigger trg_anc_contacts_after after insert or update or delete on public.anc_contacts
  for each row execute function public.anc_contacts_after();

create or replace function public.anc_pregnancies_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.lmp is not null and new.edd is null then new.edd := new.lmp + 280; end if;
  else
    if new.lmp is distinct from old.lmp and new.lmp is not null and new.edd is not distinct from old.edd then new.edd := new.lmp + 280; end if;
    if new.status is distinct from old.status then new.outcome_date := coalesce(new.outcome_date, current_date); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_anc_pregnancies_before on public.anc_pregnancies;
create trigger trg_anc_pregnancies_before before insert or update on public.anc_pregnancies
  for each row execute function public.anc_pregnancies_before();

create or replace function public.anc_pregnancies_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.anc_refresh(new.id);
  elsif new.lmp is distinct from old.lmp or new.parity is distinct from old.parity
     or new.hiv_status is distinct from old.hiv_status or new.syphilis is distinct from old.syphilis
     or new.hb_first is distinct from old.hb_first or new.manual_flags is distinct from old.manual_flags or new.status is distinct from old.status then
    perform public.anc_refresh(new.id);
  end if;
  return null;
end $$;
drop trigger if exists trg_anc_pregnancies_after on public.anc_pregnancies;
create trigger trg_anc_pregnancies_after after insert or update on public.anc_pregnancies
  for each row execute function public.anc_pregnancies_after();

create table if not exists public.labour_admissions (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  pregnancy_id  uuid references public.anc_pregnancies(id) on delete set null,
  patient_id    uuid not null,
  admitted_at   timestamptz not null default now(),
  status        text not null default 'in_labour' check (status in ('in_labour', 'delivered', 'referred', 'false_labour')),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);

create table if not exists public.partograph_entries (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  labour_id        uuid not null references public.labour_admissions(id) on delete cascade,
  recorded_at      timestamptz not null default now(),
  cervix_cm        numeric check (cervix_cm between 0 and 10),
  descent_fifths   smallint check (descent_fifths between 0 and 5),
  contractions_10min smallint check (contractions_10min between 0 and 10),
  contraction_secs smallint,
  fetal_heart_rate numeric,
  liquor           text,
  moulding         text,
  bp_sys           numeric, bp_dia numeric,
  pulse            numeric,
  temp_c           numeric,
  urine            text,
  oxytocin         text,
  drugs            text,
  recorded_by      uuid default auth.uid()
);
create index if not exists partograph_labour on public.partograph_entries(labour_id, recorded_at);

create table if not exists public.deliveries (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null,
  labour_id       uuid references public.labour_admissions(id) on delete set null,
  pregnancy_id    uuid references public.anc_pregnancies(id) on delete set null,
  patient_id      uuid not null,
  delivered_at    timestamptz not null default now(),
  mode            text not null check (mode in ('svd', 'assisted_vaginal', 'breech', 'caesarean')),
  amtsl_oxytocin  boolean,
  blood_loss_ml   numeric,
  perineum        text,
  maternal_outcome text not null default 'alive' check (maternal_outcome in ('alive', 'died', 'referred')),
  complications   text,
  delivered_by    text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);

create table if not exists public.newborns (
  id               uuid primary key default gen_random_uuid(),
  hospital_id      uuid not null,
  delivery_id      uuid not null references public.deliveries(id) on delete cascade,
  baby_patient_id  uuid,
  sex              text check (sex in ('male', 'female', 'indeterminate')),
  outcome          text not null default 'live_birth' check (outcome in ('live_birth', 'fresh_stillbirth', 'macerated_stillbirth', 'early_neonatal_death')),
  birth_weight_g   numeric,
  apgar_1          smallint check (apgar_1 between 0 and 10),
  apgar_5          smallint check (apgar_5 between 0 and 10),
  resuscitated     boolean,
  vitamin_k        boolean,
  teo              boolean,
  bcg              boolean,
  opv0             boolean,
  breastfed_1h     boolean,
  arv_prophylaxis  text,
  notes            text,
  created_at       timestamptz not null default now()
);

create table if not exists public.pnc_visits (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid not null,
  pregnancy_id  uuid references public.anc_pregnancies(id) on delete set null,
  patient_id    uuid not null,
  visit_date    date not null default current_date,
  timing        text check (timing in ('48h', '3-7d', '1-2wk', '4-6wk', 'other')),
  bp_sys        numeric, bp_dia numeric,
  temp_c        numeric,
  bleeding      text,
  breasts       text,
  baby_weight_g numeric,
  baby_feeding  text,
  fp_method     text,
  danger_signs  text,
  notes         text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);

create table if not exists public.immunisations (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  patient_id   uuid not null,
  vaccine      text not null,
  given_on     date not null default current_date,
  batch_number text,
  given_by     text,
  notes        text,
  created_at   timestamptz not null default now(),
  unique (patient_id, vaccine)
);

do $$
declare r record;
begin
  for r in select * from (values ('hiv_art', 'patient_id'), ('tb_episodes', 'patient_id'), ('case_contacts', 'index_patient_id'),
                                 ('anc_pregnancies', 'patient_id'), ('labour_admissions', 'patient_id'), ('deliveries', 'patient_id'),
                                 ('pnc_visits', 'patient_id'), ('immunisations', 'patient_id')) as t(tbl, col) loop
    begin
      execute format('alter table public.%I add constraint %I foreign key (%I) references public.patients(id) on delete cascade', r.tbl, r.tbl || '_' || r.col || '_fk', r.col);
    exception when duplicate_object then null;
              when others then raise notice 'FK %.% not added: %', r.tbl, r.col, sqlerrm;
    end;
  end loop;
end $$;

create or replace function public.programme_summary(p_hospital uuid, p_from date, p_to date)
returns table(indicator text, value bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Clinical access required'; end if;
  return query
  select 'anc_first_contacts', count(*) from public.anc_contacts c join public.anc_pregnancies p on p.id = c.pregnancy_id
    where p.hospital_id = p_hospital and c.contact_number = 1 and c.visit_date between p_from and p_to
  union all select 'anc_4th_contacts', count(*) from public.anc_contacts c join public.anc_pregnancies p on p.id = c.pregnancy_id
    where p.hospital_id = p_hospital and c.contact_number = 4 and c.visit_date between p_from and p_to
  union all select 'anc_8th_contacts', count(*) from public.anc_contacts c join public.anc_pregnancies p on p.id = c.pregnancy_id
    where p.hospital_id = p_hospital and c.contact_number = 8 and c.visit_date between p_from and p_to
  union all select 'anc_first_contact_before_12w', count(*) from public.anc_contacts c join public.anc_pregnancies p on p.id = c.pregnancy_id
    where p.hospital_id = p_hospital and c.contact_number = 1 and c.ga_weeks <= 12 and c.visit_date between p_from and p_to
  union all select 'deliveries', count(*) from public.deliveries d where d.hospital_id = p_hospital and d.delivered_at::date between p_from and p_to
  union all select 'deliveries_caesarean', count(*) from public.deliveries d where d.hospital_id = p_hospital and d.mode = 'caesarean' and d.delivered_at::date between p_from and p_to
  union all select 'pph_500ml_plus', count(*) from public.deliveries d where d.hospital_id = p_hospital and d.blood_loss_ml >= 500 and d.delivered_at::date between p_from and p_to
  union all select 'maternal_deaths', count(*) from public.deliveries d where d.hospital_id = p_hospital and d.maternal_outcome = 'died' and d.delivered_at::date between p_from and p_to
  union all select 'live_births', count(*) from public.newborns n join public.deliveries d on d.id = n.delivery_id
    where d.hospital_id = p_hospital and n.outcome = 'live_birth' and d.delivered_at::date between p_from and p_to
  union all select 'fresh_stillbirths', count(*) from public.newborns n join public.deliveries d on d.id = n.delivery_id
    where d.hospital_id = p_hospital and n.outcome = 'fresh_stillbirth' and d.delivered_at::date between p_from and p_to
  union all select 'macerated_stillbirths', count(*) from public.newborns n join public.deliveries d on d.id = n.delivery_id
    where d.hospital_id = p_hospital and n.outcome = 'macerated_stillbirth' and d.delivered_at::date between p_from and p_to
  union all select 'low_birth_weight', count(*) from public.newborns n join public.deliveries d on d.id = n.delivery_id
    where d.hospital_id = p_hospital and n.outcome = 'live_birth' and n.birth_weight_g < 2500 and d.delivered_at::date between p_from and p_to
  union all select 'pnc_48h', count(*) from public.pnc_visits v where v.hospital_id = p_hospital and v.timing = '48h' and v.visit_date between p_from and p_to
  union all select 'hiv_tx_curr', count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.status = 'active' and a.art_start_date <= p_to
  union all select 'hiv_tx_new', count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.art_start_date between p_from and p_to
  union all select 'hiv_vl_tested_12m', count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.status = 'active' and a.last_vl_date > p_to - 365
  union all select 'hiv_vl_suppressed_12m', count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.status = 'active' and a.last_vl_date > p_to - 365 and a.last_vl_value < 200
  union all select 'hiv_vl_overdue', count(*) from public.hiv_art a where a.hospital_id = p_hospital and a.status = 'active' and a.next_vl_due < p_to
  union all select 'tb_notified', count(*) from public.tb_episodes e where e.hospital_id = p_hospital and e.diagnosis_date between p_from and p_to
  union all select 'tb_notified_bacteriological', count(*) from public.tb_episodes e where e.hospital_id = p_hospital and e.confirmation = 'bacteriological' and e.diagnosis_date between p_from and p_to
  union all select 'tb_hiv_positive', count(*) from public.tb_episodes e where e.hospital_id = p_hospital and e.hiv_status = 'positive' and e.diagnosis_date between p_from and p_to
  union all select 'tb_success', count(*) from public.tb_episodes e where e.hospital_id = p_hospital and e.outcome in ('cured', 'completed') and e.outcome_date between p_from and p_to
  union all select 'immunised_penta3', count(*) from public.immunisations i where i.hospital_id = p_hospital and i.vaccine = 'PENTA3' and i.given_on between p_from and p_to
  union all select 'immunised_mr1', count(*) from public.immunisations i where i.hospital_id = p_hospital and i.vaccine = 'MR1' and i.given_on between p_from and p_to;
end $$;

do $$
declare t text;
begin
  foreach t in array array['hiv_art', 'hiv_regimen_changes', 'hiv_viral_loads', 'tb_episodes', 'tb_sputum_results', 'tb_dot_log',
                           'case_contacts', 'anc_pregnancies', 'anc_contacts', 'labour_admissions', 'partograph_entries',
                           'deliveries', 'newborns', 'pnc_visits', 'immunisations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_clinical', t);
    execute format('create policy %I on public.%I for all using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id))', t || '_clinical', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke update, delete on public.hiv_regimen_changes from authenticated;

revoke execute on function public.hiv_refresh(uuid), public.anc_refresh(uuid), public.clin_patient_age(uuid, date) from public, anon, authenticated;
grant execute on function public.hiv_refresh(uuid), public.anc_refresh(uuid), public.clin_patient_age(uuid, date) to service_role;
grant execute on function public.clin_can_access(uuid), public.hiv_change_regimen(uuid, text, text, text, date),
  public.tb_status(uuid, date), public.programme_summary(uuid, date, date) to authenticated, service_role;

commit;

select 'tables' as check_name, case when (select count(*) from pg_class where oid in (to_regclass('public.hiv_art'), to_regclass('public.hiv_viral_loads'),
      to_regclass('public.tb_episodes'), to_regclass('public.tb_dot_log'), to_regclass('public.anc_pregnancies'), to_regclass('public.anc_contacts'),
      to_regclass('public.partograph_entries'), to_regclass('public.deliveries'), to_regclass('public.newborns'), to_regclass('public.immunisations'))) = 10 then 'OK' else 'PROBLEM' end as result
    union all select 'clinical-only access', case when (select count(*) from pg_policies where schemaname = 'public' and policyname like '%_clinical') >= 15 then 'OK' else 'PROBLEM' end
    union all select 'viral load schedule', case when public.hiv_next_vl_due(date '2026-01-01', null, null, 30, false) = date '2026-04-01' then 'OK' else 'PROBLEM' end;
