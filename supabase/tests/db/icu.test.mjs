// ICU / HDU: supabase/migrations/20261206000000_icu.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const JANE = '99999999-0000-0000-0000-000000000001', JOHN = '99999999-0000-0000-0000-000000000002'

const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}
const entry = (db, adm, kind, data) => one(db, 'insert into icu_entries(admission_id, hospital_id, patient_id, kind, data) values ($1, $2, $3, $4, $5) returning *', [adm, H1, JANE, kind, JSON.stringify(data)])

describe('ICU / HDU', () => {
  let db, adm
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$
        begin return p::uuid; exception when others then return null; end $$;`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/24_icu.sql'))
    await db.exec(read('../../../docs/sql/24_icu.sql'))
  })

  it('scores SOFA in SI units', async () => {
    const s = async (d) => (await one(db, 'select sofa_score($1) as r', [JSON.stringify(d)])).r
    const sick = await s({ pao2: 80, fio2: 50, resp_support: true, platelets: 40, bilirubin: 110, noradrenaline: 0.2, gcs: 8, creatinine: 350 })
    assert.deepEqual(sick.parts, { respiration: 3, coagulation: 3, liver: 3, cardiovascular: 4, cns: 3, renal: 3 })
    assert.equal(sick.total, 19); assert.equal(sick.pf_ratio, 160)
    const well = await s({ pao2_kpa: 13, fio2: 0.21, platelets: 250, bilirubin: 10, map: 85, gcs: 15, creatinine: 70 })
    assert.equal(well.total, 0); assert.deepEqual(well.missing, [])
    assert.equal((await s({ pao2: 150, fio2: 0.8 })).parts.respiration, 2, 'P/F under 200 without support scores 2')
    assert.equal((await s({ urine_24h: 150 })).parts.renal, 4)
    assert.deepEqual((await s({ gcs: 15 })).missing.sort(), ['cardiovascular', 'coagulation', 'liver', 'renal', 'respiration'])
  })

  it('admits once, checks ventilator settings and infusion pump rates', async () => {
    await as(db, NURSE)
    adm = (await one(db, "insert into icu_admissions(hospital_id, patient_id, diagnosis, source, height_cm, sex, weight_kg) values ($1, $2, 'Septic shock', 'emergency', 170, 'male', 70) returning id", [H1, JANE])).id
    await refused(db.query("insert into icu_admissions(hospital_id, patient_id, diagnosis) values ($1, $2, 'x')", [H1, JANE]), /duplicate|unique/)

    const v = await entry(db, adm, 'ventilator', { mode: 'VC-AC', vt: 600, peep: 5, pplat: 32, fio2: 70, pao2: 70 })
    assert.equal(Number(v.calc.pbw), 66); assert.equal(Number(v.calc.vt_ml_kg), 9.1)
    assert.equal(Number(v.calc.driving_pressure), 27); assert.equal(Number(v.calc.pf_ratio), 100)
    for (const re of [/8 mL\/kg/, /Plateau/, /Driving/, /FiO₂/]) assert.ok(v.flags.some((f) => re.test(f)), re)
    await refused(entry(db, adm, 'ventilator', { vt: 400 }), /mode/)

    const nor = { drug: 'Noradrenaline', action: 'start', dose: 0.1, dose_unit: 'mcg/kg/min', amount: 4, volume_ml: 50 }
    await refused(entry(db, adm, 'infusion', nor), /second nurse/)
    await refused(entry(db, adm, 'infusion', { ...nor, second_checker: 'N. Wanjiru', pump_rate: 10 }), /does not match the calculated 5.3/)
    const ok = await entry(db, adm, 'infusion', { ...nor, second_checker: 'N. Wanjiru', pump_rate: 5.2 })
    assert.equal(Number(ok.calc.rate_ml_h), 5.3); assert.equal(ok.calc.high_alert, true)
    assert.equal(Number((await entry(db, adm, 'infusion', { drug: 'Paracetamol', action: 'start', dose: 1000, dose_unit: 'mg/h', amount: 1000, volume_ml: 100 })).calc.rate_ml_h), 100)
    await refused(entry(db, adm, 'infusion', { drug: 'Insulin', action: 'start', dose: 2, dose_unit: 'units/h', second_checker: 'x' }), /amount/)
    assert.ok(await entry(db, adm, 'infusion', { drug: 'Noradrenaline', action: 'stop' }))
  })

  it('flags vitals, sedation and open daily goals; entries are struck out, never edited', async () => {
    const vi = await entry(db, adm, 'vitals', { sbp: 80, dbp: 50, hr: 135, spo2: 90, urine_ml: 20, glucose: 3.2 })
    assert.equal(Number(vi.calc.map), 60); assert.equal(Number(vi.calc.urine_ml_kg_h), 0.29)
    assert.equal(vi.flags.length, 5)
    const se = await entry(db, adm, 'sedation', { rass: -4, rass_target: -1, cpot: 4, cam_icu: 'positive' })
    assert.deepEqual(se.flags, ['Deeper than the sedation target', 'Pain likely (CPOT 3 or more)', 'Delirium (CAM-ICU positive)'])
    await refused(entry(db, adm, 'sedation', { rass: 6 }), /-5 to \+4/)
    const g = await entry(db, adm, 'goals', { items: { feeding: 'yes', thromboprophylaxis: 'no', sbt: 'na' } })
    assert.deepEqual(g.calc.open, ['thromboprophylaxis'])
    const sofa = await entry(db, adm, 'sofa', { gcs: 15, platelets: 90 })
    assert.equal(sofa.calc.total, 2); assert.match(sofa.flags[0], /Not scored/)
    await refused(entry(db, adm, 'family', { member: 'Wife' }), /what was discussed/)
    await entry(db, adm, 'family', { member: 'Mary (wife)', discussed: 'Prognosis guarded; on ventilator' })

    await refused(db.query("update icu_entries set data = '{}' where id = $1", [vi.id]), /cannot be changed/)
    await refused(db.query('update icu_entries set struck_out_at = now() where id = $1', [vi.id]), /reason/)
    await db.query("update icu_entries set struck_out_at = now(), struck_out_reason = 'Wrong patient' where id = $1", [vi.id])
  })

  it('discharges with an outcome, flags readmission within 48 h, gives statistics; clinical staff only', async () => {
    await refused(db.query('update icu_admissions set discharged_at = now() where id = $1', [adm]), /where the patient went/)
    await db.query("update icu_admissions set outcome = 'ward' where id = $1", [adm])
    await refused(db.query("update icu_admissions set diagnosis = 'x' where id = $1", [adm]), /closed/)
    await refused(entry(db, adm, 'vitals', { hr: 80 }), /closed/)
    const again = await one(db, "insert into icu_admissions(hospital_id, patient_id, diagnosis) values ($1, $2, 'Re-intubated') returning readmission_48h", [H1, JANE])
    assert.equal(again.readmission_48h, true)
    const other = await one(db, "insert into icu_admissions(hospital_id, patient_id, diagnosis, unit) values ($1, $2, 'Eclampsia', 'HDU') returning readmission_48h", [H1, JOHN])
    assert.equal(other.readmission_48h, false)
    const st = (await one(db, "select icu_stats($1, current_date - 1, current_date) as r", [H1])).r
    assert.equal(st.admissions, 3); assert.equal(st.readmissions_48h, 1); assert.equal(st.ventilated, 1); assert.equal(st.still_in_unit, 2)
    assert.equal(Number(st.median_admission_sofa), 2)
    await as(db, REC)
    assert.equal((await db.query('select * from icu_admissions')).rows.length, 0)
    await refused(db.query("select icu_stats($1, current_date - 1, current_date)", [H1]), /clinical staff/)
  })
})
