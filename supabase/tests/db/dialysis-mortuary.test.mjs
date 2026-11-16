// Dialysis and mortuary: supabase/migrations/20261211000000_dialysis_mortuary.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1', OWNER = '00000000-0000-0000-0000-0000000000a4'
const MORT = '00000000-0000-0000-0000-0000000000f1', MORT2 = '00000000-0000-0000-0000-0000000000f2'
const JANE = '99999999-0000-0000-0000-000000000001', BOB = '99999999-0000-0000-0000-000000000002'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('dialysis and mortuary', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`insert into auth.users values ('${MORT}', 'm1@a.ke'), ('${MORT2}', 'm2@a.ke');
      insert into hospital_users(user_id, hospital_id, role) values ('${MORT}', '${H1}', 'Mortuary Attendant'), ('${MORT2}', '${H1}', 'Mortuary Attendant');
      insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', 'm1@a.ke', 'Musa', 'Mortuary Attendant', 'Active'), ('${H1}', 'm2@a.ke', 'Mary', 'Mortuary Attendant', 'Active');`)
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$ begin return p::uuid; exception when others then return null; end $$;`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/29_dialysis_mortuary.sql'))
    await db.exec(read('../../../docs/sql/29_dialysis_mortuary.sql'))
  })

  it('Kt/V (Daugirdas II) and URR', async () => {
    const a = (await one(db, 'select dialysis_adequacy(150, 50, 240, 3, 70) r')).r
    assert.equal(Number(a.urr), 66.7); assert.equal(Number(a.ktv), 1.32)
    assert.equal((await one(db, 'select dialysis_adequacy(150, null, 240, 3, 70) r')).r.ktv, null)
  })

  it('sessions: hepatitis B machines enforced, adequacy and weight gain computed, closed sessions locked', async () => {
    await as(db, NURSE)
    const pos = await one(db, "insert into dialysis_patients(hospital_id, patient_id, hbsag, dry_weight_kg, access_type) values ($1, $2, 'positive', 60, 'AVF') returning id", [H1, JANE])
    const neg = await one(db, "insert into dialysis_patients(hospital_id, patient_id, hbsag, dry_weight_kg, access_type) values ($1, $2, 'negative', 70, 'tunneled_cvc') returning id", [H1, BOB])
    const m1 = await one(db, "insert into dialysis_machines(hospital_id, name) values ($1, 'HD-1') returning id", [H1])
    const iso = await one(db, "insert into dialysis_machines(hospital_id, name, hbv_dedicated) values ($1, 'ISO-1', true) returning id", [H1])
    await refused(db.query("insert into dialysis_sessions(hospital_id, dialysis_patient_id, patient_id, machine_id) values ($1, $2, $3, $4)", [H1, pos.id, JANE, m1.id]), /hepatitis B-dedicated/)
    await refused(db.query("insert into dialysis_sessions(hospital_id, dialysis_patient_id, patient_id, machine_id) values ($1, $2, $3, $4)", [H1, neg.id, BOB, iso.id]), /dedicated to hepatitis B/)

    const s1 = await one(db, "insert into dialysis_sessions(hospital_id, dialysis_patient_id, patient_id, machine_id, session_date) values ($1, $2, $3, $4, current_date - 2) returning id", [H1, neg.id, BOB, m1.id])
    await refused(db.query("update dialysis_sessions set status = 'in_progress' where id = $1", [s1.id]), /pre-dialysis weight/)
    await db.query("update dialysis_sessions set status = 'in_progress', pre_weight_kg = 73, pre_sbp = 150, started_at = now() - interval '4 hours' where id = $1", [s1.id])
    await refused(db.query("update dialysis_sessions set status = 'completed' where id = $1", [s1.id]), /post-dialysis weight/)
    const done = await one(db, "update dialysis_sessions set status = 'completed', post_weight_kg = 70, post_sbp = 85, pre_urea = 150, post_urea = 60, duration_min = 240 where id = $1 returning *", [s1.id])
    assert.equal(Number(done.uf_achieved_l), 3); assert.equal(Number(done.urr), 60)
    assert.ok(done.flags.some((f) => /URR 60/.test(f))); assert.ok(done.flags.some((f) => /hypotension/.test(f)))
    await refused(db.query('update dialysis_sessions set post_weight_kg = 69 where id = $1', [s1.id]), /closed/)

    const s2 = await one(db, "insert into dialysis_sessions(hospital_id, dialysis_patient_id, patient_id, machine_id, status, pre_weight_kg, pre_sbp, access_check) values ($1, $2, $3, $4, 'in_progress', 74, 140, '{\"infection_signs\": true}') returning *", [H1, neg.id, BOB, m1.id])
    assert.equal(Number(s2.idwg_kg), 4)
    assert.ok(s2.flags.some((f) => /Weight gain since last session 4/.test(f))); assert.ok(s2.flags.some((f) => /Access infection/.test(f)))
    await refused(db.query("update dialysis_sessions set status = 'missed' where id = $1", [s2.id]), /reason/)
    const st = (await one(db, 'select dialysis_stats($1, current_date - 7, current_date) r', [H1])).r
    assert.equal(st.sessions, 1); assert.equal(Number(st.urr_median), 60); assert.deepEqual(st.access, { AVF: 1, tunneled_cvc: 1 })
  })

  it('mortuary: numbering, one body per chamber, medico-legal needs the OB number; mortuary staff see bodies but not clinical data', async () => {
    await as(db, MORT)
    await refused(db.query("insert into mortuary_bodies(hospital_id, deceased_name, place_of_death, chamber) values ($1, 'Unknown male', 'brought_in_dead', 'C1')", [H1]), /OB number/)
    const b = await one(db, "insert into mortuary_bodies(hospital_id, deceased_name, place_of_death, chamber, sex) values ($1, 'John Kamau', 'ward', 'C1', 'male') returning *", [H1])
    assert.match(b.body_number, /^MRT-\d{4}-\d{4}$/)
    await refused(db.query("insert into mortuary_bodies(hospital_id, deceased_name, place_of_death, chamber) values ($1, 'Second', 'ward', 'c1')", [H1]), /duplicate|unique/)
    const bid = await one(db, "insert into mortuary_bodies(hospital_id, deceased_name, place_of_death, chamber, police_ob_number) values ($1, 'Unknown female', 'brought_in_dead', 'C2', 'OB 14/11/2026') returning medico_legal", [H1])
    assert.equal(bid.medico_legal, true)
    assert.equal((await db.query('select * from dialysis_sessions')).rows.length, 0, 'mortuary staff cannot see clinical tables')
    await as(db, REC)
    assert.equal((await db.query('select * from mortuary_bodies')).rows.length, 0)
  })

  it('release: blockers listed, bill must be cleared at the cashier (or waived by an admin), two different staff', async () => {
    await as(db, MORT)
    const b = await one(db, "select id from mortuary_bodies where deceased_name = 'John Kamau'")
    const blockers = (await one(db, 'select mortuary_blockers($1) r', [b.id])).r
    assert.deepEqual(blockers, ['Identity not verified', 'Next of kin name and ID number', 'Burial permit number', 'Mortuary bill: send it to the cashier and link the invoice'])
    await refused(db.query("update mortuary_bodies set status = 'release_requested' where id = $1", [b.id]), /Identity not verified/)
    await db.exec(`reset role; insert into invoices(id, hospital_id, amount_kes, balance_kes, status) values ('cccccccc-0000-0000-0000-000000000001', '${H1}', 9000, 9000, 'Pending')`)
    await as(db, MORT)
    await db.query(`update mortuary_bodies set identity_verified = true, next_of_kin = '{"name":"Grace Kamau","id_number":"23456789","relationship":"wife"}', burial_permit_no = 'BP-0091',
      invoice_id = 'cccccccc-0000-0000-0000-000000000001' where id = $1`, [b.id])
    await refused(db.query("update mortuary_bodies set status = 'release_requested' where id = $1", [b.id]), /not cleared at the cashier \(KES 9000 due\)/)
    await refused(db.query("update mortuary_bodies set bill_waived_reason = 'family cannot pay' where id = $1", [b.id]), /Only an administrator/)
    await db.exec("reset role; update invoices set balance_kes = 0, paid_kes = 9000, status = 'Paid' where id = 'cccccccc-0000-0000-0000-000000000001'")
    await as(db, MORT)
    await db.query("update mortuary_bodies set status = 'release_requested' where id = $1", [b.id])
    await refused(db.query("update mortuary_bodies set status = 'released', released_to = 'Grace Kamau' where id = $1", [b.id]), /different staff member/)
    await as(db, MORT2)
    await refused(db.query("update mortuary_bodies set status = 'released' where id = $1", [b.id]), /released to/)
    await db.query("update mortuary_bodies set status = 'released', released_to = 'Grace Kamau (wife), ID 23456789' where id = $1", [b.id])
    await refused(db.query("update mortuary_bodies set chamber = 'C9' where id = $1", [b.id]), /closed/)
    // chamber C1 is free again
    await db.query("insert into mortuary_bodies(hospital_id, deceased_name, place_of_death, chamber) values ($1, 'Next', 'ward', 'C1')", [H1])
    // medico-legal body needs police clearance and post-mortem; admin can waive the bill
    const ml = await one(db, "select id from mortuary_bodies where deceased_name = 'Unknown female'")
    await as(db, OWNER)
    await db.query(`update mortuary_bodies set identity_verified = true, next_of_kin = '{"name":"Ann","id_number":"1"}', burial_permit_no = 'BP-1', bill_waived_reason = 'Unclaimed — county burial' where id = $1`, [ml.id])
    assert.deepEqual((await one(db, 'select mortuary_blockers($1) r', [ml.id])).r, ['Police clearance (medico-legal case)', 'Post-mortem done or waived by the police'])
    const st = (await one(db, 'select mortuary_stats($1, current_date - 1, current_date) r', [H1])).r
    assert.equal(st.released, 1); assert.equal(st.medico_legal, 1); assert.equal(st.in_storage, 2)
  })
})
