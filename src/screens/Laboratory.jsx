import { useEffect, useMemo, useState } from 'react'
import { canPerformAction } from '../access'
import supabase from '../supabase'
import { useHospital } from '../context'
import useStaff from '../hooks/useStaff'
import PatientWorkflowCard from '../components/PatientWorkflowCard'
import { executeWithFallback, omitKeys } from '../utils/dbCompat'
import { logAudit } from '../utils/audit'
import { buildWorkflowInvoiceNote, createServiceLine, SERVICE_SOURCES, stringifyServiceLines } from '../utils/workflowBilling'
import {
  deriveMicrobiologyResultSummary,
  getLabTestsForCategory,
  inferMicrobiologySampleType,
  isMicrobiologySensitivityOrder,
  LAB_TEST_CATEGORIES,
} from '../utils/labCatalog'

// ── Microbiology C&S tests that need antibiogram PDF upload instead of simple result entry ──
function isCultureSensitivityTest(testType, category) {
  if (isMicrobiologySensitivityOrder(testType, category)) return true
  const name = String(testType || '').toLowerCase()
  return (
    name.includes('culture') ||
    name.includes('c&s') ||
    name.includes('c & s') ||
    name.includes('sensitivity') ||
    name.includes('susceptibility') ||
    name.includes('antibiogram') ||
    (String(category || '').toLowerCase() === 'microbiology' && (
      name.includes('urine') || name.includes('blood') || name.includes('wound') ||
      name.includes('sputum') || name.includes('csf') || name.includes('hvs') ||
      name.includes('stool') || name.includes('swab')
    ))
  )
}

const STATUS_COLORS = {
  Pending: { bg: '#FFF3DC', color: '#C07000', border: '#FAC775' },
  'In Progress': { bg: '#E3F0FB', color: '#1a6fb5', border: '#90C4F0' },
  Complete: { bg: '#E1F5EE', color: '#0F6E56', border: '#9FE1CB' },
  Critical: { bg: '#FCEBEB', color: '#A32D2D', border: '#F09595' },
}

const PRIORITY_COLORS = {
  Routine: { bg: '#f5f5f5', color: '#666' },
  Urgent: { bg: '#FFF3DC', color: '#C07000' },
  STAT: { bg: '#FCEBEB', color: '#A32D2D' },
}

const PAGE_SIZE = 100
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

function formatKES(value) {
  return `KES ${Number(value || 0).toLocaleString()}`
}

function hasLinkedLabInvoice(invoices, test) {
  if (!test) return false
  const notePrefix = `WF|${SERVICE_SOURCES.LABORATORY}|${test.id}|`
  return invoices.some(inv => {
    const note = String(inv.notes || '')
    if (note.startsWith(notePrefix)) return true
    if (test.visit_id && inv.visit_id === test.visit_id) {
      return String(inv.services || '').toLowerCase().includes(String(test.test_type || '').toLowerCase())
    }
    return false
  })
}

// ── Convert file to base64 ────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function Laboratory() {
  const { hospitalId, userRole, navigate } = useHospital()
  const [tests, setTests] = useState([])
  const [invoices, setInvoices] = useState([])
  const [labChargeCodes, setLabChargeCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterPriority, setFilterPriority] = useState('All')
  const [filterCategory, setFilterCategory] = useState('All')
  const [filterPatient, setFilterPatient] = useState('')
  const [filterSource, setFilterSource] = useState('All')
  const today = new Date().toISOString().split('T')[0]
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)

  const [selected, setSelected] = useState(null)
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [showResultModal, setShowResultModal] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState(false)

  // ── NEW: Antibiogram PDF upload modal ─────────────────────────────────────
  const [showAntibiogramModal, setShowAntibiogramModal] = useState(false)
  const [antibiogramForm, setAntibiogramForm] = useState({
    organism: '',
    sample_type: 'Urine',
    growth: 'Heavy',
    result_summary: '',
    interpretation: '',
    performed_by: '',
    verified_by: '',
    notes: '',
    esbl: false,
    mrsa: false,
    carbapenem_r: false,
  })
  const [antibiogramFile, setAntibiogramFile] = useState(null)
  const [antibiogramFileName, setAntibiogramFileName] = useState('')
  const [antibiogramUploading, setAntibiogramUploading] = useState(false)
  const [antibiogramUploadStep, setAntibiogramUploadStep] = useState('')

  const { staff: allStaff, availableStaff: allAvailableStaff } = useStaff()

  const labStaff = useMemo(() => allStaff.filter(s =>
    s.role_category === 'Laboratory' ||
    s.department === 'Laboratory' ||
    (s.role || '').toLowerCase().includes('lab')
  ), [allStaff])

  const availableLabStaff = useMemo(() =>
    allAvailableStaff.filter(s => labStaff.some(m => m.id === s.id)),
  [allAvailableStaff, labStaff])

  const [orderForm, setOrderForm] = useState({
    patient_name: '', patient_id_text: '', phone: '',
    test_type: '', category: 'Haematology',
    priority: 'Routine', notes: '', ordered_by: '',
    payment_method: 'Cash', mpesa_ref: '', amount: '',
    test_location: 'In-House', assigned_to: '',
  })
  const [customTest, setCustomTest] = useState('')

  const [resultForm, setResultForm] = useState({
    result_text: '', result_value: '', reference_range: '',
    interpretation: '', performed_by: '', result_notes: '',
    result_file_url: '',
  })

  const [assignTech, setAssignTech] = useState('')
  const [customTech, setCustomTech] = useState('')
  const [activeTab, setActiveTab] = useState('tests')

  const [patients, setPatients] = useState([])
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState([])
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [uniquePatients, setUniquePatients] = useState([])
  const [testPage, setTestPage] = useState(1)
  const [testPageSize, setTestPageSize] = useState(PAGE_SIZE)
  const [testTotalCount, setTestTotalCount] = useState(0)
  const [invoicePage, setInvoicePage] = useState(1)
  const [invoicePageSize, setInvoicePageSize] = useState(PAGE_SIZE)
  const [invoiceTotalCount, setInvoiceTotalCount] = useState(0)

  const SAMPLE_TYPES = ['Urine', 'Blood', 'Wound Swab', 'Sputum', 'CSF', 'HVS', 'Stool', 'Other']
  const canPostLabResults = canPerformAction(userRole, 'post_lab_results')

  useEffect(() => {
    if (!hospitalId) { setLoading(false); return }
    fetchPatients(); fetchLabChargeCodes()
  }, [hospitalId])

  useEffect(() => {
    if (!hospitalId) return undefined
    fetchTests(); fetchInvoices()
    const localHandler = () => { fetchTests(); fetchInvoices() }
    const channel = supabase
      .channel(`laboratory-screen-${hospitalId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lab_tests', filter: `hospital_id=eq.${hospitalId}` }, () => fetchTests())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `hospital_id=eq.${hospitalId}` }, () => fetchInvoices())
      .subscribe()
    window.addEventListener('remedacare:workflow_changed', localHandler)
    return () => {
      window.removeEventListener('remedacare:workflow_changed', localHandler)
      try { supabase.removeChannel(channel) } catch (_) {}
    }
  }, [hospitalId])

  useEffect(() => {
    if (!hospitalId) return
    fetchTests(); fetchInvoices()
  }, [hospitalId, dateFrom, dateTo, testPage, testPageSize, invoicePage, invoicePageSize])

  async function fetchTests() {
    setLoading(true)
    const from = dateFrom || today
    const to = dateTo || today
    const start = (testPage - 1) * testPageSize
    const end = testPage * testPageSize - 1
    const { data, count } = await supabase.from('lab_tests')
      .select('*', { count: 'exact' })
      .eq('hospital_id', hospitalId)
      .gte('ordered_at', `${from}T00:00:00`)
      .lte('ordered_at', `${to}T23:59:59`)
      .order('ordered_at', { ascending: false })
      .range(start, end)
    const tests = data || []
    setTests(tests)
    setTestTotalCount(count || 0)
    setUniquePatients([...new Set(tests.map(t => t.patient_name).filter(Boolean))].sort())
    setLoading(false)
  }

  async function fetchInvoices() {
    const from = dateFrom || today
    const to = dateTo || today
    const start = (invoicePage - 1) * invoicePageSize
    const end = invoicePage * invoicePageSize - 1
    const { data, count } = await supabase
      .from('invoices')
      .select('id, visit_id, patient_id, patient_name, invoice_no, services, amount_kes, paid_kes, balance_kes, payment_method, status, notes, created_at', { count: 'exact' })
      .eq('hospital_id', hospitalId)
      .gte('created_at', `${from}T00:00:00`)
      .lte('created_at', `${to}T23:59:59`)
      .order('created_at', { ascending: false })
      .range(start, end)
    setInvoices(data || [])
    setInvoiceTotalCount(count || 0)
  }

  async function fetchLabChargeCodes() {
    const { data } = await supabase
      .from('charge_codes')
      .select('id, code, name, unit_price_kes')
      .eq('hospital_id', hospitalId)
      .eq('category', 'Lab')
      .eq('is_active', true)
    setLabChargeCodes(data || [])
  }

  // ── Match a test name to the best charge_code entry ──────────────────────
  function matchLabChargeCode(testType) {
    if (!testType || !labChargeCodes.length) return null
    const needle = testType.toLowerCase().replace(/[()&\/]/g, ' ').replace(/\s+/g, ' ').trim()
    // 1. Exact name match
    let match = labChargeCodes.find(cc => cc.name.toLowerCase() === needle)
    if (match) return match
    // 2. Charge code name is contained in test name, or vice versa
    match = labChargeCodes.find(cc => {
      const hay = cc.name.toLowerCase().replace(/[()&\/]/g, ' ').replace(/\s+/g, ' ').trim()
      return needle.includes(hay) || hay.includes(needle)
    })
    if (match) return match
    // 3. Keyword overlap — at least 2 significant words in common
    const stopWords = new Set(['test', 'and', 'the', 'of', 'for', 'rapid', 'full', 'count'])
    const needleWords = needle.split(' ').filter(w => w.length > 2 && !stopWords.has(w))
    match = labChargeCodes.find(cc => {
      const hayWords = cc.name.toLowerCase().replace(/[()&\/]/g, ' ').split(' ').filter(w => w.length > 2 && !stopWords.has(w))
      const overlap = needleWords.filter(w => hayWords.some(h => h.startsWith(w) || w.startsWith(h)))
      return overlap.length >= 2
    })
    return match || null
  }

  // ── Auto-create invoice for a doctor-ordered lab test ────────────────────
  async function autoInvoiceLabTest(test) {
    if (!test?.id) return
    // Skip if already invoiced
    if (hasLinkedLabInvoice(invoices, test)) return

    const cc = matchLabChargeCode(test.test_type)
    const amount = cc?.unit_price_kes || 0
    // If no price match and amount is 0, still create a Pending invoice
    // so the billing desk can see and price it — don't silently drop it
    const isInsurance = !['Cash', 'M-Pesa'].includes(test.payment_method || 'Cash')
    const payMethod = test.payment_method || 'Cash'
    const paidAmount = (!isInsurance && amount > 0) ? amount : 0
    const balance = amount - paidAmount
    const status = amount === 0 ? 'Pending' : (balance <= 0 ? 'Paid' : 'Pending')
    const receiptNo = `INV-${Date.now().toString().slice(-6)}`

    await supabase.from('invoices').insert({
      hospital_id: hospitalId,
      patient_id: test.patient_id || null,
      visit_id: test.visit_id || null,
      patient_name: test.patient_name || '',
      invoice_no: receiptNo,
      services: stringifyServiceLines([createServiceLine({
        label: test.test_type,
        qty: 1,
        unitPrice: amount,
        total: amount,
        source: SERVICE_SOURCES.LABORATORY,
        sourceId: test.id,
        visitId: test.visit_id || null,
        meta: { category: test.category, priority: test.priority },
      })]),
      amount_kes: amount,
      paid_kes: paidAmount,
      balance_kes: balance,
      payment_method: payMethod,
      insurer: isInsurance ? payMethod : null,
      status,
      notes: buildWorkflowInvoiceNote({
        source: SERVICE_SOURCES.LABORATORY,
        sourceId: test.id,
        visitId: test.visit_id || null,
        summary: `Lab: ${test.test_type}${cc ? '' : ' — price to be set'}`,
      }),
      paid_at: status === 'Paid' ? new Date().toISOString() : null,
    })
    fetchInvoices()
    try {
      window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', {
        detail: { test_id: test.id, source: 'lab-auto-billing' },
      }))
    } catch (_) {}
  }

  async function fetchPatients() {
    const { data } = await supabase.from('patients')
      .select('id, patient_no, full_name, phone, age, gender, blood_group, allergies, chronic_conditions')
      .eq('hospital_id', hospitalId)
      .order('full_name')
      .limit(300)
    setPatients(data || [])
  }

  function searchPatients(q) {
    setPatientSearch(q)
    if (!q.trim()) { setPatientResults([]); return }
    setPatientResults(patients.filter(p => p.full_name?.toLowerCase().includes(q.toLowerCase()) || p.phone?.includes(q)).slice(0, 6))
  }

  function pickPatient(p) {
    setSelectedPatient(p)
    setPatientSearch(p.full_name)
    setPatientResults([])
    setOrderForm(f => ({ ...f, patient_name: p.full_name, phone: p.phone || '' }))
  }

  // ── Open antibiogram upload modal for C&S tests ───────────────────────────
  function openAntibiogramModal(test) {
    setSelected(test)
    setAntibiogramForm({
      organism: '',
      sample_type: inferMicrobiologySampleType(test.test_type) || 'Urine',
      growth: 'Heavy',
      result_summary: '',
      interpretation: '',
      performed_by: test.assigned_to || '',
      verified_by: '',
      notes: test.notes || '',
      esbl: false,
      mrsa: false,
      carbapenem_r: false,
    })
    setAntibiogramFile(null)
    setAntibiogramFileName('')
    setAntibiogramUploadStep('')
    setShowAntibiogramModal(true)
  }

  // ── Handle antibiogram PDF upload & result save ───────────────────────────
  async function handleSaveAntibiogram() {
    if (!antibiogramForm.organism) { window.notifyFromLegacyAlert('Enter the organism identified (or "No growth" if culture is negative)'); return }
    if (!antibiogramFile) { window.notifyFromLegacyAlert('Upload the PDF or image of the culture & sensitivity report from the lab machine'); return }
    if (!antibiogramForm.performed_by) { window.notifyFromLegacyAlert('Enter the name of the lab technician who performed this test'); return }

    setAntibiogramUploading(true)
    const test = selected
    const now = new Date().toISOString()
    const today = now.split('T')[0]

    try {
      // Step 1 — Convert PDF/image to base64 for storage
      setAntibiogramUploadStep('Reading file...')
      const base64DataUrl = await fileToBase64(antibiogramFile)

      // Step 2 — Upload to Supabase Storage (microbiology-results bucket)
      // If storage not configured, we store as result_file_url reference
      setAntibiogramUploadStep('Uploading report...')
      let fileUrl = null
      try {
        const fileExt = antibiogramFile.name.split('.').pop()
        const filePath = `${hospitalId}/antibiograms/${test.id}_${Date.now()}.${fileExt}`
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('lab-reports')
          .upload(filePath, antibiogramFile, { contentType: antibiogramFile.type, upsert: true })
        if (!uploadError && uploadData) {
          const { data: urlData } = supabase.storage.from('lab-reports').getPublicUrl(filePath)
          fileUrl = urlData?.publicUrl || null
        }
      } catch (storageErr) {
        console.warn('Storage upload failed, proceeding without file URL:', storageErr)
        // Continue — the report data is stored in the antibiogram record
      }

      // Step 3 — Update lab_test to Complete with summary result
      setAntibiogramUploadStep('Saving lab result...')
      const resultText = [
        antibiogramForm.organism ? `Organism: ${antibiogramForm.organism}` : null,
        antibiogramForm.growth ? `Growth: ${antibiogramForm.growth}` : null,
        antibiogramForm.result_summary || null,
        antibiogramForm.esbl ? 'ESBL: Positive' : null,
        antibiogramForm.mrsa ? 'MRSA: Positive' : null,
        antibiogramForm.carbapenem_r ? 'Carbapenem Resistant: Yes' : null,
      ].filter(Boolean).join('\n')

      const { error: labUpdateError } = await supabase.from('lab_tests').update({
        result_text: resultText,
        result_value: antibiogramForm.organism || 'Culture complete — see antibiogram',
        interpretation: antibiogramForm.interpretation || null,
        performed_by: antibiogramForm.performed_by,
        result_notes: antibiogramForm.notes || null,
        result_file_url: fileUrl || null,
        status: 'Complete',
        resulted_at: now,
      }).eq('id', test.id)

      if (labUpdateError) throw new Error('Lab test update failed: ' + labUpdateError.message)

      // Step 4 — Create/update microbiology_results record (feeds Antibiogram screen)
      setAntibiogramUploadStep('Syncing to Antibiogram...')
      const microPayload = {
        hospital_id: hospitalId,
        patient_id: test.patient_id || null,
        visit_id: test.visit_id || null,
        lab_test_id: test.id,
        patient_name: test.patient_name || null,
        sample_type: antibiogramForm.sample_type,
        collection_date: test.ordered_at ? String(test.ordered_at).split('T')[0] : today,
        received_date: today,
        reported_date: today,
        organism_identified: antibiogramForm.organism,
        growth: antibiogramForm.growth,
        clinical_notes: [antibiogramForm.result_summary, antibiogramForm.notes].filter(Boolean).join('\n\n') || null,
        performed_by: antibiogramForm.performed_by,
        verified_by: antibiogramForm.verified_by || null,
        esbl: antibiogramForm.esbl,
        mrsa: antibiogramForm.mrsa,
        carbapenem_r: antibiogramForm.carbapenem_r,
        vre: false,
        susceptibility_profile: {},
        updated_at: now,
        // Store file reference in ai_suggestion field if no storage URL
        ai_suggestion: fileUrl ? null : `PDF uploaded: ${antibiogramFile.name} (${(antibiogramFile.size / 1024).toFixed(0)} KB) — view in lab reports`,
      }

      // Check if microbiology result already exists for this lab test
      const { data: existing } = await supabase
        .from('microbiology_results')
        .select('id')
        .eq('hospital_id', hospitalId)
        .eq('lab_test_id', test.id)
        .maybeSingle()

      const { error: microError } = await executeWithFallback(
        () => existing?.id
          ? supabase.from('microbiology_results').update(microPayload).eq('id', existing.id)
          : supabase.from('microbiology_results').insert(microPayload),
        async () => {
          const fallback = omitKeys(microPayload, ['susceptibility_profile', 'lab_test_id', 'received_date', 'reported_date'])
          return existing?.id
            ? supabase.from('microbiology_results').update(fallback).eq('id', existing.id)
            : supabase.from('microbiology_results').insert(fallback)
        }
      )
      if (microError) console.warn('Microbiology result sync warning:', microError)

      // Step 5 — Also update/create legacy antibiogram record for backward compat
      await supabase.from('antibiograms').upsert({
        hospital_id: hospitalId,
        patient_id: test.patient_id,
        visit_id: test.visit_id,
        test_id: test.id,
        organism: antibiogramForm.organism,
        result_summary: resultText,
        interpretation: antibiogramForm.interpretation || null,
        created_at: now,
      }, { onConflict: 'test_id' }).then(() => {}).catch(() => {}) // ignore if antibiograms table missing

      // Step 6 — Return patient to Doctor queue if all critical in-house tests done
      setAntibiogramUploadStep('Updating patient queue...')
      if (test.visit_id) {
        const { data: allVisitTests } = await supabase
          .from('lab_tests')
          .select('id, status, priority, test_location')
          .eq('visit_id', test.visit_id)

        const withCurrent = (allVisitTests || []).map(t =>
          t.id === test.id ? { ...t, status: 'Complete' } : t
        )
        const criticalPending = withCurrent.filter(t =>
          (t.test_location || 'In-House') === 'In-House' &&
          (t.priority === 'Urgent' || t.priority === 'STAT') &&
          t.status !== 'Complete' && t.status !== 'Critical'
        )
        if (criticalPending.length === 0) {
          await supabase.from('visits').update({ status: 'Doctor' }).eq('id', test.visit_id)
        }
      }

      // Step 7 — Broadcast events so Consultation + Pharmacy screens update
      try {
        window.dispatchEvent(new CustomEvent('remedacare:antibiogram_updated', {
          detail: { test_id: test.id, patient_id: test.patient_id, visit_id: test.visit_id, source: 'lab-pdf-upload' }
        }))
        window.dispatchEvent(new CustomEvent('remedacare:antibiogram_generated', {
          detail: { test_id: test.id, patient_id: test.patient_id }
        }))
        window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', {
          detail: { visit_id: test.visit_id, status: 'Doctor', source: 'antibiogram-complete' }
        }))
      } catch (_) {}

      setShowAntibiogramModal(false)
      setAntibiogramFile(null)
      setAntibiogramFileName('')
      fetchTests()
      window.notifyFromLegacyAlert(`✅ Culture & Sensitivity report saved successfully!\n\nOrganism: ${antibiogramForm.organism}\nThe result is now visible in:\n• Antibiogram screen (full S/I/R can be entered there)\n• Consultation — Labs tab\n• Pharmacy — AMR Stewardship watchlist`)

    } catch (err) {
      window.notifyFromLegacyAlert('Error saving antibiogram: ' + err.message)
    }

    setAntibiogramUploading(false)
    setAntibiogramUploadStep('')
  }

  function buildMicrobiologyResultPayloadFromLab(test, form, existingRow = null) {
    const now = new Date().toISOString()
    const today = now.split('T')[0]
    const summary = deriveMicrobiologyResultSummary({
      resultValue: form.result_value,
      resultText: form.result_text,
      interpretation: form.interpretation,
    })
    return {
      hospital_id: hospitalId,
      patient_id: test.patient_id || null,
      visit_id: test.visit_id || existingRow?.visit_id || null,
      lab_test_id: test.id,
      patient_name: test.patient_name || existingRow?.patient_name || null,
      sample_type: existingRow?.sample_type || inferMicrobiologySampleType(test.test_type),
      collection_date: existingRow?.collection_date || (test.ordered_at ? String(test.ordered_at).split('T')[0] : today),
      received_date: existingRow?.received_date || (test.ordered_at ? String(test.ordered_at).split('T')[0] : today),
      reported_date: today,
      organism_identified: summary.organismIdentified || existingRow?.organism_identified || null,
      colony_count: existingRow?.colony_count || null,
      gram_stain: existingRow?.gram_stain || null,
      growth: summary.growth || existingRow?.growth || null,
      diagnosis: existingRow?.diagnosis || null,
      ward_department: existingRow?.ward_department || null,
      clinical_notes: [form.result_text, form.result_notes].filter(Boolean).join('\n\n') || existingRow?.clinical_notes || null,
      performed_by: form.performed_by || existingRow?.performed_by || null,
      verified_by: existingRow?.verified_by || null,
      esbl: existingRow?.esbl || false,
      mrsa: existingRow?.mrsa || false,
      vre: existingRow?.vre || false,
      carbapenem_r: existingRow?.carbapenem_r || false,
      ai_suggestion: existingRow?.ai_suggestion || null,
      susceptibility_profile: existingRow?.susceptibility_profile || {},
      updated_at: now,
    }
  }

  async function syncMicrobiologyResultFromLab(test, form) {
    const existingResult = await executeWithFallback(
      () => supabase.from('microbiology_results').select('id, visit_id, patient_name, sample_type, collection_date, received_date, organism_identified, colony_count, gram_stain, growth, diagnosis, ward_department, clinical_notes, performed_by, verified_by, esbl, mrsa, vre, carbapenem_r, ai_suggestion, susceptibility_profile').eq('hospital_id', hospitalId).eq('lab_test_id', test.id).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      async () => ({ data: null, error: null, compatFallback: true }),
    )
    const payload = buildMicrobiologyResultPayloadFromLab(test, form, existingResult.data || null)
    const saveResult = await executeWithFallback(
      () => existingResult.data?.id
        ? supabase.from('microbiology_results').update(payload).eq('id', existingResult.data.id).eq('hospital_id', hospitalId)
        : supabase.from('microbiology_results').insert(payload),
      async () => {
        const fallbackPayload = omitKeys(payload, ['visit_id', 'lab_test_id', 'received_date', 'reported_date', 'diagnosis', 'clinical_notes', 'performed_by', 'verified_by', 'susceptibility_profile'])
        return existingResult.data?.id
          ? supabase.from('microbiology_results').update(fallbackPayload).eq('id', existingResult.data.id).eq('hospital_id', hospitalId)
          : supabase.from('microbiology_results').insert(fallbackPayload)
      },
    )
    if (saveResult.error) { console.error('Could not sync microbiology result', saveResult.error); return }
    try {
      window.dispatchEvent(new CustomEvent('remedacare:antibiogram_updated', { detail: { test_id: test.id, patient_id: test.patient_id || null, visit_id: test.visit_id || null, source: 'lab-result-sync' } }))
    } catch (_) {}
  }

  async function handleOrderTest() {
    const testName = orderForm.test_type === '__custom__' ? customTest : orderForm.test_type
    if (!testName) { window.notifyFromLegacyAlert('Select or enter a test name'); return }
    if (!orderForm.patient_name) { window.notifyFromLegacyAlert('Patient name required'); return }
    setSaving(true)
    const manualAmount = parseFloat(orderForm.amount) || 0
    const ccMatch = manualAmount === 0 ? matchLabChargeCode(testName) : null
    const amount = manualAmount > 0 ? manualAmount : (ccMatch?.unit_price_kes || 0)
    const receiptNumber = `LAB-${Date.now().toString().slice(-8)}`
    const orderedAt = new Date().toISOString()
    const assignedTo = (orderForm.assigned_to || '').trim()
    const { data: createdTest, error } = await supabase.from('lab_tests').insert({
      hospital_id: hospitalId,
      patient_id: selectedPatient?.id || null,
      patient_name: orderForm.patient_name,
      phone: orderForm.phone,
      test_type: testName,
      category: orderForm.category,
      priority: orderForm.priority,
      notes: orderForm.notes,
      ordered_by: orderForm.ordered_by,
      assigned_to: assignedTo || null,
      status: assignedTo ? 'In Progress' : 'Pending',
      payment_method: orderForm.payment_method,
      mpesa_ref: orderForm.mpesa_ref || null,
      amount,
      source: 'Walk-in',
      test_location: orderForm.test_location,
      sent_to_external_at: orderForm.test_location === 'External' ? new Date().toISOString() : null,
      ordered_at: orderedAt,
    }).select('*').single()
    if (error) { window.notifyFromLegacyAlert('Error: ' + error.message); setSaving(false); return }
    if (amount > 0) {
      const isInsurance = !['Cash', 'M-Pesa'].includes(orderForm.payment_method)
      const invoiceStatus = isInsurance ? 'Pending' : 'Paid'
      const paidAmount = isInsurance ? 0 : amount
      const balanceAmount = isInsurance ? amount : 0
      const ledgerPayload = { hospital_id: hospitalId, patient_id: selectedPatient?.id || null, visit_id: createdTest?.visit_id || null, patient_name: orderForm.patient_name, drug_name: testName, quantity: 1, unit_price: amount, total_kes: amount, payment_method: orderForm.payment_method, mpesa_ref: orderForm.mpesa_ref || null, category: 'Laboratory', receipt_number: receiptNumber, sold_at: orderedAt }
      await executeWithFallback(() => supabase.from('sales_ledger').insert(ledgerPayload), async () => supabase.from('sales_ledger').insert(omitKeys(ledgerPayload, ['visit_id'])))
      await supabase.from('invoices').insert({ hospital_id: hospitalId, patient_id: selectedPatient?.id || null, visit_id: createdTest?.visit_id || null, patient_name: orderForm.patient_name, invoice_no: receiptNumber.replace('LAB-', 'INV-'), services: stringifyServiceLines([createServiceLine({ label: testName, qty: 1, unitPrice: amount, total: amount, source: SERVICE_SOURCES.LABORATORY, sourceId: createdTest?.id || null, visitId: createdTest?.visit_id || null, meta: { category: orderForm.category, priority: orderForm.priority } })]), amount_kes: amount, paid_kes: paidAmount, balance_kes: balanceAmount, payment_method: orderForm.payment_method, insurer: isInsurance ? orderForm.payment_method : null, sha_member_no: null, status: invoiceStatus, notes: buildWorkflowInvoiceNote({ source: SERVICE_SOURCES.LABORATORY, sourceId: createdTest?.id || 'walkin', visitId: createdTest?.visit_id || null, summary: `Lab receipt: ${receiptNumber}` }), paid_at: invoiceStatus === 'Paid' ? orderedAt : null, created_at: orderedAt })
    }
    setShowOrderModal(false)
    resetOrderForm()
    fetchTests()
    fetchInvoices()
    try { window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { test_id: createdTest?.id, source: 'lab-order' } })) } catch (e) {}
    setSaving(false)
  }

  function resetOrderForm() {
    setOrderForm({ patient_name: '', patient_id_text: '', phone: '', test_type: '', category: 'Haematology', priority: 'Routine', notes: '', ordered_by: '', payment_method: 'Cash', mpesa_ref: '', amount: '', test_location: 'In-House', assigned_to: '' })
    setCustomTest('')
    setSelectedPatient(null)
    setPatientSearch('')
    setPatientResults([])
  }

  async function updateStatus(test, status) {
    const { error } = await supabase.from('lab_tests').update({ status }).eq('id', test.id)
    if (error) { window.notifyFromLegacyAlert('Error updating status: ' + error.message); return }
    // Auto-invoice doctor-ordered tests the moment they are picked up
    if (status === 'In Progress' && test.source === 'Doctor' && !hasLinkedLabInvoice(invoices, test)) {
      await autoInvoiceLabTest(test)
    }
    fetchTests()
    try { window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { test_id: test.id, status } })) } catch (e) {}
    if (selected?.id === test.id) setSelected({ ...selected, status })
  }

  async function handleAssignTechnician() {
    const tech = assignTech === '__custom__' ? customTech : assignTech
    if (!tech) { window.notifyFromLegacyAlert('Select or enter technician name'); return }
    setSaving(true)
    const { error } = await supabase.from('lab_tests').update({ assigned_to: tech, status: selected.status === 'Pending' ? 'In Progress' : selected.status }).eq('id', selected.id)
    if (error) { window.notifyFromLegacyAlert('Error assigning technician: ' + error.message); setSaving(false); return }
    // Auto-invoice doctor-ordered tests when assigned
    if (selected.source === 'Doctor' && !hasLinkedLabInvoice(invoices, selected)) {
      await autoInvoiceLabTest({ ...selected, status: 'In Progress' })
    }
    setShowAssignModal(false)
    setAssignTech('')
    setCustomTech('')
    fetchTests()
    try { window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { test_id: selected.id, assigned_to: tech } })) } catch (e) {}
    setSaving(false)
  }

  async function handleSaveResult() {
    if (!canPostLabResults) {
      window.notifyFromLegacyAlert('Only lab technicians can post results.')
      return
    }
    if (!resultForm.result_text && !resultForm.result_value) { window.notifyFromLegacyAlert('Enter result details'); return }
    setSaving(true)
    const { error: updateErr } = await supabase.from('lab_tests').update({
      result_text: resultForm.result_text || null,
      result_value: resultForm.result_value || null,
      reference_range: resultForm.reference_range || null,
      interpretation: resultForm.interpretation || null,
      performed_by: resultForm.performed_by || null,
      result_notes: resultForm.result_notes || null,
      result_file_url: resultForm.result_file_url || null,
      status: 'Complete',
      resulted_at: new Date().toISOString(),
    }).eq('id', selected.id)
    if (updateErr) { window.notifyFromLegacyAlert('Error saving result: ' + updateErr.message); setSaving(false); return }

    if (isMicrobiologySensitivityOrder(selected.test_type, selected.category)) {
      await syncMicrobiologyResultFromLab(selected, resultForm)
      await supabase.from('antibiograms').upsert({ hospital_id: hospitalId, patient_id: selected.patient_id, visit_id: selected.visit_id, test_id: selected.id, organism: resultForm.result_value || 'Pending Identification', result_summary: resultForm.result_text || '', interpretation: resultForm.interpretation || null, created_at: new Date().toISOString() }, { onConflict: 'test_id' })
      try {
        window.dispatchEvent(new CustomEvent('remedacare:antibiogram_generated', { detail: { test_id: selected.id, patient_id: selected.patient_id } }))
        window.dispatchEvent(new CustomEvent('remedacare:antibiogram_updated', { detail: { test_id: selected.id, patient_id: selected.patient_id, visit_id: selected.visit_id || null, source: 'lab-result' } }))
      } catch (e) {}
    }

    if (selected.visit_id) {
      const { data: allVisitTests } = await supabase.from('lab_tests').select('id, status, priority, test_location').eq('visit_id', selected.visit_id)
      const withCurrent = (allVisitTests || []).map(t => t.id === selected.id ? { ...t, status: 'Complete' } : t)
      const criticalPending = withCurrent.filter(t => (t.test_location || 'In-House') === 'In-House' && (t.priority === 'Urgent' || t.priority === 'STAT') && t.status !== 'Complete' && t.status !== 'Critical')
      if (criticalPending.length === 0) {
        await supabase.from('visits').update({ status: 'Doctor' }).eq('id', selected.visit_id)
        try { window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', { detail: { visit_id: selected.visit_id, status: 'Doctor' } })) } catch (e) {}
      }
    }

    await logAudit(supabase, {
      hospitalId,
      userRole,
      action: 'lab_result_posted',
      targetTable: 'lab_tests',
      targetId: selected?.id,
      details: {
        test: selected?.test_type,
        patient: selected?.patient_name,
        result: resultForm?.result_value,
      },
    })

    setShowResultModal(false)
    setResultForm({ result_text: '', result_value: '', reference_range: '', interpretation: '', performed_by: '', result_notes: '', result_file_url: '' })
    fetchTests()
    setSaving(false)
  }

  const filtered = tests.filter(t => {
    const query = search.trim().toLowerCase()
    const matchSearch = !query || [t.test_type, t.patient_name, t.ordered_by, t.assigned_to, t.notes, t.category].some(f => f?.toLowerCase().includes(query))
    const matchStatus = filterStatus === 'All' || t.status === filterStatus
    const matchPriority = filterPriority === 'All' || t.priority === filterPriority
    const matchCat = filterCategory === 'All' || t.category === filterCategory
    const matchPatient = !filterPatient || t.patient_name === filterPatient
    const matchSource = filterSource === 'All' || (filterSource === 'Doctor' ? !!t.visit_id : !t.visit_id)
    return matchSearch && matchStatus && matchPriority && matchCat && matchPatient && matchSource
  })

  const counts = {
    All: tests.length,
    Pending: tests.filter(t => t.status === 'Pending').length,
    Processing: tests.filter(t => t.status === 'In Progress').length,
    Completed: tests.filter(t => t.status === 'Complete').length,
    Critical: tests.filter(t => t.status === 'Critical').length,
  }

  const groupedByPatient = filtered.reduce((acc, t) => {
    const key = t.patient_name || 'Unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(t)
    return acc
  }, {})

  const patientsById = useMemo(() => patients.reduce((acc, p) => { acc[p.id] = p; return acc }, {}), [patients])

  const patientCards = useMemo(() => Object.entries(groupedByPatient).map(([name, items]) => {
    const latestOrderedAt = items.reduce((l, i) => { const t = new Date(i.ordered_at || 0).getTime(); return t > l ? t : l }, 0)
    const patientRecord = items.map(i => patientsById[i.patient_id]).find(Boolean) || patients.find(p => p.full_name === name) || null
    const linkedInvoices = invoices.filter(inv => items.some(test => hasLinkedLabInvoice([inv], test)))
    const billedTestIds = new Set(items.filter(test => hasLinkedLabInvoice(invoices, test)).map(test => test.id))
    return {
      key: name, patientName: name, patient: patientRecord, latestOrderedAt, items,
      visitId: items.find(i => i.visit_id)?.visit_id || null,
      pending: items.filter(i => i.status === 'Pending').length,
      processing: items.filter(i => i.status === 'In Progress').length,
      completed: items.filter(i => i.status === 'Complete').length,
      critical: items.filter(i => i.status === 'Critical').length,
      totalAmount: items.reduce((s, i) => s + (Number(i.amount) || 0), 0),
      billedAmount: linkedInvoices.reduce((s, i) => s + (Number(i.amount_kes) || 0), 0),
      balanceAmount: linkedInvoices.reduce((s, i) => s + (Number(i.balance_kes) || 0), 0),
      billedCount: billedTestIds.size,
      unbilledTests: items.filter(test => !billedTestIds.has(test.id)),
    }
  }).sort((a, b) => b.latestOrderedAt - a.latestOrderedAt), [groupedByPatient, invoices, patients, patientsById])

  if (loading) return (
    <div style={s.loadWrap}><div style={s.spinner} /><p style={{ color: '#0F6E56', marginTop: 12 }}>Loading Lab...</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={s.page}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .test-card:hover{box-shadow:0 4px 16px rgba(15,110,86,0.10)!important;}
        .action-btn:hover{opacity:0.85;}
      `}</style>

      {/* HEADER */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>🔬 Laboratory</h1>
          <p style={s.subtitle}>
            {counts.All} total &nbsp;•&nbsp;
            <span style={{ color: '#C07000', fontWeight: 600 }}>{counts.Pending} pending</span> &nbsp;•&nbsp;
            <span style={{ color: '#1a6fb5', fontWeight: 600 }}>{counts.Processing} processing</span> &nbsp;•&nbsp;
            <span style={{ color: '#0F6E56', fontWeight: 600 }}>{counts.Completed} completed</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...s.btn, background: activeTab === 'technicians' ? '#7B5EA7' : '#fff', color: activeTab === 'technicians' ? '#fff' : '#0F6E56', border: `1px solid ${activeTab === 'technicians' ? '#7B5EA7' : '#0F6E56'}` }} onClick={() => setActiveTab(activeTab === 'technicians' ? 'tests' : 'technicians')}>
            👥 Technicians
          </button>
          <button style={s.btn} onClick={() => { resetOrderForm(); setShowOrderModal(true) }}>+ Order Lab Test</button>
          <button style={{ ...s.btn, background: '#fff', color: '#0F6E56', border: '1px solid #0F6E56' }} onClick={fetchTests}>↻ Refresh</button>
        </div>
      </div>

      {/* TECHNICIANS VIEW */}
      {activeTab === 'technicians' && (() => {
        const activeTech = tests.filter(t => t.status !== 'Complete' && t.status !== 'Critical')
        const unassigned = activeTech.filter(t => !t.assigned_to)
        const techMap = {}
        const staffTechNames = labStaff.map(s => s.full_name).filter(Boolean)
        staffTechNames.forEach(tech => { techMap[tech] = { pending: [], processing: [], completed: [] } })
        tests.forEach(t => {
          if (!t.assigned_to || !techMap[t.assigned_to]) return
          if (t.status === 'Pending') techMap[t.assigned_to].pending.push(t)
          if (t.status === 'In Progress') techMap[t.assigned_to].processing.push(t)
          if (t.status === 'Complete') techMap[t.assigned_to].completed.push(t)
        })
        const customTechs = [...new Set(tests.map(t => t.assigned_to).filter(t => t && !staffTechNames.includes(t)))]
        customTechs.forEach(tech => {
          techMap[tech] = { pending: [], processing: [], completed: [] }
          tests.forEach(t => {
            if (t.assigned_to !== tech) return
            if (t.status === 'Pending') techMap[tech].pending.push(t)
            if (t.status === 'In Progress') techMap[tech].processing.push(t)
            if (t.status === 'Complete') techMap[tech].completed.push(t)
          })
        })
        const allTechs = [...staffTechNames, ...customTechs]
        return (
          <div>
            {unassigned.length > 0 && (
              <div style={{ background: '#FCEBEB', border: '1px solid #F09595', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 700, color: '#A32D2D', fontSize: 14 }}>⚠ {unassigned.length} Unassigned Test{unassigned.length !== 1 ? 's' : ''}</span>
                  <div style={{ fontSize: 12, color: '#A32D2D', marginTop: 3 }}>{unassigned.map(t => t.test_type).join(', ')}</div>
                </div>
                <button style={{ ...s.btn, background: '#A32D2D', fontSize: 12, padding: '8px 14px' }} onClick={() => setActiveTab('tests')}>View & Assign →</button>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
              {allTechs.map(tech => {
                const w = techMap[tech]
                const active = w.pending.length + w.processing.length
                return (
                  <div key={tech} style={{ background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: '16px 18px', boxShadow: '0 2px 6px rgba(0,0,0,.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>🔬 {tech}</div>
                        <div style={{ fontSize: 12, color: active > 0 ? '#C07000' : '#0F6E56', fontWeight: 600, marginTop: 3 }}>{active > 0 ? `${active} active test${active !== 1 ? 's' : ''}` : 'No active tests'}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: active > 3 ? '#A32D2D' : active > 0 ? '#C07000' : '#0F6E56' }}>{active}</div>
                        <div style={{ fontSize: 10, color: '#aaa', fontWeight: 600 }}>ACTIVE</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      {[['#FFF3DC', '#C07000', w.pending.length, 'PENDING'], ['#E3F0FB', '#1a6fb5', w.processing.length, 'PROCESSING'], ['#E1F5EE', '#0F6E56', w.completed.length, 'DONE']].map(([bg, color, count, label]) => (
                        <div key={label} style={{ flex: 1, background: bg, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color }}>{count}</div>
                          <div style={{ fontSize: 10, color, fontWeight: 600 }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* TESTS VIEW */}
      {activeTab === 'tests' && (
        <div>
          <div style={s.tabRow}>
            {['All', 'Pending', 'In Progress', 'Complete', 'Critical'].map(st => (
              <button key={st} style={{ ...s.tabBtn, ...(filterStatus === st ? s.tabBtnActive : {}) }} onClick={() => setFilterStatus(st)}>
                {st === 'Pending' ? '⏳' : st === 'In Progress' ? '🔄' : st === 'Complete' ? '✅' : st === 'Critical' ? '🚨' : '📋'} {st}
                <span style={{ ...s.tabCount, ...(filterStatus === st ? s.tabCountActive : {}) }}>{counts[st] ?? tests.filter(t => t.status === st).length}</span>
              </button>
            ))}
          </div>

          {/* FILTERS */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13 }}>🔍</span>
              <input style={{ ...s.input, paddingLeft: 30 }} placeholder="Search test, patient, doctor, technician..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 140 }}>
                <label style={{ fontSize: 11, color: '#555', marginBottom: 2 }}>From</label>
                <input type="date" style={{ ...s.input, width: '100%' }} value={dateFrom} max={dateTo} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 140 }}>
                <label style={{ fontSize: 11, color: '#555', marginBottom: 2 }}>To</label>
                <input type="date" style={{ ...s.input, width: '100%' }} value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)} />
              </div>
            </div>
            <select style={{ ...s.input, width: 'auto', minWidth: 160 }} value={filterPatient} onChange={e => setFilterPatient(e.target.value)}>
              <option value="">All Patients</option>
              {uniquePatients.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <select style={{ ...s.input, width: 'auto' }} value={filterSource} onChange={e => setFilterSource(e.target.value)}>
              <option value="All">All Sources</option>
              <option value="Doctor">Doctor Orders</option>
              <option value="Walk-in">Walk-in</option>
            </select>
            <select style={{ ...s.input, width: 'auto' }} value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
              <option value="All">All Priorities</option>
              <option>Routine</option><option>Urgent</option><option>STAT</option>
            </select>
            <select style={{ ...s.input, width: 'auto' }} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
              <option value="All">All Categories</option>
              {LAB_TEST_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
            {(filterPatient || filterSource !== 'All' || filterPriority !== 'All' || filterCategory !== 'All' || search) && (
              <button style={{ ...s.input, width: 'auto', background: '#FCEBEB', color: '#A32D2D', border: '1px solid #F09595', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                onClick={() => { setSearch(''); setFilterPatient(''); setFilterSource('All'); setFilterPriority('All'); setFilterCategory('All') }}>
                Clear filters
              </button>
            )}
          </div>

          {/* PATIENT CHIPS */}
          {uniquePatients.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto', paddingBottom: 6 }}>
              {uniquePatients.map(name => (
                <button key={name} style={{ ...s.chip, ...(filterPatient === name ? s.chipActive : {}), whiteSpace: 'nowrap' }} onClick={() => { setFilterPatient(name); setSearch('') }}>
                  {name} <span style={{ marginLeft: 6, fontWeight: 800 }}>{(groupedByPatient[name] || []).length}</span>
                </button>
              ))}
              <button style={s.chip} onClick={() => { setFilterPatient(''); setSearch('') }}>Show all</button>
            </div>
          )}

          {/* PATIENT CARDS */}
          {patientCards.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 10 }}>Patient Cards</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
                {patientCards.slice(0, filterPatient ? patientCards.length : 6).map(card => (
                  <div key={card.key} style={filterPatient === card.patientName ? s.patientCardActive : {}}
                    onClick={() => { setFilterPatient(card.patientName); const next = card.items.find(i => i.status !== 'Complete') || card.items[0]; if (next) setSelected(next) }}>
                    <PatientWorkflowCard
                      patientName={card.patientName}
                      patient={card.patient || {}}
                      visit={{ chiefComplaint: card.items[0]?.notes || '', visitType: card.visitId ? 'Doctor Order' : 'Walk-in' }}
                      badges={[
                        ...(card.patient?.allergies ? [{ label: 'Allergy noted', bg: '#FCEBEB', color: '#A32D2D' }] : []),
                        ...(card.visitId ? [{ label: 'Doctor order', bg: '#F0EAFC', color: '#7B5EA7' }] : []),
                      ]}
                      accentColor="#0F6E56" background="#FFFFFF">
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ ...s.pill, background: '#FFF3DC', color: '#C07000' }}>{card.pending} pending</span>
                        <span style={{ ...s.pill, background: '#E3F0FB', color: '#1a6fb5' }}>{card.processing} processing</span>
                        <span style={{ ...s.pill, background: '#E1F5EE', color: '#0F6E56' }}>{card.completed} complete</span>
                        {card.critical > 0 && <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D' }}>{card.critical} critical</span>}
                      </div>
                      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {card.items.slice(0, 3).map(item => (
                          <div key={item.id} style={{ fontSize: 12, color: '#444', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {isCultureSensitivityTest(item.test_type, item.category) ? '🧫 ' : ''}{item.test_type}
                            </span>
                            <span style={{ color: item.assigned_to ? '#1a6fb5' : '#C07000', fontWeight: 600, whiteSpace: 'nowrap' }}>{item.assigned_to || 'Unassigned'}</span>
                          </div>
                        ))}
                        {card.items.length > 3 && <div style={{ fontSize: 11, color: '#888' }}>+{card.items.length - 3} more ordered tests</div>}
                      </div>
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #EEF2F7', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>Billing</div>
                          <div style={{ fontSize: 13, color: '#111', fontWeight: 700, marginTop: 3 }}>{card.totalAmount > 0 ? `${formatKES(card.billedAmount)} billed of ${formatKES(card.totalAmount)}` : 'Charges to be set in billing'}</div>
                          <div style={{ fontSize: 11, color: card.unbilledTests.length > 0 ? '#C07000' : '#0F6E56', marginTop: 4 }}>{card.unbilledTests.length > 0 ? `${card.unbilledTests.length} test(s) still not billed` : `Balance ${formatKES(card.balanceAmount)}`}</div>
                        </div>
                        <button style={{ ...s.actionBtn, background: '#F0EAFC', color: '#7B5EA7', border: '1px solid #D4C5F5' }} onClick={e => { e.stopPropagation(); navigate?.('billing', { patientName: card.patientName, visitId: card.visitId || null, source: 'laboratory', openedAt: Date.now() }) }}>
                          Open Billing
                        </button>
                      </div>
                    </PatientWorkflowCard>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MAIN LIST + DETAIL */}
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {filtered.length === 0 ? (
                <div style={s.empty}><div style={{ fontSize: 48 }}>🔬</div><div style={{ marginTop: 12, fontWeight: 600, color: '#555' }}>No tests found</div></div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {filtered.map(test => {
                    const sc = STATUS_COLORS[test.status] || STATUS_COLORS.Pending
                    const pc = PRIORITY_COLORS[test.priority] || PRIORITY_COLORS.Routine
                    const isSelected = selected?.id === test.id
                    const isFromDoctor = !!test.visit_id
                    const isCultureTest = isCultureSensitivityTest(test.test_type, test.category)
                    const linkedInvoice = invoices.find(inv => hasLinkedLabInvoice([inv], test))

                    return (
                      <div key={test.id} className="test-card"
                        style={{ ...s.testCard, border: isSelected ? '2px solid #0F6E56' : '1px solid #eee', background: isSelected ? '#f0faf7' : '#fff' }}
                        onClick={() => setSelected(isSelected ? null : test)}>

                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 0 }}>
                          <div style={{ width: 42, height: 42, borderRadius: 10, background: isCultureTest ? '#F0EAFC' : '#E1F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                            {isCultureTest ? '🧫' : test.category === 'Haematology' ? '🩸' : test.category === 'Microbiology' ? '🦠' : test.category === 'Radiology' ? '🩻' : test.category === 'Urinalysis' ? '🧪' : test.category === 'Parasitology' ? '🔬' : test.category === 'Immunology' ? '🛡️' : test.category === 'Serology' ? '💉' : '🔬'}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                              <span style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>{test.test_type}</span>
                              <span style={{ ...s.pill, background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>{test.status}</span>
                              <span style={{ ...s.pill, background: pc.bg, color: pc.color }}>{test.priority}</span>
                              {test.category && <span style={{ ...s.pill, background: '#f5f5f5', color: '#666' }}>{test.category}</span>}
                              {/* Special badge for C&S tests */}
                              {isCultureTest && <span style={{ ...s.pill, background: '#F5F0FF', color: '#7B3AED', border: '1px solid #DDD6FE' }}>🧫 C&S — Antibiogram</span>}
                              {isFromDoctor && <span style={{ ...s.pill, background: '#F0EAFC', color: '#7B5EA7', border: '1px solid #D4C5F5' }}>📋 Doctor Order</span>}
                              {linkedInvoice
                                ? <span style={{ ...s.pill, background: '#E1F5EE', color: '#0F6E56', border: '1px solid #9FE1CB' }}>✅ Billed</span>
                                : <span style={{ ...s.pill, background: '#FFF3DC', color: '#C07000', border: '1px solid #FAC775' }}>⚠ Billing Pending</span>}
                            </div>
                            <div style={{ fontSize: 12, color: '#666', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                              <span>👤 {test.patient_name}</span>
                              {test.ordered_by && <span>🩺 Dr. {test.ordered_by}</span>}
                              {test.assigned_to ? <span style={{ color: '#1a6fb5', fontWeight: 600 }}>🔬 {test.assigned_to}</span> : <span style={{ color: '#C07000' }}>⚠ Unassigned</span>}
                              <span>🕐 {test.ordered_at ? new Date(test.ordered_at).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                              {test.amount > 0 && <span style={{ color: '#0F6E56', fontWeight: 600 }}>KES {parseFloat(test.amount).toLocaleString()}</span>}
                            </div>
                            {test.notes && <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>📝 {test.notes}</div>}

                            {/* C&S hint */}
                            {isCultureTest && test.status !== 'Complete' && (
                              <div style={{ marginTop: 6, background: '#F5F0FF', border: '1px solid #DDD6FE', borderRadius: 6, padding: '5px 10px', fontSize: 11, color: '#7B3AED', fontWeight: 600 }}>
                                🧫 Culture & Sensitivity — use "Upload Antibiogram" to attach the VITEK/WHONET PDF and record the organism
                              </div>
                            )}

                            {/* Result preview */}
                            {test.status === 'Complete' && test.result_text && (
                              <div style={{ marginTop: 8, background: '#E1F5EE', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#0F6E56', fontWeight: 500 }}>
                                {test.result_text.slice(0, 120)}{test.result_text.length > 120 ? '...' : ''}
                              </div>
                            )}
                            {test.status === 'Complete' && isCultureTest && (
                              <div style={{ marginTop: 4, fontSize: 11, color: '#7B3AED', fontWeight: 600 }}>
                                🧫 Full S/I/R antibiogram available — view in Antibiogram screen
                              </div>
                            )}
                            {test.status === 'Complete' && isFromDoctor && (
                              <div style={{ marginTop: 4, fontSize: 11, color: '#7B5EA7', fontWeight: 600 }}>✅ Result sent back to Doctor queue</div>
                            )}
                          </div>
                        </div>

                        {/* ACTION BUTTONS */}
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                          {test.status !== 'Complete' && test.status !== 'Critical' && (
                            <button className="action-btn" style={{ ...s.actionBtn, background: '#F0EAFC', color: '#7B5EA7', border: '1px solid #D4C5F5' }}
                              onClick={() => { setSelected(test); setAssignTech(test.assigned_to || ''); setShowAssignModal(true) }}>
                              👤 {test.assigned_to ? 'Reassign' : 'Assign'}
                            </button>
                          )}
                          {test.status === 'Pending' && (
                            <button className="action-btn" style={{ ...s.actionBtn, background: '#E3F0FB', color: '#1a6fb5', border: '1px solid #90C4F0' }} onClick={() => updateStatus(test, 'In Progress')}>▶ Process</button>
                          )}
                          {/* SPLIT: C&S gets Upload Antibiogram, others get Enter Result */}
                          {(test.status === 'Pending' || test.status === 'In Progress') && (
                            isCultureTest ? (
                              <button className="action-btn" style={{ ...s.actionBtn, background: '#F5F0FF', color: '#7B3AED', border: '1px solid #DDD6FE', fontWeight: 700 }}
                                onClick={() => openAntibiogramModal(test)}>
                                🧫 Upload Antibiogram
                              </button>
                            ) : (
                              <button className="action-btn" style={{ ...s.actionBtn, background: '#E1F5EE', color: '#0F6E56', border: '1px solid #9FE1CB' }}
                                onClick={() => { setSelected(test); setResultForm({ result_text: '', result_value: '', reference_range: '', interpretation: '', performed_by: '', result_notes: '', result_file_url: '' }); setShowResultModal(true) }}>
                                📝 Enter Result
                              </button>
                            )
                          )}
                          {test.status === 'Complete' && (
                            isCultureTest ? (
                              <button className="action-btn" style={{ ...s.actionBtn, background: '#F5F0FF', color: '#7B3AED', border: '1px solid #DDD6FE' }}
                                onClick={() => openAntibiogramModal(test)}>
                                🧫 Update C&S
                              </button>
                            ) : (
                              <button className="action-btn" style={{ ...s.actionBtn, background: '#f5f5f5', color: '#555' }}
                                onClick={() => { setSelected(test); setShowResultModal(true) }}>
                                ✏️ Edit
                              </button>
                            )
                          )}
                          {test.status !== 'Critical' && test.status !== 'Complete' && (
                            <button className="action-btn" style={{ ...s.actionBtn, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #F09595' }} onClick={() => updateStatus(test, 'Critical')}>🚨</button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, color: '#555' }}>
                  Showing {tests.length} of {testTotalCount || 0} lab tests
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 12, color: '#555' }}>Show:</label>
                  <select style={{ ...s.input, width: 'auto' }} value={testPageSize} onChange={e => { setTestPageSize(Number(e.target.value)); setTestPage(1) }}>
                    {PAGE_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}</option>)}
                  </select>
                  <button style={{ ...s.actionBtn, ...(testPage <= 1 ? s.btnGhost : s.btnPri), padding: '8px 12px' }} disabled={testPage <= 1} onClick={() => setTestPage(prev => Math.max(prev - 1, 1))}>← Previous</button>
                  <span style={{ fontSize: 12, color: '#555' }}>Page {testPage} of {Math.max(1, Math.ceil((testTotalCount || 0) / testPageSize))}</span>
                  <button style={{ ...s.actionBtn, ...(testPage >= Math.ceil((testTotalCount || 0) / testPageSize) ? s.btnGhost : s.btnPri), padding: '8px 12px' }} disabled={testPage >= Math.ceil((testTotalCount || 0) / testPageSize)} onClick={() => setTestPage(prev => prev + 1)}>Next →</button>
                </div>
              </div>
            </div>

            {/* DETAIL PANEL */}
            {selected && (
              <div style={s.detailPanel}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>Test Details</div>
                  <button style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#aaa' }} onClick={() => setSelected(null)}>✕</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                  <span style={{ ...s.pill, background: STATUS_COLORS[selected.status]?.bg, color: STATUS_COLORS[selected.status]?.color, border: `1px solid ${STATUS_COLORS[selected.status]?.border}`, fontSize: 12 }}>{selected.status}</span>
                  {selected.visit_id && <span style={{ ...s.pill, background: '#F0EAFC', color: '#7B5EA7', border: '1px solid #D4C5F5', fontSize: 12 }}>📋 Doctor Order</span>}
                  {isCultureSensitivityTest(selected.test_type, selected.category) && <span style={{ ...s.pill, background: '#F5F0FF', color: '#7B3AED', border: '1px solid #DDD6FE', fontSize: 12 }}>🧫 C&S</span>}
                </div>
                {[
                  ['Test', selected.test_type],
                  ['Category', selected.category],
                  ['Priority', selected.priority],
                  ['Patient', selected.patient_name],
                  ['Phone', selected.phone || '—'],
                  ['Ordered By', selected.ordered_by ? `Dr. ${selected.ordered_by}` : '—'],
                  ['Assigned To', selected.assigned_to || '—'],
                  ['Ordered At', selected.ordered_at ? new Date(selected.ordered_at).toLocaleString('en-KE') : '—'],
                  ['Notes', selected.notes || '—'],
                ].map(([label, val]) => (
                  <div key={label} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #f5f5f5' }}>
                    <div style={{ fontSize: 10, color: '#aaa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 13, color: '#111', fontWeight: 500 }}>{val}</div>
                  </div>
                ))}
                {selected.status === 'Complete' && (
                  <div style={{ marginTop: 4 }}>
                    <div style={s.sectionLabel}>Results</div>
                    {selected.result_value && <div style={{ fontSize: 18, fontWeight: 800, color: '#0F6E56', marginBottom: 6 }}>{selected.result_value}</div>}
                    {selected.result_text && <div style={{ background: '#f9fafb', borderRadius: 8, padding: 12, fontSize: 13, color: '#333', marginBottom: 8, whiteSpace: 'pre-wrap' }}>{selected.result_text}</div>}
                    {selected.interpretation && <div style={{ background: selected.interpretation?.toLowerCase().includes('abnormal') || selected.interpretation?.toLowerCase().includes('positive') ? '#FCEBEB' : '#E1F5EE', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 600, color: selected.interpretation?.toLowerCase().includes('abnormal') || selected.interpretation?.toLowerCase().includes('positive') ? '#A32D2D' : '#0F6E56', marginBottom: 8 }}>{selected.interpretation}</div>}
                    {selected.performed_by && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>By: {selected.performed_by}</div>}
                    {selected.resulted_at && <div style={{ fontSize: 11, color: '#888' }}>Completed: {new Date(selected.resulted_at).toLocaleString('en-KE')}</div>}
                    {selected.visit_id && <div style={{ marginTop: 10, background: '#E1F5EE', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#0F6E56', fontWeight: 600 }}>Patient returned to Doctor queue</div>}
                  </div>
                )}
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selected.status !== 'Complete' && selected.status !== 'Critical' && (
                    <>
                      <button style={{ ...s.btn, width: '100%', background: '#7B5EA7' }} onClick={() => { setAssignTech(selected.assigned_to || ''); setShowAssignModal(true) }}>
                        👤 {selected.assigned_to ? 'Reassign Technician' : 'Assign Technician'}
                      </button>
                      {isCultureSensitivityTest(selected.test_type, selected.category) ? (
                        <button style={{ ...s.btn, width: '100%', background: '#7B3AED' }} onClick={() => openAntibiogramModal(selected)}>
                          🧫 Upload Antibiogram PDF
                        </button>
                      ) : (
                        <button style={{ ...s.btn, width: '100%' }} onClick={() => { setResultForm({ result_text: '', result_value: '', reference_range: '', interpretation: '', performed_by: '', result_notes: '', result_file_url: '' }); setShowResultModal(true) }}>
                          📝 Enter Result
                        </button>
                      )}
                      {selected.status === 'Pending' && (
                        <button style={{ ...s.btn, background: '#1a6fb5', width: '100%' }} onClick={() => updateStatus(selected, 'In Progress')}>▶ Mark Processing</button>
                      )}
                    </>
                  )}
                  {selected.status === 'Complete' && (
                    isCultureSensitivityTest(selected.test_type, selected.category) ? (
                      <button style={{ ...s.btn, background: '#7B3AED', width: '100%' }} onClick={() => openAntibiogramModal(selected)}>🧫 Update C&S Result</button>
                    ) : (
                      <button style={{ ...s.btn, background: '#f5f5f5', color: '#555', width: '100%' }} onClick={() => setShowResultModal(true)}>✏️ Edit Result</button>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== ANTIBIOGRAM UPLOAD MODAL ===== */}
      {showAntibiogramModal && selected && (
        <div style={s.overlay} onClick={() => !antibiogramUploading && setShowAntibiogramModal(false)}>
          <div style={{ ...s.modal, maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitle}>🧫 Upload Culture & Sensitivity Report</h2>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{selected.test_type} — {selected.patient_name}</div>
                {selected.visit_id && <div style={{ fontSize: 12, color: '#7B5EA7', marginTop: 2, fontWeight: 600 }}>📋 Doctor-ordered — completing this returns patient to Doctor queue</div>}
              </div>
              <button style={s.closeBtn} onClick={() => !antibiogramUploading && setShowAntibiogramModal(false)}>✕</button>
            </div>
            <div style={s.modalBody}>

              {/* PDF Upload zone */}
              <div style={{ background: '#F5F0FF', border: '2px dashed #7B3AED', borderRadius: 12, padding: '20px', marginBottom: 16, textAlign: 'center', cursor: 'pointer' }}
                onClick={() => document.getElementById('antibiogram-pdf-input').click()}>
                <input id="antibiogram-pdf-input" type="file" accept=".pdf,image/*,.jpg,.jpeg,.png" style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) { setAntibiogramFile(file); setAntibiogramFileName(file.name) }
                    e.target.value = ''
                  }} />
                <div style={{ fontSize: 32, marginBottom: 8 }}>{antibiogramFile ? '✅' : '📎'}</div>
                <div style={{ fontWeight: 700, color: '#7B3AED', fontSize: 14 }}>
                  {antibiogramFile ? antibiogramFileName : 'Click to upload VITEK / WHONET / Lab PDF or Image'}
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  {antibiogramFile
                    ? `${(antibiogramFile.size / 1024).toFixed(0)} KB — ${antibiogramFile.type}`
                    : 'Supports PDF, JPG, PNG — attach the machine report or a clear photograph of the result sheet'}
                </div>
                {antibiogramFile && (
                  <button style={{ marginTop: 8, fontSize: 11, color: '#A32D2D', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={e => { e.stopPropagation(); setAntibiogramFile(null); setAntibiogramFileName('') }}>
                    Remove file
                  </button>
                )}
              </div>

              <div style={{ background: '#FFF7ED', border: '1px solid #FCD34D', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#92400E', marginBottom: 16 }}>
                ℹ After uploading, the full S/I/R antibiogram table can be completed in the <strong>Antibiogram screen</strong>. This step records the organism, sends the result to Consultation and Pharmacy, and returns the patient to the Doctor queue.
              </div>

              <div style={s.sectionLabel}>Culture Result</div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Organism Identified *</label>
                  <input style={s.input} placeholder="e.g. Escherichia coli, MRSA, No Growth"
                    value={antibiogramForm.organism} onChange={e => setAntibiogramForm(f => ({ ...f, organism: e.target.value }))} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Sample Type</label>
                  <select style={s.input} value={antibiogramForm.sample_type} onChange={e => setAntibiogramForm(f => ({ ...f, sample_type: e.target.value }))}>
                    {SAMPLE_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Growth</label>
                  <select style={s.input} value={antibiogramForm.growth} onChange={e => setAntibiogramForm(f => ({ ...f, growth: e.target.value }))}>
                    {['Heavy', 'Moderate', 'Light', 'No Growth'].map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Interpretation</label>
                  <select style={s.input} value={antibiogramForm.interpretation} onChange={e => setAntibiogramForm(f => ({ ...f, interpretation: e.target.value }))}>
                    <option value="">-- Select --</option>
                    {['Sensitive — treat per susceptibility', 'Resistant — consider alternative therapy', 'No growth — culture negative', 'Contaminated — repeat recommended', 'Mixed growth — clinical correlation needed'].map(i => <option key={i}>{i}</option>)}
                  </select>
                </div>
              </div>

              {/* Resistance flags */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
                {[['esbl', 'ESBL Positive'], ['mrsa', 'MRSA'], ['carbapenem_r', 'Carbapenem Resistant']].map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', fontWeight: antibiogramForm[key] ? 700 : 400, color: antibiogramForm[key] ? '#A32D2D' : '#555' }}>
                    <input type="checkbox" checked={!!antibiogramForm[key]} onChange={e => setAntibiogramForm(f => ({ ...f, [key]: e.target.checked }))} />
                    {label}
                  </label>
                ))}
              </div>

              <div style={s.formGroup}>
                <label style={s.label}>Result Summary / Clinical Notes</label>
                <textarea style={{ ...s.input, height: 70, resize: 'vertical' }}
                  placeholder="Summarise key findings, e.g. E.coli — sensitive to nitrofurantoin and ciprofloxacin, resistant to amoxicillin. Full S/I/R data in Antibiogram module."
                  value={antibiogramForm.result_summary} onChange={e => setAntibiogramForm(f => ({ ...f, result_summary: e.target.value }))} />
              </div>

              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Performed By *</label>
                  <select style={s.input} value={antibiogramForm.performed_by} onChange={e => setAntibiogramForm(f => ({ ...f, performed_by: e.target.value }))}>
                    <option value="">-- Select Technician --</option>
                    {labStaff.map(t => <option key={t.id} value={t.full_name}>{t.full_name}{t.role ? ` — ${t.role}` : ''}</option>)}
                    <option value="__other__">Other (type below)</option>
                  </select>
                  {antibiogramForm.performed_by === '__other__' && (
                    <input style={{ ...s.input, marginTop: 6 }} placeholder="Enter technician name" onChange={e => setAntibiogramForm(f => ({ ...f, performed_by: e.target.value }))} />
                  )}
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Verified By (optional)</label>
                  <input style={s.input} placeholder="Consultant or senior tech" value={antibiogramForm.verified_by} onChange={e => setAntibiogramForm(f => ({ ...f, verified_by: e.target.value }))} />
                </div>
              </div>

              <div style={{ background: '#E1F5EE', border: '1px solid #9FE1CB', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#0F6E56', fontWeight: 600 }}>
                ✅ After saving:
                <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 11, fontWeight: 400 }}>
                  <li>The lab test is marked <strong>Complete</strong></li>
                  <li>Result appears in <strong>Consultation → Labs tab</strong> for the doctor</li>
                  <li>Pharmacy <strong>AMR Stewardship watchlist</strong> is updated</li>
                  <li>Full S/I/R antibiogram table available in <strong>Antibiogram screen</strong> for detailed entry</li>
                  <li>Patient is <strong>returned to Doctor queue</strong> (if all critical tests done)</li>
                </ul>
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => !antibiogramUploading && setShowAntibiogramModal(false)} disabled={antibiogramUploading}>Cancel</button>
              <button style={{ ...s.submitBtn, background: '#7B3AED', minWidth: 180 }} onClick={handleSaveAntibiogram} disabled={antibiogramUploading}>
                {antibiogramUploading ? `⏳ ${antibiogramUploadStep || 'Saving...'}` : '🧫 Save C&S Result & Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ASSIGN TECHNICIAN MODAL ===== */}
      {showAssignModal && selected && (
        <div style={s.overlay} onClick={() => setShowAssignModal(false)}>
          <div style={{ ...s.modal, maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitle}>👤 Assign Technician</h2>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{selected.test_type} — {selected.patient_name}</div>
              </div>
              <button style={s.closeBtn} onClick={() => setShowAssignModal(false)}>✕</button>
            </div>
            <div style={s.modalBody}>
              {selected.assigned_to && <div style={{ background: '#E3F0FB', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#1a6fb5', marginBottom: 14, fontWeight: 600 }}>Currently: {selected.assigned_to}</div>}
              <div style={s.sectionLabel}>Select Technician</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {availableLabStaff.map(tech => {
                  const workload = tests.filter(t => t.assigned_to === tech.full_name && (t.status === 'Pending' || t.status === 'In Progress')).length
                  return (
                    <div key={tech.id} style={{ padding: '10px 14px', borderRadius: 8, border: `2px solid ${assignTech === tech.full_name ? '#7B5EA7' : '#eee'}`, background: assignTech === tech.full_name ? '#F0EAFC' : '#fafafa', cursor: 'pointer', fontSize: 13, fontWeight: assignTech === tech.full_name ? 700 : 400, color: assignTech === tech.full_name ? '#7B5EA7' : '#333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      onClick={() => setAssignTech(tech.full_name)}>
                      <span>{tech.full_name}{tech.role ? ` — ${tech.role}` : ''}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: workload === 0 ? '#E1F5EE' : workload < 3 ? '#FFF3DC' : '#FCEBEB', color: workload === 0 ? '#0F6E56' : workload < 3 ? '#C07000' : '#A32D2D' }}>{workload} active</span>
                    </div>
                  )
                })}
                {availableLabStaff.length === 0 && <div style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #F5F3F5', background: '#FEF3F2', color: '#B91C1C', fontSize: 12 }}>No active lab staff found. Add laboratory staff in HR.</div>}
                <div style={{ padding: '10px 14px', borderRadius: 8, border: `2px solid ${assignTech === '__custom__' ? '#7B5EA7' : '#eee'}`, background: assignTech === '__custom__' ? '#F0EAFC' : '#fafafa', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#888' }} onClick={() => setAssignTech('__custom__')}>Other / Custom</div>
              </div>
              {assignTech === '__custom__' && (
                <div style={s.formGroup}>
                  <label style={s.label}>Custom Technician Name</label>
                  <input style={s.input} placeholder="Enter full name" value={customTech} onChange={e => setCustomTech(e.target.value)} autoFocus />
                </div>
              )}
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => setShowAssignModal(false)}>Cancel</button>
              <button style={{ ...s.submitBtn, background: '#7B5EA7' }} onClick={handleAssignTechnician} disabled={saving}>{saving ? 'Saving...' : '✅ Assign & Process'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ORDER MODAL ===== */}
      {showOrderModal && (
        <div style={s.overlay} onClick={() => setShowOrderModal(false)}>
          <div style={{ ...s.modal, maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>🔬 Order Lab Test</h2>
              <button style={s.closeBtn} onClick={() => setShowOrderModal(false)}>✕</button>
            </div>
            <div style={s.modalBody}>
              <div style={s.sectionLabel}>Patient</div>
              <div style={{ position: 'relative', marginBottom: 14 }}>
                <input style={s.input} placeholder="Search registered patient or type name..." value={patientSearch}
                  onChange={e => { searchPatients(e.target.value); setOrderForm(f => ({ ...f, patient_name: e.target.value })); setSelectedPatient(null) }} />
                {patientResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: 8, zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', marginTop: 4 }}>
                    {patientResults.map(p => (
                      <div key={p.id} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f5f5f5' }} onMouseDown={() => pickPatient(p)}>
                        <span style={{ fontWeight: 600 }}>{p.full_name}</span>
                        <span style={{ color: '#888', marginLeft: 8 }}>{p.age && `${p.age}y`} {p.gender} • {p.phone}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}><label style={s.label}>Patient Name *</label><input style={s.input} placeholder="Full name" value={orderForm.patient_name} onChange={e => setOrderForm(f => ({ ...f, patient_name: e.target.value }))} /></div>
                <div style={s.formGroup}><label style={s.label}>Phone</label><input style={s.input} placeholder="07XXXXXXXX" value={orderForm.phone} onChange={e => setOrderForm(f => ({ ...f, phone: e.target.value }))} /></div>
              </div>
              <div style={s.sectionLabel}>Test Details</div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Category</label>
                  <select style={s.input} value={orderForm.category} onChange={e => setOrderForm(f => ({ ...f, category: e.target.value, test_type: '' }))}>
                    {LAB_TEST_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Test Name *</label>
                  <select style={s.input} value={orderForm.test_type} onChange={e => setOrderForm(f => ({ ...f, test_type: e.target.value }))}>
                    <option value="">-- Select Test --</option>
                    {getLabTestsForCategory(orderForm.category).map(t => <option key={t}>{t}</option>)}
                    <option value="__custom__">✏️ Custom / Other</option>
                  </select>
                </div>
              </div>
              {orderForm.test_type === '__custom__' && <div style={s.formGroup}><label style={s.label}>Custom Test Name *</label><input style={s.input} placeholder="Enter test name" value={customTest} onChange={e => setCustomTest(e.target.value)} /></div>}
              {/* Show antibiogram hint if Microbiology category */}
              {orderForm.category === 'Microbiology' && (
                <div style={{ background: '#F5F0FF', border: '1px solid #DDD6FE', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#7B3AED', fontWeight: 600, marginBottom: 12 }}>
                  🧫 Microbiology C&S tests will use the <strong>Upload Antibiogram</strong> flow when entering results — attaches the VITEK/lab PDF and feeds the Antibiogram module.
                </div>
              )}
              <div style={s.formGrid2}>
                <div style={s.formGroup}><label style={s.label}>Priority</label><select style={s.input} value={orderForm.priority} onChange={e => setOrderForm(f => ({ ...f, priority: e.target.value }))}><option>Routine</option><option>Urgent</option><option>STAT</option></select></div>
                <div style={s.formGroup}><label style={s.label}>Ordered By (Doctor)</label><input style={s.input} placeholder="Dr. name" value={orderForm.ordered_by} onChange={e => setOrderForm(f => ({ ...f, ordered_by: e.target.value }))} /></div>
              </div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}><label style={s.label}>Test Location *</label><select style={s.input} value={orderForm.test_location} onChange={e => setOrderForm(f => ({ ...f, test_location: e.target.value }))}><option value="In-House">In-House Lab</option><option value="External">Send to External Lab</option></select></div>
                <div style={s.formGroup}><label style={s.label}>Assign Technician (optional)</label><select style={s.input} value={orderForm.assigned_to || ''} onChange={e => setOrderForm(f => ({ ...f, assigned_to: e.target.value }))}><option value="">-- Assign Later --</option>{labStaff.map(t => <option key={t.id} value={t.full_name}>{t.full_name}{t.role ? ` — ${t.role}` : ''}</option>)}</select></div>
              </div>
              <div style={s.formGroup}><label style={s.label}>Clinical Notes</label><input style={s.input} placeholder="Special instructions..." value={orderForm.notes} onChange={e => setOrderForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <div style={s.sectionLabel}>Payment</div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}><label style={s.label}>Amount (KES)</label><input style={s.input} type="number" placeholder="e.g. 500" value={orderForm.amount} onChange={e => setOrderForm(f => ({ ...f, amount: e.target.value }))} /></div>
                <div style={s.formGroup}><label style={s.label}>Payment Method</label><select style={s.input} value={orderForm.payment_method} onChange={e => setOrderForm(f => ({ ...f, payment_method: e.target.value }))}><option>Cash</option><option>M-Pesa</option><option>Insurance</option><option>SHA</option><option>Credit</option></select></div>
              </div>
              {orderForm.payment_method === 'M-Pesa' && <div style={s.formGroup}><label style={s.label}>M-Pesa Ref</label><input style={{ ...s.input, textTransform: 'uppercase', letterSpacing: 1 }} placeholder="e.g. QHJ2KL8MNP" value={orderForm.mpesa_ref} onChange={e => setOrderForm(f => ({ ...f, mpesa_ref: e.target.value.toUpperCase() }))} /></div>}
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => setShowOrderModal(false)}>Cancel</button>
              <button style={s.submitBtn} onClick={handleOrderTest} disabled={saving}>{saving ? 'Saving...' : '🔬 Order Test'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== RESULT MODAL (non-C&S tests only) ===== */}
      {showResultModal && selected && (
        <div style={s.overlay} onClick={() => setShowResultModal(false)}>
          <div style={{ ...s.modal, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitle}>📝 Enter Result</h2>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{selected.test_type} — {selected.patient_name}</div>
                {selected.assigned_to && <div style={{ fontSize: 12, color: '#1a6fb5', marginTop: 2 }}>Assigned to: {selected.assigned_to}</div>}
                {selected.visit_id && <div style={{ fontSize: 12, color: '#7B5EA7', marginTop: 2, fontWeight: 600 }}>📋 Doctor-ordered — saving returns patient to Doctor queue</div>}
              </div>
              <button style={s.closeBtn} onClick={() => setShowResultModal(false)}>✕</button>
            </div>
            <div style={s.modalBody}>
              <div style={s.formGroup}>
                <label style={s.label}>Result Text / Full Report</label>
                <textarea style={{ ...s.input, height: 100, resize: 'vertical' }} placeholder="Enter full result report, findings, or detailed text..." value={resultForm.result_text} onChange={e => setResultForm(f => ({ ...f, result_text: e.target.value }))} />
              </div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}><label style={s.label}>Key Value / Reading</label><input style={s.input} placeholder="e.g. 11.2 g/dL, Positive" value={resultForm.result_value} onChange={e => setResultForm(f => ({ ...f, result_value: e.target.value }))} /></div>
                <div style={s.formGroup}><label style={s.label}>Reference Range</label><input style={s.input} placeholder="e.g. 12–16 g/dL, Negative" value={resultForm.reference_range} onChange={e => setResultForm(f => ({ ...f, reference_range: e.target.value }))} /></div>
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>Interpretation</label>
                <select style={s.input} value={resultForm.interpretation} onChange={e => setResultForm(f => ({ ...f, interpretation: e.target.value }))}>
                  <option value="">-- Select --</option>
                  {['Normal', 'Abnormal - Low', 'Abnormal - High', 'Positive', 'Negative', 'Borderline', 'Inconclusive', 'Pending Confirmation'].map(i => <option key={i}>{i}</option>)}
                </select>
              </div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Performed By</label>
                  <select style={s.input} value={resultForm.performed_by} onChange={e => setResultForm(f => ({ ...f, performed_by: e.target.value }))}>
                    <option value="">-- Select Technician --</option>
                    {labStaff.map(t => <option key={t.id} value={t.full_name}>{t.full_name}{t.role ? ` — ${t.role}` : ''}</option>)}
                    <option value="__custom__">Other</option>
                  </select>
                </div>
                <div style={s.formGroup}><label style={s.label}>Result File URL (optional)</label><input style={s.input} placeholder="Link to PDF/image" value={resultForm.result_file_url} onChange={e => setResultForm(f => ({ ...f, result_file_url: e.target.value }))} /></div>
              </div>
              <div style={s.formGroup}><label style={s.label}>Additional Notes</label><textarea style={{ ...s.input, height: 60, resize: 'vertical' }} placeholder="Any additional clinical notes..." value={resultForm.result_notes} onChange={e => setResultForm(f => ({ ...f, result_notes: e.target.value }))} /></div>
              {selected.visit_id && (
                <div style={{ background: '#F0EAFC', border: '1px solid #D4C5F5', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#7B5EA7', fontWeight: 600 }}>
                  ⚡ Saving returns patient to Doctor queue when all critical in-house tests are done.
                </div>
              )}
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => setShowResultModal(false)}>Cancel</button>
              <button
                style={s.submitBtn}
                onClick={handleSaveResult}
                disabled={saving || !canPostLabResults}
                title={!canPostLabResults ? 'Only lab technicians can post results' : ''}
              >
                {saving ? 'Saving...' : '✅ Save Result & Complete'}
              </button>
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
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  title: { fontSize: 24, fontWeight: 800, margin: 0, color: '#111' },
  subtitle: { color: '#777', margin: '4px 0 0', fontSize: 13 },
  btn: { background: '#0F6E56', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13 },
  tabRow: { display: 'flex', gap: 4, marginBottom: 14, background: '#fff', padding: '6px 8px', borderRadius: 10, border: '1px solid #eee', flexWrap: 'wrap' },
  tabBtn: { padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#888', borderRadius: 7, display: 'flex', alignItems: 'center', gap: 6 },
  tabBtnActive: { background: '#0F6E56', color: '#fff' },
  tabCount: { fontSize: 11, padding: '2px 7px', borderRadius: 99, background: '#f0f0f0', color: '#666', fontWeight: 700 },
  tabCountActive: { background: 'rgba(255,255,255,0.25)', color: '#fff' },
  patientCardActive: { border: '2px solid #0F6E56', background: '#F3FBF8', borderRadius: 12 },
  testCard: { borderRadius: 12, padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.04)', flexWrap: 'wrap', transition: 'box-shadow 0.15s' },
  detailPanel: { width: 300, flexShrink: 0, background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 18, overflowY: 'auto', maxHeight: 'calc(100vh - 140px)' },
  sectionLabel: { fontSize: 11, fontWeight: 700, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10, marginTop: 4, paddingBottom: 5, borderBottom: '1px solid #E1F5EE' },
  pill: { fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99, display: 'inline-block' },
  chip: { fontSize: 11, padding: '5px 12px', borderRadius: 99, border: '1px solid #e0e0e0', background: '#fff', cursor: 'pointer', fontWeight: 500, color: '#555' },
  chipActive: { background: '#0F6E56', color: '#fff', border: '1px solid #0F6E56' },
  actionBtn: { fontSize: 12, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', border: 'none' },
  empty: { textAlign: 'center', padding: '80px 20px', color: '#999' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal: { background: '#fff', borderRadius: 16, width: '100%', maxWidth: 700, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', animation: 'fadeIn 0.2s ease' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 24px', borderBottom: '1px solid #f0f0f0' },
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
