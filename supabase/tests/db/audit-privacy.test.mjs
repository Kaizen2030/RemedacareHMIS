// Audit trail, access log, break-glass and DPA requests: supabase/migrations/20261122000000_audit_privacy.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const MIG = read('../../migrations/20261122000000_audit_privacy.sql')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', OWNER = '00000000-0000-0000-0000-0000000000a4', OTHER = '00000000-0000-0000-0000-0000000000b1'
const JANE = '99999999-0000-0000-0000-000000000001'

async function boot() {
  const db = new PGlite()
  await db.exec(read('./stub.sql'))
  await db.exec(PAYMENTS)
  await db.exec(`alter table patients add column phone text, add column national_id text;
    update patients set phone = '0712345678', national_id = '12345678';
    grant select, insert on audit_log to authenticated; grant usage on sequence audit_log_id_seq to authenticated;`)
  await db.exec(MIG)
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

describe('append-only audit log', () => {
  let db
  before(async () => { db = await boot() })
  it('members add entries stamped with their user id; nobody edits or deletes; only admins read', async () => {
    await as(db, NURSE)
    await db.query("insert into audit_log(hospital_id, user_role, action, target_table) values ($1, 'Nurse', 'login', 'auth')", [H1])
    assert.equal((await db.query('select * from audit_log')).rows.length, 0, 'a nurse cannot read the audit log')
    await refused(db.query("update audit_log set action = 'x'"))
    await refused(db.query('delete from audit_log'))
    await as(db, OWNER)
    const r = await one(db, "select user_id, user_email from audit_log where action = 'login'")
    assert.deepEqual(r, { user_id: NURSE, user_email: 'nurse@a.ke' })
    await as(db, null)
    await refused(db.query("update audit_log set action = 'x'"), /append-only/)
  })
  it('clinical changes are audited by trigger with old → new values', async () => {
    await as(db, NURSE)
    await db.query("update patients set full_name = 'Jane W.' where id = $1", [JANE])
    await as(db, OWNER)
    const r = await one(db, "select details from audit_log where action = 'update:patients'")
    assert.match(String(r.details), /"full_name"/)
    assert.match(String(r.details), /Jane W\./)
  })
})

describe('access log and break-glass', () => {
  let db
  before(async () => { db = await boot() })
  it('views are logged (once per 10 minutes per screen)', async () => {
    await as(db, NURSE)
    for (let i = 0; i < 3; i++) assert.equal((await one(db, "select log_patient_access($1, $2, 'view', 'consultation') r", [H1, JANE])).r.allowed, true)
    await db.query("select log_patient_access($1, $2, 'print', 'patients')", [H1, JANE])
    await as(db, OWNER)
    const rows = (await db.query('select action, context, user_id from patient_access_log order by id')).rows
    assert.deepEqual(rows.map((r) => [r.action, r.context]), [['view', 'consultation'], ['print', 'patients']])
  })
  it('a confidential patient needs a reason (break-glass) unless you are an admin', async () => {
    await as(db, null)
    await db.query('update patients set confidential = true where id = $1', [JANE])
    await as(db, NURSE)
    assert.deepEqual((await one(db, "select log_patient_access($1, $2, 'view', 'ward') r", [H1, JANE])).r, { allowed: false, needs_reason: true })
    await refused(db.query("select log_patient_access($1, $2, 'break_glass', 'ward', 'urgent')", [H1, JANE]), /clear reason/)
    await db.query("select log_patient_access($1, $2, 'break_glass', 'ward', 'Patient collapsed on ward, emergency review')", [H1, JANE])
    assert.equal((await one(db, "select log_patient_access($1, $2, 'view', 'ward') r", [H1, JANE])).r.allowed, true)
    await as(db, OWNER)
    assert.equal((await one(db, "select log_patient_access($1, $2, 'view', 'admin') r", [H1, JANE])).r.allowed, true)
    assert.equal((await one(db, "select count(*)::int n from patient_access_log where action = 'break_glass'")).n, 1)
  })
  it('other hospitals cannot log or read; nobody writes the log directly', async () => {
    await as(db, OTHER)
    await refused(db.query("select log_patient_access($1, $2, 'view', 'x')", [H1, JANE]), /Not a member/)
    await as(db, NURSE)
    await refused(db.query("insert into patient_access_log(hospital_id, patient_id, user_id, action) values ($1, $2, $3, 'view')", [H1, JANE, NURSE]))
  })
})

describe('Data Protection Act requests', () => {
  it('admin export includes the record and is itself logged; erasure clears contact details but keeps clinical data', async () => {
    const db = await boot()
    await as(db, null)
    await db.query("insert into invoices(hospital_id, patient_id, patient_name, amount_kes) values ($1, $2, 'Jane', 500)", [H1, JANE])
    await as(db, NURSE)
    await refused(db.query('select dsr_export_patient($1, $2)', [H1, JANE]), /administrator/)
    await as(db, OWNER)
    await db.query("insert into data_subject_requests(hospital_id, patient_id, request_type) values ($1, $2, 'access')", [H1, JANE])
    const ex = (await one(db, 'select dsr_export_patient($1, $2) x', [H1, JANE])).x
    assert.equal(ex.patient.full_name, 'Jane')
    assert.equal(ex.invoices.length, 1)
    const r = (await one(db, "select dsr_deidentify_patient($1, $2, 'DSR-2026-001 erasure request') r", [H1, JANE])).r
    assert.deepEqual([...r.cleared].sort(), ['national_id', 'phone'])
    const p = await one(db, 'select full_name, phone, national_id, confidential from patients where id = $1', [JANE])
    assert.deepEqual(p, { full_name: 'Jane', phone: null, national_id: null, confidential: true })
    assert.deepEqual((await db.query('select action from patient_access_log order by id')).rows.map((x) => x.action), ['export', 'anonymise'])
    assert.equal((await one(db, "select due_on - received_on as d from data_subject_requests")).d, 7)
  })
  it('the paste-ready 11 file installs and reports OK', async () => {
    const db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(PAYMENTS)
    const rows = (await db.exec(read('../../../docs/sql/11_audit_privacy.sql'))).at(-1).rows
    assert.deepEqual(rows.map((r) => r.result), ['OK', 'OK', 'OK'])
  })
})

describe('read-only security check', () => {
  it('docs/sql/12_security_check.sql runs and flags RLS-off tables and allow-all policies', async () => {
    const db = await boot()
    await db.exec(`create schema if not exists storage; create table if not exists storage.buckets(name text, public boolean);
      insert into storage.buckets values ('patient-docs', true);
      create table leaky(id int, hospital_id uuid);
      create table loose(id int, hospital_id uuid); alter table loose enable row level security;
      create policy loose_all on loose for all to authenticated using (true) with check (true);`)
    const sql = read('../../../docs/sql/12_security_check.sql')
    assert.equal((sql.match(/;/g) || []).length, 1, 'one statement, so the SQL editor cannot split it')
    const rows = (await db.query(sql)).rows
    const find = (sev, obj) => rows.some((r) => r.severity === sev && r.object.startsWith(obj))
    assert.ok(find('CRITICAL', 'leaky'))
    assert.ok(find('HIGH', 'loose / loose_all'))
    assert.ok(find('MEDIUM', 'patient-docs'))
    assert.ok(!rows.some((r) => r.object === 'patient_access_log' && r.severity === 'CRITICAL'))
  })
})
