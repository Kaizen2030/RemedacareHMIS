// Dashboards: supabase/migrations/20261217000000_dashboards.sql. Missing tables must give empty figures, not errors.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1', OWNER = '00000000-0000-0000-0000-0000000000a4', ACC = '00000000-0000-0000-0000-0000000000a2'
const JANE = '99999999-0000-0000-0000-000000000001'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('dashboards', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(read('../../../docs/sql/11_audit_privacy.sql'))
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(`create table visits (id uuid primary key default gen_random_uuid(), hospital_id uuid, visit_type text, created_at timestamptz default now());
      create table wards (id uuid primary key default gen_random_uuid(), hospital_id uuid, name text);
      create table beds (id uuid primary key default gen_random_uuid(), hospital_id uuid, ward_id uuid, patient_id uuid, status text);
      insert into visits(hospital_id, visit_type) values ('${H1}', 'OPD'), ('${H1}', 'OPD'), ('${H1}', 'Emergency');
      insert into wards(id, hospital_id, name) values ('aaaaaaaa-0000-0000-0000-0000000000f1', '${H1}', 'Medical');
      insert into beds(hospital_id, ward_id, patient_id, status) values ('${H1}', 'aaaaaaaa-0000-0000-0000-0000000000f1', '${JANE}', 'Occupied'), ('${H1}', 'aaaaaaaa-0000-0000-0000-0000000000f1', null, 'Cleaning'), ('${H1}', 'aaaaaaaa-0000-0000-0000-0000000000f1', null, 'Available');
      insert into invoices(hospital_id, patient_id, amount_kes, balance_kes, status, payment_method, created_at) values
        ('${H1}', '${JANE}', 5000, 5000, 'Pending', 'SHA', now() - interval '45 days'), ('${H1}', '${JANE}', 1200, 0, 'Paid', 'Cash', now());`)
    await db.exec(read('../../../docs/sql/35_dashboards.sql'))
    await db.exec(read('../../../docs/sql/35_dashboards.sql'))
  })

  it('executive dashboard: real figures where tables exist, empty where they do not', async () => {
    await as(db, OWNER)
    const d = (await one(db, 'select exec_dashboard($1, current_date - 60, current_date) r', [H1])).r
    assert.deepEqual(d.visits, { total: 3, opd: 2 })
    assert.deepEqual(d.beds, { total: 3, occupied: 1, cleaning: 1 })
    assert.equal(Number(d.billing.billed), 6200); assert.equal(Number(d.billing.outstanding), 5000)
    assert.equal(d.emergency, null, 'no ed_attendances table here: empty, not an error')
    assert.equal(d.theatre, null); assert.equal(d.claims, null)
    await as(db, NURSE)
    await refused(db.query('select exec_dashboard($1, current_date - 60, current_date)', [H1]), /administrators/)
  })

  it('matron, pharmacy and claims dashboards with their own access rules; the metric runner is not callable', async () => {
    await as(db, NURSE)
    const m = (await one(db, 'select matron_dashboard($1) r', [H1])).r
    assert.deepEqual(m.wards, [{ ward: 'Medical', beds: 3, occupied: 1, cleaning: 1 }])
    assert.equal(m.observations, null)
    const p = (await one(db, 'select pharmacy_dashboard($1) r', [H1])).r
    assert.equal(p.stock, null)
    await refused(db.query('select claims_dashboard($1, current_date - 60, current_date)', [H1]), /claims staff/)
    await refused(db.query("select dash_metric('select 1', $1)", [H1]), /permission denied/)
    await as(db, ACC)
    const c = (await one(db, 'select claims_dashboard($1, current_date - 60, current_date) r', [H1])).r
    assert.deepEqual(c.by_payer.map((x) => [x.payer, Number(x.billed)]).sort(), [['SHA', 5000], ['Self-pay', 1200]])
    assert.equal(Number(c.aging.d31_60), 5000)
    await as(db, REC)
    await refused(db.query('select matron_dashboard($1)', [H1]), /clinical staff/)
  })
})
