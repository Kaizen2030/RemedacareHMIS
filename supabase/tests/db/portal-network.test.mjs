// Patient portal sign-in (20261128000000_patient_portal.sql) and multi-facility networks (20261129000000_multi_facility.sql).
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const CLIN = read('../../migrations/20261119000000_hiv_tb_maternity.sql')
const AUDIT = read('../../migrations/20261122000000_audit_privacy.sql')
const H1 = '11111111-1111-1111-1111-111111111111', H2 = '22222222-2222-2222-2222-222222222222', H3 = '33333333-3333-3333-3333-333333333333'
const OWNER = '00000000-0000-0000-0000-0000000000a4', NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const REC_B = '00000000-0000-0000-0000-0000000000b1'
const JANE = '99999999-0000-0000-0000-000000000001', BOB = '99999999-0000-0000-0000-000000000002'
const KID = '99999999-0000-0000-0000-000000000003', SECRET = '99999999-0000-0000-0000-000000000004', JANE_B = '99999999-0000-0000-0000-000000000005'

const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const service = (db) => db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;")
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

async function boot() {
  const db = new PGlite()
  await db.exec(read('./stub.sql'))
  await db.exec(PAYMENTS)
  await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$
      begin return p::uuid; exception when others then return null; end $$;
    grant select, insert on audit_log to authenticated; grant usage on sequence audit_log_id_seq to authenticated;
    alter table patients add column phone text, add column national_id text, add column gender text, add column dob date, add column patient_number text;
    alter table hospitals add column network_id text;
    insert into hospitals(id, name, owner_email) values ('${H3}', 'Hosp C', 'own@c.ke');
    update hospitals set network_id = 'NET-1' where id in ('${H1}', '${H2}');   -- A and B are one organisation; C is not
    insert into hospital_users(user_id, hospital_id, role) values ('${OWNER}', '${H2}', 'admin');
    update patients set phone = '0712 345 678', national_id = '12345678', gender = 'F', dob = '1990-02-01', patient_number = 'A-1' where id = '${JANE}';
    insert into patients(id, hospital_id, full_name, phone, gender, patient_number) values
      ('${KID}', '${H1}', 'Kid Wanjiku', '+254712345678', 'M', 'A-2'),
      ('${SECRET}', '${H1}', 'Secret Person', '0712345678', 'F', 'A-3'),
      ('${JANE_B}', '${H3}', 'Jane At C', '0712345678', 'F', 'C-1');
    create table visits(id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, visit_type text, status text, created_at timestamptz default now());
    create table consultations(id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, diagnosis text, icd10_code text, created_at timestamptz default now());
    create table prescriptions(id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, drug_name text, dosage text, frequency text, duration text, created_at timestamptz default now());
    insert into visits(hospital_id, patient_id, visit_type, status) values ('${H1}', '${JANE}', 'OPD', 'Completed');
    insert into consultations(hospital_id, patient_id, diagnosis, icd10_code) values ('${H1}', '${JANE}', 'Hypertension', 'I10');
    insert into prescriptions(hospital_id, patient_id, drug_name, dosage) values ('${H1}', '${JANE}', 'Amlodipine', '5 mg');`)
  await db.exec(CLIN)
  await db.exec(AUDIT)
  await db.exec(`alter table patients add column if not exists confidential boolean not null default false; update patients set confidential = true where id = '${SECRET}';`)
  await db.exec(read('../../../docs/sql/17_patient_portal_and_networks.sql'))
  await db.exec(read('../../../docs/sql/17_patient_portal_and_networks.sql')) // safe to run again
  return db
}

describe('patient portal sign-in', () => {
  let db
  before(async () => {
    db = await boot()
    await as(db, OWNER)
    await db.query('insert into portal_settings(hospital_id, enabled) values ($1, true)', [H1])
  })

  it('a phone sees its patients at facilities with the portal on — not confidential ones, not other facilities', async () => {
    await service(db)
    const rows = (await db.query("select full_name, hospital_name from portal_patients('0712345678') order by full_name")).rows
    assert.deepEqual(rows.map((r) => r.full_name), ['Jane', 'Kid Wanjiku'])
    assert.equal((await db.query("select * from portal_patients('0799999999')")).rows.length, 0)
  })

  it('SMS codes: unknown numbers get nothing, at most 3 per 15 minutes, 5 wrong tries lock the code', async () => {
    await service(db)
    assert.equal((await one(db, "select portal_request_code('0799 999 999') as r")).r.status, 'unknown')
    const first = (await one(db, "select portal_request_code('+254 712 345 678') as r")).r
    assert.equal(first.status, 'ok')
    assert.match(first.code, /^\d{6}$/)
    await db.query("select portal_request_code('0712345678')")
    await db.query("select portal_request_code('0712345678')")
    assert.equal((await one(db, "select portal_request_code('0712345678') as r")).r.status, 'rate_limited')
    for (let i = 0; i < 4; i++) assert.equal((await one(db, "select portal_verify('0712345678', '000000') as r")).r.status, 'wrong')
    assert.equal((await one(db, "select portal_verify('0712345678', '000000') as r")).r.status, 'locked')
  })

  it('reception gives a printed code; it signs in once and the session resolves to the phone', async () => {
    await as(db, REC_B)
    await refused(db.query('select portal_staff_code($1)', [JANE]), /do not belong/)
    await as(db, REC)
    await refused(db.query('select portal_staff_code($1)', [SECRET]), /Confidential/)
    const c = (await one(db, 'select portal_staff_code($1) as r', [JANE])).r
    assert.equal(c.phone_hint, '07…678')
    await service(db)
    const v = (await one(db, "select portal_verify('0712-345-678', $1) as r", [c.code])).r
    assert.equal(v.status, 'ok')
    assert.match(v.token, /^rcp_[0-9a-f]{64}$/)
    assert.equal((await one(db, "select portal_verify('0712345678', $1) as r", [c.code])).r.status, 'expired', 'one use only')
    assert.equal((await one(db, 'select portal_session_phone($1) as p', [v.token])).p, '254712345678')
    await db.query('select portal_logout($1)', [v.token])
    assert.equal((await one(db, 'select portal_session_phone($1) as p', [v.token])).p, null)
    await refused(db.query('select token_hash from portal_sessions limit 0').then(async () => { await as(db, OWNER); return db.query('select * from portal_sessions') }), /permission denied/)
  })

  it('browsers cannot call the sign-in functions directly; only admins change portal settings', async () => {
    await as(db, NURSE)
    await refused(db.query("select portal_request_code('0712345678')"), /permission denied/)
    await refused(db.query("select portal_verify('0712345678', '1')"), /permission denied/)
    await refused(db.query('update portal_settings set enabled = false where hospital_id = $1 returning 1', [H1]).then((r) => { if (!r.rows.length) throw new Error('row-level: no rows') }), /row-level/)
  })
})

describe('multi-facility networks', () => {
  let db
  before(async () => { db = await boot() })

  it('finds a patient at a sister facility by ID or phone — never at a facility outside the network or confidential ones', async () => {
    await as(db, REC_B)
    const byId = (await db.query("select * from network_patient_search($1, '12345678')", [H2])).rows
    assert.deepEqual(byId.map((r) => r.full_name), ['Jane'])
    assert.equal(byId[0].national_id_hint, '…678')
    assert.equal(byId[0].hospital_name, 'Hosp A')
    const byPhone = (await db.query("select full_name from network_patient_search($1, '0712345678') order by full_name", [H2])).rows
    assert.deepEqual(byPhone.map((r) => r.full_name), ['Jane', 'Kid Wanjiku'])
    await refused(db.query("select * from network_patient_search($1, 'Ja')", [H2]), /3 characters/)
    await refused(db.query("select * from network_patient_search($1, 'Jane')", [H1]), /do not belong/)
  })

  it('registers the patient here with their details, linked by a master id; doing it twice returns the same record', async () => {
    await as(db, REC_B)
    const id = (await one(db, 'select network_patient_import($1, $2) as id', [H2, JANE])).id
    await as(db, OWNER)
    const copy = await one(db, 'select hospital_id, full_name, national_id, phone, patient_number, mpi_id from patients where id = $1', [id])
    assert.deepEqual({ ...copy, hospital_id: String(copy.hospital_id) }, { hospital_id: H2, full_name: 'Jane', national_id: '12345678', phone: '0712 345 678', patient_number: null, mpi_id: JANE })
    assert.equal((await one(db, 'select mpi_id from patients where id = $1', [JANE])).mpi_id, JANE)
    await as(db, REC_B)
    assert.equal((await one(db, 'select network_patient_import($1, $2) as id', [H2, JANE])).id, id)
    assert.equal((await one(db, "select already_here from network_patient_search($1, '12345678')", [H2])).already_here, true)
    await refused(db.query('select network_patient_import($1, $2)', [H2, JANE_B]), /not registered at a facility in your network/)
    await refused(db.query('select network_patient_import($1, $2)', [H2, SECRET]), /Confidential/)
  })

  it('clinicians see the linked patient\'s history at sister facilities, and the look is logged there', async () => {
    await as(db, OWNER)
    const here = (await one(db, 'select id from patients where hospital_id::text = $1 and mpi_id = $2', [H2, JANE])).id
    const hist = (await db.query('select kind, summary, hospital_name from network_patient_history($1, $2) order by kind', [H2, here])).rows
    assert.deepEqual(hist.map((r) => r.kind), ['Diagnosis', 'Medicine', 'Visit'])
    assert.match(hist[0].summary, /I10 Hypertension/)
    assert.equal(hist[0].hospital_name, 'Hosp A')
    const log = await one(db, "select hospital_id, patient_id, context from patient_access_log where context like 'network history%'")
    assert.equal(String(log.hospital_id), H1)
    assert.equal(log.patient_id, JANE)
    await as(db, REC_B)
    await refused(db.query('select * from network_patient_history($1, $2)', [H2, here]), /clinical staff/)
  })

  it('administrators get a per-facility summary of the facilities they administer', async () => {
    await as(db, OWNER)
    const rows = (await db.query('select hospital_name, patients, visits_today from network_summary($1) order by hospital_name', [H1])).rows
    assert.deepEqual(rows.map((r) => r.hospital_name), ['Hosp A', 'Hosp B'])
    assert.equal(Number(rows[0].visits_today), 1)
    await as(db, NURSE)
    assert.equal((await db.query('select * from network_summary($1)', [H1])).rows.length, 0)
  })
})
