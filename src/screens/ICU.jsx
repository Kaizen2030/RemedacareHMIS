// ICU / HDU: unit board, admission, and a critical-care chart per patient — hourly vitals, ventilator (mL/kg predicted
// body weight, plateau and driving pressure), infusions (pump rate calculated; high-alert drugs double-checked), sedation
// and pain (RASS, CPOT, CAM-ICU), daily SOFA, the daily goals checklist, family communication and discharge.
// The database recomputes and checks every entry. Data: 20261206000000_icu.sql.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import PatientSearch from '../components/PatientSearch'
import usePatientAccessLog from '../hooks/useAccessLog'
import { openPromptDialog } from '../confirmDialog'
import { C, Chip, s } from './ncd/ui'
import { CPOT, DAILY_GOALS, DOSE_UNITS, RASS, SOFA_FIELDS, activeInfusions, daysIn, infusionRate, isHighAlert, sofa, ventCheck } from '../utils/icuScores'

const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Not installed yet. Run docs/sql/24_icu.sql in Supabase.'
  if (/row-level|permission/i.test(m)) return 'Only clinical staff can use the ICU screen.'
  if (/icu_admissions_one_open|duplicate key/i.test(m)) return 'This patient is already admitted to the unit.'
  return m
}
const hm = (v) => (v ? new Date(v).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const todayKey = () => new Date().toLocaleDateString('en-CA')
const dayKey = (v) => new Date(v).toLocaleDateString('en-CA')
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined))
const OUTCOMES = [['ward', 'Transferred to a ward'], ['step_down', 'Stepped down to HDU'], ['transfer', 'Transferred to another facility'], ['died', 'Died'], ['discharged_against_advice', 'Left against medical advice']]

export default function ICU() {
  const { hospitalId } = useHospital()
  const [tab, setTab] = useState('board')
  const [adms, setAdms] = useState([])
  const [entries, setEntries] = useState([])
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!hospitalId) return
    const a = await supabase.from('icu_admissions').select('*, patients(full_name, patient_number, age, gender, allergies)')
      .eq('hospital_id', hospitalId).is('discharged_at', null).order('admitted_at')
    if (a.error) { setErr(friendly(a.error)); return }
    setErr(''); setAdms(a.data || [])
    const ids = (a.data || []).map((x) => x.id)
    if (!ids.length) { setEntries([]); return }
    const e = await supabase.from('icu_entries').select('*').in('admission_id', ids).gte('recorded_at', new Date(Date.now() - 36 * 3600000).toISOString()).order('recorded_at', { ascending: false })
    setEntries(e.data || [])
  }, [hospitalId])
  useEffect(() => { void load(); const t = setInterval(() => { void load() }, 60000); return () => clearInterval(t) }, [load])

  const current = adms.find((a) => a.id === open)
  return (
    <div style={s.page}>
      <div style={{ marginBottom: 12 }}>
        <h1 style={s.h1}>ICU / HDU</h1>
        <div style={s.sub}>Critical-care chart: the system calculates SOFA, mL/kg, pump rates and flags unsafe settings.</div>
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div role="tablist" aria-label="ICU sections" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['board', `Unit board (${adms.length})`], ['admit', '+ Admit'], ['stats', 'Statistics']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...s.btn, ...(tab === k ? s.pri : s.ghost) }}>{l}</button>
        ))}
      </div>
      {tab === 'board' && <Board adms={adms} entries={entries} onOpen={setOpen} />}
      {tab === 'admit' && <Admit hospitalId={hospitalId} onDone={() => { setTab('board'); void load() }} />}
      {tab === 'stats' && <Stats hospitalId={hospitalId} />}
      {current && <AdmissionDrawer adm={current} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}

function Board({ adms, entries, onOpen }) {
  if (!adms.length) return <div style={{ ...s.card, ...s.sub }}>No patients in the unit.</div>
  return (
    <div style={s.grid(300)}>
      {adms.map((a) => {
        const mine = entries.filter((e) => e.admission_id === a.id && !e.struck_out_at)
        const latest = (k) => mine.find((e) => e.kind === k)
        const vent = latest('ventilator'), sf = latest('sofa'), vit = latest('vitals'), sed = latest('sedation')
        const infs = activeInfusions(mine)
        const flags = [...new Set(mine.filter((e) => Date.now() - new Date(e.recorded_at) < 12 * 3600000).flatMap((e) => e.flags || []))]
        const goalsToday = mine.some((e) => e.kind === 'goals' && dayKey(e.recorded_at) === todayKey())
        const vitalsLate = !vit || Date.now() - new Date(vit.recorded_at) > 2 * 3600000
        return (
          <button key={a.id} type="button" onClick={() => onOpen(a.id)} style={{ ...s.card, textAlign: 'left', cursor: 'pointer', borderLeft: `5px solid ${flags.length ? C.danger : C.success}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <b>{a.unit}{a.bed_label ? ` · ${a.bed_label}` : ''} — {a.patients?.full_name || 'Patient'}</b>
              <span style={s.sub}>Day {daysIn(a.admitted_at)}</span>
            </div>
            <div style={s.sub}>{a.diagnosis}{a.patients?.age ? ` · ${a.patients.age} y` : ''}</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '6px 0' }}>
              {a.code_status !== 'full' && <Chip tone="red">{a.code_status === 'dnar' ? 'DNAR' : 'Limited treatment'}</Chip>}
              {a.readmission_48h && <Chip tone="yellow">Readmitted &lt; 48 h</Chip>}
              {vent && <Chip tone="blue">{vent.data?.mode}{vent.calc?.vt_ml_kg ? ` · ${vent.calc.vt_ml_kg} mL/kg` : ''}</Chip>}
              {sf && <Chip tone={sf.calc?.total >= 11 ? 'red' : sf.calc?.total >= 6 ? 'yellow' : 'gray'}>SOFA {sf.calc?.total}</Chip>}
              {vit?.calc?.map && <Chip tone={vit.calc.map < 65 ? 'red' : 'gray'}>MAP {vit.calc.map}</Chip>}
              {sed?.data?.rass !== undefined && <Chip>RASS {sed.data.rass}</Chip>}
              {infs.map((i) => <Chip key={i.id} tone={i.calc?.high_alert ? 'yellow' : 'gray'}>{i.data.drug} {i.calc?.rate_ml_h} mL/h</Chip>)}
            </div>
            {flags.slice(0, 4).map((f) => <div key={f} style={{ color: C.danger, fontSize: 12 }}>⚠ {f}</div>)}
            <div style={{ display: 'flex', gap: 10, fontSize: 11, marginTop: 4 }}>
              <span style={{ color: vitalsLate ? C.danger : C.sub }}>{vitalsLate ? 'Vitals overdue' : `Vitals ${hm(vit.recorded_at)}`}</span>
              <span style={{ color: goalsToday ? C.success : C.warn }}>{goalsToday ? 'Daily goals done' : 'Daily goals not done today'}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function Admit({ hospitalId, onDone }) {
  const [patient, setPatient] = useState(null)
  const [f, setF] = useState({ unit: 'ICU', bed_label: '', source: 'emergency', diagnosis: '', reason: '', code_status: 'full', isolation: '', weight_kg: '', height_cm: '', sex: '', consultant: '' })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  useEffect(() => { if (patient?.gender) setF((x) => ({ ...x, sex: /^f/i.test(patient.gender) ? 'female' : /^m/i.test(patient.gender) ? 'male' : x.sex })) }, [patient])
  async function save(e) {
    e.preventDefault(); setErr('')
    if (!patient) { setErr('Pick the patient.'); return }
    if (!f.diagnosis.trim()) { setErr('Give the admitting diagnosis.'); return }
    const { error } = await supabase.from('icu_admissions').insert(clean({ ...f, hospital_id: hospitalId, patient_id: patient.id, visit_id: patient.current_visit_id || null, diagnosis: f.diagnosis.trim() }))
    if (error) setErr(friendly(error)); else onDone()
  }
  const sel = (k, l, opts) => <div><label style={s.label} htmlFor={`ad-${k}`}>{l}</label><select id={`ad-${k}`} style={s.input} value={f[k]} onChange={set(k)}>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
  const inp = (k, l, type = 'text') => <div><label style={s.label} htmlFor={`ad-${k}`}>{l}</label><input id={`ad-${k}`} type={type} style={s.input} value={f[k]} onChange={set(k)} /></div>
  return (
    <form onSubmit={save} style={s.card}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={s.grid(200)}>
        <div><label style={s.label} htmlFor="ad-patient">Patient</label><PatientSearch id="ad-patient" hospitalId={hospitalId} inputStyle={s.input} value={patient} onPick={setPatient} /></div>
        {sel('unit', 'Unit', [['ICU', 'ICU'], ['HDU', 'HDU'], ['NICU', 'NICU'], ['PICU', 'PICU'], ['CCU', 'CCU']])}
        {inp('bed_label', 'Bed')}
        {sel('source', 'Admitted from', [['emergency', 'Emergency'], ['theatre', 'Theatre'], ['ward', 'Ward'], ['maternity', 'Maternity'], ['other_facility', 'Another facility'], ['other', 'Other']])}
        {inp('diagnosis', 'Diagnosis *')}
        {inp('reason', 'Reason for ICU (organ support needed)')}
        {sel('code_status', 'Resuscitation status', [['full', 'Full resuscitation'], ['limited', 'Limited treatment'], ['dnar', 'DNAR']])}
        {inp('isolation', 'Isolation (e.g. contact, airborne)')}
        {inp('weight_kg', 'Weight kg', 'number')}
        {inp('height_cm', 'Height cm (for ventilator mL/kg)', 'number')}
        {sel('sex', 'Sex', [['', '—'], ['male', 'Male'], ['female', 'Female']])}
        {inp('consultant', 'Consultant')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button type="submit" style={{ ...s.btn, ...s.pri }}>Admit to unit</button></div>
    </form>
  )
}

const TABS = [['vitals', 'Vitals'], ['ventilator', 'Ventilator'], ['infusion', 'Infusions'], ['sedation', 'Sedation & pain'], ['sofa', 'SOFA'], ['goals', 'Daily goals'], ['family', 'Family'], ['discharge', 'Discharge']]

function AdmissionDrawer({ adm, onClose, onChanged }) {
  const allowed = usePatientAccessLog(adm.hospital_id, adm.patient_id, 'icu')
  const [tab, setTab] = useState('vitals')
  const [entries, setEntries] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('icu_entries').select('*').eq('admission_id', adm.id).order('recorded_at', { ascending: false }).limit(500)
    if (error) setErr(friendly(error)); else setEntries(data || [])
  }, [adm.id])
  useEffect(() => { void load() }, [load])

  async function add(kind, data, ok = 'Saved.') {
    setErr(''); setMsg('')
    const { error } = await supabase.from('icu_entries').insert({ admission_id: adm.id, hospital_id: adm.hospital_id, patient_id: adm.patient_id, kind, data: clean(data) })
    if (error) { setErr(friendly(error)); return false }
    setMsg(ok); void load(); onChanged(); return true
  }
  async function strike(e) {
    const reason = await openPromptDialog('Why is this entry wrong? It stays on the chart, crossed out.', { title: 'Strike out entry', placeholder: 'e.g. Recorded on the wrong patient', confirmLabel: 'Strike out', tone: 'danger' })
    if (!reason?.trim()) return
    const { error } = await supabase.from('icu_entries').update({ struck_out_at: new Date().toISOString(), struck_out_reason: reason.trim() }).eq('id', e.id)
    if (error) setErr(friendly(error)); else void load()
  }

  if (!allowed) return <div style={s.overlay} onClick={onClose}><div style={s.drawer} onClick={(e) => e.stopPropagation()}><div role="alert" style={s.err}>This record is confidential. Open it again and give a reason to continue.</div></div></div>
  const of = (k) => entries.filter((e) => e.kind === k)
  const props = { adm, add, list: of(tab), strike, all: entries }
  return (
    <div style={s.overlay} onClick={onClose}>
      <div role="dialog" aria-label="ICU chart" style={{ ...s.drawer, width: 860 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <h2 style={{ ...s.h2, margin: 0 }}>{adm.patients?.full_name} — {adm.unit}{adm.bed_label ? ` ${adm.bed_label}` : ''}</h2>
            <div style={s.sub}>Day {daysIn(adm.admitted_at)} · {adm.diagnosis}{adm.weight_kg ? ` · ${adm.weight_kg} kg` : ''}{adm.patients?.allergies ? ` · Allergies: ${adm.patients.allergies}` : ''}</div>
          </div>
          <button type="button" onClick={onClose} style={{ ...s.btn, ...s.ghost }}>Close</button>
        </div>
        <div role="tablist" aria-label="Chart sections" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '12px 0' }}>
          {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setErr(''); setMsg('') }} style={{ ...s.btn, ...(tab === k ? s.pri : s.ghost) }}>{l}</button>)}
        </div>
        {err && <div role="alert" style={s.err}>{err}</div>}
        {msg && <div style={s.ok}>{msg}</div>}
        {tab === 'vitals' && <Vitals {...props} />}
        {tab === 'ventilator' && <Ventilator {...props} />}
        {tab === 'infusion' && <Infusions {...props} />}
        {tab === 'sedation' && <Sedation {...props} />}
        {tab === 'sofa' && <Sofa {...props} />}
        {tab === 'goals' && <Goals {...props} />}
        {tab === 'family' && <Family {...props} />}
        {tab === 'discharge' && <Discharge adm={adm} onDone={() => { onChanged(); onClose() }} setErr={setErr} />}
      </div>
    </div>
  )
}

function Num({ k, l, f, setF, step = 'any' }) {
  return <div><label style={s.label} htmlFor={`icu-${k}`}>{l}</label><input id={`icu-${k}`} type="number" step={step} style={s.input} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
}
function Flags({ flags }) {
  if (!flags?.length) return null
  return <div>{flags.map((x) => <div key={x} style={{ color: C.danger, fontSize: 12, fontWeight: 700 }}>⚠ {x}</div>)}</div>
}
function History({ list, strike, render }) {
  if (!list.length) return <div style={{ ...s.sub, marginTop: 10 }}>Nothing charted yet.</div>
  return (
    <div style={{ marginTop: 12 }}>
      {list.map((e) => (
        <div key={e.id} style={{ borderTop: `1px solid ${C.border}`, padding: '7px 0', opacity: e.struck_out_at ? 0.5 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ textDecoration: e.struck_out_at ? 'line-through' : 'none' }}><b>{hm(e.recorded_at)}</b> {render(e)}</span>
            {!e.struck_out_at && <button type="button" onClick={() => strike(e)} style={{ ...s.btn, ...s.ghost, padding: '2px 8px', fontSize: 11 }}>Entered in error</button>}
          </div>
          {e.struck_out_at ? <div style={s.sub}>Struck out: {e.struck_out_reason}</div> : <Flags flags={e.flags} />}
        </div>
      ))}
    </div>
  )
}

function Vitals({ add, list, strike }) {
  const blank = { hr: '', sbp: '', dbp: '', spo2: '', rr: '', temp: '', cvp: '', gcs: '', glucose: '', urine_ml: '', hours: '1' }
  const [f, setF] = useState(blank)
  const fields = [['hr', 'HR /min'], ['sbp', 'Systolic'], ['dbp', 'Diastolic'], ['spo2', 'SpO₂ %'], ['rr', 'RR /min'], ['temp', 'Temp °C'], ['cvp', 'CVP cmH₂O'], ['gcs', 'GCS'], ['glucose', 'Glucose mmol/L'], ['urine_ml', 'Urine mL'], ['hours', 'Over hours']]
  const map = f.sbp && f.dbp ? Math.round((Number(f.sbp) + 2 * Number(f.dbp)) / 3) : null
  return (
    <div>
      <div style={s.grid(110)}>{fields.map(([k, l]) => <Num key={k} k={k} l={l} f={f} setF={setF} />)}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <span style={{ fontSize: 12, color: map !== null && map < 65 ? C.danger : C.sub }}>{map !== null ? `MAP ${map} mmHg` : 'MAP calculated from BP'}</span>
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={async () => { if (await add('vitals', f)) setF(blank) }}>Save vitals</button>
      </div>
      {list.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead><tr>{['Time', 'HR', 'BP', 'MAP', 'SpO₂', 'RR', 'T', 'CVP', 'GCS', 'Gluc', 'Urine', 'mL/kg/h', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{list.map((e) => (
              <tr key={e.id} style={{ opacity: e.struck_out_at ? 0.45 : 1, textDecoration: e.struck_out_at ? 'line-through' : 'none' }} title={[...(e.flags || []), e.struck_out_reason].filter(Boolean).join(' · ')}>
                <td style={s.td}>{hm(e.recorded_at)}</td><td style={s.td}>{e.data.hr}</td><td style={s.td}>{e.data.sbp ? `${e.data.sbp}/${e.data.dbp || '?'}` : ''}</td>
                <td style={{ ...s.td, color: e.calc?.map < 65 ? C.danger : undefined, fontWeight: 700 }}>{e.calc?.map}</td><td style={s.td}>{e.data.spo2}</td><td style={s.td}>{e.data.rr}</td><td style={s.td}>{e.data.temp}</td>
                <td style={s.td}>{e.data.cvp}</td><td style={s.td}>{e.data.gcs}</td><td style={s.td}>{e.data.glucose}</td><td style={s.td}>{e.data.urine_ml}</td>
                <td style={{ ...s.td, color: e.calc?.urine_ml_kg_h < 0.5 ? C.danger : undefined }}>{e.calc?.urine_ml_kg_h}</td>
                <td style={s.td}>{!e.struck_out_at && <button type="button" aria-label="Entered in error" onClick={() => strike(e)} style={{ ...s.btn, ...s.ghost, padding: '1px 6px', fontSize: 11 }}>✕</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const MODES = ['VC-AC', 'PC-AC', 'SIMV', 'PSV / CPAP', 'PRVC', 'NIV BiPAP', 'NIV CPAP', 'High-flow nasal', 'T-piece / trial', 'Face mask / nasal prongs']
function Ventilator({ adm, add, list, strike }) {
  const blank = { mode: 'VC-AC', fio2: '', peep: '', vt: '', rr_set: '', rr_total: '', ppeak: '', pplat: '', ps: '', ph: '', pao2: '', paco2: '', ett: '', ett_cm: '', cuff: '' }
  const [f, setF] = useState(blank)
  const v = ventCheck(f, adm)
  return (
    <div>
      <div style={{ ...s.card, background: '#F8FAFC', marginBottom: 10, fontSize: 12 }}>
        {v.calc.pbw ? <>Predicted body weight <b>{v.calc.pbw} kg</b> · lung-protective tidal volume <b>{v.calc.target_vt[0]}–{v.calc.target_vt[1]} mL</b> (6–8 mL/kg)</> : 'Add height and sex on the admission to calculate the target tidal volume.'}
      </div>
      <div><label style={s.label} htmlFor="icu-mode">Mode</label><select id="icu-mode" style={{ ...s.input, maxWidth: 260 }} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></div>
      <div style={{ ...s.grid(110), marginTop: 8 }}>
        {[['fio2', 'FiO₂ %'], ['peep', 'PEEP'], ['vt', 'Vt mL'], ['rr_set', 'RR set'], ['rr_total', 'RR total'], ['ppeak', 'Ppeak'], ['pplat', 'Pplat'], ['ps', 'Pressure support'], ['ph', 'pH'], ['pao2', 'PaO₂ mmHg'], ['paco2', 'PaCO₂ mmHg'], ['ett', 'ETT size'], ['ett_cm', 'ETT at lips cm'], ['cuff', 'Cuff pressure']].map(([k, l]) => <Num key={k} k={k} l={l} f={f} setF={setF} />)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
        <div style={{ fontSize: 12 }}>
          {v.calc.vt_ml_kg !== null && <div>Vt {v.calc.vt_ml_kg} mL/kg</div>}
          {v.calc.driving_pressure !== null && <div>Driving pressure {v.calc.driving_pressure} cmH₂O</div>}
          <Flags flags={v.flags} />
        </div>
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={async () => { if (await add('ventilator', f)) setF({ ...blank, mode: f.mode }) }}>Save settings</button>
      </div>
      <History list={list} strike={strike} render={(e) => <>{e.data.mode} · FiO₂ {e.data.fio2 ?? '—'} · PEEP {e.data.peep ?? '—'} · Vt {e.data.vt ?? '—'}{e.calc?.vt_ml_kg ? ` (${e.calc.vt_ml_kg} mL/kg)` : ''}{e.calc?.pf_ratio ? ` · P/F ${e.calc.pf_ratio}` : ''}</>} />
    </div>
  )
}

function Infusions({ adm, add, list, strike, all }) {
  const blank = { drug: '', action: 'start', dose: '', dose_unit: 'mcg/kg/min', amount: '', volume_ml: '', pump_rate: '', second_checker: '', weight_kg: adm.weight_kg ?? '' }
  const [f, setF] = useState(blank)
  const [err, setErr] = useState('')
  const rate = infusionRate(f)
  const high = isHighAlert(f.drug)
  const mismatch = rate !== null && f.pump_rate !== '' && Math.abs(Number(f.pump_rate) - rate) > Math.max(rate * 0.1, 0.1)
  const active = activeInfusions(all)
  async function save() {
    setErr('')
    if (!f.drug.trim()) { setErr('Name the drug.'); return }
    if (f.action !== 'stop' && rate === null) { setErr('Give the dose, amount in the syringe/bag, volume and weight to calculate the rate.'); return }
    if (f.action !== 'stop' && high && !f.second_checker.trim()) { setErr(`${f.drug} is a high-alert drug: a second nurse must check the dose and pump.`); return }
    if (mismatch) { setErr(`The pump rate does not match the calculated ${rate} mL/h.`); return }
    if (await add('infusion', f.action === 'stop' ? { drug: f.drug, action: 'stop' } : f)) setF(blank)
  }
  return (
    <div>
      {active.length > 0 && <div style={{ ...s.card, marginBottom: 10 }}>
        <div style={s.label}>Running now</div>
        {active.map((e) => (
          <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', fontSize: 13 }}>
            <span><b>{e.data.drug}</b> {e.data.dose} {e.data.dose_unit} = <b>{e.calc?.rate_ml_h} mL/h</b> ({e.data.amount} in {e.data.volume_ml} mL){e.calc?.high_alert ? ' · double-checked by ' + e.data.second_checker : ''}</span>
            <span style={{ display: 'flex', gap: 4 }}>
              <button type="button" style={{ ...s.btn, ...s.ghost, padding: '2px 8px' }} onClick={() => setF({ ...blank, ...e.data, action: 'change', pump_rate: '', second_checker: '' })}>Change</button>
              <button type="button" style={{ ...s.btn, ...s.danger, padding: '2px 8px' }} onClick={() => add('infusion', { drug: e.data.drug, action: 'stop' }, `${e.data.drug} stopped.`)}>Stop</button>
            </span>
          </div>
        ))}
      </div>}
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={s.grid(130)}>
        <div><label style={s.label} htmlFor="icu-drug">Drug</label><input id="icu-drug" style={s.input} value={f.drug} onChange={(e) => setF({ ...f, drug: e.target.value })} /></div>
        <div><label style={s.label} htmlFor="icu-action">Action</label><select id="icu-action" style={s.input} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}><option value="start">Start</option><option value="change">Change rate</option><option value="stop">Stop</option></select></div>
        {f.action !== 'stop' && <>
          <Num k="dose" l="Dose" f={f} setF={setF} />
          <div><label style={s.label} htmlFor="icu-dose_unit">Dose unit</label><select id="icu-dose_unit" style={s.input} value={f.dose_unit} onChange={(e) => setF({ ...f, dose_unit: e.target.value })}>{DOSE_UNITS.map((u) => <option key={u}>{u}</option>)}</select></div>
          <Num k="amount" l={f.dose_unit === 'units/h' ? 'Units in syringe/bag' : 'mg in syringe/bag'} f={f} setF={setF} />
          <Num k="volume_ml" l="Made up to mL" f={f} setF={setF} />
          <Num k="weight_kg" l="Weight kg" f={f} setF={setF} />
          <Num k="pump_rate" l="Pump set at mL/h" f={f} setF={setF} />
          <div><label style={s.label} htmlFor="icu-second_checker">Second checker{high ? ' *' : ''}</label><input id="icu-second_checker" style={s.input} value={f.second_checker} onChange={(e) => setF({ ...f, second_checker: e.target.value })} /></div>
        </>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <span style={{ fontSize: 13, color: mismatch ? C.danger : C.text }}>
          {f.action !== 'stop' && (rate !== null ? <>Calculated rate <b>{rate} mL/h</b>{mismatch ? ' — the pump setting does not match' : ''}</> : 'Rate calculated from dose, concentration and weight')}
          {high && f.action !== 'stop' && <b style={{ color: C.warn }}> · High-alert drug: double check</b>}
        </span>
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={save}>Save</button>
      </div>
      <History list={list} strike={strike} render={(e) => <>{e.data.action} <b>{e.data.drug}</b>{e.data.action !== 'stop' ? ` ${e.data.dose} ${e.data.dose_unit} = ${e.calc?.rate_ml_h} mL/h` : ''}{e.data.second_checker ? ` · checked by ${e.data.second_checker}` : ''}</>} />
    </div>
  )
}

function Sedation({ add, list, strike }) {
  const blank = { rass: '', rass_target: '-1', pain_nrs: '', cam_icu: '', sedation_hold: '', face: '', body: '', tension: '', vent: '' }
  const [f, setF] = useState(blank)
  const cpotDone = CPOT.every((q) => f[q.key] !== '')
  const cpot = cpotDone ? CPOT.reduce((t, q) => t + Number(f[q.key]), 0) : null
  async function save() {
    const data = { rass: f.rass, rass_target: f.rass_target, pain_nrs: f.pain_nrs, cam_icu: f.cam_icu, sedation_hold: f.sedation_hold, cpot: cpot ?? '' }
    if (await add('sedation', data)) setF({ ...blank, rass_target: f.rass_target })
  }
  const sel = (k, l, opts) => <div><label style={s.label} htmlFor={`icu-${k}`}>{l}</label><select id={`icu-${k}`} style={s.input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}><option value="">—</option>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
  return (
    <div>
      <div style={s.grid(200)}>
        {sel('rass', 'RASS now', RASS)}
        {sel('rass_target', 'RASS target', RASS)}
        {sel('cam_icu', 'CAM-ICU (delirium)', [['negative', 'Negative'], ['positive', 'Positive'], ['unable', 'Unable to assess (RASS -4/-5)']])}
        <Num k="pain_nrs" l="Pain score 0–10 (if can self-report)" f={f} setF={setF} />
        {sel('sedation_hold', 'Daily sedation hold', [['done', 'Done'], ['not_indicated', 'Not indicated'], ['not_done', 'Not done']])}
      </div>
      <div style={{ ...s.label, marginTop: 10 }}>CPOT (if cannot self-report){cpot !== null ? ` — ${cpot}/8` : ''}</div>
      <div style={s.grid(200)}>{CPOT.map((q) => sel(q.key, q.label, q.options.map((o, i) => [String(i), o])))}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <span style={{ fontSize: 12, color: cpot >= 3 ? C.danger : C.sub }}>{cpot >= 3 ? 'CPOT 3 or more: pain likely — treat and reassess' : ''}</span>
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={save}>Save assessment</button>
      </div>
      <History list={list} strike={strike} render={(e) => <>RASS {e.data.rass ?? '—'} (target {e.data.rass_target ?? '—'}){e.data.cpot !== undefined ? ` · CPOT ${e.data.cpot}` : ''}{e.data.pain_nrs ? ` · pain ${e.data.pain_nrs}/10` : ''}{e.data.cam_icu ? ` · CAM-ICU ${e.data.cam_icu}` : ''}</>} />
    </div>
  )
}

function Sofa({ add, list, strike }) {
  const blank = Object.fromEntries([...SOFA_FIELDS.map(([k]) => [k, '']), ['resp_support', false]])
  const [f, setF] = useState(blank)
  const r = sofa(f)
  const trend = useMemo(() => list.filter((e) => !e.struck_out_at).slice().reverse(), [list])
  return (
    <div>
      {trend.length > 0 && <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }} aria-label="SOFA trend">
        {trend.map((e, i) => {
          const prev = trend[i - 1]?.calc?.total
          return <div key={e.id} style={{ textAlign: 'center', fontSize: 11 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: prev !== undefined && e.calc.total > prev ? C.danger : prev !== undefined && e.calc.total < prev ? C.success : C.text }}>{e.calc.total}</div>
            <div style={s.sub}>{new Date(e.recorded_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })}</div>
          </div>
        })}
      </div>}
      <div style={s.grid(130)}>{SOFA_FIELDS.map(([k, l]) => <Num key={k} k={k} l={l} f={f} setF={setF} />)}</div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 8 }}><input type="checkbox" checked={f.resp_support} onChange={(e) => setF({ ...f, resp_support: e.target.checked })} />On ventilation / CPAP</label>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
        <span style={{ fontSize: 13 }}>
          SOFA <b>{r.total}</b> — {Object.entries(r.parts).map(([k, v]) => `${k} ${v ?? '–'}`).join(' · ')}{r.pf_ratio ? ` · P/F ${r.pf_ratio}` : ''}
          {r.missing.length > 0 && <div style={s.sub}>Not scored yet: {r.missing.join(', ')}</div>}
        </span>
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={async () => { if (await add('sofa', { ...f, resp_support: f.resp_support || '' })) setF(blank) }}>Save SOFA</button>
      </div>
      <History list={list} strike={strike} render={(e) => <>SOFA <b>{e.calc?.total}</b> ({Object.entries(e.calc?.parts || {}).map(([k, v]) => `${k} ${v ?? '–'}`).join(', ')})</>} />
    </div>
  )
}

function Goals({ add, list, strike }) {
  const [items, setItems] = useState({})
  const [plan, setPlan] = useState('')
  const [err, setErr] = useState('')
  const doneToday = list.some((e) => !e.struck_out_at && dayKey(e.recorded_at) === todayKey())
  async function save() {
    setErr('')
    if (DAILY_GOALS.some(([k]) => !items[k])) { setErr('Answer every item (yes / no / not applicable).'); return }
    if (await add('goals', { items, plan }, 'Daily goals saved.')) { setItems({}); setPlan('') }
  }
  return (
    <div>
      <div style={{ fontSize: 12, marginBottom: 8, color: doneToday ? C.success : C.warn }}>{doneToday ? 'Daily goals done today.' : 'Daily goals not yet done today (ward round).'}</div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {DAILY_GOALS.map(([k, l]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
          <span>{l}</span>
          <span style={{ display: 'flex', gap: 10 }}>{[['yes', 'Yes'], ['no', 'No'], ['na', 'N/A']].map(([v, t]) => (
            <label key={v} style={{ display: 'flex', gap: 3, alignItems: 'center', fontSize: 12, color: v === 'no' && items[k] === 'no' ? C.danger : undefined }}><input type="radio" name={`goal-${k}`} checked={items[k] === v} onChange={() => setItems({ ...items, [k]: v })} />{t}</label>
          ))}</span>
        </div>
      ))}
      <label style={{ ...s.label, marginTop: 10 }} htmlFor="icu-plan">Today's goals / plan</label>
      <textarea id="icu-plan" rows={3} style={s.input} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="e.g. Wean noradrenaline to keep MAP ≥ 65; SBT if FiO₂ ≤ 40%; repeat lactate" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={save}>Save daily goals</button></div>
      <History list={list} strike={strike} render={(e) => <>{(e.calc?.open || []).length ? `Not met: ${e.calc.open.map((k) => k.replace('_', ' ')).join(', ')}` : 'All goals met'}{e.data.plan ? ` — ${e.data.plan}` : ''}</>} />
    </div>
  )
}

function Family({ add, list, strike }) {
  const blank = { member: '', discussed: '', by: '', understanding: '', concerns: '', next_meeting: '' }
  const [f, setF] = useState(blank)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <div>
      <div style={s.grid(200)}>
        <div><label style={s.label} htmlFor="fam-member">Spoke with (name, relationship) *</label><input id="fam-member" style={s.input} value={f.member} onChange={set('member')} /></div>
        <div><label style={s.label} htmlFor="fam-by">Clinician</label><input id="fam-by" style={s.input} value={f.by} onChange={set('by')} /></div>
        <div><label style={s.label} htmlFor="fam-understanding">Family's understanding</label><select id="fam-understanding" style={s.input} value={f.understanding} onChange={set('understanding')}><option value="">—</option><option value="good">Good</option><option value="partial">Partial</option><option value="poor">Poor — needs another meeting</option></select></div>
        <div><label style={s.label} htmlFor="fam-next">Next meeting</label><input id="fam-next" type="date" style={s.input} value={f.next_meeting} onChange={set('next_meeting')} /></div>
      </div>
      <label style={{ ...s.label, marginTop: 8 }} htmlFor="fam-discussed">What was discussed *</label>
      <textarea id="fam-discussed" rows={3} style={s.input} value={f.discussed} onChange={set('discussed')} placeholder="Condition, treatment, prognosis, resuscitation decisions, costs / SHA cover" />
      <label style={{ ...s.label, marginTop: 8 }} htmlFor="fam-concerns">Family concerns / questions</label>
      <input id="fam-concerns" style={s.input} value={f.concerns} onChange={set('concerns')} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={async () => { if (await add('family', f)) setF(blank) }}>Save conversation</button></div>
      <History list={list} strike={strike} render={(e) => <><b>{e.data.member}</b>{e.data.by ? ` with ${e.data.by}` : ''}: {e.data.discussed}{e.data.understanding ? ` · understanding ${e.data.understanding}` : ''}</>} />
    </div>
  )
}

function Discharge({ adm, onDone, setErr }) {
  const [f, setF] = useState({ outcome: '', at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16), note: '' })
  async function save() {
    setErr('')
    if (!f.outcome) { setErr('Choose where the patient went (or that they died).'); return }
    const { error } = await supabase.from('icu_admissions').update({ outcome: f.outcome, discharged_at: new Date(f.at).toISOString(), discharge_note: f.note || null }).eq('id', adm.id)
    if (error) setErr(friendly(error)); else onDone()
  }
  return (
    <div style={s.card}>
      <div style={s.grid(220)}>
        <div><label style={s.label} htmlFor="dc-outcome">Outcome</label><select id="dc-outcome" style={s.input} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}><option value="">Choose…</option>{OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label style={s.label} htmlFor="dc-at">{f.outcome === 'died' ? 'Time of death' : 'Left the unit at'}</label><input id="dc-at" type="datetime-local" style={s.input} value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></div>
      </div>
      <label style={{ ...s.label, marginTop: 8 }} htmlFor="dc-note">ICU discharge summary / handover</label>
      <textarea id="dc-note" rows={4} style={s.input} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Course in ICU, organ support given, lines in place, medicines, plan for the receiving ward" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={save}>Discharge from unit</button></div>
    </div>
  )
}

function Stats({ hospitalId }) {
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { void supabase.rpc('icu_stats', { p_hospital: hospitalId, p_from: range.from, p_to: range.to }).then(({ data, error }) => { if (error) setErr(friendly(error)); else { setErr(''); setD(data) } }) }, [hospitalId, range])
  const tile = (l, v, warn) => <div style={{ border: `1px solid ${warn ? C.danger : C.border}`, borderRadius: 10, padding: 12, background: '#fff' }}><div style={s.sub}>{l}</div><div style={{ fontSize: 22, fontWeight: 800, color: warn ? C.danger : undefined }}>{v ?? '—'}</div></div>
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input aria-label="From" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <input aria-label="To" type="date" style={{ ...s.input, maxWidth: 170 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {d && <>
        <div style={s.grid(160)}>
          {tile('Admissions', d.admissions)}{tile('Still in the unit', d.still_in_unit)}{tile('Deaths', d.deaths)}
          {tile('Mortality', d.mortality_pct === null ? null : `${d.mortality_pct}%`)}{tile('Median stay', d.median_los_days === null ? null : `${d.median_los_days} days`)}
          {tile('Patient-days', d.patient_days)}{tile('Ventilated patients', d.ventilated)}{tile('Ventilator-days', d.ventilator_days)}
          {tile('Readmitted within 48 h', d.readmissions_48h, d.readmissions_48h > 0)}{tile('Median SOFA on admission', d.median_admission_sofa)}
        </div>
        <div style={{ ...s.grid(260), marginTop: 12 }}>
          <div><div style={s.label}>By unit</div>{Object.entries(d.by_unit || {}).map(([k, n]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{k}</span><b>{n}</b></div>)}</div>
          <div><div style={s.label}>Admitted from</div>{Object.entries(d.by_source || {}).map(([k, n]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{k.replace('_', ' ')}</span><b>{n}</b></div>)}</div>
        </div>
      </>}
    </div>
  )
}
