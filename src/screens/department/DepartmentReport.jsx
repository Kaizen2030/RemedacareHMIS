// Monthly department report: workload (new vs revisit, under 5 vs 5 and over, sex), top diagnoses, referrals in and out,
// admissions and services billed — the figures a department needs for the MOH 705 (outpatient morbidity, <5 / ≥5) and
// MOH 717 (hospital workload) summaries. Exportable as CSV (opens in Excel) and printable.
import { useState } from 'react'
import supabase from '../../supabase'

const monthRange = (ym) => { const [y, m] = ym.split('-').map(Number); return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) } }
const inRange = (iso, { start, end }) => { const t = new Date(iso).getTime(); return t >= start.getTime() && t < end.getTime() }
/** Invoice service lines (stored as a JSON array; anything else is ignored). */
const parseServiceLines = (v) => { try { const x = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(x) ? x : [] } catch { return [] } }
const low = (v) => String(v || '').trim().toLowerCase()

/** Age in whole years on a date, from date of birth (preferred) or the stored age. */
export function ageAt(patient, when) {
  if (patient?.dob) {
    const b = new Date(patient.dob), d = new Date(when)
    if (!Number.isNaN(b.getTime())) return d.getFullYear() - b.getFullYear() - (d < new Date(d.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0)
  }
  const a = Number(patient?.age)
  return Number.isFinite(a) && String(patient?.age ?? '') !== '' ? a : null
}

/**
 * consultations: this department's consultations in the month; prior: this department's consultations before the
 * month for the same patients; patients; referrals and admissions (already for this department and month); invoices.
 */
export function buildDepartmentReport({ consultations = [], prior = [], patients = [], referralsIn = [], referralsOut = [], admissions = [], invoices = [], department = '' }) {
  const byId = new Map(patients.map((p) => [p.id, p]))
  const seenBefore = new Set(prior.map((c) => c.patient_id))
  const sorted = [...consultations].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const firstThisMonth = new Set()
  const rows = sorted.map((c) => {
    const p = byId.get(c.patient_id)
    const age = ageAt(p, c.created_at)
    const isNew = !seenBefore.has(c.patient_id) && !firstThisMonth.has(c.patient_id)
    firstThisMonth.add(c.patient_id)
    return { c, age, under5: age !== null && age < 5, isNew, sex: low(p?.gender).startsWith('f') ? 'F' : low(p?.gender).startsWith('m') ? 'M' : '?' }
  })
  const count = (f) => rows.filter(f).length
  const workload = {
    total: rows.length,
    newUnder5: count((r) => r.isNew && r.under5), newOver5: count((r) => r.isNew && !r.under5 && r.age !== null),
    revisitUnder5: count((r) => !r.isNew && r.under5), revisitOver5: count((r) => !r.isNew && !r.under5 && r.age !== null),
    ageUnknown: count((r) => r.age === null),
    female: count((r) => r.sex === 'F'), male: count((r) => r.sex === 'M'),
    patients: new Set(rows.map((r) => r.c.patient_id).filter(Boolean)).size,
  }
  const dx = new Map()
  for (const r of rows) {
    const code = String(r.c.icd10_code || r.c.icd_code || '').trim().toUpperCase()
    const label = String(r.c.icd10_description || r.c.diagnosis || '').trim()
    if (!code && !label) continue
    const key = code || low(label)
    const e = dx.get(key) || { code, label: label || code, under5: 0, over5: 0, total: 0 }
    e.total++; if (r.age !== null) { if (r.under5) e.under5++; else e.over5++ } // unknown age: total only, never guessed into a band
    dx.set(key, e)
  }
  const diagnoses = [...dx.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)).slice(0, 10)
  const services = new Map()
  for (const inv of invoices) {
    for (const line of parseServiceLines(inv.services)) {
      if (line?.source !== 'Procedure') continue
      const e = services.get(line.label) || { label: line.label, qty: 0, amount: 0 }
      e.qty += Number(line.qty || 1); e.amount += Number(line.total || 0)
      services.set(line.label, e)
    }
  }
  const tally = (list, key) => { const m = {}; for (const x of list) { const k = x[key] || 'Unknown'; m[k] = (m[k] || 0) + 1 } return Object.entries(m).sort((a, b) => b[1] - a[1]) }
  return {
    department, workload, diagnoses,
    referrals: { in: referralsIn.length, out: referralsOut.length, declinedIn: referralsIn.filter((r) => r.status === 'Declined').length,
      inFrom: tally(referralsIn, 'referring_department'), outTo: tally(referralsOut, 'receiving_department') },
    admissions: admissions.length,
    services: [...services.values()].sort((a, b) => b.qty - a.qty),
  }
}

const csvCell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''))
export function reportCsv(r, monthLabel, hospitalName = '') {
  const L = []
  const row = (...cells) => L.push(cells.map(csvCell).join(','))
  row(`${hospitalName ? `${hospitalName} — ` : ''}${r.department} monthly report`, monthLabel)
  row()
  row('WORKLOAD (MOH 717 / MOH 705)', 'Under 5 years', '5 years and over', 'Total')
  row('New attendances', r.workload.newUnder5, r.workload.newOver5, r.workload.newUnder5 + r.workload.newOver5)
  row('Re-attendances', r.workload.revisitUnder5, r.workload.revisitOver5, r.workload.revisitUnder5 + r.workload.revisitOver5)
  row('Age not recorded', '', '', r.workload.ageUnknown)
  row('All consultations', '', '', r.workload.total)
  row('Female / male', r.workload.female, r.workload.male)
  row('Different patients seen', '', '', r.workload.patients)
  row()
  row('TOP DIAGNOSES', 'ICD-10', 'Under 5', '5 and over', 'Total')
  r.diagnoses.forEach((d) => row(d.label, d.code, d.under5, d.over5, d.total))
  row()
  row('REFERRALS', 'Count'); row('Received from other departments', r.referrals.in); row('Declined', r.referrals.declinedIn); row('Sent to other departments', r.referrals.out)
  r.referrals.inFrom.forEach(([k, n]) => row(`  from ${k}`, n)); r.referrals.outTo.forEach(([k, n]) => row(`  to ${k}`, n))
  row(); row('ADMISSIONS under this department', r.admissions)
  row(); row('SERVICES BILLED', 'Quantity', 'Amount (KES)'); r.services.forEach((s) => row(s.label, s.qty, s.amount))
  return L.join('\r\n') + '\r\n'
}

/** Load everything for one department and month. matches(name) says whether a department name is this department. */
export async function loadDepartmentReport({ hospitalId, department, matches, month }) {
  const range = monthRange(month)
  const s = range.start.toISOString(), e = range.end.toISOString()
  const safe = (p) => p.then((r) => r.data || []).catch(() => [])
  const [consAll, refs, adms, invs] = await Promise.all([
    safe(supabase.from('consultations').select('*').eq('hospital_id', hospitalId).gte('created_at', s).lt('created_at', e)),
    safe(supabase.from('referrals').select('*').eq('hospital_id', hospitalId).gte('created_at', s).lt('created_at', e)),
    safe(supabase.from('admissions').select('*').eq('hospital_id', hospitalId).gte('admission_date', s).lt('admission_date', e)),
    safe(supabase.from('invoices').select('id, services, notes, created_at').eq('hospital_id', hospitalId).gte('created_at', s).lt('created_at', e).like('notes', 'WF|Procedure|%')),
  ])
  const consultations = consAll.filter((c) => matches(c.speciality) && inRange(c.created_at, range))
  const ids = [...new Set(consultations.map((c) => c.patient_id).filter(Boolean))]
  let prior = [], patients = []
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    const [p1, p2] = await Promise.all([
      safe(supabase.from('consultations').select('patient_id, speciality, created_at').eq('hospital_id', hospitalId).in('patient_id', chunk).lt('created_at', s)),
      safe(supabase.from('patients').select('id, gender, age, dob').eq('hospital_id', hospitalId).in('id', chunk)),
    ])
    prior = prior.concat(p1.filter((c) => matches(c.speciality))); patients = patients.concat(p2)
  }
  const invoices = invs.filter((inv) => {
    const dept = String(inv.notes || '').split('|')[4] || ''
    return matches(dept.split(':')[0])
  })
  return buildDepartmentReport({
    consultations, prior, patients, department,
    referralsIn: refs.filter((r) => matches(r.receiving_department) && r.status !== 'Draft'),
    referralsOut: refs.filter((r) => r.referring_department && matches(r.referring_department)),
    admissions: adms.filter((a) => matches(a.admitting_department)),
    invoices,
  })
}

export default function DepartmentReport({ hospitalId, hospitalName, department, matchesDepartment, css, SectionCard }) {
  const now = new Date()
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const [month, setMonth] = useState(`${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`)
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })
  const run = async () => {
    setBusy(true); setError('')
    try { setReport(await loadDepartmentReport({ hospitalId, department, matches: matchesDepartment, month })) } catch (e) { setError(e.message || 'Could not build the report.') }
    setBusy(false)
  }
  const download = () => {
    const blob = new Blob(['﻿' + reportCsv(report, monthLabel, hospitalName)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `${department.replace(/[^A-Za-z0-9]+/g, '-')}-${month}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const w = report?.workload
  const cell = { ...css.td, textAlign: 'right', fontWeight: 700 }
  return (
    <SectionCard title="Monthly report" note="Workload, top diagnoses, referrals, admissions and services for one month — the figures for the MOH 705 and MOH 717 summaries.">
      <div className="rc-reader-noprint" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
        <div><label htmlFor="dept-report-month" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#344054', marginBottom: 4 }}>Month</label>
          <input id="dept-report-month" type="month" value={month} max={`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`} onChange={(e) => { setMonth(e.target.value); setReport(null) }}
            style={{ padding: '6px 10px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 13 }} /></div>
        <button type="button" style={{ ...css.backBtn, background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' }} disabled={busy} onClick={() => void run()}>{busy ? 'Building…' : 'Build report'}</button>
        {report && <button type="button" style={css.backBtn} onClick={download}>Download CSV (Excel)</button>}
        {report && <button type="button" style={css.backBtn} onClick={() => window.print()}>Print</button>}
      </div>
      {error && <div role="alert" style={{ color: '#912018', fontSize: 13 }}>{error}</div>}
      {report && (
        <div aria-label={`${department} report for ${monthLabel}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 14 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>Workload — {monthLabel}</div>
            <table style={css.table}>
              <thead><tr>{['', 'Under 5', '5 and over', 'Total'].map((h) => <th key={h} style={{ ...css.th, textAlign: h ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
              <tbody>
                <tr><td style={css.td}>New attendances</td><td style={cell}>{w.newUnder5}</td><td style={cell}>{w.newOver5}</td><td style={cell}>{w.newUnder5 + w.newOver5}</td></tr>
                <tr><td style={css.td}>Re-attendances</td><td style={cell}>{w.revisitUnder5}</td><td style={cell}>{w.revisitOver5}</td><td style={cell}>{w.revisitUnder5 + w.revisitOver5}</td></tr>
                <tr><td style={{ ...css.td, fontWeight: 800 }}>All consultations</td><td style={cell} /><td style={cell} /><td style={cell}>{w.total}</td></tr>
              </tbody>
            </table>
            <p style={{ fontSize: 12.5, color: '#344054', margin: '6px 0 0' }}>{w.patients} different patients · {w.female} female, {w.male} male{w.ageUnknown ? ` · ${w.ageUnknown} with no age recorded` : ''}</p>
            <div style={{ fontWeight: 800, fontSize: 13.5, margin: '14px 0 6px' }}>Referrals and admissions</div>
            <p style={{ fontSize: 13, margin: 0 }}>Received {report.referrals.in} (declined {report.referrals.declinedIn}) · sent {report.referrals.out} · admitted {report.admissions}</p>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>Top diagnoses</div>
            {report.diagnoses.length === 0 ? <p style={{ fontSize: 13, color: '#475467' }}>No diagnoses recorded this month.</p> : (
              <table style={css.table}>
                <thead><tr>{['Diagnosis', 'ICD-10', '<5', '≥5', 'Total'].map((h) => <th key={h} style={{ ...css.th, textAlign: ['<5', '≥5', 'Total'].includes(h) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                <tbody>{report.diagnoses.map((d) => (
                  <tr key={d.code + d.label}><td style={css.td}>{d.label}</td><td style={{ ...css.td, fontFamily: 'monospace', fontSize: 12 }}>{d.code || '—'}</td><td style={cell}>{d.under5}</td><td style={cell}>{d.over5}</td><td style={cell}>{d.total}</td></tr>
                ))}</tbody>
              </table>
            )}
            {report.services.length > 0 && <>
              <div style={{ fontWeight: 800, fontSize: 13.5, margin: '14px 0 6px' }}>Services billed</div>
              <p style={{ fontSize: 13, margin: 0 }}>{report.services.map((s) => `${s.label} × ${s.qty}`).join(' · ')}</p>
            </>}
          </div>
        </div>
      )}
    </SectionCard>
  )
}
