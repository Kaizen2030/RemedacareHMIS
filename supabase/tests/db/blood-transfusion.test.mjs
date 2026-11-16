// Blood transfusion closed loop: supabase/migrations/20261207000000_blood_transfusion.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1', LAB = '00000000-0000-0000-0000-0000000000d1'
const JANE = '99999999-0000-0000-0000-000000000001', BOB = '99999999-0000-0000-0000-000000000002'

const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}
const future = "now() + interval '20 days'"
const unit = async (db, ref, group, component = 'Packed Red Cells') => {
  const u = await one(db, `insert into blood_bank_units(hospital_id, unit_reference, blood_group, component, status, expiry_at) values ($1, $2, $3, $4, 'Quarantine', ${future}) returning id`, [H1, ref, group, component])
  await db.query("update blood_bank_units set screening_status = 'clear', status = 'Available' where id = $1", [u.id])
  return u.id
}
const request = (db, patient, extra = {}) => one(db, `insert into blood_requests(hospital_id, patient_id, component, units, urgency, emergency_release, indication, consent)
  values ($1, $2, $3, $4, $5, $6, 'Hb 5.8 g/dL, symptomatic', 'obtained') returning id`, [H1, patient, extra.component || 'Packed Red Cells', extra.units || 1, extra.urgency || 'routine', extra.emergency || false])
const group = (db, patient, sample, abo, rh) => one(db, 'insert into blood_group_tests(hospital_id, patient_id, sample_ref, abo, rh) values ($1, $2, $3, $4, $5) returning *', [H1, patient, sample, abo, rh])
const bedside = { temp: 36.8, hr: 88, sbp: 118 }

describe('blood transfusion closed loop', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`insert into auth.users values ('${LAB}', 'lab@a.ke');
      insert into hospital_users(user_id, hospital_id, role) values ('${LAB}', '${H1}', 'Lab Technician');
      insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', 'lab@a.ke', 'Lucy', 'Lab Technician', 'Active');
      alter table patients add column patient_number text; update patients set patient_number = 'P-' || full_name;`)
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$
        begin return p::uuid; exception when others then return null; end $$;
      create table notifications (id bigserial primary key, hospital_id uuid, notification_type text, title text, message text, target_path text, payload_json jsonb);
      grant insert on notifications to authenticated; grant usage on sequence notifications_id_seq to authenticated;`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/25_blood_transfusion.sql'))
    await db.exec(read('../../../docs/sql/25_blood_transfusion.sql'))
  })

  it('groups the patient: two samples confirm, a disagreement is flagged and blocks crossmatch until voided', async () => {
    await as(db, NURSE)
    await refused(group(db, JANE, 'S1', 'A', 'pos'), /row-level|permission/)
    await as(db, LAB)
    assert.equal((await group(db, JANE, 'S1', 'A', 'pos')).result_group, 'A+')
    assert.equal((await one(db, 'select blood_group_status($1) s', [JANE])).s.status, 'single')
    await refused(group(db, JANE, 's1', 'A', 'pos'), /duplicate|unique/)
    await group(db, JANE, 'S2', 'A', 'pos')
    assert.deepEqual((await one(db, 'select blood_group_status($1) s', [JANE])).s, { status: 'confirmed', group: 'A+', samples: 2, antibodies: false })
    assert.equal((await one(db, 'select blood_group from patients where id = $1', [JANE])).blood_group, 'A+')

    const bad = await group(db, BOB, 'S9', 'B', 'pos')
    const wrong = await group(db, BOB, 'S10', 'O', 'pos')
    assert.equal((await one(db, 'select blood_group_status($1) s', [BOB])).s.status, 'discrepant')
    await as(db, null)
    assert.ok(await one(db, "select 1 from notifications where title = 'Blood group discrepancy'"))
    await as(db, LAB)
    const u = await unit(db, 'U-B1', 'O+')
    await refused(db.query("insert into blood_crossmatches(hospital_id, blood_unit_id, patient_id, result, method) values ($1, $2, $3, 'Compatible', 'Gel card')", [H1, u, BOB]), /discrepancy/)
    await refused(db.query("update blood_group_tests set abo = 'A' where id = $1", [wrong.id]), /cannot be changed/)
    await db.query("update blood_group_tests set void_reason = 'Wrong blood in tube: sample from bed 4' where id = $1", [bad.id])
    assert.equal((await one(db, 'select blood_group_status($1) s', [BOB])).s.group, 'O+')
    void wrong
  })

  it('requests need an indication and consent; crossmatch reserves; issue only against the request and the right patient', async () => {
    await as(db, NURSE)
    await refused(db.query("insert into blood_requests(hospital_id, patient_id, component, indication, consent) values ($1, $2, 'Packed Red Cells', 'x', 'refused')", [H1, JANE]), /refused/)
    await refused(db.query("insert into blood_requests(hospital_id, patient_id, component, indication, consent, emergency_release) values ($1, $2, 'Packed Red Cells', 'x', 'obtained', true)", [H1, JANE]), /emergency/)
    const rq = await request(db, JANE)
    await as(db, LAB)
    const u1 = await unit(db, 'U-A1', 'A+'), u2 = await unit(db, 'U-B2', 'B+')
    await refused(db.query("insert into blood_crossmatches(hospital_id, blood_unit_id, patient_id, result, method) values ($1, $2, $3, 'Compatible', 'Gel card')", [H1, u2, JANE]), /incompatible/)
    const xm = await one(db, "insert into blood_crossmatches(hospital_id, blood_unit_id, patient_id, request_id, result, method) values ($1, $2, $3, $4, 'Compatible', 'Gel card') returning id", [H1, u1, JANE, rq.id])
    assert.deepEqual(await one(db, 'select status, reserved_for_patient_id from blood_bank_units where id = $1', [u1]), { status: 'Reserved', reserved_for_patient_id: JANE })
    assert.equal((await one(db, 'select status from blood_requests where id = $1', [rq.id])).status, 'ready')

    await refused(db.query("update blood_bank_units set status = 'Issued', issued_to_patient_id = $2, issued_crossmatch_id = $3 where id = $1", [u1, JANE, xm.id]), /request/)
    await refused(db.query("update blood_bank_units set status = 'Issued', issued_to_patient_id = $2, request_id = $3 where id = $1", [u1, BOB, rq.id]), /different patient/)
    await refused(db.query("update blood_bank_units set status = 'Issued', issued_to_patient_id = $2, request_id = $3 where id = $1", [u1, JANE, rq.id]), /crossmatch/)
    await db.query("update blood_bank_units set status = 'Issued', issued_to_patient_id = $2, request_id = $3, issued_crossmatch_id = $4 where id = $1", [u1, JANE, rq.id, xm.id])
    assert.equal((await one(db, 'select status from blood_requests where id = $1', [rq.id])).status, 'issued')
    const u3 = await unit(db, 'U-A3', 'A+')
    await refused(db.query("update blood_bank_units set status = 'Issued', issued_to_patient_id = $2, request_id = $3 where id = $1", [u3, JANE, rq.id]), /All 1 unit/)
  })

  it('applies plasma rules and emergency group-O release', async () => {
    await as(db, NURSE)
    const ffp = await request(db, JANE, { component: 'Fresh Frozen Plasma', units: 2 })
    const em = await request(db, BOB, { urgency: 'emergency', emergency: true, units: 2 })
    await as(db, LAB)
    const pO = await unit(db, 'FFP-O', 'O+', 'Fresh Frozen Plasma'), pAB = await unit(db, 'FFP-AB', 'AB-', 'Fresh Frozen Plasma')
    await refused(db.query("update blood_bank_units set status = 'Issued', issued_to_patient_id = $2, request_id = $3 where id = $1", [pO, JANE, ffp.id]), /Plasma group O\+ is not compatible/)
    await db.query("update blood_bank_units set status = 'Issued', issued_to_patient_id = $2, request_id = $3 where id = $1", [pAB, JANE, ffp.id])
    const aNeg = await unit(db, 'E-A', 'A-'), oNeg = await unit(db, 'E-O', 'O-')
    await refused(db.query("update blood_bank_units set status = 'Issued', issued_to_patient_id = $2, request_id = $3 where id = $1", [aNeg, BOB, em.id]), /group O/)
    await db.query("update blood_bank_units set status = 'Issued', issued_to_patient_id = $2, request_id = $3 where id = $1", [oNeg, BOB, em.id])
    assert.equal((await one(db, 'select emergency_release from blood_bank_units where id = $1', [oNeg])).emergency_release, true)
    // returned within 30 minutes goes back to stock
    await db.query("update blood_bank_units set status = 'Available' where id = $1", [oNeg])
    assert.equal((await one(db, 'select issued_to_patient_id from blood_bank_units where id = $1', [oNeg])).issued_to_patient_id, null)
  })

  it('bedside check catches the wrong bag or patient, needs two checkers and 15-minute observations; reactions alert', async () => {
    const u1 = (await one(db, "select id from blood_bank_units where unit_reference = 'U-A1'")).id
    await as(db, NURSE)
    const tx = (o = {}) => db.query(`insert into blood_transfusions(hospital_id, unit_id, patient_id, scanned_unit_ref, scanned_patient_number, id_band_checked, checker1_name, checker2_name, baseline)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`, [H1, u1, o.patient || JANE, o.ref || 'U-A1', o.number || 'P-Jane', o.band ?? true, 'Nora', o.c2 || 'Mary', JSON.stringify(o.baseline || bedside)])
    await refused(tx({ patient: BOB }), /WRONG PATIENT/)
    await refused(tx({ ref: 'U-A3' }), /does not match the issued unit/)
    await refused(tx({ number: 'P-Bob' }), /identity band does not match/)
    await refused(tx({ band: false }), /identity band/)
    await refused(tx({ c2: 'nora' }), /Two different staff/)
    await refused(tx({ baseline: { temp: 36.8 } }), /baseline/)
    const t = (await tx()).rows[0]
    assert.equal(t.status, 'in_progress')
    await refused(db.query("update blood_transfusions set status = 'completed', volume_ml = 300 where id = $1", [t.id]), /15-minute/)
    await refused(db.query("update blood_transfusions set checker2_name = 'X' where id = $1", [t.id]), /cannot be changed/)
    await db.query('update blood_transfusions set obs_15 = $2 where id = $1', [t.id, JSON.stringify({ temp: 38.1, hr: 96, sbp: 116 })])
    const f = (await one(db, 'select flags from blood_transfusions where id = $1', [t.id])).flags
    assert.match(f[0], /Possible reaction/)
    await refused(db.query("insert into blood_reactions(hospital_id, transfusion_id, reaction_type, severity, actions) values ($1, $2, 'febrile_non_haemolytic', 'non_severe', '')", [H1, t.id]), /what was done/)
    await db.query("insert into blood_reactions(hospital_id, transfusion_id, reaction_type, severity, actions) values ($1, $2, 'febrile_non_haemolytic', 'non_severe', 'Stopped; paracetamol; doctor reviewed')", [H1, t.id])
    await db.query("update blood_transfusions set status = 'stopped', stop_reason = 'Febrile reaction' where id = $1", [t.id])
    const done = await one(db, 'select reaction, ended_at from blood_transfusions where id = $1', [t.id])
    assert.equal(done.reaction, true); assert.ok(done.ended_at)
    await refused(db.query("update blood_transfusions set volume_ml = 50 where id = $1", [t.id]), /closed/)
    await as(db, null)
    assert.ok(await one(db, "select 1 from notifications where title = 'Transfusion reaction'"))
    await as(db, LAB)
    await refused(db.query("update blood_bank_units set status = 'Available' where id = $1", [u1]), /transfusion has already started|30 minutes/)
  })

  it('donors: eligibility and interval, unit created in quarantine, reactive screening discards and defers', async () => {
    await as(db, LAB)
    const d = await one(db, "insert into blood_donors(hospital_id, full_name, sex, date_of_birth, national_id) values ($1, 'Peter Kamau', 'male', '1990-01-01', '12345678') returning id", [H1])
    const don = (o = {}) => one(db, `insert into blood_donations(hospital_id, donor_id, weight_kg, hb, bp_sys, bp_dia, temp, questionnaire_ok, outcome, blood_group, unit_reference, donated_at)
      values ($1, $2, $3, $4, 120, 80, 36.6, true, 'donated', 'O+', $5, $6) returning *`, [H1, d.id, o.weight ?? 70, o.hb ?? 14, o.ref || 'D-1', o.at || new Date().toISOString()])
    await refused(don({ hb: 11.9 }), /12.5/)
    await refused(don({ weight: 45 }), /50 kg/)
    const first = await don({ at: new Date(Date.now() - 100 * 86400000).toISOString(), ref: 'D-0' })
    assert.deepEqual(await one(db, 'select status, component, screening_status from blood_bank_units where id = $1', [first.unit_id]), { status: 'Quarantine', component: 'Whole Blood', screening_status: 'pending' })
    await db.query(`update blood_donations set tti = '{"hiv":"negative","hbv":"negative","hcv":"negative","syphilis":"negative"}' where id = $1`, [first.id])
    assert.equal((await one(db, 'select screening_status from blood_bank_units where id = $1', [first.unit_id])).screening_status, 'clear')
    const second = await don({ ref: 'D-1' })
    await refused(don({ ref: 'D-2' }), /Too soon/)
    await db.query(`update blood_donations set tti = '{"hiv":"negative","hbv":"reactive","hcv":"negative","syphilis":"negative"}' where id = $1`, [second.id])
    assert.equal((await one(db, 'select status from blood_bank_units where id = $1', [second.unit_id])).status, 'Discarded')
    const donor = await one(db, 'select permanently_deferred, deferral_reason from blood_donors where id = $1', [d.id])
    assert.equal(donor.permanently_deferred, true); assert.match(donor.deferral_reason, /hbv/)

    const st = (await one(db, 'select blood_stats($1, current_date - 1, current_date) r', [H1])).r
    assert.equal(st.reactions, 1); assert.equal(st.transfused, 1); assert.equal(st.donations, 1); assert.equal(st.tti_reactive, 1)
    assert.equal(st.emergency_releases, 0, 'the returned O-neg unit is back in stock')
    await as(db, REC)
    assert.equal((await db.query('select * from blood_requests')).rows.length, 0)
    assert.equal((await db.query('select * from blood_bank_units')).rows.length, 0)
  })
})
