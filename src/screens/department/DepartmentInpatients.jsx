// Inpatients under a department: active admissions whose admitting department is this one (admissions.admitting_department,
// 20261231100000), with ward and bed, days in hospital, consultant and expected discharge.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { localDateKey } from '../../utils/scheduling'

const daysSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null)

export function inpatientRows(admissions, patients, matchesDepartment, today = localDateKey(new Date())) {
  const byId = new Map(patients.map((p) => [p.id, p]))
  return admissions
    .filter((a) => String(a.status || '').toLowerCase() === 'active' && matchesDepartment(a.admitting_department))
    .map((a) => {
      const target = a.target_discharge_date ? String(a.target_discharge_date).slice(0, 10) : null
      return { ...a, patient: byId.get(a.patient_id) || null, days: daysSince(a.admission_date || a.created_at), target, overdue: Boolean(target && target < today) }
    })
    .sort((x, y) => (y.days ?? 0) - (x.days ?? 0))
}

export default function DepartmentInpatients({ hospitalId, department, matchesDepartment, navigate, css, SectionCard, EmptyState, onCount }) {
  const [admissions, setAdmissions] = useState([])
  const [patients, setPatients] = useState([])
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!hospitalId) return
    const { data, error: e } = await supabase.from('admissions').select('*').eq('hospital_id', hospitalId).eq('status', 'Active').limit(500)
    if (e) { setError(e.message); return }
    setError('')
    const mine = (data || []).filter((a) => matchesDepartment(a.admitting_department))
    setAdmissions(data || [])
    const ids = [...new Set(mine.map((a) => a.patient_id).filter(Boolean))]
    if (ids.length) {
      const { data: p } = await supabase.from('patients').select('id, full_name, patient_number, age, gender').eq('hospital_id', hospitalId).in('id', ids)
      setPatients(p || [])
    } else setPatients([])
  }, [hospitalId, matchesDepartment])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const refresh = () => void load()
    window.addEventListener('remedacare:workflow_changed', refresh)
    return () => window.removeEventListener('remedacare:workflow_changed', refresh)
  }, [load])
  const rows = useMemo(() => inpatientRows(admissions, patients, matchesDepartment), [admissions, patients, matchesDepartment])
  const overdue = rows.filter((r) => r.overdue).length
  useEffect(() => { onCount?.(rows.length) }, [rows.length, onCount])

  return (
    <SectionCard title="Inpatients" count={rows.length} note={rows.length ? `${rows.length} admitted under ${department}${overdue ? ` · ${overdue} past the expected discharge date` : ''}.` : null}>
      {error && <div role="alert" style={{ color: '#912018', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      {rows.length === 0 ? <EmptyState message={`No patients admitted under ${department}.`} /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={css.table}>
            <thead><tr>{['Patient', 'Ward and bed', 'Days in', 'Consultant', 'Expected discharge', 'Notes', ''].map((h, i) => <th key={i} style={css.th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={css.td}>
                    <div style={{ fontWeight: 700 }}>{r.patient?.full_name || r.patient_name || '—'}</div>
                    <div style={{ fontSize: 12, color: '#475467' }}>{[r.patient?.patient_number, r.patient?.age ? `${r.patient.age}y` : null, r.patient?.gender].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td style={css.td}>{[r.ward, r.bed_no && `Bed ${r.bed_no}`].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{ ...css.td, fontWeight: 700 }}>{r.days ?? '—'}</td>
                  <td style={css.td}>{r.admitting_doctor || '—'}</td>
                  <td style={{ ...css.td, whiteSpace: 'nowrap', ...(r.overdue ? { color: '#912018', fontWeight: 700 } : {}) }}>{r.target || '—'}{r.overdue ? ' (overdue)' : ''}</td>
                  <td style={{ ...css.td, fontSize: 12.5 }}>{[r.resuscitation_status && r.resuscitation_status !== 'Full' ? `Resus: ${r.resuscitation_status}` : null, r.isolation_required ? 'Isolation' : null, r.admission_type].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{ ...css.td, textAlign: 'right' }}><button type="button" style={{ ...css.backBtn, padding: '5px 12px' }} onClick={() => navigate?.('wards')}>Open ward</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}
