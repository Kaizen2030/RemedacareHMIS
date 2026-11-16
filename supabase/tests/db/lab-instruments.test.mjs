// Laboratory analyser interface: supabase/migrations/20261224000000_lab_instruments.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1', OWNER = '00000000-0000-0000-0000-0000000000a4'
const JANE = '99999999-0000-0000-0000-000000000001'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('laboratory analyser interface', () => {
  let db, key, order
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`create table lab_tests (id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, patient_name text, test_type text, category text,
        status text, sample_status text, sample_barcode text, performed_by text, created_at timestamptz default now());
      create table notifications(id bigserial primary key, hospital_id uuid, notification_type text, title text, message text, target_path text, payload_json jsonb);
      grant select, insert, update on lab_tests to authenticated;`)
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/11_audit_privacy.sql'))
    await db.exec(read('../../../docs/sql/34_lab_quality.sql'))
    await db.exec(read('../../../docs/sql/40_critical_results.sql'))
    await db.exec(read('../../../docs/sql/44_lab_instruments.sql'))
    await db.exec(read('../../../docs/sql/44_lab_instruments.sql'))
    order = await one(db, "insert into lab_tests(hospital_id, patient_id, patient_name, test_type, status, sample_barcode) values ($1, $2, 'Jane', 'Full blood count', 'Pending', 'LAB-000123') returning id", [H1, JANE])
  })

  it('the paste-ready 44 file reports OK', async () => {
    const r = (await db.query(`select 'analysers, maps and inbox' as check_name, case when to_regclass('public.lab_instruments') is not null and (select count(*) from public.lab_instrument_maps where hospital_id is null) >= 30
      and not has_function_privilege('authenticated', 'public.lab_instrument_ingest(text,jsonb)', 'execute') then 'OK' else 'PROBLEM' end as result`)).rows[0]
    assert.equal(r.result, 'OK')
  })

  it('only an administrator or lab manager registers an analyser; the key is shown once and stored hashed', async () => {
    await as(db, NURSE)
    await refused(db.query("select lab_instrument_create($1, 'BC-5000', 'Mindray', 'hl7', 'haematology')", [H1]), /laboratory manager/)
    await as(db, OWNER)
    const r = (await one(db, "select lab_instrument_create($1, 'BC-5000', 'Mindray', 'hl7', 'haematology') r", [H1])).r
    key = r.key
    assert.match(key, /^rcl_[0-9a-f]{64}$/)
    await as(db, null)
    const ins = await one(db, 'select * from lab_instruments where id = $1', [r.id])
    assert.notEqual(ins.key_hash, key); assert.equal(ins.key_prefix, key.slice(0, 12))
    await as(db, NURSE)
    await refused(db.query('select key_hash from lab_instruments'), /permission/)
    await refused(db.query('select lab_instrument_ingest($1, $2)', [key, '{}']), /permission/)
  })

  it('ingest maps codes with unit conversion, matches the barcode, keeps unmapped codes, and ignores a duplicate run', async () => {
    await as(db, null)
    await refused(db.query("select lab_instrument_ingest('rcl_wrong', '{}')"), /Unknown or revoked/)
    const payload = { results: [
      { sample_id: 'lab-000123', measured_at: '2026-11-15T08:30:00+03:00', records: [
        { code: 'WBC', value: '3.1', unit: '10*9/L', flag: 'L' }, { code: 'HGB', value: '98', unit: 'g/L', flag: 'L' },
        { code: 'PLT', value: '15', unit: '10*9/L', flag: 'LL' }, { code: 'MCV', value: '81', unit: 'fL' }, { code: 'CREA', value: '1.2', unit: 'mg/dL' }] },
      { sample_id: 'UNKNOWN-9', records: [{ code: 'WBC', value: '7' }] }] }
    const s = (await one(db, 'select lab_instrument_ingest($1, $2) s', [key, JSON.stringify(payload)])).s
    assert.deepEqual(s, { received: 2, unmatched: 1, auto_accepted: 0 })
    const x = await one(db, "select * from lab_instrument_results where sample_id = 'lab-000123'")
    assert.equal(x.lab_test_id, order.id); assert.equal(x.status, 'pending'); assert.equal(x.template_key, 'fbc')
    assert.deepEqual(x.result_values, { fbc: { wbc: 3.1, haemoglobin: 9.8, platelets: 15 }, rfts: { creatinine: 106.08 } })
    assert.deepEqual(x.unmapped.map((u) => u.code), ['MCV'])
    assert.equal(x.flags.platelets, 'LL')
    const again = (await one(db, 'select lab_instrument_ingest($1, $2) s', [key, JSON.stringify({ results: [payload.results[0]] })])).s
    assert.equal(again.received, 0, 'same analyser, sample and time is not stored twice')
  })

  it('accepting writes the order and fires the critical-results loop; unmatched results are matched by hand; reject needs a reason', async () => {
    await as(db, NURSE)
    const x = await one(db, "select id from lab_instrument_results where sample_id = 'lab-000123'")
    await db.query('select lab_instrument_accept($1)', [x.id])
    const t = await one(db, 'select * from lab_tests where id = $1', [order.id])
    assert.equal(t.status, 'Complete'); assert.equal(t.performed_by, 'Analyser: BC-5000'); assert.equal(t.result_template_key, 'fbc')
    assert.deepEqual(t.result_json, { wbc: 3.1, haemoglobin: 9.8, platelets: 15 })
    const alert = await one(db, "select * from lab_critical_alerts where analyte = 'platelets'")
    assert.equal(Number(alert.value), 15, 'platelets 15 is critical (≤ 20)')
    await refused(db.query('select lab_instrument_accept($1)', [x.id]), /Already accepted/)
    const u = await one(db, "select id from lab_instrument_results where sample_id = 'UNKNOWN-9'")
    await refused(db.query('select lab_instrument_accept($1)', [u.id]), /Match the result/)
    await refused(db.query("select lab_instrument_reject($1, ' ')", [u.id]), /reason/)
    await db.query("select lab_instrument_reject($1, 'Wrong sample ID entered on the analyser')", [u.id])
    await as(db, REC)
    assert.equal((await db.query('select * from lab_instrument_results')).rows.length, 0, 'reception cannot see results')
  })

  it('a revoked analyser key stops working', async () => {
    await as(db, OWNER)
    await db.query("update lab_instruments set active = false, revoked_at = now() where name = 'BC-5000'")
    await as(db, null)
    await refused(db.query('select lab_instrument_ingest($1, $2)', [key, JSON.stringify({ results: [{ sample_id: 'X', records: [] }] })]), /Unknown or revoked/)
  })
})
