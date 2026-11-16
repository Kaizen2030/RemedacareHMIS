// MOH 405 / 406 registers: supabase/migrations/20261210000000_maternity_registers.sql.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const JANE = '99999999-0000-0000-0000-000000000001', BOB = '99999999-0000-0000-0000-000000000002'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]

describe('MOH 405 / 406 registers', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`alter table patients add column age int, add column phone text, add column village text;
      update patients set age = 24, phone = '0712000000', village = 'Kibera' where id = '${JANE}';`)
    await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;')
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    await db.exec(`create or replace function public.ref_try_uuid(p text) returns uuid language plpgsql immutable as $$ begin return p::uuid; exception when others then return null; end $$;`)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../../docs/sql/28_maternity_registers.sql'))
    await db.exec(read('../../../docs/sql/28_maternity_registers.sql'))
  })

  it('MOH 405 lists each contact with first visit / re-visit, register columns and blank required cells', async () => {
    await as(db, NURSE)
    const g = await one(db, "insert into anc_pregnancies(hospital_id, patient_id, anc_number, lmp, gravida, parity, hiv_status, syphilis) values ($1, $2, 'ANC/26/014', current_date - 140, 2, 1, 'negative', 'negative') returning id", [H1, JANE])
    await db.query(`insert into anc_contacts(hospital_id, pregnancy_id, visit_date, bp_sys, bp_dia, weight_kg, hb, muac_cm, tb_screening, ifas_given, iptp_dose, td_dose, counselling)
      values ($1, $2, current_date - 30, 110, 70, 61, 11.5, 25, 'negative', true, 1, 1, '{birth plan,breastfeeding}')`, [H1, g.id])
    await db.query("insert into anc_contacts(hospital_id, pregnancy_id, visit_date, bp_sys, bp_dia) values ($1, $2, current_date, 150, 95)", [H1, g.id])
    const rows = (await one(db, 'select moh405_register($1, current_date - 60, current_date) r', [H1])).r
    assert.equal(rows.length, 2)
    assert.deepEqual([rows[0].serial, rows[0].visit, rows[0].anc_number, rows[0].name, rows[0].age, rows[0].residence, rows[0].phone], [1, '1st', 'ANC/26/014', 'Jane', '24', 'Kibera', '0712000000'])
    assert.equal(rows[0].bp, '110/70'); assert.equal(rows[0].hiv, 'negative'); assert.equal(rows[0].counselling, 'birth plan, breastfeeding'); assert.deepEqual(rows[0].missing, [])
    assert.equal(rows[1].visit, 'Re-visit'); assert.equal(rows[1].ga_weeks, 20)
    assert.deepEqual(rows[1].missing, ['weight', 'TB screen', 'IFAS'])
    assert.match(rows[1].risk_flags, /hypertension/)
  })

  it('MOH 406 gives one row per baby with the mother\'s details, uterotonic and blanks', async () => {
    const g = (await one(db, 'select id from anc_pregnancies limit 1')).id
    const l = await one(db, "insert into labour_admissions(hospital_id, pregnancy_id, patient_id, admitted_at) values ($1, $2, $3, now() - interval '9 hours') returning id", [H1, g, JANE])
    const d = await one(db, `insert into deliveries(hospital_id, labour_id, pregnancy_id, patient_id, delivered_at, mode, amtsl_oxytocin, blood_loss_ml, delivered_by, delivered_by_cadre)
      values ($1, $2, $3, $4, now() - interval '1 hour', 'svd', true, 350, 'Sr Achieng', 'nurse_midwife') returning id`, [H1, l.id, g, JANE])
    await db.query(`insert into newborns(hospital_id, delivery_id, sex, outcome, birth_weight_g, apgar_1, apgar_5, breastfed_1h, teo, vitamin_k, chlorhexidine) values
      ($1, $2, 'female', 'live_birth', 2400, 7, 9, true, true, true, true), ($1, $2, 'male', 'live_birth', 2300, 6, null, null, true, true, false)`, [H1, d.id])
    await db.query("insert into deliveries(hospital_id, patient_id, delivered_at, mode) values ($1, $2, now(), 'caesarean')", [H1, BOB])
    const rows = (await one(db, 'select moh406_register($1, current_date - 1, current_date) r', [H1])).r
    assert.deepEqual(rows.map((r) => r.serial), ['1a', '1b', '2'])
    const girl = rows.find((r) => r.baby_sex === 'female'), boy = rows.find((r) => r.baby_sex === 'male')   // twins: same delivery, order not fixed
    assert.equal(girl.labour_hours, 8); assert.equal(girl.uterotonic, 'oxytocin'); assert.equal(girl.anc_visits, 2); assert.equal(girl.mother_hiv, 'negative')
    assert.equal(girl.delivered_by, 'Sr Achieng — nurse_midwife'); assert.deepEqual(girl.missing, [])
    assert.deepEqual(boy.missing, ['APGAR 5', 'breastfeeding 1 h'])
    assert.deepEqual(rows[2].missing, ['blood loss', 'uterotonic', 'baby details', 'mother HIV', 'delivered by'])
  })

  it('clinical staff only', async () => {
    await as(db, REC)
    let msg = null
    try { await db.query('select moh405_register($1, current_date - 60, current_date)', [H1]) } catch (e) { msg = e.message }
    assert.match(msg || '', /clinical staff/)
  })
})
