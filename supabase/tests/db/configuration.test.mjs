// Price lists, role matrix, department form changes and their change log:
// supabase/migrations/20261124000000_configuration.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const AUDIT = read('../../migrations/20261122000000_audit_privacy.sql')
const MIG = read('../../migrations/20261124000000_configuration.sql')
const H1 = '11111111-1111-1111-1111-111111111111', H2 = '22222222-2222-2222-2222-222222222222'
const OWNER = '00000000-0000-0000-0000-0000000000a4', ACC = '00000000-0000-0000-0000-0000000000a2'
const CASHIER = '00000000-0000-0000-0000-0000000000a3', NURSE = '00000000-0000-0000-0000-0000000000c1', OTHER = '00000000-0000-0000-0000-0000000000b1'

const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('configuration', () => {
  let db, sha, aar, jubilee
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(PAYMENTS)
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$
        begin return p::uuid; exception when others then return null; end $$;
      create table charge_codes (id uuid primary key default gen_random_uuid(), hospital_id text, code text, name text, unit_price_kes numeric);
      alter table charge_codes enable row level security;
      create policy cc on charge_codes for all using (true) with check (true);
      grant select, insert, update on charge_codes to authenticated;
      grant select, insert on audit_log to authenticated; grant usage on sequence audit_log_id_seq to authenticated;`)
    await db.exec(AUDIT)
    await db.exec(MIG)
    await db.exec(read('../../../docs/sql/14_configuration.sql')) // the paste-ready file, run a second time
  })

  it('works out the payer from the visit payment method and insurer', async () => {
    const t = async (m, i) => (await one(db, 'select config_payer_type($1, $2) as t', [m, i])).t
    assert.equal(await t('SHA (Social Health Authority)'), 'sha')
    assert.equal(await t('Insurance', 'NHIF'), 'sha')
    assert.equal(await t('Insurance', 'AAR'), 'insurance')
    assert.equal(await t('M-Pesa'), 'cash')
    assert.equal(await t(null), 'cash')
  })

  it('admins and finance managers set payer prices; cashiers, nurses and other hospitals cannot', async () => {
    await as(db, OWNER)
    sha = (await one(db, "insert into price_lists(hospital_id, name, payer_type) values ($1, 'SHA tariff', 'sha') returning id", [H1])).id
    aar = (await one(db, "insert into price_lists(hospital_id, name, payer_type, insurer_name) values ($1, 'AAR', 'insurance', 'AAR') returning id", [H1])).id
    await as(db, ACC)
    jubilee = (await one(db, "insert into price_lists(hospital_id, name, payer_type) values ($1, 'Any insurer', 'insurance') returning id", [H1])).id
    await db.query("insert into charge_code_prices(hospital_id, price_list_id, charge_code, price_kes) values ($1, $2, 'CONS-OPD', 400), ($1, $3, 'CONS-OPD', 1500), ($1, $4, 'CONS-OPD', 1200)", [H1, sha, aar, jubilee])
    await as(db, CASHIER)
    await refused(db.query("insert into price_lists(hospital_id, name, payer_type) values ($1, 'x', 'cash')", [H1]), /row-level/)
    await as(db, NURSE)
    await db.query('update charge_code_prices set price_kes = 1') // row-level security: matches no rows
    await as(db, OWNER)
    assert.equal((await one(db, "select price_kes from charge_code_prices where price_list_id = $1", [sha])).price_kes, '400.00')
    await as(db, OTHER)
    assert.equal((await db.query('select * from price_lists')).rows.length, 0)
    await refused(db.query("insert into charge_code_prices(hospital_id, price_list_id, charge_code, price_kes) values ($1, $2, 'X', 1)", [H2, sha]), /row-level/)
  })

  it('picks the payer price: insurer-specific first, then any-insurer, none for cash', async () => {
    await as(db, NURSE)
    const p = async (m, i) => (await db.query('select * from config_price($1, $2, $3, $4)', [H1, 'cons-opd', m, i])).rows[0] || null
    assert.equal((await p('SHA (Social Health Authority)')).price_kes, '400.00')
    assert.equal((await p('Insurance', 'AAR')).price_list, 'AAR')
    assert.equal((await p('Insurance', 'Britam')).price_list, 'Any insurer')
    assert.equal(await p('Cash'), null)
    await as(db, OTHER)
    assert.equal((await db.query('select * from config_price($1, $2, $3)', [H1, 'CONS-OPD', 'SHA'])).rows.length, 0, 'other hospitals see nothing')
  })

  it('only admins change the role matrix and forms; Admin itself cannot be restricted', async () => {
    await as(db, ACC)
    await refused(db.query("insert into role_permissions(hospital_id, role, screens) values ($1, 'Nurse', '{/dashboard}')", [H1]), /row-level/)
    await as(db, OWNER)
    await db.query("insert into role_permissions(hospital_id, role, screens, actions) values ($1, 'Nurse', '{/dashboard,/wards}', '{record_vitals}')", [H1])
    await refused(db.query("insert into role_permissions(hospital_id, role) values ($1, 'Admin')", [H1]), /check/)
    await db.query(`insert into workflow_form_overrides(hospital_id, module_code, fields) values ($1, 'theatre', '[{"key":"procedure","label":"Operation"}]')`, [H1])
    await refused(db.query(`insert into workflow_form_overrides(hospital_id, module_code, fields) values ($1, 'icu', '{"a":1}')`, [H1]), /check/)
    await as(db, NURSE)
    assert.equal((await one(db, 'select role from role_permissions')).role, 'Nurse', 'members read the matrix so menus follow it')
  })

  it('every change lands in the audit log with old and new values', async () => {
    await as(db, OWNER)
    await db.query("update charge_code_prices set price_kes = 450 where price_list_id = $1", [sha])
    const r = await one(db, "select details, user_id from audit_log where action = 'update:charge_code_prices'")
    assert.match(String(r.details), /"from": ?"400(\.00)?"/)
    assert.match(String(r.details), /"to": ?"450(\.00)?"/)
    assert.equal(r.user_id, OWNER)
    assert.ok(await one(db, "select 1 from audit_log where action = 'insert:role_permissions'"))
    assert.ok(await one(db, "select 1 from audit_log where action = 'insert:workflow_form_overrides'"))
  })
})
