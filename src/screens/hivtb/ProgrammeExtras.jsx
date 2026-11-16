// HIV / TB programme screens: HTS register, ART clinic visits (TB screening + next appointment),
// defaulter tracing and the cascade / national indicators.
// Rules live in the database (20261219000000_hiv_programme.sql); the JS mirrors only preview them.
import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'
import PatientSearch from '../../components/PatientSearch'
import { localDateKey } from '../../utils/scheduling'
import { htsFinalResult, tbScreenResult } from '../../utils/hivTb'
import { C, Chip, s } from '../ncd/ui'

const today = () => localDateKey()
const addDays = (iso, n) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const ENTRY = { opd: 'OPD', ipd: 'Inpatient', emergency: 'Emergency', anc: 'ANC', maternity: 'Maternity', pnc: 'PNC', paediatric: 'Paediatric', vct: 'VCT', tb: 'TB clinic', sti: 'STI clinic', index: 'Index testing', other: 'Other' }
const RESULT = { positive: ['Positive', 'red'], negative: ['Negative', 'green'], inconclusive: ['Inconclusive — retest in 14 days', 'yellow'] }
const SCREEN = { presumptive: ['Presumptive TB — send sputum / GeneXpert', 'red'], no_signs: ['No TB signs', 'green'], on_tb_treatment: ['On TB treatment', 'blue'], not_screened: ['Not screened', 'gray'] }
const BAND = { missed: ['Missed 1–7 days', 'yellow'], defaulter: ['Defaulter 8–30 days', 'red'], iit: ['Interrupted > 30 days', 'red'], interrupted: ['No TB dose 14+ days', 'yellow'], ltfu: ['TB lost to follow-up', 'red'] }
const OUTCOMES = { reached_will_return: 'Reached — will return', returned: 'Returned to care', not_reached: 'Not reached', wrong_contact: 'Wrong contact', refused: 'Refused to return', transferred_out: 'Transferred out', died: 'Died' }
const METHODS = { phone: 'Phone call', sms: 'SMS', home_visit: 'Home visit', treatment_supporter: 'Treatment supporter', other: 'Other' }
const errText = (e) => (e?.message || String(e))

function Field({ label, id, children }) {
  return <div><label style={s.label} htmlFor={id}>{label}</label>{children}</div>
}

// ---------------------------------------------------------------- HTS register
export function HtsRegister({ hospitalId }) {
  const [rows, setRows] = useState([])
  const [from, setFrom] = useState(addDays(today(), -30))
  const [form, setForm] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('hts_tests').select('*, patients(full_name, patient_number)').eq('hospital_id', hospitalId).gte('tested_on', from).order('tested_on', { ascending: false })
    if (error) setErr(/does not exist|schema cache/i.test(error.message) ? 'Run docs/sql/37_hiv_programme.sql to switch on the HTS register.' : error.message)
    setRows(data || [])
  }, [hospitalId, from])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])
  const preview = form ? htsFinalResult(form.test1, form.test1 === 'reactive' ? form.test2 || null : null) : null
  const save = async () => {
    setErr('')
    if (!form.patient) { setErr('Pick the client'); return }
    const { error } = await supabase.from('hts_tests').insert({
      hospital_id: hospitalId, patient_id: form.patient.id, tested_on: form.on, entry_point: form.entry, test_kind: form.kind, consent: form.consent,
      test1_result: form.test1, test2_result: form.test1 === 'reactive' ? form.test2 || null : null, counsellor: form.counsellor || null, notes: form.notes || null,
    })
    if (error) { setErr(/duplicate|unique/i.test(error.message) ? 'This client already has a test recorded that day.' : error.message); return }
    setForm(null); void load()
  }
  const tested = rows.length, pos = rows.filter((r) => r.final_result === 'positive')
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 10 }}>
        <Field label="Tested since" id="hts-from"><input id="hts-from" type="date" style={{ ...s.input, width: 170 }} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <div style={s.sub}>{tested} tested · {pos.length} positive{tested ? ` (${Math.round((pos.length / tested) * 100)}% yield)` : ''} · {pos.filter((r) => r.linked_art_id).length} of {pos.length} linked</div>
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => setForm({ patient: null, on: today(), entry: 'opd', kind: 'initial', consent: false, test1: 'non_reactive', test2: '', counsellor: '', notes: '' })}>Record HIV test</button>
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Date', 'Client', 'Entry point', 'Kits', 'Result', 'Linkage'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => {
            const [label, tone] = RESULT[r.final_result] || [r.final_result, 'gray']
            return (
              <tr key={r.id}>
                <td style={s.td}>{r.tested_on}{r.test_kind === 'retest' ? <div style={s.sub}>retest</div> : null}</td>
                <td style={s.td}><strong>{r.patients?.full_name || '—'}</strong><div style={s.sub}>{r.patients?.patient_number}</div></td>
                <td style={s.td}>{ENTRY[r.entry_point] || r.entry_point}</td>
                <td style={s.td}>{r.test1_kit}: {r.test1_result.replace('_', '-')}{r.test2_result ? <div style={s.sub}>{r.test2_kit}: {r.test2_result.replace('_', '-')}</div> : null}</td>
                <td style={s.td}><Chip tone={tone}>{label}</Chip></td>
                <td style={s.td}>{r.final_result !== 'positive' ? '—' : r.linked_art_id ? <Chip tone="green">Linked {r.linked_on}</Chip> : <Chip tone="red">Not linked — enrol on ART</Chip>}</td>
              </tr>
            )
          })}</tbody>
        </table>
        {rows.length === 0 && <div style={{ ...s.sub, padding: 16, textAlign: 'center' }}>No tests in this period.</div>}
      </div>

      {form && (
        <div style={{ ...s.overlay, justifyContent: 'center', alignItems: 'center', padding: 16 }} role="dialog" aria-modal="true" aria-label="Record HIV test">
          <div style={{ ...s.card, width: 600, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto' }}>
            <h2 style={s.h2}>Record HIV test</h2>
            <Field label="Client" id="hts-p"><PatientSearch id="hts-p" hospitalId={hospitalId} inputStyle={s.input} value={form.patient} onPick={(p) => setForm((x) => ({ ...x, patient: p }))} /></Field>
            <div style={{ ...s.grid(150), marginTop: 10 }}>
              <Field label="Date" id="hts-on"><input id="hts-on" type="date" max={today()} style={s.input} value={form.on} onChange={(e) => setForm((x) => ({ ...x, on: e.target.value }))} /></Field>
              <Field label="Entry point" id="hts-entry"><select id="hts-entry" style={s.input} value={form.entry} onChange={(e) => setForm((x) => ({ ...x, entry: e.target.value }))}>{Object.entries(ENTRY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Test" id="hts-kind"><select id="hts-kind" style={s.input} value={form.kind} onChange={(e) => setForm((x) => ({ ...x, kind: e.target.value }))}><option value="initial">Initial test</option><option value="retest">Retest</option></select></Field>
              <Field label="Determine (screening)" id="hts-t1"><select id="hts-t1" style={s.input} value={form.test1} onChange={(e) => setForm((x) => ({ ...x, test1: e.target.value }))}><option value="non_reactive">Non-reactive</option><option value="reactive">Reactive</option><option value="invalid">Invalid</option></select></Field>
              {form.test1 === 'reactive' && (
                <Field label="First Response (confirmatory)" id="hts-t2"><select id="hts-t2" style={s.input} value={form.test2} onChange={(e) => setForm((x) => ({ ...x, test2: e.target.value }))}><option value="">— do the test —</option><option value="reactive">Reactive</option><option value="non_reactive">Non-reactive</option><option value="invalid">Invalid</option></select></Field>
              )}
              <Field label="Counsellor" id="hts-c"><input id="hts-c" style={s.input} value={form.counsellor} onChange={(e) => setForm((x) => ({ ...x, counsellor: e.target.value }))} /></Field>
            </div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 10 }}><input type="checkbox" checked={form.consent} onChange={(e) => setForm((x) => ({ ...x, consent: e.target.checked }))} />Client counselled and consented to testing</label>
            <div style={{ marginTop: 10 }} aria-live="polite">
              {form.test1 === 'invalid' || form.test2 === 'invalid' ? <Chip tone="yellow">Invalid kit — repeat the test with a new kit</Chip>
                : preview ? <Chip tone={RESULT[preview][1]}>Result: {RESULT[preview][0]}</Chip>
                  : <Chip tone="yellow">Screening reactive — do the confirmatory test</Chip>}
              {preview === 'positive' && <div style={{ ...s.sub, marginTop: 6 }}>Link the client to care: enrol on ART (same-day start where ready). The test links automatically.</div>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setForm(null)}>Cancel</button>
              <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!preview || !form.consent} onClick={save}>Save test</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- ART clinic visits (inside the ART drawer)
const YN = ({ id, label, value, onChange }) => (
  <Field label={label} id={id}>
    <select id={id} style={s.input} value={value === true ? 'yes' : value === false ? 'no' : ''} onChange={(e) => onChange(e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null)}>
      <option value="">—</option><option value="no">No</option><option value="yes">Yes</option>
    </select>
  </Field>
)

export function ArtVisits({ art, onChanged }) {
  const [visits, setVisits] = useState([])
  const [traces, setTraces] = useState([])
  const blank = () => ({ visit_date: today(), weight_kg: '', cough: null, fever: null, weightLoss: null, nightSweats: null, adherence: 'good', months: '1', next: addDays(today(), 30) })
  const [v, setV] = useState(blank)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from('hiv_visits').select('*').eq('art_id', art.id).order('visit_date', { ascending: false }).limit(24),
      supabase.from('programme_tracing').select('*').eq('art_id', art.id).order('traced_on', { ascending: false }).limit(12),
    ])
    setVisits(a.data || []); setTraces(b.data || [])
  }, [art.id])
  useEffect(() => { void load() }, [load])
  const screen = tbScreenResult({ cough: v.cough, fever: v.fever, weightLoss: v.weightLoss, nightSweats: v.nightSweats })
  const setMonths = (m) => setV((x) => ({ ...x, months: m, next: addDays(x.visit_date, Number(m) * 30) }))
  const save = async () => {
    setErr('')
    const { error } = await supabase.from('hiv_visits').insert({
      hospital_id: art.hospital_id, art_id: art.id, visit_date: v.visit_date, weight_kg: v.weight_kg ? Number(v.weight_kg) : null,
      tb_cough: v.cough, tb_fever: v.fever, tb_weight_loss: v.weightLoss, tb_night_sweats: v.nightSweats,
      adherence: v.adherence || null, months_dispensed: Number(v.months), next_appointment: v.next,
    })
    if (error) { setErr(/duplicate|unique/i.test(error.message) ? 'A visit is already recorded for that day.' : errText(error)); return }
    setV(blank()); await load(); onChanged?.()
  }
  return (
    <div style={{ ...s.card, marginTop: 12 }}>
      <h3 style={s.h2}>Clinic visits and TB screening</h3>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {art.next_appointment && <Chip tone={art.next_appointment < today() ? 'red' : 'blue'}>Next appointment {art.next_appointment}</Chip>}
        {art.last_visit_date && <Chip>Last seen {art.last_visit_date}</Chip>}
      </div>
      {visits.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 10 }}>
          <tbody>{visits.map((x) => {
            const [label, tone] = SCREEN[x.tb_screen] || SCREEN.not_screened
            return <tr key={x.id}><td style={s.td}>{x.visit_date}</td><td style={s.td}>{x.weight_kg ? `${x.weight_kg} kg` : ''}</td><td style={s.td}><Chip tone={tone}>{label}</Chip></td><td style={s.td}>{x.months_dispensed ? `${x.months_dispensed} mo ARVs` : ''}</td><td style={s.td}>next {x.next_appointment}</td></tr>
          })}</tbody>
        </table>
      )}
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ ...s.grid(120), alignItems: 'end' }}>
        <Field label="Visit date" id="av-date"><input id="av-date" type="date" max={today()} style={s.input} value={v.visit_date} onChange={(e) => setV((x) => ({ ...x, visit_date: e.target.value }))} /></Field>
        <Field label="Weight (kg)" id="av-wt"><input id="av-wt" type="number" min={1} style={s.input} value={v.weight_kg} onChange={(e) => setV((x) => ({ ...x, weight_kg: e.target.value }))} /></Field>
        <YN id="av-cough" label="Cough" value={v.cough} onChange={(b) => setV((x) => ({ ...x, cough: b }))} />
        <YN id="av-fever" label="Fever" value={v.fever} onChange={(b) => setV((x) => ({ ...x, fever: b }))} />
        <YN id="av-wl" label="Weight loss" value={v.weightLoss} onChange={(b) => setV((x) => ({ ...x, weightLoss: b }))} />
        <YN id="av-ns" label="Night sweats" value={v.nightSweats} onChange={(b) => setV((x) => ({ ...x, nightSweats: b }))} />
        <Field label="Adherence" id="av-adh"><select id="av-adh" style={s.input} value={v.adherence} onChange={(e) => setV((x) => ({ ...x, adherence: e.target.value }))}><option value="good">Good (≥ 95%)</option><option value="fair">Fair (85–94%)</option><option value="poor">Poor (&lt; 85%)</option></select></Field>
        <Field label="ARVs given (months)" id="av-mmd"><select id="av-mmd" style={s.input} value={v.months} onChange={(e) => setMonths(e.target.value)}>{[1, 2, 3, 6].map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
        <Field label="Next appointment" id="av-next"><input id="av-next" type="date" min={addDays(v.visit_date, 1)} style={s.input} value={v.next} onChange={(e) => setV((x) => ({ ...x, next: e.target.value }))} /></Field>
        <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!screen} onClick={save}>Save visit</button>
      </div>
      <div style={{ marginTop: 8 }}>{screen ? <Chip tone={SCREEN[screen][1]}>{SCREEN[screen][0]}</Chip> : <Chip tone="yellow">Answer all four TB questions</Chip>}</div>
      {traces.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={s.label}>Tracing</div>
          {traces.map((t) => <div key={t.id} style={{ fontSize: 12, color: C.sub }}>{t.traced_on} · {METHODS[t.method]} · <strong>{OUTCOMES[t.outcome]}</strong>{t.promised_date ? ` (promised ${t.promised_date})` : ''}{t.notes ? ` — ${t.notes}` : ''}</div>)}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- defaulter tracing
export function DefaulterTracing({ hospitalId, onChanged }) {
  const [rows, setRows] = useState([])
  const [band, setBand] = useState('')
  const [trace, setTrace] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('programme_defaulters', { p_hospital: hospitalId })
    if (error) setErr(/does not exist|schema cache/i.test(error.message) ? 'Run docs/sql/37_hiv_programme.sql to switch on defaulter tracing.' : error.message)
    setRows(Array.isArray(data) ? data : [])
  }, [hospitalId])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])
  const save = async () => {
    setErr('')
    const r = trace.row
    const { error } = await supabase.from('programme_tracing').insert({
      hospital_id: hospitalId, programme: r.programme, art_id: r.programme === 'hiv' ? r.record_id : null, tb_episode_id: r.programme === 'tb' ? r.record_id : null,
      traced_on: trace.on, method: trace.method, outcome: trace.outcome, promised_date: trace.promised || null, notes: trace.notes || null,
    })
    if (error) { setErr(errText(error)); return }
    setTrace(null); await load(); onChanged?.()
  }
  const shown = rows.filter((r) => !band || r.band === band)
  const count = (b) => rows.filter((r) => r.band === b).length
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button type="button" style={{ ...s.btn, ...(band ? s.ghost : s.soft) }} onClick={() => setBand('')}>All ({rows.length})</button>
        {Object.entries(BAND).map(([k, [l]]) => <button key={k} type="button" style={{ ...s.btn, ...(band === k ? s.soft : s.ghost) }} onClick={() => setBand(k)}>{l} ({count(k)})</button>)}
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Client', 'Programme', 'Due / last dose', 'Days', 'Status', 'Last tracing', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{shown.map((r) => {
            const [label, tone] = BAND[r.band] || [r.band, 'gray']
            return (
              <tr key={`${r.programme}-${r.record_id}`}>
                <td style={s.td}><strong>{r.full_name || '—'}</strong><div style={s.sub}>{[r.number, r.phone].filter(Boolean).join(' · ')}</div></td>
                <td style={s.td}>{r.programme.toUpperCase()}</td>
                <td style={s.td}>{r.due_date}</td>
                <td style={{ ...s.td, fontWeight: 700 }}>{r.days}</td>
                <td style={s.td}><Chip tone={tone}>{label}</Chip></td>
                <td style={s.td}>{r.last_trace ? <>{r.last_trace.on}: {OUTCOMES[r.last_trace.outcome]}{r.last_trace.promised_date ? <div style={s.sub}>promised {r.last_trace.promised_date}</div> : null}<div style={s.sub}>{r.attempts} attempt{r.attempts === 1 ? '' : 's'} since due</div></> : <span style={s.sub}>not traced</span>}</td>
                <td style={s.td}><button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => setTrace({ row: r, on: today(), method: 'phone', outcome: 'not_reached', promised: '', notes: '' })}>Record tracing</button></td>
              </tr>
            )
          })}</tbody>
        </table>
        {shown.length === 0 && <div style={{ ...s.sub, padding: 16, textAlign: 'center' }}>Nobody to trace. Every client is within their appointment.</div>}
      </div>
      {trace && (
        <div style={{ ...s.overlay, justifyContent: 'center', alignItems: 'center', padding: 16 }} role="dialog" aria-modal="true" aria-label="Record tracing">
          <div style={{ ...s.card, width: 520, maxWidth: '96vw' }}>
            <h2 style={s.h2}>Tracing — {trace.row.full_name}</h2>
            <div style={s.grid(150)}>
              <Field label="Date" id="tr-on"><input id="tr-on" type="date" max={today()} style={s.input} value={trace.on} onChange={(e) => setTrace((x) => ({ ...x, on: e.target.value }))} /></Field>
              <Field label="Method" id="tr-m"><select id="tr-m" style={s.input} value={trace.method} onChange={(e) => setTrace((x) => ({ ...x, method: e.target.value }))}>{Object.entries(METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Outcome" id="tr-o"><select id="tr-o" style={s.input} value={trace.outcome} onChange={(e) => setTrace((x) => ({ ...x, outcome: e.target.value }))}>{Object.entries(OUTCOMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              {trace.outcome === 'reached_will_return' && <Field label="Promised date" id="tr-p"><input id="tr-p" type="date" min={trace.on} style={s.input} value={trace.promised} onChange={(e) => setTrace((x) => ({ ...x, promised: e.target.value }))} /></Field>}
            </div>
            <div style={{ marginTop: 10 }}><Field label="Notes" id="tr-n"><input id="tr-n" style={s.input} value={trace.notes} onChange={(e) => setTrace((x) => ({ ...x, notes: e.target.value }))} /></Field></div>
            {['died', 'transferred_out'].includes(trace.outcome) && <div style={{ ...s.sub, marginTop: 8, color: C.danger }}>This closes the {trace.row.programme === 'hiv' ? 'ART record' : 'TB episode'} as {OUTCOMES[trace.outcome].toLowerCase()}.</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setTrace(null)}>Cancel</button>
              <button type="button" style={{ ...s.btn, ...s.pri }} disabled={trace.outcome === 'reached_will_return' && !trace.promised} onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- cascade and indicators
export function ProgrammeIndicators({ hospitalId }) {
  const first = `${today().slice(0, 8)}01`
  const [from, setFrom] = useState(first)
  const [to, setTo] = useState(today())
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    setErr('')
    const { data: d, error } = await supabase.rpc('hiv_programme_indicators', { p_hospital: hospitalId, p_from: from, p_to: to })
    if (error) { setErr(/does not exist|schema cache/i.test(error.message) ? 'Run docs/sql/37_hiv_programme.sql to switch on programme indicators.' : error.message); setData(null); return }
    setData(d)
  }, [hospitalId, from, to])
  useEffect(() => { if (hospitalId && from && to && from <= to) void load() }, [hospitalId, from, to, load])
  const exportCsv = () => {
    const q = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`
    const lines = [['Group', 'Indicator', 'Numerator', 'Denominator', 'Percent'].map(q).join(','), ...(data?.indicators || []).map((r) => [r.group, r.label, r.numerator, r.denominator, r.percent].map(q).join(','))]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `hiv-tb-indicators-${from}-to-${to}.csv`; a.click(); URL.revokeObjectURL(url)
  }
  const cascade = data?.cascade || []
  const top = Math.max(1, ...cascade.map((c) => Number(c.value) || 0))
  const groups = [...new Set((data?.indicators || []).map((r) => r.group))]
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...s.card, display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <Field label="From" id="pi-from"><input id="pi-from" type="date" style={s.input} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To" id="pi-to"><input id="pi-to" type="date" style={s.input} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <button type="button" style={{ ...s.btn, ...s.ghost }} disabled={!data} onClick={exportCsv}>Download CSV</button>
        <div style={{ ...s.sub, flex: '1 1 260px' }}>MOH 731 / PEPFAR MER definitions. TX_CURR leaves out clients more than 30 days past their appointment.</div>
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {data && (
        <>
          <div style={s.card}>
            <h3 style={s.h2}>HIV cascade</h3>
            <div style={{ display: 'grid', gap: 6 }}>
              {cascade.map((c, i) => {
                const prev = i > 0 && i !== 4 ? Number(cascade[i - 1].value) : null
                return (
                  <div key={c.step} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 90px', gap: 8, alignItems: 'center', fontSize: 12 }}>
                    <span style={{ fontWeight: 700 }}>{c.step}</span>
                    <div style={{ background: '#F2F4F7', borderRadius: 6, height: 18 }}><div style={{ width: `${(Number(c.value) / top) * 100}%`, background: i < 4 ? C.primary : C.success, height: 18, borderRadius: 6 }} /></div>
                    <span>{c.value ?? 0}{prev ? <span style={s.sub}> · {Math.round((Number(c.value) / prev) * 100)}%</span> : null}</span>
                  </div>
                )
              })}
            </div>
          </div>
          {groups.map((g) => (
            <div key={g} style={{ ...s.card, overflowX: 'auto' }}>
              <h3 style={s.h2}>{g}</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Indicator', 'Number', 'Of', '%'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                <tbody>{data.indicators.filter((r) => r.group === g).map((r) => (
                  <tr key={r.key}><td style={s.td}>{r.label}</td><td style={{ ...s.td, fontWeight: 700 }}>{r.numerator}</td><td style={s.td}>{r.denominator ?? ''}</td><td style={s.td}>{r.percent != null ? `${r.percent}%` : ''}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ))}
          {data.by_entry_point?.length > 0 && (
            <div style={s.card}>
              <h3 style={s.h2}>Testing by entry point</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Entry point', 'Tested', 'Positive', 'Yield'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                <tbody>{data.by_entry_point.map((e) => <tr key={e.entry_point}><td style={s.td}>{ENTRY[e.entry_point] || e.entry_point}</td><td style={s.td}>{e.tested}</td><td style={s.td}>{e.positive}</td><td style={s.td}>{e.yield ?? 0}%</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

