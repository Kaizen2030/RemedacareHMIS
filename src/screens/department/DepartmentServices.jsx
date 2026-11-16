// Department services and prices (charge_codes with this department), the "Services done today" picker used in the
// Review patient panel, and billing of those services onto an unpaid invoice that the cashier collects.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { notifyError } from '../../notifications'
import { serviceCode, suggestedServices } from '../../data/departmentServices'
import { canonicalDepartmentName } from '../../utils/departmentNames'
import { priceForPayer } from '../../utils/hospitalConfig'
import { isSelfPayMethod, unpaidInvoiceFields } from '../../utils/payments/invoices'
import { buildWorkflowInvoiceNote, createServiceLine, SERVICE_SOURCES, stringifyServiceLines } from '../../utils/workflowBilling'

const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE')}`

/** Active charge codes of this department, excluding the consultation fee (billed automatically). */
export async function loadDepartmentServices(hospitalId, department) {
  if (!hospitalId) return []
  const { data } = await supabase.from('charge_codes').select('*').eq('hospital_id', hospitalId).eq('is_active', true).order('name')
  const canon = canonicalDepartmentName(department).toLowerCase()
  return (data || []).filter((c) => canonicalDepartmentName(c.department).toLowerCase() === canon)
}
export const billableServices = (rows) => rows.filter((c) => String(c.category || '').toLowerCase() !== 'consultation' && !/^CONS-/i.test(c.code || ''))

/**
 * Put the ticked services on one unpaid invoice for the visit (the cashier collects payment). Payer price lists apply.
 * picked: { [chargeCodeId]: qty }
 */
export async function billDepartmentServices({ hospitalId, visit, department, services, picked, consultationId }) {
  const chosen = services.filter((s) => Number(picked[s.id]) > 0)
  if (!chosen.length) return { billed: 0 }
  const payMethod = visit.admission_payment_method || 'Cash'
  const insurer = visit.patients?.insurer_name || visit.patients?.insurance
  const lines = []
  for (const s of chosen) {
    const qty = Math.max(1, Math.round(Number(picked[s.id])))
    const { amount } = await priceForPayer(supabase, hospitalId, s.code, s.unit_price_kes || 0, { paymentMethod: payMethod, insurer })
    lines.push(createServiceLine({ label: s.name, qty, unitPrice: amount, total: amount * qty, source: SERVICE_SOURCES.PROCEDURE, sourceId: consultationId,
      visitId: visit.id, meta: { department, charge_code: s.code } }))
  }
  const total = lines.reduce((sum, l) => sum + Number(l.total || 0), 0)
  const { error } = await supabase.from('invoices').insert({
    hospital_id: hospitalId, patient_id: visit.patient_id, patient_name: visit.patients?.full_name || visit.patient_name || '', visit_id: visit.id,
    invoice_no: `INV-${Date.now().toString().slice(-6)}`, services: stringifyServiceLines(lines), ...unpaidInvoiceFields(total),
    payment_method: payMethod, insurer: !isSelfPayMethod(payMethod) ? payMethod : null,
    notes: buildWorkflowInvoiceNote({ source: SERVICE_SOURCES.PROCEDURE, sourceId: consultationId, visitId: visit.id, summary: `${department}: ${chosen.map((s) => s.name).join(', ')}`.slice(0, 200) }),
  })
  if (error) { notifyError(`The services were not billed: ${error.message}. Add them at the cashier.`); return { billed: 0, error } }
  return { billed: lines.length, total }
}

/** Ticks and quantities for the department's services (inside Review patient). */
export function ServicePicker({ services, picked, onChange }) {
  if (!services.length) return <div style={{ fontSize: 13, color: '#475467' }}>No services are priced for this department yet. An administrator can add them under Services and prices.</div>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 6 }}>
      {services.map((s) => {
        const qty = Number(picked[s.id] || 0)
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: `1px solid ${qty ? '#0F6E56' : '#D0D5DD'}`, borderRadius: 8, background: qty ? '#E6F4EE' : '#fff' }}>
            <input type="checkbox" id={`svc-${s.id}`} checked={qty > 0} onChange={(e) => onChange({ ...picked, [s.id]: e.target.checked ? 1 : 0 })} />
            <label htmlFor={`svc-${s.id}`} style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#101828', cursor: 'pointer' }}>{s.name}<span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#475467' }}>{kes(s.unit_price_kes)}</span></label>
            {qty > 0 && <input type="number" min={1} max={50} aria-label={`Quantity of ${s.name}`} value={qty} onChange={(e) => onChange({ ...picked, [s.id]: Math.max(1, Number(e.target.value) || 1) })}
              style={{ width: 56, padding: '4px 6px', border: '1px solid #D0D5DD', borderRadius: 6, fontSize: 13 }} />}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Section on the department page: the department's services and prices. Administrators and finance managers
 * (services_can_manage, docs/sql/52) add, edit, retire, restore and remove services; everyone else reads the list.
 */
const CATEGORIES = ['Procedure', 'Consultation', 'Imaging', 'Lab', 'Nursing', 'Therapy', 'Supplies', 'Other']
const EMPTY = { name: '', code: '', category: 'Procedure', unit_price_kes: '', description: '' }
const field = { padding: '7px 10px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', background: '#fff', color: '#101828' }
const lbl = { display: 'block', fontSize: 12.5, fontWeight: 700, color: '#344054', marginBottom: 4 }
const PAGE = 25

function ServiceForm({ value, onChange, department, codeLocked, idPrefix }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
      <div style={{ gridColumn: 'span 2' }}><label style={lbl} htmlFor={`${idPrefix}-name`}>Service name</label>
        <input id={`${idPrefix}-name`} style={field} value={value.name} placeholder="e.g. Root canal treatment"
          onChange={(e) => onChange({ ...value, name: e.target.value, ...(codeLocked || value.codeEdited ? {} : { code: e.target.value.trim() ? serviceCode(department, e.target.value) : '' }) })} /></div>
      <div><label style={lbl} htmlFor={`${idPrefix}-code`}>Code</label>
        <input id={`${idPrefix}-code`} style={{ ...field, fontFamily: 'monospace', fontSize: 12.5, ...(codeLocked ? { background: '#F2F4F7' } : {}) }} value={value.code} readOnly={codeLocked}
          title={codeLocked ? 'The code stays the same so earlier bills still match' : undefined} onChange={(e) => onChange({ ...value, code: e.target.value.toUpperCase(), codeEdited: true })} /></div>
      <div><label style={lbl} htmlFor={`${idPrefix}-cat`}>Category</label>
        <select id={`${idPrefix}-cat`} style={field} value={value.category || 'Other'} onChange={(e) => set('category', e.target.value)}>
          {[...new Set([...CATEGORIES, value.category || 'Other'])].map((c) => <option key={c}>{c}</option>)}
        </select></div>
      <div><label style={lbl} htmlFor={`${idPrefix}-price`}>Cash price (KES)</label>
        <input id={`${idPrefix}-price`} type="number" min={0} step="1" style={field} value={value.unit_price_kes} onChange={(e) => set('unit_price_kes', e.target.value)} /></div>
      <div style={{ gridColumn: '1 / -1' }}><label style={lbl} htmlFor={`${idPrefix}-desc`}>Description or preparation (optional)</label>
        <input id={`${idPrefix}-desc`} style={field} value={value.description || ''} placeholder="e.g. per canal; includes local anaesthetic" onChange={(e) => set('description', e.target.value)} /></div>
    </div>
  )
}

export default function DepartmentServices({ hospitalId, department, isAdmin, navigate, css, SectionCard, EmptyState, onCount }) {
  const [all, setAll] = useState([])
  const [canManage, setCanManage] = useState(false)
  const [prices, setPrices] = useState({})
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [adding, setAdding] = useState(null)
  const [editing, setEditing] = useState(null) // { id, ...fields }
  const [removing, setRemoving] = useState(null)
  const [reason, setReason] = useState('')
  const [view, setView] = useState('active')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

  const load = useCallback(async () => {
    if (!hospitalId) return
    const [{ data }, perm] = await Promise.all([
      supabase.from('charge_codes').select('*').eq('hospital_id', hospitalId).order('name'),
      supabase.rpc('services_can_manage', { p_hospital: hospitalId }),
    ])
    const canon = canonicalDepartmentName(department).toLowerCase()
    setAll((data || []).filter((c) => canonicalDepartmentName(c.department).toLowerCase() === canon && String(c.category || '').toLowerCase() !== 'consultation' && !/^CONS-/i.test(c.code || '')))
    // before docs/sql/52 is installed the check does not exist: fall back to the administrator role
    setCanManage(perm?.error ? Boolean(isAdmin) : Boolean(perm?.data))
  }, [hospitalId, department, isAdmin])
  useEffect(() => { void load() }, [load])
  const active = all.filter((r) => r.is_active !== false)
  const retired = all.filter((r) => r.is_active === false)
  useEffect(() => { onCount?.(active.length) }, [active.length, onCount])
  const suggestions = useMemo(() => {
    const have = new Set(all.flatMap((r) => [String(r.code || '').toUpperCase(), String(r.name || '').toLowerCase()]))
    return suggestedServices(department).filter((s) => !have.has(serviceCode(department, s.name)) && !have.has(s.name.toLowerCase()))
  }, [all, department])
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = (view === 'active' ? active : retired).filter((r) => words.every((w) => `${r.name} ${r.code} ${r.category || ''} ${r.description || ''}`.toLowerCase().includes(w)))
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const shown = list.slice(Math.min(page, pages - 1) * PAGE, Math.min(page, pages - 1) * PAGE + PAGE)
  useEffect(() => { setPage(0) }, [q, view])

  const fail = (error, name) => setErr(/duplicate|unique|already used/i.test(error.message) ? `The code for "${name}" is already used by another service. Change the code.` : /row-level|permission/i.test(error.message) ? 'Only an administrator or a finance manager can change services and prices.' : error.message.replace(/^.*?ERROR:\s*/, ''))
  const done = (msg) => { setNotice(msg); setErr(''); window.dispatchEvent(new CustomEvent('remedacare:services_changed')); void load() }

  const addSuggested = async (s) => {
    const price = Number(prices[s.name])
    if (!(price > 0)) { setErr(`Enter a price for "${s.name}" first.`); return }
    setBusy(s.name); setErr('')
    const { error } = await supabase.from('charge_codes').insert({ hospital_id: hospitalId, code: serviceCode(department, s.name), name: s.name, department, category: s.category, unit_price_kes: price, is_active: true })
    setBusy('')
    if (error) { fail(error, s.name); return }
    setPrices((p) => ({ ...p, [s.name]: '' }))
    done(`Added ${s.name}.`)
  }
  const valid = (f) => {
    if (!f.name.trim()) return 'Give the service a name.'
    if (!f.code.trim()) return 'Give the service a code.'
    if (f.unit_price_kes === '' || !(Number(f.unit_price_kes) >= 0)) return 'Enter the price (0 or more).'
    return ''
  }
  const saveNew = async () => {
    const v = valid(adding); if (v) { setErr(v); return }
    setBusy('new'); setErr('')
    const { error } = await supabase.from('charge_codes').insert({ hospital_id: hospitalId, department, name: adding.name.trim(), code: adding.code.trim(), category: adding.category,
      unit_price_kes: Number(adding.unit_price_kes), description: adding.description.trim() || null, is_active: true })
    setBusy('')
    if (error) { fail(error, adding.name); return }
    setAdding(null); done(`Added ${adding.name.trim()}.`)
  }
  const saveEdit = async () => {
    const v = valid(editing); if (v) { setErr(v); return }
    setBusy(editing.id); setErr('')
    const { error } = await supabase.from('charge_codes').update({ name: editing.name.trim(), category: editing.category, unit_price_kes: Number(editing.unit_price_kes),
      description: editing.description?.trim() || null }).eq('id', editing.id).eq('hospital_id', hospitalId)
    setBusy('')
    if (error) { fail(error, editing.name); return }
    setEditing(null); done(`Saved ${editing.name.trim()}.`)
  }
  const remove = async (r) => {
    setBusy(r.id); setErr('')
    const { data, error } = await supabase.rpc('service_remove', { p_id: r.id, p_reason: reason.trim() || null })
    setBusy('')
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) { // before docs/sql/52: retire only, never delete
        const { error: e2 } = await supabase.from('charge_codes').update({ is_active: false }).eq('id', r.id).eq('hospital_id', hospitalId)
        if (e2) { fail(e2, r.name); return }
        setRemoving(null); done(`${r.name} is retired: it no longer appears on new bills.`); return
      }
      fail(error, r.name); return
    }
    setRemoving(null)
    done(data === 'deleted' ? `${r.name} is deleted.` : `${r.name} is already on patients' bills, so it is retired instead: it no longer appears on new bills and old bills keep it. You can restore it under Retired.`)
  }
  const restore = async (r) => {
    setBusy(r.id); setErr('')
    const { error } = await supabase.from('charge_codes').update({ is_active: true }).eq('id', r.id).eq('hospital_id', hospitalId)
    setBusy('')
    if (error) { fail(error, r.name); return }
    done(`${r.name} is back on the price list.`)
  }

  const primary = { ...css.backBtn, background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' }
  const small = { ...css.backBtn, padding: '4px 10px' }
  return (
    <SectionCard title="Services and prices" count={active.length}
      note={canManage ? 'You can add, change, retire and remove this department\'s services. Every change is kept in the audit log.' : 'Only an administrator or a finance manager changes services and prices.'}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {[['active', `On the price list (${active.length})`], ['retired', `Retired (${retired.length})`]].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}
            style={{ ...css.backBtn, padding: '5px 12px', ...(view === k ? { background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' } : {}) }}>{l}</button>
        ))}
        {all.length > 10 && <input type="search" aria-label="Search services" placeholder="Search name, code or category" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 13, minWidth: 220 }} />}
        {canManage && !adding && <button type="button" style={{ ...primary, marginLeft: 'auto' }} onClick={() => { setAdding({ ...EMPTY }); setEditing(null); setNotice(''); setErr('') }}>Add a service</button>}
      </div>

      {adding && (
        <div role="group" aria-label="New service" style={{ border: '1px solid #D0D5DD', borderRadius: 10, padding: 14, marginBottom: 12, background: '#FCFCFD' }}>
          <strong style={{ display: 'block', fontSize: 14.5, marginBottom: 10 }}>New {department} service</strong>
          <ServiceForm value={adding} onChange={setAdding} department={department} idPrefix="sv-new" />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" disabled={busy === 'new'} style={primary} onClick={() => void saveNew()}>{busy === 'new' ? 'Saving…' : 'Save service'}</button>
            <button type="button" style={css.backBtn} onClick={() => { setAdding(null); setErr('') }}>Close</button>
          </div>
        </div>
      )}
      {notice && <div role="status" style={{ color: '#05603A', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{notice}</div>}
      {err && <div role="alert" style={{ color: '#912018', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{err}</div>}

      {list.length === 0 ? (
        <EmptyState message={view === 'retired' ? 'No retired services.' : words.length ? 'No service matches this search.' : `No services are priced for ${department} yet.${canManage ? ' Use Add a service, or add the common ones below.' : ' An administrator or finance manager adds them.'}`} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={css.table}>
            <thead><tr>{['Service', 'Code', 'Category', 'Price', ''].map((h, i) => <th key={i} style={css.th}>{h}</th>)}</tr></thead>
            <tbody>{shown.map((r) => editing?.id === r.id ? (
              <tr key={r.id}><td colSpan={5} style={{ ...css.td, background: '#FCFCFD' }}>
                <div role="group" aria-label={`Edit ${r.name}`}>
                  <ServiceForm value={editing} onChange={setEditing} department={department} codeLocked idPrefix="sv-edit" />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button type="button" disabled={busy === r.id} style={primary} onClick={() => void saveEdit()}>{busy === r.id ? 'Saving…' : 'Save changes'}</button>
                    <button type="button" style={css.backBtn} onClick={() => { setEditing(null); setErr('') }}>Cancel</button>
                  </div>
                </div>
              </td></tr>
            ) : (
              <tr key={r.id}>
                <td style={css.td}><div style={{ fontWeight: 700 }}>{r.name}</div>
                  {r.description && <div style={{ fontSize: 12, color: '#475467' }}>{r.description}</div>}
                  {r.is_active === false && r.retired_reason && <div style={{ fontSize: 12, color: '#475467' }}>Retired: {r.retired_reason}</div>}</td>
                <td style={{ ...css.td, fontFamily: 'monospace', fontSize: 12 }}>{r.code}</td>
                <td style={css.td}>{r.category || '—'}</td>
                <td style={{ ...css.td, fontWeight: 700, whiteSpace: 'nowrap' }}>{kes(r.unit_price_kes)}</td>
                <td style={{ ...css.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canManage && removing !== r.id && (r.is_active === false ? (
                    <button type="button" disabled={busy === r.id} style={small} onClick={() => void restore(r)}>Restore</button>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <button type="button" style={small} aria-label={`Edit ${r.name}`} onClick={() => { setEditing({ id: r.id, name: r.name || '', code: r.code || '', category: r.category || 'Other', unit_price_kes: String(r.unit_price_kes ?? ''), description: r.description || '' }); setAdding(null); setNotice(''); setErr('') }}>Edit</button>
                      <button type="button" style={{ ...css.dangerBtn, padding: '4px 10px' }} aria-label={`Remove ${r.name}`} onClick={() => { setRemoving(r.id); setReason(''); setNotice('') }}>Remove</button>
                    </span>
                  ))}
                  {canManage && removing === r.id && (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <input aria-label={`Reason for removing ${r.name}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)"
                        style={{ padding: '5px 8px', border: '1px solid #D0D5DD', borderRadius: 6, fontSize: 13, minWidth: 160 }} />
                      <button type="button" disabled={busy === r.id} style={{ ...css.dangerBtn, padding: '4px 10px' }} onClick={() => void remove(r)}>Confirm remove</button>
                      <button type="button" style={small} onClick={() => setRemoving(null)}>Keep</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, fontSize: 13 }}>
          <button type="button" style={small} disabled={page === 0} onClick={() => setPage((n) => n - 1)}>‹ Previous</button>
          <span>{page * PAGE + 1}–{Math.min(list.length, (page + 1) * PAGE)} of {list.length}</span>
          <button type="button" style={small} disabled={page >= pages - 1} onClick={() => setPage((n) => n + 1)}>Next ›</button>
        </div>
      )}
      <p style={{ fontSize: 12.5, color: '#475467', margin: '8px 0 0' }}>Prices shown are the cash tariff; SHA, insurance and corporate price lists apply automatically at billing. Payment is taken at the cashier. A service already on a bill is retired, not deleted, so old bills stay correct.</p>
      {canManage && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {suggestions.length > 0 && <button type="button" style={css.backBtn} aria-expanded={showSuggestions} onClick={() => setShowSuggestions((v) => !v)}>{showSuggestions ? 'Hide suggestions' : `Add common ${department} services (${suggestions.length})`}</button>}
          <button type="button" style={css.backBtn} onClick={() => navigate?.('settings')}>Payer price lists (SHA, insurers)</button>
        </div>
      )}
      {canManage && showSuggestions && (
        <div style={{ marginTop: 10, border: '1px solid #EAECF0', borderRadius: 8 }}>
          {suggestions.map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid #EAECF0', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 220px', fontSize: 13, fontWeight: 600 }}>{s.name} <span style={{ color: '#475467', fontWeight: 500 }}>· {s.category}</span></span>
              <input type="number" min={1} placeholder="Price (KES)" aria-label={`Price for ${s.name}`} value={prices[s.name] || ''} onChange={(e) => setPrices((p) => ({ ...p, [s.name]: e.target.value }))}
                style={{ width: 130, padding: '6px 8px', border: '1px solid #D0D5DD', borderRadius: 6, fontSize: 13 }} />
              <button type="button" disabled={busy === s.name} style={{ ...css.backBtn, padding: '6px 12px' }} onClick={() => void addSuggested(s)}>{busy === s.name ? 'Adding…' : 'Add'}</button>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
