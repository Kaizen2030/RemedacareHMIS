// HIV / TB / maternity: supabase/migrations/20261119000000_hiv_tb_maternity.sql on PGlite.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const MIG = read('../../migrations/20261119000000_hiv_tb_maternity.sql')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const ACC = '00000000-0000-0000-0000-0000000000a2', OTHER = '00000000-0000-0000-0000-0000000000b1'
const JANE = '99999999-0000-0000-0000-000000000001', BOB = '99999999-0000-0000-0000-000000000002'

async function boot() {
  const db = new PGlite()
  await db.exec(read('./stub.sql'))
  await db.exec(PAYMENTS)
  await db.exec(`alter table patients add column age text, add column date_of_birth date;
    update patients set age = '30' where id = '${JANE}'; update patients set age = '19' where id = '${BOB}';`)
  await db.exec(MIG)
  return db
}
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
const d = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const addMonths = (iso, m) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10) }
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('the paste-ready 08 file', () => {
  it('installs and reports OK', async () => {
    const db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(PAYMENTS)
    const rows = (await db.exec(read('../../../docs/sql/08_hiv_tb_maternity.sql'))).at(-1).rows
    assert.deepEqual(rows.map((r) => r.result), ['OK', 'OK', 'OK'])
  })
})

describe('access to HIV and maternity records', () => {
  it('clinical staff only: reception, finance and other hospitals see nothing', async () => {
    const db = await boot()
    await as(db, NURSE)
    await db.query("insert into hiv_art(hospital_id, patient_id, ccc_number, art_start_date, current_regimen) values ($1, $2, '13939-00001', $3, 'TDF/3TC/DTG')", [H1, JANE, d(-30)])
    assert.equal((await db.query('select * from hiv_art')).rows.length, 1)
    for (const u of [REC, ACC, OTHER]) {
      await as(db, u)
      assert.equal((await db.query('select * from hiv_art')).rows.length, 0)
      await refused(db.query("insert into anc_pregnancies(hospital_id, patient_id) values ($1, $2)", [H1, JANE]))
    }
  })
})

describe('HIV viral load schedule (Kenya 2022)', () => {
  let db, art
  before(async () => {
    db = await boot(); await as(db, NURSE)
    art = await one(db, "insert into hiv_art(hospital_id, patient_id, art_start_date, current_regimen, regimen_line) values ($1, $2, $3, 'TDF/3TC/DTG', 'first') returning *", [H1, JANE, d(-100)])
  })
  it('first viral load is due 3 months after starting ART', async () => {
    assert.equal(art.next_vl_due, null === art.next_vl_due ? null : art.next_vl_due)
    const r = await one(db, 'select next_vl_due::text from hiv_art where id = $1', [art.id])
    assert.equal(r.next_vl_due, addMonths(d(-100), 3))
  })
  it('suppressed adult 25+: next in 12 months; LDL counts as suppressed', async () => {
    await db.query('insert into hiv_viral_loads(hospital_id, art_id, sample_date, copies_ml) values ($1, $2, $3, 0)', [H1, art.id, d(-5)])
    const r = await one(db, 'select vl_status, eac_required, next_vl_due::text from hiv_art where id = $1', [art.id])
    assert.deepEqual(r, { vl_status: 'suppressed', eac_required: false, next_vl_due: addMonths(d(-5), 12) })
  })
  it('200+ copies: unsuppressed, enhanced adherence counselling, repeat in 3 months', async () => {
    await db.query('insert into hiv_viral_loads(hospital_id, art_id, sample_date, copies_ml) values ($1, $2, $3, 4500)', [H1, art.id, d(-1)])
    const r = await one(db, 'select vl_status, eac_required, next_vl_due::text from hiv_art where id = $1', [art.id])
    assert.deepEqual(r, { vl_status: 'unsuppressed', eac_required: true, next_vl_due: addMonths(d(-1), 3) })
  })
  it('under 25 or pregnant/breastfeeding: 6-monthly when suppressed; 50-199 is low-level viraemia', async () => {
    const young = await one(db, "insert into hiv_art(hospital_id, patient_id, art_start_date) values ($1, $2, $3) returning id", [H1, BOB, d(-400)])
    await db.query('insert into hiv_viral_loads(hospital_id, art_id, sample_date, copies_ml) values ($1, $2, $3, 40)', [H1, young.id, d(-2)])
    assert.equal((await one(db, 'select next_vl_due::text n from hiv_art where id = $1', [young.id])).n, addMonths(d(-2), 6))
    await db.query('insert into hiv_viral_loads(hospital_id, art_id, sample_date, copies_ml) values ($1, $2, $3, 120)', [H1, young.id, d(-1)])
    assert.equal((await one(db, 'select vl_status from hiv_art where id = $1', [young.id])).vl_status, 'llv')
  })
  it('a regimen can only change with a reason, and the history is kept', async () => {
    await refused(db.query("update hiv_art set current_regimen = 'AZT/3TC/LPV/r' where id = $1", [art.id]), /reason/)
    await db.query("select hiv_change_regimen($1, 'AZT/3TC/ATV/r', 'second', 'Treatment failure: two VLs > 1000 after EAC')", [art.id])
    const r = await one(db, 'select current_regimen, regimen_line from hiv_art where id = $1', [art.id])
    assert.deepEqual(r, { current_regimen: 'AZT/3TC/ATV/r', regimen_line: 'second' })
    assert.equal((await one(db, 'select from_regimen from hiv_regimen_changes where art_id = $1', [art.id])).from_regimen, 'TDF/3TC/DTG')
    await refused(db.query('delete from hiv_regimen_changes'))
  })
})

describe('TB episode', () => {
  it('phase, follow-up sputum due, DOT adherence and suggested outcome', async () => {
    const db = await boot(); await as(db, NURSE)
    const ep = await one(db, "insert into tb_episodes(hospital_id, patient_id, treatment_start) values ($1, $2, $3) returning id", [H1, JANE, d(-30)])
    let s = (await one(db, 'select tb_status($1) s', [ep.id])).s
    assert.equal(s.phase, 'intensive')
    assert.equal(s.next_sputum_month, 2)
    await db.query("insert into tb_dot_log(hospital_id, episode_id, dose_date, taken) values ($1, $2, $3, true), ($1, $2, $4, true), ($1, $2, $5, false), ($1, $2, $6, true)", [H1, ep.id, d(-4), d(-3), d(-2), d(-1)])
    s = (await one(db, 'select tb_status($1) s', [ep.id])).s
    assert.equal(s.adherence_pct, 75)
    await refused(db.query("insert into tb_episodes(hospital_id, patient_id) values ($1, $2)", [H1, JANE]), /duplicate/)
    await db.query("update tb_episodes set treatment_start = $2 where id = $1", [ep.id, d(-200)])
    await db.query("insert into tb_sputum_results(hospital_id, episode_id, month, sample_date, result) values ($1, $2, 2, $3, 'negative'), ($1, $2, 5, $4, 'negative'), ($1, $2, 6, $5, 'negative')", [H1, ep.id, d(-140), d(-50), d(-20)])
    s = (await one(db, 'select tb_status($1) s', [ep.id])).s
    assert.equal(s.phase, 'course_complete')
    assert.equal(s.next_sputum_month, null)
    assert.equal(s.suggested_outcome, 'cured')
  })
})

describe('ANC, delivery and register counts', () => {
  let db, preg
  before(async () => {
    db = await boot(); await as(db, NURSE)
    preg = await one(db, "insert into anc_pregnancies(hospital_id, patient_id, lmp, parity, hiv_status) values ($1, $2, $3, 5, 'positive') returning *", [H1, BOB, d(-7 * 10)])
  })
  it('EDD = LMP + 280 days; booking risk flags from age, parity and HIV', async () => {
    const p = await one(db, 'select (edd - lmp) as gap, risk_flags from anc_pregnancies where id = $1', [preg.id])
    assert.equal(p.gap, 280)
    assert.deepEqual([...p.risk_flags].sort(), ['HIV positive (PMTCT)', 'grand multipara'])
  })
  it('contacts get gestation, numbering and clinical flags; next contact follows the 8-contact schedule', async () => {
    await db.query("insert into anc_contacts(pregnancy_id, visit_date, bp_sys, bp_dia, urine_protein, hb) values ($1, $2, 150, 95, '++', 9.5)", [preg.id, d(0)])
    const c = await one(db, 'select contact_number, ga_weeks, risk_flags from anc_contacts where pregnancy_id = $1', [preg.id])
    assert.equal(c.contact_number, 1)
    assert.equal(c.ga_weeks, 10)
    assert.deepEqual([...c.risk_flags].sort(), ['anaemia', 'hypertension', 'pre-eclampsia (BP + proteinuria)'])
    const p = await one(db, 'select risk_flags, next_contact_due::text n, lmp::text l from anc_pregnancies where id = $1', [preg.id])
    assert.ok(p.risk_flags.includes('pre-eclampsia (BP + proteinuria)'))
    assert.equal(p.n, d(-70 + 12 * 7), 'next contact at 12 weeks')
  })
  it('a mother booking late is scheduled forward, not marked overdue', async () => {
    const late = await one(db, "insert into anc_pregnancies(hospital_id, patient_id, lmp) values ($1, $2, $3) returning id", [H1, JANE, d(-7 * 31)])
    await db.query('insert into anc_contacts(pregnancy_id, visit_date) values ($1, $2)', [late.id, d(0)])
    const p = await one(db, 'select next_contact_due::text n from anc_pregnancies where id = $1', [late.id])
    assert.equal(p.n, d(-7 * 31 + 34 * 7))
  })
  it('delivery, newborn and the MOH register counts', async () => {
    const dl = await one(db, "insert into deliveries(hospital_id, pregnancy_id, patient_id, mode, blood_loss_ml, amtsl_oxytocin) values ($1, $2, $3, 'caesarean', 700, true) returning id", [H1, preg.id, BOB])
    await db.query("insert into newborns(hospital_id, delivery_id, sex, outcome, birth_weight_g) values ($1, $2, 'female', 'live_birth', 2300), ($1, $2, 'male', 'fresh_stillbirth', 2100)", [H1, dl.id])
    const rows = Object.fromEntries((await db.query('select indicator, value::int v from programme_summary($1, $2, $3)', [H1, d(-30), d(1)])).rows.map((r) => [r.indicator, r.v]))
    assert.equal(rows.anc_first_contacts, 2)
    assert.equal(rows.anc_first_contact_before_12w, 1)
    assert.equal(rows.deliveries_caesarean, 1)
    assert.equal(rows.pph_500ml_plus, 1)
    assert.equal(rows.live_births, 1)
    assert.equal(rows.fresh_stillbirths, 1)
    assert.equal(rows.low_birth_weight, 1)
    await as(db, REC)
    await refused(db.query('select * from programme_summary($1, $2, $3)', [H1, d(-30), d(1)]), /Clinical access/)
  })
  it('is safe to run twice', async () => {
    await as(db, null)
    await db.exec(MIG)
  })
})
