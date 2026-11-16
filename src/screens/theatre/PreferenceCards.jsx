// Surgeon preference cards and the case items panel: items picked from stock leave stock first-expiry-first-out in the
// database and carry the stock price; unbilled items go to the cashier as one bill (cashier-only payments).
// Data: theatre_preference_cards / theatre_items (20261212000000_theatre_preference_cards.sql).
import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'
import { unpaidInvoiceFields } from '../../utils/payments/invoices'
import { buildWorkflowInvoiceNote, createServiceLine, SERVICE_SOURCES, stringifyServiceLines } from '../../utils/workflowBilling'
import { C, Chip, s } from '../ncd/ui'

const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Not installed yet. Run docs/sql/30_theatre_preference_cards.sql in Supabase.'
  if (/duplicate key|unique/i.test(m)) return 'This surgeon already has a card for that procedure — edit it instead.'
  return m
}
const CARD_FIELDS = [['glove_size', 'Glove size'], ['position', 'Position'], ['skin_prep', 'Skin prep'], ['drapes', 'Drapes'], ['instruments', 'Instrument sets'], ['sutures', 'Sutures'], ['equipment', 'Equipment (diathermy, C-arm, tourniquet…)'], ['medications', 'Medications / irrigation'], ['notes', 'Notes']]
const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE')}`

export function useStock(hospitalId) {
  const [stock, setStock] = useState([])
  useEffect(() => {
    if (!hospitalId) return
    void supabase.from('pharmacy_inventory').select('id, drug_name, quantity_in_stock, selling_price').eq('hospital_id', hospitalId).order('drug_name').limit(2000).then(({ data }) => setStock(data || []))
  }, [hospitalId])
  return stock
}

export function findCard(cards, surgeon, procedure) {
  const norm = (v) => String(v || '').trim().toLowerCase()
  return cards.find((c) => c.active !== false && norm(c.surgeon) === norm(surgeon) && norm(c.procedure) === norm(procedure)) || null
}

export function PreferenceCards({ hospitalId }) {
  const stock = useStock(hospitalId)
  const [cards, setCards] = useState([])
  const [edit, setEdit] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('theatre_preference_cards').select('*').eq('hospital_id', hospitalId).order('surgeon')
    if (error) setErr(friendly(error)); else { setErr(''); setCards(data || []) }
  }, [hospitalId])
  useEffect(() => { void load() }, [load])
  async function save() {
    setErr('')
    if (!edit.surgeon?.trim() || !edit.procedure?.trim()) { setErr('Name the surgeon and the procedure.'); return }
    const row = { hospital_id: hospitalId, ...Object.fromEntries(['surgeon', 'procedure', ...CARD_FIELDS.map(([k]) => k)].map((k) => [k, edit[k] || null])), items: edit.items || [], active: edit.active !== false }
    const { error } = edit.id ? await supabase.from('theatre_preference_cards').update(row).eq('id', edit.id) : await supabase.from('theatre_preference_cards').insert(row)
    if (error) setErr(friendly(error)); else { setEdit(null); void load() }
  }
  const shown = cards.filter((c) => !q || `${c.surgeon} ${c.procedure}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input aria-label="Search cards" placeholder="Search surgeon or procedure" style={s.input} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" style={{ ...s.btn, ...s.pri, whiteSpace: 'nowrap' }} onClick={() => setEdit({ items: [] })}>+ New card</button>
      </div>
      {edit && <CardEditor edit={edit} setEdit={setEdit} stock={stock} onSave={save} />}
      <div style={s.grid(300)}>
        {shown.map((c) => (
          <div key={c.id} style={{ ...s.card, opacity: c.active === false ? 0.5 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><b>{c.procedure}</b><button type="button" style={{ ...s.btn, ...s.ghost, padding: '2px 9px' }} onClick={() => setEdit(c)}>Edit</button></div>
            <div style={s.sub}>{c.surgeon}{c.glove_size ? ` · gloves ${c.glove_size}` : ''}{c.position ? ` · ${c.position}` : ''}</div>
            {(c.items || []).length > 0 && <div style={{ fontSize: 12, marginTop: 4 }}>{c.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</div>}
          </div>
        ))}
      </div>
      {!shown.length && !edit && <div style={{ ...s.card, ...s.sub }}>No preference cards yet. A card lists what a surgeon wants for a procedure so the scrub team can set up and pick items in one step.</div>}
    </div>
  )
}

function CardEditor({ edit, setEdit, stock, onSave }) {
  const [pick, setPick] = useState({ inventory_id: '', name: '', quantity: 1, kind: 'consumable' })
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value })
  function addItem() {
    const st = stock.find((x) => x.id === pick.inventory_id)
    const name = st?.drug_name || pick.name.trim()
    if (!name) return
    setEdit({ ...edit, items: [...(edit.items || []), { kind: pick.kind, name, inventory_id: st?.id || null, quantity: Number(pick.quantity) || 1 }] })
    setPick({ inventory_id: '', name: '', quantity: 1, kind: 'consumable' })
  }
  return (
    <div style={{ ...s.card, marginBottom: 12, borderColor: C.primary }}>
      <div style={s.grid(220)}>
        <div><label style={s.label} htmlFor="pc-surgeon">Surgeon *</label><input id="pc-surgeon" style={s.input} value={edit.surgeon || ''} onChange={set('surgeon')} /></div>
        <div><label style={s.label} htmlFor="pc-procedure">Procedure *</label><input id="pc-procedure" style={s.input} value={edit.procedure || ''} onChange={set('procedure')} /></div>
        {CARD_FIELDS.map(([k, l]) => <div key={k}><label style={s.label} htmlFor={`pc-${k}`}>{l}</label><input id={`pc-${k}`} style={s.input} value={edit[k] || ''} onChange={set(k)} /></div>)}
      </div>
      <div style={{ ...s.label, marginTop: 10 }}>Pick list</div>
      {(edit.items || []).map((i, n) => (
        <div key={n} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', borderBottom: `1px solid ${C.border}` }}>
          <span>{i.quantity}× {i.name} <span style={s.sub}>({i.kind}{i.inventory_id ? ', from stock' : ''})</span></span>
          <button type="button" aria-label={`Remove ${i.name}`} style={{ ...s.btn, ...s.ghost, padding: '1px 7px' }} onClick={() => setEdit({ ...edit, items: edit.items.filter((_, j) => j !== n) })}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, alignItems: 'end', flexWrap: 'wrap', marginTop: 6 }}>
        <div style={{ minWidth: 220 }}><label style={s.label} htmlFor="pc-stock">Stock item</label><select id="pc-stock" style={s.input} value={pick.inventory_id} onChange={(e) => setPick({ ...pick, inventory_id: e.target.value })}><option value="">Not from stock — type a name</option>{stock.map((x) => <option key={x.id} value={x.id}>{x.drug_name}</option>)}</select></div>
        {!pick.inventory_id && <div><label style={s.label} htmlFor="pc-name">Name</label><input id="pc-name" style={s.input} value={pick.name} onChange={(e) => setPick({ ...pick, name: e.target.value })} /></div>}
        <div><label style={s.label} htmlFor="pc-kind">Kind</label><select id="pc-kind" style={s.input} value={pick.kind} onChange={(e) => setPick({ ...pick, kind: e.target.value })}><option value="consumable">Consumable</option><option value="implant">Implant</option><option value="instrument_set">Instrument set</option></select></div>
        <div><label style={s.label} htmlFor="pc-qty">Qty</label><input id="pc-qty" type="number" min="1" style={{ ...s.input, width: 80 }} value={pick.quantity} onChange={(e) => setPick({ ...pick, quantity: e.target.value })} /></div>
        <button type="button" style={{ ...s.btn, ...s.soft }} onClick={addItem}>Add to list</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
        <label style={{ display: 'flex', gap: 6, fontSize: 12 }}><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Active</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setEdit(null)}>Cancel</button>
          <button type="button" style={{ ...s.btn, ...s.pri }} onClick={onSave}>Save card</button>
        </div>
      </div>
    </div>
  )
}

/** Items panel inside a theatre case. */
export function CaseItems({ c, items, reload, closed }) {
  const stock = useStock(c.hospital_id)
  const [cards, setCards] = useState([])
  const [item, setItem] = useState({ kind: 'consumable', inventory_id: '', name: '', manufacturer: '', lot_number: '', serial: '', quantity: 1, site: '', unit_price: '' })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { void supabase.from('theatre_preference_cards').select('*').eq('hospital_id', c.hospital_id).then(({ data }) => setCards(data || [])) }, [c.hospital_id])
  const card = findCard(cards, c.surgeon, c.procedure)
  const st = stock.find((x) => x.id === item.inventory_id)
  async function insert(row) {
    const { error } = await supabase.from('theatre_items').insert({ hospital_id: c.hospital_id, case_id: c.id, ...row })
    if (error) throw new Error(friendly(error))
  }
  async function addItem(e) {
    e.preventDefault(); setErr(''); setMsg('')
    const name = st?.drug_name || item.name.trim()
    if (!name) { setErr('Choose a stock item or type the name.'); return }
    if (item.kind === 'implant' && !item.lot_number && !item.serial) { setErr('Implants need a lot or serial number (for recalls).'); return }
    try {
      await insert({ kind: item.kind, name, inventory_id: st?.id || null, manufacturer: item.manufacturer || null, lot_number: item.lot_number || null, serial: item.serial || null,
        quantity: Number(item.quantity) || 1, site: item.site || null, unit_price: item.unit_price === '' ? null : Number(item.unit_price) })
      setItem({ ...item, inventory_id: '', name: '', manufacturer: '', lot_number: '', serial: '', site: '', unit_price: '', quantity: 1 })
      reload()
    } catch (x) { setErr(x.message) }
  }
  async function addFromCard() {
    setErr(''); setMsg('')
    const todo = (card.items || []).filter((i) => i.kind !== 'implant')   // implants need lot / serial at the time of use
    let n = 0
    for (const i of todo) {
      try { await insert({ kind: i.kind, name: i.name, inventory_id: i.inventory_id || null, quantity: Number(i.quantity) || 1 }); n += 1 } catch (x) { setErr(`${i.name}: ${x.message}`); break }
    }
    if (n) setMsg(`${n} item(s) added from ${c.surgeon}'s card${(card.items || []).some((i) => i.kind === 'implant') ? '. Add implants one by one with their lot / serial number.' : '.'}`)
    reload()
  }
  const unbilled = items.filter((i) => !i.invoice_id && Number(i.unit_price) > 0)
  const unbilledTotal = unbilled.reduce((a, i) => a + Number(i.unit_price) * Number(i.quantity), 0)
  async function bill() {
    setErr(''); setMsg('')
    const lines = unbilled.map((i) => createServiceLine({ label: `${i.name}${i.serial ? ` (S/N ${i.serial})` : i.lot_number ? ` (lot ${i.lot_number})` : ''}`, qty: Number(i.quantity), unitPrice: Number(i.unit_price), total: Number(i.unit_price) * Number(i.quantity), source: SERVICE_SOURCES.PROCEDURE, sourceId: i.id, visitId: c.visit_id || null }))
    const { data: inv, error } = await supabase.from('invoices').insert({
      hospital_id: c.hospital_id, patient_id: c.patient_id, visit_id: c.visit_id || null, patient_name: c.patients?.full_name || 'Patient', invoice_no: `TH-${Date.now().toString().slice(-6)}`,
      services: stringifyServiceLines(lines), ...unpaidInvoiceFields(unbilledTotal), payment_method: 'Cash',
      notes: buildWorkflowInvoiceNote({ source: SERVICE_SOURCES.PROCEDURE, sourceId: c.id, visitId: c.visit_id || null, summary: `Theatre items — ${c.procedure}` }),
    }).select('id, invoice_no').single()
    if (error) { setErr(friendly(error)); return }
    for (const i of unbilled) {
      const { error: e2 } = await supabase.from('theatre_items').update({ invoice_id: inv.id }).eq('id', i.id)
      if (e2) { setErr(`Bill ${inv.invoice_no} created, but ${i.name} could not be marked billed: ${e2.message}`); reload(); return }
    }
    setMsg(`Bill ${inv.invoice_no} (${kes(unbilledTotal)}) sent to the cashier.`)
    reload()
  }
  return (
    <div style={s.card}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {msg && <div style={s.ok}>{msg}</div>}
      {card ? (
        <div style={{ background: '#F5F8FF', border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
            <b>Preference card — {card.surgeon}, {card.procedure}</b>
            {!closed && (card.items || []).length > 0 && <button type="button" style={{ ...s.btn, ...s.soft }} onClick={addFromCard}>Add items from card</button>}
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{CARD_FIELDS.filter(([k]) => card[k]).map(([k, l]) => <div key={k}><b>{l}:</b> {card[k]}</div>)}</div>
          {(card.items || []).length > 0 && <div style={{ fontSize: 12, marginTop: 4 }}><b>Pick list:</b> {card.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</div>}
        </div>
      ) : <div style={{ ...s.sub, marginBottom: 8 }}>No preference card for {c.surgeon} / {c.procedure}. Add one under Preference cards.</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{['Kind', 'Item', 'Lot / serial', 'Qty', 'Price', 'Stock', 'Billed'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>{items.map((i) => (
          <tr key={i.id}>
            <td style={s.td}>{i.kind.replace('_', ' ')}</td><td style={s.td}>{i.name}{i.manufacturer ? ` (${i.manufacturer})` : ''}</td>
            <td style={s.td}>{[i.lot_number, i.serial].filter(Boolean).join(' / ') || '—'}</td><td style={s.td}>{i.quantity}</td>
            <td style={s.td}>{i.unit_price ? kes(i.unit_price) : '—'}</td>
            <td style={s.td}>{i.stock_issue ? (i.stock_issue.batches?.length ? i.stock_issue.batches.map((b) => b.batch_number).join(', ') : 'issued') : 'not from stock'}</td>
            <td style={s.td}>{i.invoice_id ? <Chip tone="green">Billed</Chip> : Number(i.unit_price) > 0 ? <Chip tone="yellow">Not yet</Chip> : '—'}</td>
          </tr>
        ))}</tbody>
      </table>
      {unbilled.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
          <span style={{ fontSize: 13 }}>{unbilled.length} item(s) not billed · <b>{kes(unbilledTotal)}</b></span>
          <button type="button" style={{ ...s.btn, ...s.pri }} onClick={bill}>Send items bill to cashier</button>
        </div>
      )}
      {!closed && (
        <form onSubmit={addItem} style={{ ...s.grid(140), alignItems: 'end', marginTop: 10 }}>
          <div><label style={s.label} htmlFor="it-kind">Kind</label><select id="it-kind" style={s.input} value={item.kind} onChange={(e) => setItem({ ...item, kind: e.target.value })}><option value="implant">Implant</option><option value="consumable">Consumable</option><option value="instrument_set">Instrument set</option></select></div>
          <div style={{ gridColumn: 'span 2' }}><label style={s.label} htmlFor="it-stock">From stock</label><select id="it-stock" style={s.input} value={item.inventory_id} onChange={(e) => setItem({ ...item, inventory_id: e.target.value })}><option value="">Not from stock (consignment / own)</option>{stock.map((x) => <option key={x.id} value={x.id}>{x.drug_name} — {x.quantity_in_stock} in stock{x.selling_price ? `, ${kes(x.selling_price)}` : ''}</option>)}</select></div>
          {!item.inventory_id && <div><label style={s.label} htmlFor="it-name">Item *</label><input id="it-name" style={s.input} value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} /></div>}
          {[['manufacturer', 'Manufacturer'], ['lot_number', 'Lot / batch'], ['serial', 'Serial'], ['site', 'Site']].map(([k, l]) => <div key={k}><label style={s.label} htmlFor={`it-${k}`}>{l}</label><input id={`it-${k}`} style={s.input} value={item[k]} onChange={(e) => setItem({ ...item, [k]: e.target.value })} /></div>)}
          <div><label style={s.label} htmlFor="it-qty">Qty</label><input id="it-qty" type="number" min="1" style={s.input} value={item.quantity} onChange={(e) => setItem({ ...item, quantity: e.target.value })} /></div>
          {!item.inventory_id && <div><label style={s.label} htmlFor="it-price">Price each (KES)</label><input id="it-price" type="number" min="0" style={s.input} value={item.unit_price} onChange={(e) => setItem({ ...item, unit_price: e.target.value })} /></div>}
          <button type="submit" style={{ ...s.btn, ...s.pri }}>Add</button>
        </form>
      )}
      <div style={{ ...s.sub, marginTop: 6 }}>Items from stock are taken first-expiry-first-out and priced from stock. Implant records are permanent and need a lot or serial number for recalls. Payment is taken at the cashier.</div>
    </div>
  )
}
