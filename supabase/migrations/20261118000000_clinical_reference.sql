-- =============================================================================
-- RemedacareHMS — clinical reference data and decision-support audit
--   icd10_codes      ICD-10 (WHO) with ICD-11 MMS mapping; searchable with icd_search()
--   loinc_codes      LOINC lab test codes; searchable with loinc_search()
--   drug_interactions  extra interaction rules per hospital (built-in rules live in the app)
--   cds_overrides    every overridden safety alert, with the written reason — append-only, copied to audit_log
--
-- Seed: a Kenyan outpatient core set (MOH 705-style conditions). ICD-11 codes are filled only where the
-- mapping is certain; load the full WHO ICD-10 list and WHO 10→11 mapping, and the LOINC table, with
-- scripts/import-reference.mjs (it writes paste-ready SQL). Safe to re-run.
-- This material contains content from LOINC (http://loinc.org). LOINC is copyright Regenstrief Institute,
-- Inc. and the LOINC Committee and is available at no cost under the license at http://loinc.org/license.
-- =============================================================================

create table if not exists public.icd10_codes (
  code          text primary key,
  title         text not null,
  chapter       text,
  icd11_code    text,
  icd11_title   text,
  kenya_common  boolean not null default false,
  search_text   text generated always as (lower(code || ' ' || title || ' ' || coalesce(icd11_code, '') || ' ' || coalesce(icd11_title, ''))) stored
);
create index if not exists icd10_codes_search on public.icd10_codes(search_text text_pattern_ops);

create table if not exists public.loinc_codes (
  code        text primary key,
  long_name   text not null,
  short_name  text,
  component   text,
  system      text,
  unit        text,
  common      boolean not null default false,
  search_text text generated always as (lower(code || ' ' || long_name || ' ' || coalesce(short_name, '') || ' ' || coalesce(component, ''))) stored
);

do $$ begin
  create extension if not exists pg_trgm;
  execute 'create index if not exists icd10_codes_trgm on public.icd10_codes using gin (search_text gin_trgm_ops)';
  execute 'create index if not exists loinc_codes_trgm on public.loinc_codes using gin (search_text gin_trgm_ops)';
exception when others then raise notice 'pg_trgm not available; plain search is used (%)', sqlerrm;
end $$;

insert into public.icd10_codes(code, title, chapter, icd11_code, kenya_common) values
  ('A00.9', 'Cholera, unspecified', 'I', '1A00', true),
  ('A01.0', 'Typhoid fever', 'I', '1A07', true),
  ('A06.0', 'Acute amoebic dysentery', 'I', null, true),
  ('A09', 'Other gastroenteritis and colitis of infectious and unspecified origin (diarrhoea)', 'I', '1A40.Z', true),
  ('A15.0', 'Tuberculosis of lung, confirmed by sputum microscopy', 'I', null, true),
  ('A16.2', 'Tuberculosis of lung, without bacteriological or histological confirmation', 'I', null, true),
  ('A41.9', 'Sepsis, unspecified', 'I', '1G40', true),
  ('A53.9', 'Syphilis, unspecified', 'I', null, true),
  ('A54.9', 'Gonococcal infection, unspecified', 'I', null, true),
  ('A82.9', 'Rabies, unspecified', 'I', '1C82', true),
  ('A90', 'Dengue fever', 'I', null, true),
  ('B01.9', 'Varicella without complication', 'I', null, true),
  ('B05.9', 'Measles without complication', 'I', null, true),
  ('B15.9', 'Hepatitis A without hepatic coma', 'I', '1E50.0', true),
  ('B16.9', 'Acute hepatitis B without delta-agent and without hepatic coma', 'I', '1E50.1', true),
  ('B18.1', 'Chronic viral hepatitis B without delta-agent', 'I', '1E51.0', true),
  ('B18.2', 'Chronic viral hepatitis C', 'I', '1E51.1', true),
  ('B20', 'HIV disease resulting in infectious and parasitic diseases', 'I', null, true),
  ('B24', 'Unspecified human immunodeficiency virus [HIV] disease', 'I', null, true),
  ('B35.0', 'Tinea barbae and tinea capitis', 'I', null, true),
  ('B35.4', 'Tinea corporis', 'I', null, true),
  ('B37.0', 'Candidal stomatitis (oral thrush)', 'I', null, true),
  ('B37.3', 'Candidiasis of vulva and vagina', 'I', null, true),
  ('B50.0', 'Plasmodium falciparum malaria with cerebral complications', 'I', null, true),
  ('B50.9', 'Plasmodium falciparum malaria, unspecified', 'I', '1F40.Z', true),
  ('B54', 'Unspecified malaria', 'I', '1F4Z', true),
  ('B55.0', 'Visceral leishmaniasis (kala-azar)', 'I', null, true),
  ('B65.9', 'Schistosomiasis, unspecified', 'I', null, true),
  ('B76.9', 'Hookworm disease, unspecified', 'I', null, true),
  ('B82.9', 'Intestinal parasitism, unspecified', 'I', null, true),
  ('B86', 'Scabies', 'I', '1G04', true),
  ('C50.9', 'Malignant neoplasm of breast, unspecified', 'II', null, true),
  ('C53.9', 'Malignant neoplasm of cervix uteri, unspecified', 'II', null, true),
  ('C15.9', 'Malignant neoplasm of oesophagus, unspecified', 'II', null, true),
  ('C16.9', 'Malignant neoplasm of stomach, unspecified', 'II', null, true),
  ('C61', 'Malignant neoplasm of prostate', 'II', null, true),
  ('D50.9', 'Iron deficiency anaemia, unspecified', 'III', null, true),
  ('D57.1', 'Sickle-cell anaemia without crisis', 'III', null, true),
  ('D57.0', 'Sickle-cell anaemia with crisis', 'III', null, true),
  ('D64.9', 'Anaemia, unspecified', 'III', '3A9Z', true),
  ('E03.9', 'Hypothyroidism, unspecified', 'IV', null, true),
  ('E05.9', 'Thyrotoxicosis, unspecified', 'IV', null, true),
  ('E10.9', 'Type 1 diabetes mellitus without complications', 'IV', null, true),
  ('E11.9', 'Type 2 diabetes mellitus without complications', 'IV', null, true),
  ('E11.6', 'Type 2 diabetes mellitus with other specified complications', 'IV', null, true),
  ('E14.9', 'Unspecified diabetes mellitus without complications', 'IV', null, true),
  ('E40', 'Kwashiorkor', 'IV', null, true),
  ('E41', 'Nutritional marasmus', 'IV', null, true),
  ('E43', 'Unspecified severe protein-energy malnutrition', 'IV', null, true),
  ('E44.0', 'Moderate protein-energy malnutrition', 'IV', null, true),
  ('E66.9', 'Obesity, unspecified', 'IV', null, true),
  ('E78.5', 'Hyperlipidaemia, unspecified', 'IV', null, true),
  ('E86', 'Volume depletion (dehydration)', 'IV', null, true),
  ('F10.2', 'Mental and behavioural disorders due to use of alcohol: dependence syndrome', 'V', null, true),
  ('F20.9', 'Schizophrenia, unspecified', 'V', null, true),
  ('F32.9', 'Depressive episode, unspecified', 'V', null, true),
  ('F41.1', 'Generalized anxiety disorder', 'V', null, true),
  ('G40.9', 'Epilepsy, unspecified', 'VI', null, true),
  ('G43.9', 'Migraine, unspecified', 'VI', null, true),
  ('G03.9', 'Meningitis, unspecified', 'VI', null, true),
  ('H10.9', 'Conjunctivitis, unspecified', 'VII', null, true),
  ('H26.9', 'Cataract, unspecified', 'VII', null, true),
  ('H40.9', 'Glaucoma, unspecified', 'VII', null, true),
  ('H66.9', 'Otitis media, unspecified', 'VIII', null, true),
  ('I10', 'Essential (primary) hypertension', 'IX', null, true),
  ('I21.9', 'Acute myocardial infarction, unspecified', 'IX', null, true),
  ('I50.9', 'Heart failure, unspecified', 'IX', null, true),
  ('I64', 'Stroke, not specified as haemorrhage or infarction', 'IX', null, true),
  ('J00', 'Acute nasopharyngitis [common cold]', 'X', null, true),
  ('J02.9', 'Acute pharyngitis, unspecified', 'X', null, true),
  ('J03.9', 'Acute tonsillitis, unspecified', 'X', null, true),
  ('J06.9', 'Acute upper respiratory infection, unspecified', 'X', null, true),
  ('J18.9', 'Pneumonia, unspecified', 'X', null, true),
  ('J20.9', 'Acute bronchitis, unspecified', 'X', null, true),
  ('J45.9', 'Asthma, unspecified', 'X', null, true),
  ('J44.9', 'Chronic obstructive pulmonary disease, unspecified', 'X', null, true),
  ('K02.9', 'Dental caries, unspecified', 'XI', null, true),
  ('K04.7', 'Periapical abscess without sinus (dental abscess)', 'XI', null, true),
  ('K27.9', 'Peptic ulcer, unspecified', 'XI', null, true),
  ('K29.7', 'Gastritis, unspecified', 'XI', null, true),
  ('K30', 'Dyspepsia', 'XI', null, true),
  ('K35.8', 'Acute appendicitis, other and unspecified', 'XI', null, true),
  ('K40.9', 'Unilateral or unspecified inguinal hernia, without obstruction or gangrene', 'XI', null, true),
  ('K59.0', 'Constipation', 'XI', null, true),
  ('L02.9', 'Cutaneous abscess, furuncle and carbuncle, unspecified', 'XII', null, true),
  ('L03.9', 'Cellulitis, unspecified', 'XII', null, true),
  ('L08.9', 'Local infection of skin and subcutaneous tissue, unspecified', 'XII', null, true),
  ('L30.9', 'Dermatitis, unspecified', 'XII', null, true),
  ('L50.9', 'Urticaria, unspecified', 'XII', null, true),
  ('M10.9', 'Gout, unspecified', 'XIII', null, true),
  ('M19.9', 'Arthrosis, unspecified', 'XIII', null, true),
  ('M54.5', 'Low back pain', 'XIII', null, true),
  ('M79.1', 'Myalgia', 'XIII', null, true),
  ('N18.9', 'Chronic kidney disease, unspecified', 'XIV', null, true),
  ('N20.0', 'Calculus of kidney', 'XIV', null, true),
  ('N39.0', 'Urinary tract infection, site not specified', 'XIV', null, true),
  ('N40', 'Hyperplasia of prostate', 'XIV', null, true),
  ('N73.9', 'Female pelvic inflammatory disease, unspecified', 'XIV', null, true),
  ('N76.0', 'Acute vaginitis', 'XIV', null, true),
  ('O03.9', 'Spontaneous abortion, complete or unspecified, without complication', 'XV', null, true),
  ('O14.9', 'Pre-eclampsia, unspecified', 'XV', null, true),
  ('O15.9', 'Eclampsia, unspecified as to time period', 'XV', null, true),
  ('O72.1', 'Other immediate postpartum haemorrhage', 'XV', null, true),
  ('O80', 'Single spontaneous delivery', 'XV', null, true),
  ('O82', 'Single delivery by caesarean section', 'XV', null, true),
  ('P07.3', 'Other preterm infants', 'XVI', null, true),
  ('P21.9', 'Birth asphyxia, unspecified', 'XVI', null, true),
  ('P36.9', 'Bacterial sepsis of newborn, unspecified', 'XVI', null, true),
  ('P59.9', 'Neonatal jaundice, unspecified', 'XVI', null, true),
  ('R05', 'Cough', 'XVIII', null, true),
  ('R10.4', 'Other and unspecified abdominal pain', 'XVIII', null, true),
  ('R50.9', 'Fever, unspecified', 'XVIII', null, true),
  ('R51', 'Headache', 'XVIII', null, true),
  ('R56.0', 'Febrile convulsions', 'XVIII', null, true),
  ('S09.9', 'Unspecified injury of head', 'XIX', null, true),
  ('S52.5', 'Fracture of lower end of radius', 'XIX', null, true),
  ('S82.2', 'Fracture of shaft of tibia', 'XIX', null, true),
  ('T14.1', 'Open wound of unspecified body region', 'XIX', null, true),
  ('T30.0', 'Burn of unspecified body region, unspecified degree', 'XIX', null, true),
  ('T63.0', 'Toxic effect of snake venom', 'XIX', null, true),
  ('T65.9', 'Toxic effect of unspecified substance (poisoning)', 'XIX', null, true),
  ('W54', 'Bitten or struck by dog', 'XX', null, true),
  ('V89.2', 'Person injured in unspecified motor-vehicle accident, traffic', 'XX', null, true),
  ('Z00.0', 'General medical examination', 'XXI', null, true),
  ('Z21', 'Asymptomatic human immunodeficiency virus [HIV] infection status', 'XXI', null, true),
  ('Z23', 'Need for immunization against single bacterial diseases', 'XXI', null, true),
  ('Z30.0', 'General counselling and advice on contraception', 'XXI', null, true),
  ('Z34.9', 'Supervision of normal pregnancy, unspecified', 'XXI', null, true),
  ('Z39.2', 'Routine postpartum follow-up', 'XXI', null, true)
on conflict (code) do nothing;

insert into public.loinc_codes(code, long_name, short_name, component, system, unit, common) values
  ('58410-2', 'CBC panel - Blood by Automated count', 'CBC panel Bld Auto', 'CBC panel', 'Bld', null, true),
  ('718-7', 'Hemoglobin [Mass/volume] in Blood', 'Hgb Bld-mCnc', 'Hemoglobin', 'Bld', 'g/dL', true),
  ('4544-3', 'Hematocrit [Volume Fraction] of Blood by Automated count', 'Hct VFr Bld Auto', 'Hematocrit', 'Bld', '%', true),
  ('6690-2', 'Leukocytes [#/volume] in Blood by Automated count', 'WBC # Bld Auto', 'Leukocytes', 'Bld', '10*3/uL', true),
  ('789-8', 'Erythrocytes [#/volume] in Blood by Automated count', 'RBC # Bld Auto', 'Erythrocytes', 'Bld', '10*6/uL', true),
  ('787-2', 'MCV [Entitic volume] by Automated count', 'MCV RBC Auto', 'MCV', 'RBC', 'fL', true),
  ('777-3', 'Platelets [#/volume] in Blood by Automated count', 'Platelet # Bld Auto', 'Platelets', 'Bld', '10*3/uL', true),
  ('30341-2', 'Erythrocyte sedimentation rate', 'ESR Bld', 'ESR', 'Bld', 'mm/h', true),
  ('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', 'HbA1c MFr Bld', 'Hemoglobin A1c', 'Bld', '%', true),
  ('1558-6', 'Fasting glucose [Mass/volume] in Serum or Plasma', 'Glucose p fast SerPl-mCnc', 'Glucose', 'Ser/Plas', 'mg/dL', true),
  ('14771-0', 'Fasting glucose [Moles/volume] in Serum or Plasma', 'Glucose p fast SerPl-sCnc', 'Glucose', 'Ser/Plas', 'mmol/L', true),
  ('2345-7', 'Glucose [Mass/volume] in Serum or Plasma', 'Glucose SerPl-mCnc', 'Glucose', 'Ser/Plas', 'mg/dL', true),
  ('15074-8', 'Glucose [Moles/volume] in Blood', 'Glucose Bld-sCnc', 'Glucose', 'Bld', 'mmol/L', true),
  ('2160-0', 'Creatinine [Mass/volume] in Serum or Plasma', 'Creat SerPl-mCnc', 'Creatinine', 'Ser/Plas', 'mg/dL', true),
  ('14682-9', 'Creatinine [Moles/volume] in Serum or Plasma', 'Creat SerPl-sCnc', 'Creatinine', 'Ser/Plas', 'umol/L', true),
  ('98979-8', 'Glomerular filtration rate/1.73 sq M.predicted [Volume Rate/Area] in Serum, Plasma or Blood by Creatinine-based formula (CKD-EPI 2021)', 'eGFRcr CKD-EPI 2021', 'GFR', 'Ser/Plas/Bld', 'mL/min/1.73m2', true),
  ('3094-0', 'Urea nitrogen [Mass/volume] in Serum or Plasma', 'BUN SerPl-mCnc', 'Urea nitrogen', 'Ser/Plas', 'mg/dL', true),
  ('2951-2', 'Sodium [Moles/volume] in Serum or Plasma', 'Sodium SerPl-sCnc', 'Sodium', 'Ser/Plas', 'mmol/L', true),
  ('2823-3', 'Potassium [Moles/volume] in Serum or Plasma', 'Potassium SerPl-sCnc', 'Potassium', 'Ser/Plas', 'mmol/L', true),
  ('2075-0', 'Chloride [Moles/volume] in Serum or Plasma', 'Chloride SerPl-sCnc', 'Chloride', 'Ser/Plas', 'mmol/L', true),
  ('17861-6', 'Calcium [Mass/volume] in Serum or Plasma', 'Calcium SerPl-mCnc', 'Calcium', 'Ser/Plas', 'mg/dL', true),
  ('1742-6', 'Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma', 'ALT SerPl-cCnc', 'ALT', 'Ser/Plas', 'U/L', true),
  ('1920-8', 'Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma', 'AST SerPl-cCnc', 'AST', 'Ser/Plas', 'U/L', true),
  ('6768-6', 'Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma', 'ALP SerPl-cCnc', 'ALP', 'Ser/Plas', 'U/L', true),
  ('1975-2', 'Bilirubin.total [Mass/volume] in Serum or Plasma', 'Bilirub SerPl-mCnc', 'Bilirubin', 'Ser/Plas', 'mg/dL', true),
  ('1751-7', 'Albumin [Mass/volume] in Serum or Plasma', 'Albumin SerPl-mCnc', 'Albumin', 'Ser/Plas', 'g/dL', true),
  ('2885-2', 'Protein [Mass/volume] in Serum or Plasma', 'Prot SerPl-mCnc', 'Protein', 'Ser/Plas', 'g/dL', true),
  ('2093-3', 'Cholesterol [Mass/volume] in Serum or Plasma', 'Cholest SerPl-mCnc', 'Cholesterol', 'Ser/Plas', 'mg/dL', true),
  ('2571-8', 'Triglyceride [Mass/volume] in Serum or Plasma', 'Trigl SerPl-mCnc', 'Triglyceride', 'Ser/Plas', 'mg/dL', true),
  ('2085-9', 'Cholesterol in HDL [Mass/volume] in Serum or Plasma', 'HDLc SerPl-mCnc', 'HDL cholesterol', 'Ser/Plas', 'mg/dL', true),
  ('13457-7', 'Cholesterol in LDL [Mass/volume] in Serum or Plasma by calculation', 'LDLc SerPl Calc-mCnc', 'LDL cholesterol', 'Ser/Plas', 'mg/dL', true),
  ('3084-1', 'Urate [Mass/volume] in Serum or Plasma', 'Urate SerPl-mCnc', 'Urate', 'Ser/Plas', 'mg/dL', true),
  ('3016-3', 'Thyrotropin [Units/volume] in Serum or Plasma', 'TSH SerPl-aCnc', 'TSH', 'Ser/Plas', 'mIU/L', true),
  ('2276-4', 'Ferritin [Mass/volume] in Serum or Plasma', 'Ferritin SerPl-mCnc', 'Ferritin', 'Ser/Plas', 'ng/mL', true),
  ('1988-5', 'C reactive protein [Mass/volume] in Serum or Plasma', 'CRP SerPl-mCnc', 'CRP', 'Ser/Plas', 'mg/L', true),
  ('5902-2', 'Prothrombin time (PT)', 'PT', 'Prothrombin time', 'PPP', 's', true),
  ('6301-6', 'INR in Platelet poor plasma by Coagulation assay', 'INR PPP', 'INR', 'PPP', null, true),
  ('20447-9', 'HIV 1 RNA [#/volume] (viral load) in Serum or Plasma by NAA with probe detection', 'HIV1 RNA # SerPl NAA+probe', 'HIV 1 RNA', 'Ser/Plas', 'copies/mL', true),
  ('24467-3', 'CD3+CD4+ (T4 helper) cells [#/volume] in Blood', 'CD3+CD4+ cells # Bld', 'CD4 count', 'Bld', 'cells/uL', true),
  ('32700-7', 'Plasmodium sp identified in Blood by Light microscopy', 'Plasmodium sp Bld Light micro', 'Malaria smear', 'Bld', null, true),
  ('5196-1', 'Hepatitis B virus surface Ag [Presence] in Serum', 'HBV surface Ag Ser Ql', 'HBsAg', 'Ser', null, true),
  ('20507-0', 'Reagin Ab [Presence] in Serum by RPR', 'RPR Ser Ql', 'RPR', 'Ser', null, true),
  ('2106-3', 'Choriogonadotropin (pregnancy test) [Presence] in Urine', 'HCG Ur Ql', 'Pregnancy test', 'Urine', null, true),
  ('24356-8', 'Urinalysis complete panel - Urine', 'UA panel Ur', 'Urinalysis', 'Urine', null, true),
  ('14957-5', 'Microalbumin [Mass/volume] in Urine', 'Microalbumin Ur-mCnc', 'Microalbumin', 'Urine', 'mg/L', true),
  ('9318-7', 'Albumin/Creatinine [Mass Ratio] in Urine', 'Albumin/Creat Ur', 'ACR', 'Urine', 'mg/g', true),
  ('600-7', 'Bacteria identified in Blood by Culture', 'Bacteria Bld Cult', 'Blood culture', 'Bld', null, true),
  ('630-4', 'Bacteria identified in Urine by Culture', 'Bacteria Ur Cult', 'Urine culture', 'Urine', null, true),
  ('883-9', 'ABO group [Type] in Blood', 'ABO group Bld', 'ABO group', 'Bld', null, true),
  ('10331-7', 'Rh [Type] in Blood', 'Rh Bld', 'Rh type', 'Bld', null, true)
on conflict (code) do nothing;

create or replace function public.icd_search(p_query text, p_limit integer default 20)
returns table(code text, title text, icd11_code text, icd11_title text, kenya_common boolean)
language sql stable security invoker set search_path = public as $$
  with q as (select lower(trim(coalesce(p_query, ''))) as t)
  select c.code, c.title, c.icd11_code, c.icd11_title, c.kenya_common
    from public.icd10_codes c, q
   where length(q.t) >= 2
     and (c.search_text like '%' || q.t || '%'
          or (select bool_and(c.search_text like '%' || w || '%') from unnest(string_to_array(q.t, ' ')) w where w <> ''))
   order by (lower(c.code) = q.t) desc, (lower(c.code) like q.t || '%') desc, c.kenya_common desc, length(c.title), c.code
   limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

create or replace function public.loinc_search(p_query text, p_limit integer default 20)
returns table(code text, long_name text, short_name text, unit text)
language sql stable security invoker set search_path = public as $$
  with q as (select lower(trim(coalesce(p_query, ''))) as t)
  select c.code, c.long_name, c.short_name, c.unit
    from public.loinc_codes c, q
   where length(q.t) >= 2
     and (select bool_and(c.search_text like '%' || w || '%') from unnest(string_to_array(q.t, ' ')) w where w <> '')
   order by (c.code = q.t) desc, c.common desc, length(c.long_name)
   limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

-- ---------------------------------------------------------------- hospital interaction rules
create table if not exists public.drug_interactions (
  id          uuid primary key default gen_random_uuid(),
  hospital_id uuid not null,
  a           text not null,               -- drug id (e.g. 'warfarin') or 'class:nsaid'
  b           text not null,
  severity    text not null check (severity in ('contraindicated', 'major', 'moderate')),
  message     text not null,
  active      boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- overrides: append-only + audit trail
create table if not exists public.cds_overrides (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid,
  visit_id       uuid,
  patient_id     uuid,
  doctor_name    text,
  drug_name      text,
  rule           text,
  acknowledged_at timestamptz default now()
);
alter table public.cds_overrides add column if not exists severity text;
alter table public.cds_overrides add column if not exists message text;
alter table public.cds_overrides add column if not exists reason text;
alter table public.cds_overrides add column if not exists user_role text;
alter table public.cds_overrides add column if not exists overridden_by uuid default auth.uid();
alter table public.cds_overrides add column if not exists created_at timestamptz not null default now();

-- Older installs created cds_overrides.hospital_id as text. Work with either type instead of altering it.
create or replace function public.ref_try_uuid(p text)
returns uuid language sql immutable as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

create or replace function public.cds_overrides_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.overridden_by := coalesce(auth.uid(), new.overridden_by);
  if public.ref_try_uuid(new.hospital_id::text) is not null then
    perform public.payments_audit(public.ref_try_uuid(new.hospital_id::text), 'cds_alert_overridden',
      case when (to_jsonb(new)->>'id') ~* '^[0-9a-f-]{36}$' then (to_jsonb(new)->>'id')::uuid end,
      jsonb_build_object('drug', new.drug_name, 'rule', new.rule, 'severity', new.severity, 'message', new.message,
                         'reason', new.reason, 'patient_id', new.patient_id, 'visit_id', new.visit_id, 'by', new.doctor_name));
  end if;
  return new;
end $$;
drop trigger if exists trg_cds_overrides_audit on public.cds_overrides;
create trigger trg_cds_overrides_audit before insert on public.cds_overrides
  for each row execute function public.cds_overrides_audit();

-- ---------------------------------------------------------------- security
alter table public.icd10_codes enable row level security;
alter table public.loinc_codes enable row level security;
alter table public.drug_interactions enable row level security;
alter table public.cds_overrides enable row level security;

drop policy if exists icd10_codes_read on public.icd10_codes;
create policy icd10_codes_read on public.icd10_codes for select using (true);
drop policy if exists loinc_codes_read on public.loinc_codes;
create policy loinc_codes_read on public.loinc_codes for select using (true);

drop policy if exists drug_interactions_read on public.drug_interactions;
create policy drug_interactions_read on public.drug_interactions for select using (public.pay_is_member(hospital_id));
drop policy if exists drug_interactions_write on public.drug_interactions;
create policy drug_interactions_write on public.drug_interactions for all
  using (public.pay_canonical_role(public.pay_member_role(hospital_id)) = 'admin')
  with check (public.pay_canonical_role(public.pay_member_role(hospital_id)) = 'admin');

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'cds_overrides' loop
    execute format('drop policy if exists %I on public.cds_overrides', p.policyname);
  end loop;
end $$;
create policy cds_overrides_read on public.cds_overrides for select
  using (public.ref_try_uuid(hospital_id::text) is not null and public.pay_is_member(public.ref_try_uuid(hospital_id::text)));
create policy cds_overrides_insert on public.cds_overrides for insert
  with check (public.ref_try_uuid(hospital_id::text) is not null and public.pay_is_member(public.ref_try_uuid(hospital_id::text)));

grant select on public.icd10_codes, public.loinc_codes to anon, authenticated;
grant select, insert, update, delete on public.drug_interactions to authenticated;
revoke update, delete on public.cds_overrides from authenticated, anon;
grant select, insert on public.cds_overrides to authenticated;
grant all on public.icd10_codes, public.loinc_codes, public.drug_interactions, public.cds_overrides to service_role;
grant execute on function public.icd_search(text, integer), public.loinc_search(text, integer) to anon, authenticated, service_role;
