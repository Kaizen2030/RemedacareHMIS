// Maternity: ANC (8-contact schedule, EDD, risk flags, PMTCT), labour ward (partograph with alert/action
// lines), delivery and newborn records, PNC, child immunisation (KEPI) and register counts.
// Rules live in the database (20261119000000_hiv_tb_maternity.sql) and src/utils/maternity.js.
import { useCallback, useEffect, useMemo, useState } from 'react'
import MohRegister from './maternity/MohRegister'
import supabase from '../supabase'
import { useHospital } from '../context'
import PatientSearch from '../components/PatientSearch'
import { localDateKey } from '../utils/scheduling'
import { ancSchedule, gestation, immunisationStatus, partographAnalysis } from '../utils/maternity'
import { C, Chip, s } from './ncd/ui'
import usePatientAccessLog from '../hooks/useAccessLog'

const TABS = [['anc', 'ANC'], ['labour', 'Labour ward'], ['pnc', 'Postnatal'], ['imm', 'Immunisation'], ['registers', 'Registers']]
const today = () => localDateKey()
const Field = ({ label, id, children }) => <div><label style={s.label} htmlFor={id}>{label}</label>{children}</div>
const Modal = ({ title, onClose, children, width = 620 }) => (
  <div style={{ ...s.overlay, justifyContent: 'center', alignItems: 'center', padding: 16 }} role="dialog" aria-modal="true" aria-label={title}>
    <div style={{ ...s.card, width, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><h2 style={s.h2}>{title}</h2><button type="button" style={{ ...s.btn, ...s.ghost }} onClick={onClose}>Close</button></div>
      {children}
    </div>
  </div>
)
const num = (v) => (v === '' || v == null ? null : Number(v))

/** Cervix-vs-time chart with WHO alert and action lines. */
function Partograph({ entries }) {
  const a = partographAnalysis(entries)
  const pts = a.points.filter((p) => p.hours != null)
  const W = 520, H = 220, X = (h) => 40 + (h / 12) * (W - 60), Y = (cm) => H - 30 - ((cm - 0) / 10) * (H - 50)
  const start = pts[0]
  return (
    <div>
      <svg role="img" aria-label="Partograph: cervical dilatation over time" viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8 }}>
        {[0, 2, 4, 6, 8, 10].map((cm) => <g key={cm}><line x1={40} x2={W - 20} y1={Y(cm)} y2={Y(cm)} stroke="#EEF2F6" /><text x={10} y={Y(cm) + 4} fontSize="10" fill="#667085">{cm}</text></g>)}
        {[0, 2, 4, 6, 8, 10, 12].map((h) => <text key={h} x={X(h) - 4} y={H - 10} fontSize="10" fill="#667085">{h}h</text>)}
        {start && <>
          <line x1={X(0)} y1={Y(start.cm)} x2={X(10 - start.cm)} y2={Y(10)} stroke="#F79009" strokeWidth="2" strokeDasharray="6 4" />
          <text x={X(10 - start.cm) - 30} y={Y(10) - 4} fontSize="10" fill="#B54708">Alert</text>
          <line x1={X(4)} y1={Y(start.cm)} x2={X(4 + 10 - start.cm)} y2={Y(10)} stroke="#D92D20" strokeWidth="2" strokeDasharray="6 4" />
          <text x={Math.min(X(4 + 10 - start.cm), W - 40)} y={Y(10) - 4} fontSize="10" fill="#B42318">Action</text>
        </>}
        <polyline fill="none" stroke={C.primary} strokeWidth="2" points={pts.map((p) => `${X(p.hours)},${Y(p.cm)}`).join(' ')} />
        {pts.map((p, i) => <circle key={i} cx={X(p.hours)} cy={Y(p.cm)} r="4" fill={p.status === 'action' ? '#D92D20' : p.status === 'alert' ? '#F79009' : C.primary} />)}
      </svg>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        <Chip tone={a.status === 'action' ? 'red' : a.status === 'alert' ? 'yellow' : 'green'}>{String(a.status).replace('_', ' ')}</Chip>
        {(a.warnings || []).map((w) => <Chip key={w} tone="red">{w}</Chip>)}
      </div>
    </div>
  )
}

function PregnancyDrawer({ preg, onClose, onChanged }) {
  const recordAllowed = usePatientAccessLog(preg.hospital_id, preg.patient_id, 'maternity')
  const [contacts, setContacts] = useState([])
  const [f, setF] = useState({ visit_date: today(), bp_sys: '', bp_dia: '', weight_kg: '', fundal_height_cm: '', fetal_heart_rate: '', urine_protein: 'nil', hb: '', iptp_dose: '', td_dose: '', ifas_given: true, llin_given: false, danger_signs: '', notes: '', muac_cm: '', height_cm: '', rbs: '', hiv_test: '', syphilis_test: '', partner_hiv: '', tb_screening: 'negative', deworming: false, counselling: [], referred_to: '' })
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data } = await supabase.from('anc_contacts').select('*').eq('pregnancy_id', preg.id).order('visit_date')
    setContacts(data || [])
  }, [preg.id])
  useEffect(() => { void load() }, [load])
  const save = async () => {
    setErr('')
    const { error } = await supabase.from('anc_contacts').insert({ pregnancy_id: preg.id, hospital_id: preg.hospital_id, visit_date: f.visit_date, bp_sys: num(f.bp_sys), bp_dia: num(f.bp_dia), weight_kg: num(f.weight_kg),
      fundal_height_cm: num(f.fundal_height_cm), fetal_heart_rate: num(f.fetal_heart_rate), urine_protein: f.urine_protein, hb: num(f.hb), iptp_dose: num(f.iptp_dose), td_dose: num(f.td_dose),
      ifas_given: f.ifas_given, llin_given: f.llin_given, danger_signs: f.danger_signs || null, notes: f.notes || null,
      muac_cm: num(f.muac_cm), height_cm: num(f.height_cm), rbs: num(f.rbs), hiv_test: f.hiv_test || null, syphilis_test: f.syphilis_test || null, partner_hiv: f.partner_hiv || null,
      tb_screening: f.tb_screening || null, deworming: f.deworming, counselling: f.counselling, referred_to: f.referred_to || null })
    if (error) { setErr(error.message); return }
    setF((x) => ({ ...x, bp_sys: '', bp_dia: '', weight_kg: '', fundal_height_cm: '', fetal_heart_rate: '', hb: '', danger_signs: '', notes: '' }))
    await load(); onChanged()
  }
  const setStatus = async (status) => { const { error } = await supabase.from('anc_pregnancies').update({ status }).eq('id', preg.id); if (error) setErr(error.message); else onChanged() }
  const schedule = ancSchedule(preg.lmp, contacts)
  const ga = gestation(preg.lmp)
  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-label="Pregnancy" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.drawer}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <h2 style={{ ...s.h1, fontSize: 18 }}>{preg.patients?.full_name}</h2>
            <div style={s.sub}>ANC {preg.anc_number || '—'} · G{preg.gravida ?? '?'}P{preg.parity ?? '?'} · LMP {preg.lmp || '—'} · EDD <strong>{preg.edd || '—'}</strong>{ga ? ` · ${ga.label}` : ''}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {(preg.risk_flags || []).length === 0 ? <Chip tone="green">No risk flags</Chip> : preg.risk_flags.map((r) => <Chip key={r} tone="red">{r}</Chip>)}
            </div>
          </div>
          <button type="button" style={{ ...s.btn, ...s.ghost, alignSelf: 'flex-start' }} onClick={onClose}>Close</button>
        </div>
        {err && <div role="alert" style={{ ...s.err, marginTop: 10 }}>{err}</div>}
        {!recordAllowed && <div style={{ marginTop: 12 }}><div role="alert" style={{ padding: 16, background: '#FEF3F2', color: '#B42318', borderRadius: 10, fontWeight: 700 }}>This record is confidential. Open it again and give a reason to continue.</div></div>}
        {recordAllowed && <div style={{ ...s.card, marginTop: 12 }}>
          <h3 style={s.h2}>8-contact schedule</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {schedule.map((c) => <Chip key={c.contact} tone={c.state === 'done' ? 'green' : c.state === 'missed' ? 'red' : 'gray'}>#{c.contact} · {c.week}w · {c.state === 'done' ? 'done' : c.due}</Chip>)}
          </div>
        </div>}
        <div style={{ ...s.card, marginTop: 12, overflowX: 'auto' }}>
          <h3 style={s.h2}>Contacts</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['#', 'Date', 'GA', 'BP', 'Hb', 'Urine', 'FHR', 'Flags'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{contacts.map((c) => <tr key={c.id}><td style={s.td}>{c.contact_number}</td><td style={s.td}>{c.visit_date}</td><td style={s.td}>{c.ga_weeks}w</td><td style={s.td}>{c.bp_sys ? `${c.bp_sys}/${c.bp_dia}` : '—'}</td><td style={s.td}>{c.hb ?? '—'}</td><td style={s.td}>{c.urine_protein || '—'}</td><td style={s.td}>{c.fetal_heart_rate ?? '—'}</td><td style={s.td}>{(c.risk_flags || []).join(', ')}</td></tr>)}</tbody>
          </table>
        </div>
        {preg.status === 'active' && (
          <div style={{ ...s.card, marginTop: 12 }}>
            <h3 style={s.h2}>Record contact</h3>
            <div style={s.grid(120)}>
              <Field label="Date" id="c-date"><input id="c-date" type="date" style={s.input} value={f.visit_date} onChange={(e) => setF((x) => ({ ...x, visit_date: e.target.value }))} /></Field>
              {[['bp_sys', 'BP systolic'], ['bp_dia', 'BP diastolic'], ['weight_kg', 'Weight kg'], ['fundal_height_cm', 'Fundal height cm'], ['fetal_heart_rate', 'Fetal heart rate'], ['hb', 'Hb g/dL'], ['iptp_dose', 'IPTp-SP dose #'], ['td_dose', 'Td dose #'], ['muac_cm', 'MUAC cm'], ['height_cm', 'Height cm'], ['rbs', 'RBS mmol/L']].map(([k, l]) => (
                <Field key={k} label={l} id={`c-${k}`}><input id={`c-${k}`} type="number" step="0.1" style={s.input} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} /></Field>
              ))}
              <Field label="Urine protein" id="c-up"><select id="c-up" style={s.input} value={f.urine_protein} onChange={(e) => setF((x) => ({ ...x, urine_protein: e.target.value }))}>{['nil', 'trace', '+', '++', '+++'].map((v) => <option key={v}>{v}</option>)}</select></Field>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 12 }}>
              <label><input type="checkbox" checked={f.ifas_given} onChange={(e) => setF((x) => ({ ...x, ifas_given: e.target.checked }))} /> IFAS given</label>
              <label><input type="checkbox" checked={f.llin_given} onChange={(e) => setF((x) => ({ ...x, llin_given: e.target.checked }))} /> Mosquito net given</label>
              <label><input type="checkbox" checked={f.deworming} onChange={(e) => setF((x) => ({ ...x, deworming: e.target.checked }))} /> Dewormed</label>
            </div>
            <div style={{ ...s.grid(160), marginTop: 8 }}>
              <Field label="HIV (this visit)" id="c-hiv"><select id="c-hiv" style={s.input} value={f.hiv_test} onChange={(e) => setF((x) => ({ ...x, hiv_test: e.target.value }))}><option value="">—</option><option value="known_positive">Known positive</option><option value="tested_negative">Tested negative</option><option value="tested_positive">Tested positive</option><option value="not_tested">Not tested</option><option value="declined">Declined</option></select></Field>
              <Field label="Syphilis" id="c-syph"><select id="c-syph" style={s.input} value={f.syphilis_test} onChange={(e) => setF((x) => ({ ...x, syphilis_test: e.target.value }))}><option value="">—</option><option value="negative">Negative</option><option value="positive">Positive</option><option value="not_done">Not done</option></select></Field>
              <Field label="Partner HIV" id="c-phiv"><select id="c-phiv" style={s.input} value={f.partner_hiv} onChange={(e) => setF((x) => ({ ...x, partner_hiv: e.target.value }))}><option value="">—</option><option value="negative">Negative</option><option value="positive">Positive</option><option value="not_tested">Not tested</option><option value="unknown">Unknown</option></select></Field>
              <Field label="TB screening" id="c-tb"><select id="c-tb" style={s.input} value={f.tb_screening} onChange={(e) => setF((x) => ({ ...x, tb_screening: e.target.value }))}><option value="negative">Negative</option><option value="presumptive">Presumptive TB</option><option value="on_treatment">On TB treatment</option><option value="not_done">Not done</option></select></Field>
              <Field label="Referred to" id="c-ref"><input id="c-ref" style={s.input} value={f.referred_to} onChange={(e) => setF((x) => ({ ...x, referred_to: e.target.value }))} /></Field>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 12 }} aria-label="Counselling given">
              <b>Counselled on:</b>
              {['birth plan', 'danger signs', 'nutrition', 'breastfeeding', 'family planning', 'HIV / PMTCT', 'malaria prevention'].map((c) => (
                <label key={c}><input type="checkbox" checked={f.counselling.includes(c)} onChange={(e) => setF((x) => ({ ...x, counselling: e.target.checked ? [...x.counselling, c] : x.counselling.filter((y) => y !== c) }))} /> {c}</label>
              ))}
            </div>
            <div style={{ ...s.grid(220), marginTop: 8 }}>
              <Field label="Danger signs" id="c-ds"><input id="c-ds" style={s.input} value={f.danger_signs} placeholder="bleeding, headache, reduced fetal movements…" onChange={(e) => setF((x) => ({ ...x, danger_signs: e.target.value }))} /></Field>
              <Field label="Notes" id="c-notes"><input id="c-notes" style={s.input} value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} /></Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setStatus('loss')}>Pregnancy loss</button>
                <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setStatus('transferred_out')}>Transferred out</button>
              </div>
              <button type="button" style={{ ...s.btn, ...s.pri }} onClick={save}>Save contact</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LabourDrawer({ labour, onClose, onChanged }) {
  const [entries, setEntries] = useState([])
  const [e, setE] = useState({ cervix_cm: '', descent_fifths: '', contractions_10min: '', contraction_secs: '', fetal_heart_rate: '', liquor: 'I', bp_sys: '', bp_dia: '', pulse: '', temp_c: '' })
  const [dl, setDl] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data } = await supabase.from('partograph_entries').select('*').eq('labour_id', labour.id).order('recorded_at')
    setEntries(data || [])
  }, [labour.id])
  useEffect(() => { void load() }, [load])
  const addEntry = async () => {
    setErr('')
    const row = { labour_id: labour.id, hospital_id: labour.hospital_id, liquor: e.liquor }
    for (const k of ['cervix_cm', 'descent_fifths', 'contractions_10min', 'contraction_secs', 'fetal_heart_rate', 'bp_sys', 'bp_dia', 'pulse', 'temp_c']) row[k] = num(e[k])
    const { error } = await supabase.from('partograph_entries').insert(row)
    if (error) { setErr(error.message); return }
    setE((x) => ({ ...x, cervix_cm: '', fetal_heart_rate: '', contractions_10min: '', contraction_secs: '' }))
    await load()
  }
  const saveDelivery = async () => {
    setErr('')
    const { data: d, error } = await supabase.from('deliveries').insert({ hospital_id: labour.hospital_id, labour_id: labour.id, pregnancy_id: labour.pregnancy_id, patient_id: labour.patient_id,
      delivered_at: new Date(dl.at).toISOString(), mode: dl.mode, amtsl_oxytocin: dl.amtsl, blood_loss_ml: num(dl.blood), perineum: dl.perineum || null, maternal_outcome: dl.maternal, complications: dl.complications || null, delivered_by: dl.by || null,
      ip_number: dl.ip || null, placenta_complete: dl.placenta, uterotonic: dl.uterotonic || null, delivered_by_cadre: dl.cadre || null, mother_hiv: dl.mhiv || null, maternal_arv: dl.marv }).select('id').single()
    if (error) { setErr(error.message); return }
    const babies = dl.babies.map((b) => ({ hospital_id: labour.hospital_id, delivery_id: d.id, sex: b.sex, outcome: b.outcome, birth_weight_g: num(b.weight), apgar_1: num(b.a1), apgar_5: num(b.a5),
      resuscitated: b.resus, vitamin_k: b.vitk, teo: b.teo, bcg: b.bcg, opv0: b.opv0, breastfed_1h: b.bf, arv_prophylaxis: b.arv || null, chlorhexidine: b.chx, kmc: b.kmc }))
    const { error: e2 } = await supabase.from('newborns').insert(babies)
    if (e2) { setErr(e2.message); return }
    await supabase.from('labour_admissions').update({ status: 'delivered' }).eq('id', labour.id)
    if (labour.pregnancy_id) await supabase.from('anc_pregnancies').update({ status: 'delivered' }).eq('id', labour.pregnancy_id)
    setDl(null); onChanged(); onClose()
  }
  const baby = () => ({ sex: 'female', outcome: 'live_birth', weight: '', a1: '', a5: '', resus: false, vitk: true, teo: true, bcg: false, opv0: false, bf: true, arv: '', chx: true, kmc: false })
  return (
    <div style={s.overlay} role="dialog" aria-modal="true" aria-label="Labour" onClick={(ev) => { if (ev.target === ev.currentTarget) onClose() }}>
      <div style={{ ...s.drawer, width: 760 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div><h2 style={{ ...s.h1, fontSize: 18 }}>{labour.patients?.full_name}</h2><div style={s.sub}>Admitted {new Date(labour.admitted_at).toLocaleString('en-KE')} · {labour.status.replace('_', ' ')}</div></div>
          <button type="button" style={{ ...s.btn, ...s.ghost, alignSelf: 'flex-start' }} onClick={onClose}>Close</button>
        </div>
        {err && <div role="alert" style={{ ...s.err, marginTop: 10 }}>{err}</div>}
        <div style={{ ...s.card, marginTop: 12 }}><h3 style={s.h2}>Partograph</h3><Partograph entries={entries} /></div>
        {labour.status === 'in_labour' && !dl && (
          <div style={{ ...s.card, marginTop: 12 }}>
            <h3 style={s.h2}>New observation (now)</h3>
            <div style={s.grid(110)}>
              {[['cervix_cm', 'Cervix cm'], ['descent_fifths', 'Descent /5'], ['contractions_10min', 'Contractions /10 min'], ['contraction_secs', 'Lasting (s)'], ['fetal_heart_rate', 'FHR'], ['bp_sys', 'BP sys'], ['bp_dia', 'BP dia'], ['pulse', 'Pulse'], ['temp_c', 'Temp °C']].map(([k, l]) => (
                <Field key={k} label={l} id={`p-${k}`}><input id={`p-${k}`} type="number" step="0.1" style={s.input} value={e[k]} onChange={(ev) => setE((x) => ({ ...x, [k]: ev.target.value }))} /></Field>
              ))}
              <Field label="Liquor" id="p-liq"><select id="p-liq" style={s.input} value={e.liquor} onChange={(ev) => setE((x) => ({ ...x, liquor: ev.target.value }))}><option value="I">I — intact</option><option value="C">C — clear</option><option value="M">M — meconium</option><option value="B">B — blood</option><option value="A">A — absent</option></select></Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => setDl({ at: new Date().toISOString().slice(0, 16), mode: 'svd', amtsl: true, blood: '', perineum: '', maternal: 'alive', complications: '', by: '', ip: '', placenta: true, uterotonic: 'oxytocin', cadre: 'nurse_midwife', mhiv: '', marv: false, babies: [baby()] })}>Record delivery</button>
              <button type="button" style={{ ...s.btn, ...s.pri }} onClick={addEntry}>Save observation</button>
            </div>
          </div>
        )}
        {dl && (
          <div style={{ ...s.card, marginTop: 12 }}>
            <h3 style={s.h2}>Delivery</h3>
            <div style={s.grid(150)}>
              <Field label="Time of birth" id="d-at"><input id="d-at" type="datetime-local" style={s.input} value={dl.at} onChange={(ev) => setDl((x) => ({ ...x, at: ev.target.value }))} /></Field>
              <Field label="Mode" id="d-mode"><select id="d-mode" style={s.input} value={dl.mode} onChange={(ev) => setDl((x) => ({ ...x, mode: ev.target.value }))}><option value="svd">SVD</option><option value="assisted_vaginal">Assisted vaginal</option><option value="breech">Breech</option><option value="caesarean">Caesarean</option></select></Field>
              <Field label="Blood loss ml" id="d-bl"><input id="d-bl" type="number" style={s.input} value={dl.blood} onChange={(ev) => setDl((x) => ({ ...x, blood: ev.target.value }))} /></Field>
              <Field label="Mother" id="d-mo"><select id="d-mo" style={s.input} value={dl.maternal} onChange={(ev) => setDl((x) => ({ ...x, maternal: ev.target.value }))}><option value="alive">Alive</option><option value="referred">Referred</option><option value="died">Died</option></select></Field>
              <Field label="Perineum" id="d-per"><input id="d-per" style={s.input} value={dl.perineum} placeholder="intact, 1st degree…" onChange={(ev) => setDl((x) => ({ ...x, perineum: ev.target.value }))} /></Field>
              <Field label="Delivered by" id="d-by"><input id="d-by" style={s.input} value={dl.by} onChange={(ev) => setDl((x) => ({ ...x, by: ev.target.value }))} /></Field>
              <Field label="Cadre" id="d-cadre"><select id="d-cadre" style={s.input} value={dl.cadre} onChange={(ev) => setDl((x) => ({ ...x, cadre: ev.target.value }))}><option value="nurse_midwife">Nurse / midwife</option><option value="clinical_officer">Clinical officer</option><option value="doctor">Doctor</option><option value="other">Other</option></select></Field>
              <Field label="IP number" id="d-ip"><input id="d-ip" style={s.input} value={dl.ip} onChange={(ev) => setDl((x) => ({ ...x, ip: ev.target.value }))} /></Field>
              <Field label="Uterotonic" id="d-ut"><select id="d-ut" style={s.input} value={dl.uterotonic} onChange={(ev) => setDl((x) => ({ ...x, uterotonic: ev.target.value }))}><option value="oxytocin">Oxytocin</option><option value="carbetocin">Carbetocin</option><option value="misoprostol">Misoprostol</option><option value="ergometrine">Ergometrine</option><option value="none">None</option></select></Field>
              <Field label="Mother's HIV status" id="d-hiv"><select id="d-hiv" style={s.input} value={dl.mhiv} onChange={(ev) => setDl((x) => ({ ...x, mhiv: ev.target.value }))}><option value="">From ANC record</option><option value="negative">Negative</option><option value="positive">Positive</option><option value="unknown">Unknown</option></select></Field>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, marginTop: 8 }}>
              <label><input type="checkbox" checked={dl.placenta} onChange={(ev) => setDl((x) => ({ ...x, placenta: ev.target.checked }))} /> Placenta and membranes complete</label>
              <label><input type="checkbox" checked={dl.marv} onChange={(ev) => setDl((x) => ({ ...x, marv: ev.target.checked }))} /> ARVs given to mother</label>
            </div>
            <label style={{ display: 'block', fontSize: 12, marginTop: 8 }}><input type="checkbox" checked={dl.amtsl} onChange={(ev) => setDl((x) => ({ ...x, amtsl: ev.target.checked }))} /> Oxytocin 10 IU within 1 minute (AMTSL)</label>
            {Number(dl.blood) >= 500 && <div style={{ ...s.err, marginTop: 8 }}>Blood loss 500 ml or more: postpartum haemorrhage — follow the PPH protocol.</div>}
            {dl.babies.map((b, i) => (
              <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, marginTop: 10 }}>
                <strong>Baby {i + 1}</strong>
                <div style={{ ...s.grid(120), marginTop: 6 }}>
                  <Field label="Outcome" id={`b${i}-o`}><select id={`b${i}-o`} style={s.input} value={b.outcome} onChange={(ev) => setDl((x) => ({ ...x, babies: x.babies.map((y, j) => (j === i ? { ...y, outcome: ev.target.value } : y)) }))}><option value="live_birth">Live birth</option><option value="fresh_stillbirth">Fresh stillbirth</option><option value="macerated_stillbirth">Macerated stillbirth</option><option value="early_neonatal_death">Early neonatal death</option></select></Field>
                  <Field label="Sex" id={`b${i}-s`}><select id={`b${i}-s`} style={s.input} value={b.sex} onChange={(ev) => setDl((x) => ({ ...x, babies: x.babies.map((y, j) => (j === i ? { ...y, sex: ev.target.value } : y)) }))}><option value="female">Female</option><option value="male">Male</option><option value="indeterminate">Indeterminate</option></select></Field>
                  {[['weight', 'Weight g'], ['a1', 'APGAR 1'], ['a5', 'APGAR 5']].map(([k, l]) => <Field key={k} label={l} id={`b${i}-${k}`}><input id={`b${i}-${k}`} type="number" style={s.input} value={b[k]} onChange={(ev) => setDl((x) => ({ ...x, babies: x.babies.map((y, j) => (j === i ? { ...y, [k]: ev.target.value } : y)) }))} /></Field>)}
                  <Field label="ARV prophylaxis (HEI)" id={`b${i}-arv`}><input id={`b${i}-arv`} style={s.input} value={b.arv} placeholder="AZT+NVP" onChange={(ev) => setDl((x) => ({ ...x, babies: x.babies.map((y, j) => (j === i ? { ...y, arv: ev.target.value } : y)) }))} /></Field>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, marginTop: 6 }}>
                  {[['resus', 'Resuscitated'], ['vitk', 'Vitamin K'], ['teo', 'TEO'], ['chx', 'Chlorhexidine to cord'], ['bcg', 'BCG'], ['opv0', 'OPV0'], ['bf', 'Breastfed within 1 h'], ['kmc', 'Kangaroo mother care']].map(([k, l]) => (
                    <label key={k}><input type="checkbox" checked={b[k]} onChange={(ev) => setDl((x) => ({ ...x, babies: x.babies.map((y, j) => (j === i ? { ...y, [k]: ev.target.checked } : y)) }))} /> {l}</label>
                  ))}
                </div>
                {Number(b.weight) > 0 && Number(b.weight) < 2500 && <div style={{ color: C.danger, fontSize: 12, marginTop: 4 }}>Low birth weight — kangaroo mother care.</div>}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setDl((x) => ({ ...x, babies: [...x.babies, baby()] }))}>Add twin</button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setDl(null)}>Cancel</button>
                <button type="button" style={{ ...s.btn, ...s.pri }} onClick={saveDelivery}>Save delivery</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Maternity() {
  const { hospitalId } = useHospital()
  const [tab, setTab] = useState('anc')
  const [pregs, setPregs] = useState([])
  const [labours, setLabours] = useState([])
  const [pncs, setPncs] = useState([])
  const [err, setErr] = useState('')
  const [openPreg, setOpenPreg] = useState(null)
  const [openLabour, setOpenLabour] = useState(null)
  const [newPreg, setNewPreg] = useState(null)
  const [newLabour, setNewLabour] = useState(null)
  const [newPnc, setNewPnc] = useState(null)
  const [child, setChild] = useState(null)
  const [given, setGiven] = useState([])
  const [range, setRange] = useState({ from: localDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: today() })
  const [summary, setSummary] = useState(null)

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('anc_pregnancies').select('*, patients(full_name, phone, age)').eq('hospital_id', hospitalId).eq('status', 'active').order('next_contact_due', { ascending: true, nullsFirst: false }).limit(500),
      supabase.from('labour_admissions').select('*, patients(full_name, age)').eq('hospital_id', hospitalId).order('admitted_at', { ascending: false }).limit(100),
      supabase.from('pnc_visits').select('*, patients(full_name)').eq('hospital_id', hospitalId).order('visit_date', { ascending: false }).limit(100),
    ])
    const e = a.error || b.error
    setErr(e ? (/permission|row-level/i.test(e.message) ? 'Maternity records are visible to clinical staff only.' : `Not installed yet (${e.message}). Run docs/sql/08_hiv_tb_maternity.sql.`) : '')
    setPregs(a.data || []); setLabours(b.data || []); setPncs(c.data || [])
  }, [hospitalId])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])
  useEffect(() => {
    if (!child?.id) { setGiven([]); return }
    void supabase.from('immunisations').select('*').eq('patient_id', child.id).then(({ data }) => setGiven(data || []))
  }, [child?.id])

  const t = today()
  const savePreg = async () => {
    if (!newPreg.patient) { setErr('Pick the mother'); return }
    const { error } = await supabase.from('anc_pregnancies').insert({ hospital_id: hospitalId, patient_id: newPreg.patient.id, anc_number: newPreg.anc || null, lmp: newPreg.lmp || null, edd: newPreg.edd || null,
      gravida: num(newPreg.gravida), parity: num(newPreg.parity), hiv_status: newPreg.hiv || null, syphilis: newPreg.syph || null, hb_first: num(newPreg.hb), blood_group: newPreg.bg || null,
      manual_flags: newPreg.prevCs ? ['previous caesarean'] : [] })
    if (error) { setErr(/duplicate|unique/i.test(error.message) ? 'This mother already has an active pregnancy registered.' : error.message); return }
    setNewPreg(null); void load()
  }
  const saveLabour = async () => {
    if (!newLabour.patient) { setErr('Pick the mother'); return }
    const preg = pregs.find((p) => p.patient_id === newLabour.patient.id)
    const { error } = await supabase.from('labour_admissions').insert({ hospital_id: hospitalId, patient_id: newLabour.patient.id, pregnancy_id: preg?.id || null })
    if (error) { setErr(error.message); return }
    setNewLabour(null); void load()
  }
  const savePnc = async () => {
    if (!newPnc.patient) { setErr('Pick the mother'); return }
    const { error } = await supabase.from('pnc_visits').insert({ hospital_id: hospitalId, patient_id: newPnc.patient.id, visit_date: newPnc.date, timing: newPnc.timing, bp_sys: num(newPnc.bps), bp_dia: num(newPnc.bpd),
      temp_c: num(newPnc.temp), bleeding: newPnc.bleeding || null, baby_weight_g: num(newPnc.bw), baby_feeding: newPnc.feeding || null, fp_method: newPnc.fp || null, danger_signs: newPnc.danger || null })
    if (error) { setErr(error.message); return }
    setNewPnc(null); void load()
  }
  const giveVaccine = async (code) => {
    const { error } = await supabase.from('immunisations').insert({ hospital_id: hospitalId, patient_id: child.id, vaccine: code, given_on: t })
    if (error) { setErr(error.message); return }
    const { data } = await supabase.from('immunisations').select('*').eq('patient_id', child.id); setGiven(data || [])
  }
  const runSummary = async () => {
    const { data, error } = await supabase.rpc('programme_summary', { p_hospital: hospitalId, p_from: range.from, p_to: range.to })
    if (error) { setErr(error.message); return }
    setSummary(Object.fromEntries((data || []).map((r) => [r.indicator, Number(r.value)])))
  }
  const immun = useMemo(() => (child?.date_of_birth ? immunisationStatus(child.date_of_birth, given) : []), [child, given])

  const kpi = { active: pregs.length, highRisk: pregs.filter((p) => (p.risk_flags || []).length).length, overdue: pregs.filter((p) => p.next_contact_due && p.next_contact_due < t).length, inLabour: labours.filter((l) => l.status === 'in_labour').length }
  const LABELS = {
    anc_first_contacts: 'New ANC clients (1st contact)', anc_first_contact_before_12w: '1st contact at ≤ 12 weeks', anc_4th_contacts: '4th ANC contacts', anc_8th_contacts: '8th ANC contacts',
    deliveries: 'Deliveries', deliveries_caesarean: 'Caesarean sections', pph_500ml_plus: 'PPH (≥ 500 ml)', maternal_deaths: 'Maternal deaths', live_births: 'Live births',
    fresh_stillbirths: 'Fresh stillbirths', macerated_stillbirths: 'Macerated stillbirths', low_birth_weight: 'Low birth weight (< 2.5 kg)', pnc_48h: 'PNC within 48 h',
    immunised_penta3: 'Pentavalent 3 given', immunised_mr1: 'Measles-Rubella 1 given', hiv_tx_curr: 'On ART (TX_CURR)', hiv_tx_new: 'Started ART (TX_NEW)',
    hiv_vl_tested_12m: 'VL tested (last 12 m)', hiv_vl_suppressed_12m: 'VL suppressed (last 12 m)', hiv_vl_overdue: 'VL overdue', tb_notified: 'TB cases notified',
    tb_notified_bacteriological: 'TB bacteriologically confirmed', tb_hiv_positive: 'TB/HIV co-infected', tb_success: 'TB treatment success',
  }

  return (
    <section style={s.page}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div><h1 style={s.h1}>Maternity & child health</h1><p style={{ ...s.sub, margin: '5px 0 0' }}>ANC (WHO 8 contacts), labour with partograph, delivery, newborn, postnatal care and KEPI immunisation.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => setNewPreg({ patient: null, anc: '', lmp: '', edd: '', gravida: '', parity: '', hiv: '', syph: '', hb: '', bg: '', prevCs: false })}>Register pregnancy</button>
          <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => setNewLabour({ patient: null })}>Admit in labour</button>
        </div>
      </header>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ ...s.grid(160), marginBottom: 14 }}>
        {[['Active ANC', kpi.active, C.primary], ['With risk flags', kpi.highRisk, C.danger], ['Missed ANC contact', kpi.overdue, C.warn], ['In labour now', kpi.inLabour, '#175CD3']].map(([l, v, col]) => (
          <div key={l} style={s.card}><div style={s.label}>{l}</div><div style={{ fontSize: 24, fontWeight: 800, color: col }}>{v}</div></div>
        ))}
      </div>
      <nav role="tablist" style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 14, overflowX: 'auto' }}>
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} style={{ padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700, color: tab === k ? C.primary : C.sub, borderBottom: `2px solid ${tab === k ? C.primary : 'transparent'}`, whiteSpace: 'nowrap' }}>{l}</button>)}
      </nav>

      {tab === 'anc' && (
        <div style={{ ...s.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Mother', 'Gestation', 'EDD', 'Next contact', 'Risk flags'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{pregs.map((p) => {
              const ga = gestation(p.lmp); const od = p.next_contact_due && p.next_contact_due < t
              return (
                <tr key={p.id} onClick={() => setOpenPreg(p)} style={{ cursor: 'pointer' }}>
                  <td style={s.td}><strong>{p.patients?.full_name}</strong><div style={s.sub}>{[p.anc_number, p.patients?.phone].filter(Boolean).join(' · ')}</div></td>
                  <td style={s.td}>{ga?.label || '—'}</td><td style={s.td}>{p.edd || '—'}</td>
                  <td style={{ ...s.td, color: od ? C.danger : undefined, fontWeight: od ? 700 : 400 }}>{p.next_contact_due ? `${od ? 'missed ' : ''}${p.next_contact_due}` : '—'}</td>
                  <td style={s.td}><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{(p.risk_flags || []).map((r) => <Chip key={r} tone="red">{r}</Chip>)}</div></td>
                </tr>
              )
            })}</tbody>
          </table>
          {pregs.length === 0 && <div style={{ ...s.sub, padding: 16, textAlign: 'center' }}>No active pregnancies.</div>}
        </div>
      )}

      {tab === 'labour' && (
        <div style={{ ...s.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Mother', 'Admitted', 'Status'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{labours.map((l) => (
              <tr key={l.id} onClick={() => setOpenLabour(l)} style={{ cursor: 'pointer' }}>
                <td style={s.td}><strong>{l.patients?.full_name}</strong></td><td style={s.td}>{new Date(l.admitted_at).toLocaleString('en-KE')}</td>
                <td style={s.td}><Chip tone={l.status === 'in_labour' ? 'yellow' : 'green'}>{l.status.replace('_', ' ')}</Chip></td>
              </tr>
            ))}</tbody>
          </table>
          {labours.length === 0 && <div style={{ ...s.sub, padding: 16, textAlign: 'center' }}>No one in labour.</div>}
        </div>
      )}

      {tab === 'pnc' && (
        <div style={s.card}>
          <button type="button" style={{ ...s.btn, ...s.pri, marginBottom: 10 }} onClick={() => setNewPnc({ patient: null, date: t, timing: '48h', bps: '', bpd: '', temp: '', bleeding: '', bw: '', feeding: 'exclusive breastfeeding', fp: '', danger: '' })}>Record PNC visit</button>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Mother', 'Date', 'Timing', 'BP', 'Baby weight', 'FP', 'Danger signs'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{pncs.map((v) => <tr key={v.id}><td style={s.td}>{v.patients?.full_name}</td><td style={s.td}>{v.visit_date}</td><td style={s.td}>{v.timing}</td><td style={s.td}>{v.bp_sys ? `${v.bp_sys}/${v.bp_dia}` : '—'}</td><td style={s.td}>{v.baby_weight_g ?? '—'}</td><td style={s.td}>{v.fp_method || '—'}</td><td style={s.td}>{v.danger_signs || '—'}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {tab === 'imm' && (
        <div style={s.card}>
          <Field label="Child" id="imm-child"><PatientSearch id="imm-child" hospitalId={hospitalId} inputStyle={{ ...s.input, maxWidth: 420 }} value={child} onPick={setChild} /></Field>
          {child && !child.date_of_birth && <div style={{ ...s.err, marginTop: 10 }}>Add the child's date of birth on the patient record to see the schedule.</div>}
          {immun.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
              <thead><tr>{['Vaccine', 'Due', 'Status', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>{immun.map((v) => (
                <tr key={v.code}>
                  <td style={s.td}>{v.label}</td><td style={s.td}>{v.due}</td>
                  <td style={s.td}><Chip tone={{ given: 'green', overdue: 'red', due: 'yellow', window_passed: 'gray', upcoming: 'blue' }[v.state]}>{v.state === 'given' ? `given ${v.givenOn}` : v.state.replace('_', ' ')}</Chip></td>
                  <td style={s.td}>{v.state !== 'given' && v.state !== 'window_passed' && v.state !== 'upcoming' && <button type="button" style={{ ...s.btn, ...s.soft, padding: '4px 9px' }} onClick={() => giveVaccine(v.code)}>Give today</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'registers' && (
        <div style={s.card}>
          <div style={{ ...s.grid(160), alignItems: 'end' }}>
            <Field label="From" id="r-from"><input id="r-from" type="date" style={s.input} value={range.from} onChange={(e) => setRange((x) => ({ ...x, from: e.target.value }))} /></Field>
            <Field label="To" id="r-to"><input id="r-to" type="date" style={s.input} value={range.to} onChange={(e) => setRange((x) => ({ ...x, to: e.target.value }))} /></Field>
            <button type="button" style={{ ...s.btn, ...s.pri }} onClick={runSummary}>Count</button>
          </div>
          {summary && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
              <tbody>{Object.entries(LABELS).map(([k, l]) => <tr key={k}><td style={s.td}>{l}</td><td style={{ ...s.td, fontWeight: 800, textAlign: 'right' }}>{summary[k] ?? 0}</td></tr>)}</tbody>
            </table>
          )}
          <div style={{ ...s.sub, marginTop: 8 }}>These counts feed MOH 711 (maternal & child health), MOH 731 (HIV) and TB reporting.</div>
          <MohRegister hospitalId={hospitalId} range={range} />
        </div>
      )}

      {newPreg && (
        <Modal title="Register pregnancy" onClose={() => setNewPreg(null)}>
          <Field label="Mother" id="np-p"><PatientSearch id="np-p" hospitalId={hospitalId} inputStyle={s.input} value={newPreg.patient} onPick={(p) => setNewPreg((x) => ({ ...x, patient: p }))} /></Field>
          <div style={{ ...s.grid(140), marginTop: 10 }}>
            <Field label="ANC number" id="np-anc"><input id="np-anc" style={s.input} value={newPreg.anc} onChange={(e) => setNewPreg((x) => ({ ...x, anc: e.target.value }))} /></Field>
            <Field label="LMP" id="np-lmp"><input id="np-lmp" type="date" max={t} style={s.input} value={newPreg.lmp} onChange={(e) => setNewPreg((x) => ({ ...x, lmp: e.target.value }))} /></Field>
            <Field label="EDD (if no LMP, e.g. by scan)" id="np-edd"><input id="np-edd" type="date" style={s.input} value={newPreg.edd} onChange={(e) => setNewPreg((x) => ({ ...x, edd: e.target.value }))} /></Field>
            <Field label="Gravida" id="np-g"><input id="np-g" type="number" min={1} style={s.input} value={newPreg.gravida} onChange={(e) => setNewPreg((x) => ({ ...x, gravida: e.target.value }))} /></Field>
            <Field label="Parity" id="np-par"><input id="np-par" type="number" min={0} style={s.input} value={newPreg.parity} onChange={(e) => setNewPreg((x) => ({ ...x, parity: e.target.value }))} /></Field>
            <Field label="HIV" id="np-hiv"><select id="np-hiv" style={s.input} value={newPreg.hiv} onChange={(e) => setNewPreg((x) => ({ ...x, hiv: e.target.value }))}><option value="">—</option><option value="negative">Negative</option><option value="positive">Positive (new)</option><option value="known_positive">Known positive</option><option value="unknown">Not tested</option></select></Field>
            <Field label="Syphilis" id="np-sy"><select id="np-sy" style={s.input} value={newPreg.syph} onChange={(e) => setNewPreg((x) => ({ ...x, syph: e.target.value }))}><option value="">—</option><option value="negative">Negative</option><option value="positive">Positive</option><option value="unknown">Not tested</option></select></Field>
            <Field label="Hb at booking" id="np-hb"><input id="np-hb" type="number" step="0.1" style={s.input} value={newPreg.hb} onChange={(e) => setNewPreg((x) => ({ ...x, hb: e.target.value }))} /></Field>
            <Field label="Blood group" id="np-bg"><input id="np-bg" style={s.input} value={newPreg.bg} onChange={(e) => setNewPreg((x) => ({ ...x, bg: e.target.value }))} /></Field>
          </div>
          <label style={{ display: 'block', fontSize: 12, marginTop: 8 }}><input type="checkbox" checked={newPreg.prevCs} onChange={(e) => setNewPreg((x) => ({ ...x, prevCs: e.target.checked }))} /> Previous caesarean section</label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={savePreg}>Register</button></div>
        </Modal>
      )}
      {newLabour && (
        <Modal title="Admit in labour" onClose={() => setNewLabour(null)} width={480}>
          <Field label="Mother" id="nl-p"><PatientSearch id="nl-p" hospitalId={hospitalId} inputStyle={s.input} value={newLabour.patient} onPick={(p) => setNewLabour({ patient: p })} /></Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={saveLabour}>Admit</button></div>
        </Modal>
      )}
      {newPnc && (
        <Modal title="Postnatal visit" onClose={() => setNewPnc(null)}>
          <Field label="Mother" id="pn-p"><PatientSearch id="pn-p" hospitalId={hospitalId} inputStyle={s.input} value={newPnc.patient} onPick={(p) => setNewPnc((x) => ({ ...x, patient: p }))} /></Field>
          <div style={{ ...s.grid(140), marginTop: 10 }}>
            <Field label="Date" id="pn-d"><input id="pn-d" type="date" style={s.input} value={newPnc.date} onChange={(e) => setNewPnc((x) => ({ ...x, date: e.target.value }))} /></Field>
            <Field label="Timing" id="pn-t"><select id="pn-t" style={s.input} value={newPnc.timing} onChange={(e) => setNewPnc((x) => ({ ...x, timing: e.target.value }))}><option value="48h">Within 48 h</option><option value="3-7d">3–7 days</option><option value="1-2wk">1–2 weeks</option><option value="4-6wk">4–6 weeks</option><option value="other">Other</option></select></Field>
            {[['bps', 'BP sys'], ['bpd', 'BP dia'], ['temp', 'Temp °C'], ['bw', 'Baby weight g']].map(([k, l]) => <Field key={k} label={l} id={`pn-${k}`}><input id={`pn-${k}`} type="number" style={s.input} value={newPnc[k]} onChange={(e) => setNewPnc((x) => ({ ...x, [k]: e.target.value }))} /></Field>)}
            <Field label="Bleeding" id="pn-bl"><input id="pn-bl" style={s.input} value={newPnc.bleeding} onChange={(e) => setNewPnc((x) => ({ ...x, bleeding: e.target.value }))} /></Field>
            <Field label="Feeding" id="pn-f"><input id="pn-f" style={s.input} value={newPnc.feeding} onChange={(e) => setNewPnc((x) => ({ ...x, feeding: e.target.value }))} /></Field>
            <Field label="Family planning" id="pn-fp"><input id="pn-fp" style={s.input} value={newPnc.fp} onChange={(e) => setNewPnc((x) => ({ ...x, fp: e.target.value }))} /></Field>
            <Field label="Danger signs" id="pn-ds"><input id="pn-ds" style={s.input} value={newPnc.danger} onChange={(e) => setNewPnc((x) => ({ ...x, danger: e.target.value }))} /></Field>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="button" style={{ ...s.btn, ...s.pri }} onClick={savePnc}>Save</button></div>
        </Modal>
      )}
      {openPreg && <PregnancyDrawer key={openPreg.id} preg={openPreg} onClose={() => setOpenPreg(null)} onChanged={async () => {
        await load(); const { data } = await supabase.from('anc_pregnancies').select('*, patients(full_name, phone, age)').eq('id', openPreg.id).maybeSingle(); if (data) setOpenPreg(data)
      }} />}
      {openLabour && <LabourDrawer key={openLabour.id} labour={openLabour} onClose={() => setOpenLabour(null)} onChanged={() => void load()} />}
    </section>
  )
}
