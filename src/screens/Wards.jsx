import { useEffect, useMemo, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import { canPerformAction } from '../access'
import PatientWorkflowCard from '../components/PatientWorkflowCard'
import { buildWorkflowInvoiceNote, createServiceLine, inferInvoiceSource, SERVICE_SOURCES, stringifyServiceLines } from '../utils/workflowBilling'

const WARD_TYPES = ['General', 'ICU', 'Maternity', 'Paediatrics', 'Surgical', 'Cardiac', 'Orthopaedic', 'Oncology', 'Emergency', 'Psychiatric', 'Private', 'Radiology', 'Dental', 'Cardiology', 'Eye', 'Mental Health', 'Physiotherapy', 'Nutrition', 'Community Health']
const WARD_ICONS = { ICU: '', Maternity: '', General: '', Paediatrics: '', Surgical: '', Cardiac: '❤', Orthopaedic: '', Oncology: '', Emergency: '', Psychiatric: '', Private: '', Radiology: '', Dental: '', Cardiology: '❤️', Eye: '', 'Mental Health': '', Physiotherapy: '', Nutrition: '', 'Community Health': '' }
const BED_COLORS = {
 Free: { bg: '#E1F5EE', border: '#9FE1CB', color: '#0F6E56' },
 Occupied: { bg: '#E3F0FB', border: '#90C4F0', color: '#1a6fb5' },
 Critical: { bg: '#FCEBEB', border: '#F09595', color: '#A32D2D' },
 Maintenance: { bg: '#FFF9E6', border: '#FAE080', color: '#8A6A00' },
}
const BEDS_PER_PAGE = 60

function formatKES(value) {
 return `KES ${Number(value || 0).toLocaleString()}`
}

function matchesLabInvoice(invoice, test) {
 if (!invoice || !test) return false
 const haystack = `${invoice.services || ''} ${invoice.notes || ''}`.toLowerCase()
 return invoice.visit_id === test.visit_id && haystack.includes(String(test.test_type || '').toLowerCase())
}

export default function Wards() {
 const { hospitalId, userRole } = useHospital()
 const canManageWards = canPerformAction(userRole, 'create_department')
 const canAdmitPatient = canPerformAction(userRole, 'admit_patient')
 const canDischarge = canPerformAction(userRole, 'discharge_patient')
 const canTransfer = canPerformAction(userRole, 'admit_patient')
 const [wards, setWards] = useState([])
 const [beds, setBeds] = useState([])
 const [transfers, setTransfers] = useState([])
 const [loading, setLoading] = useState(true)
 const [saving, setSaving] = useState(false)

 // Navigation
 const [view, setView] = useState('overview') // overview | ward
 const [selectedWard, setSelectedWard] = useState(null)

 // Bed page & search
 const [bedPage, setBedPage] = useState(1)
 const [bedSearch, setBedSearch] = useState('')
 const [bedFilter, setBedFilter] = useState('All')

 // Selected bed side panel
 const [selectedBed, setSelectedBed] = useState(null)
 const [bedPatient, setBedPatient] = useState(null)
 const [bedVisit, setBedVisit] = useState(null)
 const [bedVitals, setBedVitals] = useState(null)
 const [bedConsultations, setBedConsultations] = useState([])
 const [bedWorkflow, setBedWorkflow] = useState({ invoices: [], labTests: [], prescriptions: [] })

 // Modals
 const [showAddWard, setShowAddWard] = useState(false)
 const [showAddBeds, setShowAddBeds] = useState(false)
 const [showTransfer, setShowTransfer] = useState(false)
 const [showDischarge, setShowDischarge] = useState(false)

 // Forms
 const [wardForm, setWardForm] = useState({ name: '', ward_type: 'General', floor: '', description: '' })
 const [bedGenForm, setBedGenForm] = useState({ prefix: '', start: 1, end: 10 })
 const [transferForm, setTransferForm] = useState({ to_ward_id: '', to_bed_id: '', requested_by: '', reason: '' })
 const [dischargeForm, setDischargeForm] = useState({ discharge_notes: '' })

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
 .subscribe()

 window.addEventListener('remedacare:workflow_changed', localHandler)

 return () => {
  window.removeEventListener('remedacare:workflow_changed', localHandler)
  try { supabase.removeChannel(channel) } catch (_) {}
 }
 }, [hospitalId])

 async function fetchAll() {
 setLoading(true)
 const [{ data: w }, { data: b }, { data: t }] = await Promise.all([
 supabase.from('wards').select('*').eq('hospital_id', hospitalId).order('created_at'),
 supabase.from('beds').select('*, patients(full_name, age, gender, phone, blood_group, allergies, chronic_conditions), visits(visit_number, visit_type, chief_complaint, assigned_doctor_name, speciality, created_at)').eq('hospital_id', hospitalId),
 supabase.from('bed_transfers').select('*, patients(full_name)').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(20),
 ])
 setWards(w || [])
 setBeds(b || [])
 setTransfers(t || [])
 setLoading(false)
 }

async function selectBed(bed) {
 setSelectedBed(bed)
 if (!bed.patient_id) { setBedPatient(null); setBedVisit(null); setBedVitals(null); setBedConsultations([]); setBedWorkflow({ invoices: [], labTests: [], prescriptions: [] }); return }
 const [{ data: v }, { data: vit }, { data: consults }, { data: invoices }, { data: labTests }, { data: prescriptions }] = await Promise.all([
 supabase.from('visits').select('*').eq('id', bed.visit_id).maybeSingle(),
 supabase.from('vitals').select('*').eq('visit_id', bed.visit_id).order('recorded_at', { ascending: false }).limit(1).maybeSingle(),
 supabase.from('consultations').select('*').eq('patient_id', bed.patient_id).order('created_at', { ascending: false }).limit(3),
 supabase.from('invoices').select('*').eq('hospital_id', hospitalId).eq('visit_id', bed.visit_id).order('created_at', { ascending: false }),
 supabase.from('lab_tests').select('*').eq('hospital_id', hospitalId).eq('visit_id', bed.visit_id).order('ordered_at', { ascending: false }),
 supabase.from('prescriptions').select('*').eq('hospital_id', hospitalId).eq('visit_id', bed.visit_id).order('created_at', { ascending: false }),
 ])
 setBedPatient(bed.patients)
 setBedVisit(v)
 setBedVitals(vit)
 setBedConsultations(consults || [])
 setBedWorkflow({ invoices: invoices || [], labTests: labTests || [], prescriptions: prescriptions || [] })
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

async function handleDischarge() {
 if (!selectedBed) return
 if (!canDischarge) {
 window.notifyFromLegacyAlert('Only doctors, nurses and admins can discharge patients.')
 return
 }
 if (!dischargeChecklist.canDischarge) {
 window.notifyFromLegacyAlert('Discharge is blocked until billing reconciliation is complete. Clear unpaid balances and any unbilled lab charges first.')
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

 await supabase.from('beds').update({ status: 'Free', patient_id: null, visit_id: null, admitted_at: null, notes: dischargeForm.discharge_notes }).eq('id', selectedBed.id)
 await supabase.from('visits').update({
 status: 'Completed',
 discharged_at: new Date().toISOString(),
 discharge_notes: dischargeForm.discharge_notes || null,
 }).eq('id', selectedBed.visit_id)
 await supabase.from('admissions').update({
 discharge_date: new Date().toISOString(),
 discharge_notes: dischargeForm.discharge_notes || null,
 status: 'Discharged',
 }).eq('visit_id', selectedBed.visit_id)
 setShowDischarge(false)
 setSelectedBed(null)
 setDischargeForm({ discharge_notes: '' })
 try {
  window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: selectedBed.visit_id, status: 'Completed', source: 'ward-discharge' } }))
 } catch (e) {}
 fetchAll()
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
 free: wb.filter(b => b.status === 'Free').length,
 maintenance: wb.filter(b => b.status === 'Maintenance').length,
 }
 }

 // Beds for selected ward
 const wardBeds = selectedWard ? beds.filter(b => b.ward_id === selectedWard.id) : []
 const filteredBeds = wardBeds.filter(b => {
 const matchSearch = !bedSearch || b.bed_number?.toLowerCase().includes(bedSearch.toLowerCase()) || b.patients?.full_name?.toLowerCase().includes(bedSearch.toLowerCase())
 const matchFilter = bedFilter === 'All' || b.status === bedFilter
 return matchSearch && matchFilter
 })
 const totalPages = Math.ceil(filteredBeds.length / BEDS_PER_PAGE)
 const pagedBeds = filteredBeds.slice((bedPage - 1) * BEDS_PER_PAGE, bedPage * BEDS_PER_PAGE)

 // Global stats
 const totalBeds = beds.length
 const totalOccupied = beds.filter(b => b.status === 'Occupied').length
 const totalCritical = beds.filter(b => b.status === 'Critical').length
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

  return {
   openInvoices,
   unbilledLabs,
   pendingLabResults,
   unreleasedPrescriptions,
   pharmacyBalance,
   canDischarge: openInvoices.length === 0 && unbilledLabs.length === 0,
  }
 }, [bedWorkflow])

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
 ? `${totalBeds} total beds • ${totalOccupied} occupied • ${totalFree} free • ${totalCritical} critical`
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
 {/* Global stat chips */}
 <div style={s.statsRow}>
 {[
 { label: 'Total Beds', value: totalBeds, color: '#333', bg: '#f5f5f5' },
 { label: 'Occupied', value: totalOccupied, color: '#1a6fb5', bg: '#E3F0FB' },
 { label: 'Free', value: totalFree, color: '#0F6E56', bg: '#E1F5EE' },
 { label: 'Critical', value: totalCritical, color: '#A32D2D', bg: '#FCEBEB' },
 { label: 'Transfers Pending', value: pendingTransfers, color: '#C07000', bg: '#FFF3DC' },
 ].map(stat => (
 <div key={stat.label} style={{ ...s.statChip, background: stat.bg }}>
 <div style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</div>
 <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{stat.label}</div>
 </div>
 ))}
 </div>

 {/* Ward cards */}
 {wards.length === 0 ? (
 <div style={s.empty}>
 <div style={{ fontSize: 48 }}></div>
 <div style={{ fontWeight: 600, color: '#555', marginTop: 12 }}>No wards yet</div>
 <div style={{ color: '#999', fontSize: 13, marginTop: 4 }}>Click "+ Add Ward" to create your first ward</div>
 </div>
 ) : (
 <div style={s.wardGrid}>
 {wards.map(ward => {
 const st = wardStats(ward.id)
 const pct = st.total > 0 ? Math.round((st.occupied + st.critical) / st.total * 100) : 0
 const icon = WARD_ICONS[ward.ward_type] || ''
 const isFull = pct >= 90
 return (
 <div key={ward.id} style={{ ...s.wardCard, border: isFull ? '2px solid #F09595' : '1px solid #eee' }} onClick={() => { setSelectedWard(ward); setView('ward'); setSelectedBed(null); setBedPage(1); setBedSearch(''); setBedFilter('All') }}>
 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
 <div>
 <div style={{ fontSize: 13, color: '#888', marginBottom: 2 }}>{ward.ward_type}{ward.floor ? ` • Floor ${ward.floor}` : ''}</div>
 <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{ward.name}</div>
 </div>
 <span style={{ fontSize: 24 }}>{icon}</span>
 </div>
 <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
 <span style={{ ...s.pill, background: '#E3F0FB', color: '#1a6fb5' }}>{st.occupied} occupied</span>
 <span style={{ ...s.pill, background: '#E1F5EE', color: '#0F6E56' }}>{st.free} free</span>
 {st.critical > 0 && <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D' }}> {st.critical} critical</span>}
 {st.maintenance > 0 && <span style={{ ...s.pill, background: '#FFF9E6', color: '#8A6A00' }}>{st.maintenance} maint.</span>}
 </div>
 {/* Occupancy bar */}
 <div style={{ background: '#f0f0f0', borderRadius: 99, height: 6, overflow: 'hidden', marginBottom: 8 }}>
 <div style={{ width: `${pct}%`, height: '100%', background: isFull ? '#E24B4A' : '#0F6E56', borderRadius: 99, transition: 'width 0.4s' }} />
 </div>
 <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888' }}>
 <span>{st.total} total beds</span>
 <span style={{ color: isFull ? '#A32D2D' : '#0F6E56', fontWeight: 600 }}>{pct}% full</span>
 </div>
 <div style={{ marginTop: 10, fontSize: 12, color: '#0F6E56', fontWeight: 600 }}>View Bed Map →</div>
 </div>
 )
 })}
 </div>
 )}

 {/* Pending transfers */}
 {transfers.filter(t => t.status === 'Pending').length > 0 && (
 <div style={{ marginTop: 24 }}>
 <div style={s.sectionLabel}>⏳ Pending Bed Transfers</div>
 <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #eee', overflow: 'hidden' }}>
 <table style={{ width: '100%', borderCollapse: 'collapse' }}>
 <thead>
 <tr style={{ background: '#f8f9fa' }}>
 {['Patient', 'From', 'To', 'Requested By', 'Reason', 'Action'].map(h => (
 <th key={h} style={s.th}>{h}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {transfers.filter(t => t.status === 'Pending').map(t => (
 <tr key={t.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
 <td style={s.td}>{t.patients?.full_name || '—'}</td>
 <td style={s.td}>{t.from_ward}</td>
 <td style={s.td}>{t.to_ward}</td>
 <td style={s.td}>{t.requested_by}</td>
 <td style={s.td}>{t.reason || '—'}</td>
 <td style={s.td}>
 <button
  style={{ ...s.pill, background: '#E1F5EE', color: '#0F6E56', cursor: canTransfer ? 'pointer' : 'not-allowed', border: 'none', fontWeight: 700, opacity: canTransfer ? 1 : 0.5 }}
  onClick={() => handleApproveTransfer(t)}
  disabled={!canTransfer}
  title="Only doctors and nurses can approve bed transfers"> Approve</button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}
 </>
 )}

 {/* WARD BED MAP VIEW */}
 {view === 'ward' && selectedWard && (
 <div style={{ display: 'flex', gap: 16, minHeight: 0 }}>
 {/* BED GRID */}
 <div style={{ flex: 1, minWidth: 0 }}>
 {/* Controls */}
 <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
 <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
 <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13 }}></span>
 <input style={{ ...s.input, paddingLeft: 30 }} placeholder="Search bed number or patient name..." value={bedSearch} onChange={e => { setBedSearch(e.target.value); setBedPage(1) }} />
 </div>
 {['All', 'Free', 'Occupied', 'Critical', 'Maintenance'].map(f => (
 <button key={f} style={{ ...s.chip, ...(bedFilter === f ? s.chipActive : {}) }} onClick={() => { setBedFilter(f); setBedPage(1) }}>
 {f} ({f === 'All' ? wardBeds.length : wardBeds.filter(b => b.status === f).length})
 </button>
 ))}
 </div>

 {/* Legend */}
 <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
 {Object.entries(BED_COLORS).map(([status, colors]) => (
 <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#666' }}>
 <div style={{ width: 12, height: 12, borderRadius: 3, background: colors.bg, border: `2px solid ${colors.border}` }} />
 {status}
 </div>
 ))}
 </div>

 {pagedBeds.length === 0 ? (
 <div style={s.empty}>
 <div style={{ fontSize: 40 }}></div>
 <div style={{ color: '#888', marginTop: 8 }}>No beds found</div>
 <button
  style={{ ...s.btn, marginTop: 12, ...(canManageWards ? {} : s.btnDisabled) }}
  onClick={() => setShowAddBeds(true)}
  disabled={!canManageWards}
  title="Only admins can add beds to wards">+ Generate Beds</button>
 </div>
 ) : (
 <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 16 }}>
 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
 <div style={{ fontSize: 13, color: '#888' }}>Showing {(bedPage - 1) * BEDS_PER_PAGE + 1}–{Math.min(bedPage * BEDS_PER_PAGE, filteredBeds.length)} of {filteredBeds.length} beds</div>
 {totalPages > 1 && (
 <div style={{ display: 'flex', gap: 6 }}>
 <button style={s.pageBtn} onClick={() => setBedPage(p => Math.max(1, p - 1))} disabled={bedPage === 1}>←</button>
 {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map(p => (
 <button key={p} style={{ ...s.pageBtn, ...(p === bedPage ? { background: '#0F6E56', color: '#fff', border: '1px solid #0F6E56' } : {}) }} onClick={() => setBedPage(p)}>{p}</button>
 ))}
 <button style={s.pageBtn} onClick={() => setBedPage(p => Math.min(totalPages, p + 1))} disabled={bedPage === totalPages}>→</button>
 </div>
 )}
 </div>
 <div style={s.bedGrid}>
 {pagedBeds.map(bed => {
 const bc = BED_COLORS[bed.status] || BED_COLORS.Free
 const isSelected = selectedBed?.id === bed.id
 return (
 <div key={bed.id}
 style={{ ...s.bedCard, background: bc.bg, border: isSelected ? `3px solid #0F6E56` : `2px solid ${bc.border}`, color: bc.color, boxShadow: isSelected ? '0 0 0 3px rgba(15,110,86,0.2)' : 'none' }}
 onClick={() => selectBed(bed)}
 title={bed.patients?.full_name || bed.status}
 >
 <div style={{ fontSize: 11, fontWeight: 700 }}>{bed.bed_number}</div>
 {bed.patients?.full_name && (
 <div style={{ fontSize: 9, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
 {bed.patients.full_name.split(' ')[0]}
 </div>
 )}
 {bed.status === 'Critical' && <div style={{ fontSize: 8, marginTop: 1 }}></div>}
 {bed.status === 'Maintenance' && <div style={{ fontSize: 8, marginTop: 1 }}>🔧</div>}
 </div>
 )
 })}
 </div>
 </div>
 )}
 </div>

 {/* SIDE PANEL — bed detail */}
 {selectedBed && (
 <div style={s.sidePanel}>
 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
 <div style={{ fontWeight: 700, fontSize: 16, color: '#111' }}>Bed {selectedBed.bed_number}</div>
 <button style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#aaa' }} onClick={() => setSelectedBed(null)}></button>
 </div>

 {/* Status badge + change */}
 <div style={{ marginBottom: 14 }}>
 <div style={{ fontSize: 11, color: '#888', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>Status</div>
 <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
 {['Free', 'Occupied', 'Critical', 'Maintenance'].map(st => (
 <button
 key={st}
 style={{ ...s.pill, cursor: canManageWards ? 'pointer' : 'not-allowed', border: 'none', background: selectedBed.status === st ? BED_COLORS[st].border : '#f0f0f0', color: selectedBed.status === st ? BED_COLORS[st].color : '#888', fontWeight: selectedBed.status === st ? 700 : 400, opacity: canManageWards ? 1 : 0.5 }}
 onClick={() => setBedStatus(selectedBed, st)}
 disabled={!canManageWards}
 title="Only admins can update bed status">{st}</button>
 ))}
 </div>
 </div>

 {!bedPatient ? (
 <div style={{ textAlign: 'center', padding: '32px 0', color: '#bbb' }}>
 <div style={{ fontSize: 32 }}></div>
 <div style={{ marginTop: 8, fontSize: 13 }}>Bed is {selectedBed.status.toLowerCase()}</div>
 </div>
 ) : (
 <>
 {/* Patient card */}
 <PatientWorkflowCard
  patientName={bedPatient.full_name}
  patient={bedPatient}
  visit={{
   visit_number: bedVisit?.visit_number,
   visit_type: bedVisit?.visit_type,
   assigned_doctor_name: bedVisit?.assigned_doctor_name,
   speciality: bedVisit?.speciality,
   chief_complaint: bedVisit?.chief_complaint,
   ward: selectedWard?.name,
   bed_no: selectedBed?.bed_number,
  }}
  latestVitals={bedVitals}
  badges={[
   { label: selectedBed.status, bg: BED_COLORS[selectedBed.status]?.bg || '#F3F4F6', color: BED_COLORS[selectedBed.status]?.color || '#6B7280' },
   ...(selectedBed.admitted_at ? [{ label: `${daysAdmitted(selectedBed.admitted_at)} admitted`, bg: '#EFF6FF', color: '#1D4ED8' }] : []),
  ]}
  accentColor={BED_COLORS[selectedBed.status]?.border || '#0F6E56'}
  background="#EAF6F1"
 />

 {/* Visit info */}
 {bedVisit && (
 <div style={{ marginBottom: 14 }}>
 <div style={s.sideSectionLabel}>Visit Info</div>
 <div style={{ fontSize: 12, color: '#444', display: 'flex', flexDirection: 'column', gap: 4 }}>
 <div><span style={{ color: '#888' }}>Visit: </span>{bedVisit.visit_number}</div>
 <div><span style={{ color: '#888' }}>Type: </span>{bedVisit.visit_type}</div>
 {bedVisit.chief_complaint && <div><span style={{ color: '#888' }}>Complaint: </span>{bedVisit.chief_complaint}</div>}
 {bedVisit.assigned_doctor_name && <div><span style={{ color: '#888' }}>Doctor: </span>Dr. {bedVisit.assigned_doctor_name}</div>}
 {bedVisit.speciality && <div><span style={{ color: '#888' }}>Speciality: </span>{bedVisit.speciality}</div>}
 </div>
 </div>
 )}

 {/* Billing reconciliation */}
 <div style={{ marginBottom: 14 }}>
 <div style={s.sideSectionLabel}>Discharge Reconciliation</div>
 <div style={{ background: dischargeChecklist.canDischarge ? '#E1F5EE' : '#FEF2F2', border: `1px solid ${dischargeChecklist.canDischarge ? '#9FE1CB' : '#F5B4B4'}`, borderRadius: 10, padding: '10px 12px' }}>
 <div style={{ fontSize: 12, fontWeight: 700, color: dischargeChecklist.canDischarge ? '#0F6E56' : '#A32D2D' }}>
 {dischargeChecklist.canDischarge ? 'Ready for discharge clearance' : 'Discharge blocked until billing is cleared'}
 </div>
 <div style={{ fontSize: 11, color: '#555', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
 <div>Open invoices: <strong>{dischargeChecklist.openInvoices.length}</strong>{dischargeChecklist.openInvoices.length > 0 ? ` · ${formatKES(dischargeChecklist.openInvoices.reduce((sum, inv) => sum + Number(inv.balance_kes || 0), 0))}` : ''}</div>
 <div>Unbilled lab tests: <strong>{dischargeChecklist.unbilledLabs.length}</strong></div>
 <div>Pending lab results: <strong>{dischargeChecklist.pendingLabResults.length}</strong></div>
 <div>Unreleased prescriptions: <strong>{dischargeChecklist.unreleasedPrescriptions.length}</strong></div>
 </div>
 </div>
 </div>

 {/* Vitals */}
 {bedVitals && (
 <div style={{ marginBottom: 14 }}>
 <div style={s.sideSectionLabel}>Latest Vitals</div>
 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
 {[
 ['BP', bedVitals.bp_systolic ? `${bedVitals.bp_systolic}/${bedVitals.bp_diastolic}` : null],
 ['Pulse', bedVitals.pulse_bpm ? `${bedVitals.pulse_bpm} bpm` : null],
 ['Temp', bedVitals.temperature_c ? `${bedVitals.temperature_c}°C` : null],
 ['SpO2', bedVitals.oxygen_sat ? `${bedVitals.oxygen_sat}%` : null],
 ['Weight', bedVitals.weight_kg ? `${bedVitals.weight_kg} kg` : null],
 ['Sugar', bedVitals.blood_sugar ? `${bedVitals.blood_sugar} mmol/L` : null],
 ].filter(([, v]) => v).map(([label, val]) => (
 <div key={label} style={{ background: '#f9fafb', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
 <div style={{ color: '#888', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
 <div style={{ fontWeight: 700, color: '#111', marginTop: 2 }}>{val}</div>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Recent consultations */}
 {bedConsultations.length > 0 && (
 <div style={{ marginBottom: 14 }}>
 <div style={s.sideSectionLabel}>Recent Diagnosis</div>
 {bedConsultations.slice(0, 2).map(c => (
 <div key={c.id} style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px', marginBottom: 6, fontSize: 12 }}>
 <div style={{ fontWeight: 700, color: '#111' }}>{c.diagnosis}</div>
 <div style={{ color: '#888', marginTop: 2 }}>Dr. {c.doctor_name} • {new Date(c.created_at).toLocaleDateString('en-KE')}</div>
 {c.treatment_plan && <div style={{ color: '#555', marginTop: 4, fontSize: 11 }}>{c.treatment_plan}</div>}
 </div>
 ))}
 </div>
 )}

 {/* Actions */}
 <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
 {selectedBed && selectedBed.status === 'Free' && !selectedBed.patient_id && (
 <button
  style={{ ...s.btn, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #F09595', width: '100%', ...(canManageWards ? {} : s.btnDisabled) }}
  onClick={() => handleDeleteBed(selectedBed)}
  disabled={saving || !canManageWards}
  title="Only admins can delete beds">Delete Bed</button>
 )}
 <button
  style={{ ...s.btn, width: '100%', ...(canTransfer ? {} : s.btnDisabled) }}
  onClick={() => setShowTransfer(true)}
  disabled={!selectedBed?.patient_id || !canTransfer}
  title="Only doctors and nurses can transfer admitted patients">⇄ Request Transfer</button>
 <button
  style={{ ...s.btn, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #F09595', width: '100%', opacity: dischargeChecklist.canDischarge && canDischarge ? 1 : 0.7, cursor: canDischarge ? 'pointer' : 'not-allowed' }}
  onClick={() => setShowDischarge(true)}
  disabled={!canDischarge}
  title="Only doctors and nurses can discharge patients"> Discharge Patient</button>
 </div>
 </>
 )}
 </div>
 )}
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
 ? 'Billing reconciliation is clear. You can complete discharge.'
 : `Discharge is blocked: ${dischargeChecklist.openInvoices.length} open invoice(s) and ${dischargeChecklist.unbilledLabs.length} unbilled lab test(s) still need reconciliation.`}
 <div style={{ marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
 <span>Pending labs: {dischargeChecklist.pendingLabResults.length}</span>
 <span>Unreleased Rx: {dischargeChecklist.unreleasedPrescriptions.length}</span>
 <span>Pharmacy balances: {dischargeChecklist.pharmacyBalance.length}</span>
 </div>
 </div>
 <div style={s.formGroup}>
 <label style={s.label}>Discharge Notes / Summary</label>
 <textarea style={{ ...s.input, height: 100, resize: 'vertical' }} placeholder="Discharge condition, follow-up instructions..." value={dischargeForm.discharge_notes} onChange={e => setDischargeForm({ discharge_notes: e.target.value })} />
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
 wardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 },
 wardCard: { background: '#fff', borderRadius: 14, padding: 18, cursor: 'pointer', transition: 'box-shadow 0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' },
 sectionLabel: { fontSize: 11, fontWeight: 700, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid #E1F5EE' },
 bedGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 8 },
 bedCard: { borderRadius: 8, padding: '8px 4px', cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s', minHeight: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', userSelect: 'none' },
 sidePanel: { width: 300, flexShrink: 0, background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 18, overflowY: 'auto', maxHeight: 'calc(100vh - 140px)', animation: 'slideIn 0.2s ease' },
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
 input: { width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#111', fontFamily: 'inherit' },
 cancelBtn: { padding: '10px 20px', border: '1px solid #ddd', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#555' },
 submitBtn: { padding: '10px 24px', border: 'none', borderRadius: 8, background: '#0F6E56', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
}
