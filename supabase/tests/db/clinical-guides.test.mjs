// Clinical guide approvals: supabase/migrations/20261223000000_clinical_guides.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1', CONS = '00000000-0000-0000-0000-0000000000e1'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('clinical guide approvals', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`insert into auth.users values ('${CONS}', 'cons@a.ke'); insert into hospital_users(user_id, hospital_id, role) values ('${CONS}', '${H1}', 'Consultant Physician');
      insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', 'cons@a.ke', 'Dr Kamau', 'Consultant Physician', 'Active');`)
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/41_clinical_guides.sql'))
    await db.exec(read('../../../docs/sql/41_clinical_guides.sql'))
  })

  it('only approvers approve; one active approval per version; withdraw needs a reason; everyone in the hospital can read', async () => {
    const ins = "insert into clinical_guide_approvals(hospital_id, guide_id, version, approver_name, committee_ref) values ($1, 'sepsis', '2026-11', $2, 'MTC 12/2026') returning *"
    await as(db, NURSE)
    await refused(db.query(ins, [H1, 'Nora']), /Only a consultant/)
    await as(db, CONS)
    await refused(db.query(ins, [H1, ' ']), /approver's name/)
    const a = await one(db, ins, [H1, 'Dr Kamau'])
    assert.equal(a.approved_by, CONS)
    await refused(db.query(ins, [H1, 'Dr Kamau']), /duplicate|unique/)
    await refused(db.query("update clinical_guide_approvals set version = '2027-01' where id = $1", [a.id]), /cannot be edited/)
    await refused(db.query("update clinical_guide_approvals set withdrawn_at = now() where id = $1", [a.id]), /reason/)
    await db.query("update clinical_guide_approvals set withdrawn_at = now(), withdraw_reason = 'Local antibiogram changed' where id = $1", [a.id])
    await one(db, ins, [H1, 'Dr Kamau'])
    await as(db, REC)
    assert.equal((await db.query('select * from clinical_guide_approvals')).rows.length, 2)
  })
})
