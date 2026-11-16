import { useEffect, useMemo, useRef, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import { typography } from '../theme'
import { canPerformAction, resolveRole } from '../access'
import { executeWithFallback, omitKeys } from '../utils/dbCompat'
import { extractGeminiText, generateGeminiContent } from '../utils/geminiProxy'
import {
  formatAntibioticLabel,
  getSusceptibilityEntries,
  normalizeSusceptibilityKey,
  normalizeSusceptibilityProfile,
} from '../utils/hospitalSignals'
import { executeMicrobiologyQuery, MICROBIOLOGY_RESULT_BASE_COLUMNS } from '../utils/microbiologyResults'
import { notifyError, notifyWarning } from '../notifications'

// All antibiotics tracked (column key -> display label)
const ANTIBIOTICS = [
  { key: 'amoxicillin',       label: 'Amoxicillin' },
  { key: 'amox_clav',         label: 'Amox-Clav' },
  { key: 'ampicillin',        label: 'Ampicillin' },
  { key: 'cotrimoxazole',     label: 'Cotrimoxazole' },
  { key: 'ciprofloxacin',     label: 'Ciprofloxacin' },
  { key: 'levofloxacin',      label: 'Levofloxacin' },
  { key: 'norfloxacin',       label: 'Norfloxacin' },
  { key: 'gentamicin',        label: 'Gentamicin' },
  { key: 'amikacin',          label: 'Amikacin' },
  { key: 'ceftriaxone',       label: 'Ceftriaxone' },
  { key: 'cefuroxime',        label: 'Cefuroxime' },
  { key: 'ceftazidime',       label: 'Ceftazidime' },
  { key: 'cefepime',          label: 'Cefepime' },
  { key: 'meropenem',         label: 'Meropenem' },
  { key: 'imipenem',          label: 'Imipenem' },
  { key: 'piperacillin_tazo', label: 'Pip-Tazo' },
  { key: 'nitrofurantoin',    label: 'Nitrofurantoin' },
  { key: 'tetracycline',      label: 'Tetracycline' },
  { key: 'doxycycline',       label: 'Doxycycline' },
  { key: 'clindamycin',       label: 'Clindamycin' },
  { key: 'erythromycin',      label: 'Erythromycin' },
  { key: 'azithromycin',      label: 'Azithromycin' },
  { key: 'vancomycin',        label: 'Vancomycin' },
  { key: 'linezolid',         label: 'Linezolid' },
  { key: 'chloramphenicol',   label: 'Chloramphenicol' },
  { key: 'metronidazole',     label: 'Metronidazole' },
]

const KNOWN_ANTIBIOTIC_KEYS = new Set(ANTIBIOTICS.map(a => a.key))

function normalizeAntibioticText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const ANTIBIOTIC_KEY_MAP = Object.fromEntries([
  ...ANTIBIOTICS.flatMap(a => [[a.label, a.key], [a.key, a.key]]),
  ['amox-clav', 'amox_clav'], ['amoxicillin-clavulanate', 'amox_clav'],
  ['amoxicillin clavulanate', 'amox_clav'], ['augmentin', 'amox_clav'],
  ['co-trimoxazole', 'cotrimoxazole'], ['trimethoprim-sulfamethoxazole', 'cotrimoxazole'], ['tmp-smx', 'cotrimoxazole'],
  ['trimethoprim sulfamethoxazole', 'cotrimoxazole'], ['bactrim', 'cotrimoxazole'],
  ['pip-tazo', 'piperacillin_tazo'], ['piperacillin/tazobactam', 'piperacillin_tazo'], ['piptazo', 'piperacillin_tazo'],
  ['piperacillin tazobactam', 'piperacillin_tazo'], ['tazocin', 'piperacillin_tazo'],
  ['cipro', 'ciprofloxacin'], ['levo', 'levofloxacin'], ['gent', 'gentamicin'], ['amik', 'amikacin'],
  ['ceftri', 'ceftriaxone'], ['rocephin', 'ceftriaxone'], ['cefurox', 'cefuroxime'], ['ceftaz', 'ceftazidime'],
  ['cefepim', 'cefepime'], ['meropenem', 'meropenem'], ['merrem', 'meropenem'], ['imipenem', 'imipenem'],
  ['nitrofurant', 'nitrofurantoin'], ['vanco', 'vancomycin'], ['linezolid', 'linezolid'],
  ['chloramph', 'chloramphenicol'], ['metro', 'metronidazole'], ['flagyl', 'metronidazole'],
  ['doxy', 'doxycycline'], ['clinda', 'clindamycin'], ['erythro', 'erythromycin'], ['azithro', 'azithromycin'],
].map(([label, key]) => [normalizeAntibioticText(label), key]))

const SAMPLE_TYPES = ['All', 'Urine', 'Blood', 'Wound Swab', 'Sputum', 'CSF', 'HVS', 'Stool', 'Other']

const BLANK_FORM = {
  patient_name: '', lab_test_id: '', patient_id: '',
  sample_type: 'Urine', collection_date: new Date().toISOString().split('T')[0],
  received_date: '', reported_date: '',
  organism_identified: '', colony_count: '', gram_stain: '', growth: 'Heavy',
  diagnosis: '', ward_department: '', clinical_notes: '', performed_by: '', verified_by: '',
  esbl: false, mrsa: false, vre: false, carbapenem_r: false,
  susceptibility_profile: {},
  ...Object.fromEntries(ANTIBIOTICS.map(a => [a.key, 'NT'])),
}

const EXCLUDED_FIELDS = new Set(MICROBIOLOGY_RESULT_BASE_COLUMNS)

function normalizeSIR(value) {
  const v = String(value || '').trim().toUpperCase()
  if (['S', 'I', 'R', 'NT'].includes(v)) return v
  if (v === 'SUSCEPTIBLE') return 'S'
  if (v === 'INTERMEDIATE') return 'I'
  if (v === 'RESISTANT') return 'R'
  return ''
}

function resolveKnownAntibioticKey(name) {
  const normalizedName = normalizeAntibioticText(name)
  if (!normalizedName) return null

  const directKey = ANTIBIOTIC_KEY_MAP[normalizedName]
  if (directKey) return directKey

  const bestMatch = ANTIBIOTICS
    .map(antibiotic => {
      const label = normalizeAntibioticText(antibiotic.label)
      const key = normalizeAntibioticText(antibiotic.key)
      let score = -1

      if (label === normalizedName || key === normalizedName) score = 100
      else if (normalizedName.length >= 5 && label.includes(normalizedName)) score = 80
      else if (label.length >= 5 && normalizedName.includes(label)) score = 70
      else if (normalizedName.length >= 5 && key.includes(normalizedName)) score = 60
      else if (key.length >= 5 && normalizedName.includes(key)) score = 50

      return { key: antibiotic.key, score }
    })
    .filter(match => match.score >= 0)
    .sort((a, b) => b.score - a.score)[0]

  return bestMatch?.key || null
}

function buildProfileEntry(key, label, sir) {
  const normalizedKey = normalizeSusceptibilityKey(key)
  const normalizedSir = normalizeSIR(sir)
  if (!normalizedKey || !normalizedSir || EXCLUDED_FIELDS.has(normalizedKey)) return null

  return {
    key: normalizedKey,
    label: String(label || formatAntibioticLabel(normalizedKey)).trim() || formatAntibioticLabel(normalizedKey),
    sir: normalizedSir,
  }
}

function buildSusceptibilityFields(rawAntibiotics = {}) {
  const columnValues = {}
  const profile = {}

  Object.entries(rawAntibiotics || {}).forEach(([name, value]) => {
    const sir = normalizeSIR(value)
    const label = String(name || '').trim()
    if (!label || !sir) return

    const knownKey = resolveKnownAntibioticKey(label)
    if (knownKey) {
      columnValues[knownKey] = sir
      return
    }

    const entry = buildProfileEntry(label, label, sir)
    if (entry) {
      profile[entry.key] = { label: entry.label, sir: entry.sir }
    }
  })

  return { columnValues, profile }
}

function hydrateMicrobiologyRow(row) {
  const profile = normalizeSusceptibilityProfile(row?.susceptibility_profile)
  const hydrated = { ...(row || {}), susceptibility_profile: profile }

  Object.values(profile).forEach(entry => {
    if (!hydrated[entry.key]) hydrated[entry.key] = entry.sir
  })

  return hydrated
}

function buildMicrobiologyPayload(row, hospitalId = null) {
  const payload = { ...(row || {}) }
  if (hospitalId) payload.hospital_id = hospitalId

  delete payload.id
  delete payload.created_at
  delete payload.updated_at
  delete payload.ai_suggestion

  const profile = normalizeSusceptibilityProfile(payload.susceptibility_profile)
  const extraKeys = new Set(Object.keys(profile))

  Object.entries(row || {}).forEach(([key, value]) => {
    if (KNOWN_ANTIBIOTIC_KEYS.has(key) || EXCLUDED_FIELDS.has(key)) return
    const sir = normalizeSIR(value)
    if (!sir) return

    const entry = buildProfileEntry(key, profile[key]?.label || formatAntibioticLabel(key), sir)
    if (!entry) return

    profile[entry.key] = { label: entry.label, sir: entry.sir }
    extraKeys.add(entry.key)
  })

  extraKeys.forEach(key => {
    delete payload[key]
  })

  payload.susceptibility_profile = Object.keys(profile).length > 0 ? profile : {}
  return payload
}

// ─── Gemini API extraction ────────────────────────────────────────────────────
async function extractWithGemini(fileDataUrl, mimeType, fileName) {
  const isImage = mimeType.startsWith('image/')
  const userPrompt = `Extract culture & sensitivity (C&S / antibiogram) results from the provided document. Return ONLY valid JSON in this exact format (no markdown, no preamble):\n${JSON.stringify({
    results: [
      {
        patient_name: 'string or null',
        organism_identified: 'full species name',
        sample_type: 'Urine|Blood|Wound Swab|Sputum|CSF|HVS|Stool|Other',
        collection_date: 'YYYY-MM-DD or null',
        gram_stain: 'string or null',
        growth: 'Heavy|Moderate|Light|No Growth or null',
        colony_count: 'string or null',
        ward_department: 'string or null',
        esbl: true,
        mrsa: true,
        vre: true,
        carbapenem_r: true,
        antibiotics: {
          antibiotic_name: 'S|I|R|NT'
        }
      }
    ]
  }, null, 2)}\n\nFor antibiotics use the exact names written on the report. Do not limit yourself to the example names, and do not omit an antibiotic just because it is uncommon or not predefined in the system.\nS = Sensitive/Susceptible, I = Intermediate, R = Resistant, NT = Not Tested. Extract every organism row separately and include every antibiotic shown for that isolate. If a field is not present, use null.`

  const parts = [{ text: userPrompt }]
  if (fileDataUrl) {
    parts.push({ inlineData: { mimeType, data: fileDataUrl.split(',')[1] } })
  }

  const data = await generateGeminiContent({
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.0,
      // A multi-isolate instrument report (e.g. VITEK 2 with 6+ isolates × 15+ drugs) needs far more than 1,200 tokens;
      // a truncated answer is invalid JSON and the whole upload failed.
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      topP: 0.95,
      topK: 40
    }
  })

  const text = extractGeminiText(data) || ''
  const clean = text.replace(/```json|```/gi, '').trim()
  return JSON.parse(clean)

  const legacyResponse = await fetch(
    'https://example.invalid/gemini-disabled',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.0,
          maxOutputTokens: 1200,
          topP: 0.95,
          topK: 40
        }
      })
    }
  )

  if (!legacyResponse.ok) {
    const err = await legacyResponse.text()
    throw new Error(`Gemini API error: ${response.status} — ${err.slice(0, 200)}`)
  }

  const legacyData = await legacyResponse.json()
  const legacyText = legacyData?.candidates?.[0]?.content?.parts?.map(p => p.text).join(' ') || ''
  const legacyClean = legacyText.replace(/```json|```/gi, '').trim()
  return JSON.parse(legacyClean)
}

// Map Claude's extracted result to our DB schema
function mapClaudeResultToRow(result, hospitalId) {
  const { columnValues, profile } = buildSusceptibilityFields(result.antibiotics || {})

  return hydrateMicrobiologyRow({
    hospital_id: hospitalId,
    patient_name: result.patient_name || null,
    organism_identified: result.organism_identified || null,
    sample_type: result.sample_type || 'Other',
    collection_date: result.collection_date || new Date().toISOString().split('T')[0],
    gram_stain: result.gram_stain || null,
    growth: result.growth || null,
    colony_count: result.colony_count || null,
    ward_department: result.ward_department || null,
    esbl: !!result.esbl,
    mrsa: !!result.mrsa,
    vre: !!result.vre,
    carbapenem_r: !!result.carbapenem_r,
    susceptibility_profile: profile,
    ...columnValues,
  })
}

// ─── CSV / Excel fallback parser ──────────────────────────────────────────────
async function parseSpreadsheetFile(file) {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const rows = []
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName]
    rows.push(...XLSX.utils.sheet_to_json(sheet, { defval: '' }))
  })
  return rows
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const row = {}
    headers.forEach((h, i) => { row[h] = vals[i] || '' })
    return row
  })
}

function mapSpreadsheetRow(raw, hospitalId) {
  const row = { hospital_id: hospitalId, ...Object.fromEntries(ANTIBIOTICS.map(a => [a.key, 'NT'])) }
  const get = (...keys) => {
    for (const k of keys) {
      const match = Object.keys(raw).find(rk => rk.toLowerCase().replace(/[^a-z]/g, '') === k.replace(/[^a-z]/g, ''))
      if (match && raw[match]) return raw[match]
    }
    return null
  }
  row.patient_name = get('patientname', 'patient', 'name') || null
  row.organism_identified = get('organismidentified', 'organism', 'isolate') || null
  row.sample_type = get('sampletype', 'sample', 'specimen') || 'Other'
  row.collection_date = get('collectiondate', 'collected', 'date') || new Date().toISOString().split('T')[0]
  row.gram_stain = get('gramstain', 'gram') || null
  row.growth = get('growth') || null
  row.colony_count = get('colonycount', 'cfu') || null
  row.ward_department = get('ward', 'department', 'warddepartment') || null
  row.esbl = String(get('esbl') || '').toLowerCase() === 'true' || String(get('esbl') || '').toUpperCase() === 'YES'
  row.mrsa = String(get('mrsa') || '').toLowerCase() === 'true' || String(get('mrsa') || '').toUpperCase() === 'YES'
  row.vre = String(get('vre') || '').toLowerCase() === 'true'
  row.carbapenem_r = String(get('carbapenemr', 'carbapenemresistant') || '').toLowerCase() === 'true'

  const antibioticValues = Object.entries(raw).reduce((acc, [header, value]) => {
    const sir = normalizeSIR(value)
    if (sir) acc[header] = sir
    return acc
  }, {})

  const { columnValues, profile } = buildSusceptibilityFields(antibioticValues)
  return hydrateMicrobiologyRow({ ...row, ...columnValues, susceptibility_profile: profile })
}

export default function Antibiogram({ onNavigateLab, onNavigateAI }) {
  const { hospitalId, userRole } = useHospital()
  const canManage = resolveRole(userRole) === 'Admin' || canPerformAction(userRole, 'manage_antibiogram')
  const [tab, setTab] = useState('patient')
  const [results, setResults] = useState([])
  const [labTests, setLabTests] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [filterOrganism, setFilterOrganism] = useState('All')
  const [filterSample, setFilterSample] = useState('All')

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)
  const [editingId, setEditingId] = useState(null)
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState([])

  // Detail panel
  const [selected, setSelected] = useState(null)
  const reportRef = useRef(null)

  // Upload state
  const [uploadError, setUploadError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadStep, setUploadStep] = useState('') // status message
  const [uploadPreviewRows, setUploadPreviewRows] = useState([])
  const [previewFileName, setPreviewFileName] = useState('')
  const [showUploadPreview, setShowUploadPreview] = useState(false)

  const [customAntibioticName, setCustomAntibioticName] = useState('')

  function broadcastAntibiogramUpdated(detail = {}) {
    try {
      window.dispatchEvent(new CustomEvent('remedacare:antibiogram_updated', { detail }))
    } catch (_) {}
  }

  const allAntibiotics = useMemo(() => {
    const labels = new Map(ANTIBIOTICS.map(a => [a.key, a.label]))
    results.forEach(row => {
      getSusceptibilityEntries(row, { includeNotTested: true }).forEach(entry => {
        if (!labels.has(entry.key) || !KNOWN_ANTIBIOTIC_KEYS.has(entry.key)) {
          labels.set(entry.key, entry.label)
        }
      })
    })
    return [
      ...ANTIBIOTICS,
      ...Array.from(labels.entries())
        .filter(([key]) => !KNOWN_ANTIBIOTIC_KEYS.has(key))
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([key, label]) => ({ key, label })),
    ]
  }, [results])

  const formAntibiotics = useMemo(() => {
    const labels = new Map(allAntibiotics.map(a => [a.key, a.label]))
    getSusceptibilityEntries(form, { includeNotTested: true }).forEach(entry => {
      if (!labels.has(entry.key) || !KNOWN_ANTIBIOTIC_KEYS.has(entry.key)) {
        labels.set(entry.key, entry.label)
      }
    })
    return [
      ...ANTIBIOTICS,
      ...Array.from(labels.entries())
        .filter(([key]) => !KNOWN_ANTIBIOTIC_KEYS.has(key))
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([key, label]) => ({ key, label })),
    ]
  }, [allAntibiotics, form])

  function setFormAntibioticValue(key, value, label = null) {
    const sir = normalizeSIR(value) || 'NT'
    setForm(current => {
      const next = { ...current, [key]: sir }
      if (!KNOWN_ANTIBIOTIC_KEYS.has(key)) {
        const profile = normalizeSusceptibilityProfile(current.susceptibility_profile)
        profile[key] = {
          label: String(label || profile[key]?.label || formatAntibioticLabel(key)).trim() || formatAntibioticLabel(key),
          sir,
        }
        next.susceptibility_profile = profile
      }
      return next
    })
  }

  function addCustomAntibiotic() {
    const raw = customAntibioticName.trim()
    if (!raw) return
    const knownKey = resolveKnownAntibioticKey(raw)
    const key = knownKey || normalizeSusceptibilityKey(raw)
    if (!key || EXCLUDED_FIELDS.has(key)) { notifyWarning('Invalid antibiotic name.'); return }
    setForm(current => {
      const next = { ...current, [key]: normalizeSIR(current[key]) || 'NT' }
      if (!KNOWN_ANTIBIOTIC_KEYS.has(key)) {
        const profile = normalizeSusceptibilityProfile(current.susceptibility_profile)
        profile[key] = { label: raw, sir: normalizeSIR(current[key]) || 'NT' }
        next.susceptibility_profile = profile
      }
      return next
    })
    setCustomAntibioticName('')
  }

  // ─── Upload handler ──────────────────────────────────────────────────────
  async function handleUploadFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploadError('')
    setUploading(true)
    setUploadStep('Reading file...')

    try {
      const fileName = file.name
      const mimeType = file.type
      const isCsv = fileName.toLowerCase().endsWith('.csv')
      const isExcel = fileName.toLowerCase().match(/\.(xlsx|xls)$/)
      const isImage = mimeType.startsWith('image/')
      const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')

      let uploadRows = []

      if (isCsv || isExcel) {
        // Spreadsheets: parse directly, no AI needed
        setUploadStep('Parsing spreadsheet...')
        const rawRows = isCsv
          ? parseCSV(await file.text())
          : await parseSpreadsheetFile(file)

        if (rawRows.length === 0) throw new Error('No rows found in the spreadsheet.')

        uploadRows = rawRows
          .map(r => mapSpreadsheetRow(r, hospitalId))
          .filter(r => r.patient_name && r.organism_identified)

        if (uploadRows.length === 0) {
          throw new Error('No valid C&S rows found. Make sure your spreadsheet has "Patient Name" and "Organism Identified" columns.')
        }
      } else if (isImage || isPdf) {
        // Images and PDFs: use Gemini API for smart extraction
        setUploadStep('Sending to AI for extraction...')
        const dataUrl = await new Promise((res, rej) => {
          const reader = new FileReader()
          reader.onload = e => res(e.target.result)
          reader.onerror = rej
          reader.readAsDataURL(file)
        })

        const extracted = await extractWithGemini(dataUrl, mimeType, fileName)

        if (!extracted?.results?.length) {
          throw new Error('AI could not find any C&S results in this document. Make sure it contains a culture & sensitivity report.')
        }

        uploadRows = extracted.results
          .map(r => mapClaudeResultToRow(r, hospitalId))
          .filter(r => r.organism_identified)

        // If patient_name missing, mark as Unknown
        uploadRows = uploadRows.map(r => ({
          ...r,
          patient_name: r.patient_name || 'Unknown — verify before saving'
        }))

        if (uploadRows.length === 0) {
          throw new Error('No valid isolate rows could be extracted. Try uploading a clearer image or CSV.')
        }
      } else {
        throw new Error('Unsupported format. Use: image (JPG/PNG), PDF, CSV, or Excel (XLSX/XLS).')
      }

      setUploadPreviewRows(uploadRows)
      setPreviewFileName(fileName)
      setShowUploadPreview(true)
      setUploadStep('')
    } catch (err) {
      setUploadError(err.message || 'Upload failed.')
      setUploadStep('')
    }

    setUploading(false)
    event.target.value = ''
  }

  async function confirmUploadPreview() {
    if (uploadPreviewRows.length === 0) return
    setUploading(true)
    setUploadError('')
    try {
      const payloads = uploadPreviewRows.map(row => buildMicrobiologyPayload(row))
      const hasExtraSusceptibility = payloads.some(payload => Object.keys(payload.susceptibility_profile || {}).length > 0)
      let usedCompatFallback = false
      const { error } = await executeWithFallback(
        () => supabase.from('microbiology_results').insert(payloads),
        async () => {
          usedCompatFallback = true
          return supabase.from('microbiology_results').insert(payloads.map(payload => omitKeys(payload, ['susceptibility_profile'])))
        }
      )
      if (error) throw error
      setShowUploadPreview(false)
      setUploadPreviewRows([])
      setPreviewFileName('')
      broadcastAntibiogramUpdated({ source: 'upload', count: uploadPreviewRows.length })
      if (usedCompatFallback && hasExtraSusceptibility) {
        setUploadError('Saved the standard antibiotics, but extra S/I/R agents were skipped because `microbiology_results.susceptibility_profile` is missing. Apply `microbiology_susceptibility_profile_upgrade.sql` to preserve the full extract.')
      }
      fetchAll()
    } catch (err) {
      setUploadError(err.message || 'Failed to save.')
    }
    setUploading(false)
  }

  function cancelUploadPreview() {
    setShowUploadPreview(false)
    setUploadPreviewRows([])
    setPreviewFileName('')
    setUploadError('')
  }

  useEffect(() => { if (!hospitalId) { setLoading(false); return }; fetchAll() }, [hospitalId])

  async function fetchAll() {
    setLoading(true)
    const [r1, r2, r3] = await Promise.all([
      executeMicrobiologyQuery(select =>
        supabase.from('microbiology_results').select(select).eq('hospital_id', hospitalId).order('collection_date', { ascending: false }),
      ),
      supabase.from('patients').select('id,full_name,phone,age,gender').eq('hospital_id', hospitalId).order('full_name'),
      supabase.from('lab_tests').select('id,test_type,patient_name,category').eq('hospital_id', hospitalId).eq('category', 'Microbiology').order('ordered_at', { ascending: false }).limit(200),
    ])
    setResults((r1.data || []).map(hydrateMicrobiologyRow))
    setLabTests(r3.data || [])
    setLoading(false)
  }

  async function searchPatients(q) {
    setPatientSearch(q)
    if (!q.trim()) { setPatientResults([]); return }
    const { data } = await supabase.from('patients')
      .select('id,full_name,phone,age,gender')
      .eq('hospital_id', hospitalId)
      .ilike('full_name', `%${q.trim()}%`)
      .order('full_name')
      .limit(10)
    setPatientResults(data || [])
  }
  function pickPatient(p) {
    setPatientSearch(p.full_name)
    setPatientResults([])
    setForm(f => ({ ...f, patient_name: p.full_name, patient_id: p.id }))
  }
  function openNew() {
    if (!canManage) return
    setForm({ ...BLANK_FORM, susceptibility_profile: {} })
    setEditingId(null)
    setPatientSearch('')
    setCustomAntibioticName('')
    setShowModal(true)
  }
  function openEdit(r) {
    if (!canManage) return
    setForm(hydrateMicrobiologyRow({ ...BLANK_FORM, ...r }))
    setEditingId(r.id)
    setPatientSearch(r.patient_name || '')
    setCustomAntibioticName('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!canManage) return
    if (!form.patient_name) { notifyWarning('Patient name required'); return }
    if (!form.organism_identified) { notifyWarning('Organism identified required'); return }
    setSaving(true)
    const payload = buildMicrobiologyPayload(form, hospitalId)
    const hasExtraSusceptibility = Object.keys(payload.susceptibility_profile || {}).length > 0
    let usedCompatFallback = false
    const runSave = savePayload => (
      editingId
        ? supabase.from('microbiology_results').update({ ...savePayload, updated_at: new Date().toISOString() }).eq('id', editingId)
        : supabase.from('microbiology_results').insert(savePayload)
    )
    const { error } = await executeWithFallback(
      () => runSave(payload),
      async () => {
        usedCompatFallback = true
        return runSave(omitKeys(payload, ['susceptibility_profile']))
      }
    )
    if (error) { notifyError('Error: ' + error.message); setSaving(false); return }
    setShowModal(false)
    broadcastAntibiogramUpdated({ source: editingId ? 'edit' : 'create', id: editingId || null, patient_id: form.patient_id || null })
    if (usedCompatFallback && hasExtraSusceptibility) {
      notifyWarning('Saved the standard antibiotics, but extra S/I/R agents were not preserved because `microbiology_results.susceptibility_profile` is missing. Apply `microbiology_susceptibility_profile_upgrade.sql` to keep the full culture susceptibility profile.')
    }
    fetchAll()
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!canManage) return
    if (!await window.openConfirmDialog('Delete this microbiology result? This cannot be undone.')) return
    await supabase.from('microbiology_results').delete().eq('id', id)
    setSelected(null)
    broadcastAntibiogramUpdated({ source: 'delete', id })
    fetchAll()
  }

  const organisms = useMemo(() => {
    const all = results.map(r => r.organism_identified).filter(Boolean)
    return ['All', ...new Set(all)].sort()
  }, [results])

  const filteredResults = useMemo(() => results.filter(r => {
    const matchSearch = !search || r.patient_name?.toLowerCase().includes(search.toLowerCase()) || r.organism_identified?.toLowerCase().includes(search.toLowerCase())
    const matchOrg = filterOrganism === 'All' || r.organism_identified === filterOrganism
    const matchSample = filterSample === 'All' || r.sample_type === filterSample
    return matchSearch && matchOrg && matchSample
  }), [results, search, filterOrganism, filterSample])

  const hospitalMatrix = useMemo(() => {
    const scope = filterSample === 'All' ? results : results.filter(r => r.sample_type === filterSample)
    const byOrg = {}
    scope.forEach(r => {
      if (!r.organism_identified) return
      if (!byOrg[r.organism_identified]) byOrg[r.organism_identified] = []
      byOrg[r.organism_identified].push(r)
    })
    return Object.entries(byOrg).map(([org, rows]) => {
      const entry = { organism: org, count: rows.length, esbl: 0, mrsa: 0, carbapenem_r: 0 }
      rows.forEach(r => { if (r.esbl) entry.esbl++; if (r.mrsa) entry.mrsa++; if (r.carbapenem_r) entry.carbapenem_r++ })
      allAntibiotics.forEach(({ key }) => {
        const tested = rows.filter(r => normalizeSIR(r[key]) && normalizeSIR(r[key]) !== 'NT')
        const sensitive = rows.filter(r => normalizeSIR(r[key]) === 'S')
        entry[`pct_${key}`] = tested.length >= 1 ? Math.round(100 * sensitive.length / tested.length) : null
      })
      return entry
    }).sort((a, b) => b.count - a.count)
  }, [results, filterSample, allAntibiotics])

  if (loading) return (
    <div style={{ height: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <div style={{ width: 36, height: 36, border: '3px solid #e8ebe8', borderTop: '3px solid #0F6E56', borderRadius: '50%', animation: 'spin 0.9s linear infinite' }} />
      <p style={{ color: '#0F6E56', marginTop: 12 }}>Loading Antibiogram...</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const testedFor = (r) => allAntibiotics
    .map((a) => ({ ...a, sir: normalizeSIR(r?.[a.key]) }))
    .filter((x) => x.sir && x.sir !== 'NT')
  const flagsFor = (r) => [r.esbl && 'ESBL', r.mrsa && 'MRSA', r.vre && 'VRE', r.carbapenem_r && 'Carbapenem-R'].filter(Boolean)
  const stats = {
    isolates: results.length,
    organisms: organisms.length - 1,
    esbl: results.filter((r) => r.esbl).length,
    mrsa: results.filter((r) => r.mrsa).length,
    cr: results.filter((r) => r.carbapenem_r).length,
  }
  const matrixColumns = allAntibiotics.filter((a) => hospitalMatrix.some((row) => row[`pct_${a.key}`] != null))
  const filtersOn = Boolean(search || filterOrganism !== 'All' || filterSample !== 'All')
  const selectedTested = selected ? testedFor(selected) : []
  const openResult = (r) => { setSelected(r); requestAnimationFrame(() => reportRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })) }
  const SIR_GROUPS = [['R', 'Resistant'], ['I', 'Susceptible, increased exposure'], ['S', 'Susceptible']]

  return (
    <div style={s.page}>
      <style>{'@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} .abg-row:hover td{background:#F2F8F5} @media print{.abg-noprint{display:none!important}}'}</style>

      {/* HEADER */}
      <div style={s.header}>
        <div style={{ minWidth: 0 }}>
          <h1 style={s.title}>Antibiogram &amp; AMR</h1>
          <p style={s.subtitle}>Culture &amp; sensitivity results per patient, and the hospital cumulative antibiogram (EUCAST S / I / R).</p>
        </div>
        <div style={s.actions}>
          {onNavigateLab && <button type="button" style={s.btnGhost} onClick={onNavigateLab}>Lab orders</button>}
          {onNavigateAI && <button type="button" style={s.btnGhost} onClick={onNavigateAI}>AI suggestion</button>}
          <button type="button" style={s.btnGhost} onClick={fetchAll}>Refresh</button>
          {canManage && <>
            <input id="antibiogram-upload" type="file" accept=".csv,.xlsx,.xls,.pdf,image/*" style={{ display: 'none' }} onChange={handleUploadFile} disabled={uploading} />
            <label htmlFor="antibiogram-upload" style={{ ...s.btnSecondary, ...(uploading ? s.btnBusy : {}) }}>
              {uploading ? (uploadStep || 'Processing…') : 'Upload file'}
            </label>
            <button type="button" style={s.btn} onClick={openNew}>Add C&amp;S result</button>
          </>}
        </div>
      </div>

      {/* SUMMARY */}
      <div style={s.statsRow}>
        {[['Isolates', stats.isolates, false], ['Organisms', stats.organisms, false], ['ESBL', stats.esbl, true], ['MRSA', stats.mrsa, true], ['Carbapenem-resistant', stats.cr, true]].map(([label, value, alarm]) => (
          <div key={label} style={{ ...s.stat, ...(alarm && value > 0 ? s.statAlarm : {}) }}>
            <div style={{ ...s.statValue, color: alarm && value > 0 ? '#912018' : '#101828' }}>{value}</div>
            <div style={s.statLabel}>{label}</div>
          </div>
        ))}
      </div>

      {uploadError && (
        <div role="alert" style={s.alert}>
          <span>{uploadError}</span>
          <button type="button" aria-label="Dismiss" style={s.alertClose} onClick={() => setUploadError('')}>✕</button>
        </div>
      )}

      {/* UPLOAD PREVIEW */}
      {showUploadPreview && (
        <div style={{ ...s.panel, borderColor: '#0F6E56', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={s.panelTitle}>Check before saving: {uploadPreviewRows.length} isolate{uploadPreviewRows.length !== 1 ? 's' : ''} read from <em>{previewFileName}</em></div>
              <div style={s.muted}>Compare with the original report. You can edit any record after saving.</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={s.btnGhost} onClick={cancelUploadPreview}>Cancel</button>
              <button type="button" style={s.btn} onClick={confirmUploadPreview} disabled={uploading}>
                {uploading ? 'Saving…' : `Save ${uploadPreviewRows.length} result${uploadPreviewRows.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead><tr>{['Patient', 'Organism', 'Specimen', 'Collected', 'Growth', 'Resistance', 'Results'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {uploadPreviewRows.map((row, idx) => {
                  const tested = getSusceptibilityEntries(row)
                  const count = (v) => tested.filter((e) => e.sir === v).length
                  return (
                    <tr key={idx}>
                      <td style={s.td}><strong>{row.patient_name || '—'}</strong></td>
                      <td style={{ ...s.td, fontStyle: 'italic', fontWeight: 600 }}>{row.organism_identified || '—'}</td>
                      <td style={s.td}>{row.sample_type || '—'}</td>
                      <td style={s.td}>{row.collection_date || '—'}</td>
                      <td style={s.td}>{row.growth || '—'}</td>
                      <td style={s.td}>{flagsFor(row).map((f) => <span key={f} style={s.flag}>{f}</span>)}{!flagsFor(row).length && '—'}</td>
                      <td style={s.td}>{tested.length ? <SirCounts s={count('S')} i={count('I')} r={count('R')} /> : <span style={s.muted}>none read</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TABS */}
      <div role="tablist" aria-label="Antibiogram views" style={s.tabRow}>
        {[['patient', 'Patient results', results.length], ['hospital', 'Hospital antibiogram', hospitalMatrix.length]].map(([id, label, n]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} style={{ ...s.tabBtn, ...(tab === id ? s.tabBtnActive : {}) }} onClick={() => setTab(id)}>
            {label} <span style={{ ...s.tabCount, ...(tab === id ? s.tabCountActive : {}) }}>{n}</span>
          </button>
        ))}
      </div>

      {/* FILTERS */}
      {!(tab === 'patient' && selected) && <div style={s.filters}>
        {tab === 'patient' && <div style={{ flex: '1 1 260px' }}>
          <label style={s.filterLabel} htmlFor="abg-search">Search</label>
          <input id="abg-search" style={s.input} placeholder="Patient name or organism" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>}
        {tab === 'patient' && <div style={{ flex: '0 1 240px' }}>
          <label style={s.filterLabel} htmlFor="abg-organism">Organism</label>
          <select id="abg-organism" style={s.input} value={filterOrganism} onChange={(e) => setFilterOrganism(e.target.value)}>
            {organisms.map((o) => <option key={o} value={o}>{o === 'All' ? 'All organisms' : o}</option>)}
          </select>
        </div>}
        <div style={{ flex: '0 1 200px' }}>
          <label style={s.filterLabel} htmlFor="abg-sample">Specimen</label>
          <select id="abg-sample" style={s.input} value={filterSample} onChange={(e) => setFilterSample(e.target.value)}>
            {SAMPLE_TYPES.map((st) => <option key={st} value={st}>{st === 'All' ? 'All specimens' : st}</option>)}
          </select>
        </div>
        {filtersOn && <button type="button" style={{ ...s.btnGhost, alignSelf: 'flex-end' }} onClick={() => { setSearch(''); setFilterOrganism('All'); setFilterSample('All') }}>Clear filters</button>}
      </div>}

      {/* ========== PATIENT RESULTS ========== */}
      {tab === 'patient' && !selected && (
        <div>
          {filteredResults.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyTitle}>{results.length ? 'No result matches these filters' : 'No culture & sensitivity results yet'}</div>
              <div style={s.muted}>{results.length ? 'Clear the filters to see all results.' : canManage ? 'Use "Add C&S result" to enter one, or "Upload file" to import a VITEK / Phoenix report (PDF or image) or a spreadsheet.' : 'Results appear here when the laboratory adds them.'}</div>
            </div>
          ) : (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>{['Collected', 'Patient', 'Specimen', 'Organism', 'Resistance', 'Results', ''].map((h, i) => <th key={i} style={s.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filteredResults.map((r) => {
                    const tested = testedFor(r)
                    const count = (v) => tested.filter((x) => x.sir === v).length
                    return (
                      <tr key={r.id} className="abg-row" onClick={() => openResult(r)} style={{ cursor: 'pointer' }}>
                        <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{r.collection_date || '—'}</td>
                        <td style={s.td}><div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{r.patient_name}</div>{r.ward_department && <div style={s.muted}>{r.ward_department}</div>}</td>
                        <td style={s.td}>{r.sample_type || '—'}</td>
                        <td style={{ ...s.td, fontStyle: 'italic', fontWeight: 700, color: '#101828' }}>{r.organism_identified}</td>
                        <td style={s.td}>{flagsFor(r).length ? flagsFor(r).map((f) => <span key={f} style={s.flag}>{f}</span>) : <span style={s.muted}>None flagged</span>}</td>
                        <td style={s.td}>{tested.length ? <SirCounts s={count('S')} i={count('I')} r={count('R')} /> : <span style={s.muted}>No AST</span>}</td>
                        <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}><button type="button" style={s.btnLink} onClick={(e) => { e.stopPropagation(); openResult(r) }}>Open report ›</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ========== FULL-WIDTH RESULT REPORT ========== */}
      {tab === 'patient' && selected && (() => {
        const idx = filteredResults.findIndex((r) => r.id === selected.id)
        const prev = idx > 0 ? filteredResults[idx - 1] : null
        const next = idx >= 0 && idx < filteredResults.length - 1 ? filteredResults[idx + 1] : null
        const facts = [['Ward / dept', selected.ward_department], ['Gram stain', selected.gram_stain], ['Growth', selected.growth], ['Colony count', selected.colony_count],
          ['Diagnosis', selected.diagnosis], ['Performed by', selected.performed_by], ['Verified by', selected.verified_by]].filter(([, v]) => v)
        return (
          <article aria-label={`Result report: ${selected.organism_identified}`} style={s.report} ref={reportRef}>
            <div className="abg-noprint" style={s.reportBar}>
              <button type="button" style={s.btnGhost} onClick={() => setSelected(null)}>← Back to results</button>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {idx >= 0 && <span style={s.muted}>{idx + 1} of {filteredResults.length}</span>}
                <button type="button" style={s.btnGhost} disabled={!prev} onClick={() => prev && openResult(prev)}>‹ Previous</button>
                <button type="button" style={s.btnGhost} disabled={!next} onClick={() => next && openResult(next)}>Next ›</button>
                <button type="button" style={s.btnGhost} onClick={() => window.print()}>Print</button>
                {canManage && <button type="button" style={s.btnGhost} onClick={() => openEdit(selected)}>Edit</button>}
                {canManage && <button type="button" style={s.btnDanger} onClick={() => handleDelete(selected.id)}>Delete</button>}
              </div>
            </div>

            <header style={s.reportHead}>
              <div style={{ minWidth: 0, flex: '1 1 380px' }}>
                <div style={s.eyebrow}>Culture &amp; sensitivity report</div>
                <h2 style={s.reportTitle}>{selected.organism_identified}</h2>
                <div style={s.reportMeta}>
                  <span><strong>{selected.patient_name}</strong></span>
                  <span>{selected.sample_type || 'Specimen not stated'}</span>
                  {selected.collection_date && <span>Collected {selected.collection_date}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {flagsFor(selected).length ? flagsFor(selected).map((f) => <span key={f} style={s.flagLarge}>{f}</span>) : <span style={s.okBadge}>No resistance flag</span>}
              </div>
            </header>

            {facts.length > 0 && (
              <dl style={s.factsRow}>
                {facts.map(([l, v]) => <div key={l} style={s.fact}><dt style={s.factLabel}>{l}</dt><dd style={s.factValue}>{v}</dd></div>)}
              </dl>
            )}

            <h3 style={s.sectionTitle}>Susceptibility · {selectedTested.length} antibiotics tested</h3>
            {selectedTested.length === 0 ? <div style={s.muted}>No susceptibility results recorded.</div> : (
              <div style={s.sirColumns}>
                {SIR_GROUPS.map(([code, label]) => {
                  const list = selectedTested.filter((x) => x.sir === code)
                  return (
                    <section key={code} aria-label={label} style={s.sirCol}>
                      <div style={s.sirColHead}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: SIR_STYLE[code].dot }} />{label}</span><span style={{ ...s.sirChip, background: '#F2F4F7', color: '#101828' }}>{list.length}</span>
                      </div>
                      {list.length === 0 && <div style={{ ...s.muted, padding: '8px 0' }}>None</div>}
                      {list.map((x) => (
                        <div key={x.key} style={s.abxRow}>
                          <span>{x.label}</span>
                          <span style={{ ...s.sirChip, background: SIR_STYLE[code].bg, color: SIR_STYLE[code].color }}>{code}</span>
                        </div>
                      ))}
                    </section>
                  )
                })}
              </div>
            )}
            <p style={{ ...s.muted, marginTop: 12 }}>S = susceptible at standard dosing · I = susceptible, increased exposure (high dosage needed) · R = resistant (EUCAST).</p>

            {selected.clinical_notes && <><h3 style={s.sectionTitle}>Clinical notes</h3><p style={{ fontSize: 14, color: '#101828', margin: 0, whiteSpace: 'pre-wrap' }}>{selected.clinical_notes}</p></>}
            {onNavigateAI && <div className="abg-noprint" style={{ marginTop: 16 }}><button type="button" style={s.btnSecondary} onClick={onNavigateAI}>AI prescribing suggestion</button></div>}
          </article>
        )
      })()}

      {/* ========== HOSPITAL ANTIBIOGRAM ========== */}
      {tab === 'hospital' && (
        <div>
          {hospitalMatrix.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyTitle}>No data yet</div>
              <div style={s.muted}>The hospital antibiogram is built from the patient results.</div>
            </div>
          ) : (
            <>
              <div style={s.legend}>
                <span style={s.legendTitle}>% susceptible</span>
                <span style={{ ...s.legendChip, ...PCT_STYLE.good }}>≥ 80% good</span>
                <span style={{ ...s.legendChip, ...PCT_STYLE.mid }}>50–79% moderate</span>
                <span style={{ ...s.legendChip, ...PCT_STYLE.poor }}>&lt; 50% poor</span>
                <span style={s.muted}>Interpret with caution when n &lt; 30 isolates (CLSI M39). Only antibiotics with results are shown.</span>
              </div>
              <div style={s.tableWrap}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={{ ...s.thDark, position: 'sticky', left: 0, zIndex: 2, minWidth: 200, textAlign: 'left' }}>Organism</th>
                      <th style={s.thDark}>n</th>
                      <th style={s.thDark}>ESBL</th>
                      <th style={s.thDark}>MRSA</th>
                      <th style={s.thDark}>Carb-R</th>
                      {matrixColumns.map((a) => <th key={a.key} style={{ ...s.thDark, whiteSpace: 'nowrap' }}>{a.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {hospitalMatrix.map((row, i) => (
                      <tr key={row.organism}>
                        <td style={{ ...s.td, position: 'sticky', left: 0, background: '#FFFFFF', zIndex: 1, fontStyle: 'italic', fontWeight: 700, color: '#101828' }}>{row.organism}</td>
                        <td style={{ ...s.td, textAlign: 'center', fontWeight: 700, color: row.count < 30 ? '#B54708' : '#101828' }} title={row.count < 30 ? 'Fewer than 30 isolates' : undefined}>{row.count}</td>
                        {['esbl', 'mrsa', 'carbapenem_r'].map((k) => (
                          <td key={k} style={{ ...s.td, textAlign: 'center' }}>{row[k] > 0 ? <span style={s.flag}>{row[k]}</span> : <span style={s.muted}>0</span>}</td>
                        ))}
                        {matrixColumns.map((a) => {
                          const pct = row[`pct_${a.key}`]
                          const st = pct == null ? null : pct >= 80 ? PCT_STYLE.good : pct >= 50 ? PCT_STYLE.mid : PCT_STYLE.poor
                          return <td key={a.key} style={{ ...s.td, textAlign: 'center', padding: 4 }}>{st ? <span style={{ ...s.pctCell, ...st }}>{pct}%</span> : <span style={s.muted}>–</span>}</td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ========== ADD / EDIT MODAL ========== */}
      {showModal && (
        <div style={s.overlay} onClick={() => setShowModal(false)}>
          <div style={{ ...s.modal, maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitle}>{editingId ? 'Edit' : 'Add'} culture &amp; sensitivity result</h2>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Enter culture & sensitivity for a patient isolate</div>
              </div>
              <button type="button" aria-label="Close" style={s.closeBtn} onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div style={s.modalBody}>
              <div style={s.sectionLabel}>Patient</div>
              <div style={{ position: 'relative', marginBottom: 14 }}>
                <input style={s.input} placeholder="Search registered patient or type name..."
                  value={patientSearch} onChange={e => { searchPatients(e.target.value); setForm(f => ({ ...f, patient_name: e.target.value })) }} />
                {patientResults.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: 8, zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,.12)', marginTop: 4 }}>
                    {patientResults.map(p => (
                      <div key={p.id} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f5f5f5' }} onMouseDown={() => pickPatient(p)}>
                        <span style={{ fontWeight: 600 }}>{p.full_name}</span>
                        <span style={{ color: '#888', marginLeft: 8 }}>{p.age && `${p.age}y`} {p.gender}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Link to Lab Order (optional)</label>
                  <select style={s.input} value={form.lab_test_id} onChange={e => setForm(f => ({ ...f, lab_test_id: e.target.value }))}>
                    <option value="">— Not linked —</option>
                    {labTests.map(t => <option key={t.id} value={t.id}>{t.patient_name} — {t.test_type}</option>)}
                  </select>
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Ward / Department</label>
                  <input style={s.input} placeholder="e.g. Medical Ward, ICU, OPD" value={form.ward_department} onChange={e => setForm(f => ({ ...f, ward_department: e.target.value }))} />
                </div>
              </div>

              <div style={s.sectionLabel}>Sample</div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Sample Type *</label>
                  <select style={s.input} value={form.sample_type} onChange={e => setForm(f => ({ ...f, sample_type: e.target.value }))}>
                    {SAMPLE_TYPES.filter(t => t !== 'All').map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Collection Date</label>
                  <input style={s.input} type="date" value={form.collection_date} onChange={e => setForm(f => ({ ...f, collection_date: e.target.value }))} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Growth</label>
                  <select style={s.input} value={form.growth} onChange={e => setForm(f => ({ ...f, growth: e.target.value }))}>
                    {['Heavy', 'Moderate', 'Light', 'No Growth'].map(g => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Colony Count</label>
                  <input style={s.input} placeholder="e.g. >100,000 CFU/mL" value={form.colony_count} onChange={e => setForm(f => ({ ...f, colony_count: e.target.value }))} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Gram Stain</label>
                  <input style={s.input} placeholder="e.g. Gram -ve Rods" value={form.gram_stain} onChange={e => setForm(f => ({ ...f, gram_stain: e.target.value }))} />
                </div>
              </div>

              <div style={s.sectionLabel}>Organism Identified *</div>
              <div style={s.formGroup}>
                <input style={s.input} placeholder="e.g. Escherichia coli, Klebsiella pneumoniae, MRSA..." value={form.organism_identified} onChange={e => setForm(f => ({ ...f, organism_identified: e.target.value }))} />
              </div>

              <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
                {[['esbl', 'ESBL'], ['mrsa', 'MRSA'], ['vre', 'VRE'], ['carbapenem_r', 'Carbapenem-R']].map(([k, l]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', fontWeight: form[k] ? 700 : 400, color: form[k] ? '#A32D2D' : '#555' }}>
                    <input type="checkbox" checked={!!form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.checked }))} />
                    {l}
                  </label>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                <input style={{ ...s.input, flex: 1, minWidth: 200 }} placeholder="Add custom antibiotic name" value={customAntibioticName} onChange={e => setCustomAntibioticName(e.target.value)} />
                <button style={{ ...s.btn, background: '#fff', color: '#0F6E56', border: '1px solid #0F6E56', width: 'auto' }} onClick={addCustomAntibiotic}>+ Add</button>
              </div>

              <div style={s.sectionLabel}>Antibiogram (S / I / R / NT)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
                {formAntibiotics.map(a => (
                  <div key={a.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fafafa', borderRadius: 8, padding: '7px 10px', border: '1px solid #eee' }}>
                    <span style={{ fontSize: 12, color: '#444', fontWeight: 500 }}>{a.label}</span>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {['S', 'I', 'R', 'NT'].map(v => (
                        <button key={v}
                          style={{ width: 26, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 700,
                            background: form[a.key] === v ? (v === 'S' ? '#0F6E56' : v === 'I' ? '#C07000' : v === 'R' ? '#A32D2D' : '#888') : '#eee',
                            color: form[a.key] === v ? '#fff' : '#888' }}
                          onClick={() => setFormAntibioticValue(a.key, v, a.label)}>
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={s.sectionLabel}>Clinical Context</div>
              <div style={s.formGrid2}>
                <div style={s.formGroup}>
                  <label style={s.label}>Diagnosis / Indication</label>
                  <input style={s.input} placeholder="e.g. UTI, Sepsis, Pneumonia" value={form.diagnosis} onChange={e => setForm(f => ({ ...f, diagnosis: e.target.value }))} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Performed By</label>
                  <input style={s.input} placeholder="Lab technician" value={form.performed_by} onChange={e => setForm(f => ({ ...f, performed_by: e.target.value }))} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Verified By</label>
                  <input style={s.input} placeholder="Consultant sign-off" value={form.verified_by} onChange={e => setForm(f => ({ ...f, verified_by: e.target.value }))} />
                </div>
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>Clinical Notes</label>
                <textarea style={{ ...s.input, height: 60, resize: 'vertical' }} placeholder="Additional notes..." value={form.clinical_notes} onChange={e => setForm(f => ({ ...f, clinical_notes: e.target.value }))} />
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={s.submitBtn} onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save result'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Solid, high-contrast colours for results (S green, I amber, R red)
// Professional palette: neutral surfaces, colour only as small muted signals (S green, I amber, R red)
const SIR_STYLE = {
  S: { bg: '#F2F4F7', color: '#05603A', dot: '#3F8F6B' },
  I: { bg: '#F2F4F7', color: '#93370D', dot: '#C4873A' },
  R: { bg: '#F2F4F7', color: '#912018', dot: '#B5544B' },
}
const PCT_STYLE = {
  good: { color: '#05603A' },
  mid: { color: '#93370D' },
  poor: { color: '#912018' },
}

/** "5 S · 1 I · 9 R" with a small proportional bar. */
function SirCounts({ s: sCount, i: iCount, r: rCount }) {
  const total = sCount + iCount + rCount || 1
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ display: 'flex', gap: 10, fontSize: 12.5, fontWeight: 700 }}>
        <span style={{ color: SIR_STYLE.S.color }}>{sCount} S</span>
        <span style={{ color: SIR_STYLE.I.color }}>{iCount} I</span>
        <span style={{ color: SIR_STYLE.R.color }}>{rCount} R</span>
      </div>
      <div aria-hidden="true" style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 4, background: '#EAECF0' }}>
        <span style={{ width: `${(100 * sCount) / total}%`, background: SIR_STYLE.S.dot }} />
        <span style={{ width: `${(100 * iCount) / total}%`, background: SIR_STYLE.I.dot }} />
        <span style={{ width: `${(100 * rCount) / total}%`, background: SIR_STYLE.R.dot }} />
      </div>
    </div>
  )
}

const s = {
  page: { padding: '20px 24px 32px', color: '#101828', fontFamily: typography.fontFamily, boxSizing: 'border-box' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 22, fontWeight: 800, margin: 0, color: '#101828' },
  subtitle: { color: '#344054', margin: '4px 0 0', fontSize: 13.5 },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  btn: { background: '#0F6E56', color: '#FFFFFF', border: '1px solid #0F6E56', padding: '9px 16px', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' },
  btnSecondary: { background: '#FFFFFF', color: '#0F6E56', border: '1px solid #0F6E56', padding: '9px 16px', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13, display: 'inline-block', fontFamily: 'inherit' },
  btnGhost: { background: '#FFFFFF', color: '#101828', border: '1px solid #D0D5DD', padding: '9px 14px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' },
  btnDanger: { background: '#FFFFFF', color: '#B42318', border: '1px solid #B42318', padding: '9px 14px', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' },
  btnBusy: { background: '#F2F4F7', color: '#344054', borderColor: '#D0D5DD', cursor: 'wait' },
  iconBtn: { background: '#FFFFFF', border: '1px solid #D0D5DD', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', color: '#101828', fontSize: 14, flexShrink: 0 },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 },
  stat: { background: '#FFFFFF', border: '1px solid #D0D5DD', borderRadius: 10, padding: '12px 14px' },
  statAlarm: {},
  statValue: { fontSize: 24, fontWeight: 800, lineHeight: 1.1 },
  statLabel: { fontSize: 12.5, fontWeight: 700, color: '#344054', marginTop: 2 },
  alert: { background: '#FEF3F2', border: '1px solid #B42318', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#B42318', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 14, fontWeight: 600 },
  alertClose: { background: 'none', border: 'none', cursor: 'pointer', color: '#B42318', fontSize: 16 },
  panel: { background: '#FFFFFF', border: '1px solid #D0D5DD', borderRadius: 12, padding: 16 },
  panelTitle: { fontWeight: 800, fontSize: 14, color: '#101828' },
  tabRow: { display: 'flex', gap: 4, marginBottom: 14, borderBottom: '2px solid #EAECF0' },
  tabBtn: { padding: '10px 14px', borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: '3px solid transparent', marginBottom: -2, background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: '#475467', display: 'inline-flex', gap: 8, alignItems: 'center', fontFamily: 'inherit' },
  tabBtnActive: { color: '#0F6E56', borderBottom: '3px solid #0F6E56' },
  tabCount: { fontSize: 11.5, fontWeight: 700, background: '#F2F4F7', color: '#344054', borderRadius: 999, padding: '1px 8px' },
  tabCountActive: { background: '#0F6E56', color: '#FFFFFF' },
  filters: { display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap', alignItems: 'flex-end', background: '#FFFFFF', border: '1px solid #D0D5DD', borderRadius: 10, padding: 12 },
  filterLabel: { display: 'block', fontSize: 12, fontWeight: 700, color: '#344054', marginBottom: 4 },
  tableWrap: { overflowX: 'auto', background: '#FFFFFF', border: '1px solid #D0D5DD', borderRadius: 10 },
  table: { width: '100%', minWidth: 760, borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 800, color: '#344054', background: '#F9FAFB', borderBottom: '1px solid #D0D5DD', whiteSpace: 'nowrap' },
  thDark: { textAlign: 'center', padding: '10px 8px', fontSize: 12, fontWeight: 800, color: '#344054', background: '#F9FAFB', borderBottom: '1px solid #D0D5DD' },
  td: { padding: '10px 12px', borderBottom: '1px solid #EAECF0', verticalAlign: 'middle', color: '#101828', background: '#FFFFFF' },
  tdSel: { background: '#E6F4EE' },
  flag: { display: 'inline-block', fontSize: 11.5, fontWeight: 700, color: '#912018', background: '#FFFFFF', border: '1px solid #D9A8A3', borderRadius: 4, padding: '1px 7px', marginRight: 4, marginBottom: 2 },
  flagLarge: { display: 'inline-block', fontSize: 12.5, fontWeight: 700, color: '#912018', background: '#FFFFFF', border: '1px solid #D9A8A3', borderRadius: 4, padding: '3px 10px' },
  muted: { color: '#475467', fontSize: 12.5 },
  btnLink: { background: 'none', border: 'none', color: '#0F6E56', fontWeight: 800, cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' },
  report: { background: '#FFFFFF', border: '1px solid #D0D5DD', borderRadius: 12, padding: '18px 22px 22px', scrollMarginTop: 12 },
  reportBar: { display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', paddingBottom: 14, marginBottom: 16, borderBottom: '1px solid #EAECF0' },
  reportHead: { display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' },
  reportTitle: { fontSize: 26, fontWeight: 800, fontStyle: 'italic', margin: '4px 0 6px', color: '#101828', lineHeight: 1.2 },
  reportMeta: { display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 14.5, color: '#101828' },
  okBadge: { display: 'inline-block', fontSize: 12.5, fontWeight: 700, color: '#344054', background: '#FFFFFF', border: '1px solid #D0D5DD', borderRadius: 4, padding: '3px 10px' },
  factsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, margin: '16px 0 0', padding: 12, background: '#F9FAFB', borderRadius: 10, border: '1px solid #EAECF0' },
  fact: { minWidth: 0 },
  sirColumns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 },
  sirCol: { border: '1px solid #EAECF0', borderRadius: 10, padding: '10px 14px' },
  sirColHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 800, fontSize: 13.5, color: '#101828', paddingBottom: 6, borderBottom: '1px solid #EAECF0', marginBottom: 2 },
  detailPanel: { flex: '0 1 380px', minWidth: 300, background: '#FFFFFF', border: '1px solid #D0D5DD', borderRadius: 12, padding: 18, position: 'sticky', top: 12, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', boxSizing: 'border-box' },
  eyebrow: { fontSize: 12, fontWeight: 700, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '.03em' },
  detailTitle: { fontSize: 19, fontWeight: 800, fontStyle: 'italic', margin: '4px 0 0', color: '#101828', lineHeight: 1.25 },
  facts: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', margin: '14px 0 4px' },
  factLabel: { fontSize: 11.5, fontWeight: 700, color: '#475467', textTransform: 'uppercase', letterSpacing: '.03em' },
  factValue: { margin: '2px 0 0', fontSize: 13.5, fontWeight: 600, color: '#101828' },
  sectionTitle: { fontSize: 14, fontWeight: 800, color: '#101828', margin: '16px 0 8px', paddingTop: 12, borderTop: '1px solid #EAECF0' },
  groupHead: { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.03em', margin: '6px 0 4px' },
  abxRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F2F4F7', fontSize: 13.5, fontWeight: 600 },
  sirChip: { minWidth: 26, textAlign: 'center', fontWeight: 800, fontSize: 12.5, borderRadius: 6, padding: '2px 6px' },
  legend: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 },
  legendTitle: { fontSize: 12.5, fontWeight: 800, color: '#101828' },
  legendChip: { fontSize: 12, fontWeight: 700, padding: '2px 4px' },
  pctCell: { display: 'inline-block', minWidth: 44, padding: '4px 6px', fontWeight: 700, fontSize: 13 },
  empty: { textAlign: 'center', padding: '56px 20px', background: '#FFFFFF', border: '1px dashed #D0D5DD', borderRadius: 12 },
  emptyTitle: { fontWeight: 800, color: '#101828', fontSize: 15, marginBottom: 4 },
  // modal and form (unchanged layout, solid colours)
  input: { width: '100%', padding: '9px 12px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 13.5, outline: 'none', boxSizing: 'border-box', background: '#FFFFFF', color: '#101828', fontFamily: 'inherit' },
  sectionLabel: { fontSize: 12, fontWeight: 800, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 10, marginTop: 4, paddingBottom: 5, borderBottom: '1px solid #D1E9DF' },
  formGrid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 },
  formGroup: { marginBottom: 14 },
  label: { fontSize: 12.5, color: '#344054', display: 'block', marginBottom: 5, fontWeight: 700 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(16,24,40,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal: { background: '#FFFFFF', borderRadius: 14, width: '100%', maxWidth: 700, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', animation: 'fadeIn 0.2s ease' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '16px 22px', borderBottom: '1px solid #EAECF0' },
  modalTitle: { fontSize: 18, fontWeight: 800, margin: 0, color: '#101828' },
  closeBtn: { background: '#FFFFFF', border: '1px solid #D0D5DD', borderRadius: 8, width: 32, height: 32, fontSize: 14, cursor: 'pointer', color: '#101828' },
  modalBody: { padding: '18px 22px', overflowY: 'auto', flex: 1 },
  modalFooter: { padding: '14px 22px', borderTop: '1px solid #EAECF0', display: 'flex', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { padding: '9px 18px', border: '1px solid #D0D5DD', borderRadius: 8, background: '#FFFFFF', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#101828' },
  submitBtn: { padding: '9px 22px', border: 'none', borderRadius: 8, background: '#0F6E56', color: '#FFFFFF', cursor: 'pointer', fontSize: 13, fontWeight: 700 },
}
