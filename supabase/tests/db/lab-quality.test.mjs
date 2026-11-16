// Laboratory quality: supabase/migrations/20261216000000_lab_quality.sql (defaults mirror src/utils/labQuality.js).
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1', LAB = '00000000-0000-0000-0000-0000000000d1'
const JANE = '99999999-0000-0000-0000-000000000001'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}
const result = (db, values, extra = {}) => one(db, `insert into lab_tests(hospital_id, patient_id, patient_name, test_type, category, priority, created_at, resulted_at, result_template_key, result_json)
  values ($1, $2, 'Jane', 'Urea & Electrolytes', 'Biochemistry', $3, $4, $5, 'rfts', $6) returning *`,
  [H1, JANE, extra.priority || 'Routine', extra.created || new Date(Date.now() - 3600000).toISOString(), extra.at || new Date().toISOString(), JSON.stringify(values)])

describe('laboratory quality', () => {
  let db, js
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`insert into auth.users values ('${LAB}', 'lab@a.ke'); insert into hospital_users(user_id, hospital_id, role) values ('${LAB}', '${H1}', 'Lab Technician');
      insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', 'lab@a.ke', 'Lucy', 'Lab Technician', 'Active');
      create table lab_tests (id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, patient_name text, test_type text, category text, status text, created_at timestamptz default now());
      grant select, insert, update on lab_tests to authenticated;`)
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$ begin return p::uuid; exception when others then return null; end $$;`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/34_lab_quality.sql'))
    await db.exec(read('../../../docs/sql/34_lab_quality.sql'))
    js = await import('data:text/javascript,' + encodeURIComponent(read('../../../src/utils/labQuality.js')))
  })

  it('database defaults match the app', async () => {
    const rows = (await db.query('select template_key, analyte, low, high, critical_low, critical_high, delta_abs, delta_pct, delta_days from lab_analyte_rules where hospital_id is null order by template_key, analyte')).rows
    const norm = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null || typeof v === 'string' && !/^-?[\d.]+$/.test(v) ? v : Number(v)]))
    const appRules = [...js.DEFAULT_LAB_RULES].sort((a, b) => `${a.template_key}${a.analyte}`.localeCompare(`${b.template_key}${b.analyte}`))
    assert.deepEqual(rows.map(norm), appRules)
  })

  it('delta check against the previous result; review queue by default; auto-validation only when switched on', async () => {
    await as(db, LAB)
    const first = await result(db, { sodium: '138', potassium: '4.2', urea: '5', creatinine: '80' }, { at: new Date(Date.now() - 2 * 86400000).toISOString() })
    assert.equal(first.validation_status, 'needs_review', 'auto-validation is off by default')
    assert.deepEqual(first.delta_flags, [])
    const second = await result(db, { sodium: '139', potassium: '5.4', urea: '5.2', creatinine: '130' })
    assert.deepEqual(second.delta_flags.map((f) => [f.analyte, Number(f.previous), Number(f.current)]), [['creatinine', 80, 130], ['potassium', 4.2, 5.4]])
    const app = js.assessResult('rfts', { sodium: '139', potassium: '5.4', urea: '5.2', creatinine: '130' }, { values: { sodium: '138', potassium: '4.2', urea: '5', creatinine: '80' }, at: first.resulted_at })
    assert.deepEqual(app.delta_flags.map((f) => f.analyte).sort(), ['creatinine', 'potassium'])

    await as(db, NURSE)
    await refused(db.query("insert into lab_quality_settings(hospital_id, autoverify) values ($1, true)", [H1]), /laboratory manager/)
    await as(db, LAB)
    await db.query("insert into lab_quality_settings(hospital_id, autoverify) values ($1, true)", [H1])
    const normal = await result(db, { sodium: '139', potassium: '5.0', urea: '5.3', creatinine: '128' })
    assert.equal(normal.validation_status, 'needs_review', 'creatinine 128 is above range')
    const fine = await result(db, { sodium: '140', potassium: '4.9', urea: '5.5', creatinine: '105' })
    assert.equal(fine.validation_status, 'auto_validated'); assert.deepEqual(fine.delta_flags, [])
    const crit = await result(db, { sodium: '140', potassium: '6.8' })
    assert.equal(crit.validation_status, 'needs_review')
    const reviewed = await one(db, "update lab_tests set reviewed_at = now() where id = $1 returning validation_status, validated_by", [crit.id])
    assert.deepEqual([reviewed.validation_status, reviewed.validated_by], ['validated', LAB])
  })

  it('hospital rules override the defaults; built-in rules are protected', async () => {
    await db.query("update lab_analyte_rules set delta_abs = 5 where hospital_id is null and analyte = 'potassium'")   // hidden from edits by row security
    assert.equal(Number((await one(db, "select delta_abs from lab_analyte_rules where hospital_id is null and analyte = 'potassium'")).delta_abs), 1)
    await db.query("insert into lab_analyte_rules(hospital_id, template_key, analyte, low, high, delta_abs, delta_days) values ($1, 'rfts', 'potassium', 3.5, 5.1, 0.5, 7)", [H1])
    const r = await one(db, "select delta_abs from lab_rules($1, 'rfts') where analyte = 'potassium'", [H1])
    assert.equal(Number(r.delta_abs), 0.5)
  })

  it('turnaround times by priority with overdue list; clinical / lab staff only', async () => {
    await db.query(`insert into lab_tests(hospital_id, patient_id, patient_name, test_type, category, priority, created_at) values ($1, $2, 'Jane', 'Full Blood Count (FBC)', 'Haematology', 'STAT', now() - interval '3 hours')`, [H1, JANE])
    const t = (await one(db, 'select lab_tat($1, current_date - 3, current_date) r', [H1])).r
    assert.equal(t.targets.STAT, 60)
    assert.ok(t.by_priority.Routine.resulted >= 4)
    assert.equal(t.overdue.length, 1); assert.equal(t.overdue[0].priority, 'STAT')
    assert.ok(t.awaiting_review >= 1); assert.equal(t.auto_validated, 1); assert.equal(t.delta_flagged >= 1, true)
    await as(db, REC)
    await refused(db.query('select lab_tat($1, current_date - 3, current_date)', [H1]), /clinical and laboratory/)
  })
})
