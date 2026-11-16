// Medical records file locator and incomplete-records list: supabase/migrations/20261215000000_records_file_locator.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1', HRO = '00000000-0000-0000-0000-0000000000e7'
const JANE = '99999999-0000-0000-0000-000000000001', BOB = '99999999-0000-0000-0000-000000000002'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}
const move = (db, file, action, extra = {}) => one(db, 'insert into record_file_movements(hospital_id, file_id, action, to_holder, to_location, reason) values ($1, $2, $3, $4, $5, $6) returning *',
  [H1, file, action, extra.to || null, extra.loc || null, extra.reason || null])

describe('medical records', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`insert into auth.users values ('${HRO}', 'hro@a.ke'); insert into hospital_users(user_id, hospital_id, role) values ('${HRO}', '${H1}', 'Health Records Officer');
      insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', 'hro@a.ke', 'Hellen', 'Health Records Officer', 'Active');
      create table admissions (id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, visit_id text, ward_name text, doctor_name text,
        admission_date timestamptz, discharge_date timestamptz, discharge_summary_notes text, icd10_code text);
      create table consultations (id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, visit_id text, icd10_code text);
      insert into admissions(hospital_id, patient_id, visit_id, ward_name, doctor_name, discharge_date, discharge_summary_notes, icd10_code) values
        ('${H1}', '${JANE}', 'v1', 'Medical', 'Dr Dee', now() - interval '5 days', null, null),
        ('${H1}', '${BOB}', 'v2', 'Surgical', 'Dr Kim', now() - interval '2 days', 'Recovered well', null),
        ('${H1}', '${BOB}', 'v3', 'Surgical', 'Dr Kim', now() - interval '1 days', 'OK', 'K35.8'),
        ('${H1}', '${JANE}', 'v4', 'Medical', 'Dr Dee', null, null, null);
      insert into consultations(hospital_id, patient_id, visit_id, icd10_code) values ('${H1}', '${BOB}', 'v2', 'J18.9');`)
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$ begin return p::uuid; exception when others then return null; end $$;`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/33_records_file_locator.sql'))
    await db.exec(read('../../../docs/sql/33_records_file_locator.sql'))
  })

  it('file locator: issue, transfer, return; location only changes through movements; missing and found', async () => {
    await as(db, HRO)
    const f = await one(db, "insert into record_files(hospital_id, patient_id, file_number, shelf, status, holder) values ($1, $2, 'MR-0001', 'A-12', 'out', 'x') returning *", [H1, JANE])
    assert.equal(f.status, 'in_registry'); assert.equal(f.holder, null)
    await refused(move(db, f.id, 'transferred', { to: 'Ward 3' }), /issue it from the registry/)
    await refused(move(db, f.id, 'issued'), /who is taking/)
    await move(db, f.id, 'issued', { to: 'Dr Dee', loc: 'OPD room 4' })
    let row = await one(db, 'select * from record_files where id = $1', [f.id])
    assert.equal(row.status, 'out'); assert.equal(row.holder, 'Dr Dee'); assert.ok(row.due_back)
    await refused(move(db, f.id, 'issued', { to: 'Someone else' }), /not in the registry \(it is out: Dr Dee/)
    await as(db, NURSE)
    await move(db, f.id, 'transferred', { to: 'Sr Wanjiru', loc: 'Medical ward' })
    assert.equal((await one(db, 'select holder from record_files where id = $1', [f.id])).holder, 'Sr Wanjiru')
    await db.query("update record_files set holder = 'Me', status = 'in_registry' where id = $1", [f.id]).catch((e) => assert.match(e.message, /recorded movement/))
    assert.equal((await one(db, 'select status from record_files where id = $1', [f.id])).status, 'out')
    await refused(move(db, f.id, 'missing'), /last seen/)
    await move(db, f.id, 'missing', { reason: 'Not on the ward at handover' })
    await move(db, f.id, 'found')
    row = await one(db, 'select * from record_files where id = $1', [f.id])
    assert.equal(row.status, 'in_registry'); assert.equal(row.holder, null)
    assert.equal((await one(db, 'select count(*)::int n from record_file_movements where file_id = $1', [f.id])).n, 4)   // issued, transferred, missing, found
    await refused(db.query('update record_file_movements set to_holder = $2 where file_id = $1', [f.id, 'x']), /cannot be changed|permission denied/)
  })

  it('incomplete records come from the clinical data and clear themselves', async () => {
    await as(db, HRO)
    let list = (await one(db, 'select records_deficiencies($1, current_date - 30, current_date) r', [H1])).r
    assert.deepEqual(list.map((x) => [x.patient, x.missing]), [['Jane', ['Discharge summary', 'Diagnosis (ICD-10) code']]], 'Bob v2 has a coded consultation; v3 complete; v4 not discharged')
    assert.equal(list[0].days_since, 5); assert.equal(list[0].clinician, 'Dr Dee')
    await db.exec(`reset role; update admissions set discharge_summary_notes = 'Treated for malaria' where visit_id = 'v1'`)
    await as(db, HRO)
    list = (await one(db, 'select records_deficiencies($1, current_date - 30, current_date) r', [H1])).r
    assert.deepEqual(list[0].missing, ['Diagnosis (ICD-10) code'])
    await as(db, REC)
    await refused(db.query('select records_deficiencies($1, current_date - 30, current_date)', [H1]), /records and clinical staff/)
    assert.equal((await db.query('select * from record_files')).rows.length, 0)
  })
})
