-- =============================================================================
-- RemedacareHMS - MATERNITY REGISTERS: MOH 405 (ANC) AND MOH 406 (MATERNITY) FROM THE CLINICAL RECORDS
-- Generated from supabase/migrations/20261210000000_maternity_registers.sql - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.clin_can_access(uuid)') is null then
    raise exception 'Run 08_hiv_tb_maternity.sql first. Nothing was changed.';
  end if;
end $$;

do $$ begin
  if to_regclass('public.anc_contacts') is null or to_regclass('public.deliveries') is null then
    raise exception 'Maternity tables not found: run 08_hiv_tb_maternity.sql first. Nothing was changed.';
  end if;
end $$;

alter table public.anc_contacts add column if not exists muac_cm numeric;
alter table public.anc_contacts add column if not exists height_cm numeric;
alter table public.anc_contacts add column if not exists rbs numeric;
alter table public.anc_contacts add column if not exists hiv_test text check (hiv_test in ('known_positive', 'tested_negative', 'tested_positive', 'not_tested', 'declined'));
alter table public.anc_contacts add column if not exists syphilis_test text check (syphilis_test in ('negative', 'positive', 'not_done'));
alter table public.anc_contacts add column if not exists partner_hiv text check (partner_hiv in ('negative', 'positive', 'not_tested', 'unknown'));
alter table public.anc_contacts add column if not exists tb_screening text check (tb_screening in ('negative', 'presumptive', 'on_treatment', 'not_done'));
alter table public.anc_contacts add column if not exists deworming boolean;
alter table public.anc_contacts add column if not exists counselling text[] not null default '{}';
alter table public.anc_contacts add column if not exists referred_to text;
alter table public.anc_pregnancies add column if not exists marital_status text;

alter table public.deliveries add column if not exists ip_number text;
alter table public.deliveries add column if not exists labour_hours numeric;
alter table public.deliveries add column if not exists placenta_complete boolean;
alter table public.deliveries add column if not exists uterotonic text check (uterotonic in ('oxytocin', 'carbetocin', 'misoprostol', 'ergometrine', 'none'));
alter table public.deliveries add column if not exists delivered_by_cadre text check (delivered_by_cadre in ('doctor', 'clinical_officer', 'nurse_midwife', 'other'));
alter table public.deliveries add column if not exists mother_hiv text check (mother_hiv in ('negative', 'positive', 'unknown'));
alter table public.deliveries add column if not exists maternal_arv boolean;
alter table public.deliveries add column if not exists discharged_at timestamptz;
alter table public.newborns add column if not exists chlorhexidine boolean;
alter table public.newborns add column if not exists kmc boolean;

create or replace function public.moh405_register(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Only clinical staff can see the ANC register'; end if;
  with c as (
    select c.*, row_number() over (partition by c.pregnancy_id order by c.visit_date, c.created_at) as seq
      from public.anc_contacts c where c.hospital_id = p_hospital
  ), rows as (
    select c.visit_date, c.created_at, jsonb_build_object(
      'visit_date', c.visit_date, 'anc_number', g.anc_number,
      'visit', case when coalesce(c.contact_number, c.seq) = 1 then '1st' else 'Re-visit' end,
      'contact_number', coalesce(c.contact_number, c.seq),
      'name', pj->>'full_name',
      'age', coalesce(nullif(pj->>'age', ''), case when nullif(pj->>'date_of_birth', '') is not null then floor(extract(year from age(c.visit_date, (pj->>'date_of_birth')::date)))::text end),
      'residence', coalesce(pj->>'village', pj->>'residence', pj->>'address', pj->>'location', pj->>'county'),
      'phone', coalesce(pj->>'phone', pj->>'phone_number', pj->>'mobile'),
      'marital_status', coalesce(g.marital_status, pj->>'marital_status'),
      'gravida', g.gravida, 'parity', g.parity, 'lmp', g.lmp, 'edd', g.edd,
      'ga_weeks', coalesce(c.ga_weeks, case when g.lmp is not null then ((c.visit_date - g.lmp) / 7) end),
      'muac', c.muac_cm, 'height', c.height_cm, 'weight', c.weight_kg,
      'bp', case when c.bp_sys is not null then c.bp_sys || '/' || coalesce(c.bp_dia::text, '?') end,
      'hb', c.hb, 'rbs', c.rbs, 'urine', c.urine_protein, 'blood_group', coalesce(g.blood_group, pj->>'blood_group'),
      'syphilis', coalesce(c.syphilis_test, case when coalesce(c.contact_number, c.seq) = 1 then g.syphilis end),
      'hiv', coalesce(c.hiv_test, case when coalesce(c.contact_number, c.seq) = 1 then g.hiv_status end),
      'partner_hiv', c.partner_hiv,
      'maternal_art', case when g.pmtct->>'on_art' = 'true' then 'Yes' end,
      'iptp', c.iptp_dose, 'td', c.td_dose,
      'ifas', case when c.ifas_given then 'Yes' when c.ifas_given = false then 'No' end,
      'llin', case when c.llin_given then 'Yes' when c.llin_given = false then 'No' end,
      'deworming', case when c.deworming then 'Yes' when c.deworming = false then 'No' end,
      'tb_screening', c.tb_screening,
      'counselling', array_to_string(c.counselling, ', '),
      'referred_to', c.referred_to,
      'risk_flags', array_to_string(c.risk_flags || g.risk_flags, ', '),
      'missing', to_jsonb(array_remove(array[
        case when g.anc_number is null then 'ANC no.' end,
        case when c.bp_sys is null then 'BP' end,
        case when c.weight_kg is null then 'weight' end,
        case when coalesce(c.contact_number, c.seq) = 1 and c.hb is null and g.hb_first is null then 'Hb' end,
        case when coalesce(c.contact_number, c.seq) = 1 and coalesce(c.hiv_test, g.hiv_status) is null then 'HIV' end,
        case when coalesce(c.contact_number, c.seq) = 1 and coalesce(c.syphilis_test, g.syphilis) is null then 'syphilis' end,
        case when coalesce(c.contact_number, c.seq) = 1 and c.muac_cm is null then 'MUAC' end,
        case when c.tb_screening is null then 'TB screen' end,
        case when c.ifas_given is null then 'IFAS' end
      ], null))) as row
      from c
      join public.anc_pregnancies g on g.id = c.pregnancy_id
      left join lateral (select to_jsonb(p) pj from public.patients p where p.id = g.patient_id) pp on true
     where c.visit_date between p_from and p_to
  )
  select coalesce(jsonb_agg(row || jsonb_build_object('serial', n) order by visit_date, created_at), '[]'::jsonb) into r
    from (select *, row_number() over (order by visit_date, created_at) n from rows) x;
  return r;
end $$;

create or replace function public.moh406_register(p_hospital uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.clin_can_access(p_hospital) then raise exception 'Only clinical staff can see the maternity register'; end if;
  with d as (
    select d.*, row_number() over (order by d.delivered_at, d.created_at) as serial
      from public.deliveries d where d.hospital_id = p_hospital and d.delivered_at >= p_from and d.delivered_at < p_to + 1
  ), rows as (
    select d.serial, coalesce(b.created_at, d.created_at) as bt, jsonb_build_object(
      'serial', d.serial::text || case when count(*) over (partition by d.id) > 1 then chr(96 + (row_number() over (partition by d.id order by b.created_at, b.id))::int) else '' end,
      'admitted_at', l.admitted_at, 'ip_number', d.ip_number,
      'name', pj->>'full_name',
      'age', coalesce(nullif(pj->>'age', ''), case when nullif(pj->>'date_of_birth', '') is not null then floor(extract(year from age(d.delivered_at::date, (pj->>'date_of_birth')::date)))::text end),
      'gravida', g.gravida, 'parity', g.parity,
      'anc_visits', (select count(*) from public.anc_contacts ac where ac.pregnancy_id = d.pregnancy_id),
      'ga_weeks', case when g.lmp is not null then ((d.delivered_at::date - g.lmp) / 7) end,
      'delivered_at', d.delivered_at, 'labour_hours', coalesce(d.labour_hours, round((extract(epoch from d.delivered_at - l.admitted_at) / 3600)::numeric, 1)),
      'mode', d.mode, 'placenta_complete', case when d.placenta_complete then 'Yes' when d.placenta_complete = false then 'No' end,
      'uterotonic', coalesce(d.uterotonic, case when d.amtsl_oxytocin then 'oxytocin' when d.amtsl_oxytocin = false then 'none' end),
      'blood_loss_ml', d.blood_loss_ml, 'perineum', d.perineum, 'mother_condition', d.maternal_outcome, 'complications', d.complications,
      'baby_sex', b.sex, 'birth_weight_g', b.birth_weight_g, 'apgar_1', b.apgar_1, 'apgar_5', b.apgar_5, 'baby_outcome', b.outcome,
      'resuscitated', case when b.resuscitated then 'Yes' end,
      'bf_1h', case when b.breastfed_1h then 'Yes' when b.breastfed_1h = false then 'No' end,
      'teo', case when b.teo then 'Yes' when b.teo = false then 'No' end,
      'vitamin_k', case when b.vitamin_k then 'Yes' when b.vitamin_k = false then 'No' end,
      'chlorhexidine', case when b.chlorhexidine then 'Yes' when b.chlorhexidine = false then 'No' end,
      'mother_hiv', coalesce(d.mother_hiv, case when g.hiv_status in ('positive', 'known_positive') then 'positive' when g.hiv_status = 'negative' then 'negative' end),
      'maternal_arv', case when coalesce(d.maternal_arv, g.pmtct->>'on_art' = 'true') then 'Yes' end,
      'infant_arv', b.arv_prophylaxis,
      'delivered_by', concat_ws(' — ', d.delivered_by, d.delivered_by_cadre),
      'discharged_at', d.discharged_at,
      'missing', to_jsonb(array_remove(array[
        case when d.blood_loss_ml is null then 'blood loss' end,
        case when d.uterotonic is null and d.amtsl_oxytocin is null then 'uterotonic' end,
        case when b.id is null then 'baby details' end,
        case when b.id is not null and b.birth_weight_g is null then 'birth weight' end,
        case when b.outcome = 'live_birth' and b.apgar_5 is null then 'APGAR 5' end,
        case when b.outcome = 'live_birth' and b.breastfed_1h is null then 'breastfeeding 1 h' end,
        case when coalesce(d.mother_hiv, g.hiv_status) is null then 'mother HIV' end,
        case when d.delivered_by_cadre is null and d.delivered_by is null then 'delivered by' end
      ], null))) as row
      from d
      left join public.newborns b on b.delivery_id = d.id
      left join public.labour_admissions l on l.id = d.labour_id
      left join public.anc_pregnancies g on g.id = d.pregnancy_id
      left join lateral (select to_jsonb(p) pj from public.patients p where p.id = d.patient_id) pp on true
  )
  select coalesce(jsonb_agg(row order by serial, bt), '[]'::jsonb) into r from rows;
  return r;
end $$;

revoke execute on function public.moh405_register(uuid, date, date), public.moh406_register(uuid, date, date) from public, anon;
grant execute on function public.moh405_register(uuid, date, date), public.moh406_register(uuid, date, date) to authenticated, service_role;

commit;

select 'register functions' as check_name, case when to_regprocedure('public.moh405_register(uuid,date,date)') is not null and to_regprocedure('public.moh406_register(uuid,date,date)') is not null and exists (select 1 from information_schema.columns where table_name = 'deliveries' and column_name = 'uterotonic') then 'OK' else 'PROBLEM' end as result;
