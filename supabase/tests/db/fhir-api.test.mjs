// FHIR API keys and call log: supabase/migrations/20261125000000_fhir_api.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const AUDIT = read('../../migrations/20261122000000_audit_privacy.sql')
const MIG = read('../../migrations/20261125000000_fhir_api.sql')
const H1 = '11111111-1111-1111-1111-111111111111'
const OWNER = '00000000-0000-0000-0000-0000000000a4', NURSE = '00000000-0000-0000-0000-0000000000c1', OTHER = '00000000-0000-0000-0000-0000000000b1'
const JANE = '99999999-0000-0000-0000-000000000001'

const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const service = (db) => db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;")
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('FHIR API keys', () => {
  let db, key, clientId
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(PAYMENTS)
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$
        begin return p::uuid; exception when others then return null; end $$;
      grant select, insert on audit_log to authenticated; grant usage on sequence audit_log_id_seq to authenticated;
      -- the live table predates this migration with fewer columns
      create table fhir_audit_log (id bigserial primary key, hospital_id text, resource_type text, resource_id text, action text, caller_ip text, status text, details jsonb);
      alter table fhir_audit_log enable row level security;
      create policy anyone on fhir_audit_log for all using (true) with check (true);
      grant all on fhir_audit_log to anon, authenticated;`)
    await db.exec(AUDIT)
    await db.exec(MIG)
    await db.exec(read('../../../docs/sql/15_fhir_api.sql')) // the paste-ready file, run a second time
  })

  it('only admins create keys; the key is shown once and only its hash is stored', async () => {
    await as(db, NURSE)
    await refused(db.query("select fhir_client_create($1, 'KHIS', array['Patient'])", [H1]), /administrators/)
    await as(db, OWNER)
    await refused(db.query("select fhir_client_create($1, 'KHIS', array['Secrets'])", [H1]), /valid resource/)
    const r = (await one(db, "select fhir_client_create($1, 'Partner EMR', array['Patient','Observation'], 30) as r", [H1])).r
    key = r.key; clientId = r.id
    assert.match(key, /^rcf_[0-9a-f]{64}$/)
    const row = await one(db, 'select key_prefix, key_hash, expires_at from fhir_clients where id = $1', [clientId])
    assert.equal(row.key_prefix, key.slice(0, 12))
    assert.notEqual(row.key_hash, key)
    assert.ok(row.expires_at)
    await as(db, OTHER)
    assert.equal((await db.query('select * from fhir_clients')).rows.length, 0, 'other hospitals see nothing')
    await as(db, NURSE)
    assert.equal((await db.query('select * from fhir_clients')).rows.length, 0, 'non-admins see nothing')
  })

  it('the server resolves a key to its client; wrong, revoked or expired keys get nothing; browsers cannot call it', async () => {
    await as(db, OWNER)
    await refused(db.query('select * from fhir_client_by_key($1)', [key]), /permission denied/)
    await service(db)
    const c = await one(db, 'select * from fhir_client_by_key($1)', [key])
    assert.equal(c.id, clientId)
    assert.deepEqual(c.scopes, ['Patient', 'Observation'])
    assert.equal((await db.query('select * from fhir_client_by_key($1)', [key + 'x'])).rows.length, 0)
    assert.ok((await one(db, 'select last_used_at from fhir_clients where id = $1', [clientId])).last_used_at)
    await as(db, OWNER)
    await db.query('update fhir_clients set active = false, revoked_at = now() where id = $1', [clientId])
    await refused(db.query("update fhir_clients set scopes = array['Patient'] where id = $1", [clientId]), /permission denied/)
    await service(db)
    assert.equal((await db.query('select * from fhir_client_by_key($1)', [key])).rows.length, 0, 'revoked')
    await db.exec(`update fhir_clients set active = true, revoked_at = null, expires_at = now() - interval '1 day' where id = '${clientId}'`)
    assert.equal((await db.query('select * from fhir_client_by_key($1)', [key])).rows.length, 0, 'expired')
  })

  it('API calls are logged for admins only, and API reads appear in the patient access log', async () => {
    await service(db)
    await db.query("insert into fhir_audit_log(hospital_id, resource_type, action, status, client_id, client_name, result_count) values ($1, 'Patient', 'search', 'ok', $2, 'Partner EMR', 1)", [H1, clientId])
    await db.query("insert into patient_access_log(hospital_id, patient_id, api_client_id, api_client_name, action, context) values ($1, $2, $3, 'Partner EMR', 'export', 'FHIR API')", [H1, JANE, clientId])
    await refused(db.query("insert into patient_access_log(hospital_id, patient_id, action) values ($1, $2, 'export')", [H1, JANE]), /patient_access_log_who/)
    await as(db, NURSE)
    assert.equal((await db.query('select * from fhir_audit_log')).rows.length, 0)
    await refused(db.query("insert into fhir_audit_log(hospital_id, action) values ($1, 'x')", [H1]), /permission denied/)
    await as(db, OWNER)
    assert.equal((await one(db, 'select client_name from fhir_audit_log')).client_name, 'Partner EMR')
    assert.equal((await one(db, 'select api_client_name from patient_access_log where api_client_id is not null')).api_client_name, 'Partner EMR')
  })
})
