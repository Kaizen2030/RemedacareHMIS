// Service desk for the support departments (Housekeeping, Kitchen, Maintenance, Transport, Security, Medical Records,
// IT, Administration): request board with checklists and verification, registers, log books, special panels and a
// report. What each department has is defined in supportConfig.js.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import PatientSearch from '../../components/PatientSearch'
import DiagnosisPicker from '../../components/DiagnosisPicker'
import { C, Chip, s } from '../ncd/ui'
import { OPEN_STATUSES, PRIORITIES, STATUS_LABEL, SUPPORT_DEPARTMENTS, checklistFor, nextPpm, summarise, tempAlert } from './supportConfig'

const TAB_LABEL = { board: 'Requests', assets: 'Register', report: 'Report', production: 'Production plan', coding: 'Coding', status: 'System status', kpis: 'Dashboard' }
const PRIORITY_TONE = { emergency: 'red', urgent: 'yellow', routine: 'blue', low: 'gray' }
const STATUS_TONE = { open: 'gray', assigned: 'blue', in_progress: 'blue', on_hold: 'yellow', done: 'green', verified: 'green', cancelled: 'gray' }
const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Not installed yet. Run docs/sql/19_support_services.sql in Supabase.'
  if (/row-level|permission/i.test(m)) return 'You are not allowed to do that here.'
  return m
}
const when = (v) => (v ? new Date(v).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const pretty = (k) => String(k || '').replace(/_/g, ' ')

export default function SupportDesk({ department, hospitalId }) {
  const cfg = SUPPORT_DEPARTMENTS[department]
  const [tab, setTab] = useState(cfg?.tabs?.[0] || 'board')
  const [me, setMe] = useState('')
  useEffect(() => { void supabase.auth.getUser().then(({ data }) => setMe(data?.user?.email || '')).catch(() => {}) }, [])
  useEffect(() => { setTab(cfg?.tabs?.[0] || 'board') }, [department]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!cfg || !hospitalId) return null

  const label = (t) => (t.startsWith('log:') ? cfg.logs[t.slice(4)]?.label : t === 'assets' ? (cfg.code === 'transport' ? 'Vehicles' : cfg.code === 'admin' ? 'Contracts & licences' : 'Register') : TAB_LABEL[t])
  return (
    <section style={{ ...s.card, marginBottom: 14 }} aria-label={`${cfg.title} service desk`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2 style={{ ...s.h2, marginBottom: 2 }}>{cfg.title} desk</h2>
          <div style={s.sub}>{cfg.intro}</div>
        </div>
      </div>
      <div role="tablist" aria-label={`${cfg.title} sections`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
        {cfg.tabs.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={{ ...s.btn, ...(tab === t ? s.pri : s.ghost) }}>{label(t)}</button>)}
      </div>
      {tab === 'board' && <RequestBoard cfg={cfg} hospitalId={hospitalId} me={me} />}
      {tab === 'assets' && <AssetRegister cfg={cfg} hospitalId={hospitalId} />}
      {tab.startsWith('log:') && <LogBook cfg={cfg} kind={tab.slice(4)} hospitalId={hospitalId} me={me} />}
      {tab === 'report' && <Report cfg={cfg} hospitalId={hospitalId} />}
      {tab === 'production' && <KitchenProduction hospitalId={hospitalId} />}
      {tab === 'coding' && <CodingWorkspace hospitalId={hospitalId} />}
      {tab === 'status' && <SystemStatus cfg={cfg} hospitalId={hospitalId} me={me} />}
      {tab === 'kpis' && <ExecDashboard hospitalId={hospitalId} />}
    </section>
  )
}

// ---------------------------------------------------------------- shared field input
function FieldInput({ field, value, onChange, hospitalId, assets, idPrefix }) {
  const id = `${idPrefix}-${field.key}`
  const box = (input) => <div><label style={s.label} htmlFor={id}>{field.label}{field.required ? ' *' : ''}</label>{input}</div>
  if (field.type === 'patient') return box(<PatientSearch id={id} hospitalId={hospitalId} inputStyle={s.input} value={value || null} onPick={onChange} />)
  if (field.type === 'select') return box(<select id={id} style={s.input} value={value || ''} onChange={(e) => onChange(e.target.value)}><option value="">Choose…</option>{field.options.map((o) => <option key={o}>{o}</option>)}</select>)
  if (field.type === 'asset') return box(<select id={id} style={s.input} value={value || ''} onChange={(e) => onChange(e.target.value)}><option value="">{assets?.length ? 'Choose…' : 'None registered yet'}</option>{(assets || []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.code ? ` (${a.code})` : ''}</option>)}</select>)
  if (field.type === 'textarea') return box(<textarea id={id} style={{ ...s.input, minHeight: 60 }} placeholder={field.placeholder} value={value || ''} onChange={(e) => onChange(e.target.value)} />)
  return box(<input id={id} style={s.input} type={field.type || 'text'} placeholder={field.placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />)
}

function useAssets(hospitalId, department) {
  const [assets, setAssets] = useState([])
  const load = useCallback(async () => {
    const { data } = await supabase.from('service_assets').select('*').eq('hospital_id', hospitalId).eq('department', department).order('name')
    setAssets(data || [])
  }, [hospitalId, department])
  useEffect(() => { void load() }, [load])
  return [assets, load]
}

// ---------------------------------------------------------------- requests
function RequestBoard({ cfg, hospitalId, me }) {
  const kinds = Object.entries(cfg.kinds)
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('open')
  const [open, setOpen] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ kind: kinds[0][0], title: '', priority: kinds[0][1].priority, location: '', description: '', details: {} })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [assets] = useAssets(hospitalId, cfg.code === 'transport' ? 'transport' : cfg.code === 'it' ? 'it' : 'maintenance')
  const [settings, setSettings] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('service_requests').select('*').eq('hospital_id', hospitalId).eq('department', cfg.code).order('created_at', { ascending: false }).limit(300)
    if (error) setErr(friendly(error))
    setRows(data || [])
  }, [hospitalId, cfg.code])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!cfg.settings) return
    void supabase.from('service_settings').select('*').eq('hospital_id', hospitalId).maybeSingle().then(({ data }) => setSettings(data || { hold_beds_for_cleaning: false }))
  }, [cfg.settings, hospitalId])

  const now = new Date()
  const shown = rows.filter((r) => filter === 'all' ? true
    : filter === 'open' ? OPEN_STATUSES.includes(r.status)
      : filter === 'overdue' ? OPEN_STATUSES.includes(r.status) && r.due_at && new Date(r.due_at) < now
        : filter === 'verify' ? r.status === 'done'
          : filter === 'mine' ? OPEN_STATUSES.includes(r.status) && me && String(r.assigned_to || '').toLowerCase().includes(me.split('@')[0].toLowerCase())
            : true)
  const k = cfg.kinds[form.kind]

  async function create(e) {
    e.preventDefault(); setErr(''); setMsg('')
    const missing = (k.fields || []).find((f) => f.required && !form.details[f.key])
    if (missing) { setErr(`Fill in "${missing.label}".`); return }
    const details = { ...form.details }
    const patient = details.patient
    if (patient) { details.patient_name = patient.full_name; delete details.patient }
    const assetId = details.asset || details.vehicle || null
    const title = form.title.trim() || [k.label, details.area_type, details.category, details.type, details.to && `to ${details.to}`, details.missing, details.change, details.item, details.equipment].filter(Boolean).join(' — ')
    const row = {
      hospital_id: hospitalId, department: cfg.code, kind: form.kind, title: title.slice(0, 200), priority: form.priority,
      location: form.location || null, description: form.description || null, details, checklist: checklistFor(cfg, form.kind, form.details),
      patient_id: patient?.id || null, asset_id: assetId && /^[0-9a-f-]{36}$/i.test(assetId) ? assetId : null, requested_by_name: me || null,
      ...(details.due ? { due_at: new Date(`${details.due}T17:00:00`).toISOString() } : {}),
    }
    const { error } = await supabase.from('service_requests').insert(row)
    if (error) { setErr(friendly(error)); return }
    setMsg('Request created.'); setShowNew(false)
    setForm({ kind: form.kind, title: '', priority: k.priority, location: '', description: '', details: {} })
    void load()
  }
  async function saveHold(v) {
    const { error } = await supabase.from('service_settings').upsert({ hospital_id: hospitalId, hold_beds_for_cleaning: v }, { onConflict: 'hospital_id' })
    if (error) setErr(/row-level|permission/i.test(error.message) ? 'Only administrators can change this.' : friendly(error)); else setSettings({ ...settings, hold_beds_for_cleaning: v })
  }

  const counts = { open: rows.filter((r) => OPEN_STATUSES.includes(r.status)).length, overdue: rows.filter((r) => OPEN_STATUSES.includes(r.status) && r.due_at && new Date(r.due_at) < now).length, verify: rows.filter((r) => r.status === 'done').length }
  return (
    <div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {msg && <div role="status" style={s.ok}>{msg}</div>}
      {settings && cfg.settings?.includes('hold_beds_for_cleaning') && (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 10 }}>
          <input type="checkbox" checked={Boolean(settings.hold_beds_for_cleaning)} onChange={(e) => saveHold(e.target.checked)} />
          Hold discharged beds as “Cleaning” until housekeeping finishes (admins). Off: the clean is still created but the bed is free at once.
        </label>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {[['open', `Open (${counts.open})`], ['overdue', `Overdue (${counts.overdue})`], ['verify', `To verify (${counts.verify})`], ['mine', 'Assigned to me'], ['all', 'All']].map(([f, l]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} style={{ ...s.btn, ...(filter === f ? s.soft : s.ghost), ...(f === 'overdue' && counts.overdue ? { color: C.danger } : {}) }}>{l}</button>
        ))}
        <button type="button" style={{ ...s.btn, ...s.pri, marginLeft: 'auto' }} onClick={() => setShowNew((v) => !v)}>{showNew ? 'Close form' : '+ New request'}</button>
      </div>

      {showNew && (
        <form onSubmit={create} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={s.grid(190)}>
            <div><label style={s.label} htmlFor={`${cfg.code}-kind`}>Type</label>
              <select id={`${cfg.code}-kind`} style={s.input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, priority: cfg.kinds[e.target.value].priority, details: {} })}>
                {kinds.map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
              </select></div>
            <div><label style={s.label} htmlFor={`${cfg.code}-prio`}>Priority</label>
              <select id={`${cfg.code}-prio`} style={s.input} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
            <div><label style={s.label} htmlFor={`${cfg.code}-loc`}>Location</label><input id={`${cfg.code}-loc`} style={s.input} placeholder="Ward, room, bed or place" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            {(k.fields || []).map((f) => <FieldInput key={f.key} field={f} idPrefix={`${cfg.code}-new`} hospitalId={hospitalId} assets={assets} value={form.details[f.key]} onChange={(v) => setForm({ ...form, details: { ...form.details, [f.key]: v } })} />)}
          </div>
          <div style={{ ...s.grid(260), marginTop: 8 }}>
            <div><label style={s.label} htmlFor={`${cfg.code}-title`}>Short title (optional)</label><input id={`${cfg.code}-title`} style={s.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><label style={s.label} htmlFor={`${cfg.code}-desc`}>Details</label><textarea id={`${cfg.code}-desc`} style={{ ...s.input, minHeight: 40 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          {checklistFor(cfg, form.kind, form.details).length > 0 && <div style={{ ...s.sub, marginTop: 6 }}>Comes with a {checklistFor(cfg, form.kind, form.details).length}-item checklist.</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button type="submit" style={{ ...s.btn, ...s.pri }}>Create request</button></div>
        </form>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shown.map((r) => {
          const overdue = OPEN_STATUSES.includes(r.status) && r.due_at && new Date(r.due_at) < now
          const ticks = (r.checklist || []).filter((i) => i.done).length
          return (
            <button key={r.id} type="button" onClick={() => setOpen(r)} style={{ textAlign: 'left', border: `1px solid ${overdue ? C.danger : C.border}`, background: '#fff', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span>
                <b>{r.title}</b>
                <span style={{ ...s.sub, display: 'block' }}>{[cfg.kinds[r.kind]?.label || pretty(r.kind), r.location, r.details?.patient_name, r.assigned_to && `→ ${r.assigned_to}`].filter(Boolean).join(' · ')}</span>
              </span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {r.checklist?.length > 0 && <span style={s.sub}>{ticks}/{r.checklist.length} ✓</span>}
                <Chip tone={PRIORITY_TONE[r.priority]}>{r.priority}</Chip>
                <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                <span style={{ fontSize: 11, color: overdue ? C.danger : C.sub, fontWeight: overdue ? 700 : 400 }}>{OPEN_STATUSES.includes(r.status) ? `due ${when(r.due_at)}` : when(r.completed_at || r.updated_at)}</span>
              </span>
            </button>
          )
        })}
        {shown.length === 0 && !err && <div style={{ ...s.sub, padding: 10 }}>Nothing here.</div>}
      </div>
      {open && <RequestDrawer cfg={cfg} request={open} me={me} onClose={() => setOpen(null)} onChanged={(r) => { setOpen(r); void load() }} />}
    </div>
  )
}

function RequestDrawer({ cfg, request, me, onClose, onChanged }) {
  const [r, setR] = useState(request)
  const [assignee, setAssignee] = useState(request.assigned_to || '')
  const [outcome, setOutcome] = useState(request.outcome || '')
  const [extra, setExtra] = useState({})
  const [err, setErr] = useState('')
  useEffect(() => { setR(request) }, [request])
  const k = cfg.kinds[r.kind] || {}
  const closed = ['verified', 'cancelled'].includes(r.status)

  async function update(patch) {
    setErr('')
    const { data, error } = await supabase.from('service_requests').update(patch).eq('id', r.id).select().single()
    if (error) { setErr(friendly(error).replace('You are not allowed to do that here.', 'Not allowed: ' + error.message)); return }
    setR(data); onChanged(data)
  }
  const tick = (i) => update({ checklist: r.checklist.map((x, n) => (n === i ? { ...x, done: !x.done } : x)) })
  const complete = () => {
    const missing = (k.completeFields || []).find((f) => f.required && !extra[f.key])
    if (missing) { setErr(`Fill in "${missing.label}".`); return }
    update({ status: 'done', outcome: outcome || null, details: { ...r.details, ...extra } })
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={r.title} style={s.drawer} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <h2 style={{ ...s.h2, fontSize: 18 }}>{r.title}</h2>
          <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={onClose}>Close</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <Chip tone={PRIORITY_TONE[r.priority]}>{r.priority}</Chip><Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
          <span style={s.sub}>Raised {when(r.created_at)} by {r.requested_by_name || 'staff'} · due {when(r.due_at)}</span>
        </div>
        {err && <div role="alert" style={s.err}>{err}</div>}
        <div style={{ fontSize: 13, marginBottom: 10 }}>
          {r.location && <div><b>Location:</b> {r.location}</div>}
          {Object.entries(r.details || {}).filter(([, v]) => v !== '' && v !== null && typeof v !== 'object').map(([key, v]) => <div key={key}><b>{pretty(key)}:</b> {String(v)}</div>)}
          {r.description && <p style={{ whiteSpace: 'pre-wrap' }}>{r.description}</p>}
        </div>

        {r.checklist?.length > 0 && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <div style={s.label}>Checklist</div>
            {r.checklist.map((i, n) => (
              <label key={n} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, padding: '4px 0' }}>
                <input type="checkbox" checked={Boolean(i.done)} disabled={closed || r.status === 'done'} onChange={() => tick(n)} />
                <span>{i.label}{i.required ? ' *' : ''}</span>
              </label>
            ))}
          </div>
        )}

        {!closed && r.status !== 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input aria-label="Assign to" style={s.input} placeholder="Assign to (name)" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => update({ assigned_to: assignee || null })}>Assign</button>
              {me && <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => { setAssignee(me); void update({ assigned_to: me }) }}>Me</button>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {r.status !== 'in_progress' && <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => update({ status: 'in_progress' })}>Start</button>}
              {r.status !== 'on_hold' && <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => update({ status: 'on_hold' })}>On hold</button>}
              <button type="button" style={{ ...s.btn, ...s.danger }} onClick={() => update({ status: 'cancelled', outcome: outcome || 'Cancelled' })}>Cancel request</button>
            </div>
            {(k.completeFields || []).map((f) => <FieldInput key={f.key} field={f} idPrefix={`done-${r.id}`} value={extra[f.key]} onChange={(v) => setExtra({ ...extra, [f.key]: v })} />)}
            <label style={s.label} htmlFor={`outcome-${r.id}`}>What was done</label>
            <textarea id={`outcome-${r.id}`} style={{ ...s.input, minHeight: 50 }} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
            <button type="button" style={{ ...s.btn, ...s.pri }} onClick={complete}>Mark done</button>
          </div>
        )}
        {r.status === 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={s.ok}>Done {when(r.completed_at)}{r.outcome ? ` — ${r.outcome}` : ''}. A supervisor (not the person who did it) now checks and verifies.</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => update({ status: 'verified' })}>Verify</button>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => update({ status: 'in_progress', outcome: `Re-opened: ${outcome || 'not acceptable'}` })}>Reject — redo</button>
            </div>
          </div>
        )}
        {closed && <div style={s.ok}>{STATUS_LABEL[r.status]} {when(r.verified_at || r.updated_at)}{r.outcome ? ` — ${r.outcome}` : ''}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- registers
function AssetRegister({ cfg, hospitalId }) {
  const def = cfg.assets
  const [assets, load] = useAssets(hospitalId, cfg.code)
  const [form, setForm] = useState({ kind: Object.keys(def.kinds)[0], name: '', code: '', location: '', status: def.statuses[0], ppm_every_days: '', last_ppm_on: '', expires_on: '', details: {} })
  const [err, setErr] = useState('')
  const today = new Date().toISOString().slice(0, 10)

  async function add(e) {
    e.preventDefault(); setErr('')
    if (!form.name.trim()) { setErr('Give it a name.'); return }
    const { error } = await supabase.from('service_assets').insert({
      hospital_id: hospitalId, department: cfg.code, kind: form.kind, name: form.name.trim(), code: form.code || null, location: form.location || null, status: form.status,
      ppm_every_days: form.ppm_every_days ? Number(form.ppm_every_days) : null, last_ppm_on: form.last_ppm_on || null, expires_on: form.expires_on || null, details: form.details,
    })
    if (error) setErr(friendly(error)); else { setForm({ ...form, name: '', code: '', location: '', details: {} }); void load() }
  }
  async function setStatus(a, status) {
    const { error } = await supabase.from('service_assets').update({ status }).eq('id', a.id)
    if (error) setErr(friendly(error)); else void load()
  }
  async function ppmDone(a) {
    const { error } = await supabase.rpc('service_ppm_done', { p_asset: a.id, p_notes: null })
    if (error) setErr(friendly(error)); else void load()
  }
  return (
    <div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <form onSubmit={add} style={{ ...s.grid(160), alignItems: 'end', border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div><label style={s.label} htmlFor={`${cfg.code}-akind`}>Kind</label><select id={`${cfg.code}-akind`} style={s.input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{Object.entries(def.kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label style={s.label} htmlFor={`${cfg.code}-aname`}>Name *</label><input id={`${cfg.code}-aname`} style={s.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label style={s.label} htmlFor={`${cfg.code}-acode`}>{cfg.code === 'transport' ? 'Registration' : 'Tag / serial'}</label><input id={`${cfg.code}-acode`} style={s.input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
        <div><label style={s.label} htmlFor={`${cfg.code}-aloc`}>Location / holder</label><input id={`${cfg.code}-aloc`} style={s.input} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
        {def.ppm && <div><label style={s.label} htmlFor={`${cfg.code}-appm`}>Service every (days)</label><input id={`${cfg.code}-appm`} type="number" min="1" style={s.input} value={form.ppm_every_days} onChange={(e) => setForm({ ...form, ppm_every_days: e.target.value })} /></div>}
        {def.ppm && <div><label style={s.label} htmlFor={`${cfg.code}-alast`}>Last serviced</label><input id={`${cfg.code}-alast`} type="date" style={s.input} value={form.last_ppm_on} onChange={(e) => setForm({ ...form, last_ppm_on: e.target.value })} /></div>}
        {def.expiry && <div><label style={s.label} htmlFor={`${cfg.code}-aexp`}>Expires</label><input id={`${cfg.code}-aexp`} type="date" style={s.input} value={form.expires_on} onChange={(e) => setForm({ ...form, expires_on: e.target.value })} /></div>}
        {(def.fields || []).map((f) => <FieldInput key={f.key} field={f} idPrefix={`${cfg.code}-af`} value={form.details[f.key]} onChange={(v) => setForm({ ...form, details: { ...form.details, [f.key]: v } })} />)}
        <button type="submit" style={{ ...s.btn, ...s.pri }}>Add</button>
      </form>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['Name', 'Kind', 'Location', def.ppm ? 'Next service' : def.expiry ? 'Expires' : 'Details', 'Status', ''].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{assets.map((a) => {
            const due = nextPpm(a)
            const late = (due && due < today) || (a.expires_on && a.expires_on < today)
            const soon = a.expires_on && !late && (new Date(a.expires_on) - new Date()) / 86400000 <= 60
            return (
              <tr key={a.id}>
                <td style={s.td}><b>{a.name}</b>{a.code ? <div style={s.sub}>{a.code}</div> : null}</td>
                <td style={s.td}>{def.kinds[a.kind] || pretty(a.kind)}</td>
                <td style={s.td}>{a.location || '—'}</td>
                <td style={{ ...s.td, color: late ? C.danger : soon ? C.warn : undefined, fontWeight: late || soon ? 700 : 400 }}>
                  {def.ppm ? (due ? `${due}${late ? ' (overdue)' : ''}` : 'No schedule') : def.expiry ? (a.expires_on ? `${a.expires_on}${late ? ' (expired)' : soon ? ' (soon)' : ''}` : '—') : Object.values(a.details || {}).filter((v) => typeof v === 'string').join(' · ') || '—'}
                  {a.details?.link && /^https?:\/\//.test(a.details.link) ? <div><a href={a.details.link} target="_blank" rel="noreferrer">Open document</a></div> : null}
                </td>
                <td style={s.td}><select aria-label={`Status of ${a.name}`} style={{ ...s.input, padding: '4px 6px' }} value={a.status} onChange={(e) => setStatus(a, e.target.value)}>{def.statuses.map((x) => <option key={x} value={x}>{pretty(x)}</option>)}</select></td>
                <td style={s.td}>{def.ppm && a.ppm_every_days ? <button type="button" style={{ ...s.btn, ...s.soft, padding: '3px 8px' }} onClick={() => ppmDone(a)}>Serviced today</button> : null}</td>
              </tr>
            )
          })}</tbody>
        </table>
        {assets.length === 0 && <div style={{ ...s.sub, padding: 10 }}>Nothing registered yet.</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- log books
function LogBook({ cfg, kind, hospitalId, me }) {
  const def = cfg.logs[kind]
  const [rows, setRows] = useState([])
  const [form, setForm] = useState({ subject: '', value: '', details: {} })
  const [closing, setClosing] = useState(null)
  const [closeVals, setCloseVals] = useState({})
  const [err, setErr] = useState('')
  const [assets] = useAssets(hospitalId, cfg.code)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('service_logs').select('*').eq('hospital_id', hospitalId).eq('department', cfg.code).eq('kind', kind).order('started_at', { ascending: false }).limit(200)
    if (error) setErr(friendly(error))
    setRows(data || [])
  }, [hospitalId, cfg.code, kind])
  useEffect(() => { void load() }, [load])

  async function add(e) {
    e.preventDefault(); setErr('')
    const missing = (def.fields || []).find((f) => f.required && (form.details[f.key] === undefined || form.details[f.key] === ''))
    if (!form.subject) { setErr(`Fill in "${def.subject.label}".`); return }
    if (missing) { setErr(`Fill in "${missing.label}".`); return }
    if (def.value && form.value === '') { setErr(`Fill in "${def.value.label}".`); return }
    const assetName = def.subject.type === 'asset' ? assets.find((a) => a.id === form.subject)?.name : null
    const { error } = await supabase.from('service_logs').insert({
      hospital_id: hospitalId, department: cfg.code, kind, subject: assetName || form.subject, asset_id: assetName ? form.subject : null,
      value: def.value ? Number(form.value) : null, unit: def.value?.unit || null, details: form.details, recorded_by_name: me || null,
    })
    if (error) { setErr(friendly(error)); return }
    if (assetName && cfg.code === 'transport') await supabase.from('service_assets').update({ status: 'on_trip' }).eq('id', form.subject)
    setForm({ subject: '', value: '', details: {} }); void load()
  }
  async function close(row) {
    const missing = (def.closeFields || []).find((f) => f.required && !closeVals[f.key])
    if (missing) { setErr(`Fill in "${missing.label}".`); return }
    const { error } = await supabase.from('service_logs').update({ ended_at: new Date().toISOString(), details: { ...row.details, ...closeVals } }).eq('id', row.id)
    if (error) { setErr(friendly(error)); return }
    if (row.asset_id && cfg.code === 'transport') await supabase.from('service_assets').update({ status: 'available' }).eq('id', row.asset_id)
    setClosing(null); setCloseVals({}); void load()
  }

  const subjField = { key: 'subject', ...def.subject }
  return (
    <div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <form onSubmit={add} style={{ ...s.grid(170), alignItems: 'end', border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <FieldInput field={{ ...subjField, required: true }} idPrefix={`${cfg.code}-${kind}`} assets={assets} value={form.subject} onChange={(v) => setForm({ ...form, subject: v })} />
        {def.value && <FieldInput field={{ key: 'value', label: `${def.value.label} (${def.value.unit})`, type: 'number', required: true }} idPrefix={`${cfg.code}-${kind}`} value={form.value} onChange={(v) => setForm({ ...form, value: v })} />}
        {(def.fields || []).map((f) => <FieldInput key={f.key} field={f} idPrefix={`${cfg.code}-${kind}`} value={form.details[f.key]} onChange={(v) => setForm({ ...form, details: { ...form.details, [f.key]: v } })} />)}
        <button type="submit" style={{ ...s.btn, ...s.pri }}>Record</button>
      </form>
      {def.alert && form.subject && form.value !== '' && def.alert({ subject: form.subject, value: form.value }) && <div role="alert" style={s.err}>{def.alert({ subject: form.subject, value: form.value })}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['When', def.subject.label, ...(def.value ? [def.value.label] : []), 'Details', 'By', ...(def.closable ? [def.closable] : [])].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => {
            const alert = def.alert ? def.alert({ subject: r.subject, value: r.value }) : ''
            return (
              <tr key={r.id}>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{when(r.started_at)}</td>
                <td style={s.td}>{r.subject}</td>
                {def.value && <td style={{ ...s.td, color: alert ? C.danger : undefined, fontWeight: alert ? 700 : 400 }} title={alert}>{r.value} {r.unit}{alert ? ' ⚠' : ''}</td>}
                <td style={s.td}>{Object.entries(r.details || {}).map(([k, v]) => `${pretty(k)}: ${v}`).join(' · ') || '—'}</td>
                <td style={s.td}>{r.recorded_by_name || '—'}</td>
                {def.closable && <td style={s.td}>{r.ended_at ? when(r.ended_at) : closing === r.id ? (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {(def.closeFields || []).map((f) => <input key={f.key} aria-label={f.label} placeholder={f.label} type={f.type} style={{ ...s.input, width: 120, padding: '3px 6px' }} value={closeVals[f.key] || ''} onChange={(e) => setCloseVals({ ...closeVals, [f.key]: e.target.value })} />)}
                    <button type="button" style={{ ...s.btn, ...s.pri, padding: '3px 8px' }} onClick={() => close(r)}>Save</button>
                  </div>
                ) : <button type="button" style={{ ...s.btn, ...s.soft, padding: '3px 8px' }} onClick={() => (def.closeFields ? setClosing(r.id) : close(r))}>{def.closable}</button>}</td>}
              </tr>
            )
          })}</tbody>
        </table>
        {rows.length === 0 && !err && <div style={{ ...s.sub, padding: 10 }}>No entries yet.</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- report
function Report({ cfg, hospitalId }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    const since = new Date(Date.now() - 90 * 86400000).toISOString()
    void supabase.from('service_requests').select('kind, status, created_at, completed_at, due_at').eq('hospital_id', hospitalId).eq('department', cfg.code).gte('created_at', since).limit(2000)
      .then(({ data }) => setRows(data || []))
  }, [hospitalId, cfg.code])
  const sum = useMemo(() => summarise(rows || []), [rows])
  if (!rows) return <div style={s.sub}>Loading…</div>
  const tile = (l, v, tone) => <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}><div style={s.sub}>{l}</div><div style={{ fontSize: 22, fontWeight: 800, color: tone }}>{v ?? '—'}</div></div>
  return (
    <div>
      <div style={s.grid(150)}>
        {tile('Open now', sum.open)}
        {tile('Overdue', sum.overdue, sum.overdue ? C.danger : undefined)}
        {tile('Done (30 days)', sum.done30)}
        {tile('Average hours to finish', sum.avgHours)}
        {tile('Finished on time', sum.onTimePct === null ? null : `${sum.onTimePct}%`)}
        {tile('Waiting for verification', sum.unverified)}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 12 }}>
        <thead><tr>{['Type', 'Open', 'Done (90 days)'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>{Object.entries(sum.byKind).map(([k, v]) => <tr key={k}><td style={s.td}>{cfg.kinds[k]?.label || pretty(k)}</td><td style={s.td}>{v.open}</td><td style={s.td}>{v.done}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------- kitchen production
function KitchenProduction({ hospitalId }) {
  const [orders, setOrders] = useState([])
  const [inpatients, setInpatients] = useState(null)
  useEffect(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    void supabase.from('meal_orders').select('*').eq('hospital_id', hospitalId).gte('created_at', start.toISOString()).limit(1000).then(({ data }) => setOrders(data || []))
    void supabase.from('beds').select('id, patient_id').eq('hospital_id', hospitalId).not('patient_id', 'is', null).then(({ data }) => setInpatients((data || []).length))
  }, [hospitalId])
  const plan = {}
  for (const o of orders) {
    const meal = o.meal_type || 'Meal'
    const diet = o.diet_type || 'Normal'
    ;(plan[meal] ||= {})[diet] = (plan[meal][diet] || 0) + 1
  }
  const ordered = new Set(orders.map((o) => o.patient_id).filter(Boolean)).size
  return (
    <div>
      <div style={{ ...s.sub, marginBottom: 8 }}>{inpatients ?? '…'} inpatients now; {ordered} have a diet order today. Patients without an order get the normal diet unless the ward says otherwise — check “Nil by mouth” with the ward.</div>
      {Object.keys(plan).length === 0 && <div style={s.sub}>No diet orders yet today. Wards and Nutrition send them; special requests come in under Requests.</div>}
      {Object.entries(plan).map(([meal, diets]) => (
        <div key={meal} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
          <b>{meal}</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>{Object.entries(diets).map(([d, n]) => <Chip key={d} tone={/nil/i.test(d) ? 'red' : /diab|renal|salt/i.test(d) ? 'yellow' : 'gray'}>{d}: {n}</Chip>)}</div>
        </div>
      ))}
      {orders.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
          <thead><tr>{['Patient', 'Bed', 'Meal', 'Diet', 'Time'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{orders.map((o) => <tr key={o.id}><td style={s.td}>{o.patient_name || '—'}</td><td style={s.td}>{o.bed_number || '—'}</td><td style={s.td}>{o.meal_type || '—'}</td><td style={s.td}>{o.diet_type || 'Normal'}</td><td style={s.td}>{o.delivery_time || '—'}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- medical records coding
function CodingWorkspace({ hospitalId }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [done, setDone] = useState({})
  useEffect(() => {
    const since = new Date(Date.now() - 60 * 86400000).toISOString()
    void supabase.from('consultations').select('id, patient_id, diagnosis, created_at, icd10_code, patients(full_name, patient_number)').eq('hospital_id', hospitalId)
      .is('icd10_code', null).not('diagnosis', 'is', null).gte('created_at', since).order('created_at', { ascending: false }).limit(100)
      .then(({ data, error }) => { if (error) setErr(friendly(error)); setRows(data || []) })
  }, [hospitalId])
  async function code(row, pick) {
    setErr('')
    let { error } = await supabase.from('consultations').update({ icd10_code: pick.code, icd10_description: pick.description }).eq('id', row.id)
    if (error && /icd10_description/.test(error.message)) ({ error } = await supabase.from('consultations').update({ icd10_code: pick.code }).eq('id', row.id))
    if (error) setErr(friendly(error)); else setDone({ ...done, [row.id]: `${pick.code} ${pick.description || ''}` })
  }
  if (!rows) return <div style={s.sub}>Loading…</div>
  return (
    <div>
      <div style={{ ...s.sub, marginBottom: 8 }}>Diagnoses from the last 60 days written as free text without an ICD-10 code. Coded diagnoses feed SHA claims and MOH reports.</div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {rows.length === 0 && <div style={s.ok}>Everything is coded.</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ ...s.grid(260), border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, marginBottom: 6, alignItems: 'center' }}>
          <div><b>{r.diagnosis}</b><div style={s.sub}>{r.patients?.full_name || 'Patient'} {r.patients?.patient_number ? `· ${r.patients.patient_number}` : ''} · {when(r.created_at)}</div></div>
          {done[r.id] ? <Chip tone="green">Coded {done[r.id]}</Chip> : <DiagnosisPicker id={`code-${r.id}`} inputStyle={s.input} onPick={(p) => code(r, p)} placeholder={`Code “${String(r.diagnosis).slice(0, 30)}”`} />}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- IT status board
function SystemStatus({ cfg, hospitalId, me }) {
  const [rows, setRows] = useState([])
  const [note, setNote] = useState({})
  const load = useCallback(async () => {
    const { data } = await supabase.from('service_logs').select('*').eq('hospital_id', hospitalId).eq('department', 'it').eq('kind', 'system_status').order('started_at', { ascending: false }).limit(200)
    setRows(data || [])
  }, [hospitalId])
  useEffect(() => { void load() }, [load])
  async function set(system, status) {
    await supabase.from('service_logs').insert({ hospital_id: hospitalId, department: 'it', kind: 'system_status', subject: system, details: { status, note: note[system] || null }, recorded_by_name: me || null })
    setNote({ ...note, [system]: '' }); void load()
  }
  const tone = { up: 'green', degraded: 'yellow', down: 'red' }
  return (
    <div style={s.grid(230)}>
      {cfg.systems.map((sys) => {
        const last = rows.find((r) => r.subject === sys)
        const st = last?.details?.status || 'up'
        return (
          <div key={sys} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{sys}</b><Chip tone={tone[st]}>{st}</Chip></div>
            <div style={s.sub}>{last ? `${when(last.started_at)}${last.details?.note ? ` — ${last.details.note}` : ''}` : 'No reports'}</div>
            <input aria-label={`Note for ${sys}`} style={{ ...s.input, marginTop: 6 }} placeholder="Note (optional)" value={note[sys] || ''} onChange={(e) => setNote({ ...note, [sys]: e.target.value })} />
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>{['up', 'degraded', 'down'].map((x) => <button key={x} type="button" style={{ ...s.btn, ...(x === 'down' ? s.danger : s.ghost), padding: '3px 8px' }} onClick={() => set(sys, x)}>{x}</button>)}</div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- executive dashboard
function ExecDashboard({ hospitalId }) {
  const [k, setK] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { void supabase.rpc('exec_kpis', { p_hospital: hospitalId }).then(({ data, error }) => { if (error) setErr(friendly(error)); setK(data || {}) }) }, [hospitalId])
  if (err) return <div role="alert" style={s.err}>{err}</div>
  if (!k) return <div style={s.sub}>Loading…</div>
  const kes = (v) => (v === undefined ? '—' : `KES ${Number(v).toLocaleString('en-KE')}`)
  const tile = (l, v, warn) => <div style={{ border: `1px solid ${warn ? C.danger : C.border}`, borderRadius: 10, padding: 12 }}><div style={s.sub}>{l}</div><div style={{ fontSize: 22, fontWeight: 800, color: warn ? C.danger : undefined }}>{v ?? '—'}</div></div>
  const occ = k.beds_total ? Math.round((k.beds_occupied / k.beds_total) * 100) : null
  return (
    <div>
      <div style={s.grid(170)}>
        {tile('Bed occupancy', occ === null ? null : `${occ}% (${k.beds_occupied}/${k.beds_total})`, occ > 90)}
        {tile('Visits today', k.visits_today)}
        {tile('Collected today', kes(k.collected_today))}
        {tile('Unpaid balances', kes(k.unpaid_balances))}
        {tile('SHA claims rejected (90 days)', k.claims_90d ? `${k.claims_rejected_90d}/${k.claims_90d}` : null, k.claims_90d && k.claims_rejected_90d / k.claims_90d > 0.1)}
        {tile('Open support requests', k.requests_open)}
        {tile('Overdue support requests', k.requests_overdue, k.requests_overdue > 0)}
        {tile('Security incidents open', k.incidents_open, k.incidents_open > 0)}
        {tile('Complaints open', k.complaints_open, k.complaints_open > 0)}
        {tile('Equipment service overdue', k.ppm_overdue, k.ppm_overdue > 0)}
        {tile('Contracts / licences expiring in 60 days', k.expiring_60d, k.expiring_60d > 0)}
      </div>
      {k.by_department && Object.keys(k.by_department).length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{Object.entries(k.by_department).map(([d, n]) => <Chip key={d}>{d}: {n} open</Chip>)}</div>
      )}
    </div>
  )
}
