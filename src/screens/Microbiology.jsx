// Microbiology surveillance: isolates with MIC / zone results interpreted by the database against EUCAST v16.1,
// expert rules and MDR / XDR, the first-isolate cumulative antibiogram, resistance alerts and ward clusters,
// instrument import (ASTM / CSV from VITEK 2, Phoenix, MicroScan) and WHONET export.
// Data and rules: supabase/migrations/20261221000000_microbiology.sql. Clinical and laboratory staff.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import PatientSearch from '../components/PatientSearch'
import { localDateKey } from '../utils/scheduling'
import { buildWhonetCsv, FLAG_INFO, parseAstm, parseDelimited, PRIORITY_FLAGS, tableToImportRows } from '../utils/microbiology'
import { C, Chip, s } from './ncd/ui'
import { EUCAST_DOSAGE_VERSION, eucastDoseNote } from '../data/eucastDosages'

const TABS = [['isolates', 'Isolates'], ['antibiogram', 'Antibiogram'], ['alerts', 'Alerts & clusters'], ['import', 'Instrument import'], ['whonet', 'WHONET export'], ['breakpoints', 'Breakpoints']]
const SIR_TONE = { S: 'green', I: 'yellow', R: 'red' }
const MDR_TONE = { PDR: 'red', XDR: 'red', 'possible XDR': 'red', MDR: 'yellow', none: 'gray', insufficient: 'gray' }
const WARD_TYPES = { inx: 'Inpatient', out: 'Outpatient', eme: 'Emergency', icu: 'ICU', oth: 'Other' }
const today = () => localDateKey()
const daysAgo = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return localDateKey(x) }
const notInstalled = (e) => /does not exist|schema cache|Could not find/i.test(e?.message || '')
const download = (name, text, type = 'text/csv') => {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a')
  a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}

function Field({ label, id, children, span }) {
  return <div style={span ? { gridColumn: `span ${span}` } : undefined}><label style={s.label} htmlFor={id}>{label}</label>{children}</div>
}
function Flags({ flags = [] }) {
  return <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{flags.map((f) => <Chip key={f} tone={PRIORITY_FLAGS.includes(f) ? 'red' : 'yellow'} title={FLAG_INFO[f]}>{f}</Chip>)}</span>
}

// ---------------------------------------------------------------- isolate detail
function IsolateDrawer({ isolate, refs, onClose, onChanged }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState({ antibiotic: '', method: 'mic', raw_value: '', entered_sir: '' })
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data } = await supabase.from('micro_ast').select('*').eq('isolate_id', isolate.id).order('antibiotic')
    setRows(data || [])
  }, [isolate.id])
  useEffect(() => { void load() }, [load])
  const run = async (fn) => { setErr(''); try { await fn(); await load(); onChanged() } catch (e) { setErr(e.message || String(e)) } }
  const add = () => run(async () => {
    const { error } = await supabase.from('micro_ast').upsert({ isolate_id: isolate.id, hospital_id: isolate.hospital_id, antibiotic: form.antibiotic, method: form.method,
      raw_value: form.method === 'sir' ? null : form.raw_value, entered_sir: form.entered_sir || null }, { onConflict: 'isolate_id,antibiotic' })
    if (error) throw error
    setForm({ antibiotic: '', method: form.method, raw_value: '', entered_sir: '' })
  })
  const remove = (id) => run(async () => { const { error } = await supabase.from('micro_ast').delete().eq('id', id); if (error) throw error })
  const setPhenotype = (k, v) => run(async () => {
    const { error } = await supabase.from('micro_isolates').update({ phenotype: { ...(isolate.phenotype || {}), [k]: v || undefined } }).eq('id', isolate.id)
    if (error) throw error
  })
  const setStatus = (status) => run(async () => { const { error } = await supabase.from('micro_isolates').update({ status }).eq('id', isolate.id); if (error) throw error })
  const abxName = (c) => refs.antibiotics.find((a) => a.code === c)?.name || c
  const d = isolate.mdr_detail || {}
  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-label="Isolate" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.drawer}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <h2 style={{ ...s.h1, fontSize: 18 }}><em>{isolate.organism_name}</em></h2>
            <div style={s.sub}>{isolate.patients?.full_name || 'Unlinked patient'} · {refs.specimens.find((x) => x.code === isolate.specimen_type)?.label || isolate.specimen_type} · {isolate.specimen_date}{isolate.ward ? ` · ${isolate.ward}` : ''}{isolate.specimen_no ? ` · ${isolate.specimen_no}` : ''}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <Flags flags={isolate.flags} />
              {isolate.mdr_class && <Chip tone={MDR_TONE[isolate.mdr_class]} title={`${d.categories_non_susceptible ?? 0} of ${d.categories_tested ?? 0} tested categories resistant (${d.categories_total ?? 0} in the definition)`}>{isolate.mdr_class === 'none' ? 'not MDR' : isolate.mdr_class}</Chip>}
              {isolate.onset && <Chip tone={isolate.onset === 'hospital' ? 'red' : 'blue'}>{isolate.onset}-onset</Chip>}
              <Chip tone={isolate.status === 'final' ? 'green' : 'gray'}>{isolate.status}</Chip>
            </div>
          </div>
          <button type="button" style={{ ...s.btn, ...s.ghost, alignSelf: 'flex-start' }} onClick={onClose}>Close</button>
        </div>
        {err && <div role="alert" style={{ ...s.err, marginTop: 10 }}>{err}</div>}
        {(isolate.warnings || []).map((w) => <div key={w} role="alert" style={{ ...s.err, background: '#FFFAEB', color: '#B54708', marginTop: 8 }}>{w}</div>)}
        {(isolate.flags || []).filter((f) => FLAG_INFO[f]).map((f) => <div key={f} style={{ ...s.sub, marginTop: 4 }}><strong>{f}:</strong> {FLAG_INFO[f]}</div>)}
        {(isolate.flags || []).some((f) => PRIORITY_FLAGS.includes(f) || /ESBL/.test(f)) && <a href="#/references?guide=resistant-organisms" style={{ display: 'inline-block', marginTop: 6, color: C.primary, fontWeight: 700, fontSize: 12 }}>Treatment guide for resistant organisms →</a>}

        <div style={{ ...s.card, marginTop: 12 }}>
          <h3 style={s.h2}>Susceptibility</h3>
          {rows.length === 0 ? <div style={s.sub}>No results yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>{['Antibiotic', 'Result', 'Interpretation', 'Reported', 'Rule', ''].map((h, i) => <th key={i} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td style={s.td}><strong>{abxName(r.antibiotic)}</strong> <span style={s.sub}>{r.antibiotic}</span></td>
                  <td style={s.td}>{r.method === 'sir' ? `entered ${r.entered_sir}` : `${r.raw_value} ${r.method === 'disk' ? 'mm' : 'mg/L'}`}{r.entered_sir && r.method !== 'sir' ? <div style={s.sub}>instrument: {r.entered_sir}</div> : null}</td>
                  <td style={s.td}>{r.interpretation ? <Chip tone={SIR_TONE[r.interpretation]}>{r.interpretation}</Chip> : '—'}</td>
                  <td style={s.td}>{r.reported_sir ? <Chip tone={SIR_TONE[r.reported_sir]}>{r.reported_sir}</Chip> : '—'}{r.reported_sir === 'I' && eucastDoseNote(r.antibiotic, 'I') ? <div style={{ ...s.sub, maxWidth: 260, marginTop: 3 }}>{eucastDoseNote(r.antibiotic, 'I')}</div> : null}</td>
                  <td style={{ ...s.td, color: C.sub }}>{r.rule}</td>
                  <td style={s.td}>{isolate.status !== 'final' && <button type="button" aria-label={`Remove ${r.antibiotic}`} style={{ ...s.btn, ...s.ghost, padding: '2px 8px' }} onClick={() => remove(r.id)}>×</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <div style={{ ...s.sub, marginTop: 6 }}>I = susceptible, increased exposure (EUCAST): the drug works only at the high dosage shown under the result. Doses are those EUCAST used to set the breakpoints ({EUCAST_DOSAGE_VERSION}), not a dosing guideline; adjust for weight, kidney function and local guidance. Reported results include intrinsic resistance and expert rules.</div>
          {isolate.status !== 'final' && (
            <div style={{ ...s.grid(120), marginTop: 10, alignItems: 'end' }}>
              <Field label="Antibiotic" id="ast-abx"><select id="ast-abx" style={s.input} value={form.antibiotic} onChange={(e) => setForm((f) => ({ ...f, antibiotic: e.target.value }))}><option value="">—</option>{refs.antibiotics.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</select></Field>
              <Field label="Method" id="ast-m"><select id="ast-m" style={s.input} value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}><option value="mic">MIC (mg/L)</option><option value="disk">Disk zone (mm)</option><option value="etest">Gradient (E-test)</option><option value="sir">S / I / R only</option></select></Field>
              {form.method !== 'sir' && <Field label={form.method === 'disk' ? 'Zone (mm)' : 'MIC'} id="ast-v"><input id="ast-v" style={s.input} placeholder={form.method === 'disk' ? '22' : '<=0.25'} value={form.raw_value} onChange={(e) => setForm((f) => ({ ...f, raw_value: e.target.value }))} /></Field>}
              <Field label={form.method === 'sir' ? 'Result' : 'Instrument S/I/R (optional)'} id="ast-sir"><select id="ast-sir" style={s.input} value={form.entered_sir} onChange={(e) => setForm((f) => ({ ...f, entered_sir: e.target.value }))}><option value="">—</option><option>S</option><option>I</option><option>R</option></select></Field>
              <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!form.antibiotic || (form.method === 'sir' ? !form.entered_sir : !form.raw_value)} onClick={add}>Add result</button>
            </div>
          )}
        </div>

        <div style={{ ...s.card, marginTop: 12 }}>
          <h3 style={s.h2}>Phenotypic tests</h3>
          <div style={s.grid(130)}>
            {[['esbl', 'ESBL confirmation'], ['carbapenemase', 'Carbapenemase'], ['beta_lactamase', 'Beta-lactamase'], ['d_test', 'D-test (inducible clindamycin)'], ['meca', 'mecA / PBP2a']].map(([k, l]) => (
              <Field key={k} label={l} id={`ph-${k}`}><select id={`ph-${k}`} style={s.input} disabled={isolate.status === 'final'} value={isolate.phenotype?.[k] || ''} onChange={(e) => setPhenotype(k, e.target.value)}><option value="">Not done</option><option value="+">Positive</option><option value="-">Negative</option></select></Field>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          {isolate.status === 'final'
            ? <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setStatus('preliminary')}>Amend (back to preliminary)</button>
            : <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => setStatus('final')}>Finalise report</button>}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- isolates list + entry
function Isolates({ hospitalId, refs }) {
  const [rows, setRows] = useState([])
  const [from, setFrom] = useState(daysAgo(30))
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [form, setForm] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('micro_isolates').select('*, patients(full_name, patient_number)').eq('hospital_id', hospitalId).gte('specimen_date', from).order('specimen_date', { ascending: false }).limit(500)
    if (error) setErr(notInstalled(error) ? 'Run docs/sql/39_microbiology.sql to switch on microbiology surveillance.' : error.message)
    setRows(data || [])
    if (open) { const fresh = (data || []).find((r) => r.id === open.id); if (fresh) setOpen(fresh) }
  }, [hospitalId, from, open])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, from]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setErr('')
    if (!form.organism_code) { setErr('Pick the organism'); return }
    const { data, error } = await supabase.from('micro_isolates').insert({ hospital_id: hospitalId, patient_id: form.patient?.id || null, specimen_no: form.specimen_no || null,
      specimen_type: form.specimen_type, specimen_date: form.specimen_date, ward: form.ward || null, ward_type: form.ward_type || null,
      organism_code: form.organism_code, organism_name: refs.organisms.find((o) => o.code === form.organism_code)?.name || '' }).select('*, patients(full_name, patient_number)').single()
    if (error) { setErr(/unique|duplicate/i.test(error.message) ? 'This organism is already recorded for that specimen number.' : error.message); return }
    setForm(null); await load(); setOpen(data)
  }
  const shown = rows.filter((r) => !q || `${r.organism_name} ${r.patients?.full_name || ''} ${r.ward || ''} ${r.specimen_no || ''} ${(r.flags || []).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 10 }}>
        <Field label="Specimens since" id="iso-from"><input id="iso-from" type="date" style={{ ...s.input, width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Search" id="iso-q"><input id="iso-q" style={{ ...s.input, width: 240 }} placeholder="organism, patient, ward, MRSA…" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <div style={{ flex: 1 }} />
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => setForm({ patient: null, specimen_no: '', specimen_type: 'blood', specimen_date: today(), ward: '', ward_type: 'inx', organism_code: '' })}>New isolate</button>
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Date', 'Patient', 'Specimen', 'Organism', 'Ward', 'Resistance', 'Status'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id} onClick={() => setOpen(r)} style={{ cursor: 'pointer' }}>
              <td style={s.td}>{r.specimen_date}</td>
              <td style={s.td}><strong>{r.patients?.full_name || '—'}</strong><div style={s.sub}>{r.specimen_no}</div></td>
              <td style={s.td}>{refs.specimens.find((x) => x.code === r.specimen_type)?.label || r.specimen_type}</td>
              <td style={s.td}><em>{r.organism_name}</em>{!r.organism_code && <div style={{ ...s.sub, color: C.danger }}>not coded</div>}</td>
              <td style={s.td}>{r.ward || '—'}{r.onset === 'hospital' && <div style={{ ...s.sub, color: C.danger }}>hospital-onset</div>}</td>
              <td style={s.td}><Flags flags={r.flags} /></td>
              <td style={s.td}>{r.status}{r.source !== 'manual' && <div style={s.sub}>{r.source}</div>}</td>
            </tr>
          ))}</tbody>
        </table>
        {shown.length === 0 && <div style={{ ...s.sub, padding: 16, textAlign: 'center' }}>No isolates in this period.</div>}
      </div>
      {form && (
        <div style={{ ...s.overlay, justifyContent: 'center', alignItems: 'center', padding: 16 }} role="dialog" aria-modal="true" aria-label="New isolate">
          <div style={{ ...s.card, width: 620, maxWidth: '96vw' }}>
            <h2 style={s.h2}>New isolate</h2>
            <Field label="Patient" id="ni-p"><PatientSearch id="ni-p" hospitalId={hospitalId} inputStyle={s.input} value={form.patient} onPick={(p) => setForm((f) => ({ ...f, patient: p }))} /></Field>
            <div style={{ ...s.grid(160), marginTop: 10 }}>
              <Field label="Organism" id="ni-org"><select id="ni-org" style={s.input} value={form.organism_code} onChange={(e) => setForm((f) => ({ ...f, organism_code: e.target.value }))}><option value="">—</option>{refs.organisms.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}</select></Field>
              <Field label="Specimen" id="ni-spec"><select id="ni-spec" style={s.input} value={form.specimen_type} onChange={(e) => setForm((f) => ({ ...f, specimen_type: e.target.value }))}>{refs.specimens.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>
              <Field label="Specimen number" id="ni-no"><input id="ni-no" style={s.input} value={form.specimen_no} onChange={(e) => setForm((f) => ({ ...f, specimen_no: e.target.value }))} /></Field>
              <Field label="Collected" id="ni-date"><input id="ni-date" type="date" max={today()} style={s.input} value={form.specimen_date} onChange={(e) => setForm((f) => ({ ...f, specimen_date: e.target.value }))} /></Field>
              <Field label="Ward" id="ni-ward"><input id="ni-ward" style={s.input} value={form.ward} onChange={(e) => setForm((f) => ({ ...f, ward: e.target.value }))} /></Field>
              <Field label="Patient type" id="ni-wt"><select id="ni-wt" style={s.input} value={form.ward_type} onChange={(e) => setForm((f) => ({ ...f, ward_type: e.target.value }))}>{Object.entries(WARD_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setForm(null)}>Cancel</button>
              <button type="button" style={{ ...s.btn, ...s.pri }} onClick={save}>Save and add results</button>
            </div>
          </div>
        </div>
      )}
      {open && <IsolateDrawer key={open.id} isolate={open} refs={refs} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}

// ---------------------------------------------------------------- antibiogram
function Antibiogram({ hospitalId, refs }) {
  const [from, setFrom] = useState(`${new Date().getFullYear() - 1}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`)
  const [to, setTo] = useState(today())
  const [filters, setFilters] = useState({ ward: '', specimen_type: '', onset: '', ward_type: '' })
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    setErr('')
    const f = Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
    const { data: d, error } = await supabase.rpc('micro_antibiogram', { p_hospital: hospitalId, p_from: from, p_to: to, p_filters: f })
    if (error) { setErr(notInstalled(error) ? 'Run docs/sql/39_microbiology.sql to switch on the antibiogram.' : error.message); return }
    setData(d)
  }, [hospitalId, from, to, filters])
  useEffect(() => { if (hospitalId && from <= to) void load() }, [hospitalId, from, to, filters, load])
  const orgs = data?.organisms || []
  const abx = useMemo(() => refs.antibiotics.filter((a) => orgs.some((o) => o.antibiotics?.[a.code])), [orgs, refs.antibiotics])
  const csv = () => {
    const lines = [['Organism', 'Isolates', ...abx.map((a) => `${a.code} %S (n)`)].join(',')]
    for (const o of orgs) lines.push([`"${o.organism}"`, o.isolates, ...abx.map((a) => { const c = o.antibiotics?.[a.code]; return c ? `${c.pct_s} (${c.n})` : '' })].join(','))
    download(`antibiogram-${from}-to-${to}.csv`, lines.join('\r\n'))
  }
  const tone = (p) => (p >= 90 ? ['#ECFDF3', '#027A48'] : p >= 70 ? ['#FFFAEB', '#B54708'] : ['#FEF3F2', '#B42318'])
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...s.card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
        <Field label="From" id="ab-from"><input id="ab-from" type="date" style={s.input} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To" id="ab-to"><input id="ab-to" type="date" style={s.input} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Ward" id="ab-ward"><input id="ab-ward" style={s.input} value={filters.ward} placeholder="all" onChange={(e) => setFilters((f) => ({ ...f, ward: e.target.value }))} /></Field>
        <Field label="Specimen" id="ab-spec"><select id="ab-spec" style={s.input} value={filters.specimen_type} onChange={(e) => setFilters((f) => ({ ...f, specimen_type: e.target.value }))}><option value="">All</option>{refs.specimens.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>
        <Field label="Onset" id="ab-onset"><select id="ab-onset" style={s.input} value={filters.onset} onChange={(e) => setFilters((f) => ({ ...f, onset: e.target.value }))}><option value="">All</option><option value="community">Community</option><option value="hospital">Hospital</option></select></Field>
        <Field label="Patient type" id="ab-wt"><select id="ab-wt" style={s.input} value={filters.ward_type} onChange={(e) => setFilters((f) => ({ ...f, ward_type: e.target.value }))}><option value="">All</option>{Object.entries(WARD_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <button type="button" style={{ ...s.btn, ...s.ghost }} disabled={!orgs.length} onClick={csv}>Download CSV</button>
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {data && (
        <div style={{ ...s.card, overflowX: 'auto' }}>
          <div style={{ ...s.sub, marginBottom: 8 }}>% susceptible (S) of first isolates, {data.guideline}. Grey rows have fewer than 30 isolates — interpret with caution. Intrinsic resistance is left out.</div>
          {orgs.length === 0 ? <div style={s.sub}>No coded isolates in this period.</div> : (
            <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr><th style={s.th}>Organism</th><th style={s.th}>n</th>{abx.map((a) => <th key={a.code} style={{ ...s.th, textAlign: 'center' }} title={a.name}>{a.code}</th>)}</tr></thead>
              <tbody>{orgs.map((o) => (
                <tr key={o.organism_code} style={{ opacity: o.low_n ? 0.6 : 1 }}>
                  <td style={s.td}><em>{o.organism}</em></td><td style={s.td}>{o.isolates}</td>
                  {abx.map((a) => {
                    const c = o.antibiotics?.[a.code]
                    if (!c) return <td key={a.code} style={s.td} />
                    const [bg, fg] = tone(c.pct_s)
                    return <td key={a.code} title={`${c.s} S / ${c.i} I / ${c.r} R of ${c.n}`} style={{ ...s.td, textAlign: 'center', background: bg, color: fg, fontWeight: 700 }}>{c.pct_s}<div style={{ fontSize: 10, fontWeight: 400 }}>{c.n}</div></td>
                  })}
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- alerts & clusters
function Alerts({ hospitalId }) {
  const [priority, setPriority] = useState([])
  const [clusters, setClusters] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!hospitalId) return
    void (async () => {
      const [a, b] = await Promise.all([
        supabase.from('micro_isolates').select('*, patients(full_name)').eq('hospital_id', hospitalId).gte('specimen_date', daysAgo(30)).order('specimen_date', { ascending: false }).limit(300),
        supabase.rpc('micro_cluster_alerts', { p_hospital: hospitalId }),
      ])
      if (a.error) setErr(notInstalled(a.error) ? 'Run docs/sql/39_microbiology.sql.' : a.error.message)
      setPriority((a.data || []).filter((r) => (r.flags || []).some((f) => PRIORITY_FLAGS.includes(f))))
      setClusters(Array.isArray(b.data) ? b.data : [])
    })()
  }, [hospitalId])
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={s.card}>
        <h3 style={s.h2}>Possible clusters (14 days)</h3>
        {clusters.length === 0 ? <div style={s.sub}>No ward clusters above the usual level.</div> : clusters.map((c) => (
          <div key={`${c.ward}-${c.organism_code}-${c.pattern}`} role="alert" style={{ ...s.err, marginBottom: 6 }}>
            <strong>{c.ward}:</strong> {c.patients} patients with <em>{c.organism}</em>{c.pattern !== 'any' ? ` (${c.pattern})` : ''} between {c.first_date} and {c.last_date}
            {c.hospital_onset ? ` — ${c.hospital_onset} hospital-onset` : ''}. Usual for 14 days: {c.expected}. Review infection control on the ward.
          </div>
        ))}
      </div>
      <div style={{ ...s.card, overflowX: 'auto' }}>
        <h3 style={s.h2}>Priority resistant organisms (30 days)</h3>
        {priority.length === 0 ? <div style={s.sub}>None.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Date', 'Patient', 'Organism', 'Ward', 'Flags'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{priority.map((r) => <tr key={r.id}><td style={s.td}>{r.specimen_date}</td><td style={s.td}>{r.patients?.full_name || '—'}</td><td style={s.td}><em>{r.organism_name}</em></td><td style={s.td}>{r.ward || '—'}</td><td style={s.td}><Flags flags={r.flags} /></td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- instrument import
function ImportTab({ hospitalId, refs }) {
  const [instrument, setInstrument] = useState('VITEK2')
  const [rows, setRows] = useState(null)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState(null)
  const [maps, setMaps] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const onFile = async (file) => {
    setErr(''); setResult(null); setRows(null)
    if (!file) return
    const text = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '')); r.onerror = () => reject(r.error); r.readAsText(file) })
    setFileName(file.name)
    try {
      const parsed = /(^|[\x02\r\n])\d?H\|/.test(text) ? parseAstm(text) : tableToImportRows(parseDelimited(text))
      if (!parsed.length) throw new Error('No isolates found. Check that the file has an organism column (CSV) or organism result records (ASTM).')
      setRows(parsed)
    } catch (e) { setErr(e.message) }
  }
  const submit = async () => {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('micro_import', { p_hospital: hospitalId, p_instrument: instrument, p_rows: rows })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setResult(data)
  }
  const saveMaps = async () => {
    const list = Object.entries(maps).filter(([, v]) => v).map(([k, v]) => { const [kind, code] = k.split('|'); return { hospital_id: hospitalId, instrument, kind, external_code: code, internal_code: v } })
    if (!list.length) return
    const { error } = await supabase.from('micro_instrument_maps').insert(list)
    if (error) { setErr(error.message); return }
    setMaps({}); await submit()
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={s.card}>
        <h3 style={s.h2}>Import from an instrument</h3>
        <div style={{ ...s.sub, marginBottom: 10 }}>Upload an ASTM record file (from the LIS / middleware capture) or a CSV / tab export from VITEK 2, BD Phoenix, MicroScan or a spreadsheet. Columns are recognised by name (specimen, patient, organism, and either one column per antibiotic or antibiotic / MIC / interpretation columns). Codes the instrument uses are mapped once and remembered.</div>
        <div style={{ ...s.grid(200), alignItems: 'end' }}>
          <Field label="Instrument" id="imp-inst"><input id="imp-inst" list="instruments" style={s.input} value={instrument} onChange={(e) => setInstrument(e.target.value.toUpperCase())} /></Field>
          <datalist id="instruments">{['VITEK2', 'PHOENIX', 'MICROSCAN', 'SPREADSHEET'].map((x) => <option key={x} value={x} />)}</datalist>
          <Field label="File" id="imp-file"><input id="imp-file" type="file" accept=".csv,.txt,.tsv,.astm,.dat" style={s.input} onChange={(e) => onFile(e.target.files?.[0])} /></Field>
        </div>
        {err && <div role="alert" style={{ ...s.err, marginTop: 10 }}>{err}</div>}
        {rows && (
          <div style={{ marginTop: 10 }}>
            <div style={s.sub}>{fileName}: {rows.length} isolate(s), {rows.reduce((n, r) => n + r.results.length, 0)} results. First: {rows[0].organism} ({rows[0].specimen_no || 'no specimen number'}).</div>
            <button type="button" style={{ ...s.btn, ...s.pri, marginTop: 8 }} disabled={busy} onClick={submit}>{busy ? 'Importing…' : 'Import'}</button>
          </div>
        )}
      </div>
      {result && (
        <div style={s.card}>
          <div role="status" style={s.ok}>Created {result.created}, updated {result.updated}{result.skipped ? `, skipped ${result.skipped} (organism not recognised)` : ''}.</div>
          {result.patients_not_found?.length > 0 && <div style={{ ...s.sub, color: C.danger }}>Patient numbers not found (isolates saved without a patient): {result.patients_not_found.join(', ')}</div>}
          {result.unmapped?.length > 0 && (
            <>
              <h3 style={{ ...s.h2, marginTop: 10 }}>Map these {instrument} codes</h3>
              <div style={s.grid(260)}>
                {result.unmapped.map((u) => {
                  const k = `${u.kind}|${u.code}`
                  const list = u.kind === 'organism' ? refs.organisms : refs.antibiotics
                  return (
                    <Field key={k} label={`${u.kind}: ${u.code}`} id={`map-${k}`}>
                      <select id={`map-${k}`} style={s.input} value={maps[k] || ''} onChange={(e) => setMaps((m) => ({ ...m, [k]: e.target.value }))}>
                        <option value="">— choose —</option>{list.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
                      </select>
                    </Field>
                  )
                })}
              </div>
              <button type="button" style={{ ...s.btn, ...s.pri, marginTop: 10 }} onClick={saveMaps}>Save mappings and import again</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- WHONET export
function WhonetTab({ hospitalId }) {
  const [from, setFrom] = useState(daysAgo(90))
  const [to, setTo] = useState(today())
  const [lab, setLab] = useState('LAB')
  const [identifiable, setIdentifiable] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const run = async () => {
    setErr(''); setMsg('')
    const { data, error } = await supabase.rpc('micro_whonet_rows', { p_hospital: hospitalId, p_from: from, p_to: to, p_identifiable: identifiable })
    if (error) { setErr(error.message); return }
    const rows = Array.isArray(data) ? data : []
    if (!rows.length) { setMsg('No coded isolates in this period.'); return }
    download(`whonet-${lab}-${from}-to-${to}.csv`, buildWhonetCsv(rows, lab))
    setMsg(`${rows.length} isolates exported. In WHONET, open BacLink, choose this CSV and map the columns once (they use WHONET names, e.g. CIP_EM, AMP_ED10).`)
  }
  return (
    <div style={s.card}>
      <h3 style={s.h2}>Export for WHONET / national AMR surveillance</h3>
      <div style={{ ...s.grid(170), alignItems: 'end' }}>
        <Field label="From" id="wh-from"><input id="wh-from" type="date" style={s.input} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To" id="wh-to"><input id="wh-to" type="date" style={s.input} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Laboratory code" id="wh-lab"><input id="wh-lab" style={s.input} value={lab} onChange={(e) => setLab(e.target.value.toUpperCase().slice(0, 3))} /></Field>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={identifiable} onChange={(e) => setIdentifiable(e.target.checked)} />Include patient numbers (internal use only)</label>
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={run}>Download WHONET file</button>
      </div>
      <div style={{ ...s.sub, marginTop: 8 }}>By default patients are replaced with a one-way code so the file can be shared for surveillance without names or numbers.</div>
      {err && <div role="alert" style={{ ...s.err, marginTop: 10 }}>{err}</div>}
      {msg && <div role="status" style={{ ...s.ok, marginTop: 10 }}>{msg}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- breakpoints
function Breakpoints({ hospitalId, refs }) {
  const [rows, setRows] = useState([])
  const [group, setGroup] = useState('ENT')
  const [form, setForm] = useState({ guideline: 'CLSI', version: '', organism_code: '', antibiotic: '', method: 'mic', s: '', r: '', indication: 'general' })
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data } = await supabase.from('micro_breakpoints').select('*').eq('bp_group', group).order('antibiotic')
    setRows(data || [])
  }, [group])
  useEffect(() => { void load() }, [load])
  const add = async () => {
    setErr('')
    const { error } = await supabase.from('micro_breakpoints').insert({ hospital_id: hospitalId, bp_group: group, guideline: form.guideline, version: form.version || 'local',
      organism_code: form.organism_code || null, antibiotic: form.antibiotic, method: form.method, s: Number(form.s), r: Number(form.r), indication: form.indication })
    if (error) { setErr(/unique|duplicate/i.test(error.message) ? 'A local breakpoint already exists for this combination.' : error.message); return }
    setForm((f) => ({ ...f, antibiotic: '', s: '', r: '' })); void load()
  }
  const toggle = async (b) => { const { error } = await supabase.from('micro_breakpoints').update({ active: !b.active }).eq('id', b.id); if (error) setErr(error.message); else void load() }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...s.card, overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'end', marginBottom: 10, flexWrap: 'wrap' }}>
          <Field label="Organism group" id="bp-g"><select id="bp-g" style={s.input} value={group} onChange={(e) => setGroup(e.target.value)}>{[['ENT', 'Enterobacterales'], ['PSE', 'Pseudomonas'], ['ACI', 'Acinetobacter'], ['STA', 'Staphylococcus'], ['ENC', 'Enterococcus'], ['SAG', 'Streptococcus A, B, C, G'], ['SPN', 'S. pneumoniae'], ['HIN', 'H. influenzae']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <div style={{ ...s.sub, flex: '1 1 300px' }}>Defaults: EUCAST Clinical Breakpoint Tables v16.1 (eucast.org), common agents. MIC S ≤ / R &gt; (mg/L); zone S ≥ / R &lt; (mm). Brackets = use with another active agent. A local row (e.g. CLSI) replaces the default.</div>
        </div>
        {err && <div role="alert" style={s.err}>{err}</div>}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['Antibiotic', 'Species', 'Method', 'S', 'R', 'Use', 'Source', 'Note', ''].map((h, i) => <th key={i} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((b) => (
            <tr key={b.id} style={{ opacity: b.active ? 1 : 0.5 }}>
              <td style={s.td}>{refs.antibiotics.find((a) => a.code === b.antibiotic)?.name || b.antibiotic}</td>
              <td style={s.td}>{b.organism_code ? refs.organisms.find((o) => o.code === b.organism_code)?.name || b.organism_code : 'group'}</td>
              <td style={s.td}>{b.method === 'disk' ? `disk ${b.potency || ''}` : 'MIC'}</td>
              <td style={s.td}>{b.bracketed ? `(${Number(b.s)})` : Number(b.s)}</td><td style={s.td}>{b.bracketed ? `(${Number(b.r)})` : Number(b.r)}</td>
              <td style={s.td}>{b.indication}</td><td style={s.td}>{b.guideline} {b.version}{b.hospital_id ? ' (local)' : ''}</td>
              <td style={{ ...s.td, color: C.sub }}>{b.note}</td>
              <td style={s.td}>{b.hospital_id && <button type="button" style={{ ...s.btn, ...s.ghost, padding: '2px 8px' }} onClick={() => toggle(b)}>{b.active ? 'Turn off' : 'Turn on'}</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={s.card}>
        <h3 style={s.h2}>Add a local breakpoint</h3>
        <div style={{ ...s.grid(120), alignItems: 'end' }}>
          <Field label="Guideline" id="lb-g"><input id="lb-g" style={s.input} value={form.guideline} onChange={(e) => setForm((f) => ({ ...f, guideline: e.target.value }))} /></Field>
          <Field label="Version" id="lb-v"><input id="lb-v" style={s.input} placeholder="M100 Ed36" value={form.version} onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))} /></Field>
          <Field label="Antibiotic" id="lb-a"><select id="lb-a" style={s.input} value={form.antibiotic} onChange={(e) => setForm((f) => ({ ...f, antibiotic: e.target.value }))}><option value="">—</option>{refs.antibiotics.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</select></Field>
          <Field label="Species (optional)" id="lb-o"><select id="lb-o" style={s.input} value={form.organism_code} onChange={(e) => setForm((f) => ({ ...f, organism_code: e.target.value }))}><option value="">Whole group</option>{refs.organisms.filter((o) => o.bp_group === group).map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}</select></Field>
          <Field label="Method" id="lb-m"><select id="lb-m" style={s.input} value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}><option value="mic">MIC</option><option value="disk">Disk</option></select></Field>
          <Field label={form.method === 'disk' ? 'S ≥ (mm)' : 'S ≤ (mg/L)'} id="lb-s"><input id="lb-s" type="number" step="any" style={s.input} value={form.s} onChange={(e) => setForm((f) => ({ ...f, s: e.target.value }))} /></Field>
          <Field label={form.method === 'disk' ? 'R < (mm)' : 'R > (mg/L)'} id="lb-r"><input id="lb-r" type="number" step="any" style={s.input} value={form.r} onChange={(e) => setForm((f) => ({ ...f, r: e.target.value }))} /></Field>
          <Field label="Use" id="lb-i"><select id="lb-i" style={s.input} value={form.indication} onChange={(e) => setForm((f) => ({ ...f, indication: e.target.value }))}><option value="general">General</option><option value="meningitis">Meningitis (CSF)</option><option value="uti">Urinary</option></select></Field>
          <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!form.antibiotic || form.s === '' || form.r === ''} onClick={add}>Add</button>
        </div>
      </div>
    </div>
  )
}

export default function Microbiology() {
  const { hospitalId } = useHospital()
  const [tab, setTab] = useState('isolates')
  const [refs, setRefs] = useState({ organisms: [], antibiotics: [], specimens: [] })
  useEffect(() => {
    void (async () => {
      const [o, a, sp] = await Promise.all([
        supabase.from('micro_organisms').select('*').order('name'),
        supabase.from('micro_antibiotics').select('*').order('name'),
        supabase.from('micro_specimen_types').select('*').order('label'),
      ])
      setRefs({ organisms: o.data || [], antibiotics: a.data || [], specimens: sp.data || [] })
    })()
  }, [])
  return (
    <section style={s.page}>
      <header style={{ marginBottom: 14 }}>
        <h1 style={s.h1}>Microbiology surveillance</h1>
        <p style={{ ...s.sub, margin: '5px 0 0' }}>Isolates, MIC / zone interpretation (EUCAST v16.1), resistance alerts, first-isolate antibiogram, instrument import and WHONET export. <a href="#/references?topic=microbiology" style={{ color: C.primary, fontWeight: 700 }}>Sources</a></p>
      </header>
      <nav role="tablist" style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 14, overflowX: 'auto' }}>
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} style={{ padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap', color: tab === k ? C.primary : C.sub, borderBottom: `2px solid ${tab === k ? C.primary : 'transparent'}` }}>{l}</button>)}
      </nav>
      {tab === 'isolates' && <Isolates hospitalId={hospitalId} refs={refs} />}
      {tab === 'antibiogram' && <Antibiogram hospitalId={hospitalId} refs={refs} />}
      {tab === 'alerts' && <Alerts hospitalId={hospitalId} />}
      {tab === 'import' && <ImportTab hospitalId={hospitalId} refs={refs} />}
      {tab === 'whonet' && <WhonetTab hospitalId={hospitalId} />}
      {tab === 'breakpoints' && <Breakpoints hospitalId={hospitalId} refs={refs} />}
    </section>
  )
}
