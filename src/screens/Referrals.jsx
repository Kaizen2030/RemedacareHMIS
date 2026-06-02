import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { renderToStaticMarkup } from 'react-dom/server'
import PaginationBar, { paginateItems } from '../components/PaginationBar'
import { buildFunctionUrl, fetchFhirBundle } from '../utils/fhir/client'
import { findIcd10ByCode, searchIcd10Diagnoses } from '../utils/icd10Kenya'
import { resolveRole } from '../access'
import { useHospital } from '../context'
import supabase from '../supabase'
import { colors as C, typography } from '../theme'

const COMMON_FACILITIES = [
  'Kenyatta National Hospital',
  'Moi Teaching and Referral Hospital',
  'Kenyatta University Teaching, Referral and Research Hospital',
  'Aga Khan University Hospital',
  'MP Shah Hospital',
  "Gertrude's Children Hospital",
  'Nairobi Hospital',
  'Mama Lucy Kibaki Hospital',
  'Mbagathi County Hospital',
  'Coast General Teaching and Referral Hospital',
  'Jaramogi Oginga Odinga Teaching and Referral Hospital',
  'Kisii Teaching and Referral Hospital',
  'Machakos Level 5 Hospital',
  'Nakuru County Referral Hospital',
]

const URGENCY_META = {
  Routine: { bg: C.blueL, color: C.blue },
  Urgent: { bg: C.warnL, color: C.warnDark },
  Emergency: { bg: C.dangerL, color: C.dangerDark },
}

const STATUS_META = {
  Draft: { bg: C.panel, color: C.subStrong },
  Sent: { bg: C.blueL, color: C.blue },
  Received: { bg: C.warnL, color: C.warnDark },
  Completed: { bg: C.successL, color: C.primaryDark },
  Declined: { bg: C.dangerL, color: C.dangerDark },
}

const STATUS_OPTIONS = ['Draft', 'Sent', 'Received', 'Completed', 'Declined']
const URGENCY_OPTIONS = ['Routine', 'Urgent', 'Emergency']
const TAB_OPTIONS = ['Outgoing', 'Incoming', 'All']

function emptyMedicationRow() {
  return { name: '', dose: '', route: '', time: '' }
}

function emptyReferralForm(hospitalName = '') {
  return {
    visit_id: '',
    patient_id: '',
    patient_name: '',
    patient_age: '',
    patient_gender: '',
    referring_doctor: '',
    referring_facility: hospitalName || '',
    receiving_facility: '',
    receiving_fhir_endpoint: '',
    receiving_department: '',
    referral_reason: '',
    clinical_summary: '',
    diagnosis_icd10: '',
    diagnosis_label: '',
    urgency: 'Routine',
    status: 'Draft',
    transport_arranged: false,
    transport_notes: '',
    vitals_at_referral: {
      bp: '',
      pulse: '',
      temp: '',
      spo2: '',
      rr: '',
    },
    medications_given: [emptyMedicationRow()],
    referral_date: new Date().toISOString().slice(0, 10),
  }
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('en-KE') : '—'
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function parseStatusNotes(value) {
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function createStatusNote(status, note, author) {
  return {
    status,
    note: String(note || '').trim(),
    author: author || '',
    at: new Date().toISOString(),
  }
}

function buildReferralQrValue(referral) {
  return JSON.stringify({
    resourceType: 'Reference',
    reference: `Bundle/${referral.visit_id || referral.id}`,
    fhirEndpoint: buildFunctionUrl('fhir-bundle', { hospitalId: referral.hospital_id, visitId: referral.visit_id || '' }),
  })
}

function DiagnosisPicker({ value, label, onCodeChange, disabled = false }) {
  const [query, setQuery] = useState(value?.label || '')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setQuery(value?.label || '')
  }, [value?.label])

  useEffect(() => {
    const term = String(query || '').trim()
    if (term.length < 2) {
      setResults([])
      return undefined
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      const matches = await searchIcd10Diagnoses(term, { signal: controller.signal })
      setResults(matches.slice(0, 8))
    }, 220)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  function applyMatch(item) {
    onCodeChange(item.code, item.description)
    setQuery(item.description)
    setOpen(false)
  }

  return (
    <div style={{ marginBottom: 14, position: 'relative' }}>
      <div style={labelStyle}>{label}</div>
      <input
        style={inputStyle}
        value={query}
        disabled={disabled}
        placeholder="Search ICD-10 diagnosis"
        onFocus={() => setOpen(true)}
        onChange={e => {
          setQuery(e.target.value)
          onCodeChange('', e.target.value)
          setOpen(true)
        }}
      />
      {value?.code ? (
        <div style={{ position: 'absolute', right: 10, top: 36, background: C.primaryL, color: C.primaryDark, border: `1px solid ${C.accent}`, borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 800 }}>
          {value.code}
        </div>
      ) : null}
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: '0 18px 40px rgba(15,23,42,.14)', overflow: 'hidden', zIndex: 20 }}>
          {results.map(item => (
            <button
              key={item.code}
              type="button"
              onClick={() => applyMatch(item)}
              style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: '11px 12px', cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}
            >
              <div style={{ fontSize: 12, fontWeight: 800, color: C.primary }}>{item.code}</div>
              <div style={{ fontSize: 12.5, color: C.text, marginTop: 3 }}>{item.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ReferralLetter({ referral, hospitalName, hospitalProfile }) {
  const logo = hospitalProfile?.logoBase64
    ? `<img src="${hospitalProfile.logoBase64}" alt="Hospital logo" style="width:72px;height:72px;object-fit:cover;border-radius:16px;border:1px solid #E5E7EB;" />`
    : `<div style="width:72px;height:72px;border:2px dashed #94A3B8;border-radius:16px;display:flex;align-items:center;justify-content:center;color:#64748B;font-size:11px;">Logo</div>`

  const meds = Array.isArray(referral.medications_given) ? referral.medications_given : []
  const medsMarkup = meds.length
    ? meds.map((item) => `<li>${[item.name, item.dose, item.route, item.time].filter(Boolean).join(' • ')}</li>`).join('')
    : '<li>None documented</li>'

  const vitals = referral.vitals_at_referral || {}
  const qrMarkup = renderToStaticMarkup(
    <QRCodeSVG value={buildReferralQrValue(referral)} size={96} fgColor="#5B21B6" bgColor="#FFFFFF" />
  )

  return `
    <html>
      <head>
        <title>Referral Letter</title>
        <style>
          body{font-family:Arial,sans-serif;margin:0;padding:22px;color:#111827;background:#fff}
          .letter{max-width:920px;margin:0 auto}
          .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #5B21B6;padding-bottom:18px;margin-bottom:20px}
          .title{font-size:30px;font-weight:800;color:#5B21B6;margin:0}
          .sub{font-size:13px;color:#64748B;margin-top:6px;line-height:1.5}
          .badge{display:inline-block;padding:6px 12px;border-radius:999px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;background:${URGENCY_META[referral.urgency || 'Routine'].bg};color:${URGENCY_META[referral.urgency || 'Routine'].color};margin-top:10px}
          .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 20px;margin-bottom:18px}
          .card{border:1px solid #E5E7EB;border-radius:12px;padding:12px 14px;background:#fff}
          .label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#6B7280;font-weight:800;margin-bottom:4px}
          .value{font-size:14px;line-height:1.55}
          .section{margin-bottom:18px}
          .section-title{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#5B21B6;font-weight:800;margin:0 0 8px}
          .big{font-size:15px;font-weight:700}
          ul{margin:8px 0 0 18px}
          .footer{margin-top:28px;display:grid;grid-template-columns:1fr 120px;gap:24px;align-items:end}
          .signature-line{margin-top:56px;border-top:1px solid #111827;padding-top:8px;width:260px}
          @media print { body{padding:0} .letter{padding:16mm} }
        </style>
      </head>
      <body>
        <div class="letter">
          <div class="header">
            <div>
              <h1 class="title">${hospitalName || referral.referring_facility || 'Brightpath Travel Scholars'}</h1>
              <div class="sub">Kenya MOH Referral Letter<br/>Referring facility: ${referral.referring_facility || hospitalName || '—'}</div>
              <div class="badge">${referral.urgency || 'Routine'} referral</div>
            </div>
            <div>${logo}</div>
          </div>

          <div class="grid">
            <div class="card"><div class="label">Patient Name</div><div class="value big">${referral.patient_name || '—'}</div></div>
            <div class="card"><div class="label">Referral Date</div><div class="value">${formatDate(referral.referral_date || referral.created_at)}</div></div>
            <div class="card"><div class="label">Age / Gender</div><div class="value">${referral.patient_age || '—'} / ${referral.patient_gender || '—'}</div></div>
            <div class="card"><div class="label">Receiving Facility</div><div class="value">${referral.receiving_facility || '—'}</div></div>
            <div class="card"><div class="label">Receiving Department</div><div class="value">${referral.receiving_department || '—'}</div></div>
            <div class="card"><div class="label">Referring Doctor</div><div class="value">${referral.referring_doctor || '—'}</div></div>
          </div>

          <div class="section">
            <div class="section-title">Clinical Summary</div>
            <div class="card"><div class="value">${String(referral.clinical_summary || 'No clinical summary provided.').replace(/\n/g, '<br/>')}</div></div>
          </div>

          <div class="grid">
            <div class="card"><div class="label">Diagnosis</div><div class="value">${referral.diagnosis_label || '—'}${referral.diagnosis_icd10 ? ` (${referral.diagnosis_icd10})` : ''}</div></div>
            <div class="card"><div class="label">Referral Reason</div><div class="value">${referral.referral_reason || '—'}</div></div>
          </div>

          <div class="section">
            <div class="section-title">Vitals at Referral</div>
            <div class="grid">
              <div class="card"><div class="label">Blood Pressure</div><div class="value">${vitals.bp || '—'}</div></div>
              <div class="card"><div class="label">Pulse</div><div class="value">${vitals.pulse || '—'}</div></div>
              <div class="card"><div class="label">Temperature</div><div class="value">${vitals.temp || '—'}</div></div>
              <div class="card"><div class="label">SpO2 / RR</div><div class="value">${vitals.spo2 || '—'} / ${vitals.rr || '—'}</div></div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Medications Given Before Referral</div>
            <div class="card"><ul>${medsMarkup}</ul></div>
          </div>

          <div class="grid">
            <div class="card"><div class="label">Transport Arranged</div><div class="value">${referral.transport_arranged ? 'Yes' : 'No'}</div></div>
            <div class="card"><div class="label">Transport Notes</div><div class="value">${referral.transport_notes || '—'}</div></div>
          </div>

          <div class="footer">
            <div>
              <div class="label">Doctor Signature</div>
              <div class="signature-line">${referral.referring_doctor || 'Doctor'}</div>
            </div>
            <div>${qrMarkup}</div>
          </div>
        </div>
        <script>setTimeout(()=>window.print(),400)</script>
      </body>
    </html>
  `
}

export default function Referrals() {
  const { hospitalId, hospitalName, hospitalProfile, userRole, navigationState, clearNavigationState } = useHospital()
  const normalizedRole = resolveRole(userRole)
  const canCreate = normalizedRole === 'Doctor' || normalizedRole === 'Admin' || normalizedRole === 'Nurse'
  const canUpdate = normalizedRole === 'Doctor' || normalizedRole === 'Admin'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [patients, setPatients] = useState([])
  const [referrals, setReferrals] = useState([])
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResultsLimit, setPatientResultsLimit] = useState(12)
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [form, setForm] = useState(() => emptyReferralForm(hospitalName))
  const [latestVitals, setLatestVitals] = useState(null)
  const [tab, setTab] = useState('Outgoing')
  const [search, setSearch] = useState('')
  const [referralsPage, setReferralsPage] = useState(1)
  const [selectedReferralId, setSelectedReferralId] = useState(null)
  const [statusNote, setStatusNote] = useState('')
  const [responseModal, setResponseModal] = useState(null)

  async function loadData() {
    if (!hospitalId) return
    setLoading(true)
    const [{ data: patientRows }, { data: referralRows }] = await Promise.all([
      supabase.from('patients').select('id, full_name, age, gender, phone, patient_number').eq('hospital_id', hospitalId).order('full_name'),
      supabase.from('referrals').select('*').eq('hospital_id', hospitalId).order('created_at', { ascending: false }),
    ])
    setPatients(patientRows || [])
    setReferrals(referralRows || [])
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [hospitalId])

  useEffect(() => {
    setForm(current => ({ ...current, referring_facility: hospitalName || current.referring_facility || '' }))
  }, [hospitalName])

  useEffect(() => {
    if (!selectedPatient) return
    setForm(current => ({
      ...current,
      patient_id: selectedPatient.id,
      patient_name: selectedPatient.full_name || '',
      patient_age: selectedPatient.age || '',
      patient_gender: selectedPatient.gender || '',
    }))
  }, [selectedPatient])

  useEffect(() => {
    if (!navigationState || navigationState.screen !== 'referrals' || patients.length === 0) return
    const matchedPatient =
      patients.find(patient => String(patient.id) === String(navigationState.patientId || '')) ||
      patients.find(patient => String(patient.full_name || '').trim().toLowerCase() === String(navigationState.patientName || '').trim().toLowerCase())

    if (matchedPatient) {
      setSelectedPatient(matchedPatient)
      setPatientSearch(matchedPatient.full_name || '')
    }

    setForm(current => ({
      ...current,
      visit_id: navigationState.visitId || current.visit_id,
      patient_id: matchedPatient?.id || current.patient_id,
      patient_name: matchedPatient?.full_name || navigationState.patientName || current.patient_name,
      patient_age: matchedPatient?.age || current.patient_age,
      patient_gender: matchedPatient?.gender || current.patient_gender,
      referring_doctor: navigationState.doctorName || current.referring_doctor,
      diagnosis_icd10: navigationState.diagnosisCode || current.diagnosis_icd10,
      diagnosis_label: navigationState.diagnosisLabel || current.diagnosis_label,
      clinical_summary: navigationState.clinicalSummary || current.clinical_summary,
      referral_reason: navigationState.referralReason || current.referral_reason,
      urgency: navigationState.urgency || current.urgency,
    }))
    clearNavigationState?.()
  }, [navigationState, patients, clearNavigationState])

  useEffect(() => {
    if (!hospitalId || !selectedPatient?.id) return
    let cancelled = false
    const loadVitals = async () => {
      const { data } = await supabase
        .from('vitals')
        .select('bp_systolic, bp_diastolic, pulse_bpm, temperature_c, oxygen_sat, respiratory_rate, recorded_at')
        .eq('hospital_id', hospitalId)
        .eq('patient_id', selectedPatient.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      setLatestVitals(data || null)
      if (data) {
        setForm(current => ({
          ...current,
          vitals_at_referral: {
            bp: data.bp_systolic ? `${data.bp_systolic}/${data.bp_diastolic || ''}` : current.vitals_at_referral.bp,
            pulse: data.pulse_bpm ? `${data.pulse_bpm} bpm` : current.vitals_at_referral.pulse,
            temp: data.temperature_c ? `${data.temperature_c} °C` : current.vitals_at_referral.temp,
            spo2: data.oxygen_sat ? `${data.oxygen_sat}%` : current.vitals_at_referral.spo2,
            rr: data.respiratory_rate ? `${data.respiratory_rate}/min` : current.vitals_at_referral.rr,
          },
        }))
      }
    }
    void loadVitals()
    return () => { cancelled = true }
  }, [hospitalId, selectedPatient?.id])

  useEffect(() => {
    let cancelled = false
    const loadUser = async () => {
      const { data } = await supabase.auth.getUser()
      if (cancelled) return
      setForm(current => ({
        ...current,
        referring_doctor: current.referring_doctor || data?.user?.user_metadata?.full_name || data?.user?.email || '',
      }))
    }
    void loadUser()
    return () => { cancelled = true }
  }, [])

  const filteredPatients = useMemo(() => {
    const term = normalizeText(patientSearch)
    if (!term) return patients
    return patients.filter(patient =>
      [patient.full_name, patient.phone, patient.patient_number]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [patientSearch, patients])

  const visiblePatients = useMemo(
    () => filteredPatients.slice(0, patientResultsLimit),
    [filteredPatients, patientResultsLimit],
  )

  const filteredReferrals = useMemo(() => {
    const term = normalizeText(search)
    return referrals.filter(referral => {
      const outgoing = normalizeText(referral.referring_facility) === normalizeText(hospitalName)
      const incoming = normalizeText(referral.receiving_facility) === normalizeText(hospitalName)
      if (tab === 'Outgoing' && !outgoing) return false
      if (tab === 'Incoming' && !incoming) return false
      if (!term) return true
      return [referral.patient_name, referral.receiving_facility, referral.referring_facility]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
  }, [referrals, tab, search, hospitalName])

  const pagedReferrals = useMemo(
    () => paginateItems(filteredReferrals, referralsPage, 12),
    [filteredReferrals, referralsPage],
  )

  const selectedReferral = useMemo(
    () => filteredReferrals.find(item => item.id === selectedReferralId) || filteredReferrals[0] || null,
    [filteredReferrals, selectedReferralId],
  )

  useEffect(() => {
    if (!selectedReferral && filteredReferrals[0]) setSelectedReferralId(filteredReferrals[0].id)
  }, [filteredReferrals, selectedReferral])

  useEffect(() => {
    setReferralsPage(1)
  }, [tab, search])

  useEffect(() => {
    setPatientResultsLimit(12)
  }, [patientSearch])

  const stats = useMemo(() => {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const thisMonth = referrals.filter(item => new Date(item.created_at).getTime() >= monthStart.getTime())
    return {
      totalSent: thisMonth.filter(item => normalizeText(item.referring_facility) === normalizeText(hospitalName)).length,
      pending: referrals.filter(item => ['draft', 'sent', 'received'].includes(normalizeText(item.status))).length,
      completed: referrals.filter(item => normalizeText(item.status) === 'completed').length,
      emergency: referrals.filter(item => normalizeText(item.urgency) === 'emergency').length,
    }
  }, [referrals, hospitalName])

  function updateForm(key, value) {
    setForm(current => ({ ...current, [key]: value }))
  }

  function updateVitalField(key, value) {
    setForm(current => ({
      ...current,
      vitals_at_referral: {
        ...(current.vitals_at_referral || {}),
        [key]: value,
      },
    }))
  }

  function updateMedication(index, key, value) {
    setForm(current => ({
      ...current,
      medications_given: (current.medications_given || []).map((item, itemIndex) => (
        itemIndex === index ? { ...item, [key]: value } : item
      )),
    }))
  }

  function addMedicationRow() {
    setForm(current => ({
      ...current,
      medications_given: [...(current.medications_given || []), emptyMedicationRow()],
    }))
  }

  function removeMedicationRow(index) {
    setForm(current => ({
      ...current,
      medications_given: (current.medications_given || []).filter((_, itemIndex) => itemIndex !== index),
    }))
  }

  async function handleCreateReferral() {
    if (!canCreate) {
      window.notifyFromLegacyAlert('You do not have permission to create referrals.')
      return
    }
    if (!form.patient_id || !form.receiving_facility || !form.clinical_summary || !form.referral_reason) {
      window.notifyFromLegacyAlert('Patient, receiving facility, clinical summary and referral reason are required.')
      return
    }

    setSaving(true)
    const { error } = await supabase.from('referrals').insert({
      hospital_id: hospitalId,
      visit_id: form.visit_id || null,
      patient_id: form.patient_id,
      patient_name: form.patient_name,
      patient_age: String(form.patient_age || ''),
      patient_gender: form.patient_gender || '',
      referring_doctor: form.referring_doctor || '',
      referring_facility: form.referring_facility || hospitalName || '',
      receiving_facility: form.receiving_facility,
      receiving_fhir_endpoint: form.receiving_fhir_endpoint || null,
      receiving_department: form.receiving_department || null,
      referral_reason: form.referral_reason,
      clinical_summary: form.clinical_summary,
      diagnosis_icd10: form.diagnosis_icd10 || null,
      diagnosis_label: form.diagnosis_label || null,
      urgency: form.urgency,
      status: form.status || 'Draft',
      transport_arranged: Boolean(form.transport_arranged),
      transport_notes: form.transport_notes || null,
      vitals_at_referral: form.vitals_at_referral || {},
      medications_given: (form.medications_given || []).filter(item => Object.values(item || {}).some(Boolean)),
      referral_date: form.referral_date,
      status_notes: [createStatusNote(form.status || 'Draft', 'Referral created', form.referring_doctor || userRole)],
    })
    setSaving(false)
    if (error) {
      window.notifyFromLegacyAlert(`Unable to save referral: ${error.message}`)
      return
    }
    await loadData()
    setForm(emptyReferralForm(hospitalName))
    setSelectedPatient(null)
    window.notifyFromLegacyAlert('Referral created successfully.')
  }

  async function handleUpdateStatus(nextStatus) {
    if (!canUpdate || !selectedReferral) {
      window.notifyFromLegacyAlert('Only Doctor and Admin can update referral status.')
      return
    }

    const currentNotes = parseStatusNotes(selectedReferral.status_notes)
    const payload = {
      status: nextStatus,
      updated_at: new Date().toISOString(),
      status_notes: [...currentNotes, createStatusNote(nextStatus, statusNote, form.referring_doctor || selectedReferral.referring_doctor)],
    }
    if (nextStatus === 'Received') payload.received_at = new Date().toISOString()
    if (nextStatus === 'Completed') payload.completed_at = new Date().toISOString()

    const { error } = await supabase.from('referrals').update(payload).eq('id', selectedReferral.id)
    if (error) {
      window.notifyFromLegacyAlert(`Unable to update referral status: ${error.message}`)
      return
    }
    setStatusNote('')
    await loadData()
    window.notifyFromLegacyAlert(`Referral marked as ${nextStatus}.`)
  }

  function printReferral(referral) {
    const win = window.open('', '_blank', 'width=980,height=820')
    if (!win) return
    win.document.write(ReferralLetter({ referral, hospitalName: hospitalName || referral.referring_facility, hospitalProfile }))
    win.document.close()
  }

  async function handleSendViaFhir(referral) {
    if (!canUpdate) {
      window.notifyFromLegacyAlert('Only Doctor and Admin can send referral bundles.')
      return
    }
    if (!referral?.visit_id) {
      window.notifyFromLegacyAlert('This referral is not linked to a visit yet.')
      return
    }
    if (!referral?.receiving_fhir_endpoint) {
      window.notifyFromLegacyAlert('Enter the receiving facility FHIR endpoint first.')
      return
    }

    try {
      const bundle = await fetchFhirBundle({ hospitalId, visitId: referral.visit_id })
      const endpoint = `${String(referral.receiving_fhir_endpoint).replace(/\/$/, '')}/Bundle`
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/fhir+json',
          Accept: 'application/fhir+json',
        },
        body: JSON.stringify(bundle),
      })
      const raw = await response.text()
      let parsed = {}
      try {
        parsed = raw ? JSON.parse(raw) : {}
      } catch {
        parsed = { raw }
      }

      const fhirSendStatus = response.ok ? 'Sent via FHIR' : 'Send failed'
      const { error } = await supabase
        .from('referrals')
        .update({
          status: response.ok ? 'Sent' : referral.status,
          updated_at: new Date().toISOString(),
          fhir_send_status: fhirSendStatus,
          fhir_send_response: parsed,
          fhir_sent_at: response.ok ? new Date().toISOString() : referral.fhir_sent_at,
          status_notes: [
            ...parseStatusNotes(referral.status_notes),
            createStatusNote(response.ok ? 'Sent' : referral.status, response.ok ? `FHIR referral sent to ${referral.receiving_facility}` : `FHIR send failed (${response.status})`, referral.referring_doctor || userRole),
          ],
        })
        .eq('id', referral.id)
      if (error) throw error
      await loadData()
      if (response.ok) {
        window.notifyFromLegacyAlert(`Referral bundle sent to ${referral.receiving_facility}.`)
      } else {
        setResponseModal({ title: `FHIR send failed · ${referral.patient_name}`, payload: parsed })
        window.notifyFromLegacyAlert('FHIR send failed. Review the response for details.')
      }
    } catch (error) {
      setResponseModal({ title: `FHIR send failed · ${referral.patient_name}`, payload: { error: error instanceof Error ? error.message : 'Unknown error' } })
      window.notifyFromLegacyAlert(error instanceof Error ? error.message : 'Unable to send referral via FHIR.')
    }
  }

  return (
    <div style={pageStyle}>
      <div style={{ display: 'grid', gap: 18 }}>
        <div style={{ ...cardStyle, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div style={eyebrowStyle}>Clinical</div>
              <h1 style={{ margin: '6px 0 0', fontSize: 28, fontWeight: 800, color: C.textStrong }}>Referral Management</h1>
              <div style={{ fontSize: 13, color: C.sub, marginTop: 8, lineHeight: 1.6 }}>
                Structured patient referrals, facility handoff tracking, and Kenya MOH-style printable referral letters.
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {[
            ['Total sent this month', stats.totalSent],
            ['Pending', stats.pending],
            ['Completed', stats.completed],
            ['Emergency', stats.emergency],
          ].map(([label, value]) => (
            <div key={label} style={{ ...cardStyle, padding: '16px 18px' }}>
              <div style={{ fontSize: 11, color: C.sub, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 800 }}>{label}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: C.textStrong, marginTop: 8 }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 18, alignItems: 'start' }}>
          <section style={{ ...cardStyle, padding: 18, position: 'sticky', top: 18, maxHeight: 'calc(100vh - 48px)', overflowY: 'auto' }}>
            <div style={eyebrowStyle}>Create referral</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.textStrong, marginBottom: 14 }}>New referral</div>

            <Field label="Find patient">
              <input style={inputStyle} value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Search by patient name, phone, number" />
            </Field>

            <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
              {visiblePatients.map(patient => {
                const active = selectedPatient?.id === patient.id
                return (
                  <button
                    key={patient.id}
                    type="button"
                    onClick={() => setSelectedPatient(patient)}
                    style={{
                      textAlign: 'left',
                      padding: '11px 13px',
                      borderRadius: 14,
                      border: active ? `1px solid ${C.primary}` : `1px solid ${C.border}`,
                      background: active ? C.primaryL : C.surface,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 800, color: C.text }}>{patient.full_name}</div>
                    <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>{patient.phone || patient.patient_number || 'No phone'}</div>
                  </button>
                )
              })}
            </div>
            {filteredPatients.length > visiblePatients.length ? (
              <button
                type="button"
                onClick={() => setPatientResultsLimit(current => current + 12)}
                style={{ ...ghostBtn, width: '100%', marginBottom: 14 }}
              >
                Load more patients ({filteredPatients.length - visiblePatients.length} more)
              </button>
            ) : null}

            <div style={grid2}>
              <Field label="Patient Age">
                <input style={inputStyle} value={form.patient_age} disabled />
              </Field>
              <Field label="Patient Gender">
                <input style={inputStyle} value={form.patient_gender} disabled />
              </Field>
            </div>

            <div style={grid2}>
              <Field label="Referring Doctor">
                <input style={inputStyle} value={form.referring_doctor} disabled={!canCreate} onChange={e => updateForm('referring_doctor', e.target.value)} />
              </Field>
              <Field label="Referral Date">
                <input type="date" style={inputStyle} value={form.referral_date} disabled={!canCreate} onChange={e => updateForm('referral_date', e.target.value)} />
              </Field>
            </div>

            <div style={grid2}>
              <Field label="Referring Facility">
                <input style={inputStyle} value={form.referring_facility} disabled />
              </Field>
              <Field label="Receiving Department">
                <input style={inputStyle} value={form.receiving_department} disabled={!canCreate} onChange={e => updateForm('receiving_department', e.target.value)} placeholder="e.g. ICU, Orthopaedics" />
              </Field>
            </div>

            <Field label="Receiving Facility">
              <input
                style={inputStyle}
                list="receiving-facilities"
                value={form.receiving_facility}
                disabled={!canCreate}
                onChange={e => updateForm('receiving_facility', e.target.value)}
                placeholder="Select or type receiving facility"
              />
              <datalist id="receiving-facilities">
                {COMMON_FACILITIES.map(item => <option key={item} value={item} />)}
              </datalist>
            </Field>

            <Field label="Receiving Facility FHIR Endpoint (optional)">
              <input
                style={inputStyle}
                value={form.receiving_fhir_endpoint}
                disabled={!canCreate}
                onChange={e => updateForm('receiving_fhir_endpoint', e.target.value)}
                placeholder="https://receiving-hospital.example/fhir"
              />
            </Field>

            <DiagnosisPicker
              label="Diagnosis (ICD-10)"
              value={{ code: form.diagnosis_icd10, label: form.diagnosis_label }}
              disabled={!canCreate}
              onCodeChange={(code, label) => {
                updateForm('diagnosis_icd10', code)
                updateForm('diagnosis_label', label)
              }}
            />

            <Field label="Urgency">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {URGENCY_OPTIONS.map(item => {
                  const active = form.urgency === item
                  const tone = URGENCY_META[item]
                  return (
                    <button
                      key={item}
                      type="button"
                      disabled={!canCreate}
                      onClick={() => updateForm('urgency', item)}
                      style={{
                        borderRadius: 999,
                        border: active ? `1px solid ${tone.color}` : `1px solid ${C.border}`,
                        background: active ? tone.bg : C.surface,
                        color: active ? tone.color : C.text,
                        padding: '8px 12px',
                        cursor: canCreate ? 'pointer' : 'not-allowed',
                        fontWeight: 800,
                        fontSize: 12,
                      }}
                    >
                      {item}
                    </button>
                  )
                })}
              </div>
            </Field>

            <Field label="Referral Reason">
              <textarea style={textareaStyle} value={form.referral_reason} disabled={!canCreate} onChange={e => updateForm('referral_reason', e.target.value)} />
            </Field>
            <Field label="Clinical Summary">
              <textarea style={{ ...textareaStyle, minHeight: 110 }} value={form.clinical_summary} disabled={!canCreate} onChange={e => updateForm('clinical_summary', e.target.value)} />
            </Field>

            <div style={{ marginBottom: 14 }}>
              <div style={labelStyle}>Vitals snapshot</div>
              <div style={{ ...cardInset, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input style={inputStyle} value={form.vitals_at_referral.bp || ''} disabled={!canCreate} onChange={e => updateVitalField('bp', e.target.value)} placeholder="BP" />
                <input style={inputStyle} value={form.vitals_at_referral.pulse || ''} disabled={!canCreate} onChange={e => updateVitalField('pulse', e.target.value)} placeholder="Pulse" />
                <input style={inputStyle} value={form.vitals_at_referral.temp || ''} disabled={!canCreate} onChange={e => updateVitalField('temp', e.target.value)} placeholder="Temperature" />
                <input style={inputStyle} value={form.vitals_at_referral.spo2 || ''} disabled={!canCreate} onChange={e => updateVitalField('spo2', e.target.value)} placeholder="SpO2" />
                <input style={inputStyle} value={form.vitals_at_referral.rr || ''} disabled={!canCreate} onChange={e => updateVitalField('rr', e.target.value)} placeholder="Respiratory rate" />
                <div style={{ fontSize: 11, color: C.sub, alignSelf: 'center' }}>
                  {latestVitals ? `Pulled from latest vitals on ${formatDateTime(latestVitals.recorded_at)}` : 'No recent vitals found'}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={labelStyle}>Medications given before referral</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {(form.medications_given || []).map((row, index) => (
                  <div key={index} style={{ ...cardInset, padding: 12 }}>
                    <div style={{ ...grid2, marginBottom: 10 }}>
                      <input style={inputStyle} value={row.name} disabled={!canCreate} onChange={e => updateMedication(index, 'name', e.target.value)} placeholder="Medication" />
                      <input style={inputStyle} value={row.dose} disabled={!canCreate} onChange={e => updateMedication(index, 'dose', e.target.value)} placeholder="Dose" />
                    </div>
                    <div style={{ ...grid2, marginBottom: 10 }}>
                      <input style={inputStyle} value={row.route} disabled={!canCreate} onChange={e => updateMedication(index, 'route', e.target.value)} placeholder="Route" />
                      <input style={inputStyle} value={row.time} disabled={!canCreate} onChange={e => updateMedication(index, 'time', e.target.value)} placeholder="Time given" />
                    </div>
                    {(form.medications_given || []).length > 1 && (
                      <button type="button" disabled={!canCreate} onClick={() => removeMedicationRow(index)} style={{ ...ghostBtn, color: C.dangerDark, border: `1px solid ${C.dangerSoft}` }}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" disabled={!canCreate} onClick={addMedicationRow} style={{ ...ghostBtn, marginTop: 10 }}>+ Add medication</button>
            </div>

            <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.text }}>
                <input type="checkbox" checked={Boolean(form.transport_arranged)} disabled={!canCreate} onChange={e => updateForm('transport_arranged', e.target.checked)} />
                Transport arranged
              </label>
              <textarea style={textareaStyle} value={form.transport_notes} disabled={!canCreate} onChange={e => updateForm('transport_notes', e.target.value)} placeholder="Ambulance / escort / transport notes" />
            </div>

            <button
              type="button"
              disabled={!canCreate || saving}
              onClick={handleCreateReferral}
              style={{ ...primaryBtn, width: '100%', opacity: !canCreate || saving ? 0.6 : 1, cursor: !canCreate || saving ? 'not-allowed' : 'pointer' }}
            >
              {saving ? 'Saving...' : 'Create referral'}
            </button>
          </section>

          <section style={{ display: 'grid', gap: 18 }}>
            <div style={{ ...cardStyle, padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {TAB_OPTIONS.map(item => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setTab(item)}
                      style={{
                        borderRadius: 999,
                        border: tab === item ? `1px solid ${C.primary}` : `1px solid ${C.border}`,
                        background: tab === item ? C.primaryL : C.surface,
                        color: tab === item ? C.primaryDark : C.text,
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontWeight: 800,
                        fontSize: 12,
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <input style={{ ...inputStyle, maxWidth: 320 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient or facility" />
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                {pagedReferrals.items.map(referral => {
                  const active = selectedReferral?.id === referral.id
                  const statusTone = STATUS_META[referral.status] || STATUS_META.Draft
                  const urgencyTone = URGENCY_META[referral.urgency] || URGENCY_META.Routine
                  return (
                    <button
                      key={referral.id}
                      type="button"
                      onClick={() => setSelectedReferralId(referral.id)}
                      style={{
                        textAlign: 'left',
                        padding: '13px 14px',
                        borderRadius: 14,
                        border: active ? `1px solid ${C.primary}` : `1px solid ${C.border}`,
                        background: active ? C.primaryL : C.surface,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 800, color: C.text }}>{referral.patient_name}</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ ...pillStyle, background: urgencyTone.bg, color: urgencyTone.color }}>{referral.urgency}</span>
                          <span style={{ ...pillStyle, background: statusTone.bg, color: statusTone.color }}>{referral.status}</span>
                          <span style={{ ...pillStyle, background: referral.fhir_send_status === 'Sent via FHIR' ? C.blueL : referral.fhir_send_status === 'Send failed' ? C.dangerL : C.panel, color: referral.fhir_send_status === 'Sent via FHIR' ? C.blue : referral.fhir_send_status === 'Send failed' ? C.dangerDark : C.subStrong }}>
                            {referral.fhir_send_status || 'Not sent'}
                          </span>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: C.sub, marginTop: 6 }}>
                        {referral.referring_facility} → {referral.receiving_facility || 'Receiving facility not set'}
                      </div>
                      <div style={{ fontSize: 11, color: C.sub, marginTop: 6 }}>
                        {formatDateTime(referral.referral_date || referral.created_at)}
                      </div>
                    </button>
                  )
                })}
                {filteredReferrals.length === 0 && (
                  <div style={{ fontSize: 13, color: C.sub, padding: '14px 6px' }}>No referrals found for this view.</div>
                )}
              </div>
              {filteredReferrals.length > 0 ? (
                <div style={{ marginTop: 14 }}>
                  <PaginationBar
                    page={pagedReferrals.page}
                    totalPages={pagedReferrals.totalPages}
                    totalItems={pagedReferrals.totalItems}
                    pageSize={pagedReferrals.pageSize}
                    onPageChange={setReferralsPage}
                  />
                </div>
              ) : null}
            </div>

            <div style={{ ...cardStyle, padding: 18 }}>
              {selectedReferral ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div>
                      <div style={eyebrowStyle}>Referral details</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: C.textStrong, marginTop: 6 }}>{selectedReferral.patient_name}</div>
                      <div style={{ fontSize: 13, color: C.sub, marginTop: 6 }}>{selectedReferral.receiving_facility || '—'} • {selectedReferral.receiving_department || '—'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => printReferral(selectedReferral)} style={primaryBtn}>Print letter</button>
                      <button type="button" onClick={() => handleSendViaFhir(selectedReferral)} style={ghostBtn}>Send via FHIR</button>
                      {selectedReferral.fhir_send_status === 'Send failed' && (
                        <button type="button" onClick={() => setResponseModal({ title: `FHIR send failed · ${selectedReferral.patient_name}`, payload: selectedReferral.fhir_send_response || {} })} style={ghostBtn}>
                          View Error
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={grid2}>
                    {[
                      ['Diagnosis', `${selectedReferral.diagnosis_label || '—'}${selectedReferral.diagnosis_icd10 ? ` (${selectedReferral.diagnosis_icd10})` : ''}`],
                      ['Referring doctor', selectedReferral.referring_doctor || '—'],
                      ['Referral date', formatDateTime(selectedReferral.referral_date || selectedReferral.created_at)],
                      ['Transport', selectedReferral.transport_arranged ? 'Arranged' : 'Not arranged'],
                      ['FHIR status', selectedReferral.fhir_send_status || 'Not sent'],
                    ].map(([label, value]) => (
                      <div key={label} style={detailCardStyle}>
                        <div style={detailLabelStyle}>{label}</div>
                        <div style={detailValueStyle}>{value}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ ...detailCardStyle, marginTop: 14 }}>
                    <div style={detailLabelStyle}>Clinical summary</div>
                    <div style={detailValueStyle}>{selectedReferral.clinical_summary || '—'}</div>
                  </div>

                  <div style={{ ...detailCardStyle, marginTop: 14 }}>
                    <div style={detailLabelStyle}>Medications given</div>
                    <div style={{ ...detailValueStyle, display: 'grid', gap: 6 }}>
                      {(selectedReferral.medications_given || []).length > 0
                        ? (selectedReferral.medications_given || []).map((item, index) => (
                          <div key={index}>{[item.name, item.dose, item.route, item.time].filter(Boolean).join(' • ')}</div>
                        ))
                        : 'None documented'}
                    </div>
                  </div>

                  <div style={{ ...detailCardStyle, marginTop: 14 }}>
                    <div style={detailLabelStyle}>Status tracking</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, marginBottom: 10 }}>
                      {STATUS_OPTIONS.map(item => {
                        const active = selectedReferral.status === item
                        const tone = STATUS_META[item]
                        return (
                          <button
                            key={item}
                            type="button"
                            disabled={!canUpdate}
                            onClick={() => handleUpdateStatus(item)}
                            style={{
                              borderRadius: 999,
                              border: active ? `1px solid ${tone.color}` : `1px solid ${C.border}`,
                              background: active ? tone.bg : C.surface,
                              color: active ? tone.color : C.text,
                              padding: '8px 12px',
                              cursor: canUpdate ? 'pointer' : 'not-allowed',
                              fontWeight: 800,
                              fontSize: 12,
                              opacity: canUpdate ? 1 : 0.7,
                            }}
                          >
                            {item}
                          </button>
                        )
                      })}
                    </div>
                    <textarea
                      style={textareaStyle}
                      value={statusNote}
                      disabled={!canUpdate}
                      onChange={e => setStatusNote(e.target.value)}
                      placeholder="Add note before changing status"
                    />
                    <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                      {parseStatusNotes(selectedReferral.status_notes).map((item, index) => (
                        <div key={`${item.status}-${item.at}-${index}`} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 12px' }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: C.text }}>{item.status}</div>
                          <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>{formatDateTime(item.at)} • {item.author || '—'}</div>
                          {item.note ? <div style={{ fontSize: 12, color: C.text, marginTop: 6 }}>{item.note}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: C.sub }}>Select a referral from the list to review details and print the letter.</div>
              )}
            </div>
          </section>
        </div>
      </div>
      {responseModal ? (
        <div style={modalBackdropStyle} onClick={() => setResponseModal(null)}>
          <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.textStrong }}>{responseModal.title}</div>
              <button type="button" onClick={() => setResponseModal(null)} style={ghostBtn}>Close</button>
            </div>
            <pre style={{ margin: 0, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {JSON.stringify(responseModal.payload || {}, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const pageStyle = {
  minHeight: '100vh',
  background: C.bg,
  color: C.text,
  fontFamily: typography.fontFamily,
  padding: '20px 24px',
}

const cardStyle = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 18,
  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.04)',
}

const cardInset = {
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
}

const eyebrowStyle = {
  fontSize: 11,
  color: C.primary,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  fontWeight: 800,
}

const labelStyle = {
  fontSize: 11,
  color: C.sub,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  fontWeight: 800,
  marginBottom: 6,
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${C.border}`,
  background: C.surface,
  color: C.text,
  fontSize: 13,
  outline: 'none',
}

const textareaStyle = {
  ...inputStyle,
  minHeight: 86,
  resize: 'vertical',
}

const primaryBtn = {
  border: 'none',
  borderRadius: 10,
  background: C.primary,
  color: '#fff',
  fontWeight: 800,
  fontSize: 13,
  padding: '11px 16px',
  cursor: 'pointer',
}

const ghostBtn = {
  borderRadius: 10,
  background: C.surface,
  border: `1px solid ${C.border}`,
  color: C.text,
  fontWeight: 700,
  fontSize: 12,
  padding: '8px 12px',
  cursor: 'pointer',
}

const grid2 = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
}

const pillStyle = {
  display: 'inline-block',
  padding: '5px 10px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 800,
}

const detailCardStyle = {
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  padding: '12px 14px',
}

const detailLabelStyle = {
  fontSize: 11,
  color: C.sub,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  fontWeight: 800,
  marginBottom: 6,
}

const detailValueStyle = {
  fontSize: 13,
  color: C.text,
  lineHeight: 1.6,
}

const modalBackdropStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 18,
  zIndex: 50,
}

const modalStyle = {
  width: 'min(92vw, 760px)',
  maxHeight: '85vh',
  overflowY: 'auto',
  background: C.surface,
  borderRadius: 18,
  border: `1px solid ${C.border}`,
  boxShadow: '0 24px 50px rgba(15, 23, 42, 0.22)',
  padding: 20,
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  )
}
