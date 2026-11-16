// MOH reports + schedules: supabase/migrations/20261121000000_moh_reports.sql on PGlite.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const CLIN = read('../../migrations/20261119000000_hiv_tb_maternity.sql')
const MOH = read('../../migrations/20261121000000_moh_reports.sql')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const JANE = '99999999-0000-0000-0000-000000000001', BOB = '99999999-0000-0000-0000-000000000002', BABY = '99999999-0000-0000-0000-000000000003'
const FROM = '2026-10-01', TO = '2026-10-31'

async function boot() {
  const db = new PGlite()
  await db.exec(read('./stub.sql'))
  await db.exec(PAYMENTS)
  await db.exec(`alter table patients add column age text, add column date_of_birth date, add column gender text;
    update patients set age = '17', gender = 'Female' where id = '${JANE}';
    update patients set age = '34', gender = 'Male' where id = '${BOB}';
    insert into patients(id, hospital_id, full_name, date_of_birth, gender) values ('${BABY}', '${H1}', 'Baby', '2026-01-10', 'Female');
    create table visits(id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, created_at timestamptz);
    create table admissions(id uuid primary key default gen_random_uuid(), hospital_id uuid, visit_id uuid, admission_date date, discharge_date date, status text, created_at timestamptz default now());
    insert into visits(hospital_id, patient_id, created_at) values
      ('${H1}', '${BOB}', '2026-09-20T09:00:00Z'), ('${H1}', '${BOB}', '2026-10-05T09:00:00Z'), ('${H1}', '${JANE}', '2026-10-06T09:00:00Z'), ('${H1}', '${BABY}', '2026-10-07T09:00:00Z');
    insert into admissions(hospital_id, admission_date, discharge_date, status) values ('${H1}', '2026-10-02', '2026-10-06', 'Discharged'), ('${H1}', '2026-10-10', '2026-10-12', 'Died');`)
  await db.exec(CLIN)
  await db.exec(MOH)
  await db.exec(`
    insert into anc_pregnancies(id, hospital_id, patient_id, lmp, hiv_status) values ('aaaaaaaa-0000-0000-0000-000000000001', '${H1}', '${JANE}', '2026-08-01', 'positive');
    insert into anc_contacts(pregnancy_id, visit_date, iptp_dose, hb, ifas_given, llin_given) values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-15', 1, 10.2, true, true);
    insert into deliveries(id, hospital_id, patient_id, delivered_at, mode, blood_loss_ml, amtsl_oxytocin) values ('bbbbbbbb-0000-0000-0000-000000000001', '${H1}', '${JANE}', '2026-10-20T10:00:00Z', 'caesarean', 600, true);
    insert into newborns(hospital_id, delivery_id, sex, outcome, birth_weight_g, breastfed_1h, arv_prophylaxis) values ('${H1}', 'bbbbbbbb-0000-0000-0000-000000000001', 'female', 'live_birth', 2300, true, 'AZT+NVP');
    insert into immunisations(hospital_id, patient_id, vaccine, given_on) values
      ('${H1}', '${BABY}', 'BCG', '2026-01-10'), ('${H1}', '${BABY}', 'OPV3', '2026-04-20'), ('${H1}', '${BABY}', 'PENTA3', '2026-04-20'),
      ('${H1}', '${BABY}', 'PCV3', '2026-04-20'), ('${H1}', '${BABY}', 'MR1', '2026-10-12');
    insert into hiv_art(hospital_id, patient_id, art_start_date) values ('${H1}', '${BOB}', '2026-10-03'), ('${H1}', '${JANE}', '2025-01-01');
    insert into tb_episodes(hospital_id, patient_id, diagnosis_date, treatment_start, hiv_status) values ('${H1}', '${BOB}', '2026-10-04', '2026-10-04', 'positive');`)
  return db
}
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const report = async (db, form) => (await db.query('select section, indicator, disaggregation, value::int v from moh_report($1, $2, $3, $4)', [H1, form, FROM, TO])).rows
const find = (rows, indicator, dis = 'all') => rows.find((r) => r.indicator === indicator && r.disaggregation === dis)?.v ?? 0
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('MOH reports', () => {
  let db
  before(async () => { db = await boot(); await as(db, NURSE) })

  it('711 uses the maternal age bands', async () => {
    const r = await report(db, '711')
    assert.equal(find(r, 'New ANC clients (1st contact)', '15-19'), 1)
    assert.equal(find(r, 'IPTp-SP dose 1'), 1)
    assert.equal(find(r, 'Anaemic (Hb < 11)'), 1)
    assert.equal(find(r, 'HIV positive (new clients)'), 1)
    assert.equal(find(r, 'Deliveries — caesarean section'), 1)
    assert.equal(find(r, 'Deliveries', '15-19'), 1)
    assert.equal(find(r, 'Postpartum haemorrhage (≥ 500 ml)'), 1)
    assert.equal(find(r, 'Live births'), 1)
    assert.equal(find(r, 'Low birth weight (< 2500 g)'), 1)
  })
  it('710 splits under 1 / 1 year+ and counts fully immunised children', async () => {
    const r = await report(db, '710')
    assert.equal(find(r, 'MR1', 'under 1'), 1)
    assert.equal(find(r, 'Fully immunised child (MR1 + BCG, OPV3, Penta3, PCV3 by 1 year)', 'under 1'), 1)
  })
  it('731 uses DATIM age/sex bands for TX_NEW and TX_CURR', async () => {
    const r = await report(db, '731')
    assert.equal(find(r, 'Started ART (TX_NEW)', '30-34 M'), 1)
    assert.equal(find(r, 'Currently on ART (TX_CURR)', '15-19 F') + find(r, 'Currently on ART (TX_CURR)', '30-34 M'), 2)
    assert.equal(find(r, 'TB/HIV co-infected'), 1)
    assert.equal(find(r, 'HIV-exposed infants given ARV prophylaxis'), 1)
  })
  it('717 workload: new vs revisit by under 5 / 5-59 / 60+, admissions, deaths, bed days', async () => {
    const r = await report(db, '717')
    assert.equal(find(r, 'Revisits', '5-59'), 1, 'Bob came in September too')
    assert.equal(find(r, 'New attendances', '5-59'), 1)
    assert.equal(find(r, 'New attendances', 'under 5'), 1)
    assert.equal(find(r, 'Admissions'), 2)
    assert.equal(find(r, 'Deaths'), 1)
    assert.equal(find(r, 'Bed days (discharged patients)'), 6)
  })
  it('only clinical staff can run reports', async () => {
    await as(db, REC)
    await refused(db.query('select * from moh_report($1, $2, $3, $4)', [H1, '711', FROM, TO]), /Clinical access/)
    await as(db, NURSE)
  })
})

describe('schedules', () => {
  it('next run date, due runs generate a CSV and move forward', async () => {
    const db = await boot(); await as(db, NURSE)
    const nr = (await db.query("select report_next_run('monthly', 5, '2026-11-14T08:00:00Z')::text t")).rows[0].t
    assert.match(nr, /^2026-12-05 03:00:00/)
    await db.query("insert into report_schedules(hospital_id, form, recipients) values ($1, '711', '{records@clinic.ke}')", [H1])
    await as(db, null)
    await db.query("update report_schedules set next_run_at = now() - interval '1 minute'")
    assert.equal((await db.query('select report_run_due() n')).rows[0].n, 1)
    const run = (await db.query('select form, email_status, csv, jsonb_array_length(rows) n from report_runs')).rows[0]
    assert.equal(run.form, '711')
    assert.equal(run.email_status, 'pending')
    assert.match(run.csv, /^section,indicator,disaggregation,value\n/)
    assert.ok((await db.query('select next_run_at > now() ok from report_schedules')).rows[0].ok)
    assert.equal((await db.query('select report_run_due() n')).rows[0].n, 0)
    await as(db, REC)
    assert.equal((await db.query('select * from report_runs')).rows.length, 0)
  })
  it('the paste-ready 10 file installs after 08 and reports OK', async () => {
    const db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(PAYMENTS)
    await db.exec(read('../../../docs/sql/08_hiv_tb_maternity.sql'))
    const rows = (await db.exec(read('../../../docs/sql/10_moh_reports.sql'))).at(-1).rows
    assert.deepEqual(rows.map((r) => r.result), ['OK', 'OK'])
  })
})
