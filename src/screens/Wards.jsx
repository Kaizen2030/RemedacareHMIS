import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import supabase from '../supabase'
import { useHospital } from '../context'
import { canPerformAction } from '../access'
import { buildWorkflowInvoiceNote, createServiceLine, inferInvoiceSource, SERVICE_SOURCES, stringifyServiceLines } from '../utils/workflowBilling'
import WardOverview from './wards/WardOverview'
import WardBedGrid from './wards/WardBedGrid'
import WardBedPanel from './wards/WardBedPanel'

const WARD_TYPES = ['General', 'ICU', 'Maternity', 'Paediatrics', 'Surgical', 'Cardiac', 'Orthopaedic', 'Oncology', 'Emergency', 'Psychiatric', 'Private', 'Radiology', 'Dental', 'Cardiology', 'Eye', 'Mental Health', 'Physiotherapy', 'Nutrition', 'Community Health']
const WARD_ICONS = { ICU: 'ICU', Maternity: 'MAT', General: 'GEN', Paediatrics: 'PEDS', Surgical: 'SURG', Cardiac: 'CARD', Orthopaedic: 'ORTHO', Oncology: 'ONC', Emergency: 'ER', Psychiatric: 'MH', Private: 'PVT', Radiology: 'RAD', Dental: 'DENT', Cardiology: 'CARD', Eye: 'EYE', 'Mental Health': 'MH', Physiotherapy: 'PT', Nutrition: 'NUT', 'Community Health': 'CH' }
const BED_COLORS = {
 Free: { bg: '#E1F5EE', border: '#9FE1CB', color: '#0F6E56' },
 Occupied: { bg: '#FDEAEA', border: '#F3A6A6', color: '#A32D2D' },
 Critical: { bg: '#FAD6D6', border: '#E07272', color: '#7F1D1D' },
 Reserved: { bg: '#FFF3DC', border: '#FAC775', color: '#C07000' },
 Maintenance: { bg: '#EEF1F4', border: '#C6CDD5', color: '#667085' },
}
const BEDS_PER_PAGE = 60
const ADMISSION_TYPES = ['Elective', 'Emergency', 'Transfer from another facility']
const RESUSCITATION_OPTIONS = ['Full', 'DNR']
const ROUND_CONDITIONS = ['Improving', 'Stable', 'Deteriorating']
const BED_REQUEST_PRIORITIES = ['Routine', 'Urgent', 'Emergency']
const OVERVIEW_TABS = ['operations', 'analytics']

function formatKES(value) {
 return `KES ${Number(value || 0).toLocaleString()}`
}

function escapeHtml(value) {
 return String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')
}

function matchesLabInvoice(invoice, test) {
 if (!invoice || !test) return false
 const haystack = `${invoice.services || ''} ${invoice.notes || ''}`.toLowerCase()
 return invoice.visit_id === test.visit_id && haystack.includes(String(test.test_type || '').toLowerCase())
}

const INTAKE_TYPES = ['Oral Intake', 'IV Fluid', 'Blood']
const OUTPUT_TYPES = ['Urine Output', 'Drain Output', 'Vomit', 'Other']
const NURSING_NOTE_TYPES = ['General', 'Medication', 'Procedure', 'Handover', 'Incident']
const FLUID_ENTRY_TYPES = [...INTAKE_TYPES, ...OUTPUT_TYPES]

function getCurrentUserDisplayName(user) {
 const meta = user?.user_metadata || {}
 return meta.full_name || meta.name || user?.email || 'Current Nurse'
}

function isIntakeEntry(type) {
 return INTAKE_TYPES.includes(type)
}

function isShaPatientRecord(patient, visit) {
 const insurance = `${patient?.payment_method || ''} ${visit?.payment_method || ''} ${patient?.insurer_name || ''}`.toLowerCase()
 return insurance.includes('sha') || Boolean(patient?.sha_member_no || patient?.sha_number || patient?.sha_member_number)
}

function formatDateTime(value) {
 if (!value) return '—'
 return new Date(value).toLocaleString('en-KE')
}

function formatDateOnly(value) {
 if (!value) return '—'
 return new Date(value).toLocaleDateString('en-KE')
}

function differenceInDays(from, to = new Date()) {
 if (!from) return null
 return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24))
}

function getLengthOfStayFlag(days) {
 if (days == null || days < 7) return null
 if (days >= 14) return { label: 'Discharge board review', bg: '#FCEBEB', color: '#A32D2D' }
 return { label: 'Senior review due', bg: '#FFF3DC', color: '#C07000' }
}

function readmissionWithin30Days(admission, admissions) {
 if (!admission?.patient_id || !admission?.admission_date) return false
 const currentStart = new Date(admission.admission_date).getTime()
 return admissions.some((item) => {
  if (item.id === admission.id || item.patient_id !== admission.patient_id || !item.discharge_date) return false
  const priorDischarge = new Date(item.discharge_date).getTime()
  const diff = currentStart - priorDischarge
  return diff > 0 && diff <= (30 * 24 * 60 * 60 * 1000)
 })
}

export default function Wards() {
 const { hospitalId, hospitalName, userRole, navigate } = useHospital()
 const canManageWards = canPerformAction(userRole, 'create_department')
 const canAdmitPatient = canPerformAction(userRole, 'admit_patient')
 const canDischarge = canPerformAction(userRole, 'discharge_patient')
 const canTransfer = canPerformAction(userRole, 'admit_patient')
 const isAdmin = ['admin', 'Admin'].includes(userRole)
 const canSetDnr = isAdmin || /doctor|medical|clinical officer|consultant/i.test(String(userRole || ''))
 const [wards, setWards] = useState([])
 const [beds, setBeds] = useState([])
 const [transfers, setTransfers] = useState([])
 const [admissions, setAdmissions] = useState([])
 const [bedRequests, setBedRequests] = useState([])
 const [wardRounds, setWardRounds] = useState([])
 const [loading, setLoading] = useState(true)
 const [saving, setSaving] = useState(false)

 // Navigation
 const [view, setView] = useState('overview') // overview | ward
 const [overviewTab, setOverviewTab] = useState('operations')
 const [selectedWard, setSelectedWard] = useState(null)

 // Bed page & search
 const [bedPage, setBedPage] = useState(1)
 const [bedSearch, setBedSearch] = useState('')
 const [bedFilter, setBedFilter] = useState('All')

 // Selected bed side panel
 const [selectedBed, setSelectedBed] = useState(null)
 const [bedPatient, setBedPatient] = useState(null)
 const [bedVisit, setBedVisit] = useState(null)
 const [bedAdmission, setBedAdmission] = useState(null)
 const [bedVitals, setBedVitals] = useState(null)
 const [bedVitalsTrend, setBedVitalsTrend] = useState([])
 const [bedConsultations, setBedConsultations] = useState([])
 const [bedWorkflow, setBedWorkflow] = useState({ invoices: [], labTests: [], prescriptions: [] })
 const [bedNursingNotes, setBedNursingNotes] = useState([])
 const [bedFluidBalance, setBedFluidBalance] = useState([])
 const [bedRoundNotes, setBedRoundNotes] = useState([])
 const [bedFollowUps, setBedFollowUps] = useState([])
 const [bedPanelTab, setBedPanelTab] = useState('overview')
 const [currentUserName, setCurrentUserName] = useState('Current Nurse')

 // Modals
 const [showAddWard, setShowAddWard] = useState(false)
 const [showAddBeds, setShowAddBeds] = useState(false)
 const [showTransfer, setShowTransfer] = useState(false)
 const [showDischarge, setShowDischarge] = useState(false)
 const [showVitalsShortcut, setShowVitalsShortcut] = useState(false)
 const [showAdmitModal, setShowAdmitModal] = useState(false)
 const [showRoundModal, setShowRoundModal] = useState(false)

 // Forms
 const [wardForm, setWardForm] = useState({ name: '', ward_type: 'General', floor: '', description: '' })
 const [bedGenForm, setBedGenForm] = useState({ prefix: '', start: 1, end: 10 })
 const [transferForm, setTransferForm] = useState({ to_ward_id: '', to_bed_id: '', requested_by: '', reason: '' })
 const [admitForm, setAdmitForm] = useState({
  patient_id: '',
  visit_id: '',
  patient_name: '',
  sha_number: '',
  admission_type: 'Elective',
  referring_doctor: '',
  referring_facility: '',
  sha_preauth_number: '',
  expected_length_of_stay: '',
  allergies_review: '',
  resuscitation_status: 'Full',
  isolation_required: false,
  request_id: '',
 })
 const [dischargeForm, setDischargeForm] = useState({
  discharge_notes: '',
  discharge_instructions: '',
  condition_on_discharge: 'Improved',
  doctor_note_written: false,
  discharge_prescriptions_written: false,
  bill_settled: false,
  discharge_summary_printed: false,
  follow_up_appointment_booked: false,
  override_reason: '',
 })
 const [roundForm, setRoundForm] = useState({
  current_condition: 'Stable',
  plan_for_today: '',
  target_discharge_date: '',
  clinician_name: '',
  note_date: new Date().toISOString().slice(0, 16),
 })
 const [nursingForm, setNursingForm] = useState({
  nurse_name: 'Current Nurse',
  note_type: 'General',
  note_text: '',
  created_at: new Date().toISOString().slice(0, 16),
 })
 const [fluidForm, setFluidForm] = useState({
  entry_type: 'Oral Intake',
  volume_ml: '',
  fluid_description: '',
  recorded_at: new Date().toISOString().slice(0, 16),
  recorded_by: 'Current Nurse',
 })
 const [vitalsShortcutForm, setVitalsShortcutForm] = useState({
  weight_kg:'', height_cm:'', bp_systolic:'', bp_diastolic:'',
  pulse_bpm:'', temperature_c:'', oxygen_sat:'', respiratory_rate:'',
  blood_sugar:'', recorded_by:'',
 })

 useEffect(() => {
 if (!hospitalId) { setLoading(false); return undefined }
 fetchAll()

 const localHandler = () => fetchAll()
 const channel = supabase
 .channel(`wards-live-${hospitalId}`)
 .on('postgres_changes', { event: '*', schema: 'public', table: 'wards', filter: `hospital_id=eq.${hospitalId}` }, () => fetchAll())
 .on('postgres_changes', { event: '*', schema: 'public', table: 'beds', filter: `hospital_id=eq.${hospitalId}` }, () => fetchAll())
 .on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `hospital_id=eq.${hospitalId}` }, () => fetchAll())
 .on('postgres_changes', { event: '*', schema: 'public', table: 'admissions', filter: `hospital_id=eq.${hospitalId}` }, () => fetchAll())
 .on('postgres_changes', { event: '*', schema: 'public', table: 'ward_bed_requests', filter: `hospital_id=eq.${hospitalId}` }, () => fetchAll())
 .on('postgres_changes', { event: '*', schema: 'public', table: 'ward_round_notes', filter: `hospital_id=eq.${hospitalId}` }, () => selectedBed?.id ? selectBed(selectedBed) : fetchAll())
 .on('postgres_changes', { event: '*', schema: 'public', table: 'nursing_notes', filter: `hospital_id=eq.${hospitalId}` }, () => selectedBed?.id ? selectBed(selectedBed) : fetchAll())
 .on('postgres_changes', { event: '*', schema: 'public', table: 'fluid_balance', filter: `hospital_id=eq.${hospitalId}` }, () => selectedBed?.id ? selectBed(selectedBed) : fetchAll())
 .subscribe()

 window.addEventListener('remedacare:workflow_changed', localHandler)

 return () => {
  window.removeEventListener('remedacare:workflow_changed', localHandler)
  try { supabase.removeChannel(channel) } catch (_) {}
 }
 }, [hospitalId])

 useEffect(() => {
  let mounted = true
  supabase.auth.getUser().then(({ data }) => {
   if (!mounted) return
   const nextName = getCurrentUserDisplayName(data?.user)
   setCurrentUserName(nextName)
   setNursingForm(prev => ({ ...prev, nurse_name: prev.nurse_name === 'Current Nurse' ? nextName : prev.nurse_name }))
   setFluidForm(prev => ({ ...prev, recorded_by: prev.recorded_by === 'Current Nurse' ? nextName : prev.recorded_by }))
   setVitalsShortcutForm(prev => ({ ...prev, recorded_by: prev.recorded_by || nextName }))
   setRoundForm(prev => ({ ...prev, clinician_name: prev.clinician_name || nextName }))
  }).catch(() => {})
  return () => { mounted = false }
 }, [])

 async function fetchAll() {
 setLoading(true)
 const [{ data: w }, { data: b }, { data: t }, { data: a }, { data: requests }, { data: rounds }] = await Promise.all([
 supabase.from('wards').select('*').eq('hospital_id', hospitalId).order('created_at'),
 supabase.from('beds').select('*, patients(*), visits(*)').eq('hospital_id', hospitalId),
 supabase.from('bed_transfers').select('*, patients(full_name)').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(20),
 supabase.from('admissions').select('*').eq('hospital_id', hospitalId).order('admission_date', { ascending: false }).limit(500),
 supabase.from('ward_bed_requests').select('*, patients(*), visits(*)').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(200),
 supabase.from('ward_round_notes').select('*').eq('hospital_id', hospitalId).order('note_date', { ascending: false }).limit(500),
 ])
 setWards(w || [])
 setBeds(b || [])
 setTransfers(t || [])
 setAdmissions(a || [])
 setBedRequests(requests || [])
 setWardRounds(rounds || [])
 setLoading(false)
 }

async function selectBed(bed) {
 setSelectedBed(bed)
 setBedPanelTab('overview')
 if (!bed.patient_id) {
  setBedPatient(null); setBedVisit(null); setBedAdmission(null); setBedVitals(null); setBedVitalsTrend([]); setBedConsultations([]); setBedWorkflow({ invoices: [], labTests: [], prescriptions: [] }); setBedNursingNotes([]); setBedFluidBalance([]); setBedRoundNotes([]); setBedFollowUps([])
  return
 }
 const [
  { data: v },
  { data: admission },
  { data: vit },
  { data: allVitals },
  { data: consults },
  { data: invoices },
  { data: labTests },
  { data: prescriptions },
  { data: roundNotes },
  { data: appointments },
  nursingNotesResult,
  fluidBalanceResult,
 ] = await Promise.all([
 supabase.from('visits').select('*').eq('id', bed.visit_id).maybeSingle(),
 supabase.from('admissions').select('*').eq('hospital_id', hospitalId).eq('visit_id', bed.visit_id).order('admission_date', { ascending: false }).limit(1).maybeSingle(),
 supabase.from('vitals').select('*').eq('visit_id', bed.visit_id).order('recorded_at', { ascending: false }).limit(1).maybeSingle(),
 supabase.from('vitals').select('*').eq('visit_id', bed.visit_id).order('recorded_at', { ascending: false }).limit(24),
 supabase.from('consultations').select('*').eq('patient_id', bed.patient_id).order('created_at', { ascending: false }).limit(20),
 supabase.from('invoices').select('*').eq('hospital_id', hospitalId).eq('visit_id', bed.visit_id).order('created_at', { ascending: false }),
 supabase.from('lab_tests').select('*').eq('hospital_id', hospitalId).eq('visit_id', bed.visit_id).order('ordered_at', { ascending: false }),
 supabase.from('prescriptions').select('*').eq('hospital_id', hospitalId).eq('visit_id', bed.visit_id).order('created_at', { ascending: false }),
 supabase.from('ward_round_notes').select('*').eq('hospital_id', hospitalId).eq('visit_id', bed.visit_id).order('note_date', { ascending: false }),
 supabase.from('appointments').select('*').eq('hospital_id', hospitalId).eq('patient_id', bed.patient_id).order('appointment_date', { ascending: false }).limit(10),
 supabase.from('nursing_notes').select('*').eq('hospital_id', hospitalId).eq('bed_id', bed.id).eq('visit_id', bed.visit_id).order('created_at', { ascending: false }),
 supabase.from('fluid_balance').select('*').eq('hospital_id', hospitalId).eq('bed_id', bed.id).eq('visit_id', bed.visit_id).order('recorded_at', { ascending: false }),
 ])
 setBedPatient(bed.patients)
 setBedVisit(v)
 setBedAdmission(admission)
 setBedVitals(vit)
 setBedVitalsTrend(allVitals || [])
 setBedConsultations(consults || [])
 setBedWorkflow({ invoices: invoices || [], labTests: labTests || [], prescriptions: prescriptions || [] })
 setBedRoundNotes(roundNotes || [])
 setBedFollowUps(appointments || [])
 setBedNursingNotes(nursingNotesResult?.error ? [] : (nursingNotesResult?.data || []))
 setBedFluidBalance(fluidBalanceResult?.error ? [] : (fluidBalanceResult?.data || []))
 setDischargeForm(prev => ({
  ...prev,
  discharge_notes: admission?.discharge_summary_notes || admission?.discharge_notes || prev.discharge_notes,
  doctor_note_written: Boolean(admission?.discharge_doctor_note_written || admission?.discharge_notes || admission?.discharge_summary_notes),
  discharge_prescriptions_written: Boolean(admission?.discharge_prescriptions_written || (prescriptions || []).length),
  bill_settled: Boolean(admission?.discharge_bill_settled),
  discharge_summary_printed: Boolean(admission?.discharge_summary_printed),
  follow_up_appointment_booked: Boolean(admission?.follow_up_appointment_booked || (appointments || []).some(item => ['Scheduled', 'Confirmed'].includes(item.status))),
  override_reason: admission?.discharge_override_reason || '',
 }))
 setRoundForm({
  current_condition: roundNotes?.[0]?.current_condition || 'Stable',
  plan_for_today: '',
  target_discharge_date: admission?.target_discharge_date || roundNotes?.[0]?.target_discharge_date || '',
  clinician_name: currentUserName,
  note_date: new Date().toISOString().slice(0, 16),
 })
 if (admission) {
  setAdmitForm(prev => ({
   ...prev,
   patient_id: admission.patient_id || bed.patient_id || '',
   visit_id: admission.visit_id || bed.visit_id || '',
   patient_name: bed.patients?.full_name || '',
   sha_number: bed.patients?.sha_member_no || bed.patients?.sha_number || '',
   admission_type: admission.admission_type || 'Elective',
   referring_doctor: admission.referring_doctor || '',
   referring_facility: admission.referring_facility || '',
   sha_preauth_number: admission.sha_preauth_number || '',
   expected_length_of_stay: admission.expected_los_days || '',
   allergies_review: admission.allergies_review || bed.patients?.allergies || '',
   resuscitation_status: admission.resuscitation_status || 'Full',
   isolation_required: Boolean(admission.isolation_required),
  }))
 }
 setNursingForm({
  nurse_name: currentUserName,
  note_type: 'General',
  note_text: '',
  created_at: new Date().toISOString().slice(0, 16),
 })
 setFluidForm({
  entry_type: 'Oral Intake',
  volume_ml: '',
  fluid_description: '',
  recorded_at: new Date().toISOString().slice(0, 16),
  recorded_by: currentUserName,
 })
 }

 async function handleAddWard() {
 if (!canManageWards) { window.notifyFromLegacyAlert('Only admins can create wards.'); return }
 if (!wardForm.name) { window.notifyFromLegacyAlert('Ward name required'); return }
 setSaving(true)
 await supabase.from('wards').insert({ ...wardForm, hospital_id: hospitalId })
 setShowAddWard(false)
 setWardForm({ name: '', ward_type: 'General', floor: '', description: '' })
 fetchAll()
 setSaving(false)
 }

 async function handleGenerateBeds() {
 if (!canManageWards) { window.notifyFromLegacyAlert('Only admins can add beds to wards.'); return }
 if (!selectedWard) return
 const { prefix, start, end } = bedGenForm
 if (!prefix || end < start) { window.notifyFromLegacyAlert('Check prefix and range'); return }
 if (end - start > 499) { window.notifyFromLegacyAlert('Max 500 beds at once'); return }
 setSaving(true)
 const rows = []
 for (let i = parseInt(start); i <= parseInt(end); i++) {
 rows.push({ hospital_id: hospitalId, ward_id: selectedWard.id, bed_number: `${prefix}${String(i).padStart(2, '0')}`, status: 'Free' })
 }
 await supabase.from('beds').insert(rows)
 // update ward total_beds
 const wardBeds = beds.filter(b => b.ward_id === selectedWard.id).length + rows.length
 await supabase.from('wards').update({ total_beds: wardBeds }).eq('id', selectedWard.id)
 setShowAddBeds(false)
 setBedGenForm({ prefix: '', start: 1, end: 10 })
 fetchAll()
 setSaving(false)
 }

 async function handleTransfer() {
 if (!canTransfer) { window.notifyFromLegacyAlert('Only doctors and nurses can transfer admitted patients.'); return }
 if (!transferForm.to_bed_id || !transferForm.requested_by) { window.notifyFromLegacyAlert('Select target bed and enter requester name'); return }
 setSaving(true)
 const targetBed = beds.find(b => b.id === transferForm.to_bed_id)
 await supabase.from('bed_transfers').insert({
 hospital_id: hospitalId,
 patient_id: selectedBed.patient_id,
 from_bed_id: selectedBed.id,
 to_bed_id: transferForm.to_bed_id,
 from_ward: selectedWard?.name || '',
 to_ward: wards.find(w => w.id === transferForm.to_ward_id)?.name || '',
 requested_by: transferForm.requested_by,
 reason: transferForm.reason,
 status: 'Pending',
 })
 setShowTransfer(false)
 setTransferForm({ to_ward_id: '', to_bed_id: '', requested_by: '', reason: '' })
 try {
  window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: selectedBed?.visit_id || null, source: 'bed-transfer-requested' } }))
 } catch (e) {}
 fetchAll()
 setSaving(false)
 }

async function handleApproveTransfer(transfer) {
 if (!canTransfer) { window.notifyFromLegacyAlert('Only doctors and nurses can approve bed transfers.'); return }
 setSaving(true)
 // move patient to new bed, free old bed
 await supabase.from('beds').update({ status: 'Free', patient_id: null, visit_id: null, admitted_at: null }).eq('id', transfer.from_bed_id)
 const fromBed = beds.find(b => b.id === transfer.from_bed_id)
 await supabase.from('beds').update({ status: fromBed?.status === 'Critical' ? 'Critical' : 'Occupied', patient_id: transfer.patient_id, visit_id: fromBed?.visit_id, admitted_at: fromBed?.admitted_at }).eq('id', transfer.to_bed_id)
 await supabase.from('bed_transfers').update({ status: 'Approved' }).eq('id', transfer.id)
 setSelectedBed(null)
 try {
  window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: fromBed?.visit_id || null, source: 'bed-transfer-approved' } }))
 } catch (e) {}
 fetchAll()
 setSaving(false)
 }

async function autoCreateBedChargeInvoice({ bed, wardType, hospitalId }) {
  try {
    // Check if a bed invoice already exists for this admission
    const { data: existing } = await supabase
      .from('invoices')
      .select('id')
      .eq('hospital_id', hospitalId)
      .eq('visit_id', bed.visit_id)
      .ilike('notes', `WF|${SERVICE_SOURCES.WARD}|%`)
      .maybeSingle()

    if (existing) return // already billed

    // Calculate nights stayed
    const admittedAt = bed.admitted_at ? new Date(bed.admitted_at) : new Date()
    const dischargedAt = new Date()
    const msPerNight = 24 * 60 * 60 * 1000
    const nights = Math.max(1, Math.ceil((dischargedAt - admittedAt) / msPerNight))

    // Map ward type → charge code
    const wt = (wardType || '').toLowerCase()
    let chargeCode = 'BED-GENERAL'
    if (wt.includes('icu') || wt.includes('hdu') || wt.includes('critical')) chargeCode = 'BED-ICU'
    else if (wt.includes('matern')) chargeCode = 'BED-MATERNITY'
    else if (wt.includes('private')) chargeCode = 'BED-PRIVATE'

    // Fetch price from charge_codes
    const { data: cc } = await supabase
      .from('charge_codes')
      .select('id, unit_price_kes, name')
      .eq('hospital_id', hospitalId)
      .eq('code', chargeCode)
      .maybeSingle()

    const nightlyRate = cc?.unit_price_kes || 2500
    const amount = nightlyRate * nights
    const serviceLabel = `${cc?.name || 'General Ward'} × ${nights} night${nights !== 1 ? 's' : ''}`
    const patientName = bed.patients?.full_name || ''

    await supabase.from('invoices').insert({
      hospital_id: hospitalId,
      patient_id: bed.patient_id,
      patient_name: patientName,
      visit_id: bed.visit_id,
      invoice_no: `INV-${Date.now().toString().slice(-6)}`,
      services: stringifyServiceLines([createServiceLine({
        label: serviceLabel,
        qty: nights,
        unitPrice: nightlyRate,
        total: amount,
        source: SERVICE_SOURCES.WARD,
        sourceId: bed.id,
        visitId: bed.visit_id,
        meta: { ward_type: wardType, charge_code: chargeCode, nights },
      })]),
      amount_kes: amount,
      paid_kes: 0,
      balance_kes: amount,
      payment_method: 'Cash',
      status: 'Pending',
      notes: buildWorkflowInvoiceNote({
        source: SERVICE_SOURCES.WARD,
        sourceId: bed.id,
        visitId: bed.visit_id,
        summary: serviceLabel,
      }),
    })

    window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', {
      detail: { visit_id: bed.visit_id, source: 'ward-bed-charge', nights },
    }))
  } catch (e) {
    console.error('autoCreateBedChargeInvoice failed:', e)
  }
}

async function saveDischargeSummaryDraftForAdmission({
 hospitalId,
 visitId,
 summaryText,
}) {
 if (!visitId) return
 await supabase
  .from('admissions')
  .update({ discharge_summary_notes: summaryText || null })
  .eq('hospital_id', hospitalId)
  .eq('visit_id', visitId)
}

async function printDischargeSummary() {
 if (!selectedBed || !bedPatient) return

 const admittingConsultation = bedConsultations.length > 0 ? bedConsultations[bedConsultations.length - 1] : null
 const finalConsultation = bedConsultations.length > 0 ? bedConsultations[0] : null
 const dischargeDate = new Date().toISOString()
 const summaryText = dischargeForm.discharge_notes || ''
 const instructionText = dischargeForm.discharge_instructions || ''
 const doctorName = bedVisit?.assigned_doctor_name || finalConsultation?.doctor_name || bedAdmission?.admitting_doctor || 'Not captured'

 await saveDischargeSummaryDraftForAdmission({
  hospitalId,
  visitId: selectedBed.visit_id,
  summaryText: summaryText || instructionText,
 })
 await persistDischargeChecklist({ discharge_summary_printed: true, doctor_note_written: Boolean(summaryText || instructionText) })

 const patientNumber = bedPatient?.patient_number || bedPatient?.mrn || bedPatient?.national_id || bedPatient?.id || '—'
 const labRows = (bedWorkflow.labTests || []).map(test => `
  <tr>
   <td>${escapeHtml(test.test_type || 'Lab test')}</td>
   <td>${escapeHtml(test.result_text || test.result_value || test.interpretation || 'Pending')}</td>
   <td>${escapeHtml(test.ordered_at ? new Date(test.ordered_at).toLocaleDateString('en-KE') : '—')}</td>
  </tr>
 `).join('')

 const rxRows = (bedWorkflow.prescriptions || []).map(rx => `
  <tr>
   <td>${escapeHtml(rx.drug_name || 'Medication')}</td>
   <td>${escapeHtml(rx.dosage || '—')}</td>
   <td>${escapeHtml([rx.frequency, rx.duration].filter(Boolean).join(' · ') || '—')}</td>
   <td>${escapeHtml(String(rx.quantity || '—'))}</td>
  </tr>
 `).join('')

 const w = window.open('', '_blank', 'width=1000,height=900')
 if (!w) return
 w.document.write(`
  <html>
   <head>
    <title>Discharge Summary</title>
    <style>
      @page { size: A4 portrait; margin: 14mm; }
      body { font-family: Arial, sans-serif; color: #111; margin: 0; background: #fff; }
      .print-sheet { max-width: 210mm; margin: 0 auto; padding: 10mm 8mm; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 18px; }
      .logo-box { width: 74px; height: 74px; border: 1.5px dashed #8AAE9F; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #6B7F76; font-size: 11px; text-align: center; }
      .title { font-size: 26px; font-weight: 800; color: #0F6E56; margin: 0; }
      .subtitle { margin-top: 4px; color: #555; font-size: 12px; }
      .section { border: 1px solid #DDE7E1; border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
      .section-title { font-size: 12px; font-weight: 800; color: #0F6E56; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 10px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; }
      .row-label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px; }
      .row-value { font-size: 13px; color: #111; font-weight: 600; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #D6E1DB; padding: 7px 8px; text-align: left; vertical-align: top; }
      th { background: #EEF6F2; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
      .muted { color: #666; font-size: 12px; }
      .summary-box { min-height: 84px; padding: 10px 12px; border-radius: 10px; background: #F8FBF9; border: 1px solid #DDE7E1; white-space: pre-wrap; font-size: 12px; line-height: 1.55; }
      @media print {
        body * { visibility: hidden; }
        .print-sheet, .print-sheet * { visibility: visible; }
        .print-sheet { position: absolute; left: 0; top: 0; width: 100%; }
      }
    </style>
   </head>
   <body>
    <div class="print-sheet">
      <div class="header">
        <div>
          <h1 class="title">${escapeHtml(hospitalName || 'RemaCare Hospital')}</h1>
          <div class="subtitle">Patient discharge summary</div>
        </div>
        <div class="logo-box">Hospital Logo</div>
      </div>

      <div class="section">
        <div class="section-title">Patient Demographics</div>
        <div class="grid">
          <div><div class="row-label">Patient Name</div><div class="row-value">${escapeHtml(bedPatient?.full_name || '—')}</div></div>
          <div><div class="row-label">Patient Number / MRN</div><div class="row-value">${escapeHtml(patientNumber)}</div></div>
          <div><div class="row-label">Date of Birth</div><div class="row-value">${escapeHtml(bedPatient?.dob || '—')}</div></div>
          <div><div class="row-label">Gender</div><div class="row-value">${escapeHtml(bedPatient?.gender || '—')}</div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Admission Details</div>
        <div class="grid">
          <div><div class="row-label">Admission Date</div><div class="row-value">${escapeHtml(bedAdmission?.admission_date ? new Date(bedAdmission.admission_date).toLocaleString('en-KE') : selectedBed?.admitted_at ? new Date(selectedBed.admitted_at).toLocaleString('en-KE') : '—')}</div></div>
          <div><div class="row-label">Discharge Date</div><div class="row-value">${escapeHtml(new Date(dischargeDate).toLocaleString('en-KE'))}</div></div>
          <div><div class="row-label">Ward</div><div class="row-value">${escapeHtml(selectedWard?.name || bedAdmission?.ward || '—')}</div></div>
          <div><div class="row-label">Bed Number</div><div class="row-value">${escapeHtml(selectedBed?.bed_number || bedAdmission?.bed_no || '—')}</div></div>
          <div><div class="row-label">Admitting Diagnosis</div><div class="row-value">${escapeHtml(admittingConsultation?.diagnosis || bedAdmission?.diagnosis || bedVisit?.chief_complaint || '—')}</div></div>
          <div><div class="row-label">Final Diagnosis</div><div class="row-value">${escapeHtml(finalConsultation ? `${finalConsultation.icd10_code || finalConsultation.icd_code || ''}${finalConsultation.icd10_code || finalConsultation.icd_code ? ' — ' : ''}${finalConsultation.icd10_description || finalConsultation.diagnosis || '—'}` : '—')}</div></div>
          <div><div class="row-label">Condition on Discharge</div><div class="row-value">${escapeHtml(dischargeForm.condition_on_discharge || 'Improved')}</div></div>
          <div><div class="row-label">Attending Doctor</div><div class="row-value">Dr. ${escapeHtml(doctorName)}</div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Investigations</div>
        <table>
          <thead><tr><th>Test</th><th>Result</th><th>Date</th></tr></thead>
          <tbody>${labRows || '<tr><td colspan="3">No investigations recorded for this visit.</td></tr>'}</tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-title">Medications on Discharge</div>
        <table>
          <thead><tr><th>Medication</th><th>Dose</th><th>Frequency / Duration</th><th>Qty</th></tr></thead>
          <tbody>${rxRows || '<tr><td colspan="4">No discharge medications recorded for this visit.</td></tr>'}</tbody>
        </table>
      </div>

      <div class="section">
        <div class="section-title">Discharge Summary</div>
        <div class="summary-box">${escapeHtml(summaryText || 'No discharge summary notes entered yet.')}</div>
      </div>

      <div class="section">
        <div class="section-title">Discharge Instructions</div>
        <div class="summary-box">${escapeHtml(instructionText || 'No discharge instructions entered yet.')}</div>
      </div>

      <div class="muted">Generated from the ward admission record, consultations, lab tests and prescriptions in RemedacareHMIS.</div>
    </div>
    <script>setTimeout(() => window.print(), 300)</script>
   </body>
  </html>
 `)
 w.document.close()
}

async function handleDischarge() {
 if (!selectedBed) return
 if (!canDischarge) {
 window.notifyFromLegacyAlert('Only doctors, nurses and admins can discharge patients.')
 return
 }
 if (!dischargeChecklist.canDischarge && !(isAdmin && String(dischargeForm.override_reason || '').trim())) {
 window.notifyFromLegacyAlert('Discharge is blocked until the discharge checklist is complete, unless an admin enters an override reason.')
 return
 }
 setSaving(true)

 // Auto-create bed charge invoice before clearing the bed
 const wardRecord = wards.find(w => w.id === selectedBed.ward_id)
 await autoCreateBedChargeInvoice({
  bed: selectedBed,
  wardType: wardRecord?.ward_type || 'General',
  hospitalId,
 })

 await saveDischargeSummaryDraftForAdmission({
  hospitalId,
  visitId: selectedBed.visit_id,
  summaryText: dischargeForm.discharge_notes || dischargeForm.discharge_instructions || null,
 })

 await supabase.from('beds').update({ status: 'Free', patient_id: null, visit_id: null, admitted_at: null, notes: dischargeForm.discharge_notes }).eq('id', selectedBed.id)
 await supabase.from('visits').update({
 status: 'Completed',
 discharged_at: new Date().toISOString(),
 discharge_notes: dischargeForm.discharge_notes || null,
 }).eq('id', selectedBed.visit_id)
 await supabase.from('admissions').update({
 discharge_date: new Date().toISOString(),
 discharge_notes: dischargeForm.discharge_notes || null,
 discharge_summary_notes: dischargeForm.discharge_notes || dischargeForm.discharge_instructions || null,
 discharge_doctor_note_written: Boolean(dischargeForm.doctor_note_written),
 discharge_prescriptions_written: Boolean(dischargeForm.discharge_prescriptions_written),
 discharge_bill_settled: Boolean(dischargeForm.bill_settled),
 discharge_summary_printed: Boolean(dischargeForm.discharge_summary_printed),
 follow_up_appointment_booked: Boolean(dischargeForm.follow_up_appointment_booked),
 discharge_override_reason: dischargeChecklist.overrideUsed ? dischargeForm.override_reason || null : null,
 status: 'Discharged',
 }).eq('visit_id', selectedBed.visit_id)
 setShowDischarge(false)
 setSelectedBed(null)
 setBedAdmission(null)
 setDischargeForm({ discharge_notes: '', discharge_instructions: '', condition_on_discharge: 'Improved', doctor_note_written: false, discharge_prescriptions_written: false, bill_settled: false, discharge_summary_printed: false, follow_up_appointment_booked: false, override_reason: '' })
 try {
  window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: selectedBed.visit_id, status: 'Completed', source: 'ward-discharge' } }))
 } catch (e) {}
 fetchAll()
 setSaving(false)
 }

 function openAdmitModal(request = null) {
  if (!canAdmitPatient) {
   window.notifyFromLegacyAlert('Only authorized clinical staff can admit patients.')
   return
  }
  if (!selectedBed || selectedBed.patient_id || !['Free', 'Reserved'].includes(selectedBed.status)) {
   window.notifyFromLegacyAlert('Select an available or reserved bed first.')
   return
  }
  const patient = request?.patients || null
  const visit = request?.visits || null
  setAdmitForm({
   patient_id: request?.patient_id || '',
   visit_id: request?.visit_id || '',
   patient_name: patient?.full_name || request?.patient_name || '',
   sha_number: patient?.sha_member_no || patient?.sha_number || '',
   admission_type: request?.admission_type || 'Elective',
   referring_doctor: request?.referring_doctor || '',
   referring_facility: request?.referring_facility || '',
   sha_preauth_number: request?.sha_preauth_number || '',
   expected_length_of_stay: request?.expected_los_days || '',
   allergies_review: patient?.allergies || request?.allergies_review || '',
   resuscitation_status: 'Full',
   isolation_required: Boolean(request?.isolation_required),
   request_id: request?.id || '',
  })
  setShowAdmitModal(true)
 }

 async function handleAdmitPatient() {
  if (!selectedBed) return
  if (!admitForm.patient_id || !admitForm.visit_id) {
   window.notifyFromLegacyAlert('Choose a patient from the admission waiting list first.')
   return
  }
  if (isShaPatientRecord({ sha_member_no: admitForm.sha_number }, null) && !String(admitForm.sha_preauth_number || '').trim()) {
   window.notifyFromLegacyAlert('SHA pre-authorization number is required for SHA admissions.')
   return
  }
  if (admitForm.resuscitation_status === 'DNR' && !canSetDnr) {
   window.notifyFromLegacyAlert('Only admin or doctor roles can mark a patient as DNR.')
   return
  }
  setSaving(true)
  const nowIso = new Date().toISOString()
  const bedStatus = admitForm.isolation_required ? 'Reserved' : 'Occupied'
  const admissionPayload = {
   hospital_id: hospitalId,
   visit_id: admitForm.visit_id,
   patient_id: admitForm.patient_id,
   admitting_doctor: admitForm.referring_doctor || bedVisit?.assigned_doctor_name || null,
   admission_date: nowIso,
   status: 'Active',
   ward: selectedWard?.name || null,
   bed_no: selectedBed?.bed_number || null,
   admission_type: admitForm.admission_type,
   referring_doctor: admitForm.referring_doctor || null,
   referring_facility: admitForm.referring_facility || null,
   sha_preauth_number: admitForm.sha_preauth_number || null,
   expected_los_days: Number(admitForm.expected_length_of_stay || 0) || null,
   allergies_review: admitForm.allergies_review || null,
   resuscitation_status: admitForm.resuscitation_status || 'Full',
   isolation_required: Boolean(admitForm.isolation_required),
   target_discharge_date: admitForm.expected_length_of_stay ? new Date(Date.now() + (Number(admitForm.expected_length_of_stay) * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10) : null,
  }
  const { data: existingAdmission } = await supabase
   .from('admissions')
   .select('id')
   .eq('hospital_id', hospitalId)
   .eq('visit_id', admitForm.visit_id)
   .eq('status', 'Active')
   .maybeSingle()
  const admissionMutation = existingAdmission
   ? supabase.from('admissions').update(admissionPayload).eq('id', existingAdmission.id)
   : supabase.from('admissions').insert(admissionPayload)
  const [{ error: bedError }, { error: admissionError }] = await Promise.all([
   supabase.from('beds').update({
    status: bedStatus,
    patient_id: admitForm.patient_id,
    visit_id: admitForm.visit_id,
    admitted_at: nowIso,
    notes: admitForm.allergies_review || null,
   }).eq('id', selectedBed.id),
   admissionMutation,
  ])
  if (admitForm.request_id) {
   await supabase.from('ward_bed_requests').update({ status: 'Admitted', resolved_at: nowIso }).eq('id', admitForm.request_id)
  }
  setSaving(false)
  if (bedError || admissionError) {
   window.notifyFromLegacyAlert(`Admission failed: ${(bedError || admissionError)?.message}`)
   return
  }
  setShowAdmitModal(false)
  try {
   window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: admitForm.visit_id, patient_id: admitForm.patient_id, source: 'ward-admission' } }))
  } catch (e) {}
  await fetchAll()
  const admittedBed = {
   ...selectedBed,
   status: bedStatus,
   patient_id: admitForm.patient_id,
   visit_id: admitForm.visit_id,
   admitted_at: nowIso,
   patients: { ...(selectedBed.patients || {}), id: admitForm.patient_id, full_name: admitForm.patient_name },
  }
  await selectBed(admittedBed)
 }

 async function handleSaveRoundNote() {
  if (!selectedBed?.id || !bedVisit?.id || !bedPatient?.id) return
  if (!roundForm.plan_for_today.trim()) {
   window.notifyFromLegacyAlert('Enter the plan for today before saving the round note.')
   return
  }
  setSaving(true)
  const payload = {
   hospital_id: hospitalId,
   ward_id: selectedWard?.id || null,
   bed_id: selectedBed.id,
   visit_id: bedVisit.id,
   patient_id: bedPatient.id,
   clinician_name: roundForm.clinician_name || currentUserName,
   note_date: roundForm.note_date ? new Date(roundForm.note_date).toISOString() : new Date().toISOString(),
   current_condition: roundForm.current_condition,
   target_discharge_date: roundForm.target_discharge_date || null,
   plan_for_today: roundForm.plan_for_today.trim(),
   vitals_snapshot: bedVitals || null,
  }
  const [{ error: roundError }, { error: admissionError }] = await Promise.all([
   supabase.from('ward_round_notes').insert(payload),
   supabase.from('admissions').update({
    target_discharge_date: roundForm.target_discharge_date || null,
    ward_round_last_condition: roundForm.current_condition,
    ward_round_last_note_at: new Date().toISOString(),
   }).eq('hospital_id', hospitalId).eq('visit_id', bedVisit.id),
  ])
  setSaving(false)
  if (roundError || admissionError) {
   window.notifyFromLegacyAlert(`Could not save round note: ${(roundError || admissionError)?.message}`)
   return
  }
  setShowRoundModal(false)
  await selectBed(selectedBed)
  await fetchAll()
 }

 async function persistDischargeChecklist(patch) {
  if (!selectedBed?.visit_id) return
  const nextState = { ...dischargeForm, ...patch }
  setDischargeForm(nextState)
  await supabase.from('admissions').update({
   discharge_doctor_note_written: Boolean(nextState.doctor_note_written),
   discharge_prescriptions_written: Boolean(nextState.discharge_prescriptions_written),
   discharge_bill_settled: Boolean(nextState.bill_settled),
   discharge_summary_printed: Boolean(nextState.discharge_summary_printed),
   follow_up_appointment_booked: Boolean(nextState.follow_up_appointment_booked),
   discharge_override_reason: nextState.override_reason || null,
  }).eq('hospital_id', hospitalId).eq('visit_id', selectedBed.visit_id)
 }

async function handleSaveNursingNote() {
 if (!selectedBed?.id || !bedVisit?.id || !bedPatient?.id) return
 if (!nursingForm.note_text.trim()) {
  window.notifyFromLegacyAlert('Enter the nursing progress note before saving.')
  return
 }
 setSaving(true)
 const payload = {
  hospital_id: hospitalId,
  bed_id: selectedBed.id,
  visit_id: bedVisit.id,
  patient_id: bedPatient.id,
  nurse_name: nursingForm.nurse_name || currentUserName,
  note_type: nursingForm.note_type,
  note_text: nursingForm.note_text.trim(),
  created_at: nursingForm.created_at ? new Date(nursingForm.created_at).toISOString() : new Date().toISOString(),
 }
 const { error } = await supabase.from('nursing_notes').insert(payload)
 if (error) {
  window.notifyFromLegacyAlert('Error saving nursing note: ' + error.message)
 } else {
  setNursingForm({
   nurse_name: currentUserName,
   note_type: 'General',
   note_text: '',
   created_at: new Date().toISOString().slice(0, 16),
  })
  await selectBed(selectedBed)
 }
 setSaving(false)
}

async function handleSaveFluidEntry() {
 if (!selectedBed?.id || !bedVisit?.id || !bedPatient?.id) return
 if (!fluidForm.volume_ml || Number(fluidForm.volume_ml) <= 0) {
  window.notifyFromLegacyAlert('Enter a valid fluid volume in millilitres.')
  return
 }
 setSaving(true)
 const payload = {
  hospital_id: hospitalId,
  bed_id: selectedBed.id,
  visit_id: bedVisit.id,
  patient_id: bedPatient.id,
  entry_type: fluidForm.entry_type,
  volume_ml: Number(fluidForm.volume_ml),
  fluid_description: fluidForm.fluid_description || null,
  recorded_at: fluidForm.recorded_at ? new Date(fluidForm.recorded_at).toISOString() : new Date().toISOString(),
  recorded_by: fluidForm.recorded_by || currentUserName,
  created_at: new Date().toISOString(),
 }
 const { error } = await supabase.from('fluid_balance').insert(payload)
 if (error) {
  window.notifyFromLegacyAlert('Error saving fluid balance entry: ' + error.message)
 } else {
  setFluidForm({
   entry_type: 'Oral Intake',
   volume_ml: '',
   fluid_description: '',
   recorded_at: new Date().toISOString().slice(0, 16),
   recorded_by: currentUserName,
  })
  await selectBed(selectedBed)
 }
 setSaving(false)
}

async function handleSaveVitalsShortcut() {
 if (!selectedBed?.id || !bedVisit?.id || !bedPatient?.id) return
 if (!vitalsShortcutForm.bp_systolic || !vitalsShortcutForm.weight_kg) {
  window.notifyFromLegacyAlert('Weight and systolic blood pressure are required.')
  return
 }
 setSaving(true)
 const bmi = vitalsShortcutForm.weight_kg && vitalsShortcutForm.height_cm
  ? parseFloat((parseFloat(vitalsShortcutForm.weight_kg) / Math.pow(parseFloat(vitalsShortcutForm.height_cm)/100, 2)).toFixed(1))
  : null
 const payload = {
  hospital_id: hospitalId,
  visit_id: bedVisit.id,
  patient_id: bedPatient.id,
  ...vitalsShortcutForm,
  recorded_by: vitalsShortcutForm.recorded_by || currentUserName,
  bmi,
  recorded_at: new Date().toISOString(),
 }
 const { error } = await supabase.from('vitals').insert(payload)
 if (error) {
  window.notifyFromLegacyAlert('Error saving vitals: ' + error.message)
 } else {
  setShowVitalsShortcut(false)
  setVitalsShortcutForm({
   weight_kg:'', height_cm:'', bp_systolic:'', bp_diastolic:'',
   pulse_bpm:'', temperature_c:'', oxygen_sat:'', respiratory_rate:'',
   blood_sugar:'', recorded_by: currentUserName,
  })
  await selectBed(selectedBed)
 }
 setSaving(false)
}

async function setBedStatus(bed, status) {
 if (!canManageWards) {
 window.notifyFromLegacyAlert('Only admins can update bed status.')
 return
 }
 await supabase.from('beds').update({ status }).eq('id', bed.id)
 try {
  window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: bed.visit_id || null, source: 'bed-status-update', status } }))
 } catch (e) {}
 fetchAll()
 if (selectedBed?.id === bed.id) setSelectedBed({ ...selectedBed, status })
 }

 async function handleDeleteBed(bed) {
 if (!canManageWards) {
 window.notifyFromLegacyAlert('Only Admin users can delete beds.')
 return
 }
 if (!bed) return
 if (bed.patient_id || bed.status !== 'Free') {
 window.notifyFromLegacyAlert('Only a free bed can be deleted. Discharge or move patients first.')
 return
 }
 if (!await window.openConfirmDialog(`Delete bed ${bed.bed_number}? This action cannot be undone.`)) return
 setSaving(true)
 await supabase.from('beds').delete().eq('id', bed.id)
 const wardBedCount = beds.filter(b => b.ward_id === bed.ward_id).length - 1
 await supabase.from('wards').update({ total_beds: Math.max(0, wardBedCount) }).eq('id', bed.ward_id)
 setSelectedBed(null)
 fetchAll()
 setSaving(false)
 }

 async function handleDeleteWard(ward) {
 if (!canManageWards) {
 window.notifyFromLegacyAlert('Only Admin users can delete wards.')
 return
 }
 if (!ward) return
 const wardBeds = beds.filter(b => b.ward_id === ward.id)
 const hasOccupants = wardBeds.some(b => b.patient_id || b.status === 'Occupied' || b.status === 'Critical')
 if (hasOccupants) {
 window.notifyFromLegacyAlert('Cannot delete a ward with occupied or critical beds. Discharge or transfer patients first.')
 return
 }
 if (!await window.openConfirmDialog(`Delete ward \"${ward.name}\" and ${wardBeds.length} bed(s)? This action cannot be undone.`)) return
 setSaving(true)
 await supabase.from('beds').delete().eq('ward_id', ward.id)
 await supabase.from('wards').delete().eq('id', ward.id)
 if (selectedWard?.id === ward.id) {
 setView('overview')
 setSelectedWard(null)
 setSelectedBed(null)
 }
 fetchAll()
 setSaving(false)
 }

 // Ward stats
 function wardStats(wardId) {
 const wb = beds.filter(b => b.ward_id === wardId)
 return {
 total: wb.length,
 occupied: wb.filter(b => b.status === 'Occupied').length,
 critical: wb.filter(b => b.status === 'Critical').length,
 reserved: wb.filter(b => b.status === 'Reserved').length,
 free: wb.filter(b => b.status === 'Free').length,
 maintenance: wb.filter(b => b.status === 'Maintenance').length,
 }
 }

 // Beds for selected ward
 const wardBeds = selectedWard ? beds.filter(b => b.ward_id === selectedWard.id) : []

 // Global stats
 const totalBeds = beds.length
 const totalOccupied = beds.filter(b => ['Occupied', 'Critical'].includes(b.status)).length
 const totalCritical = beds.filter(b => b.status === 'Critical').length
 const totalReserved = beds.filter(b => b.status === 'Reserved').length
 const totalFree = beds.filter(b => b.status === 'Free').length
 const pendingTransfers = transfers.filter(t => t.status === 'Pending').length

 const daysAdmitted = (admittedAt) => {
 if (!admittedAt) return '—'
 const days = Math.floor((new Date() - new Date(admittedAt)) / (1000 * 60 * 60 * 24))
 return days === 0 ? 'Today' : `${days}d`
 }

 const dischargeChecklist = useMemo(() => {
  const invoices = bedWorkflow.invoices || []
  const labTests = bedWorkflow.labTests || []
  const prescriptions = bedWorkflow.prescriptions || []

  const openInvoices = invoices.filter(inv => Number(inv.balance_kes || 0) > 0)
  const labTestsWithCharges = labTests.filter(test => Number(test.amount || 0) > 0)
  const unbilledLabs = labTestsWithCharges.filter(test => !invoices.some(inv => {
   const source = inferInvoiceSource(inv)
   return (source === SERVICE_SOURCES.LABORATORY || source === 'Other') && matchesLabInvoice(inv, test)
  }))
  const pendingLabResults = labTests.filter(test => ['Pending', 'In Progress', 'Critical'].includes(test.status))
  const unreleasedPrescriptions = prescriptions.filter(rx => ['Pending', 'Approved'].includes(rx.status || 'Pending'))
  const pharmacyBalance = openInvoices.filter(inv => inferInvoiceSource(inv) === SERVICE_SOURCES.PHARMACY)
  const doctorNoteReady = Boolean(dischargeForm.doctor_note_written || dischargeForm.discharge_notes || dischargeForm.discharge_instructions)
  const rxReady = Boolean(dischargeForm.discharge_prescriptions_written || prescriptions.length)
  const billReady = openInvoices.length === 0 && unbilledLabs.length === 0 && (dischargeForm.bill_settled || true)
  const summaryReady = Boolean(dischargeForm.discharge_summary_printed)
  const followUpReady = Boolean(dischargeForm.follow_up_appointment_booked || bedFollowUps.some(item => ['Scheduled', 'Confirmed'].includes(item.status)))
  const checklistItems = [
   { key: 'doctor_note_written', label: 'Doctor has written discharge note', checked: doctorNoteReady },
   { key: 'discharge_prescriptions_written', label: 'Discharge prescriptions written', checked: rxReady },
   { key: 'bill_settled', label: 'Bill settled or credit arrangement signed', checked: billReady },
   { key: 'discharge_summary_printed', label: 'Discharge summary printed', checked: summaryReady },
   { key: 'follow_up_appointment_booked', label: 'Follow-up appointment booked', checked: followUpReady },
  ]
  const readyCount = checklistItems.filter(item => item.checked).length
  const overrideUsed = isAdmin && String(dischargeForm.override_reason || '').trim().length > 0

  return {
   openInvoices,
   unbilledLabs,
   pendingLabResults,
   unreleasedPrescriptions,
   pharmacyBalance,
   checklistItems,
   readyCount,
   overrideUsed,
   canDischarge: checklistItems.every(item => item.checked) || overrideUsed,
  }
 }, [bedWorkflow, dischargeForm, bedFollowUps, isAdmin])

 const latestRoundByVisit = useMemo(() => {
  const map = new Map()
  wardRounds.forEach((note) => {
   if (!note.visit_id || map.has(note.visit_id)) return
   map.set(note.visit_id, note)
  })
  return map
 }, [wardRounds])

 const pendingBedRequests = useMemo(() => bedRequests.filter(item => ['Pending', 'Flagged', 'Queued'].includes(item.status || 'Pending')), [bedRequests])
 const wardRequestQueue = useMemo(() => pendingBedRequests.filter(item => !selectedWard || !item.requested_ward_id || item.requested_ward_id === selectedWard.id), [pendingBedRequests, selectedWard])

 const admissionsTrend = useMemo(() => {
  const weeks = Array.from({ length: 6 }, (_, index) => {
   const start = new Date()
   start.setDate(start.getDate() - ((5 - index) * 7))
   const end = new Date(start)
   end.setDate(end.getDate() + 6)
   return {
    label: `${start.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}`,
    start,
    end,
    admissions: 0,
    discharges: 0,
   }
  })
  admissions.forEach((item) => {
   const admitted = item.admission_date ? new Date(item.admission_date) : null
   const discharged = item.discharge_date ? new Date(item.discharge_date) : null
   weeks.forEach((bucket) => {
    if (admitted && admitted >= bucket.start && admitted <= bucket.end) bucket.admissions += 1
    if (discharged && discharged >= bucket.start && discharged <= bucket.end) bucket.discharges += 1
   })
  })
  return weeks
 }, [admissions])

 const occupancyAnalytics = useMemo(() => wards.map((ward) => {
  const stats = wardStats(ward.id)
  const occupied = stats.occupied + stats.critical + stats.reserved
  const occupancy = stats.total ? Math.round((occupied / stats.total) * 100) : 0
  const activeAdmissions = admissions.filter(item => (item.ward || '') === ward.name && (item.status || '') === 'Active')
  const losValues = activeAdmissions.map(item => differenceInDays(item.admission_date)).filter(value => value != null)
  const avgLos = losValues.length ? Number((losValues.reduce((sum, value) => sum + value, 0) / losValues.length).toFixed(1)) : 0
  return {
   ward: ward.name,
   occupancy,
   avgLos,
   turnover: stats.total ? Number(((activeAdmissions.length + admissions.filter(item => item.ward === ward.name && item.discharge_date).length) / stats.total).toFixed(1)) : 0,
  }
 }), [wards, admissions, beds])

 const statusMixData = useMemo(() => {
  const statuses = ['Free', 'Occupied', 'Critical', 'Reserved', 'Maintenance']
  return statuses.map((status) => ({ name: status, value: beds.filter(item => item.status === status).length, fill: BED_COLORS[status]?.border || '#CBD5E1' })).filter(item => item.value > 0)
 }, [beds])

 const diagnosisLosRows = useMemo(() => {
  const map = new Map()
  admissions.forEach((item) => {
   const diagnosis = item.diagnosis || 'Uncoded admission'
   const los = differenceInDays(item.admission_date, item.discharge_date || new Date())
   if (los == null) return
   if (!map.has(diagnosis)) map.set(diagnosis, [])
   map.get(diagnosis).push(los)
  })
  return Array.from(map.entries()).map(([diagnosis, values]) => ({
   diagnosis,
   avgLos: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)),
   count: values.length,
  })).sort((a, b) => b.avgLos - a.avgLos).slice(0, 8)
 }, [admissions])

 if (loading) return (
 <div style={s.loadWrap}><div style={s.spinner}></div><p style={{ color: '#0F6E56', marginTop: 12 }}>Loading Wards...</p></div>
 )

 return (
 <div style={s.page}>
 <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} @keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}`}</style>

 {/* HEADER */}
 <div style={s.header}>
 <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
 {view === 'ward' && (
 <button style={s.backBtn} onClick={() => { setView('overview'); setSelectedWard(null); setSelectedBed(null); setBedPage(1) }}>← Back</button>
 )}
 <div>
 <h1 style={s.title}>{view === 'overview' ? 'Ward & Bed Management' : `${selectedWard?.name} — ${WARD_ICONS[selectedWard?.ward_type] || ''} ${selectedWard?.ward_type}`}</h1>
 <p style={s.subtitle}>
 {view === 'overview'
 ? `${totalBeds} total beds • ${totalOccupied} occupied • ${totalReserved} reserved • ${totalFree} free • ${totalCritical} critical`
 : `${wardStats(selectedWard?.id).total} beds • ${wardStats(selectedWard?.id).free} free`
 }
 </p>
 </div>
 </div>
 <div style={{ display: 'flex', gap: 8 }}>
 {view === 'overview' && (
 <button
  style={{ ...s.btn, ...(canManageWards ? {} : s.btnDisabled) }}
  onClick={() => setShowAddWard(true)}
  disabled={!canManageWards}
  title="Only admins can create wards">+ Add Ward</button>
 )}
 {view === 'ward' && (
 <>
 <button
  style={{ ...s.btn, background: '#fff', color: '#0F6E56', border: '1px solid #0F6E56', ...(canManageWards ? {} : s.btnDisabled) }}
  onClick={() => setShowAddBeds(true)}
  disabled={!canManageWards}
  title="Only admins can add beds to wards">+ Add Beds</button>
 <button
  style={{ ...s.btn, ...(canTransfer ? {} : s.btnDisabled) }}
  onClick={() => setShowTransfer(true)}
  disabled={!selectedBed?.patient_id || !canTransfer}
  title="Only doctors and nurses can transfer admitted patients">⇄ Transfer</button>
 <button
  style={{ ...s.btn, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #F09595', ...(canManageWards ? {} : s.btnDisabled) }}
  onClick={() => handleDeleteWard(selectedWard)}
  disabled={saving || !canManageWards}
  title="Only admins can delete wards">Delete Ward</button>
 </>
 )}
 </div>
 </div>

 {/* OVERVIEW */}
 {view === 'overview' && (
 <>
  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
   {OVERVIEW_TABS.map(tabKey => (
    <button key={tabKey} style={{ ...s.chip, ...(overviewTab === tabKey ? s.chipActive : {}) }} onClick={() => setOverviewTab(tabKey)}>
     {tabKey === 'operations' ? 'Operations View' : 'Ward Analytics'}
    </button>
   ))}
  </div>

  {overviewTab === 'operations' && (
   <>
    <WardOverview
     wards={wards}
     beds={beds}
     transfers={transfers}
     onSelectWard={ward => { setSelectedWard(ward); setView('ward'); setSelectedBed(null); setBedPage(1); setBedSearch(''); setBedFilter('All') }}
     canManageWards={canManageWards}
     canTransfer={canTransfer}
     onOpenAddWard={() => setShowAddWard(true)}
     onApproveTransfer={handleApproveTransfer}
     styles={s}
     wardIcons={WARD_ICONS}
     wardStats={wardStats}
    />

    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 16, marginTop: 20 }}>
     <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E6ECE8', padding: 18 }}>
      <div style={s.sectionLabel}>Bed Requests from OPD / Casualty</div>
      {pendingBedRequests.length === 0 ? (
       <div style={{ color: '#777', fontSize: 13 }}>No active bed requests right now. New requests appear here in realtime.</div>
      ) : (
       <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pendingBedRequests.slice(0, 8).map(request => (
         <div key={request.id} style={{ border: '1px solid #E8ECEB', borderRadius: 12, padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
           <div style={{ fontWeight: 700, color: '#111' }}>{request.patients?.full_name || request.patient_name || 'Patient awaiting bed'}</div>
           <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            {request.request_source || 'OPD'} • {request.admission_type || 'Elective'} • Requested {formatDateTime(request.created_at)}
           </div>
           <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            <span style={{ ...s.pill, background: request.priority === 'Emergency' ? '#FCEBEB' : request.priority === 'Urgent' ? '#FFF3DC' : '#EAF6F1', color: request.priority === 'Emergency' ? '#A32D2D' : request.priority === 'Urgent' ? '#C07000' : '#0F6E56' }}>{request.priority || 'Routine'}</span>
            {request.requested_ward_id && <span style={{ ...s.pill, background: '#EFF6FF', color: '#1D4ED8' }}>Preferred ward set</span>}
            {request.isolation_required && <span style={{ ...s.pill, background: '#F3E8FF', color: '#7C3AED' }}>Isolation required</span>}
           </div>
           {request.notes && <div style={{ fontSize: 12, color: '#444', marginTop: 6 }}>{request.notes}</div>}
          </div>
          <button
           style={{ ...s.btn, padding: '8px 12px', ...(canAdmitPatient ? {} : s.btnDisabled) }}
           onClick={() => {
            if (request.requested_ward_id) {
             const ward = wards.find(item => item.id === request.requested_ward_id)
             if (ward) {
              setSelectedWard(ward)
              setView('ward')
             }
            }
            window.notifyFromLegacyAlert('Open a free bed in the target ward, then use Quick Admit to complete this admission request.')
           }}
           disabled={!canAdmitPatient}
          >
           Route to ward
          </button>
         </div>
        ))}
       </div>
      )}
     </div>

     <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E6ECE8', padding: 18 }}>
      <div style={s.sectionLabel}>Length of Stay Alerts</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
       {admissions.filter(item => item.status === 'Active').map(item => ({
        item,
        days: differenceInDays(item.admission_date),
        flag: getLengthOfStayFlag(differenceInDays(item.admission_date)),
       })).filter(row => row.flag).sort((a, b) => b.days - a.days).slice(0, 8).map(({ item, days, flag }) => (
        <div key={item.id} style={{ border: `1px solid ${flag.color === '#A32D2D' ? '#F3A6A6' : '#FAC775'}`, background: flag.bg, borderRadius: 12, padding: 12 }}>
         <div style={{ fontWeight: 700, color: flag.color }}>{item.patient_name || item.patient_id || 'Admitted patient'} • {days} day(s)</div>
         <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{item.ward || 'Ward not set'} • {item.diagnosis || 'Diagnosis pending'} • {flag.label}</div>
        </div>
       ))}
       {admissions.filter(item => item.status === 'Active').every(item => !getLengthOfStayFlag(differenceInDays(item.admission_date))) && (
        <div style={{ color: '#777', fontSize: 13 }}>No senior-review or discharge-board flags right now.</div>
       )}
      </div>
     </div>
    </div>
   </>
  )}

  {overviewTab === 'analytics' && (
   <div style={{ display: 'grid', gap: 16 }}>
    <div style={s.statsRow}>
     {[
      { label: 'Current Occupancy %', value: `${totalBeds ? Math.round(((totalOccupied + totalReserved) / totalBeds) * 100) : 0}%`, color: '#111', bg: '#F3F4F6' },
      { label: 'Avg LOS This Month', value: `${occupancyAnalytics.length ? Number((occupancyAnalytics.reduce((sum, row) => sum + row.avgLos, 0) / occupancyAnalytics.length).toFixed(1)) : 0}d`, color: '#0F6E56', bg: '#E1F5EE' },
      { label: 'Bed Turnover', value: occupancyAnalytics.length ? Number((occupancyAnalytics.reduce((sum, row) => sum + row.turnover, 0) / occupancyAnalytics.length).toFixed(1)) : 0, color: '#1D4ED8', bg: '#EAF2FF' },
      { label: '30d Readmissions', value: admissions.filter(item => readmissionWithin30Days(item, admissions)).length, color: '#A32D2D', bg: '#FCEBEB' },
     ].map(stat => (
      <div key={stat.label} style={{ ...s.statChip, background: stat.bg }}>
       <div style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</div>
       <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{stat.label}</div>
      </div>
     ))}
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
     <div style={s.chartCard}>
      <div style={s.sectionLabel}>Admissions vs Discharges Trend</div>
      <div style={{ width: '100%', height: 280 }}>
       <ResponsiveContainer>
        <LineChart data={admissionsTrend}>
         <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
         <XAxis dataKey="label" stroke="#6B7280" />
         <YAxis stroke="#6B7280" />
         <Tooltip />
         <Legend />
         <Line type="monotone" dataKey="admissions" stroke="#0F6E56" strokeWidth={3} name="Admissions" />
         <Line type="monotone" dataKey="discharges" stroke="#C07000" strokeWidth={3} name="Discharges" />
        </LineChart>
       </ResponsiveContainer>
      </div>
     </div>

     <div style={s.chartCard}>
      <div style={s.sectionLabel}>Bed Status Mix</div>
      <div style={{ width: '100%', height: 280 }}>
       <ResponsiveContainer>
        <PieChart>
         <Pie data={statusMixData} innerRadius={60} outerRadius={95} dataKey="value" nameKey="name">
          {statusMixData.map(item => <Cell key={item.name} fill={item.fill} />)}
         </Pie>
         <Tooltip />
         <Legend />
        </PieChart>
       </ResponsiveContainer>
      </div>
     </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
     <div style={s.chartCard}>
      <div style={s.sectionLabel}>Occupancy % by Ward</div>
      <div style={{ width: '100%', height: 280 }}>
       <ResponsiveContainer>
        <BarChart data={occupancyAnalytics}>
         <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
         <XAxis dataKey="ward" stroke="#6B7280" hide />
         <YAxis stroke="#6B7280" />
         <Tooltip formatter={(value) => [`${value}%`, 'Occupancy']} />
         <Bar dataKey="occupancy" radius={[8, 8, 0, 0]}>
          {occupancyAnalytics.map(item => <Cell key={item.ward} fill={item.occupancy > 90 ? '#A32D2D' : item.occupancy >= 75 ? '#C07000' : '#0F6E56'} />)}
         </Bar>
        </BarChart>
       </ResponsiveContainer>
      </div>
     </div>

     <div style={s.chartCard}>
      <div style={s.sectionLabel}>Average LOS by Diagnosis</div>
      <div style={{ overflowX: 'auto' }}>
       <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
         <tr>{['Diagnosis', 'Avg LOS', 'Cases'].map(header => <th key={header} style={s.th}>{header}</th>)}</tr>
        </thead>
        <tbody>
         {diagnosisLosRows.length === 0 && <tr><td colSpan={3} style={{ ...s.td, textAlign: 'center', color: '#888' }}>No diagnosis LOS data yet</td></tr>}
         {diagnosisLosRows.map(row => (
          <tr key={row.diagnosis} style={{ borderBottom: '1px solid #F0F4F1' }}>
           <td style={s.td}>{row.diagnosis}</td>
           <td style={s.td}>{row.avgLos} day(s)</td>
           <td style={s.td}>{row.count}</td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>
     </div>
    </div>
   </div>
  )}
 </>
 )}

 {/* WARD BED MAP VIEW */}
 {view === 'ward' && selectedWard && (
 <div style={{ display: 'flex', gap: 16, minHeight: 0 }}>
 <WardBedGrid
  beds={wardBeds}
  selectedBed={selectedBed}
  onSelectBed={selectBed}
  onQuickAdmit={openAdmitModal}
  bedPage={bedPage}
  setBedPage={setBedPage}
  bedSearch={bedSearch}
  setBedSearch={setBedSearch}
  bedFilter={bedFilter}
  setBedFilter={setBedFilter}
  onOpenAddBeds={() => setShowAddBeds(true)}
  canManageWards={canManageWards}
  canAdmitPatient={canAdmitPatient}
  admissionQueue={wardRequestQueue}
  styles={s}
  bedColors={BED_COLORS}
  latestRoundByVisit={latestRoundByVisit}
  daysAdmitted={daysAdmitted}
  bedsPerPage={BEDS_PER_PAGE}
 />

 <WardBedPanel
  bed={selectedBed}
  patient={bedPatient}
  visit={bedVisit}
  admission={bedAdmission}
  vitals={bedVitals}
  vitalsTrend={bedVitalsTrend}
  consultations={bedConsultations}
  workflow={bedWorkflow}
  rounds={bedRoundNotes}
  followUps={bedFollowUps}
  ward={selectedWard}
  userRole={userRole}
  canManageWards={canManageWards}
  canAdmitPatient={canAdmitPatient}
  canDischarge={canDischarge}
  canTransfer={canTransfer}
  canSetDnr={canSetDnr}
  saving={saving}
  onClose={() => setSelectedBed(null)}
  onSetBedStatus={setBedStatus}
  daysAdmitted={daysAdmitted}
  bedColors={BED_COLORS}
  latestRound={selectedBed?.visit_id ? latestRoundByVisit.get(selectedBed.visit_id) : null}
  admissionQueue={wardRequestQueue}
  bedPanelTab={bedPanelTab}
  setBedPanelTab={setBedPanelTab}
  dischargeChecklist={dischargeChecklist}
  dischargeForm={dischargeForm}
  setDischargeForm={setDischargeForm}
  onChecklistChange={persistDischargeChecklist}
  onQuickAdmit={openAdmitModal}
  onOpenRoundModal={() => setShowRoundModal(true)}
  roundForm={roundForm}
  setRoundForm={setRoundForm}
  printDischargeSummary={printDischargeSummary}
  onOpenDischarge={() => setShowDischarge(true)}
  onOpenTransfer={() => setShowTransfer(true)}
  onDeleteBed={handleDeleteBed}
  nursingProps={{
   nursingForm,
  setNursingForm,
  onSaveNursingNote: handleSaveNursingNote,
  nursingNotes: bedNursingNotes,
  fluidForm,
  setFluidForm,
   onSaveFluidEntry: handleSaveFluidEntry,
   fluidEntries: bedFluidBalance,
   vitalsTrend: bedVitalsTrend,
   onOpenVitalsShortcut: () => {
    setVitalsShortcutForm(prev => ({ ...prev, recorded_by: currentUserName }))
    setShowVitalsShortcut(true)
   },
   onOpenPatientsFlow: () => navigate?.('patients', { patientId: bedPatient?.id || null, visitId: bedVisit?.id || null, source: 'ward-vitals-shortcut', openedAt: Date.now() }),
   saving,
   styles: s,
   nursingNoteTypes: NURSING_NOTE_TYPES,
   fluidEntryTypes: FLUID_ENTRY_TYPES,
   isIntakeEntry,
  }}
  styles={s}
 />
 </div>
 )}

 {/* ===== VITALS SHORTCUT MODAL ===== */}
 {showVitalsShortcut && (
 <div style={s.overlay} onClick={() => setShowVitalsShortcut(false)}>
  <div style={{ ...s.modal, maxWidth: 720 }} onClick={e => e.stopPropagation()}>
   <div style={s.modalHeader}>
    <h2 style={s.modalTitle}>Record Vitals — {bedPatient?.full_name}</h2>
    <button style={s.closeBtn} onClick={() => setShowVitalsShortcut(false)}></button>
   </div>
   <div style={s.modalBody}>
    <div style={s.formGrid2}>
     <div style={s.formGroup}><label style={s.label}>Weight (kg) *</label><input style={s.input} type="number" value={vitalsShortcutForm.weight_kg} onChange={e => setVitalsShortcutForm({ ...vitalsShortcutForm, weight_kg: e.target.value })} /></div>
     <div style={s.formGroup}><label style={s.label}>Height (cm)</label><input style={s.input} type="number" value={vitalsShortcutForm.height_cm} onChange={e => setVitalsShortcutForm({ ...vitalsShortcutForm, height_cm: e.target.value })} /></div>
     <div style={s.formGroup}><label style={s.label}>BP Systolic *</label><input style={s.input} type="number" value={vitalsShortcutForm.bp_systolic} onChange={e => setVitalsShortcutForm({ ...vitalsShortcutForm, bp_systolic: e.target.value })} /></div>
     <div style={s.formGroup}><label style={s.label}>BP Diastolic</label><input style={s.input} type="number" value={vitalsShortcutForm.bp_diastolic} onChange={e => setVitalsShortcutForm({ ...vitalsShortcutForm, bp_diastolic: e.target.value })} /></div>
     <div style={s.formGroup}><label style={s.label}>Pulse (bpm)</label><input style={s.input} type="number" value={vitalsShortcutForm.pulse_bpm} onChange={e => setVitalsShortcutForm({ ...vitalsShortcutForm, pulse_bpm: e.target.value })} /></div>
     <div style={s.formGroup}><label style={s.label}>Temperature (°C)</label><input style={s.input} type="number" value={vitalsShortcutForm.temperature_c} onChange={e => setVitalsShortcutForm({ ...vitalsShortcutForm, temperature_c: e.target.value })} /></div>
     <div style={s.formGroup}><label style={s.label}>SpO2 (%)</label><input style={s.input} type="number" value={vitalsShortcutForm.oxygen_sat} onChange={e => setVitalsShortcutForm({ ...vitalsShortcutForm, oxygen_sat: e.target.value })} /></div>
     <div style={s.formGroup}><label style={s.label}>Respiratory Rate</label><input style={s.input} type="number" value={vitalsShortcutForm.respiratory_rate} onChange={e => setVitalsShortcutForm({ ...vitalsShortcutForm, respiratory_rate: e.target.value })} /></div>
     <div style={s.formGroup}><label style={s.label}>Blood Sugar</label><input style={s.input} type="number" value={vitalsShortcutForm.blood_sugar} onChange={e => setVitalsShortcutForm({ ...vitalsShortcutForm, blood_sugar: e.target.value })} /></div>
     <div style={s.formGroup}><label style={s.label}>Recorded By</label><input style={s.input} value={vitalsShortcutForm.recorded_by} onChange={e => setVitalsShortcutForm({ ...vitalsShortcutForm, recorded_by: e.target.value })} /></div>
    </div>
   </div>
   <div style={s.modalFooter}>
    <button style={s.cancelBtn} onClick={() => setShowVitalsShortcut(false)}>Cancel</button>
    <button style={s.submitBtn} onClick={handleSaveVitalsShortcut} disabled={saving}>{saving ? 'Saving...' : 'Save Vitals'}</button>
   </div>
 </div>
 </div>
 )}

 {/* ===== QUICK ADMIT MODAL ===== */}
 {showAdmitModal && (
 <div style={s.overlay} onClick={() => setShowAdmitModal(false)}>
  <div style={{ ...s.modal, maxWidth: 760 }} onClick={e => e.stopPropagation()}>
   <div style={s.modalHeader}>
    <h2 style={s.modalTitle}>Admit Patient to Bed {selectedBed?.bed_number}</h2>
    <button style={s.closeBtn} onClick={() => setShowAdmitModal(false)}></button>
   </div>
   <div style={s.modalBody}>
    <div style={{ background: '#F8FBF9', border: '1px solid #E1F5EE', borderRadius: 12, padding: 12, marginBottom: 16 }}>
     <div style={{ fontWeight: 700, color: '#111' }}>{admitForm.patient_name || 'Select patient from waiting list'}</div>
     <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Visit ID: {admitForm.visit_id || '—'} • SHA No: {admitForm.sha_number || 'Not recorded'}</div>
    </div>
    <div style={s.formGrid2}>
     <div style={s.formGroup}>
      <label style={s.label}>Admission Type</label>
      <select style={s.input} value={admitForm.admission_type} onChange={e => setAdmitForm({ ...admitForm, admission_type: e.target.value })}>
       {ADMISSION_TYPES.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
     </div>
     <div style={s.formGroup}>
      <label style={s.label}>Expected Length of Stay (days)</label>
      <input style={s.input} type="number" min={1} value={admitForm.expected_length_of_stay} onChange={e => setAdmitForm({ ...admitForm, expected_length_of_stay: e.target.value })} />
     </div>
     <div style={s.formGroup}>
      <label style={s.label}>Referring Doctor</label>
      <input style={s.input} value={admitForm.referring_doctor} onChange={e => setAdmitForm({ ...admitForm, referring_doctor: e.target.value })} placeholder="Dr. ..." />
     </div>
     <div style={s.formGroup}>
      <label style={s.label}>Referring Facility</label>
      <input style={s.input} value={admitForm.referring_facility} onChange={e => setAdmitForm({ ...admitForm, referring_facility: e.target.value })} placeholder="Only for transfers / outside referral" />
     </div>
     <div style={s.formGroup}>
      <label style={s.label}>SHA Pre-Authorization Number</label>
      <input style={s.input} value={admitForm.sha_preauth_number} onChange={e => setAdmitForm({ ...admitForm, sha_preauth_number: e.target.value })} placeholder="Required for SHA patients" />
     </div>
     <div style={s.formGroup}>
      <label style={s.label}>Resuscitation Status</label>
      <select style={s.input} value={admitForm.resuscitation_status} onChange={e => setAdmitForm({ ...admitForm, resuscitation_status: e.target.value })} disabled={!canSetDnr}>
       {RESUSCITATION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
      {!canSetDnr && <div style={s.inlineHint}>Only admin/doctor roles can change DNR status.</div>}
     </div>
    </div>
    <div style={s.formGroup}>
     <label style={s.label}>Allergies Review</label>
     <textarea style={{ ...s.input, minHeight: 82, resize: 'vertical' }} value={admitForm.allergies_review} onChange={e => setAdmitForm({ ...admitForm, allergies_review: e.target.value })} placeholder="Drug / food allergies reviewed at admission..." />
    </div>
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#333' }}>
     <input type="checkbox" checked={admitForm.isolation_required} onChange={e => setAdmitForm({ ...admitForm, isolation_required: e.target.checked })} />
     Isolation required for infection control
    </label>
   </div>
   <div style={s.modalFooter}>
    <button style={s.cancelBtn} onClick={() => setShowAdmitModal(false)}>Cancel</button>
    <button style={s.submitBtn} onClick={handleAdmitPatient} disabled={saving}>{saving ? 'Admitting...' : 'Confirm Admission'}</button>
   </div>
  </div>
 </div>
 )}

 {/* ===== DAILY ROUND MODAL ===== */}
 {showRoundModal && (
 <div style={s.overlay} onClick={() => setShowRoundModal(false)}>
  <div style={{ ...s.modal, maxWidth: 680 }} onClick={e => e.stopPropagation()}>
   <div style={s.modalHeader}>
    <h2 style={s.modalTitle}>Daily Ward Round • {bedPatient?.full_name}</h2>
    <button style={s.closeBtn} onClick={() => setShowRoundModal(false)}></button>
   </div>
   <div style={s.modalBody}>
    <div style={s.formGrid2}>
     <div style={s.formGroup}>
      <label style={s.label}>Current Condition</label>
      <select style={s.input} value={roundForm.current_condition} onChange={e => setRoundForm({ ...roundForm, current_condition: e.target.value })}>
       {ROUND_CONDITIONS.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
     </div>
     <div style={s.formGroup}>
      <label style={s.label}>Target Discharge Date</label>
      <input style={s.input} type="date" value={roundForm.target_discharge_date || ''} onChange={e => setRoundForm({ ...roundForm, target_discharge_date: e.target.value })} />
     </div>
     <div style={s.formGroup}>
      <label style={s.label}>Clinician Name</label>
      <input style={s.input} value={roundForm.clinician_name} onChange={e => setRoundForm({ ...roundForm, clinician_name: e.target.value })} />
     </div>
     <div style={s.formGroup}>
      <label style={s.label}>Round Date / Time</label>
      <input style={s.input} type="datetime-local" value={roundForm.note_date} onChange={e => setRoundForm({ ...roundForm, note_date: e.target.value })} />
     </div>
    </div>
    <div style={{ background: '#F8FBF9', borderRadius: 10, padding: 12, border: '1px solid #E1F5EE', marginBottom: 14 }}>
     <div style={{ fontWeight: 700, color: '#0F6E56', marginBottom: 6 }}>Latest Vitals Snapshot</div>
     <div style={{ fontSize: 12, color: '#444' }}>
      BP {bedVitals?.bp_systolic ? `${bedVitals.bp_systolic}/${bedVitals.bp_diastolic || ''}` : '—'} • Pulse {bedVitals?.pulse_bpm || '—'} • Temp {bedVitals?.temperature_c || '—'} • SpO2 {bedVitals?.oxygen_sat || '—'}
     </div>
    </div>
    <div style={s.formGroup}>
     <label style={s.label}>Plan for Today</label>
     <textarea style={{ ...s.input, minHeight: 110, resize: 'vertical' }} value={roundForm.plan_for_today} onChange={e => setRoundForm({ ...roundForm, plan_for_today: e.target.value })} placeholder="Assessment, investigations, consultant review, antibiotics, discharge goals..." />
    </div>
   </div>
   <div style={s.modalFooter}>
    <button style={s.cancelBtn} onClick={() => setShowRoundModal(false)}>Cancel</button>
    <button style={s.submitBtn} onClick={handleSaveRoundNote} disabled={saving}>{saving ? 'Saving...' : 'Save Round Note'}</button>
   </div>
  </div>
 </div>
 )}

 {/* ===== ADD WARD MODAL ===== */}
 {showAddWard && (
 <div style={s.overlay} onClick={() => setShowAddWard(false)}>
 <div style={{ ...s.modal, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
 <div style={s.modalHeader}>
 <h2 style={s.modalTitle}>Add New Ward</h2>
 <button style={s.closeBtn} onClick={() => setShowAddWard(false)}></button>
 </div>
 <div style={s.modalBody}>
 <div style={s.formGroup}>
 <label style={s.label}>Ward Name *</label>
 <input style={s.input} placeholder="e.g. General Ward A, ICU Block 1" value={wardForm.name} onChange={e => setWardForm({ ...wardForm, name: e.target.value })} />
 </div>
 <div style={s.formGrid2}>
 <div style={s.formGroup}>
 <label style={s.label}>Ward Type</label>
 <select style={s.input} value={wardForm.ward_type} onChange={e => setWardForm({ ...wardForm, ward_type: e.target.value })}>
 {WARD_TYPES.map(t => <option key={t}>{t}</option>)}
 </select>
 </div>
 <div style={s.formGroup}>
 <label style={s.label}>Floor / Block</label>
 <input style={s.input} placeholder="e.g. 1, Ground, B" value={wardForm.floor} onChange={e => setWardForm({ ...wardForm, floor: e.target.value })} />
 </div>
 </div>
 <div style={s.formGroup}>
 <label style={s.label}>Description (optional)</label>
 <input style={s.input} placeholder="e.g. For post-surgical female patients" value={wardForm.description} onChange={e => setWardForm({ ...wardForm, description: e.target.value })} />
 </div>
 </div>
 <div style={s.modalFooter}>
 <button style={s.cancelBtn} onClick={() => setShowAddWard(false)}>Cancel</button>
 <button
  style={{ ...s.submitBtn, ...(canManageWards ? {} : s.btnDisabled) }}
  onClick={handleAddWard}
  disabled={saving || !canManageWards}
  title="Only admins can create wards">{saving ? 'Saving...' : '+ Create Ward'}</button>
 </div>
 </div>
 </div>
 )}

 {/* ===== ADD BEDS MODAL ===== */}
 {showAddBeds && (
 <div style={s.overlay} onClick={() => setShowAddBeds(false)}>
 <div style={{ ...s.modal, maxWidth: 460 }} onClick={e => e.stopPropagation()}>
 <div style={s.modalHeader}>
 <h2 style={s.modalTitle}>Generate Beds — {selectedWard?.name}</h2>
 <button style={s.closeBtn} onClick={() => setShowAddBeds(false)}></button>
 </div>
 <div style={s.modalBody}>
 <div style={{ background: '#E3F0FB', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#1a6fb5', marginBottom: 16 }}>
 💡 Beds will be named: <strong>{bedGenForm.prefix || 'B'}{String(bedGenForm.start).padStart(2, '0')}</strong> to <strong>{bedGenForm.prefix || 'B'}{String(bedGenForm.end).padStart(2, '0')}</strong>
 &nbsp;= <strong>{Math.max(0, bedGenForm.end - bedGenForm.start + 1)} beds</strong>
 </div>
 <div style={s.formGrid2}>
 <div style={s.formGroup}>
 <label style={s.label}>Bed Prefix *</label>
 <input style={s.input} placeholder="e.g. ICU, B, G, OC" value={bedGenForm.prefix} onChange={e => setBedGenForm({ ...bedGenForm, prefix: e.target.value.toUpperCase() })} />
 </div>
 <div style={s.formGroup}>
 <label style={s.label}>Start Number *</label>
 <input style={s.input} type="number" min={1} value={bedGenForm.start} onChange={e => setBedGenForm({ ...bedGenForm, start: parseInt(e.target.value) || 1 })} />
 </div>
 <div style={s.formGroup}>
 <label style={s.label}>End Number *</label>
 <input style={s.input} type="number" min={1} max={500} value={bedGenForm.end} onChange={e => setBedGenForm({ ...bedGenForm, end: parseInt(e.target.value) || 10 })} />
 </div>
 </div>
 <div style={{ fontSize: 12, color: '#888' }}>Max 500 beds per batch. Run multiple batches for larger wards.</div>
 </div>
 <div style={s.modalFooter}>
 <button style={s.cancelBtn} onClick={() => setShowAddBeds(false)}>Cancel</button>
 <button
  style={{ ...s.submitBtn, ...(canManageWards ? {} : s.btnDisabled) }}
  onClick={handleGenerateBeds}
  disabled={saving || !canManageWards}
  title="Only admins can add beds to wards">{saving ? 'Generating...' : ` Generate ${Math.max(0, bedGenForm.end - bedGenForm.start + 1)} Beds`}</button>
 </div>
 </div>
 </div>
 )}

 {/* ===== TRANSFER MODAL ===== */}
 {showTransfer && (
 <div style={s.overlay} onClick={() => setShowTransfer(false)}>
 <div style={{ ...s.modal, maxWidth: 460 }} onClick={e => e.stopPropagation()}>
 <div style={s.modalHeader}>
 <h2 style={s.modalTitle}>Request Bed Transfer</h2>
 <button style={s.closeBtn} onClick={() => setShowTransfer(false)}></button>
 </div>
 <div style={s.modalBody}>
 <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
 <strong>{bedPatient?.full_name}</strong> from Bed <strong>{selectedBed?.bed_number}</strong>
 </div>
 <div style={s.formGroup}>
 <label style={s.label}>Target Ward</label>
 <select style={s.input} value={transferForm.to_ward_id} onChange={e => setTransferForm({ ...transferForm, to_ward_id: e.target.value, to_bed_id: '' })}>
 <option value="">-- Select Ward --</option>
 {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
 </select>
 </div>
 {transferForm.to_ward_id && (
 <div style={s.formGroup}>
 <label style={s.label}>Target Bed (Free beds only)</label>
 <select style={s.input} value={transferForm.to_bed_id} onChange={e => setTransferForm({ ...transferForm, to_bed_id: e.target.value })}>
 <option value="">-- Select Bed --</option>
 {beds.filter(b => b.ward_id === transferForm.to_ward_id && b.status === 'Free').map(b => (
 <option key={b.id} value={b.id}>{b.bed_number}</option>
 ))}
 </select>
 </div>
 )}
 <div style={s.formGroup}>
 <label style={s.label}>Requested By *</label>
 <input style={s.input} placeholder="Dr. / Nurse name" value={transferForm.requested_by} onChange={e => setTransferForm({ ...transferForm, requested_by: e.target.value })} />
 </div>
 <div style={s.formGroup}>
 <label style={s.label}>Reason</label>
 <input style={s.input} placeholder="e.g. Patient condition worsened" value={transferForm.reason} onChange={e => setTransferForm({ ...transferForm, reason: e.target.value })} />
 </div>
 </div>
 <div style={s.modalFooter}>
 <button style={s.cancelBtn} onClick={() => setShowTransfer(false)}>Cancel</button>
 <button
  style={{ ...s.submitBtn, ...(canTransfer ? {} : s.btnDisabled) }}
  onClick={handleTransfer}
  disabled={saving || !canTransfer}
  title="Only doctors and nurses can transfer admitted patients">{saving ? 'Submitting...' : '⇄ Submit Transfer Request'}</button>
 </div>
 </div>
 </div>
 )}

 {/* ===== DISCHARGE MODAL ===== */}
 {showDischarge && (
 <div style={s.overlay} onClick={() => setShowDischarge(false)}>
 <div style={{ ...s.modal, maxWidth: 440 }} onClick={e => e.stopPropagation()}>
 <div style={s.modalHeader}>
 <h2 style={s.modalTitle}>Discharge Patient</h2>
 <button style={s.closeBtn} onClick={() => setShowDischarge(false)}></button>
 </div>
 <div style={s.modalBody}>
 <div style={{ background: '#FCEBEB', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#A32D2D', marginBottom: 14 }}>
 This will discharge <strong>{bedPatient?.full_name}</strong> from Bed <strong>{selectedBed?.bed_number}</strong> and mark the visit as Completed.
 </div>
 <div style={{ background: dischargeChecklist.canDischarge ? '#E1F5EE' : '#FFF3DC', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: dischargeChecklist.canDischarge ? '#0F6E56' : '#C07000', marginBottom: 14, border: `1px solid ${dischargeChecklist.canDischarge ? '#9FE1CB' : '#FAC775'}` }}>
 {dischargeChecklist.canDischarge
 ? 'The discharge checklist is complete. You can complete discharge.'
 : `Discharge is blocked: ${dischargeChecklist.openInvoices.length} open invoice(s), ${dischargeChecklist.unbilledLabs.length} unbilled lab test(s), or pending checklist items still need action.`}
 <div style={{ marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
 <span>Pending labs: {dischargeChecklist.pendingLabResults.length}</span>
 <span>Unreleased Rx: {dischargeChecklist.unreleasedPrescriptions.length}</span>
 <span>Pharmacy balances: {dischargeChecklist.pharmacyBalance.length}</span>
 <span>Checklist: {dischargeChecklist.readyCount}/{dischargeChecklist.checklistItems.length}</span>
 </div>
 </div>
 <div style={{ background: '#fff', border: '1px solid #E6ECE8', borderRadius: 10, padding: 12, marginBottom: 14 }}>
  <div style={{ fontSize: 12, fontWeight: 700, color: '#111', marginBottom: 10 }}>Ready for Discharge Checklist</div>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
   {dischargeChecklist.checklistItems.map(item => (
    <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#333' }}>
     <input
      type="checkbox"
      checked={item.checked}
      onChange={e => persistDischargeChecklist({ [item.key]: e.target.checked })}
      disabled={item.key === 'bill_settled' && !dischargeChecklist.canDischarge && (dischargeChecklist.openInvoices.length > 0 || dischargeChecklist.unbilledLabs.length > 0)}
     />
     {item.label}
    </label>
   ))}
  </div>
 </div>
 {!dischargeChecklist.canDischarge && isAdmin && (
  <div style={s.formGroup}>
   <label style={s.label}>Admin Override Reason</label>
   <textarea style={{ ...s.input, minHeight: 72, resize: 'vertical' }} value={dischargeForm.override_reason} onChange={e => persistDischargeChecklist({ override_reason: e.target.value })} placeholder="Reason for bypassing incomplete discharge checklist..." />
  </div>
 )}
 <div style={s.formGroup}>
 <label style={s.label}>Condition on Discharge</label>
 <select style={s.input} value={dischargeForm.condition_on_discharge} onChange={e => setDischargeForm({ ...dischargeForm, condition_on_discharge: e.target.value })}>
 <option>Improved</option>
 <option>Stable</option>
 <option>Transferred</option>
 <option>Against Medical Advice</option>
 <option>Deceased</option>
 </select>
 </div>
 <div style={s.formGroup}>
 <label style={s.label}>Discharge Notes / Summary</label>
 <textarea style={{ ...s.input, height: 100, resize: 'vertical' }} placeholder="Clinical summary, final diagnosis, hospital course..." value={dischargeForm.discharge_notes} onChange={e => setDischargeForm({ ...dischargeForm, discharge_notes: e.target.value })} />
 </div>
 <div style={s.formGroup}>
 <label style={s.label}>Discharge Instructions</label>
 <textarea style={{ ...s.input, height: 90, resize: 'vertical' }} placeholder="Medication instructions, follow-up clinic, danger signs..." value={dischargeForm.discharge_instructions} onChange={e => setDischargeForm({ ...dischargeForm, discharge_instructions: e.target.value })} />
 </div>
 </div>
 <div style={s.modalFooter}>
 <button style={s.cancelBtn} onClick={() => setShowDischarge(false)}>Cancel</button>
 <button
  style={{ ...s.submitBtn, background: dischargeChecklist.canDischarge && canDischarge ? '#A32D2D' : '#BDBDBD' }}
  onClick={handleDischarge}
  disabled={saving || !dischargeChecklist.canDischarge || !canDischarge}
  title="Only doctors and nurses can discharge patients">{saving ? 'Processing...' : ' Confirm Discharge'}</button>
 </div>
 </div>
 </div>
 )}
 </div>
 )
}

const s = {
 page: { padding: '20px 24px', flex: 1, overflowY: 'auto', background: '#f7f8f7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', minHeight: '100vh', boxSizing: 'border-box' },
 loadWrap: { height: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
 spinner: { width: 36, height: 36, border: '3px solid #e8ebe8', borderTop: '3px solid #0F6E56', borderRadius: '50%', animation: 'spin 0.9s linear infinite' },
 header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 },
 title: { fontSize: 24, fontWeight: 800, margin: 0, color: '#111' },
 subtitle: { color: '#777', margin: '4px 0 0', fontSize: 13 },
 backBtn: { background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#555' },
 btn: { background: '#0F6E56', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13 },
 btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
 statsRow: { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' },
 statChip: { borderRadius: 12, padding: '12px 20px', minWidth: 100, textAlign: 'center' },
 chartCard: { background: '#fff', borderRadius: 14, border: '1px solid #E6ECE8', padding: 18, minHeight: 340 },
 wardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 },
 wardCard: { background: '#fff', borderRadius: 14, padding: 18, cursor: 'pointer', transition: 'box-shadow 0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' },
 sectionLabel: { fontSize: 11, fontWeight: 700, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid #E1F5EE' },
 bedGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 8 },
 bedCard: { borderRadius: 8, padding: '8px 4px', cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s', minHeight: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', userSelect: 'none' },
 bedOverlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 950, padding: 24 },
 sidePanel: { width: 'min(880px, calc(100vw - 48px))', flexShrink: 0, background: '#fff', borderRadius: 18, border: '1px solid #E6ECE8', padding: 22, overflowY: 'auto', maxHeight: 'calc(100vh - 56px)', boxShadow: '0 24px 80px rgba(15,23,42,0.22)', animation: 'fadeIn 0.2s ease' },
 sideSectionLabel: { fontSize: 10, fontWeight: 700, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8, marginTop: 2, paddingBottom: 4, borderBottom: '1px solid #E1F5EE' },
 pill: { fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99 },
 chip: { fontSize: 12, padding: '6px 12px', borderRadius: 99, border: '1px solid #e0e0e0', background: '#fff', cursor: 'pointer', fontWeight: 500, color: '#555', whiteSpace: 'nowrap' },
 chipActive: { background: '#0F6E56', color: '#fff', border: '1px solid #0F6E56' },
 pageBtn: { padding: '4px 10px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, color: '#555' },
 empty: { textAlign: 'center', padding: '60px 20px', color: '#999' },
 th: { fontSize: 11, color: '#888', fontWeight: 600, textAlign: 'left', padding: '10px 14px', borderBottom: '2px solid #f0f0f0', textTransform: 'uppercase' },
 td: { fontSize: 13, color: '#333', padding: '10px 14px', verticalAlign: 'middle' },
 overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
 modal: { background: '#fff', borderRadius: 16, width: '100%', maxWidth: 700, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', animation: 'fadeIn 0.2s ease' },
 modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #f0f0f0' },
 modalTitle: { fontSize: 17, fontWeight: 700, margin: 0, color: '#111' },
 closeBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#aaa' },
 modalBody: { padding: '20px 24px', overflowY: 'auto', flex: 1 },
 modalFooter: { padding: '14px 24px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end', gap: 10 },
 formGrid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
 formGroup: { marginBottom: 14 },
 label: { fontSize: 12, color: '#666', display: 'block', marginBottom: 5, fontWeight: 500 },
 inlineHint: { fontSize: 11, color: '#777', marginTop: 4 },
 input: { width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#111', fontFamily: 'inherit' },
 cancelBtn: { padding: '10px 20px', border: '1px solid #ddd', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#555' },
 submitBtn: { padding: '10px 24px', border: 'none', borderRadius: 8, background: '#0F6E56', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
}
