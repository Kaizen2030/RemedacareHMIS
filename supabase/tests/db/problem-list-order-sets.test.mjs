// Problem list, current medicines and order sets: supabase/migrations/20261214000000_problem_list_order_sets.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1', DOC = '00000000-0000-0000-0000-0000000000d9'
const JANE = '99999999-0000-0000-0000-000000000001'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('problem list, current medicines and order sets', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`insert into auth.users values ('${DOC}', 'doc@a.ke'); insert into hospital_users(user_id, hospital_id, role) values ('${DOC}', '${H1}', 'Doctor');
      insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', 'doc@a.ke', 'Dee', 'Medical Officer', 'Active');`)
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$ begin return p::uuid; exception when others then return null; end $$;`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/32_problem_list_order_sets.sql'))
    await db.exec(read('../../../docs/sql/32_problem_list_order_sets.sql'))
  })

  it('recognises Kenyan clinical job titles (fix) without making non-clinical "specialists" clinical', async () => {
    const r = async (t) => (await one(db, 'select pay_canonical_role($1) r', [t])).r
    for (const t of ['Medical Officer', 'Consultant', 'Specialist', 'General Practitioner', 'Registrar', 'Microbiologist', 'Radiographer', 'Senior Medical Officer', 'Consultant Paediatrician', 'Dentist'])
      assert.equal(await r(t), 'clinical', t)
    assert.equal(await r('IT Specialist'), 'unknown')
    assert.equal(await r('Procurement Consultant'), 'unknown')
    assert.equal(await r('Cashier'), 'accountant')
    assert.equal(await r('staff'), 'unknown')
  })

  it('problem list: one active entry per problem; resolving stamps the date', async () => {
    await as(db, NURSE)
    const p = await one(db, "insert into patient_problems(hospital_id, patient_id, problem, icd10, chronic) values ($1, $2, 'Hypertension', 'i10', true) returning *", [H1, JANE])
    assert.equal(p.icd10, 'I10')
    await refused(db.query("insert into patient_problems(hospital_id, patient_id, problem, icd10) values ($1, $2, 'Essential hypertension', 'I10')", [H1, JANE]), /duplicate|unique/)
    await db.query("insert into patient_problems(hospital_id, patient_id, problem) values ($1, $2, 'Low back pain')", [H1, JANE])
    await refused(db.query("insert into patient_problems(hospital_id, patient_id, problem) values ($1, $2, ' low back pain ')", [H1, JANE]), /duplicate|unique/)
    const r = await one(db, "update patient_problems set status = 'resolved' where problem = 'Low back pain' returning resolved_on", [])
    assert.ok(r.resolved_on)
    await db.query("insert into patient_problems(hospital_id, patient_id, problem) values ($1, $2, 'Low back pain')", [H1, JANE])   // can recur
  })

  it('current medicines: stopping needs a reason, stopped stays stopped; reviews count active medicines', async () => {
    const m = await one(db, "insert into patient_medications(hospital_id, patient_id, drug, dose, frequency) values ($1, $2, 'Amlodipine', '5 mg', 'OD') returning id", [H1, JANE])
    await refused(db.query("insert into patient_medications(hospital_id, patient_id, drug) values ($1, $2, 'amlodipine')", [H1, JANE]), /duplicate|unique/)
    await db.query("insert into patient_medications(hospital_id, patient_id, drug, source) values ($1, $2, 'Metformin', 'other_facility')", [H1, JANE])
    await refused(db.query("update patient_medications set status = 'stopped' where id = $1", [m.id]), /reason/)
    await db.query("update patient_medications set status = 'stopped', stop_reason = 'Ankle swelling' where id = $1", [m.id])
    await refused(db.query("update patient_medications set status = 'active' where id = $1", [m.id]), /add it again/)
    const rv = await one(db, 'insert into medication_reviews(hospital_id, patient_id) values ($1, $2) returning active_count', [H1, JANE])
    assert.equal(rv.active_count, 1)
  })

  it('order sets: start switched off, a doctor approves, edits withdraw approval, uses are logged', async () => {
    await as(db, NURSE)
    const o = await one(db, `insert into order_sets(hospital_id, name, labs, medications, active, approved_by) values ($1, 'Uncomplicated malaria (adult)', '[{"test_type":"Malaria RDT","category":"Parasitology"}]', '[{"drug_name":"Artemether-lumefantrine 20/120 mg"}]', true, $2) returning *`, [H1, NURSE])
    assert.equal(o.active, false); assert.equal(o.approved_by, null)
    await refused(db.query('insert into order_set_uses(hospital_id, order_set_id) values ($1, $2)', [H1, o.id]), /not approved/)
    await refused(db.query('update order_sets set approved_by = $2, active = true where id = $1', [o.id, NURSE]), /Only a doctor/)
    await refused(db.query('update order_sets set active = true where id = $1', [o.id]), /Approve the order set/)
    await as(db, DOC)
    const ap = await one(db, "update order_sets set approved_by = $2, approved_by_name = 'Dr Dee', active = true where id = $1 returning approved_by, active, version", [o.id, NURSE])
    assert.equal(ap.approved_by, DOC, 'approver is the signed-in doctor'); assert.equal(ap.active, true)
    await as(db, NURSE)
    const u = await one(db, 'insert into order_set_uses(hospital_id, order_set_id, patient_id) values ($1, $2, $3) returning version', [H1, o.id, JANE])
    assert.equal(u.version, 1)
    const ed = await one(db, "update order_sets set instructions = 'Give first dose under observation' where id = $1 returning version, active, approved_by", [o.id])
    assert.deepEqual([ed.version, ed.active, ed.approved_by], [2, false, null])
    await as(db, REC)
    assert.equal((await db.query('select * from order_sets')).rows.length, 0)
    assert.equal((await db.query('select * from patient_problems')).rows.length, 0)
  })
})
