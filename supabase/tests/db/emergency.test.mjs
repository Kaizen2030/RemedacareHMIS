// Emergency department: supabase/migrations/20261202000000_emergency.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1', OTHER = '00000000-0000-0000-0000-0000000000b1'
const JANE = '99999999-0000-0000-0000-000000000001'

const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('emergency department', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$
        begin return p::uuid; exception when others then return null; end $$;`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/20_emergency.sql'))
    await db.exec(read('../../../docs/sql/20_emergency.sql'))
  })

  it('computes the colour from the score and emergency signs (the worst wins) and sets the see-by time', async () => {
    const c = async (score, signs, child = false) => (await one(db, 'select ed_colour($1, $2, $3) as c', [score, signs, child])).c
    assert.equal(await c(2, []), 'green')
    assert.equal(await c(3, []), 'yellow')
    assert.equal(await c(5, []), 'orange')
    assert.equal(await c(7, []), 'red')
    assert.equal(await c(1, ['orange:Chest pain']), 'orange')
    assert.equal(await c(9, ['yellow:Abdominal pain']), 'red')
    assert.equal(await c(9, [], true), 'green', 'children: signs only (ETAT+)')
    assert.equal(await c(0, ['red:Obstructed breathing'], true), 'red')

    await as(db, NURSE)
    const a = await one(db, "insert into ed_attendances(hospital_id, patient_id, arrival_at, complaint, tews_score, discriminators, triage_colour) values ($1, $2, now() - interval '5 minutes', 'Chest pain', 2, '{orange:Chest pain}', 'green') returning *", [H1, JANE])
    assert.equal(a.triage_colour, 'orange', 'cannot be set lower than the findings')
    assert.equal(Math.round((new Date(a.see_by) - new Date(a.arrival_at)) / 60000), 10)
    assert.equal(a.triage_by, NURSE)
  })

  it('requires a seen time before a disposition (except LWBS / died), then closes the record', async () => {
    await as(db, NURSE)
    const a = await one(db, "insert into ed_attendances(hospital_id, unknown_label, tews_score) values ($1, 'Unknown male ~30', 4) returning id", [H1])
    await refused(db.query("update ed_attendances set disposition = 'admitted' where id = $1", [a.id]), /seen/)
    await db.query("update ed_attendances set seen_at = now(), clinician = 'Dr Otieno' where id = $1", [a.id])
    await db.query("update ed_attendances set disposition = 'admitted' where id = $1", [a.id])
    const r = await one(db, 'select departed_at, seen_by from ed_attendances where id = $1', [a.id])
    assert.ok(r.departed_at); assert.equal(r.seen_by, NURSE)
    await refused(db.query("update ed_attendances set disposition = 'discharged' where id = $1", [a.id]), /closed/)
    await db.query("update ed_attendances set notes = 'Handed to ward 3' where id = $1", [a.id])
    const lw = await one(db, "insert into ed_attendances(hospital_id, unknown_label, tews_score) values ($1, 'Walk-in', 1) returning id", [H1])
    await db.query("update ed_attendances set disposition = 'lwbs' where id = $1", [lw.id])
  })

  it('pathway steps are timed once each; clinical staff only; statistics', async () => {
    await as(db, NURSE)
    const a = await one(db, "select id from ed_attendances where complaint = 'Chest pain'")
    await db.query("insert into ed_pathway_events(hospital_id, attendance_id, pathway, step) values ($1, $2, 'stemi', 'ecg')", [H1, a.id])
    await refused(db.query("insert into ed_pathway_events(hospital_id, attendance_id, pathway, step) values ($1, $2, 'stemi', 'ecg')", [H1, a.id]), /duplicate|unique/)
    const s = (await one(db, "select ed_stats($1, current_date - 1, current_date) as s", [H1])).s
    assert.equal(s.attendances, 3)
    assert.equal(s.lwbs_pct, 50)
    assert.ok(s.pathway_steps['stemi:ecg'] >= 4)
    await as(db, REC)
    assert.equal((await db.query('select * from ed_attendances')).rows.length, 0, 'reception is not clinical')
    await refused(db.query("select ed_stats($1, current_date, current_date)", [H1]), /clinical/)
    await as(db, OTHER)
    assert.equal((await db.query('select * from ed_attendances')).rows.length, 0)
  })
})
