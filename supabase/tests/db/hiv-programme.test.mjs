// HIV / TB programme: supabase/migrations/20261219000000_hiv_programme.sql on PGlite.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1', HTS = '00000000-0000-0000-0000-0000000000d1'
const JANE = '99999999-0000-0000-0000-000000000001', BOB = '99999999-0000-0000-0000-000000000002'
const KIM = '99999999-0000-0000-0000-000000000003', LEO = '99999999-0000-0000-0000-000000000004', MAY = '99999999-0000-0000-0000-000000000005'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
const d = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}
const hts = (db, patient, t1, t2, extra = {}) => db.query(
  'insert into hts_tests(hospital_id, patient_id, tested_on, entry_point, consent, test1_result, test2_result) values ($1, $2, $3, $4, $5, $6, $7) returning *',
  [H1, patient, extra.on || d(-10), extra.entry || 'opd', extra.consent ?? true, t1, t2 ?? null])
const visit = (db, art, on, next, screen = [false, false, false, false], extra = {}) => db.query(
  'insert into hiv_visits(art_id, visit_date, next_appointment, tb_cough, tb_fever, tb_weight_loss, tb_night_sweats, months_dispensed) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *',
  [art, on, next, ...screen, extra.months ?? 1])

describe('HIV / TB programme', () => {
  let db, js
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(PAYMENTS)
    await db.exec(`alter table patients add column age text, add column date_of_birth date, add column phone text;
      update patients set age = '30', phone = '0711000001' where id = '${JANE}'; update patients set age = '19' where id = '${BOB}';
      insert into patients(id, hospital_id, full_name, age, phone) values ('${KIM}', '${H1}', 'Kim', '40', '0711000003'), ('${LEO}', '${H1}', 'Leo', '28', null), ('${MAY}', '${H1}', 'May', '35', null);
      insert into auth.users values ('${HTS}', 'hts@a.ke');
      insert into hospital_users(user_id, hospital_id, role) values ('${HTS}', '${H1}', 'HTS Counsellor');
      insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', 'hts@a.ke', 'Hanna', 'HTS Counsellor', 'Active');`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../migrations/20261219000000_hiv_programme.sql'))
    await db.exec(read('../../migrations/20261219000000_hiv_programme.sql'))
    js = await import('data:text/javascript,' + encodeURIComponent(read('../../../src/utils/hivTb.js')))
  })

  it('the paste-ready 37 file installs and reports OK', async () => {
    const x = new PGlite()
    await x.exec(read('./stub.sql'))
    await x.exec(PAYMENTS)
    await x.exec(read('../../../docs/sql/08_hiv_tb_maternity.sql'))
    const rows = (await x.exec(read('../../../docs/sql/37_hiv_programme.sql'))).at(-1).rows
    assert.ok(rows.length > 0 && rows.every((r) => r.result === 'OK'), JSON.stringify(rows))
  })

  it('HTS: consent and the two-kit algorithm; HTS counsellors may test; reception sees nothing', async () => {
    await as(db, HTS)
    await refused(hts(db, JANE, 'reactive', 'reactive', { consent: false }), /consent/)
    await refused(hts(db, JANE, 'reactive', null), /confirmatory test/)
    await refused(hts(db, JANE, 'invalid', null), /repeat it/)
    await refused(hts(db, JANE, 'non_reactive', 'reactive'), /no confirmatory test/)
    await refused(hts(db, JANE, 'reactive', 'invalid'), /Confirmatory test invalid/)
    await refused(hts(db, JANE, 'non_reactive', null, { on: d(2) }), /future/)
    assert.equal((await hts(db, JANE, 'reactive', 'reactive')).rows[0].final_result, 'positive')
    assert.equal((await hts(db, BOB, 'non_reactive', null, { entry: 'vct' })).rows[0].final_result, 'negative')
    assert.equal((await hts(db, LEO, 'reactive', 'non_reactive', { entry: 'anc' })).rows[0].final_result, 'inconclusive')
    await as(db, REC)
    assert.equal((await db.query('select * from hts_tests')).rows.length, 0)
  })

  it('linkage: enrolling a positive client links the test; a positive for an enrolled client links at once', async () => {
    await as(db, NURSE)
    const jane = await one(db, "insert into hiv_art(hospital_id, patient_id, ccc_number, enrolled_on, art_start_date, current_regimen) values ($1, $2, '13939-00001', $3, $3, 'TLD') returning id", [H1, JANE, d(-8)])
    const t = await one(db, 'select linked_art_id, linked_on::text from hts_tests where patient_id = $1', [JANE])
    assert.equal(t.linked_art_id, jane.id); assert.equal(t.linked_on, d(-8))
    const kim = await one(db, "insert into hiv_art(hospital_id, patient_id, enrolled_on, art_start_date, current_regimen) values ($1, $2, $3, $3, 'TLD') returning id", [H1, KIM, d(-400)])
    const k = (await hts(db, KIM, 'reactive', 'reactive', { on: d(-5), entry: 'index' })).rows[0]
    assert.equal(k.linked_art_id, kim.id)
    assert.equal((await one(db, 'select linked_art_id from hts_tests where patient_id = $1', [LEO])).linked_art_id, null, 'inconclusive is never linked')
  })

  it('visits: appointment rules, the TB symptom screen and next appointment kept on the ART record', async () => {
    await as(db, NURSE)
    const jane = (await one(db, 'select id from hiv_art where patient_id = $1', [JANE])).id
    await refused(visit(db, jane, d(-8), d(-8)), /after the visit/)
    await refused(visit(db, jane, d(-8), d(250)), /more than 6 months/)
    await refused(visit(db, jane, d(-8), d(20), [false, null, null, null]), /all four TB screening questions/)
    const v = (await visit(db, jane, d(-8), d(-1), [false, true, false, false])).rows[0]
    assert.equal(v.tb_screen, 'presumptive'); assert.equal(v.hospital_id, H1)
    const none = (await visit(db, jane, d(-40), d(-30), [null, null, null, null])).rows[0]
    assert.equal(none.tb_screen, 'not_screened')
    const a = await one(db, 'select last_visit_date::text, next_appointment::text from hiv_art where id = $1', [jane])
    assert.equal(a.last_visit_date, d(-8), 'latest visit wins, not the last entered')
    assert.equal(a.next_appointment, d(-1))
    await db.query("insert into tb_episodes(hospital_id, patient_id, treatment_start) values ($1, $2, $3)", [H1, KIM, d(-20)])
    const kim = (await one(db, 'select id from hiv_art where patient_id = $1', [KIM])).id
    assert.equal((await visit(db, kim, d(-100), d(-90), [true, true, false, false], { months: 3 })).rows[0].tb_screen, 'presumptive', 'TB started after this visit')
    assert.equal((await visit(db, kim, d(-3), d(60), [true, true, false, false], { months: 3 })).rows[0].tb_screen, 'on_tb_treatment')
  })

  it('defaulters and tracing: bands, promised date, died closes the record; tracing is append-only; LTFU client returns', async () => {
    await as(db, NURSE)
    const may = await one(db, "insert into hiv_art(hospital_id, patient_id, enrolled_on, art_start_date, current_regimen) values ($1, $2, $3, $3, 'TLD') returning id", [H1, MAY, d(-300)])
    await visit(db, may.id, d(-60), d(-45))
    const leo = await one(db, "insert into hiv_art(hospital_id, patient_id, enrolled_on, art_start_date, current_regimen) values ($1, $2, $3, $3, 'TLD') returning id", [H1, LEO, d(-300)])
    await visit(db, leo.id, d(-30), d(-12))
    let list = (await one(db, 'select programme_defaulters($1) l', [H1])).l
    const band = (name) => list.find((r) => r.full_name === name)?.band
    assert.equal(band('Jane'), 'missed'); assert.equal(band('Leo'), 'defaulter'); assert.equal(band('May'), 'iit')
    assert.equal(list.find((r) => r.full_name === 'Jane').phone, '0711000001')
    const tb = list.find((r) => r.programme === 'tb')
    assert.equal(tb.full_name, 'Kim'); assert.equal(tb.band, 'interrupted'); assert.equal(tb.days, 20)
    await refused(db.query("insert into programme_tracing(programme, art_id, method, outcome) values ('hiv', $1, 'phone', 'reached_will_return')", [leo.id]), /promised/)
    await db.query("insert into programme_tracing(programme, art_id, method, outcome, promised_date) values ('hiv', $1, 'phone', 'reached_will_return', $2)", [leo.id, d(3)])
    await db.query("insert into programme_tracing(programme, art_id, method, outcome) values ('hiv', $1, 'home_visit', 'died')", [may.id])
    assert.equal((await one(db, 'select status from hiv_art where id = $1', [may.id])).status, 'died')
    await db.query("insert into programme_tracing(programme, tb_episode_id, method, outcome) values ('tb', $1, 'treatment_supporter', 'transferred_out')", [tb.record_id])
    assert.equal((await one(db, 'select outcome from tb_episodes where id = $1', [tb.record_id])).outcome, 'transferred_out')
    list = (await one(db, 'select programme_defaulters($1) l', [H1])).l
    assert.deepEqual(list.map((r) => r.full_name).sort(), ['Jane', 'Leo'])
    const l = list.find((r) => r.full_name === 'Leo')
    assert.equal(l.attempts, 1); assert.equal(l.last_trace.outcome, 'reached_will_return')
    await db.query("update programme_tracing set outcome = 'returned' where art_id = $1", [leo.id]).catch(() => {})
    await as(db, null)
    assert.equal((await one(db, 'select outcome from programme_tracing where art_id = $1', [leo.id])).outcome, 'reached_will_return')
    await as(db, NURSE)
    await db.query("update hiv_art set status = 'ltfu', status_date = $2 where id = $1", [leo.id, d(-2)])
    await visit(db, leo.id, d(-1), d(30))
    assert.equal((await one(db, 'select status from hiv_art where id = $1', [leo.id])).status, 'active', 'returned to care')
    await as(db, REC)
    await refused(db.query('select programme_defaulters($1)', [H1]), /Clinical access/)
  })

  it('indicators: cascade, TX_CURR without interruptions, TX_ML, TX_RTT, TX_PVLS, TB screening, TB/HIV', async () => {
    await as(db, NURSE)
    const jane = (await one(db, 'select id from hiv_art where patient_id = $1', [JANE])).id
    const kim = (await one(db, 'select id from hiv_art where patient_id = $1', [KIM])).id
    await db.query('insert into hiv_viral_loads(hospital_id, art_id, sample_date, copies_ml) values ($1, $2, $3, 40)', [H1, kim, d(-30)])
    await db.query("insert into tb_episodes(hospital_id, patient_id, diagnosis_date, hiv_status) values ($1, $2, $3, 'positive'), ($1, $4, $3, 'negative'), ($1, $5, $3, null)", [H1, JANE, d(-5), BOB, LEO])
    const r = (await one(db, 'select hiv_programme_indicators($1, $2, $3) r', [H1, d(-60), d(0)])).r
    const ind = Object.fromEntries(r.indicators.map((x) => [x.key, x]))
    assert.equal(ind.hts_tst.numerator, 4)
    assert.deepEqual([ind.hts_tst_pos.numerator, ind.hts_tst_pos.denominator, ind.hts_tst_pos.percent], [2, 4, 50])
    assert.deepEqual([ind.linked.numerator, ind.linked.denominator], [2, 2])
    assert.equal(ind.tx_new.numerator, 1, 'Jane started in the period')
    assert.equal(ind.tx_curr.numerator, 3, 'Jane, Kim, Leo — May died')
    assert.equal(ind.tx_ml_died.numerator, 1)
    assert.equal(ind.tx_rtt.numerator, 1, 'Kim came back 87 days after a missed appointment')
    assert.deepEqual([ind.vl_coverage.numerator, ind.vl_coverage.denominator], [1, 2], 'Kim and Leo on ART 3+ months; Kim has a VL')
    assert.deepEqual([ind.tx_pvls.numerator, ind.tx_pvls.denominator, ind.tx_pvls.percent], [1, 1, 100])
    assert.deepEqual([ind.tx_tb_screened.numerator, ind.tx_tb_screened.denominator], [4, 4], 'every client seen in the window was screened at least once')
    assert.deepEqual([ind.mmd.numerator], [1])
    assert.deepEqual([ind.tb_hiv_known.numerator, ind.tb_hiv_known.denominator], [2, 4], 'Kim (today) and Leo unknown')
    assert.deepEqual([ind.tb_hiv_art.numerator, ind.tb_hiv_art.denominator], [1, 1])
    assert.deepEqual(r.cascade.map((s) => s.value), [4, 2, 2, 2, 3, 1, 1])
    assert.equal(r.by_entry_point.find((e) => e.entry_point === 'index').yield, 100)
  })

  it('JavaScript mirrors give the same answers as the database', async () => {
    await as(db, null)
    const kits = ['reactive', 'non_reactive', 'invalid', null]
    for (const a of kits.slice(0, 3)) for (const b of kits) {
      const { r } = await one(db, 'select hts_final_result($1, $2) r', [a, b])
      assert.equal(js.htsFinalResult(a, b), r, `${a}/${b}`)
    }
    const v = [true, false, null]
    for (const c of v) for (const f of v) for (const w of v) for (const n of v) for (const t of [false, true]) {
      const { r } = await one(db, 'select tb_screen_result($1, $2, $3, $4, $5) r', [c, f, w, n, t])
      assert.equal(js.tbScreenResult({ cough: c, fever: f, weightLoss: w, nightSweats: n }, t), r, `${c}${f}${w}${n}${t}`)
    }
    for (const days of [null, -3, 0, 1, 7, 8, 30, 31, 400]) {
      const { r } = await one(db, 'select hiv_defaulter_band($1) r', [days])
      assert.equal(js.defaulterBand(days), r, String(days))
    }
  })
})
