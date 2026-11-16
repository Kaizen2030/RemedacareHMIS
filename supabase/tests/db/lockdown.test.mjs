// Public-key lockdown: supabase/migrations/20261123000000_lockdown_public.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const MIG = read('../../migrations/20261123000000_lockdown_public.sql')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', OTHER = '00000000-0000-0000-0000-0000000000b1'

const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false); set role ${user ? 'authenticated' : 'anon'};`)
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('public key lockdown', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(PAYMENTS)
    // Reproduce the live shape: Supabase-style blanket grants and allow-all policies
    await db.exec(`
      create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$
        begin return p::uuid; exception when others then return null; end $$;
      create table ppb_dispensing_flags (id bigserial primary key, hospital_id text, drug_name text);
      alter table ppb_dispensing_flags enable row level security;
      create policy ppb_dispensing_flags_select_authenticate on ppb_dispensing_flags for select to authenticated using (true);
      create policy ppb_dispensing_flags_insert_authenticate on ppb_dispensing_flags for insert to authenticated with check (true);
      create table purchase_orders (id uuid primary key default gen_random_uuid(), hospital_id uuid);
      create table purchase_order_items (id bigserial primary key, purchase_order_id uuid references purchase_orders(id), item_name text);
      alter table purchase_order_items enable row level security;
      create policy anything on purchase_order_items for all using (true) with check (true);
      insert into ppb_dispensing_flags(hospital_id, drug_name) values ('${H1}', 'Tramadol'), ('22222222-2222-2222-2222-222222222222', 'Other');
      insert into purchase_orders(id, hospital_id) values ('aaaaaaaa-0000-0000-0000-000000000001', '${H1}'), ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222');
      insert into purchase_order_items(purchase_order_id, item_name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Mine'), ('aaaaaaaa-0000-0000-0000-000000000002', 'Theirs');
      grant all on all tables in schema public to anon, authenticated;
      grant all on all sequences in schema public to anon, authenticated;
      create function get_user_id_by_email(p text) returns uuid language sql security definer set search_path = public as $$ select null::uuid $$;
      grant execute on function get_user_id_by_email(text) to anon, authenticated;
      grant execute on function pay_is_member(uuid) to anon, authenticated;`)
    await db.exec(MIG)
    await db.exec(read('../../../docs/sql/13_lockdown_public.sql')) // the paste-ready file, run a second time
  })

  it('anon has no table, sequence or definer-function access left', async () => {
    const t = (await db.query(`select count(*)::int as n from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`)).rows[0]
    assert.equal(t.n, 0)
    const f = (await db.query(`select count(*)::int as n from pg_proc f join pg_namespace n on n.oid = f.pronamespace
      where n.nspname = 'public' and f.prosecdef and has_function_privilege('anon', f.oid, 'execute')`)).rows[0]
    assert.equal(f.n, 0)
    await as(db, null)
    await refused(db.query('select * from patients'), /permission denied/)
    await refused(db.query("insert into invoices(hospital_id) values ($1)", [H1]), /permission denied/)
    await refused(db.query('select pay_is_member($1)', [H1]), /permission denied/)
  })

  it('logged-in users keep their function access but lose truncate and the e-mail lookup', async () => {
    await as(db, NURSE)
    assert.equal((await db.query('select pay_is_member($1) as ok', [H1])).rows[0].ok, true)
    await refused(db.query('select get_user_id_by_email($1)', ['x@y.ke']), /permission denied/)
    await refused(db.query('truncate invoices'), /permission denied/)
  })

  it('the security check runs and finds no public access, truncate or open definer functions', async () => {
    await db.exec(`reset role; create schema if not exists storage; create table if not exists storage.buckets (name text, public boolean);
      create view leaky as select * from patients; grant select on leaky to authenticated;`)
    await db.exec(MIG)
    const fixed = (await db.query("select 'security_invoker=true' = any(reloptions) as ok from pg_class where relname = 'leaky'")).rows[0]
    assert.equal(fixed.ok, true, 'views are switched to security_invoker')
    await db.exec('drop view leaky; create view leaky as select * from patients; grant select on leaky to authenticated;')
    const rows = (await db.query(read('../../../docs/sql/12_security_check.sql'))).rows
    const areas = rows.map((r) => r.area)
    for (const bad of ['Public (anon) has access', 'Logged-in users can TRUNCATE', 'Definer function open to the public']) assert.ok(!areas.includes(bad), bad + ': ' + JSON.stringify(rows.filter((r) => r.area === bad)))
    assert.ok(rows.some((r) => r.area === 'View skips row-level security' && r.object === 'leaky'))
    await db.exec('drop view leaky')
  })

  it('PPB flags and purchase-order lines are limited to the user\'s hospital', async () => {
    await as(db, NURSE)
    assert.deepEqual((await db.query('select drug_name from ppb_dispensing_flags')).rows.map((r) => r.drug_name), ['Tramadol'])
    assert.deepEqual((await db.query('select item_name from purchase_order_items')).rows.map((r) => r.item_name), ['Mine'])
    await db.query("insert into ppb_dispensing_flags(hospital_id, drug_name) values ($1, 'Codeine')", [H1])
    await refused(db.query("insert into ppb_dispensing_flags(hospital_id, drug_name) values ('22222222-2222-2222-2222-222222222222', 'x')"), /row-level/)
    await refused(db.query("insert into purchase_order_items(purchase_order_id, item_name) values ('aaaaaaaa-0000-0000-0000-000000000002', 'x')"), /row-level/)
    await as(db, OTHER)
    assert.deepEqual((await db.query('select drug_name from ppb_dispensing_flags')).rows.map((r) => r.drug_name), ['Other'])
  })
})
