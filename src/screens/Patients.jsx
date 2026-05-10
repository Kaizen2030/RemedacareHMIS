import { useEffect, useMemo, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import { canPerformAction } from '../access'
import { executeWithFallback, omitKeys } from '../utils/dbCompat'
import { buildWorkflowInvoiceNote, createServiceLine, SERVICE_SOURCES, stringifyServiceLines } from '../utils/workflowBilling'
import { getLabTestsForCategory, LAB_TEST_CATEGORIES } from '../utils/labCatalog'

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

const STEPS = ['Registration', 'Vitals', 'Doctor', 'Lab', 'Pharmacy', 'Admission Requested', 'Completed']
const STEP_COLORS = {
 Registration: { bg: '#E3F0FB', color: '#1a6fb5' },
 Vitals: { bg: '#FFF3DC', color: '#C07000' },
 Doctor: { bg: '#F0EAFC', color: '#7B5EA7' },
 Lab: { bg: '#FCEBEB', color: '#A32D2D' },
 Pharmacy: { bg: '#E1F5EE', color: '#085041' },
 'Admission Requested': { bg: '#DBEAFE', color: '#1D4ED8' },
 Completed: { bg: '#f0f0f0', color: '#555' },
 Admitted: { bg: '#EAF3DE', color: '#3B6D11' },
}

const AVATAR_COLORS = ['#E1F5EE', '#E3F0FB', '#F0EAFC', '#FFF3DC', '#FCEBEB', '#EAF3DE']


// ─── Utility ─────────────────────────────────────────────────────────────────
function getDateRange(range) {
 const now = new Date()
 const start = new Date()
 if (range === 'today') start.setHours(0,0,0,0)
 else if (range === 'week') start.setDate(now.getDate()-7)
 else if (range === '2weeks') start.setDate(now.getDate()-14)
 else if (range === 'month') start.setDate(now.getDate()-30)
 else if (range === '2months') start.setDate(now.getDate()-60)
 else if (range === 'all') start.setFullYear(2000)
 return start.toISOString()
}

// ─── Receipt printer ─────────────────────────────────────────────────────────
function printReceipt(hospitalName, hospitalId, patient, visit) {
 const w = window.open('', '_blank')
 w.document.write(`
 <html><head><title>Receipt</title>
 <style>
 body{font-family:Arial,sans-serif;max-width:400px;margin:30px auto;padding:0}
 .box{border:3px solid #0F6E56;border-radius:12px;padding:24px}
 h2{text-align:center;color:#0F6E56;margin:0}
 p{text-align:center;margin:4px 0;font-size:13px;color:#555}
 hr{border:1px solid #0F6E56;margin:14px 0}
 .row{display:flex;justify-content:space-between;margin:6px 0;font-size:14px}
 .total{font-size:18px;font-weight:800;color:#0F6E56}
 .foot{text-align:center;font-size:12px;color:#0F6E56;margin-top:16px}
 @media print{body{margin:0}}
 </style></head><body>
 <div class="box">
 <h2>${hospitalName || 'REMEDACARE HOSPITAL'}</h2>
 <p>Your Health, Our Priority</p>
 <hr>
 <h3 style="text-align:center;margin:10px 0">OFFICIAL RECEIPT</h3>
 <div class="row"><span>Visit No.</span><strong>${visit.visit_number}</strong></div>
 <div class="row"><span>Date/Time</span><span>${new Date().toLocaleString('en-KE')}</span></div>
 <div class="row"><span>Hospital ID</span><span>${hospitalId || '—'}</span></div>
 <div class="row"><span>Patient</span><strong>${patient.full_name}</strong></div>
 <div class="row"><span>Age/Gender</span><span>${patient.age||'-'} yrs / ${patient.gender||'-'}</span></div>
 <div class="row"><span>Phone</span><span>${patient.phone||'-'}</span></div>
 <hr>
 <div class="row"><span>Service</span><span>${visit.visit_type} Consultation</span></div>
 <div class="row"><span>Payment</span><span>${visit.payment_method}</span></div>
 ${visit.mpesa_ref ? `<div class="row"><span>M-Pesa Ref</span><span>${visit.mpesa_ref}</span></div>` : ''}
 <hr>
 <div class="row"><span>TOTAL PAID</span><span class="total">KES ${parseFloat(visit.admission_fee).toLocaleString()}</span></div>
 <div class="foot">Thank you for choosing ${hospitalName||'Remedacare'}<br><strong>Keep this receipt</strong></div>
 </div>
 <script>setTimeout(()=>{window.print();},500)</script>
 </body></html>
 `)
 w.document.close()
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Patients() {
 const { hospitalId, userRole, departments: configuredDepartments = [] } = useHospital()
 const canRegister = canPerformAction(userRole, 'register_patient')
 const canVitals = canPerformAction(userRole, 'record_vitals')
 const canDoctor = canPerformAction(userRole, 'write_diagnosis')
 const canLab = canPerformAction(userRole, 'order_labs')
 const canPharmacy = canPerformAction(userRole, 'approve_prescription')
 const canAdmit = canPerformAction(userRole, 'admit_patient')
 const canDischarge = canPerformAction(userRole, 'discharge_patient')
 const canPrint = canPerformAction(userRole, 'create_invoice') || ['Admin','admin'].includes(userRole || '')

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
 const [filterStatus, setFilterStatus] = useState('All')
 const [dateRange, setDateRange] = useState('today')

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

 const emptyReg = {
 full_name:'', national_id:'', dob:'', age:'', gender:'Female',
 phone:'', phone2:'', address:'', blood_group:'',
 allergies:'', chronic_conditions:'',
 next_of_kin:'', next_of_kin_phone:'', next_of_kin_relationship:'',
 insurance:'', insurance_number:'',
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

 // ── fetch ──────────────────────────────────────────────────────────────────
 useEffect(() => {
 if (!hospitalId) { setLoading(false); return }
 fetchData(); fetchDoctors(); fetchHospital(); fetchWards()
 }, [hospitalId, dateRange])

 useEffect(() => {
 if (!hospitalId) return
 fetchPatientPage(patientPage)
 }, [hospitalId, patientPage])

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
 async function handleSearch() {
 if (!searchQuery.trim()) return
 setSearching(true); setSearchDone(false)
 const q = searchQuery.trim()
 const { data } = await supabase.from('patients').select('*')
 .eq('hospital_id', hospitalId)
 .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,national_id.ilike.%${q}%,guardian_id.ilike.%${q}%`)
 .limit(10)
 setSearchResults(data || [])
 setSearchDone(true); setSearching(false)
 }

 function openNewPatient() {
 if (!canRegister) { window.notifyFromLegacyAlert('Only receptionists, nurses and admins can register patients.'); return }
 setShowSearchModal(false); setIsReturning(false); setSelectedPatient(null)
 setRegForm(emptyReg); setVisitForm(emptyVisit); setRegStep(1); setShowRegister(true)
 }

 function selectReturningPatient(patient) {
 if (!canRegister) { window.notifyFromLegacyAlert('Only receptionists, nurses and admins can register patients.'); return }
 setShowSearchModal(false); setIsReturning(true); setSelectedPatient(patient)
 setRegForm({ ...patient }); setVisitForm({ ...emptyVisit, admission_fee:'300' })
 setRegStep(2); setShowRegister(true)
 }

 // ── REGISTER ──────────────────────────────────────────────────────────────
 async function handleRegister() {
 if (!canRegister) { window.notifyFromLegacyAlert('Only receptionists, nurses and admins can register patients.'); return }
 if (!visitForm.admission_fee || parseFloat(visitForm.admission_fee) <= 0) { window.notifyFromLegacyAlert('Enter a valid fee.'); return }
 if (visitForm.payment_method === 'M-Pesa' && !visitForm.mpesa_ref) { window.notifyFromLegacyAlert('Enter M-Pesa reference.'); return }
 setSaving(true)
 try {
 let patientId = selectedPatient?.id
 if (!isReturning) {
 if (regForm.national_id || regForm.phone) {
 const { data: ex } = await supabase.from('patients').select('id')
 .eq('hospital_id', hospitalId)
 .or(`national_id.eq.${regForm.national_id},phone.eq.${regForm.phone}`)
 .maybeSingle()
 if (ex) patientId = ex.id
 }
 if (!patientId) {
 const { data: np, error } = await supabase.from('patients')
 .insert({ ...regForm, hospital_id: hospitalId }).select().single()
 if (error) { window.notifyFromLegacyAlert('Error: ' + error.message); setSaving(false); return }
 patientId = np.id
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
 if (vErr) { window.notifyFromLegacyAlert('Error: ' + vErr.message); setSaving(false); return }

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
 const isInsurancePayment = !['Cash', 'M-Pesa'].includes(mappedPaymentMethod)
 const paidAmount = isInsurancePayment ? 0 : consultationAmount
 const balanceAmount = isInsurancePayment ? consultationAmount : 0

const { error: invoiceErr } = await supabase.from('invoices').insert({
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
  amount_kes: consultationAmount,
  paid_kes: paidAmount,
  balance_kes: balanceAmount,
  payment_method: mappedPaymentMethod,
  insurer: mappedPaymentMethod === 'SHA (Social Health Authority)' ? 'SHA' : (isInsurancePayment ? mappedPaymentMethod : null),
  sha_member_no: mappedPaymentMethod === 'SHA (Social Health Authority)' ? (regForm.insurance_number || selectedPatient?.sha_member_no || null) : null,
  status: isInsurancePayment ? 'Pending' : 'Paid',
  notes: buildWorkflowInvoiceNote({
   source: SERVICE_SOURCES.CONSULTATION,
   sourceId: createdVisit?.visit_number || visitNumber,
   visitId: createdVisit?.id || null,
   summary: `Consultation fee for ${createdVisit?.visit_number || visitNumber}`,
  }),
  paid_at: isInsurancePayment ? null : new Date().toISOString(),
  created_at: new Date().toISOString(),
 })
 if (invoiceErr) { console.error('Consultation invoice creation failed', invoiceErr) }

 // Print receipt
 if (!canPrint) {
   window.notifyFromLegacyAlert('Only billing-authorized users can print receipts.')
 } else {
   printReceipt(hospitalName, hospitalId, selectedPatient || regForm, {
     visit_number: visitNumber, visit_type: visitForm.visit_type,
     admission_fee: visitForm.admission_fee, payment_method: visitForm.payment_method,
     mpesa_ref: visitForm.mpesa_ref
   })
 }

 setShowRegister(false)
 setSearchQuery(''); setSearchResults([]); setSearchDone(false)
 try {
  window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: createdVisit?.id, source: 'patient-registration' } }))
 } catch (e) {}
 await fetchData()
} catch (e) { window.notifyFromLegacyAlert('Error: ' + e.message) }
 setSaving(false)
 }

 // ── VITALS ────────────────────────────────────────────────────────────────
 async function handleSaveVitals() {
 if (!canVitals) { window.notifyFromLegacyAlert('Only nurses and admins can record vitals.'); return }
 if (!vitalsForm.weight_kg || !vitalsForm.bp_systolic) { window.notifyFromLegacyAlert('Weight and Systolic BP required.'); return }
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
 if (!canDoctor) { window.notifyFromLegacyAlert('Only doctors, clinical officers and admins can assess patients.'); return }
 if (nextStatus === 'Lab' && !canLab) { window.notifyFromLegacyAlert('Only doctors can order lab tests.'); return }
 if (nextStatus === 'Admitted' && !canAdmit) { window.notifyFromLegacyAlert('Only doctors and nurses can process admissions.'); return }
 if (!doctorForm.doctor_name) { window.notifyFromLegacyAlert('Enter doctor name.'); return }
 setSaving(true)
 const { error } = await supabase.from('visits').update({
 assigned_doctor_name: doctorForm.doctor_name,
 speciality: doctorForm.speciality,
 doctor_notes: doctorForm.notes,
 status: nextStatus,
 }).eq('id', showDoctor.id).eq('hospital_id', hospitalId)
 if (error) { window.notifyFromLegacyAlert('Error: ' + error.message); setSaving(false); return }
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
 if (!canLab) { window.notifyFromLegacyAlert('Only doctors can order lab tests.'); return }
 if (labSelectedTests.length === 0) { window.notifyFromLegacyAlert('Select at least one test.'); return }
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
 ordered_at: new Date().toISOString(),
 }))

 const { error } = await supabase.from('lab_tests').insert(rows)
 if (error) { window.notifyFromLegacyAlert('Error saving tests: ' + error.message); setSaving(false); return }

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
  window.notifyFromLegacyAlert('Only pharmacists and admins can process pharmacy outcomes.')
  return
 }
 if (activeStatus === 'Admission Requested' && !canAdmit) {
  window.notifyFromLegacyAlert('Only doctors and nurses can process admissions.')
  return
 }
 if (activeStatus === 'Admitted' && !canDischarge) {
  window.notifyFromLegacyAlert('Only doctors, nurses and admins can discharge patients.')
  return
 }
 const { outcome, bed_id, ward_id, refer_department, refer_ward } = pharmaForm

 // Validate
 if (outcome === 'Admitted' && !bed_id) { window.notifyFromLegacyAlert('Please select a ward and a free bed to admit the patient.'); return }
 if (outcome === 'Referred' && !refer_department) { window.notifyFromLegacyAlert('Please select the referring department.'); return }

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
 if (error) { window.notifyFromLegacyAlert('Error updating visit: ' + error.message); setSaving(false); return }

 // ── 3. Mark related prescriptions as released when pharmacy action is complete ─────────
 if (visitPrescriptions.length > 0) {
 const pendingRx = visitPrescriptions.filter(rx => (rx.status || 'Pending') !== 'Released')
 const prescriptionIds = pendingRx.map(rx => rx.id)
 if (prescriptionIds.length > 0) {
 const { error: rxErr } = await supabase.from('prescriptions').update({
 status: 'Released',
 dispensed_at: new Date().toISOString(),
 }).in('id', prescriptionIds).eq('hospital_id', hospitalId)
 if (rxErr) { window.notifyFromLegacyAlert('Visit saved but prescriptions update failed: ' + rxErr.message) }
 }

 // ── 3a. Deduct stock for released prescriptions and log the dispense ───
 const dispensedAt = new Date().toISOString()
 const releasedServiceLines = []
 for (const rx of pendingRx) {
 const quantity = Number(rx.quantity || 1)
 const { data: stockItem, error: stockErr } = await supabase.from('pharmacy_inventory')
 .select('id,drug_name,quantity_in_stock,selling_price')
 .eq('hospital_id', hospitalId)
 .ilike('drug_name', rx.drug_name || '')
 .limit(1)
 .maybeSingle()
 if (stockErr) {
 console.error('Stock lookup failed for', rx.drug_name, stockErr)
 continue
 }
 if (!stockItem) {
 console.warn('No pharmacy inventory match for', rx.drug_name)
 continue
 }
 const unitPrice = Number(stockItem.selling_price || 0)
 const lineTotal = unitPrice * quantity
 const newQty = Math.max(0, Number(stockItem.quantity_in_stock || 0) - quantity)
 await supabase.from('pharmacy_inventory').update({ quantity_in_stock: newQty }).eq('id', stockItem.id)
 const dispenseLedgerPayload = {
 hospital_id: hospitalId,
 visit_id: showPharmacy.id,
 receipt_number: `RX-${rx.id?.slice(-8) || Date.now().toString(36).slice(-8)}`,
 drug_name: rx.drug_name,
 qty_sold: quantity,
 total_kes: lineTotal,
 payment_method: 'Internal Dispense',
 served_by: p.full_name || 'Pharmacy',
 notes: `Prescription dispense — Patient: ${p.full_name || 'patient'} | Visit: ${showPharmacy.visit_number || showPharmacy.id}`,
 sold_at: dispensedAt,
 }
 await executeWithFallback(
  () => supabase.from('sales_ledger').insert(dispenseLedgerPayload),
  async () => supabase.from('sales_ledger').insert(omitKeys(dispenseLedgerPayload, ['visit_id'])),
 )
 releasedServiceLines.push(createServiceLine({
  label: rx.drug_name || stockItem.drug_name || 'Dispensed drug',
  qty: quantity,
  unitPrice,
  total: lineTotal,
  source: SERVICE_SOURCES.PHARMACY,
  sourceId: rx.id || stockItem.id,
  visitId: showPharmacy.id,
  meta: { prescription_id: rx.id || null },
 }))
 releasedPharmacyAmount += lineTotal
 }

 if (releasedServiceLines.length > 0) {
 const mappedPaymentMethod = hasCoverage
  ? (isShaCoverage ? 'SHA (Social Health Authority)' : coverageName)
  : 'Cash'
 const invoicePayload = {
  hospital_id: hospitalId,
  patient_id: showPharmacy.patient_id,
  visit_id: showPharmacy.id,
  patient_name: p.full_name || showPharmacy.patient_name || 'Patient',
  invoice_no: `INV-${Date.now().toString().slice(-6)}`,
  services: stringifyServiceLines(releasedServiceLines),
  amount_kes: releasedPharmacyAmount,
  paid_kes: 0,
  balance_kes: releasedPharmacyAmount,
  payment_method: mappedPaymentMethod,
  insurer: hasCoverage ? (isShaCoverage ? 'SHA' : coverageName) : null,
  sha_member_no: isShaCoverage ? (p.insurance_number || p.sha_member_no || null) : null,
  status: 'Pending',
  notes: buildWorkflowInvoiceNote({
   source: SERVICE_SOURCES.PHARMACY,
   sourceId: showPharmacy.visit_number || showPharmacy.id,
   visitId: showPharmacy.id,
   summary: `Pharmacy release for ${showPharmacy.visit_number || showPharmacy.id}`,
  }),
  created_at: dispensedAt,
 }
 const { data: pharmacyInvoice, error: invoiceErr } = await supabase.from('invoices')
 .insert(invoicePayload)
 .select('id, invoice_no, amount_kes')
 .single()
 if (invoiceErr) {
  window.notifyFromLegacyAlert('Visit saved and drugs were dispensed, but billing invoice creation failed: ' + invoiceErr.message)
 } else {
  createdPharmacyInvoice = pharmacyInvoice
 }
 }
 }

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
 if (bedErr) { window.notifyFromLegacyAlert('Visit saved but bed assignment failed: ' + bedErr.message) }

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
} catch(e) { window.notifyFromLegacyAlert('Unexpected error: ' + e.message) }
 setSaving(false)
 }

 // ── filters ───────────────────────────────────────────────────────────────
 const statusCounts = {}
 STEPS.forEach(st => { statusCounts[st] = visits.filter(v => v.status === st).length })
 statusCounts['Admitted'] = visits.filter(v => v.status === 'Admitted').length
 statusCounts['All'] = visits.length

 const filteredVisits = visits.filter(v => {
 const name = (v.patients?.full_name || '').toLowerCase()
 const phone = v.patients?.phone || ''
 const vno = v.visit_number || ''
 const ok = !search || name.includes(search.toLowerCase()) || phone.includes(search) || vno.includes(search)
 return ok && (filterStatus === 'All' || v.status === filterStatus)
 })

 const filteredPatients = allPatients.filter(p =>
 p.full_name?.toLowerCase().includes(search.toLowerCase()) ||
 p.phone?.includes(search) || p.national_id?.includes(search)
 )

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
 <select style={s.rangeSelect} value={dateRange} onChange={e=>setDateRange(e.target.value)}>
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
 </div>
 </div>

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
 placeholder={view==='queue'?'Search name, phone, visit number...':'Search name, phone, national ID...'}
 value={search} onChange={e=>setSearch(e.target.value)}/>
 {search && <span style={s.clearBtn} onClick={()=>setSearch('')}></span>}
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
 {j<STEPS.length-1 && <div style={{width:14,height:1,background:done?'#9FE1CB':'#e0e0e0'}}/>}
 </div>
 )
 })}
 </div>

 {/* RIGHT: action buttons */}
 <div style={{display:'flex',gap:6,flexShrink:0,flexWrap:'wrap'}}>
 <button style={s.actionBtn} onClick={()=>setShowDetail(visit)}>View</button>

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
 filteredPatients.length===0
 ? <div style={s.empty}><div style={{fontSize:48}}>👥</div><div style={{fontSize:16,fontWeight:600,color:'#555',marginTop:12}}>No patients registered</div></div>
 : (
    <>
      <div style={s.tableWrap}>
      <table style={s.table}>
 <thead>
 <tr style={{background:'#f8f9fa'}}>
 {['Patient','Age/Gender','Phone','National ID','Blood Group','Insurance','Registered','Action'].map(h=>(
 <th key={h} style={s.th}>{h}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {filteredPatients.map((p,i)=>(
 <tr key={p.id} style={{borderBottom:'1px solid #f5f5f5',background:i%2===0?'#fff':'#fafafa'}}>
 <td style={s.td}>
 <div style={{display:'flex',alignItems:'center',gap:10}}>
 <div style={{...s.avatar,background:AVATAR_COLORS[i%AVATAR_COLORS.length]}}>{p.full_name?.charAt(0)?.toUpperCase()}</div>
 <div>
 <div style={s.patName}>{p.full_name}</div>
 {p.is_minor && <span style={{fontSize:10,color:'#1a6fb5',fontWeight:600}}> Minor</span>}
 {p.allergies && <div style={{fontSize:11,color:'#A32D2D'}}> {p.allergies}</div>}
 {p.chronic_conditions && <div style={{fontSize:11,color:'#C07000'}}> {p.chronic_conditions}</div>}
 </div>
 </div>
 </td>
 <td style={s.td}>{p.age||'—'} / {p.gender||'—'}</td>
 <td style={s.td}>{p.phone||'—'}</td>
 <td style={s.td}>{p.national_id||'—'}{p.guardian_id ? ` (Gdn: ${p.guardian_id})` : ''}</td>
 <td style={s.td}>{p.blood_group||'—'}</td>
 <td style={s.td}>{p.insurance||'—'}</td>
 <td style={s.td}>{p.created_at ? new Date(p.created_at).toLocaleDateString('en-KE') : '—'}</td>
 <td style={s.td}>
 <button
  style={{...s.actionBtn, ...(canRegister ? {} : s.btnDisabled)}}
  onClick={()=>selectReturningPatient(p)}
  disabled={!canRegister}
  title="Only receptionists, nurses and admins can register patients">
  New Visit
 </button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
 <div style={{ fontSize: 12, color: '#555' }}>
 {patientLoading ? 'Loading patient registry...' : `Showing ${allPatients.length} of ${patientTotal || 0} registered patients`}
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
 ))}

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
 <button style={s.closeBtn} onClick={()=>setShowSearchModal(false)}></button>
 </div>
 <div style={s.modalBody}>
 <div style={{display:'flex',gap:10,marginBottom:16}}>
 <input style={{...s.input,flex:1}} placeholder="Name, Phone, National ID, Guardian ID..."
 value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
 onKeyDown={e=>e.key==='Enter'&&handleSearch()} autoFocus/>
 <button style={s.primaryBtn} onClick={handleSearch} disabled={searching}>{searching?'...':' Search'}</button>
 </div>
 <div style={{background:'#E3F0FB',border:'1px solid #B3D4F0',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#1a6fb5',marginBottom:16}}>
 <strong>Minors</strong> — search by parent/guardian National ID or child's birth cert number
 </div>

 {searchDone && searchResults.length===0 && (
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
 <div style={{...s.avatar,background:'#E1F5EE',width:44,height:44,fontSize:18}}>{p.full_name?.charAt(0)?.toUpperCase()}</div>
 <div>
 <div style={{fontWeight:700,fontSize:15,color:'#111'}}>{p.full_name}</div>
 <div style={{fontSize:12,color:'#666',marginTop:3,display:'flex',gap:12,flexWrap:'wrap'}}>
 {p.age && <span>👤 {p.age}y {p.gender}</span>}
 {p.phone && <span>📞 {p.phone}</span>}
 {p.national_id && <span>🪪 {p.national_id}</span>}
 {p.is_minor && <span style={{color:'#1a6fb5',fontWeight:600}}> Minor</span>}
 {p.blood_group && <span> {p.blood_group}</span>}
 </div>
 {p.allergies && <div style={{fontSize:11,color:'#A32D2D',marginTop:3}}> {p.allergies}</div>}
 {p.chronic_conditions && <div style={{fontSize:11,color:'#C07000',marginTop:2}}> {p.chronic_conditions}</div>}
 {p.insurance && p.insurance!=='None' && <div style={{fontSize:11,color:'#0F6E56',marginTop:2}}> {p.insurance} {p.insurance_number&&`• ${p.insurance_number}`}</div>}
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

 {!searchDone && (
 <div style={{textAlign:'center',padding:20,color:'#ccc',fontSize:13}}>Enter details above and press Search or Enter</div>
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
 <h2 style={s.modalTitle}>{isReturning ? '🔄 Returning Patient' : ' New Patient Registration'}</h2>
 {!isReturning && (
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
 <button style={s.closeBtn} onClick={()=>setShowRegister(false)}></button>
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
 <Fld label="Full Name *"><input style={s.input} placeholder="e.g. Jane Wanjiku" value={regForm.full_name} onChange={e=>setRegForm({...regForm,full_name:e.target.value})}/></Fld>
 <Fld label={regForm.is_minor?'Birth Certificate No.':'National ID / Passport'}>
 <input style={s.input} placeholder={regForm.is_minor?'e.g. BC-2020-001234':'e.g. 12345678'} value={regForm.national_id} onChange={e=>setRegForm({...regForm,national_id:e.target.value})}/>
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
 <Fld label="Blood Group">
 <select style={s.input} value={regForm.blood_group} onChange={e=>setRegForm({...regForm,blood_group:e.target.value})}>
 <option value="">Unknown</option>
 {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(b=><option key={b}>{b}</option>)}
 </select>
 </Fld>
 <Fld label="Phone Number"><input style={s.input} placeholder="e.g. 0712345678" value={regForm.phone} onChange={e=>setRegForm({...regForm,phone:e.target.value})}/></Fld>
 <Fld label="Phone 2 (optional)"><input style={s.input} placeholder="e.g. 0700000000" value={regForm.phone2} onChange={e=>setRegForm({...regForm,phone2:e.target.value})}/></Fld>
 </div>
 <Fld label="Address"><input style={s.input} placeholder="e.g. Nairobi, Westlands" value={regForm.address} onChange={e=>setRegForm({...regForm,address:e.target.value})}/></Fld>
 <div style={s.grid2}>
 <Fld label="Known Allergies"><input style={s.input} placeholder="e.g. Penicillin, Aspirin" value={regForm.allergies} onChange={e=>setRegForm({...regForm,allergies:e.target.value})}/></Fld>
 <Fld label="Chronic Conditions"><input style={s.input} placeholder="e.g. Diabetes, Hypertension" value={regForm.chronic_conditions} onChange={e=>setRegForm({...regForm,chronic_conditions:e.target.value})}/></Fld>
 </div>

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

 <div style={s.sectionLabel}>Next of Kin</div>
 <div style={s.grid2}>
 <Fld label="Name"><input style={s.input} value={regForm.next_of_kin} onChange={e=>setRegForm({...regForm,next_of_kin:e.target.value})}/></Fld>
 <Fld label="Relationship">
 <select style={s.input} value={regForm.next_of_kin_relationship} onChange={e=>setRegForm({...regForm,next_of_kin_relationship:e.target.value})}>
 <option value="">-- Select --</option>
 {['Spouse','Parent','Child','Sibling','Friend','Guardian','Other'].map(r=><option key={r}>{r}</option>)}
 </select>
 </Fld>
 <Fld label="Phone"><input style={s.input} value={regForm.next_of_kin_phone} onChange={e=>setRegForm({...regForm,next_of_kin_phone:e.target.value})}/></Fld>
 </div>

 <div style={s.sectionLabel}>Insurance (Optional)</div>
 <div style={s.grid2}>
 <Fld label="Insurance Provider">
 <select style={s.input} value={regForm.insurance} onChange={e=>setRegForm({...regForm,insurance:e.target.value})}>
 <option value="">None</option>
 {['SHA','NHIF','AAR','Jubilee Insurance','CIC Insurance','Resolution Insurance','Britam','Madison Insurance','Other'].map(ins=><option key={ins}>{ins}</option>)}
 </select>
 </Fld>
 <Fld label="Member / Card Number"><input style={s.input} placeholder="e.g. SHA-1234567" value={regForm.insurance_number} onChange={e=>setRegForm({...regForm,insurance_number:e.target.value})}/></Fld>
 </div>
 </>
 )}

 {/* ─ STEP 2: Visit & Payment ─ */}
 {(regStep===2 || isReturning) && (
 <>
 {/* Patient summary */}
 <div style={{...s.summaryCard,background:isReturning?'#E1F5EE':'#f9fafb',border:isReturning?'1px solid #9FE1CB':'1px solid #eee',marginBottom:16}}>
 <div style={{display:'flex',alignItems:'center',gap:12}}>
 <div style={{...s.avatar,width:44,height:44,fontSize:18,background:'#E1F5EE'}}>
 {(selectedPatient?.full_name||regForm.full_name)?.charAt(0)?.toUpperCase()}
 </div>
 <div>
 <div style={{fontWeight:700,fontSize:15}}>{selectedPatient?.full_name||regForm.full_name}</div>
 <div style={{fontSize:13,color:'#666',marginTop:3}}>
 {(selectedPatient?.age||regForm.age)&&`${selectedPatient?.age||regForm.age}y`}
 {(selectedPatient?.gender||regForm.gender)&&` • ${selectedPatient?.gender||regForm.gender}`}
 {(selectedPatient?.phone||regForm.phone)&&` • ${selectedPatient?.phone||regForm.phone}`}
 </div>
 {(selectedPatient?.allergies||regForm.allergies) && <div style={{fontSize:11,color:'#A32D2D',marginTop:3}}> {selectedPatient?.allergies||regForm.allergies}</div>}
 {(selectedPatient?.insurance||regForm.insurance) && (selectedPatient?.insurance||regForm.insurance)!=='None' && <div style={{fontSize:11,color:'#0F6E56',marginTop:2}}> {selectedPatient?.insurance||regForm.insurance}</div>}
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
 <option>Cash</option><option>M-Pesa</option><option>Insurance</option><option>SHA</option>
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
 {saving?'Saving...':' Confirm & Print Receipt'}
 </button>
 </>
 : <>
 <button style={s.cancelBtn} onClick={()=>setShowRegister(false)}>Cancel</button>
 <button style={s.primaryBtn} onClick={()=>{if(!regForm.full_name){window.notifyFromLegacyAlert('Full name required');return}setRegStep(2)}}>
 Next: Visit & Payment →
 </button>
 </>
 }
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
 <button style={s.closeBtn} onClick={()=>setShowVitals(null)}></button>
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
 <button style={s.closeBtn} onClick={()=>setShowDoctor(null)}></button>
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
 <button style={s.closeBtn} onClick={()=>setShowLab(null)}></button>
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
 <span key={t.test_name} style={{background:'#E1F5EE',color:'#0F6E56',border:'1px solid #9FE1CB',
 borderRadius:99,padding:'4px 10px',fontSize:12,fontWeight:500,display:'flex',alignItems:'center',gap:6}}>
 {t.test_name}
 <span style={{cursor:'pointer',fontWeight:700,color:'#A32D2D'}}
 onClick={()=>setLabSelectedTests(prev=>prev.filter(x=>x.test_name!==t.test_name))}>×</span>
 </span>
 ))}
 </div>
 </div>
 )}

 <div style={{background:'#F0EAFC',border:'1px solid #D4B8F4',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#7B5EA7',marginTop:14}}>
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
 <button style={s.closeBtn} onClick={()=>setShowPharmacy(null)}></button>
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
 <div style={{background:'#EAF3DE',border:'1px solid #9FE1CB',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#3B6D11'}}>
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
 <div style={{...s.modal,maxWidth:600}} onClick={e=>e.stopPropagation()}>
 <div style={s.modalHeader}>
 <h2 style={s.modalTitle}>Visit Details — {showDetail.patients?.full_name}</h2>
 <button style={s.closeBtn} onClick={()=>setShowDetail(null)}></button>
 </div>
 <div style={s.modalBody}>
 {/* Journey */}
 <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
 {STEPS.map((st,j)=>{
 const idx = STEPS.indexOf(showDetail.status)
 const done=j<idx, active=j===idx
 const sc = STEP_COLORS[st]
 return <div key={st} style={{padding:'4px 12px',borderRadius:99,fontSize:12,fontWeight:600,
 background:active?sc.bg:done?'#E1F5EE':'#f5f5f5',
 color:active?sc.color:done?'#0F6E56':'#bbb',
 border:active?`1px solid ${sc.color}`:'none'}}>
 {done?' ':active?'● ':''}{st}
 </div>
 })}
 </div>

 <div style={s.sectionLabel}>Visit Info</div>
 <div style={s.viewGrid}>
 {[
 ['Visit No.',showDetail.visit_number],
 ['Type',showDetail.visit_type],
 ['Priority',showDetail.priority],
 ['Status',showDetail.status],
 ['Chief Complaint',showDetail.chief_complaint],
 ['Doctor',showDetail.assigned_doctor_name?`Dr. ${showDetail.assigned_doctor_name}`:'—'],
 ['Referred To',showDetail.outcome==='Referred' && showDetail.assigned_doctor_name ? `Dr. ${showDetail.assigned_doctor_name}${showDetail.speciality ? ` — ${showDetail.speciality}` : ''}` : '—'],
 ['Speciality',showDetail.speciality||'—'],
 ['Doctor Notes',showDetail.doctor_notes||'—'],
 ['Fee Paid',`KES ${parseFloat(showDetail.admission_fee||0).toLocaleString()}`],
 ['Payment',showDetail.admission_payment_method],
 ['Time',showDetail.created_at?new Date(showDetail.created_at).toLocaleString('en-KE'):'—'],
 ['Outcome',showDetail.outcome||'—'],
 ['Ward/Bed',showDetail.ward?`${showDetail.ward} / ${showDetail.bed_no||'—'}`:'—'],
 ].map(([l,v])=>(
 <div key={l} style={s.viewRow}>
 <div style={s.viewLabel}>{l}</div>
 <div style={s.viewVal}>{v||'—'}</div>
 </div>
 ))}
 </div>

 <div style={{...s.sectionLabel,marginTop:16}}>Patient Info</div>
 <div style={s.viewGrid}>
 {[
 ['Age',showDetail.patients?.age],
 ['Gender',showDetail.patients?.gender],
 ['Phone',showDetail.patients?.phone],
 ['Blood Group',showDetail.patients?.blood_group],
 ['Allergies',showDetail.patients?.allergies],
 ['Chronic Conditions',showDetail.patients?.chronic_conditions],
 ['Insurance',showDetail.patients?.insurance],
 ['Minor',showDetail.patients?.is_minor?'Yes':'No'],
 ].map(([l,v])=>(
 <div key={l} style={s.viewRow}>
 <div style={s.viewLabel}>{l}</div>
 <div style={s.viewVal}>{v||'—'}</div>
 </div>
 ))}
 </div>

 {showDetail.prescription && (
 <>
 <div style={{...s.sectionLabel,marginTop:16}}>Prescription</div>
 <div style={{background:'#f9fafb',border:'1px solid #eee',borderRadius:8,padding:'12px 14px',fontSize:13,color:'#333',whiteSpace:'pre-wrap'}}>
 {showDetail.prescription}
 </div>
 </>
 )}
 </div>
 <div style={s.modalFooter}>
 <button style={s.cancelBtn} onClick={()=>setShowDetail(null)}>Close</button>
 <button style={{...s.primaryBtn,background:'#555'}} onClick={() => {
   if (!canPrint) {
     window.notifyFromLegacyAlert('Only billing-authorized users can print receipts.')
     return
   }
   printReceipt(hospitalName, hospitalId, showDetail.patients||{}, {
     visit_number:showDetail.visit_number, visit_type:showDetail.visit_type,
     admission_fee:showDetail.admission_fee, payment_method:showDetail.admission_payment_method,
     mpesa_ref:showDetail.mpesa_ref
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
function Fld({label,children}) {
 return (
 <div style={{marginBottom:14}}>
 <label style={{fontSize:12,color:'#666',display:'block',marginBottom:5,fontWeight:500}}>{label}</label>
 {children}
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
 btnDisabled: { opacity:0.5, cursor:'not-allowed' },
 btnOrange: { background:'#FFF3DC', color:'#C07000', border:'1px solid #FAC775' },
 btnPurple: { background:'#F0EAFC', color:'#7B5EA7', border:'1px solid #D4B8F4' },
 btnRed: { background:'#FCEBEB', color:'#A32D2D', border:'1px solid #f5c6cb' },
 btnGreen: { background:'#E1F5EE', color:'#0F6E56', border:'1px solid #9FE1CB' },
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
 sectionLabel:{ fontSize:11, fontWeight:700, color:'#0F6E56', textTransform:'uppercase', letterSpacing:.8, marginBottom:12, marginTop:4, paddingBottom:6, borderBottom:'1px solid #E1F5EE' },
 cancelBtn: { padding:'10px 20px', border:'1px solid #ddd', borderRadius:8, background:'#fff', cursor:'pointer', fontSize:14, fontWeight:500, color:'#555' },
 summaryCard:{ borderRadius:10, padding:14, background:'#f9fafb', border:'1px solid #eee' },
 resultCard: { background:'#fff', border:'1px solid #e0e0e0', borderRadius:10, padding:'14px 16px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, transition:'border .15s' },
 viewGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:0 },
 viewRow: { padding:'10px 0', borderBottom:'1px solid #f5f5f5' },
 viewLabel: { fontSize:11, color:'#888', fontWeight:600, textTransform:'uppercase', letterSpacing:.4, marginBottom:3 },
 viewVal: { fontSize:13, color:'#111', fontWeight:500 },
}
