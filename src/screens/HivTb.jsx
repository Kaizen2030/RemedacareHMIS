// HIV & TB care: ART clients with viral-load schedule and suppression, regimen history, TPT;
// TB episodes with phases, follow-up sputum, DOT log and outcomes; index-testing / contact tracing.
// Rules live in the database (20261119000000_hiv_tb_maternity.sql). Clinical staff only.
import { useCallback, useEffect, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import PatientSearch from '../components/PatientSearch'
import { localDateKey } from '../utils/scheduling'
import { C, Chip, s } from './ncd/ui'
import usePatientAccessLog from '../hooks/useAccessLog'
import { ArtVisits, DefaulterTracing, HtsRegister, ProgrammeIndicators } from './hivtb/ProgrammeExtras'

const VL = { suppressed: ['Suppressed', 'green'], llv: ['Low-level viraemia', 'yellow'], unsuppressed: ['Unsuppressed', 'red'], unknown: ['No VL yet', 'gray'] }
const REGIMENS = ['TDF/3TC/DTG (TLD)', 'ABC/3TC/DTG', 'TDF/3TC/EFV (TLE)', 'AZT/3TC/DTG', 'AZT/3TC/ATV/r', 'AZT/3TC/LPV/r', 'ABC/3TC/LPV/r', 'TDF/3TC/ATV/r', 'DRV/r + DTG + NRTIs']
const TB_RESULTS = { negative: 'Negative', positive: 'Positive', mtb_detected: 'MTB detected', mtb_not_detected: 'MTB not detected', rif_resistant: 'RIF resistant', contaminated: 'Contaminated' }
const TABS = [['art', 'ART clients'], ['hts', 'HIV testing'], ['tb', 'TB treatment'], ['contacts', 'Contacts & index testing'], ['defaulters', 'Defaulter tracing'], ['indicators', 'Programme indicators']]
const today = () => localDateKey()

function Field({ label, id, children }) {
  return <div><label style={s.label} htmlFor={id}>{label}</label>{children}</div>
}

function ArtDrawer({ art, onClose, onChanged }) {
  const recordAllowed = usePatientAccessLog(art.hospital_id, art.patient_id, 'HIV care')
  const [vls, setVls] = useState([])
  const [changes, setChanges] = useState([])
  const [vl, setVl] = useState({ sample_date: today(), copies_ml: '', ldl: false, eac_sessions: '' })
  const [rx, setRx] = useState({ to: '', line: art.regimen_line || 'first', reason: '' })
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from('hiv_viral_loads').select('*').eq('art_id', art.id).order('sample_date', { ascending: false }),
      supabase.from('hiv_regimen_changes').select('*').eq('art_id', art.id).order('changed_on', { ascending: false }),
    ])
    setVls(a.data || []); setChanges(b.data || [])
  }, [art.id])
  useEffect(() => { void load() }, [load])
  const run = async (fn) => { setErr(''); try { await fn(); await load(); onChanged() } catch (e) { setErr(e.message || String(e)) } }
  const addVl = () => run(async () => {
    if (!vl.ldl && vl.copies_ml === '') throw new Error('Enter copies/ml or tick LDL')
    const { error } = await supabase.from('hiv_viral_loads').insert({ hospital_id: art.hospital_id, art_id: art.id, sample_date: vl.sample_date, copies_ml: vl.ldl ? 0 : Number(vl.copies_ml), eac_sessions: vl.eac_sessions ? Number(vl.eac_sessions) : null })
    if (error) throw error
    setVl({ sample_date: today(), copies_ml: '', ldl: false, eac_sessions: '' })
  })
  const changeRegimen = () => run(async () => {
    const { error } = await supabase.rpc('hiv_change_regimen', { p_art: art.id, p_to: rx.to, p_line: rx.line, p_reason: rx.reason, p_on: today() })
    if (error) throw error
    setRx({ to: '', line: rx.line, reason: '' })
  })
  const update = (patch) => run(async () => { const { error } = await supabase.from('hiv_art').update(patch).eq('id', art.id); if (error) throw error })
  const [label, tone] = VL[art.vl_status] || VL.unknown
  const overdue = art.next_vl_due && art.next_vl_due < today()
  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-label="ART client" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.drawer}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <h2 style={{ ...s.h1, fontSize: 18 }}>{art.patients?.full_name || 'Client'}</h2>
            <div style={s.sub}>CCC {art.ccc_number || '—'} · ART since {art.art_start_date || '—'} · {art.current_regimen || 'no regimen'} ({art.regimen_line || '—'} line)</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <Chip tone={tone}>{label}{art.last_vl_value != null ? ` · ${art.last_vl_value === 0 ? 'LDL' : `${art.last_vl_value} c/ml`}` : ''}</Chip>
              {art.next_vl_due && <Chip tone={overdue ? 'red' : 'blue'}>VL {overdue ? 'overdue since' : 'due'} {art.next_vl_due}</Chip>}
              {art.eac_required && <Chip tone="red">Enhanced adherence counselling</Chip>}
              {art.status !== 'active' && <Chip tone="red">{art.status}</Chip>}
            </div>
          </div>
          <button type="button" style={{ ...s.btn, ...s.ghost, alignSelf: 'flex-start' }} onClick={onClose}>Close</button>
        </div>
        {err && <div role="alert" style={{ ...s.err, marginTop: 10 }}>{err}</div>}
        {!recordAllowed ? <div style={{ marginTop: 12 }}><div role="alert" style={{ padding: 16, background: '#FEF3F2', color: '#B42318', borderRadius: 10, fontWeight: 700 }}>This record is confidential. Open it again and give a reason to continue.</div></div> : <>
        <ArtVisits art={art} onChanged={onChanged} />

        <div style={{ ...s.card, marginTop: 12 }}>
          <h3 style={s.h2}>Viral loads</h3>
          {vls.length === 0 ? <div style={s.sub}>None yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>{vls.map((v) => <tr key={v.id}><td style={s.td}>{v.sample_date}</td><td style={s.td}>{Number(v.copies_ml) === 0 ? 'LDL' : `${v.copies_ml} copies/ml`}</td><td style={s.td}>{v.eac_sessions ? `${v.eac_sessions} EAC sessions` : ''}</td></tr>)}</tbody>
            </table>
          )}
          <div style={{ ...s.grid(130), marginTop: 10, alignItems: 'end' }}>
            <Field label="Sample date" id="vl-date"><input id="vl-date" type="date" max={today()} style={s.input} value={vl.sample_date} onChange={(e) => setVl((x) => ({ ...x, sample_date: e.target.value }))} /></Field>
            <Field label="Copies/ml" id="vl-copies"><input id="vl-copies" type="number" min={0} disabled={vl.ldl} style={s.input} value={vl.copies_ml} onChange={(e) => setVl((x) => ({ ...x, copies_ml: e.target.value }))} /></Field>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={vl.ldl} onChange={(e) => setVl((x) => ({ ...x, ldl: e.target.checked }))} />LDL (&lt;50)</label>
            <Field label="EAC sessions" id="vl-eac"><input id="vl-eac" type="number" min={0} max={6} style={s.input} value={vl.eac_sessions} onChange={(e) => setVl((x) => ({ ...x, eac_sessions: e.target.value }))} /></Field>
            <button type="button" style={{ ...s.btn, ...s.pri }} onClick={addVl}>Add result</button>
          </div>
        </div>

        <div style={{ ...s.card, marginTop: 12 }}>
          <h3 style={s.h2}>Regimen</h3>
          {changes.map((c) => <div key={c.id} style={{ fontSize: 12, color: '#475467' }}>{c.changed_on}: {c.from_regimen || '—'} → <strong>{c.to_regimen}</strong> ({c.to_line || '—'} line) — {c.reason}</div>)}
          <div style={{ ...s.grid(150), marginTop: 10, alignItems: 'end' }}>
            <Field label="New regimen" id="rx-to"><input id="rx-to" list="regimens" style={s.input} value={rx.to} onChange={(e) => setRx((x) => ({ ...x, to: e.target.value }))} /></Field>
            <datalist id="regimens">{REGIMENS.map((r) => <option key={r} value={r} />)}</datalist>
            <Field label="Line" id="rx-line"><select id="rx-line" style={s.input} value={rx.line} onChange={(e) => setRx((x) => ({ ...x, line: e.target.value }))}><option value="first">First</option><option value="second">Second</option><option value="third">Third</option></select></Field>
            <div style={{ gridColumn: 'span 2' }}><Field label="Reason" id="rx-reason"><input id="rx-reason" style={s.input} value={rx.reason} placeholder="e.g. Toxicity, treatment failure, optimisation to DTG" onChange={(e) => setRx((x) => ({ ...x, reason: e.target.value }))} /></Field></div>
            <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!rx.to || !rx.reason} onClick={changeRegimen}>Change regimen</button>
          </div>
        </div>

        <div style={{ ...s.card, marginTop: 12 }}>
          <h3 style={s.h2}>TB preventive therapy, pregnancy and status</h3>
          <div style={{ ...s.grid(150), alignItems: 'end' }}>
            <Field label="TPT" id="tpt"><select id="tpt" style={s.input} value={art.tpt_status || ''} onChange={(e) => update({ tpt_status: e.target.value || null, ...(e.target.value === 'on_tpt' && !art.tpt_start ? { tpt_start: today() } : {}), ...(e.target.value === 'completed' ? { tpt_end: today() } : {}) })}>
              <option value="">—</option><option value="not_started">Not started</option><option value="on_tpt">On TPT</option><option value="completed">Completed</option><option value="not_eligible">Not eligible</option><option value="stopped">Stopped</option>
            </select></Field>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={art.pregnant_or_breastfeeding} onChange={(e) => update({ pregnant_or_breastfeeding: e.target.checked })} />Pregnant / breastfeeding (6-monthly VL)</label>
            <Field label="Status" id="art-status"><select id="art-status" style={s.input} value={art.status} onChange={(e) => update({ status: e.target.value, status_date: today() })}>
              <option value="active">Active on ART</option><option value="ltfu">Lost to follow-up</option><option value="transferred_out">Transferred out</option><option value="died">Died</option><option value="stopped">Stopped</option>
            </select></Field>
          </div>
        </div>
        </>}
      </div>
    </div>
  )
}

function TbDrawer({ ep, onClose, onChanged }) {
  const [status, setStatus] = useState(null)
  const [sputum, setSputum] = useState([])
  const [dots, setDots] = useState([])
  const [sp, setSp] = useState({ month: 2, sample_date: today(), method: 'smear', result: 'negative' })
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const [st, a, b] = await Promise.all([
      supabase.rpc('tb_status', { p_episode: ep.id }),
      supabase.from('tb_sputum_results').select('*').eq('episode_id', ep.id).order('month'),
      supabase.from('tb_dot_log').select('*').eq('episode_id', ep.id).order('dose_date', { ascending: false }).limit(60),
    ])
    setStatus(st.data || null); setSputum(a.data || []); setDots(b.data || [])
  }, [ep.id])
  useEffect(() => { void load() }, [load])
  const run = async (fn) => { setErr(''); try { await fn(); await load(); onChanged() } catch (e) { setErr(e.message || String(e)) } }
  const dot = (taken) => run(async () => {
    const { error } = await supabase.from('tb_dot_log').upsert({ hospital_id: ep.hospital_id, episode_id: ep.id, dose_date: today(), taken }, { onConflict: 'episode_id,dose_date' })
    if (error) throw error
  })
  const addSputum = () => run(async () => {
    const { error } = await supabase.from('tb_sputum_results').upsert({ hospital_id: ep.hospital_id, episode_id: ep.id, ...sp, month: Number(sp.month) }, { onConflict: 'episode_id,month,method' })
    if (error) throw error
  })
  const setOutcome = (outcome) => run(async () => {
    const { error } = await supabase.from('tb_episodes').update({ outcome: outcome || null, outcome_date: outcome ? today() : null }).eq('id', ep.id)
    if (error) throw error
  })
  const todayDot = dots.find((d) => d.dose_date === today())
  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-label="TB episode" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.drawer}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <h2 style={{ ...s.h1, fontSize: 18 }}>{ep.patients?.full_name || 'Patient'}</h2>
            <div style={s.sub}>TB no. {ep.tb_number || '—'} · {ep.disease_site}, {ep.confirmation} · {ep.regimen} · started {ep.treatment_start || 'not yet'}</div>
            {status && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <Chip tone={status.phase === 'intensive' ? 'yellow' : 'blue'}>{String(status.phase || '').replace('_', ' ')}{status.day != null ? ` · day ${status.day}` : ''}</Chip>
              {status.next_sputum_month != null && <Chip tone={status.next_sputum_date < today() ? 'red' : 'gray'}>Month-{status.next_sputum_month} sputum {status.next_sputum_date < today() ? 'overdue' : `due ${status.next_sputum_date}`}</Chip>}
              {status.adherence_pct != null && <Chip tone={status.adherence_pct >= 90 ? 'green' : 'red'}>DOT {status.adherence_pct}% ({status.dot_taken}/{status.dot_recorded})</Chip>}
              {ep.hiv_status === 'positive' && <Chip tone="red">TB/HIV</Chip>}
            </div>}
          </div>
          <button type="button" style={{ ...s.btn, ...s.ghost, alignSelf: 'flex-start' }} onClick={onClose}>Close</button>
        </div>
        {err && <div role="alert" style={{ ...s.err, marginTop: 10 }}>{err}</div>}
        {!ep.outcome && (
          <div style={{ ...s.card, marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>Today's dose:</strong>{todayDot ? <Chip tone={todayDot.taken ? 'green' : 'red'}>{todayDot.taken ? 'Taken' : 'Missed'}</Chip> : <span style={s.sub}>not recorded</span>}
            <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => dot(true)}>Observed — taken</button>
            <button type="button" style={{ ...s.btn, ...s.danger }} onClick={() => dot(false)}>Missed</button>
          </div>
        )}
        <div style={{ ...s.card, marginTop: 12 }}>
          <h3 style={s.h2}>Sputum follow-up</h3>
          {sputum.map((r) => <div key={r.id} style={{ fontSize: 12 }}>Month {r.month} · {r.sample_date} · {r.method}: <strong>{TB_RESULTS[r.result]}</strong></div>)}
          <div style={{ ...s.grid(120), marginTop: 10, alignItems: 'end' }}>
            <Field label="Month" id="sp-m"><select id="sp-m" style={s.input} value={sp.month} onChange={(e) => setSp((x) => ({ ...x, month: e.target.value }))}>{[0, 2, 3, 5, 6].map((m) => <option key={m} value={m}>{m === 0 ? 'Diagnosis' : `Month ${m}`}</option>)}</select></Field>
            <Field label="Date" id="sp-d"><input id="sp-d" type="date" style={s.input} value={sp.sample_date} onChange={(e) => setSp((x) => ({ ...x, sample_date: e.target.value }))} /></Field>
            <Field label="Method" id="sp-me"><select id="sp-me" style={s.input} value={sp.method} onChange={(e) => setSp((x) => ({ ...x, method: e.target.value }))}><option value="smear">Smear</option><option value="genexpert">GeneXpert</option><option value="culture">Culture</option></select></Field>
            <Field label="Result" id="sp-r"><select id="sp-r" style={s.input} value={sp.result} onChange={(e) => setSp((x) => ({ ...x, result: e.target.value }))}>{Object.entries(TB_RESULTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <button type="button" style={{ ...s.btn, ...s.pri }} onClick={addSputum}>Save</button>
          </div>
        </div>
        <div style={{ ...s.card, marginTop: 12 }}>
          <h3 style={s.h2}>Treatment outcome</h3>
          {status?.suggested_outcome && !ep.outcome && <div style={{ ...s.ok }}>Suggested from results: <strong>{status.suggested_outcome}</strong></div>}
          <select aria-label="Outcome" style={s.input} value={ep.outcome || ''} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">On treatment</option><option value="cured">Cured</option><option value="completed">Treatment completed</option><option value="failed">Treatment failed</option>
            <option value="died">Died</option><option value="ltfu">Lost to follow-up</option><option value="transferred_out">Transferred out</option><option value="not_evaluated">Not evaluated</option>
          </select>
        </div>
      </div>
    </div>
  )
}

export default function HivTb() {
  const { hospitalId } = useHospital()
  const [tab, setTab] = useState('art')
  const [art, setArt] = useState([])
  const [tb, setTb] = useState([])
  const [contacts, setContacts] = useState([])
  const [filter, setFilter] = useState('')
  const [err, setErr] = useState('')
  const [openArt, setOpenArt] = useState(null)
  const [openTb, setOpenTb] = useState(null)
  const [newArt, setNewArt] = useState(null)
  const [newTb, setNewTb] = useState(null)
  const [newContact, setNewContact] = useState(null)

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('hiv_art').select('*, patients(full_name, phone, patient_number, age, gender)').eq('hospital_id', hospitalId).order('next_vl_due', { ascending: true, nullsFirst: false }).limit(500),
      supabase.from('tb_episodes').select('*, patients(full_name, phone, patient_number)').eq('hospital_id', hospitalId).order('diagnosis_date', { ascending: false }).limit(300),
      supabase.from('case_contacts').select('*, patients:index_patient_id(full_name)').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(300),
    ])
    const e = a.error || b.error
    setErr(e ? (/permission|row-level/i.test(e.message) ? 'HIV and TB records are visible to clinical staff only.' : `Not installed yet (${e.message}). Run docs/sql/08_hiv_tb_maternity.sql.`) : '')
    setArt(a.data || []); setTb(b.data || []); setContacts(c.data || [])
  }, [hospitalId])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])

  const saveArt = async () => {
    if (!newArt.patient) { setErr('Pick the patient'); return }
    const { error } = await supabase.from('hiv_art').insert({ hospital_id: hospitalId, patient_id: newArt.patient.id, ccc_number: newArt.ccc || null, art_start_date: newArt.start || null,
      current_regimen: newArt.regimen || null, regimen_line: 'first', who_stage: newArt.stage ? Number(newArt.stage) : null, pregnant_or_breastfeeding: newArt.pbf })
    if (error) { setErr(/duplicate|unique/i.test(error.message) ? 'This client (or CCC number) is already registered.' : error.message); return }
    setNewArt(null); void load()
  }
  const saveTb = async () => {
    if (!newTb.patient) { setErr('Pick the patient'); return }
    const { error } = await supabase.from('tb_episodes').insert({ hospital_id: hospitalId, patient_id: newTb.patient.id, tb_number: newTb.tbNo || null, diagnosis_date: newTb.dx, disease_site: newTb.site,
      confirmation: newTb.conf, patient_type: newTb.type, regimen: newTb.regimen, treatment_months: newTb.regimen.includes('10RH') ? 12 : 6, treatment_start: newTb.start || null, hiv_status: newTb.hiv || null,
      dot_supporter: newTb.supporter || null, dot_supporter_phone: newTb.supporterPhone || null })
    if (error) { setErr(/duplicate|unique/i.test(error.message) ? 'This patient already has an open TB episode.' : error.message); return }
    setNewTb(null); void load()
  }
  const saveContact = async () => {
    if (!newContact.index || !newContact.name) { setErr('Pick the index client and enter the contact name'); return }
    const { error } = await supabase.from('case_contacts').insert({ hospital_id: hospitalId, index_patient_id: newContact.index.id, programme: newContact.programme, contact_name: newContact.name,
      relationship: newContact.relationship || null, age_years: newContact.age ? Number(newContact.age) : null, sex: newContact.sex || null, phone: newContact.phone || null })
    if (error) { setErr(error.message); return }
    setNewContact(null); void load()
  }
  const updateContact = async (id, patch) => { const { error } = await supabase.from('case_contacts').update(patch).eq('id', id); if (error) setErr(error.message); else void load() }

  const t = today()
  const active = art.filter((a) => a.status === 'active')
  const kpi = {
    active: active.length,
    suppressed: active.filter((a) => a.vl_status === 'suppressed').length,
    withVl: active.filter((a) => a.vl_status !== 'unknown').length,
    unsuppressed: active.filter((a) => a.vl_status === 'unsuppressed').length,
    overdue: active.filter((a) => a.next_vl_due && a.next_vl_due < t).length,
    tbOpen: tb.filter((e) => !e.outcome).length,
  }
  const artRows = art.filter((a) => !filter || (filter === 'overdue' ? a.status === 'active' && a.next_vl_due && a.next_vl_due < t : filter === 'eac' ? a.eac_required : a.status === filter))

  return (
    <section style={s.page}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div><h1 style={s.h1}>HIV & TB care</h1><p style={{ ...s.sub, margin: '5px 0 0' }}>HIV testing, ART, viral load, TB screening and treatment, defaulter tracing and programme indicators — Kenya 2022 ARV, HTS and NTLD-P guidelines. <a href="#/references?topic=hiv_tb" style={{ color: C.primary, fontWeight: 700 }}>Sources</a></p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => setNewArt({ patient: null, ccc: '', start: t, regimen: REGIMENS[0], stage: '', pbf: false })}>Enrol on ART</button>
          <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => setNewTb({ patient: null, tbNo: '', dx: t, start: t, site: 'pulmonary', conf: 'bacteriological', type: 'new', regimen: '2RHZE/4RH', hiv: '', supporter: '', supporterPhone: '' })}>Start TB treatment</button>
        </div>
      </header>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ ...s.grid(160), marginBottom: 14 }}>
        {[['On ART', kpi.active, C.primary, ''], ['VL suppression', `${kpi.withVl ? Math.round((kpi.suppressed / kpi.withVl) * 100) : 0}%`, C.success, 'active'], ['Unsuppressed (EAC)', kpi.unsuppressed, C.danger, 'eac'], ['VL overdue', kpi.overdue, C.warn, 'overdue'], ['On TB treatment', kpi.tbOpen, '#175CD3', null]].map(([l, v, col, f]) => (
          <button key={l} type="button" style={{ ...s.card, textAlign: 'left', cursor: 'pointer' }} onClick={() => { if (f === null) setTab('tb'); else { setTab('art'); setFilter(f) } }}>
            <div style={s.label}>{l}</div><div style={{ fontSize: 24, fontWeight: 800, color: col }}>{v}</div>
          </button>
        ))}
      </div>
      <nav role="tablist" style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 14, overflowX: 'auto' }}>
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} style={{ padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700, color: tab === k ? C.primary : C.sub, borderBottom: `2px solid ${tab === k ? C.primary : 'transparent'}` }}>{l}</button>)}
      </nav>

      {tab === 'art' && (
        <div style={s.card}>
          <select aria-label="Filter" style={{ ...s.input, maxWidth: 260, marginBottom: 10 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All clients</option><option value="active">Active</option><option value="overdue">VL overdue</option><option value="eac">Needs EAC</option><option value="ltfu">Lost to follow-up</option><option value="transferred_out">Transferred out</option><option value="died">Died</option>
          </select>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Client', 'CCC', 'Regimen', 'Last VL', 'Next VL', 'TPT', 'Status'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>{artRows.map((a) => {
                const [label, tone] = VL[a.vl_status] || VL.unknown
                const od = a.next_vl_due && a.next_vl_due < t && a.status === 'active'
                return (
                  <tr key={a.id} onClick={() => setOpenArt(a)} style={{ cursor: 'pointer' }}>
                    <td style={s.td}><strong>{a.patients?.full_name}</strong><div style={s.sub}>{a.patients?.phone}</div></td>
                    <td style={s.td}>{a.ccc_number || '—'}</td>
                    <td style={s.td}>{a.current_regimen || '—'}<div style={s.sub}>{a.regimen_line ? `${a.regimen_line} line` : ''}</div></td>
                    <td style={s.td}><Chip tone={tone}>{label}</Chip><div style={s.sub}>{a.last_vl_date || ''}</div></td>
                    <td style={{ ...s.td, color: od ? C.danger : undefined, fontWeight: od ? 700 : 400 }}>{a.next_vl_due || '—'}</td>
                    <td style={s.td}>{a.tpt_status ? a.tpt_status.replace('_', ' ') : '—'}</td>
                    <td style={s.td}>{a.status}</td>
                  </tr>
                )
              })}</tbody>
            </table>
            {artRows.length === 0 && <div style={{ ...s.sub, padding: 16, textAlign: 'center' }}>No clients in this view.</div>}
          </div>
        </div>
      )}

      {tab === 'hts' && <HtsRegister hospitalId={hospitalId} />}
      {tab === 'defaulters' && <DefaulterTracing hospitalId={hospitalId} onChanged={load} />}
      {tab === 'indicators' && <ProgrammeIndicators hospitalId={hospitalId} />}

      {tab === 'tb' && (
        <div style={{ ...s.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Patient', 'TB no.', 'Type', 'Regimen', 'Started', 'HIV', 'Outcome'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{tb.map((e) => (
              <tr key={e.id} onClick={() => setOpenTb(e)} style={{ cursor: 'pointer' }}>
                <td style={s.td}><strong>{e.patients?.full_name}</strong></td><td style={s.td}>{e.tb_number || '—'}</td>
                <td style={s.td}>{e.disease_site}, {e.confirmation}<div style={s.sub}>{e.patient_type.replace(/_/g, ' ')}</div></td>
                <td style={s.td}>{e.regimen}</td><td style={s.td}>{e.treatment_start || '—'}</td><td style={s.td}>{e.hiv_status || '—'}</td>
                <td style={s.td}>{e.outcome ? <Chip tone={['cured', 'completed'].includes(e.outcome) ? 'green' : 'red'}>{e.outcome}</Chip> : <Chip tone="blue">on treatment</Chip>}</td>
              </tr>
            ))}</tbody>
          </table>
          {tb.length === 0 && <div style={{ ...s.sub, padding: 16, textAlign: 'center' }}>No TB episodes.</div>}
        </div>
      )}

      {tab === 'contacts' && (
        <div style={s.card}>
          <button type="button" style={{ ...s.btn, ...s.pri, marginBottom: 10 }} onClick={() => setNewContact({ index: null, programme: 'hiv', name: '', relationship: '', age: '', sex: '', phone: '' })}>Add contact</button>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Index client', 'Programme', 'Contact', 'Screened / tested', 'Result', 'Linked'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>{contacts.map((c) => (
                <tr key={c.id}>
                  <td style={s.td}>{c.patients?.full_name || '—'}</td><td style={s.td}>{c.programme.toUpperCase()}</td>
                  <td style={s.td}><strong>{c.contact_name}</strong><div style={s.sub}>{[c.relationship, c.age_years ? `${c.age_years}y` : null, c.sex, c.phone].filter(Boolean).join(' · ')}</div></td>
                  <td style={s.td}>
                    <button type="button" style={{ ...s.btn, ...s.ghost, padding: '3px 8px' }} onClick={() => updateContact(c.id, c.programme === 'tb' ? { screened_on: t } : { tested_on: t })}>{(c.programme === 'tb' ? c.screened_on : c.tested_on) || 'Mark today'}</button>
                  </td>
                  <td style={s.td}>
                    <select aria-label="Result" style={s.input} value={c.programme === 'tb' ? (c.screening_result || '') : (c.test_result || '')}
                      onChange={(e) => updateContact(c.id, c.programme === 'tb' ? { screening_result: e.target.value || null } : { test_result: e.target.value || null })}>
                      <option value="">—</option>
                      {c.programme === 'tb'
                        ? ['no symptoms', 'presumptive TB — refer', 'on TPT', 'diagnosed TB'].map((v) => <option key={v} value={v}>{v}</option>)
                        : [['negative', 'Negative'], ['positive', 'Positive'], ['known_positive', 'Known positive'], ['declined', 'Declined'], ['pending', 'Pending']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td style={s.td}><input type="checkbox" aria-label="Linked to care" checked={c.linked} onChange={(e) => updateContact(c.id, { linked: e.target.checked })} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {newArt && (
        <div style={{ ...s.overlay, justifyContent: 'center', alignItems: 'center', padding: 16 }} role="dialog" aria-modal="true" aria-label="Enrol on ART">
          <div style={{ ...s.card, width: 560, maxWidth: '96vw' }}>
            <h2 style={s.h2}>Enrol on ART</h2>
            <Field label="Client" id="art-p"><PatientSearch id="art-p" hospitalId={hospitalId} inputStyle={s.input} value={newArt.patient} onPick={(p) => setNewArt((x) => ({ ...x, patient: p }))} /></Field>
            <div style={{ ...s.grid(150), marginTop: 10 }}>
              <Field label="CCC number" id="art-ccc"><input id="art-ccc" style={s.input} value={newArt.ccc} onChange={(e) => setNewArt((x) => ({ ...x, ccc: e.target.value }))} /></Field>
              <Field label="ART start" id="art-start"><input id="art-start" type="date" style={s.input} value={newArt.start} onChange={(e) => setNewArt((x) => ({ ...x, start: e.target.value }))} /></Field>
              <Field label="Regimen" id="art-rx"><input id="art-rx" list="regimens-new" style={s.input} value={newArt.regimen} onChange={(e) => setNewArt((x) => ({ ...x, regimen: e.target.value }))} /></Field>
              <datalist id="regimens-new">{REGIMENS.map((r) => <option key={r} value={r} />)}</datalist>
              <Field label="WHO stage" id="art-stage"><select id="art-stage" style={s.input} value={newArt.stage} onChange={(e) => setNewArt((x) => ({ ...x, stage: e.target.value }))}><option value="">—</option>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></Field>
            </div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 10 }}><input type="checkbox" checked={newArt.pbf} onChange={(e) => setNewArt((x) => ({ ...x, pbf: e.target.checked }))} />Pregnant or breastfeeding</label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setNewArt(null)}>Cancel</button>
              <button type="button" style={{ ...s.btn, ...s.pri }} onClick={saveArt}>Enrol</button>
            </div>
          </div>
        </div>
      )}

      {newTb && (
        <div style={{ ...s.overlay, justifyContent: 'center', alignItems: 'center', padding: 16 }} role="dialog" aria-modal="true" aria-label="Start TB treatment">
          <div style={{ ...s.card, width: 620, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto' }}>
            <h2 style={s.h2}>Start TB treatment</h2>
            <Field label="Patient" id="tb-p"><PatientSearch id="tb-p" hospitalId={hospitalId} inputStyle={s.input} value={newTb.patient} onPick={(p) => setNewTb((x) => ({ ...x, patient: p }))} /></Field>
            <div style={{ ...s.grid(150), marginTop: 10 }}>
              <Field label="TB number" id="tb-no"><input id="tb-no" style={s.input} value={newTb.tbNo} onChange={(e) => setNewTb((x) => ({ ...x, tbNo: e.target.value }))} /></Field>
              <Field label="Diagnosed" id="tb-dx"><input id="tb-dx" type="date" style={s.input} value={newTb.dx} onChange={(e) => setNewTb((x) => ({ ...x, dx: e.target.value }))} /></Field>
              <Field label="Treatment start" id="tb-st"><input id="tb-st" type="date" style={s.input} value={newTb.start} onChange={(e) => setNewTb((x) => ({ ...x, start: e.target.value }))} /></Field>
              <Field label="Site" id="tb-site"><select id="tb-site" style={s.input} value={newTb.site} onChange={(e) => setNewTb((x) => ({ ...x, site: e.target.value }))}><option value="pulmonary">Pulmonary</option><option value="extrapulmonary">Extrapulmonary</option></select></Field>
              <Field label="Confirmation" id="tb-conf"><select id="tb-conf" style={s.input} value={newTb.conf} onChange={(e) => setNewTb((x) => ({ ...x, conf: e.target.value }))}><option value="bacteriological">Bacteriologically confirmed</option><option value="clinical">Clinically diagnosed</option></select></Field>
              <Field label="Patient type" id="tb-type"><select id="tb-type" style={s.input} value={newTb.type} onChange={(e) => setNewTb((x) => ({ ...x, type: e.target.value }))}>{['new', 'relapse', 'treatment_after_failure', 'treatment_after_ltfu', 'transfer_in', 'other'].map((v) => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}</select></Field>
              <Field label="Regimen" id="tb-rx"><select id="tb-rx" style={s.input} value={newTb.regimen} onChange={(e) => setNewTb((x) => ({ ...x, regimen: e.target.value }))}><option>2RHZE/4RH</option><option>2RHZE/10RH</option><option>2RHZE/4RH (paediatric FDC)</option></select></Field>
              <Field label="HIV status" id="tb-hiv"><select id="tb-hiv" style={s.input} value={newTb.hiv} onChange={(e) => setNewTb((x) => ({ ...x, hiv: e.target.value }))}><option value="">—</option><option value="positive">Positive</option><option value="negative">Negative</option><option value="unknown">Unknown</option></select></Field>
              <Field label="DOT supporter" id="tb-sup"><input id="tb-sup" style={s.input} value={newTb.supporter} onChange={(e) => setNewTb((x) => ({ ...x, supporter: e.target.value }))} /></Field>
              <Field label="Supporter phone" id="tb-supp"><input id="tb-supp" style={s.input} value={newTb.supporterPhone} onChange={(e) => setNewTb((x) => ({ ...x, supporterPhone: e.target.value }))} /></Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setNewTb(null)}>Cancel</button>
              <button type="button" style={{ ...s.btn, ...s.pri }} onClick={saveTb}>Start treatment</button>
            </div>
          </div>
        </div>
      )}

      {newContact && (
        <div style={{ ...s.overlay, justifyContent: 'center', alignItems: 'center', padding: 16 }} role="dialog" aria-modal="true" aria-label="Add contact">
          <div style={{ ...s.card, width: 560, maxWidth: '96vw' }}>
            <h2 style={s.h2}>Add contact</h2>
            <Field label="Index client" id="ct-idx"><PatientSearch id="ct-idx" hospitalId={hospitalId} inputStyle={s.input} value={newContact.index} onPick={(p) => setNewContact((x) => ({ ...x, index: p }))} /></Field>
            <div style={{ ...s.grid(140), marginTop: 10 }}>
              <Field label="Programme" id="ct-prog"><select id="ct-prog" style={s.input} value={newContact.programme} onChange={(e) => setNewContact((x) => ({ ...x, programme: e.target.value }))}><option value="hiv">HIV (index testing)</option><option value="tb">TB (contact screening)</option></select></Field>
              <Field label="Contact name" id="ct-name"><input id="ct-name" style={s.input} value={newContact.name} onChange={(e) => setNewContact((x) => ({ ...x, name: e.target.value }))} /></Field>
              <Field label="Relationship" id="ct-rel"><input id="ct-rel" style={s.input} value={newContact.relationship} placeholder="spouse, child…" onChange={(e) => setNewContact((x) => ({ ...x, relationship: e.target.value }))} /></Field>
              <Field label="Age" id="ct-age"><input id="ct-age" type="number" style={s.input} value={newContact.age} onChange={(e) => setNewContact((x) => ({ ...x, age: e.target.value }))} /></Field>
              <Field label="Sex" id="ct-sex"><select id="ct-sex" style={s.input} value={newContact.sex} onChange={(e) => setNewContact((x) => ({ ...x, sex: e.target.value }))}><option value="">—</option><option>Female</option><option>Male</option></select></Field>
              <Field label="Phone" id="ct-ph"><input id="ct-ph" style={s.input} value={newContact.phone} onChange={(e) => setNewContact((x) => ({ ...x, phone: e.target.value }))} /></Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setNewContact(null)}>Cancel</button>
              <button type="button" style={{ ...s.btn, ...s.pri }} onClick={saveContact}>Save</button>
            </div>
          </div>
        </div>
      )}

      {openArt && <ArtDrawer key={openArt.id} art={openArt} onClose={() => setOpenArt(null)} onChanged={async () => {
        await load(); const { data } = await supabase.from('hiv_art').select('*, patients(full_name, phone, patient_number, age, gender)').eq('id', openArt.id).maybeSingle(); if (data) setOpenArt(data)
      }} />}
      {openTb && <TbDrawer key={openTb.id} ep={openTb} onClose={() => setOpenTb(null)} onChanged={async () => {
        await load(); const { data } = await supabase.from('tb_episodes').select('*, patients(full_name, phone, patient_number)').eq('id', openTb.id).maybeSingle(); if (data) setOpenTb(data)
      }} />}
    </section>
  )
}
