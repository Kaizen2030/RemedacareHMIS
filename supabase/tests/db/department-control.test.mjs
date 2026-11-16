// Departments run their own roster and leave (docs/sql/51): department managers, roster per department, leave approval.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', HR = '00000000-0000-0000-0000-0000000000b7', INCH = '00000000-0000-0000-0000-0000000000b8', MARY = '00000000-0000-0000-0000-0000000000b9'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}
const day = (offset) => new Date(Date.UTC(2027, 1, 1 + offset)).toISOString().slice(0, 10) // Monday 1 Feb 2027
const shift = (db, staff, date, code = 'D', unit = null) => db.query('insert into staff_shifts(hospital_id, staff_id, shift_date, shift_code, unit) values ($1, $2, $3, $4, $5) returning *', [H1, staff, date, code, unit])

describe('departments run their own roster and leave', () => {
  let db, nora, kevin, mary, ina
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`insert into auth.users values ('${HR}', 'hr@a.ke'), ('${INCH}', 'ic@a.ke'), ('${MARY}', 'mary@a.ke');
      insert into hospital_users(user_id, hospital_id, role) values ('${HR}', '${H1}', 'HR Manager'), ('${INCH}', '${H1}', 'Ward In-Charge'), ('${MARY}', '${H1}', 'Nursing Officer');
      alter table staff add column registration_expiry date; alter table staff add column department text;
      insert into staff(hospital_id, email, full_name, role, status, department) values ('${H1}', 'hr@a.ke', 'Hilda', 'HR Manager', 'Active', 'Administration'),
        ('${H1}', 'ic@a.ke', 'Ina', 'Ward In-Charge', 'Active', 'paediatrics'), ('${H1}', 'mary@a.ke', 'Mary', 'Nursing Officer', 'Active', 'General Medicine'),
        ('${H1}', 'kevin@a.ke', 'Kevin', 'Nurse', 'Active', 'General Medicine');
      update staff set department = 'Paediatrics' where full_name = 'Nora';`)
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(read('../../../docs/sql/11_audit_privacy.sql'))
    await db.exec(read('../../../docs/sql/36_hr_roster_leave.sql'))
    await db.exec(read('../../migrations/20261229000000_merge_duplicate_departments.sql'))
    for (let i = 0; i < 2; i++) {
      const rows = (await db.exec(read('../../../docs/sql/51_department_control.sql'))).at(-1).rows
      assert.ok(rows.every((r) => r.result === 'OK'), JSON.stringify(rows))
    }
    const id = async (n) => (await one(db, 'select id from staff where full_name = $1', [n])).id
    nora = await id('Nora'); kevin = await id('Kevin'); mary = await id('Mary'); ina = await id('Ina')
  })

  it('an in-charge rosters only their own department', async () => {
    await as(db, INCH)
    await shift(db, nora, day(0))
    await refused(shift(db, kevin, day(0)), /row-level|policy/)
  })

  it('a named department manager runs that department\'s roster, and can borrow staff into the unit', async () => {
    await as(db, MARY)
    await refused(shift(db, kevin, day(1)), /row-level|policy/)
    await as(db, NURSE)
    await refused(db.query('insert into department_managers(hospital_id, department, staff_id) values ($1, $2, $3)', [H1, 'General Medicine', mary]), /row-level|policy/)
    await as(db, HR)
    const m = await one(db, 'insert into department_managers(hospital_id, department, staff_id) values ($1, $2, $3) returning department', [H1, 'general medicine', mary])
    assert.equal(m.department, 'General Medicine', 'stored under the proper department name')
    await as(db, MARY)
    await shift(db, kevin, day(1))
    await shift(db, nora, day(2), 'D', 'General Medicine')
    await refused(shift(db, nora, day(3), 'D', 'Paediatrics'), /row-level|policy/)
    await refused(db.query("update staff_shifts set shift_code = 'N' where staff_id = $1 and shift_date = $2", [nora, day(0)]).then((r) => { if (r.affectedRows === 0) throw new Error('row-level: not visible for update') }), /row-level/)
  })

  it('the department\'s leave approver decides its staff\'s leave, never their own', async () => {
    await as(db, HR)
    const k = await one(db, "insert into staff_leave(hospital_id, staff_id, leave_type, start_date, end_date) values ($1, $2, 'Annual Leave', $3, $4) returning id", [H1, kevin, day(14), day(18)])
    const n = await one(db, "insert into staff_leave(hospital_id, staff_id, leave_type, start_date, end_date) values ($1, $2, 'Annual Leave', $3, $4) returning id", [H1, nora, day(14), day(18)])
    await as(db, MARY)
    assert.equal((await db.query('select id from staff_leave where id = $1', [k.id])).rows.length, 1, 'Mary sees her ward\'s request')
    assert.equal((await db.query('select id from staff_leave where id = $1', [n.id])).rows.length, 0, 'but not other departments\' requests')
    const done = await one(db, "update staff_leave set status = 'approved' where id = $1 returning status, decided_by", [k.id])
    assert.equal(done.status, 'approved'); assert.equal(done.decided_by, MARY)
    const own = await one(db, "insert into staff_leave(hospital_id, staff_id, leave_type, start_date, end_date) values ($1, $2, 'Annual Leave', $3, $4) returning id", [H1, mary, day(21), day(22)])
    await refused(db.query("update staff_leave set status = 'approved' where id = $1", [own.id]), /cannot approve your own/)
    await as(db, INCH)
    assert.equal((await db.query("update staff_leave set status = 'approved' where id = $1", [n.id])).affectedRows, 0, 'an in-charge without the leave right cannot decide')
    await as(db, HR)
    await db.query('insert into department_managers(hospital_id, department, staff_id, can_roster, can_approve_leave) values ($1, $2, $3, true, true)', [H1, 'Paediatrics', ina])
    await as(db, INCH)
    assert.equal((await one(db, "update staff_leave set status = 'approved' where id = $1 returning status", [n.id])).status, 'approved')
  })
})
