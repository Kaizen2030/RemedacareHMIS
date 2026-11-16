// Radiology: supabase/migrations/20261204000000_radiology.sql (extends the existing radiology_orders table).
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const JANE = '99999999-0000-0000-0000-000000000001'

const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('radiology', () => {
  let db, cxr, us
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$
        begin return p::uuid; exception when others then return null; end $$;
      -- the original table, as Consultation uses it
      create table radiology_orders (id uuid primary key default gen_random_uuid(), hospital_id text, visit_id uuid, patient_id uuid, requesting_doctor text,
        modality text, body_region text, clinical_indication text, priority text, special_instructions text, status text default 'Requested',
        report_text text, impression text, report_date timestamptz, created_at timestamptz default now());
      insert into radiology_orders(hospital_id, patient_id, modality, status, report_text) values ('${H1}', '${JANE}', 'X-Ray', 'Reported', 'Old report before this module');
      create table notifications (id bigserial primary key, hospital_id text, notification_type text, title text, message text, target_path text, payload_json jsonb, is_read boolean default false, created_at timestamptz default now());
      alter table radiology_orders enable row level security;
      create policy members on radiology_orders for all using (pay_is_member(ref_try_uuid(hospital_id))) with check (pay_is_member(ref_try_uuid(hospital_id)));
      grant select, insert, update on radiology_orders to authenticated;`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/22_radiology.sql'))
    await db.exec(read('../../../docs/sql/22_radiology.sql'))
    await as(db, NURSE)
    cxr = (await one(db, "insert into radiology_orders(hospital_id, patient_id, modality, body_region, clinical_indication, room, scheduled_at, duration_min) values ($1, $2, 'X-Ray', 'Chest', 'Cough 3 weeks', 'X-ray room 1', now() + interval '1 hour', 15) returning *", [H1, JANE]))
    us = (await one(db, "insert into radiology_orders(hospital_id, patient_id, modality, body_region, clinical_indication) values ($1, $2, 'Ultrasound', 'Obstetric', 'Dating scan') returning *", [H1, JANE]))
  })

  it('gives every order an accession number and refuses a room clash', async () => {
    assert.match(cxr.accession_number, /^RAD\d{6}-\d{5}$/)
    assert.notEqual(us.accession_number, cxr.accession_number)
    await refused(db.query("insert into radiology_orders(hospital_id, patient_id, modality, room, scheduled_at) values ($1, $2, 'X-Ray', 'X-ray room 1', now() + interval '1 hour 5 minutes')", [H1, JANE]), /already booked/)
  })

  it('requires the pregnancy check for ionising imaging only, and findings before reporting', async () => {
    await refused(db.query("update radiology_orders set status = 'In Progress' where id = $1", [cxr.id]), /pregnancy check/)
    await db.query("update radiology_orders set status = 'In Progress' where id = $1", [us.id])
    await db.query("update radiology_orders set status = 'In Progress', pregnancy_check = 'not_pregnant', performed_by = 'Radiographer Achieng', dose = '{\"dap\": 0.12}' where id = $1", [cxr.id])
    await refused(db.query("update radiology_orders set status = 'Reported' where id = $1", [cxr.id]), /findings or impression/)
    await db.query("update radiology_orders set status = 'Reported', report_text = 'Right upper lobe cavitation', impression = 'Suggestive of pulmonary TB' where id = $1", [cxr.id])
    const r = await one(db, 'select performed_at, reported_at, reported_by from radiology_orders where id = $1', [cxr.id])
    assert.ok(r.performed_at && r.reported_at); assert.equal(r.reported_by, NURSE)
    await db.query("update radiology_orders set impression = 'Old report, acknowledged' where status = 'Reported' and report_text like 'Old report%'")
  })

  it('a critical result alerts the clinic and stays until acknowledged; verified reports are locked', async () => {
    await refused(db.query("update radiology_orders set critical = true where id = $1", [us.id]), /Describe the critical finding/)
    await db.query("update radiology_orders set critical = true, critical_finding = 'No fetal heart activity', status = 'Reported', report_text = 'Intrauterine gestation, no cardiac activity' where id = $1", [us.id])
    await as(db, null)
    const n = await one(db, "select title, target_path, payload_json from notifications where title = 'Critical imaging result'")
    assert.equal(n.target_path, '/radiology'); assert.equal(n.payload_json.radiology_order_id, us.id)
    await as(db, NURSE)
    await db.query("update radiology_orders set status = 'Verified' where id = $1", [us.id])
    await refused(db.query("update radiology_orders set impression = 'changed' where id = $1", [us.id]), /locked/)
    await db.query("update radiology_orders set critical_ack_at = now(), critical_ack_name = 'Dr Otieno' where id = $1", [us.id])
    assert.equal((await one(db, 'select critical_ack_by from radiology_orders where id = $1', [us.id])).critical_ack_by, NURSE)
  })

  it('statistics and cumulative dose for clinical staff', async () => {
    await db.query("insert into radiology_orders(hospital_id, patient_id, modality, pregnancy_check, status, report_text, dose) values ($1, $2, 'CT', 'na', 'Reported', 'CT head normal', '{\"dlp\": 950}')", [H1, JANE])
    const s = (await one(db, 'select radiology_stats($1, current_date - 1, current_date) as s', [H1])).s
    assert.equal(s.orders, 4); assert.equal(s.critical, 1); assert.equal(s.critical_unacknowledged, 0)
    assert.equal(Number(s.ct_dlp_median), 950)
    const d = (await one(db, 'select radiology_patient_dose($1) as d', [JANE])).d
    assert.equal(Number(d.dlp_total), 950); assert.equal(Number(d.ionising_exams), 3)
    await as(db, REC)
    await refused(db.query('select radiology_stats($1, current_date, current_date)', [H1]), /clinical/)
  })
})
