// FHIR R4 read API core, shared by the `fhir` and `fhir-bundle` functions. No network or Deno APIs here: the
// caller passes a Supabase client (the signed-in user's, so row-level security applies, or the service client for
// API keys) and every query is also filtered by the caller's hospital. Unit-tested in supabase/tests/edge-fhir.test.ts.
import * as mappers from './mappers.ts'

// The mappers are untyped JavaScript shared with the web app
// deno-lint-ignore no-explicit-any
const M = mappers as any
const {
  createFHIRCoding, createFHIRReference, createSearchBundle, createVisitDocumentBundle, diagnosisToFHIRCondition,
  hospitalToFHIROrganization, labResultToFHIRDiagnosticReport, patientToFHIR, prescriptionToFHIRMedicationRequest,
  staffToFHIRPractitioner, visitToFHIREncounter, vitalsToFHIRObservations,
} = M

export const RESOURCE_TYPES = ['Patient', 'Encounter', 'Observation', 'Condition', 'MedicationRequest', 'DiagnosticReport', 'Immunization', 'Organization', 'Practitioner'] as const
export type ResourceType = typeof RESOURCE_TYPES[number]
/** Resources that hold clinical information about a patient (need a clinical role or an API scope). */
export const CLINICAL_TYPES: ResourceType[] = ['Patient', 'Encounter', 'Observation', 'Condition', 'MedicationRequest', 'DiagnosticReport', 'Immunization']
/** Searches on these must name one patient: no bulk download of clinical records through this API. */
const PATIENT_SCOPED: ResourceType[] = ['Encounter', 'Observation', 'Condition', 'MedicationRequest', 'DiagnosticReport', 'Immunization']
export const MAX_COUNT = 100
const DEFAULT_COUNT = 50
const KEPI_SYSTEM = 'https://remedacare.health/fhir/CodeSystem/kepi-antigen'
const KENYA_ID = 'https://health.go.ke/identifier'

export class FhirError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function operationOutcome(status: number, code: string, text: string) {
  return { resourceType: 'OperationOutcome', issue: [{ severity: status >= 500 ? 'fatal' : 'error', code, diagnostics: text }] }
}

export interface Caller {
  kind: 'user' | 'client'
  hospitalId: string
  scopes: string[]                // resource types this caller may read
  allowConfidential: boolean
  userId?: string
  clientId?: string
  name: string
}

// ---------------------------------------------------------------- routing

export interface Route { type: string | null, id: string | null, operation: string | null }

/** '/functions/v1/fhir/Patient/123/$everything' → { type: 'Patient', id: '123', operation: '$everything' } */
export function parsePath(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const at = parts.lastIndexOf('fhir')
  const rest = at >= 0 ? parts.slice(at + 1) : parts
  const [type = null, id = null, operation = null] = rest
  if (rest.length > 3) throw new FhirError(404, 'not-found', 'Unknown path.')
  if (type === 'metadata') return { type: 'metadata', id: null, operation: null }
  if (type && !(RESOURCE_TYPES as readonly string[]).includes(type)) throw new FhirError(404, 'not-supported', `Resource type ${type} is not supported. See /metadata.`)
  if (id && !/^[A-Za-z0-9\-.]{1,64}$/.test(id)) throw new FhirError(400, 'invalid', 'Invalid resource id.')
  if (operation && !(type === 'Patient' && operation === '$everything')) throw new FhirError(404, 'not-supported', `Operation ${operation} is not supported.`)
  return { type, id, operation }
}

export function canRead(caller: Caller, type: string) {
  return caller.scopes.includes(type)
}

// ---------------------------------------------------------------- search parameters

export interface Search {
  patient: string | null
  identifier: { system: string | null, value: string } | null
  name: string | null
  date: { ge?: string, lt?: string }
  category: string | null
  count: number
  offset: number
}

const ID_RE = /^[A-Za-z0-9\-.]{1,64}$/

function parseDate(values: string[]) {
  const out: { ge?: string, lt?: string } = {}
  for (const raw of values) {
    const m = /^(eq|ge|gt|le|lt)?(\d{4}-\d{2}-\d{2})(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/.exec(raw)
    if (!m) throw new FhirError(400, 'invalid', `Invalid date "${raw}". Use e.g. ge2026-01-01.`)
    const prefix = m[1] || 'eq'
    const day = m[2]
    const next = new Date(`${day}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1)
    const nextDay = next.toISOString().slice(0, 10)
    if (prefix === 'eq') { out.ge = day; out.lt = nextDay }
    if (prefix === 'ge') out.ge = day
    if (prefix === 'gt') out.ge = nextDay
    if (prefix === 'lt') out.lt = day
    if (prefix === 'le') out.lt = nextDay
  }
  return out
}

export function parseSearch(type: string, params: URLSearchParams): Search {
  const patientRaw = params.get('patient') || params.get('subject') || (type === 'Patient' ? params.get('_id') : null)
  const patient = patientRaw ? patientRaw.replace(/^Patient\//, '') : null
  if (patient && !ID_RE.test(patient)) throw new FhirError(400, 'invalid', 'Invalid patient reference.')
  const idRaw = params.get('identifier')
  let identifier = null
  if (idRaw) {
    const bar = idRaw.lastIndexOf('|')
    const value = (bar >= 0 ? idRaw.slice(bar + 1) : idRaw).trim()
    if (!value || value.length > 64) throw new FhirError(400, 'invalid', 'Invalid identifier.')
    identifier = { system: bar >= 0 ? idRaw.slice(0, bar) : null, value }
  }
  const name = params.get('name')?.trim() || null
  if (name && (name.length < 2 || name.length > 80)) throw new FhirError(400, 'invalid', 'Name search needs 2–80 characters.')
  const countRaw = Number(params.get('_count') || DEFAULT_COUNT)
  const offsetRaw = Number(params.get('_offset') || 0)
  if (!Number.isInteger(countRaw) || countRaw < 1) throw new FhirError(400, 'invalid', '_count must be a positive whole number.')
  if (!Number.isInteger(offsetRaw) || offsetRaw < 0) throw new FhirError(400, 'invalid', '_offset must be 0 or more.')
  const search: Search = {
    patient,
    identifier,
    name,
    date: parseDate(params.getAll('date')),
    category: params.get('category'),
    count: Math.min(countRaw, MAX_COUNT),
    offset: offsetRaw,
  }
  if (type === 'Patient' && !search.patient && !search.identifier && !search.name) {
    throw new FhirError(400, 'required', 'Search patients by identifier (national ID, SHA number or patient number), name or _id.')
  }
  if ((PATIENT_SCOPED as string[]).includes(type) && !search.patient) {
    throw new FhirError(400, 'required', `${type} searches must name one patient, e.g. ?patient=Patient/<id>.`)
  }
  return search
}

// ---------------------------------------------------------------- data

// deno-lint-ignore no-explicit-any
type Db = any

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

function noTable(error: { message?: string, code?: string } | null) {
  return Boolean(error && /does not exist|schema cache|Could not find/i.test(error.message || ''))
}

async function rows(query: Promise<{ data: unknown[] | null, error: { message?: string } | null, count?: number | null }>) {
  const { data, error, count } = await query
  if (error) {
    if (noTable(error)) return { data: [] as Record<string, unknown>[], count: 0 }
    throw new FhirError(500, 'exception', 'The database refused the request.')
  }
  return { data: (data || []) as Record<string, unknown>[], count: count ?? (data || []).length }
}

/** The patient, if it belongs to the caller's hospital and they may see it; otherwise a FHIR error. */
export async function requirePatient(db: Db, caller: Caller, patientId: string) {
  const { data } = await rows(db.from('patients').select('*').eq('hospital_id', caller.hospitalId).eq('id', patientId).limit(1))
  const patient = data[0]
  if (!patient) throw new FhirError(404, 'not-found', 'Patient not found.')
  if (patient.confidential && !caller.allowConfidential) {
    throw new FhirError(403, 'forbidden', 'This record is confidential. It can only be opened in RemedacareHMS with a recorded reason.')
  }
  return patient
}

function withRange(q: Db, s: Search) {
  return q.range(s.offset, s.offset + s.count - 1)
}
function withDate(q: Db, s: Search, column: string) {
  let out = q
  if (s.date.ge) out = out.gte(column, s.date.ge)
  if (s.date.lt) out = out.lt(column, s.date.lt)
  return out
}

const IDENTIFIER_COLUMNS: Record<string, string> = {
  [`${KENYA_ID}/national-id`]: 'national_id',
  [`${KENYA_ID}/sha`]: 'sha_member_no',
  'https://remedacare.health/identifier/mrn': 'patient_number',
}

async function searchPatients(db: Db, caller: Caller, s: Search) {
  let found: Record<string, unknown>[] = []
  if (s.patient) {
    found = (await rows(db.from('patients').select('*').eq('hospital_id', caller.hospitalId).eq('id', s.patient).limit(1))).data
  } else if (s.identifier) {
    const columns = s.identifier.system
      ? [IDENTIFIER_COLUMNS[s.identifier.system]].filter(Boolean)
      : ['national_id', 'sha_member_no', 'patient_number']
    if (!columns.length) throw new FhirError(400, 'not-supported', `Unknown identifier system ${s.identifier.system}.`)
    for (const column of columns) {
      // one parameterised query per column: the value never becomes part of a filter expression
      const r = await db.from('patients').select('*').eq('hospital_id', caller.hospitalId).eq(column, s.identifier.value).limit(MAX_COUNT)
      if (!r.error) found.push(...(r.data || []))
    }
    found = [...new Map(found.map((p) => [p.id, p])).values()]
  } else if (s.name) {
    found = (await rows(withRange(db.from('patients').select('*').eq('hospital_id', caller.hospitalId).ilike('full_name', `%${escapeLike(s.name)}%`).order('full_name'), s))).data
  }
  const visible = found.filter((p) => !p.confidential || caller.allowConfidential)
  return { patients: visible, hidden: found.length - visible.length }
}

function viralLoadObservation(vl: Record<string, unknown>, patientId: string) {
  const copies = Number(vl.copies_ml)
  return {
    resourceType: 'Observation',
    id: `vl-${vl.id}`,
    status: 'final',
    category: [{ coding: [createFHIRCoding('http://terminology.hl7.org/CodeSystem/observation-category', 'laboratory', 'Laboratory')] }],
    code: { coding: [createFHIRCoding('http://loinc.org', '20447-9', 'HIV 1 RNA [#/volume] (viral load) in Serum or Plasma by NAA with probe detection')], text: 'HIV viral load' },
    subject: createFHIRReference('Patient', patientId),
    effectiveDateTime: String(vl.sample_date),
    ...(copies === 0
      ? { valueString: 'Below detection limit (LDL)' }
      : { valueQuantity: { value: copies, unit: 'copies/mL', system: 'http://unitsofmeasure.org', code: '{copies}/mL' } }),
  }
}

function immunizationResource(row: Record<string, unknown>) {
  return {
    resourceType: 'Immunization',
    id: String(row.id),
    status: 'completed',
    vaccineCode: { coding: [createFHIRCoding(KEPI_SYSTEM, String(row.vaccine), String(row.vaccine))], text: String(row.vaccine) },
    patient: createFHIRReference('Patient', String(row.patient_id)),
    occurrenceDateTime: String(row.given_on),
    ...(row.batch_number ? { lotNumber: String(row.batch_number) } : {}),
    ...(row.notes ? { note: [{ text: String(row.notes) }] } : {}),
  }
}

/** Practitioner without personal identifiers or phone numbers. */
function practitionerResource(staff: Record<string, unknown>) {
  const p = staffToFHIRPractitioner(staff) as Record<string, unknown>
  return { ...p, identifier: (p.identifier as { system: string }[]).filter((i) => !i.system.includes('national-id')), telecom: [] }
}

const VITAL_SIGNS = createFHIRCoding('http://terminology.hl7.org/CodeSystem/observation-category', 'vital-signs', 'Vital Signs')

/** Run a search or read for one resource type. Returns FHIR resources plus the patient ids touched (for the access log). */
export async function runQuery(db: Db, caller: Caller, type: ResourceType, id: string | null, s: Search) {
  const h = caller.hospitalId
  const touched = new Set<string>()
  let resources: Record<string, unknown>[] = []
  let total: number | undefined
  const patient = !id && s.patient && type !== 'Patient' ? await requirePatient(db, caller, s.patient) : null
  if (patient) touched.add(String(patient.id))
  const byPatient = (table: string) => db.from(table).select('*').eq('hospital_id', h).eq('patient_id', s.patient)
  const byId = (table: string) => db.from(table).select('*').eq('hospital_id', h).eq('id', id).limit(1)

  switch (type) {
    case 'Patient': {
      if (id) {
        const p = await requirePatient(db, caller, id)
        resources = [patientToFHIR(p, h)]
      } else {
        const r = await searchPatients(db, caller, s)
        resources = r.patients.map((p) => patientToFHIR(p, h))
      }
      resources.forEach((r) => touched.add(String(r.id)))
      break
    }
    case 'Encounter': {
      const r = id ? await rows(byId('visits')) : await rows(withRange(withDate(byPatient('visits').order('created_at', { ascending: false }), s, 'created_at'), s))
      for (const v of r.data) {
        const p = patient || await requirePatient(db, caller, String(v.patient_id))
        touched.add(String(p.id))
        resources.push(visitToFHIREncounter(v, p, null, h))
      }
      total = id ? undefined : r.count
      break
    }
    case 'Observation': {
      if (id) throw new FhirError(400, 'not-supported', 'Read observations through a patient search: Observation?patient=<id>.')
      const wantVitals = !s.category || s.category === 'vital-signs'
      const wantLab = !s.category || s.category === 'laboratory'
      if (wantVitals) {
        const r = await rows(withDate(byPatient('vitals').order('recorded_at', { ascending: false }).limit(MAX_COUNT), s, 'recorded_at'))
        for (const v of r.data) {
          for (const o of vitalsToFHIRObservations(v, null, patient, h)) resources.push({ ...o, category: [{ coding: [VITAL_SIGNS] }] })
        }
      }
      if (wantLab) {
        const r = await db.from('hiv_viral_loads').select('*, hiv_art!inner(patient_id)').eq('hospital_id', h).eq('hiv_art.patient_id', s.patient).order('sample_date', { ascending: false }).limit(MAX_COUNT)
        if (!r.error) for (const vl of r.data || []) resources.push(viralLoadObservation(vl, String(s.patient)))
      }
      total = resources.length
      resources = resources.slice(s.offset, s.offset + s.count)
      break
    }
    case 'Condition': {
      const r = id ? await rows(byId('consultations')) : await rows(withRange(withDate(byPatient('consultations').order('created_at', { ascending: false }), s, 'created_at'), s))
      resources = r.data.filter((c) => c.diagnosis || c.icd10_code || c.icd_code).map((c) => diagnosisToFHIRCondition(c, patient, null, h))
      total = id ? undefined : r.count
      break
    }
    case 'MedicationRequest': {
      const r = id ? await rows(byId('prescriptions')) : await rows(withRange(withDate(byPatient('prescriptions').order('created_at', { ascending: false }), s, 'created_at'), s))
      resources = r.data.map((rx) => prescriptionToFHIRMedicationRequest(rx, null, patient, null, h))
      total = id ? undefined : r.count
      break
    }
    case 'DiagnosticReport': {
      const r = id ? await rows(byId('lab_tests')) : await rows(withRange(withDate(byPatient('lab_tests').order('ordered_at', { ascending: false }), s, 'ordered_at'), s))
      resources = r.data.map((t) => labResultToFHIRDiagnosticReport(t, patient, null, h))
      total = id ? undefined : r.count
      break
    }
    case 'Immunization': {
      const r = id ? await rows(byId('immunisations')) : await rows(withRange(withDate(byPatient('immunisations').order('given_on', { ascending: false }), s, 'given_on'), s))
      resources = r.data.map(immunizationResource)
      total = id ? undefined : r.count
      break
    }
    case 'Organization': {
      if ((id && id !== h) || s.patient) throw new FhirError(404, 'not-found', 'Only your own organisation can be read.')
      const r = await rows(db.from('hospitals').select('*').eq('id', h).limit(1))
      resources = r.data.map(hospitalToFHIROrganization)
      break
    }
    case 'Practitioner': {
      const q = db.from('staff').select('id, full_name, role, hospital_id').eq('hospital_id', h)
      const r = id ? await rows(q.eq('id', id).limit(1)) : await rows(withRange(s.name ? q.ilike('full_name', `%${escapeLike(s.name)}%`) : q.order('full_name'), s))
      resources = r.data.map(practitionerResource)
      total = id ? undefined : r.count
      break
    }
  }

  // Records read by id must still belong to a patient the caller may see
  if (id && type !== 'Patient' && type !== 'Organization' && type !== 'Practitioner') {
    const row = resources[0] as Record<string, any> | undefined
    const ref = row?.subject?.reference || row?.patient?.reference
    const pid = typeof ref === 'string' ? ref.replace('Patient/', '') : null
    if (pid) { await requirePatient(db, caller, pid); touched.add(pid) }
  }
  if (id && !resources.length) throw new FhirError(404, 'not-found', `${type}/${id} not found.`)
  return { resources, total, touched: [...touched] }
}

/** Patient/<id>/$everything: the patient and everything the caller's scopes allow. */
export async function patientEverything(db: Db, caller: Caller, patientId: string) {
  await requirePatient(db, caller, patientId)
  const s: Search = { patient: patientId, identifier: null, name: null, date: {}, category: null, count: MAX_COUNT, offset: 0 }
  const resources: Record<string, unknown>[] = []
  for (const type of ['Patient', 'Encounter', 'Condition', 'Observation', 'MedicationRequest', 'DiagnosticReport', 'Immunization'] as ResourceType[]) {
    if (!canRead(caller, type)) continue
    const r = await runQuery(db, caller, type, type === 'Patient' ? patientId : null, s)
    resources.push(...r.resources)
  }
  return { resources, touched: [patientId] }
}

/** One visit as a FHIR document bundle (referral letters). */
export async function visitDocument(db: Db, caller: Caller, visitId: string) {
  const h = caller.hospitalId
  const { data: [visit] } = await rows(db.from('visits').select('*').eq('hospital_id', h).eq('id', visitId).limit(1))
  if (!visit) throw new FhirError(404, 'not-found', 'Visit not found.')
  const patient = await requirePatient(db, caller, String(visit.patient_id))
  const byVisit = (table: string, order: string) => rows(db.from(table).select('*').eq('hospital_id', h).eq('visit_id', visitId).order(order, { ascending: false }).limit(MAX_COUNT))
  const [hospital, vitals, rx, labs, consults] = await Promise.all([
    rows(db.from('hospitals').select('*').eq('id', h).limit(1)),
    byVisit('vitals', 'recorded_at'), byVisit('prescriptions', 'created_at'), byVisit('lab_tests', 'ordered_at'), byVisit('consultations', 'created_at'),
  ])
  const bundle = createVisitDocumentBundle({
    hospital: hospitalToFHIROrganization(hospital.data[0] || { id: h }),
    patient: patientToFHIR(patient, h),
    encounter: visitToFHIREncounter(visit, patient, null, h),
    practitioner: null,
    observations: vitals.data.flatMap((v) => vitalsToFHIRObservations(v, visit, patient, h)),
    medicationRequests: rx.data.map((r) => prescriptionToFHIRMedicationRequest(r, visit, patient, null, h)),
    diagnosticReports: labs.data.map((t) => labResultToFHIRDiagnosticReport(t, patient, visit, h)),
    conditions: consults.data.filter((c) => c.diagnosis || c.icd10_code).map((c) => diagnosisToFHIRCondition(c, patient, visit, h)),
  })
  return { bundle, touched: [String(patient.id)] }
}

// ---------------------------------------------------------------- bundles & capability

export function searchSet(resources: Record<string, unknown>[], base: string, selfUrl: string, s: Search, total?: number) {
  const bundle = createSearchBundle(resources) as Record<string, any>
  bundle.id = crypto.randomUUID()
  bundle.meta = { lastUpdated: new Date().toISOString() }
  bundle.total = total ?? resources.length
  bundle.entry = resources.map((r) => ({ fullUrl: `${base}/${r.resourceType}/${r.id}`, resource: r, search: { mode: 'match' } }))
  const link = [{ relation: 'self', url: selfUrl }]
  if (total !== undefined && s.offset + s.count < total) {
    const next = new URL(selfUrl)
    next.searchParams.set('_offset', String(s.offset + s.count))
    next.searchParams.set('_count', String(s.count))
    link.push({ relation: 'next', url: next.toString() })
  }
  bundle.link = link
  return bundle
}

export function capabilityStatement(base: string) {
  const search = (names: [string, string, string][]) => names.map(([name, type, documentation]) => ({ name, type, documentation }))
  const patientParam: [string, string, string] = ['patient', 'reference', 'Required: the patient (Patient/<id>)']
  const dateParam: [string, string, string] = ['date', 'date', 'ge/gt/le/lt/eq, e.g. ge2026-01-01']
  return {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: '2026-11-14',
    publisher: 'RemedacareHMS',
    kind: 'instance',
    software: { name: 'RemedacareHMS FHIR API', version: '1.0.0' },
    implementation: { description: 'RemedacareHMS read-only FHIR R4 API', url: base },
    fhirVersion: '4.0.1',
    format: ['application/fhir+json'],
    rest: [{
      mode: 'server',
      security: {
        cors: true,
        description: 'Send an API key from Settings → FHIR API as "Authorization: Bearer rcf_…" (or X-API-Key). Staff apps may use their RemedacareHMS sign-in token with ?hospital=<id>. Every request is logged; confidential patients are withheld unless the key allows them.',
      },
      resource: [
        { type: 'Patient', interaction: [{ code: 'read' }, { code: 'search-type' }], operation: [{ name: 'everything', definition: 'http://hl7.org/fhir/OperationDefinition/Patient-everything' }],
          searchParam: search([['_id', 'token', 'Patient id'], ['identifier', 'token', `${KENYA_ID}/national-id|…, ${KENYA_ID}/sha|… or a bare value`], ['name', 'string', 'Part of the name (2+ characters)']]) },
        { type: 'Encounter', interaction: [{ code: 'read' }, { code: 'search-type' }], searchParam: search([patientParam, dateParam]) },
        { type: 'Observation', interaction: [{ code: 'search-type' }], searchParam: search([patientParam, dateParam, ['category', 'token', 'vital-signs | laboratory']]) },
        { type: 'Condition', interaction: [{ code: 'read' }, { code: 'search-type' }], searchParam: search([patientParam, dateParam]) },
        { type: 'MedicationRequest', interaction: [{ code: 'read' }, { code: 'search-type' }], searchParam: search([patientParam, dateParam]) },
        { type: 'DiagnosticReport', interaction: [{ code: 'read' }, { code: 'search-type' }], searchParam: search([patientParam, dateParam]) },
        { type: 'Immunization', interaction: [{ code: 'read' }, { code: 'search-type' }], searchParam: search([patientParam, dateParam]) },
        { type: 'Organization', interaction: [{ code: 'read' }, { code: 'search-type' }] },
        { type: 'Practitioner', interaction: [{ code: 'read' }, { code: 'search-type' }], searchParam: search([['name', 'string', 'Part of the name']]) },
      ],
    }],
  }
}
