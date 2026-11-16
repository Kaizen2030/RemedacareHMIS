// Theatre: supabase/migrations/20261203000000_theatre.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const JANE = '99999999-0000-0000-0000-000000000001'
const SIGN_IN = { identity_confirmed: 'yes', site_marked: 'yes', consent: 'yes', anaesthesia_check: 'yes', pulse_oximeter: 'yes', allergy: 'no', difficult_airway: 'no', blood_loss_risk: 'yes_planned' }
const TIME_OUT = { team_introduced: 'yes', patient_site_procedure: 'yes', antibiotics: 'yes', critical_events: 'yes', sterility: 'yes', imaging: 'na' }
const SIGN_OUT = { procedure_recorded: 'yes', counts_correct: 'yes', specimens_labelled: 'yes', equipment_problems: 'none', recovery_concerns: 'yes' }

const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}
const upd = (db, id, patch) => db.query(`update theatre_cases set ${Object.keys(patch).map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`,
  [id, ...Object.values(patch).map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : v))])

describe('theatre', () => {
  let db, room, caseId
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$
        begin return p::uuid; exception when others then return null; end $$;`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/21_theatre.sql'))
    await db.exec(read('../../../docs/sql/21_theatre.sql'))
    await as(db, NURSE)
    room = (await one(db, "insert into theatre_rooms(hospital_id, name) values ($1, 'Theatre 1') returning id", [H1])).id
  })

  it('books a case and refuses a clash in the same room', async () => {
    caseId = (await one(db, `insert into theatre_cases(hospital_id, patient_id, room_id, procedure, surgeon, scheduled_start, scheduled_end)
      values ($1, $2, $3, 'Appendicectomy', 'Dr Mwangi', now(), now() + interval '2 hours') returning id`, [H1, JANE, room])).id
    await refused(db.query(`insert into theatre_cases(hospital_id, patient_id, room_id, procedure, surgeon, scheduled_start, scheduled_end)
      values ($1, $2, $3, 'Hernia repair', 'Dr Mwangi', now() + interval '1 hour', now() + interval '3 hours')`, [H1, JANE, room]), /already booked.*Appendicectomy/)
  })

  it('enforces the WHO checklist in order, item by item', async () => {
    await refused(upd(db, caseId, { time_out: TIME_OUT }), /sign in before the time out/)
    await upd(db, caseId, { sign_in: { ...SIGN_IN, pulse_oximeter: 'no' } })
    assert.equal((await one(db, 'select sign_in_at from theatre_cases where id = $1', [caseId])).sign_in_at, null, 'a "no" on a safety item is not complete')
    await refused(upd(db, caseId, { anaesthesia_start: new Date() }), /sign in before anaesthesia/)
    await upd(db, caseId, { sign_in: SIGN_IN, anaesthesia_start: new Date(), in_theatre_at: new Date(), status: 'in_theatre' })
    await refused(upd(db, caseId, { knife_to_skin: new Date() }), /time out before the incision/)
    await upd(db, caseId, { time_out: TIME_OUT, knife_to_skin: new Date(), status: 'operating' })
    await refused(upd(db, caseId, { sign_in: { ...SIGN_IN, allergy: 'yes' } }), /cannot change after the time out/)
    await refused(upd(db, caseId, { sign_out: { ...SIGN_OUT, counts_correct: 'no' }, status: 'recovery' }), /sign out before the patient leaves/)
    await upd(db, caseId, { sign_out: SIGN_OUT, closure_at: new Date(), status: 'recovery' })
    const c = await one(db, 'select sign_in_by, time_out_at, sign_out_at, out_of_theatre from theatre_cases where id = $1', [caseId])
    assert.equal(c.sign_in_by, NURSE); assert.ok(c.time_out_at && c.sign_out_at && c.out_of_theatre)
  })

  it('needs the operation note and an Aldrete score of 9+ to complete; then the case is closed', async () => {
    await refused(upd(db, caseId, { status: 'completed' }), /operation note/)
    await upd(db, caseId, { op_note: { procedure_performed: 'Open appendicectomy', findings: 'Inflamed appendix, no perforation', post_op_plan: 'Oral fluids after 6 h' }, recovery: [{ total: 7 }] })
    await refused(upd(db, caseId, { status: 'completed' }), /Aldrete/)
    await upd(db, caseId, { recovery: [{ total: 7 }, { total: 9 }], status: 'completed' })
    assert.equal((await one(db, 'select complication_grade from theatre_cases where id = $1', [caseId])).complication_grade, 'none')
    await refused(upd(db, caseId, { procedure: 'Something else' }), /closed/)
    await upd(db, caseId, { complication_grade: 'II', complications: 'Wound infection day 5, oral antibiotics' })
  })

  it('implants need a lot or serial number; cancellations need a reason; statistics; clinical staff only', async () => {
    await refused(db.query("insert into theatre_items(hospital_id, case_id, kind, name) values ($1, $2, 'implant', 'DHS plate')", [H1, caseId]), /check/)
    await db.query("insert into theatre_items(hospital_id, case_id, kind, name, lot_number) values ($1, $2, 'implant', 'DHS plate', 'LOT-77')", [H1, caseId])
    const other = (await one(db, `insert into theatre_cases(hospital_id, patient_id, room_id, procedure, surgeon, scheduled_start, scheduled_end)
      values ($1, $2, $3, 'Hernia repair', 'Dr Mwangi', now() + interval '3 hours', now() + interval '4 hours') returning id`, [H1, JANE, room])).id
    await refused(upd(db, other, { status: 'cancelled' }), /reason/)
    await upd(db, other, { status: 'cancelled', cancel_reason: 'Patient not fasted' })
    const s = (await one(db, 'select theatre_stats($1, current_date - 1, current_date + 1) as s', [H1])).s
    assert.equal(s.completed, 1); assert.equal(s.cancelled, 1); assert.equal(s.checklist_complete_pct, 100); assert.equal(s.complications, 1); assert.equal(s.implants, 1)
    assert.deepEqual(s.cancel_reasons, { 'Patient not fasted': 1 })
    await as(db, REC)
    assert.equal((await db.query('select * from theatre_cases')).rows.length, 0)
    await as(db, NURSE)
  })
})
