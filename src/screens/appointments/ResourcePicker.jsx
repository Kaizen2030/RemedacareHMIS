// Room and equipment for an appointment. The database refuses a booking when the room or item is already
// in use at that time beyond its quantity (20261220000000_safety_checks.sql); appointment types add their
// own equipment automatically.
import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'

export default function ResourcePicker({ hospitalId, form, setForm, css = {} }) {
  const [items, setItems] = useState(null)
  const [manage, setManage] = useState(false)
  const [draft, setDraft] = useState({ name: '', kind: 'room', quantity: 1 })
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('scheduling_resources').select('*').eq('hospital_id', hospitalId).order('name')
    if (error) { setItems(null); return }
    setItems(data || [])
    setForm((f) => (f.resources_enabled ? f : { ...f, resources_enabled: true }))
  }, [hospitalId, setForm])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])
  if (!items) return null
  const rooms = items.filter((i) => i.kind === 'room' && i.active)
  const equipment = items.filter((i) => i.kind === 'equipment' && i.active)
  const chosen = form.resources || []
  const toggle = (name) => setForm((f) => ({ ...f, resources: chosen.includes(name) ? chosen.filter((x) => x !== name) : [...chosen, name] }))
  const add = async () => {
    setErr('')
    const { error } = await supabase.from('scheduling_resources').insert({ hospital_id: hospitalId, name: draft.name.trim(), kind: draft.kind, quantity: Number(draft.quantity) || 1 })
    if (error) { setErr(/unique|duplicate/i.test(error.message) ? 'That name already exists.' : /row-level|permission/i.test(error.message) ? 'Only reception or an administrator can add rooms and equipment.' : error.message); return }
    setDraft({ name: '', kind: draft.kind, quantity: 1 }); void load()
  }
  const deactivate = async (item) => {
    const { error } = await supabase.from('scheduling_resources').update({ active: !item.active }).eq('id', item.id)
    if (error) setErr(error.message); else void load()
  }
  return (
    <div style={{ marginTop: 12 }}>
      <div style={css.grid2 || { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={css.label} htmlFor="appt-room">Room</label>
          <select id="appt-room" style={css.select || css.input} value={form.room || ''} onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))}>
            <option value="">No room</option>
            {rooms.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
          </select>
        </div>
        <div>
          <span style={css.label}>Equipment</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12 }}>
            {equipment.length === 0 && <span style={{ color: '#667085' }}>None set up</span>}
            {equipment.map((e) => (
              <label key={e.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={chosen.includes(e.name)} onChange={() => toggle(e.name)} />{e.name}{e.quantity > 1 ? ` (×${e.quantity})` : ''}
              </label>
            ))}
          </div>
        </div>
      </div>
      <button type="button" onClick={() => setManage((m) => !m)} style={{ marginTop: 6, background: 'none', border: 'none', color: '#175CD3', cursor: 'pointer', fontSize: 12, padding: 0 }}>
        {manage ? 'Hide rooms & equipment list' : 'Manage rooms & equipment'}
      </button>
      {manage && (
        <div style={{ marginTop: 6, padding: 10, border: '1px solid #EAECF0', borderRadius: 8, fontSize: 12 }}>
          {err && <div role="alert" style={{ color: '#B42318', marginBottom: 6 }}>{err}</div>}
          {items.map((i) => (
            <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: i.active ? undefined : '#98A2B3' }}>
              <span>{i.name} · {i.kind}{i.quantity > 1 ? ` ×${i.quantity}` : ''}</span>
              <button type="button" onClick={() => deactivate(i)} style={{ background: 'none', border: 'none', color: '#175CD3', cursor: 'pointer', fontSize: 12 }}>{i.active ? 'Retire' : 'Restore'}</button>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 70px auto', gap: 6, marginTop: 6 }}>
            <input aria-label="Resource name" style={css.input} placeholder="e.g. Procedure room 1, Ultrasound" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            <select aria-label="Resource kind" style={css.select || css.input} value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}><option value="room">Room</option><option value="equipment">Equipment</option></select>
            <input aria-label="Quantity" type="number" min={1} max={50} style={css.input} value={draft.quantity} onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))} />
            <button type="button" disabled={!draft.name.trim()} onClick={add} style={{ padding: '6px 10px', borderRadius: 8, border: 'none', background: '#0F6E56', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Add</button>
          </div>
        </div>
      )}
    </div>
  )
}
