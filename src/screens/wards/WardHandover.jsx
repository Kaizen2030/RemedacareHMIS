// Ward-level medication board ("due now / overdue") and nursing shift handover.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { effectiveStatus } from './WardMar'

const time = (iso) => new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Nairobi' })

/** Doses due within the next hour or overdue, across every occupied bed of the ward. */
export function WardMedsDue({ beds = [], onOpenBed }) {
  const visitIds = useMemo(() => beds.filter((b) => b.visit_id).map((b) => b.visit_id), [beds])
  const [doses, setDoses] = useState([])
  const load = useCallback(async () => {
    if (!visitIds.length) { setDoses([]); return }
    const { data } = await supabase.from('mar_doses').select('id, visit_id, drug_name, dose, scheduled_at, status')
      .in('visit_id', visitIds).eq('status', 'due').lte('scheduled_at', new Date(Date.now() + 3600e3).toISOString()).order('scheduled_at').limit(100)
    setDoses(data || [])
  }, [visitIds])
  useEffect(() => { void load(); const t = setInterval(load, 120000); return () => clearInterval(t) }, [load])
  if (!doses.length) return null
  const bedOf = (visitId) => beds.find((b) => String(b.visit_id) === String(visitId))
  const overdue = doses.filter((d) => effectiveStatus(d) === 'overdue').length
  return (
    <div role="region" aria-label="Medicines due" style={{ gridColumn: '1 / -1', border: `1px solid ${overdue ? '#FDA29B' : '#B2DDFF'}`, background: overdue ? '#FEF3F2' : '#EFF8FF', borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontWeight: 800, fontSize: 13, color: overdue ? '#B42318' : '#175CD3' }}>
        Medicines due: {doses.length}{overdue ? ` · ${overdue} overdue` : ''}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {doses.slice(0, 24).map((d) => {
          const b = bedOf(d.visit_id)
          const od = effectiveStatus(d) === 'overdue'
          return (
            <button key={d.id} type="button" onClick={() => b && onOpenBed?.(b)}
              style={{ border: 'none', borderRadius: 8, padding: '4px 8px', fontSize: 11, cursor: 'pointer', background: '#fff', color: od ? '#B42318' : '#344054', fontWeight: 700 }}>
              {time(d.scheduled_at)} · Bed {b?.bed_number || '?'} · {d.drug_name} {d.dose || ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Shift handover: per-patient medication summary for the last 12 h + notes, acknowledged by the incoming nurse. */
export default function WardHandover({ hospitalId, ward, beds = [], onClose }) {
  const occupied = useMemo(() => beds.filter((b) => b.patient_id && b.visit_id), [beds])
  const [stats, setStats] = useState({})
  const [notes, setNotes] = useState({})
  const [form, setForm] = useState({ shift: new Date().getHours() >= 7 && new Date().getHours() < 19 ? 'day' : 'night', from: '', to: '', summary: '' })
  const [history, setHistory] = useState([])
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 12 * 3600e3).toISOString()
    const ids = occupied.map((b) => b.visit_id)
    const [d, h] = await Promise.all([
      ids.length ? supabase.from('mar_doses').select('visit_id, status, scheduled_at, drug_name').in('visit_id', ids).gte('scheduled_at', since).lte('scheduled_at', new Date().toISOString()) : Promise.resolve({ data: [] }),
      supabase.from('ward_handovers').select('*').eq('hospital_id', hospitalId).eq('ward_id', String(ward?.id || '')).order('handover_at', { ascending: false }).limit(10),
    ])
    if (h.error) setErr(/does not exist|schema cache/i.test(h.error.message) ? 'Handover is not installed yet. Run docs/sql/09_ward_mar.sql.' : h.error.message)
    const s = {}
    for (const row of d.data || []) {
      const k = String(row.visit_id); s[k] = s[k] || { given: 0, missed: 0, held: 0, overdue: [], refused: 0 }
      const st = effectiveStatus(row)
      if (st === 'given') s[k].given++
      else if (st === 'missed') s[k].missed++
      else if (['held', 'not_available'].includes(st)) s[k].held++
      else if (st === 'refused') s[k].refused++
      else if (st === 'overdue' || st === 'due') s[k].overdue.push(`${row.drug_name} ${time(row.scheduled_at)}`)
    }
    setStats(s); setHistory(h.data || [])
  }, [occupied, hospitalId, ward?.id])
  useEffect(() => { void load() }, [load])

  async function save() {
    if (!form.from.trim()) { setErr('Enter your name (handing over).'); return }
    setErr('')
    const patients = occupied.map((b) => {
      const st = stats[String(b.visit_id)] || { given: 0, missed: 0, held: 0, refused: 0, overdue: [] }
      return { bed: b.bed_number, patient: b.patients?.full_name || 'Patient', given: st.given, missed: st.missed, held: st.held, refused: st.refused, outstanding: st.overdue, note: notes[b.id] || '' }
    })
    const { error } = await supabase.from('ward_handovers').insert({ hospital_id: hospitalId, ward_id: String(ward?.id || ''), ward_name: ward?.name || null, shift: form.shift,
      from_nurse: form.from.trim(), to_nurse: form.to.trim() || null, summary: form.summary.trim() || null, patients })
    if (error) { setErr(error.message); return }
    setSaved('Handover saved. The incoming nurse acknowledges it below.'); setNotes({}); await load()
  }
  async function acknowledge(h) {
    const { error } = await supabase.from('ward_handovers').update({ acknowledged_at: new Date().toISOString(), acknowledged_by: (await supabase.auth.getUser()).data?.user?.id || null }).eq('id', h.id)
    if (error) setErr(error.message); else await load()
  }

  const input = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: '1px solid #D0D5DD', borderRadius: 7, fontSize: 12 }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 }} role="dialog" aria-modal="true" aria-label="Shift handover">
      <div style={{ width: 860, maxWidth: '97vw', maxHeight: '92vh', overflowY: 'auto', background: '#fff', borderRadius: 14, padding: 18, fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Shift handover — {ward?.name}</h2>
          <button type="button" onClick={onClose} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #D0D5DD', background: '#fff', cursor: 'pointer' }}>Close</button>
        </div>
        {err && <div role="alert" style={{ background: '#FEF3F2', color: '#B42318', borderRadius: 8, padding: '8px 10px', margin: '10px 0' }}>{err}</div>}
        {saved && <div role="status" style={{ background: '#ECFDF3', color: '#027A48', borderRadius: 8, padding: '8px 10px', margin: '10px 0' }}>{saved}</div>}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
          <thead><tr>{['Bed', 'Patient', 'Meds last 12 h', 'Outstanding', 'Handover note'].map((h) => <th key={h} style={{ textAlign: 'left', fontSize: 11, color: '#667085', padding: 6, borderBottom: '1px solid #EAECF0' }}>{h}</th>)}</tr></thead>
          <tbody>{occupied.map((b) => {
            const st = stats[String(b.visit_id)] || { given: 0, missed: 0, held: 0, refused: 0, overdue: [] }
            return (
              <tr key={b.id}>
                <td style={{ padding: 6, borderBottom: '1px solid #F2F4F7' }}>{b.bed_number}</td>
                <td style={{ padding: 6, borderBottom: '1px solid #F2F4F7' }}>{b.patients?.full_name}</td>
                <td style={{ padding: 6, borderBottom: '1px solid #F2F4F7', fontSize: 12 }}>{st.given} given{st.missed ? <strong style={{ color: '#B42318' }}> · {st.missed} missed</strong> : ''}{st.held ? ` · ${st.held} held` : ''}{st.refused ? ` · ${st.refused} refused` : ''}</td>
                <td style={{ padding: 6, borderBottom: '1px solid #F2F4F7', fontSize: 12, color: st.overdue.length ? '#B42318' : '#667085' }}>{st.overdue.join(', ') || '—'}</td>
                <td style={{ padding: 6, borderBottom: '1px solid #F2F4F7' }}><input aria-label={`Note for bed ${b.bed_number}`} style={input} value={notes[b.id] || ''} placeholder="condition, pending tasks, watch for…" onChange={(e) => setNotes((x) => ({ ...x, [b.id]: e.target.value }))} /></td>
              </tr>
            )
          })}</tbody>
        </table>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 8, marginTop: 12 }}>
          <label style={{ fontSize: 11 }}>Shift<select style={input} value={form.shift} onChange={(e) => setForm((x) => ({ ...x, shift: e.target.value }))}><option value="day">Day</option><option value="night">Night</option><option value="other">Other</option></select></label>
          <label style={{ fontSize: 11 }}>Handing over (you)<input style={input} value={form.from} onChange={(e) => setForm((x) => ({ ...x, from: e.target.value }))} /></label>
          <label style={{ fontSize: 11 }}>Receiving nurse<input style={input} value={form.to} onChange={(e) => setForm((x) => ({ ...x, to: e.target.value }))} /></label>
        </div>
        <label style={{ display: 'block', fontSize: 11, marginTop: 8 }}>Ward summary<textarea rows={2} style={input} value={form.summary} onChange={(e) => setForm((x) => ({ ...x, summary: e.target.value }))} placeholder="admissions, discharges, critical patients, stock issues" /></label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" onClick={save} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#0F6E56', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Save handover</button>
        </div>
        {history.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#0F6E56', textTransform: 'uppercase' }}>Recent handovers</div>
            {history.map((h) => (
              <div key={h.id} style={{ borderBottom: '1px solid #F2F4F7', padding: '8px 0', fontSize: 12 }}>
                <strong>{new Date(h.handover_at).toLocaleString('en-KE')}</strong> · {h.shift} · {h.from_nurse} → {h.to_nurse || '—'}{h.summary ? ` · ${h.summary}` : ''}
                {h.acknowledged_at ? <span style={{ color: '#027A48' }}> · acknowledged {new Date(h.acknowledged_at).toLocaleTimeString('en-KE')}</span>
                  : <button type="button" onClick={() => acknowledge(h)} style={{ marginLeft: 8, padding: '3px 8px', borderRadius: 7, border: 'none', background: '#EFF8FF', color: '#175CD3', fontWeight: 700, cursor: 'pointer' }}>Acknowledge</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
