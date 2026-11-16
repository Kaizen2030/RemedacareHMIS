import { Children, cloneElement, isValidElement, useEffect, useId, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { renderToStaticMarkup } from 'react-dom/server'
import supabase from '../supabase'
import { useHospital } from '../context'
import { canAccessScreen, canPerformAction } from '../access'
import { executeWithFallback, omitKeys } from '../utils/dbCompat'
import { inferChronicConditionHint } from '../utils/chronicDisease'
import { buildWorkflowInvoiceNote, createServiceLine, SERVICE_SOURCES, stringifyServiceLines } from '../utils/workflowBilling'
import { getLabTestsForCategory, LAB_TEST_CATEGORIES } from '../utils/labCatalog'
import { generateSampleBarcode } from '../utils/labWorkflow'
import { openRadiologyReportPrintWindow } from '../utils/radiology'
import { isSelfPayMethod, notifySentToCashier, unpaidInvoiceFields } from '../utils/payments/invoices'
import { notifyError, notifySuccess, notifyWarning } from '../notifications'
import { NetworkPatientImport, PatientNetworkPanel } from './patients/NetworkTools'

/*
 * PATIENT WORKFLOW - WHO DOES WHAT
 * --------------------------------
 * REGISTER patient   -> Receptionist, Nurse, Admin
 * RECORD VITALS      -> Nurse, Admin
 * DOCTOR ASSESSMENT  -> Doctor, Clinical Officer, Admin
 * ORDER LAB TESTS    -> Doctor, Admin (from assessment modal)
 * PHARMACY OUTCOME   -> Pharmacist, Admin
 * ADMIT TO WARD      -> Doctor, Nurse, Admin
 * DISCHARGE          -> Doctor, Nurse, Admin
 *
 * The Patients screen is a shared workflow hub - multiple
 * roles see it but each can only action their own step.
 * All other buttons are visible but disabled with tooltips.
 */

import { STEPS, STEP_COLORS, AVATAR_COLORS, BLOOD_GROUP_OPTIONS, REGISTRY_FILTER_DEFAULTS, PATIENT_FOLLOW_UP_STORAGE_KEY, DUPLICATE_SCAN_LIMIT, normalizeText, normalizeDigits, getInitials, hashName, getAvatarStyle, formatCurrency, formatDateTime, formatDate, getAgeBucket, parseAllergyTags, stringifyAllergyTags, buildPatientSearchFields, getPatientPhoneForWhatsApp, getRelativeDaysLabel, getAgeRangeMatch, getRegisteredDateMatch, loadLocalFollowUpFlags, saveLocalFollowUpFlags, samePhoneFamily, detectDuplicatePatientGroups, getDateRange, printReceipt, getPatientCardNumber, printPatientIdCard, printPatientSummary } from './patients/patientHelpers'

export default function Patients() {
 const { hospitalId, userRole, departments: configuredDepartments = [], navigate } = useHospital()
 const isAdmin = ['Admin', 'admin'].includes(userRole || '')
 const canRegister = canPerformAction(userRole, 'register_patient')
 const canVitals = canPerformAction(userRole, 'record_vitals')
 const canDoctor = canPerformAction(userRole, 'write_diagnosis')
 const canLab = canPerformAction(userRole, 'order_labs')
 const canPharmacy = canPerformAction(userRole, 'approve_prescription')
 const canAdmit = canPerformAction(userRole, 'admit_patient')
 const canDischarge = canPerformAction(userRole, 'discharge_patient')
 const canPrint = canPerformAction(userRole, 'create_invoice') || ['Admin','admin'].includes(userRole || '')
 const canViewChronicDisease = canAccessScreen(userRole, '/chronic-disease') || isAdmin

 // data
 const PAGE_SIZE = 50
 const [visits, setVisits] = useState([])
 const [allPatients, setAllPatients] = useState([])
 const [patientPage, setPatientPage] = useState(1)
 const [patientTotal, setPatientTotal] = useState(0)
 const [patientLoading, setPatientLoading] = useState(false)
 const [doctors, setDoctors] = useState([])
 const [hospitalName, setHospitalName] = useState('')

 // ui state
 const [loading, setLoading] = useState(true)
 const [saving, setSaving] = useState(false)
 const [view, setView] = useState('queue') // 'queue' | 'registry'
 const [search, setSearch] = useState('')
 const [searchDraft, setSearchDraft] = useState('')
 const [filterStatus, setFilterStatus] = useState('All')
 const [dateRange, setDateRange] = useState('today')
 const [registryFilters, setRegistryFilters] = useState(REGISTRY_FILTER_DEFAULTS)
const [recentPatients, setRecentPatients] = useState([])
const [patientMetaMap, setPatientMetaMap] = useState({})
const [chronicPatientMap, setChronicPatientMap] = useState({})
const [selectedPatientIds, setSelectedPatientIds] = useState([])
 const [duplicateGroups, setDuplicateGroups] = useState([])
 const [localFollowUpFlags, setLocalFollowUpFlags] = useState(() => loadLocalFollowUpFlags())
 const [registrationComplete, setRegistrationComplete] = useState(null)
 const [allergyInput, setAllergyInput] = useState('')

 // search-first modal
 const [showSearchModal, setShowSearchModal] = useState(false)
 const [searchQuery, setSearchQuery] = useState('')
 const [searchResults, setSearchResults] = useState([])
 const [searching, setSearching] = useState(false)
 const [searchDone, setSearchDone] = useState(false)

 // register modal
 const [showRegister, setShowRegister] = useState(false)
 const [regStep, setRegStep] = useState(1)
 const [isReturning, setIsReturning] = useState(false)
 const [selectedPatient, setSelectedPatient] = useState(null)
 const [editingPatient, setEditingPatient] = useState(null)

 const emptyReg = {
 full_name:'', national_id:'', dob:'', age:'', gender:'Female',
 phone:'', phone2:'', address:'', blood_group:'Unknown',
 allergies:'', allergy_tags: [], chronic_conditions:'',
 patient_number:'', huduma_number:'',
 next_of_kin:'', next_of_kin_name:'', next_of_kin_phone:'', next_of_kin_relationship:'',
 insurance:'', insurer_name:'', insurance_number:'', insurance_member_number:'', sha_member_no:'',
 is_minor:false, guardian_name:'', guardian_id:'', guardian_relationship:'',
 }
 const emptyVisit = { visit_type:'OPD', chief_complaint:'', priority:'Normal', admission_fee:'500', payment_method:'Cash', mpesa_ref:'' }

 const [regForm, setRegForm] = useState(emptyReg)
 const [visitForm, setVisitForm] = useState(emptyVisit)

 // vitals modal
 const [showVitals, setShowVitals] = useState(null)
 const [vitalsForm, setVitalsForm] = useState({
 weight_kg:'', height_cm:'', bp_systolic:'', bp_diastolic:'',
 pulse_bpm:'', temperature_c:'', oxygen_sat:'', respiratory_rate:'',
 blood_sugar:'', recorded_by:'',
 })

 // doctor modal
 const [showDoctor, setShowDoctor] = useState(null)
 const [doctorForm, setDoctorForm] = useState({ doctor_id:'', doctor_name:'', speciality:'', notes:'' })

 // lab modal
 const [showLab, setShowLab] = useState(null)
 const [labCategory, setLabCategory] = useState('Haematology')
 const [labSelectedTests, setLabSelectedTests] = useState([]) // [{category, test_name}]
 const [labCustomTest, setLabCustomTest] = useState('')
 const [labPriority, setLabPriority] = useState('Routine')
 const [labNotes, setLabNotes] = useState('')

 // pharmacy/discharge modal
 const [showPharmacy, setShowPharmacy] = useState(null)
 const [pharmaForm, setPharmaForm] = useState({ prescription:'', outcome:'Outpatient', ward_id:'', bed_id:'', discharge_notes:'', refer_department:'', refer_ward:'' })
 const [wards, setWards] = useState([])
 const [wardBeds, setWardBeds] = useState([])
 const [loadingBeds, setLoadingBeds] = useState(false)
 const [visitPrescriptions, setVisitPrescriptions] = useState([])
 const [prescriptionsLoading, setPrescriptionsLoading] = useState(false)
 const departmentOptions = useMemo(
  () => [...new Set([
   ...configuredDepartments.map(dept => dept?.name).filter(Boolean),
   doctorForm.speciality,
   pharmaForm.refer_department,
  ].filter(Boolean))],
  [configuredDepartments, doctorForm.speciality, pharmaForm.refer_department]
 )

 // view detail modal
const [showDetail, setShowDetail] = useState(null)
const [detailTab, setDetailTab] = useState('overview')
const [radiologyHistory, setRadiologyHistory] = useState([])
 const [radiologyHistoryLoading, setRadiologyHistoryLoading] = useState(false)

 // ── fetch ──────────────────────────────────────────────────────────────────
useEffect(() => {
 if (!hospitalId) { setLoading(false); return }
 fetchData(); fetchDoctors(); fetchHospital(); fetchWards(); fetchRecentPatients(); fetchDuplicateGroups(); fetchChronicPatientMeta()
}, [hospitalId, dateRange])

 useEffect(() => {
  const timer = setTimeout(() => setSearch(searchDraft.trim()), 300)
  return () => clearTimeout(timer)
 }, [searchDraft])

 useEffect(() => {
  saveLocalFollowUpFlags(localFollowUpFlags)
 }, [localFollowUpFlags])

 useEffect(() => {
  if (!showSearchModal) return
  if (!searchQuery.trim()) {
   setSearchResults([])
   setSearchDone(false)
   setSearching(false)
   return
  }
  const timer = setTimeout(() => {
   void handleSearch(searchQuery)
  }, 300)
  return () => clearTimeout(timer)
 }, [showSearchModal, searchQuery, hospitalId])

 useEffect(() => {
  if (!hospitalId || !showDetail?.patient_id) {
   setRadiologyHistory([])
   return
  }
  void (async () => {
   setRadiologyHistoryLoading(true)
   const { data } = await supabase
    .from('radiology_orders')
    .select('*')
    .eq('hospital_id', hospitalId)
    .eq('patient_id', showDetail.patient_id)
    .order('created_at', { ascending: false })
    .limit(12)
   setRadiologyHistory(data || [])
   setRadiologyHistoryLoading(false)
  })()
 }, [hospitalId, showDetail?.patient_id])

useEffect(() => {
 if (!hospitalId) return
 fetchPatientPage(patientPage)
}, [hospitalId, patientPage])

 async function fetchChronicPatientMeta() {
  const { data, error } = await supabase
   .from('chronic_disease_records')
   .select('id, patient_id, patient_name, condition, visit_date, created_at, notes, current_meds, oral_meds, arv_regimen, adherence_score, viral_load, hba1c, bp_systolic, bp_diastolic')
   .eq('hospital_id', hospitalId)
   .order('visit_date', { ascending: false })

  if (error) {
   console.error('fetchChronicPatientMeta error:', error)
   setChronicPatientMap({})
   return
  }

  const grouped = {}
  ;(data || []).forEach(record => {
   if (!record?.patient_id) return
   if (!grouped[record.patient_id]) grouped[record.patient_id] = { conditions: [], latestByCondition: [] }
   if (!grouped[record.patient_id].conditions.includes(record.condition)) {
    grouped[record.patient_id].conditions.push(record.condition)
   }
   if (!grouped[record.patient_id].latestByCondition.some(item => item.condition === record.condition)) {
    grouped[record.patient_id].latestByCondition.push(record)
   }
  })
  setChronicPatientMap(grouped)
 }

 useEffect(() => {
  setSelectedPatientIds([])
 }, [view, patientPage, search, registryFilters])

 function openChronicDiseaseWorkspace(patient, visit = null) {
  const chronicHint = inferChronicConditionHint(
   patient?.chronic_conditions,
   visit?.doctor_notes,
   visit?.chief_complaint,
   visit?.visit_type,
  )

  navigate?.('chronic-disease', {
   patientId: patient?.id || visit?.patient_id || null,
   patientName: patient?.full_name || visit?.patients?.full_name || '',
   visitId: visit?.id || null,
   suggestedCondition: chronicHint,
   source: visit ? 'patients-queue' : 'patients-registry',
  })
 }

 async function fetchWards() {
 const { data, error } = await supabase.from('wards').select('id, name, ward_type').eq('hospital_id', hospitalId).order('name')
 if (error) console.error('fetchWards error:', error)
 console.log('wards fetched:', data)
 setWards(data || [])
 }

 async function fetchBedsForWard(wardId) {
 setLoadingBeds(true)
 const { data } = await supabase.from('beds')
 .select('id, bed_number, status')
 .eq('hospital_id', hospitalId)
 .eq('ward_id', wardId)
 .eq('status', 'Free')
 .order('bed_number')
 setWardBeds(data || [])
 setLoadingBeds(false)
 }

 async function loadVisitPrescriptions(visitId) {
 setPrescriptionsLoading(true)
 const { data, error } = await supabase.from('prescriptions')
 .select('*')
 .eq('hospital_id', hospitalId)
 .eq('visit_id', visitId)
 .order('created_at', { ascending: true })
 if (error) {
 console.error('loadVisitPrescriptions error:', error)
 setVisitPrescriptions([])
 } else {
 setVisitPrescriptions(data || [])
 }
 setPrescriptionsLoading(false)
 }

 async function fetchHospital() {
 const { data } = await supabase.from('hospitals').select('name').eq('id', hospitalId).single()
 if (data) setHospitalName(data.name)
 }

 async function fetchRecentPatients() {
  const { data, error } = await supabase
   .from('visits')
   .select('patient_id, created_at, patients(*)')
   .eq('hospital_id', hospitalId)
   .order('created_at', { ascending: false })
   .limit(20)
  if (error) {
   console.error('fetchRecentPatients error:', error)
   setRecentPatients([])
   return
  }
  const deduped = []
  const seen = new Set()
  ;(data || []).forEach((row) => {
   if (!row?.patient_id || seen.has(row.patient_id) || !row?.patients) return
   seen.add(row.patient_id)
   deduped.push({ ...row.patients, last_visit_at: row.created_at })
  })
  setRecentPatients(deduped.slice(0, 10))
 }

 async function fetchDuplicateGroups() {
  const { data, error } = await supabase
   .from('patients')
   .select('id, hospital_id, full_name, phone, patient_number, national_id, created_at')
   .eq('hospital_id', hospitalId)
   .order('created_at', { ascending: false })
   .limit(DUPLICATE_SCAN_LIMIT)
  if (error) {
   console.error('fetchDuplicateGroups error:', error)
   setDuplicateGroups([])
   return
  }
  setDuplicateGroups(detectDuplicatePatientGroups(data || []))
 }

 async function fetchPatientRegistryMeta(rows = []) {
  const patientIds = [...new Set((rows || []).map(row => row?.id).filter(Boolean))]
  if (patientIds.length === 0) {
   setPatientMetaMap({})
   return
  }
  const [{ data: visitsData }, { data: invoicesData }] = await Promise.all([
   supabase
    .from('visits')
    .select('id, patient_id, visit_number, status, created_at, priority')
    .eq('hospital_id', hospitalId)
    .in('patient_id', patientIds)
    .order('created_at', { ascending: false }),
   supabase
    .from('invoices')
    .select('patient_id, balance_kes, status, amount_kes')
    .eq('hospital_id', hospitalId)
    .in('patient_id', patientIds),
  ])

  const nextMeta = {}
  rows.forEach((patient) => {
   const patientVisits = (visitsData || []).filter(visit => visit.patient_id === patient.id)
   const latestVisit = patientVisits[0] || null
   const patientInvoices = (invoicesData || []).filter(invoice => invoice.patient_id === patient.id)
   const outstandingBalance = patientInvoices.reduce((sum, invoice) => sum + Number(invoice.balance_kes || 0), 0)
   nextMeta[patient.id] = {
    latestVisit,
    lastVisitAt: latestVisit?.created_at || null,
    outstandingBalance,
    hasOutstandingBalance: outstandingBalance > 0,
    followUpNeeded: Boolean(patient.follow_up_needed || localFollowUpFlags[patient.id]),
   }
  })
  setPatientMetaMap(nextMeta)
 }

 async function getNextPatientNumber() {
  const year = new Date().getFullYear()
  const prefix = `RMC-${year}-`
  const { data } = await supabase
   .from('patients')
   .select('patient_number')
   .eq('hospital_id', hospitalId)
   .ilike('patient_number', `${prefix}%`)
   .order('created_at', { ascending: false })
   .limit(50)
  const nextSequence = (data || []).reduce((max, row) => {
   const match = String(row.patient_number || '').match(/RMC-\d{4}-(\d{4})$/)
   return Math.max(max, match ? Number(match[1]) : 0)
  }, 0) + 1
  return `${prefix}${String(nextSequence).padStart(4, '0')}`
 }

 function updateAllergyTags(nextTags) {
  const tags = parseAllergyTags(nextTags)
  setRegForm(prev => ({ ...prev, allergy_tags: tags, allergies: stringifyAllergyTags(tags) }))
 }

 function addAllergyTag(rawValue) {
  const token = String(rawValue || '').trim()
  if (!token) return
  updateAllergyTags([...(regForm.allergy_tags || []), token])
  setAllergyInput('')
 }

 function removeAllergyTag(tag) {
  updateAllergyTags((regForm.allergy_tags || []).filter(item => item !== tag))
 }

 function buildPatientPayload(form) {
  const allergyTags = parseAllergyTags(form.allergy_tags?.length ? form.allergy_tags : form.allergies)
  const insurerName = form.insurer_name || form.insurance || ''
  const insuranceMemberNumber = form.insurance_member_number || form.insurance_number || ''
  return {
   ...omitKeys(form, ['id', 'hospital_id', 'created_at', 'updated_at', 'allergy_tags']),
   full_name: form.full_name?.trim(),
   patient_number: form.patient_number || '',
   blood_group: form.blood_group || 'Unknown',
   allergies: stringifyAllergyTags(allergyTags),
   next_of_kin: form.next_of_kin_name || form.next_of_kin || '',
   next_of_kin_name: form.next_of_kin_name || form.next_of_kin || '',
   next_of_kin_phone: form.next_of_kin_phone || '',
   next_of_kin_relationship: form.next_of_kin_relationship || '',
   insurer: insurerName || null,
   insurance: insurerName || null,
   insurance_number: insuranceMemberNumber || null,
   insurance_member_number: insuranceMemberNumber || null,
   sha_member_no: form.sha_member_no || null,
   huduma_number: form.huduma_number || null,
  }
 }

 async function fetchData() {
 setLoading(true)
 const since = getDateRange(dateRange)
 const { data: v } = await supabase
 .from('visits').select('*, patients(*)')
 .eq('hospital_id', hospitalId)
 .gte('created_at', since)
 .order('created_at', { ascending: false })
 setVisits(v || [])
 setLoading(false)
 }

 async function fetchPatientPage(page = 1) {
 setPatientLoading(true)
 const from = (page - 1) * PAGE_SIZE
 const to = page * PAGE_SIZE - 1
 const { data, count, error } = await supabase
 .from('patients')
 .select('*', { count: 'exact' })
 .eq('hospital_id', hospitalId)
 .order('created_at', { ascending: false })
 .range(from, to)
 if (error) {
 console.error('fetchPatientPage error:', error.message)
 setAllPatients([])
 setPatientTotal(0)
 } else {
 setAllPatients(data || [])
 setPatientTotal(count || 0)
 await fetchPatientRegistryMeta(data || [])
 }
 setPatientLoading(false)
 }

 async function fetchDoctors() {
 const { data } = await supabase.from('staff')
 .select('*')
 .eq('hospital_id', hospitalId)
 .eq('status', 'Active')
 .or(`role.eq.Doctor,role.eq.Clinical Officer,role_category.eq.Doctors & Clinical Officers`)
 .order('current_shift', { ascending: false })
 .order('full_name', { ascending: true })
 const candidates = (data || []).filter(d => d.role === 'Doctor' || d.role === 'Clinical Officer' || d.role_category === 'Doctors & Clinical Officers')
 const sorted = candidates.sort((a, b) => {
  const aOn = a.current_shift && !a.current_shift.toLowerCase().includes('off')
  const bOn = b.current_shift && !b.current_shift.toLowerCase().includes('off')
  if (aOn !== bOn) return aOn ? -1 : 1
  return String(a.full_name || '').localeCompare(String(b.full_name || ''))
 })
 setDoctors(sorted)
 }

 // ── search patients ────────────────────────────────────────────────────────
async function handleSearch(explicitQuery = searchQuery) {
 if (!String(explicitQuery || '').trim()) return
 setSearching(true); setSearchDone(false)
 const q = String(explicitQuery || '').trim()
 const primarySearch = async () => supabase.from('patients').select('*')
 .eq('hospital_id', hospitalId)
 .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,phone2.ilike.%${q}%,national_id.ilike.%${q}%,patient_number.ilike.%${q}%,guardian_id.ilike.%${q}%,huduma_number.ilike.%${q}%`)
 .limit(12)
 const fallbackSearch = async () => supabase.from('patients').select('*')
 .eq('hospital_id', hospitalId)
 .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,phone2.ilike.%${q}%,national_id.ilike.%${q}%,patient_number.ilike.%${q}%,guardian_id.ilike.%${q}%`)
 .limit(12)
 let { data, error } = await primarySearch()
 if (error) {
  console.warn('handleSearch primary query failed, retrying without huduma_number:', error.message)
  ;({ data, error } = await fallbackSearch())
 }
 if (error) {
  console.error('handleSearch error:', error)
  setSearchResults([])
 } else {
  setSearchResults(data || [])
 }
 setSearchDone(true); setSearching(false)
 }

function openNewPatient() {
 if (!canRegister) { notifyWarning('Only receptionists, nurses and admins can register patients.'); return }
 setShowSearchModal(false); setIsReturning(false); setSelectedPatient(null); setEditingPatient(null)
 setVisitForm(emptyVisit); setRegStep(1); setAllergyInput(''); setRegistrationComplete(null)
 setShowRegister(true)
 void (async () => {
  const patientNumber = await getNextPatientNumber()
  setRegForm({ ...emptyReg, patient_number: patientNumber, allergy_tags: [] })
 })()
 }

function selectReturningPatient(patient) {
 if (!canRegister) { notifyWarning('Only receptionists, nurses and admins can register patients.'); return }
 setShowSearchModal(false); setIsReturning(true); setSelectedPatient(patient)
 setEditingPatient(null)
 setRegForm({
  ...emptyReg,
  ...patient,
  insurer_name: patient.insurer || patient.insurance || '',
  insurance_member_number: patient.insurance_member_number || patient.insurance_number || '',
  sha_member_no: patient.sha_member_no || '',
  blood_group: patient.blood_group || 'Unknown',
  next_of_kin_name: patient.next_of_kin_name || patient.next_of_kin || '',
  allergy_tags: parseAllergyTags(patient.allergies),
 }); setAllergyInput(''); setVisitForm({ ...emptyVisit, admission_fee:'300' })
 setRegStep(2); setShowRegister(true)
}

 // ── REGISTER ──────────────────────────────────────────────────────────────
function openEditPatient(patient) {
 if (!canRegister) { notifyWarning('Only receptionists, nurses and admins can edit patient records.'); return }
 setShowSearchModal(false)
 setIsReturning(false)
 setSelectedPatient(patient)
 setEditingPatient(patient)
 setRegForm({
  ...emptyReg,
  ...patient,
  insurer_name: patient.insurer || patient.insurance || '',
  insurance_member_number: patient.insurance_member_number || patient.insurance_number || '',
  sha_member_no: patient.sha_member_no || '',
  blood_group: patient.blood_group || 'Unknown',
  next_of_kin_name: patient.next_of_kin_name || patient.next_of_kin || '',
  allergy_tags: parseAllergyTags(patient.allergies),
 })
 setAllergyInput('')
 setVisitForm(emptyVisit)
 setRegStep(1)
 setShowRegister(true)
}

async function handleSavePatientProfile() {
 if (!canRegister) { notifyWarning('Only receptionists, nurses and admins can edit patient records.'); return }
 if (!editingPatient?.id) return
 if (!regForm.full_name?.trim()) { notifyWarning('Full name required'); return }
 setSaving(true)
 const payload = buildPatientPayload({ ...regForm, full_name: regForm.full_name.trim() })
 const { error } = await executeWithFallback(
  () => supabase
   .from('patients')
   .update(payload)
   .eq('id', editingPatient.id)
   .eq('hospital_id', hospitalId),
  async () => supabase
   .from('patients')
   .update(omitKeys(payload, ['huduma_number', 'insurance_member_number', 'insurer_name', 'sha_member_no']))
   .eq('id', editingPatient.id)
   .eq('hospital_id', hospitalId),
 )
 if (error) {
  notifyError('Error: ' + error.message)
  setSaving(false)
  return
 }
 setShowRegister(false)
 setEditingPatient(null)
 setSelectedPatient(null)
 setRegForm(emptyReg)
 await Promise.all([fetchPatientPage(patientPage), fetchData(), fetchRecentPatients(), fetchDuplicateGroups()])
 setSaving(false)
}

async function handleRegister() {
 if (!canRegister) { notifyWarning('Only receptionists, nurses and admins can register patients.'); return }
 if (!visitForm.admission_fee || parseFloat(visitForm.admission_fee) <= 0) { notifyWarning('Enter a valid fee.'); return }
 if (visitForm.payment_method === 'M-Pesa' && !visitForm.mpesa_ref) { notifyWarning('Enter M-Pesa reference.'); return }
 setSaving(true)
 try {
 let patientId = selectedPatient?.id
 let patientRecord = selectedPatient || null
 if (!isReturning) {
 if (regForm.national_id || regForm.phone) {
  const { data: ex } = await supabase.from('patients').select('id')
  .eq('hospital_id', hospitalId)
  .or(`national_id.eq.${regForm.national_id},phone.eq.${regForm.phone}`)
  .maybeSingle()
  if (ex) patientId = ex.id
 }
 if (!patientId) {
 const patientPayload = {
  ...buildPatientPayload({
   ...regForm,
   patient_number: regForm.patient_number || await getNextPatientNumber(),
  }),
  hospital_id: hospitalId,
 }
 const { data: np, error } = await executeWithFallback(
  () => supabase.from('patients').insert(patientPayload).select().single(),
  async () => supabase.from('patients').insert(omitKeys(patientPayload, ['huduma_number', 'insurance_member_number', 'insurer_name', 'sha_member_no'])).select().single(),
 )
 if (error) { notifyError('Error: ' + error.message); setSaving(false); return }
 patientId = np.id
 patientRecord = np
 }
 }

 const visitNumber = `V-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`
 // Emergency skips vitals
 const initialStatus = visitForm.priority === 'Emergency' ? 'Doctor' : 'Vitals'

 const { data: createdVisit, error: vErr } = await supabase.from('visits').insert({
 hospital_id: hospitalId, patient_id: patientId,
 visit_number: visitNumber,
 visit_type: visitForm.visit_type,
 chief_complaint: visitForm.chief_complaint,
 priority: visitForm.priority,
 admission_fee: parseFloat(visitForm.admission_fee),
 admission_payment_method: visitForm.payment_method,
 mpesa_ref: visitForm.mpesa_ref || null,
 status: initialStatus,
 }).select('id, visit_number').single()
 if (vErr) { notifyError('Error: ' + vErr.message); setSaving(false); return }

 // Sales ledger
 const visitLedgerPayload = {
  hospital_id: hospitalId, patient_id: patientId,
  visit_id: createdVisit?.id || null,
  patient_name: regForm.full_name || selectedPatient?.full_name,
  drug_name: `${visitForm.visit_type} Consultation Fee`,
  quantity: 1, unit_price: parseFloat(visitForm.admission_fee),
  total_kes: parseFloat(visitForm.admission_fee),
  payment_method: visitForm.payment_method, mpesa_ref: visitForm.mpesa_ref || null,
  sold_at: new Date().toISOString(), category: 'Consultation',
 }
 await executeWithFallback(
  () => supabase.from('sales_ledger').insert(visitLedgerPayload),
  async () => supabase.from('sales_ledger').insert(omitKeys(visitLedgerPayload, ['visit_id'])),
 )

 const consultationAmount = parseFloat(visitForm.admission_fee) || 0
 const mappedPaymentMethod =
  visitForm.payment_method === 'SHA'
   ? 'SHA (Social Health Authority)'
   : visitForm.payment_method
 const isInsurancePayment = !isSelfPayMethod(mappedPaymentMethod)

const { data: visitInvoice, error: invoiceErr } = await supabase.from('invoices').insert({
  hospital_id: hospitalId,
  patient_id: patientId,
  visit_id: createdVisit?.id || null,
  patient_name: regForm.full_name || selectedPatient?.full_name,
  invoice_no: `INV-${Date.now().toString().slice(-6)}`,
  services: stringifyServiceLines([
   createServiceLine({
    label: `${visitForm.visit_type} Consultation Fee`,
    qty: 1,
    unitPrice: consultationAmount,
    total: consultationAmount,
    source: SERVICE_SOURCES.CONSULTATION,
    sourceId: createdVisit?.id || visitNumber,
    visitId: createdVisit?.id || null,
   }),
  ]),
  ...unpaidInvoiceFields(consultationAmount),
  payment_method: mappedPaymentMethod,
  insurer: mappedPaymentMethod === 'SHA (Social Health Authority)' ? 'SHA' : (isInsurancePayment ? mappedPaymentMethod : null),
  sha_member_no: mappedPaymentMethod === 'SHA (Social Health Authority)' ? (regForm.sha_member_no || regForm.insurance_member_number || regForm.insurance_number || selectedPatient?.sha_member_no || null) : null,
  notes: buildWorkflowInvoiceNote({
   source: SERVICE_SOURCES.CONSULTATION,
   sourceId: createdVisit?.visit_number || visitNumber,
   visitId: createdVisit?.id || null,
   summary: `Consultation fee for ${createdVisit?.visit_number || visitNumber}`,
  }),
  created_at: new Date().toISOString(),
 }).select('*').single()
 if (invoiceErr) { console.error('Consultation invoice creation failed', invoiceErr) }

 // Self-pay visit fee is paid at the cashier, who prints the official receipt.
 const feeAtCashier = Boolean(visitInvoice && !isInsurancePayment && consultationAmount > 0)
 if (feeAtCashier) {
   notifySentToCashier(visitInvoice, 'Visit created')
 } else if (!canPrint) {
   notifyWarning('Only billing-authorized users can print receipts.')
 } else {
   printReceipt(hospitalName, hospitalId, patientRecord || selectedPatient || regForm, {
     visit_number: visitNumber, visit_type: visitForm.visit_type,
     admission_fee: visitForm.admission_fee, payment_method: visitForm.payment_method,
     mpesa_ref: visitForm.mpesa_ref
   })
 }

 setShowRegister(false)
 setEditingPatient(null)
 setSearchQuery(''); setSearchResults([]); setSearchDone(false)
 setRegistrationComplete({
  patientId,
  visitId: createdVisit?.id || null,
  visitStatus: createdVisit?.status || initialStatus,
  patientName: patientRecord?.full_name || regForm.full_name || selectedPatient?.full_name || 'Patient',
  visitNumber: createdVisit?.visit_number || visitNumber,
 })
 try {
  window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: createdVisit?.id, source: 'patient-registration' } }))
 } catch (e) {}
 await Promise.all([fetchData(), fetchPatientPage(patientPage), fetchRecentPatients(), fetchDuplicateGroups()])
} catch (e) { notifyError('Error: ' + e.message) }
 setSaving(false)
 }

 // ── VITALS ────────────────────────────────────────────────────────────────
async function openPatientTimeline(record, highlightedVisitId = null) {
 const basePatient = record?.patients || record || null
 const patientId = record?.patient_id || basePatient?.id
 if (!patientId) return
 setShowDetail({ patient_id: patientId, patients: basePatient, loading: true, timeline: [], workflowEvents: [], highlightedVisitId })
 try {
  const { data: patientRow } = await supabase
   .from('patients')
   .select('*')
   .eq('hospital_id', hospitalId)
   .eq('id', patientId)
   .single()

  const { data: visitRows } = await supabase
   .from('visits')
   .select('*')
   .eq('hospital_id', hospitalId)
   .eq('patient_id', patientId)
   .order('created_at', { ascending: false })

  const visitIds = (visitRows || []).map(visit => visit.id).filter(Boolean)
  const [
   consultationsResult,
   prescriptionsResult,
   labTestsResult,
   invoicesResult,
  workflowEventsResult,
  ] = await Promise.all([
   visitIds.length ? supabase.from('consultations').select('*').eq('hospital_id', hospitalId).in('visit_id', visitIds).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
   visitIds.length ? supabase.from('prescriptions').select('*').eq('hospital_id', hospitalId).in('visit_id', visitIds).order('created_at', { ascending: true }) : Promise.resolve({ data: [] }),
   visitIds.length ? supabase.from('lab_tests').select('*').eq('hospital_id', hospitalId).in('visit_id', visitIds).order('created_at', { ascending: true }) : Promise.resolve({ data: [] }),
   visitIds.length ? supabase.from('invoices').select('id, visit_id, invoice_no, amount_kes, paid_kes, balance_kes, status, payment_method, created_at').eq('hospital_id', hospitalId).in('visit_id', visitIds).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
  supabase.from('workflow_events').select('id, patient_id, visit_id, source_module, event_type, record_id, payload, created_at').eq('hospital_id', hospitalId).eq('patient_id', patientId).order('created_at', { ascending: false }).limit(100),
  ])

  const consultationsByVisit = Object.fromEntries((consultationsResult.data || []).map(item => [item.visit_id, item]))
  const prescriptionsByVisit = (prescriptionsResult.data || []).reduce((acc, item) => {
   if (!acc[item.visit_id]) acc[item.visit_id] = []
   acc[item.visit_id].push(item)
   return acc
  }, {})
  const labsByVisit = (labTestsResult.data || []).reduce((acc, item) => {
   if (!acc[item.visit_id]) acc[item.visit_id] = []
   acc[item.visit_id].push(item)
   return acc
  }, {})
  const invoicesByVisit = (invoicesResult.data || []).reduce((acc, item) => {
   if (!acc[item.visit_id]) acc[item.visit_id] = item
   return acc
  }, {})

 const timeline = (visitRows || []).map((visit) => ({
   ...visit,
   consultation: consultationsByVisit[visit.id] || null,
   prescriptions: prescriptionsByVisit[visit.id] || [],
   labTests: labsByVisit[visit.id] || [],
   invoice: invoicesByVisit[visit.id] || null,
  }))

 setShowDetail({
   patient_id: patientId,
   patients: patientRow || basePatient,
   loading: false,
   highlightedVisitId,
   timeline,
  workflowEvents: workflowEventsResult.error ? [] : (workflowEventsResult.data || []),
   chronicRecords: chronicPatientMap[patientId]?.latestByCondition || [],
  })
  setDetailTab('overview')
} catch (error) {
  console.error('openPatientTimeline error:', error)
  notifyError(`Could not load patient timeline: ${error.message}`)
  setShowDetail(null)
 }
 }

 function togglePatientSelection(patientId) {
 setSelectedPatientIds(prev => prev.includes(patientId) ? prev.filter(id => id !== patientId) : [...prev, patientId])
 }

 function toggleSelectAllVisible(checked, rows) {
 setSelectedPatientIds(checked ? rows.map(row => row.id) : [])
 }

 function buildWhatsAppReminderMessage(patient) {
 return `Hello ${patient.full_name || 'patient'}, this is a reminder from ${hospitalName || 'RemaCare Hospital'} for your follow-up care. Please contact us if you need assistance.`
 }

 function handleBulkWhatsAppReminder(rows) {
 const selectedRows = rows.filter(row => selectedPatientIds.includes(row.id))
 const withPhones = selectedRows.filter(row => getPatientPhoneForWhatsApp(row))
 if (withPhones.length === 0) {
  notifyWarning('Select at least one patient with a phone number.')
  return
 }
 withPhones.forEach((patient) => {
  const phone = getPatientPhoneForWhatsApp(patient)
  const text = encodeURIComponent(buildWhatsAppReminderMessage(patient))
  window.open(`https://wa.me/${phone}?text=${text}`, '_blank', 'noopener,noreferrer')
 })
 }

 async function handleBulkFollowUp(rows) {
 const selectedRows = rows.filter(row => selectedPatientIds.includes(row.id))
 if (selectedRows.length === 0) {
  notifyWarning('Select at least one patient first.')
  return
 }
 const nowIso = new Date().toISOString()
 const ids = selectedRows.map(row => row.id)
 const result = await executeWithFallback(
  () => supabase.from('patients').update({ follow_up_needed: true, follow_up_marked_at: nowIso }).eq('hospital_id', hospitalId).in('id', ids),
  async () => supabase.from('patients').update({ updated_at: nowIso }).eq('hospital_id', hospitalId).in('id', ids),
 )
 if (result.error) {
  notifyError(`Could not mark follow-up patients: ${result.error.message}`)
  return
 }
 const nextFlags = { ...localFollowUpFlags }
 ids.forEach((id) => { nextFlags[id] = nowIso })
 setLocalFollowUpFlags(nextFlags)
 setSelectedPatientIds([])
 await fetchPatientPage(patientPage)
 }

 async function handleMergePatients(primaryPatient, duplicatePatient) {
 if (!isAdmin) {
  notifyWarning('Only Admin users can merge duplicate patients.')
  return
 }
 const confirmed = await window.openConfirmDialog(`Merge ${duplicatePatient.full_name} into ${primaryPatient.full_name}? This will move visits, invoices, labs, claims, and prescriptions to the kept record.`)
 if (!confirmed) return

 const keeper = primaryPatient
 const source = duplicatePatient
 const mergedPatientPayload = {
  full_name: keeper.full_name || source.full_name,
  patient_number: keeper.patient_number || source.patient_number || '',
  national_id: keeper.national_id || source.national_id || '',
  huduma_number: keeper.huduma_number || source.huduma_number || '',
  dob: keeper.dob || source.dob || '',
  age: keeper.age || source.age || '',
  gender: keeper.gender || source.gender || '',
  phone: keeper.phone || source.phone || '',
  phone2: keeper.phone2 || source.phone2 || '',
  address: keeper.address || source.address || '',
  blood_group: keeper.blood_group || source.blood_group || 'Unknown',
  allergies: keeper.allergies || source.allergies || '',
  chronic_conditions: keeper.chronic_conditions || source.chronic_conditions || '',
  next_of_kin: keeper.next_of_kin || source.next_of_kin || '',
  next_of_kin_name: keeper.next_of_kin_name || source.next_of_kin_name || '',
  next_of_kin_phone: keeper.next_of_kin_phone || source.next_of_kin_phone || '',
  next_of_kin_relationship: keeper.next_of_kin_relationship || source.next_of_kin_relationship || '',
  insurer: keeper.insurer || keeper.insurance || source.insurer || source.insurance || null,
  insurance: keeper.insurer || keeper.insurance || source.insurer || source.insurance || null,
  insurance_number: keeper.insurance_number || source.insurance_number || null,
  insurance_member_number: keeper.insurance_member_number || source.insurance_member_number || null,
  sha_member_no: keeper.sha_member_no || source.sha_member_no || null,
 }

 const patientIdTables = ['visits', 'consultations', 'lab_tests', 'prescriptions', 'invoices', 'radiology_orders', 'admissions', 'appointments', 'sha_claims', 'insurance_claims', 'microbiology_results']
 try {
  setSaving(true)
  await executeWithFallback(
   () => supabase.from('patients').update(mergedPatientPayload).eq('hospital_id', hospitalId).eq('id', keeper.id),
   async () => supabase.from('patients').update(omitKeys(mergedPatientPayload, ['huduma_number', 'insurance_member_number', 'sha_member_no'])).eq('hospital_id', hospitalId).eq('id', keeper.id),
  )
  for (const table of patientIdTables) {
   const { error } = await supabase.from(table).update({ patient_id: keeper.id }).eq('hospital_id', hospitalId).eq('patient_id', source.id)
   if (error) throw error
  }
  const { error: deleteError } = await supabase.from('patients').delete().eq('hospital_id', hospitalId).eq('id', source.id)
  if (deleteError) throw deleteError
  notifySuccess(`Merged duplicate patient records into ${keeper.full_name}.`)
  await Promise.all([fetchPatientPage(patientPage), fetchRecentPatients(), fetchDuplicateGroups(), fetchData()])
 } catch (error) {
  notifyError(`Patient merge failed: ${error.message}`)
 } finally {
  setSaving(false)
 }
 }

 async function handleSaveVitals() {
 if (!canVitals) { notifyWarning('Only nurses and admins can record vitals.'); return }
 if (!vitalsForm.weight_kg || !vitalsForm.bp_systolic) { notifyWarning('Weight and Systolic BP required.'); return }
 setSaving(true)
 const bmi = vitalsForm.weight_kg && vitalsForm.height_cm
 ? parseFloat((parseFloat(vitalsForm.weight_kg) / Math.pow(parseFloat(vitalsForm.height_cm)/100, 2)).toFixed(1))
 : null
 await supabase.from('vitals').insert({
 hospital_id: hospitalId, visit_id: showVitals.id, patient_id: showVitals.patient_id,
 ...vitalsForm, bmi, recorded_at: new Date().toISOString(),
 })
 await supabase.from('visits').update({ status: 'Doctor' })
 .eq('id', showVitals.id).eq('hospital_id', hospitalId)
 setShowVitals(null)
 setVitalsForm({ weight_kg:'', height_cm:'', bp_systolic:'', bp_diastolic:'', pulse_bpm:'', temperature_c:'', oxygen_sat:'', respiratory_rate:'', blood_sugar:'', recorded_by:'' })
 try {
  window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: showVitals.id, status: 'Doctor', source: 'patient-vitals' } }))
 } catch (e) {}
 await fetchData(); setSaving(false)
 }

 // ── DOCTOR ────────────────────────────────────────────────────────────────
 async function handleSaveDoctor(nextStatus) {
 if (!canDoctor) { notifyWarning('Only doctors, clinical officers and admins can assess patients.'); return }
 if (nextStatus === 'Lab' && !canLab) { notifyWarning('Only doctors can order lab tests.'); return }
 if (nextStatus === 'Admitted' && !canAdmit) { notifyWarning('Only doctors and nurses can process admissions.'); return }
 if (!doctorForm.doctor_name) { notifyWarning('Enter doctor name.'); return }
 setSaving(true)
 const { error } = await supabase.from('visits').update({
 assigned_doctor_name: doctorForm.doctor_name,
 speciality: doctorForm.speciality,
 doctor_notes: doctorForm.notes,
 status: nextStatus,
 }).eq('id', showDoctor.id).eq('hospital_id', hospitalId)
 if (error) { notifyError('Error: ' + error.message); setSaving(false); return }
 setShowDoctor(null)
 setDoctorForm({ doctor_id:'', doctor_name:'', speciality:'', notes:'' })
 try {
  window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: showDoctor.id, status: nextStatus, source: 'patient-doctor-routing' } }))
 } catch (e) {}
 await fetchData(); setSaving(false)
 }

 // ── LAB ───────────────────────────────────────────────────────────────────
 function toggleLabTest(testName) {
 setLabSelectedTests(prev => {
 const exists = prev.find(t => t.test_name === testName)
 if (exists) return prev.filter(t => t.test_name !== testName)
 return [...prev, { category: labCategory, test_name: testName }]
 })
 }

 function addCustomLabTest() {
 const name = labCustomTest.trim()
 if (!name) return
 if (labSelectedTests.find(t => t.test_name === name)) { setLabCustomTest(''); return }
 setLabSelectedTests(prev => [...prev, { category: labCategory, test_name: name }])
 setLabCustomTest('')
 }

 async function handleSaveLab() {
 if (!canLab) { notifyWarning('Only doctors can order lab tests.'); return }
 if (labSelectedTests.length === 0) { notifyWarning('Select at least one test.'); return }
 setSaving(true)
 const visit = showLab
 const p = visit.patients || {}

 // Insert each test as a separate row in lab_tests
 const rows = labSelectedTests.map(t => ({
 hospital_id: hospitalId,
 visit_id: visit.id,
 patient_id: visit.patient_id,
 patient_name: p.full_name || '',
 phone: p.phone || '',
 test_type: t.test_name,
 category: t.category,
 priority: labPriority,
 notes: labNotes || null,
 ordered_by: visit.assigned_doctor_name ? `Dr. ${visit.assigned_doctor_name}` : 'Doctor',
 source: 'Doctor',
 status: 'Pending',
 sample_barcode: generateSampleBarcode(),
 sample_status: 'Ordered',
 ordered_at: new Date().toISOString(),
 }))

 const { error } = await supabase.from('lab_tests').insert(rows)
 if (error) { notifyError('Error saving tests: ' + error.message); setSaving(false); return }

 // Keep visit at 'Lab' — Laboratory.jsx will push it back to 'Doctor' when all tests done
 await supabase.from('visits').update({ status: 'Lab', lab_requested: true })
 .eq('id', visit.id).eq('hospital_id', hospitalId)

 setShowLab(null)
 setLabSelectedTests([]); setLabCustomTest(''); setLabPriority('Routine'); setLabNotes('')
 try {
  window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: visit.id, status: 'Lab', source: 'patient-lab-order', count: rows.length } }))
 } catch (e) {}
 await fetchData(); setSaving(false)
 }

 // ── PHARMACY / DISCHARGE ──────────────────────────────────────────────────
 async function handleSavePharmacy() {
 const activeStatus = showPharmacy?.status
 if (activeStatus === 'Pharmacy' && !canPharmacy) {
  notifyWarning('Only pharmacists and admins can process pharmacy outcomes.')
  return
 }
 if (activeStatus === 'Admission Requested' && !canAdmit) {
  notifyWarning('Only doctors and nurses can process admissions.')
  return
 }
 if (activeStatus === 'Admitted' && !canDischarge) {
  notifyWarning('Only doctors, nurses and admins can discharge patients.')
  return
 }
 const { outcome, bed_id, ward_id, refer_department, refer_ward } = pharmaForm

 // Validate
 if (outcome === 'Admitted' && !bed_id) { notifyWarning('Please select a ward and a free bed to admit the patient.'); return }
 if (outcome === 'Referred' && !refer_department) { notifyWarning('Please select the referring department.'); return }
 const undispensed = visitPrescriptions.filter(rx => !['Released', 'Rejected', 'Cancelled'].includes(rx.status || 'Pending'))
 if (outcome !== 'Admitted' && outcome !== 'Referred' && undispensed.length > 0) {
  notifyWarning(`${undispensed.length} prescription(s) have not been dispensed yet. Dispense them in the Pharmacy screen first (cash patients pay at the cashier before drugs are released), then close the visit.`)
  return
 }

 setSaving(true)
 try {
 const p = showPharmacy.patients || {}
 const coverageName = String(p.insurance || '').trim()
 const hasCoverage = coverageName && coverageName !== 'None'
 const isShaCoverage = /sha|social health authority/i.test(coverageName)
 const selectedWard = wards.find(w => w.id === ward_id)
 const selectedBed = wardBeds.find(b => b.id === bed_id)
 let createdPharmacyInvoice = null
 let releasedPharmacyAmount = 0

 // ── 1. Determine final visit status ──────────────────────────────────
 let finalStatus = 'Completed'
 if (outcome === 'Admitted') finalStatus = 'Admitted'
 if (outcome === 'Referred') finalStatus = 'Doctor' // stays active, re-enters doctor queue

 // ── 2. Update the visit ───────────────────────────────────────────────
const referWard = wards.find(w => w.id === refer_ward)
  const visitUpdate = {
    prescription: pharmaForm.prescription || null,
    outcome: outcome,
    discharge_notes: pharmaForm.discharge_notes || null,
    status: finalStatus,
    ward: selectedWard?.name || null,
    bed_no: selectedBed?.bed_number || null,
  }
  if (finalStatus === 'Completed') visitUpdate.discharged_at = new Date().toISOString()
 if (outcome === 'Referred') {
    visitUpdate.speciality = refer_department
    if (referWard) {
      visitUpdate.ward = referWard.name
      visitUpdate.bed_no = null
    }
 }

 const { error } = await supabase.from('visits').update(visitUpdate)
 .eq('id', showPharmacy.id).eq('hospital_id', hospitalId)
 if (error) { notifyError('Error updating visit: ' + error.message); setSaving(false); return }

 // ── 3. Prescriptions are NOT dispensed here. The Pharmacy screen does it, with pharmacist approval,
 //       allergy / interaction / PPB checks, batch tracking and pay-before-dispense for self-pay patients.

 // ── 4. Admitted → free any previous bed, then assign new one ────────────
 if (outcome === 'Admitted' && bed_id) {
 // Free any bed already linked to this visit or patient (prevents double assignment)
 await supabase.from('beds').update({ status:'Free', patient_id:null, visit_id:null, admitted_at:null })
 .eq('visit_id', showPharmacy.id).eq('hospital_id', hospitalId)
 await supabase.from('beds').update({ status:'Free', patient_id:null, visit_id:null, admitted_at:null })
 .eq('patient_id', showPharmacy.patient_id).eq('hospital_id', hospitalId)
 // Assign new bed — only if it's still Free
 const { error: bedErr } = await supabase.from('beds').update({
 status:'Occupied', patient_id:showPharmacy.patient_id,
 visit_id:showPharmacy.id, admitted_at:new Date().toISOString(),
 }).eq('id', bed_id).eq('hospital_id', hospitalId)
 if (bedErr) { notifyError('Visit saved but bed assignment failed: ' + bedErr.message) }

 // ── Create admission record (with duplicate guard) ───────────────────
 const { data: existingAdm } = await supabase
 .from('admissions')
 .select('id')
 .eq('visit_id', showPharmacy.id)
 .eq('status', 'Active')
 .maybeSingle()

 if (!existingAdm) {
 await supabase.from('admissions').insert({
 hospital_id: hospitalId,
 visit_id: showPharmacy.id,
 patient_id: showPharmacy.patient_id,
 admitting_doctor: showPharmacy.assigned_doctor_name || null,
 diagnosis: showPharmacy.doctor_notes || pharmaForm.discharge_notes || null,
 admission_date: new Date().toISOString(),
 status: 'Active',
 ward: selectedWard?.name || null,
 bed_no: selectedBed?.bed_number || null,
 })
 }
 }

 // ── 4. Insurance → auto-generate claim ───────────────────────────────
 if (hasCoverage && !isShaCoverage && releasedPharmacyAmount > 0) {
 const claimPayload = {
 hospital_id: hospitalId,
 visit_id: showPharmacy.id,
 patient_id: showPharmacy.patient_id,
 patient_name: p.full_name,
 insurer: coverageName,
 insurance_number: p.insurance_number,
 visit_type: showPharmacy.visit_type,
 amount: releasedPharmacyAmount,
 claim_date: new Date().toISOString(),
 status: 'Pending',
 invoice_id: createdPharmacyInvoice?.id || null,
 notes: createdPharmacyInvoice?.invoice_no ? `Imported from Billing invoice ${createdPharmacyInvoice.invoice_no}` : null,
 }
 await executeWithFallback(
  () => supabase.from('insurance_claims').insert(claimPayload),
  async () => supabase.from('insurance_claims').insert(omitKeys(claimPayload, ['invoice_id'])),
 )
 }

 setShowPharmacy(null)
 setWardBeds([])
 setPharmaForm({ prescription:'', outcome:'Outpatient', ward_id:'', bed_id:'', discharge_notes:'', refer_department:'', refer_ward:'' })
 try {
  window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', {
   detail: { visit_id: showPharmacy.id, status: finalStatus, source: 'patients-workflow', outcome },
  }))
 } catch (e) {}
 await fetchData()
} catch(e) { notifyError('Unexpected error: ' + e.message) }
 setSaving(false)
 }

 // ── filters ───────────────────────────────────────────────────────────────
 const statusCounts = {}
 STEPS.forEach(st => { statusCounts[st] = visits.filter(v => v.status === st).length })
 statusCounts['Admitted'] = visits.filter(v => v.status === 'Admitted').length
 statusCounts['All'] = visits.length

 const filteredVisits = visits.filter(v => {
 const haystack = `${buildPatientSearchFields(v.patients || {})} ${String(v.visit_number || '').toLowerCase()} ${String(v.chief_complaint || '').toLowerCase()}`
 const ok = !search || haystack.includes(search.toLowerCase())
 return ok && (filterStatus === 'All' || v.status === filterStatus)
 })

 const registrationVisit = registrationComplete?.visitId
  ? visits.find(visit => String(visit.id) === String(registrationComplete.visitId))
  : null
 const registrationVisitStatus = registrationVisit?.status || registrationComplete?.visitStatus || ''
 const canLaunchConsultationFromRegistration = ['Doctor', 'OPD'].includes(registrationVisitStatus)

 const enrichedPatients = allPatients.map((patient) => ({
  ...patient,
  _meta: patientMetaMap[patient.id] || {
   latestVisit: null,
   lastVisitAt: null,
   outstandingBalance: 0,
   hasOutstandingBalance: false,
   followUpNeeded: Boolean(localFollowUpFlags[patient.id]),
  },
 }))

 const filteredPatients = enrichedPatients.filter((patient) => {
  const latestStatus = patient._meta.latestVisit?.status || 'Completed'
  const hasSearchMatch = !search || buildPatientSearchFields(patient).includes(search.toLowerCase())
  const workflowMatch = registryFilters.workflow === 'All' || latestStatus === registryFilters.workflow
  const genderMatch = registryFilters.gender === 'All' || patient.gender === registryFilters.gender
  const ageMatch = getAgeRangeMatch(patient.age, registryFilters.ageRange)
  const registeredMatch = getRegisteredDateMatch(patient.created_at, registryFilters.registered)
  const shaMatch = registryFilters.shaMember === 'all'
   || (registryFilters.shaMember === 'yes' && Boolean(patient.sha_member_no || patient.insurance === 'SHA' || patient.insurer === 'SHA'))
   || (registryFilters.shaMember === 'no' && !Boolean(patient.sha_member_no || patient.insurance === 'SHA' || patient.insurer === 'SHA'))
  const balanceMatch = registryFilters.outstanding === 'all'
   || (registryFilters.outstanding === 'yes' && patient._meta.hasOutstandingBalance)
   || (registryFilters.outstanding === 'no' && !patient._meta.hasOutstandingBalance)
  return hasSearchMatch && workflowMatch && genderMatch && ageMatch && registeredMatch && shaMatch && balanceMatch
 })

 const detailPatient = showDetail?.patients || null
 const [showNetworkImport, setShowNetworkImport] = useState(false)
 const detailTimeline = showDetail?.timeline || []
 const detailWorkflowEvents = showDetail?.workflowEvents || []
 const detailChronicRecords = showDetail?.chronicRecords || []
 const focusVisit = detailTimeline.find(item => item.id === showDetail?.highlightedVisitId) || detailTimeline[0] || null

 // ── loading ───────────────────────────────────────────────────────────────
 if (loading) return (
 <div style={s.loadWrap}><div style={s.spinner}/><p style={{color:'#0F6E56',marginTop:12}}>Loading...</p></div>
 )

 // ═══════════════════════════════════════════════════════════════════════════
 return (
 <div style={s.page}>
 <style>{`
 @keyframes spin{to{transform:rotate(360deg)}}
 @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
 .hov-card:hover{border-color:#0F6E56!important;box-shadow:0 4px 16px rgba(15,110,86,.12)!important}
 `}</style>

 {/* ── HEADER ─────────────────────────────────────────────────────────── */}
 <div style={s.header}>
 <div>
 <h1 style={s.title}>Patients</h1>
 <p style={s.subtitle}>
 {visits.length} visit{visits.length!==1?'s':''} • {patientTotal} total registered
 </p>
 </div>
 <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
 {/* Date range selector */}
 <select style={s.rangeSelect} aria-label="Date range" value={dateRange} onChange={e=>setDateRange(e.target.value)}>
 <option value="today">Today</option>
 <option value="week">This Week</option>
 <option value="2weeks">2 Weeks</option>
 <option value="month">1 Month</option>
 <option value="2months">2 Months</option>
 <option value="all">All Time</option>
 </select>
 <button style={{...s.tabToggle,...(view==='queue'?s.tabActive:{})}} onClick={()=>setView('queue')}>📋 Queue</button>
 <button style={{...s.tabToggle,...(view==='registry'?s.tabActive:{})}} onClick={()=>setView('registry')}>👥 Registry</button>
 <button
 style={{...s.primaryBtn, ...(canRegister ? {} : s.btnDisabled)}}
 onClick={()=>{setShowSearchModal(true);setSearchQuery('');setSearchResults([]);setSearchDone(false)}}
 disabled={!canRegister}
 title="Only receptionists, nurses and admins can register patients">
 + Register Patient
 </button>
 <button style={{...s.tabToggle}} onClick={()=>setShowNetworkImport(true)} disabled={!canRegister} title="Register a patient already known at one of your organisation's other facilities">🔗 From another facility</button>
 </div>
 </div>
 {showNetworkImport && (
  <NetworkPatientImport
   hospitalId={hospitalId}
   onClose={()=>setShowNetworkImport(false)}
   onImported={async (id, src)=>{
    setShowNetworkImport(false)
    notifySuccess(`${src.full_name} is now registered here (linked to ${src.hospital_name}).`)
    await Promise.all([fetchData(), fetchPatientPage(patientPage), fetchRecentPatients()])
   }}
  />
 )}

 {/* ── PIPELINE ───────────────────────────────────────────────────────── */}
 {view==='queue' && (
 <div style={s.pipeline}>
 {[...STEPS,'Admitted','All'].map(st=>{
 const cnt = st==='All' ? visits.length : (statusCounts[st]||0)
 const sc = STEP_COLORS[st] || {bg:'#f0f0f0',color:'#333'}
 const active = filterStatus===st
 return (
 <div key={st} style={{...s.pipeStep,...(active?s.pipeActive:{})}} onClick={()=>setFilterStatus(active?'All':st)}>
 <div style={{...s.pipeCount,background:sc.bg,color:sc.color}}>{cnt}</div>
 <div style={s.pipeLabel}>{st}</div>
 </div>
 )
 })}
 </div>
 )}

 {/* ── SEARCH BAR ─────────────────────────────────────────────────────── */}
 <div style={s.searchWrap}>
 <span style={s.searchIcon}></span>
 <input style={s.searchInput}
 placeholder={view==='queue'?'Search name, phone, visit number, patient number...':'Search name, phone, national ID, patient number...'}
 value={searchDraft} onChange={e=>setSearchDraft(e.target.value)}/>
 {searchDraft && <span style={s.clearBtn} onClick={()=>setSearchDraft('')}></span>}
 </div>

 {/* ══ QUEUE VIEW ════════════════════════════════════════════════════════ */}
 {view==='queue' && (
 filteredVisits.length===0
 ? <div style={s.empty}><div style={{fontSize:48}}>📋</div><div style={{fontSize:16,fontWeight:600,color:'#555',marginTop:12}}>No visits for this period</div></div>
 : <div style={s.queueList}>
 {filteredVisits.map((visit,i)=>{
 const p = visit.patients || {}
 const sc = STEP_COLORS[visit.status] || STEP_COLORS.Completed
 const stepIdx = STEPS.indexOf(visit.status)
 return (
 <div key={visit.id} className="hov-card" style={s.queueCard}>
 {/* LEFT: avatar + info */}
 <div style={{display:'flex',alignItems:'center',gap:14,flex:1,minWidth:0}}>
 <div style={{...s.avatar,background:AVATAR_COLORS[i%AVATAR_COLORS.length]}}>
 {p.full_name?.charAt(0)?.toUpperCase()}
 </div>
 <div style={{flex:1,minWidth:0}}>
 <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
 <span style={s.patName}>{p.full_name}</span>
 <span style={{...s.pill,background:sc.bg,color:sc.color}}>{visit.status}</span>
 {visit.priority==='Emergency' && <span style={{...s.pill,background:'#FCEBEB',color:'#A32D2D'}}> Emergency</span>}
 {visit.priority==='Urgent' && <span style={{...s.pill,background:'#FFF3DC',color:'#C07000'}}>⚡ Urgent</span>}
 {p.is_minor && <span style={{...s.pill,background:'#E3F0FB',color:'#1a6fb5'}}> Minor</span>}
 {chronicPatientMap[p.id]?.conditions?.length > 0 && <span style={{...s.pill,background:'#EFF8FF',color:'#175CD3'}}> Chronic</span>}
 {p.insurance && p.insurance!=='None' && p.insurance!=='' && <span style={{...s.pill,background:'#EAF3DE',color:'#3B6D11'}}> {p.insurance}</span>}
 </div>
 <div style={{fontSize:12,color:'#888',marginTop:4,display:'flex',gap:12,flexWrap:'wrap'}}>
 <span>📋 {visit.visit_number}</span>
 <span> {visit.visit_type}</span>
 {p.phone && <span>📞 {p.phone}</span>}
 {p.age && <span>👤 {p.age}y {p.gender}</span>}
 {visit.chief_complaint && <span>💬 {visit.chief_complaint}</span>}
 {(visit.ward || visit.bed_no) && (
 <span>🛏 {visit.ward || '—'}{visit.bed_no ? ` / ${visit.bed_no}` : ''}</span>
 )}
 {visit.outcome==='Referred' && visit.assigned_doctor_name && (
 <span>↪ Referred to Dr. {visit.assigned_doctor_name}{visit.speciality ? ` (${visit.speciality})` : ''}</span>
 )}
 </div>
 {visit.assigned_doctor_name && (
 <div style={{fontSize:12,color:'#7B5EA7',marginTop:3}}>
 👨‍⚕ Dr. {visit.assigned_doctor_name}{visit.speciality ? ` — ${visit.speciality}` : ''}
 </div>
 )}
 {visit.doctor_notes && (
 <div style={{fontSize:11,color:'#555',marginTop:2,fontStyle:'italic'}}>📝 {visit.doctor_notes}</div>
 )}
 </div>
 </div>

 {/* CENTRE: journey dots */}
 <div style={s.journeyDots}>
 {STEPS.map((st,j)=>{
 const done = j < stepIdx
 const active = j === stepIdx
 return (
 <div key={st} style={{display:'flex',alignItems:'center'}}>
 <div title={st} style={{
 width:10,height:10,borderRadius:'50%',
 background: done||active ? '#0F6E56' : '#e0e0e0',
 opacity: active ? 1 : done ? 0.6 : 0.3,
 border: active ? '2px solid #0F6E56' : 'none',
 boxSizing:'border-box'
 }}/>
 {j<STEPS.length-1 && <div style={{width:14,height:1,background:done?'#B4E5D0':'#e0e0e0'}}/>}
 </div>
 )
 })}
 </div>

 {/* RIGHT: action buttons */}
 <div style={{display:'flex',gap:6,flexShrink:0,flexWrap:'wrap'}}>
 <button style={s.actionBtn} onClick={()=>openPatientTimeline(visit, visit.id)}>View</button>
 {canViewChronicDisease && (
 <button
 style={{...s.actionBtn,...s.btnPri}}
 onClick={()=>openChronicDiseaseWorkspace(p, visit)}
 title="Open chronic disease tracker for this patient">
 Chronic
 </button>
 )}

 {visit.status==='Vitals' && (
 <button
 style={{...s.actionBtn,...s.btnOrange, ...(canVitals ? {} : s.btnDisabled)}}
 onClick={()=>{setShowVitals(visit);setVitalsForm({weight_kg:'',height_cm:'',bp_systolic:'',bp_diastolic:'',pulse_bpm:'',temperature_c:'',oxygen_sat:'',respiratory_rate:'',blood_sugar:'',recorded_by:''})}}
 disabled={!canVitals}
 title="Only nurses and admins can record vitals">
 Vitals
 </button>
 )}

 {visit.status==='Doctor' && (
 <button
 style={{...s.actionBtn,...s.btnPurple, ...(canDoctor ? {} : s.btnDisabled)}}
 onClick={()=>{setShowDoctor(visit);setDoctorForm({doctor_id:'',doctor_name:visit.assigned_doctor_name||'',speciality:visit.speciality||'',notes:''})}}
 disabled={!canDoctor}
 title="Only doctors and clinical officers can assess patients">
 👨‍⚕ Doctor
 </button>
 )}

 {visit.status==='Lab' && (
 <button
 style={{...s.actionBtn,...s.btnRed, ...(canLab ? {} : s.btnDisabled)}}
 onClick={()=>{setShowLab(visit);setLabSelectedTests([]);setLabCategory('Haematology');setLabPriority('Routine');setLabNotes('');setLabCustomTest('')}}
 disabled={!canLab}
 title="Only doctors can order lab tests">
 Lab
 </button>
 )}

 {visit.status==='Pharmacy' && (
 <button
 style={{...s.actionBtn,...s.btnGreen, ...(canPharmacy ? {} : s.btnDisabled)}}
 onClick={()=>{setShowPharmacy(visit);setPharmaForm({prescription:'',outcome:'Outpatient',ward_id:'',bed_id:'',discharge_notes:'',refer_department:'',refer_ward:''});setWardBeds([]);fetchWards();loadVisitPrescriptions(visit.id)}}
 disabled={!canPharmacy}
 title="Only pharmacists and admins can process pharmacy outcomes">
 Pharmacy
 </button>
 )}

 {visit.status==='Admission Requested' && (
 <button
 style={{...s.actionBtn,...s.btnGreen, ...(canAdmit ? {} : s.btnDisabled)}}
 onClick={()=>{setShowPharmacy(visit);setPharmaForm({prescription:'',outcome:'Admitted',ward_id:'',bed_id:'',discharge_notes:'',refer_department:'',refer_ward:''});setWardBeds([]);fetchWards();loadVisitPrescriptions(visit.id)}}
 disabled={!canAdmit}
 title="Only doctors and nurses can process admissions">
 Assign Bed
 </button>
 )}

 {visit.status==='Admitted' && (
 <button
 style={{...s.actionBtn,...s.btnGreen, ...(canDischarge ? {} : s.btnDisabled)}}
 onClick={()=>{setShowPharmacy(visit);setPharmaForm({prescription:'',outcome:'Outpatient',ward_id:'',bed_id:'',discharge_notes:'',refer_department:'',refer_ward:''});setWardBeds([]);fetchWards();loadVisitPrescriptions(visit.id)}}
 disabled={!canDischarge}
 title="Only doctors, nurses and admins can discharge patients">
 Discharge
 </button>
 )}
 </div>
 </div>
 )
 })}
 </div>
 )}

 {/* ══ REGISTRY VIEW ═════════════════════════════════════════════════════ */}
{view==='registry' && (
 <>
 <div style={s.registryToolbar}>
  <select style={s.rangeSelect} value={registryFilters.workflow} onChange={e => setRegistryFilters(prev => ({ ...prev, workflow: e.target.value }))}>
   <option value="All">All Workflow Steps</option>
   {[...STEPS, 'Admitted'].map(step => <option key={step} value={step}>{step}</option>)}
  </select>
  <select style={s.rangeSelect} value={registryFilters.gender} onChange={e => setRegistryFilters(prev => ({ ...prev, gender: e.target.value }))}>
   <option value="All">All Genders</option>
   {['Female', 'Male', 'Other'].map(option => <option key={option} value={option}>{option}</option>)}
  </select>
  <select style={s.rangeSelect} value={registryFilters.ageRange} onChange={e => setRegistryFilters(prev => ({ ...prev, ageRange: e.target.value }))}>
   <option value="All">All Ages</option>
   {['Child', 'Adult', 'Senior'].map(option => <option key={option} value={option}>{option}</option>)}
  </select>
  <select style={s.rangeSelect} value={registryFilters.registered} onChange={e => setRegistryFilters(prev => ({ ...prev, registered: e.target.value }))}>
   <option value="all">Any Registration Date</option>
   <option value="today">Registered Today</option>
   <option value="week">Registered in 7 Days</option>
   <option value="month">Registered in 30 Days</option>
  </select>
  <select style={s.rangeSelect} value={registryFilters.shaMember} onChange={e => setRegistryFilters(prev => ({ ...prev, shaMember: e.target.value }))}>
   <option value="all">SHA: Any</option>
   <option value="yes">SHA Member</option>
   <option value="no">Not SHA</option>
  </select>
  <select style={s.rangeSelect} value={registryFilters.outstanding} onChange={e => setRegistryFilters(prev => ({ ...prev, outstanding: e.target.value }))}>
   <option value="all">Balance: Any</option>
   <option value="yes">Has Outstanding Balance</option>
   <option value="no">No Outstanding Balance</option>
  </select>
 </div>
 {selectedPatientIds.length > 0 && (
  <div style={s.bulkBar}>
   <div style={{fontSize:13,fontWeight:700,color:'#111'}}>{selectedPatientIds.length} patient(s) selected</div>
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
    <button style={{...s.actionBtn,...s.btnGreen}} onClick={() => handleBulkWhatsAppReminder(filteredPatients)}>WhatsApp Reminder</button>
    <button style={{...s.actionBtn,...s.btnOrange}} onClick={() => handleBulkFollowUp(filteredPatients)}>Mark Follow-up Needed</button>
  </div>
 </div>
 )}
 {isAdmin && duplicateGroups.length > 0 && (
  <div style={s.duplicatePanel}>
   <div style={{fontSize:13,fontWeight:800,color:'#A32D2D'}}>Duplicate patient candidates detected</div>
   <div style={{fontSize:12,color:'#555',marginTop:4}}>Same name plus similar phone. Review carefully before merging.</div>
   <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:12}}>
    {duplicateGroups.slice(0, 5).map((group, index) => (
     <div key={index} style={s.duplicateRow}>
      <div style={{fontSize:12,color:'#333',flex:1}}>
       {group.map(item => `${item.full_name} (${item.phone || 'No phone'})`).join(' | ')}
      </div>
      {group[1] && <button style={{...s.actionBtn,...s.btnRed}} onClick={() => handleMergePatients(group[0], group[1])}>Merge Duplicate</button>}
     </div>
    ))}
   </div>
  </div>
 )}
 {filteredPatients.length===0
 ? <div style={s.empty}><div style={{fontSize:48}}>👥</div><div style={{fontSize:16,fontWeight:600,color:'#555',marginTop:12}}>No patients registered</div></div>
 : (
  <>
   <div style={s.tableWrap}>
    <table style={s.table}>
     <thead>
      <tr style={{background:'#f8f9fa'}}>
       <th style={s.th}><input type="checkbox" checked={filteredPatients.length > 0 && selectedPatientIds.length === filteredPatients.length} onChange={e => toggleSelectAllVisible(e.target.checked, filteredPatients)} /></th>
       {['Patient','Workflow','Age / Gender','Phone / ID','Blood / Cover','Outstanding','Registered','Action'].map(h => (
        <th key={h} style={s.th}>{h}</th>
       ))}
      </tr>
     </thead>
     <tbody>
      {filteredPatients.map((p) => {
       const meta = p._meta || {}
       const workflowStatus = meta.latestVisit?.status || 'Completed'
       const workflowColors = STEP_COLORS[workflowStatus] || STEP_COLORS.Completed
       const avatarStyle = getAvatarStyle(p.full_name)
       const allergyTags = parseAllergyTags(p.allergies)
       const duplicateGroup = duplicateGroups.find(group => group.some(item => item.id === p.id))
       return (
        <tr key={p.id} style={{borderBottom:'1px solid #f5f5f5',background:selectedPatientIds.includes(p.id)?'#F8FBF9':'#fff'}}>
         <td style={s.td}><input type="checkbox" checked={selectedPatientIds.includes(p.id)} onChange={() => togglePatientSelection(p.id)} /></td>
         <td style={s.td}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
           <div style={{...s.avatar,...avatarStyle}}>{getInitials(p.full_name)}</div>
           <div>
            <button type="button" style={s.linkButton} onClick={() => openPatientTimeline(p)}>
             {p.full_name}
            </button>
            <div style={{fontSize:11,color:'#667085',marginTop:3}}>
             {p.patient_number || getPatientCardNumber(p)}
            </div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
             {p.is_minor && <span style={{...s.pill,background:'#E3F0FB',color:'#1a6fb5'}}>Minor</span>}
             {allergyTags.length > 0 && <span style={{...s.pill,background:'#FCEBEB',color:'#A32D2D'}}>Allergy</span>}
             {chronicPatientMap[p.id]?.conditions?.length > 0 && <span style={{...s.pill,background:'#EFF8FF',color:'#175CD3'}}>Chronic</span>}
             {meta.followUpNeeded && <span style={{...s.pill,background:'#FFF3DC',color:'#C07000'}}>Follow-up</span>}
             {duplicateGroup?.length > 1 && isAdmin && <span style={{...s.pill,background:'#FDECEC',color:'#B42318'}}>Possible Duplicate</span>}
            </div>
           </div>
          </div>
         </td>
         <td style={s.td}>
          <div style={{fontWeight:600,color:'#111'}}>{workflowStatus}</div>
          <span style={{...s.pill,background:workflowColors.bg,color:workflowColors.color,display:'inline-block',marginTop:6}}>
           {workflowStatus}
          </span>
          <div style={{fontSize:11,color:'#667085',marginTop:8}}>
           {p.age || '—'} yrs • {p.gender || '—'}
          </div>
         </td>
         <td style={s.td}>
          <div>{p.phone || '—'}</div>
          <div style={{fontSize:11,color:'#667085',marginTop:4}}>
           {p.national_id || p.huduma_number || p.guardian_id || 'No ID recorded'}
          </div>
         </td>
         <td style={s.td}>
          <div>{p.blood_group || 'Unknown'}</div>
          <div style={{fontSize:11,color:'#667085',marginTop:4}}>
           {p.insurer_name || p.insurer || p.insurance || (p.sha_member_no ? 'SHA Member' : 'Self Pay')}
          </div>
         </td>
         <td style={s.td}>
          <div style={{fontWeight:700,color:meta.hasOutstandingBalance ? '#B42318' : '#0F6E56'}}>
           {formatCurrency(meta.outstandingBalance || 0)}
          </div>
          <div style={{fontSize:11,color:'#667085',marginTop:4}}>
           {meta.hasOutstandingBalance ? 'Outstanding balance' : 'Fully settled'}
          </div>
         </td>
         <td style={s.td}>
          <div>{p.created_at ? new Date(p.created_at).toLocaleDateString('en-KE') : '—'}</div>
          <div style={{fontSize:11,color:'#667085',marginTop:4}}>
           {meta.lastVisitAt ? `Last visit ${getRelativeDaysLabel(meta.lastVisitAt)}` : 'No prior visits'}
          </div>
         </td>
         <td style={s.td}>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
           <button
            style={{...s.actionBtn, ...(canRegister ? {} : s.btnDisabled)}}
            onClick={()=>selectReturningPatient(p)}
            disabled={!canRegister}
            title="Only receptionists, nurses and admins can register patients">
            New Visit
           </button>
           <button style={s.actionBtn} onClick={()=>openPatientTimeline(p)}>Timeline</button>
           {canViewChronicDisease && (
            <button
             style={{...s.actionBtn,...s.btnPri}}
             onClick={()=>openChronicDiseaseWorkspace(p)}
             title="Open chronic disease tracker for this patient">
             Chronic
            </button>
           )}
           <button
            style={{...s.actionBtn, ...(canRegister ? {} : s.btnDisabled)}}
            onClick={()=>openEditPatient(p)}
            disabled={!canRegister}
            title="Only receptionists, nurses and admins can edit patient records">
            Edit
           </button>
           <button
            style={{...s.actionBtn, ...(canPrint ? {} : s.btnDisabled)}}
            onClick={()=>printPatientIdCard(hospitalName, p)}
            disabled={!canPrint}
            title={!canPrint ? 'Printing is limited to billing-authorized users and admins.' : ''}>
            Print ID Card
           </button>
           {isAdmin && duplicateGroup?.length > 1 && duplicateGroup[0].id !== p.id && <button style={{...s.actionBtn,...s.btnRed}} onClick={() => handleMergePatients(duplicateGroup[0], p)}>Merge</button>}
          </div>
         </td>
        </tr>
       )
      })}
     </tbody>
    </table>
   </div>
   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
    <div style={{ fontSize: 12, color: '#555' }}>
     {patientLoading ? 'Loading patient registry...' : `Showing ${filteredPatients.length} of ${patientTotal || 0} registered patients`}
    </div>
    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
     <button
      style={{ ...s.actionBtn, ...(patientPage <= 1 ? s.btnGhost : s.btnPri), padding: '8px 12px' }}
      disabled={patientPage <= 1 || patientLoading}
      onClick={() => setPatientPage(prev => Math.max(prev - 1, 1))}
     >
      Previous
     </button>
     <button
      style={{ ...s.actionBtn, ...(patientPage >= Math.ceil((patientTotal || 0) / PAGE_SIZE) ? s.btnGhost : s.btnPri), padding: '8px 12px' }}
      disabled={patientPage >= Math.ceil((patientTotal || 0) / PAGE_SIZE) || patientLoading}
      onClick={() => setPatientPage(prev => prev + 1)}
     >
      Next
     </button>
    </div>
   </div>
  </>
 )}
 </>
)}

 {/* ════════════════════════════════════════════════════════════════════ */}
 {/* MODAL: SEARCH-FIRST */}
 {/* ════════════════════════════════════════════════════════════════════ */}
 {showSearchModal && (
 <div style={s.overlay} onClick={()=>setShowSearchModal(false)}>
 <div style={{...s.modal,maxWidth:540}} onClick={e=>e.stopPropagation()}>
 <div style={s.modalHeader}>
 <div>
 <h2 style={s.modalTitle}>Patient Check-In</h2>
 <p style={{fontSize:13,color:'#888',margin:'4px 0 0'}}>Search first to avoid duplicate registration</p>
 </div>
 <button style={s.closeBtn} onClick={()=>setShowSearchModal(false)} aria-label="Close" title="Close">✕</button>
 </div>
 <div style={s.modalBody}>
 <div style={{display:'flex',gap:10,marginBottom:16}}>
 <input style={{...s.input,flex:1}} placeholder="Name, phone, national ID, patient number, or guardian ID..."
 value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
 autoFocus/>
 </div>
 <div style={{background:'#E3F0FB',border:'1px solid #B3D4F0',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#1a6fb5',marginBottom:16}}>
 <strong>Minors</strong> — search by parent/guardian National ID or child's birth cert number
 </div>

 {!searchQuery.trim() && recentPatients.length > 0 && (
 <div style={{marginBottom:16}}>
 <div style={s.sectionLabel}>Recent Patients</div>
 <div style={{display:'flex',flexDirection:'column',gap:10}}>
 {recentPatients.map(p => (
 <div
 key={p.id}
 style={{...s.resultCard, opacity:canRegister ? 1 : 0.65, cursor:canRegister ? 'pointer' : 'not-allowed'}}
 className="hov-card"
 onClick={()=>{ if (canRegister) selectReturningPatient(p) }}>
 <div style={{display:'flex',alignItems:'center',gap:12,flex:1}}>
 <div style={{...s.avatar,...getAvatarStyle(p.full_name),width:44,height:44,fontSize:16}}>{getInitials(p.full_name)}</div>
 <div>
 <div style={{fontWeight:700,fontSize:15,color:'#111'}}>{p.full_name}</div>
 <div style={{fontSize:12,color:'#666',marginTop:3,display:'flex',gap:12,flexWrap:'wrap'}}>
 {p.patient_number && <span>{p.patient_number}</span>}
 {p.phone && <span>{p.phone}</span>}
 <span>{getRelativeDaysLabel(p.last_visit_at)}</span>
 </div>
 </div>
 </div>
 <div style={{fontSize:12,color:'#0F6E56',fontWeight:600}}>Check In</div>
 </div>
 ))}
 </div>
 </div>
 )}

 {searchDone && searchQuery.trim() && searchResults.length===0 && (
 <div style={{textAlign:'center',padding:24,background:'#f9fafb',borderRadius:10,marginBottom:16}}>
 <div style={{fontSize:32,marginBottom:8}}></div>
 <div style={{fontWeight:600,color:'#333',marginBottom:4}}>No patient found</div>
 <div style={{fontSize:13,color:'#888',marginBottom:16}}>This appears to be a new patient</div>
 <button
 style={{...s.primaryBtn, ...(canRegister ? {} : s.btnDisabled)}}
 onClick={openNewPatient}
 disabled={!canRegister}
 title="Only receptionists, nurses and admins can register patients">
 + Register as New Patient
 </button>
 </div>
 )}

 {searchResults.length>0 && (
 <>
 <div style={s.sectionLabel}>{searchResults.length} patient(s) found — select to check in</div>
 <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
 {searchResults.map(p=>(
 <div
 key={p.id}
 style={{...s.resultCard, opacity:canRegister ? 1 : 0.65, cursor:canRegister ? 'pointer' : 'not-allowed'}}
 className="hov-card"
 onClick={()=>{ if (canRegister) selectReturningPatient(p) }}
 title="Only receptionists, nurses and admins can register patients">
 <div style={{display:'flex',alignItems:'center',gap:12,flex:1}}>
 <div style={{...s.avatar,...getAvatarStyle(p.full_name),width:44,height:44,fontSize:16}}>{getInitials(p.full_name)}</div>
 <div>
 <div style={{fontWeight:700,fontSize:15,color:'#111'}}>{p.full_name}</div>
 <div style={{fontSize:12,color:'#666',marginTop:3,display:'flex',gap:12,flexWrap:'wrap'}}>
 {p.patient_number && <span>{p.patient_number}</span>}
 {p.age && <span>👤 {p.age}y {p.gender}</span>}
 {p.phone && <span>📞 {p.phone}</span>}
 {(p.national_id || p.huduma_number) && <span>🪪 {p.national_id || p.huduma_number}</span>}
 {p.is_minor && <span style={{color:'#1a6fb5',fontWeight:600}}> Minor</span>}
 {p.blood_group && <span>{p.blood_group}</span>}
 </div>
 {p.allergies && <div style={{fontSize:11,color:'#A32D2D',marginTop:3}}> {p.allergies}</div>}
 {p.chronic_conditions && <div style={{fontSize:11,color:'#C07000',marginTop:2}}> {p.chronic_conditions}</div>}
 {(p.insurer_name || p.insurer || p.insurance) && (p.insurer_name || p.insurer || p.insurance)!=='None' && <div style={{fontSize:11,color:'#0F6E56',marginTop:2}}> {p.insurer_name || p.insurer || p.insurance} {(p.insurance_member_number || p.insurance_number)&&`• ${p.insurance_member_number || p.insurance_number}`}</div>}
 </div>
 </div>
 <div style={{fontSize:12,color:'#0F6E56',fontWeight:600}}>Check In →</div>
 </div>
 ))}
 </div>
 <div style={{borderTop:'1px solid #f0f0f0',paddingTop:14,textAlign:'center'}}>
 <span style={{fontSize:13,color:'#888'}}>Not the right patient? </span>
 <span style={{fontSize:13,color:'#0F6E56',fontWeight:600,cursor:'pointer'}} onClick={openNewPatient}>Register as New Patient →</span>
 </div>
 </>
 )}

 {!searchDone && !searchQuery.trim() && recentPatients.length === 0 && (
 <div style={{textAlign:'center',padding:20,color:'#ccc',fontSize:13}}>Type to search patients instantly by name, phone, national ID, or patient number</div>
 )}
 </div>
 </div>
 </div>
 )}

 {/* ════════════════════════════════════════════════════════════════════ */}
 {/* MODAL: REGISTER */}
 {/* ════════════════════════════════════════════════════════════════════ */}
{showRegister && (
 <div style={s.overlay} onClick={()=>setShowRegister(false)}>
 <div style={s.modal} onClick={e=>e.stopPropagation()}>
 <div style={s.modalHeader}>
 <div>
 <h2 style={s.modalTitle}>{editingPatient ? 'Edit Patient' : isReturning ? '🔄 Returning Patient' : ' New Patient Registration'}</h2>
 {!isReturning && !editingPatient && (
 <div style={{display:'flex',gap:6,marginTop:8}}>
 {['Demographics','Visit & Payment'].map((lbl,i)=>(
 <div key={i} style={{display:'flex',alignItems:'center',gap:6}}>
 <div style={{width:22,height:22,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,background:regStep>i+1?'#0F6E56':regStep===i+1?'#0F6E56':'#e0e0e0',color:regStep>=i+1?'#fff':'#888'}}>
 {regStep>i+1?'':i+1}
 </div>
 <span style={{fontSize:12,color:regStep===i+1?'#0F6E56':'#999',fontWeight:regStep===i+1?600:400}}>{lbl}</span>
 {i===0 && <span style={{color:'#ccc'}}>→</span>}
 </div>
 ))}
 </div>
 )}
 </div>
 <button style={s.closeBtn} onClick={()=>setShowRegister(false)} aria-label="Close" title="Close">✕</button>
 </div>

 <div style={s.modalBody}>
 {/* ─ STEP 1: Demographics ─ */}
 {regStep===1 && !isReturning && (
  <>
   <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16,background:'#E3F0FB',padding:12,borderRadius:8}}>
    <input type="checkbox" id="is_minor" checked={regForm.is_minor}
    onChange={e=>setRegForm({...regForm,is_minor:e.target.checked})}
    style={{width:16,height:16,accentColor:'#1a6fb5'}}/>
    <label htmlFor="is_minor" style={{fontSize:14,cursor:'pointer',color:'#1a6fb5',fontWeight:600}}> This is a minor (under 18)</label>
   </div>

   <div style={s.sectionLabel}>Personal Information</div>
   <div style={s.grid2}>
    <Fld label="Patient Number">
     <input style={{...s.input,background:'#F8FAFC',color:'#475467'}} value={regForm.patient_number || ''} readOnly />
    </Fld>
    <Fld label="Full Name *"><input style={s.input} placeholder="e.g. Jane Wanjiku" value={regForm.full_name} onChange={e=>setRegForm({...regForm,full_name:e.target.value})}/></Fld>
    <Fld label={regForm.is_minor?'Birth Certificate No.':'National ID / Passport'}>
     <input style={s.input} placeholder={regForm.is_minor?'e.g. BC-2020-001234':'e.g. 12345678'} value={regForm.national_id} onChange={e=>setRegForm({...regForm,national_id:e.target.value})}/>
    </Fld>
    <Fld label="Huduma Number">
     <input style={s.input} placeholder="e.g. HUD-00123456" value={regForm.huduma_number || ''} onChange={e=>setRegForm({...regForm,huduma_number:e.target.value})}/>
    </Fld>
    <Fld label="Date of Birth">
     <input style={s.input} type="date" value={regForm.dob} onChange={e=>{
      const age=Math.floor((new Date()-new Date(e.target.value))/(365.25*24*3600*1000))
      setRegForm({...regForm,dob:e.target.value,age:age>0?age:''})
     }}/>
    </Fld>
    <Fld label="Age (years)"><input style={s.input} type="number" placeholder="e.g. 28" value={regForm.age} onChange={e=>setRegForm({...regForm,age:e.target.value})}/></Fld>
    <Fld label="Gender *">
     <select style={s.input} value={regForm.gender} onChange={e=>setRegForm({...regForm,gender:e.target.value})}>
      <option>Female</option><option>Male</option><option>Other</option>
     </select>
    </Fld>
    <Fld label="Phone Number"><input style={s.input} placeholder="e.g. 0712345678" value={regForm.phone} onChange={e=>setRegForm({...regForm,phone:e.target.value})}/></Fld>
    <Fld label="Phone 2 (optional)"><input style={s.input} placeholder="e.g. 0700000000" value={regForm.phone2} onChange={e=>setRegForm({...regForm,phone2:e.target.value})}/></Fld>
   </div>
   <Fld label="Address"><input style={s.input} placeholder="e.g. Nairobi, Westlands" value={regForm.address} onChange={e=>setRegForm({...regForm,address:e.target.value})}/></Fld>

   {regForm.is_minor && (
    <>
     <div style={s.sectionLabel}>Parent / Guardian</div>
     <div style={s.grid2}>
      <Fld label="Guardian Full Name *"><input style={s.input} value={regForm.guardian_name} onChange={e=>setRegForm({...regForm,guardian_name:e.target.value})}/></Fld>
      <Fld label="Guardian National ID *"><input style={s.input} value={regForm.guardian_id} onChange={e=>setRegForm({...regForm,guardian_id:e.target.value})}/></Fld>
      <Fld label="Relationship">
       <select style={s.input} value={regForm.guardian_relationship} onChange={e=>setRegForm({...regForm,guardian_relationship:e.target.value})}>
        <option value="">-- Select --</option>
        {['Mother','Father','Guardian','Grandparent','Sibling','Other'].map(r=><option key={r}>{r}</option>)}
       </select>
      </Fld>
     </div>
    </>
   )}

   <div style={s.sectionLabel}>Emergency Contact & Medical</div>
   <div style={s.grid2}>
    <Fld label="Blood Group">
     <select style={s.input} value={regForm.blood_group} onChange={e=>setRegForm({...regForm,blood_group:e.target.value})}>
      {BLOOD_GROUP_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
     </select>
    </Fld>
    <Fld label="Known Allergies">
     <div style={s.tagInputWrap}>
      <input
       style={{...s.input,border:'none',padding:'2px 0',flex:1,minWidth:120}}
       placeholder="Type allergy and press Enter"
       value={allergyInput}
       onChange={e=>setAllergyInput(e.target.value)}
       onKeyDown={e=>{
        if (e.key === 'Enter' || e.key === ',') {
         e.preventDefault()
         addAllergyTag(allergyInput)
        }
       }}
      />
      <button type="button" style={s.smallActionBtn} onClick={() => addAllergyTag(allergyInput)}>Add</button>
     </div>
     {(regForm.allergy_tags || []).length > 0 && (
      <div style={s.tagWrap}>
       {(regForm.allergy_tags || []).map(tag => (
        <span key={tag} style={s.tagPill}>
         {tag}
         <button type="button" style={s.tagRemoveBtn} onClick={() => removeAllergyTag(tag)}>×</button>
        </span>
       ))}
      </div>
     )}
    </Fld>
    <Fld label="Chronic Conditions"><input style={s.input} placeholder="e.g. Diabetes, Hypertension" value={regForm.chronic_conditions} onChange={e=>setRegForm({...regForm,chronic_conditions:e.target.value})}/></Fld>
    <Fld label="Next of Kin Name"><input style={s.input} value={regForm.next_of_kin_name || regForm.next_of_kin} onChange={e=>setRegForm({...regForm,next_of_kin:e.target.value,next_of_kin_name:e.target.value})}/></Fld>
    <Fld label="Next of Kin Phone"><input style={s.input} type="tel" value={regForm.next_of_kin_phone} onChange={e=>setRegForm({...regForm,next_of_kin_phone:e.target.value})}/></Fld>
    <Fld label="Next of Kin Relationship">
     <select style={s.input} value={regForm.next_of_kin_relationship} onChange={e=>setRegForm({...regForm,next_of_kin_relationship:e.target.value})}>
      <option value="">-- Select --</option>
      {['Spouse','Parent','Child','Sibling','Guardian','Friend','Other'].map(r=><option key={r}>{r}</option>)}
     </select>
    </Fld>
   </div>

   <div style={s.sectionLabel}>Cover & Membership (Optional)</div>
   <div style={s.grid2}>
    <Fld label="SHA Member Number">
     <input style={s.input} placeholder="e.g. SHA-1234567" value={regForm.sha_member_no || ''} onChange={e=>setRegForm({...regForm,sha_member_no:e.target.value})}/>
    </Fld>
    <Fld label="Insurer Name">
     <select style={s.input} value={regForm.insurer_name || regForm.insurance || ''} onChange={e=>setRegForm({...regForm,insurer_name:e.target.value,insurance:e.target.value})}>
      <option value="">None</option>
      {['SHA','NHIF','AAR','Jubilee Insurance','CIC Insurance','Resolution Insurance','Britam','Madison Insurance','Other'].map(ins=><option key={ins}>{ins}</option>)}
     </select>
    </Fld>
    <Fld label="Insurance Member Number">
     <input style={s.input} placeholder="e.g. INS-1234567" value={regForm.insurance_member_number || regForm.insurance_number || ''} onChange={e=>setRegForm({...regForm,insurance_member_number:e.target.value,insurance_number:e.target.value})}/>
    </Fld>
   </div>
   </>
 )}

 {/* ─ STEP 2: Visit & Payment ─ */}
 {(regStep===2 || isReturning) && (
 <>
 {/* Patient summary */}
 <div style={{...s.summaryCard,background:isReturning?'#E1F5EE':'#f9fafb',border:isReturning?'1px solid #B4E5D0':'1px solid #eee',marginBottom:16}}>
 <div style={{display:'flex',alignItems:'center',gap:12}}>
 <div style={{...s.avatar,...getAvatarStyle(selectedPatient?.full_name||regForm.full_name),width:44,height:44,fontSize:18}}>
 {(selectedPatient?.full_name||regForm.full_name)?.split(' ').map(part => part[0]).join('').slice(0,2).toUpperCase()}
 </div>
 <div>
 <div style={{fontWeight:700,fontSize:15}}>{selectedPatient?.full_name||regForm.full_name}</div>
 <div style={{fontSize:13,color:'#666',marginTop:3}}>
 {(selectedPatient?.age||regForm.age)&&`${selectedPatient?.age||regForm.age}y`}
 {(selectedPatient?.gender||regForm.gender)&&` • ${selectedPatient?.gender||regForm.gender}`}
 {(selectedPatient?.phone||regForm.phone)&&` • ${selectedPatient?.phone||regForm.phone}`}
 </div>
 <div style={{fontSize:11,color:'#667085',marginTop:4}}>{selectedPatient?.patient_number || regForm.patient_number || 'Pending patient number'}</div>
 {(selectedPatient?.allergies||regForm.allergies) && <div style={{fontSize:11,color:'#A32D2D',marginTop:3}}> {selectedPatient?.allergies||regForm.allergies}</div>}
 {(selectedPatient?.sha_member_no||regForm.sha_member_no) && <div style={{fontSize:11,color:'#0F6E56',marginTop:2}}>SHA: {selectedPatient?.sha_member_no||regForm.sha_member_no}</div>}
 {(selectedPatient?.insurer_name||selectedPatient?.insurer||selectedPatient?.insurance||regForm.insurer_name||regForm.insurance) && ((selectedPatient?.insurer_name||selectedPatient?.insurer||selectedPatient?.insurance||regForm.insurer_name||regForm.insurance)!=='None') && <div style={{fontSize:11,color:'#0F6E56',marginTop:2}}> {selectedPatient?.insurer_name||selectedPatient?.insurer||selectedPatient?.insurance||regForm.insurer_name||regForm.insurance}</div>}
 {isReturning && <span style={{...s.pill,background:'#E1F5EE',color:'#0F6E56',fontSize:10,marginTop:4,display:'inline-block'}}>🔄 Returning Patient</span>}
 </div>
 </div>
 </div>

 <div style={s.sectionLabel}>Visit Details</div>
 <div style={s.grid2}>
 <Fld label="Visit Type">
 <select style={s.input} value={visitForm.visit_type} onChange={e=>setVisitForm({...visitForm,visit_type:e.target.value})}>
 <option>OPD</option><option>Emergency</option><option>Follow-up</option><option>Inpatient</option>
 </select>
 </Fld>
 <Fld label="Priority">
 <select style={s.input} value={visitForm.priority} onChange={e=>setVisitForm({...visitForm,priority:e.target.value})}>
 <option>Normal</option><option>Urgent</option><option>Emergency</option>
 </select>
 </Fld>
 </div>
 <Fld label="Chief Complaint">
 <input style={s.input} placeholder="e.g. Fever and headache for 3 days"
 value={visitForm.chief_complaint} onChange={e=>setVisitForm({...visitForm,chief_complaint:e.target.value})}/>
 </Fld>

 {visitForm.priority==='Emergency' && (
 <div style={{background:'#FCEBEB',border:'1px solid #f5c6cb',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#A32D2D',marginBottom:12}}>
 <strong>Emergency</strong> — This patient will skip Vitals and go directly to Doctor
 </div>
 )}

 <div style={s.sectionLabel}>Consultation Fee</div>
 <div style={s.grid2}>
 <Fld label="Amount (KES) *">
 <input style={{...s.input,fontSize:18,fontWeight:700,color:'#0F6E56'}} type="number"
 value={visitForm.admission_fee} onChange={e=>setVisitForm({...visitForm,admission_fee:e.target.value})}/>
 </Fld>
 <Fld label="Payment Method *">
 <select style={s.input} value={visitForm.payment_method} onChange={e=>setVisitForm({...visitForm,payment_method:e.target.value})}>
 <option>Cash</option><option>M-Pesa</option><option>Insurance</option><option>SHA (Social Health Authority)</option>
 </select>
 </Fld>
 </div>
 {visitForm.payment_method==='M-Pesa' && (
 <Fld label="M-Pesa Reference *">
 <input style={{...s.input,letterSpacing:1,textTransform:'uppercase'}} placeholder="e.g. QHJ2KL8MNP"
 value={visitForm.mpesa_ref} onChange={e=>setVisitForm({...visitForm,mpesa_ref:e.target.value.toUpperCase()})}/>
 </Fld>
 )}

 <div style={s.summaryCard}>
 <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}><span style={{color:'#555'}}>Visit Type</span><span style={{fontWeight:600}}>{visitForm.visit_type}</span></div>
 <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}><span style={{color:'#555'}}>Payment</span><span style={{fontWeight:600}}>{visitForm.payment_method}</span></div>
 <div style={{borderTop:'1px solid #e0e0e0',paddingTop:10,display:'flex',justifyContent:'space-between'}}>
 <span style={{fontWeight:700}}>Total Collected</span>
 <span style={{fontWeight:800,fontSize:18,color:'#0F6E56'}}>KES {parseFloat(visitForm.admission_fee||0).toLocaleString()}</span>
 </div>
 </div>
 </>
 )}
 </div>

 <div style={s.modalFooter}>
 {(isReturning||regStep===2)
 ? <>
 <button style={s.cancelBtn} onClick={()=>isReturning?setShowRegister(false):setRegStep(1)}>
 {isReturning?'Cancel':'← Back'}
 </button>
 <button style={s.primaryBtn} onClick={handleRegister} disabled={saving}>
 {saving?'Saving...':'Confirm & Print Receipt'}
 </button>
 </>
 : <>
 <button style={s.cancelBtn} onClick={()=>setShowRegister(false)}>Cancel</button>
 {editingPatient ? (
 <button style={s.primaryBtn} onClick={handleSavePatientProfile} disabled={saving}>
 {saving?'Saving...':'Save Patient'}
 </button>
 ) : (
 <button style={s.primaryBtn} onClick={()=>{if(!regForm.full_name){notifyWarning('Full name required');return}setRegStep(2)}}>
 Next: Visit & Payment →
 </button>
 )}
 </>
 }
 </div>
 </div>
 </div>
 )}

 {registrationComplete && (
  <div style={s.overlay} onClick={() => setRegistrationComplete(null)}>
   <div style={{...s.modal,maxWidth:520}} onClick={e=>e.stopPropagation()}>
    <div style={s.modalHeader}>
     <div>
      <h2 style={s.modalTitle}>Registration Complete</h2>
      <p style={{fontSize:13,color:'#667085',margin:'4px 0 0'}}>
       {registrationComplete.patientName} has been checked in successfully.
      </p>
     </div>
     <button style={s.closeBtn} onClick={() => setRegistrationComplete(null)} aria-label="Close" title="Close">✕</button>
    </div>
    <div style={s.modalBody}>
     <div style={s.summaryCard}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
       <div>
        <div style={s.viewLabel}>Patient</div>
        <div style={s.viewVal}>{registrationComplete.patientName}</div>
       </div>
       <div>
        <div style={s.viewLabel}>Visit Number</div>
        <div style={s.viewVal}>{registrationComplete.visitNumber || 'Pending'}</div>
       </div>
      </div>
     </div>
    </div>
    <div style={s.modalFooter}>
     <button style={s.cancelBtn} onClick={() => setRegistrationComplete(null)}>Done</button>
     <button
      style={s.primaryBtn}
      onClick={() => {
       if (canLaunchConsultationFromRegistration) {
        navigate?.('consultation', {
         patientId: registrationComplete.patientId,
         visitId: registrationComplete.visitId,
         source: 'patient-registration',
        })
       } else if (registrationVisit && canVitals) {
        setShowVitals(registrationVisit)
        setVitalsForm({ weight_kg:'', height_cm:'', bp_systolic:'', bp_diastolic:'', pulse_bpm:'', temperature_c:'', oxygen_sat:'', respiratory_rate:'', blood_sugar:'', recorded_by:'' })
       } else {
        notifyWarning(`This patient is still in ${registrationVisitStatus || 'workflow'}. Complete vitals before opening consultation.`)
       }
       setRegistrationComplete(null)
      }}
     >
      {canLaunchConsultationFromRegistration ? 'Start Consultation Now' : (canVitals ? 'Record Vitals First' : 'Back to Queue')}
     </button>
    </div>
   </div>
  </div>
 )}

 {/* ════════════════════════════════════════════════════════════════════ */}
 {/* MODAL: VITALS */}
 {/* ════════════════════════════════════════════════════════════════════ */}
 {showVitals && (
 <div style={s.overlay} onClick={()=>setShowVitals(null)}>
 <div style={{...s.modal,maxWidth:580}} onClick={e=>e.stopPropagation()}>
 <div style={s.modalHeader}>
 <div>
 <h2 style={s.modalTitle}> Record Vitals</h2>
 <p style={{margin:'4px 0 0',fontSize:13,color:'#888'}}>{showVitals.patients?.full_name} — {showVitals.visit_number}</p>
 </div>
 <button style={s.closeBtn} onClick={()=>setShowVitals(null)} aria-label="Close" title="Close">✕</button>
 </div>
 <div style={s.modalBody}>
 {/* Patient alert bar */}
 {(showVitals.patients?.allergies || showVitals.patients?.chronic_conditions) && (
 <div style={{background:'#FCEBEB',border:'1px solid #f5c6cb',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12}}>
 {showVitals.patients?.allergies && <div style={{color:'#A32D2D'}}> <strong>Allergies:</strong> {showVitals.patients.allergies}</div>}
 {showVitals.patients?.chronic_conditions && <div style={{color:'#C07000',marginTop:4}}> <strong>Chronic:</strong> {showVitals.patients.chronic_conditions}</div>}
 </div>
 )}
 <div style={s.grid2}>
 {[
 ['Weight (kg) *','weight_kg','e.g. 68'],
 ['Height (cm)','height_cm','e.g. 165'],
 ['BP Systolic (mmHg) *','bp_systolic','e.g. 120'],
 ['BP Diastolic (mmHg)','bp_diastolic','e.g. 80'],
 ['Pulse (bpm)','pulse_bpm','e.g. 72'],
 ['Temperature (°C)','temperature_c','e.g. 36.6'],
 ['Oxygen Sat (%)','oxygen_sat','e.g. 98'],
 ['Respiratory Rate','respiratory_rate','e.g. 16'],
 ['Blood Sugar (mmol/L)','blood_sugar','e.g. 5.4'],
 ].map(([label,field,ph])=>(
 <Fld key={field} label={label}>
 <input style={s.input} type="number" step="0.1" placeholder={ph}
 value={vitalsForm[field]} onChange={e=>setVitalsForm({...vitalsForm,[field]:e.target.value})}/>
 </Fld>
 ))}
 </div>
 {vitalsForm.weight_kg && vitalsForm.height_cm && (()=>{
 const bmi = parseFloat(vitalsForm.weight_kg)/Math.pow(parseFloat(vitalsForm.height_cm)/100,2)
 const cat = bmi<18.5?'Underweight':bmi<25?'Normal':bmi<30?'Overweight':'Obese'
 const col = bmi<18.5||bmi>=30?'#A32D2D':bmi<25?'#0F6E56':'#C07000'
 return <div style={{background:'#E1F5EE',padding:'10px 14px',borderRadius:8,fontSize:13,color:col,marginBottom:12}}>
 BMI: <strong>{bmi.toFixed(1)}</strong> — {cat}
 </div>
 })()}
 <Fld label="Recorded By">
 <input style={s.input} placeholder="Nurse name"
 value={vitalsForm.recorded_by} onChange={e=>setVitalsForm({...vitalsForm,recorded_by:e.target.value})}/>
 </Fld>
 </div>
 <div style={s.modalFooter}>
 <button style={s.cancelBtn} onClick={()=>setShowVitals(null)}>Cancel</button>
 <button style={s.primaryBtn} onClick={handleSaveVitals} disabled={saving}>
 {saving?'Saving...':' Save Vitals → Send to Doctor'}
 </button>
 </div>
 </div>
 </div>
 )}

 {/* ════════════════════════════════════════════════════════════════════ */}
 {/* MODAL: DOCTOR */}
 {/* ════════════════════════════════════════════════════════════════════ */}
 {showDoctor && (
 <div style={s.overlay} onClick={()=>setShowDoctor(null)}>
 <div style={{...s.modal,maxWidth:560}} onClick={e=>e.stopPropagation()}>
 <div style={s.modalHeader}>
 <div>
 <h2 style={s.modalTitle}>👨‍⚕ Doctor Assessment</h2>
 <p style={{margin:'4px 0 0',fontSize:13,color:'#888'}}>{showDoctor.patients?.full_name} — {showDoctor.visit_number}</p>
 </div>
 <button style={s.closeBtn} onClick={()=>setShowDoctor(null)} aria-label="Close" title="Close">✕</button>
 </div>
 <div style={s.modalBody}>
 {/* vitals summary if available */}
 {showDoctor.patients?.allergies && (
 <div style={{background:'#FCEBEB',borderRadius:8,padding:'8px 14px',marginBottom:12,fontSize:12,color:'#A32D2D'}}>
 <strong>Allergies:</strong> {showDoctor.patients.allergies}
 </div>
 )}

 <div style={s.grid2}>
 <Fld label="Speciality">
 <select style={s.input} value={doctorForm.speciality} onChange={e=>setDoctorForm({...doctorForm,speciality:e.target.value,doctor_id:'',doctor_name:''})}>
 <option value="">-- Select --</option>
 {departmentOptions.map(sp=><option key={sp}>{sp}</option>)}
 </select>
 </Fld>
 <Fld label="Doctor Name *">
 <input style={s.input} placeholder="Dr. ..." value={doctorForm.doctor_name} onChange={e=>setDoctorForm({...doctorForm,doctor_name:e.target.value})}/>
 </Fld>
 </div>

 {doctorForm.speciality && (() => {
 const activeDocs = doctors.filter(d => d.speciality === doctorForm.speciality && d.current_shift && !d.current_shift.toLowerCase().includes('off'))
 const offDocs = doctors.filter(d => d.speciality === doctorForm.speciality && (!d.current_shift || d.current_shift.toLowerCase().includes('off')))
 return (
 <>
 {activeDocs.length > 0 && (
 <div style={{marginBottom:14}}>
 <div style={s.sectionLabel}>Doctors on Shift</div>
 {activeDocs.map(doc => (
 <div key={doc.id} onClick={() => setDoctorForm({...doctorForm, doctor_id: doc.id, doctor_name: doc.full_name})}
 style={{padding:12,borderRadius:8,cursor:'pointer',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',
 border:doctorForm.doctor_id===doc.id?'2px solid #0F6E56':'1px solid #eee',
 background:doctorForm.doctor_id===doc.id?'#E1F5EE':'#fff'}}>
 <div><div style={{fontWeight:600}}>Dr. {doc.full_name}</div><div style={{fontSize:12,color:'#888'}}>{doc.speciality}</div></div>
 <span style={{...s.pill,background:'#E1F5EE',color:'#0F6E56',fontSize:10}}>On Shift</span>
 </div>
 ))}
 </div>
 )}
 {offDocs.length > 0 && (
 <div style={{marginBottom:14}}>
 <div style={s.sectionLabel}>Available Off Duty</div>
 {offDocs.map(doc => (
 <div key={doc.id} onClick={() => setDoctorForm({...doctorForm, doctor_id: doc.id, doctor_name: doc.full_name})}
 style={{padding:12,borderRadius:8,cursor:'pointer',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',
 border:doctorForm.doctor_id===doc.id?'2px solid #0F6E56':'1px solid #eee',
 background:doctorForm.doctor_id===doc.id?'#E1F5EE':'#fff'}}>
 <div><div style={{fontWeight:600}}>Dr. {doc.full_name}</div><div style={{fontSize:12,color:'#888'}}>{doc.speciality}</div></div>
 <span style={{...s.pill,background:'#F3F4F6',color:'#555',fontSize:10}}>Off Duty</span>
 </div>
 ))}
 </div>
 )}
 </>
 )
 })()}

 <Fld label="Doctor Notes / Diagnosis">
 <textarea style={{...s.input,minHeight:80,resize:'vertical'}} placeholder="Diagnosis, findings, referral notes..."
 value={doctorForm.notes} onChange={e=>setDoctorForm({...doctorForm,notes:e.target.value})}/>
 </Fld>

 <div style={s.sectionLabel}>Send Patient To →</div>
 <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
 {[
 {label:' Lab Tests', status:'Lab', color:'#A32D2D', bg:'#FCEBEB', disabled:!canLab, title:'Only doctors can order lab tests'},
 {label:' Pharmacy', status:'Pharmacy', color:'#085041', bg:'#E1F5EE'},
 {label:' Admit to Ward', status:'Admitted', color:'#3B6D11', bg:'#EAF3DE', disabled:!canAdmit, title:'Only doctors and nurses can process admissions'},
 {label:'✅ Completed (Go Home)', status:'Completed', color:'#555', bg:'#f0f0f0'},
 ].map(opt=>(
 <button key={opt.status} style={{padding:'14px 10px',border:`2px solid ${opt.bg}`,borderRadius:10,
 background:opt.bg,color:opt.color,fontWeight:700,fontSize:13,
 cursor:(saving || opt.disabled) ? 'not-allowed' : 'pointer',
 opacity:opt.disabled ? 0.4 : 1,
 pointerEvents:opt.disabled ? 'none' : 'auto'}}
 onClick={()=>handleSaveDoctor(opt.status)} disabled={saving || opt.disabled} title={opt.title || undefined}>
 {opt.label}
 </button>
 ))}
 </div>
 </div>
 <div style={s.modalFooter}>
 <button style={s.cancelBtn} onClick={()=>setShowDoctor(null)}>Cancel</button>
 </div>
 </div>
 </div>
 )}

 {/* ════════════════════════════════════════════════════════════════════ */}
 {/* MODAL: LAB */}
 {/* ════════════════════════════════════════════════════════════════════ */}
 {showLab && (
 <div style={s.overlay} onClick={()=>setShowLab(null)}>
 <div style={{...s.modal,maxWidth:640}} onClick={e=>e.stopPropagation()}>
 <div style={s.modalHeader}>
 <div>
 <h2 style={s.modalTitle}> Order Lab Tests</h2>
 <p style={{margin:'4px 0 0',fontSize:13,color:'#888'}}>
 {showLab.patients?.full_name} — {showLab.visit_number}
 {showLab.assigned_doctor_name && ` — Dr. ${showLab.assigned_doctor_name}`}
 </p>
 </div>
 <button style={s.closeBtn} onClick={()=>setShowLab(null)} aria-label="Close" title="Close">✕</button>
 </div>
 <div style={s.modalBody}>

 {/* Priority + Notes */}
 <div style={s.grid2}>
 <Fld label="Priority">
 <select style={s.input} value={labPriority} onChange={e=>setLabPriority(e.target.value)}>
 <option>Routine</option>
 <option>Urgent</option>
 <option>STAT</option>
 </select>
 </Fld>
 <Fld label="Notes for Lab Technician">
 <input style={s.input} placeholder="Special instructions..."
 value={labNotes} onChange={e=>setLabNotes(e.target.value)}/>
 </Fld>
 </div>

 {/* Category tabs */}
 <div style={s.sectionLabel}>Select Tests</div>
 <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
 {LAB_TEST_CATEGORIES.map(cat=>(
 <button key={cat}
 style={{padding:'5px 12px',borderRadius:99,border:'1px solid',fontSize:12,cursor:'pointer',fontWeight:500,
 borderColor: labCategory===cat ? '#0F6E56' : '#ddd',
 background: labCategory===cat ? '#0F6E56' : '#fff',
 color: labCategory===cat ? '#fff' : '#555'}}
 onClick={()=>setLabCategory(cat)}>
 {cat}
 </button>
 ))}
 </div>

 {/* Tests in selected category */}
 <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:14}}>
                {getLabTestsForCategory(labCategory).map(test=>{
 const checked = !!labSelectedTests.find(t=>t.test_name===test)
 return (
 <div key={test} onClick={()=>toggleLabTest(test)}
 style={{padding:'7px 13px',borderRadius:8,border:`1.5px solid ${checked?'#0F6E56':'#ddd'}`,
 background:checked?'#E1F5EE':'#fff',color:checked?'#0F6E56':'#444',
 fontSize:12,cursor:'pointer',fontWeight:checked?600:400,transition:'all .15s',
 display:'flex',alignItems:'center',gap:6}}>
 {checked && <span style={{fontSize:10}}></span>}
 {test}
 </div>
 )
 })}
 </div>

 {/* Custom test entry */}
 <div style={{display:'flex',gap:8,marginBottom:16}}>
 <input style={{...s.input,flex:1}} placeholder="Add custom test..."
 value={labCustomTest} onChange={e=>setLabCustomTest(e.target.value)}
 onKeyDown={e=>e.key==='Enter'&&addCustomLabTest()}/>
 <button style={{...s.primaryBtn,padding:'10px 16px',fontSize:13}} onClick={addCustomLabTest}>+ Add</button>
 </div>

 {/* Selected tests summary */}
 {labSelectedTests.length > 0 && (
 <div style={{background:'#f9fafb',border:'1px solid #eee',borderRadius:10,padding:'12px 14px'}}>
 <div style={{fontSize:11,fontWeight:700,color:'#0F6E56',textTransform:'uppercase',letterSpacing:.6,marginBottom:8}}>
 {labSelectedTests.length} test{labSelectedTests.length!==1?'s':''} ordered:
 </div>
 <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
 {labSelectedTests.map(t=>(
 <span key={t.test_name} style={{background:'#E1F5EE',color:'#0F6E56',border:'1px solid #B4E5D0',
 borderRadius:99,padding:'4px 10px',fontSize:12,fontWeight:500,display:'flex',alignItems:'center',gap:6}}>
 {t.test_name}
 <span style={{cursor:'pointer',fontWeight:700,color:'#A32D2D'}}
 onClick={()=>setLabSelectedTests(prev=>prev.filter(x=>x.test_name!==t.test_name))}>×</span>
 </span>
 ))}
 </div>
 </div>
 )}

 <div style={{background:'#EAF5EF',border:'1px solid #D4B8F4',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#7B5EA7',marginTop:14}}>
 ⚡ Tests will be sent to <strong>Laboratory</strong>. Patient stays in Lab queue until all results are entered, then auto-returns to Doctor.
 </div>
 </div>
 <div style={s.modalFooter}>
 <button style={s.cancelBtn} onClick={()=>setShowLab(null)}>Cancel</button>
 <button style={{...s.primaryBtn,opacity:labSelectedTests.length===0?.5:1}}
 onClick={handleSaveLab} disabled={saving||labSelectedTests.length===0}>
 {saving?'Sending...':` Send ${labSelectedTests.length||''} Test${labSelectedTests.length!==1?'s':''} to Lab`}
 </button>
 </div>
 </div>
 </div>
 )}

 {/* ════════════════════════════════════════════════════════════════════ */}
 {/* MODAL: PHARMACY / DISCHARGE */}
 {/* ════════════════════════════════════════════════════════════════════ */}
 {showPharmacy && (
 <div style={s.overlay} onClick={()=>setShowPharmacy(null)}>
 <div style={{...s.modal,maxWidth:580}} onClick={e=>e.stopPropagation()}>
 <div style={s.modalHeader}>
 <div>
 <h2 style={s.modalTitle}> Pharmacy & Discharge</h2>
 <p style={{margin:'4px 0 0',fontSize:13,color:'#888'}}>{showPharmacy.patients?.full_name} — {showPharmacy.visit_number}</p>
 </div>
 <button style={s.closeBtn} onClick={()=>setShowPharmacy(null)} aria-label="Close" title="Close">✕</button>
 </div>
 <div style={s.modalBody}>
 {showPharmacy.patients?.allergies && (
 <div style={{background:'#FCEBEB',borderRadius:8,padding:'8px 14px',marginBottom:12,fontSize:12,color:'#A32D2D'}}>
 <strong>ALLERGY ALERT:</strong> {showPharmacy.patients.allergies}
 </div>
 )}

 {prescriptionsLoading ? (
 <div style={{marginBottom:14,padding:12,borderRadius:10,background:'#f5f7fb',color:'#555',fontSize:13}}>Loading prescriptions...</div>
 ) : visitPrescriptions.length > 0 ? (
 <div style={{marginBottom:14,padding:12,borderRadius:10,border:'1px solid #e0e0e0',background:'#f9fafb'}}>
 <div style={{fontSize:12,fontWeight:700,color:'#0F6E56',marginBottom:10}}>Prescriptions sent from consultation</div>
 {visitPrescriptions.map(rx => (
 <div key={rx.id} style={{padding:'10px 12px',borderRadius:8,background:'#fff',border:'1px solid #eee',marginBottom:8}}>
 <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
 <div style={{fontSize:13,fontWeight:700,color:'#111'}}>{rx.drug_name}</div>
 <div style={{fontSize:11,color:'#555',fontWeight:600}}>{rx.quantity || 1} unit{rx.quantity > 1 ? 's' : ''}</div>
 </div>
 <div style={{fontSize:12,color:'#555',marginTop:4}}>{rx.dosage || '—'} • {rx.frequency || '—'} • {rx.duration || '—'}</div>
 <div style={{marginTop:8,display:'flex',gap:8,flexWrap:'wrap'}}>
 <span style={{fontSize:11,color:'#666'}}>{rx.status || 'Pending'}</span>
 {rx.dispensed && <span style={{fontSize:11,color:'#0F6E56'}}>Dispensed</span>}
 </div>
 </div>
 ))}
 </div>
 ) : null}
 <Fld label="Prescription / Drugs Dispensed">
 <textarea style={{...s.input,minHeight:100,resize:'vertical'}}
 placeholder="e.g. Amoxicillin 500mg x3 daily x7 days, Paracetamol 1g x3 daily x5 days..."
 value={pharmaForm.prescription} onChange={e=>setPharmaForm({...pharmaForm,prescription:e.target.value})}/>
 </Fld>

 <Fld label="Discharge Notes / Instructions">
 <textarea style={{...s.input,minHeight:60,resize:'vertical'}}
 placeholder="Patient instructions, follow-up date, diet notes..."
 value={pharmaForm.discharge_notes} onChange={e=>setPharmaForm({...pharmaForm,discharge_notes:e.target.value})}/>
 </Fld>

 <div style={s.sectionLabel}>Patient Outcome</div>
 <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:16}}>
 {[
 {label:'🏠 Outpatient', val:'Outpatient', color:'#0F6E56', bg:'#E1F5EE'},
 {label:' Admit', val:'Admitted', color:'#3B6D11', bg:'#EAF3DE'},
 {label:'🔁 Refer', val:'Referred', color:'#C07000', bg:'#FFF3DC'},
 ].map(opt=>(
 <button key={opt.val}
 style={{padding:'12px 8px',border:`2px solid ${pharmaForm.outcome===opt.val?opt.color:opt.bg}`,
 borderRadius:10,background:pharmaForm.outcome===opt.val?opt.bg:'#fff',
 color:opt.color,fontWeight:700,fontSize:13,cursor:'pointer'}}
 onClick={()=>setPharmaForm({...pharmaForm,outcome:opt.val})}>
 {opt.label}
 </button>
 ))}
 </div>

 {/* ── ADMIT: real ward + free bed picker ── */}
 {pharmaForm.outcome==='Admitted' && (
 <div style={{background:'#EAF3DE',border:'1px solid #b6dcb0',borderRadius:10,padding:'14px 16px',marginBottom:14}}>
 <div style={{fontSize:12,fontWeight:700,color:'#3B6D11',marginBottom:10,textTransform:'uppercase',letterSpacing:.6}}> Ward & Bed Assignment</div>
 <div style={s.grid2}>
 <Fld label="Select Ward *">
 <select style={s.input} value={pharmaForm.ward_id}
 onChange={e=>{
 setPharmaForm({...pharmaForm,ward_id:e.target.value,bed_id:''})
 if(e.target.value) fetchBedsForWard(e.target.value)
 else setWardBeds([])
 }}>
 <option value="">{wards.length===0 ? '⏳ Loading wards...' : `-- Choose Ward (${wards.length} available) --`}</option>
 {wards.map(w=><option key={w.id} value={w.id}>{w.name} ({w.ward_type})</option>)}
 </select>
 </Fld>
 <Fld label={loadingBeds?'Loading free beds...':'Select Free Bed *'}>
 <select style={s.input} value={pharmaForm.bed_id}
 onChange={e=>setPharmaForm({...pharmaForm,bed_id:e.target.value})}
 disabled={!pharmaForm.ward_id||loadingBeds}>
 <option value="">-- Choose Bed --</option>
 {wardBeds.map(b=><option key={b.id} value={b.id}>{b.bed_number}</option>)}
 </select>
 </Fld>
 </div>
 <div style={{fontSize:12,color:'#3B6D11',marginTop:2}}>
 ℹ This is a physical ward/bed assignment. Department referral routing is handled separately through the doctor/speciality fields.
 </div>
 {pharmaForm.ward_id && !loadingBeds && wardBeds.length===0 && (
 <div style={{fontSize:12,color:'#A32D2D',marginTop:-6}}> No free beds in this ward. Choose another ward or free up a bed first.</div>
 )}
 </div>
 )}

 {/* ── REFER: department + ward ── */}
 {pharmaForm.outcome==='Referred' && (
 <div style={{background:'#FFF3DC',border:'1px solid #FAC775',borderRadius:10,padding:'14px 16px',marginBottom:14}}>
 <div style={{fontSize:12,fontWeight:700,color:'#C07000',marginBottom:10,textTransform:'uppercase',letterSpacing:.6}}>🔁 Referral Details</div>
 <div style={s.grid2}>
 <Fld label="Refer To Department *">
 <select style={s.input} value={pharmaForm.refer_department}
 onChange={e=>setPharmaForm({...pharmaForm,refer_department:e.target.value})}>
 <option value="">-- Select Department --</option>
 {departmentOptions.map(sp => <option key={sp}>{sp}</option>)}
 </select>
 </Fld>
 <Fld label="Refer To Ward">
 <select style={s.input} value={pharmaForm.refer_ward}
 onChange={e=>setPharmaForm({...pharmaForm,refer_ward:e.target.value})}>
 <option value="">-- Select Ward (Optional) --</option>
 {wards.map(w=><option key={w.id} value={w.id}>{w.name} ({w.ward_type})</option>)}
 </select>
 </Fld>
 </div>
 <div style={{fontSize:12,color:'#C07000',marginTop:2}}>
 ℹ Patient will re-enter the <strong>Doctor queue</strong> assigned to this department. Ward selection is optional for inpatient referrals.
 </div>
 </div>
 )}

 {/* Insurance notice */}
 {showPharmacy.patients?.insurance && showPharmacy.patients.insurance!=='None' && showPharmacy.patients.insurance!=='' && (
 <div style={{background:'#EAF3DE',border:'1px solid #B4E5D0',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#3B6D11'}}>
 <strong>Insurance Patient ({showPharmacy.patients.insurance})</strong> — A claim will be auto-generated and saved to SHA Claims / Insurance Claims screen
 </div>
 )}
 </div>
 <div style={s.modalFooter}>
 <button style={s.cancelBtn} onClick={()=>setShowPharmacy(null)}>Cancel</button>
 <button style={s.primaryBtn} onClick={handleSavePharmacy} disabled={saving}>
 {saving?'Saving...':` ${pharmaForm.outcome==='Admitted'?'Admit Patient':pharmaForm.outcome==='Referred'?'Refer Patient':'Discharge Patient'}`}
 </button>
 </div>
 </div>
 </div>
 )}

 {/* ════════════════════════════════════════════════════════════════════ */}
 {/* MODAL: VISIT DETAIL */}
 {/* ════════════════════════════════════════════════════════════════════ */}
{showDetail && (
 <div style={s.overlay} onClick={()=>setShowDetail(null)}>
 <div style={{...s.modal,maxWidth:920}} onClick={e=>e.stopPropagation()}>
 <div style={s.modalHeader}>
 <div>
  <h2 style={s.modalTitle}>Patient Timeline — {detailPatient?.full_name}</h2>
  <p style={{fontSize:13,color:'#667085',margin:'4px 0 0'}}>
   Visit history, prescriptions, lab results, balances, and radiology reports
  </p>
 </div>
 <button style={s.closeBtn} onClick={()=>setShowDetail(null)} aria-label="Close" title="Close">✕</button>
 </div>
 <div style={s.modalBody}>
 {showDetail.loading ? (
  <div style={{padding:'30px 0',textAlign:'center',color:'#667085'}}>Loading patient timeline...</div>
 ) : (
  <>
   <div style={s.timelineHero}>
    <div style={{display:'flex',alignItems:'center',gap:14}}>
     <div style={{...s.avatar,...getAvatarStyle(detailPatient?.full_name),width:56,height:56,fontSize:20}}>
      {getInitials(detailPatient?.full_name)}
     </div>
     <div>
      <div style={{fontSize:20,fontWeight:800,color:'#111'}}>{detailPatient?.full_name}</div>
      <div style={{fontSize:13,color:'#667085',marginTop:4}}>
       {(detailPatient?.patient_number || getPatientCardNumber(detailPatient))} • {detailPatient?.gender || '—'} • {detailPatient?.age || '—'} years
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>
       {detailPatient?.blood_group && <span style={{...s.pill,background:'#E3F0FB',color:'#1a6fb5'}}>Blood {detailPatient.blood_group}</span>}
       {detailPatient?.allergies && <span style={{...s.pill,background:'#FCEBEB',color:'#A32D2D'}}>Allergies Recorded</span>}
       {(detailPatient?.sha_member_no || detailPatient?.insurance === 'SHA' || detailPatient?.insurer === 'SHA') && <span style={{...s.pill,background:'#E1F5EE',color:'#0F6E56'}}>SHA Member</span>}
      </div>
     </div>
    </div>
    <div style={s.timelineHeroStats}>
     <div style={s.timelineStatCard}><div style={s.viewLabel}>Phone</div><div style={s.viewVal}>{detailPatient?.phone || '—'}</div></div>
     <div style={s.timelineStatCard}><div style={s.viewLabel}>National ID</div><div style={s.viewVal}>{detailPatient?.national_id || detailPatient?.huduma_number || '—'}</div></div>
     <div style={s.timelineStatCard}><div style={s.viewLabel}>Latest Workflow</div><div style={s.viewVal}>{focusVisit?.status || 'No visits yet'}</div></div>
    </div>
   </div>

   <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:18}}>
    <button
     type="button"
     style={{...s.tabToggle, ...(detailTab === 'overview' ? s.tabActive : {})}}
     onClick={() => setDetailTab('overview')}
    >
     Overview
    </button>
    <button
     type="button"
     style={{...s.tabToggle, ...(detailTab === 'chronic' ? s.tabActive : {})}}
     onClick={() => setDetailTab('chronic')}
    >
     Chronic Disease{detailChronicRecords.length ? ` (${detailChronicRecords.length})` : ''}
    </button>
   </div>

   {detailTab === 'overview' && (
    <>
   <div style={{...s.sectionLabel,marginTop:18}}>Patient Summary</div>
   <div style={s.viewGrid}>
    {[
     ['Patient Number',detailPatient?.patient_number || getPatientCardNumber(detailPatient)],
     ['Date of Birth',detailPatient?.dob],
     ['Emergency Contact',detailPatient?.next_of_kin_name || detailPatient?.next_of_kin],
     ['Emergency Phone',detailPatient?.next_of_kin_phone],
     ['Emergency Relationship',detailPatient?.next_of_kin_relationship],
     ['Allergies',detailPatient?.allergies],
     ['Chronic Conditions',detailPatient?.chronic_conditions],
     ['Cover',detailPatient?.insurer_name || detailPatient?.insurer || detailPatient?.insurance || 'Self Pay'],
    ].map(([l,v])=>(
     <div key={l} style={s.viewRow}>
      <div style={s.viewLabel}>{l}</div>
      <div style={s.viewVal}>{v||'—'}</div>
     </div>
    ))}
   </div>

  <PatientNetworkPanel patient={detailPatient} hospitalId={hospitalId} />

  <div style={{...s.sectionLabel,marginTop:18}}>Cross-module activity</div>
  {detailWorkflowEvents.length === 0 ? (
   <div style={{padding:'18px 0',color:'#667085'}}>No workflow events recorded for this patient yet.</div>
  ) : (
   <div style={s.timelineList}>
    {detailWorkflowEvents.map(event => {
    const knownLabels = {
     'emergency.red_triage': 'Emergency red triage',
     'theatre.scheduled': 'Theatre case scheduled',
     'theatre.started': 'Theatre case started',
     'theatre.completed': 'Theatre case completed',
    'blood.crossmatch_recorded': 'Blood crossmatch recorded',
     'blood.issued': 'Blood unit issued',
     'morgue.death_recorded': 'Mortuary admission recorded',
     'morgue.release_requested': 'Mortuary release requested',
     'morgue.released': 'Mortuary release approved',
     'maternity.delivery_recorded': 'Delivery recorded',
     'procurement.received': 'Goods received',
     'safety.incident_opened': 'Safety incident opened',
    }
    const label = knownLabels[event.event_type] || String(event.event_type || 'Workflow update').replace(/[._]/g, ' ').replace(/\b\w/g, character => character.toUpperCase())
    const source = event.source_module === 'blood-bank' ? 'blood-bank' : event.source_module
    return (
     <div key={event.id} style={s.timelineCard}>
      <div style={s.timelineLineWrap}><div style={{...s.timelineDot,background:'#1A6FB5'}} /></div>
      <div style={{flex:1}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',alignItems:'flex-start'}}>
       <div>
        <div style={{fontSize:14,fontWeight:800,color:'#111'}}>{label}</div>
        <div style={{fontSize:12,color:'#667085',marginTop:4}}>{event.payload?.title || event.source_module} • {formatDateTime(event.created_at)}</div>
       </div>
       <button type="button" style={s.linkButton} onClick={() => navigate?.(source)}>Open module</button>
      </div>
      {event.payload?.triage_category && <div style={{fontSize:12,color:'#667085',marginTop:6}}>Triage: {event.payload.triage_category}</div>}
      </div>
     </div>
    )
    })}
   </div>
  )}

   <div style={{...s.sectionLabel,marginTop:18}}>Visit Timeline</div>
   {detailTimeline.length === 0 ? (
    <div style={{padding:'18px 0',color:'#667085'}}>No visits found for this patient yet.</div>
   ) : (
    <div style={s.timelineList}>
     {detailTimeline.map((visit, index) => {
      const stageColors = STEP_COLORS[visit.status] || STEP_COLORS.Completed
      const invoice = visit.invoice || null
      return (
       <div key={visit.id} style={{...s.timelineCard, ...(visit.id === showDetail.highlightedVisitId ? s.timelineCardActive : {})}}>
        <div style={s.timelineLineWrap}>
         <div style={{...s.timelineDot,background:stageColors.color}} />
         {index !== detailTimeline.length - 1 && <div style={s.timelineLine} />}
        </div>
        <div style={{flex:1}}>
         <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',alignItems:'flex-start'}}>
          <div>
           <div style={{fontSize:15,fontWeight:800,color:'#111'}}>
            {visit.visit_number || `Visit ${index + 1}`}
           </div>
           <div style={{fontSize:12,color:'#667085',marginTop:4}}>
            {formatDateTime(visit.created_at)} • {visit.visit_type || 'Visit'} • {visit.priority || 'Normal'}
           </div>
          </div>
          <span style={{...s.pill,background:stageColors.bg,color:stageColors.color}}>{visit.status || 'Completed'}</span>
         </div>

         <div style={s.timelineMetaGrid}>
          <div style={s.timelineMiniCard}>
           <div style={s.viewLabel}>Doctor</div>
           <div style={s.viewVal}>{visit.consultation?.doctor_name || visit.assigned_doctor_name || '—'}</div>
          </div>
          <div style={s.timelineMiniCard}>
           <div style={s.viewLabel}>Diagnosis</div>
           <div style={s.viewVal}>{visit.consultation?.diagnosis || visit.consultation?.icd10_description || '—'}</div>
          </div>
          <div style={s.timelineMiniCard}>
           <div style={s.viewLabel}>Billed</div>
           <div style={s.viewVal}>{formatCurrency(invoice?.amount_kes || visit.admission_fee || 0)}</div>
          </div>
          <div style={s.timelineMiniCard}>
           <div style={s.viewLabel}>Payment</div>
           <div style={s.viewVal}>{invoice?.status || visit.admission_payment_method || '—'}</div>
          </div>
         </div>

         {visit.chief_complaint && (
          <div style={s.timelineSection}>
           <div style={s.viewLabel}>Chief Complaint</div>
           <div style={s.viewVal}>{visit.chief_complaint}</div>
          </div>
         )}

         {visit.consultation?.notes && (
          <div style={s.timelineSection}>
           <div style={s.viewLabel}>Clinical Notes</div>
           <div style={s.viewVal}>{visit.consultation.notes}</div>
          </div>
         )}

         <div style={s.timelineSection}>
          <div style={s.viewLabel}>Prescriptions</div>
          {visit.prescriptions?.length ? (
           <div style={s.timelineChipWrap}>
            {visit.prescriptions.map(rx => (
             <span key={rx.id} style={s.timelineChip}>{rx.drug_name || 'Unnamed drug'}</span>
            ))}
           </div>
          ) : <div style={s.viewVal}>No prescriptions recorded</div>}
         </div>

         <div style={s.timelineSection}>
          <div style={s.viewLabel}>Lab Results</div>
          {visit.labTests?.length ? (
           <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {visit.labTests.map(test => (
             <div key={test.id} style={s.timelineDataRow}>
              <div style={{fontWeight:700,color:'#111'}}>{test.test_name}</div>
              <div style={{fontSize:12,color:'#667085'}}>{test.status || 'Pending'} • {test.result || 'No result yet'}</div>
             </div>
            ))}
           </div>
          ) : <div style={s.viewVal}>No lab tests for this visit</div>}
         </div>

         {invoice && (
          <div style={s.timelineSection}>
           <div style={s.viewLabel}>Invoice</div>
           <div style={s.timelineInvoiceRow}>
            <span>{invoice.invoice_no || 'Invoice'}</span>
            <span>{formatCurrency(invoice.amount_kes || 0)}</span>
            <span>{formatCurrency(invoice.balance_kes || 0)} balance</span>
           </div>
          </div>
         )}
        </div>
       </div>
      )
     })}
    </div>
   )}

   {radiologyHistoryLoading || radiologyHistory.length > 0 ? (
    <>
     <div style={{...s.sectionLabel,marginTop:18}}>Radiology</div>
     {radiologyHistoryLoading ? (
      <div style={{fontSize:13,color:'#888'}}>Loading radiology reports...</div>
     ) : (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
       {radiologyHistory.map(report => (
        <div key={report.id} style={{background:'#f9fafb',border:'1px solid #eee',borderRadius:8,padding:'12px 14px'}}>
         <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'flex-start'}}>
          <div>
           <div style={{fontSize:13,fontWeight:700,color:'#111'}}>{report.modality} — {report.body_region || '—'}</div>
           <div style={{fontSize:11,color:'#64748B',marginTop:3}}>{report.report_date ? new Date(report.report_date).toLocaleDateString('en-KE') : 'Pending report'} • {report.status || 'Requested'}</div>
           <div style={{fontSize:12,color:'#334155',marginTop:6}}>{String(report.impression || report.report_text || 'No report text yet').slice(0, 120)}</div>
          </div>
          {['Reported','Verified'].includes(report.status) && (
           <button style={{...s.primaryBtn,background:'#fff',color:'#0F6E56',border:'1px solid #0F6E56',padding:'8px 12px'}} onClick={() => openRadiologyReportPrintWindow({ ...report, patients: detailPatient || {} }, hospitalName)}>
            Print Report
           </button>
          )}
         </div>
        </div>
       ))}
      </div>
     )}
   </>
   ) : null}
    </>
   )}

   {detailTab === 'chronic' && (
    <>
     <div style={{...s.sectionLabel,marginTop:18}}>Latest chronic disease records</div>
     {detailChronicRecords.length === 0 ? (
      <div style={{padding:'18px 0',color:'#667085'}}>No chronic disease enrollment has been recorded for this patient yet.</div>
     ) : (
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
       {detailChronicRecords.map(record => (
        <div key={record.id} style={{background:'#fff',border:'1px solid #E4E7EC',borderRadius:14,padding:'14px 16px'}}>
         <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'flex-start',flexWrap:'wrap'}}>
          <div>
           <div style={{fontSize:15,fontWeight:800,color:'#111'}}>{record.condition || 'Chronic care'}</div>
           <div style={{fontSize:12,color:'#667085',marginTop:4}}>
            Last reviewed {record.visit_date ? new Date(record.visit_date).toLocaleDateString('en-KE') : '—'}
           </div>
          </div>
          <button
           type="button"
           style={{...s.actionBtn,...s.btnPri}}
           onClick={() => openChronicDiseaseWorkspace(detailPatient, focusVisit)}
          >
           Open Tracker
          </button>
         </div>
         <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10,marginTop:12}}>
          <div style={s.timelineMiniCard}>
           <div style={s.viewLabel}>Medication</div>
           <div style={s.viewVal}>{record.arv_regimen || record.oral_meds || record.current_meds || '—'}</div>
          </div>
          <div style={s.timelineMiniCard}>
           <div style={s.viewLabel}>Markers</div>
           <div style={s.viewVal}>
            {[
             record.viral_load ? `VL ${record.viral_load}` : '',
             record.hba1c ? `HbA1c ${record.hba1c}` : '',
             record.bp_systolic ? `BP ${record.bp_systolic}/${record.bp_diastolic || ''}` : '',
             record.adherence_score ? `Adherence ${record.adherence_score}/5` : '',
            ].filter(Boolean).join(' • ') || '—'}
           </div>
          </div>
         </div>
         {record.notes && (
          <div style={{marginTop:12}}>
           <div style={s.viewLabel}>Notes</div>
           <div style={s.viewVal}>{record.notes}</div>
          </div>
         )}
        </div>
       ))}
      </div>
     )}
    </>
   )}
  </>
 )}
 </div>
 <div style={s.modalFooter}>
 <button style={s.cancelBtn} onClick={()=>setShowDetail(null)}>Close</button>
 <button
 style={{...s.primaryBtn, background:'#1A6B4A', ...(canPrint ? {} : s.btnDisabled)}}
 onClick={() => printPatientSummary(hospitalName, detailPatient || {}, detailTimeline)}
 disabled={!canPrint}
 title={!canPrint ? 'Printing is limited to billing-authorized users and admins.' : ''}>
 Print Patient Summary
 </button>
 <button
 style={{...s.primaryBtn,background:'#555', ...(canPrint ? {} : s.btnDisabled)}}
 disabled={!canPrint}
 onClick={() => {
   if (!canPrint) {
     notifyWarning('Only billing-authorized users can print receipts.')
     return
   }
   if (!focusVisit) {
    notifyWarning('No visit available to reprint receipt for.')
    return
   }
   printReceipt(hospitalName, hospitalId, showDetail.patients||{}, {
     visit_number:focusVisit.visit_number, visit_type:focusVisit.visit_type,
     admission_fee:focusVisit.admission_fee, payment_method:focusVisit.admission_payment_method,
     mpesa_ref:focusVisit.mpesa_ref
   })
 }}>🖨 Reprint Receipt</button>
 </div>
 </div>
 </div>
 )}
 </div>
 )
}

// ─── Tiny helper ─────────────────────────────────────────────────────────────
// Links the label to its field (click the label to focus; screen readers announce it) when the field is a single
// input / select / textarea without its own id.
function Fld({label,children}) {
 const autoId = useId()
 const only = Children.count(children) === 1 && isValidElement(children) && ['input','select','textarea'].includes(children.type) ? children : null
 const fieldId = only ? (only.props.id || autoId) : null
 return (
 <div style={{marginBottom:14}}>
 <label htmlFor={fieldId || undefined} style={{fontSize:12,color:'#666',display:'block',marginBottom:5,fontWeight:500}}>{label}</label>
 {only && !only.props.id ? cloneElement(only, { id: fieldId }) : children}
 </div>
 )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = {
 page: { padding:'20px 24px', flex:1, overflowY:'auto', background:'#f7f8f7', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' },
 loadWrap: { height:'80vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' },
 spinner: { width:36, height:36, border:'3px solid #e8ebe8', borderTop:'3px solid #0F6E56', borderRadius:'50%', animation:'spin 0.9s linear infinite' },
 header: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10 },
 title: { fontSize:26, fontWeight:800, margin:0, color:'#111' },
 subtitle: { color:'#777', margin:'4px 0 0', fontSize:13 },
 primaryBtn: { background:'#0F6E56', color:'#fff', border:'none', padding:'10px 20px', borderRadius:8, fontWeight:600, cursor:'pointer', fontSize:14 },
 tabToggle: { padding:'9px 16px', border:'1px solid #e0e0e0', borderRadius:8, background:'#fff', cursor:'pointer', fontSize:13, color:'#555', fontWeight:500 },
 tabActive: { background:'#0F6E56', color:'#fff', border:'1px solid #0F6E56' },
 rangeSelect:{ padding:'9px 12px', border:'1px solid #ddd', borderRadius:8, fontSize:13, cursor:'pointer', background:'#fff', color:'#333' },
 registryToolbar: { display:'flex', gap:10, flexWrap:'wrap', marginBottom:14, background:'#fff', padding:'14px 16px', border:'1px solid #eee', borderRadius:12 },
 bulkBar: { display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:14, background:'#FFF8E8', border:'1px solid #F6D58C', borderRadius:12, padding:'12px 16px' },
 duplicatePanel: { marginBottom:14, background:'#FFF4F4', border:'1px solid #F5C2C7', borderRadius:12, padding:'14px 16px' },
 duplicateRow: { display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap', background:'#fff', border:'1px solid #F8D7DA', borderRadius:10, padding:'10px 12px' },
 pipeline: { display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', background:'#fff', padding:'14px 16px', borderRadius:12, border:'1px solid #eee' },
 pipeStep: { display:'flex', flexDirection:'column', alignItems:'center', gap:4, cursor:'pointer', padding:'6px 10px', borderRadius:8, minWidth:70 },
 pipeActive: { background:'#f0f2f0' },
 pipeCount: { fontSize:18, fontWeight:800, padding:'4px 10px', borderRadius:6, minWidth:32, textAlign:'center' },
 pipeLabel: { fontSize:10, color:'#888', fontWeight:500, textAlign:'center' },
 searchWrap: { position:'relative', marginBottom:14 },
 searchIcon: { position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', fontSize:14 },
 searchInput:{ width:'100%', padding:'10px 12px 10px 36px', border:'1px solid #ddd', borderRadius:8, fontSize:14, outline:'none', background:'#fff', boxSizing:'border-box' },
 clearBtn: { position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', cursor:'pointer', color:'#999' },
 queueList: { display:'flex', flexDirection:'column', gap:10 },
 queueCard: { background:'#fff', borderRadius:12, padding:'14px 16px', border:'1px solid #eee', display:'flex', alignItems:'center', gap:12, boxShadow:'0 2px 6px rgba(0,0,0,.04)', flexWrap:'wrap', transition:'border .15s,box-shadow .15s' },
 journeyDots:{ display:'flex', alignItems:'center' },
 tableWrap: { background:'#fff', borderRadius:12, border:'1px solid #eee', overflow:'hidden' },
 table: { width:'100%', borderCollapse:'collapse' },
 th: { fontSize:11, color:'#888', fontWeight:600, textAlign:'left', padding:'12px 14px', borderBottom:'2px solid #f0f0f0', textTransform:'uppercase', letterSpacing:.5, whiteSpace:'nowrap' },
 td: { fontSize:13, color:'#333', padding:'12px 14px', verticalAlign:'middle' },
 avatar: { width:38, height:38, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:700, color:'#0F6E56', flexShrink:0 },
 patName: { fontWeight:600, color:'#111', fontSize:14 },
 pill: { fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:99 },
 actionBtn: { fontSize:12, padding:'6px 12px', border:'1px solid #ddd', borderRadius:6, background:'#fff', cursor:'pointer', fontWeight:500, color:'#333', whiteSpace:'nowrap' },
 smallActionBtn: { fontSize:12, padding:'7px 12px', border:'1px solid #0F6E56', borderRadius:8, background:'#F4FBF8', color:'#0F6E56', cursor:'pointer', fontWeight:700 },
 btnDisabled: { opacity:0.5, cursor:'not-allowed' },
 btnPri: { background:'#0F6E56', color:'#fff', border:'1px solid #0F6E56' },
 btnGhost: { background:'#F8FAFC', color:'#98A2B3', border:'1px solid #E4E7EC' },
 btnOrange: { background:'#FFF3DC', color:'#C07000', border:'1px solid #FAC775' },
 btnPurple: { background:'#EAF5EF', color:'#7B5EA7', border:'1px solid #D4B8F4' },
 btnRed: { background:'#FCEBEB', color:'#A32D2D', border:'1px solid #f5c6cb' },
 btnGreen: { background:'#E1F5EE', color:'#0F6E56', border:'1px solid #B4E5D0' },
 empty: { textAlign:'center', padding:'80px 20px', color:'#999' },
 overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 },
 modal: { background:'#fff', borderRadius:16, width:'100%', maxWidth:700, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,.2)', animation:'fadeIn .2s ease' },
 modalHeader:{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'20px 24px', borderBottom:'1px solid #f0f0f0' },
 modalTitle: { fontSize:18, fontWeight:700, margin:0, color:'#111' },
 closeBtn: { background:'none', border:'none', fontSize:18, cursor:'pointer', color:'#888', padding:'4px 8px' },
 modalBody: { padding:'20px 24px', overflowY:'auto', flex:1 },
 modalFooter:{ padding:'16px 24px', borderTop:'1px solid #f0f0f0', display:'flex', justifyContent:'flex-end', gap:10 },
 grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:4 },
 input: { width:'100%', padding:'10px 12px', border:'1px solid #ddd', borderRadius:8, fontSize:14, outline:'none', boxSizing:'border-box', background:'#fff', color:'#111', fontFamily:'inherit' },
 tagInputWrap: { display:'flex', alignItems:'center', gap:8, border:'1px solid #ddd', borderRadius:8, padding:'8px 12px', background:'#fff' },
 tagWrap: { display:'flex', gap:8, flexWrap:'wrap', marginTop:10 },
 tagPill: { display:'inline-flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:999, background:'#FCEBEB', color:'#A32D2D', fontSize:12, fontWeight:600 },
 tagRemoveBtn: { border:'none', background:'transparent', color:'#A32D2D', cursor:'pointer', fontSize:14, lineHeight:1, padding:0 },
 sectionLabel:{ fontSize:11, fontWeight:700, color:'#0F6E56', textTransform:'uppercase', letterSpacing:.8, marginBottom:12, marginTop:4, paddingBottom:6, borderBottom:'1px solid #E1F5EE' },
 cancelBtn: { padding:'10px 20px', border:'1px solid #ddd', borderRadius:8, background:'#fff', cursor:'pointer', fontSize:14, fontWeight:500, color:'#555' },
 summaryCard:{ borderRadius:10, padding:14, background:'#f9fafb', border:'1px solid #eee' },
 resultCard: { background:'#fff', border:'1px solid #e0e0e0', borderRadius:10, padding:'14px 16px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, transition:'border .15s' },
 linkButton: { background:'transparent', border:'none', padding:0, color:'#111', fontSize:14, fontWeight:700, cursor:'pointer', textAlign:'left' },
 viewGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:0 },
 viewRow: { padding:'10px 0', borderBottom:'1px solid #f5f5f5' },
 viewLabel: { fontSize:11, color:'#888', fontWeight:600, textTransform:'uppercase', letterSpacing:.4, marginBottom:3 },
 viewVal: { fontSize:13, color:'#111', fontWeight:500 },
 timelineHero: { display:'flex', justifyContent:'space-between', gap:16, flexWrap:'wrap', background:'linear-gradient(135deg, #F4FBF8, #FFFFFF)', border:'1px solid #D8EEE5', borderRadius:16, padding:'18px 20px' },
 timelineHeroStats: { display:'grid', gridTemplateColumns:'repeat(3, minmax(120px, 1fr))', gap:10, flex:'1 1 280px' },
 timelineStatCard: { background:'#fff', border:'1px solid #E4E7EC', borderRadius:12, padding:'12px 14px' },
 timelineList: { display:'flex', flexDirection:'column', gap:14 },
 timelineCard: { display:'flex', gap:14, background:'#fff', border:'1px solid #E4E7EC', borderRadius:14, padding:'16px 18px' },
 timelineCardActive: { border:'1px solid #0F6E56', boxShadow:'0 0 0 3px rgba(15,110,86,.08)' },
 timelineLineWrap: { display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0 },
 timelineDot: { width:14, height:14, borderRadius:'50%', marginTop:6 },
 timelineLine: { width:2, flex:1, background:'#D0D5DD', marginTop:4 },
 timelineMetaGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10, marginTop:14 },
 timelineMiniCard: { background:'#F8FAFC', border:'1px solid #EAECF0', borderRadius:10, padding:'10px 12px' },
 timelineSection: { marginTop:14 },
 timelineChipWrap: { display:'flex', gap:8, flexWrap:'wrap' },
 timelineChip: { display:'inline-flex', alignItems:'center', padding:'5px 9px', borderRadius:999, background:'#EEF4FF', color:'#175CD3', fontSize:12, fontWeight:600 },
 timelineDataRow: { border:'1px solid #EAECF0', borderRadius:10, padding:'10px 12px', background:'#fff' },
 timelineInvoiceRow: { display:'flex', gap:14, flexWrap:'wrap', fontSize:13, fontWeight:600, color:'#111' },
}
