// Microbiology helpers. Interpretation and expert rules run in the database (20261221000000_microbiology.sql);
// parseAstValue / sirFromBreakpoint mirror micro_parse_value / micro_sir and are parity-tested against it.
// Instrument files: ASTM E1394 record files (as saved by a LIS / middleware capture) and CSV / tab exports
// from VITEK 2, BD Phoenix (EpiCenter), MicroScan (LabPro) or a lab spreadsheet. Codes are mapped in the database.

/** "<=0.25", "≤ 0.25", ">16", "0.5*" → { comparator, value } (null value when it is not a number). */
export function parseAstValue(raw) {
  const t = String(raw ?? '').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/\s+/g, '').replace(/\*+$/, '')
  const m = t.match(/^(<=|>=|<|>|=)?(\d+(?:\.\d+)?)$/)
  if (!m) return { comparator: null, value: null }
  return { comparator: m[1] || '=', value: Number(m[2]) }
}

/** S / I / R for a value against breakpoint S and R (MIC: S ≤ s, R > r; zone: S ≥ s, R < r). null = undecidable. */
export function sirFromBreakpoint(method, comparator, value, s, r) {
  if (value == null || s == null || r == null) return null
  const v = Number(value)
  if (method === 'disk') return v >= s ? 'S' : v < r ? 'R' : 'I'
  const c = comparator || '='
  if (c === '<=' || c === '<') return v <= s ? 'S' : null
  if (c === '>') return v >= r ? 'R' : null
  if (c === '>=') return v > r ? 'R' : null
  return v <= s ? 'S' : v > r ? 'R' : 'I'
}

export const FLAG_INFO = {
  MRSA: 'Methicillin-resistant S. aureus — contact precautions; beta-lactams reported resistant',
  MRCoNS: 'Methicillin-resistant coagulase-negative staphylococcus',
  VRSA: 'Vancomycin-resistant S. aureus — notify infection control and the reference laboratory',
  'ESBL probable': 'Third-generation cephalosporin non-susceptible — probable ESBL (or AmpC); confirm phenotypically',
  'AmpC probable': 'Third-generation cephalosporin non-susceptible with a negative ESBL test — probable AmpC',
  ESBL: 'ESBL confirmed',
  CRE: 'Carbapenem-resistant Enterobacterales — isolate the patient, test for carbapenemase',
  CPE: 'Carbapenemase-producing Enterobacterales',
  CRAB: 'Carbapenem-resistant Acinetobacter baumannii',
  CRPA: 'Carbapenem-resistant Pseudomonas aeruginosa',
  VRE: 'Vancomycin-resistant Enterococcus',
  iMLSB: 'Inducible clindamycin resistance (D-test positive) — clindamycin reported resistant',
  PNSP: 'Penicillin non-susceptible S. pneumoniae',
  MDR: 'Multidrug resistant (non-susceptible to ≥ 1 agent in ≥ 3 categories)',
  XDR: 'Extensively drug resistant (susceptible to ≤ 2 categories)',
  PDR: 'Pandrug resistant (non-susceptible to all agents tested in all categories)',
  'Ceftriaxone-resistant typhoid': 'Ceftriaxone-resistant S. Typhi / Paratyphi — notify public health',
}
export const PRIORITY_FLAGS = ['PDR', 'XDR', 'VRSA', 'CPE', 'CRE', 'CRAB', 'CRPA', 'VRE', 'MRSA', 'Ceftriaxone-resistant typhoid']

// ---------------------------------------------------------------- delimited text
export function detectDelimiter(text) {
  const first = String(text || '').split(/\r?\n/).find((l) => l.trim()) || ''
  const counts = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length - 1])
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ','
}

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, any single-character delimiter). */
export function parseDelimited(text, delimiter = detectDelimiter(text)) {
  const rows = []; let row = []; let field = ''; let q = false
  const s = String(text || '').replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += ch
    } else if (ch === '"' && field === '') q = true
    else if (ch === delimiter) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

const ROLE_PATTERNS = {
  specimen_no: /^(spec(imen)?[ _]?(no|num|number|id)?|lab[ _]?(id|no|number)|accession|sample[ _]?(id|no)|spec_num)$/i,
  patient_number: /^(patient[ _]?(id|no|number)|mrn|hospital[ _]?(no|number)|ip[ _]?no|op[ _]?no|patient_id)$/i,
  specimen_type: /^(spec(imen)?[ _]?type|specimen|sample[ _]?type|source|spec_type)$/i,
  specimen_date: /^(spec(imen)?[ _]?date|collection[ _]?date|date[ _]?collected|date|spec_date)$/i,
  ward: /^(ward|location|department|unit)$/i,
  organism: /^(organism|organism[ _]?(name|code|id)|isolate|identification|org)$/i,
  antibiotic: /^(antibiotic|drug|antimicrobial|agent|abx)$/i,
  value: /^(mic|value|result|zone|mic[ _]?value|result[ _]?value)$/i,
  sir: /^(sir|interp(retation)?|s\/i\/r|category|final[ _]?interp)$/i,
  method: /^(method|test[ _]?method)$/i,
}

/** Guess which column is which. Returns { roles: {role: index}, layout: 'long' | 'wide', abxColumns: [{index, code?, name, kind}] }. */
export function guessColumns(header) {
  const roles = {}
  header.forEach((h, i) => {
    const name = String(h || '').trim()
    for (const [role, re] of Object.entries(ROLE_PATTERNS)) if (roles[role] == null && re.test(name)) { roles[role] = i; break }
  })
  const layout = roles.antibiotic != null ? 'long' : 'wide'
  const taken = new Set(Object.values(roles))
  const abxColumns = []
  if (layout === 'wide') {
    header.forEach((h, i) => {
      if (taken.has(i)) return
      const name = String(h || '').trim()
      if (!name) return
      const wh = name.match(/^([A-Z]{3})_[A-Z]([DME])([0-9_.]*)$/)   // WHONET style: CIP_EM, AMP_ED10
      if (wh) { abxColumns.push({ index: i, code: wh[1], name, kind: wh[2] === 'D' ? 'disk' : wh[2] === 'E' ? 'etest' : 'mic' }); return }
      const pair = name.match(/^(.*?)[ _-]*(mic|zone|interp(retation)?|sir|result)$/i)  // "Ampicillin MIC", "AMP Interp"
      if (pair && pair[1]) {
        const kind = /interp|sir/i.test(pair[2]) ? 'sir' : /zone/i.test(pair[2]) ? 'disk' : 'mic'
        abxColumns.push({ index: i, name: pair[1].trim(), kind }); return
      }
      abxColumns.push({ index: i, name, kind: 'auto' })
    })
  }
  return { roles, layout, abxColumns }
}

const looksSir = (v) => /^[SIR]$/i.test(String(v || '').trim())

/** Turn a parsed table into import rows for micro_import (grouped by specimen + organism). */
export function tableToImportRows(table, guess = guessColumns(table[0] || [])) {
  const [, ...data] = table
  const { roles, layout, abxColumns } = guess
  const get = (r, role) => (roles[role] != null ? String(r[roles[role]] ?? '').trim() : '')
  const groups = new Map()
  for (const r of data) {
    const organism = get(r, 'organism')
    if (!organism) continue
    const key = `${get(r, 'specimen_no')}|${organism}`
    if (!groups.has(key)) {
      groups.set(key, { specimen_no: get(r, 'specimen_no'), patient_number: get(r, 'patient_number'), specimen_type: get(r, 'specimen_type'),
        specimen_date: normaliseDate(get(r, 'specimen_date')), ward: get(r, 'ward'), organism, results: [] })
    }
    const g = groups.get(key)
    if (layout === 'long') {
      const code = get(r, 'antibiotic'); if (!code) continue
      const value = get(r, 'value'); const sir = get(r, 'sir')
      const method = (get(r, 'method') || '').toLowerCase()
      g.results.push({ code, method: /disk|zone|kb/.test(method) ? 'disk' : /etest|grad/.test(method) ? 'etest' : looksSir(value) ? 'sir' : 'mic',
        value: looksSir(value) ? '' : value, sir: sir || (looksSir(value) ? value.toUpperCase() : '') })
    } else {
      const byName = new Map()
      for (const c of abxColumns) {
        const cell = String(r[c.index] ?? '').trim(); if (!cell) continue
        const code = c.code || c.name
        const cur = byName.get(code) || { code, method: c.kind === 'disk' ? 'disk' : c.kind === 'etest' ? 'etest' : 'mic', value: '', sir: '' }
        if (c.kind === 'sir' || (c.kind === 'auto' && looksSir(cell))) cur.sir = cell.toUpperCase().slice(0, 1)
        else { cur.value = cell; if (c.kind !== 'auto') cur.method = c.kind === 'disk' ? 'disk' : c.kind === 'etest' ? 'etest' : 'mic' }
        byName.set(code, cur)
      }
      for (const v of byName.values()) { if (!v.value) v.method = 'sir'; g.results.push(v) }
    }
  }
  return [...groups.values()]
}

export function normaliseDate(s) {
  const t = String(s || '').trim(); if (!t) return ''
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/)   // day/month/year (Kenya)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = t.match(/^(\d{4})(\d{2})(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`   // ASTM YYYYMMDD
  return ''
}

// ---------------------------------------------------------------- ASTM E1394
const ORG_TESTS = /^(org|organism|orgid|org_id|id|identification|isolate)$/i

/**
 * Parse an ASTM E1394 record file (H / P / O / R / L records; E1381 framing characters are stripped).
 * O starts a specimen; an R whose test id is an organism test (ORG, ORGANISM …) starts an isolate; other R
 * records are AST results: test id = antibiotic code, value = MIC / zone, abnormal flag = S / I / R.
 */
export function parseAstm(text) {
  const lines = String(text || '')
    .replace(/[\x02\x03\x04\x05\x06\x15\x17]/g, '\n')
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/^[0-7](?=[HPOCMRLQ]\|)/, '').trim())   // E1381 frame number; checksums end up on their own line and are dropped
    .filter((l) => /^[HPOCMRLQ]\|/.test(l))
  let fd = '|', cd = '^'
  const rows = []; let patient = ''; let spec = null; let iso = null
  for (const l of lines) {
    if (l.startsWith('H')) { fd = l[1]; cd = l[3] || '^'; continue }
    const f = l.split(fd)
    const comp = (x) => String(x || '').split(cd)
    if (f[0] === 'P') { patient = comp(f[3])[0] || comp(f[2])[0] || comp(f[4])[0] || ''; continue }
    if (f[0] === 'O') {
      spec = { specimen_no: comp(f[2])[0] || comp(f[3])[0] || '', specimen_type: comp(f[15])[0] || '', specimen_date: normaliseDate(f[7] || f[6] || '') }
      iso = null; continue
    }
    if (f[0] === 'R') {
      const id = comp(f[2]).filter(Boolean)
      const test = id.length > 1 ? id[id.length - 1] : id[0] || ''
      const testCode = comp(f[2])[3] || test
      const value = comp(f[3])[0] || ''
      const flag = String(f[6] || '').trim()
      if (ORG_TESTS.test(comp(f[2])[3] || '') || ORG_TESTS.test(test)) {
        iso = { specimen_no: spec?.specimen_no || '', patient_number: patient, specimen_type: spec?.specimen_type || '', specimen_date: spec?.specimen_date || '', ward: '', organism: value, results: [] }
        rows.push(iso); continue
      }
      if (!iso) continue
      const p = parseAstValue(value)
      iso.results.push({ code: testCode, method: p.value == null ? 'sir' : 'mic', value: p.value == null ? '' : value, sir: /^[SIR]$/i.test(flag) ? flag.toUpperCase() : (/^[SIR]$/i.test(value) ? value.toUpperCase() : '') })
    }
  }
  return rows
}

// ---------------------------------------------------------------- WHONET export
export const WHONET_BASE = ['LABORATORY', 'PATIENT_ID', 'SEX', 'AGE', 'DATE_BIRTH', 'WARD', 'WARD_TYPE', 'ORIGIN', 'SPEC_NUM', 'SPEC_DATE', 'SPEC_TYPE', 'ORGANISM', 'ESBL', 'BETA_LACT', 'MRSA', 'INDUC_CLI', 'CARBAPENEM', 'COMMENT']

/** CSV for WHONET BacLink: one row per isolate, one column per antibiotic test field (e.g. CIP_ED5, CIP_EM). */
export function buildWhonetCsv(rows, laboratory = 'LAB') {
  const fields = [...new Set((rows || []).flatMap((r) => (r.results || []).map((x) => x.field)))].sort()
  const header = [...WHONET_BASE, ...fields]
  const q = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const lines = [header.join(',')]
  for (const r of rows || []) {
    const res = Object.fromEntries((r.results || []).map((x) => [x.field, x.value]))
    lines.push(header.map((h) => q(h === 'LABORATORY' ? laboratory : h in res ? res[h] : r[h])).join(','))
  }
  return lines.join('\r\n')
}
