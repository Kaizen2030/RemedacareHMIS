// Ward MAR: supabase/migrations/20261120000000_ward_mar.sql on PGlite.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const CLIN = read('../../migrations/20261119000000_hiv_tb_maternity.sql')
const MAR = read('../../migrations/20261120000000_ward_mar.sql')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const JANE = '99999999-0000-0000-0000-000000000001'
const VISIT = '77777777-0000-0000-0000-000000000001'

async function boot() {
  const db = new PGlite()
  await db.exec(read('./stub.sql'))
  await db.exec(PAYMENTS)
  await db.exec(`
    create table visits(id uuid primary key, hospital_id uuid, patient_id uuid);
    insert into visits values ('${VISIT}', '${H1}', '${JANE}');
    create table prescriptions(id uuid primary key default gen_random_uuid(), hospital_id uuid, visit_id uuid, patient_id uuid, drug_name text,
      dosage text, frequency text, duration text, route text, status text default 'Pending', created_at timestamptz default now(), dispensed_at timestamptz);
    grant select on visits, prescriptions to authenticated;`)
  await db.exec(CLIN)
  await db.exec(MAR)
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

describe('the paste-ready 09 file', () => {
  it('installs after 08 and reports OK', async () => {
    const db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(PAYMENTS)
    await db.exec(read('../../../docs/sql/08_hiv_tb_maternity.sql'))
    const rows = (await db.exec(read('../../../docs/sql/09_ward_mar.sql'))).at(-1).rows
    assert.deepEqual(rows.map((r) => r.result), ['OK', 'OK', 'OK'])
  })
})

describe('frequency → ward times', () => {
  it('maps common Kenyan prescription wording', async () => {
    const db = await boot()
    const t = async (f) => (await one(db, 'select array_to_string(mar_times($1), \',\') t', [f])).t
    assert.equal(await t('TDS'), '06:00:00,14:00:00,22:00:00')
    assert.equal(await t('Every 8 hours'), '06:00:00,14:00:00,22:00:00')
    assert.equal(await t('Twice daily'), '08:00:00,20:00:00')
    assert.equal(await t('Once daily'), '08:00:00')
    assert.equal(await t('At night'), '22:00:00')
    assert.equal(await t('6 hourly'), '00:00:00,06:00:00,12:00:00,18:00:00')
    assert.equal(await t('As needed'), '')
    assert.equal((await one(db, "select mar_duration_days('5 days') a, mar_duration_days('2 weeks') b, mar_duration_days('') c")).a, 5)
    assert.equal((await one(db, "select mar_duration_days('2 weeks') b")).b, 14)
  })
})

describe('MAR', () => {
  let db
  before(async () => {
    db = await boot()
    await db.query(`insert into prescriptions(hospital_id, visit_id, patient_id, drug_name, dosage, frequency, duration, status, created_at) values
      ($1, $2, $3, 'Ceftriaxone', '1g', 'Once daily', '5 days', 'Released', now() - interval '1 hour'),
      ($1, $2, $3, 'Paracetamol', '1g', 'Every 6 hours', '3 days', 'Released', now() - interval '1 hour'),
      ($1, $2, $3, 'Morphine', '5mg', 'As needed', null, 'Released', now()),
      ($1, $2, $3, 'Old drug', '1 tab', 'TDS', '5 days', 'Rejected', now())`, [H1, VISIT, JANE])
  })

  it('generates the next 24 h of doses for active prescriptions only, idempotently', async () => {
    await as(db, NURSE)
    const n = (await one(db, 'select mar_generate($1, 24) n', [VISIT])).n
    assert.ok(n >= 4 && n <= 6, `got ${n} doses`)
    const byDrug = Object.fromEntries((await db.query('select drug_name, count(*)::int c from mar_doses group by 1')).rows.map((r) => [r.drug_name, r.c]))
    assert.ok(byDrug.Ceftriaxone >= 1 && byDrug.Ceftriaxone <= 2)
    assert.ok(byDrug.Paracetamol >= 3 && byDrug.Paracetamol <= 5)
    assert.equal(byDrug.Morphine, undefined, 'PRN is not scheduled')
    assert.equal(byDrug['Old drug'], undefined, 'rejected prescriptions are ignored')
    assert.equal((await one(db, 'select mar_generate($1, 24) n', [VISIT])).n, 0, 'running again adds nothing')
  })
  it('giving a dose stamps the nurse and time; held / refused need a reason', async () => {
    const d = await one(db, "select id from mar_doses where drug_name = 'Ceftriaxone' order by scheduled_at limit 1")
    await db.query("update mar_doses set status = 'given' where id = $1", [d.id])
    const r = await one(db, 'select status, administered_by, administered_by_name, administered_at is not null as stamped from mar_doses where id = $1', [d.id])
    assert.deepEqual(r, { status: 'given', administered_by: NURSE, administered_by_name: 'Nora', stamped: true })
    const p = await one(db, "select id from mar_doses where drug_name = 'Paracetamol' order by scheduled_at limit 1")
    await refused(db.query("update mar_doses set status = 'held' where id = $1", [p.id]), /check constraint/)
    await db.query("update mar_doses set status = 'held', reason = 'Temp 36.8, no pain' where id = $1", [p.id])
  })
  it('a documented dose cannot be rewritten — only marked in error with a reason', async () => {
    const d = await one(db, "select id from mar_doses where status = 'given' limit 1")
    await refused(db.query("update mar_doses set status = 'refused', reason = 'x' where id = $1", [d.id]), /already documented/)
    await refused(db.query("update mar_doses set status = 'entered_in_error' where id = $1", [d.id]), /check constraint/)
    await db.query("update mar_doses set status = 'entered_in_error', reason = 'Charted on wrong patient' where id = $1", [d.id])
    await refused(db.query("update mar_doses set status = 'given' where id = $1", [d.id]), /cannot be changed/)
    await refused(db.query('delete from mar_doses where id = $1', [d.id]))
  })
  it('PRN doses are recorded when given', async () => {
    const rx = await one(db, "select id from prescriptions where drug_name = 'Morphine'")
    await db.query("insert into mar_doses(hospital_id, visit_id, patient_id, prescription_id, drug_name, dose, prn, scheduled_at, status, witness) values ($1, $2, $3, $4, 'Morphine', '5mg', true, now(), 'given', 'Nurse Atieno')", [H1, VISIT, JANE, rx.id])
    assert.equal((await one(db, "select administered_by_name from mar_doses where prn")).administered_by_name, 'Nora')
  })
  it('undocumented doses become missed after 4 hours (sweep), and reception cannot see the MAR', async () => {
    await as(db, null)
    await db.query("insert into mar_doses(hospital_id, visit_id, patient_id, prescription_id, drug_name, scheduled_at) values ($1, $2, $3, 'x-old', 'Amoxicillin', now() - interval '5 hours')", [H1, VISIT, JANE])
    assert.equal((await one(db, 'select mar_flag_missed() n')).n, 1)
    assert.equal((await one(db, "select status from mar_doses where prescription_id = 'x-old'")).status, 'missed')
    await as(db, REC)
    assert.equal((await db.query('select * from mar_doses')).rows.length, 0)
    await refused(db.query('select mar_generate($1, 24)', [VISIT]), /Clinical access/)
  })
  it('is safe to run twice', async () => {
    await as(db, null)
    await db.exec(MAR)
  })
})
