// Clinical content control (docs/sql/46): pathways, delete with tombstone, start fresh setting, hospital library.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', CONS = '00000000-0000-0000-0000-0000000000e1'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}
const STORAGE = `
  create schema if not exists storage;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated; grant select, insert, delete on storage.objects to authenticated;`

describe('clinical library, pathways and start fresh', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(STORAGE)
    await db.exec(`insert into auth.users values ('${CONS}', 'cons@a.ke'); insert into hospital_users(user_id, hospital_id, role) values ('${CONS}', '${H1}', 'Consultant Physician');
      insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', 'cons@a.ke', 'Dr Kamau', 'Consultant Physician', 'Active');`)
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    for (const f of ['41_clinical_guides', '42_clinical_content_revisions', '43_clinical_content_documents', '46_clinical_library', '46_clinical_library']) {
      const rows = (await db.exec(read(`../../../docs/sql/${f}.sql`))).at(-1).rows
      assert.ok(rows.every((r) => r.result === 'OK'), `${f}: ${JSON.stringify(rows)}`)
    }
  })

  it('pathways and the start-fresh setting save like guides; only approvers write', async () => {
    const save = (type, id, content) => db.query(`insert into clinical_content_revisions(hospital_id, content_type, content_id, content) values ($1, $2, $3, $4)
      on conflict (hospital_id, content_type, content_id) do update set content = excluded.content returning revision`, [H1, type, id, JSON.stringify(content)])
    await as(db, NURSE)
    await refused(save('pathway', 'sepsis-adult', { hidden: true }), /Only an authorised|row-level/)
    await as(db, CONS)
    assert.equal((await save('pathway', 'sepsis-adult', { hidden: true })).rows[0].revision, 1)
    assert.equal((await save('setting', 'pathway', { builtin_default: 'hidden' })).rows[0].revision, 1)
    await refused(save('other', 'x', {}), /check constraint/)
  })

  it('deleting a hospital-written item keeps a tombstone with the old wording; nurses cannot delete', async () => {
    await as(db, CONS)
    await db.query(`insert into clinical_content_revisions(hospital_id, content_type, content_id, content) values ($1, 'guide', 'local-1', '{"title":"Our snakebite guide"}')`, [H1])
    await as(db, NURSE)
    await db.query("delete from clinical_content_revisions where content_id = 'local-1'")
    await as(db, CONS)
    assert.equal((await db.query("select * from clinical_content_revisions where content_id = 'local-1'")).rows.length, 1, 'RLS hides the row from a nurse delete')
    await db.query("delete from clinical_content_revisions where content_id = 'local-1'")
    assert.equal((await db.query("select * from clinical_content_revisions where content_id = 'local-1'")).rows.length, 0)
    const h = (await db.query("select revision, content from clinical_content_revision_history where content_id = 'local-1' order by revision")).rows
    assert.equal(h.length, 2)
    assert.equal(h[1].content.deleted, true)
    assert.equal(h[1].content.previous.title, 'Our snakebite guide')
  })

  it('library: files up to 50 MB, links (http/https only), approvers edit the description but never the file', async () => {
    await as(db, CONS)
    const file = (size) => db.query(`insert into clinical_content_documents(hospital_id, guide_id, object_path, file_name, content_type, file_size, title, category, tags)
      values ($1, '_library', $2, 'book.pdf', 'application/pdf', $3, 'Formulary', 'Formulary', '{drugs}') returning id`, [H1, `${H1}/_library/${size}-book.pdf`, size])
    const f = (await file(40 * 1024 * 1024)).rows[0]
    await refused(file(60 * 1024 * 1024), /check constraint/)
    const link = (url) => db.query(`insert into clinical_content_documents(hospital_id, guide_id, kind, link_url, file_name, title) values ($1, '_library', 'link', $2, 'MOH guidelines', 'Kenya HIV guidelines') returning id`, [H1, url])
    await link('https://www.nascop.or.ke/guidelines')
    await refused(link('javascript:alert(1)'), /check constraint/)
    await refused(db.query(`insert into clinical_content_documents(hospital_id, guide_id, kind, file_name) values ($1, '_library', 'link', 'x')`, [H1]), /check constraint/)
    await db.query("update clinical_content_documents set title = 'Hospital formulary 2026', tags = '{drugs,formulary}' where id = $1", [f.id])
    await refused(db.query('update clinical_content_documents set file_size = 5 where id = $1', [f.id]), /permission|Only the title/)
    await as(db, NURSE)
    await db.query("update clinical_content_documents set title = 'nurse' where id = $1", [f.id])
    await as(db, CONS)
    assert.equal((await db.query('select title from clinical_content_documents where id = $1', [f.id])).rows[0].title, 'Hospital formulary 2026')
    await as(db, null)
    assert.equal((await db.query("select file_size_limit from storage.buckets where id = 'clinical-content-files'")).rows[0].file_size_limit, 52428800)
  })
})
