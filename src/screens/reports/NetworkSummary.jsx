// Reports → All facilities: today's and this month's activity at every facility of the organisation that the
// signed-in administrator manages (network_summary, 20261129000000_multi_facility.sql).
import { useEffect, useState } from 'react'
import supabase from '../../supabase'
import { s } from '../ncd/ui'

export default function NetworkSummary({ hospitalId }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!hospitalId) return
    void supabase.rpc('network_summary', { p_hospital: hospitalId }).then(({ data, error }) => {
      if (error) setErr(/does not exist|schema cache/i.test(error.message) ? 'Not installed yet. Run docs/sql/17_patient_portal_and_networks.sql in Supabase.' : error.message)
      setRows(data || [])
    })
  }, [hospitalId])
  const total = (k) => (rows || []).reduce((sum, r) => sum + Number(r[k] || 0), 0)
  return (
    <div style={s.card}>
      <h2 style={s.h2}>All facilities</h2>
      <p style={{ ...s.sub, marginTop: -6 }}>Facilities of your organisation that you administer. Facilities join an organisation by sharing a network in Settings; staff switch facility from the top bar and get the role they have at that site.</p>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>{['Facility', 'Registered patients', 'Visits today', 'Visits this month', 'Unpaid balances (KES)'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.hospital_id}>
                <td style={{ ...s.td, fontWeight: 700 }}>{r.hospital_name}{String(r.hospital_id) === String(hospitalId) ? ' (this one)' : ''}</td>
                <td style={s.td}>{Number(r.patients).toLocaleString('en-KE')}</td>
                <td style={s.td}>{Number(r.visits_today).toLocaleString('en-KE')}</td>
                <td style={s.td}>{Number(r.visits_month).toLocaleString('en-KE')}</td>
                <td style={s.td}>{Number(r.open_balance).toLocaleString('en-KE')}</td>
              </tr>
            ))}
            {rows && rows.length > 1 && (
              <tr>
                <td style={{ ...s.td, fontWeight: 800 }}>Total</td>
                <td style={{ ...s.td, fontWeight: 800 }}>{total('patients').toLocaleString('en-KE')}</td>
                <td style={{ ...s.td, fontWeight: 800 }}>{total('visits_today').toLocaleString('en-KE')}</td>
                <td style={{ ...s.td, fontWeight: 800 }}>{total('visits_month').toLocaleString('en-KE')}</td>
                <td style={{ ...s.td, fontWeight: 800 }}>{total('open_balance').toLocaleString('en-KE')}</td>
              </tr>
            )}
          </tbody>
        </table>
        {rows && rows.length === 0 && !err && <div style={{ ...s.sub, padding: 12 }}>Only administrators see this summary.</div>}
      </div>
    </div>
  )
}
