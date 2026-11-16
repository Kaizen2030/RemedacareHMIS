// Ward nursing: supabase/migrations/20261205000000_ward_nursing.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const JANE = '99999999-0000-0000-0000-000000000001'

const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('ward nursing', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$
        begin return p::uuid; exception when others then return null; end $$;
      create table notifications (id bigserial primary key, hospital_id uuid, notification_type text, title text, message text, target_path text, payload_json jsonb);`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/23_ward_nursing.sql'))
    await db.exec(read('../../../docs/sql/23_ward_nursing.sql'))
  })

  it('scores NEWS2 by the RCP bands', async () => {
    const n = async (o) => (await one(db, 'select news2_score($1) as r', [JSON.stringify(o)])).r
    const normal = await n({ rr: 16, spo2: 97, oxygen: false, sbp: 125, hr: 75, consciousness: 'A', temp: 36.8 })
    assert.equal(normal.score, 0); assert.deepEqual(normal.missing, [])
    const sick = await n({ rr: 26, spo2: 90, oxygen: true, sbp: 88, hr: 135, consciousness: 'C', temp: 39.5 })
    assert.deepEqual(sick.parts, { rr: 3, spo2: 3, oxygen: 2, sbp: 3, hr: 3, consciousness: 3, temp: 2 })
    assert.equal(sick.score, 19)
    assert.equal((await n({ spo2: 89, spo2_scale: 2, oxygen: true })).parts.spo2, 0, 'scale 2: 88–92 scores 0')
    assert.equal((await n({ spo2: 97, spo2_scale: 2, oxygen: true })).parts.spo2, 3, 'scale 2: ≥97 on oxygen scores 3')
    assert.equal((await n({ spo2: 97, spo2_scale: 2, oxygen: false })).parts.spo2, 0, 'scale 2: on air scores 0')
    assert.equal((await n({ temp: 35.0 })).parts.temp, 3)
    assert.equal((await n({ hr: 40 })).parts.hr, 3)
  })

  it('sets the response, next-due time and an alert for high scores; observations cannot be edited', async () => {
    await as(db, NURSE)
    const low = await one(db, "insert into ward_observations(hospital_id, patient_id, obs) values ($1, $2, '{\"rr\":22,\"spo2\":97,\"sbp\":125,\"hr\":80,\"consciousness\":\"A\",\"temp\":37}') returning *", [H1, JANE])
    assert.equal(low.score, 2); assert.equal(low.level, 'low')
    assert.equal(Math.round((new Date(low.next_due_at) - new Date(low.observed_at)) / 60000), 240)
    const three = await one(db, "insert into ward_observations(hospital_id, patient_id, obs) values ($1, $2, '{\"rr\":16,\"spo2\":97,\"sbp\":125,\"hr\":80,\"consciousness\":\"V\",\"temp\":37}') returning level", [H1, JANE])
    assert.equal(three.level, 'low_medium', 'a single 3 = urgent ward review')
    const high = await one(db, "insert into ward_observations(hospital_id, patient_id, bed_id, obs) values ($1, $2, 'B1', '{\"rr\":26,\"spo2\":91,\"oxygen\":true,\"sbp\":95,\"hr\":120,\"consciousness\":\"A\",\"temp\":38.5}') returning *", [H1, JANE])
    assert.equal(high.level, 'high'); assert.match(high.response, /Emergency response/)
    await as(db, null)
    assert.ok(await one(db, "select 1 from notifications where title = 'Deteriorating patient'"))
    await as(db, NURSE)
    await refused(db.query('update ward_observations set obs = $2 where id = $1', [high.id, '{}']), /cannot be changed/)
    await db.query("update ward_observations set escalated_to = 'Dr Otieno', reviewed_at = now(), review_note = 'Sepsis bundle started' where id = $1", [high.id])
    assert.ok((await one(db, 'select escalated_at from ward_observations where id = $1', [high.id])).escalated_at)
  })

  it('scores PEWS for children', async () => {
    const p = await one(db, "insert into ward_observations(hospital_id, patient_id, scale, obs) values ($1, $2, 'pews', '{\"behaviour\":1,\"cardiovascular\":1,\"respiratory\":1,\"nebs\":true}') returning score, level", [H1, JANE])
    assert.equal(p.score, 5); assert.equal(p.level, 'high')
    const q = await one(db, "insert into ward_observations(hospital_id, patient_id, scale, obs) values ($1, $2, 'pews', '{\"behaviour\":0,\"cardiovascular\":1,\"respiratory\":2}') returning score, level", [H1, JANE])
    assert.equal(q.score, 3); assert.equal(q.level, 'low_medium')
  })

  it('computes Braden and Morse risk; care plans close once; clinical staff only', async () => {
    const b = await one(db, "insert into ward_risk_assessments(hospital_id, patient_id, kind, answers, total, risk) values ($1, $2, 'braden', '{\"sensory\":2,\"moisture\":2,\"activity\":1,\"mobility\":2,\"nutrition\":2,\"friction\":1}', 0, 'x') returning total, risk", [H1, JANE])
    assert.deepEqual(b, { total: 10, risk: 'high' })
    await refused(db.query("insert into ward_risk_assessments(hospital_id, patient_id, kind, answers, total, risk) values ($1, $2, 'braden', '{\"sensory\":2}', 0, 'x')", [H1, JANE]), /all six/)
    const m = await one(db, "insert into ward_risk_assessments(hospital_id, patient_id, kind, answers, total, risk) values ($1, $2, 'morse', '{\"history\":25,\"secondary_dx\":15,\"aid\":15,\"iv\":20}', 0, 'x') returning total, risk", [H1, JANE])
    assert.deepEqual(m, { total: 75, risk: 'high' })
    const cp = await one(db, "insert into ward_care_plans(hospital_id, patient_id, problem, goal, interventions) values ($1, $2, 'Risk of pressure injury', 'Skin intact at discharge', '[\"2-hourly turns\"]') returning id", [H1, JANE])
    await db.query("update ward_care_plans set status = 'resolved' where id = $1", [cp.id])
    await refused(db.query("update ward_care_plans set status = 'active' where id = $1", [cp.id]), /closed/)
    await as(db, REC)
    assert.equal((await db.query('select * from ward_observations')).rows.length, 0)
  })
})
