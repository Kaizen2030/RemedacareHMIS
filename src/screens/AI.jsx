import { useEffect, useMemo, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import { executeWithFallback } from '../utils/dbCompat'
import { streamGeminiContent } from '../utils/geminiProxy'
import { buildAmrInterventions, summarizeAmrInterventions } from '../utils/hospitalSignals'
import { executeMicrobiologyQuery } from '../utils/microbiologyResults'

function formatKES(value) {
  return `KES ${Number(value || 0).toLocaleString()}`
}

function formatKenyaDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

export default function AI() {
  const { hospitalId, hospitalName } = useHospital()

  const [messages, setMessages] = useState([
    {
      type: 'bot',
      text: `Hello! I'm your AI Clinical Assistant for ${hospitalName || 'RemedacareHMS'}.\n\nAsk me about prescriptions, ward occupancy, staff availability, pharmacy stock, lab status, or upload a prescription/image, PDF, CSV, or Excel file.\n\nI can also answer general clinical questions — drug side effects, dosages, contraindications, treatment guidelines, and more.`
    }
  ])
  const [input, setInput] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [filePreview, setFilePreview] = useState(null)
  const [fileText, setFileText] = useState('')
  const [fileName, setFileName] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [answeringWith, setAnsweringWith] = useState('') // AI provider currently answering
  const [answerStarted, setAnswerStarted] = useState(false) // first words have arrived
  const [hospitalData, setHospitalData] = useState({
    inventory: [],
    pharmacyInventory: [],
    drugBatches: [],
    wards: [],
    beds: [],
    staff: [],
    patients: [],
    labTests: [],
    prescriptions: [],
    invoices: [],
    antibiogram: [],
    mpesaTransactions: [],
    shaClaims: [],
    insuranceClaims: [],
    creditDebts: [],
    microbiologyResults: [],
    stewardshipInterventions: [],
    departments: [],
  })

  useEffect(() => {
    if (hospitalId) loadHospitalData()
  }, [hospitalId])

  useEffect(() => {
    if (!hospitalId) return undefined

    const timer = setInterval(() => loadHospitalData(), 60000)
    const localHandler = () => loadHospitalData()
    window.addEventListener('remedacare:workflow_changed', localHandler)
    window.addEventListener('remedacare:prescriptions_changed', localHandler)
    window.addEventListener('remedacare:antibiogram_updated', localHandler)
    window.addEventListener('remedacare:stewardship_changed', localHandler)

    return () => {
      clearInterval(timer)
      window.removeEventListener('remedacare:workflow_changed', localHandler)
      window.removeEventListener('remedacare:prescriptions_changed', localHandler)
      window.removeEventListener('remedacare:antibiogram_updated', localHandler)
      window.removeEventListener('remedacare:stewardship_changed', localHandler)
    }
  }, [hospitalId])

  async function loadHospitalData() {
    if (!hospitalId) return

    const requests = await Promise.allSettled([
      supabase.from('inventory').select('id,drug_name,quantity,expiry_date').eq('hospital_id', hospitalId).order('drug_name').limit(120),
      supabase.from('pharmacy_inventory').select('id,drug_name,quantity_in_stock,expiry_date,reorder_level').eq('hospital_id', hospitalId).order('drug_name').limit(120),
      supabase.from('drug_batches').select('id,drug_name,batch_number,quantity_remaining,expiry_date,status').eq('hospital_id', hospitalId).order('expiry_date').limit(120),
      supabase.from('wards').select('id,name,ward_type').eq('hospital_id', hospitalId),
      supabase.from('beds').select('id,bed_number,status,ward_id').eq('hospital_id', hospitalId).order('bed_number'),
      supabase.from('staff').select('id,full_name,department,role,status,current_shift').eq('hospital_id', hospitalId).order('full_name'),
      supabase.from('patients').select('id,full_name,gender,age,ward,bed_no,status').eq('hospital_id', hospitalId).order('full_name').limit(120),
      supabase.from('lab_tests').select('id,test_name,status,ordered_by,assigned_to,patient_name').eq('hospital_id', hospitalId).order('created_at').limit(120),
      supabase.from('prescriptions').select('id,patient_id,patient_name,drug_name,status').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(160),
      supabase.from('invoices').select('id,invoice_no,amount_kes,paid_kes,status,payment_method').eq('hospital_id', hospitalId).order('created_at').limit(120),
      supabase.from('v_live_antibiogram').select('*').eq('hospital_id', hospitalId).limit(200),
      supabase.from('mpesa_transactions').select('id,reference,amount_kes,status,transacted_at').eq('hospital_id', hospitalId).order('transacted_at', { ascending: false }).limit(120),
      supabase.from('sha_claims').select('id,patient_name,amount_claimed,status,created_at').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(120),
      supabase.from('insurance_claims').select('id,patient_name,insurer,insurer_name,amount_kes,amount_claimed,status,submitted_at,created_at').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(120),
      supabase.from('credit_debts').select('id,description,balance,status,patient_id,created_at').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(120),
      executeMicrobiologyQuery(select => supabase.from('microbiology_results').select(select).eq('hospital_id', hospitalId).order('updated_at', { ascending: false }).limit(120)),
      executeWithFallback(
        () => supabase.from('stewardship_interventions').select('*').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(160),
        async () => ({ data: [], error: null, compatFallback: true }),
      ),
      supabase.from('departments').select('id,name,status').eq('hospital_id', hospitalId).order('name'),
    ])

    const nextData = {
      inventory: [],
      pharmacyInventory: [],
      drugBatches: [],
      wards: [],
      beds: [],
      staff: [],
      patients: [],
      labTests: [],
      prescriptions: [],
      invoices: [],
      antibiogram: [],
      mpesaTransactions: [],
      shaClaims: [],
      insuranceClaims: [],
      creditDebts: [],
      microbiologyResults: [],
      stewardshipInterventions: [],
      departments: [],
    }

    requests.forEach((result, index) => {
      if (result.status !== 'fulfilled' || result.value.error) return
      const data = result.value.data || []
      switch (index) {
        case 0: nextData.inventory = data; break
        case 1: nextData.pharmacyInventory = data; break
        case 2: nextData.drugBatches = data; break
        case 3: nextData.wards = data; break
        case 4: nextData.beds = data; break
        case 5: nextData.staff = data; break
        case 6: nextData.patients = data; break
        case 7: nextData.labTests = data; break
        case 8: nextData.prescriptions = data; break
        case 9: nextData.invoices = data; break
        case 10: nextData.antibiogram = data; break
        case 11: nextData.mpesaTransactions = data; break
        case 12: nextData.shaClaims = data; break
        case 13: nextData.insuranceClaims = data; break
        case 14: nextData.creditDebts = data; break
        case 15: nextData.microbiologyResults = data; break
        case 16: nextData.stewardshipInterventions = data; break
        case 17: nextData.departments = data; break
      }
    })

    setHospitalData(nextData)
  }

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve(ev.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const extractTextFromExcel = async (file) => {
    const XLSX = await import('xlsx')
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const parts = []
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName]
      const sheetRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      if (sheetRows.length > 0) {
        parts.push(`Sheet: ${sheetName}`)
        sheetRows.forEach(row => {
          const entries = Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('; ')
          parts.push(entries)
        })
      }
    })
    return parts.join('\n')
  }

  const extractTextFromPdf = async (file) => {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf')
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const pages = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items.map(item => item.str).join(' ')
      pages.push(pageText)
    }
    return pages.join('\n')
  }

  const extractTextFromImage = async (file) => {
    const dataUrl = await readFileAsDataUrl(file)
    const tesseract = await import('tesseract.js')
    const worker = await tesseract.createWorker({ logger: () => {} })
    await worker.load()
    await worker.loadLanguage('eng')
    await worker.initialize('eng')
    const { data } = await worker.recognize(dataUrl)
    await worker.terminate()
    return data.text
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setSelectedFile(file)
    setFileName(file.name)
    setFilePreview(null)
    setFileText('')
    setExtracting(true)
    setLoading(true)

    try {
      let extracted = ''
      if (file.type.startsWith('image/')) {
        const preview = await readFileAsDataUrl(file)
        setFilePreview(preview)
        extracted = await extractTextFromImage(file)
      } else if (file.name.match(/\.(xlsx|xls)$/i)) {
        extracted = await extractTextFromExcel(file)
      } else if (file.name.match(/\.pdf$/i)) {
        extracted = await extractTextFromPdf(file)
      } else if (file.name.match(/\.csv$/i)) {
        extracted = await file.text()
      } else {
        throw new Error('Unsupported file format. Please upload image, PDF, Excel, or CSV.')
      }
      setFileText(extracted || 'No readable text found in the uploaded file.')
      setMessages(prev => [...prev, { type: 'bot', text: `Uploaded ${file.name}. Extracted text for AI analysis.` }])
    } catch (err) {
      console.error(err)
      setMessages(prev => [...prev, { type: 'bot', text: `File parsing failed: ${err.message}` }])
    }

    setExtracting(false)
    setLoading(false)
  }

  const wardNamesById = useMemo(() => {
    const map = {}
    hospitalData.wards.forEach((ward) => {
      map[ward.id] = ward.name || 'Unknown Ward'
    })
    return map
  }, [hospitalData.wards])

  const freeBeds = useMemo(
    () => hospitalData.beds.filter(b => (b.status || '').toLowerCase() === 'free'),
    [hospitalData.beds]
  )

  const occupiedBeds = useMemo(
    () => hospitalData.beds.filter(b => {
      const status = (b.status || '').toLowerCase()
      return status === 'occupied' || status === 'critical'
    }),
    [hospitalData.beds]
  )

  const availableStaff = useMemo(
    () => hospitalData.staff.filter(s => ['active', 'Active'].includes(s.status) && !(s.current_shift || '').toLowerCase().includes('off')).slice(0, 12),
    [hospitalData.staff]
  )

  const expiredPharmacyItems = useMemo(() => {
    const now = new Date()
    const allItems = [
      ...hospitalData.pharmacyInventory.map(item => ({
        drug_name: item.drug_name,
        expiry_date: item.expiry_date,
        type: 'Pharmacy stock'
      })),
      ...hospitalData.drugBatches.map(batch => ({
        drug_name: batch.drug_name,
        expiry_date: batch.expiry_date,
        type: 'Drug batch'
      }))
    ]
    return allItems.filter(item => item.expiry_date && new Date(item.expiry_date) < now)
  }, [hospitalData.pharmacyInventory, hospitalData.drugBatches])

  const lowStockPharmacyItems = useMemo(
    () => hospitalData.pharmacyInventory.filter(item => {
      const qty = Number(item.quantity_in_stock || 0)
      const reorder = Number(item.reorder_level || 0)
      return reorder > 0 ? qty <= reorder : qty <= 10
    }).slice(0, 10),
    [hospitalData.pharmacyInventory]
  )

  const pendingLabTests = useMemo(
    () => hospitalData.labTests.filter(test => !['completed', 'done', 'verified'].includes(String(test.status || '').toLowerCase())),
    [hospitalData.labTests]
  )

  const pendingMpesaTransactions = useMemo(
    () => hospitalData.mpesaTransactions.filter(tx => String(tx.status || '').toLowerCase() === 'pending'),
    [hospitalData.mpesaTransactions]
  )

  const pendingShaClaims = useMemo(
    () => hospitalData.shaClaims.filter(claim => ['pending', 'submitted', 'under review', 'appealed'].includes(String(claim.status || '').toLowerCase())),
    [hospitalData.shaClaims]
  )

  const pendingInsuranceClaims = useMemo(
    () => hospitalData.insuranceClaims.filter(claim => ['draft', 'pending', 'pre-auth', 'submitted', 'under review', 'appealed'].includes(String(claim.status || '').toLowerCase())),
    [hospitalData.insuranceClaims]
  )

  const openCreditDebts = useMemo(
    () => hospitalData.creditDebts.filter(item => Number(item.balance || 0) > 0 && !['paid', 'waived'].includes(String(item.status || '').toLowerCase())),
    [hospitalData.creditDebts]
  )

  const activeDepartments = useMemo(
    () => hospitalData.departments.filter(department => String(department.status || 'active').toLowerCase() !== 'inactive'),
    [hospitalData.departments]
  )

  const departmentCoverage = useMemo(() => {
    const activeStaffByDepartment = hospitalData.staff.reduce((map, member) => {
      if (!['active', 'approved'].includes(String(member.status || '').toLowerCase())) return map
      const key = String(member.department || '').trim()
      if (!key) return map
      map[key] = (map[key] || 0) + 1
      return map
    }, {})

    const configured = activeDepartments.map(department => ({
      name: department.name,
      activeStaff: activeStaffByDepartment[department.name] || 0,
      status: department.status || 'Active',
    }))

    return {
      configured,
      uncovered: configured.filter(item => item.activeStaff === 0),
    }
  }, [activeDepartments, hospitalData.staff])

  const amrInterventions = useMemo(
    () => buildAmrInterventions({
      results: hospitalData.microbiologyResults,
      prescriptions: hospitalData.prescriptions,
      interventions: hospitalData.stewardshipInterventions,
      maxAgeDays: 21,
    }),
    [hospitalData.microbiologyResults, hospitalData.prescriptions, hospitalData.stewardshipInterventions]
  )

  const amrSummary = useMemo(
    () => summarizeAmrInterventions(amrInterventions),
    [amrInterventions]
  )

  const buildAntibiogramText = () => {
    const rows = hospitalData.antibiogram || []
    if (rows.length === 0) return 'No local antibiogram data is available for this hospital.'

    const topRows = rows.slice(0, 8)
    const lines = [`Local antibiogram snapshot (${rows.length} records):`]
    topRows.forEach(row => {
      const values = Object.entries(row)
        .filter(([key, value]) => value !== null && value !== undefined && value !== '' && !['id', 'hospital_id', 'created_at', 'updated_at'].includes(key))
        .slice(0, 12)
        .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`)
      lines.push(values.join('; '))
    })
    if (rows.length > 8) lines.push(`...and ${rows.length - 8} more antibiogram rows.`)
    lines.push('Use these results as the hospital-specific resistance and susceptibility pattern when advising on antibiotic choice.')
    return lines.join('\n')
  }

  const buildContextText = () => {
    const wardSummary = hospitalData.wards.length > 0
      ? hospitalData.wards.map(w => `${w.name} (${w.ward_type || 'General'})`).join(', ')
      : 'No wards available.'

    const freeWardNames = [...new Set(freeBeds.map(b => wardNamesById[b.ward_id] || 'Unknown Ward'))]
    const staffSummary = availableStaff.length > 0
      ? availableStaff.map(s => `${s.full_name}${s.role ? ` (${s.role})` : ''}`).join(', ')
      : 'No active staff currently available to show.'

    const expiredText = expiredPharmacyItems.length > 0
      ? expiredPharmacyItems.slice(0, 8).map(item => `${item.drug_name} (${item.expiry_date})`).join('; ')
      : 'No expired pharmacy items found.'

    const lowText = lowStockPharmacyItems.length > 0
      ? lowStockPharmacyItems.map(item => `${item.drug_name} (${item.quantity_in_stock || 0} left)`).join('; ')
      : 'No low stock alerts at the moment.'

    const uncoveredDepartments = departmentCoverage.uncovered.length > 0
      ? departmentCoverage.uncovered.slice(0, 8).map(item => item.name).join(', ')
      : 'All configured departments have at least one active staff member in the loaded data.'

    const amrText = amrInterventions.length > 0
      ? `${amrSummary.pendingReview} pending pharmacist reviews, ${amrSummary.highSeverity} high-severity alerts, ${amrSummary.resistantOverlap} resistant overlaps with active therapy.`
      : 'No recent microbiology stewardship alerts in the loaded data.'

    return [
      `Hospital Data Snapshot for ${hospitalName || 'RemedacareHMS'}:`,
      `- Wards: ${hospitalData.wards.length}. ${wardSummary}`,
      `- Beds: ${hospitalData.beds.length} total, ${freeBeds.length} free, ${occupiedBeds.length} occupied.`,
      `- Free wards: ${freeWardNames.length > 0 ? freeWardNames.join(', ') : 'None.'}`,
      `- Active staff available: ${availableStaff.length}. ${staffSummary}`,
      `- Departments configured: ${activeDepartments.length}. Coverage gaps: ${uncoveredDepartments}`,
      `- Pharmacy stock records: ${hospitalData.pharmacyInventory.length}.`,
      `- Expired pharmacy items: ${expiredText}`,
      `- Low stock pharmacy items: ${lowText}`,
      `- Active patients loaded: ${hospitalData.patients.length}.`,
      `- Lab tests loaded: ${hospitalData.labTests.length}. Pending / in progress: ${pendingLabTests.length}.`,
      `- Active prescriptions loaded: ${hospitalData.prescriptions.length}.`,
      `- Invoices loaded: ${hospitalData.invoices.length}.`,
      `- M-Pesa pending confirmations: ${pendingMpesaTransactions.length}, value ${formatKES(pendingMpesaTransactions.reduce((sum, tx) => sum + Number(tx.amount_kes || 0), 0))}.`,
      `- SHA claims awaiting action: ${pendingShaClaims.length}, value ${formatKES(pendingShaClaims.reduce((sum, claim) => sum + Number(claim.amount_claimed || 0), 0))}.`,
      `- Insurance claims awaiting action: ${pendingInsuranceClaims.length}, value ${formatKES(pendingInsuranceClaims.reduce((sum, claim) => sum + Number(claim.amount_kes || claim.amount_claimed || 0), 0))}.`,
      `- Credit debts still open: ${openCreditDebts.length}, outstanding ${formatKES(openCreditDebts.reduce((sum, item) => sum + Number(item.balance || 0), 0))}.`,
      `- Local antibiogram records: ${hospitalData.antibiogram.length}.`,
      `- AMR stewardship watchlist: ${amrText}`,
    ].join('\n')
  }

  const detectIntentRole = (question = '') => {
    const normalized = String(question || '').toLowerCase()
    if (!normalized.trim()) return 'master'

    if (/pharmacy|drug|medicine|stock|expiry|expired|dose|dosage|interaction|contraindication/.test(normalized)) return 'pharmacy'
    if (/lab|laboratory|microbiology|culture|antibiogram|amr|stewardship/.test(normalized)) return 'laboratory'
    if (/sha|nhif|claim|insurance|pre-auth|preauth|etims|kra|mpesa|billing|invoice|credit|debt|reconciliation/.test(normalized)) return 'finance'
    if (/ward|bed|occupancy|admission|discharge|nurse|icu|theatre/.test(normalized)) return 'inpatient'
    if (/staff|shift|department|coverage|roster|admin|operations|summary|situation report/.test(normalized)) return 'operations'
    if (/diagnosis|symptom|treatment|differential|guideline|procedure|referral/.test(normalized)) return 'clinical'
    return 'master'
  }

  const buildPrompt = (question, role = 'master') => {
    const rolePrompts = {
      master: `You are ARIA — Advanced RemedacareHMS Intelligence Assistant — a hospital-grade AI clinical and operations assistant deployed at ${hospitalName || 'this hospital'} in Kenya.

You operate with the precision of a senior clinical pharmacist, the situational awareness of a hospital administrator, and the diagnostic reasoning of a specialist physician. You are deeply familiar with Kenya's healthcare system: SHA (Social Health Authority), NHIF legacy claims, eTIMS/KRA compliance, M-Pesa payment workflows, MOH treatment protocols, Kenya Essential Medicines List (KEML), Kenya Standard Treatment Guidelines (KSTG), and ICD-10 coding as used in Kenya.

## YOUR IDENTITY
- Name: ARIA (Advanced RemedacareHMS Intelligence Assistant)
- Deployed at: ${hospitalName || 'this hospital'}, Kenya
- Today: ${formatKenyaDate(new Date())}
- Hospital Tier: Not configured

## YOUR TWO OPERATING MODES

### MODE A — LIVE HOSPITAL OPERATIONS
Answer questions using ONLY the live hospital data snapshot provided below.
Cover: ward occupancy, free beds, pending labs, pharmacy stock levels, expiring drugs,
pending prescriptions, SHA/insurance claim status, M-Pesa reconciliation, staff on shift,
department coverage gaps, AMR stewardship alerts, credit exposure, billing summaries.

RULES for Mode A:
- Never fabricate patient names, drug quantities, or claim numbers.
- If data is missing or a table is empty, say so clearly.
- Always cite which data source you used (e.g. "Based on pharmacy_inventory...").
- Flag anomalies proactively: expired drugs, overdue labs, uncollected prescriptions >24h,
  rejected SHA claims, staff coverage gaps.

### MODE B — CLINICAL & PHARMACOLOGY KNOWLEDGE BASE
Answer using your trained medical knowledge when no live data is needed.
Cover:
- Drug monographs: mechanism, indications, dosing (adult/paediatric/renal/hepatic adjustment),
  contraindications, interactions, adverse effects, pregnancy/lactation safety (FDA/WHO categories),
  brand names in Kenya, KEML listing status.
- Disease management: symptoms, differential diagnosis, Kenya MOH first-line treatment,
  WHO guidelines, referral criteria.
- Antimicrobial stewardship: empiric selection, de-escalation, PK/PD targets, local resistance patterns.
- Clinical procedures: indications, steps, complications, consent points.
- Nutrition, maternal health, paediatrics, tropical diseases (malaria, typhoid, TB, HIV).

RULES for Mode B:
- Always cite guideline source when applicable (e.g. "Per Kenya STG 2022...").
- For drug dosing, always specify route and frequency explicitly.
- Flag black box warnings with ⚠️.
- Never replace physician judgment — end complex answers with "Confirm with the attending clinician."

### MODE C — COMBINED QUERIES
If the question spans both modes (e.g. "Do we have ceftriaxone in stock and what is the dose for meningitis?"),
answer both parts sequentially, clearly labeled.

## RESPONSE FORMAT
- Be concise but complete. Use bullet points for lists, plain prose for explanations.
- For operational queries: lead with the key number or status, then detail.
- For clinical queries: lead with the direct answer, then evidence/caveats.
- Never pad with disclaimers. Be direct.
- Use KES for all monetary values.
- Dates: DD/MM/YYYY format as used in Kenya.

## CRITICAL RULES
1. Never share identifiable patient data in aggregate summaries beyond what is operationally necessary.
2. For emergencies flagged in data (e.g. critical lab values, no staff coverage in ICU), escalate urgency in your response.
3. If asked something outside your scope (legal advice, financial investment, personal matters), decline politely and redirect.`,
      pharmacy: `You are ARIA in Pharmacy & Therapeutics mode. Prioritize Kenyan formulary, KEML, KSTG, stock status, expiry risk, dosage precision, interactions, contraindications, reimbursement implications, and operational dispensing safety. For live stock questions, cite pharmacy_inventory or drug_batches explicitly. For dosing questions, specify route and frequency clearly.`,
      laboratory: `You are ARIA in Laboratory & AMR mode. Prioritize lab status, pending workload, microbiology interpretation, antibiogram-aware antibiotic reasoning, AMR stewardship, culture susceptibility, turnaround delays, and critical value escalation. Cite lab_tests, microbiology_results, or local antibiogram data explicitly when used.`,
      finance: `You are ARIA in Revenue Cycle mode. Prioritize SHA, insurance, M-Pesa, billing, eTIMS, credit exposure, and reconciliation accuracy. Use KES always, cite claims/payment data sources explicitly, and flag denied, delayed, or anomalous financial records proactively.`,
      inpatient: `You are ARIA in Inpatient Operations mode. Prioritize ward occupancy, free beds, admissions, nursing visibility, discharge bottlenecks, and patient flow risk. Cite wards, beds, visits, and staffing context explicitly when used.`,
      operations: `You are ARIA in Hospital Operations mode. Prioritize staffing, departmental coverage, service continuity, bottlenecks, risk scanning, and concise situation reporting for leadership. Lead with the operational picture, then anomalies and recommended actions.`,
      clinical: `You are ARIA in Clinical Decision Support mode. Prioritize direct clinical reasoning, Kenya STG/MOH/WHO alignment, differential diagnosis, first-line treatment, dosing detail, referral criteria, and bedside practicality. End higher-risk recommendations with "Confirm with the attending clinician."`,
    }

    const selectedPrompt = rolePrompts[role] || rolePrompts.master
    const fileContentBlock = selectedFile && fileText ? [
      '## UPLOADED FILE (if any)',
      `Filename: ${fileName}`,
      fileText.slice(0, 15000),
    ].join('\n') : '## UPLOADED FILE (if any)\nNone'

    return [
      selectedPrompt,
      '---',
      '## LIVE HOSPITAL DATA SNAPSHOT',
      buildContextText(),
      '',
      '## LOCAL ANTIBIOGRAM',
      buildAntibiogramText(),
      '',
      fileContentBlock,
      '',
      `User question: ${question || 'Analyze the uploaded file and share your findings.'}`,
    ].join('\n')
  }

  // Returns a fast local answer for clear hospital-data questions,
  // or null to let the question fall through to Gemini.
  const directAnswer = (question) => {
    if (!question) return null
    const normalized = question.toLowerCase()

    // ── NEW: detect pure clinical / pharmacology questions ──────────────────
    // These should always go to Gemini for proper medical knowledge answers.
    const isClinicalKnowledge = /side effect|side-effect|adverse effect|contraindication|drug interaction|mechanism of action|pharmacokinetic|pharmacodynamic|what is (the )?dose|dosage|max dose|loading dose|maintenance dose|indication|what is [a-z]+ used for|how does .* work|what is [a-z]+\??$|treatment for|symptoms of|diagnosis of|what causes|antibiotic|antibiotic cover|spectrum of|class of drug|brand name|generic name|half.?life|renal dose|hepatic dose|pregnancy category|paediatric dose|pediatric dose/.test(normalized)

    // Detect questions clearly about this hospital's live data
    const isHospitalData = /which ward|free bed|empty bed|available bed|bed count|who is (on duty|available|free)|staff on duty|expired (drug|medicine|stock)|expiry|low stock|reorder|pending lab|pending test|how many (bed|ward|patient|staff)|mpesa|insurance|sha|claim|credit|debt|amr|antibiogram|department|hospital summary|situation report/.test(normalized)

    // If it reads as clinical knowledge AND NOT clearly about hospital data → go straight to Gemini
    if (isClinicalKnowledge && !isHospitalData) return null
    // ────────────────────────────────────────────────────────────────────────

    const hasDrug = /drug|medicine|pharmacy|stock|expiry|expired/.test(normalized)
    const hasWard = /ward|bed|free|empty|available|capacity/.test(normalized)
    const hasStaff = /staff|who is free|available|on duty|doctor|nurse|laboratory|lab tech|pharmacist/.test(normalized)
    const wantsHospitalSummary = /hospital summary|situation report|what.*going on|operational picture|status report/.test(normalized)

    if (wantsHospitalSummary) {
      return [
        `Hospital situation report for ${hospitalName || 'your hospital'}:`,
        `- Beds free: ${freeBeds.length} of ${hospitalData.beds.length}.`,
        `- Pending lab tests: ${pendingLabTests.length}.`,
        `- Pending M-Pesa confirmations: ${pendingMpesaTransactions.length} worth ${formatKES(pendingMpesaTransactions.reduce((sum, tx) => sum + Number(tx.amount_kes || 0), 0))}.`,
        `- Pending SHA claims: ${pendingShaClaims.length}. Pending insurance claims: ${pendingInsuranceClaims.length}.`,
        `- Open credit balances: ${openCreditDebts.length} worth ${formatKES(openCreditDebts.reduce((sum, item) => sum + Number(item.balance || 0), 0))}.`,
        `- AMR stewardship alerts: ${amrSummary.pendingReview} awaiting pharmacist review, with ${amrSummary.resistantOverlap} resistant prescription overlaps.`,
      ].join('\n')
    }

    if (hasDrug && /expired|expiry/.test(normalized)) {
      if (expiredPharmacyItems.length === 0) {
        return 'I checked the current pharmacy records and there are no expired items in the loaded hospital data.'
      }
      return `Expired pharmacy items: ${expiredPharmacyItems.slice(0, 8).map(i => `${i.drug_name} (${i.expiry_date})`).join('; ')}.`
    }

    if (hasDrug && /(low stock|reorder|running low|stock).*(drug|medicine|item)/.test(normalized)) {
      if (lowStockPharmacyItems.length === 0) {
        return 'There are currently no low stock pharmacy items in the loaded hospital data.'
      }
      return `Low stock pharmacy items: ${lowStockPharmacyItems.map(i => `${i.drug_name} (${i.quantity_in_stock || 0} remaining)`).join('; ')}.`
    }

    if (hasWard && /(free|empty|available)/.test(normalized)) {
      if (freeBeds.length === 0) {
        return 'There are no free beds available right now according to the loaded ward data.'
      }
      const byWard = freeBeds.reduce((acc, bed) => {
        const name = wardNamesById[bed.ward_id] || 'Unknown Ward'
        acc[name] = (acc[name] || 0) + 1
        return acc
      }, {})
      return `Free beds: ${freeBeds.length}. ${Object.entries(byWard).map(([ward, count]) => `${ward}: ${count}`).join(', ')}.`
    }

    if (hasStaff && /(free|available|on duty|available now)/.test(normalized)) {
      if (availableStaff.length === 0) {
        return 'I could not find any active staff marked as on duty in the current hospital data.'
      }
      return `Available staff: ${availableStaff.map(s => `${s.full_name}${s.role ? ` (${s.role})` : ''}`).join(', ')}.`
    }

    if (/pending lab|lab tests.*pending|lab queue|tests still pending/.test(normalized)) {
      if (pendingLabTests.length === 0) {
        return 'There are no pending lab tests in the loaded hospital data right now.'
      }
      return `Pending lab tests: ${pendingLabTests.length}. ${pendingLabTests.slice(0, 8).map(test => `${test.test_name || 'Unnamed test'}${test.patient_name ? ` for ${test.patient_name}` : ''}`).join('; ')}.`
    }

    if (/mpesa|m-pesa/.test(normalized)) {
      if (pendingMpesaTransactions.length === 0) {
        return `There are no pending M-Pesa confirmations right now. Completed M-Pesa transactions loaded: ${hospitalData.mpesaTransactions.filter(tx => String(tx.status || '').toLowerCase() === 'completed').length}.`
      }
      return `Pending M-Pesa confirmations: ${pendingMpesaTransactions.length}, worth ${formatKES(pendingMpesaTransactions.reduce((sum, tx) => sum + Number(tx.amount_kes || 0), 0))}. Latest refs: ${pendingMpesaTransactions.slice(0, 6).map(tx => tx.reference || 'unreferenced').join(', ')}.`
    }

    if (/sha|social health authority/.test(normalized)) {
      if (pendingShaClaims.length === 0) {
        return 'There are no SHA claims awaiting action in the loaded hospital data.'
      }
      return `SHA claims awaiting action: ${pendingShaClaims.length}, worth ${formatKES(pendingShaClaims.reduce((sum, claim) => sum + Number(claim.amount_claimed || 0), 0))}. Patients in follow-up: ${pendingShaClaims.slice(0, 6).map(claim => claim.patient_name || 'Unknown patient').join(', ')}.`
    }

    if (/insurance|pre-auth|preauth|claim/.test(normalized)) {
      if (pendingInsuranceClaims.length === 0) {
        return 'There are no insurance claims awaiting action in the loaded hospital data.'
      }
      return `Insurance claims awaiting action: ${pendingInsuranceClaims.length}, worth ${formatKES(pendingInsuranceClaims.reduce((sum, claim) => sum + Number(claim.amount_kes || claim.amount_claimed || 0), 0))}. Follow-up insurers include ${[...new Set(pendingInsuranceClaims.slice(0, 8).map(claim => claim.insurer || claim.insurer_name || 'Unknown insurer'))].join(', ')}.`
    }

    if (/credit|debt|outstanding balance|arrears/.test(normalized)) {
      if (openCreditDebts.length === 0) {
        return 'There are no open credit balances in the loaded hospital data.'
      }
      return `Open credit balances: ${openCreditDebts.length} record(s), worth ${formatKES(openCreditDebts.reduce((sum, item) => sum + Number(item.balance || 0), 0))}.`
    }

    if (/amr|antibiogram|resistan|stewardship|microbiology/.test(normalized)) {
      if (amrInterventions.length === 0) {
        return 'There are no recent AMR stewardship alerts in the loaded microbiology results.'
      }
      const priorityPatients = amrInterventions.slice(0, 5).map(item => `${item.patientName} (${item.organism}${item.resistantMatches.length > 0 ? `, resistant overlap ${item.resistantMatches.map(match => match.drugName).join('/')}` : ''})`)
      return [
        `AMR stewardship watchlist: ${amrSummary.pendingReview} pending review, ${amrSummary.highSeverity} high-severity, ${amrSummary.resistantOverlap} resistant therapy overlaps.`,
        `Priority patients: ${priorityPatients.join('; ')}.`,
      ].join(' ')
    }

    if (/department|coverage gap|who is missing|staff gap/.test(normalized)) {
      if (departmentCoverage.uncovered.length === 0) {
        return `All ${activeDepartments.length} configured departments currently have at least one active staff member in the loaded data.`
      }
      return `Departments with no active staff coverage in the loaded data: ${departmentCoverage.uncovered.map(item => item.name).join(', ')}.`
    }

    if (/which ward.*(free|empty|available)/.test(normalized)) {
      if (freeBeds.length === 0) {
        return 'No free wards or beds are available right now.'
      }
      const wardFreeNames = [...new Set(freeBeds.map(b => wardNamesById[b.ward_id] || 'Unknown Ward'))]
      return `Wards with free beds: ${wardFreeNames.join(', ')}.`
    }

    if (/which drug.*expired|expired drug|medicine.*expired/.test(normalized)) {
      if (expiredPharmacyItems.length === 0) {
        return 'No expired drugs appear in the current pharmacy records.'
      }
      return `Expired drugs: ${expiredPharmacyItems.map(i => `${i.drug_name} (${i.expiry_date})`).join('; ')}.`
    }

    return null
  }

  const sendMessage = async (customInput) => {
    const question = customInput || input
    if ((!question.trim() && !selectedFile) || loading || extracting) return

    const userMsg = {
      type: 'user',
      text: question || `Analyze this file: ${fileName || 'uploaded document'}`,
      image: filePreview
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const direct = directAnswer(question)
      if (direct && !selectedFile) {
        setMessages(prev => [...prev, { type: 'bot', text: direct }])
        setLoading(false)
        setSelectedFile(null)
        setFilePreview(null)
        setFileText('')
        return
      }

      const role = detectIntentRole(question)
      const prompt = buildPrompt(question, role)

      const parts = [{ text: prompt }]
      if (selectedFile && filePreview && selectedFile.type.startsWith('image/')) {
        parts.push({ inlineData: { mimeType: selectedFile.type, data: filePreview.split(',')[1] } })
      }

      // The answer streams in word by word; the server falls back to the next AI provider if one is busy or slow.
      const showLive = (text) => setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.streaming) return text ? [...prev.slice(0, -1), { ...last, text }] : prev.slice(0, -1)
        return text ? [...prev, { type: 'bot', text, streaming: true }] : prev
      })
      const result = await streamGeminiContent({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1800,
          topP: 0.95,
          topK: 40
        },
        hospitalId,
      }, (text, providerLabel) => {
        if (providerLabel) setAnsweringWith(providerLabel)
        setAnswerStarted(Boolean(text))
        showLive(text)
      })

      setMessages(prev => {
        const finished = { type: 'bot', text: result.text, answeredBy: result.provider }
        return prev[prev.length - 1]?.streaming ? [...prev.slice(0, -1), finished] : [...prev, finished]
      })
    } catch (err) {
      console.error(err)
      setMessages(prev => [...prev.filter(message => !message.streaming), { type: 'bot', text: `Error: ${err.message || 'Failed to connect to AI.'}` }])
    }
    setAnswerStarted(false)
    setAnsweringWith('')

    setSelectedFile(null)
    setFilePreview(null)
    setFileText('')
    setFileName('')
    setLoading(false)
  }

  return (
    <div style={styles.page}>
      <div style={styles.topbar}>
        <div>
          <h2 style={styles.title}>AI Clinical Assist</h2>
          <div style={styles.subtitle}>HMIS assistant for {hospitalName || 'your hospital'}</div>
        </div>
        <span style={styles.powered}>Multi-AI with automatic fallback • hospital-aware</span>
      </div>

      <div style={styles.snapshotRow}>
        {[
          { label: 'Free Beds', value: freeBeds.length, sub: `${hospitalData.beds.length} total beds` },
          { label: 'Pending Labs', value: pendingLabTests.length, sub: `${hospitalData.labTests.length} tests loaded` },
          { label: 'Claims Follow-up', value: pendingShaClaims.length + pendingInsuranceClaims.length, sub: `${pendingMpesaTransactions.length} M-Pesa pending` },
          { label: 'AMR Watchlist', value: amrSummary.pendingReview, sub: `${amrSummary.resistantOverlap} resistant overlaps` },
        ].map(card => (
          <div key={card.label} style={styles.snapshotCard}>
            <div style={styles.snapshotLabel}>{card.label}</div>
            <div style={styles.snapshotValue}>{card.value}</div>
            <div style={styles.snapshotSub}>{card.sub}</div>
          </div>
        ))}
      </div>

      <div style={styles.chatWrap}>
        <div style={styles.chatMessages}>
          {messages.map((msg, i) => (
            <div key={i} style={msg.type === 'user' ? styles.msgUser : styles.msgBot}>
              {msg.type === 'bot' && <div style={styles.botLabel}>HMIS AI</div>}
              {msg.image && <img src={msg.image} alt="uploaded" style={styles.chatImage} />}
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{msg.text}</div>
            </div>
          ))}
          {loading && !answerStarted && (
            <div style={styles.msgBot}>
              <div style={styles.botLabel}>HMIS AI</div>
              {answeringWith ? `Thinking (${answeringWith})...` : 'Thinking...'}
            </div>
          )}
        </div>

        {(filePreview || selectedFile) && (
          <div style={styles.imagePreview}>
            {filePreview && <img src={filePreview} alt="preview" style={styles.previewImg} />}
            <div style={{ fontSize: '11px', color: '#666' }}>{selectedFile?.name || fileName}</div>
            <button onClick={() => { setSelectedFile(null); setFilePreview(null); setFileText(''); setFileName('') }} style={styles.removeBtn}>Remove</button>
          </div>
        )}

        <div style={styles.chatInputRow}>
          <input type="file" accept="image/*,.pdf,.csv,.xls,.xlsx" onChange={handleFileUpload} style={{ display: 'none' }} id="image-upload" />
          <label htmlFor="image-upload" style={styles.uploadBtn}>📎</label>
          <input
            style={styles.chatInput}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && sendMessage()}
            placeholder="Ask about pharmacy, wards, staff, drug side effects, dosages…"
            disabled={loading}
          />
          <button style={{ ...styles.btnPrimary, opacity: loading ? 0.6 : 1 }} onClick={() => sendMessage()} disabled={loading}>
            {loading ? '…' : 'Send'}
          </button>
        </div>
      </div>

      <div style={styles.quickQueries}>
        <div style={styles.cardTitle}>Quick queries</div>
        <div style={styles.quickButtons}>
          {[
            ['Hospital brief',           'Give me the hospital situation report right now.'],
            ['AMR watchlist',            'What AMR stewardship alerts need pharmacist review right now?'],
            ['Pending M-Pesa',           'Which M-Pesa transactions are still pending confirmation?'],
            ['SHA follow-up',            'Which SHA claims still need action?'],
            ['Insurance follow-up',      'Which insurance claims are still pending or under review?'],
            ['Dept coverage gaps',       'Which departments have no active staff coverage right now?'],
            ['Pending lab tests',        'What lab tests are still pending?'],
            ['Expired drugs',            'Which drugs in pharmacy are expired?'],
            ['Metformin contraindications', 'What are the contraindications of metformin?'],
            ['Sepsis treatment',         'What is the first-line treatment for sepsis?'],
          ].map(([label, question]) => (
            <button key={label} style={styles.quickBtn} onClick={() => sendMessage(question)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles = {
  page: { padding: '18px 22px', flex: 1, overflowY: 'auto' },
  topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' },
  title: { fontSize: '15px', fontWeight: '600', color: '#111' },
  subtitle: { fontSize: '12px', color: '#555', marginTop: '4px' },
  powered: { fontSize: '11px', color: '#1D9E75', fontWeight: '500' },
  snapshotRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '16px' },
  snapshotCard: { background: '#fff', border: '1px solid #e8ebe8', borderRadius: '10px', padding: '12px 14px' },
  snapshotLabel: { fontSize: '10px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '700' },
  snapshotValue: { fontSize: '22px', color: '#111', fontWeight: '700', marginTop: '5px' },
  snapshotSub: { fontSize: '11px', color: '#666', marginTop: '4px' },
  chatWrap: { background: '#fff', border: '1px solid #e8ebe8', borderRadius: '10px', padding: '14px', height: '420px', display: 'flex', flexDirection: 'column' },
  chatMessages: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '10px' },
  msgUser: { alignSelf: 'flex-end', background: '#0F6E56', color: '#fff', padding: '10px 14px', borderRadius: '10px 10px 2px 10px', maxWidth: '75%', fontSize: '13px' },
  msgBot: { alignSelf: 'flex-start', background: '#f9fbf9', border: '1px solid #e8ebe8', padding: '10px 14px', borderRadius: '10px 10px 10px 2px', maxWidth: '80%', fontSize: '13px' },
  botLabel: { fontSize: '10px', color: '#1D9E75', fontWeight: '600', marginBottom: '4px' },
  chatImage: { maxWidth: '200px', borderRadius: '8px', marginBottom: '8px', display: 'block' },
  chatInputRow: { display: 'flex', gap: '8px', alignItems: 'center' },
  chatInput: { flex: 1, padding: '10px 14px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '13px' },
  btnPrimary: { background: '#0F6E56', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: '500', fontSize: '13px' },
  uploadBtn: { padding: '9px 13px', background: '#f0f2f0', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', border: '1px solid #ddd' },
  imagePreview: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', padding: '8px 12px', background: '#f9fbf9', borderRadius: '8px', border: '1px dashed #ccc' },
  previewImg: { maxHeight: '70px', borderRadius: '6px' },
  removeBtn: { background: '#FCEBEB', color: '#A32D2D', border: 'none', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', marginLeft: 'auto' },
  quickQueries: { marginTop: '16px' },
  cardTitle: { fontSize: '13px', fontWeight: '600', color: '#111', marginBottom: '8px' },
  quickButtons: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  quickBtn: { background: '#fff', color: '#0F6E56', border: '1px solid #0F6E56', padding: '6px 14px', borderRadius: '9999px', fontSize: '12px', cursor: 'pointer' }
}
