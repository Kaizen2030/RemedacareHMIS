// Microbiology surveillance: supabase/migrations/20261221000000_microbiology.sql on PGlite.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const H1 = '11111111-1111-1111-1111-111111111111'
const NURSE = '00000000-0000-0000-0000-0000000000c1', REC = '00000000-0000-0000-0000-0000000000a1'
const JANE = '99999999-0000-0000-0000-000000000001', BOB = '99999999-0000-0000-0000-000000000002'
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0]
const d = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}
const BASE = `
  alter table patients add column patient_number text, add column gender text, add column age text, add column date_of_birth date;
  update patients set patient_number = 'P-001', gender = 'Female', age = '34' where id = '${JANE}';
  update patients set patient_number = 'P-002', gender = 'Male', age = '61' where id = '${BOB}';
  create table notifications(id bigserial primary key, hospital_id uuid, notification_type text, title text, message text, target_path text, payload_json jsonb);
  create table admissions(id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, admission_date timestamptz, discharge_date timestamptz, status text);
  create table microbiology_results(id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, visit_id uuid, sample_type text,
    collection_date date, organism_identified text, ward_department text, esbl boolean, mrsa boolean, ceftriaxone text, ampicillin text, ciprofloxacin text,
    susceptibility_profile jsonb, created_at timestamptz default now());
  grant select, insert, update, delete on microbiology_results to authenticated;
  insert into microbiology_results(hospital_id, patient_id, sample_type, collection_date, organism_identified, ward_department, ceftriaxone, ampicillin, susceptibility_profile)
  values ('${H1}', '${JANE}', 'Urine (MSU)', current_date - 20, 'E. coli', 'Medical', 'R', 'R', '{"meropenem": {"label": "Meropenem", "sir": "S"}}'),
         ('${H1}', '${BOB}', 'Blood', current_date - 20, 'No growth', 'ICU', null, null, null);
`

describe('microbiology surveillance', () => {
  let db, js
  const iso = async (org, spec = 'blood', extra = {}) => (await one(db,
    `insert into micro_isolates(hospital_id, patient_id, specimen_no, specimen_type, specimen_date, ward, organism_code, organism_name, phenotype)
     values ($1, $2, $3, $4, $5, $6, $7, '', $8) returning id`,
    [H1, extra.patient || JANE, extra.no || null, spec, extra.date || d(-1), extra.ward || 'ICU', org, JSON.stringify(extra.phenotype || {})])).id
  const ast = (id, abx, method, raw, sir = null) => db.query('insert into micro_ast(isolate_id, hospital_id, antibiotic, method, raw_value, entered_sir) values ($1, $2, $3, $4, $5, $6)', [id, H1, abx, method, raw, sir])
  const res = async (id) => Object.fromEntries((await db.query('select antibiotic, interpretation, reported_sir, rule from micro_ast where isolate_id = $1', [id])).rows.map((r) => [r.antibiotic, r]))
  const get = (id) => one(db, 'select * from micro_isolates where id = $1', [id])

  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(PAYMENTS)
    await db.exec(BASE)
    await db.exec(read('../../migrations/20261119000000_hiv_tb_maternity.sql'))
    await db.exec(read('../../migrations/20261221000000_microbiology.sql'))
    await db.exec(read('../../migrations/20261221000000_microbiology.sql'))
    js = await import('data:text/javascript,' + encodeURIComponent(read('../../../src/utils/microbiology.js')))
  })

  it('the paste-ready 39 file installs and reports OK', async () => {
    const x = new PGlite()
    await x.exec(read('./stub.sql'))
    await x.exec(PAYMENTS)
    await x.exec(read('../../../docs/sql/08_hiv_tb_maternity.sql'))
    const rows = (await x.exec(read('../../../docs/sql/39_microbiology.sql'))).at(-1).rows
    assert.ok(rows.length > 0 && rows.every((r) => r.result === 'OK' || /isolates/.test(r.result)), JSON.stringify(rows))
  })

  it('old microbiology results become isolates (no growth skipped); new ones follow', async () => {
    await as(db, null)
    const old = (await db.query("select * from micro_isolates where source = 'legacy'")).rows
    assert.equal(old.length, 1)
    assert.equal(old[0].organism_code, 'eco'); assert.equal(old[0].specimen_type, 'urine')
    const r = await res(old[0].id)
    assert.equal(r.CRO.reported_sir, 'R'); assert.equal(r.MEM.reported_sir, 'S')
    assert.ok(old[0].flags.includes('ESBL probable'))
    await as(db, NURSE)
    await db.query("insert into microbiology_results(hospital_id, patient_id, sample_type, organism_identified, ciprofloxacin) values ($1, $2, 'Pus swab', 'Staphylococcus aureus', 'S')", [H1, BOB])
    assert.equal((await one(db, "select count(*)::int n from micro_isolates where source = 'legacy'")).n, 2)
  })

  it('EUCAST interpretation from MIC and zone; CSF uses meningitis breakpoints; intrinsic resistance overrides', async () => {
    await as(db, NURSE)
    const e = await iso('eco', 'blood')
    await ast(e, 'CRO', 'mic', '2'); await ast(e, 'CAZ', 'disk', '20'); await ast(e, 'MEM', 'mic', '<=0.06'); await ast(e, 'CIP', 'mic', '>2'); await ast(e, 'AMC', 'mic', '>=4')
    let r = await res(e)
    assert.equal(r.CRO.interpretation, 'I', 'MIC 2: S <= 1, R > 2'); assert.equal(r.CAZ.interpretation, 'I', 'zone 20: S >= 22, R < 19')
    assert.equal(r.MEM.interpretation, 'S'); assert.equal(r.CIP.interpretation, 'R'); assert.equal(r.AMC.interpretation, null, '>=4 cannot be decided against 8')
    assert.match(r.CRO.rule, /EUCAST 16.1/)
    const c = await iso('eco', 'csf')
    await ast(c, 'CRO', 'mic', '2')
    assert.equal((await res(c)).CRO.interpretation, 'R', 'meningitis: R > 1')
    const k = await iso('kpn', 'urine')
    await ast(k, 'AMP', 'sir', null, 'S')
    r = await res(k)
    assert.equal(r.AMP.reported_sir, 'R'); assert.match(r.AMP.rule, /intrinsic/)
    assert.match((await get(k)).warnings[0], /intrinsically resistant/)
    await refused(ast(k, 'XYZ', 'mic', '1'), /Unknown antibiotic/)
    await refused(ast(k, 'CIP', 'mic', 'abc'), /Cannot read/)
    await refused(db.query("update micro_ast set interpretation = 'S' where isolate_id = $1", [k]), /permission/)
  })

  it('expert rules: MRSA (beta-lactams reported R, MDR, alert), ESBL, CRE, MDR / XDR', async () => {
    await as(db, NURSE)
    const s = await iso('sau', 'wound', { ward: 'Surgical' })
    await ast(s, 'FOX', 'disk', '18'); await ast(s, 'AMC', 'sir', null, 'S'); await ast(s, 'VAN', 'mic', '1'); await ast(s, 'CLI', 'disk', '25')
    const si = await get(s)
    assert.ok(si.flags.includes('MRSA')); assert.ok(si.flags.includes('MDR'))
    const r = await res(s)
    assert.equal(r.AMC.reported_sir, 'R'); assert.match(r.AMC.rule, /methicillin resistant/); assert.equal(r.VAN.reported_sir, 'S')
    await as(db, null)
    assert.match((await one(db, "select title from notifications order by id desc limit 1")).title, /MRSA/)
    await as(db, NURSE)
    const k = await iso('kpn', 'blood', { patient: BOB })
    for (const [abx, v] of [['CTX', '>4'], ['CAZ', '16'], ['FEP', '16'], ['MEM', '16'], ['ETP', '2'], ['IPM', '8'], ['CIP', '4'], ['GEN', '8'], ['AMK', '32'], ['TOB', '8'], ['SXT', '8'], ['TZP', '64'], ['ATM', '32'], ['COL', '0.5']]) await ast(k, abx, 'mic', v)
    const ki = await get(k)
    assert.ok(ki.flags.includes('ESBL probable')); assert.ok(ki.flags.includes('CRE'))
    assert.equal(ki.mdr_class, 'possible XDR', 'only colistin susceptible, but 8 of 16 categories untested'); assert.ok(ki.flags.includes('MDR'))
    const p = await iso('pae', 'sputum')
    await ast(p, 'MEM', 'mic', '16'); await ast(p, 'CAZ', 'mic', '1'); await ast(p, 'CIP', 'mic', '0.25')
    const pi = await get(p)
    assert.ok(pi.flags.includes('CRPA')); assert.equal(pi.mdr_class, 'insufficient', 'only 3 of 8 categories tested')
    const e = await iso('efm', 'blood')
    await ast(e, 'VAN', 'disk', '8')
    assert.ok((await get(e)).flags.includes('VRE'))
    const d = await iso('sau', 'wound', { patient: BOB, phenotype: { d_test: '+' } })
    await ast(d, 'CLI', 'disk', '25')
    assert.equal((await res(d)).CLI.reported_sir, 'R'); assert.ok((await get(d)).flags.includes('iMLSB'))
  })

  it('hospital (e.g. CLSI) breakpoint rows take precedence; final isolates are locked', async () => {
    await as(db, NURSE)
    await db.query("insert into micro_breakpoints(hospital_id, guideline, version, bp_group, antibiotic, method, s, r) values ($1, 'CLSI', 'M100-Ed36', 'ENT', 'CRO', 'mic', 1, 2)", [H1])
    const e = await iso('eco', 'blood', { patient: BOB })
    await ast(e, 'CRO', 'mic', '4')
    const cro = (await res(e)).CRO
    assert.equal(cro.rule, 'CLSI M100-Ed36'); assert.equal(cro.interpretation, 'R')
    await db.query("update micro_isolates set status = 'final' where id = $1", [e])
    await refused(db.query("update micro_isolates set organism_code = 'kpn' where id = $1", [e]), /final/)
  })

  it('antibiogram counts the first isolate per patient per organism and flags small numbers', async () => {
    await as(db, NURSE)
    const a = (await one(db, 'select micro_antibiogram($1, $2, $3) a', [H1, d(-60), d(0)])).a
    const eco = a.organisms.find((o) => o.organism_code === 'eco')
    assert.equal(eco.isolates, 2, 'Jane (3 E. coli) and Bob count once each')
    assert.equal(eco.low_n, true)
    assert.equal(eco.antibiotics.CRO.n, 2)
    const kpn = a.organisms.find((o) => o.organism_code === 'kpn')
    assert.equal(kpn.antibiotics.AMP, undefined, 'intrinsic resistance left out')
    const icu = (await one(db, 'select micro_antibiogram($1, $2, $3, $4) a', [H1, d(-60), d(0), JSON.stringify({ ward: 'Surgical' })])).a
    assert.deepEqual(icu.organisms.map((o) => o.organism_code), ['sau'])
  })

  it('cluster signal: three MRSA patients on one ward in 14 days', async () => {
    await as(db, null)
    await db.exec(`insert into patients(id, hospital_id, full_name) values ('99999999-0000-0000-0000-000000000003', '${H1}', 'Kim'), ('99999999-0000-0000-0000-000000000004', '${H1}', 'Leo')`)
    await as(db, NURSE)
    for (const p of ['99999999-0000-0000-0000-000000000003', '99999999-0000-0000-0000-000000000004']) {
      const s = await iso('sau', 'wound', { patient: p, ward: 'Surgical' })
      await ast(s, 'FOX', 'disk', '15')
    }
    const c = (await one(db, 'select micro_cluster_alerts($1) c', [H1])).c
    const m = c.find((x) => x.pattern === 'MRSA')
    assert.equal(m.ward, 'Surgical'); assert.equal(m.patients, 3)
  })

  it('WHONET rows use WHONET codes and fields, de-identified by default', async () => {
    await as(db, NURSE)
    const rows = (await one(db, 'select micro_whonet_rows($1, $2, $3) r', [H1, d(-60), d(0)])).r
    const csf = rows.find((r) => r.SPEC_TYPE === 'sf')
    assert.equal(csf.ORGANISM, 'eco'); assert.equal(csf.SEX, 'F'); assert.match(csf.PATIENT_ID, /^[0-9a-f]{32}$/)
    const e = rows.find((r) => r.results.some((x) => x.field === 'CAZ_ED10'))
    assert.equal(e.results.find((x) => x.field === 'CAZ_ED10').value, '20')
    assert.equal(e.results.find((x) => x.field === 'MEM_EM').value, '<=0.06')
    const named = (await one(db, 'select micro_whonet_rows($1, $2, $3, true) r', [H1, d(-60), d(0)])).r
    assert.ok(named.some((r) => r.PATIENT_ID === 'P-001'))
    const csv = js.buildWhonetCsv(rows, 'KNH')
    assert.match(csv.split('\r\n')[0], /^LABORATORY,PATIENT_ID,.*,CAZ_ED10/)
  })

  it('instrument import: maps codes, matches patients, reports what is unmapped', async () => {
    await as(db, NURSE)
    await db.query("insert into micro_instrument_maps(hospital_id, instrument, kind, external_code, internal_code) values ($1, 'VITEK2', 'antibiotic', 'AM', 'AMP'), ($1, 'VITEK2', 'organism', 'ESCCOL', 'eco')", [H1])
    const payload = [{ specimen_no: 'M-2611-01', patient_number: 'P-002', specimen_type: 'ur', specimen_date: d(-2), organism: 'ESCCOL',
      results: [{ code: 'AM', value: '>=32', sir: 'R' }, { code: 'CIP', value: '<=0.25', sir: 'S' }, { code: 'ZZQ', value: '1' }] },
      { specimen_no: 'M-2611-02', patient_number: 'P-999', organism: 'UNKNOWNBUG', results: [] }]
    const out = (await one(db, "select micro_import($1, 'VITEK2', $2) r", [H1, JSON.stringify(payload)])).r
    assert.equal(out.created, 1); assert.equal(out.skipped, 1)
    assert.deepEqual(out.unmapped.map((u) => u.code).sort(), ['UNKNOWNBUG', 'ZZQ'])
    const i = await one(db, "select * from micro_isolates where specimen_no = 'M-2611-01'")
    assert.equal(i.patient_id, BOB); assert.equal(i.specimen_type, 'urine'); assert.equal(i.source, 'import')
    const r = await res(i.id)
    assert.equal(r.AMP.reported_sir, 'R'); assert.equal(r.CIP.interpretation, 'S')
    const again = (await one(db, "select micro_import($1, 'VITEK2', $2) r", [H1, JSON.stringify(payload.slice(0, 1))])).r
    assert.equal(again.updated, 1, 're-importing the same specimen updates it')
  })

  it('only clinical staff see isolates and run reports', async () => {
    await as(db, REC)
    assert.equal((await db.query('select * from micro_isolates')).rows.length, 0)
    await refused(db.query('select micro_antibiogram($1, $2, $3)', [H1, d(-60), d(0)]), /Clinical access/)
    assert.ok((await db.query('select * from micro_breakpoints where hospital_id is null')).rows.length > 200, 'EUCAST defaults are readable')
  })

  it('JavaScript parsing and S/I/R mirror the database', async () => {
    await as(db, null)
    for (const raw of ['<=0.25', '≤ 0.25', '>16', '>= 32', '0.5', '4*', 'R', '', '=2']) {
      const r = await one(db, 'select (micro_parse_value($1)).*', [raw])
      const j = js.parseAstValue(raw)
      assert.deepEqual([j.comparator, j.value], [r.comparator, r.value == null ? null : Number(r.value)], raw)
    }
    for (const [m, c, v, s, r] of [['mic', '=', 1, 1, 2], ['mic', '=', 2, 1, 2], ['mic', '=', 4, 1, 2], ['mic', '<=', 0.5, 1, 2], ['mic', '<=', 2, 1, 2], ['mic', '>', 2, 1, 2], ['mic', '>', 1, 1, 2], ['mic', '>=', 2, 1, 2], ['mic', '>=', 4, 1, 2], ['disk', '=', 22, 22, 19], ['disk', '=', 20, 22, 19], ['disk', '=', 18, 22, 19]]) {
      const db1 = (await one(db, 'select micro_sir($1, $2, $3, $4, $5) r', [m, c, v, s, r])).r
      assert.equal(js.sirFromBreakpoint(m, c, v, s, r), db1, `${m} ${c}${v} ${s}/${r}`)
    }
  })
})
