import { useEffect, useState, useMemo } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import { executeWithFallback, omitKeys } from '../utils/dbCompat'
import { extractGeminiText, generateGeminiContent } from '../utils/geminiProxy'
import {
  formatAntibioticLabel,
  getSusceptibilityEntries,
  normalizeSusceptibilityKey,
  normalizeSusceptibilityProfile,
} from '../utils/hospitalSignals'
import { executeMicrobiologyQuery, MICROBIOLOGY_RESULT_BASE_COLUMNS } from '../utils/microbiologyResults'

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

const SIR_COLORS = {
  S: { bg: '#E1F5EE', color: '#0F6E56', label: 'S' },
  I: { bg: '#FFF3DC', color: '#C07000', label: 'I' },
  R: { bg: '#FCEBEB', color: '#A32D2D', label: 'R' },
  NT: { bg: '#f5f5f5', color: '#aaa', label: '—' },
}

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

function pctColor(pct) {
  if (pct == null) return { bg: '#f5f5f5', color: '#bbb' }
  if (pct >= 80) return { bg: '#E1F5EE', color: '#0F6E56' }
  if (pct >= 50) return { bg: '#FFF3DC', color: '#C07000' }
  return { bg: '#FCEBEB', color: '#A32D2D' }
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
      maxOutputTokens: 1200,
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
  const { hospitalId } = useHospital()
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
    if (!key || EXCLUDED_FIELDS.has(key)) { window.notifyFromLegacyAlert('Invalid antibiotic name.'); return }
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
    setForm({ ...BLANK_FORM, susceptibility_profile: {} })
    setEditingId(null)
    setPatientSearch('')
    setCustomAntibioticName('')
    setShowModal(true)
  }
  function openEdit(r) {
    setForm(hydrateMicrobiologyRow({ ...BLANK_FORM, ...r }))
    setEditingId(r.id)
    setPatientSearch(r.patient_name || '')
    setCustomAntibioticName('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.patient_name) { window.notifyFromLegacyAlert('Patient name required'); return }
    if (!form.organism_identified) { window.notifyFromLegacyAlert('Organism identified required'); return }
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
    if (error) { window.notifyFromLegacyAlert('Error: ' + error.message); setSaving(false); return }
    setShowModal(false)
    broadcastAntibiogramUpdated({ source: editingId ? 'edit' : 'create', id: editingId || null, patient_id: form.patient_id || null })
    if (usedCompatFallback && hasExtraSusceptibility) {
      window.notifyFromLegacyAlert('Saved the standard antibiotics, but extra S/I/R agents were not preserved because `microbiology_results.susceptibility_profile` is missing. Apply `microbiology_susceptibility_profile_upgrade.sql` to keep the full culture susceptibility profile.')
    }
    fetchAll()
    setSaving(false)
  }

  async function handleDelete(id) {
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

  return (
    <div style={s.page}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* HEADER */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>🧫 Antibiogram Surveillance</h1>
          <p style={s.subtitle}>
            {results.length} isolates &nbsp;•&nbsp;
            {organisms.length - 1} organisms &nbsp;•&nbsp;
            <span style={{ color: '#A32D2D', fontWeight: 600 }}>{results.filter(r => r.esbl).length} ESBL</span> &nbsp;•&nbsp;
            <span style={{ color: '#A32D2D', fontWeight: 600 }}>{results.filter(r => r.mrsa).length} MRSA</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {onNavigateLab && (
            <button style={{ ...s.btn, background: '#fff', color: '#0F6E56', border: '1px solid #0F6E56' }} onClick={onNavigateLab}>
              🔬 Lab Orders
            </button>
          )}
          {onNavigateAI && (
            <button style={{ ...s.btn, background: '#F0EAFC', color: '#7B5EA7', border: '1px solid #D4C5F5' }} onClick={onNavigateAI}>
              ✦ AI Suggestion
            </button>
          )}

          {/* Upload button */}
          <div style={{ position: 'relative' }}>
            <input id="antibiogram-upload" type="file" accept=".csv,.xlsx,.xls,.pdf,image/*" style={{ display: 'none' }} onChange={handleUploadFile} disabled={uploading} />
            <label htmlFor="antibiogram-upload" style={{ ...s.btn, background: uploading ? '#ccc' : '#fff', color: uploading ? '#888' : '#0F6E56', border: '1px solid #0F6E56', cursor: uploading ? 'not-allowed' : 'pointer', display: 'inline-block' }}>
              {uploading ? `⏳ ${uploadStep || 'Processing...'}` : '📎 Upload File'}
            </label>
          </div>
          <button style={s.btn} onClick={openNew}>+ Add C&S Result</button>
          <button style={{ ...s.btn, background: '#fff', color: '#0F6E56', border: '1px solid #0F6E56' }} onClick={fetchAll}>↻</button>
        </div>

        {uploadError && (
          <div style={{ width: '100%', marginTop: 8, background: '#FCEBEB', border: '1px solid #F09595', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#A32D2D', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>⚠️ {uploadError}</span>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A32D2D', fontSize: 16 }} onClick={() => setUploadError('')}>✕</button>
          </div>
        )}

        {/* Upload preview panel */}
        {showUploadPreview && (
          <div style={{ width: '100%', background: '#fff', border: '1px solid #9FE1CB', borderRadius: 12, padding: 16, marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>
                  🧫 Preview — {uploadPreviewRows.length} isolate{uploadPreviewRows.length !== 1 ? 's' : ''} extracted from <em>{previewFileName}</em>
                </div>
                <div style={{ fontSize: 12, color: '#555', marginTop: 3 }}>
                  Review the data below, then confirm to save to the antibiogram.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ ...s.btn, background: '#fff', color: '#555', border: '1px solid #ddd' }} onClick={cancelUploadPreview}>Cancel</button>
                <button style={s.btn} onClick={confirmUploadPreview} disabled={uploading}>
                  {uploading ? 'Saving...' : `✅ Confirm & Save ${uploadPreviewRows.length} Row${uploadPreviewRows.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #eee', maxHeight: 300 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f5f5f5' }}>
                    {['Patient', 'Organism', 'Sample', 'Date', 'Growth', 'ESBL', 'MRSA', 'Antibiotics tested'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: '#555', whiteSpace: 'nowrap', borderBottom: '1px solid #eee' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uploadPreviewRows.map((row, idx) => {
                    const abxTested = getSusceptibilityEntries(row)
                    const sCount = abxTested.filter(entry => entry.sir === 'S').length
                    const rCount = abxTested.filter(entry => entry.sir === 'R').length
                    return (
                      <tr key={idx} style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>{row.patient_name || '—'}</td>
                        <td style={{ padding: '8px 10px', color: '#0F6E56', fontWeight: 600 }}>{row.organism_identified || '—'}</td>
                        <td style={{ padding: '8px 10px' }}>{row.sample_type || '—'}</td>
                        <td style={{ padding: '8px 10px', color: '#888', fontSize: 11 }}>{row.collection_date || '—'}</td>
                        <td style={{ padding: '8px 10px' }}>{row.growth || '—'}</td>
                        <td style={{ padding: '8px 10px' }}>{row.esbl ? <span style={{ color: '#A32D2D', fontWeight: 700 }}>✓</span> : '—'}</td>
                        <td style={{ padding: '8px 10px' }}>{row.mrsa ? <span style={{ color: '#A32D2D', fontWeight: 700 }}>✓</span> : '—'}</td>
                        <td style={{ padding: '8px 10px', fontSize: 11 }}>
                          {abxTested.length > 0
                            ? <span>{abxTested.length} tested · <span style={{ color: '#0F6E56' }}>{sCount}S</span> · <span style={{ color: '#A32D2D' }}>{rCount}R</span></span>
                            : <span style={{ color: '#bbb' }}>None extracted</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 10, fontSize: 11, color: '#888', background: '#f9fafb', borderRadius: 6, padding: '6px 10px' }}>
              ℹ After saving, you can edit individual records to correct any extraction errors.
            </div>
          </div>
        )}
      </div>

      {/* TABS */}
      <div style={s.tabRow}>
        {[{ id: 'patient', label: '👤 Per-Patient Results' }, { id: 'hospital', label: '🏥 Hospital Antibiogram' }].map(t => (
          <button key={t.id} style={{ ...s.tabBtn, ...(tab === t.id ? s.tabBtnActive : {}) }} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* FILTERS */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...s.input, flex: 1, minWidth: 200 }} placeholder="Search patient or organism..." value={search} onChange={e => setSearch(e.target.value)} />
        <select style={{ ...s.input, width: 'auto' }} value={filterOrganism} onChange={e => setFilterOrganism(e.target.value)}>
          {organisms.map(o => <option key={o}>{o}</option>)}
        </select>
        <select style={{ ...s.input, width: 'auto' }} value={filterSample} onChange={e => setFilterSample(e.target.value)}>
          {SAMPLE_TYPES.map(st => <option key={st}>{st}</option>)}
        </select>
        {(search || filterOrganism !== 'All' || filterSample !== 'All') && (
          <button style={{ ...s.input, width: 'auto', background: '#FCEBEB', color: '#A32D2D', border: '1px solid #F09595', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
            onClick={() => { setSearch(''); setFilterOrganism('All'); setFilterSample('All') }}>Clear</button>
        )}
      </div>

      {/* ========== PER-PATIENT TAB ========== */}
      {tab === 'patient' && (
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {filteredResults.length === 0 ? (
              <div style={s.empty}>
                <div style={{ fontSize: 48 }}>🧫</div>
                <div style={{ fontWeight: 600, color: '#555', marginTop: 12 }}>No C&S results yet</div>
                <div style={{ color: '#aaa', fontSize: 13, marginTop: 4 }}>Click "+ Add C&S Result" to enter manually, or "📎 Upload File" to import from image, PDF, or spreadsheet</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredResults.map(r => (
                  <div key={r.id} style={{ ...s.card, border: selected?.id === r.id ? '2px solid #0F6E56' : '1px solid #eee', background: selected?.id === r.id ? '#f0faf7' : '#fff' }}
                    onClick={() => setSelected(selected?.id === r.id ? null : r)}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: '#E1F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🧫</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>{r.organism_identified}</span>
                          <span style={{ ...s.pill, background: '#E3F0FB', color: '#1a6fb5' }}>{r.sample_type}</span>
                          {r.esbl && <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D' }}>ESBL</span>}
                          {r.mrsa && <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D' }}>MRSA</span>}
                          {r.carbapenem_r && <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D' }}>CRO</span>}
                        </div>
                        <div style={{ fontSize: 12, color: '#666', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <span>👤 {r.patient_name}</span>
                          {r.ward_department && <span>🏥 {r.ward_department}</span>}
                          <span>📅 {r.collection_date}</span>
                          {r.growth && <span>Growth: <b>{r.growth}</b></span>}
                        </div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                          {allAntibiotics.filter(a => normalizeSIR(r[a.key]) && normalizeSIR(r[a.key]) !== 'NT').slice(0, 10).map(a => {
                            const sir = normalizeSIR(r[a.key]) || 'NT'
                            const c = SIR_COLORS[sir] || SIR_COLORS.NT
                            return (
                              <div key={a.key} style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: c.bg, color: c.color, lineHeight: 1.6 }} title={a.label}>
                                {a.label.split('-')[0].split(' ')[0].slice(0, 5)} <span style={{ opacity: 0.7 }}>{c.label}</span>
                              </div>
                            )
                          })}
                          {allAntibiotics.filter(a => normalizeSIR(r[a.key]) && normalizeSIR(r[a.key]) !== 'NT').length > 10 && (
                            <div style={{ fontSize: 10, color: '#aaa', padding: '2px 6px' }}>+{allAntibiotics.filter(a => normalizeSIR(r[a.key]) && normalizeSIR(r[a.key]) !== 'NT').length - 10} more</div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button style={{ ...s.actionBtn, background: '#E3F0FB', color: '#1a6fb5', border: '1px solid #90C4F0' }} onClick={() => openEdit(r)}>✏️ Edit</button>
                      <button style={{ ...s.actionBtn, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #F09595' }} onClick={() => handleDelete(r.id)}>🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* DETAIL PANEL */}
          {selected && (
            <div style={s.detailPanel}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>Result Detail</span>
                <button style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#aaa' }} onClick={() => setSelected(null)}>✕</button>
              </div>

              <div style={s.sectionLabel}>Patient & Sample</div>
              {[
                ['Patient', selected.patient_name],
                ['Sample', selected.sample_type],
                ['Collected', selected.collection_date],
                ['Ward / Dept', selected.ward_department || '—'],
                ['Diagnosis', selected.diagnosis || '—'],
                ['Gram Stain', selected.gram_stain || '—'],
                ['Growth', selected.growth || '—'],
                ['Colony Count', selected.colony_count || '—'],
              ].map(([l, v]) => (
                <div key={l} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #f5f5f5' }}>
                  <div style={{ fontSize: 10, color: '#aaa', fontWeight: 700, textTransform: 'uppercase', marginBottom: 1 }}>{l}</div>
                  <div style={{ fontSize: 13, color: '#111' }}>{v}</div>
                </div>
              ))}

              <div style={{ ...s.sectionLabel, marginTop: 10 }}>Organism</div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#0F6E56', marginBottom: 8 }}>{selected.organism_identified}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {selected.esbl && <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D' }}>ESBL</span>}
                {selected.mrsa && <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D' }}>MRSA</span>}
                {selected.vre && <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D' }}>VRE</span>}
                {selected.carbapenem_r && <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D' }}>Carbapenem-R</span>}
              </div>

              <div style={s.sectionLabel}>Antibiogram</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {allAntibiotics.filter(a => normalizeSIR(selected[a.key]) && normalizeSIR(selected[a.key]) !== 'NT').map(a => {
                  const sir = normalizeSIR(selected[a.key]) || 'NT'
                  const c = SIR_COLORS[sir] || SIR_COLORS.NT
                  return (
                    <div key={a.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', borderRadius: 6, background: c.bg }}>
                      <span style={{ fontSize: 12, color: '#333' }}>{a.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: c.color }}>{sir}</span>
                    </div>
                  )
                })}
                {allAntibiotics.filter(a => normalizeSIR(selected[a.key]) && normalizeSIR(selected[a.key]) !== 'NT').length === 0 && (
                  <div style={{ fontSize: 12, color: '#aaa', fontStyle: 'italic' }}>No susceptibility data recorded</div>
                )}
              </div>

              {selected.clinical_notes && (
                <>
                  <div style={{ ...s.sectionLabel, marginTop: 10 }}>Clinical Notes</div>
                  <div style={{ fontSize: 12, color: '#555', background: '#f9f9f9', borderRadius: 8, padding: '8px 10px' }}>{selected.clinical_notes}</div>
                </>
              )}

              {onNavigateAI && (
                <button style={{ ...s.btn, width: '100%', marginTop: 14, background: '#7B5EA7', fontSize: 12 }} onClick={onNavigateAI}>
                  ✦ Get AI Prescription Suggestion
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========== HOSPITAL ANTIBIOGRAM TAB ========== */}
      {tab === 'hospital' && (
        <div>
          {hospitalMatrix.length === 0 ? (
            <div style={s.empty}>
              <div style={{ fontSize: 48 }}>🏥</div>
              <div style={{ fontWeight: 600, color: '#555', marginTop: 12 }}>No data yet</div>
              <div style={{ color: '#aaa', fontSize: 13, marginTop: 4 }}>Add per-patient C&S results to populate the hospital antibiogram</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
                % Susceptibility (S) — <span style={{ color: '#0F6E56', fontWeight: 600 }}>≥80% good</span> &nbsp;
                <span style={{ color: '#C07000', fontWeight: 600 }}>50–79% moderate</span> &nbsp;
                <span style={{ color: '#A32D2D', fontWeight: 600 }}>&lt;50% resistant</span> &nbsp;•&nbsp;
                Interpret with caution if n &lt; 10
              </div>
              <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #eee', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,.04)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#0F6E56', color: '#fff' }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, position: 'sticky', left: 0, background: '#0F6E56', zIndex: 2, minWidth: 180 }}>Organism</th>
                      <th style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 600, minWidth: 50 }}>n</th>
                      <th style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600, minWidth: 46, color: '#FCEBEB' }}>ESBL</th>
                      <th style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600, minWidth: 46, color: '#FCEBEB' }}>MRSA</th>
                      <th style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600, minWidth: 46, color: '#FCEBEB' }}>CRO</th>
                      {allAntibiotics.map(a => (
                        <th key={a.key} style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600, minWidth: 72, whiteSpace: 'nowrap' }}>{a.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {hospitalMatrix.map((row, i) => (
                      <tr key={row.organism} style={{ background: i % 2 === 0 ? '#fff' : '#fafcfb', borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 700, color: '#111', position: 'sticky', left: 0, background: i % 2 === 0 ? '#fff' : '#fafcfb', zIndex: 1 }}>{row.organism}</td>
                        <td style={{ padding: '8px', textAlign: 'center', color: '#555', fontWeight: 600 }}>{row.count}</td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>{row.esbl > 0 ? <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D' }}>{row.esbl}</span> : <span style={{ color: '#bbb' }}>—</span>}</td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>{row.mrsa > 0 ? <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D' }}>{row.mrsa}</span> : <span style={{ color: '#bbb' }}>—</span>}</td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>{row.carbapenem_r > 0 ? <span style={{ ...s.pill, background: '#FCEBEB', color: '#A32D2D' }}>{row.carbapenem_r}</span> : <span style={{ color: '#bbb' }}>—</span>}</td>
                        {allAntibiotics.map(a => {
                          const pct = row[`pct_${a.key}`]
                          const c = pctColor(pct)
                          return (
                            <td key={a.key} style={{ padding: '6px', textAlign: 'center' }}>
                              {pct != null ? <span style={{ ...s.pill, background: c.bg, color: c.color, fontWeight: 700, minWidth: 38, display: 'inline-block', textAlign: 'center' }}>{pct}%</span> : <span style={{ color: '#ddd', fontSize: 11 }}>—</span>}
                            </td>
                          )
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
                <h2 style={s.modalTitle}>🧫 {editingId ? 'Edit' : 'Add'} C&S Result</h2>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Enter culture & sensitivity for a patient isolate</div>
              </div>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}>✕</button>
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
              <button style={s.submitBtn} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : '🧫 Save C&S Result'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  page: { padding: '20px 24px', flex: 1, overflowY: 'auto', background: '#f7f8f7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', minHeight: '100vh', boxSizing: 'border-box' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  title: { fontSize: 24, fontWeight: 800, margin: 0, color: '#111' },
  subtitle: { color: '#777', margin: '4px 0 0', fontSize: 13 },
  btn: { background: '#0F6E56', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 13 },
  tabRow: { display: 'flex', gap: 4, marginBottom: 14, background: '#fff', padding: '6px 8px', borderRadius: 10, border: '1px solid #eee' },
  tabBtn: { padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#888', borderRadius: 7 },
  tabBtnActive: { background: '#0F6E56', color: '#fff' },
  card: { borderRadius: 12, padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.04)', transition: 'box-shadow .15s', flexWrap: 'wrap' },
  pill: { fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99, display: 'inline-block' },
  actionBtn: { fontSize: 12, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', border: 'none' },
  sectionLabel: { fontSize: 11, fontWeight: 700, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 10, marginTop: 4, paddingBottom: 5, borderBottom: '1px solid #E1F5EE' },
  detailPanel: { width: 300, flexShrink: 0, background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 18, overflowY: 'auto', maxHeight: 'calc(100vh - 140px)' },
  empty: { textAlign: 'center', padding: '80px 20px', color: '#999' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#111', fontFamily: 'inherit' },
  formGrid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  formGroup: { marginBottom: 14 },
  label: { fontSize: 12, color: '#666', display: 'block', marginBottom: 5, fontWeight: 500 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal: { background: '#fff', borderRadius: 16, width: '100%', maxWidth: 700, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', animation: 'fadeIn 0.2s ease' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 24px', borderBottom: '1px solid #f0f0f0' },
  modalTitle: { fontSize: 17, fontWeight: 700, margin: 0, color: '#111' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#aaa' },
  modalBody: { padding: '20px 24px', overflowY: 'auto', flex: 1 },
  modalFooter: { padding: '14px 24px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { padding: '10px 20px', border: '1px solid #ddd', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#555' },
  submitBtn: { padding: '10px 24px', border: 'none', borderRadius: 8, background: '#0F6E56', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
}
