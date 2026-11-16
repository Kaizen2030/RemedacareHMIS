// Neurology and urology specialty templates (docs/sql/48): the database scores match the app exactly,
// and the earlier templates still score the same after specialty_score() was redefined.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
const mod = (src) => import('data:text/javascript,' + encodeURIComponent(src))
const norm = (scores) => Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, typeof v === 'string' ? v : Number(v)]))

describe('neurology and urology assessments', () => {
  let db, spec
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/27_specialty_assessments.sql'))
    await db.exec(read('../../../docs/sql/31_growth_ortho_oncology.sql'))
    for (let i = 0; i < 2; i++) {
      const rows = (await db.exec(read('../../../docs/sql/48_specialty_neuro_uro.sql'))).at(-1).rows
      assert.ok(rows.every((r) => r.result === 'OK'), JSON.stringify(rows))
    }
    spec = await mod(read('../../../src/utils/specialtyTemplates.js'))
  })

  const nih = (vals) => Object.fromEntries(['n1a', 'n1b', 'n1c', 'n2', 'n3', 'n4', 'n5a', 'n5b', 'n6a', 'n6b', 'n7', 'n8', 'n9', 'n10', 'n11'].map((k, i) => [k, String(vals[i] ?? 0)]))
  const ipss = (vals) => Object.fromEntries(vals.map((v, i) => [`i${i + 1}`, String(v)]))
  const CASES = [
    ['neurology', { gcs_e: '2', gcs_v: '2', gcs_m: '4', ...nih([2, 2, 2, 2, 2, 3, 4, 0, 4, 0, 0, 2, 3, 2, 2]), onset_hours: 3 }],
    ['neurology', { gcs_e: '4', gcs_v: '5', gcs_m: '6', ...nih([0, 0, 0, 0, 0, 1, 1, 0, 1, 0]), onset_hours: 8 }],
    ['neurology', { gcs_e: '4', gcs_v: '5', gcs_m: '6', ...nih([]) }],
    ['neurology', { gcs_e: '3', gcs_v: '4' }],
    ['urology', { ...ipss([4, 5, 3, 4, 5, 3, 3]), ipss_qol: '5', psa: 6.2, pvr_ml: 350 }],
    ['urology', { ...ipss([1, 2, 1, 1, 2, 0, 1]), ipss_qol: '2', psa: 1.1, pvr_ml: 40 }],
    ['urology', { psa: 4 }],
    // earlier templates are unchanged
    ['mental_health', { q1: 3, q2: 3, q3: 2, q4: 2, q5: 1, q6: 2, q7: 1, q8: 1, q9: 1 }],
    ['oncology', { height_cm: 170, weight_kg: 70, dose_mg_m2: 60, anc: 1.2, ecog: '3' }],
  ]

  it('database and app give the same scores and alerts', async () => {
    for (const [t, d] of CASES) {
      const sql = (await one(db, 'select specialty_score($1, $2) r', [t, JSON.stringify(d)])).r
      const app = spec.scoreAssessment(t, d)
      assert.deepEqual(sql.flags, app.flags, `${t} ${JSON.stringify(d)}`)
      assert.deepEqual(norm(sql.scores), app.scores, `${t} ${JSON.stringify(d)}`)
    }
  })

  it('scores follow the published scales', () => {
    const severe = spec.scoreAssessment('neurology', CASES[0][1])
    assert.equal(severe.scores.gcs, 8)
    assert.equal(severe.scores.nihss, 30)
    assert.equal(severe.scores.nihss_band, 'Severe stroke')
    assert.equal(severe.flags.length, 3)
    assert.equal(spec.scoreAssessment('neurology', CASES[2][1]).scores.nihss_band, 'No stroke symptoms')
    const u = spec.scoreAssessment('urology', CASES[4][1])
    assert.equal(u.scores.ipss, 27)
    assert.equal(u.scores.ipss_band, 'Severe')
    assert.equal(spec.scoreAssessment('urology', CASES[5][1]).scores.ipss_band, 'Moderate')
    assert.deepEqual(spec.scoreAssessment('urology', { psa: 4 }).flags, [], 'PSA exactly 4 is not flagged')
  })

  it('assessments can be saved with the new templates', async () => {
    await assert.doesNotReject(db.query("select 'neurology'::text where 'neurology' = any(array['neurology','urology'])"))
    const def = (await one(db, "select pg_get_constraintdef(oid) d from pg_constraint where conname = 'specialty_assessments_template_check'")).d
    assert.match(def, /neurology/)
    assert.match(def, /urology/)
  })
})
