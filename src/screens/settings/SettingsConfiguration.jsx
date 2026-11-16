// Settings → Configuration: payer price lists, the role & permission matrix, department form changes and a log of
// every configuration change. Stored in the database (20261124000000_configuration.sql); the code defaults stay as
// the starting point and "Reset to default" removes a hospital's change.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import supabase from '../../supabase'
import { ALL_ACTIONS, ALL_SCREENS, CONFIGURABLE_ROLES, DEFAULT_ROLE_PERMISSIONS } from '../../access'
import { HOSPITAL_WORKFLOW_MODULES } from '../hospitalWorkflowModules'
import { ALWAYS_ALLOWED_SCREENS, clearWorkflowOverrideCache, customFieldKey, mergeWorkflowFields, validateWorkflowOverride } from '../../utils/hospitalConfig'
import { openConfirmDialog } from '../../confirmDialog'
import { C, Chip, s } from '../ncd/ui'

const SECTIONS = [
  ['prices', 'Payer prices'],
  ['roles', 'Roles & permissions'],
  ['forms', 'Department forms'],
  ['log', 'Change log'],
]
const PAYER_TYPES = { sha: 'SHA', insurance: 'Insurance', corporate: 'Corporate', staff: 'Staff', cash: 'Cash (special)', other: 'Other' }
const CONFIG_TABLES = ['charge_codes', 'price_lists', 'charge_code_prices', 'role_permissions', 'workflow_form_overrides']
const TABLE_LABEL = { charge_codes: 'Base price', price_lists: 'Price list', charge_code_prices: 'Payer price', role_permissions: 'Role permissions', workflow_form_overrides: 'Department form' }

function friendlyError(e) {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Not installed yet. Run docs/sql/14_configuration.sql in Supabase.'
  if (/row-level|permission/i.test(m)) return 'Only administrators (and finance managers, for prices) can change configuration.'
  return m
}
const screenLabel = (path) => {
  const t = path.replace(/^\//, '').replace(/-/g, ' ')
  return t.replace(/\b(sha|hr|hiv|tb|icu|etims)\b/gi, (w) => w.toUpperCase()).replace(/^./, (c) => c.toUpperCase())
}
const actionLabel = (a) => a.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

export default function SettingsConfiguration({ hospitalId }) {
  const [section, setSection] = useState('prices')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div role="tablist" aria-label="Configuration" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {SECTIONS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={section === k} onClick={() => setSection(k)}
            style={{ ...s.btn, ...(section === k ? s.pri : s.ghost) }}>{l}</button>
        ))}
      </div>
      {section === 'prices' && <PayerPrices hospitalId={hospitalId} />}
      {section === 'roles' && <RoleMatrix hospitalId={hospitalId} />}
      {section === 'forms' && <DepartmentForms hospitalId={hospitalId} />}
      {section === 'log' && <ChangeLog hospitalId={hospitalId} />}
    </div>
  )
}

function Notice({ err, msg, onDismiss }) {
  return <>
    {err && <div role="alert" style={s.err}>{err} <button type="button" style={{ ...s.btn, ...s.ghost, padding: '2px 8px' }} onClick={onDismiss}>Dismiss</button></div>}
    {msg && <div role="status" style={s.ok}>{msg}</div>}
  </>
}

// ---------------------------------------------------------------- payer prices
function PayerPrices({ hospitalId }) {
  const [lists, setLists] = useState([])
  const [codes, setCodes] = useState([])
  const [prices, setPrices] = useState([])
  const [selected, setSelected] = useState(null)
  const [edits, setEdits] = useState({})
  const [filter, setFilter] = useState('')
  const [newList, setNewList] = useState({ name: '', payer_type: 'sha', insurer_name: '' })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [l, c, p] = await Promise.all([
      supabase.from('price_lists').select('*').eq('hospital_id', hospitalId).order('name'),
      supabase.from('charge_codes').select('id, code, name, category, department, unit_price_kes, is_active').eq('hospital_id', hospitalId).order('category').order('name'),
      supabase.from('charge_code_prices').select('*').eq('hospital_id', hospitalId),
    ])
    const e = l.error || p.error || c.error
    if (e) setErr(friendlyError(e))
    setLists(l.data || []); setCodes(c.data || []); setPrices(p.data || [])
    setSelected((cur) => cur && (l.data || []).find((x) => x.id === cur.id) ? cur : (l.data || [])[0] || null)
  }, [hospitalId])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])
  // clear unsaved edits only when the user switches to another price list (not on the first load — that raced with typing)
  const shownListId = useRef(null)
  useEffect(() => {
    if (shownListId.current && shownListId.current !== selected?.id) setEdits({})
    shownListId.current = selected?.id || null
  }, [selected?.id])

  const listPrices = useMemo(() => new Map(prices.filter((p) => p.price_list_id === selected?.id).map((p) => [String(p.charge_code).toUpperCase(), p])), [prices, selected])
  const shown = codes.filter((c) => c.is_active !== false && (!filter || `${c.code} ${c.name} ${c.category} ${c.department}`.toLowerCase().includes(filter.toLowerCase())))

  async function addList() {
    setErr(''); setMsg('')
    if (!newList.name.trim()) { setErr('Give the price list a name, e.g. "SHA tariff" or "AAR Insurance".'); return }
    const { data, error } = await supabase.from('price_lists').insert({
      hospital_id: hospitalId, name: newList.name.trim(), payer_type: newList.payer_type,
      insurer_name: newList.payer_type === 'insurance' && newList.insurer_name.trim() ? newList.insurer_name.trim() : null,
    }).select().single()
    if (error) { setErr(/duplicate|unique/i.test(error.message) ? 'A price list with that name already exists.' : friendlyError(error)); return }
    setNewList({ name: '', payer_type: 'sha', insurer_name: '' }); setSelected(data); setMsg(`Price list "${data.name}" created. Enter the prices that differ from the base price.`)
    void load()
  }
  async function toggleActive(list) {
    const { error } = await supabase.from('price_lists').update({ active: !list.active }).eq('id', list.id)
    if (error) setErr(friendlyError(error)); else void load()
  }
  async function removeList(list) {
    if (!await openConfirmDialog(`Delete the price list "${list.name}" and all its prices? Bills already issued are not changed.`, { title: 'Delete price list', confirmLabel: 'Delete' })) return
    const { error } = await supabase.from('price_lists').delete().eq('id', list.id)
    if (error) setErr(friendlyError(error)); else { setSelected(null); void load() }
  }
  async function savePrices() {
    setErr(''); setMsg('')
    const entries = Object.entries(edits)
    if (!entries.length || !selected) return
    const upserts = []; const removals = []
    for (const [code, raw] of entries) {
      const v = String(raw).trim()
      if (v === '') { if (listPrices.has(code)) removals.push(listPrices.get(code).id); continue }
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) { setErr(`The price for ${code} must be a number of 0 or more.`); return }
      upserts.push({ hospital_id: hospitalId, price_list_id: selected.id, charge_code: code, price_kes: n })
    }
    setSaving(true)
    const r1 = upserts.length ? await supabase.from('charge_code_prices').upsert(upserts, { onConflict: 'price_list_id,charge_code' }) : { error: null }
    const r2 = removals.length ? await supabase.from('charge_code_prices').delete().in('id', removals) : { error: null }
    setSaving(false)
    if (r1.error || r2.error) { setErr(friendlyError(r1.error || r2.error)); return }
    setEdits({}); setMsg(`Saved ${upserts.length} price${upserts.length === 1 ? '' : 's'}${removals.length ? `, ${removals.length} back to the base price` : ''}.`)
    void load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Notice err={err} msg={msg} onDismiss={() => setErr('')} />
      <div style={s.card}>
        <h2 style={s.h2}>Price lists by payer</h2>
        <p style={{ ...s.sub, marginTop: -6 }}>Cash and M-Pesa patients pay the base price from <b>💰 Price List</b>. Add a list for SHA, an insurer or a corporate scheme, then enter only the prices that differ — anything left blank uses the base price. Consultation, lab, department and ward bills pick the list from the visit's payment method and the patient's insurer.</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {lists.map((l) => (
            <button key={l.id} type="button" onClick={() => setSelected(l)} aria-pressed={selected?.id === l.id}
              style={{ ...s.btn, ...(selected?.id === l.id ? s.soft : s.ghost), opacity: l.active ? 1 : 0.55 }}>
              {l.name} <span style={{ fontWeight: 400 }}>· {PAYER_TYPES[l.payer_type]}{l.insurer_name ? ` (${l.insurer_name})` : ''}{l.active ? '' : ' · off'}</span>
            </button>
          ))}
          {lists.length === 0 && !err && <span style={s.sub}>No payer price lists yet: everyone pays the base price.</span>}
        </div>
        <div style={{ ...s.grid(160), alignItems: 'end' }}>
          <div><label style={s.label} htmlFor="pl-name">New list name</label><input id="pl-name" style={s.input} value={newList.name} placeholder="e.g. SHA tariff" onChange={(e) => setNewList((x) => ({ ...x, name: e.target.value }))} /></div>
          <div><label style={s.label} htmlFor="pl-type">Payer</label>
            <select id="pl-type" style={s.input} value={newList.payer_type} onChange={(e) => setNewList((x) => ({ ...x, payer_type: e.target.value }))}>
              {Object.entries(PAYER_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          {newList.payer_type === 'insurance' && <div><label style={s.label} htmlFor="pl-ins">Insurer (blank = any insurer)</label><input id="pl-ins" style={s.input} value={newList.insurer_name} placeholder="e.g. AAR" onChange={(e) => setNewList((x) => ({ ...x, insurer_name: e.target.value }))} /></div>}
          <button type="button" style={{ ...s.btn, ...s.pri }} onClick={addList}>Add price list</button>
        </div>
      </div>

      {selected && <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ ...s.h2, margin: 0 }}>{selected.name} <Chip tone={selected.active ? 'green' : 'gray'}>{selected.active ? 'In use' : 'Switched off'}</Chip></h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => toggleActive(selected)}>{selected.active ? 'Switch off' : 'Switch on'}</button>
            <button type="button" style={{ ...s.btn, ...s.danger }} onClick={() => removeList(selected)}>Delete list</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input aria-label="Search services" style={{ ...s.input, maxWidth: 320 }} placeholder="Search code, service or department…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button type="button" style={{ ...s.btn, ...s.pri }} disabled={saving || !Object.keys(edits).length} onClick={savePrices}>{saving ? 'Saving…' : `Save ${Object.keys(edits).length || ''} change${Object.keys(edits).length === 1 ? '' : 's'}`}</button>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 520 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['Code', 'Service', 'Category', 'Base price (KES)', `${selected.name} price (KES)`].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>{shown.map((c) => {
              const code = String(c.code).toUpperCase()
              const current = listPrices.get(code)
              const value = edits[code] ?? (current ? String(Number(current.price_kes)) : '')
              const differs = value !== '' && Number(value) !== Number(c.unit_price_kes)
              return (
                <tr key={c.id}>
                  <td style={{ ...s.td, fontFamily: 'monospace' }}>{c.code}</td>
                  <td style={s.td}>{c.name}</td>
                  <td style={s.td}>{c.category}</td>
                  <td style={s.td}>{Number(c.unit_price_kes || 0).toLocaleString('en-KE')}</td>
                  <td style={s.td}>
                    <input aria-label={`${selected.name} price for ${c.name}`} type="number" min="0" step="1" style={{ ...s.input, width: 130, borderColor: edits[code] !== undefined ? C.primary : undefined, fontWeight: differs ? 700 : 400 }}
                      placeholder="Base price" value={value} onChange={(e) => setEdits((x) => ({ ...x, [code]: e.target.value }))} />
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
          {shown.length === 0 && <div style={{ ...s.sub, padding: 12 }}>No services match. Add services and base prices under 💰 Price List.</div>}
        </div>
      </div>}
    </div>
  )
}

// ---------------------------------------------------------------- roles
function RoleMatrix({ hospitalId }) {
  const [rows, setRows] = useState([])
  const [role, setRole] = useState(CONFIGURABLE_ROLES[0])
  const [draft, setDraft] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('role_permissions').select('*').eq('hospital_id', hospitalId)
    if (error) setErr(friendlyError(error))
    setRows(data || [])
  }, [hospitalId])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])

  const saved = rows.find((r) => r.role === role)
  const base = saved || DEFAULT_ROLE_PERMISSIONS[role]
  useEffect(() => { setDraft({ screens: new Set(base.screens), actions: new Set(base.actions) }) }, [role, saved?.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!draft) return null

  const toggle = (kind, value) => setDraft((d) => {
    const next = new Set(d[kind]); if (next.has(value)) next.delete(value); else next.add(value)
    return { ...d, [kind]: next }
  })
  const dirty = JSON.stringify([...draft.screens].sort()) !== JSON.stringify([...base.screens].sort())
    || JSON.stringify([...draft.actions].sort()) !== JSON.stringify([...base.actions].sort())

  async function save() {
    setErr(''); setMsg('')
    const screens = [...new Set([...draft.screens, ...ALWAYS_ALLOWED_SCREENS])].sort()
    const { error } = await supabase.from('role_permissions').upsert(
      { hospital_id: hospitalId, role, screens, actions: [...draft.actions].sort() }, { onConflict: 'hospital_id,role' })
    if (error) { setErr(friendlyError(error)); return }
    setMsg(`${role} permissions saved. Menus update for staff the next time their screen loads.`)
    window.dispatchEvent(new Event('rc-role-config-changed'))
    void load()
  }
  async function reset() {
    if (!saved) return
    if (!await openConfirmDialog(`Put ${role} back to the standard permissions?`, { title: 'Reset role', confirmLabel: 'Reset' })) return
    const { error } = await supabase.from('role_permissions').delete().eq('id', saved.id)
    if (error) { setErr(friendlyError(error)); return }
    setMsg(`${role} is back to the standard permissions.`)
    window.dispatchEvent(new Event('rc-role-config-changed'))
    void load()
  }

  const box = (kind, value, label, locked) => (
    <label key={value} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, padding: '4px 0', opacity: locked ? 0.6 : 1 }}>
      <input type="checkbox" disabled={locked} checked={locked || draft[kind].has(value)} onChange={() => toggle(kind, value)} />{label}
    </label>
  )

  return (
    <div style={s.card}>
      <Notice err={err} msg={msg} onDismiss={() => setErr('')} />
      <h2 style={s.h2}>Roles & permissions</h2>
      <p style={{ ...s.sub, marginTop: -6 }}>Choose which screens and actions each role gets. Job titles follow their role (Clinical Officer → Doctor, Cashier → Accountant, Midwife → Nurse…). Administrators always have everything. The database still enforces its own rules on top of this — for example HIV and maternity records stay clinical-only, and only finance managers can refund — so ticking a box here can hide a screen but never opens data the role is not allowed to see.</p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {CONFIGURABLE_ROLES.map((r) => {
          const changed = rows.some((x) => x.role === r)
          return <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)} style={{ ...s.btn, ...(role === r ? s.soft : s.ghost) }}>{r}{changed ? ' •' : ''}</button>
        })}
      </div>
      <div style={{ ...s.sub, marginBottom: 8 }}>{saved ? <Chip tone="yellow">Customised for this hospital</Chip> : <Chip>Standard permissions</Chip>}</div>
      <div style={s.grid(260)}>
        <fieldset style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px' }}>
          <legend style={s.label}>Screens</legend>
          <div style={s.grid(150)}>{ALL_SCREENS.map((p) => box('screens', p, screenLabel(p), ALWAYS_ALLOWED_SCREENS.includes(p)))}</div>
        </fieldset>
        <fieldset style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px' }}>
          <legend style={s.label}>Actions</legend>
          <div style={s.grid(170)}>{ALL_ACTIONS.map((a) => box('actions', a, actionLabel(a), false))}</div>
        </fieldset>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        {saved && <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={reset}>Reset to standard</button>}
        <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!dirty} onClick={save}>Save {role}</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- department forms
const MODULES = Object.values(HOSPITAL_WORKFLOW_MODULES).sort((a, b) => a.title.localeCompare(b.title))

function DepartmentForms({ hospitalId }) {
  const [code, setCode] = useState(MODULES[0]?.code)
  const [row, setRow] = useState(null)
  const [overrides, setOverrides] = useState({})
  const [custom, setCustom] = useState([])
  const [newField, setNewField] = useState({ label: '', type: 'text', required: false, options: '' })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const mod = HOSPITAL_WORKFLOW_MODULES[code]

  const load = useCallback(async () => {
    setErr('')
    const { data, error } = await supabase.from('workflow_form_overrides').select('*').eq('hospital_id', hospitalId).eq('module_code', code).maybeSingle()
    if (error) setErr(friendlyError(error))
    setRow(data || null)
    const fields = data?.fields || []
    setOverrides(Object.fromEntries(fields.filter((f) => !f.custom).map((f) => [f.key, f])))
    setCustom(fields.filter((f) => f.custom))
  }, [hospitalId, code])
  useEffect(() => { if (hospitalId && code) void load() }, [hospitalId, code, load])

  const setO = (key, patch) => setOverrides((o) => ({ ...o, [key]: { ...(o[key] || { key }), ...patch } }))
  const buildOverride = () => {
    const out = []
    for (const f of mod.fields) {
      const o = overrides[f.key]
      if (!o) continue
      const entry = { key: f.key }
      if (o.label && o.label.trim() && o.label.trim() !== f.label) entry.label = o.label.trim()
      if (o.required && !f.required) entry.required = true
      if (o.hidden && !f.required) entry.hidden = true
      if (f.type === 'select' && Array.isArray(o.options) && o.options.join('|') !== (f.options || []).join('|')) entry.options = o.options
      if (Object.keys(entry).length > 1) out.push(entry)
    }
    return [...out, ...custom]
  }
  const preview = useMemo(() => mergeWorkflowFields(mod?.fields || [], buildOverride()), [mod, overrides, custom]) // eslint-disable-line react-hooks/exhaustive-deps

  function addCustom() {
    const key = customFieldKey(newField.label)
    const field = { key, label: newField.label.trim(), type: newField.type, required: newField.required, custom: true,
      ...(newField.type === 'select' ? { options: newField.options.split(',').map((x) => x.trim()).filter(Boolean) } : {}) }
    const problem = validateWorkflowOverride(mod.fields, [...custom, field])
    if (problem) { setErr(problem); return }
    setErr(''); setCustom((c) => [...c, field]); setNewField({ label: '', type: 'text', required: false, options: '' })
  }
  async function save() {
    setMsg('')
    const fields = buildOverride()
    const problem = validateWorkflowOverride(mod.fields, fields)
    if (problem) { setErr(problem); return }
    const { error } = await supabase.from('workflow_form_overrides').upsert({ hospital_id: hospitalId, module_code: code, fields }, { onConflict: 'hospital_id,module_code' })
    if (error) { setErr(friendlyError(error)); return }
    clearWorkflowOverrideCache(); setMsg(`${mod.title} form saved. Staff see it the next time they open the screen.`); void load()
  }
  async function reset() {
    if (!row || !await openConfirmDialog(`Put the ${mod.title} form back to the standard fields? Data already entered in custom fields is kept in the records.`, { title: 'Reset form', confirmLabel: 'Reset' })) return
    const { error } = await supabase.from('workflow_form_overrides').delete().eq('id', row.id)
    if (error) { setErr(friendlyError(error)); return }
    clearWorkflowOverrideCache(); setMsg(`${mod.title} form is back to the standard fields.`); void load()
  }
  if (!mod) return null

  return (
    <div style={s.card}>
      <Notice err={err} msg={msg} onDismiss={() => setErr('')} />
      <h2 style={s.h2}>Department forms</h2>
      <p style={{ ...s.sub, marginTop: -6 }}>Rename fields, change drop-down choices, make fields required, hide optional ones or add your own. Fields marked 🔒 feed safety checks (theatre room clashes, body release, triage…) and cannot be hidden.</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select aria-label="Department form" style={{ ...s.input, maxWidth: 300 }} value={code} onChange={(e) => { setCode(e.target.value); setMsg('') }}>
          {MODULES.map((m) => <option key={m.code} value={m.code}>{m.title}</option>)}
        </select>
        {row ? <Chip tone="yellow">Customised</Chip> : <Chip>Standard</Chip>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['Field', 'Label staff see', 'Required', 'Hide', 'Choices (comma-separated)'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>
            {mod.fields.map((f) => {
              const o = overrides[f.key] || {}
              return (
                <tr key={f.key} style={{ opacity: o.hidden ? 0.5 : 1 }}>
                  <td style={{ ...s.td, fontFamily: 'monospace' }}>{f.required ? '🔒 ' : ''}{f.key}</td>
                  <td style={s.td}><input aria-label={`Label for ${f.key}`} style={s.input} value={o.label ?? f.label} onChange={(e) => setO(f.key, { label: e.target.value })} /></td>
                  <td style={s.td}><input type="checkbox" aria-label={`${f.label} required`} disabled={f.required} checked={Boolean(f.required || o.required)} onChange={(e) => setO(f.key, { required: e.target.checked })} /></td>
                  <td style={s.td}><input type="checkbox" aria-label={`Hide ${f.label}`} disabled={f.required} checked={Boolean(o.hidden)} onChange={(e) => setO(f.key, { hidden: e.target.checked })} /></td>
                  <td style={s.td}>{f.type === 'select'
                    ? <input aria-label={`Choices for ${f.label}`} style={s.input} value={(o.options || f.options || []).join(', ')} onChange={(e) => setO(f.key, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                    : <span style={s.sub}>—</span>}</td>
                </tr>
              )
            })}
            {custom.map((f) => (
              <tr key={f.key}>
                <td style={{ ...s.td, fontFamily: 'monospace' }}>{f.key} <Chip tone="blue">added</Chip></td>
                <td style={s.td}>{f.label}</td>
                <td style={s.td}>{f.required ? 'Yes' : 'No'}</td>
                <td style={s.td}><button type="button" style={{ ...s.btn, ...s.ghost, padding: '2px 8px' }} onClick={() => setCustom((c) => c.filter((x) => x.key !== f.key))}>Remove</button></td>
                <td style={s.td}>{f.type === 'select' ? (f.options || []).join(', ') : f.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ ...s.grid(150), alignItems: 'end', marginTop: 12 }}>
        <div><label style={s.label} htmlFor="cf-label">Add a field</label><input id="cf-label" style={s.input} placeholder="e.g. Blood loss (ml)" value={newField.label} onChange={(e) => setNewField((x) => ({ ...x, label: e.target.value }))} /></div>
        <div><label style={s.label} htmlFor="cf-type">Type</label>
          <select id="cf-type" style={s.input} value={newField.type} onChange={(e) => setNewField((x) => ({ ...x, type: e.target.value }))}>
            <option value="text">Short text</option><option value="textarea">Long text</option><option value="number">Number</option><option value="date">Date</option><option value="datetime-local">Date & time</option><option value="select">Drop-down</option>
          </select></div>
        {newField.type === 'select' && <div><label style={s.label} htmlFor="cf-opt">Choices</label><input id="cf-opt" style={s.input} placeholder="Yes, No, Unknown" value={newField.options} onChange={(e) => setNewField((x) => ({ ...x, options: e.target.value }))} /></div>}
        <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={newField.required} onChange={(e) => setNewField((x) => ({ ...x, required: e.target.checked }))} />Required</label>
        <button type="button" style={{ ...s.btn, ...s.soft }} disabled={!newField.label.trim()} onClick={addCustom}>Add field</button>
      </div>
      <div style={{ marginTop: 14, padding: 12, background: C.bg, borderRadius: 10 }}>
        <div style={s.label}>Staff will see</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{preview.map((f) => <Chip key={f.key} tone={f.required ? 'blue' : 'gray'}>{f.label}{f.required ? ' *' : ''}</Chip>)}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        {row && <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={reset}>Reset to standard</button>}
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={save}>Save form</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- change log
function ChangeLog({ hospitalId }) {
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!hospitalId) return
    const actions = CONFIG_TABLES.flatMap((t) => ['insert', 'update', 'delete'].map((op) => `${op}:${t}`))
    void supabase.from('audit_log').select('id, action, details, user_email, user_role, performed_at')
      .eq('hospital_id', hospitalId).in('action', actions).order('performed_at', { ascending: false }).limit(200)
      .then(({ data, error }) => { if (error) setErr(friendlyError(error)); setRows(data || []) })
  }, [hospitalId])

  const describe = (r) => {
    let d = r.details
    try { if (typeof d === 'string') d = JSON.parse(d) } catch { return String(r.details || '') }
    if (d?.changes) return Object.entries(d.changes).map(([k, v]) => `${k}: ${v.from || '—'} → ${v.to || '—'}`).join('; ')
    if (d?.deleted_row) return `Removed ${d.deleted_row.name || d.deleted_row.role || d.deleted_row.charge_code || d.deleted_row.module_code || ''}`.trim()
    return 'Created'
  }
  return (
    <div style={s.card}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <h2 style={s.h2}>Configuration change log</h2>
      <p style={{ ...s.sub, marginTop: -6 }}>Every change to prices, price lists, role permissions and department forms, with who made it. Entries cannot be edited or deleted.</p>
      <div style={{ overflowX: 'auto', maxHeight: 560 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['When', 'Who', 'What', 'Change'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => {
            const [op, table] = String(r.action).split(':')
            return (
              <tr key={r.id}>
                <td style={{ ...s.td, whiteSpace: 'nowrap' }}>{r.performed_at ? new Date(r.performed_at).toLocaleString('en-KE') : '—'}</td>
                <td style={s.td}>{r.user_email || '—'}<div style={s.sub}>{r.user_role}</div></td>
                <td style={s.td}><Chip tone={op === 'delete' ? 'red' : op === 'insert' ? 'green' : 'blue'}>{TABLE_LABEL[table] || table}</Chip></td>
                <td style={{ ...s.td, maxWidth: 520, wordBreak: 'break-word' }}>{describe(r)}</td>
              </tr>
            )
          })}</tbody>
        </table>
        {rows.length === 0 && !err && <div style={{ ...s.sub, padding: 12 }}>No configuration changes recorded yet.</div>}
      </div>
    </div>
  )
}
