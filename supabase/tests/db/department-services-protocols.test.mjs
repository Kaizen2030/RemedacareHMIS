// Department services and protocols (docs/sql/52): who changes prices, delete vs retire, protocol revisions and reads.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111', H2 = '22222222-2222-2222-2222-222222222222'
const OWNER = '00000000-0000-0000-0000-0000000000a4', ACC = '00000000-0000-0000-0000-0000000000a2', NURSE = '00000000-0000-0000-0000-0000000000c1'
const INCH = '00000000-0000-0000-0000-0000000000b8', REC_B = '00000000-0000-0000-0000-0000000000b1'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('department services and protocols', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`insert into auth.users values ('${INCH}', 'ic@a.ke');
      insert into hospital_users(user_id, hospital_id, role) values ('${INCH}', '${H1}', 'Ward In-Charge');
      alter table staff add column registration_expiry date; alter table staff add column department text;
      insert into staff(hospital_id, email, full_name, role, status, department) values ('${H1}', 'ic@a.ke', 'Ina', 'Ward In-Charge', 'Active', 'Dental');
      update staff set department = 'Dental' where full_name = 'Nora';
      create schema if not exists storage;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select, insert, delete on storage.objects to authenticated;
      -- the live price list: made by hand, with a policy that let anyone change it
      create table charge_codes (id uuid primary key default gen_random_uuid(), hospital_id uuid, code text, name text, unit_price_kes numeric);
      alter table charge_codes enable row level security;
      create policy "Enable all for users" on charge_codes for all using (true) with check (true);
      grant select, insert, update, delete on charge_codes to authenticated;
      alter table invoices add column services text;`)
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(read('../../../docs/sql/11_audit_privacy.sql'))
    await db.exec(read('../../../docs/sql/36_hr_roster_leave.sql'))
    await db.exec(read('../../migrations/20261229000000_merge_duplicate_departments.sql'))
    await db.exec(read('../../../docs/sql/51_department_control.sql'))
    for (let i = 0; i < 2; i++) {
      const rows = (await db.exec(read('../../../docs/sql/52_department_services_protocols.sql'))).at(-1).rows
      assert.ok(rows.every((r) => r.result === 'OK'), JSON.stringify(rows))
    }
  })

  it('only administrators and finance managers change the price list; everyone in the hospital reads it', async () => {
    await as(db, NURSE)
    await refused(db.query(`insert into charge_codes(hospital_id, code, name, unit_price_kes, department) values ($1, 'X-1', 'Scaling', 1500, 'Dental')`, [H1]), /row-level/)
    await as(db, OWNER)
    const s = await one(db, `insert into charge_codes(hospital_id, code, name, unit_price_kes, department, category) values ($1, ' proc-dental-scaling ', 'Scaling and polishing', 1500, 'dental', 'Procedure') returning *`, [H1])
    assert.equal(s.code, 'PROC-DENTAL-SCALING')
    assert.equal(s.department, 'Dental')
    await refused(db.query(`insert into charge_codes(hospital_id, code, name, unit_price_kes) values ($1, 'proc-dental-scaling', 'Copy', 10)`, [H1]), /already used/)
    await refused(db.query(`update charge_codes set unit_price_kes = -5 where id = $1`, [s.id]), /negative/)
    await as(db, ACC) // accountant = finance manager
    await db.query(`update charge_codes set unit_price_kes = 1800, description = 'Full mouth' where id = $1`, [s.id])
    await as(db, NURSE)
    assert.equal((await one(db, 'select unit_price_kes from charge_codes where id = $1', [s.id])).unit_price_kes, '1800')
    const upd = await db.query(`update charge_codes set unit_price_kes = 1 where id = $1`, [s.id])
    assert.equal(upd.affectedRows, 0)
    await as(db, REC_B)
    assert.equal((await db.query('select * from charge_codes')).rows.length, 0) // other hospital
    await as(db)
  })

  it('removing a service deletes it if never billed, and retires it if it is on a bill', async () => {
    await as(db, OWNER)
    const a = await one(db, `insert into charge_codes(hospital_id, code, name, unit_price_kes, department) values ($1, 'PROC-DENTAL-EXTRACTION', 'Extraction', 1200, 'Dental') returning id`, [H1])
    const b = await one(db, `insert into charge_codes(hospital_id, code, name, unit_price_kes, department) values ($1, 'PROC-DENTAL-FILLING', 'Filling', 2500, 'Dental') returning id`, [H1])
    await as(db)
    await db.query(`insert into invoices(hospital_id, invoice_no, services) values ($1, 'INV-1', '[{"label":"Filling","meta":{"charge_code":"PROC-DENTAL-FILLING"}}]')`, [H1])
    await as(db, NURSE)
    await refused(db.query('select service_remove($1)', [a.id]), /administrator or a finance manager/)
    await as(db, OWNER)
    assert.equal((await one(db, 'select service_remove($1) as r', [a.id])).r, 'deleted')
    assert.equal((await one(db, "select service_remove($1, 'Price list review 2027') as r", [b.id])).r, 'retired')
    const kept = await one(db, 'select is_active, retired_reason, retired_at from charge_codes where id = $1', [b.id])
    assert.equal(kept.is_active, false); assert.equal(kept.retired_reason, 'Price list review 2027'); assert.ok(kept.retired_at)
    await db.query('update charge_codes set is_active = true where id = $1', [b.id]) // restore
    assert.equal((await one(db, 'select retired_reason from charge_codes where id = $1', [b.id])).retired_reason, null)
    await as(db)
  })

  it('a department manager publishes protocols; new content is a new revision and staff confirm reading each one', async () => {
    await as(db, NURSE)
    await refused(db.query(`insert into department_documents(hospital_id, department, title) values ($1, 'Dental', 'Infection control')`, [H1]), /row-level/)
    await as(db, INCH) // in-charge of Dental runs it
    const d = await one(db, `insert into department_documents(hospital_id, department, title, kind) values ($1, 'dental', 'Instrument sterilisation SOP', 'sop') returning *`, [H1])
    assert.equal(d.department, 'Dental'); assert.equal(d.revision, 1)
    await db.query("insert into storage.objects(bucket_id, name) values ('department-documents', $1)", [`${H1}/${d.id}/sop.pdf`])
    await db.query(`update department_documents set file_path = $2, file_name = 'sop.pdf' where id = $1`, [d.id, `${H1}/${d.id}/sop.pdf`])
    assert.equal((await one(db, 'select revision from department_documents where id = $1', [d.id])).revision, 1) // first file = creating it
    await refused(db.query(`insert into department_documents(hospital_id, department, title) values ($1, 'General Medicine', 'Not mine')`, [H1]), /row-level/)
    await refused(db.query("insert into storage.objects(bucket_id, name) values ('department-documents', $1)", [`${H1}/${crypto.randomUUID()}/x.pdf`]), /row-level/)

    await as(db, NURSE)
    await db.query('insert into department_document_reads(document_id, hospital_id, revision) values ($1, $2, 99)', [d.id, H1])
    const r = await one(db, 'select revision, user_id, staff_id from department_document_reads where document_id = $1', [d.id])
    assert.equal(r.revision, 1); assert.equal(r.user_id, NURSE); assert.ok(r.staff_id)
    await refused(db.query('insert into department_document_reads(document_id, hospital_id) values ($1, $2)', [d.id, H1]), /duplicate|unique/)
    assert.equal((await db.query("select * from storage.objects where bucket_id = 'department-documents'")).rows.length, 1) // staff can read the file
    await refused(db.query("delete from storage.objects where bucket_id = 'department-documents' returning id").then((x) => { if (!x.rows.length) throw new Error('row-level: nothing deleted') })) // staff cannot remove it

    await as(db, INCH)
    await db.query(`update department_documents set body = 'Autoclave 134 C for 3 minutes.', change_note = 'Added cycle' where id = $1`, [d.id])
    const d2 = await one(db, 'select revision from department_documents where id = $1', [d.id])
    assert.equal(d2.revision, 2)
    const h = await one(db, 'select revision, file_name from department_document_history where document_id = $1', [d.id])
    assert.equal(h.revision, 1); assert.equal(h.file_name, 'sop.pdf')
    await db.query(`update department_documents set must_read = false where id = $1`, [d.id]) // settings only: same revision
    assert.equal((await one(db, 'select revision from department_documents where id = $1', [d.id])).revision, 2)
    await refused(db.query(`update department_documents set department = 'Surgery' where id = $1`, [d.id]), /stays in its department/)

    await as(db, NURSE) // must read again: revision 2
    await db.query('insert into department_document_reads(document_id, hospital_id) values ($1, $2)', [d.id, H1])
    assert.deepEqual((await db.query('select revision from department_document_reads where document_id = $1 order by revision', [d.id])).rows.map((x) => x.revision), [1, 2])
    await as(db, REC_B)
    assert.equal((await db.query('select * from department_documents')).rows.length, 0)
    await as(db)
  })
})
