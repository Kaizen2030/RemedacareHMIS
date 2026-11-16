import supabase from '../supabase'

const SEARCHES = [
  { table: 'patients', columns: 'id, name, phone, patient_number', path: '/patients', label: 'Patient', text: (row) => row.name || row.patient_number, detail: (row) => row.phone || row.patient_number },
  { table: 'appointments', columns: 'id, patient_name, appointment_date, reason', path: '/appointments', label: 'Appointment', text: (row) => row.patient_name || 'Appointment', detail: (row) => row.appointment_date || row.reason },
  { table: 'prescriptions', columns: 'id, patient_name, created_at', path: '/prescriptions', label: 'Prescription', text: (row) => row.patient_name || 'Prescription', detail: (row) => row.created_at },
]

export async function searchAcrossHospital({ hospitalId, query }) {
  const term = String(query || '').trim()
  if (!hospitalId || term.length < 2) return []
  const pattern = `%${term.replace(/[%_]/g, '\\$&')}%`
  const searches = SEARCHES.map(async (definition) => {
    const response = await supabase.from(definition.table).select(definition.columns).eq('hospital_id', hospitalId).or(`name.ilike.${pattern},patient_name.ilike.${pattern},patient_number.ilike.${pattern}`).limit(8)
    if (response.error) return []
    return (response.data || []).map((row) => ({ id: row.id, category: definition.label, label: definition.text(row), description: definition.detail(row), path: definition.path, state: { searchResult: row } }))
  })
  const workflowSearch = supabase
    .from('hospital_workflow_records')
    .select('id, module_code, title, status, patient_id, visit_id, created_at')
    .eq('hospital_id', hospitalId)
    .ilike('title', pattern)
    .order('created_at', { ascending: false })
    .limit(12)
    .then(({ data, error }) => {
      if (error) return []
      return (data || []).map((row) => ({
        id: row.id,
        category: 'Clinical workflow',
        label: row.title,
        description: `${row.module_code} · ${row.status}`,
        path: `/${row.module_code}`,
        state: { searchResult: row },
      }))
    })
  const [existingResults, workflowResults] = await Promise.all([Promise.all(searches), workflowSearch])
  return [...existingResults.flat(), ...workflowResults]
}

export function groupSearchResults(results = []) {
  const grouped = results.reduce((groups, result) => {
    const label = result.category || 'Other'
    if (!groups[label]) groups[label] = []
    groups[label].push(result)
    return groups
  }, {})
  return Object.entries(grouped).map(([label, items]) => ({ key: label, label, items }))
}
