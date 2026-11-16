// Pharmacy controls: supabase/migrations/20261208000000_pharmacy_controls.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1', PHARM = '00000000-0000-0000-0000-0000000000e1', NURSE2 = '00000000-0000-0000-0000-0000000000e2'
const JANE = '99999999-0000-0000-0000-000000000001'
const AMOX = 'aaaaaaaa-0000-0000-0000-000000000001', MORPH = 'aaaaaaaa-0000-0000-0000-000000000002', PCM = 'aaaaaaaa-0000-0000-0000-000000000003'

const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}
const cd = (db, o) => one(db, `insert into cd_register(hospital_id, inventory_id, location, entry_type, quantity, patient_id, prescriber, counterpart, reason)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`, [H1, MORPH, o.location || 'Pharmacy', o.type, o.qty, o.patient || null, o.prescriber || null, o.counterpart || null, o.reason || null])

describe('pharmacy controls', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`insert into auth.users values ('${PHARM}', 'ph@a.ke'), ('${NURSE2}', 'n2@a.ke');
      insert into hospital_users(user_id, hospital_id, role) values ('${PHARM}', '${H1}', 'Pharmacist'), ('${NURSE2}', '${H1}', 'Nurse');
      insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', 'ph@a.ke', 'Paul', 'Pharmacist', 'Active'), ('${H1}', 'n2@a.ke', 'Nadia', 'Nurse', 'Active');
      create table pharmacy_inventory (id uuid primary key, hospital_id uuid, drug_name text, generic_name text, quantity_in_stock numeric default 0);
      create table drug_batches (id uuid primary key default gen_random_uuid(), hospital_id uuid, drug_name text, batch_number text, quantity_received numeric, quantity_remaining numeric, expiry_date date, status text default 'Active');
      grant select, insert, update on pharmacy_inventory, drug_batches to authenticated;
      create table notifications (id bigserial primary key, hospital_id uuid, notification_type text, title text, message text, target_path text, payload_json jsonb);`)
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$ begin return p::uuid; exception when others then return null; end $$;`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/26_pharmacy_controls.sql'))
    await db.exec(read('../../../docs/sql/26_pharmacy_controls.sql'))
    await db.exec(`insert into pharmacy_inventory values ('${AMOX}', '${H1}', 'Amoxicillin 500mg', 'amoxicillin', 300), ('${MORPH}', '${H1}', 'Morphine 10mg/ml inj', 'morphine', 50), ('${PCM}', '${H1}', 'Paracetamol 500mg', 'paracetamol', 100);
      update pharmacy_inventory set controlled_drug = true where id = '${MORPH}';
      insert into drug_batches(hospital_id, drug_name, batch_number, quantity_received, quantity_remaining, expiry_date) values
        ('${H1}', 'Amoxicillin 500mg', 'OLD-EXP', 50, 50, current_date - 5),
        ('${H1}', 'Amoxicillin 500mg', 'B-SOON', 100, 100, current_date + 30),
        ('${H1}', 'Amoxicillin 500mg', 'B-LATER', 150, 150, current_date + 300);`)
  })

  it('FEFO: direct draws must take the earliest batch; expired stock is blocked; write-offs and pharmacist overrides allowed', async () => {
    await as(db, PHARM)
    await refused(db.query("update drug_batches set quantity_remaining = 140 where batch_number = 'B-LATER'"), /use batch B-SOON/)
    await refused(db.query("update drug_batches set quantity_remaining = 40 where batch_number = 'OLD-EXP'"), /expired/)
    await db.query("update drug_batches set quantity_remaining = 0, status = 'Written Off', last_change_reason = 'write_off' where batch_number = 'OLD-EXP'")
    await db.query("update drug_batches set quantity_remaining = 145, last_change_reason = 'override: patient allergic to excipient in B-SOON' where batch_number = 'B-LATER'")
    assert.equal((await one(db, "select last_change_reason from drug_batches where batch_number = 'B-LATER'")).last_change_reason, null)
    await as(db, NURSE)
    await refused(db.query("update drug_batches set quantity_remaining = 140, last_change_reason = 'override: nurse wants to' where batch_number = 'B-LATER'"), /Only a pharmacist/)
  })

  it('pharmacy_fefo_issue takes the earliest batches atomically with the stock level', async () => {
    await as(db, NURSE)
    await refused(db.query('select pharmacy_fefo_issue($1, 10)', [AMOX]), /Only pharmacy staff/)
    await as(db, PHARM)
    const r = (await one(db, "select pharmacy_fefo_issue($1, 120, 'RX-1') r", [AMOX])).r
    assert.deepEqual(r.batches.map((b) => [b.batch_number, Number(b.quantity)]), [['B-SOON', 100], ['B-LATER', 20]])
    assert.equal(Number((await one(db, 'select quantity_in_stock from pharmacy_inventory where id = $1', [AMOX])).quantity_in_stock), 180)
    await refused(db.query('select pharmacy_fefo_issue($1, 500)', [AMOX]), /only 180 in stock/)
    await db.exec(`reset role; update pharmacy_inventory set quantity_in_stock = 1000 where id = '${AMOX}'`)
    await as(db, PHARM)
    await refused(db.query('select pharmacy_fefo_issue($1, 200)', [AMOX]), /cover only 125/)
    const untracked = (await one(db, 'select pharmacy_fefo_issue($1, 10) r', [PCM])).r
    assert.equal(untracked.tracked, false)
    assert.equal((await one(db, "select count(*)::int n from pharmacy_batch_movements where reference = 'RX-1'")).n, 2)
  })

  it('controlled drug register: running balance, no negatives, patient issues need prescriber, ward transfers post both sides', async () => {
    await as(db, PHARM)
    await refused(one(db, "insert into cd_register(hospital_id, inventory_id, entry_type, quantity) values ($1, $2, 'receipt', 5) returning id", [H1, AMOX]), /not marked as a controlled/)
    const rec = await cd(db, { type: 'receipt', qty: 20, counterpart: 'KEMSA invoice 4471' })
    assert.equal(Number(rec.balance_after), 20)
    await refused(cd(db, { type: 'issue_patient', qty: 2, patient: JANE }), /prescriber/)
    await cd(db, { type: 'issue_patient', qty: 2, patient: JANE, prescriber: 'Dr Mwangi' })
    await refused(cd(db, { type: 'issue_patient', qty: 50, patient: JANE, prescriber: 'Dr Mwangi' }), /balance for Morphine 10mg\/ml inj is 18/)
    await cd(db, { type: 'issue_ward', qty: 10, counterpart: 'Surgical Ward' })
    await as(db, NURSE)
    const ward = await one(db, "select * from cd_register where location = 'Surgical Ward'")
    assert.equal(ward.entry_type, 'received_from_pharmacy'); assert.equal(Number(ward.balance_after), 10)
    await cd(db, { location: 'Surgical Ward', type: 'administered', qty: 1, patient: JANE })
    await refused(cd(db, { type: 'receipt', qty: 5 }), /row-level|policy/)
    const bal = (await db.query('select * from cd_balances($1) order by location', [H1])).rows
    assert.deepEqual(bal.map((b) => [b.location, Number(b.balance)]), [['Pharmacy', 8], ['Surgical Ward', 9]])
    await refused(db.query("update cd_register set quantity = 1 where id = $1", [ward.id]), /cannot be changed|permission denied/)
  })

  it('witness must be a different login; pharmacist witnesses destruction; count discrepancies need a reason and alert', async () => {
    await as(db, NURSE)
    const use = await cd(db, { location: 'Surgical Ward', type: 'administered', qty: 1, patient: JANE })
    await refused(db.query("select cd_witness($1, 'Nora')", [use.id]), /second person/)
    await as(db, NURSE2)
    await db.query("select cd_witness($1, 'Nadia')", [use.id])
    assert.equal((await one(db, 'select witness_name from cd_register where id = $1', [use.id])).witness_name, 'Nadia')
    await refused(db.query("select cd_witness($1, 'Nadia')", [use.id]), /Already/)
    await as(db, NURSE)
    const destroy = await cd(db, { location: 'Surgical Ward', type: 'destruction', qty: 1, reason: 'Ampoule broken' })
    await as(db, NURSE2)
    await refused(db.query('select cd_witness($1)', [destroy.id]), /pharmacist must witness/)
    await as(db, PHARM)
    await db.query("select cd_witness($1, 'Paul')", [destroy.id])
    await as(db, NURSE)
    await refused(cd(db, { location: 'Surgical Ward', type: 'balance_check', qty: 6 }), /differs from the register balance \(7\)/)
    const chk = await cd(db, { location: 'Surgical Ward', type: 'balance_check', qty: 6, reason: 'One ampoule unaccounted for: incident report filed' })
    assert.equal(Number(chk.discrepancy), -1); assert.equal(Number(chk.balance_after), 7)
    await as(db, null)
    assert.ok(await one(db, "select 1 from notifications where title = 'Controlled drug discrepancy'"))
  })

  it('ward imprest: par levels, top-up issued FEFO by pharmacy and received by the ward, usage and counts', async () => {
    await as(db, PHARM)
    const ws = await one(db, "insert into ward_stock(hospital_id, ward, inventory_id, par_level, quantity) values ($1, 'Surgical Ward', $2, 40, 999) returning *", [H1, AMOX])
    assert.equal(Number(ws.quantity), 0, 'stock only arrives by top-up')
    await as(db, NURSE)
    await db.query("update ward_stock set quantity = 5 where id = $1", [ws.id])
    assert.equal(Number((await one(db, "select quantity from ward_stock where id = $1", [ws.id])).quantity), 0, "nurses cannot edit ward stock directly")
    await refused(db.query("insert into ward_stock_moves(hospital_id, ward_stock_id, kind, quantity) values ($1, $2, 'topup', 5)", [H1, ws.id]), /pharmacy top-up/)
    const req = (await one(db, "select ward_topup_create($1, 'Surgical Ward') id", [H1])).id
    const lines = (await one(db, 'select lines from ward_topup_requests where id = $1', [req])).lines
    assert.equal(Number(lines[0].requested), 40)
    await refused(db.query('select ward_topup_issue($1, $2)', [req, JSON.stringify({ [ws.id]: 30 })]), /Only pharmacy staff/)
    await refused(db.query("update ward_topup_requests set status = 'received' where id = $1", [req]), /only through issue and receive/)
    await as(db, PHARM)
    const before = Number((await one(db, 'select quantity_in_stock from pharmacy_inventory where id = $1', [AMOX])).quantity_in_stock)
    await db.query('select ward_topup_issue($1, $2)', [req, JSON.stringify({ [ws.id]: 30 })])
    assert.equal(Number((await one(db, 'select quantity_in_stock from pharmacy_inventory where id = $1', [AMOX])).quantity_in_stock), before - 30)
    await as(db, NURSE)
    await db.query('select ward_topup_receive($1)', [req])
    assert.equal(Number((await one(db, 'select quantity from ward_stock where id = $1', [ws.id])).quantity), 30)
    await db.query("insert into ward_stock_moves(hospital_id, ward_stock_id, kind, quantity, patient_id) values ($1, $2, 'use', 3, $3)", [H1, ws.id, JANE])
    await refused(db.query("insert into ward_stock_moves(hospital_id, ward_stock_id, kind, quantity) values ($1, $2, 'use', 100)", [H1, ws.id]), /Only 27/)
    await refused(db.query("insert into ward_stock_moves(hospital_id, ward_stock_id, kind, quantity) values ($1, $2, 'count', 25)", [H1, ws.id]), /give the reason/)
    const c = await one(db, "insert into ward_stock_moves(hospital_id, ward_stock_id, kind, quantity, reason) values ($1, $2, 'count', 25, 'Two capsules dropped') returning variance", [H1, ws.id])
    assert.equal(Number(c.variance), -2)
    await as(db, REC)
    assert.equal((await db.query('select * from cd_register')).rows.length, 0)
    assert.equal((await db.query('select * from ward_stock')).rows.length, 0)
  })
})
