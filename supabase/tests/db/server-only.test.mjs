// Server-only functions under Supabase's real default privileges (20261130000000_server_only_functions.sql).
// Supabase grants EXECUTE on every new function to authenticated; PGlite does not, which is why the other tests
// missed that some service-only functions were callable by any signed-in user. This test reproduces Supabase.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const SQL = (f) => read(`../../../docs/sql/${f}`)

const SERVER_ONLY = [
  'pay_user_context(uuid, uuid)', 'pay_access_level(uuid, uuid)', 'create_online_payment(uuid, uuid, text, text, numeric, text, text, text, text, boolean)',
  'create_gateway_refund(uuid, uuid, numeric, text)', 'fhir_client_by_key(text)', 'secret_store(uuid, text, text)', 'hospital_secret_get(uuid, text)',
  'referral_share_resolve(text)', 'portal_patients(text)', 'portal_request_code(text)', 'portal_verify(text, text)', 'portal_session_phone(text)',
  'portal_logout(text)', 'net_facilities(uuid)',
]
const BROWSER = [
  'pay_is_member(uuid)', 'record_manual_payments(uuid, jsonb, text)', 'fhir_client_create(uuid, text, text[], integer, boolean)',
  'hospital_secret_set(uuid, text, text)', 'admin_pin_check(uuid, text)', 'referral_share_create(text, integer)', 'portal_staff_code(uuid)',
  'network_patient_search(uuid, text)', 'network_patient_history(uuid, uuid)', 'clin_can_access(uuid)',
]

describe('server-only functions with Supabase default privileges', () => {
  let db
  before(async () => {
    db = new PGlite()
    // Supabase: functions created by postgres are executable by anon and authenticated unless revoked
    await db.exec(read('./stub.sql'))
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$
        begin return p::uuid; exception when others then return null; end $$;
      alter table hospitals add column system_settings jsonb; alter table patients add column phone text;
      create table referrals (id uuid primary key, hospital_id text, visit_id uuid);`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../migrations/20261122000000_audit_privacy.sql'))
    for (const f of ['13_lockdown_public.sql', '15_fhir_api.sql', '16_secrets_and_referral_links.sql', '17_patient_portal_and_networks.sql']) await db.exec(SQL(f))
  })

  it('before the fix, signed-in users could call service-only functions (the live problem)', async () => {
    const r = await db.query("select has_function_privilege('authenticated', 'public.portal_request_code(text)', 'execute') as ok")
    assert.equal(r.rows[0].ok, true)
  })

  it('after the fix, only the server can call them, and the browser functions still work', async () => {
    await db.exec(SQL('18_server_only_functions.sql'))
    await db.exec(SQL('18_server_only_functions.sql'))
    for (const f of SERVER_ONLY) {
      const { rows: [r] } = await db.query(`select has_function_privilege('authenticated', 'public.${f}', 'execute') as auth,
        has_function_privilege('anon', 'public.${f}', 'execute') as anon, has_function_privilege('service_role', 'public.${f}', 'execute') as svc`)
      assert.deepEqual(r, { auth: false, anon: false, svc: true }, f)
    }
    for (const f of BROWSER) {
      const { rows: [r] } = await db.query(`select has_function_privilege('authenticated', 'public.${f}', 'execute') as ok`)
      assert.equal(r.ok, true, f)
    }
  })
})
