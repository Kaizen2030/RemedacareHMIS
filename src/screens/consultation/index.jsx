import { useEffect, useMemo, useRef, useState } from 'react'
import { canPerformAction, resolveRole } from '../../access'
import supabase from '../../supabase'
import { useHospital } from '../../context'
import { canonicalizePrescriptionDrug, findInventoryMatch } from '../../utils/pharmacy'
import PatientWorkflowCard from '../../components/PatientWorkflowCard'
import { executeWithFallback } from '../../utils/dbCompat'
import { buildAmrInterventions } from '../../utils/hospitalSignals'
import { broadcastStewardshipChanged } from '../../utils/workflowEvents'
import { executeMicrobiologyQuery } from '../../utils/microbiologyResults'
import { getLabTestsForCategory, LAB_TEST_CATEGORIES } from '../../utils/labCatalog'
import { logAudit } from '../../utils/audit'
import { buildWorkflowInvoiceNote, createServiceLine, SERVICE_SOURCES, stringifyServiceLines } from '../../utils/workflowBilling'
import { generateSampleBarcode } from '../../utils/labWorkflow'
import { checkAMRAlert } from '../../utils/amrAlerts'
import { createRadiologyDraft } from '../../utils/radiology'
import {
 buildBilingualInstruction,
 detectPrescriptionInteractions,
 getAbnormalVitalAlerts,
 getAwareClassification,
 getBmiSummary,
 getCommonDiagnosesForDepartment,
 hasMalariaDiagnosis,
 hasTuberculosisDiagnosis,
 needsPregnancyPrompt,
} from '../../utils/consultationClinical'
import { inferChronicConditionHint } from '../../utils/chronicDisease'
import ConsultationForm from './ConsultationForm'
import ConsultationLabResults from './ConsultationLabResults'
import ConsultationQueue from './ConsultationQueue'

const DISPOSITIONS = ['OPD - Send Home', 'Admit - Inpatient', 'Refer to Specialist', 'Send to Lab', 'Send to Pharmacy', 'Emergency Admit']
const SPECIALITIES = ['General Medicine','Paediatrics','Obstetrics & Gynaecology','Surgery','Orthopaedics','Ophthalmology','ENT','Dermatology','Cardiology','Neurology','Psychiatry','Oncology','Urology','Dental','Emergency','Mental Health & Psychiatry','Eye Clinic','Physiotherapy','Nutrition & Dietetics','Community Health','ICU / HDU','Theatre / Surgery','Inpatient / Wards','Maternity','Laboratory','Radiology & Imaging','Pharmacy']
const CONSULTATION_LOCAL_DRAFT_PREFIX = 'remedacare:consultation-draft:'

// Clinical departments available for specialist referral — grouped by type
const REFERRAL_DEPARTMENTS = [
  { group: 'General & Emergency', options: ['General Medicine', 'OPD / Outpatient', 'Emergency'] },
  { group: 'Medical Specialties', options: ['Cardiology', 'Neurology', 'Dermatology', 'Psychiatry', 'Mental Health & Psychiatry', 'Oncology', 'Urology', 'Paediatrics'] },
  { group: 'Surgical Specialties', options: ['Surgery', 'Orthopaedics', 'ENT', 'Ophthalmology', 'Eye Clinic', 'Theatre / Surgery'] },
  { group: 'Women & Children', options: ['Obstetrics & Gynaecology', 'Maternity', 'Paediatrics'] },
  { group: 'Allied Health', options: ['Physiotherapy', 'Nutrition & Dietetics', 'Community Health', 'Dental'] },
  { group: 'Diagnostic', options: ['Laboratory', 'Radiology & Imaging'] },
  { group: 'Inpatient & Critical Care', options: ['Inpatient / Wards', 'ICU / HDU'] },
  { group: 'Pharmacy', options: ['Pharmacy'] },
]

function createPrescriptionRow() {
 return {
  drug_name: '',
  dosage: '',
  frequency: '',
  duration: '',
  quantity: '',
  prn: false,
  patient_instructions: '',
  aware_classification: '',
  amr_override_reason: '',
   cds_acknowledged: false,
 }
}

function createConsultationRadiologyRow() {
 return createRadiologyDraft()
}

function createDiagnosisRow(role = 'Primary') {
 return { role, code: '', description: '', reasoning: '' }
}

function hasMeaningfulPrescription(row = {}) {
 return ['drug_name', 'dosage', 'frequency', 'duration', 'quantity', 'patient_instructions']
  .some(key => String(row?.[key] || '').trim())
}

function hasMeaningfulLabOrder(row = {}) {
 return ['test_type', 'notes', 'priority'].some(key => String(row?.[key] || '').trim())
}

function getConsultationDraftStorageKey(visitId) {
 return `${CONSULTATION_LOCAL_DRAFT_PREFIX}${visitId || 'unknown'}`
}

function readLocalConsultationDraft(visitId) {
 try {
  const raw = window.localStorage.getItem(getConsultationDraftStorageKey(visitId))
  return raw ? JSON.parse(raw) : null
 } catch (_) {
  return null
 }
}

function writeLocalConsultationDraft(visitId, payload) {
 try {
  window.localStorage.setItem(getConsultationDraftStorageKey(visitId), JSON.stringify(payload))
 } catch (_) {}
}

function clearLocalConsultationDraft(visitId) {
 try {
  window.localStorage.removeItem(getConsultationDraftStorageKey(visitId))
 } catch (_) {}
}

export default function Consultation() {
 const { hospitalId, hospitalName, userRole, departments: configuredDepartments = [], navigationState, clearNavigationState, navigate } = useHospital()
 const [visits, setVisits] = useState([])
 const [queueLoading, setQueueLoading] = useState(true)
 const [saving, setSaving] = useState(false)
 const [selected, setSelected] = useState(null)
 const [vitals, setVitals] = useState(null)
 const [prevConsultations, setPrevConsultations] = useState([])
 const [labResults, setLabResults] = useState([])
 const [allPatientLabs, setAllPatientLabs] = useState([])
 const [antibiograms, setAntibiograms] = useState([])
 const [microbiologyResults, setMicrobiologyResults] = useState([])
 const [stewardshipInterventions, setStewardshipInterventions] = useState([])
 const [stewardshipSchemaReady, setStewardshipSchemaReady] = useState(true)
 const [stewardshipSaving, setStewardshipSaving] = useState(false)
 const [stewardshipDrafts, setStewardshipDrafts] = useState({})
 const [billingStatus, setBillingStatus] = useState(null) // { ok, message, amount }
 const [filterSpec, setFilterSpec] = useState('All')
 const [search, setSearch] = useState('')
 const [tab, setTab] = useState('consult')
 const [lastLocalDraftAt, setLastLocalDraftAt] = useState(null)

 const [form, setForm] = useState({
  presenting_complaint: '',
  history: '',
  examination_findings: '',
  diagnosis: '',
  icd_code: '',
  icd10_code: '',
  icd10_description: '',
  treatment_plan: '',
  notes: '',
  diagnoses: [createDiagnosisRow('Primary'), createDiagnosisRow('Secondary')],
  assessment_notes: '',
  pregnancy_status: '',
  disposition: '',
  refer_to: '',
  refer_department: '',
  refer_ward: '',
  referral_reason: '',
  follow_up_date: '',
  doctor_name: '',
  speciality: '',
 })

 const departmentNames = useMemo(
  () => [...new Set([
   ...configuredDepartments.map(dept => dept?.name).filter(Boolean),
   selected?.speciality,
   form.speciality,
   form.refer_department,
  ].filter(Boolean))],
  [configuredDepartments, selected?.speciality, form.speciality, form.refer_department]
 )

 const referralGroups = useMemo(() => {
  const grouped = new Map()
  configuredDepartments.forEach(dept => {
   if (!dept?.name) return
   const labelMap = {
    clinical: 'Clinical',
    diagnostic: 'Diagnostic',
    pharmacy: 'Pharmacy',
    admin: 'Admin',
    support: 'Support',
   }
   const key = labelMap[dept.dept_type] || 'Other'
   if (!grouped.has(key)) grouped.set(key, [])
   grouped.get(key).push(dept.name)
  })

  const extraDepartments = departmentNames.filter(name => !configuredDepartments.some(dept => dept?.name === name))
  if (extraDepartments.length > 0) grouped.set('Other', [...(grouped.get('Other') || []), ...extraDepartments])

  return [...grouped.entries()]
   .map(([group, options]) => ({ group, options: [...new Set(options)].sort() }))
   .filter(group => group.options.length > 0)
 }, [configuredDepartments, departmentNames])
 const canSaveConsultation = canPerformAction(userRole, 'write_diagnosis')
 const canOrderLabs = canPerformAction(userRole, 'order_labs')

 // Wards for the ward picker in referral
 const [wardsList, setWardsList] = useState([])
 useEffect(() => {
  if (!hospitalId) return
  supabase.from('wards').select('id, name, ward_type').eq('hospital_id', hospitalId).order('name')
   .then(({ data }) => setWardsList(data || []))
 }, [hospitalId])

 const [rxList, setRxList] = useState([createPrescriptionRow()])
 const [amrAlerts, setAmrAlerts] = useState({})
 const [amrChecking, setAmrChecking] = useState({})
 const [amrDismissed, setAmrDismissed] = useState({})
 const [amrInfoExpanded, setAmrInfoExpanded] = useState({})
 const [amrOverrideOpen, setAmrOverrideOpen] = useState({})
 const amrRequestTokens = useRef({})
 const [inventory, setInventory] = useState([])

 const [labOrders, setLabOrders] = useState([
  { test_type: '', priority: 'Routine', notes: '', category: 'Haematology' }
 ])
 const [radiologyOrders, setRadiologyOrders] = useState([createConsultationRadiologyRow()])
 const [recentRadiologyReports, setRecentRadiologyReports] = useState([])

const [showLabOrders, setShowLabOrders] = useState(false)
const [showRadiologyOrders, setShowRadiologyOrders] = useState(false)
const [showRx, setShowRx] = useState(false)
const [savingDraft, setSavingDraft] = useState(false)
const [cdsAlertsByRow, setCdsAlertsByRow] = useState({})
const [activePatientPrescriptions, setActivePatientPrescriptions] = useState([])
const [chronicFollowUpRows, setChronicFollowUpRows] = useState([])
const canAcknowledgeDangerAlerts = canPerformAction(userRole, 'override_cds_alerts') || resolveRole(userRole) === 'Admin'

 const openChronicDiseaseFromConsultation = () => {
  if (!selected?.patient_id) {
   window.notifyFromLegacyAlert('Select a consultation patient first.')
   return
  }

  navigate?.('chronic-disease', {
   patientId: selected.patient_id,
   patientName: selected?.patients?.full_name || '',
   visitId: selected?.id || null,
   suggestedCondition: inferChronicConditionHint(
    selected?.patients?.chronic_conditions,
    form.diagnosis,
    form.icd10_description,
    selected?.chief_complaint,
   ),
   source: 'consultation',
  })
 }

 const inferCarePathwayProtocol = () => {
  const diagnosisText = [
   form.diagnosis,
   form.icd10_description,
   form.assessment_notes,
   selected?.chief_complaint,
   selected?.patients?.chronic_conditions,
  ].join(' ').toLowerCase()
  const patientAge = Number(selected?.patients?.age || 0)

  if (diagnosisText.includes('severe malaria')) return 'malaria-severe'
  if (diagnosisText.includes('malaria')) return 'malaria-uncomplicated'
  if (diagnosisText.includes('hiv')) return chronicFollowUpRows.length > 0 ? 'hiv-monitoring' : 'hiv-initiation'
  if (diagnosisText.includes('diabetes')) return 'type2-diabetes'
  if (diagnosisText.includes('hypertension') || diagnosisText.includes('blood pressure')) return 'hypertension'
  if (diagnosisText.includes('tb') || diagnosisText.includes('tuberculosis')) return 'tb-presumptive'
  if (diagnosisText.includes('pneumonia')) return patientAge > 0 && patientAge < 18 ? 'pneumonia-paediatric' : 'pneumonia-adult'
  return null
 }

 const openCarePathwayFromConsultation = () => {
  if (!selected?.patient_id) {
   window.notifyFromLegacyAlert('Select a consultation patient first.')
   return
  }

  navigate?.('care-pathways', {
   screen: 'care-pathways',
   patientId: selected.patient_id,
   patientName: selected?.patients?.full_name || '',
   visitId: selected?.id || null,
   suggestedProtocol: inferCarePathwayProtocol(),
   suggestedCondition: inferChronicConditionHint(
    selected?.patients?.chronic_conditions,
    form.diagnosis,
    form.icd10_description,
    selected?.chief_complaint,
   ),
   source: 'consultation',
  })
 }

 const openReferralFromConsultation = () => {
  if (!selected?.patient_id) {
   window.notifyFromLegacyAlert('Select a consultation patient first.')
   return
  }

  const primaryDiagnosis = Array.isArray(form.diagnoses)
   ? form.diagnoses.find(item => String(item?.description || '').trim())
   : null

  navigate?.('referrals', {
   screen: 'referrals',
   patientId: selected.patient_id,
   patientName: selected?.patients?.full_name || '',
   visitId: selected?.id || null,
   diagnosisCode: primaryDiagnosis?.code || form.icd10_code || form.icd_code || '',
   diagnosisLabel: primaryDiagnosis?.description || form.diagnosis || form.icd10_description || '',
   clinicalSummary: form.assessment_notes || form.notes || form.presenting_complaint || selected?.chief_complaint || '',
   referralReason: form.referral_reason || form.disposition || 'Specialist referral from consultation',
   doctorName: form.doctor_name || selected?.assigned_doctor_name || '',
   urgency: 'Routine',
   source: 'consultation',
  })
 }

 const updateRxField = (index, key, value) => {
 setRxList(prev => {
  const next = [...prev]
  const row = { ...(next[index] || {}) }
  row[key] = value

  if (key === 'drug_name') {
    const match = findInventoryMatch(value, inventory)
    row.inventory_match_name = match?.drug_name || ''
    if (!row.dosage && match?.strength) row.dosage = match.strength
    row.aware_classification = getAwareClassification(value) || ''
    if (!String(row.patient_instructions || '').trim()) {
      row.patient_instructions = buildBilingualInstruction(row)
    }
    row.amr_override_reason = ''
    row.cds_acknowledged = false
   }

   if (['dosage', 'frequency', 'duration', 'prn'].includes(key) && !String(row.patient_instructions || '').trim()) {
    row.patient_instructions = buildBilingualInstruction(row)
   }
   if (key === 'dosage') row.cds_acknowledged = false

   next[index] = row
   return next
  })

  if (key === 'drug_name') {
   setAmrAlerts(current => {
    const next = { ...current }
    delete next[index]
    return next
   })
   setAmrChecking(current => ({ ...current, [index]: false }))
   setAmrDismissed(current => ({ ...current, [index]: false }))
   setAmrInfoExpanded(current => ({ ...current, [index]: false }))
   setAmrOverrideOpen(current => ({ ...current, [index]: false }))
  }
 }

const handleRemovePrescriptionRow = index => {
 setRxList(prev => prev.filter((_, currentIndex) => currentIndex !== index))
  ;[setAmrAlerts, setAmrChecking, setAmrDismissed, setAmrInfoExpanded, setAmrOverrideOpen].forEach(setter => {
   setter(current => Object.fromEntries(
    Object.entries(current)
     .filter(([key]) => Number(key) !== index)
     .map(([key, value]) => {
      const numericKey = Number(key)
      return [numericKey > index ? numericKey - 1 : numericKey, value]
     }),
   ))
  })
  setCdsAlertsByRow(current => Object.fromEntries(
   Object.entries(current)
    .filter(([key]) => Number(key) !== index)
    .map(([key, value]) => {
     const numericKey = Number(key)
     return [numericKey > index ? numericKey - 1 : numericKey, value]
    }),
  ))
 }

 const handleAddPrescriptionRow = () => {
  setRxList(prev => [...prev, createPrescriptionRow()])
 }

 const handleOverrideReasonChange = (index, value) => {
  setRxList(prev => prev.map((row, currentIndex) => (
   currentIndex === index ? { ...row, amr_override_reason: value } : row
  )))
 }

 const getDrugAvailability = (name, qty) => {
  const match = findInventoryMatch(name)
  const needed = Number(qty || 1)
  if (!match) return { label: 'No matching inventory found', color: '#B91C1C' }
  const balance = Number(match.quantity_in_stock || 0)
  if (balance <= 0) return { label: 'Out of stock', color: '#B91C1C' }
  if (balance < needed) return { label: `Low stock — ${balance} available`, color: '#C2410C' }
  return { label: `In stock — ${balance} available`, color: '#16A34A' }
 }

 useEffect(() => {
  if (!hospitalId) { setQueueLoading(false); return }
  fetchVisits()
 }, [hospitalId])

 useEffect(() => {
  if (!hospitalId) return
  const fetchInventory = async () => {
   const { data } = await supabase
    .from('pharmacy_inventory')
    .select('id, drug_name, generic_name, strength, quantity_in_stock, is_active')
    .eq('hospital_id', hospitalId)
    .eq('is_active', true)
    .order('drug_name')
   setInventory(data || [])
  }
  fetchInventory()
 }, [hospitalId])

 useEffect(() => {
  const interval = setInterval(() => {
   if (hospitalId) fetchVisits()
  }, 30000)
  return () => clearInterval(interval)
 }, [hospitalId])

 async function fetchVisits() {
  if (!selected) setQueueLoading(true)
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase
   .from('visits')
   .select('*, patients(*)')
   .eq('hospital_id', hospitalId)
   .in('status', ['Doctor', 'OPD'])
   .gte('created_at', today)
   .order('created_at', { ascending: true })
  setVisits(data || [])
  setQueueLoading(false)
 }

 async function loadStewardshipContext(visit, { keepTab = false } = {}) {
  if (!visit?.patient_id) {
   setMicrobiologyResults([])
   setStewardshipInterventions([])
   setStewardshipSchemaReady(true)
   return
  }

  const [microbiologyResult, interventionResult] = await Promise.all([
   executeMicrobiologyQuery(select =>
    supabase
     .from('microbiology_results')
     .select(select)
     .eq('hospital_id', hospitalId)
     .eq('patient_id', visit.patient_id)
     .order('reported_date', { ascending: false })
     .limit(16),
   ),
   executeWithFallback(
    () => supabase
     .from('stewardship_interventions')
     .select('*')
     .eq('hospital_id', hospitalId)
     .eq('patient_id', visit.patient_id)
     .order('created_at', { ascending: false })
     .limit(40),
    async compatError => ({ data: [], error: null, compatFallback: true, compatError }),
   ),
  ])

  const microRows = microbiologyResult?.data || []
  setMicrobiologyResults(microRows)
  setStewardshipInterventions(interventionResult?.data || [])
  setStewardshipSchemaReady(!interventionResult?.compatFallback)
  setStewardshipDrafts(prev => {
   const next = { ...prev }
   ;(interventionResult?.data || []).forEach(row => {
    const key = row.microbiology_result_id
    if (key && !next[key]) next[key] = row.action_taken || row.prescriber_response || ''
   })
   return next
  })

  if (!keepTab && (microRows || []).some(row => row.organism_identified)) {
   setTab('labs')
  }
 }

async function selectVisit(visit) {
  setSelected(visit)
  setTab('consult')
  setBillingStatus(null)
  setForm({
   presenting_complaint: visit.chief_complaint || '',
   history: '',
   examination_findings: '',
   diagnosis: '',
   icd_code: '',
   icd10_code: '',
   icd10_description: '',
   treatment_plan: '',
   notes: '',
   diagnoses: [createDiagnosisRow('Primary'), createDiagnosisRow('Secondary')],
   assessment_notes: '',
   pregnancy_status: '',
   disposition: '',
   refer_to: '',
   refer_department: '',
   refer_ward: '',
   referral_reason: '',
   follow_up_date: '',
   doctor_name: visit.assigned_doctor_name || '',
   speciality: visit.speciality || '',
  })
  setRxList([createPrescriptionRow()])
  setLabOrders([{ test_type: '', priority: 'Routine', notes: '', category: 'Haematology' }])
  setRadiologyOrders([createConsultationRadiologyRow()])
  setShowRx(false)
  setShowLabOrders(false)
  setShowRadiologyOrders(false)
  setMicrobiologyResults([])
  setStewardshipInterventions([])
  setStewardshipDrafts({})
  setRecentRadiologyReports([])
  setActivePatientPrescriptions([])
  setChronicFollowUpRows([])
  setAmrAlerts({})
  setAmrChecking({})
  setAmrDismissed({})
  setAmrInfoExpanded({})
  setAmrOverrideOpen({})
  setCdsAlertsByRow({})

  const { data: draft } = await supabase
   .from('consultation_drafts')
   .select('*')
   .eq('visit_id', visit.id)
   .maybeSingle()

  const localDraft = readLocalConsultationDraft(visit.id)
  const localSavedAt = localDraft?.saved_at ? new Date(localDraft.saved_at).getTime() : 0
  const remoteSavedAt = draft?.saved_at ? new Date(draft.saved_at).getTime() : 0
  const effectiveDraft = localSavedAt > remoteSavedAt ? localDraft : draft

  if (effectiveDraft) {
   try {
    const draftParsed = effectiveDraft.form_data ? JSON.parse(effectiveDraft.form_data) : effectiveDraft
    if (draftParsed.form) setForm(prev => ({ ...prev, ...draftParsed.form }))
    if (draftParsed.rxList) setRxList(draftParsed.rxList.map(row => ({ ...createPrescriptionRow(), ...row })))
    if (draftParsed.labOrders) setLabOrders(draftParsed.labOrders)
    if (draftParsed.radiologyOrders) setRadiologyOrders(draftParsed.radiologyOrders.map(row => ({ ...createConsultationRadiologyRow(), ...row })))
    if (draftParsed.showRx !== undefined) setShowRx(draftParsed.showRx)
    if (draftParsed.showLabOrders !== undefined) setShowLabOrders(draftParsed.showLabOrders)
    if (draftParsed.showRadiologyOrders !== undefined) setShowRadiologyOrders(draftParsed.showRadiologyOrders)
    if (draftParsed.tab) setTab(draftParsed.tab)
    setLastLocalDraftAt(effectiveDraft.saved_at || null)
    window.notifyFromLegacyAlert('Draft loaded from ' + new Date(effectiveDraft.saved_at).toLocaleString())
   } catch (e) {
    console.error('Error loading draft:', e)
   }
  }

  const { data: v } = await supabase
   .from('vitals')
   .select('*')
   .eq('visit_id', visit.id)
   .order('recorded_at', { ascending: false })
   .limit(1)
   .maybeSingle()
  setVitals(v || null)

  const { data: prev } = await supabase
   .from('consultations')
   .select('*')
   .eq('patient_id', visit.patient_id)
   .eq('hospital_id', hospitalId)
   .order('created_at', { ascending: false })
   .limit(10)
  setPrevConsultations(prev || [])

  const { data: activeRxRows } = await supabase
   .from('prescriptions')
   .select('id, drug_name, generic_name, dosage, frequency, duration, status, created_at')
   .eq('patient_id', visit.patient_id)
   .eq('hospital_id', hospitalId)
   .in('status', ['Pending', 'Approved', 'Released'])
   .order('created_at', { ascending: false })
   .limit(20)
  setActivePatientPrescriptions(activeRxRows || [])

  const { data: thisVisitLabs } = await supabase
   .from('lab_tests')
   .select('*')
   .eq('visit_id', visit.id)
   .order('ordered_at', { ascending: false })
  setLabResults(thisVisitLabs || [])

  const { data: allLabs } = await supabase
   .from('lab_tests')
   .select('*')
   .eq('patient_id', visit.patient_id)
   .order('ordered_at', { ascending: false })
   .limit(20)
  setAllPatientLabs(allLabs || [])

  const { data: radiologyRows } = await supabase
   .from('radiology_orders')
   .select('*')
   .eq('hospital_id', hospitalId)
   .eq('patient_id', visit.patient_id)
   .order('created_at', { ascending: false })
   .limit(5)
  setRecentRadiologyReports(radiologyRows || [])

  const { data: antibiogramData } = await supabase
   .from('antibiograms')
   .select('*')
   .eq('patient_id', visit.patient_id)
   .order('created_at', { ascending: false })
   .limit(10)
  setAntibiograms(antibiogramData || [])

  const { data: chronicRows } = await supabase
   .from('chronic_disease_records')
   .select('id, condition, visit_date, notes, arv_regimen, oral_meds, current_meds, viral_load, hba1c, bp_systolic, bp_diastolic')
   .eq('hospital_id', hospitalId)
   .eq('patient_id', visit.patient_id)
   .order('visit_date', { ascending: false })
   .limit(20)
  setChronicFollowUpRows(chronicRows || [])

  await loadStewardshipContext(visit, { keepTab: !!effectiveDraft })

 if (!effectiveDraft && (thisVisitLabs || []).some(l => l.status === 'Complete')) {
  setTab('labs')
 }
}

 function applyCarePathwaySuggestions(pathwayState) {
  if (!pathwayState || pathwayState.source !== 'care-pathway') return

  const suggestedPrescriptions = Array.isArray(pathwayState.suggestedPrescriptions)
   ? pathwayState.suggestedPrescriptions
   : []
  const suggestedLabOrders = Array.isArray(pathwayState.suggestedLabOrders)
   ? pathwayState.suggestedLabOrders
   : []

  if (suggestedPrescriptions.length > 0) {
   setShowRx(true)
   setRxList(current => {
    const baseRows = current.some(hasMeaningfulPrescription) ? current : []
    const existingKeys = new Set(
     baseRows.map(row => `${canonicalizePrescriptionDrug(row.drug_name || '')}|${String(row.dosage || '').trim()}|${String(row.frequency || '').trim()}`),
    )

    const additions = suggestedPrescriptions.reduce((acc, item) => {
     const nextRow = {
      ...createPrescriptionRow(),
      ...item,
      aware_classification: item.aware_classification || getAwareClassification(item.drug_name || item.generic_name || '') || '',
      patient_instructions: item.patient_instructions || buildBilingualInstruction({ ...createPrescriptionRow(), ...item }),
      cds_acknowledged: false,
     }
     const key = `${canonicalizePrescriptionDrug(nextRow.drug_name || '')}|${String(nextRow.dosage || '').trim()}|${String(nextRow.frequency || '').trim()}`
     if (!key || existingKeys.has(key)) return acc
     existingKeys.add(key)
     acc.push(nextRow)
     return acc
    }, [])

    return additions.length > 0 ? [...baseRows, ...additions] : (baseRows.length > 0 ? baseRows : [createPrescriptionRow()])
   })
  }

  if (suggestedLabOrders.length > 0) {
   setShowLabOrders(true)
   setLabOrders(current => {
    const baseRows = current.some(hasMeaningfulLabOrder) ? current : []
    const existingKeys = new Set(
     baseRows.map(row => `${String(row.test_type || '').trim().toLowerCase()}|${String(row.category || '').trim().toLowerCase()}`),
    )

    const additions = suggestedLabOrders.reduce((acc, item) => {
     const nextRow = {
      test_type: '',
      priority: 'Routine',
      notes: '',
      category: 'Haematology',
      ...item,
     }
     const key = `${String(nextRow.test_type || '').trim().toLowerCase()}|${String(nextRow.category || '').trim().toLowerCase()}`
     if (!String(nextRow.test_type || '').trim() || existingKeys.has(key)) return acc
     existingKeys.add(key)
     acc.push(nextRow)
     return acc
    }, [])

    return additions.length > 0 ? [...baseRows, ...additions] : (baseRows.length > 0 ? baseRows : [{ test_type: '', priority: 'Routine', notes: '', category: 'Haematology' }])
   })
  }

  if (pathwayState.protocolName) {
   setForm(current => {
    const protocolLine = `Care pathway: ${pathwayState.protocolName}`
    if (String(current.notes || '').includes(protocolLine)) return current
    return {
     ...current,
     notes: current.notes ? `${current.notes}\n${protocolLine}` : protocolLine,
    }
   })
  }

  setTab('consult')

  if (pathwayState.protocolName) {
   window.notifyFromLegacyAlert(`${pathwayState.protocolName} suggestions loaded into consultation.`)
  }
 }

 useEffect(() => {
  if (!navigationState || navigationState.screen !== 'consultation' || queueLoading) return undefined

  let cancelled = false

  const syncNavigationState = async () => {
   const matchedVisit =
   visits.find(visit => String(visit.id) === String(navigationState.visitId || '')) ||
    visits.find(visit => String(visit.patient_id) === String(navigationState.patientId || ''))

   if (matchedVisit) {
    if (selected?.id === matchedVisit.id) {
     applyCarePathwaySuggestions(navigationState)
     clearNavigationState?.()
     return
    }

    await selectVisit(matchedVisit)
    if (!cancelled) applyCarePathwaySuggestions(navigationState)
    if (!cancelled) clearNavigationState?.()
    return
   }

   if (!hospitalId) return

   let blockedVisit = null
   if (navigationState.visitId) {
    const { data } = await supabase
     .from('visits')
     .select('id, status, visit_number, patient_id, patients(full_name)')
     .eq('hospital_id', hospitalId)
     .eq('id', navigationState.visitId)
     .maybeSingle()
    blockedVisit = data || null
   } else if (navigationState.patientId) {
    const { data } = await supabase
     .from('visits')
     .select('id, status, visit_number, patient_id, patients(full_name)')
     .eq('hospital_id', hospitalId)
     .eq('patient_id', navigationState.patientId)
     .order('created_at', { ascending: false })
     .limit(1)
    blockedVisit = (data || [])[0] || null
   }

   if (cancelled || !blockedVisit) return

   if (!['Doctor', 'OPD'].includes(blockedVisit.status || '')) {
    const patientName = blockedVisit.patients?.full_name || 'This patient'
    const visitLabel = blockedVisit.visit_number ? ` (${blockedVisit.visit_number})` : ''
   window.notifyFromLegacyAlert(`${patientName}${visitLabel} is still in ${blockedVisit.status || 'workflow'}. Complete that step before consultation.`)
   }
   clearNavigationState?.()
  }

  void syncNavigationState()

  return () => {
   cancelled = true
  }
 }, [navigationState, queueLoading, visits, selected?.id, clearNavigationState, hospitalId])

 useEffect(() => {
  if (!hospitalId || !selected) return undefined

  const refreshStewardship = () => loadStewardshipContext(selected, { keepTab: true })
  window.addEventListener('remedacare:stewardship_changed', refreshStewardship)
  window.addEventListener('remedacare:antibiogram_updated', refreshStewardship)

  return () => {
   window.removeEventListener('remedacare:stewardship_changed', refreshStewardship)
   window.removeEventListener('remedacare:antibiogram_updated', refreshStewardship)
  }
 }, [hospitalId, selected])

 // ── Billing helpers ──────────────────────────────────────────────────────────

 useEffect(() => {
  if (!selected?.id) return undefined

  const timer = window.setInterval(() => {
   const payload = {
    hospital_id: hospitalId,
    visit_id: selected.id,
    patient_id: selected.patient_id,
    form,
    rxList,
    labOrders,
    radiologyOrders,
    showRx,
    showLabOrders,
    showRadiologyOrders,
    tab,
    saved_at: new Date().toISOString(),
   }
   writeLocalConsultationDraft(selected.id, payload)
   setLastLocalDraftAt(payload.saved_at)
  }, 30000)

  return () => {
   window.clearInterval(timer)
  }
 }, [hospitalId, selected?.id, selected?.patient_id, form, rxList, labOrders, radiologyOrders, showRx, showLabOrders, showRadiologyOrders, tab])

 useEffect(() => {
  if (!hospitalId) return undefined

  const timers = []
  const activeIndexes = new Set()

  rxList.forEach((row, index) => {
   const drugName = String(row?.drug_name || '').trim()
   if (drugName.length <= 3 || !selected?.patient_id) {
    setAmrChecking(current => ({ ...current, [index]: false }))
    return
   }

   activeIndexes.add(index)
   setAmrChecking(current => ({ ...current, [index]: true }))
   const token = `${Date.now()}-${index}-${drugName}`
   amrRequestTokens.current[index] = token
   const timer = window.setTimeout(() => {
    checkAMRAlert(drugName, selected.patient_id, hospitalId)
     .then(result => {
      if (amrRequestTokens.current[index] !== token) return
      setAmrAlerts(current => ({ ...current, [index]: result }))
      setAmrChecking(current => ({ ...current, [index]: false }))
     })
     .catch(() => {
      if (amrRequestTokens.current[index] !== token) return
      setAmrAlerts(current => ({ ...current, [index]: null }))
      setAmrChecking(current => ({ ...current, [index]: false }))
     })
   }, 600)
   timers.push(timer)
  })

  setAmrAlerts(current => Object.fromEntries(Object.entries(current).filter(([key]) => activeIndexes.has(Number(key)))))
  setAmrDismissed(current => Object.fromEntries(Object.entries(current).filter(([key]) => activeIndexes.has(Number(key)))))
  setAmrInfoExpanded(current => Object.fromEntries(Object.entries(current).filter(([key]) => activeIndexes.has(Number(key)))))
  setAmrOverrideOpen(current => Object.fromEntries(Object.entries(current).filter(([key]) => activeIndexes.has(Number(key)))))

  return () => {
   timers.forEach(timer => window.clearTimeout(timer))
  }
 }, [rxList, selected?.patient_id, hospitalId])

 function getConsultationChargeCode(speciality, visitType) {
  if ((visitType || '').toLowerCase().includes('emergency') ||
      (speciality || '').toLowerCase().includes('emergency')) return 'CONS-EMERGENCY'
  const map = {
   'Cardiology': 'CONS-CARDIO',
   'Neurology': 'CONS-NEURO',
   'Surgery': 'CONS-SURG',
   'Orthopaedics': 'CONS-ORTHO',
   'ENT': 'CONS-ENT',
   'Ophthalmology': 'CONS-OPHTHAL',
   'Eye Clinic': 'CONS-OPHTHAL',
   'Dermatology': 'CONS-DERM',
   'Psychiatry': 'CONS-PSYCH',
   'Mental Health & Psychiatry': 'CONS-PSYCH',
   'Oncology': 'CONS-ONCO',
   'Urology': 'CONS-UROL',
   'Obstetrics & Gynaecology': 'CONS-OBGYN',
   'Maternity': 'CONS-OBGYN',
   'Paediatrics': 'CONS-PAEDS',
   'Dental': 'CONS-DENTAL',
   'Physiotherapy': 'CONS-PHYSIO',
   'Nutrition & Dietetics': 'CONS-NUTR',
   'General Medicine': 'CONS-GENMED',
  }
  return map[speciality] || 'CONS-OPD'
 }

 async function autoCreateConsultationInvoice({ visit, consultationId }) {
  try {
   // Skip if an invoice for this consultation already exists
   const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('hospital_id', hospitalId)
    .eq('visit_id', visit.id)
    .ilike('notes', `WF|${SERVICE_SOURCES.CONSULTATION}|%`)
    .maybeSingle()

   if (existing) {
    setBillingStatus({ ok: true, message: 'Consultation already invoiced', amount: null })
    return
   }

   // Look up price from charge_codes table
   const chargeCode = getConsultationChargeCode(form.speciality, visit.visit_type)
   const { data: cc } = await supabase
    .from('charge_codes')
    .select('id, unit_price_kes, name')
    .eq('hospital_id', hospitalId)
    .eq('code', chargeCode)
    .maybeSingle()

   // Use admission_fee if reception already collected it, otherwise use price list
   const amount = visit.admission_fee
    ? Number(visit.admission_fee)
    : (cc?.unit_price_kes || 500)

   const paymentMethod = visit.admission_payment_method || 'Cash'
   const NON_INSURANCE = ['Cash', 'M-Pesa']
   const alreadyPaid = visit.admission_fee ? Number(visit.admission_fee) : 0
   const balance = Math.max(0, amount - alreadyPaid)
   const status = balance <= 0 && amount > 0 ? 'Paid' : alreadyPaid > 0 ? 'Partial' : 'Pending'
   const serviceLabel = cc?.name || (form.speciality ? `${form.speciality} Consultation` : 'OPD Consultation')

   const serviceLine = createServiceLine({
    label: serviceLabel,
    qty: 1,
    unitPrice: amount,
    total: amount,
    source: SERVICE_SOURCES.CONSULTATION,
    sourceId: consultationId,
    visitId: visit.id,
    meta: { speciality: form.speciality, charge_code: chargeCode },
   })

   const { error: invErr } = await supabase.from('invoices').insert({
    hospital_id: hospitalId,
    patient_id: visit.patient_id,
    patient_name: visit.patients?.full_name || '',
    visit_id: visit.id,
    invoice_no: `INV-${Date.now().toString().slice(-6)}`,
    services: stringifyServiceLines([serviceLine]),
    amount_kes: amount,
    paid_kes: alreadyPaid,
    balance_kes: balance,
    payment_method: paymentMethod,
    insurer: !NON_INSURANCE.includes(paymentMethod) ? paymentMethod : null,
    sha_member_no: visit.sha_member_no || null,
    status,
    notes: buildWorkflowInvoiceNote({
     source: SERVICE_SOURCES.CONSULTATION,
     sourceId: consultationId,
     visitId: visit.id,
     summary: serviceLabel,
    }),
    paid_at: status === 'Paid' ? new Date().toISOString() : null,
   })

   if (invErr) {
    console.error('Auto-billing error:', invErr.message)
    setBillingStatus({ ok: false, message: `Billing error: ${invErr.message}`, amount })
   } else {
    setBillingStatus({ ok: true, message: `${serviceLabel} — KES ${amount.toLocaleString()} (${status})`, amount })
    try {
     window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', {
      detail: { visit_id: visit.id, source: 'consultation-auto-billing' }
     }))
    } catch (_) {}
   }
  } catch (e) {
   console.error('autoCreateConsultationInvoice failed:', e)
   setBillingStatus({ ok: false, message: 'Billing skipped — unexpected error', amount: null })
  }
 }

async function handleSave() {
  const diagnosisRows = (form.diagnoses || []).filter(item => String(item?.description || '').trim())
  const primaryDiagnosis = diagnosisRows[0] || null
  const primaryDiagnosisText = primaryDiagnosis?.description || form.diagnosis
  if (!primaryDiagnosisText) { window.notifyFromLegacyAlert('Diagnosis is required.'); return }
  if (!form.disposition) { window.notifyFromLegacyAlert('Select a disposition.'); return }
  if (!form.doctor_name) { window.notifyFromLegacyAlert('Enter doctor name.'); return }
  if (showPregnancyPrompt && !form.pregnancy_status) {
   window.notifyFromLegacyAlert('Record pregnancy status for female patients aged 15-49.')
   return
  }
  const isPharmacy = form.disposition.includes('Pharmacy')
  if (form.disposition.includes('Refer')) {
   if (!form.refer_department) { window.notifyFromLegacyAlert('Select a department to refer the patient to.'); return }
  }
  const validRx = rxList
   .map((r, index) => {
    const rawName = (r.drug_name || '').trim()
    const match = findInventoryMatch(rawName, inventory)
    return {
     ...r,
     rowIndex: index,
     drug_name: canonicalizePrescriptionDrug(rawName, inventory),
     dosage: (r.dosage || '').trim() || match?.strength || '',
     quantity: Math.max(1, parseInt(r.quantity, 10) || 1),
     prn: Boolean(r.prn),
     patient_instructions: String(r.patient_instructions || '').trim() || buildBilingualInstruction(r),
     aware_classification: getAwareClassification(rawName) || null,
     amr_override_reason: (r.amr_override_reason || '').trim(),
     cds_acknowledged: Boolean(r.cds_acknowledged),
    }
   })
   .filter(r => r.drug_name)
  const blockingAmr = validRx.find(r => amrAlerts[r.rowIndex]?.alertLevel === 'critical' && !r.amr_override_reason)
  if (blockingAmr) {
   window.notifyFromLegacyAlert(`Please document justification for prescribing ${blockingAmr.drug_name} given the resistance pattern.`)
   setAmrOverrideOpen(current => ({ ...current, [blockingAmr.rowIndex]: true }))
   return
  }
  const blockingCdsDanger = validRx.find((r) => {
   const rowAlerts = cdsAlertsByRow[r.rowIndex] || []
   return rowAlerts.some(alert => alert.severity === 'danger') && !r.cds_acknowledged
  })
  if (blockingCdsDanger) {
   if (!canAcknowledgeDangerAlerts) {
    window.notifyFromLegacyAlert(`A Doctor or Admin must acknowledge the CDS danger alert for ${blockingCdsDanger.drug_name} before saving.`)
    return
   }
   window.notifyFromLegacyAlert(`Please tick "I acknowledge this alert" for ${blockingCdsDanger.drug_name} before saving.`)
   return
  }
  setSaving(true)

  try {
   // 1. Save consultation record
   const consultationPayload = {
    hospital_id: hospitalId,
    visit_id: selected.id,
    patient_id: selected.patient_id,
    doctor_name: form.doctor_name,
    speciality: form.speciality,
    presenting_complaint: form.presenting_complaint,
    history: form.history,
    examination_findings: form.examination_findings,
    diagnosis: primaryDiagnosisText,
    icd_code: primaryDiagnosis?.code || form.icd_code,
    icd10_code: primaryDiagnosis?.code || form.icd10_code || form.icd_code || null,
    icd10_description: primaryDiagnosis?.description || form.icd10_description || primaryDiagnosisText || null,
    treatment_plan: form.treatment_plan,
    notes: form.assessment_notes || form.notes,
    disposition: form.disposition,
    refer_to: form.refer_to,
    follow_up_date: form.follow_up_date || null,
    subjective_notes: form.history || null,
    objective_notes: form.examination_findings || null,
    assessment_notes: form.assessment_notes || null,
    plan_notes: form.treatment_plan || null,
    diagnoses_json: diagnosisRows,
    pregnancy_status: form.pregnancy_status || null,
    referral_reason: form.referral_reason || null,
    created_at: new Date().toISOString(),
   }

   const { error: cErr } = await executeWithFallback(
    () => supabase.from('consultations').insert(consultationPayload),
    async () => supabase.from('consultations').insert({
     hospital_id: consultationPayload.hospital_id,
     visit_id: consultationPayload.visit_id,
     patient_id: consultationPayload.patient_id,
     doctor_name: consultationPayload.doctor_name,
     speciality: consultationPayload.speciality,
     presenting_complaint: consultationPayload.presenting_complaint,
     history: consultationPayload.history,
     examination_findings: consultationPayload.examination_findings,
     diagnosis: consultationPayload.diagnosis,
     icd_code: consultationPayload.icd_code,
     icd10_code: consultationPayload.icd10_code,
     icd10_description: consultationPayload.icd10_description,
     treatment_plan: consultationPayload.treatment_plan,
     notes: consultationPayload.notes,
     disposition: consultationPayload.disposition,
     refer_to: consultationPayload.refer_to,
     follow_up_date: consultationPayload.follow_up_date,
     created_at: consultationPayload.created_at,
    }),
   )

   if (cErr) { window.notifyFromLegacyAlert('Error saving consultation: ' + cErr.message); setSaving(false); return }

   // 1b. Auto-create consultation invoice
   // Get the id of the just-inserted consultation
   const { data: newConsult } = await supabase
    .from('consultations')
    .select('id')
    .eq('visit_id', selected.id)
    .eq('hospital_id', hospitalId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

   await autoCreateConsultationInvoice({ visit: selected, consultationId: newConsult?.id || null })

   // 2. Save prescriptions
   if (isPharmacy && validRx.length === 0) {
    window.notifyFromLegacyAlert('Add at least one prescription before sending this visit to pharmacy.')
    setSaving(false)
   return
  }
  if (validRx.length > 0) {
    const prescriptionRows = validRx.map(r => ({
     hospital_id: hospitalId,
     visit_id: selected.id,
     patient_id: selected.patient_id,
     patient_name: selected.patients?.full_name || '',
     drug_name: r.drug_name,
     dosage: r.dosage,
     frequency: r.frequency,
     duration: r.duration,
     quantity: r.quantity,
     prn: r.prn,
     patient_instructions: r.patient_instructions || null,
     aware_classification: r.aware_classification || null,
     amr_override_reason: r.amr_override_reason || null,
     status: 'Pending',
     prescribed_by: form.doctor_name,
     created_at: new Date().toISOString(),
    }))
    const { error: rxErr } = await executeWithFallback(
     () => supabase.from('prescriptions').insert(prescriptionRows),
     async () => supabase.from('prescriptions').insert(
      prescriptionRows.map(({ prn, patient_instructions, aware_classification, ...row }) => row),
     ),
    )
    if (rxErr) { window.notifyFromLegacyAlert('Error saving prescriptions: ' + rxErr.message); setSaving(false); return }
    const cdsOverrideRows = validRx.flatMap((r) => {
     const rowAlerts = cdsAlertsByRow[r.rowIndex] || []
     return rowAlerts
      .filter(alert => alert.severity === 'danger' && r.cds_acknowledged)
      .map(alert => ({
       hospital_id: hospitalId,
       visit_id: selected.id,
       patient_id: selected.patient_id,
       doctor_name: form.doctor_name,
       drug_name: r.drug_name,
       rule: alert.rule,
       acknowledged_at: new Date().toISOString(),
      }))
    })
    if (cdsOverrideRows.length > 0) {
     const { error: cdsOverrideError } = await supabase.from('cds_overrides').insert(cdsOverrideRows)
     if (cdsOverrideError) {
      console.error('CDS override logging failed:', cdsOverrideError)
      window.notifyFromLegacyAlert(`Prescriptions saved, but CDS override audit logging failed: ${cdsOverrideError.message}`)
     }
    }
    validRx
     .filter(r => amrAlerts[r.rowIndex]?.alertLevel === 'warning')
     .forEach(r => {
      void logAudit(supabase, {
       hospitalId,
       userRole,
       action: 'AMR warning shown',
       targetTable: 'prescriptions',
       targetId: selected.id,
       details: {
        visit_id: selected.id,
        patient_id: selected.patient_id,
        drug_name: r.drug_name,
        alert: amrAlerts[r.rowIndex],
       },
      })
     })
    try {
     window.dispatchEvent(new CustomEvent('remedacare:prescriptions_changed', { detail: { visit_id: selected.id } }))
    } catch (e) {}
   }

   // 3. Save lab orders
   const validLabs = labOrders.filter(l => (l.test_type || '').trim())
   if (validLabs.length > 0) {
   const { error: labErr } = await supabase.from('lab_tests').insert(
     validLabs.map(l => ({
      hospital_id: hospitalId,
      visit_id: selected.id,
      patient_id: selected.patient_id,
      patient_name: selected.patients?.full_name,
      test_type: l.test_type,
      category: l.category || 'Other',
      priority: l.priority,
      notes: l.notes,
      status: 'Pending',
      sample_barcode: generateSampleBarcode(),
      sample_status: 'Ordered',
      source: 'Doctor',
      ordered_by: form.doctor_name,
      ordered_at: new Date().toISOString(),
     }))
    )
    if (labErr) { window.notifyFromLegacyAlert('Error saving lab orders: ' + labErr.message); setSaving(false); return }
    try {
     window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: selected.id, source: 'consultation-lab-order', count: validLabs.length } }))
    } catch (e) {}
   }

   // 4. Map disposition → correct visit status
   const validRadiologyOrders = radiologyOrders.filter(order => (order.modality || '').trim() && (order.clinical_indication || '').trim())
   if (validRadiologyOrders.length > 0) {
    const { error: radiologyErr } = await supabase.from('radiology_orders').insert(
     validRadiologyOrders.map(order => ({
      hospital_id: hospitalId,
      visit_id: selected.id,
      patient_id: selected.patient_id,
      requesting_doctor: form.doctor_name || null,
      modality: order.modality,
      body_region: order.body_region || null,
      clinical_indication: order.clinical_indication.trim(),
      priority: order.priority || 'Routine',
      special_instructions: order.special_instructions?.trim() || null,
      status: 'Requested',
      created_by: userRole || 'Staff',
      created_at: new Date().toISOString(),
     })),
    )
    if (radiologyErr) { window.notifyFromLegacyAlert('Error saving radiology orders: ' + radiologyErr.message); setSaving(false); return }
    try {
     window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: selected.id, source: 'consultation-radiology-order', count: validRadiologyOrders.length } }))
    } catch (e) {}
   }

   const isLab = form.disposition.includes('Lab')
   const isAdmit = form.disposition.includes('Admit')
   const isRefer = form.disposition.includes('Refer')

   let newStatus = 'Completed'
   if (isLab) newStatus = 'Lab'
   else if (isPharmacy) newStatus = 'Prescription'
   else if (isAdmit) newStatus = 'Admission Requested'
   else if (isRefer) newStatus = 'Doctor' // re-enters doctor queue at new dept

   // 5. Update visit
   const { error: vErr } = await supabase.from('visits').update({
    status: newStatus,
    speciality: isRefer ? (form.refer_department || form.speciality || null) : (form.speciality || null),
    assigned_doctor_name: isRefer ? (form.refer_to || form.doctor_name) : form.doctor_name,
    doctor_notes: form.diagnosis,
    ...(isRefer && form.refer_ward ? { ward: form.refer_ward } : {}),
    ...(validLabs.length > 0 ? { lab_requested: true } : {}),
   }).eq('id', selected.id).eq('hospital_id', hospitalId)

   if (vErr) { window.notifyFromLegacyAlert('Error updating visit: ' + vErr.message); setSaving(false); return }

   // 6. Delete draft after successful save
   await supabase.from('consultation_drafts').delete().eq('visit_id', selected.id)
   clearLocalConsultationDraft(selected.id)
   setLastLocalDraftAt(null)

   try {
    window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', {
     detail: { visit_id: selected.id, status: newStatus }
    }))
   } catch (e) {}

   await logAudit(supabase, {
    hospitalId,
    userRole,
    action: 'consultation_saved',
    targetTable: 'consultations',
    targetId: selected?.id,
    details: {
     patient: selected?.patients?.full_name,
     diagnosis: form.diagnosis,
     disposition: form.disposition,
    },
   })

   setSelected(null)
   await fetchVisits()

  } catch (e) {
   window.notifyFromLegacyAlert('Error: ' + e.message)
  }
  setSaving(false)
 }

 async function saveDraft() {
  if (!selected) return
  setSavingDraft(true)
 try {
  const draftData = {
   hospital_id: hospitalId,
   visit_id: selected.id,
   patient_id: selected.patient_id,
    form_data: JSON.stringify({ form, rxList, labOrders, radiologyOrders, showRx, showLabOrders, showRadiologyOrders, tab }),
    saved_at: new Date().toISOString()
   }
   const { error } = await supabase
   .from('consultation_drafts')
   .upsert(draftData, { onConflict: 'visit_id' })
  if (error) throw error
   writeLocalConsultationDraft(selected.id, { ...JSON.parse(draftData.form_data), hospital_id: hospitalId, visit_id: selected.id, patient_id: selected.patient_id, saved_at: draftData.saved_at })
   setLastLocalDraftAt(draftData.saved_at)
   window.notifyFromLegacyAlert('Draft saved successfully!')
  } catch (e) {
   window.notifyFromLegacyAlert('Error saving draft: ' + e.message)
  }
  setSavingDraft(false)
 }

 const filtered = visits.filter(v => {
  const name = v.patients?.full_name?.toLowerCase() || ''
  const matchSearch = name.includes(search.toLowerCase()) || v.visit_number?.includes(search)
  const matchSpec = filterSpec === 'All' || v.speciality === filterSpec
  return matchSearch && matchSpec
 })

 const specCounts = {}
 visits.forEach(v => {
  const sp = v.speciality || 'Unassigned'
  specCounts[sp] = (specCounts[sp] || 0) + 1
 })

 const completedLabsThisVisit = labResults.filter(l => l.status === 'Complete')
 const pendingLabsThisVisit = labResults.filter(l => l.status === 'Pending' || l.status === 'In Progress')
 const hasLabResults = completedLabsThisVisit.length > 0
 const stewardshipItems = useMemo(
  () => buildAmrInterventions({
   results: microbiologyResults,
   prescriptions: [],
   interventions: stewardshipInterventions,
   maxAgeDays: 120,
  }),
  [microbiologyResults, stewardshipInterventions],
 )
 const vitalAlerts = useMemo(() => getAbnormalVitalAlerts(vitals), [vitals])
 const bmiSummary = useMemo(() => getBmiSummary(vitals), [vitals])
 const interactionWarnings = useMemo(() => detectPrescriptionInteractions(rxList), [rxList])
 const patientCdsContext = useMemo(() => ([
  ...activePatientPrescriptions,
  {
   __patient_context: true,
   ageYears: Number(selected?.patients?.age || 0),
   weightKg: Number(selected?.patients?.weight_kg || selected?.patients?.weight || 0),
  },
 ]), [activePatientPrescriptions, selected?.patients?.age, selected?.patients?.weight, selected?.patients?.weight_kg])
 const commonDiagnoses = useMemo(
  () => getCommonDiagnosesForDepartment(form.speciality || selected?.speciality || ''),
  [form.speciality, selected?.speciality],
 )
 const diagnosisList = useMemo(
  () => (form.diagnoses || []).filter(item => String(item?.description || '').trim()),
  [form.diagnoses],
 )
 const showPregnancyPrompt = useMemo(() => needsPregnancyPrompt(selected?.patients || {}), [selected?.patients])
 const malariaPrompt = useMemo(() => hasMalariaDiagnosis(diagnosisList), [diagnosisList])
 const tbPrompt = useMemo(() => hasTuberculosisDiagnosis(diagnosisList), [diagnosisList])

 async function handleStewardshipDecision(item, decision) {
  if (!stewardshipSchemaReady || !item.latestIntervention?.id) {
   window.notifyFromLegacyAlert('Run next_upgrade_relations_and_stewardship.sql to enable prescriber acknowledgement inside consultation.')
   return
  }

  const prescriberName = (form.doctor_name || selected?.assigned_doctor_name || '').trim()
  if (!prescriberName) {
   window.notifyFromLegacyAlert('Enter the doctor name before acknowledging stewardship recommendations.')
   return
  }

  const response = String(stewardshipDrafts[item.id] || '').trim()
  if (['Rejected', 'Actioned'].includes(decision) && !response) {
   window.notifyFromLegacyAlert('Add the prescriber response or action taken before saving this decision.')
   return
  }

  setStewardshipSaving(true)
  const now = new Date().toISOString()
  const nextStatus = decision === 'Accepted'
   ? 'accepted'
   : decision === 'Rejected'
    ? 'rejected'
    : decision === 'Actioned'
     ? 'actioned'
     : 'acknowledged'

  const result = await executeWithFallback(
   () => supabase
    .from('stewardship_interventions')
    .update({
     prescriber_name: prescriberName,
     acknowledged_at: item.latestIntervention?.acknowledged_at || now,
     prescriber_decision: decision,
     prescriber_response: response || item.latestIntervention?.prescriber_response || null,
     action_taken: decision === 'Actioned' ? response : item.latestIntervention?.action_taken || null,
     status: nextStatus,
     outcome_status: decision === 'Actioned' ? 'Monitoring' : item.latestIntervention?.outcome_status || 'Monitoring',
     updated_at: now,
    })
    .eq('id', item.latestIntervention.id)
    .eq('hospital_id', hospitalId),
   async compatError => ({ data: null, error: compatError, compatFallback: true }),
  )

  setStewardshipSaving(false)

  if (result.error) {
   window.notifyFromLegacyAlert('Could not save stewardship decision: ' + result.error.message)
   return
  }

  broadcastStewardshipChanged({
   microbiology_result_id: item.id,
   patient_id: selected?.patient_id || null,
   visit_id: selected?.id || null,
   prescriber_decision: decision,
  })
  await loadStewardshipContext(selected, { keepTab: true })
 }

 function interpColor(interp) {
  if (!interp) return null
  const lower = interp.toLowerCase()
  if (lower.includes('abnormal') || lower.includes('positive')) return { bg: '#FCEBEB', color: '#A32D2D' }
  if (lower.includes('normal') || lower.includes('negative')) return { bg: '#F3E8FF', color: '#5B21B6' }
  return { bg: '#FFF3DC', color: '#C07000' }
 }

 if (queueLoading && !selected) return (
  <div style={s.loadWrap}><div style={s.spinner}></div><p style={{ color: '#5B21B6', marginTop: '12px' }}>Loading...</p></div>
 )

 return (
  <div style={s.page}>
   <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}`}</style>

   <div style={s.layout}>
    <ConsultationQueue
      visits={visits}
      search={search}
      setSearch={setSearch}
      filterSpec={filterSpec}
      setFilterSpec={setFilterSpec}
      selected={selected}
      onSelect={selectVisit}
      loading={queueLoading}
      refresh={fetchVisits}
      styles={s}
    />
    {/* RIGHT PANEL */}
    <div style={s.rightPanel}>
     {!selected ? (
      <div style={s.noSelection}>
       <div style={{ fontSize: '64px', marginBottom: '16px' }}></div>
       <div style={{ fontSize: '20px', fontWeight: '700', color: '#333', marginBottom: '8px' }}>Select a patient</div>
       <div style={{ fontSize: '14px', color: '#888' }}>Choose a patient from the queue to start consultation</div>
      </div>
     ) : (
      <>
       {/* Patient header */}
       <div style={s.patHeader}>
        <div style={{ flex: 1, minWidth: 0 }}>
         <PatientWorkflowCard
          patientName={selected.patients?.full_name}
          patient={selected.patients || {}}
          visit={{
           visit_number: selected.visit_number,
           visit_type: selected.visit_type,
           assigned_doctor_name: selected.assigned_doctor_name,
           speciality: selected.speciality,
           chief_complaint: selected.chief_complaint,
          }}
          latestVitals={vitals}
          badges={[
           { label: selected.status || 'Doctor', bg: '#F0EAFC', color: '#7B5EA7' },
           ...(selected.priority === 'Emergency' ? [{ label: 'Emergency', bg: '#FCEBEB', color: '#A32D2D' }] : []),
          ]}
         accentColor="#5B21B6"
         background="#EAF6F1"
         >
          {lastLocalDraftAt && (
           <div style={{ fontSize: 11, color: '#4B5563', marginBottom: 10 }}>
            Draft auto-saved locally at {new Date(lastLocalDraftAt).toLocaleTimeString('en-KE')}
           </div>
          )}
          {(selected.admission_fee || selected.admission_payment_method || selected.mpesa_ref) && (
           <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {selected.admission_fee ? (
             <div style={{ background: '#F4F7F6', border: '1px solid #DDE4E0', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: '#111', fontWeight: 600 }}>
              💰 Consultation Fee: KES {parseFloat(selected.admission_fee || 0).toLocaleString()}
             </div>
            ) : null}
            {selected.admission_payment_method ? (
             <div style={{ background: '#F4F7F6', border: '1px solid #DDE4E0', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: '#111', fontWeight: 600 }}>
              🧾 Payment: {selected.admission_payment_method}
             </div>
            ) : null}
            {selected.mpesa_ref ? (
             <div style={{ background: '#F4F7F6', border: '1px solid #DDE4E0', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: '#111', fontWeight: 600 }}>
              🔗 M-Pesa Ref: {selected.mpesa_ref}
             </div>
            ) : null}
           </div>
          )}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: 10 }}>
           {chronicFollowUpRows.length > 0 && (
            <div
             style={{
              width: '100%',
              background: '#EFF8FF',
              border: '1px solid #B2DDFF',
              borderRadius: 12,
              padding: '12px 14px',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              alignItems: 'center',
             }}
            >
             <div style={{ fontSize: 12, color: '#175CD3', fontWeight: 700 }}>
              This patient is on {[...new Set(chronicFollowUpRows.map(row => row.condition).filter(Boolean))].join(' / ')} follow-up.
             </div>
             <button
              type="button"
              onClick={openChronicDiseaseFromConsultation}
              style={{
               padding: '7px 11px',
               borderRadius: 999,
               border: '1px solid #84CAFF',
               background: '#FFFFFF',
               color: '#175CD3',
               fontSize: 12,
               fontWeight: 700,
               cursor: 'pointer',
              }}
             >
              Open Chronic Disease Record
             </button>
            </div>
           )}
           <button
            type="button"
            onClick={openChronicDiseaseFromConsultation}
            style={{
             padding: '8px 12px',
             borderRadius: 10,
             border: '1px solid #CDE5DD',
             background: '#FFFFFF',
             color: '#5B21B6',
             fontSize: 12,
             fontWeight: 700,
             cursor: 'pointer',
            }}
           >
            Chronic Disease Tracker
           </button>
          </div>
         </PatientWorkflowCard>
        </div>
        <button style={s.closePatBtn} onClick={() => setSelected(null)}></button>
       </div>

       {/* Lab results alert banner */}
       {hasLabResults && (
        <div style={{ margin: '0 20px', marginTop: 12, background: 'linear-gradient(135deg, #F3E8FF, #D4EEE6)', border: '1.5px solid #D8B4FE', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
         onClick={() => setTab('labs')}>
         <span style={{ fontSize: 20 }}>🔬</span>
         <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#5B21B6' }}>
           Lab Results Ready — {completedLabsThisVisit.length} test(s) completed
          </div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
           {completedLabsThisVisit.map(l => l.test_type).join(', ')}
          </div>
         </div>
         <span style={{ fontSize: 12, color: '#5B21B6', fontWeight: 600 }}>View →</span>
        </div>
       )}

       {/* Pending labs warning */}
       {pendingLabsThisVisit.length > 0 && (
        <div style={{ margin: '8px 20px 0', background: '#FFF3DC', border: '1px solid #FAC775', borderRadius: 10, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
         <span style={{ fontSize: 16, animation: 'pulse 2s infinite' }}>⏳</span>
         <div style={{ fontSize: 12, color: '#C07000', fontWeight: 600 }}>
          {pendingLabsThisVisit.length} lab test(s) still pending: {pendingLabsThisVisit.map(l => l.test_type).join(', ')}
         </div>
        </div>
       )}

       {/* Billing status banner */}
       {billingStatus && (
        <div style={{
         margin: '8px 20px 0',
         background: billingStatus.ok ? '#F3E8FF' : '#FCEBEB',
         border: `1px solid ${billingStatus.ok ? '#D8B4FE' : '#F09595'}`,
         borderRadius: 10,
         padding: '8px 14px',
         display: 'flex',
         alignItems: 'center',
         gap: 10,
        }}>
         <span style={{ fontSize: 16 }}>{billingStatus.ok ? '🧾' : '⚠️'}</span>
         <div style={{ fontSize: 12, color: billingStatus.ok ? '#5B21B6' : '#A32D2D', fontWeight: 600 }}>
          {billingStatus.ok ? 'Invoice created: ' : ''}{billingStatus.message}
         </div>
        </div>
       )}

       {/* Tabs */}
       <div style={{ ...s.tabRow, marginTop: hasLabResults || pendingLabsThisVisit.length > 0 ? 12 : 0 }}>
        {[
         ['consult', ' Consultation'],
         ['vitals', ' Vitals'],
         ['labs', `🔬 Lab Results${labResults.length > 0 ? ` (${labResults.length})` : ''}`],
         ['history', '📁 History'],
        ].map(([key, label]) => (
         <button key={key} style={{ ...s.tabBtn, ...(tab === key ? s.tabBtnActive : {}) }} onClick={() => setTab(key)}>
          {label}
          {key === 'history' && prevConsultations.length > 0 && (
           <span style={{ ...s.pill, background: '#F0EAFC', color: '#7B5EA7', marginLeft: '6px', fontSize: '10px' }}>{prevConsultations.length}</span>
          )}
          {key === 'labs' && completedLabsThisVisit.length > 0 && (
           <span style={{ ...s.pill, background: '#F3E8FF', color: '#5B21B6', marginLeft: '4px', fontSize: '10px' }}> {completedLabsThisVisit.length}</span>
          )}
         </button>
        ))}
       </div>

       <div style={s.consultBody}>

        {/* ---- VITALS TAB ---- */}
        {tab === 'vitals' && (
         <div>
          {!vitals ? (
           <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
            <div style={{ fontSize: '32px' }}></div>
            <div style={{ marginTop: '8px' }}>No vitals recorded yet for this visit</div>
           </div>
          ) : (
           <div style={s.vitalsGrid}>
            {[
             ['⚖ Weight', vitals.weight_kg ? `${vitals.weight_kg} kg` : '—'],
             ['📏 Height', vitals.height_cm ? `${vitals.height_cm} cm` : '—'],
             ['📐 BMI', vitals.bmi ? `${vitals.bmi}` : '—'],
             ['❤ BP', vitals.bp_systolic ? `${vitals.bp_systolic}/${vitals.bp_diastolic} mmHg` : '—'],
             ['💓 Pulse', vitals.pulse_bpm ? `${vitals.pulse_bpm} bpm` : '—'],
             ['🌡 Temp', vitals.temperature_c ? `${vitals.temperature_c}°C` : '—'],
             ['🫁 SpO2', vitals.oxygen_sat ? `${vitals.oxygen_sat}%` : '—'],
             ['🫀 RR', vitals.respiratory_rate ? `${vitals.respiratory_rate}/min` : '—'],
             [' Blood Sugar', vitals.blood_sugar ? `${vitals.blood_sugar} mmol/L` : '—'],
            ].map(([label, val]) => (
             <div key={label} style={s.vitalCard}>
              <div style={s.vitalLabel}>{label}</div>
              <div style={s.vitalVal}>{val}</div>
             </div>
            ))}
           </div>
          )}
          {vitals?.recorded_by && (
           <div style={{ fontSize: '12px', color: '#888', textAlign: 'center', marginTop: '12px' }}>
            Recorded by {vitals.recorded_by} at {new Date(vitals.recorded_at).toLocaleTimeString('en-KE')}
           </div>
          )}
         </div>
        )}

        {/* ---- LAB RESULTS TAB ---- */}
        {tab === 'labs' && (
         <ConsultationLabResults
           labResults={labResults}
           allPatientLabs={allPatientLabs}
           antibiograms={antibiograms}
           stewardshipItems={stewardshipItems}
           stewardshipDrafts={stewardshipDrafts}
           stewardshipSchemaReady={stewardshipSchemaReady}
           selected={selected}
           styles={s}
         />
        )}

        {/* ---- HISTORY TAB ---- */}
        {tab === 'history' && (
         <div>
          {prevConsultations.length === 0
           ? <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}><div style={{ fontSize: '32px' }}>📁</div><div style={{ marginTop: '8px' }}>No previous consultations</div></div>
           : prevConsultations.map((c) => (
            <div key={c.id} style={s.historyCard}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
              <div>
               <div style={{ fontWeight: '700', color: '#111', fontSize: '14px' }}>
                {c.diagnosis || 'No diagnosis'}
                {(c.icd10_code || c.icd_code) && (
                  <span style={{ marginLeft: 8, color: '#5B21B6', fontSize: 12 }}>
                    {c.icd10_code || c.icd_code}
                  </span>
                )}
               </div>
               <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                Dr. {c.doctor_name || '—'} • {c.speciality || '—'} • {c.created_at ? new Date(c.created_at).toLocaleDateString('en-KE') : '—'}
               </div>
              </div>
              <span style={{ ...s.pill, background: '#F3E8FF', color: '#5B21B6', fontSize: '11px' }}>{c.disposition || '—'}</span>
             </div>
             {c.presenting_complaint && <div style={s.historyRow}><span style={s.historyLabel}>Complaint</span><span>{c.presenting_complaint}</span></div>}
             {c.examination_findings && <div style={s.historyRow}><span style={s.historyLabel}>Findings</span><span>{c.examination_findings}</span></div>}
             {c.treatment_plan && <div style={s.historyRow}><span style={s.historyLabel}>Treatment</span><span>{c.treatment_plan}</span></div>}
             {c.notes && <div style={s.historyRow}><span style={s.historyLabel}>Notes</span><span>{c.notes}</span></div>}
            </div>
           ))
          }
         </div>
        )}

        {/* ---- CONSULTATION TAB ---- */}
        {tab === 'consult' && (
         <ConsultationForm
           form={form}
           setForm={setForm}
           vitals={vitals}
           saving={saving}
           savingDraft={savingDraft}
           onSave={handleSave}
           onSaveDraft={saveDraft}
           onCancel={() => setSelected(null)}
           departmentNames={departmentNames}
           referralGroups={referralGroups}
           wardsList={wardsList}
           showRx={showRx}
           setShowRx={setShowRx}
           showLabOrders={showLabOrders}
           setShowLabOrders={setShowLabOrders}
           showRadiologyOrders={showRadiologyOrders}
           setShowRadiologyOrders={setShowRadiologyOrders}
           rxList={rxList}
           setRxList={setRxList}
           updateRxField={updateRxField}
           amrAlerts={amrAlerts}
           amrChecking={amrChecking}
           amrDismissed={amrDismissed}
           amrInfoExpanded={amrInfoExpanded}
           amrOverrideOpen={amrOverrideOpen}
           onDismissAmrAlert={index => setAmrDismissed(current => ({ ...current, [index]: true }))}
           onToggleAmrInfo={index => setAmrInfoExpanded(current => ({ ...current, [index]: !current[index] }))}
           onToggleAmrOverride={index => setAmrOverrideOpen(current => ({ ...current, [index]: !current[index] }))}
           onOverrideReasonChange={handleOverrideReasonChange}
           onRemovePrescriptionRow={handleRemovePrescriptionRow}
           onAddPrescriptionRow={handleAddPrescriptionRow}
           inventory={inventory}
           labOrders={labOrders}
           setLabOrders={setLabOrders}
           radiologyOrders={radiologyOrders}
           setRadiologyOrders={setRadiologyOrders}
           recentRadiologyReports={recentRadiologyReports}
           previousConsultations={prevConsultations.slice(0, 3)}
           hospitalName={hospitalName || 'Brightpath Travel Scholars'}
           onOpenCarePathway={openCarePathwayFromConsultation}
           onOpenReferral={openReferralFromConsultation}
           getLabTestsForCategory={getLabTestsForCategory}
           LAB_TEST_CATEGORIES={LAB_TEST_CATEGORIES}
           hasLabResults={hasLabResults}
           completedLabsThisVisit={completedLabsThisVisit}
           commonDiagnoses={commonDiagnoses}
           vitalAlerts={vitalAlerts}
           bmiSummary={bmiSummary}
           interactionWarnings={interactionWarnings}
           patientAllergies={selected.patients?.allergies || ''}
           activePatientPrescriptions={patientCdsContext}
           onSafetyAlertsChange={setCdsAlertsByRow}
           canAcknowledgeDanger={canAcknowledgeDangerAlerts}
           showPregnancyPrompt={showPregnancyPrompt}
           malariaPrompt={malariaPrompt}
           tbPrompt={tbPrompt}
           patient={selected.patients || {}}
           canSaveConsultation={canSaveConsultation}
           canOrderLabs={canOrderLabs}
           styles={s}
         />
        )}
       </div>
      </>
     )}
    </div>
   </div>
  </div>
 )
}

const AVATAR_COLORS = ['#F3E8FF', '#E3F0FB', '#F0EAFC', '#FFF3DC', '#FCEBEB', '#EAF3DE']

const s = {
 page: { padding: '20px 24px', flex: 1, overflowY: 'auto', background: '#f7f8f7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', height: '100%', boxSizing: 'border-box' },
 loadWrap: { height: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
 spinner: { width: '36px', height: '36px', border: '3px solid #e8ebe8', borderTop: '3px solid #5B21B6', borderRadius: '50%', animation: 'spin 0.9s linear infinite' },
 layout: { display: 'flex', gap: '16px', height: 'calc(100vh - 80px)', minHeight: 0 },
 leftPanel: { width: '280px', flexShrink: 0, background: '#fff', borderRadius: '12px', border: '1px solid #eee', padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column' },
 panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
 panelTitle: { fontSize: '15px', fontWeight: '700', color: '#111' },
 panelSub: { fontSize: '12px', color: '#888', marginTop: '2px' },
 refreshBtn: { background: '#f0f2f0', border: 'none', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', fontSize: '14px', color: '#5B21B6', fontWeight: '700' },
 rightPanel: { flex: 1, background: '#fff', borderRadius: '12px', border: '1px solid #eee', overflowY: 'auto', display: 'flex', flexDirection: 'column', minWidth: 0 },
 noSelection: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#bbb' },
 patHeader: { padding: '16px 20px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'flex-start', gap: '12px', background: '#fafafa', borderRadius: '12px 12px 0 0' },
 closePatBtn: { background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#aaa', padding: '4px', flexShrink: 0 },
 tabRow: { display: 'flex', gap: '0', borderBottom: '2px solid #f0f0f0', padding: '0 20px' },
 tabBtn: { padding: '12px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '500', color: '#888', borderBottom: '2px solid transparent', marginBottom: '-2px', display: 'flex', alignItems: 'center' },
 tabBtnActive: { color: '#5B21B6', fontWeight: '700', borderBottom: '2px solid #5B21B6' },
 consultBody: { padding: '20px', flex: 1, overflowY: 'auto' },
 sectionLabel: { fontSize: '11px', fontWeight: '700', color: '#5B21B6', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '12px', marginTop: '4px', paddingBottom: '6px', borderBottom: '1px solid #F3E8FF' },
 formGrid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' },
 formGroup: { marginBottom: '14px' },
 label: { fontSize: '12px', color: '#666', display: 'block', marginBottom: '5px', fontWeight: '500' },
 input: { width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#111', fontFamily: 'inherit' },
 vitalsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' },
 vitalCard: { background: '#f9fafb', borderRadius: '10px', padding: '14px', border: '1px solid #eee', textAlign: 'center' },
 vitalLabel: { fontSize: '12px', color: '#888', marginBottom: '6px' },
 vitalVal: { fontSize: '20px', fontWeight: '800', color: '#5B21B6' },
 historyCard: { background: '#f9fafb', borderRadius: '10px', padding: '16px', border: '1px solid #eee', marginBottom: '12px' },
 historyRow: { fontSize: '13px', color: '#444', marginTop: '6px', display: 'flex', gap: '8px' },
 historyLabel: { fontWeight: '600', color: '#888', fontSize: '11px', textTransform: 'uppercase', minWidth: '70px', marginTop: '1px' },
 dispositionGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' },
 dispOption: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '12px 8px', borderRadius: '10px', border: '2px solid #eee', cursor: 'pointer', textAlign: 'center', background: '#fafafa', transition: 'all 0.15s' },
 dispOptionActive: { border: '2px solid #5B21B6', background: '#F3E8FF' },
 rxRow: { background: '#f9fafb', borderRadius: '8px', padding: '14px', marginBottom: '10px', border: '1px solid #eee' },
 toggleBtn: { fontSize: '12px', padding: '4px 10px', border: '1px solid #5B21B6', borderRadius: '6px', background: '#fff', color: '#5B21B6', cursor: 'pointer', fontWeight: '600' },
 addRowBtn: { fontSize: '13px', padding: '8px 16px', border: '1px dashed #D8B4FE', borderRadius: '8px', background: '#f9fafb', color: '#5B21B6', cursor: 'pointer', fontWeight: '600', width: '100%', marginBottom: '8px' },
 removeBtn: { fontSize: '12px', padding: '4px 10px', border: '1px solid #F09595', borderRadius: '6px', background: '#fff', color: '#A32D2D', cursor: 'pointer' },
 queueItem: { padding: '12px', borderRadius: '10px', border: '1px solid #f0f0f0', marginBottom: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', transition: 'all 0.15s' },
 queueItemActive: { border: '2px solid #5B21B6', background: '#f0faf7' },
 avatar: { width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: '700', color: '#5B21B6' },
 chip: { fontSize: '11px', padding: '4px 10px', borderRadius: '99px', border: '1px solid #e0e0e0', background: '#fff', cursor: 'pointer', fontWeight: '500', color: '#555' },
 chipActive: { background: '#5B21B6', color: '#fff', border: '1px solid #5B21B6' },
 pill: { fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '99px' },
 viewLabel: { fontSize: '11px', color: '#667085', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 },
 viewVal: { fontSize: '13px', color: '#111827', fontWeight: 600 },
 emptyQueue: { textAlign: 'center', padding: '40px 0', color: '#ccc' },
 cancelBtn: { padding: '10px 20px', border: '1px solid #ddd', borderRadius: '8px', background: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '500', color: '#555' },
 submitBtn: { padding: '10px 24px', border: 'none', borderRadius: '8px', background: '#5B21B6', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '600' },
}


