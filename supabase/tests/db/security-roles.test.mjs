// Privilege-escalation tests for supabase/migrations/20261115000000_harden_roles.sql.
// The RLS policies below copy the ones found on the live project (check script, 2026-11-14),
// so these tests show the holes are closed WITHOUT breaking login / sign-up / staff screens.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const HARDEN = read('../../migrations/20261115000000_harden_roles.sql')

const H1 = '11111111-1111-1111-1111-111111111111', H2 = '22222222-2222-2222-2222-222222222222'
const U = {
  rec: '00000000-0000-0000-0000-0000000000a1', acc: '00000000-0000-0000-0000-0000000000a2',
  owner: '00000000-0000-0000-0000-0000000000a4', nurse: '00000000-0000-0000-0000-0000000000c1',
  otherHospital: '00000000-0000-0000-0000-0000000000b1', hr: '00000000-0000-0000-0000-0000000000d1',
  fresh: '00000000-0000-0000-0000-0000000000e1', invited: '00000000-0000-0000-0000-0000000000e2',
}

// Live-project shape: extra columns the app writes, and the live RLS policies.
const LIVE = `
  alter table hospitals add column network_id uuid, add column location text;
  alter table hospital_users add column last_login_at timestamptz, add column must_change_password boolean default false, add column is_primary boolean default false;
  alter table staff add column last_login_at timestamptz, add column must_change_password boolean default false, add column current_shift text;
  insert into auth.users values ('${U.hr}', 'hr@a.ke'), ('${U.fresh}', 'new@c.ke'), ('${U.invited}', 'inv@a.ke');
  insert into hospital_users(user_id, hospital_id, role) values ('${U.hr}', '${H1}', 'HR Manager');
  insert into staff(hospital_id, email, full_name, role, status) values
    ('${H1}', 'hr@a.ke', 'Hana', 'HR Manager', 'Active'), ('${H1}', 'inv@a.ke', 'Ivy', 'Cashier', 'Active'),
    ('${H1}', 'own@a.ke', 'Olga', 'admin', 'Active');
  update hospital_users set role = 'admin' where user_id = '${U.owner}';
  grant select, insert, update, delete on hospital_users, staff, hospitals to authenticated;
  alter table hospital_users enable row level security;
  alter table staff enable row level security;
  alter table hospitals enable row level security;
  create policy hospital_users_own on hospital_users for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  create function stub_member_of() returns setof uuid language sql stable security definer as
    $f$ select hospital_id from hospital_users where user_id = auth.uid() $f$;
  create function stub_admin_of() returns setof uuid language sql stable security definer as
    $f$ select hospital_id from hospital_users where user_id = auth.uid() and lower(role) = 'admin' $f$;
  create function stub_my_email() returns text language sql stable security definer as
    $f$ select lower(email) from auth.users where id = auth.uid() $f$;
  create policy hu_admin_scope on hospital_users for all using (hospital_id in (select stub_admin_of())) with check (true);
  create policy staff_hospital_isolation on staff for all using (hospital_id in (select stub_member_of())) with check (true);
  create policy hospitals_members on hospitals for all
    using (id in (select stub_member_of()) or lower(owner_email) = stub_my_email())
    with check (true);
`

async function boot({ harden = true } = {}) {
  const db = new PGlite()
  await db.exec(read('./stub.sql'))
  await db.exec(PAYMENTS)
  await db.exec(LIVE)
  if (harden) await db.exec(HARDEN)
  return db
}
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
async function denied(db, sql, params, re) {
  let msg = null
  try { await db.query(sql, params) } catch (e) { msg = e.message }
  assert.ok(msg, `should have been refused: ${sql}`)
  if (re) assert.match(msg, re)
}
const ok = (db, sql, params) => db.query(sql, params)
const level = async (db, u, h = H1) => { await as(db, null); return (await db.query('select pay_access_level($1, $2) as l', [h, u])).rows[0].l }

describe('the holes exist without the fix (proves the tests bite)', () => {
  it('a nurse can make herself admin through the live policies', async () => {
    const db = await boot({ harden: false })
    await as(db, U.nurse)
    await ok(db, "update hospital_users set role = 'admin' where user_id = $1", [U.nurse])
    await ok(db, "update staff set role = 'Admin' where email = 'nurse@a.ke'")
    assert.equal(await level(db, U.nurse), 'manage')
  })
})

describe('with the fix: escalation is refused', () => {
  let db
  before(async () => { db = await boot() })

  it('cannot set your own hospital role to admin', async () => {
    await as(db, U.nurse)
    await denied(db, "update hospital_users set role = 'admin' where user_id = $1", [U.nurse], /set by an administrator/)
  })
  it('cannot change your own (or anyone\'s) job title or status', async () => {
    await as(db, U.nurse)
    await denied(db, "update staff set role = 'Admin' where email = 'nurse@a.ke'", [], /job title/)
    await denied(db, "update staff set role = 'Accountant' where email = 'rec@a.ke'", [], /job title/)
    await denied(db, "update staff set status = 'Active' where email = 'sus@a.ke'", [], /status/)
    await denied(db, "update staff set email = 'own@a.ke' where email = 'nurse@a.ke'", [], /e-mail/)
  })
  it('cannot join another hospital, or add staff, or delete staff', async () => {
    await as(db, U.nurse)
    await denied(db, "insert into hospital_users(user_id, hospital_id, role) values ($1, $2, 'admin')", [U.nurse, H2], /not been added/)
    await denied(db, "insert into staff(hospital_id, email, role) values ($1, 'x@a.ke', 'Admin')", [H1], /administrator/)
    await denied(db, "delete from staff where email = 'rec@a.ke'", [], /administrator/)
  })
  it('cannot take over the hospital through owner_email or a network', async () => {
    await as(db, U.nurse)
    await denied(db, "update hospitals set owner_email = 'nurse@a.ke' where id = $1", [H1], /owner/)
    await as(db, null)
    await ok(db, "update hospitals set network_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where id = $1", [H1])
    await as(db, U.otherHospital) // admin of nothing in that network, tries to attach Hosp B to it
    await ok(db, "update hospital_users set role = 'Receptionist' where user_id = $1", [U.otherHospital])
    await denied(db, "update hospitals set network_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where id = $1", [H2], /network/)
  })
  it('none of that gave the nurse any payment rights', async () => {
    assert.equal(await level(db, U.nurse), 'member')
  })
})

describe('with the fix: the real flows keep working', () => {
  let db
  before(async () => { db = await boot() })

  it('login: update own last_login_at, clear the first-login flag, sync role from staff.role', async () => {
    await as(db, U.rec)
    await ok(db, 'update hospital_users set last_login_at = now(), must_change_password = false where user_id = $1', [U.rec])
    await ok(db, "update staff set last_login_at = now(), must_change_password = false where email = 'rec@a.ke'")
    await ok(db, "update hospital_users set role = 'Receptionist' where user_id = $1", [U.rec])
    await ok(db, "update hospital_users set role = 'staff' where user_id = $1", [U.rec])
  })
  it('invited staff create their own link with the role the admin gave them', async () => {
    await as(db, U.invited)
    await denied(db, "insert into hospital_users(user_id, hospital_id, role) values ($1, $2, 'admin')", [U.invited, H1], /administrator/)
    await ok(db, "insert into hospital_users(user_id, hospital_id, role) values ($1, $2, 'Cashier')", [U.invited, H1])
    assert.equal(await level(db, U.invited), 'take')
  })
  it('sign-up of a brand-new hospital: owner creates hospital, staff row and admin link', async () => {
    await as(db, U.fresh)
    const { rows } = await db.query("insert into hospitals(id, name, owner_email) values (gen_random_uuid(), 'Clinic C', 'new@c.ke') returning id")
    const h = rows[0].id
    await ok(db, "insert into staff(hospital_id, email, full_name, role, status) values ($1, 'new@c.ke', 'Neema', 'admin', 'Active')", [h])
    await ok(db, "insert into hospital_users(user_id, hospital_id, role) values ($1, $2, 'admin')", [U.fresh, h])
    await denied(db, "insert into hospitals(id, name, owner_email) values (gen_random_uuid(), 'Fake', 'own@a.ke')", [], /owned by the account/)
    assert.equal(await level(db, U.fresh, h), 'manage')
  })
  it('anyone can still change shifts (Settings / HR shift toggle)', async () => {
    await as(db, U.nurse)
    await ok(db, "update staff set current_shift = 'Night' where email = 'rec@a.ke'")
  })
  it('the admin manages staff, roles and the hospital profile', async () => {
    await as(db, U.owner)
    await ok(db, "update staff set role = 'Accountant' where email = 'rec@a.ke'")
    await ok(db, "update staff set status = 'Suspended' where email = 'nurse@a.ke'")
    await ok(db, "insert into staff(hospital_id, email, role) values ($1, 'newcashier@a.ke', 'Cashier')", [H1])
    await ok(db, "update hospital_users set role = 'admin' where user_id = $1", [U.acc])
    await ok(db, "update hospitals set name = 'Hosp A Renamed', owner_email = 'own@a.ke' where id = $1", [H1])
    await ok(db, "delete from staff where email = 'newcashier@a.ke'")
  })
  it('HR can manage ordinary staff but cannot create admins or touch admins', async () => {
    await as(db, U.hr)
    await ok(db, "insert into staff(hospital_id, email, role) values ($1, 'clerk@a.ke', 'Receptionist')", [H1])
    await ok(db, "update staff set status = 'On Leave' where email = 'clerk@a.ke'")
    await ok(db, "update staff set role = 'Nurse' where email = 'clerk@a.ke'")
    await denied(db, "update staff set role = 'Admin' where email = 'clerk@a.ke'", [], /job title/)
    await denied(db, "insert into staff(hospital_id, email, role) values ($1, 'boss@a.ke', 'Hospital Administrator')", [H1], /administrator/)
    await denied(db, "update staff set status = 'Suspended' where email = 'own@a.ke'", [], /status/)
    await denied(db, "update staff set role = 'Senior HR Manager' where email = 'hr@a.ke'", [], /job title/)
  })
  it('server-side code (no signed-in user) is not restricted', async () => {
    await as(db, null)
    await ok(db, "update hospital_users set role = 'admin' where user_id = $1", [U.nurse])
    await ok(db, "update staff set role = 'Nurse' where email = 'nurse@a.ke'")
  })
  it('re-running the hardening is safe', async () => {
    await as(db, null)
    await db.exec(HARDEN)
    await as(db, U.rec)
    await denied(db, "update hospital_users set role = 'admin' where user_id = $1", [U.rec])
  })
})
