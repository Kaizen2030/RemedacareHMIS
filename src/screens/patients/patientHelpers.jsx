// Constants and helpers for the Patients screen (search, duplicates, printing). Moved out of Patients.jsx unchanged.
import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { renderToStaticMarkup } from 'react-dom/server'
import supabase from '../../supabase'
import { useHospital } from '../../context'
import { canAccessScreen, canPerformAction } from '../../access'
import { executeWithFallback, omitKeys } from '../../utils/dbCompat'
import { inferChronicConditionHint } from '../../utils/chronicDisease'
import { buildWorkflowInvoiceNote, createServiceLine, SERVICE_SOURCES, stringifyServiceLines } from '../../utils/workflowBilling'
import { getLabTestsForCategory, LAB_TEST_CATEGORIES } from '../../utils/labCatalog'
import { generateSampleBarcode } from '../../utils/labWorkflow'
import { openRadiologyReportPrintWindow } from '../../utils/radiology'
import { isSelfPayMethod, notifySentToCashier, unpaidInvoiceFields } from '../../utils/payments/invoices'
import { notifyError, notifySuccess, notifyWarning } from '../../notifications'

export const STEPS = ['Registration', 'Vitals', 'Doctor', 'Lab', 'Pharmacy', 'Admission Requested', 'Completed']
export const STEP_COLORS = {
 Registration: { bg: '#E3F0FB', color: '#1a6fb5' },
 Vitals: { bg: '#FFF3DC', color: '#C07000' },
 Doctor: { bg: '#EAF5EF', color: '#7B5EA7' },
 Lab: { bg: '#FCEBEB', color: '#A32D2D' },
 Pharmacy: { bg: '#E1F5EE', color: '#085041' },
 'Admission Requested': { bg: '#DBEAFE', color: '#1D4ED8' },
 Completed: { bg: '#f0f0f0', color: '#555' },
 Admitted: { bg: '#EAF3DE', color: '#3B6D11' },
}

export const AVATAR_COLORS = ['#E1F5EE', '#E3F0FB', '#EAF5EF', '#FFF3DC', '#FCEBEB', '#EAF3DE']
export const BLOOD_GROUP_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown']
export const REGISTRY_FILTER_DEFAULTS = {
 workflow: 'All',
 gender: 'All',
 ageRange: 'All',
 registered: 'all',
 shaMember: 'all',
 outstanding: 'all',
}
export const PATIENT_FOLLOW_UP_STORAGE_KEY = 'remedacare-patient-follow-up'
export const DUPLICATE_SCAN_LIMIT = 400

export function normalizeText(value) {
 return String(value || '').trim().toLowerCase()
}

export function normalizeDigits(value) {
 return String(value || '').replace(/\D/g, '')
}

export function getInitials(name) {
 return String(name || '')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part.charAt(0).toUpperCase())
  .join('') || 'PT'
}

export function hashName(name) {
 return [...String(name || '')].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 0)
}

export function getAvatarStyle(name) {
 const idx = hashName(name) % AVATAR_COLORS.length
 const background = AVATAR_COLORS[idx]
 const textColors = ['#0F6E56', '#1A6FB5', '#7B5EA7', '#C07000', '#A32D2D', '#3B6D11']
 return { background, color: textColors[idx] || '#0F6E56' }
}

export function formatCurrency(value) {
 return `KES ${Number(value || 0).toLocaleString()}`
}

export function formatDateTime(value) {
 return value ? new Date(value).toLocaleString('en-KE') : '—'
}

export function formatDate(value) {
 return value ? new Date(value).toLocaleDateString('en-KE') : '—'
}

export function getAgeBucket(age) {
 const numericAge = Number(age || 0)
 if (!numericAge && numericAge !== 0) return 'Unknown'
 if (numericAge < 18) return 'Child'
 if (numericAge < 60) return 'Adult'
 return 'Senior'
}

export function parseAllergyTags(value) {
 const tokens = Array.isArray(value) ? value : String(value || '').split(/[,;\n]/)
 return [...new Set(tokens.map(token => String(token || '').trim()).filter(Boolean))]
}

export function stringifyAllergyTags(value) {
 return parseAllergyTags(value).join(', ')
}

export function buildPatientSearchFields(patient = {}) {
 return [
  patient.full_name,
  patient.phone,
  patient.phone2,
  patient.national_id,
  patient.huduma_number,
  patient.patient_number,
  patient.mrn,
  patient.guardian_id,
  patient.next_of_kin_phone,
 ].filter(Boolean).join(' ').toLowerCase()
}

export function getPatientPhoneForWhatsApp(patient = {}) {
 const raw = normalizeDigits(patient.phone || patient.phone2 || patient.next_of_kin_phone)
 if (!raw) return ''
 if (raw.startsWith('254')) return raw
 if (raw.startsWith('0')) return `254${raw.slice(1)}`
 return raw
}

export function getRelativeDaysLabel(value) {
 if (!value) return 'Never'
 const days = Math.floor((Date.now() - new Date(value).getTime()) / (1000 * 60 * 60 * 24))
 if (days <= 0) return 'Today'
 if (days === 1) return '1 day ago'
 return `${days} days ago`
}

export function getAgeRangeMatch(age, ageRange) {
 const numericAge = Number(age || 0)
 if (ageRange === 'All') return true
 if (ageRange === 'Child') return numericAge < 18
 if (ageRange === 'Adult') return numericAge >= 18 && numericAge < 60
 if (ageRange === 'Senior') return numericAge >= 60
 return true
}

export function getRegisteredDateMatch(createdAt, filter) {
 if (filter === 'all') return true
 if (!createdAt) return false
 const created = new Date(createdAt)
 const now = new Date()
 const start = new Date()
 if (filter === 'today') start.setHours(0, 0, 0, 0)
 else if (filter === 'week') start.setDate(now.getDate() - 7)
 else if (filter === 'month') start.setDate(now.getDate() - 30)
 else return true
 return created >= start
}

export function loadLocalFollowUpFlags() {
 try {
  return JSON.parse(window.localStorage.getItem(PATIENT_FOLLOW_UP_STORAGE_KEY) || '{}')
 } catch (_) {
  return {}
 }
}

export function saveLocalFollowUpFlags(value) {
 try {
  window.localStorage.setItem(PATIENT_FOLLOW_UP_STORAGE_KEY, JSON.stringify(value || {}))
 } catch (_) {}
}

export function samePhoneFamily(phoneA, phoneB) {
 const a = normalizeDigits(phoneA).slice(-7)
 const b = normalizeDigits(phoneB).slice(-7)
 return a && b && a === b
}

export function detectDuplicatePatientGroups(patients = []) {
 const groups = new Map()
 patients.forEach((patient) => {
  const nameKey = normalizeText(patient.full_name)
  if (!nameKey) return
  const existing = groups.get(nameKey) || []
  existing.push(patient)
  groups.set(nameKey, existing)
 })

 return [...groups.values()]
  .map((group) => group.filter((patient, index, arr) => arr.some(other => other.id !== patient.id && samePhoneFamily(patient.phone, other.phone))))

useEffect(() => {
 const patientId = showDetail?.patient_id
 if (!hospitalId || !patientId) return undefined
 const channel = supabase.channel(`patient-workflow-events-${hospitalId}-${patientId}`)
  .on('postgres_changes', {
   event: 'INSERT',
   schema: 'public',
   table: 'workflow_events',
   filter: `hospital_id=eq.${hospitalId}`,
  }, ({ new: event }) => {
   if (String(event?.patient_id || '') !== String(patientId)) return
   setShowDetail(current => {
    if (!current || String(current.patient_id) !== String(patientId)) return current
    const events = current.workflowEvents || []
    if (events.some(item => item.id === event.id)) return current
    return { ...current, workflowEvents: [event, ...events] }
   })
  })
  .subscribe()
 return () => { void supabase.removeChannel(channel) }
}, [hospitalId, showDetail?.patient_id])
  .filter((group) => group.length > 1)
  .map((group) => {
   const unique = []
   const seen = new Set()
   group.forEach((patient) => {
    if (seen.has(patient.id)) return
    seen.add(patient.id)
    unique.push(patient)
   })
   return unique.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  })
}


// ─── Utility ─────────────────────────────────────────────────────────────────
export function getDateRange(range) {
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
export function printReceipt(hospitalName, hospitalId, patient, visit) {
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
 <div class="foot">Thank you for choosing ${hospitalName||'RemedacareHMS'}<br><strong>Keep this receipt</strong></div>
 </div>
 <script>setTimeout(()=>{window.print();},500)</script>
 </body></html>
 `)
 w.document.close()
}

export function getPatientCardNumber(patient) {
 const raw =
  patient?.patient_number ||
  patient?.mrn ||
  patient?.national_id ||
  (patient?.id ? `PT-${String(patient.id).slice(-6).toUpperCase()}` : 'PT-UNKNOWN')
 return String(raw)
}

export function printPatientIdCard(hospitalName, patient) {
 const patientNumber = getPatientCardNumber(patient)
 const qrMarkup = renderToStaticMarkup(
  <QRCodeSVG
   value={patientNumber}
   size={90}
   marginSize={0}
   fgColor="#0F6E56"
   bgColor="#FFFFFF"
  />
 )

 const w = window.open('', '_blank', 'width=500,height=360')
 if (!w) return
 w.document.write(`
  <html>
   <head>
    <title>Patient ID Card</title>
    <style>
      @page { size: 85.6mm 54mm; margin: 0; }
      body { margin: 0; font-family: Arial, sans-serif; background: #fff; }
      .page { width: 85.6mm; height: 54mm; display: flex; align-items: center; justify-content: center; }
      .card {
        width: 85.6mm;
        height: 54mm;
        box-sizing: border-box;
        border: 1px solid #CDE2D9;
        border-radius: 4mm;
        overflow: hidden;
        background: linear-gradient(180deg, #ffffff 0%, #FAF7FF 100%);
        display: flex;
        flex-direction: column;
      }
      .header { background: #1A6B4A; color: #fff; padding: 4mm 5mm 3mm; }
      .hospital { font-size: 12px; font-weight: 800; letter-spacing: 0.4px; text-transform: uppercase; }
      .sub { font-size: 9px; opacity: 0.92; margin-top: 1mm; }
      .body { display: grid; grid-template-columns: 1fr 24mm; gap: 3mm; padding: 4mm 5mm; flex: 1; }
      .name { font-size: 14px; font-weight: 800; color: #123B2A; line-height: 1.15; margin-bottom: 2mm; }
      .meta-row { font-size: 9.5px; color: #2F3D37; margin-bottom: 1.2mm; }
      .meta-label { color: #597268; font-weight: 700; text-transform: uppercase; letter-spacing: 0.35px; margin-right: 1mm; font-size: 8px; }
      .blood { display: inline-block; margin-top: 1mm; background: #E1F5EE; color: #0F6E56; border: 1px solid #B4E5D0; border-radius: 999px; padding: 1mm 2.2mm; font-size: 8.5px; font-weight: 800; }
      .qr-wrap { display: flex; flex-direction: column; align-items: center; justify-content: space-between; }
      .qr { width: 24mm; height: 24mm; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid #D9E8E1; border-radius: 3mm; padding: 2mm; box-sizing: border-box; }
      .qr svg { width: 100%; height: 100%; }
      .qr-caption { font-size: 7.5px; color: #5B6C65; text-align: center; word-break: break-word; margin-top: 1mm; }
      @media print {
        body * { visibility: hidden; }
        .page, .page * { visibility: visible; }
        .page { position: absolute; left: 0; top: 0; }
      }
    </style>
   </head>
   <body>
    <div class="page">
      <div class="card">
        <div class="header">
          <div class="hospital">${hospitalName || 'RemaCare Hospital'}</div>
          <div class="sub">Official patient identification card</div>
        </div>
        <div class="body">
          <div>
            <div class="name">${patient?.full_name || 'Patient name'}</div>
            <div class="meta-row"><span class="meta-label">MRN</span>${patientNumber}</div>
            <div class="meta-row"><span class="meta-label">DOB</span>${patient?.dob || '—'}</div>
            <div class="meta-row"><span class="meta-label">Gender</span>${patient?.gender || '—'}</div>
            <div class="meta-row"><span class="meta-label">Emergency</span>${patient?.next_of_kin_name || patient?.next_of_kin || '—'}</div>
            <div class="meta-row"><span class="meta-label">Phone</span>${patient?.next_of_kin_phone || '—'}</div>
            <div class="blood">Blood Group: ${patient?.blood_group || 'Not captured'}</div>
          </div>
          <div class="qr-wrap">
            <div class="qr">${qrMarkup}</div>
            <div class="qr-caption">${patientNumber}</div>
          </div>
        </div>
      </div>
    </div>
    <script>setTimeout(() => window.print(), 300)</script>
   </body>
  </html>
 `)
 w.document.close()
}

export function printPatientSummary(hospitalName, patient, timeline = []) {
 const patientNumber = getPatientCardNumber(patient)
 const timelineRows = timeline.length === 0
  ? '<div class="empty">No visit history available.</div>'
  : timeline.map((entry) => {
   const prescriptions = (entry.prescriptions || []).map((rx) => `${rx.drug_name || 'Drug'} ${rx.frequency || ''} ${rx.duration || ''}`.trim()).filter(Boolean)
   const labs = (entry.labTests || []).map((test) => `${test.test_name || test.test_type || 'Lab'}${test.result ? `: ${String(test.result).slice(0, 120)}` : ` (${test.status || 'Pending'})`}`)
   return `
    <div class="visit">
      <div class="visit-head">
        <div>
          <div class="visit-title">${entry.visit_number || 'Visit'} - ${entry.visit_type || 'Visit'}</div>
          <div class="muted">${formatDateTime(entry.created_at)} | ${entry.status || 'Unknown status'}</div>
        </div>
        <div class="visit-amount">${formatCurrency(entry.invoice?.amount_kes || entry.admission_fee || 0)}</div>
      </div>
      <div class="grid">
        <div><span class="label">Doctor</span><span>${entry.assigned_doctor_name || '—'}</span></div>
        <div><span class="label">Diagnosis</span><span>${entry.consultation?.diagnosis || entry.consultation?.icd10_description || entry.doctor_notes || '—'}</span></div>
        <div><span class="label">Payment</span><span>${entry.invoice?.status || entry.admission_payment_method || '—'}</span></div>
        <div><span class="label">Balance</span><span>${formatCurrency(entry.invoice?.balance_kes || 0)}</span></div>
      </div>
      ${prescriptions.length ? `<div class="block"><div class="label">Prescriptions</div><div>${prescriptions.join('<br/>')}</div></div>` : ''}
      ${labs.length ? `<div class="block"><div class="label">Lab Results</div><div>${labs.join('<br/>')}</div></div>` : ''}
    </div>
   `
  }).join('')

 const w = window.open('', '_blank', 'width=980,height=720')
 if (!w) return
 w.document.write(`
  <html>
   <head>
    <title>Patient Summary</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #1F2937; }
      h1 { margin: 0; color: #0F6E56; font-size: 26px; }
      .sub { margin-top: 6px; color: #64748B; font-size: 13px; }
      .hero { border: 2px solid #D9E8E1; border-radius: 14px; padding: 18px 20px; background: linear-gradient(180deg, #FFFFFF 0%, #FAF7FF 100%); margin-bottom: 18px; }
      .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 18px; }
      .meta-card { border: 1px solid #E5E7EB; border-radius: 10px; padding: 10px 12px; background: #fff; }
      .label { display: block; color: #6B7280; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
      .timeline { display: flex; flex-direction: column; gap: 14px; }
      .visit { border: 1px solid #E5E7EB; border-radius: 12px; padding: 14px 16px; background: #fff; }
      .visit-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
      .visit-title { font-size: 15px; font-weight: 800; color: #111827; }
      .visit-amount { font-size: 15px; font-weight: 800; color: #0F6E56; }
      .muted { color: #64748B; font-size: 12px; }
      .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 16px; }
      .block { margin-top: 12px; }
      .empty { padding: 24px; text-align: center; border: 1px dashed #CBD5E1; border-radius: 12px; color: #64748B; }
      @media print {
        body { margin: 0; padding: 14mm; }
      }
    </style>
   </head>
   <body>
    <div class="hero">
      <h1>${hospitalName || 'RemaCare Hospital'}</h1>
      <div class="sub">Patient Summary</div>
      <div class="meta">
        <div class="meta-card"><span class="label">Patient</span>${patient?.full_name || '—'}</div>
        <div class="meta-card"><span class="label">Patient Number</span>${patientNumber}</div>
        <div class="meta-card"><span class="label">Printed</span>${formatDateTime(new Date())}</div>
        <div class="meta-card"><span class="label">Age / Gender</span>${patient?.age || '—'} / ${patient?.gender || '—'}</div>
        <div class="meta-card"><span class="label">Blood Group</span>${patient?.blood_group || '—'}</div>
        <div class="meta-card"><span class="label">Allergies</span>${patient?.allergies || 'None recorded'}</div>
      </div>
    </div>
    <div class="timeline">${timelineRows}</div>
    <script>setTimeout(() => window.print(), 350)</script>
   </body>
  </html>
 `)
 w.document.close()
}

// ─── Main Component ───────────────────────────────────────────────────────────