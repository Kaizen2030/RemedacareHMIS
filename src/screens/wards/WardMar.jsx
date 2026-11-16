// Medication administration record for one admitted patient: the next 24 h of scheduled doses
// (generated from the prescriptions), due / overdue alerts, give / hold / refuse with reason,
// PRN doses on demand, and corrections ("entered in error") that keep the history.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { performSyncableAction } from '../../utils/offlineSync'

const STATUS = {
  due: ['Due', '#175CD3', '#EFF8FF'], overdue: ['Overdue', '#B42318', '#FEF3F2'], given: ['Given', '#027A48', '#ECFDF3'],
  held: ['Held', '#B54708', '#FFFAEB'], refused: ['Refused', '#B54708', '#FFFAEB'], not_available: ['Not available', '#B54708', '#FFFAEB'],
  missed: ['Missed', '#B42318', '#FEF3F2'], entered_in_error: ['In error', '#667085', '#F2F4F7'],
}
const time = (iso) => new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Nairobi' })
const day = (iso) => new Date(iso).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })
const CONTROLLED = /(morphine|pethidine|fentanyl|diazepam|midazolam|lorazepam|ketamine|insulin|potassium chloride|heparin)/i

export function effectiveStatus(dose, now = Date.now()) {
  if (dose.status === 'due' && new Date(dose.scheduled_at).getTime() < now - 60 * 60000) return 'overdue'
  return dose.status
}

export default function WardMar({ hospitalId, visitId, patientId, prescriptions = [], styles = {} }) {
  const [doses, setDoses] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState(null) // { dose, status, reason, witness, notes }
  const [prn, setPrn] = useState({ rxId: '', witness: '', notes: '' })

  const load = useCallback(async () => {
    if (!visitId) return
    setError('')
    const gen = await supabase.rpc('mar_generate', { p_visit: visitId, p_hours: 24 })
    if (gen.error && !/does not exist|schema cache/i.test(gen.error.message)) setError(gen.error.message)
    if (gen.error && /does not exist|schema cache/i.test(gen.error.message)) { setError('The medication chart is not installed yet. Run docs/sql/09_ward_mar.sql in Supabase.'); return }
    const { data, error: e } = await supabase.from('mar_doses').select('*').eq('visit_id', visitId)
      .gte('scheduled_at', new Date(Date.now() - 24 * 3600e3).toISOString()).order('scheduled_at')
    if (e) setError(e.message)
    setDoses(data || [])
  }, [visitId])
  useEffect(() => { void load() }, [load])

  const prnRx = useMemo(() => prescriptions.filter((rx) => /as needed|prn|when required|sos/i.test(rx.frequency || '') && !['Rejected', 'Cancelled'].includes(rx.status)), [prescriptions])
  const counts = useMemo(() => doses.reduce((acc, d) => { const st = effectiveStatus(d); acc[st] = (acc[st] || 0) + 1; return acc }, {}), [doses])

  async function sign() {
    const a = action
    if (['held', 'refused', 'not_available', 'entered_in_error'].includes(a.status) && !a.reason.trim()) { setError('Give a reason.'); return }
    if (a.status === 'given' && CONTROLLED.test(a.dose.drug_name) && !a.witness.trim()) { setError('A second nurse must witness this drug — enter their name.'); return }
    setBusy(true); setError('')
    // Works offline: queued with the real time of administration, and held for review if another nurse
    // documented this dose on another device meanwhile (status no longer what this nurse saw).
    const { error: e, offlineQueued } = await performSyncableAction(supabase, {
      table: 'mar_doses', operation: 'update', where: { column: 'id', value: a.dose.id }, base: { status: a.dose.status },
      label: `${a.dose.drug_name} ${a.dose.dose || ''} — ${STATUS[a.status]?.[0] || a.status}`,
      payload: { status: a.status, reason: a.reason.trim() || null, witness: a.witness.trim() || null, notes: a.notes.trim() || null,
        ...(a.status !== 'entered_in_error' ? { administered_at: new Date().toISOString() } : {}) },
    })
    setBusy(false)
    if (e) { setError(e.message); return }
    setAction(null)
    if (offlineQueued) {
      setDoses((list) => list.map((d) => (d.id === a.dose.id ? { ...d, status: a.status, reason: a.reason.trim() || null, administered_by_name: 'saved on this device — waiting to sync' } : d)))
      return
    }
    await load()
  }
  async function givePrn() {
    const rx = prnRx.find((r) => String(r.id) === String(prn.rxId))
    if (!rx) return
    if (CONTROLLED.test(rx.drug_name) && !prn.witness.trim()) { setError('A second nurse must witness this drug — enter their name.'); return }
    setBusy(true); setError('')
    const now = new Date().toISOString()
    const { error: e, offlineQueued } = await performSyncableAction(supabase, { table: 'mar_doses', operation: 'insert', label: `${rx.drug_name} PRN — given`,
      payload: { hospital_id: hospitalId, visit_id: visitId, patient_id: patientId, prescription_id: String(rx.id), drug_name: rx.drug_name,
        dose: rx.dosage || null, route: rx.route || null, prn: true, scheduled_at: now, administered_at: now, status: 'given', witness: prn.witness.trim() || null, notes: prn.notes.trim() || null } })
    setBusy(false)
    if (e) { setError(e.message); return }
    setPrn({ rxId: '', witness: '', notes: '' })
    if (offlineQueued) { setError('Offline: the PRN dose is saved on this device and will sync when the connection returns.'); return }
    await load()
  }

  const btn = (bg, fg) => ({ padding: '4px 9px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 11, background: bg, color: fg })
  const input = styles.input || { width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: '1px solid #D0D5DD', borderRadius: 7, fontSize: 12 }
  return (
    <section aria-label="Medication administration record">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {Object.entries(counts).map(([k, n]) => { const [l, fg, bg] = STATUS[k] || [k, '#475467', '#F2F4F7']; return <span key={k} style={{ background: bg, color: fg, borderRadius: 99, padding: '2px 9px', fontSize: 11, fontWeight: 800 }}>{l}: {n}</span> })}
        <button type="button" style={btn('#F2F4F7', '#344054')} onClick={load}>Refresh</button>
      </div>
      {error && <div role="alert" style={{ background: '#FEF3F2', color: '#B42318', borderRadius: 8, padding: '8px 10px', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {doses.length === 0 && !error && <div style={{ color: '#667085', fontSize: 12 }}>No scheduled doses. Prescriptions with a frequency (e.g. TDS, 8 hourly) appear here automatically; PRN drugs are given below.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {doses.map((d) => {
          const st = effectiveStatus(d)
          const [label, fg, bg] = STATUS[st] || STATUS.due
          return (
            <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '78px minmax(0,1fr) auto', gap: 8, alignItems: 'center', border: '1px solid #EAECF0', borderLeft: `4px solid ${fg}`, borderRadius: 8, padding: '7px 9px', opacity: st === 'entered_in_error' ? 0.6 : 1 }}>
              <div style={{ fontSize: 12 }}><strong>{time(d.scheduled_at)}</strong><div style={{ color: '#667085', fontSize: 10 }}>{day(d.scheduled_at)}</div></div>
              <div style={{ minWidth: 0, fontSize: 12 }}>
                <strong>{d.drug_name}</strong> {d.dose || ''} {d.route || ''}{d.prn ? ' · PRN' : ''}
                <div style={{ color: '#667085', fontSize: 11 }}>
                  <span style={{ background: bg, color: fg, borderRadius: 99, padding: '1px 7px', fontWeight: 800, marginRight: 6 }}>{label}</span>
                  {d.administered_by_name ? `${d.administered_by_name} ${d.administered_at ? time(d.administered_at) : ''}` : ''}{d.witness ? ` · witness ${d.witness}` : ''}{d.reason ? ` · ${d.reason}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {['due', 'missed'].includes(d.status) && <>
                  <button type="button" style={btn('#039855', '#fff')} onClick={() => setAction({ dose: d, status: 'given', reason: d.status === 'missed' ? 'Given late' : '', witness: '', notes: '' })}>Give</button>
                  <button type="button" style={btn('#FFFAEB', '#B54708')} onClick={() => setAction({ dose: d, status: 'held', reason: '', witness: '', notes: '' })}>Hold</button>
                  <button type="button" style={btn('#FFFAEB', '#B54708')} onClick={() => setAction({ dose: d, status: 'refused', reason: '', witness: '', notes: '' })}>Refused</button>
                  <button type="button" style={btn('#F2F4F7', '#344054')} onClick={() => setAction({ dose: d, status: 'not_available', reason: '', witness: '', notes: '' })}>Not available</button>
                </>}
                {['given', 'held', 'refused', 'not_available'].includes(d.status) && <button type="button" style={btn('#F2F4F7', '#667085')} onClick={() => setAction({ dose: d, status: 'entered_in_error', reason: '', witness: '', notes: '' })}>Correct</button>}
              </div>
            </div>
          )
        })}
      </div>

      {action && (
        <div style={{ border: '1px solid #D0D5DD', borderRadius: 10, padding: 10, marginTop: 10, background: '#F9FAFB' }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>{STATUS[action.status]?.[0] || action.status}: {action.dose.drug_name} {action.dose.dose || ''} at {time(action.dose.scheduled_at)}</div>
          {action.status !== 'given' || action.reason ? (
            <label style={{ display: 'block', fontSize: 11, color: '#475467' }}>Reason
              <input style={input} value={action.reason} onChange={(e) => setAction((x) => ({ ...x, reason: e.target.value }))} placeholder={action.status === 'entered_in_error' ? 'What was wrong' : 'e.g. BP 90/60, nil by mouth, patient asleep'} />
            </label>
          ) : null}
          {action.status === 'given' && CONTROLLED.test(action.dose.drug_name) && (
            <label style={{ display: 'block', fontSize: 11, color: '#475467', marginTop: 6 }}>Witness (second nurse)
              <input style={input} value={action.witness} onChange={(e) => setAction((x) => ({ ...x, witness: e.target.value }))} />
            </label>
          )}
          <label style={{ display: 'block', fontSize: 11, color: '#475467', marginTop: 6 }}>Note
            <input style={input} value={action.notes} onChange={(e) => setAction((x) => ({ ...x, notes: e.target.value }))} />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
            <button type="button" style={btn('#F2F4F7', '#344054')} onClick={() => setAction(null)}>Cancel</button>
            <button type="button" style={btn('#0F6E56', '#fff')} disabled={busy} onClick={sign}>{busy ? 'Saving…' : 'Sign'}</button>
          </div>
        </div>
      )}

      {prnRx.length > 0 && (
        <div style={{ borderTop: '1px solid #EAECF0', marginTop: 12, paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>As-needed (PRN) dose</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 6, alignItems: 'end' }}>
            <select aria-label="PRN drug" style={input} value={prn.rxId} onChange={(e) => setPrn((x) => ({ ...x, rxId: e.target.value }))}>
              <option value="">Choose drug</option>{prnRx.map((rx) => <option key={rx.id} value={rx.id}>{rx.drug_name} {rx.dosage || ''}</option>)}
            </select>
            <input aria-label="Witness" style={input} placeholder="Witness (controlled)" value={prn.witness} onChange={(e) => setPrn((x) => ({ ...x, witness: e.target.value }))} />
            <input aria-label="PRN note" style={input} placeholder="Indication / pain score" value={prn.notes} onChange={(e) => setPrn((x) => ({ ...x, notes: e.target.value }))} />
            <button type="button" style={btn('#039855', '#fff')} disabled={busy || !prn.rxId} onClick={givePrn}>Give now</button>
          </div>
        </div>
      )}
    </section>
  )
}
