// Turns official reference files into paste-ready SQL for the Supabase SQL Editor.
//
//   node scripts/import-reference.mjs icd   <file>   ICD-10 → ICD-11 mapping from WHO
//        (download "ICD-10 to ICD-11 mapping tables" from https://icd.who.int/browse/ → Info → Downloads,
//         use 10To11MapToOneCategory.txt — tab separated, columns icd10Code … icd10Title … icd11Code … icd11Title)
//        Any CSV/TSV with columns code,title[,icd11_code,icd11_title] also works.
//   node scripts/import-reference.mjs loinc <file>   Loinc.csv from https://loinc.org/downloads/ (free account,
//        accept the LOINC licence). Columns LOINC_NUM, LONG_COMMON_NAME, SHORTNAME, COMPONENT, SYSTEM, EXAMPLE_UCUM_UNITS.
//
// Output: docs/sql/reference/<kind>_NN.sql, 2,000 rows each. Run them in order ("Run without RLS").
// Re-running is safe: rows are upserted; the Kenyan "common" flag on existing rows is kept.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const [kind, file] = process.argv.slice(2)
if (!['icd', 'loinc'].includes(kind) || !file) {
  console.error('Usage: node scripts/import-reference.mjs <icd|loinc> <file>')
  process.exit(1)
}

/** Minimal CSV/TSV parser with quotes. */
function parse(text) {
  const delim = text.split('\n', 1)[0].includes('\t') ? '\t' : ','
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false; else cell += c
    } else if (c === '"') q = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const head = rows.shift().map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
}
const pick = (o, ...keys) => { for (const k of keys) if (o[k]) return o[k]; return '' }
const lit = (v) => (v === '' || v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

const records = parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
let values = [], table = '', cols = '', conflict = ''
if (kind === 'icd') {
  const seen = new Set()
  for (const r of records) {
    let code = pick(r, 'icd10code', 'code').replace(/\s+/g, '')
    const title = pick(r, 'icd10title', 'title', 'description').replace(/^[-\s]+/, '')
    if (!code || !title || seen.has(code) || /^[IVX]+$/.test(code) || code.includes('-')) continue // skip chapters / blocks
    if (/^[A-Z]\d{3}$/.test(code)) code = `${code.slice(0, 3)}.${code.slice(3)}` // A010 → A01.0
    seen.add(code)
    const icd11 = pick(r, 'icd11code', 'icd11').replace(/\s+/g, '')
    values.push(`(${lit(code)}, ${lit(title)}, ${lit(pick(r, 'icd10chapter', 'chapter'))}, ${lit(icd11 && icd11 !== 'No Mapping' ? icd11 : '')}, ${lit(pick(r, 'icd11title').replace(/^[-\s]+/, ''))})`)
  }
  table = 'icd10_codes'; cols = 'code, title, chapter, icd11_code, icd11_title'
  conflict = 'on conflict (code) do update set title = excluded.title, chapter = coalesce(excluded.chapter, icd10_codes.chapter), icd11_code = coalesce(excluded.icd11_code, icd10_codes.icd11_code), icd11_title = coalesce(excluded.icd11_title, icd10_codes.icd11_title)'
} else {
  for (const r of records) {
    const code = pick(r, 'loincnum', 'code')
    const name = pick(r, 'longcommonname', 'longname')
    if (!code || !name || /deprecated|discouraged/i.test(pick(r, 'status'))) continue
    values.push(`(${lit(code)}, ${lit(name)}, ${lit(pick(r, 'shortname'))}, ${lit(pick(r, 'component'))}, ${lit(pick(r, 'system'))}, ${lit(pick(r, 'exampleucumunits', 'unit'))})`)
  }
  table = 'loinc_codes'; cols = 'code, long_name, short_name, component, system, unit'
  conflict = 'on conflict (code) do update set long_name = excluded.long_name, short_name = excluded.short_name, component = excluded.component, system = excluded.system, unit = coalesce(excluded.unit, loinc_codes.unit)'
}
if (!values.length) { console.error('No usable rows found — check the file and its header row.'); process.exit(1) }

const out = new URL('../docs/sql/reference/', import.meta.url)
mkdirSync(out, { recursive: true })
const size = 2000
const parts = Math.ceil(values.length / size)
for (let p = 0; p < parts; p++) {
  const chunk = values.slice(p * size, (p + 1) * size)
  const name = `${kind}_${String(p + 1).padStart(2, '0')}.sql`
  writeFileSync(new URL(name, out),
    `-- ${table}: part ${p + 1} of ${parts} (${chunk.length} rows). Run in SQL Editor ("Run without RLS").\n` +
    (kind === 'loinc' && p === 0 ? '-- This material contains content from LOINC (http://loinc.org), available at no cost under http://loinc.org/license.\n' : '') +
    `insert into public.${table}(${cols}) values\n${chunk.join(',\n')}\n${conflict};\n`)
}
console.log(`Wrote ${values.length} ${table} rows into ${parts} file(s) in docs/sql/reference/`)
