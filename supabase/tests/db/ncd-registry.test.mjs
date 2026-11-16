// NCD registry: supabase/migrations/20261117000000_ncd_registry.sql on PGlite.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const SCHED = read('../../migrations/20261116000000_scheduling.sql')
const NCD = read('../../migrations/20261117000000_ncd_registry.sql')
const H1 = '11111111-1111-1111-1111-111111111111'
const REC = '00000000-0000-0000-0000-0000000000a1', OTHER = '00000000-0000-0000-0000-0000000000b1', OWNER = '00000000-0000-0000-0000-0000000000a4'
const JANE = '99999999-0000-0000-0000-000000000001', BOB = '99999999-0000-0000-0000-000000000002'

const LEGACY = `
  alter table patients add column phone text;
  create table appointments(id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, doctor_id uuid,
    doctor_name text, department text, appointment_type text, appointment_date date, start_time time, end_time time,
    duration_minutes int, status text default 'Scheduled', notes text, visit_id uuid, created_by text,
    cancellation_reason text, completed_at timestamptz, created_at timestamptz default now());
  create table chronic_disease_records(id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, patient_name text,
    condition text, visit_date date, notes text, current_meds text, oral_meds text, arv_regimen text, adherence_score int,
    viral_load text, hba1c text, bp_systolic int, bp_diastolic int, created_at timestamptz default now());
  insert into chronic_disease_records(hospital_id, patient_id, condition, visit_date, hba1c, bp_systolic, bp_diastolic, adherence_score, current_meds) values
    ('${H1}', '${JANE}', 'Type 2 Diabetes', current_date - 60, '8.4%', 150, 95, 2, 'Metformin 500mg BD'),
    ('${H1}', '${JANE}', 'Type 2 Diabetes', current_date - 20, '6.5', null, null, 5, 'Metformin'),
    ('${H1}', '${BOB}', 'HIV', current_date - 10, null, null, null, 4, null);
  update chronic_disease_records set viral_load = 'LDL', arv_regimen = 'TDF/3TC/DTG' where condition = 'HIV';
`
async function boot() {
  const db = new PGlite({ extensions: { btree_gist } })
  await db.exec(read('./stub.sql'))
  await db.exec(PAYMENTS)
  await db.exec(LEGACY)
  await db.exec(SCHED)
  await db.exec(NCD)
  return db
}
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('control targets from config', () => {
  let db
  before(async () => { db = await boot(); await as(db, null) })

  it('evaluates any field_max / field_min target; unknown when nothing comparable', async () => {
    const ev = async (v, t) => (await one(db, 'select ncd_evaluate($1::jsonb, $2::jsonb) as r', [v, t])).r
    assert.equal(await ev('{"bp_sys":132,"bp_dia":84}', '{"bp_sys_max":139,"bp_dia_max":89}'), 'controlled')
    assert.equal(await ev('{"bp_sys":145,"bp_dia":84}', '{"bp_sys_max":139,"bp_dia_max":89}'), 'uncontrolled')
    assert.equal(await ev('{"weight_kg":70}', '{"bp_sys_max":139}'), 'unknown')
    assert.equal(await ev('{"act_score":18}', '{"act_score_min":20}'), 'uncontrolled')
  })
  it('hospital and per-patient overrides win over the national default', async () => {
    assert.deepEqual((await one(db, "select ncd_targets($1, 'dm', '{}') as t", [H1])).t, { hba1c_max: 6.9, fbs_max: 7 })
    await db.query("insert into ncd_condition_config(hospital_id, code, label, targets) values ($1, 'dm', 'Diabetes', '{\"hba1c_max\":7.4}')", [H1])
    assert.equal((await one(db, "select ncd_targets($1, 'dm', '{}') as t", [H1])).t.hba1c_max, 7.4)
    assert.equal((await one(db, "select ncd_targets($1, 'dm', '{\"hba1c_max\":7.9}') as t", [H1])).t.hba1c_max, 7.9)
  })
})

describe('old free-text register is carried over', () => {
  let db
  before(async () => { db = await boot(); await as(db, null) })

  it('one enrolment per patient + condition, visits with parsed numbers, latest visit drives control', async () => {
    const { rows } = await db.query('select condition_code, status, control_status, last_values from ncd_enrolments order by condition_code')
    assert.deepEqual(rows.map((r) => [r.condition_code, r.status, r.control_status]), [['dm', 'active', 'controlled'], ['hiv', 'active', 'controlled']])
    assert.equal(rows[0].last_values.hba1c, 6.5)
    assert.equal(rows[1].last_values.viral_load, 0, 'LDL → 0')
    const v = await one(db, "select count(*)::int n, min(hba1c) lo, max(hba1c) hi from ncd_visits where patient_id = $1", [JANE])
    assert.deepEqual(v, { n: 2, lo: '6.5', hi: '8.4' })
  })
  it('re-running the migration does not duplicate anything', async () => {
    await db.exec(NCD)
    assert.equal((await one(db, 'select count(*)::int n from ncd_visits')).n, 3)
    assert.equal((await one(db, 'select count(*)::int n from ncd_enrolments')).n, 2)
  })
})

describe('visits, recall and tracing', () => {
  let db, enrol
  before(async () => {
    db = await boot(); await as(db, REC)
    enrol = (await one(db, "insert into ncd_enrolments(hospital_id, patient_id, condition_code, enrolled_on, risk_class) values ($1, $2, 'htn', current_date - 100, 'high') returning *", [H1, JANE]))
  })

  it('enrolment gets the label and first due date from config; one active enrolment per condition', async () => {
    assert.equal(enrol.condition_label, 'Hypertension')
    assert.equal((await one(db, "select (next_visit_due = enrolled_on + 30) ok from ncd_enrolments where id = $1", [enrol.id])).ok, true)
    await refused(db.query("insert into ncd_enrolments(hospital_id, patient_id, condition_code) values ($1, $2, 'htn')", [H1, JANE]), /duplicate/)
  })
  it('a visit sets control status, next due and refill due', async () => {
    await db.query("insert into ncd_visits(enrolment_id, hospital_id, patient_id, visit_date, bp_sys, bp_dia, refill_days, adherence) values ($1, $2, $3, current_date - 70, 162, 98, 30, 'poor')", [enrol.id, H1, JANE])
    const e = await one(db, 'select control_status, (next_visit_due = last_visit_date + 30) due_ok, (refill_due = last_visit_date + 30) refill_ok from ncd_enrolments where id = $1', [enrol.id])
    assert.deepEqual(e, { control_status: 'uncontrolled', due_ok: true, refill_ok: true })
  })
  it('recall: overdue after 7 days → tracing task; after 28 days → lost to follow-up', async () => {
    await as(db, null)
    // last visit 70 days ago, due 40 days ago → LTFU
    const r = await one(db, 'select ncd_recall_sweep() as r')
    assert.deepEqual(r.r, { new_overdue_tasks: 0, new_ltfu: 1 })
    const e = await one(db, 'select status from ncd_enrolments where id = $1', [enrol.id])
    assert.equal(e.status, 'ltfu')
    const t = await one(db, "select reason, status from ncd_tracing_tasks where enrolment_id = $1", [enrol.id])
    assert.deepEqual(t, { reason: 'ltfu', status: 'open' })
    // running again is idempotent
    assert.deepEqual((await one(db, 'select ncd_recall_sweep() as r')).r, { new_overdue_tasks: 0, new_ltfu: 0 })
  })
  it('tracing attempts are logged; a returning patient closes the task and is active again', async () => {
    await as(db, REC)
    const t = await one(db, "select id from ncd_tracing_tasks where enrolment_id = $1 and status = 'open'", [enrol.id])
    await db.query("insert into ncd_tracing_attempts(task_id, hospital_id, method, result) values ($1, $2, 'call', 'no_answer'), ($1, $2, 'chw', 'reached')", [t.id, H1])
    await db.query("insert into ncd_visits(enrolment_id, hospital_id, patient_id, visit_date, bp_sys, bp_dia) values ($1, $2, $3, current_date, 134, 82)", [enrol.id, H1, JANE])
    const e = await one(db, 'select status, control_status from ncd_enrolments where id = $1', [enrol.id])
    assert.deepEqual(e, { status: 'active', control_status: 'controlled' })
    assert.deepEqual(await one(db, 'select status, outcome from ncd_tracing_tasks where id = $1', [t.id]), { status: 'closed', outcome: 'returned' })
  })
  it('a patient with a future booking is not counted as a defaulter', async () => {
    await as(db, null)
    const e2 = await one(db, "insert into ncd_enrolments(hospital_id, patient_id, condition_code, enrolled_on) values ($1, $2, 'dm', current_date - 50) returning id", [H1, BOB])
    await db.query("insert into appointments(hospital_id, patient_id, doctor_id, doctor_name, appointment_date, start_time, duration_minutes) values ($1, $2, gen_random_uuid(), 'Dr A', current_date + 3, '10:00', 20)", [H1, BOB])
    await db.query('select ncd_recall_sweep()')
    assert.equal((await one(db, 'select count(*)::int n from ncd_tracing_tasks where enrolment_id = $1', [e2.id])).n, 0)
  })
  it('a missed appointment opens a tracing task at once', async () => {
    const appt = await one(db, 'select id from appointments where patient_id = $1', [BOB])
    await db.query("update appointments set status = 'No-Show' where id = $1", [appt.id])
    assert.equal((await one(db, "select reason from ncd_tracing_tasks where patient_id = $1 and status = 'open'", [BOB])).reason, 'missed_appointment')
  })
  it('marking died closes tracing', async () => {
    await db.query("update ncd_enrolments set status = 'died', status_reason = 'Community report' where patient_id = $1", [BOB])
    assert.deepEqual(await one(db, 'select status, outcome from ncd_tracing_tasks where patient_id = $1', [BOB]), { status: 'closed', outcome: 'died' })
  })
})

describe('the paste-ready SQL file', () => {
  it('docs/sql/06_ncd_registry.sql installs on top of 05 and reports OK', async () => {
    const db = new PGlite({ extensions: { btree_gist } })
    await db.exec(read('./stub.sql'))
    await db.exec(PAYMENTS)
    await db.exec(LEGACY)
    await db.exec(read('../../../docs/sql/05_scheduling.sql'))
    const res = await db.exec(read('../../../docs/sql/06_ncd_registry.sql'))
    const rows = res.at(-1).rows
    assert.deepEqual(rows.slice(0, 2).map((r) => r.result), ['OK', 'OK'])
    assert.equal(rows[2].result, '2 enrolments, 3 visits')
  })
})

describe('dashboards, cohorts and security', () => {
  let db
  before(async () => { db = await boot() })

  it('summary per condition for members only', async () => {
    await as(db, REC)
    const { rows } = await db.query('select condition_code, active::int, controlled::int from ncd_summary($1) order by 1', [H1])
    assert.deepEqual(rows, [{ condition_code: 'dm', active: 1, controlled: 1 }, { condition_code: 'hiv', active: 1, controlled: 1 }])
    await as(db, OTHER)
    await refused(db.query('select * from ncd_summary($1)', [H1]), /Not a member/)
    assert.equal((await db.query('select * from ncd_enrolments')).rows.length, 0, 'other hospital sees nothing')
  })
  it('6- and 12-month cohort outcomes', async () => {
    await as(db, null)
    await db.query("update ncd_enrolments set enrolled_on = current_date - 400 where condition_code = 'dm'")
    await db.query("update ncd_enrolments set enrolled_on = current_date - 400, status = 'ltfu', status_date = current_date - 300 where condition_code = 'hiv'")
    await as(db, REC)
    const six = await one(db, "select * from ncd_cohort($1, null, current_date - 500, current_date, 6)", [H1])
    assert.deepEqual(Object.fromEntries(Object.entries(six).map(([k, v]) => [k, Number(v)])),
      { enrolled: 2, in_care: 1, controlled: 0, ltfu: 1, died: 0, transferred: 0, not_yet_due: 0 })
  })
  it('only admins change hospital targets; nobody runs the sweep from the browser', async () => {
    await as(db, REC)
    await refused(db.query("insert into ncd_condition_config(hospital_id, code, label, targets) values ($1, 'htn', 'HTN', '{}')", [H1]))
    await refused(db.query('select ncd_recall_sweep()'))
    await as(db, OWNER)
    await db.query("insert into ncd_condition_config(hospital_id, code, label, targets) values ($1, 'htn', 'HTN', '{\"bp_sys_max\":149}')", [H1])
  })
})
