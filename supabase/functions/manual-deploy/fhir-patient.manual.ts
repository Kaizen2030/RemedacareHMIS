import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const KENYA_ID_SYSTEM = 'https://health.go.ke/identifier'
const REMEDACARE_ID_SYSTEM = 'https://remedacare.health/identifier'

const DRUG_SNOMED_RXNORM = {
  'artemether-lumefantrine': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '197361', display: 'Artemether / Lumefantrine' },
  'amoxicillin': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '723', display: 'Amoxicillin' },
  'co-trimoxazole': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '10831', display: 'Sulfamethoxazole / Trimethoprim' },
  'metformin': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '6809', display: 'Metformin' },
  'amlodipine': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '17767', display: 'Amlodipine' },
  'lisinopril': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '29046', display: 'Lisinopril' },
  'losartan': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '52175', display: 'Losartan' },
  'warfarin': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '11289', display: 'Warfarin' },
  'aspirin': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '1191', display: 'Aspirin' },
  'tenofovir': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '1147521', display: 'Tenofovir' },
  'dolutegravir': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '1659151', display: 'Dolutegravir' },
  'efavirenz': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '301542', display: 'Efavirenz' },
  'isoniazid': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '6038', display: 'Isoniazid' },
  'rifampicin': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '9384', display: 'Rifampicin' },
  'insulin': { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '5856', display: 'Insulin' },
}

const LAB_LOINC = {
  'cd4 count': createFHIRCoding('http://loinc.org', '8123-2', 'CD4 cells [#/volume] in Blood'),
  'viral load': createFHIRCoding('http://loinc.org', '25836-8', 'HIV 1 RNA [#/volume]'),
  'hba1c': createFHIRCoding('http://loinc.org', '4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood'),
  'fasting glucose': createFHIRCoding('http://loinc.org', '1558-6', 'Glucose [Mass/volume] in Serum or Plasma --Fasting'),
  'random glucose': createFHIRCoding('http://loinc.org', '2345-7', 'Glucose [Mass/volume] in Serum or Plasma'),
  'creatinine': createFHIRCoding('http://loinc.org', '2160-0', 'Creatinine [Mass/volume] in Serum or Plasma'),
  'lft': createFHIRCoding('http://loinc.org', '24323-8', 'Comprehensive metabolic 2000 panel'),
  'genexpert': createFHIRCoding('http://loinc.org', '62467-6', 'Mycobacterium tuberculosis DNA [Presence] in Specimen by NAA with probe detection'),
  'full hemogram': createFHIRCoding('http://loinc.org', '57021-8', 'CBC W Auto Differential panel - Blood'),
  'urea and electrolytes': createFHIRCoding('http://loinc.org', '24321-2', 'Basic metabolic 2000 panel'),
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function makeSlug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function splitName(fullName) {
  const safe = String(fullName || '').trim().replace(/\s+/g, ' ')
  if (!safe) return { text: '', family: '', given: [] }
  const parts = safe.split(' ')
  return {
    text: safe,
    family: parts.length > 1 ? parts[parts.length - 1] : parts[0],
    given: parts.length > 1 ? parts.slice(0, -1) : [parts[0]],
  }
}

function deriveBirthDate(dateOfBirth, age) {
  if (dateOfBirth) {
    const parsed = new Date(dateOfBirth)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  }
  const ageNumber = Number(age)
  if (!Number.isFinite(ageNumber) || ageNumber <= 0) return undefined
  const currentYear = new Date().getFullYear()
  return `${currentYear - ageNumber}-01-01`
}

function mapGender(gender) {
  const value = normalizeText(gender)
  if (value.startsWith('m')) return 'male'
  if (value.startsWith('f')) return 'female'
  if (value === 'other') return 'other'
  return 'unknown'
}

function encodeInternalIdentifier(resourceType, id) {
  return `${REMEDACARE_ID_SYSTEM}/${resourceType}`
}

function createFHIRReference(resourceType, id, display) {
  return {
    reference: `${resourceType}/${id}`,
    ...(display ? { display } : {}),
  }
}

function createFHIRCoding(system, code, display) {
  return {
    system,
    ...(code ? { code } : {}),
    ...(display ? { display } : {}),
  }
}

function createKenyaIdentifiers(patient) {
  const identifiers = [
    { system: encodeInternalIdentifier('Patient', patient.id), value: String(patient.id || '') },
  ]
  if (patient?.national_id) {
    identifiers.push({ system: `${KENYA_ID_SYSTEM}/national-id`, value: String(patient.national_id) })
  }
  if (patient?.sha_member_no) {
    identifiers.push({ system: `${KENYA_ID_SYSTEM}/sha`, value: String(patient.sha_member_no) })
  }
  if (patient?.patient_number || patient?.patient_no || patient?.mrn) {
    identifiers.push({ system: `${REMEDACARE_ID_SYSTEM}/mrn`, value: String(firstDefined(patient.patient_number, patient.patient_no, patient.mrn)) })
  }
  return identifiers.filter(item => item.value)
}

function patientToFHIR(patient, hospitalId) {
  const name = splitName(patient?.full_name)
  return {
    resourceType: 'Patient',
    id: String(patient?.id || ''),
    meta: {
      profile: ['http://hl7.org/fhir/StructureDefinition/Patient'],
      tag: [createFHIRCoding(encodeInternalIdentifier('hospital', hospitalId), String(hospitalId), 'Brightpath Travel Scholars Hospital Scope')],
    },
    identifier: createKenyaIdentifiers(patient),
    name: [{
      use: 'official',
      text: name.text,
      family: name.family,
      given: name.given,
    }],
    gender: mapGender(patient?.gender),
    ...(deriveBirthDate(patient?.date_of_birth || patient?.dob, patient?.age) ? { birthDate: deriveBirthDate(patient?.date_of_birth || patient?.dob, patient?.age) } : {}),
    telecom: patient?.phone ? [{ system: 'phone', value: String(patient.phone), use: 'mobile' }] : [],
    address: [{
      text: String(patient?.address || patient?.location || ''),
      country: 'KE',
    }],
    extension: [
      {
        url: 'http://hl7.org/fhir/StructureDefinition/patient-nationality',
        valueCodeableConcept: {
          coding: [createFHIRCoding('urn:iso:std:iso:3166', 'KE', 'Kenya')],
        },
      },
      ...(patient?.blood_group ? [{
        url: 'https://remedacare.health/fhir/StructureDefinition/blood-group',
        valueString: String(patient.blood_group),
      }] : []),
      ...(patient?.allergies ? [{
        url: 'https://remedacare.health/fhir/StructureDefinition/allergies',
        valueString: String(patient.allergies),
      }] : []),
    ],
    managingOrganization: createFHIRReference('Organization', hospitalId, 'Brightpath Travel Scholars Facility'),
  }
}

function mapEncounterClass(visitType) {
  const value = normalizeText(visitType)
  if (value.includes('inpatient') || value.includes('admission') || value.includes('ward') || value.includes('ipd')) {
    return createFHIRCoding('http://terminology.hl7.org/CodeSystem/v3-ActCode', 'IMP', 'inpatient encounter')
  }
  return createFHIRCoding('http://terminology.hl7.org/CodeSystem/v3-ActCode', 'AMB', 'ambulatory')
}

function mapEncounterStatus(status) {
  const value = normalizeText(status)
  if (['completed', 'discharged', 'closed'].includes(value)) return 'finished'
  if (['cancelled', 'cancelled visit', 'canceled'].includes(value)) return 'cancelled'
  if (['arrived', 'triage', 'lab', 'doctor', 'pharmacy', 'billing', 'active', 'admitted'].includes(value)) return 'in-progress'
  return 'planned'
}

function visitToFHIREncounter(visit, patient, practitioner, hospitalId) {
  return {
    resourceType: 'Encounter',
    id: String(visit?.id || ''),
    identifier: [
      { system: `${REMEDACARE_ID_SYSTEM}/encounter`, value: String(firstDefined(visit?.visit_number, visit?.id, '')) },
    ],
    status: mapEncounterStatus(visit?.status),
    class: mapEncounterClass(visit?.visit_type),
    type: [{
      text: String(firstDefined(visit?.speciality, visit?.visit_type, visit?.chief_complaint, 'Clinical visit')),
    }],
    subject: createFHIRReference('Patient', patient?.id || visit?.patient_id, patient?.full_name),
    participant: practitioner?.id ? [{
      individual: createFHIRReference('Practitioner', practitioner.id, practitioner.full_name || practitioner.name || practitioner.email || 'Practitioner'),
    }] : [],
    serviceProvider: createFHIRReference('Organization', hospitalId, firstDefined(visit?.hospital_name, 'Brightpath Travel Scholars Facility')),
    period: {
      start: firstDefined(visit?.created_at, visit?.visit_date, new Date().toISOString()),
      ...(firstDefined(visit?.discharged_at, visit?.discharge_date, visit?.updated_at) ? { end: firstDefined(visit?.discharged_at, visit?.discharge_date, visit?.updated_at) } : {}),
    },
    reasonCode: visit?.chief_complaint ? [{ text: String(visit.chief_complaint) }] : [],
    location: visit?.ward ? [{ location: { display: `${visit.ward}${visit.bed_no ? ` Bed ${visit.bed_no}` : ''}` } }] : [],
  }
}

function buildObservation({ id, code, display, patientId, patientName, encounterId, effectiveDateTime, value, unit, valueType = 'Quantity' }) {
  const resource = {
    resourceType: 'Observation',
    id,
    status: 'final',
    code: {
      coding: [createFHIRCoding('http://loinc.org', code, display)],
      text: display,
    },
    subject: createFHIRReference('Patient', patientId, patientName),
    encounter: encounterId ? createFHIRReference('Encounter', encounterId) : undefined,
    effectiveDateTime,
  }
  if (valueType === 'String') {
    resource.valueString = String(value)
  } else {
    resource.valueQuantity = { value: Number(value), unit }
  }
  return resource
}

function vitalsToFHIRObservations(vitals, visit, patient, hospitalId) {
  const patientId = patient?.id || vitals?.patient_id || visit?.patient_id
  const patientName = patient?.full_name || vitals?.patient_name || ''
  const encounterId = visit?.id || vitals?.visit_id
  const effectiveDateTime = firstDefined(vitals?.recorded_at, vitals?.created_at, new Date().toISOString())
  const resources = []

  if (firstDefined(vitals?.temperature_c, vitals?.temperature)) {
    resources.push(buildObservation({
      id: `${vitals.id || encounterId}-temp`,
      code: '8310-5',
      display: 'Body temperature',
      patientId,
      patientName,
      encounterId,
      effectiveDateTime,
      value: firstDefined(vitals.temperature_c, vitals.temperature),
      unit: 'degC',
    }))
  }
  if (firstDefined(vitals?.pulse_bpm, vitals?.pulse)) {
    resources.push(buildObservation({
      id: `${vitals.id || encounterId}-pulse`,
      code: '8867-4',
      display: 'Heart rate',
      patientId,
      patientName,
      encounterId,
      effectiveDateTime,
      value: firstDefined(vitals.pulse_bpm, vitals.pulse),
      unit: '/min',
    }))
  }
  if (firstDefined(vitals?.spo2, vitals?.oxygen_sat)) {
    resources.push(buildObservation({
      id: `${vitals.id || encounterId}-spo2`,
      code: '59408-5',
      display: 'Oxygen saturation in Arterial blood by Pulse oximetry',
      patientId,
      patientName,
      encounterId,
      effectiveDateTime,
      value: firstDefined(vitals.spo2, vitals.oxygen_sat),
      unit: '%',
    }))
  }
  if (firstDefined(vitals?.respiratory_rate, vitals?.rr)) {
    resources.push(buildObservation({
      id: `${vitals.id || encounterId}-rr`,
      code: '9279-1',
      display: 'Respiratory rate',
      patientId,
      patientName,
      encounterId,
      effectiveDateTime,
      value: firstDefined(vitals.respiratory_rate, vitals.rr),
      unit: '/min',
    }))
  }
  if (firstDefined(vitals?.weight_kg, vitals?.weight)) {
    resources.push(buildObservation({
      id: `${vitals.id || encounterId}-weight`,
      code: '29463-7',
      display: 'Body weight',
      patientId,
      patientName,
      encounterId,
      effectiveDateTime,
      value: firstDefined(vitals.weight_kg, vitals.weight),
      unit: 'kg',
    }))
  }
  if (firstDefined(vitals?.bp_systolic, vitals?.systolic) || firstDefined(vitals?.bp_diastolic, vitals?.diastolic)) {
    resources.push({
      resourceType: 'Observation',
      id: `${vitals.id || encounterId}-bp`,
      status: 'final',
      code: {
        coding: [createFHIRCoding('http://loinc.org', '55284-4', 'Blood pressure panel with all children optional')],
        text: 'Blood pressure',
      },
      subject: createFHIRReference('Patient', patientId, patientName),
      encounter: encounterId ? createFHIRReference('Encounter', encounterId) : undefined,
      effectiveDateTime,
      component: [
        firstDefined(vitals?.bp_systolic, vitals?.systolic) ? {
          code: { coding: [createFHIRCoding('http://loinc.org', '8480-6', 'Systolic blood pressure')] },
          valueQuantity: { value: Number(firstDefined(vitals.bp_systolic, vitals.systolic)), unit: 'mmHg' },
        } : null,
        firstDefined(vitals?.bp_diastolic, vitals?.diastolic) ? {
          code: { coding: [createFHIRCoding('http://loinc.org', '8462-4', 'Diastolic blood pressure')] },
          valueQuantity: { value: Number(firstDefined(vitals.bp_diastolic, vitals.diastolic)), unit: 'mmHg' },
        } : null,
      ].filter(Boolean),
    })
  }

  return resources
}

function mapMedicationStatus(status) {
  const value = normalizeText(status)
  if (['dispensed', 'released', 'completed'].includes(value)) return 'completed'
  if (['cancelled', 'rejected'].includes(value)) return 'cancelled'
  return 'active'
}

function prescriptionToFHIRMedicationRequest(prescription, visit, patient, doctor, hospitalId) {
  const drugName = firstDefined(prescription?.drug_name, prescription?.generic_name, 'Medication')
  const codedDrug = DRUG_SNOMED_RXNORM[makeSlug(drugName)]
  return {
    resourceType: 'MedicationRequest',
    id: String(prescription?.id || ''),
    status: mapMedicationStatus(prescription?.status),
    intent: 'order',
    medicationCodeableConcept: {
      ...(codedDrug ? { coding: [createFHIRCoding(codedDrug.system, codedDrug.code, codedDrug.display)] } : {}),
      text: String(drugName),
    },
    subject: createFHIRReference('Patient', patient?.id || prescription?.patient_id, patient?.full_name || prescription?.patient_name),
    encounter: createFHIRReference('Encounter', visit?.id || prescription?.visit_id, firstDefined(visit?.visit_number, 'Clinical encounter')),
    requester: doctor?.id
      ? createFHIRReference('Practitioner', doctor.id, doctor.full_name || doctor.email || doctor.name)
      : { display: String(firstDefined(prescription?.prescribed_by, prescription?.doctor_name, 'Doctor')) },
    authoredOn: firstDefined(prescription?.created_at, new Date().toISOString()),
    dosageInstruction: [{
      text: [prescription?.dosage, prescription?.frequency, prescription?.duration, prescription?.patient_instructions].filter(Boolean).join(' · ') || String(prescription?.dosage_instructions || ''),
      route: prescription?.route ? { text: String(prescription.route) } : undefined,
    }],
    dispenseRequest: {
      quantity: prescription?.quantity ? { value: Number(prescription.quantity), unit: 'units' } : undefined,
    },
  }
}

function labResultToFHIRDiagnosticReport(labTest, patient, visit, hospitalId) {
  const key = makeSlug(firstDefined(labTest?.test_name, labTest?.test_type))
  const loinc = LAB_LOINC[key] || null
  return {
    resourceType: 'DiagnosticReport',
    id: String(labTest?.id || ''),
    status: normalizeText(labTest?.status) === 'completed'
      ? 'final'
      : normalizeText(labTest?.status).includes('progress')
        ? 'partial'
        : 'registered',
    code: {
      ...(loinc ? { coding: [loinc] } : {}),
      text: String(firstDefined(labTest?.test_name, labTest?.test_type, 'Laboratory test')),
    },
    subject: createFHIRReference('Patient', patient?.id || labTest?.patient_id, patient?.full_name || labTest?.patient_name),
    encounter: createFHIRReference('Encounter', visit?.id || labTest?.visit_id, firstDefined(visit?.visit_number, 'Clinical encounter')),
    effectiveDateTime: firstDefined(labTest?.ordered_at, labTest?.created_at, new Date().toISOString()),
    issued: firstDefined(labTest?.results_ready_at, labTest?.updated_at, labTest?.ordered_at),
    performer: [createFHIRReference('Organization', hospitalId, 'Brightpath Travel Scholars Laboratory')],
    result: Array.isArray(labTest?.observations)
      ? labTest.observations.map((observation) => createFHIRReference('Observation', observation.id || observation.reference || `${labTest.id}-obs`, observation.label || observation.test_name))
      : [],
    conclusion: String(firstDefined(labTest?.interpretation, labTest?.notes, labTest?.result_summary, '')),
  }
}

function mapConditionStatus(value) {
  const text = normalizeText(value)
  if (['resolved', 'completed'].includes(text)) return 'resolved'
  return 'active'
}

function diagnosisToFHIRCondition(consultation, patient, visit, hospitalId) {
  const code = firstDefined(consultation?.icd10_code, consultation?.icd_code)
  const label = firstDefined(consultation?.icd10_description, consultation?.diagnosis, consultation?.assessment)
  return {
    resourceType: 'Condition',
    id: String(consultation?.id || ''),
    clinicalStatus: {
      coding: [createFHIRCoding('http://terminology.hl7.org/CodeSystem/condition-clinical', mapConditionStatus(consultation?.status), mapConditionStatus(consultation?.status))],
    },
    code: {
      coding: code ? [createFHIRCoding('http://hl7.org/fhir/sid/icd-10', String(code), String(label || code))] : [],
      text: String(label || ''),
    },
    subject: createFHIRReference('Patient', patient?.id || consultation?.patient_id, patient?.full_name),
    encounter: createFHIRReference('Encounter', visit?.id || consultation?.visit_id, firstDefined(visit?.visit_number, 'Clinical encounter')),
    recordedDate: firstDefined(consultation?.created_at, new Date().toISOString()),
    note: consultation?.notes ? [{ text: String(consultation.notes) }] : [],
  }
}

function normalizeServiceLines(invoice) {
  if (Array.isArray(invoice?.services)) return invoice.services
  try {
    const parsed = JSON.parse(invoice?.services || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function invoiceToFHIRClaim(invoice, patient, visit, hospitalId, shaClaim = null) {
  const serviceLines = normalizeServiceLines(invoice)
  const totalAmount = Number(firstDefined(shaClaim?.amount_claimed, invoice?.amount_kes, 0))
  return {
    resourceType: 'Claim',
    id: String(firstDefined(shaClaim?.id, invoice?.id, '')),
    use: 'claim',
    status: normalizeText(firstDefined(shaClaim?.status, invoice?.status, 'draft')) === 'paid' ? 'active' : 'draft',
    type: {
      coding: [createFHIRCoding('http://terminology.hl7.org/CodeSystem/claim-type', 'professional', 'Professional')],
    },
    patient: createFHIRReference('Patient', patient?.id || invoice?.patient_id, patient?.full_name || invoice?.patient_name),
    created: firstDefined(invoice?.created_at, shaClaim?.created_at, new Date().toISOString()),
    insurer: createFHIRReference('Organization', 'SHA', 'Social Health Authority'),
    provider: createFHIRReference('Organization', hospitalId, 'Brightpath Travel Scholars Facility'),
    priority: {
      coding: [createFHIRCoding('http://terminology.hl7.org/CodeSystem/processpriority', 'normal', 'Normal')],
    },
    prescription: visit?.id ? createFHIRReference('Encounter', visit.id, visit.visit_number) : undefined,
    diagnosis: firstDefined(shaClaim?.icd10_code, invoice?.diagnosis_icd10) ? [{
      sequence: 1,
      diagnosisCodeableConcept: {
        coding: [createFHIRCoding('http://hl7.org/fhir/sid/icd-10', String(firstDefined(shaClaim?.icd10_code, invoice?.diagnosis_icd10)), String(firstDefined(shaClaim?.diagnosis_label, invoice?.diagnosis_label, shaClaim?.icd10_code)))],
      },
    }] : [],
    item: serviceLines.map((line, index) => ({
      sequence: index + 1,
      productOrService: {
        text: String(firstDefined(line.label, line.name, line.source, 'Service line')),
      },
      quantity: line.qty ? { value: Number(line.qty) } : undefined,
      unitPrice: { value: Number(firstDefined(line.unitPrice, line.price, line.total, 0)), currency: 'KES' },
      net: { value: Number(firstDefined(line.total, line.unitPrice, 0)), currency: 'KES' },
    })),
    total: { value: totalAmount, currency: 'KES' },
  }
}

function hospitalToFHIROrganization(hospital) {
  return {
    resourceType: 'Organization',
    id: String(hospital?.id || ''),
    identifier: [
      { system: `${REMEDACARE_ID_SYSTEM}/hospital`, value: String(hospital?.id || '') },
      ...(hospital?.moh_facility_code ? [{ system: `${KENYA_ID_SYSTEM}/moh-facility-code`, value: String(hospital.moh_facility_code) }] : []),
      ...(hospital?.sha_provider_number ? [{ system: `${KENYA_ID_SYSTEM}/sha-provider-number`, value: String(hospital.sha_provider_number) }] : []),
    ],
    name: String(firstDefined(hospital?.name, 'Brightpath Travel Scholars Facility')),
    telecom: hospital?.phone ? [{ system: 'phone', value: String(hospital.phone) }] : [],
    address: [{
      text: String(firstDefined(hospital?.physical_address, hospital?.location, '')),
      district: String(firstDefined(hospital?.sub_county, '')),
      state: String(firstDefined(hospital?.county, '')),
      country: 'KE',
    }],
    endpoint: hospital?.fhir_base_url ? [{ address: String(hospital.fhir_base_url) }] : [],
  }
}

function staffToFHIRPractitioner(staff) {
  const name = splitName(firstDefined(staff?.full_name, staff?.name, staff?.email))
  return {
    resourceType: 'Practitioner',
    id: String(staff?.id || ''),
    identifier: [
      { system: `${REMEDACARE_ID_SYSTEM}/staff`, value: String(staff?.id || '') },
      ...(staff?.national_id ? [{ system: `${KENYA_ID_SYSTEM}/national-id`, value: String(staff.national_id) }] : []),
    ],
    name: [{
      text: name.text,
      family: name.family,
      given: name.given,
    }],
    telecom: [
      ...(staff?.phone ? [{ system: 'phone', value: String(staff.phone) }] : []),
      ...(staff?.email ? [{ system: 'email', value: String(staff.email) }] : []),
    ],
    qualification: staff?.role ? [{
      code: {
        text: String(staff.role),
      },
    }] : [],
  }
}

function createSearchBundle(entries = [], resourceType = 'Bundle') {
  return {
    resourceType,
    type: 'searchset',
    total: entries.length,
    entry: entries.map((resource) => ({
      fullUrl: `${resource.resourceType}/${resource.id}`,
      resource,
    })),
  }
}

function createVisitDocumentBundle({ hospital, patient, encounter, practitioner, observations = [], medicationRequests = [], diagnosticReports = [], conditions = [], claim = null }) {
  const baseUrl = firstDefined(hospital?.fhir_base_url, `https://fhir.remedacare.health/${hospital?.id || 'hospital'}`)
  const compositionId = `composition-${encounter?.id || patient?.id || 'visit'}`
  const composition = {
    resourceType: 'Composition',
    id: compositionId,
    status: 'final',
    type: {
      coding: [createFHIRCoding('http://loinc.org', '34133-9', 'Summarization of episode note')],
      text: 'Visit referral bundle',
    },
    subject: createFHIRReference('Patient', patient?.id, patient?.name?.[0]?.text),
    encounter: encounter?.id ? createFHIRReference('Encounter', encounter.id) : undefined,
    date: new Date().toISOString(),
    author: practitioner?.id ? [createFHIRReference('Practitioner', practitioner.id, practitioner?.name?.[0]?.text)] : [],
    title: `Brightpath Travel Scholars Visit Bundle - ${patient?.name?.[0]?.text || patient?.id}`,
    section: [
      { title: 'Vitals', entry: observations.map(item => createFHIRReference('Observation', item.id)) },
      { title: 'Prescriptions', entry: medicationRequests.map(item => createFHIRReference('MedicationRequest', item.id)) },
      { title: 'Lab reports', entry: diagnosticReports.map(item => createFHIRReference('DiagnosticReport', item.id)) },
      { title: 'Diagnoses', entry: conditions.map(item => createFHIRReference('Condition', item.id)) },
      ...(claim ? [{ title: 'Claim', entry: [createFHIRReference('Claim', claim.id)] }] : []),
    ],
  }

  const resources = [
    composition,
    hospital,
    patient,
    ...(practitioner ? [practitioner] : []),
    ...(encounter ? [encounter] : []),
    ...observations,
    ...medicationRequests,
    ...diagnosticReports,
    ...conditions,
    ...(claim ? [claim] : []),
  ].filter(Boolean)

  return {
    resourceType: 'Bundle',
    type: 'document',
    timestamp: new Date().toISOString(),
    entry: resources.map((resource) => ({
      fullUrl: `${baseUrl.replace(/\/$/, '')}/${resource.resourceType}/${resource.id}`,
      resource,
    })),
  }
}


const FHIR_JSON_HEADERS = {
  'Content-Type': 'application/fhir+json',
}

function getCorsHeaders(origin: string | null) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const siteUrl = Deno.env.get('SITE_URL') || Deno.env.get('APP_URL') || ''
  const allowedOrigins = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    supabaseUrl,
    siteUrl,
  ].filter(Boolean))

  const allowOrigin = origin && (allowedOrigins.has(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))
    ? origin
    : '*'

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

function fhirResponse(body: Record<string, unknown>, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(origin),
      ...FHIR_JSON_HEADERS,
    },
  })
}

function operationOutcome(text: string, status = 400, origin: string | null = null) {
  return fhirResponse({
    resourceType: 'OperationOutcome',
    issue: [{
      severity: 'error',
      code: 'exception',
      details: { text },
    }],
  }, status, origin)
}

function getServiceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase service role environment variables.')
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function logFhirAudit(client: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  try {
    await client.from('fhir_audit_log').insert(payload)
  } catch (error) {
    console.error('FHIR audit log insert failed:', error)
  }
}

function getCallerIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') || ''
  return forwarded.split(',').map((value) => value.trim()).find(Boolean) || req.headers.get('x-real-ip') || ''
}

async function fetchHospitalBundleContext(client: ReturnType<typeof createClient>, hospitalId: string) {
  const { data: hospital, error } = await client
    .from('hospitals')
    .select('id, name, location, owner_email, fhir_base_url, sha_fhir_endpoint, sha_fhir_client_id, sha_fhir_client_secret, sha_fhir_auto_submit, system_settings')
    .eq('id', hospitalId)
    .maybeSingle()
  if (error) throw error
  return hospital || null
}

async function fetchVisitBundleRows(client: ReturnType<typeof createClient>, hospitalId: string, visitId: string) {
  const [visitRes, vitalsRes, rxRes, labRes, consultRes, invoiceRes] = await Promise.all([
    client.from('visits').select('*, patients(*)').eq('hospital_id', hospitalId).eq('id', visitId).maybeSingle(),
    client.from('vitals').select('*').eq('hospital_id', hospitalId).eq('visit_id', visitId).order('recorded_at', { ascending: false }),
    client.from('prescriptions').select('*').eq('hospital_id', hospitalId).eq('visit_id', visitId).order('created_at', { ascending: true }),
    client.from('lab_tests').select('*').eq('hospital_id', hospitalId).eq('visit_id', visitId).order('ordered_at', { ascending: true }),
    client.from('consultations').select('*').eq('hospital_id', hospitalId).eq('visit_id', visitId).order('created_at', { ascending: true }),
    client.from('invoices').select('*').eq('hospital_id', hospitalId).eq('visit_id', visitId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  if (visitRes.error) throw visitRes.error
  if (vitalsRes.error) throw vitalsRes.error
  if (rxRes.error) throw rxRes.error
  if (labRes.error) throw labRes.error
  if (consultRes.error) throw consultRes.error
  if (invoiceRes.error) throw invoiceRes.error

  return {
    visit: visitRes.data,
    patient: visitRes.data?.patients || null,
    vitals: vitalsRes.data || [],
    prescriptions: rxRes.data || [],
    labTests: labRes.data || [],
    consultations: consultRes.data || [],
    invoice: invoiceRes.data || null,
  }
}

async function fetchPractitionerByName(client: ReturnType<typeof createClient>, hospitalId: string, name: string | null | undefined) {
  const safeName = String(name || '').trim()
  if (!safeName) return null
  const { data, error } = await client
    .from('staff')
    .select('id, full_name, role, phone, email')
    .eq('hospital_id', hospitalId)
    .ilike('full_name', safeName)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data || null
}

async function buildVisitBundle(client: ReturnType<typeof createClient>, hospitalId: string, visitId: string) {
  const hospital = await fetchHospitalBundleContext(client, hospitalId)
  if (!hospital) {
    throw new Error('Hospital not found for FHIR bundle.')
  }

  const rows = await fetchVisitBundleRows(client, hospitalId, visitId)
  if (!rows.visit || !rows.patient) {
    throw new Error('Visit or patient not found.')
  }

  const practitionerRow = await fetchPractitionerByName(client, hospitalId, firstDefined(rows.visit.assigned_doctor_name, rows.consultations[0]?.doctor_name))
  const patient = patientToFHIR(rows.patient, hospitalId)
  const organization = hospitalToFHIROrganization({
    ...hospital,
    moh_facility_code: hospital?.system_settings?.moh_facility_code,
    sha_provider_number: hospital?.system_settings?.sha_provider_number,
  })
  const practitioner = practitionerRow ? staffToFHIRPractitioner(practitionerRow) : null
  const encounter = visitToFHIREncounter(rows.visit, rows.patient, practitionerRow, hospitalId)
  const observations = rows.vitals.flatMap((vital) => vitalsToFHIRObservations(vital, rows.visit, rows.patient, hospitalId))
  const medicationRequests = rows.prescriptions.map((row) => prescriptionToFHIRMedicationRequest(row, rows.visit, rows.patient, practitionerRow, hospitalId))
  const diagnosticReports = rows.labTests.map((row) => labResultToFHIRDiagnosticReport(row, rows.patient, rows.visit, hospitalId))
  const conditions = rows.consultations.map((row) => diagnosisToFHIRCondition(row, rows.patient, rows.visit, hospitalId))
  let claim = null
  if (rows.invoice) {
    const { data: shaClaim } = await client
      .from('sha_claims')
      .select('*')
      .eq('hospital_id', hospitalId)
      .or(`invoice_id.eq.${rows.invoice.id},invoice_no.eq.${rows.invoice.invoice_no}`)
      .limit(1)
      .maybeSingle()
    claim = invoiceToFHIRClaim(rows.invoice, rows.patient, rows.visit, hospitalId, shaClaim || null)
  }

  return createVisitDocumentBundle({
    hospital: organization,
    patient,
    encounter,
    practitioner,
    observations,
    medicationRequests,
    diagnosticReports,
    conditions,
    claim,
  })
}

function wrapSearchBundle(resources: Record<string, unknown>[]) {
  return createSearchBundle(resources)
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}



Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(origin) })
  }

  const url = new URL(req.url)
  const hospitalId = String(url.searchParams.get('hospitalId') || '').trim()
  const patientId = String(url.searchParams.get('patientId') || '').trim()
  const identifier = String(url.searchParams.get('identifier') || '').trim()

  if (!hospitalId) return operationOutcome('hospitalId is required.', 400, origin)

  const client = getServiceClient()
  const callerIp = getCallerIp(req)

  try {
    if (patientId) {
      const { data, error } = await client.from('patients').select('*').eq('hospital_id', hospitalId).eq('id', patientId).maybeSingle()
      if (error) throw error
      if (!data) return operationOutcome('Patient not found.', 404, origin)
      const resource = patientToFHIR(data, hospitalId)
      await logFhirAudit(client, { hospital_id: hospitalId, resource_type: 'Patient', resource_id: patientId, action: 'read', caller_ip: callerIp, status: 'ok' })
      return fhirResponse(resource, 200, origin)
    }

    if (identifier) {
      const query = client
        .from('patients')
        .select('*')
        .eq('hospital_id', hospitalId)
        .or(`sha_member_no.eq.${identifier},national_id.eq.${identifier},patient_number.eq.${identifier},phone.eq.${identifier}`)
      const { data, error } = await query
      if (error) throw error
      const resources = (data || []).map((row) => patientToFHIR(row, hospitalId))
      await logFhirAudit(client, { hospital_id: hospitalId, resource_type: 'Patient', resource_id: identifier, action: 'search', caller_ip: callerIp, status: 'ok' })
      return fhirResponse(wrapSearchBundle(resources), 200, origin)
    }

    return operationOutcome('Provide patientId or identifier.', 400, origin)
  } catch (error) {
    console.error('fhir-patient failed:', error)
    await logFhirAudit(client, { hospital_id: hospitalId, resource_type: 'Patient', resource_id: patientId || identifier || null, action: patientId ? 'read' : 'search', caller_ip: callerIp, status: 'error', details: { error: error instanceof Error ? error.message : 'Unknown error' } })
    return operationOutcome(error instanceof Error ? error.message : 'FHIR patient export failed.', 500, origin)
  }
})
