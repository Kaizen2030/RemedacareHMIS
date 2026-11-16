// Theatre preference cards and stock-linked items: supabase/migrations/20261212000000_theatre_preference_cards.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const JANE = '99999999-0000-0000-0000-000000000001'
const SUT = 'aaaaaaaa-0000-0000-0000-000000000011', PLATE = 'aaaaaaaa-0000-0000-0000-000000000012'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('theatre preference cards and items from stock', () => {
  let db, caseId
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`create table pharmacy_inventory (id uuid primary key, hospital_id uuid, drug_name text, generic_name text, quantity_in_stock numeric default 0, selling_price numeric);
      create table drug_batches (id uuid primary key default gen_random_uuid(), hospital_id uuid, drug_name text, batch_number text, quantity_received numeric, quantity_remaining numeric, expiry_date date, status text default 'Active');
      grant select on pharmacy_inventory, drug_batches to authenticated;
      create table notifications (id bigserial primary key, hospital_id uuid, notification_type text, title text, message text, target_path text, payload_json jsonb);`)
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$ begin return p::uuid; exception when others then return null; end $$;`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/21_theatre.sql'))
    await db.exec(read('../../../docs/sql/26_pharmacy_controls.sql'))
    await db.exec(read('../../../docs/sql/30_theatre_preference_cards.sql'))
    await db.exec(read('../../../docs/sql/30_theatre_preference_cards.sql'))
    await db.exec(`insert into pharmacy_inventory values ('${SUT}', '${H1}', 'Vicryl 2-0', null, 20, 450), ('${PLATE}', '${H1}', 'DHS plate 4-hole', null, 2, 18000);
      insert into drug_batches(hospital_id, drug_name, batch_number, quantity_received, quantity_remaining, expiry_date) values
        ('${H1}', 'Vicryl 2-0', 'V-LATE', 10, 10, current_date + 400), ('${H1}', 'Vicryl 2-0', 'V-SOON', 10, 10, current_date + 40);`)
    await as(db, NURSE)
    caseId = (await one(db, "insert into theatre_cases(hospital_id, patient_id, procedure, surgeon, scheduled_start, scheduled_end) values ($1, $2, 'DHS fixation', 'Dr Mwangi', now(), now() + interval '2 hours') returning id", [H1, JANE])).id
  })

  it('preference cards: one per surgeon and procedure', async () => {
    await db.query(`insert into theatre_preference_cards(hospital_id, surgeon, procedure, glove_size, position, items) values ($1, ' Dr Mwangi ', 'DHS fixation', '7.5', 'Supine on traction table', $2)`,
      [H1, JSON.stringify([{ kind: 'consumable', name: 'Vicryl 2-0', inventory_id: SUT, quantity: 3 }])])
    assert.equal((await one(db, 'select surgeon from theatre_preference_cards')).surgeon, 'Dr Mwangi')
    await refused(db.query("insert into theatre_preference_cards(hospital_id, surgeon, procedure) values ($1, 'dr mwangi', 'dhs FIXATION')", [H1]), /duplicate|unique/)
  })

  it('stock-linked items leave stock first-expiry-first-out and take the price; records are permanent', async () => {
    const i = await one(db, "insert into theatre_items(hospital_id, case_id, kind, name, inventory_id, quantity) values ($1, $2, 'consumable', 'Vicryl 2-0', $3, 3) returning *", [H1, caseId, SUT])
    assert.equal(Number(i.unit_price), 450)
    assert.deepEqual(i.stock_issue.batches.map((b) => b.batch_number), ['V-SOON'])
    await as(db, null)
    assert.equal(Number((await one(db, 'select quantity_in_stock q from pharmacy_inventory where id = $1', [SUT])).q), 17)
    assert.equal(Number((await one(db, "select quantity_remaining q from drug_batches where batch_number = 'V-SOON'")).q), 7)
    await as(db, NURSE)
    await refused(db.query("insert into theatre_items(hospital_id, case_id, kind, name, inventory_id, quantity, lot_number) values ($1, $2, 'implant', 'DHS plate', $3, 3, 'L1')", [H1, caseId, PLATE]), /only 2 in stock/)
    const consign = await one(db, "insert into theatre_items(hospital_id, case_id, kind, name, quantity, serial, unit_price) values ($1, $2, 'implant', 'Consignment screw', 1, 'S-99', 2500) returning stock_issue", [H1, caseId])
    assert.equal(consign.stock_issue, null, 'consignment implants do not touch stock')
    await refused(db.query("update theatre_items set quantity = 1 where id = $1", [i.id]), /cannot be changed|permission denied/)
  })

  it('each item is billed once', async () => {
    const i = await one(db, "select id from theatre_items where name = 'Vicryl 2-0'")
    await db.query("update theatre_items set invoice_id = 'cccccccc-0000-0000-0000-000000000009' where id = $1", [i.id])
    assert.ok((await one(db, 'select billed_at from theatre_items where id = $1', [i.id])).billed_at)
    await refused(db.query("update theatre_items set invoice_id = 'cccccccc-0000-0000-0000-000000000010' where id = $1", [i.id]), /already been billed/)
    await as(db, REC)
    assert.equal((await db.query('select * from theatre_preference_cards')).rows.length, 0)
  })
})
