// Growth z-scores, orthopaedics and oncology: supabase/migrations/20261213000000_growth_ortho_oncology.sql.
// Database and app (src/utils/growth.js, specialtyTemplates.js) must agree.
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
const mod = (src) => import('data:text/javascript,' + encodeURIComponent(src))

// exact WHO day-level LMS rows (from the full anthro tables) — interpolation must stay within 0.02 z
const EXACT = [
  ['wfa', 1, 400, [0.0552, 9.9065, 0.10953], 10.4],
  ['lhfa', 2, 1000, [1, 92.8178, 0.03949], 88.0],
  ['wfl', 1, 72.3, [-0.3521, 8.9353, 0.08259], 8.1],
  ['hcfa', 2, 45, [1, 37.4411, 0.03187], 36.2],
  ['wfa', 2, 20, [0.2061, 3.7968, 0.14098], 3.4],
  ['lhfa', 1, 100, [1, 62.1826, 0.03306], 60.5],
  ['hcfa', 1, 75, [1, 39.8127, 0.02955], 40.6],
]

describe('growth z-scores, orthopaedics and oncology', () => {
  let db, growth, spec
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec("alter table patients add column date_of_birth date, add column gender text; update patients set date_of_birth = current_date - 400, gender = 'Male' where full_name = 'Jane';")
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$ begin return p::uuid; exception when others then return null; end $$;
      create table notifications (id bigserial primary key, hospital_id uuid, notification_type text, title text, message text, target_path text, payload_json jsonb);`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/27_specialty_assessments.sql'))
    await db.exec(read('../../../docs/sql/31_growth_ortho_oncology.sql'))
    await db.exec(read('../../../docs/sql/31_growth_ortho_oncology.sql'))
    const ref = read('../../../src/utils/growthReference.js')
    const refUrl = 'data:text/javascript,' + encodeURIComponent(ref)
    growth = await mod(read('../../../src/utils/growth.js').replace("from './growthReference'", `from '${refUrl}'`))
    spec = await mod(read('../../../src/utils/specialtyTemplates.js'))
  })

  it('interpolated reference stays within 0.02 z of the exact WHO day / length tables', async () => {
    for (const [ind, sex, x, lms, value] of EXACT) {
      const exact = growth.zFromLms(value, lms, ['wfa', 'wfl'].includes(ind))
      const sql = Number((await one(db, 'select growth_z($1, growth_lms($2, $3::smallint, $4), $5) z', [value, ind, sex, x, ['wfa', 'wfl'].includes(ind)])).z)
      assert.ok(Math.abs(sql - exact) <= 0.02, `${ind} ${x}: ${sql} vs exact ${exact}`)
    }
  })

  it('database and app agree on z-scores and alerts', async () => {
    await as(db, NURSE)
    const cases = [
      { age_days: 30, sex: 'female', weight_kg: 3.1, length_cm: 52, measured: 'length', hc_cm: 35 },
      { age_days: 400, sex: 'male', weight_kg: 7.2, length_cm: 70, measured: 'length', muac_cm: 11.3 },
      { age_days: 900, sex: 'female', weight_kg: 9.0, length_cm: 82, measured: 'length', muac_cm: 12.2 },
      { age_days: 1500, sex: 'male', weight_kg: 24, length_cm: 104, measured: 'height', hc_cm: 54 },
      { age_days: 200, sex: 'male', weight_kg: 4.6, length_cm: 61, measured: 'height', oedema: true },
      { age_days: 700, sex: 'female', weight_kg: 16.5, length_cm: 79, measured: 'length', hc_cm: 41 },
    ]
    for (const c of cases) {
      const row = await one(db, `insert into growth_measurements(hospital_id, patient_id, age_days, sex, weight_kg, length_cm, measured, hc_cm, muac_cm, oedema)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`, [H1, JANE, c.age_days, c.sex, c.weight_kg, c.length_cm, c.measured, c.hc_cm ?? null, c.muac_cm ?? null, c.oedema ?? false])
      const app = growth.growthAssess(c)
      for (const k of ['waz', 'haz', 'whz', 'hcz']) {
        if (app[k] === null) assert.equal(row[k], null, `${k} ${JSON.stringify(c)}`)
        else assert.ok(Math.abs(Number(row[k]) - app[k]) <= 0.011, `${k}: db ${row[k]} app ${app[k]} ${JSON.stringify(c)}`)
      }
      assert.deepEqual(row.flags, app.flags, JSON.stringify(c))
    }
  })

  it('uses the date of birth and sex from the patient record; checks inputs; immutable; clinical only', async () => {
    const r = await one(db, "insert into growth_measurements(hospital_id, patient_id, weight_kg, length_cm) values ($1, $2, 7.0, 71) returning age_days, sex, waz, flags", [H1, JANE])
    assert.equal(r.age_days, 400); assert.equal(r.sex, 'Male'); assert.ok(Number(r.waz) < -2)
    assert.ok(r.flags.includes('Underweight (WAZ < −2)'))
    let msg = null
    try { await db.query("insert into growth_measurements(hospital_id, patient_id, age_days, sex, weight_kg) values ($1, $2, 2500, 'male', 18)", [H1, JANE]) } catch (e) { msg = e.message }
    assert.match(msg || '', /under 5 years/)
    msg = null
    try { await db.query("update growth_measurements set weight_kg = 9") } catch (e) { msg = e.message }
    assert.match(msg || '', /cannot be changed|permission denied/)
    await as(db, REC)
    assert.equal((await db.query('select * from growth_measurements')).rows.length, 0)
  })

  it('orthopaedics and oncology scores match the app', async () => {
    const cases = [
      ['orthopaedics', { fracture_type: 'open', gustilo: 'IIIB', pulse: 'present', cap_refill: 'gt2', passive_stretch_pain: 'yes', cast: 'tight', weeks: 2 }],
      ['orthopaedics', { fracture_type: 'closed', gustilo: '', union: 'not_united', weeks: 26 }],
      ['orthopaedics', { fracture_type: 'open', gustilo: 'na', union: 'radiological' }],
      ['oncology', { height_cm: 170, weight_kg: 70, dose_mg_m2: 60, anc: 1.2, platelets: 90, hb: 7.5, ecog: '3', cycle_number: 4 }],
      ['oncology', { height_cm: 158, weight_kg: 52, ecog: '0' }],
    ]
    for (const [t, d] of cases) {
      const sql = (await one(db, 'select specialty_score($1, $2) r', [t, JSON.stringify(d)])).r
      const app = spec.scoreAssessment(t, d)
      assert.deepEqual(sql.flags, app.flags, `${t} ${JSON.stringify(d)}`)
      assert.deepEqual(Object.fromEntries(Object.entries(sql.scores).map(([k, v]) => [k, typeof v === 'string' ? v : Number(v)])), app.scores, `${t} ${JSON.stringify(d)}`)
    }
    // the earlier templates still work through the replaced function
    assert.equal((await one(db, "select specialty_score('mental_health', '{\"q1\":3,\"q2\":3,\"q3\":2,\"q4\":2,\"q5\":1,\"q6\":2,\"q7\":1,\"q8\":1,\"q9\":1}') r")).r.scores.phq9, 16)
  })
})
