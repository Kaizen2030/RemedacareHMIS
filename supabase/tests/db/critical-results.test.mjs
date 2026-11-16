// Critical results loop, drug–lab alerts and TDM: supabase/migrations/20261222000000_critical_results.sql.
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
const result = (db, patient, template, values) => one(db, `insert into lab_tests(hospital_id, patient_id, patient_name, test_type, ordered_by, result_template_key, result_json, resulted_at)
  values ($1, $2, $3, $4, 'Dr Achieng', $5, $6, now()) returning id`, [H1, patient, patient === JANE ? 'Jane' : 'Bob', template === 'rfts' ? 'Urea & Electrolytes' : 'Full blood count', template, JSON.stringify(values)])

describe('critical results, drug–lab alerts and TDM', () => {
  let db, js
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`insert into auth.users values ('${LAB}', 'lab@a.ke'); insert into hospital_users(user_id, hospital_id, role) values ('${LAB}', '${H1}', 'Lab Technician');
      insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', 'lab@a.ke', 'Lucy', 'Lab Technician', 'Active');
      alter table patients add column age text, add column gender text, add column date_of_birth date;
      update patients set age = '60', gender = 'Female' where id = '${JANE}'; update patients set age = '45', gender = 'Male' where id = '${BOB}';
      create table lab_tests (id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, patient_name text, test_type text, ordered_by text, visit_id uuid, category text, status text, created_at timestamptz default now());
      create table notifications(id bigserial primary key, hospital_id uuid, notification_type text, title text, message text, target_path text, payload_json jsonb);
      grant select, insert, update on lab_tests to authenticated;`)
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$ begin return p::uuid; exception when others then return null; end $$;`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/32_problem_list_order_sets.sql'))
    await db.exec(read('../../../docs/sql/34_lab_quality.sql'))
    await db.exec(read('../../migrations/20261222000000_critical_results.sql'))
    await db.exec(read('../../migrations/20261222000000_critical_results.sql'))
    js = await import('data:text/javascript,' + encodeURIComponent(read('../../../src/utils/tdm.js')))
  })

  it('the paste-ready 40 file installs and reports OK', async () => {
    const x = new PGlite()
    await x.exec(read('./stub.sql'))
    await x.exec(`create table lab_tests (id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, patient_name text, test_type text, created_at timestamptz default now());`)
    await x.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await x.exec(read('../../../docs/sql/08_hiv_tb_maternity.sql'))
    await x.exec(read('../../../docs/sql/11_audit_privacy.sql'))
    await x.exec(read('../../../docs/sql/34_lab_quality.sql'))
    const rows = (await x.exec(read('../../../docs/sql/40_critical_results.sql'))).at(-1).rows
    assert.ok(rows.length > 0 && rows.every((r) => r.result === 'OK'), JSON.stringify(rows))
  })

  it('a critical potassium creates an alert with the drug that explains it; normal results do not', async () => {
    await as(db, NURSE)
    await db.query("insert into patient_medications(hospital_id, patient_id, drug, status) values ($1, $2, 'Lisinopril 10 mg', 'active'), ($1, $2, 'Spironolactone', 'active'), ($1, $2, 'Paracetamol', 'active')", [H1, JANE])
    await as(db, LAB)
    const t = await result(db, JANE, 'rfts', { potassium: '6.9', sodium: '138' })
    await result(db, BOB, 'rfts', { potassium: '4.2', sodium: '140' })
    await as(db, NURSE)
    const a = (await db.query("select * from lab_critical_alerts where kind = 'critical'")).rows
    assert.equal(a.length, 1)
    assert.equal(a[0].lab_test_id, t.id); assert.equal(a[0].analyte, 'potassium'); assert.equal(Number(a[0].value), 6.9)
    assert.match(a[0].message, /critically high/); assert.equal(a[0].ordered_by, 'Dr Achieng')
    assert.deepEqual(a[0].drug_notes.map((n) => n.drug).sort(), ['Lisinopril 10 mg', 'Spironolactone'])
    await as(db, null)
    assert.match((await one(db, 'select title from notifications order by id desc limit 1')).title, /Critical result: Jane/)
  })

  it('notify needs read-back; the reporter cannot acknowledge; the clinician acknowledges with an action', async () => {
    await as(db, LAB)
    const a = await one(db, "select id from lab_critical_alerts where kind = 'critical'")
    await refused(db.query("select critical_notify($1, 'Sr Wanjiru', 'phone', false)", [a.id]), /read it back/)
    await refused(db.query("select critical_notify($1, ' ', 'phone', true)", [a.id]), /name/)
    await db.query("select critical_notify($1, 'Sr Wanjiru (Medical ward)', 'phone', true)", [a.id])
    await refused(db.query("select critical_acknowledge($1, 'repeat')", [a.id]), /not the person who reported/)
    await as(db, NURSE)
    await refused(db.query("select critical_acknowledge($1, ' ')", [a.id]), /action taken/)
    await db.query("select critical_acknowledge($1, 'Calcium gluconate and insulin-dextrose given; lisinopril and spironolactone held; repeat K in 2 h')", [a.id])
    const done = await one(db, 'select * from lab_critical_alerts where id = $1', [a.id])
    assert.equal(done.status, 'acknowledged'); assert.equal(done.read_back, true); assert.equal(done.acknowledged_by, NURSE)
    await refused(db.query("update lab_critical_alerts set status = 'open' where id = $1", [a.id]), /permission/)
    await as(db, REC)
    assert.equal((await db.query('select * from lab_critical_alerts')).rows.length, 0, 'reception sees no results')
  })

  it('an abnormal (not critical) result on an interacting drug gives an advisory alert', async () => {
    await as(db, NURSE)
    await db.query("insert into patient_medications(hospital_id, patient_id, drug, status) values ($1, $2, 'Gentamicin 400 mg IV', 'active'), ($1, $2, 'Digoxin 125 mcg', 'active')", [H1, BOB])
    await as(db, LAB)
    await result(db, BOB, 'rfts', { creatinine: '180', potassium: '3.1' })
    await as(db, NURSE)
    const a = (await db.query("select analyte, message, drug_notes from lab_critical_alerts where kind = 'interaction' order by analyte")).rows
    assert.deepEqual(a.map((x) => x.analyte), ['creatinine', 'potassium'])
    assert.match(a[0].drug_notes.find((n) => /Gentamicin/.test(n.drug)).message, /nephrotoxic/)
    assert.match(a[1].drug_notes[0].message, /digoxin toxicity/)
  })

  it('overdue critical alerts escalate (once per 30 minutes, up to three levels)', async () => {
    await as(db, LAB)
    await result(db, JANE, 'fbc', { platelets: '12' })
    await as(db, null)
    await db.query("update lab_critical_alerts set notify_due_at = now() - interval '1 minute' where analyte = 'platelets'")
    await as(db, NURSE)
    assert.equal((await one(db, 'select critical_escalate($1) n', [H1])).n, 1)
    assert.equal((await one(db, 'select critical_escalate($1) n', [H1])).n, 0, 'not again within 30 minutes')
    assert.equal((await one(db, "select escalation_level from lab_critical_alerts where analyte = 'platelets'")).escalation_level, 1)
    await refused(db.query('select critical_escalate(null)'), /Clinical staff only/)
    await as(db, null)
    assert.match((await one(db, "select title from notifications where title like 'ESCALATION%' limit 1")).title, /not yet reported/)
    await as(db, NURSE)
    const s = (await one(db, 'select critical_stats($1, current_date - 1, current_date) s', [H1])).s
    assert.equal(s.critical, 2); assert.equal(s.acknowledged, 1); assert.equal(s.read_back_pct, 100); assert.equal(s.escalated, 1)
  })

  it('TDM: units, timing checks, renal function, advice and a toxic level becomes a critical alert', async () => {
    await as(db, NURSE)
    const lv = (drug, sample, value, unit, extra = {}) => one(db,
      `insert into tdm_levels(hospital_id, patient_id, drug, sample, indication, value, unit, last_dose_at, next_dose_at, sample_at, weight_kg)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), $11) returning *`,
      [H1, extra.patient || BOB, drug, sample, extra.indication || 'general', value, unit, extra.last || null, extra.next || null, extra.at || null, extra.weight || null])
    const g = await lv('Gentamicin', 'trough', 2, 'mcg/mL', { next: new Date(Date.now() + 15 * 60000).toISOString(), weight: 70 })
    assert.equal(g.interpretation, 'toxic', 'trough must be < 2'); assert.match(g.advice, /hold the next dose/)
    assert.equal(Number(g.creatinine_umol), 180); assert.equal(Number(g.egfr), js.egfrCkdEpi2021(180, 45, false)); assert.equal(Number(g.crcl), js.crclCockcroftGault(180, 45, false, 70))
    const alert = await one(db, "select * from lab_critical_alerts where kind = 'tdm'")
    assert.equal(alert.tdm_level_id, g.id); assert.equal(alert.status, 'notified')
    const d = await lv('Digoxin', 'random', 1.5, 'nmol/L', { indication: 'heart failure', last: new Date(Date.now() - 3 * 3600000).toISOString() })
    assert.equal(Number(d.value_target_unit), 1.17); assert.equal(d.interpretation, 'supratherapeutic')
    assert.match(d.warnings[0], /at least 6 h/); assert.match(d.advice, /check the sample timing first/)
    const l = await lv('Lithium', 'trough', 0.8, 'mEq/L', { patient: JANE, last: new Date(Date.now() - 12 * 3600000).toISOString() })
    assert.equal(l.interpretation, 'therapeutic'); assert.deepEqual(l.warnings, ['No creatinine on record: check renal function'])
    await refused(lv('Phenytoin', 'trough', 40, 'g/L'), /not recognised/)
    const p = await lv('Phenytoin', 'trough', 40, 'µmol/L', { patient: JANE })
    assert.equal(Number(p.value_target_unit), 10.09); assert.equal(p.interpretation, 'therapeutic')
    assert.equal((await lv('Amoxicillin', 'random', 5, 'mg/L')).interpretation, 'no_target')
    await refused(db.query("update tdm_levels set value = 1 where id = $1", [g.id]), /permission/)
  })

  it('JavaScript renal function and TDM classification mirror the database', async () => {
    await as(db, null)
    for (const [cr, age, f] of [[60, 30, true], [90, 30, false], [180, 45, false], [400, 70, true], [62, 18, true], [50, 17, false]]) {
      const r = await one(db, 'select egfr_ckd_epi_2021($1, $2, $3) e, crcl_cockcroft_gault($1, $2, $3, 70) c', [cr, age, f])
      assert.equal(js.egfrCkdEpi2021(cr, age, f), r.e == null ? null : Number(r.e), `eGFR ${cr} ${age} ${f}`)
      assert.equal(js.crclCockcroftGault(cr, age, f, 70), r.c == null ? null : Number(r.c), `CrCl ${cr} ${age} ${f}`)
    }
    for (const c of [[1.9, null, 2, true, 2], [2, null, 2, true, 2], [11, 4, 12, false, 15], [13, 4, 12, false, 15], [16, 4, 12, false, 15], [3, 4, 12, false, 15]]) {
      const r = await one(db, 'select tdm_classify($1, $2, $3, $4, $5) x', c)
      assert.equal(js.tdmClassify(...c), r.x, JSON.stringify(c))
    }
    assert.equal(js.egfrCkdEpi2021(80, 50, false), 103, 'hand-checked: 142 × 1.0056^-1.2 × 0.9938^50 = 103')
  })
})
