// Server-side patient search (name, phone, patient number). No 500-row limit: searches the database.
import { useEffect, useState } from 'react'
import supabase from '../supabase'

export default function PatientSearch({ hospitalId, value, onPick, inputStyle = {}, id = 'patient-search', placeholder = 'Type name, phone or patient number' }) {
  const [q, setQ] = useState(value?.full_name || '')
  const [results, setResults] = useState([])
  useEffect(() => { setQ(value?.full_name || '') }, [value?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2 || term === value?.full_name) { setResults([]); return undefined }
    const t = setTimeout(async () => {
      const safe = term.replace(/[%,()]/g, ' ')
      const { data } = await supabase.from('patients').select('*')
        .eq('hospital_id', hospitalId).or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%,patient_number.ilike.%${safe}%`).limit(10)
      setResults(data || [])
    }, 220)
    return () => clearTimeout(t)
  }, [q, hospitalId, value])
  return (
    <div style={{ position: 'relative' }}>
      <input id={id} aria-label="Search patient" autoComplete="off" style={inputStyle} value={q} placeholder={placeholder}
        onChange={(e) => { setQ(e.target.value); if (value) onPick(null) }} />
      {results.length > 0 && (
        <div role="listbox" style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 30, background: '#fff', border: '1px solid #D0D5DD', borderRadius: 8, boxShadow: '0 12px 24px rgba(15,23,42,.12)' }}>
          {results.map((p) => (
            <button key={p.id} type="button" role="option" aria-selected="false" onClick={() => { onPick(p); setQ(p.full_name); setResults([]) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', borderBottom: '1px solid #F2F4F7', background: 'none', cursor: 'pointer' }}>
              <strong>{p.full_name}</strong> <span style={{ color: '#667085', fontSize: 12 }}>{[p.patient_number, p.phone, p.age ? `${p.age}y` : null, p.gender].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
