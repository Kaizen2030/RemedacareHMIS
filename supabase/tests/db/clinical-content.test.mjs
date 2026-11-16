// Clinical content revisions (docs/sql/42) and guide documents (docs/sql/43).
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111', H2 = '22222222-2222-2222-2222-222222222222'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1', CONS = '00000000-0000-0000-0000-0000000000e1'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}
// The parts of Supabase Storage the migration touches.
const STORAGE = `
  create schema if not exists storage;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated; grant select, insert, delete on storage.objects to authenticated;`

describe('clinical content revisions and documents', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(STORAGE)
    await db.exec(`insert into auth.users values ('${CONS}', 'cons@a.ke'); insert into hospital_users(user_id, hospital_id, role) values ('${CONS}', '${H1}', 'Consultant Physician');
      insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', 'cons@a.ke', 'Dr Kamau', 'Consultant Physician', 'Active');`)
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/41_clinical_guides.sql'))
    for (const f of ['42_clinical_content_revisions', '43_clinical_content_documents']) {
      await db.exec(read(`../../../docs/sql/${f}.sql`))
      const rows = (await db.exec(read(`../../../docs/sql/${f}.sql`))).at(-1).rows
      assert.ok(rows.every((r) => r.result === 'OK'), `${f}: ${JSON.stringify(rows)}`)
    }
  })

  it('only approvers edit; every save is a new revision and the history keeps each wording', async () => {
    const save = (content) => db.query(`insert into clinical_content_revisions(hospital_id, content_type, content_id, content) values ($1, 'guide', 'sepsis', $2)
      on conflict (hospital_id, content_type, content_id) do update set content = excluded.content returning revision`, [H1, JSON.stringify(content)])
    await as(db, NURSE)
    await refused(save({ title: 'Nurse edit' }), /Only an authorised|row-level/)
    await as(db, CONS)
    assert.equal((await save({ title: 'Sepsis (local v1)', version: '2026-11' })).rows[0].revision, 1)
    assert.equal((await save({ title: 'Sepsis (local v2)', version: '2026-11' })).rows[0].revision, 2)
    const h = (await db.query("select revision, content->>'title' t from clinical_content_revision_history where content_id = 'sepsis' order by revision")).rows
    assert.deepEqual(h, [{ revision: 1, t: 'Sepsis (local v1)' }, { revision: 2, t: 'Sepsis (local v2)' }])
    await refused(db.query("update clinical_content_revision_history set content = '{}' where content_id = 'sepsis'"), /permission/)
    await as(db, REC)
    assert.equal((await db.query('select * from clinical_content_revision_history')).rows.length, 2, 'every member can read the history')
  })

  it('documents: private bucket, path must sit under the hospital and guide, approvers can add and remove', async () => {
    await as(db, null)
    assert.equal((await one(db, "select public from storage.buckets where id = 'clinical-content-files'")).public, false)
    const ins = (path, hospital = H1) => db.query(`insert into clinical_content_documents(hospital_id, guide_id, object_path, file_name, content_type, file_size)
      values ($1, 'sepsis', $2, 'protocol.pdf', 'application/pdf', 1000) returning id`, [hospital, path])
    await as(db, NURSE)
    await refused(ins(`${H1}/sepsis/a-protocol.pdf`), /Only an authorised|row-level/)
    await as(db, CONS)
    await refused(ins(`${H2}/sepsis/x.pdf`), /check constraint|row-level|Only an authorised/)
    await refused(ins(`${H1}/other-guide/x.pdf`), /check constraint/)
    const d = (await ins(`${H1}/sepsis/a-protocol.pdf`)).rows[0]
    await refused(db.query("insert into storage.objects(bucket_id, name) values ('clinical-content-files', $1)", [`${H2}/sepsis/x.pdf`]), /row-level/)
    await db.query("insert into storage.objects(bucket_id, name) values ('clinical-content-files', $1)", [`${H1}/sepsis/a-protocol.pdf`])
    await as(db, NURSE)
    await db.query('delete from clinical_content_documents where id = $1', [d.id])
    await as(db, null)
    assert.equal((await db.query('select * from clinical_content_documents')).rows.length, 1, 'a nurse cannot remove a file (RLS hides it from delete)')
    await as(db, CONS)
    await db.query('delete from clinical_content_documents where id = $1', [d.id])
    await as(db, REC)
    assert.equal((await db.query('select * from clinical_content_documents')).rows.length, 0)
  })
})
