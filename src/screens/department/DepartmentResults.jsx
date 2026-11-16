// "Results waiting" for a department's own patients: lab, imaging and prescriptions ordered for its recent visits,
// with what has come back since the department last saw the patient, and any critical result not yet acknowledged.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'

const LAB_DONE = ['complete', 'completed', 'resulted', 'validated', 'released']
const IMG_DONE = ['reported', 'verified']
const CANCELLED = ['cancelled', 'canceled', 'rejected']
const low = (v) => String(v || '').trim().toLowerCase()
const time = (v) => (v ? new Date(v).getTime() : 0)

/**
 * One row per visit with orders. A result is "new" when it came back after this department's latest consultation
 * for that visit (or there has been none yet).
 */
export function buildResultsBoard({ visits = [], labs = [], imaging = [], prescriptions = [], alerts = [], consultations = [] }) {
  const lastSeen = {}
  for (const c of consultations) if (c.visit_id) lastSeen[c.visit_id] = Math.max(lastSeen[c.visit_id] || 0, time(c.created_at))
  return visits.map((v) => {
    const vid = v.id
    const seen = lastSeen[vid] || 0
    const vLabs = labs.filter((l) => l.visit_id === vid && !CANCELLED.includes(low(l.status)))
    const vImg = imaging.filter((r) => r.visit_id === vid && !CANCELLED.includes(low(r.status)))
    const vRx = prescriptions.filter((r) => r.visit_id === vid)
    const labDone = vLabs.filter((l) => LAB_DONE.includes(low(l.status)))
    const imgDone = vImg.filter((r) => IMG_DONE.includes(low(r.status)))
    const newLabs = labDone.filter((l) => time(l.resulted_at || l.results_ready_at || l.updated_at) > seen)
    const newImg = imgDone.filter((r) => time(r.verified_at || r.reported_at || r.updated_at) > seen)
    const critical = alerts.filter((a) => a.status !== 'acknowledged' && ((a.visit_id && String(a.visit_id) === String(vid)) || (a.patient_id && a.patient_id === v.patient_id)))
    return {
      visit: v,
      labs: vLabs, imaging: vImg, prescriptions: vRx,
      labPending: vLabs.length - labDone.length, labReady: labDone.length,
      imgPending: vImg.length - imgDone.length, imgReady: imgDone.length,
      newCount: newLabs.length + newImg.length, newIds: new Set([...newLabs, ...newImg].map((x) => x.id)),
      rxPending: vRx.filter((r) => ['pending', 'approved'].includes(low(r.status))).length,
      rxRejected: vRx.filter((r) => low(r.status) === 'rejected').length,
      critical,
    }
  }).filter((r) => r.labs.length || r.imaging.length || r.prescriptions.length || r.critical.length)
    .sort((a, b) => (b.critical.length - a.critical.length) || (b.newCount - a.newCount) || (time(b.visit.created_at) - time(a.visit.created_at)))
}

export default function DepartmentResults({ hospitalId, visits, consultations, css, SectionCard, EmptyState, navigate, onCount }) {
  const [data, setData] = useState({ labs: [], imaging: [], prescriptions: [], alerts: [] })
  const [view, setView] = useState('review')
  const [open, setOpen] = useState('')
  const [error, setError] = useState('')
  const recent = useMemo(() => visits.filter((v) => time(v.created_at) >= Date.now() - 14 * 86400000 || !v.created_at).slice(0, 200), [visits])
  const ids = useMemo(() => recent.map((v) => v.id).filter(Boolean), [recent])
  const idKey = ids.join(',')
  const load = useCallback(async () => {
    if (!hospitalId || !ids.length) { setData({ labs: [], imaging: [], prescriptions: [], alerts: [] }); return }
    const patients = [...new Set(recent.map((v) => v.patient_id).filter(Boolean))]
    const safe = (p) => p.then((r) => r.data || []).catch(() => [])
    const [labs, imaging, prescriptions, alerts] = await Promise.all([
      safe(supabase.from('lab_tests').select('*').eq('hospital_id', hospitalId).in('visit_id', ids)),
      safe(supabase.from('radiology_orders').select('*').eq('hospital_id', hospitalId).in('visit_id', ids)),
      safe(supabase.from('prescriptions').select('*').eq('hospital_id', hospitalId).in('visit_id', ids)),
      patients.length ? safe(supabase.from('lab_critical_alerts').select('*').eq('hospital_id', hospitalId).in('patient_id', patients).neq('status', 'acknowledged')) : Promise.resolve([]),
    ])
    setError('')
    setData({ labs, imaging, prescriptions, alerts })
  }, [hospitalId, idKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load().catch((e) => setError(e.message)) }, [load])
  useEffect(() => {
    const refresh = () => void load()
    window.addEventListener('remedacare:workflow_changed', refresh)
    window.addEventListener('remedacare:prescriptions_changed', refresh)
    return () => { window.removeEventListener('remedacare:workflow_changed', refresh); window.removeEventListener('remedacare:prescriptions_changed', refresh) }
  }, [load])

  const board = useMemo(() => buildResultsBoard({ visits: recent, consultations, ...data }), [recent, consultations, data])
  const needsReview = board.filter((r) => r.newCount || r.critical.length)
  useEffect(() => { onCount?.(needsReview.length) }, [needsReview.length, onCount])
  const waiting = board.filter((r) => r.labPending || r.imgPending || r.rxPending)
  const rows = view === 'review' ? needsReview : view === 'waiting' ? waiting : board
  const chip = (text, strong) => <span style={{ display: 'inline-block', marginRight: 6, marginBottom: 2, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700, background: strong ? '#FEF3F2' : '#F2F4F7', color: strong ? '#912018' : '#101828', border: strong ? '1px solid #D9A8A3' : '1px solid transparent' }}>{text}</span>

  return (
    <SectionCard title="Results and orders" count={needsReview.length}>
      <div role="tablist" aria-label="Results and orders" style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {[['review', `To review (${needsReview.length})`], ['waiting', `Still waiting (${waiting.length})`], ['all', `All, last 14 days (${board.length})`]].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
            style={{ ...css.backBtn, padding: '5px 12px', ...(view === k ? { background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' } : {}) }}>{l}</button>
        ))}
      </div>
      {error && <div role="alert" style={{ color: '#912018', fontSize: 13 }}>{error}</div>}
      {rows.length === 0 ? <EmptyState message={view === 'review' ? 'No new results to review.' : view === 'waiting' ? 'Nothing outstanding from the lab, imaging or pharmacy.' : 'No orders for this department\'s patients in the last 14 days.'} /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={css.table}>
            <thead><tr>{['Patient', 'Laboratory', 'Imaging', 'Prescriptions', ''].map((h, i) => <th key={i} style={css.th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = open === r.visit.id
                return [
                  <tr key={r.visit.id}>
                    <td style={css.td}>
                      <div style={{ fontWeight: 700 }}>{r.visit.patients?.full_name || r.visit.patient_name || '—'}</div>
                      <div style={{ fontSize: 12, color: '#475467' }}>{r.visit.visit_number || String(r.visit.visit_id || r.visit.id).slice(0, 8)}</div>
                      {r.critical.length > 0 && <div style={{ marginTop: 4 }}>{chip(`Critical result not acknowledged (${r.critical.length})`, true)}</div>}
                      {r.newCount > 0 && <div style={{ marginTop: 4 }}>{chip(`${r.newCount} new since last seen`, false)}</div>}
                    </td>
                    <td style={css.td}>{r.labs.length ? <>{r.labReady > 0 && chip(`${r.labReady} ready`)}{r.labPending > 0 && chip(`${r.labPending} pending`)}</> : '—'}</td>
                    <td style={css.td}>{r.imaging.length ? <>{r.imgReady > 0 && chip(`${r.imgReady} reported`)}{r.imgPending > 0 && chip(`${r.imgPending} waiting`)}</> : '—'}</td>
                    <td style={css.td}>{r.prescriptions.length ? <>{r.rxPending > 0 && chip(`${r.rxPending} not yet dispensed`)}{r.rxRejected > 0 && chip(`${r.rxRejected} rejected by pharmacy`, true)}{!r.rxPending && !r.rxRejected && chip('All dispensed')}</> : '—'}</td>
                    <td style={{ ...css.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" aria-expanded={isOpen} style={{ ...css.backBtn, padding: '5px 12px' }} onClick={() => setOpen(isOpen ? '' : r.visit.id)}>{isOpen ? 'Hide' : 'Details'}</button>
                      {r.critical.length > 0 && <button type="button" style={{ ...css.dangerBtn, padding: '5px 12px', marginLeft: 6 }} onClick={() => navigate?.('critical-results')}>Act on critical</button>}
                    </td>
                  </tr>,
                  isOpen && (
                    <tr key={`${r.visit.id}-detail`}>
                      <td colSpan={5} style={{ ...css.td, background: '#F9FAFB' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                          <Detail title="Laboratory" items={r.labs.map((l) => ({ id: l.id, name: l.test_type || l.test_name || 'Test', status: l.status, text: l.result_text, isNew: r.newIds.has(l.id) }))} />
                          <Detail title="Imaging" items={r.imaging.map((i) => ({ id: i.id, name: [i.modality, i.body_region].filter(Boolean).join(' — ') || 'Imaging', status: i.status, text: i.impression || i.report_text || i.findings, isNew: r.newIds.has(i.id) }))} />
                          <Detail title="Prescriptions" items={r.prescriptions.map((p) => ({ id: p.id, name: [p.drug_name, p.dosage, p.frequency].filter(Boolean).join(' '), status: p.status }))} />
                        </div>
                        {r.critical.map((a) => <div key={a.id} style={{ marginTop: 8, color: '#912018', fontSize: 13, fontWeight: 700 }}>Critical: {a.message}</div>)}
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

function Detail({ title, items }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: '#344054', marginBottom: 4 }}>{title}</div>
      {items.length === 0 ? <div style={{ fontSize: 13, color: '#475467' }}>None</div> : items.map((it) => (
        <div key={it.id} style={{ padding: '5px 0', borderBottom: '1px solid #EAECF0', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontWeight: 700, color: '#101828' }}>{it.name}{it.isNew && <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 800, color: '#0F6E56' }}>NEW</span>}</span>
            <span style={{ color: '#344054', whiteSpace: 'nowrap' }}>{it.status || '—'}</span>
          </div>
          {it.text && <div style={{ color: '#344054', marginTop: 2, whiteSpace: 'pre-wrap' }}>{String(it.text).slice(0, 300)}</div>}
        </div>
      ))}
    </div>
  )
}
