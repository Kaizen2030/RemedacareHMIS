import { describe, expect, it } from 'vitest'
import {
  capabilityStatement, FhirError, parsePath, parseSearch, patientEverything, runQuery, searchSet, visitDocument, type Caller,
} from '../functions/_shared/fhirCore.ts'

const H = '11111111-1111-1111-1111-111111111111'
const OTHER_H = '22222222-2222-2222-2222-222222222222'

// Minimal in-memory stand-in for the supabase-js query builder
function fakeDb(tables: Record<string, any[]>) {
  const calls: string[] = []
  const from = (table: string) => {
    const filters: ((r: any) => boolean)[] = []
    let order: [string, boolean] | null = null
    let range: [number, number] | null = null
    let limit: number | null = null
    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        calls.push(`${table}.${col}=${val}`)
        if (col.includes('.')) {
          const [rel, c] = col.split('.')
          filters.push((r) => {
            const parent = (tables[rel] || []).find((p) => p.id === r[`${rel.replace(/s$/, '')}_id`] || p.id === r.art_id)
            return parent && String(parent[c]) === String(val)
          })
        } else filters.push((r) => String(r[col]) === String(val))
        return b
      },
      ilike: (col: string, pat: string) => { const needle = pat.replace(/^%|%$/g, '').toLowerCase(); filters.push((r) => String(r[col] || '').toLowerCase().includes(needle)); return b },
      gte: (col: string, v: string) => { filters.push((r) => String(r[col]) >= v); return b },
      lt: (col: string, v: string) => { filters.push((r) => String(r[col]) < v); return b },
      order: (col: string, o?: { ascending?: boolean }) => { order = [col, o?.ascending !== false]; return b },
      range: (a: number, z: number) => { range = [a, z]; return b },
      limit: (n: number) => { limit = n; return b },
      then: (res: any, rej: any) => {
        if (!(table in tables)) return Promise.resolve({ data: null, error: { message: `relation "${table}" does not exist` } }).then(res, rej)
        let out = tables[table].filter((r) => filters.every((f) => f(r)))
        if (order) { const [c, asc] = order; out = [...out].sort((x, y) => (x[c] > y[c] ? 1 : -1) * (asc ? 1 : -1)) }
        const count = out.length
        if (range) out = out.slice(range[0], range[1] + 1)
        if (limit !== null) out = out.slice(0, limit)
        return Promise.resolve({ data: out, error: null, count }).then(res, rej)
      },
    }
    return b
  }
  return { from, calls }
}

const data = () => ({
  patients: [
    { id: 'p1', hospital_id: H, full_name: 'Jane Wanjiku', national_id: '12345678', sha_member_no: 'SHA-1', gender: 'F', dob: '1990-02-01', phone: '0712000000' },
    { id: 'p2', hospital_id: H, full_name: 'Grace Secret', national_id: '87654321', confidential: true },
    { id: 'p3', hospital_id: OTHER_H, full_name: 'Jane Other', national_id: '12345678' },
  ],
  visits: [{ id: 'v1', hospital_id: H, patient_id: 'p1', status: 'Completed', visit_type: 'OPD', created_at: '2026-11-01T08:00:00Z' },
    { id: 'v9', hospital_id: H, patient_id: 'p2', status: 'Completed', created_at: '2026-11-02T08:00:00Z' }],
  vitals: [{ id: 'vt1', hospital_id: H, patient_id: 'p1', visit_id: 'v1', temperature: 37.2, bp_systolic: 130, bp_diastolic: 85, recorded_at: '2026-11-01T08:10:00Z' }],
  consultations: [{ id: 'c1', hospital_id: H, patient_id: 'p1', visit_id: 'v1', diagnosis: 'Malaria', icd10_code: 'B54', created_at: '2026-11-01T09:00:00Z' }],
  prescriptions: [{ id: 'rx1', hospital_id: H, patient_id: 'p1', visit_id: 'v1', drug_name: 'Metformin', created_at: '2026-11-01T09:10:00Z' }],
  lab_tests: [{ id: 'l1', hospital_id: H, patient_id: 'p1', visit_id: 'v1', test_type: 'CD4 count', status: 'Completed', ordered_at: '2026-11-01T09:05:00Z' }],
  immunisations: [{ id: 'i1', hospital_id: H, patient_id: 'p1', vaccine: 'MR1', given_on: '2026-10-01' }],
  hiv_art: [{ id: 'a1', hospital_id: H, patient_id: 'p1' }],
  hiv_viral_loads: [{ id: 'vl1', hospital_id: H, art_id: 'a1', sample_date: '2026-09-01', copies_ml: 0 }, { id: 'vl2', hospital_id: H, art_id: 'a1', sample_date: '2026-03-01', copies_ml: 1200 }],
  hospitals: [{ id: H, name: 'Hosp A' }, { id: OTHER_H, name: 'Hosp B' }],
  staff: [{ id: 's1', hospital_id: H, full_name: 'Dr Otieno', role: 'Doctor', national_id: '999', phone: '0700' }],
})

const ALL = ['Patient', 'Encounter', 'Observation', 'Condition', 'MedicationRequest', 'DiagnosticReport', 'Immunization', 'Organization', 'Practitioner']
const client = (over: Partial<Caller> = {}): Caller => ({ kind: 'client', hospitalId: H, scopes: ALL, allowConfidential: false, clientId: 'k1', name: 'Partner EMR', ...over })
const search = (type: string, qs: string) => parseSearch(type, new URLSearchParams(qs))
async function fails(p: Promise<unknown>, status: number) {
  try { await p } catch (e) { expect(e).toBeInstanceOf(FhirError); expect((e as FhirError).status).toBe(status); return }
  throw new Error(`expected ${status}`)
}

describe('FHIR routing and search parameters', () => {
  it('parses paths under /functions/v1/fhir', () => {
    expect(parsePath('/functions/v1/fhir/Patient/p1')).toEqual({ type: 'Patient', id: 'p1', operation: null })
    expect(parsePath('/fhir/Patient/p1/$everything')).toEqual({ type: 'Patient', id: 'p1', operation: '$everything' })
    expect(parsePath('/functions/v1/fhir/metadata').type).toBe('metadata')
    expect(parsePath('/functions/v1/fhir').type).toBe(null)
    expect(() => parsePath('/fhir/Claim')).toThrow(/not supported/)
    expect(() => parsePath("/fhir/Patient/1'or'1")).toThrow(/Invalid resource id/)
    expect(() => parsePath('/fhir/Encounter/v1/$everything')).toThrow(/not supported/)
  })
  it('requires a patient for clinical searches and an identifier or name for patients (no bulk download)', () => {
    expect(() => search('Observation', '')).toThrow(/must name one patient/)
    expect(() => search('Patient', '')).toThrow(/identifier/)
    expect(search('Observation', 'patient=Patient/p1&_count=500').count).toBe(100)
    expect(search('Patient', 'identifier=https://health.go.ke/identifier/national-id|12345678').identifier).toEqual({ system: 'https://health.go.ke/identifier/national-id', value: '12345678' })
    expect(search('Encounter', 'patient=p1&date=ge2026-01-01&date=le2026-01-31').date).toEqual({ ge: '2026-01-01', lt: '2026-02-01' })
    expect(search('Encounter', 'patient=p1&date=2026-03-05').date).toEqual({ ge: '2026-03-05', lt: '2026-03-06' })
    expect(() => search('Encounter', 'patient=p1&date=yesterday')).toThrow(/Invalid date/)
    expect(() => search('Encounter', 'patient=p1),or(id.neq.0')).toThrow(/Invalid patient/)
  })
  it('publishes a CapabilityStatement', () => {
    const cs = capabilityStatement('https://x/functions/v1/fhir')
    expect(cs.fhirVersion).toBe('4.0.1')
    expect(cs.rest[0].resource.map((r) => r.type)).toContain('Immunization')
  })
})

describe('FHIR reads', () => {
  it('finds patients by national ID only in the caller\'s hospital, with parameterised filters', async () => {
    const db = fakeDb(data())
    const r = await runQuery(db, client(), 'Patient', null, search('Patient', 'identifier=12345678'))
    expect(r.resources.map((p: any) => p.id)).toEqual(['p1'])
    expect(r.touched).toEqual(['p1'])
    expect(db.calls).toContain(`patients.hospital_id=${H}`)
    expect(db.calls).toContain('patients.national_id=12345678')
  })
  it('withholds confidential patients unless the key allows them', async () => {
    const db = fakeDb(data())
    await fails(runQuery(db, client(), 'Patient', 'p2', search('Patient', '_id=p2')), 403)
    const r = await runQuery(db, client(), 'Patient', null, search('Patient', 'name=Grace'))
    expect(r.resources).toEqual([])
    await fails(runQuery(db, client(), 'Encounter', 'v9', search('Encounter', 'patient=p1')), 403)
    const ok = await runQuery(db, client({ allowConfidential: true }), 'Patient', 'p2', search('Patient', '_id=p2'))
    expect(ok.resources[0].id).toBe('p2')
  })
  it('never returns another hospital\'s records', async () => {
    const db = fakeDb(data())
    await fails(runQuery(db, client(), 'Patient', 'p3', search('Patient', '_id=p3')), 404)
    await fails(runQuery(db, client(), 'Observation', null, search('Observation', 'patient=p3')), 404)
    await fails(runQuery(db, client(), 'Organization', OTHER_H, search('Organization', '')), 404)
  })
  it('returns vital signs and viral loads as Observations with LOINC codes', async () => {
    const r = await runQuery(fakeDb(data()), client(), 'Observation', null, search('Observation', 'patient=Patient/p1'))
    const codes = r.resources.map((o: any) => o.code.coding[0].code)
    expect(codes).toEqual(expect.arrayContaining(['8310-5', '55284-4', '20447-9']))
    const vl = r.resources.filter((o: any) => o.code.coding[0].code === '20447-9')
    expect(vl.map((o: any) => o.valueString || o.valueQuantity.value)).toEqual(['Below detection limit (LDL)', 1200])
    expect(r.resources.find((o: any) => o.code.coding[0].code === '8310-5').category[0].coding[0].code).toBe('vital-signs')
    const labOnly = await runQuery(fakeDb(data()), client(), 'Observation', null, search('Observation', 'patient=p1&category=laboratory'))
    expect(labOnly.resources).toHaveLength(2)
  })
  it('maps conditions, prescriptions, lab reports and immunisations', async () => {
    const db = fakeDb(data())
    const s = search('Condition', 'patient=p1')
    expect((await runQuery(db, client(), 'Condition', null, s)).resources[0].code.coding[0]).toMatchObject({ system: 'http://hl7.org/fhir/sid/icd-10', code: 'B54' })
    expect((await runQuery(db, client(), 'MedicationRequest', null, s)).resources[0].medicationCodeableConcept.coding[0].code).toBe('6809')
    expect((await runQuery(db, client(), 'DiagnosticReport', null, s)).resources[0].code.coding[0].code).toBe('24467-3')
    const imm = (await runQuery(db, client(), 'Immunization', null, s)).resources[0]
    expect(imm).toMatchObject({ resourceType: 'Immunization', status: 'completed', occurrenceDateTime: '2026-10-01', vaccineCode: { text: 'MR1' } })
  })
  it('hides staff national ID and phone numbers', async () => {
    const r = await runQuery(fakeDb(data()), client(), 'Practitioner', 's1', search('Practitioner', ''))
    expect(JSON.stringify(r.resources[0])).not.toMatch(/999|0700/)
  })
  it('$everything returns only what the key may read', async () => {
    const r = await patientEverything(fakeDb(data()), client({ scopes: ['Patient', 'Immunization'] }), 'p1')
    expect([...new Set(r.resources.map((x: any) => x.resourceType))].sort()).toEqual(['Immunization', 'Patient'])
  })
  it('builds a visit document bundle and pages search results', async () => {
    const { bundle, touched } = await visitDocument(fakeDb(data()), client(), 'v1')
    expect(bundle.type).toBe('document')
    expect(bundle.entry[0].resource.resourceType).toBe('Composition')
    expect(touched).toEqual(['p1'])
    await fails(visitDocument(fakeDb(data()), client(), 'v9'), 403)
    const s = search('Encounter', 'patient=p1&_count=1')
    const set = searchSet([{ resourceType: 'Encounter', id: 'v1' }], 'https://x/fhir', 'https://x/fhir/Encounter?patient=p1&_count=1', s, 3)
    expect(set.link.find((l: any) => l.relation === 'next').url).toContain('_offset=1')
  })
})
