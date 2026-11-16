// Regenerates 02_install_payments.sql from the migration (run: node docs/sql/build-install.mjs).
import { readFileSync, writeFileSync } from 'node:fs'
const migration = readFileSync(new URL('../../supabase/migrations/20261114000000_payments_ledger.sql', import.meta.url), 'utf8')

const header = `-- =============================================================================
-- RemedacareHMS — INSTALL / UPDATE the payments ledger (all-in-one)
-- Generated from supabase/migrations/20261114000000_payments_ledger.sql — do not edit by hand.
--
-- 1. Run 01_check_current_supabase.sql first and fix every BLOCKER.
-- 2. Take a backup: Supabase → Database → Backups (or pg_dump). This script also keeps a
--    private copy of the invoices table in schema payments_backup.
-- 3. Paste this whole file into Supabase → SQL Editor → Run.
--    Everything runs in ONE transaction: if any statement fails, nothing is changed.
-- 4. The last result is a health check. Every row should say OK.
-- Safe to run again later (it is idempotent).
-- =============================================================================

begin;

-- Stop at once if this is not the RemedacareHMS database (wrong Supabase project).
do $$ begin
  if to_regclass('public.invoices') is null or to_regclass('public.hospital_users') is null
     or to_regclass('public.staff') is null or to_regclass('public.hospitals') is null then
    raise exception 'This database has no RemedacareHMS tables (invoices, hospital_users, staff, hospitals). You are probably in the wrong Supabase project. Open the project your app uses (VITE_SUPABASE_URL in .env) and run it there. Nothing was changed.';
  end if;
end $$;

-- Private snapshot of invoices as they were before the ledger (not exposed to the API).
create schema if not exists payments_backup;
revoke all on schema payments_backup from public;
do $$ begin
  if to_regclass('payments_backup.invoices_before_ledger') is null then
    create table payments_backup.invoices_before_ledger as select now() as snapshot_at, i.* from public.invoices i;
  end if;
end $$;
do $$ begin
  execute 'revoke all on schema payments_backup from anon, authenticated';
exception when undefined_object then null; end $$;

`
const footer = `

commit;

-- ---------------------------------------------------------------- health check (read-only)
select check_name, case when ok then 'OK' else 'PROBLEM' end as result, detail from (
  select 'tables created' as check_name,
         (select count(*) from pg_class where oid in (to_regclass('public.payments'), to_regclass('public.receipt_counters'),
           to_regclass('public.payment_events'), to_regclass('public.hospital_payment_settings'),
           to_regclass('public.hospital_payment_credentials'), to_regclass('public.payment_daily_summary'))) = 6 as ok,
         '6 expected' as detail
  union all
  select 'invoice triggers', (select count(*) from pg_trigger where tgrelid = 'public.invoices'::regclass
           and tgname in ('trg_invoices_guard_ledger', 'trg_invoices_sync_ledger')) = 2, 'guard + bridge'
  union all
  select 'payment triggers', (select count(*) from pg_trigger where tgrelid = 'public.payments'::regclass
           and tgname in ('trg_payments_before_write', 'trg_payments_after_write')) = 2, 'immutability + recompute'
  union all
  select 'history back-filled', true,
         (select count(*) || ' legacy payments, KES ' || coalesce(sum(amount), 0) from public.payments where source = 'legacy_backfill')
  union all
  select 'paid_kes matches the ledger', count(*) = 0, count(*) || ' invoices differ' from (
    select i.id from public.invoices i
    left join public.payments p on p.invoice_id = i.id and p.status = 'completed'
    where i.hospital_id is not null
    group by i.id, i.paid_kes
    having round(coalesce(i.paid_kes, 0), 2) <> round(greatest(coalesce(sum(case when p.kind = 'payment' then p.amount else -p.amount end), 0), 0), 2)) d
  union all
  select 'browser cannot call internal functions',
         not has_function_privilege('authenticated', 'public.next_receipt_no(uuid, text)', 'execute')
         and not has_function_privilege('authenticated', 'public.payments_audit(uuid, text, uuid, jsonb)', 'execute'),
         'next_receipt_no / payments_audit revoked'
  union all
  select 'browser cannot write payments', not has_table_privilege('authenticated', 'public.payments', 'insert'), 'writes only via RPCs'
) h;
`
// Strip SQL comments: some SQL editors split scripts on ';' without understanding comments,
// and the commented-out optional block contains '$$'. A trailing '-- ...' is only removed when
// no quote appears before it on the line, so '--' inside a string literal is left alone.
const body = migration.split('\n')
  .filter((line) => !/^\s*--/.test(line))
  .map((line) => {
    const i = line.indexOf('--')
    return i >= 0 && !line.slice(0, i).includes("'") ? line.slice(0, i).trimEnd() : line
  })
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
const leftovers = body.split('\n').filter((l) => /--/.test(l) && /;/.test(l.slice(l.indexOf('--'))))
if (leftovers.length) throw new Error('comment with ";" survived:\n' + leftovers.join('\n'))
writeFileSync(new URL('./02_install_payments.sql', import.meta.url), header + body + footer)
console.log('wrote docs/sql/02_install_payments.sql')

// ---------------------------------------------------------------- 03: role / ownership hardening
{
  const src = readFileSync(new URL('../../supabase/migrations/20261115000000_harden_roles.sql', import.meta.url), 'utf8')
  const body = src.split('\n').filter((l) => !/^\s*--/.test(l))
    .map((l) => { const i = l.indexOf('--'); return i >= 0 && !l.slice(0, i).includes("'") ? l.slice(0, i).trimEnd() : l })
    .join('\n').replace(/\n{3,}/g, '\n\n')
  const head = `-- =============================================================================
-- RemedacareHMS - SECURITY FIX: stop users making themselves admin or joining other hospitals
-- Generated from supabase/migrations/20261115000000_harden_roles.sql - do not edit by hand.
-- Run AFTER 02_install_payments.sql. Paste the whole file into SQL Editor, Run, choose
-- "Run without RLS" if asked. One transaction: if anything fails, nothing changes.
-- The last result lists everyone who has admin rights. Check you recognise every name.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.pay_canonical_role(text)') is null then
    raise exception 'Run 02_install_payments.sql first. Nothing was changed.';
  end if;
end $$;
`
  const foot = `
commit;

select 'CHECK' as kind, check_name as name, case when ok then 'OK' else 'PROBLEM' end as detail from (
  select 'guard on hospital_users' as check_name, exists (select 1 from pg_trigger where tgname = 'trg_sec_guard_hospital_users') as ok
  union all select 'guard on staff', exists (select 1 from pg_trigger where tgname = 'trg_sec_guard_staff')
  union all select 'guard on hospitals', exists (select 1 from pg_trigger where tgname = 'trg_sec_guard_hospitals')
  union all select 'helpers hidden from browser', not has_function_privilege('authenticated', 'public.sec_is_hospital_admin(uuid, uuid)', 'execute')
) c
union all
select 'ADMIN (please review)', coalesce(h.name, hu.hospital_id::text), coalesce(u.email, hu.user_id::text) ||
       case when lower(coalesce(h.owner_email, '')) = lower(coalesce(u.email, '-')) then '  (owner)' else '  (admin link)' end
from public.hospital_users hu
left join public.hospitals h on h.id = hu.hospital_id
left join auth.users u on u.id = hu.user_id
where lower(coalesce(hu.role, '')) = 'admin'
union all
select 'REVIEW: trigger on auth.users', tgname, 'runs ' || tgfoid::regproc::text || ' when accounts are created. Send me its definition if it adds people to hospitals'
from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal
union all
select 'REVIEW: set_staff_role', p.oid::regprocedure::text,
       case when p.prosecdef and p.prosrc !~* 'raise' then 'has no permission check of its own (the new guards still block misuse). Send me its definition to tidy up'
            else 'looks guarded' end
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'set_staff_role'
order by 1, 2;
`
  writeFileSync(new URL('./03_security_hardening.sql', import.meta.url), head + body + foot)
  console.log('wrote docs/sql/03_security_hardening.sql')
}

// ---------------------------------------------------------------- 05+: later modules (same pattern)
function strip(src) {
  const body = src.split('\n').filter((l) => !/^\s*--/.test(l))
    .map((l) => { const i = l.indexOf('--'); return i >= 0 && !l.slice(0, i).includes("'") ? l.slice(0, i).trimEnd() : l })
    .join('\n').replace(/\n{3,}/g, '\n\n')
  const bad = body.split('\n').filter((l) => /--/.test(l) && /;/.test(l.slice(l.indexOf('--'))))
  if (bad.length) throw new Error('comment with ";" survived:\n' + bad.join('\n'))
  return body
}
const MODULES = [
  { out: '05_scheduling.sql', migration: '20261116000000_scheduling.sql', title: 'SCHEDULING ENGINE (clinic hours, no double-booking, SMS reminders, waiting list)',
    check: `select 'tables' as check_name, case when (select count(*) from pg_class where oid in (to_regclass('public.provider_schedules'),
      to_regclass('public.provider_schedule_exceptions'), to_regclass('public.appointment_types'), to_regclass('public.appointment_reminders'),
      to_regclass('public.appointment_waitlist'))) = 5 then 'OK' else 'PROBLEM' end as result
    union all select 'booking guard', case when exists (select 1 from pg_trigger where tgname = 'trg_sched_appointments_before') then 'OK' else 'PROBLEM' end
    union all select 'double-booking constraint', case when exists (select 1 from pg_constraint where conname = 'appointments_no_clinician_overlap')
      then 'OK' else 'SKIPPED - old double-bookings exist; the trigger still blocks new ones' end
    union all select 'appointments with times', (select count(*) filter (where starts_at is not null) || ' of ' || count(*) from public.appointments);` },
  { out: '06_ncd_registry.sql', migration: '20261117000000_ncd_registry.sql', title: 'CHRONIC CARE (NCD) REGISTRY with targets, recall, tracing and cohorts',
    check: `select 'tables' as check_name, case when (select count(*) from pg_class where oid in (to_regclass('public.ncd_enrolments'),
      to_regclass('public.ncd_visits'), to_regclass('public.ncd_tracing_tasks'), to_regclass('public.ncd_tracing_attempts'),
      to_regclass('public.ncd_condition_config'))) = 5 then 'OK' else 'PROBLEM' end as result
    union all select 'condition targets loaded', case when (select count(*) from public.ncd_condition_config where hospital_id is null) >= 12 then 'OK' else 'PROBLEM' end
    union all select 'old register copied in', (select count(*) || ' enrolments, ' || (select count(*) from public.ncd_visits) || ' visits' from public.ncd_enrolments);` },
  { out: '07_clinical_reference.sql', migration: '20261118000000_clinical_reference.sql', title: 'DECISION SUPPORT AND CODING (ICD-10/11, LOINC, override audit)',
    check: `select 'ICD-10 codes' as check_name, (select count(*) || ' loaded' from public.icd10_codes) as result
    union all select 'LOINC codes', (select count(*) || ' loaded' from public.loinc_codes)
    union all select 'override audit trigger', case when exists (select 1 from pg_trigger where tgname = 'trg_cds_overrides_audit') then 'OK' else 'PROBLEM' end
    union all select 'search works', case when exists (select 1 from public.icd_search('malaria')) then 'OK' else 'PROBLEM' end;` },
  { out: '08_hiv_tb_maternity.sql', migration: '20261119000000_hiv_tb_maternity.sql', title: 'HIV, TB AND MATERNITY (ART & viral load, TB treatment, ANC, labour, delivery, PNC, immunisation)',
    check: `select 'tables' as check_name, case when (select count(*) from pg_class where oid in (to_regclass('public.hiv_art'), to_regclass('public.hiv_viral_loads'),
      to_regclass('public.tb_episodes'), to_regclass('public.tb_dot_log'), to_regclass('public.anc_pregnancies'), to_regclass('public.anc_contacts'),
      to_regclass('public.partograph_entries'), to_regclass('public.deliveries'), to_regclass('public.newborns'), to_regclass('public.immunisations'))) = 10 then 'OK' else 'PROBLEM' end as result
    union all select 'clinical-only access', case when (select count(*) from pg_policies where schemaname = 'public' and policyname like '%_clinical') >= 15 then 'OK' else 'PROBLEM' end
    union all select 'viral load schedule', case when public.hiv_next_vl_due(date '2026-01-01', null, null, 30, false) = date '2026-04-01' then 'OK' else 'PROBLEM' end;` },
  { out: '09_ward_mar.sql', migration: '20261120000000_ward_mar.sql', title: 'WARD MEDICATION CHART (MAR) AND SHIFT HANDOVER', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'tables' as check_name, case when to_regclass('public.mar_doses') is not null and to_regclass('public.ward_handovers') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'documented doses protected', case when exists (select 1 from pg_trigger where tgname = 'trg_mar_doses_before') then 'OK' else 'PROBLEM' end
    union all select 'TDS → 06:00, 14:00, 22:00', case when public.mar_times('TDS') = array['06:00', '14:00', '22:00']::time[] then 'OK' else 'PROBLEM' end;` },
  { out: '10_moh_reports.sql', migration: '20261121000000_moh_reports.sql', title: 'MOH REPORTS 711 / 710 / 731 / 717, KHIS EXPORT AND REPORT SCHEDULES', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'tables' as check_name, case when (select count(*) from pg_class where oid in (to_regclass('public.khis_mappings'), to_regclass('public.khis_settings'),
      to_regclass('public.report_schedules'), to_regclass('public.report_runs'))) = 4 then 'OK' else 'PROBLEM' end as result
    union all select 'MOH age bands', case when public.rpt_band(17, '711') = '15-19' and public.rpt_band(0.5, '710') = 'under 1' and public.rpt_band(52, '731') = '50+' then 'OK' else 'PROBLEM' end;` },
  { out: '11_audit_privacy.sql', migration: '20261122000000_audit_privacy.sql', title: 'AUDIT TRAIL, ACCESS LOG, BREAK-GLASS AND DATA PROTECTION REQUESTS',
    check: `select 'audit log append-only' as check_name, case when exists (select 1 from pg_trigger where tgname = 'trg_audit_log_guard') then 'OK' else 'PROBLEM' end as result
    union all select 'access log + break-glass', case when to_regclass('public.patient_access_log') is not null and to_regprocedure('public.log_patient_access(uuid, uuid, text, text, text)') is not null then 'OK' else 'PROBLEM' end
    union all select 'clinical tables audited', case when (select count(*) from pg_trigger where tgname = 'trg_audit_change') >= 1 then 'OK' else 'PROBLEM' end;` },
  { out: '13_lockdown_public.sql', migration: '20261123000000_lockdown_public.sql', title: 'LOCK DOWN THE PUBLIC KEY (fixes from 12_security_check)', requires: 'ref_try_uuid(text)', requiresFile: '07_clinical_reference.sql',
    check: `select 'public (anon) table access' as check_name, case when count(*) = 0 then 'OK' else count(*) || ' grants left - send me this' end as result
      from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'
    union all select 'definer functions open to anon', case when count(*) = 0 then 'OK' else count(*) || ' left - send me this' end
      from pg_proc f join pg_namespace n on n.oid = f.pronamespace where n.nspname = 'public' and f.prosecdef and has_function_privilege('anon', f.oid, 'execute')
    union all select 'logged-in TRUNCATE', case when count(*) = 0 then 'OK' else count(*) || ' left' end
      from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'TRUNCATE'
    union all select 'PPB flags per hospital', case when exists (select 1 from pg_policies where tablename = 'ppb_dispensing_flags' and qual = 'true') then 'PROBLEM' else 'OK' end;` },
  { out: '14_configuration.sql', migration: '20261124000000_configuration.sql', title: 'CONFIGURATION: PAYER PRICE LISTS, ROLE MATRIX, DEPARTMENT FORMS, CHANGE LOG', requires: 'audit_row_change()', requiresFile: '11_audit_privacy.sql',
    check: `select 'tables' as check_name, case when (select count(*) from pg_class where oid in (to_regclass('public.price_lists'), to_regclass('public.charge_code_prices'),
      to_regclass('public.role_permissions'), to_regclass('public.workflow_form_overrides'))) = 4 then 'OK' else 'PROBLEM' end as result
    union all select 'changes go to the audit log', case when (select count(*) from pg_trigger where tgname = 'trg_audit_change' and tgrelid in (to_regclass('public.price_lists'),
      to_regclass('public.charge_code_prices'), to_regclass('public.role_permissions'), to_regclass('public.workflow_form_overrides'))) = 4 then 'OK' else 'PROBLEM' end
    union all select 'SHA payer detected', case when public.config_payer_type('SHA (Social Health Authority)') = 'sha' and public.config_payer_type('Insurance', 'AAR') = 'insurance' then 'OK' else 'PROBLEM' end;` },
  { out: '15_fhir_api.sql', migration: '20261125000000_fhir_api.sql', title: 'FHIR R4 API: CLIENT KEYS, CALL LOG, API READS IN THE ACCESS LOG', requires: 'priv_is_admin(uuid)', requiresFile: '11_audit_privacy.sql',
    check: `select 'API keys table' as check_name, case when to_regclass('public.fhir_clients') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'key lookup is server-only', case when has_function_privilege('authenticated', 'public.fhir_client_by_key(text)', 'execute') then 'PROBLEM' else 'OK' end
    union all select 'API call log admin-only', case when exists (select 1 from pg_policies where tablename = 'fhir_audit_log' and policyname = 'fhir_audit_admin_read') then 'OK' else 'PROBLEM' end;` },
  { out: '16_secrets_and_referral_links.sql', migrations: ['20261126000000_hospital_secrets.sql', '20261127000000_referral_shares.sql'], title: 'SERVER-ONLY CREDENTIALS, HASHED ADMIN PIN, REFERRAL LETTER LINKS', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'credentials left in readable settings' as check_name, case when count(*) = 0 then 'OK' else count(*) || ' hospitals - send me this' end as result
      from public.hospitals where system_settings::text ~ '"(etims_secret|sha_api_key|mpesa_consumer_key|mpesa_consumer_sec|mpesa_passkey|sms_api_key|nhif_password|admin_pin)": ?"[^"]'
    union all select 'credentials moved', (select count(*) || ' saved, ' || count(*) filter (where vault_id is not null) || ' encrypted in Vault' from public.hospital_secrets)
    union all select 'referral links', case when to_regprocedure('public.referral_share_resolve(text)') is not null then 'OK' else 'PROBLEM' end;` },
  { out: '17_patient_portal_and_networks.sql', migrations: ['20261128000000_patient_portal.sql', '20261129000000_multi_facility.sql'], title: 'PATIENT PORTAL SIGN-IN AND MULTI-FACILITY NETWORKS', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'portal tables' as check_name, case when to_regclass('public.portal_sessions') is not null and to_regclass('public.portal_settings') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'portal sign-in is server-only', case when has_function_privilege('authenticated', 'public.portal_verify(text, text)', 'execute') then 'PROBLEM' else 'OK' end
    union all select 'Kenyan phone numbers recognised', case when public.portal_phone_norm('0712 345 678') = '254712345678' and public.portal_phone_norm('+254 112 345 678') = '254112345678' then 'OK' else 'PROBLEM' end
    union all select 'facilities in networks', (select count(*) filter (where to_jsonb(h)->>'network_id' is not null) || ' of ' || count(*) from public.hospitals h);` },
  { out: '18_server_only_functions.sql', migration: '20261130000000_server_only_functions.sql', title: 'SERVER-ONLY FUNCTIONS: REMOVE ACCESS FOR SIGNED-IN USERS', requires: 'pay_is_member(uuid)',
    check: `select 'server-only functions callable by signed-in users' as check_name,
      coalesce(nullif(string_agg(f, ', '), ''), 'none - OK') as result
      from unnest(array['public.pay_user_context(uuid, uuid)', 'public.pay_access_level(uuid, uuid)',
        'public.create_online_payment(uuid, uuid, text, text, numeric, text, text, text, text, boolean)', 'public.create_gateway_refund(uuid, uuid, numeric, text)',
        'public.fhir_client_by_key(text)', 'public.secret_store(uuid, text, text)', 'public.hospital_secret_get(uuid, text)', 'public.referral_share_resolve(text)',
        'public.portal_patients(text)', 'public.portal_request_code(text)', 'public.portal_verify(text, text)', 'public.portal_session_phone(text)',
        'public.portal_logout(text)', 'public.net_facilities(uuid)']) f
     where to_regprocedure(f) is not null and has_function_privilege('authenticated', f, 'execute');` },
  { out: '19_support_services.sql', migration: '20261201000000_support_services.sql', title: 'SUPPORT DEPARTMENTS: HOUSEKEEPING, KITCHEN, MAINTENANCE, TRANSPORT, SECURITY, MEDICAL RECORDS, IT, ADMINISTRATION', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'service desk tables' as check_name, case when to_regclass('public.service_requests') is not null and to_regclass('public.service_assets') is not null and to_regclass('public.service_logs') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'discharge creates a clean', case when exists (select 1 from pg_trigger where tgname = 'trg_beds_turnover') then 'OK' else 'SKIPPED - no beds table' end
    union all select 'internal functions server-only', case when has_function_privilege('authenticated', 'public.beds_turnover()', 'execute') then 'PROBLEM' else 'OK' end;` },
  { out: '20_emergency.sql', migration: '20261202000000_emergency.sql', title: 'EMERGENCY DEPARTMENT: TRIAGE (SATS / ETAT+), PATHWAYS, TRAUMA SHEET, DEPARTMENT TIMES', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'tables' as check_name, case when to_regclass('public.ed_attendances') is not null and to_regclass('public.ed_pathway_events') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'triage colours', case when public.ed_colour(7, '{}', false) = 'red' and public.ed_colour(1, '{orange:Chest pain}', false) = 'orange' and public.ed_target_minutes('orange') = 10 then 'OK' else 'PROBLEM' end;` },
  { out: '21_theatre.sql', migration: '20261203000000_theatre.sql', title: 'THEATRE: WHO SURGICAL SAFETY CHECKLIST, OPERATION NOTES, RECOVERY, IMPLANTS, UTILISATION', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'tables' as check_name, case when to_regclass('public.theatre_cases') is not null and to_regclass('public.theatre_items') is not null and to_regclass('public.theatre_rooms') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'WHO checklist enforced', case when public.theatre_phase_problem('sign_in', '{}') <> '' and exists (select 1 from pg_trigger where tgname = 'trg_theatre_cases_before') then 'OK' else 'PROBLEM' end;` },
  { out: '22_radiology.sql', migration: '20261204000000_radiology.sql', title: 'RADIOLOGY: WORKLISTS, SCHEDULING, STRUCTURED REPORTS, CRITICAL RESULTS, DOSE AND CONTRAST', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'radiology extended' as check_name, case when exists (select 1 from information_schema.columns where table_name = 'radiology_orders' and column_name = 'critical_ack_at') and exists (select 1 from pg_trigger where tgname = 'trg_radiology_orders_before') then 'OK' else 'PROBLEM' end as result
    union all select 'accession numbers given to existing orders', (select count(*) || ' orders without one' from public.radiology_orders where accession_number is null);` },
  { out: '23_ward_nursing.sql', migration: '20261205000000_ward_nursing.sql', title: 'WARD NURSING: NEWS2 / PEWS WITH ESCALATION, RISK ASSESSMENTS, CARE PLANS', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'tables' as check_name, case when to_regclass('public.ward_observations') is not null and to_regclass('public.ward_care_plans') is not null and to_regclass('public.ward_risk_assessments') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'NEWS2 scoring', case when (public.news2_score('{"rr":26,"spo2":90,"oxygen":true,"sbp":88,"hr":135,"consciousness":"C","temp":39.5}')->>'score')::int = 19 then 'OK' else 'PROBLEM' end;` },
  { out: '24_icu.sql', migration: '20261206000000_icu.sql', title: 'ICU / HDU: CRITICAL-CARE CHART, VENTILATOR, INFUSIONS, SEDATION, SOFA, DAILY GOALS, FAMILY LOG', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'tables' as check_name, case when to_regclass('public.icu_admissions') is not null and to_regclass('public.icu_entries') is not null and exists (select 1 from pg_trigger where tgname = 'trg_icu_entries_before') then 'OK' else 'PROBLEM' end as result
    union all select 'SOFA and pump-rate checks', case when (public.sofa_score('{"pao2":80,"fio2":0.5,"resp_support":true,"platelets":40,"bilirubin":110,"noradrenaline":0.2,"gcs":8,"creatinine":350}')->>'total')::int = 19 and public.icu_infusion_rate(0.1, 'mcg/kg/min', 4, 50, 70) = 5.3 then 'OK' else 'PROBLEM' end;` },
  { out: '25_blood_transfusion.sql', migration: '20261207000000_blood_transfusion.sql', title: 'BLOOD TRANSFUSION CLOSED LOOP: REQUEST, GROUPING, CROSSMATCH, ISSUE, BEDSIDE CHECK, REACTIONS, DONORS', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'tables' as check_name, case when to_regclass('public.blood_requests') is not null and to_regclass('public.blood_transfusions') is not null and to_regclass('public.blood_donations') is not null and exists (select 1 from pg_trigger where tgname = 'blood_bank_units_safety_guard') then 'OK' else 'PROBLEM' end as result
    union all select 'compatibility rules', case when public.blood_groups_compatible('O-', 'AB+') and not public.blood_groups_compatible('A+', 'O+') and public.blood_plasma_compatible('AB+', 'O-') and not public.blood_plasma_compatible('O+', 'A+') then 'OK' else 'PROBLEM' end
    union all select 'units issued without a request (before this update)', (select count(*) || ' units' from public.blood_bank_units where status = 'Issued' and request_id is null);` },
  { out: '26_pharmacy_controls.sql', migration: '20261208000000_pharmacy_controls.sql', title: 'PHARMACY CONTROLS: ENFORCED FEFO, CONTROLLED DRUG REGISTER WITH WITNESS, WARD IMPREST STOCK', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'tables and FEFO guard' as check_name, case when to_regclass('public.cd_register') is not null and to_regclass('public.ward_stock') is not null and exists (select 1 from pg_trigger where tgname = 'trg_drug_batches_fefo_guard') then 'OK' else 'PROBLEM' end as result
    union all select 'medicines marked controlled', (select count(*) || ' (mark them in Inventory, then record opening balances in the register)' from public.pharmacy_inventory where controlled_drug)
    union all select 'batches not linked to a stock item (matched by name)', (select count(*) || ' batches' from public.drug_batches where inventory_id is null and coalesce(quantity_remaining, 0) > 0);` },
  { out: '27_specialty_assessments.sql', migration: '20261209000000_specialty_assessments.sql', title: 'SPECIALTY CLINIC TEMPLATES: MENTAL HEALTH, EYE, DENTAL, ENT, PHYSIOTHERAPY, CARDIOLOGY, DERMATOLOGY', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'table' as check_name, case when to_regclass('public.specialty_assessments') is not null and exists (select 1 from pg_trigger where tgname = 'trg_specialty_assessments_before') then 'OK' else 'PROBLEM' end as result
    union all select 'scoring (PHQ-9, visual acuity, CHA2DS2-VASc)', case when (public.specialty_score('mental_health', '{"q1":3,"q2":3,"q3":2,"q4":2,"q5":1,"q6":2,"q7":1,"q8":1,"q9":1}')->'scores'->>'phq9')::int = 16 and public.spec_va('6/60') = 0.1 and (public.specialty_score('cardiology', '{"af":"yes","age":70,"sex":"female","htn":true}')->'scores'->>'cha2ds2_vasc')::int = 3 then 'OK' else 'PROBLEM' end;` },
  { out: '28_maternity_registers.sql', migration: '20261210000000_maternity_registers.sql', title: 'MATERNITY REGISTERS: MOH 405 (ANC) AND MOH 406 (MATERNITY) FROM THE CLINICAL RECORDS', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'register functions' as check_name, case when to_regprocedure('public.moh405_register(uuid,date,date)') is not null and to_regprocedure('public.moh406_register(uuid,date,date)') is not null and exists (select 1 from information_schema.columns where table_name = 'deliveries' and column_name = 'uterotonic') then 'OK' else 'PROBLEM' end as result;` },
  { out: '29_dialysis_mortuary.sql', migration: '20261211000000_dialysis_mortuary.sql', title: 'DIALYSIS (SESSIONS, URR / KT/V, HEPATITIS B MACHINES) AND MORTUARY (BODY REGISTER, MCCD, CONTROLLED RELEASE)', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'tables' as check_name, case when to_regclass('public.dialysis_sessions') is not null and to_regclass('public.mortuary_bodies') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'Kt/V calculation', case when (public.dialysis_adequacy(150, 50, 240, 3, 70)->>'ktv')::numeric = 1.32 then 'OK' else 'PROBLEM' end;` },
  { out: '30_theatre_preference_cards.sql', migration: '20261212000000_theatre_preference_cards.sql', title: 'THEATRE PREFERENCE CARDS, ITEMS FROM STOCK (FEFO) AND ITEM BILLING AT THE CASHIER', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'preference cards and stock-linked items' as check_name, case when to_regclass('public.theatre_preference_cards') is not null and exists (select 1 from pg_trigger where tgname = 'trg_theatre_items_before') then 'OK' else 'PROBLEM' end as result
    union all select 'pharmacy controls installed (FEFO issue from stock)', case when to_regprocedure('public.pharmacy_fefo_issue(uuid,numeric,text)') is not null then 'OK' else 'Run 26_pharmacy_controls.sql for batch-level stock issue' end;` },
  { out: '31_growth_ortho_oncology.sql', migration: '20261213000000_growth_ortho_oncology.sql', title: 'PAEDIATRIC GROWTH (WHO Z-SCORES), ORTHOPAEDIC / FRACTURE CLINIC AND ONCOLOGY TEMPLATES', requires: 'clin_can_access(uuid)', requiresFile: '27_specialty_assessments.sql',
    check: `select 'WHO growth reference loaded' as check_name, case when (select count(*) from public.growth_reference) = 2362 then 'OK' else 'PROBLEM' end as result
    union all select 'z-score: boy 12 months 9.6 kg (WAZ about 0)', case when abs(public.growth_z(9.6, public.growth_lms('wfa', 1::smallint, 365)) - 0) < 0.1 then 'OK' else 'PROBLEM' end
    union all select 'orthopaedics / oncology templates', case when (public.specialty_score('oncology', '{"height_cm":170,"weight_kg":70}')->'scores'->>'bsa')::numeric = 1.82 then 'OK' else 'PROBLEM' end;` },
  { out: '32_problem_list_order_sets.sql', migration: '20261214000000_problem_list_order_sets.sql', title: 'PROBLEM LIST, CURRENT MEDICINES AND APPROVED ORDER SETS', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'tables' as check_name, case when to_regclass('public.patient_problems') is not null and to_regclass('public.patient_medications') is not null and to_regclass('public.order_sets') is not null then 'OK' else 'PROBLEM' end as result;` },
  { out: '33_records_file_locator.sql', migration: '20261215000000_records_file_locator.sql', title: 'MEDICAL RECORDS: FILE LOCATOR AND AUTOMATIC INCOMPLETE-RECORDS LIST', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'file locator and deficiency list' as check_name, case when to_regclass('public.record_files') is not null and to_regprocedure('public.records_deficiencies(uuid,date,date)') is not null then 'OK' else 'PROBLEM' end as result;` },
  { out: '34_lab_quality.sql', migration: '20261216000000_lab_quality.sql', title: 'LABORATORY QUALITY: DELTA CHECKS, AUTO-VALIDATION, REVIEW, TURNAROUND TIMES', requires: 'ref_try_uuid(text)', requiresFile: '11_audit_privacy.sql',
    check: `select 'rules and quality trigger' as check_name, case when (select count(*) from public.lab_analyte_rules where hospital_id is null) = 13 and exists (select 1 from pg_trigger where tgname = 'trg_lab_tests_quality') then 'OK' else 'PROBLEM' end as result
    union all select 'auto-validation', case when coalesce((select bool_or(autoverify) from public.lab_quality_settings), false) then 'switched on for at least one hospital' else 'off (every result goes to review) — the lab manager can switch it on' end;` },
  { out: '35_dashboards.sql', migration: '20261217000000_dashboards.sql', title: 'EXECUTIVE, MATRON, PHARMACY AND CLAIMS DASHBOARDS', requires: 'priv_is_admin(uuid)', requiresFile: '11_audit_privacy.sql',
    check: `select 'dashboard functions' as check_name, case when to_regprocedure('public.exec_dashboard(uuid,date,date)') is not null and to_regprocedure('public.matron_dashboard(uuid)') is not null and not has_function_privilege('authenticated', 'public.dash_metric(text,uuid,date,date)', 'execute') then 'OK' else 'PROBLEM' end as result;` },
  { out: '36_hr_roster_leave.sql', migration: '20261218000000_hr_roster_leave.sql', title: 'HR: DUTY ROSTER, LEAVE APPROVAL AND BALANCES, LICENCES AND CPD', requires: 'ref_try_uuid(text)', requiresFile: '11_audit_privacy.sql',
    check: `select 'roster, leave and licences' as check_name, case when to_regclass('public.staff_shifts') is not null and to_regclass('public.staff_licences') is not null and exists (select 1 from pg_trigger where tgname = 'trg_staff_leave_before') then 'OK' else 'PROBLEM' end as result
    union all select 'existing leave records kept as approved', (select count(*) || ' records' from public.staff_leave where status = 'approved');` },
  { out: '37_hiv_programme.sql', migration: '20261219000000_hiv_programme.sql', title: 'HIV / TB PROGRAMME: HTS REGISTER, ART VISITS WITH TB SCREENING, DEFAULTER TRACING, CASCADE AND NATIONAL INDICATORS', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'HTS, visits and tracing' as check_name, case when to_regclass('public.hts_tests') is not null and to_regclass('public.hiv_visits') is not null and to_regclass('public.programme_tracing') is not null and to_regprocedure('public.hiv_programme_indicators(uuid,date,date)') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'HTS algorithm and TB screen', case when public.hts_final_result('reactive', 'reactive') = 'positive' and public.hts_final_result('reactive', 'non_reactive') = 'inconclusive' and public.tb_screen_result(false, false, true, false) = 'presumptive' and public.pay_canonical_role('HTS Counsellor') = 'clinical' then 'OK' else 'PROBLEM' end;` },
  { out: '38_safety_checks.sql', migration: '20261220000000_safety_checks.sql', title: 'SAFETY CHECKS: DIALYSIS WATER LOG, ISOLATION AND BED PLACEMENT, VISITOR PASSES, ROOM / EQUIPMENT CLASHES', requires: 'dialysis_adequacy(numeric,numeric,numeric,numeric,numeric)', requiresFile: '29_dialysis_mortuary.sql',
    check: `select 'tables' as check_name, case when to_regclass('public.dialysis_water_tests') is not null and to_regclass('public.patient_isolation') is not null and to_regclass('public.visitor_passes') is not null and to_regclass('public.scheduling_resources') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'rules', case when public.dialysis_water_grade('total_chlorine', 0.2) = 'fail' and public.bed_isolation_problem(null, array['airborne']) is not null and public.visitor_in_hours('[{"from":"12:30","to":"14:00"}]', '13:00') then 'OK' else 'PROBLEM' end
    union all select 'bed isolation check', case when to_regclass('public.beds') is null then 'beds table not found - not installed' when exists (select 1 from pg_trigger where tgname = 'trg_beds_isolation_before') then 'OK' else 'PROBLEM' end
    union all select 'appointment room / equipment check', case when to_regclass('public.appointments') is null then 'appointments table not found - not installed' when exists (select 1 from pg_trigger where tgname = 'trg_sched_resources_before') then 'OK' else 'PROBLEM' end;` },
  { out: '39_microbiology.sql', migration: '20261221000000_microbiology.sql', title: 'MICROBIOLOGY SURVEILLANCE: ISOLATES, MIC / ZONE WITH EUCAST v16.1, EXPERT RULES, MDR / XDR, ANTIBIOGRAM, WHONET EXPORT, INSTRUMENT IMPORT', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'reference data (EUCAST v16.1 breakpoints, WHONET codes)' as check_name, case when (select count(*) from public.micro_breakpoints where hospital_id is null) > 200 and (select count(*) from public.micro_organisms) >= 60 and (select count(*) from public.micro_mdr_categories) = 62 then 'OK' else 'PROBLEM' end as result
    union all select 'interpretation', case when public.micro_sir('mic', '=', 2, 1, 2) = 'I' and public.micro_sir('disk', '=', 18, 22, 19) = 'R' and (public.micro_parse_value('<=0.25')).value = 0.25 then 'OK' else 'PROBLEM' end
    union all select 'old microbiology results converted', (select count(*) || ' isolates' from public.micro_isolates where source = 'legacy');` },
  { out: '40_critical_results.sql', migration: '20261222000000_critical_results.sql', title: 'CRITICAL RESULTS LOOP (READ-BACK, ACKNOWLEDGEMENT, ESCALATION), DRUG–LAB ALERTS AND THERAPEUTIC DRUG MONITORING', requires: 'lab_rules(uuid,text)', requiresFile: '34_lab_quality.sql',
    check: `select 'alerts, rules and TDM targets' as check_name, case when to_regclass('public.lab_critical_alerts') is not null and exists (select 1 from pg_trigger where tgname = 'trg_lab_tests_critical') and (select count(*) from public.lab_drug_rules where hospital_id is null) >= 25 and (select count(*) from public.tdm_targets where hospital_id is null) = 15 then 'OK' else 'PROBLEM' end as result
    union all select 'renal function and TDM rules', case when public.egfr_ckd_epi_2021(80, 50, false) = 103 and public.tdm_classify(2, null, 2, true, 2) = 'toxic' then 'OK' else 'PROBLEM' end;` },
  { out: '41_clinical_guides.sql', migration: '20261223000000_clinical_guides.sql', title: 'CLINICAL GUIDES: HOSPITAL APPROVAL (CLINICAL LEAD / MTC SIGN-OFF)', requires: 'clin_can_access(uuid)', requiresFile: '08_hiv_tb_maternity.sql',
    check: `select 'guide approvals' as check_name, case when to_regclass('public.clinical_guide_approvals') is not null and exists (select 1 from pg_trigger where tgname = 'trg_clinical_guide_approvals_before') then 'OK' else 'PROBLEM' end as result;` },
  // 42_clinical_content_revisions.sql and 43_clinical_content_documents.sql are maintained by hand (several prerequisite checks).
  { out: '44_lab_instruments.sql', migration: '20261224000000_lab_instruments.sql', title: 'LABORATORY ANALYSER INTERFACE: ANALYSER KEYS, CODE MAPS, INSTRUMENT INBOX (WITH tools/lab-bridge AND THE lab-ingest FUNCTION)', requires: 'lab_rules(uuid,text)', requiresFile: '34_lab_quality.sql',
    check: `select 'analysers, maps and inbox' as check_name, case when to_regclass('public.lab_instruments') is not null and to_regclass('public.lab_instrument_results') is not null and (select count(*) from public.lab_instrument_maps where hospital_id is null) >= 30 and not has_function_privilege('authenticated', 'public.lab_instrument_ingest(text,jsonb)', 'execute') then 'OK' else 'PROBLEM' end as result;` },
  { out: '46_clinical_library.sql', migration: '20261228000000_clinical_library.sql', title: 'CLINICAL CONTENT CONTROL: EDITABLE CARE PATHWAYS, REMOVE / RESTORE / START FRESH, HOSPITAL LIBRARY (FILES UP TO 50 MB AND LINKS). THEN RUN 45 AGAIN', requires: 'clinical_content_documents_before()', requiresFile: '43_clinical_content_documents.sql',
    check: `select 'pathways and settings allowed' as check_name, case when pg_get_constraintdef((select oid from pg_constraint where conname = 'clinical_content_revisions_content_type_check')) ~ 'pathway' and has_table_privilege('authenticated', 'public.clinical_content_revisions', 'delete') then 'OK' else 'PROBLEM' end as result
    union all select 'library and links', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinical_content_documents' and column_name = 'link_url') and (select file_size_limit from storage.buckets where id = 'clinical-content-files') = 52428800 then 'OK' else 'PROBLEM' end;` },
  { out: '47_merge_duplicate_departments.sql', migration: '20261229000000_merge_duplicate_departments.sql', title: 'MERGE DUPLICATE DEPARTMENTS (PSYCHIATRY / MENTAL HEALTH, OPHTHALMOLOGY / EYE CLINIC, SPELLING VARIANTS) AND MOVE STAFF TO THE KEPT ONE', requires: 'priv_is_admin(uuid)', requiresFile: '11_audit_privacy.sql',
    check: `select coalesce(h.name, d.hospital_id::text) as hospital, public.department_merge(d.hospital_id) as what_was_merged
      from (select distinct hospital_id from public.departments) d left join public.hospitals h on h.id = d.hospital_id;` },
  { out: '48_specialty_neuro_uro.sql', migration: '20261230000000_specialty_neuro_uro.sql', title: 'SPECIALTY CLINICS: NEUROLOGY (GCS, NIH STROKE SCALE) AND UROLOGY (IPSS, PSA, POST-VOID RESIDUAL)', requires: 'specialty_score(text,jsonb)', requiresFile: '31_growth_ortho_oncology.sql',
    check: `select 'neurology and urology scoring' as check_name, case when (public.specialty_score('neurology', '{"gcs_e":"2","gcs_v":"2","gcs_m":"4"}')->'scores'->>'gcs') = '8' and (public.specialty_score('urology', '{"i1":"4","i2":"5","i3":"3","i4":"4","i5":"5","i6":"3","i7":"3"}')->'scores'->>'ipss') = '27' then 'OK' else 'PROBLEM' end as result;` },
  { out: '49_department_referrals.sql', migration: '20261231000000_department_referrals.sql', title: 'DEPARTMENT REFERRAL INBOX / OUTBOX (REFERRING DEPARTMENT, DECLINE REASON)',
    check: `select 'department referral columns' as check_name, case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'referrals' and column_name in ('referring_department', 'declined_reason', 'declined_at')) = 3 then 'OK' else 'PROBLEM' end as result;` },
  { out: '50_admission_department.sql', migration: '20261231100000_admission_department.sql', title: 'INPATIENTS PER DEPARTMENT (ADMITTING DEPARTMENT ON ADMISSIONS, FILLED IN FOR EXISTING ADMISSIONS)',
    check: `select 'admitting department' as check_name, case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'admissions' and column_name = 'admitting_department') then 'OK' else 'PROBLEM' end as result
    union all select 'active admissions without a department', (select count(*)::text from public.admissions where status = 'Active' and admitting_department is null);` },
  { out: '51_department_control.sql', migration: '20261231200000_department_control.sql', title: 'DEPARTMENTS RUN THEIR OWN WORK: DEPARTMENT MANAGERS, DEPARTMENT DUTY ROSTER AND LEAVE APPROVAL', requires: 'department_canonical(text)', requiresFile: '47_merge_duplicate_departments.sql',
    check: `select 'department managers' as check_name, case when to_regclass('public.department_managers') is not null and to_regprocedure('public.dept_manages(uuid,text,text)') is not null then 'OK' else 'PROBLEM' end as result
    union all select 'roster editable per department', case when (select qual from pg_policies where tablename = 'staff_shifts' and policyname = 'staff_shifts_write') ~ 'shift_editable' then 'OK' else 'PROBLEM: run 51 again after 45' end;` },
  { out: '52_department_services_protocols.sql', migration: '20261231300000_department_services_protocols.sql', title: 'DEPARTMENT SERVICES (ADD, EDIT, RETIRE, DELETE; ONLY ADMIN OR FINANCE CHANGE PRICES) AND DEPARTMENT PROTOCOLS (DOCUMENTS, RULES, REVISIONS, WHO HAS READ THEM)', requires: 'dept_manages(uuid,text,text)', requiresFile: '51_department_control.sql',
    check: `select 'price list protected' as check_name, case when exists (select 1 from pg_policies where tablename = 'charge_codes' and policyname = 'charge_codes_write') and not exists (select 1 from pg_policies where tablename = 'charge_codes' and policyname not in ('charge_codes_read', 'charge_codes_write')) then 'OK' else 'PROBLEM' end as result
    union all select 'department protocols', case when to_regclass('public.department_documents') is not null and to_regclass('public.department_document_reads') is not null then 'OK' else 'PROBLEM' end
    union all select 'protocol file storage (private)', case when exists (select 1 from storage.buckets where id = 'department-documents' and not public) then 'OK' else 'PROBLEM' end;` },
  { out: '45_rls_performance.sql', migration: '20261227000000_rls_performance.sql', title: 'SPEED: ACCESS CHECKS ONCE PER QUERY INSTEAD OF PER ROW, AND HOSPITAL INDEXES. RUN THIS LAST, AND AGAIN AFTER RE-RUNNING ANY OTHER FILE', requires: 'pay_is_member(uuid)', requiresFile: '02_install_payments.sql',
    check: `select 'access checks optimised' as check_name, case when (select count(*) from pg_policies where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) ~ '\\m(pay_is_member|clin_can_access|priv_is_admin|blood_is_staff|hr_can_manage|hr_can_roster|guide_can_approve|pharm_is_staff|rec_can_access|can_manage_payments|can_take_payments|mortuary_can_access|is_payments_admin|lab_instrument_can_manage|service_is_records_staff)\\(hospital_id\\)') = 0 then 'OK' else 'PROBLEM: run this file again' end as result
    union all select 'policies using the fast form', (select count(*) || ' policies' from pg_policies where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'rls_hospitals')
    union all select 'hospital indexes', case when not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public' join pg_attribute a on a.attrelid = c.oid and a.attname = 'hospital_id' and not a.attisdropped where c.relkind = 'r' and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)) then 'OK' else 'PROBLEM' end;` },
]
for (const m of MODULES) {
  const src = (m.migrations || [m.migration]).map((f) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8')).join('\n\n')
  const head = `-- =============================================================================
-- RemedacareHMS - ${m.title}
-- Generated from supabase/migrations/${(m.migrations || [m.migration]).join(' + ')} - do not edit by hand.
-- Paste the whole file into SQL Editor, Run, choose "Run without RLS" if asked.
-- One transaction: if anything fails, nothing changes. Safe to run again.
-- =============================================================================

begin;

do $$ begin
  if to_regprocedure('public.${m.requires || 'pay_is_member(uuid)'}') is null then
    raise exception 'Run ${m.requiresFile || '02_install_payments.sql'} first. Nothing was changed.';
  end if;
end $$;
`
  writeFileSync(new URL(`./${m.out}`, import.meta.url), head + strip(src) + '\ncommit;\n\n' + m.check + '\n')
  console.log('wrote docs/sql/' + m.out)
}
