// Specialty assessments: supabase/migrations/20261209000000_specialty_assessments.sql.
// The database scoring must agree exactly with the app's preview (src/utils/specialtyTemplates.js).
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

const CASES = [
  ['mental_health', { q1: 3, q2: 3, q3: 2, q4: 2, q5: 1, q6: 2, q7: 1, q8: 1, q9: 1, g1: 2, g2: 2, g3: 2, g4: 2, g5: 1, g6: 1, g7: 1, c1: 'yes', c2: 'yes', c3: 'yes', c4: 'yes', c5: 'no', c6: 'no', a1: 2, a2: 1, a3: 0, sex: 'female' }],
  ['mental_health', { q1: 1, q2: 1, q3: 0, q4: 1, q5: 0, q6: 0, q7: 0, q8: 0, q9: 0, c1: 'no', c2: 'no' }],
  ['mental_health', { q1: 0, q9: 2 }],
  ['eye', { va_r: '6/60', va_l: '6/24', ph_r: '6/18', iop_r: 26, iop_l: 18 }],
  ['eye', { va_r: 'CF', va_l: 'HM' }],
  ['dental', { teeth: { 16: 'caries', 26: 'extract', 36: 'missing', 46: 'filled', 11: 'crown', 21: 'rct', 22: 'sound' }, s1: 2, s2: 1, s3: 4 }],
  ['ent', { tm_r: 'perforation', discharge: 'ge2w', whisper: 'fail_r', tonsils: '3', snoring: 'apnoea' }],
  ['physio', { feeding: 10, bathing: 0, grooming: 5, dressing: 5, bowels: 10, bladder: 5, toilet: 5, transfers: 10, mobility: 10, stairs: 0, pain_move: 8 }],
  ['cardiology', { af: 'yes', age: 78, sex: 'female', htn: true, diabetes: true, nyha: '3' }],
  ['cardiology', { af: 'yes', age: 60, sex: 'male', htn: true }],
  ['cardiology', { af: 'yes', age: 50, sex: 'female' }],
  ['dermatology', { bsa: 12, itch: 6 }],
  ['dermatology', { bsa: 2 }],
]

describe('specialty assessments', () => {
  let db, js
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$ begin return p::uuid; exception when others then return null; end $$;
      create table notifications (id bigserial primary key, hospital_id uuid, notification_type text, title text, message text, target_path text, payload_json jsonb);`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/27_specialty_assessments.sql'))
    await db.exec(read('../../../docs/sql/27_specialty_assessments.sql'))
    js = await import('data:text/javascript,' + encodeURIComponent(read('../../../src/utils/specialtyTemplates.js')))
  })

  it('database scores and alerts match the app preview exactly', async () => {
    for (const [t, d] of CASES) {
      const sql = (await one(db, 'select specialty_score($1, $2) r', [t, JSON.stringify(d)])).r
      const app = js.scoreAssessment(t, d)
      assert.deepEqual(sql.flags, app.flags, `${t} flags ${JSON.stringify(d)}`)
      assert.deepEqual(Object.fromEntries(Object.entries(sql.scores).map(([k, v]) => [k, typeof v === 'string' ? v : Number(v)])), app.scores, `${t} scores ${JSON.stringify(d)}`)
    }
  })

  it('known values: PHQ-9, WHO vision category, DMFT, Barthel, CHA2DS2-VASc', async () => {
    const s = async (t, d) => (await one(db, 'select specialty_score($1, $2) r', [t, JSON.stringify(d)])).r
    const mh = await s(...CASES[0])
    assert.equal(mh.scores.phq9, 16); assert.equal(mh.scores.phq9_band, 'Moderately severe'); assert.equal(mh.scores.suicide_risk, 'high')
    assert.equal(mh.scores.gad7, 11); assert.equal(mh.scores.audit_c, 3)
    assert.equal((await s(...CASES[3])).scores.who_category, 'Moderate impairment', 'better eye 6/24 = 0.25')
    assert.equal((await s('eye', { va_r: '6/60', va_l: '6/60' })).scores.who_category, 'Moderate impairment')
    assert.equal((await s(...CASES[4])).scores.who_category, 'Blindness')
    assert.deepEqual((await s(...CASES[5])).scores, { D: 2, M: 1, F: 2, DMFT: 5, bpe_max: 4 })
    assert.equal((await s(...CASES[7])).scores.barthel, 60)
    assert.equal((await s(...CASES[8])).scores.cha2ds2_vasc, 5) // age 78 (2) + female (1) + hypertension (1) + diabetes (1)
    assert.equal((await s(...CASES[9])).scores.anticoagulation, 'Consider')
    assert.equal((await s(...CASES[10])).scores.anticoagulation, 'Not indicated')
  })

  it('stores computed scores, alerts high suicide risk, is immutable and clinical-only', async () => {
    await as(db, NURSE)
    const a = await one(db, 'insert into specialty_assessments(hospital_id, patient_id, template, data, scores) values ($1, $2, $3, $4, $5) returning *',
      [H1, JANE, 'mental_health', JSON.stringify(CASES[0][1]), JSON.stringify({ phq9: 0 })])
    assert.equal(a.scores.phq9, 16, 'client-supplied scores are ignored')
    let msg = null
    try { await db.query("update specialty_assessments set data = '{}' where id = $1", [a.id]) } catch (e) { msg = e.message }
    assert.match(msg || '', /cannot be changed|permission denied/)
    await as(db, null)
    assert.ok(await one(db, "select 1 from notifications where title = 'High suicide risk'"))
    await as(db, REC)
    assert.equal((await db.query('select * from specialty_assessments')).rows.length, 0)
  })
})
