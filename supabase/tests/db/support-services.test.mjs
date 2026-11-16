// Support departments service desk: supabase/migrations/20261201000000_support_services.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const OWNER = '00000000-0000-0000-0000-0000000000a4', NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const OTHER = '00000000-0000-0000-0000-0000000000b1', JANE = '99999999-0000-0000-0000-000000000001'
const BED = 'bbbbbbbb-0000-0000-0000-000000000001', BED_ISO = 'bbbbbbbb-0000-0000-0000-000000000002'

const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

async function boot() {
  const db = new PGlite()
  await db.exec(read('./stub.sql'))
  await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;') // like Supabase
  await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
  await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$
      begin return p::uuid; exception when others then return null; end $$;
    grant select, insert on audit_log to authenticated; grant usage on sequence audit_log_id_seq to authenticated;
    create table beds (id uuid primary key, hospital_id uuid, ward_id uuid, bed_number text, status text, patient_id uuid, notes text);
    insert into beds values ('${BED}', '${H1}', null, 'M-01', 'Occupied', '${JANE}', null), ('${BED_ISO}', '${H1}', null, 'ISO-1', 'Occupied', '${JANE}', 'Isolation: suspected TB');
    grant select, update on beds to authenticated;
    create table visits(id uuid primary key default gen_random_uuid(), hospital_id uuid, created_at timestamptz default now());
    insert into visits(hospital_id) values ('${H1}');`)
  await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
  await db.exec(read('../../migrations/20261122000000_audit_privacy.sql'))
  await db.exec(read('../../../docs/sql/18_server_only_functions.sql'))
  await db.exec(read('../../../docs/sql/19_support_services.sql'))
  await db.exec(read('../../../docs/sql/19_support_services.sql')) // safe to run again
  return db
}

describe('support services', () => {
  let db
  before(async () => { db = await boot() })

  it('a discharge creates a housekeeping clean (terminal for isolation) and, when enabled, holds the bed', async () => {
    await as(db, NURSE)
    await db.query("update beds set status = 'Free', patient_id = null where id = $1", [BED])
    const clean = await one(db, 'select kind, title, priority, status, jsonb_array_length(checklist) as items, due_at > now() as due from service_requests where bed_id = $1', [BED])
    assert.deepEqual(clean, { kind: 'discharge_clean', title: 'Discharge clean — Bed M-01', priority: 'urgent', status: 'open', items: 5, due: true })
    assert.equal((await one(db, 'select status from beds where id = $1', [BED])).status, 'Free', 'not held unless switched on')
    await as(db, OWNER)
    await db.query('insert into service_settings(hospital_id, hold_beds_for_cleaning) values ($1, true)', [H1])
    await as(db, NURSE)
    await db.query("update beds set status = 'Free', patient_id = null where id = $1", [BED_ISO])
    assert.equal((await one(db, 'select kind from service_requests where bed_id = $1', [BED_ISO])).kind, 'terminal_clean')
    assert.equal((await one(db, 'select status from beds where id = $1', [BED_ISO])).status, 'Cleaning')
  })

  it('checklist must be ticked before done; done releases the held bed; a different person verifies', async () => {
    await as(db, REC)
    const r = await one(db, 'select id, checklist from service_requests where bed_id = $1', [BED_ISO])
    await db.query("update service_requests set assigned_to = 'Mary (cleaner)' where id = $1", [r.id])
    assert.equal((await one(db, 'select status from service_requests where id = $1', [r.id])).status, 'assigned')
    await refused(db.query("update service_requests set status = 'done' where id = $1", [r.id]), /required checklist/)
    const ticked = r.checklist.map((i) => ({ ...i, done: true }))
    await db.query("update service_requests set checklist = $2, status = 'done' where id = $1", [r.id, JSON.stringify(ticked)])
    assert.equal((await one(db, 'select status from beds where id = $1', [BED_ISO])).status, 'Free')
    await refused(db.query("update service_requests set status = 'verified' where id = $1", [r.id]), /Someone other/)
    await as(db, NURSE)
    await db.query("update service_requests set status = 'verified' where id = $1", [r.id])
    await refused(db.query("update service_requests set status = 'open' where id = $1", [r.id]), /closed/)
    await as(db, OWNER)
    assert.ok(await one(db, "select 1 from audit_log where action = 'update:service_requests'"))
  })

  it('anyone at the hospital can report; complaints are visible to admins and the reporter only; other hospitals see nothing', async () => {
    await as(db, NURSE)
    await db.query("insert into service_requests(hospital_id, department, kind, title, priority) values ($1, 'maintenance', 'job', 'Theatre light flickering', 'emergency')", [H1])
    await db.query("insert into service_requests(hospital_id, department, kind, title) values ($1, 'admin', 'complaint', 'Long wait at pharmacy')", [H1])
    const job = await one(db, "select due_at - created_at < interval '61 minutes' as one_hour from service_requests where title = 'Theatre light flickering'")
    assert.equal(job.one_hour, true, 'emergency → due within 1 hour')
    await as(db, REC)
    assert.equal((await db.query("select * from service_requests where kind = 'complaint'")).rows.length, 0)
    await as(db, OWNER)
    assert.equal((await db.query("select * from service_requests where kind = 'complaint'")).rows.length, 1)
    await as(db, OTHER)
    assert.equal((await db.query('select * from service_requests')).rows.length, 0)
    await refused(db.query("insert into service_requests(hospital_id, department, kind, title) values ($1, 'it', 'ticket', 'x y')", [H1]), /row-level/)
  })

  it('log books are append-only; open entries (visitors, trips) can only be closed once', async () => {
    await as(db, REC)
    const v = await one(db, "insert into service_logs(hospital_id, department, kind, subject, details) values ($1, 'security', 'visitor', 'John Kamau', '{\"visiting\":\"Bed M-01\"}') returning id", [H1])
    await db.query('update service_logs set ended_at = now() where id = $1', [v.id])
    await refused(db.query('update service_logs set ended_at = now() where id = $1', [v.id]), /already closed/)
    await refused(db.query("update service_logs set subject = 'Someone else' where id = $1", [v.id]), /cannot be changed/)
    await refused(db.query('delete from service_logs where id = $1', [v.id]), /permission denied|cannot be deleted/)
  })

  it('PPM: recording maintenance moves the next due date; admins get the executive dashboard', async () => {
    await as(db, NURSE)
    const a = await one(db, "insert into service_assets(hospital_id, department, kind, name, ppm_every_days, last_ppm_on) values ($1, 'maintenance', 'equipment', 'Oxygen concentrator #2', 90, current_date - 120) returning id", [H1])
    await db.query("insert into service_assets(hospital_id, department, kind, name, status, expires_on) values ($1, 'maintenance', 'licence', 'Boiler certificate', 'active', current_date + 20)", [H1])
    await as(db, OWNER)
    let k = (await one(db, 'select exec_kpis($1) as k', [H1])).k
    assert.equal(k.ppm_overdue, 1)
    assert.equal(k.expiring_60d, 1)
    assert.equal(k.beds_total, 2)
    assert.equal(k.visits_today, 1)
    assert.ok(k.requests_open >= 1)
    await as(db, NURSE)
    const next = (await one(db, 'select service_ppm_done($1, $2) as d', [a.id, 'Filters replaced'])).d
    assert.equal(new Date(next).toISOString().slice(0, 10), new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10))
    await refused(db.query('select exec_kpis($1)', [H1]), /administrators/)
    await as(db, OWNER)
    k = (await one(db, 'select exec_kpis($1) as k', [H1])).k
    assert.equal(k.ppm_overdue, 0)
  })
})
