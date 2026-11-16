// HR roster, leave and licences: supabase/migrations/20261218000000_hr_roster_leave.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1', HR = '00000000-0000-0000-0000-0000000000b7', INCH = '00000000-0000-0000-0000-0000000000b8'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}
const day = (offset) => new Date(Date.UTC(2027, 0, 4 + offset)).toISOString().slice(0, 10)   // Monday 4 Jan 2027

describe('HR roster, leave and licences', () => {
  let db, nora, hilda, ina
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`insert into auth.users values ('${HR}', 'hr@a.ke'), ('${INCH}', 'ic@a.ke');
      insert into hospital_users(user_id, hospital_id, role) values ('${HR}', '${H1}', 'HR Manager'), ('${INCH}', '${H1}', 'Ward In-Charge');
      insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', 'hr@a.ke', 'Hilda', 'HR Manager', 'Active'), ('${H1}', 'ic@a.ke', 'Ina', 'Ward In-Charge', 'Active');
      alter table staff add column registration_expiry date;`)
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(read('../../../docs/sql/11_audit_privacy.sql'))
    await db.exec(read('../../../docs/sql/36_hr_roster_leave.sql'))
    await db.exec(read('../../../docs/sql/36_hr_roster_leave.sql'))
    nora = (await one(db, "select id from staff where full_name = 'Nora'")).id
    hilda = (await one(db, "select id from staff where full_name = 'Hilda'")).id
    ina = (await one(db, "select id from staff where full_name = 'Ina'")).id
  })

  it('roster: times from the shift code, no double-booking, rest and weekly-hours warnings; in-charges can roster', async () => {
    await as(db, NURSE)
    await refused(db.query("insert into staff_shifts(hospital_id, staff_id, shift_date, shift_code) values ($1, $2, $3, 'D')", [H1, nora, day(0)]), /row-level|policy/)
    await as(db, INCH)
    const d = await one(db, "insert into staff_shifts(hospital_id, staff_id, shift_date, shift_code) values ($1, $2, $3, 'd') returning *", [H1, nora, day(0)])
    assert.equal(d.shift_code, 'D'); assert.equal(new Date(d.starts_at).toISOString(), `${day(0)}T04:00:00.000Z`, '07:00 Nairobi'); assert.deepEqual(d.flags, [])
    await refused(db.query("insert into staff_shifts(hospital_id, staff_id, shift_date, shift_code) values ($1, $2, $3, 'AM')", [H1, nora, day(0)]), /already rostered D/)
    const n = await one(db, "insert into staff_shifts(hospital_id, staff_id, shift_date, shift_code) values ($1, $2, $3, 'N') returning flags", [H1, nora, day(0)])
    assert.match(n.flags[0], /Less than 11 hours of rest/, 'day then the same night: 0 h rest')
    for (const i of [1, 2, 3, 4]) await db.query("insert into staff_shifts(hospital_id, staff_id, shift_date, shift_code) values ($1, $2, $3, 'N')", [H1, nora, day(i)])
    const sixth = await one(db, "insert into staff_shifts(hospital_id, staff_id, shift_date, shift_code) values ($1, $2, $3, 'N') returning flags", [H1, nora, day(5)])
    assert.ok(sixth.flags.some((f) => /hours in 7 days/.test(f)))
    await as(db, REC)
    assert.equal((await db.query('select * from staff_shifts')).rows.length, 7, 'everyone in the hospital can see the roster')
  })

  it('leave: staff request their own, HR approves (not their own), working days, balances, roster clash refused', async () => {
    await as(db, NURSE)
    await refused(db.query("insert into staff_leave(hospital_id, staff_id, leave_type, start_date, end_date) values ($1, $2, 'Annual Leave', $3, $4)", [H1, hilda, day(14), day(18)]), /only request leave for yourself/)
    const req = await one(db, "insert into staff_leave(hospital_id, staff_id, leave_type, start_date, end_date, status) values ($1, $2, 'Annual Leave', $3, $4, 'approved') returning *", [H1, nora, day(14), day(25)])
    assert.equal(req.status, 'requested', 'staff cannot approve by inserting'); assert.equal(Number(req.working_days), 10, 'two weeks Mon–Fri')
    await refused(db.query("update staff_leave set status = 'approved' where id = $1", [req.id]), /Only HR/)
    await as(db, HR)
    const own = await one(db, "insert into staff_leave(hospital_id, staff_id, leave_type, start_date, end_date) values ($1, $2, 'Annual Leave', $3, $4) returning id", [H1, hilda, day(14), day(15)])
    await refused(db.query("update staff_leave set status = 'approved' where id = $1", [own.id]), /your own leave/)
    await refused(db.query("update staff_leave set status = 'rejected' where id = $1", [req.id]), /reason for rejecting/)
    await db.query("update staff_leave set status = 'approved' where id = $1", [req.id])
    const mat = await one(db, "insert into staff_leave(hospital_id, staff_id, leave_type, start_date, end_date) values ($1, $2, 'Maternity Leave', $3, $4) returning working_days", [H1, nora, day(60), day(149)])
    assert.equal(Number(mat.working_days), 90, 'maternity counted in calendar days')
    const bal = (await one(db, 'select leave_balances($1, $2, 2027) b', [H1, nora])).b
    assert.deepEqual(bal['Annual Leave'], { entitled: 21, used: 10, pending: 0 })
    assert.equal(bal['Maternity Leave'].pending, 90)
    await as(db, INCH)
    await refused(db.query("insert into staff_shifts(hospital_id, staff_id, shift_date, shift_code) values ($1, $2, $3, 'D')", [H1, nora, day(16)]), /on approved Annual Leave/)
    await db.query("insert into staff_shifts(hospital_id, staff_id, shift_date, shift_code) values ($1, $2, $3, 'OFF')", [H1, nora, day(16)])
    await as(db, HR)
    await refused(db.query("update staff_leave set end_date = $2 where id = $1", [req.id, day(30)]), /cancel it/)
    const dup = await one(db, "insert into staff_leave(hospital_id, staff_id, leave_type, start_date, end_date) values ($1, $2, 'Sick Leave', $3, $4) returning id", [H1, nora, day(20), day(21)])
    await refused(db.query("update staff_leave set status = 'approved' where id = $1", [dup.id]), /Overlaps approved leave/)
    await as(db, NURSE)
    assert.equal((await db.query('select * from staff_leave')).rows.length, 3, 'staff see only their own leave')
  })

  it('licences and CPD: compliance list for HR only', async () => {
    await as(db, HR)
    await db.exec(`reset role; insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', 'doc2@a.ke', 'Dr Otieno', 'Medical Officer', 'Active')`)
    await as(db, HR)
    const doc = (await one(db, "select id from staff where full_name = 'Dr Otieno'")).id
    await refused(db.query("insert into staff_licences(hospital_id, staff_id, body, number, expires_on) values ($1, $2, 'NCK', ' ', current_date + 30)", [H1, nora]), /registration number/)
    await db.query("insert into staff_licences(hospital_id, staff_id, body, number, expires_on) values ($1, $2, 'NCK', 'NCK/123', current_date + 30)", [H1, nora])
    await db.query("insert into staff_licences(hospital_id, staff_id, body, number, expires_on) values ($1, $2, 'KMPDC', 'A9999', current_date - 3)", [H1, doc])
    await db.query("insert into staff_cpd(hospital_id, staff_id, activity, done_on, points) values ($1, $2, 'BLS refresher', current_date, 5)", [H1, nora])
    await db.query("insert into hr_cpd_requirements(hospital_id, body, points_per_year) values ($1, 'NCK', 20)", [H1])
    const c = (await one(db, 'select hr_compliance($1) r', [H1])).r
    assert.deepEqual(c.expired.map((x) => [x.staff, x.body]), [['Dr Otieno', 'KMPDC']])
    assert.deepEqual(c.expiring.map((x) => [x.staff, x.days]), [['Nora', 30]])
    assert.ok(c.no_licence.some((x) => x.staff === 'Ina') === false)
    const noraCpd = c.cpd.find((x) => x.staff === 'Nora')
    assert.equal(Number(noraCpd.points), 5); assert.equal(Number(noraCpd.required), 20)
    await as(db, NURSE)
    await refused(db.query('select hr_compliance($1)', [H1]), /Only HR/)
    assert.equal((await db.query('select * from staff_licences')).rows.length, 1, 'staff see their own licence')
  })
})
