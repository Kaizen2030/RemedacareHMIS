// Cross-check the EUCAST breakpoints seeded in supabase/migrations/20261221000000_microbiology.sql against an official
// EUCAST breakpoint workbook (download the .xlsx from https://www.eucast.org/clinical_breakpoints).
// usage: node tools/eucast/check-breakpoints.mjs path/to/v_16.1_Breakpoint_Tables.xlsx
// Superscript runs (footnote markers) are dropped; brackets are kept.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ExcelJS = require('exceljs')
const ROOT = new URL('../../', import.meta.url)
const sql = readFileSync(new URL('supabase/migrations/20261221000000_microbiology.sql', ROOT), 'utf8')
const names = Object.fromEntries([...sql.matchAll(/\('([A-Z]{3})', '([^']+)', '(J[0-9A-Z]+|)'/g)].map((m) => [m[1], m[2]]))
const SHEET = { ENT: 'Enterobacterales', PSE: 'Pseudomonas', ACI: 'Acinetobacter', STA: 'Staphylococcus', ENC: 'Enterococcus', SAG: 'Streptococcus A,B,C,G', SPN: 'S.pneumoniae', HIN: 'H.influenzae' }

const wb = new ExcelJS.Workbook()
const xlsx = process.argv[2]
if (!xlsx) { console.error('usage: node tools/eucast/check-breakpoints.mjs <EUCAST breakpoint tables .xlsx>'); process.exit(2) }
await wb.xlsx.readFile(xlsx)
const plain = (v) => {
  if (v == null) return ''
  if (typeof v !== 'object') return String(v)
  if (v.richText) return v.richText.filter((r) => r.font?.vertAlign !== 'superscript').map((r) => r.text).join('')
  if (v.text != null) return plain(v.text)
  if (v.result != null) return String(v.result)
  return ''
}
const tables = {}
for (const [g, name] of Object.entries(SHEET)) {
  const ws = wb.getWorksheet(name)
  const rows = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    const c = row.values.slice(1).map(plain).map((s) => s.replace(/\s+/g, ' ').trim())
    if (c[0]) rows.push({ name: c[0], ms: c[1], mr: c[2], disk: c[4], zs: c[5], zr: c[6] })
  })
  tables[g] = rows
}
const num = (s) => { const m = String(s).match(/^\(?([0-9.]+)\)?/); return m ? Number(m[1]) : null }
const seed = [...sql.matchAll(/\('([A-Z]{3})', (null|'[^']*'), '([A-Z]{3})', ([^,]+), ([^,]+), (null|'[^']*'), ([^,]+), ([^,]+), (true|false), '([a-z_]+)', (null|'[^']*')\)/g)]
  .map((m) => ({ g: m[1], org: m[2], abx: m[3], ms: m[4], mr: m[5], zs: m[7], zr: m[8], br: m[9] === 'true', ind: m[10], note: m[11] }))
let ok = 0, bad = 0, noteOnly = 0
for (const r of seed) {
  const drug = (names[r.abx] || r.abx).toLowerCase()
  const cands = tables[r.g].filter((x) => x.name.toLowerCase().startsWith(drug))
  const v = (s) => (s === 'null' ? null : Number(s))
  const match = cands.find((x) => {
    const okMic = v(r.ms) === null || v(r.ms) === 999 || (num(x.ms) === v(r.ms) && num(x.mr) === v(r.mr))
    const okZone = v(r.zs) === null || (num(x.zs) === v(r.zs) && num(x.zr) === v(r.zr))
    return okMic && okZone
  })
  if (match) { ok++; continue }
  if (cands.length && cands.every((x) => /^(Note|NA|-)/.test(x.ms))) { noteOnly++; console.log(`• ${r.g} ${r.org} ${r.abx}: value is given in an EUCAST note, check by hand (${r.note})`); continue }
  bad++
  console.log(`\n✗ ${r.g} ${r.org} ${r.abx} (${names[r.abx]}) [${r.ind}${r.note !== 'null' ? ' ' + r.note : ''}] seed MIC ${r.ms}/${r.mr} zone ${r.zs}/${r.zr}`)
  for (const x of cands) console.log(`    xlsx: ${x.name.slice(0, 90)} | MIC ${x.ms}/${x.mr} | disk ${x.disk} | zone ${x.zs}/${x.zr}`)
}
console.log(`\n${seed.length} seed rows: ${ok} match the workbook, ${noteOnly} are set in EUCAST notes (check those by hand), ${bad} differ`)
process.exitCode = bad ? 1 : 0
