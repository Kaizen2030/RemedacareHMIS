// Safety checks: supabase/migrations/20261220000000_safety_checks.sql on PGlite.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const JANE = '99999999-0000-0000-0000-000000000001', BOB = '99999999-0000-0000-0000-000000000002', KIM = '99999999-0000-0000-0000-000000000003'
const DOC1 = 'aaaaaaaa-0000-0000-0000-000000000001', DOC2 = 'aaaaaaaa-0000-0000-0000-000000000002', DOC3 = 'aaaaaaaa-0000-0000-0000-000000000003'
const W1 = 'bbbbbbbb-0000-0000-0000-000000000001'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}
const MON = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 7); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()

const BASE = `
  alter table patients add column phone text, add column age text, add column date_of_birth date;
  insert into patients(id, hospital_id, full_name) values ('${KIM}', '${H1}', 'Kim');
  create table appointments(id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, doctor_id uuid,
    doctor_name text, department text, appointment_type text, appointment_date date, start_time time, end_time time,
    duration_minutes int, status text default 'Scheduled', notes text, visit_id uuid, created_by text,
    cancellation_reason text, completed_at timestamptz, created_at timestamptz default now());
  grant select, insert, update, delete on appointments to authenticated;
  create table wards(id uuid primary key default gen_random_uuid(), hospital_id uuid, name text, ward_type text, total_beds int);
  create table beds(id uuid primary key default gen_random_uuid(), hospital_id uuid, ward_id uuid, bed_number text, status text default 'Free',
    patient_id uuid, visit_id uuid, admitted_at timestamptz, notes text);
  grant select, insert, update, delete on wards, beds to authenticated;
  insert into wards(id, hospital_id, name) values ('${W1}', '${H1}', 'Medical Ward');
  insert into beds(hospital_id, ward_id, bed_number) values ('${H1}', '${W1}', 'M01'), ('${H1}', '${W1}', 'M02'), ('${H1}', '${W1}', 'M03');
`

describe('safety checks', () => {
  let db, js
  before(async () => {
    db = new PGlite({ extensions: { btree_gist } })
    await db.exec(read('./stub.sql'))
    await db.exec(PAYMENTS)
    await db.exec(BASE)
    await db.exec(read('../../migrations/20261116000000_scheduling.sql'))
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/29_dialysis_mortuary.sql'))
    await db.exec(read('../../migrations/20261220000000_safety_checks.sql'))
    await db.exec(read('../../migrations/20261220000000_safety_checks.sql'))
    js = await import('data:text/javascript,' + encodeURIComponent(read('../../../src/utils/safetyChecks.js')))
  })

  it('the paste-ready 38 file installs and reports OK', async () => {
    const x = new PGlite()
    await x.exec(read('./stub.sql'))
    await x.exec(PAYMENTS)
    await x.exec(read('../../../docs/sql/08_hiv_tb_maternity.sql'))
    await x.exec(read('../../../docs/sql/29_dialysis_mortuary.sql'))
    const rows = (await x.exec(read('../../../docs/sql/38_safety_checks.sql'))).at(-1).rows
    assert.deepEqual(rows.slice(0, 2).map((r) => r.result), ['OK', 'OK'])
    assert.match(rows[2].result, /beds table not found/)
  })

  it('dialysis water: graded in the database, failing needs an action, failed chlorine stops sessions until a passing retest', async () => {
    await as(db, NURSE)
    const dp = await one(db, "insert into dialysis_patients(hospital_id, patient_id, hbsag, dry_weight_kg, access_type) values ($1, $2, 'negative', 60, 'AVF') returning id", [H1, JANE])
    const m = await one(db, "insert into dialysis_machines(hospital_id, name) values ($1, 'HD-1') returning id", [H1])
    await refused(db.query("insert into dialysis_water_tests(hospital_id, parameter, value) values ($1, 'total_chlorine', 0.3)", [H1]), /action taken/)
    const bad = await one(db, "insert into dialysis_water_tests(hospital_id, parameter, value, status, action_taken, tested_at) values ($1, 'total_chlorine', 0.3, 'pass', 'Carbon tank changed', now() - interval '1 hour') returning status", [H1])
    assert.equal(bad.status, 'fail', 'status comes from the database, not the client')
    await refused(db.query("insert into dialysis_sessions(hospital_id, dialysis_patient_id, patient_id, machine_id, status, started_at, pre_weight_kg, pre_sbp, pre_dbp) values ($1, $2, $3, $4, 'in_progress', now(), 62, 130, 80)", [H1, dp.id, JANE, m.id]), /Water not safe: total chlorine 0.3/)
    const s = await one(db, 'insert into dialysis_sessions(hospital_id, dialysis_patient_id, patient_id, machine_id) values ($1, $2, $3, $4) returning id', [H1, dp.id, JANE, m.id])
    await refused(db.query("update dialysis_sessions set status = 'in_progress', started_at = now(), pre_weight_kg = 62, pre_sbp = 130, pre_dbp = 80 where id = $1", [s.id]), /Water not safe/)
    await db.query("insert into dialysis_water_tests(hospital_id, parameter, value) values ($1, 'total_chlorine', 0.05)", [H1])
    await db.query("update dialysis_sessions set status = 'in_progress', started_at = now(), pre_weight_kg = 62, pre_sbp = 130, pre_dbp = 80 where id = $1", [s.id])
    await db.query("insert into dialysis_water_tests(hospital_id, parameter, value, tested_at) values ($1, 'bacteria', 60, now() - interval '40 days')", [H1])
    const st = Object.fromEntries((await one(db, 'select dialysis_water_status($1) s', [H1])).s.map((r) => [r.parameter, r]))
    assert.equal(st.total_chlorine.status, 'pass'); assert.equal(st.total_chlorine.blocks_dialysis, false)
    assert.equal(st.bacteria.status, 'action'); assert.equal(st.bacteria.overdue, true, 'monthly culture overdue')
    assert.equal(st.hardness.overdue, true, 'never tested')
    await refused(db.query("update dialysis_water_tests set value = 0 where parameter = 'total_chlorine'"), /permission/)
  })

  it('isolation: precautions steer bed placement; a reason lets staff use another bed; ending needs a reason', async () => {
    await as(db, NURSE)
    await db.query("insert into patient_isolation(hospital_id, patient_id, precaution, reason) values ($1, $2, 'airborne', 'Suspected pulmonary TB')", [H1, JANE])
    await refused(db.query("insert into patient_isolation(hospital_id, patient_id, precaution, reason) values ($1, $2, 'contact', ' ')", [H1, BOB]), /reason/)
    const m01 = (await one(db, "select id from beds where bed_number = 'M01'")).id
    const m02 = (await one(db, "select id from beds where bed_number = 'M02'")).id
    await db.query("update beds set isolation_type = 'negative_pressure' where id = $1", [m02])
    assert.match((await one(db, 'select bed_isolation_check($1, $2) r', [m01, JANE])).r, /airborne/)
    assert.equal((await one(db, 'select bed_isolation_check($1, $2) r', [m02, JANE])).r, null)
    await refused(db.query("update beds set status = 'Occupied', patient_id = $2 where id = $1", [m01, JANE]), /Jane needs airborne isolation/)
    await db.query("update beds set status = 'Occupied', patient_id = $2, isolation_override_reason = 'Side room full; screens and N95 for staff' where id = $1", [m01, JANE])
    let board = (await one(db, 'select isolation_board($1) b', [H1])).b
    assert.equal(board[0].full_name, 'Jane'); assert.equal(board[0].bed_number, 'M01'); assert.match(board[0].problem, /airborne/)
    await db.query("update beds set status = 'Free', patient_id = null where id = $1", [m01])
    assert.equal((await one(db, 'select isolation_override_reason r from beds where id = $1', [m01])).r, null, 'override cleared when the bed is freed')
    await db.query("update beds set status = 'Occupied', patient_id = $2 where id = $1", [m02, JANE])
    board = (await one(db, 'select isolation_board($1) b', [H1])).b
    assert.equal(board[0].problem, null)
    await db.query("update beds set status = 'Occupied', patient_id = $2 where id = $1", [m01, BOB])
    const iso = (await one(db, 'select id from patient_isolation where patient_id = $1', [JANE])).id
    await refused(db.query('update patient_isolation set ended_at = now() where id = $1', [iso]), /reason for ending/)
    await as(db, REC)
    assert.equal((await db.query('select * from patient_isolation')).rows.length, 0, 'reception cannot see the organism')
    await refused(db.query('select isolation_board($1)', [H1]), /Clinical access/)
  })

  it('visitor passes: admitted patients only, isolation needs approval, hours and bedside maximum at check-in', async () => {
    await as(db, REC)
    await refused(db.query("insert into visitor_passes(hospital_id, patient_id, visitor_name) values ($1, $2, 'Ann')", [H1, KIM]), /not in a ward bed/)
    await refused(db.query("insert into visitor_passes(hospital_id, patient_id, visitor_name) values ($1, $2, 'Ann')", [H1, JANE]), /airborne isolation — the nurse in charge/)
    const pj = await one(db, "insert into visitor_passes(hospital_id, patient_id, visitor_name, override_reason) values ($1, $2, 'Ann', 'Sr Wanjiru approved, N95 given') returning *", [H1, JANE])
    assert.match(pj.pass_no, /^VP-\d{6}-001$/); assert.equal(pj.ward_name, 'Medical Ward'); assert.equal(pj.bed_number, 'M02')
    await as(db, null)
    await db.query(`insert into visitor_settings(hospital_id, max_per_patient, windows) values ($1, 2, '[{"from":"00:00","to":"23:59:59"}]')`, [H1])
    await as(db, REC)
    const passes = []
    for (const n of ['Tom', 'Sue', 'Max']) passes.push((await one(db, 'insert into visitor_passes(hospital_id, patient_id, visitor_name) values ($1, $2, $3) returning pass_no', [H1, BOB, n])).pass_no)
    await db.query("select visitor_pass_action($1, $2, 'in')", [H1, passes[0]])
    await db.query("select visitor_pass_action($1, $2, 'in')", [H1, passes[1].toLowerCase()])
    await refused(db.query("select visitor_pass_action($1, $2, 'in')", [H1, passes[2]]), /Already 2 visitor/)
    await refused(db.query("select visitor_pass_action($1, $2, 'in')", [H1, passes[0]]), /already in/)
    await db.query("select visitor_pass_action($1, $2, 'out')", [H1, passes[0]])
    assert.equal((await one(db, "select visitor_pass_action($1, $2, 'in') r", [H1, passes[2]])).r.status, 'in')
    await refused(db.query("select visitor_pass_action($1, $2, 'revoke')", [H1, passes[2]]), /reason/)
    await refused(db.query("update visitor_passes set status = 'in' where pass_no = $1", [passes[0]]), /permission/)
    await as(db, null)
    await db.query(`update visitor_settings set windows = '[]' where hospital_id = $1`, [H1])
    await db.query("update visitor_passes set issued_at = now() - interval '2 days' where pass_no = $1", [pj.pass_no])
    await as(db, REC)
    const late = (await one(db, "insert into visitor_passes(hospital_id, patient_id, visitor_name) values ($1, $2, 'Liz') returning pass_no", [H1, BOB])).pass_no
    await refused(db.query("select visitor_pass_action($1, $2, 'in')", [H1, late]), /Outside visiting hours/)
    await db.query("select visitor_pass_action($1, $2, 'out')", [H1, passes[1]])
    await db.query("select visitor_pass_action($1, $2, 'in', 'Patient critical; family called by the doctor')", [H1, late])
    await refused(db.query("select visitor_pass_action($1, $2, 'in')", [H1, pj.pass_no]), /expired/)
  })

  it('appointments: a room or item cannot be double-booked beyond its quantity; type resources are added', async () => {
    await as(db, null)
    await db.query("insert into scheduling_resources(hospital_id, name, kind, quantity) values ($1, 'Procedure room 1', 'room', 1), ($1, 'Ultrasound', 'equipment', 2)", [H1])
    await db.query("insert into appointment_types(hospital_id, name, default_minutes, resources) values ($1, 'Obstetric scan', 30, '{Ultrasound}')", [H1])
    await as(db, REC)
    const book = (doc, name, start, extra = {}) => db.query(
      `insert into appointments(hospital_id, patient_id, doctor_id, doctor_name, appointment_type, appointment_date, start_time, duration_minutes, room, schedule_override_reason)
       values ($1, $2, $3, $4, $5, $6, $7, 30, $8, 'test') returning *`, [H1, extra.patient || JANE, doc, name, extra.type || 'Review', MON, start, extra.room ?? null])
    await book(DOC1, 'Dr Achieng', '09:00', { room: 'Procedure room 1' })
    await refused(book(DOC2, 'Dr Baraka', '09:15', { room: 'procedure ROOM 1', patient: BOB }), /Procedure room 1 is already booked from 09:00 to 09:30 \(Dr Achieng\)/)
    await book(DOC2, 'Dr Baraka', '09:30', { room: 'Procedure room 1', patient: BOB })
    const a = (await book(DOC1, 'Dr Achieng', '10:00', { type: 'Obstetric scan' })).rows[0]
    assert.deepEqual(a.resources, ['Ultrasound'])
    await book(DOC2, 'Dr Baraka', '10:00', { type: 'Obstetric scan', patient: BOB })
    await refused(book(DOC3, 'Dr Chebet', '10:15', { type: 'obstetric scan', patient: KIM }), /Ultrasound is already booked/)
    await db.query("update appointments set status = 'Cancelled' where id = $1", [a.id])
    await book(DOC3, 'Dr Chebet', '10:15', { type: 'Obstetric scan', patient: KIM })
    await book(DOC1, 'Dr Achieng', '11:00', { room: 'Room 9 (not catalogued)' })
  })

  it('JavaScript mirrors give the same answers as the database', async () => {
    await as(db, null)
    const values = { total_chlorine: [0, 0.09, 0.1, 0.5], hardness: [0, 17.1, 17.2], conductivity: [5, 9.99, 10, 20, 20.1], bacteria: [0, 49, 50, 99, 100], endotoxin: [0.1, 0.125, 0.249, 0.25] }
    for (const [p, vs] of Object.entries(values)) for (const v of vs) {
      assert.equal(js.dialysisWaterGrade(p, v), (await one(db, 'select dialysis_water_grade($1, $2) r', [p, v])).r, `${p} ${v}`)
    }
    const beds = [null, 'single_room', 'negative_pressure', 'cohort']
    const sets = [[], ['contact'], ['droplet'], ['airborne'], ['protective'], ['contact', 'airborne'], ['contact', 'protective']]
    for (const b of beds) for (const p of sets) {
      assert.equal(js.bedIsolationProblem(b, p), (await one(db, 'select bed_isolation_problem($1, $2) r', [b, p])).r, `${b} ${p}`)
    }
    const w = [{ from: '06:00', to: '07:00' }, { from: '12:30', to: '14:00' }]
    for (const t of ['05:59', '06:00', '06:59', '07:00', '13:00', '14:00']) {
      assert.equal(js.inVisitingHours(w, t), (await one(db, 'select visitor_in_hours($1, $2::time) r', [JSON.stringify(w), t])).r, t)
    }
  })
})
