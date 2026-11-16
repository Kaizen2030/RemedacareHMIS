-- Specialty clinic assessments: structured templates (mental health, eye, dental, ENT, physiotherapy, cardiology,
-- dermatology) whose scores and alerts are computed here — PHQ-9, GAD-7, C-SSRS screen, AUDIT-C, WHO visual impairment
-- category and IOP, DMFT and BPE, tonsil grade / CSOM / hearing, Barthel index, CHA2DS2-VASc, body surface area.
-- High suicide risk posts a hospital alert. Records are immutable (amend with a new assessment). Clinical staff only.
-- The app mirrors specialty_score() in src/utils/specialtyTemplates.js.

create table if not exists public.specialty_assessments (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid not null,
  patient_id   uuid not null,
  visit_id     text,
  template     text not null check (template in ('mental_health', 'eye', 'dental', 'ent', 'physio', 'cardiology', 'dermatology')),
  data         jsonb not null default '{}'::jsonb,
  scores       jsonb not null default '{}'::jsonb,
  flags        jsonb not null default '[]'::jsonb,
  amends       uuid references public.specialty_assessments(id),
  recorded_by  uuid default auth.uid(),
  recorded_by_name text,
  created_at   timestamptz not null default now()
);
create index if not exists specialty_assessments_patient on public.specialty_assessments(hospital_id, patient_id, template, created_at desc);

create or replace function public.spec_num(d jsonb, k text)
returns numeric language sql immutable as $$ select nullif(d->>k, '')::numeric $$;

-- sum of the keys, or null if any is missing
create or replace function public.spec_sum(d jsonb, keys text[])
returns numeric language sql immutable as $$
  select case when bool_or(nullif(d->>k, '') is null) then null else sum((d->>k)::numeric) end from unnest(keys) k
$$;

create or replace function public.spec_va(v text)
returns numeric language plpgsql immutable as $$
declare s text := upper(trim(coalesce(v, ''))); m text[];
begin
  if s = '' then return null; end if;
  if s = 'CF' then return 0.02; elsif s = 'HM' then return 0.01; elsif s = 'PL' then return 0.001; elsif s = 'NPL' then return 0; end if;
  m := regexp_match(s, '^(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)$');
  if m is null or m[2]::numeric = 0 then return null; end if;
  return round(m[1]::numeric / m[2]::numeric, 3);
end $$;

create or replace function public.specialty_score(p_template text, d jsonb)
returns jsonb language plpgsql immutable as $$
declare s jsonb := '{}'; f jsonb := '[]'; v numeric; w numeric; risk text; r numeric; l numeric; better numeric; cat text; age numeric; female boolean; male_score int; total int;
begin
  if p_template = 'mental_health' then
    v := public.spec_sum(d, array['q1','q2','q3','q4','q5','q6','q7','q8','q9']);
    if v is not null then s := s || jsonb_build_object('phq9', v, 'phq9_band', case when v >= 20 then 'Severe' when v >= 15 then 'Moderately severe' when v >= 10 then 'Moderate' when v >= 5 then 'Mild' else 'Minimal' end); end if;
    w := public.spec_sum(d, array['g1','g2','g3','g4','g5','g6','g7']);
    if w is not null then s := s || jsonb_build_object('gad7', w, 'gad7_band', case when w >= 15 then 'Severe' when w >= 10 then 'Moderate' when w >= 5 then 'Mild' else 'Minimal' end); end if;
    risk := case when 'yes' in (d->>'c4', d->>'c5', d->>'c6') then 'high' when d->>'c3' = 'yes' then 'moderate' when 'yes' in (d->>'c1', d->>'c2') then 'low'
                 when 'no' in (d->>'c1', d->>'c2', d->>'c3', d->>'c4', d->>'c5', d->>'c6') then 'none' end;
    if risk is not null then s := s || jsonb_build_object('suicide_risk', risk); end if;
    if risk = 'high' or public.spec_num(d, 'q9') > 0 then
      f := f || jsonb_build_array(case when risk = 'high' then 'HIGH suicide risk: do not leave the patient alone; same-day psychiatric review; remove means' else 'PHQ-9 item 9 positive: complete the suicide risk screen now' end);
    elsif risk = 'moderate' then f := f || '["Moderate suicide risk: safety plan and early review"]';
    end if;
    total := public.spec_sum(d, array['a1','a2','a3']);
    if total is not null then
      s := s || jsonb_build_object('audit_c', total);
      if total >= (case when d->>'sex' = 'female' then 3 else 4 end) then f := f || '["AUDIT-C positive: hazardous drinking — brief intervention"]'; end if;
    end if;
    if v >= 15 then f := f || '["PHQ-9 15 or more: treatment for depression indicated"]'; end if;
    if w >= 10 then f := f || '["GAD-7 10 or more: probable anxiety disorder"]'; end if;

  elsif p_template = 'eye' then
    r := public.spec_va(d->>'va_r'); l := public.spec_va(d->>'va_l');
    if r is not null or l is not null then
      better := greatest(coalesce(r, -1), coalesce(l, -1));
      cat := case when better >= 0.5 then 'No impairment' when better >= 0.3 then 'Mild impairment' when better >= 0.1 then 'Moderate impairment' when better >= 0.05 then 'Severe impairment' else 'Blindness' end;
      s := s || jsonb_build_object('better_eye_decimal', better, 'who_category', cat);
    end if;
    if public.spec_num(d, 'iop_r') > 21 then f := f || jsonb_build_array('Raised intraocular pressure right (' || (d->>'iop_r') || ' mmHg): glaucoma assessment'); end if;
    if public.spec_num(d, 'iop_l') > 21 then f := f || jsonb_build_array('Raised intraocular pressure left (' || (d->>'iop_l') || ' mmHg): glaucoma assessment'); end if;
    if cat is not null and cat not in ('No impairment', 'Mild impairment') then f := f || jsonb_build_array(cat || ' (better eye): refer / register for low-vision services'); end if;
    if public.spec_va(d->>'ph_r') > r then f := f || '["Pinhole improves the right eye: refractive error — refraction needed"]'; end if;
    if public.spec_va(d->>'ph_l') > l then f := f || '["Pinhole improves the left eye: refractive error — refraction needed"]'; end if;

  elsif p_template = 'dental' then
    s := jsonb_build_object(
      'D', (select count(*) from jsonb_each_text(coalesce(d->'teeth', '{}')) where value in ('caries', 'extract')),
      'M', (select count(*) from jsonb_each_text(coalesce(d->'teeth', '{}')) where value = 'missing'),
      'F', (select count(*) from jsonb_each_text(coalesce(d->'teeth', '{}')) where value in ('filled', 'crown')));
    s := s || jsonb_build_object('DMFT', (s->>'D')::int + (s->>'M')::int + (s->>'F')::int);
    v := (select max(nullif(d->>k, '')::numeric) from unnest(array['s1','s2','s3','s4','s5','s6']) k);
    if v is not null then
      s := s || jsonb_build_object('bpe_max', v);
      if v = 4 then f := f || '["BPE code 4 (pocket over 5.5 mm): full periodontal charting and treatment"]'; end if;
    end if;
    if exists (select 1 from jsonb_each_text(coalesce(d->'teeth', '{}')) where value = 'extract') then f := f || '["Teeth marked for extraction"]'; end if;

  elsif p_template = 'ent' then
    v := public.spec_num(d, 'tonsils');
    if v is not null then s := s || jsonb_build_object('tonsil_grade', v); end if;
    if v >= 3 and d->>'snoring' in ('snoring', 'apnoea') then f := f || '["Large tonsils with snoring / apnoea: assess for obstructive sleep apnoea — consider tonsillectomy referral"]'; end if;
    if 'perforation' in (d->>'tm_r', d->>'tm_l') and d->>'discharge' = 'ge2w' then f := f || '["Perforation with discharge 2 weeks or more: chronic suppurative otitis media"]'; end if;
    if coalesce(d->>'whisper', '') like 'fail%' then f := f || '["Failed whisper test: audiometry"]'; end if;

  elsif p_template = 'physio' then
    v := public.spec_sum(d, array['feeding','bathing','grooming','dressing','bowels','bladder','toilet','transfers','mobility','stairs']);
    if v is not null then s := s || jsonb_build_object('barthel', v, 'barthel_band', case when v = 100 then 'Independent' when v >= 91 then 'Slight dependency' when v >= 61 then 'Moderate dependency' when v >= 21 then 'Severe dependency' else 'Total dependency' end); end if;
    if public.spec_num(d, 'pain_move') >= 7 then f := f || '["Severe pain on movement: review analgesia"]'; end if;

  elsif p_template = 'cardiology' then
    age := public.spec_num(d, 'age'); female := d->>'sex' = 'female';
    if d->>'af' = 'yes' and age is not null and coalesce(d->>'sex', '') <> '' then
      total := (case when coalesce((d->>'chf')::boolean, false) then 1 else 0 end) + (case when coalesce((d->>'htn')::boolean, false) then 1 else 0 end)
             + (case when coalesce((d->>'diabetes')::boolean, false) then 1 else 0 end) + (case when coalesce((d->>'stroke')::boolean, false) then 2 else 0 end)
             + (case when coalesce((d->>'vascular')::boolean, false) then 1 else 0 end) + (case when age >= 75 then 2 when age >= 65 then 1 else 0 end) + (case when female then 1 else 0 end);
      male_score := total - case when female then 1 else 0 end;
      s := s || jsonb_build_object('cha2ds2_vasc', total, 'anticoagulation', case when male_score >= 2 then 'Recommended' when male_score = 1 then 'Consider' else 'Not indicated' end);
      if male_score >= 2 then f := f || jsonb_build_array('CHA₂DS₂-VASc ' || total || ': oral anticoagulation recommended unless contraindicated (check bleeding risk)'); end if;
    end if;
    if public.spec_num(d, 'nyha') >= 3 then f := f || jsonb_build_array('NYHA class ' || case when d->>'nyha' = '4' then 'IV' else 'III' end || ': optimise heart failure treatment'); end if;

  elsif p_template = 'dermatology' then
    v := public.spec_num(d, 'bsa');
    if v is not null then s := s || jsonb_build_object('bsa', v, 'extent', case when v > 10 then 'Severe (over 10%)' when v >= 3 then 'Moderate (3–10%)' else 'Mild (under 3%)' end); end if;
    if v > 10 then f := f || '["Over 10% body surface: consider systemic treatment / specialist review"]'; end if;
  end if;
  return jsonb_build_object('scores', s, 'flags', f);
end $$;

create or replace function public.specialty_assessments_before()
returns trigger language plpgsql as $$
declare r jsonb;
begin
  if tg_op = 'UPDATE' then raise exception 'Assessments cannot be changed; record an amended assessment'; end if;
  r := public.specialty_score(new.template, new.data);
  new.scores := r->'scores'; new.flags := r->'flags';
  new.created_at := now();
  return new;
end $$;
drop trigger if exists trg_specialty_assessments_before on public.specialty_assessments;
create trigger trg_specialty_assessments_before before insert or update on public.specialty_assessments for each row execute function public.specialty_assessments_before();

create or replace function public.specialty_assessments_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.scores->>'suicide_risk' = 'high' then
    begin
      execute 'insert into public.notifications(hospital_id, notification_type, title, message, target_path, payload_json) values ($1, ''alert'', ''High suicide risk'', $2, ''/consultation'', $3)'
        using new.hospital_id, 'A patient screened at high suicide risk. Do not leave them alone; same-day psychiatric review.', jsonb_build_object('assessment_id', new.id, 'patient_id', new.patient_id, 'visit_id', new.visit_id);
    exception when others then raise warning 'suicide risk alert skipped: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists trg_specialty_assessments_after on public.specialty_assessments;
create trigger trg_specialty_assessments_after after insert on public.specialty_assessments for each row execute function public.specialty_assessments_after();

alter table public.specialty_assessments enable row level security;
drop policy if exists specialty_assessments_clinical on public.specialty_assessments;
create policy specialty_assessments_clinical on public.specialty_assessments for all to authenticated using (public.clin_can_access(hospital_id)) with check (public.clin_can_access(hospital_id));
revoke all on public.specialty_assessments from anon;
grant select, insert on public.specialty_assessments to authenticated;
grant all on public.specialty_assessments to service_role;
revoke execute on function public.specialty_assessments_before(), public.specialty_assessments_after() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.audit_row_change()') is not null then
    execute 'drop trigger if exists trg_audit_change on public.specialty_assessments';
    execute 'create trigger trg_audit_change after insert or update or delete on public.specialty_assessments for each row execute function public.audit_row_change()';
  end if;
end $$;
