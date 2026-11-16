// Builds a FICTIONAL antimicrobial susceptibility report laid out like a VITEK 2 Compact print-out, plus the same data
// as CSV, for testing the Antibiogram import (PDF → AI extraction; CSV → direct import).
// MICs are interpreted with EUCAST v16.1 breakpoints (the version in the Microbiology module).
// usage: node tools/test-data/make-vitek-sample.mjs        → tools/test-data/vitek2-compact-sample-report.pdf + .csv
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const OUT = fileURLToPath(new URL('./', import.meta.url))

// [antimicrobial, MIC (mg/L), interpretation]  ('—' = no EUCAST breakpoint, reported without category)
const ISOLATES = [
  {
    labId: 'MB-26-1101', patient: 'TEST PATIENT 01', patientNo: 'TP-0001', ageSex: '54 y / F', ward: 'Medical Ward 2', specimen: 'Urine', specimenDetail: 'Urine (midstream)',
    collected: '2026-11-10', reported: '2026-11-12', gram: 'Gram-negative rods', growth: 'Heavy', colonyCount: '>10^5 CFU/ml',
    organism: 'Escherichia coli', probability: 99, idCard: 'GN', astCard: 'AST-N222', flags: { esbl: true },
    phenotype: 'ESBL test: POSITIVE', aes: 'Extended-spectrum beta-lactamase (ESBL) — consistent phenotype',
    ast: [['Ampicillin', '>=32', 'R'], ['Amoxicillin/Clavulanic Acid', '16', 'R'], ['Piperacillin/Tazobactam', '16', 'R'], ['Cefuroxime', '>=64', 'R'], ['Ceftriaxone', '>=64', 'R'],
      ['Ceftazidime', '16', 'R'], ['Cefepime', '8', 'R'], ['Ertapenem', '<=0.12', 'S'], ['Meropenem', '<=0.25', 'S'], ['Amikacin', '<=2', 'S'], ['Gentamicin', '>=16', 'R'],
      ['Ciprofloxacin', '>=4', 'R'], ['Trimethoprim/Sulfamethoxazole', '>=320', 'R'], ['Nitrofurantoin', '<=16', 'S'], ['Fosfomycin', '<=8', 'S']],
  },
  {
    labId: 'MB-26-1102', patient: 'TEST PATIENT 02', patientNo: 'TP-0002', ageSex: '67 y / M', ward: 'ICU', specimen: 'Blood', specimenDetail: 'Blood culture (aerobic bottle)',
    collected: '2026-11-10', reported: '2026-11-13', gram: 'Gram-negative rods', growth: 'Positive culture', colonyCount: 'n/a',
    organism: 'Klebsiella pneumoniae ssp pneumoniae', probability: 98, idCard: 'GN', astCard: 'AST-N222', flags: { esbl: true, carbapenem_r: true },
    phenotype: 'ESBL test: POSITIVE · Carbapenem resistance detected — refer for carbapenemase confirmation', aes: 'Carbapenemase (possible) — confirm by molecular or phenotypic test',
    ast: [['Ampicillin', '>=32', 'R'], ['Amoxicillin/Clavulanic Acid', '>=32', 'R'], ['Piperacillin/Tazobactam', '>=128', 'R'], ['Ceftriaxone', '>=64', 'R'], ['Ceftazidime', '>=64', 'R'],
      ['Cefepime', '>=32', 'R'], ['Ertapenem', '>=8', 'R'], ['Imipenem', '>=16', 'R'], ['Meropenem', '>=16', 'R'], ['Amikacin', '32', 'R'], ['Gentamicin', '>=16', 'R'],
      ['Ciprofloxacin', '>=4', 'R'], ['Trimethoprim/Sulfamethoxazole', '>=320', 'R'], ['Colistin', '<=0.5', 'S'], ['Tigecycline', '1', '—']],
  },
  {
    labId: 'MB-26-1103', patient: 'TEST PATIENT 03', patientNo: 'TP-0003', ageSex: '38 y / M', ward: 'Surgical Ward', specimen: 'Wound Swab', specimenDetail: 'Wound swab (post-operative, abdomen)',
    collected: '2026-11-11', reported: '2026-11-13', gram: 'Gram-positive cocci in clusters', growth: 'Moderate', colonyCount: 'n/a',
    organism: 'Staphylococcus aureus', probability: 99, idCard: 'GP', astCard: 'AST-P592', flags: { mrsa: true },
    phenotype: 'Cefoxitin screen: POSITIVE (MRSA) · Inducible clindamycin resistance: NEGATIVE', aes: 'Methicillin resistance (mecA) — consistent phenotype',
    ast: [['Cefoxitin Screen', 'POS', '+'], ['Benzylpenicillin', '>=0.5', 'R'], ['Oxacillin', '>=4', 'R'], ['Gentamicin', '<=0.5', 'S'], ['Ciprofloxacin', '>=8', 'R'],
      ['Erythromycin', '>=8', 'R'], ['Clindamycin', '<=0.25', 'S'], ['Linezolid', '2', 'S'], ['Vancomycin', '1', 'S'], ['Tetracycline', '<=1', 'S'],
      ['Fusidic Acid', '<=0.5', 'S'], ['Rifampicin', '<=0.03', 'S'], ['Trimethoprim/Sulfamethoxazole', '<=10', 'S']],
  },
  {
    labId: 'MB-26-1104', patient: 'TEST PATIENT 04', patientNo: 'TP-0004', ageSex: '45 y / F', ward: 'ICU', specimen: 'Sputum', specimenDetail: 'Tracheal aspirate (ventilated, day 6)',
    collected: '2026-11-11', reported: '2026-11-14', gram: 'Gram-negative rods', growth: 'Heavy', colonyCount: '>10^6 CFU/ml',
    organism: 'Pseudomonas aeruginosa', probability: 99, idCard: 'GN', astCard: 'AST-N233', flags: {},
    phenotype: 'Wild type for carbapenems at increased exposure', aes: 'Wild type — EUCAST: I = susceptible, increased exposure (use high dosage)',
    ast: [['Piperacillin/Tazobactam', '16', 'I'], ['Ceftazidime', '4', 'I'], ['Cefepime', '8', 'I'], ['Imipenem', '2', 'I'], ['Meropenem', '4', 'I'],
      ['Amikacin', '4', 'S'], ['Tobramycin', '<=1', 'S'], ['Ciprofloxacin', '0.25', 'I'], ['Levofloxacin', '1', 'I'], ['Colistin', '<=0.5', 'S']],
  },
  {
    labId: 'MB-26-1105', patient: 'TEST PATIENT 05', patientNo: 'TP-0005', ageSex: '29 y / F', ward: 'OPD', specimen: 'Urine', specimenDetail: 'Urine (midstream)',
    collected: '2026-11-12', reported: '2026-11-14', gram: 'Gram-negative rods', growth: 'Heavy', colonyCount: '>10^5 CFU/ml',
    organism: 'Klebsiella pneumoniae ssp pneumoniae', probability: 97, idCard: 'GN', astCard: 'AST-N222', flags: {},
    phenotype: 'ESBL test: NEGATIVE', aes: 'Wild type (intrinsic resistance to ampicillin)',
    ast: [['Ampicillin', '>=32', 'R'], ['Amoxicillin/Clavulanic Acid', '4', 'S'], ['Piperacillin/Tazobactam', '<=4', 'S'], ['Ceftriaxone', '<=1', 'S'], ['Ceftazidime', '<=1', 'S'],
      ['Cefepime', '<=1', 'S'], ['Ertapenem', '<=0.12', 'S'], ['Meropenem', '<=0.25', 'S'], ['Amikacin', '<=2', 'S'], ['Gentamicin', '<=1', 'S'],
      ['Ciprofloxacin', '<=0.25', 'S'], ['Trimethoprim/Sulfamethoxazole', '<=20', 'S']],
  },
  {
    labId: 'MB-26-1106', patient: 'TEST PATIENT 06', patientNo: 'TP-0006', ageSex: '71 y / M', ward: 'ICU', specimen: 'Blood', specimenDetail: 'Blood culture (central line)',
    collected: '2026-11-12', reported: '2026-11-15', gram: 'Gram-negative coccobacilli', growth: 'Positive culture', colonyCount: 'n/a',
    organism: 'Acinetobacter baumannii complex', probability: 96, idCard: 'GN', astCard: 'AST-N233', flags: { carbapenem_r: true },
    phenotype: 'Carbapenem-resistant Acinetobacter baumannii (CRAB)', aes: 'Carbapenemase (possible) — infection-control alert',
    ast: [['Imipenem', '>=16', 'R'], ['Meropenem', '>=16', 'R'], ['Amikacin', '>=64', 'R'], ['Gentamicin', '>=16', 'R'], ['Tobramycin', '>=16', 'R'],
      ['Ciprofloxacin', '>=4', 'R'], ['Levofloxacin', '>=8', 'R'], ['Trimethoprim/Sulfamethoxazole', '>=320', 'R'], ['Colistin', '<=0.5', 'S'], ['Tigecycline', '2', '—']],
  },
  {
    labId: 'MB-26-1107', patient: 'TEST PATIENT 07', patientNo: 'TP-0007', ageSex: '24 y / F', ward: 'Maternity', specimen: 'Urine', specimenDetail: 'Urine (catheter)',
    collected: '2026-11-13', reported: '2026-11-15', gram: 'Gram-positive cocci in chains', growth: 'Moderate', colonyCount: '10^4–10^5 CFU/ml',
    organism: 'Enterococcus faecalis', probability: 99, idCard: 'GP', astCard: 'AST-P586', flags: {},
    phenotype: 'High-level gentamicin: SYNERGY (no high-level resistance) · Vancomycin: susceptible', aes: 'Wild type',
    ast: [['Ampicillin', '<=2', 'S'], ['Gentamicin High Level (synergy)', 'SYN-S', 'S'], ['Vancomycin', '1', 'S'], ['Teicoplanin', '<=0.5', 'S'],
      ['Linezolid', '2', 'S'], ['Nitrofurantoin', '<=16', 'S']],
  },
]

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const interp = (c) => (c === 'R' ? 'Resistant' : c === 'I' ? 'Susceptible, increased exposure' : c === 'S' ? 'Susceptible' : c === '+' ? 'Positive' : 'No EUCAST breakpoint')
const tone = (c) => (c === 'R' ? '#B42318' : c === 'I' ? '#B54708' : c === 'S' ? '#067647' : '#344054')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 14mm 12mm 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10.5pt; margin: 0; }
  .banner { background: #FEF3F2; border: 2px solid #B42318; color: #B42318; font-weight: 700; padding: 6px 10px; text-align: center; margin-bottom: 8px; }
  .head { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 10px; }
  .head h1 { font-size: 15pt; margin: 0; } .muted { color: #333; font-size: 9pt; }
  .iso { border: 1px solid #555; padding: 8px 10px; margin-bottom: 12px; page-break-inside: avoid; }
  .iso h2 { font-size: 12pt; margin: 0 0 6px; background: #EEE; padding: 4px 6px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px 14px; font-size: 9.5pt; margin-bottom: 6px; }
  .grid b { display: inline-block; min-width: 92px; }
  .org { font-size: 11pt; margin: 6px 0; } .org i { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; } th { background: #F2F2F2; }
  td.c { font-weight: 700; text-align: center; width: 42px; }
  .pheno { margin-top: 6px; font-size: 9.5pt; } .pheno b { color: #B42318; }
  .foot { font-size: 8.5pt; color: #333; margin-top: 10px; border-top: 1px solid #999; padding-top: 6px; }
</style></head><body>
<div class="banner">SAMPLE TEST REPORT — FICTIONAL PATIENTS AND RESULTS FOR SOFTWARE TESTING ONLY — NOT FOR CLINICAL USE</div>
<div class="head">
  <div><h1>Microbiology — Antimicrobial Susceptibility Report</h1>
    <div class="muted">RemedacareHMS Test Laboratory · Instrument: VITEK 2 Compact (simulated print-out) · Interpretation: EUCAST Clinical Breakpoint Tables v16.1</div></div>
  <div class="muted" style="text-align:right">Printed: 2026-11-15 10:42<br>Isolates in report: ${ISOLATES.length}</div>
</div>
${ISOLATES.map((x, n) => `<div class="iso">
  <h2>Isolate ${n + 1} of ${ISOLATES.length} — Lab ID ${esc(x.labId)}</h2>
  <div class="grid">
    <div><b>Patient name:</b> ${esc(x.patient)}</div><div><b>Patient no:</b> ${esc(x.patientNo)}</div><div><b>Age / sex:</b> ${esc(x.ageSex)}</div>
    <div><b>Ward / dept:</b> ${esc(x.ward)}</div><div><b>Specimen:</b> ${esc(x.specimenDetail)}</div><div><b>Collected:</b> ${esc(x.collected)}</div>
    <div><b>Gram stain:</b> ${esc(x.gram)}</div><div><b>Growth:</b> ${esc(x.growth)}</div><div><b>Colony count:</b> ${esc(x.colonyCount)}</div>
  </div>
  <div class="org">Organism identified: <i>${esc(x.organism)}</i> — ${x.probability}% probability, excellent identification · ID card: ${esc(x.idCard)} · AST card: ${esc(x.astCard)} · Reported: ${esc(x.reported)}</div>
  <table><thead><tr><th>Antimicrobial</th><th>MIC (mg/L)</th><th>Cat.</th><th>Interpretation</th></tr></thead><tbody>
    ${x.ast.map(([d, mic, c]) => `<tr><td>${esc(d)}</td><td>${esc(mic)}</td><td class="c" style="color:${tone(c)}">${c}</td><td style="color:${tone(c)}">${interp(c)}</td></tr>`).join('')}
  </tbody></table>
  <div class="pheno"><b>Phenotype:</b> ${esc(x.phenotype)}<br><b>AES comment:</b> ${esc(x.aes)}</div>
</div>`).join('')}
<div class="foot">S = susceptible, standard dosing · I = susceptible, increased exposure (high dosage) · R = resistant (EUCAST definitions).
MIC values are fictional but consistent with EUCAST v16.1 breakpoints. Generated by tools/test-data/make-vitek-sample.mjs for RemedacareHMS testing.</div>
</body></html>`

// CSV for the direct (non-AI) import: one row per isolate, one column per antibiotic (S / I / R; blank = not tested)
const NAME = { 'Amoxicillin/Clavulanic Acid': 'Amox-Clav', 'Piperacillin/Tazobactam': 'Pip-Tazo', 'Trimethoprim/Sulfamethoxazole': 'Cotrimoxazole' }
const drugs = [...new Set(ISOLATES.flatMap((x) => x.ast.filter(([, , c]) => ['S', 'I', 'R'].includes(c)).map(([d]) => NAME[d] || d)))]
const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
const header = ['Patient Name', 'Organism Identified', 'Sample Type', 'Collection Date', 'Ward', 'Gram Stain', 'Growth', 'Colony Count', 'ESBL', 'MRSA', 'VRE', 'Carbapenem R', ...drugs]
const rows = ISOLATES.map((x) => {
  const sir = Object.fromEntries(x.ast.filter(([, , c]) => ['S', 'I', 'R'].includes(c)).map(([d, , c]) => [NAME[d] || d, c]))
  return [x.patient, x.organism, x.specimen, x.collected, x.ward, x.gram, x.growth, x.colonyCount,
    String(Boolean(x.flags.esbl)), String(Boolean(x.flags.mrsa)), String(Boolean(x.flags.vre)), String(Boolean(x.flags.carbapenem_r)), ...drugs.map((d) => sir[d] || '')]
})
writeFileSync(OUT + 'vitek2-compact-sample-results.csv', [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n')

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
const page = await browser.newPage()
await page.setContent(html, { waitUntil: 'load' })
await page.pdf({ path: OUT + 'vitek2-compact-sample-report.pdf', format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
  displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#444">FICTIONAL TEST DATA — page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' })
await browser.close()
console.log(`wrote ${OUT}vitek2-compact-sample-report.pdf and vitek2-compact-sample-results.csv (${ISOLATES.length} isolates, ${drugs.length} antibiotics)`)
