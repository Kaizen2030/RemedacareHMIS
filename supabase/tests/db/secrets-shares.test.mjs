// Server-only hospital secrets + admin PIN (20261126000000_hospital_secrets.sql) and referral share links
// (20261127000000_referral_shares.sql).
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const CLIN = read('../../migrations/20261119000000_hiv_tb_maternity.sql')
const AUDIT = read('../../migrations/20261122000000_audit_privacy.sql')
const H1 = '11111111-1111-1111-1111-111111111111', H2 = '22222222-2222-2222-2222-222222222222'
const OWNER = '00000000-0000-0000-0000-0000000000a4', NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const OTHER = '00000000-0000-0000-0000-0000000000b1'

const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const service = (db) => db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;")
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

async function boot({ vault = false } = {}) {
  const db = new PGlite()
  await db.exec(read('./stub.sql'))
  await db.exec(PAYMENTS)
  await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$
      begin return p::uuid; exception when others then return null; end $$;
    grant select, insert on audit_log to authenticated; grant usage on sequence audit_log_id_seq to authenticated;
    alter table hospitals add column system_settings jsonb, add column sha_fhir_client_secret text;
    grant update on hospitals to authenticated;
    create policy hospitals_member_update on hospitals for update using (pay_is_member(id));
    -- the live shape before this fix: credentials and the PIN readable by every member
    update hospitals set system_settings = '{"admin_pin":"1234","integrations_config":{"etims_pin":"P051","etims_secret":"S3CRET","mpesa_passkey":"PASS"}}',
      sha_fhir_client_secret = 'SHA-SECRET' where id = '${H1}';
    create table referrals (id uuid primary key default gen_random_uuid(), hospital_id text, visit_id uuid, patient_name text);
    insert into referrals(id, hospital_id, visit_id) values ('aaaaaaaa-0000-0000-0000-00000000000a', '${H1}', 'bbbbbbbb-0000-0000-0000-00000000000b'),
      ('aaaaaaaa-0000-0000-0000-00000000000c', '${H1}', null);`)
  if (vault) {
    await db.exec(`create schema vault;
      create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
      create function vault.create_secret(s text, n text, d text) returns uuid language sql as $$ insert into vault.secrets(name, secret, description) values (n, 'enc:' || s, d) returning id $$;
      create function vault.update_secret(i uuid, s text) returns void language sql as $$ update vault.secrets set secret = 'enc:' || s where id = i $$;
      create view vault.decrypted_secrets as select id, name, substr(secret, 5) as decrypted_secret from vault.secrets;`)
  }
  await db.exec(CLIN)
  await db.exec(AUDIT)
  await db.exec(read('../../../docs/sql/16_secrets_and_referral_links.sql'))
  await db.exec(read('../../../docs/sql/16_secrets_and_referral_links.sql')) // safe to run again
  return db
}

for (const vault of [false, true]) {
  describe(`hospital secrets (${vault ? 'Supabase Vault' : 'server-only table'})`, () => {
    let db
    before(async () => { db = await boot({ vault }) })

    it('moves existing credentials and the PIN out of the settings every member can read', async () => {
      await as(db, NURSE)
      const h = await one(db, 'select system_settings, sha_fhir_client_secret from hospitals where id = $1', [H1])
      assert.doesNotMatch(JSON.stringify(h), /S3CRET|PASS|1234|SHA-SECRET/)
      assert.equal(h.system_settings.integrations_config.etims_pin, 'P051', 'non-secret settings stay')
      assert.deepEqual(h.system_settings.integrations_secrets_saved.sort(), ['etims_secret', 'mpesa_passkey'])
      assert.equal(h.system_settings.admin_pin_set, true)
      await refused(db.query('select * from hospital_secrets'), /permission denied/)
      await refused(db.query('select hospital_secret_get($1, $2)', [H1, 'etims_secret']), /permission denied/)
      await service(db)
      assert.equal((await one(db, 'select hospital_secret_get($1, $2) as v', [H1, 'etims_secret'])).v, 'S3CRET')
      assert.equal((await one(db, 'select hospital_secret_get($1, $2) as v', [H1, 'sha_fhir_client_secret'])).v, 'SHA-SECRET')
      if (vault) assert.equal((await one(db, "select count(*)::int as n from hospital_secrets where value is not null")).n, 0, 'values live only in Vault')
    })

    it('a later save that puts a secret back into settings is moved again', async () => {
      await as(db, NURSE)
      await db.query(`update hospitals set system_settings = system_settings || '{"admin_pin":"9999","integrations_config":{"sms_api_key":"SMSKEY"}}' where id = $1`, [H1])
      assert.doesNotMatch(JSON.stringify((await one(db, 'select system_settings from hospitals where id = $1', [H1])).system_settings), /SMSKEY|9999/)
      await service(db)
      assert.equal((await one(db, 'select hospital_secret_get($1, $2) as v', [H1, 'sms_api_key'])).v, 'SMSKEY')
      await as(db, OWNER)
      await db.query("select admin_pin_set($1, '1234')", [H1])
    })

    it('only admins set or list credentials, and never see the values', async () => {
      await as(db, NURSE)
      await refused(db.query("select hospital_secret_set($1, 'sha_api_key', 'x')", [H1]), /administrators/)
      assert.equal((await db.query('select * from hospital_secret_status($1)', [H1])).rows.length, 0)
      await as(db, OWNER)
      await db.query("select hospital_secret_set($1, 'sha_api_key', 'NEWKEY')", [H1])
      await refused(db.query("select hospital_secret_set($1, 'admin_pin_hash', 'x')", [H1]), /Invalid/)
      const names = (await db.query('select name, encrypted from hospital_secret_status($1)', [H1])).rows
      assert.ok(names.some((r) => r.name === 'sha_api_key'))
      assert.equal(names.every((r) => r.encrypted === vault), true)
      assert.doesNotMatch(JSON.stringify(names), /NEWKEY/)
      await db.query("select hospital_secret_set($1, 'sha_api_key', '')", [H1])
      await service(db)
      assert.equal((await one(db, 'select hospital_secret_get($1, $2) as v', [H1, 'sha_api_key'])).v, null, 'cleared')
      await db.exec('reset role')
      const audit = (await db.query("select details from audit_log where action like '%hospital_secrets'")).rows
      assert.ok(audit.length >= 2)
      assert.doesNotMatch(JSON.stringify(audit), /NEWKEY/)
    })

    it('checks the admin PIN in the database and locks after 5 wrong tries', async () => {
      await as(db, OTHER)
      assert.equal((await one(db, "select admin_pin_check($1, '1234') as r", [H1])).r, 'not_member')
      await as(db, REC)
      assert.equal((await one(db, "select admin_pin_check($1, '1234') as r", [H1])).r, 'ok')
      for (let i = 0; i < 5; i++) assert.equal((await one(db, "select admin_pin_check($1, '0000') as r", [H1])).r, 'wrong')
      assert.equal((await one(db, "select admin_pin_check($1, '1234') as r", [H1])).r, 'locked')
      await refused(db.query("select admin_pin_set($1, '1111')", [H1]), /administrators/)
      await as(db, OWNER)
      await refused(db.query("select admin_pin_set($1, '12ab')", [H1]), /4 to 6 digits/)
      assert.equal((await one(db, "select admin_pin_check($1, '1234') as r", [H2])).r, 'not_member')
    })
  })
}

describe('referral share links', () => {
  let db, token
  before(async () => { db = await boot() })

  it('clinical staff create a link for a referral with a visit; others cannot', async () => {
    await as(db, REC)
    await refused(db.query("select referral_share_create('aaaaaaaa-0000-0000-0000-00000000000a')"), /clinical staff/)
    await as(db, NURSE)
    await refused(db.query("select referral_share_create('aaaaaaaa-0000-0000-0000-00000000000c')"), /visit/)
    await refused(db.query("select referral_share_create('aaaaaaaa-0000-0000-0000-0000000000ff')"), /not found/)
    const r = (await one(db, "select referral_share_create('aaaaaaaa-0000-0000-0000-00000000000a', 500) as r")).r
    token = r.token
    assert.match(token, /^rcs_[0-9a-f]{64}$/)
    const days = (new Date(r.expires_at) - Date.now()) / 86400000
    assert.ok(days > 89 && days <= 90, 'capped at 90 days')
    await refused(db.query('select token_hash from referral_shares'), /permission denied/)
  })

  it('the server resolves a valid token to that one visit and counts it; revoked or expired links stop working', async () => {
    await as(db, NURSE)
    await refused(db.query('select * from referral_share_resolve($1)', [token]), /permission denied/)
    await service(db)
    const s = await one(db, 'select * from referral_share_resolve($1)', [token])
    assert.equal(s.visit_id, 'bbbbbbbb-0000-0000-0000-00000000000b')
    assert.equal(s.hospital_id, H1)
    assert.equal((await db.query('select * from referral_share_resolve($1)', ['rcs_nope'])).rows.length, 0)
    assert.equal((await one(db, 'select use_count from referral_shares')).use_count, 1)
    await as(db, NURSE)
    await db.query('update referral_shares set revoked_at = now()')
    await service(db)
    assert.equal((await db.query('select * from referral_share_resolve($1)', [token])).rows.length, 0)
  })
})
