-- Specialty clinic templates: neurology (Glasgow Coma Scale, NIH Stroke Scale) and urology (IPSS + quality of life, PSA,
-- post-void residual). specialty_score() is redefined with every earlier template unchanged plus the two new branches;
-- src/utils/specialtyTemplates.js mirrors it (the db test compares them).

do $$ begin
  if to_regclass('public.specialty_assessments') is null then raise exception 'Run 27_specialty_assessments.sql first. Nothing was changed.'; end if;
end $$;

alter table public.specialty_assessments drop constraint if exists specialty_assessments_template_check;
alter table public.specialty_assessments add constraint specialty_assessments_template_check
  check (template in ('mental_health', 'eye', 'dental', 'ent', 'physio', 'cardiology', 'dermatology', 'orthopaedics', 'oncology', 'neurology', 'urology'));

create or replace function public.specialty_score(p_template text, d jsonb)
returns jsonb language plpgsql immutable as $$
declare s jsonb := '{}'; f jsonb := '[]'; ht numeric; wt numeric; bsa numeric; v numeric; w numeric; risk text; r numeric; l numeric; better numeric; cat text; age numeric; female boolean; male_score int; total int;
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

  elsif p_template = 'orthopaedics' then
    if coalesce(d->>'fracture_type', '') <> '' then
      s := s || jsonb_build_object('fracture', case when d->>'fracture_type' = 'open' then 'open' || case when coalesce(nullif(d->>'gustilo', ''), 'na') <> 'na' then ' ' || (d->>'gustilo') else '' end else 'closed' end);
    end if;
    if public.spec_num(d, 'weeks') is not null then s := s || jsonb_build_object('weeks', public.spec_num(d, 'weeks')); end if;
    if coalesce(d->>'union', '') <> '' then s := s || jsonb_build_object('union', d->>'union'); end if;
    if d->>'fracture_type' = 'open' then f := f || '["Open fracture: IV antibiotics within 1 hour, tetanus prophylaxis, debridement within 24 hours"]'; end if;
    if coalesce(d->>'gustilo', '') like 'III%' then f := f || '["Gustilo III: urgent orthopaedic and plastic surgery review"]'; end if;
    if d->>'pulse' = 'absent' or d->>'cap_refill' = 'gt2' or d->>'sensation' = 'reduced' or d->>'movement' = 'reduced' then
      f := f || '["Neurovascular compromise: urgent review — reduce the fracture / split the cast"]';
    end if;
    if d->>'passive_stretch_pain' = 'yes' or d->>'pain_out_of_proportion' = 'yes' then
      f := f || '["Possible compartment syndrome: split the cast to skin, keep the limb at heart level, urgent surgical review (fasciotomy)"]';
    end if;
    if d->>'cast' = 'tight' then f := f || '["Tight cast: split or replace now"]'; end if;
    if d->>'union' = 'non_union' or (public.spec_num(d, 'weeks') >= 24 and d->>'union' = 'not_united') then f := f || '["Non-union: refer for surgical review"]'; end if;

  elsif p_template = 'oncology' then
    ht := public.spec_num(d, 'height_cm'); wt := public.spec_num(d, 'weight_kg');
    if ht > 0 and wt > 0 then
      bsa := round(sqrt(ht * wt / 3600), 2);
      s := s || jsonb_build_object('bsa', bsa);
      if public.spec_num(d, 'dose_mg_m2') > 0 then s := s || jsonb_build_object('planned_dose_mg', round(public.spec_num(d, 'dose_mg_m2') * bsa)); end if;
    end if;
    if coalesce(d->>'ecog', '') <> '' then s := s || jsonb_build_object('ecog', public.spec_num(d, 'ecog')); end if;
    if public.spec_num(d, 'cycle_number') is not null then s := s || jsonb_build_object('cycle', public.spec_num(d, 'cycle_number')); end if;
    if public.spec_num(d, 'ecog') >= 3 then f := f || '["ECOG 3–4: chemotherapy is usually not appropriate — review treatment intent"]'; end if;
    if public.spec_num(d, 'anc') < 1.5 then f := f || '["Neutrophils below 1.5 ×10⁹/L: delay the cycle"]'; end if;
    if public.spec_num(d, 'platelets') < 100 then f := f || '["Platelets below 100 ×10⁹/L: delay the cycle"]'; end if;
    if public.spec_num(d, 'hb') < 8 then f := f || '["Hb below 8 g/dL: consider transfusion before chemotherapy"]'; end if;
  elsif p_template = 'neurology' then
    v := public.spec_sum(d, array['gcs_e','gcs_v','gcs_m']);
    if v is not null then s := s || jsonb_build_object('gcs', v, 'gcs_band', case when v <= 8 then 'Severe' when v <= 12 then 'Moderate' else 'Mild' end); end if;
    w := public.spec_sum(d, array['n1a','n1b','n1c','n2','n3','n4','n5a','n5b','n6a','n6b','n7','n8','n9','n10','n11']);
    if w is not null then s := s || jsonb_build_object('nihss', w, 'nihss_band', case when w = 0 then 'No stroke symptoms' when w <= 4 then 'Minor stroke' when w <= 15 then 'Moderate stroke' when w <= 20 then 'Moderate to severe stroke' else 'Severe stroke' end); end if;
    if v <= 8 then f := f || '["GCS 8 or less: protect the airway — urgent senior / ICU review"]'; end if;
    if public.spec_num(d, 'onset_hours') <= 4.5 and w > 0 then f := f || '["Stroke symptoms within 4.5 hours of onset: urgent brain CT — assess for thrombolysis where available"]'; end if;
    if w >= 16 then f := f || '["NIHSS 16 or more: severe stroke — high-dependency care, swallow screen before oral intake"]'; end if;

  elsif p_template = 'urology' then
    v := public.spec_sum(d, array['i1','i2','i3','i4','i5','i6','i7']);
    if v is not null then s := s || jsonb_build_object('ipss', v, 'ipss_band', case when v >= 20 then 'Severe' when v >= 8 then 'Moderate' else 'Mild' end); end if;
    if public.spec_num(d, 'ipss_qol') is not null then s := s || jsonb_build_object('ipss_qol', public.spec_num(d, 'ipss_qol')); end if;
    if v >= 20 then f := f || '["IPSS 20 or more: severe lower urinary tract symptoms — urology review for medical or surgical treatment"]'; end if;
    if public.spec_num(d, 'psa') > 4 then f := f || '["PSA above 4 ng/mL: repeat and assess for prostate cancer (consider age and prostate size)"]'; end if;
    if public.spec_num(d, 'pvr_ml') >= 300 then f := f || '["Post-void residual 300 mL or more: chronic urinary retention — catheter and urology review"]'; end if;
  end if;
  return jsonb_build_object('scores', s, 'flags', f);
end $$;
