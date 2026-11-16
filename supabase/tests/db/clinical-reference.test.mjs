// Clinical reference + CDS override audit: supabase/migrations/20261118000000_clinical_reference.sql on PGlite.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const REF = read('../../migrations/20261118000000_clinical_reference.sql')
const H1 = '11111111-1111-1111-1111-111111111111'
const REC = '00000000-0000-0000-0000-0000000000a1', OTHER = '00000000-0000-0000-0000-0000000000b1', OWNER = '00000000-0000-0000-0000-0000000000a4'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('clinical reference', () => {
  let db
  before(async () => {
    db = new PGlite({ extensions: { pg_trgm } })
    await db.exec(read('./stub.sql'))
    await db.exec(PAYMENTS)
    await db.exec(REF)
  })

  it('ICD search by code, words in any order, and shows the ICD-11 code where mapped', async () => {
    await as(db, REC)
    const byCode = (await db.query("select code from icd_search('b54')")).rows
    assert.equal(byCode[0].code, 'B54')
    const words = (await db.query("select code, icd11_code from icd_search('malaria falciparum')")).rows
    assert.ok(words.some((r) => r.code === 'B50.9' && r.icd11_code === '1F40.Z'))
    assert.deepEqual((await db.query("select code from icd_search('x')")).rows, [], 'needs 2+ characters')
    assert.ok((await db.query("select count(*)::int n from icd10_codes")).rows[0].n >= 125)
  })
  it('LOINC search', async () => {
    const r = (await db.query("select code from loinc_search('hba1c')")).rows
    assert.equal(r[0].code, '4548-4')
    assert.ok((await db.query("select code from loinc_search('viral load hiv')")).rows.some((x) => x.code === '20447-9'))
  })
  it('reference data is read-only for the browser', async () => {
    await as(db, REC)
    await refused(db.query("insert into icd10_codes(code, title) values ('ZZZ', 'x')"))
  })
  it('a CDS override is append-only and lands in the audit log', async () => {
    await as(db, REC)
    await db.query("insert into cds_overrides(hospital_id, drug_name, rule, severity, message, reason) values ($1, 'Ibuprofen', 'interaction:warfarin+nsaid', 'danger', 'Bleeding risk', 'Short course, INR check booked')", [H1])
    await refused(db.query("update cds_overrides set reason = 'changed'"))
    await refused(db.query('delete from cds_overrides'))
    await as(db, null)
    const audit = (await db.query("select action, details from audit_log where action = 'cds_alert_overridden'")).rows
    assert.equal(audit.length, 1)
    assert.match(String(audit[0].details), /Short course, INR check booked/)
    const row = (await db.query('select overridden_by from cds_overrides')).rows[0]
    assert.equal(row.overridden_by, REC)
  })
  it('other hospitals cannot read overrides; only admins add interaction rules', async () => {
    await as(db, OTHER)
    assert.equal((await db.query('select * from cds_overrides')).rows.length, 0)
    await as(db, REC)
    await refused(db.query("insert into drug_interactions(hospital_id, a, b, severity, message) values ($1, 'amlodipine', 'simvastatin', 'moderate', 'max 20mg')", [H1]))
    await as(db, OWNER)
    await db.query("insert into drug_interactions(hospital_id, a, b, severity, message) values ($1, 'amlodipine', 'simvastatin', 'moderate', 'max 20mg')", [H1])
    await as(db, REC)
    assert.equal((await db.query('select * from drug_interactions')).rows.length, 1)
  })
  it('the paste-ready 07 file installs and reports OK', async () => {
    const fresh = new PGlite({ extensions: { pg_trgm } })
    await fresh.exec(read('./stub.sql'))
    await fresh.exec(PAYMENTS)
    const rows = (await fresh.exec(read('../../../docs/sql/07_clinical_reference.sql'))).at(-1).rows
    assert.deepEqual(rows.slice(2).map((r) => r.result), ['OK', 'OK'])
  })
  it('works with the live shape where cds_overrides.hospital_id is text', async () => {
    const live = new PGlite({ extensions: { pg_trgm } })
    await live.exec(read('./stub.sql'))
    await live.exec(PAYMENTS)
    await live.exec(`create table cds_overrides(id uuid primary key default gen_random_uuid(), hospital_id text, visit_id uuid, patient_id uuid,
      doctor_name text, drug_name text, rule text, acknowledged_at timestamptz)`)
    const rows = (await live.exec(read('../../../docs/sql/07_clinical_reference.sql'))).at(-1).rows
    assert.deepEqual(rows.slice(2).map((r) => r.result), ['OK', 'OK'])
    await as(live, REC)
    await live.query("insert into cds_overrides(hospital_id, drug_name, rule, reason) values ($1, 'Ibuprofen', 'x', 'reason given')", [H1])
    assert.equal((await live.query('select * from cds_overrides')).rows.length, 1)
    await as(live, OTHER)
    assert.equal((await live.query('select * from cds_overrides')).rows.length, 0)
    await as(live, null)
    assert.equal((await live.query("select count(*)::int n from audit_log where action = 'cds_alert_overridden'")).rows[0].n, 1)
  })
  it('is safe to run twice', async () => {
    await as(db, null)
    await db.exec(REF)
  })
})
