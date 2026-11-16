import { useEffect, useMemo, useState } from 'react'
import { resolveRole } from '../access'
import { useHospital } from '../context'
import supabase from '../supabase'
import { colors as C, typography } from '../theme'
import { getWorkflowVisitUpdate } from '../utils/visitHandoff'
import { loadWorkflowOverride, mergeWorkflowFields } from '../utils/hospitalConfig'

const RECORD_COLUMNS = 'id, patient_id, visit_id, title, status, details, created_at, updated_at'
const STATUSES = ['Open', 'Pending', 'In Progress', 'Completed', 'Cancelled']

const styles = {
  page: { minHeight: '100vh', background: C.bg, color: C.text, fontFamily: typography.fontFamily, padding: '20px 24px' },
  wrap: { maxWidth: '1200px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' },
  title: { fontSize: '18px', fontWeight: 700, margin: 0 },
  subtext: { color: C.sub, fontSize: '12px', marginTop: '5px' },
  button: { background: C.primary, color: '#fff', border: 'none', borderRadius: '7px', padding: '8px 12px', fontWeight: 700, cursor: 'pointer', fontSize: '12px' },
  secondaryButton: { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '8px 12px', fontWeight: 600, cursor: 'pointer', fontSize: '12px' },
  actions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '18px' },
  stat: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '13px 15px' },
  label: { color: C.sub, fontSize: '11px', textTransform: 'uppercase', fontWeight: 700, marginBottom: '5px' },
  value: { fontSize: '21px', fontWeight: 800 },
  panel: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: '8px', marginBottom: '16px', overflow: 'hidden' },
  panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 15px', borderBottom: `1px solid ${C.border}`, fontWeight: 700 },
  form: { padding: '15px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' },
  field: { minWidth: 0 },
  fieldLabel: { display: 'block', color: C.sub, fontSize: '11px', fontWeight: 700, marginBottom: '5px' },
  input: { width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: '6px', padding: '8px 9px', color: C.text, background: C.surface, fontSize: '13px' },
  error: { padding: '11px 14px', color: C.danger || '#A32D2D', background: C.dangerL || '#FCEBEB', borderBottom: `1px solid ${C.border}`, fontSize: '12px' },
  list: { display: 'grid' },
  row: { display: 'grid', gridTemplateColumns: 'minmax(180px, 1.2fr) minmax(130px, .8fr) minmax(150px, 1fr) auto', alignItems: 'center', gap: '12px', padding: '12px 15px', borderBottom: `1px solid ${C.border}` },
  recordTitle: { fontWeight: 700, fontSize: '13px' },
  detail: { color: C.sub, fontSize: '11px', marginTop: '4px', overflowWrap: 'anywhere' },
  quiet: { color: C.sub, textAlign: 'center', padding: '22px 12px', fontSize: '13px' },
}

function getInputValue(field, value) {
  if (value === '') return null
  return field.type === 'number' ? Number(value) : value
}

function getWorkflowError(action, error) {
  const message = String(error?.message || error || 'Unknown database error')
  if (error?.code === 'PGRST205' || message.includes('hospital_workflow_records') || message.includes('schema cache')) {
    return 'Database setup required. Apply supabase/migrations/20261002000100_create_hospital_workflow_records.sql in Supabase, then reload.'
  }
  return `Could not ${action}: ${message}`
}

export default function HospitalWorkflowBoard({ config: baseConfig }) {
  const { hospitalId, userRole, navigate } = useHospital()
  // Form changes saved in Settings → Configuration (relabelled / extra / hidden optional fields)
  const [formOverride, setFormOverride] = useState([])
  useEffect(() => {
    let active = true
    setFormOverride([])
    void loadWorkflowOverride(supabase, hospitalId, baseConfig.code).then((fields) => { if (active) setFormOverride(fields) })
    return () => { active = false }
  }, [hospitalId, baseConfig.code])
  const config = useMemo(
    () => (formOverride.length ? { ...baseConfig, fields: mergeWorkflowFields(baseConfig.fields, formOverride) } : baseConfig),
    [baseConfig, formOverride],
  )
  const canManage = config.roles.includes(resolveRole(userRole))
  const [records, setRecords] = useState([])
  const [patients, setPatients] = useState([])
  const [visits, setVisits] = useState([])
  const [form, setForm] = useState({})
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingId, setSavingId] = useState('')
  const [editingId, setEditingId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      if (!hospitalId) {
        setRecords([])
        setPatients([])
        setVisits([])
        setError('Select an active hospital to load these records.')
        setLoading(false)
        return
      }
      const recordQuery = supabase.from('hospital_workflow_records')
        .select(RECORD_COLUMNS)
        .eq('hospital_id', hospitalId)
        .eq('module_code', config.code)
        .order('created_at', { ascending: false })
      const patientQuery = config.patientMode
        ? supabase.from('patients').select('id, full_name, patient_number').eq('hospital_id', hospitalId).order('full_name').limit(500)
        : Promise.resolve({ data: [], error: null })
      const visitQuery = config.patientMode
        ? supabase.from('visits').select('id, patient_id, visit_number, visit_type, status, created_at').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(500)
        : Promise.resolve({ data: [], error: null })
      const [recordResult, patientResult, visitResult] = await Promise.all([recordQuery, patientQuery, visitQuery])
      if (!active) return
      const errors = []
      if (recordResult.error) {
        setRecords([])
        errors.push(getWorkflowError(`load ${config.title.toLowerCase()} records`, recordResult.error))
      } else {
        setRecords(recordResult.data || [])
      }
      if (patientResult.error) {
        setPatients([])
        errors.push(`Could not load hospital patients: ${patientResult.error.message}`)
      } else {
        setPatients(patientResult.data || [])
      }
      setVisits(visitResult.error ? [] : (visitResult.data || []))
      setError(errors.join(' '))
      setLoading(false)
    }
    void load()
    const channel = supabase.channel(`hospital-workflow-${hospitalId}-${config.code}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'hospital_workflow_records',
        filter: `hospital_id=eq.${hospitalId}`,
      }, (change) => {
        const record = change.new?.module_code ? change.new : change.old
        if (record?.module_code === config.code) void load()
      })
      .subscribe()
    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [config, hospitalId])

  const patientById = useMemo(() => new Map(patients.map((patient) => [String(patient.id), patient])), [patients])
  const stats = useMemo(() => ({
    total: records.length,
    open: records.filter((record) => !['Completed', 'Released', 'Cancelled'].includes(record.status)).length,
    completed: records.filter((record) => (config.completedStatuses || ['Completed']).includes(record.status)).length,
  }), [records])

  const startNewRecord = () => {
    setEditingId('')
    setForm({ ...(config.initialValues || {}), patient_id: '', status: 'Open' })
    setError('')
    setShowForm(true)
  }

  const startEditRecord = (record) => {
    setEditingId(record.id)
    setForm({
      ...record.details,
      ...(config.prepareForm ? config.prepareForm(record) : {}),
      patient_id: record.patient_id || '',
    })
    setError('')
    setShowForm(true)
  }

  const syncVisitHandoff = async (visitId, status) => {
    const update = getWorkflowVisitUpdate(config, status)
    if (!visitId || !update) return ''
    const { error: visitError } = await supabase
      .from('visits')
      .update(update)
      .eq('id', visitId)
      .eq('hospital_id', hospitalId)
    if (visitError) return visitError.message
    window.dispatchEvent(new CustomEvent('remedacare:workflow_changed', {
      detail: { visit_id: visitId, status: update.status, department: update.speciality, source: config.code },
    }))
    return ''
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canManage || !hospitalId) return
    if (config.patientMode === 'required' && !form.patient_id) {
      setError('Select a registered patient for this record.')
      return
    }
    if (config.requiresVisit && !form.visit_id) {
      setError('Select the active patient visit so this workflow can hand off to the next department.')
      return
    }
    const missingField = config.fields.find((field) => field.required && !String(form[field.key] ?? '').trim())
    if (missingField) {
      setError(`${missingField.label} is required.`)
      return
    }
    const patient = patientById.get(String(form.patient_id || ''))
    const formDetails = Object.fromEntries(config.fields
      .map((field) => [field.key, getInputValue(field, form[field.key] ?? '')])
      .filter(([, value]) => value !== null))
    const details = config.prepareDetails ? config.prepareDetails(formDetails) : formDetails
    const patientId = patient?.id || null
    const recordValidationError = config.validateRecord?.(details, records, { editingId, patientId })
    if (recordValidationError) {
      setError(recordValidationError)
      return
    }
    const title = config.titleField
      ? String(details[config.titleField] || '').trim()
      : `${patient?.full_name || 'Hospital'} - ${config.recordLabel}`

    setSaving(true)
    setError('')
    const payload = {
      hospital_id: hospitalId,
      module_code: config.code,
      patient_id: patientId,
      visit_id: form.visit_id || null,
      title,
      details,
    }
    const query = editingId
      ? supabase.from('hospital_workflow_records').update({ ...payload, updated_at: new Date().toISOString() }).eq('hospital_id', hospitalId).eq('module_code', config.code).eq('id', editingId)
      : supabase.from('hospital_workflow_records').insert({ ...payload, status: 'Open' })
    const { data, error: saveError } = await query.select(RECORD_COLUMNS).single()
    if (saveError) {
      setError(getWorkflowError('save record', saveError))
    } else {
      const handoffError = await syncVisitHandoff(data.visit_id, data.status)
      setRecords((current) => editingId
        ? current.map((record) => record.id === editingId ? data : record)
        : [data, ...current])
      setShowForm(false)
      setEditingId('')
      setForm({})
      if (handoffError) setError(`Workflow record saved, but visit handoff failed: ${handoffError}`)
    }
    setSaving(false)
  }

  const handleStatusChange = async (record, status) => {
    if (!canManage) return
    if (isFinalRecord(record) && status !== record.status) {
      setError('This record is final and cannot be reopened or changed.')
      return
    }
    const statusValidationError = config.validateStatus?.(record, status)
    if (statusValidationError) {
      setError(statusValidationError)
      return
    }
    setSavingId(record.id)
    setError('')
    const { data, error: updateError } = await supabase.from('hospital_workflow_records')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('hospital_id', hospitalId)
      .eq('module_code', config.code)
      .eq('id', record.id)
      .select(RECORD_COLUMNS)
      .single()
    if (updateError) {
      setError(getWorkflowError('update record status', updateError))
    } else {
      const handoffError = await syncVisitHandoff(data.visit_id, data.status)
      setRecords((current) => current.map((item) => item.id === record.id ? data : item))
      if (handoffError) setError(`Workflow status saved, but visit handoff failed: ${handoffError}`)
    }
    setSavingId('')
  }

  const openPatientChart = (patientId) => {
    if (patientId) navigate?.('consultation', { patientId, source: config.code })
  }

  const isFinalRecord = (record) => ['Completed', 'Released', 'Received', 'Cancelled'].includes(record.status)
  const canEditRecord = (record) => !isFinalRecord(record) && (!config.canEditRecord || config.canEditRecord(record))

  return (
    <main style={styles.page}>
      <div style={styles.wrap}>
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>{config.title}</h1>
            <div style={styles.subtext}>{config.description}</div>
          </div>
          <div style={styles.actions}>
            {config.patientMode && <button type="button" style={styles.secondaryButton} onClick={() => navigate?.('patients')}>Open patient registry</button>}
            {canManage && !error && <button type="button" style={styles.button} onClick={startNewRecord}>New record</button>}
          </div>
        </header>

        {error && <div role="alert" style={styles.error}>{error}</div>}

        <section style={styles.stats} aria-label={`${config.title} summary`}>
          {[
            ['Records', stats.total],
            ['Open', stats.open],
            ['Completed', stats.completed],
          ].map(([label, value]) => (
            <div key={label} style={styles.stat}>
              <div style={styles.label}>{label}</div>
              <div style={styles.value}>{loading || error ? '—' : value}</div>
            </div>
          ))}
        </section>

        {showForm && (
          <form style={styles.panel} onSubmit={handleSubmit}>
            <div style={styles.panelHead}><span>{editingId ? `Edit ${config.recordLabel.toLowerCase()}` : `New ${config.recordLabel.toLowerCase()}`}</span><span>Required fields are marked *</span></div>
            <div style={styles.form}>
              <div style={styles.grid}>
                {config.patientMode && (
                  <div style={styles.field}>
                    <label style={styles.fieldLabel} htmlFor={`${config.code}-patient`}>Patient{config.patientMode === 'required' ? ' *' : ''}</label>
                    <select id={`${config.code}-patient`} style={styles.input} required={config.patientMode === 'required'} value={form.patient_id || ''} onChange={(event) => setForm((current) => ({ ...current, patient_id: event.target.value, visit_id: '' }))}>
                      <option value="">{config.patientMode === 'required' ? 'Select registered patient' : 'No patient linked'}</option>
                      {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.full_name}{patient.patient_number ? ` · ${patient.patient_number}` : ''}</option>)}
                    </select>
                  </div>
                )}
                {config.patientMode && (
                  <div style={styles.field}>
                    <label style={styles.fieldLabel} htmlFor={`${config.code}-visit`}>Linked visit (optional)</label>
                    <select id={`${config.code}-visit`} style={styles.input} value={form.visit_id || ''} onChange={(event) => setForm((current) => ({ ...current, visit_id: event.target.value }))}>
                      <option value="">No visit linked</option>
                      {visits.filter((visit) => String(visit.patient_id) === String(form.patient_id)).map((visit) => (
                        <option key={visit.id} value={visit.id}>{visit.visit_number || visit.visit_type || 'Visit'} · {visit.status || 'Open'} · {new Date(visit.created_at).toLocaleDateString('en-KE')}</option>
                      ))}
                    </select>
                  </div>
                )}
                {config.fields.map((field) => (
                  <div key={field.key} style={styles.field}>
                    <label style={styles.fieldLabel} htmlFor={`${config.code}-${field.key}`}>{field.label}{field.required ? ' *' : ''}</label>
                    {field.type === 'select' ? (
                      <select id={`${config.code}-${field.key}`} style={styles.input} required={field.required} value={form[field.key] || ''} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}>
                        <option value="">Select {field.label.toLowerCase()}</option>
                        {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea id={`${config.code}-${field.key}`} style={{ ...styles.input, minHeight: '76px', resize: 'vertical' }} required={field.required} value={form[field.key] || ''} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
                    ) : (
                      <input id={`${config.code}-${field.key}`} style={styles.input} type={field.type || 'text'} min={field.min} max={field.max} step={field.step} required={field.required} value={form[field.key] || ''} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
                    )}
                  </div>
                ))}
              </div>
              <div style={{ ...styles.actions, justifyContent: 'flex-end', marginTop: '14px' }}>
                <button type="button" style={styles.secondaryButton} onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" style={styles.button} disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update record' : 'Save record'}</button>
              </div>
            </div>
          </form>
        )}

        <section style={styles.panel}>
          <div style={styles.panelHead}><span>{config.recordLabel}s</span><span>{loading ? 'Loading...' : error ? 'Unavailable' : `${records.length} saved`}</span></div>
          {loading ? <div style={styles.quiet}>Loading saved records...</div> : error ? (
            <div style={styles.quiet}>Records are unavailable until the database issue above is resolved.</div>
          ) : records.length === 0 ? (
            <div style={styles.quiet}>No saved records yet. Records will appear here after staff enter them.</div>
          ) : (
            <div style={styles.list}>
              {records.map((record) => {
                const patient = patientById.get(String(record.patient_id || ''))
                const details = config.fields.filter((field) => record.details?.[field.key] !== null && record.details?.[field.key] !== undefined && record.details?.[field.key] !== '')
                return (
                  <article key={record.id} style={styles.row}>
                    <div>
                      <div style={styles.recordTitle}>{record.title}</div>
                      <div style={styles.detail}>{patient ? `${patient.full_name}${patient.patient_number ? ` · ${patient.patient_number}` : ''}` : config.patientMode ? 'No patient linked' : 'Hospital record'}</div>
                      <div style={styles.detail}>{details.map((field) => `${field.label}: ${record.details[field.key]}`).join(' · ')}</div>
                    </div>
                    <div style={styles.detail}>{record.created_at ? new Date(record.created_at).toLocaleString('en-KE') : ''}</div>
                    {canManage ? (
                      <select aria-label={`Status for ${record.title}`} style={styles.input} value={record.status} disabled={savingId === record.id} onChange={(event) => void handleStatusChange(record, event.target.value)}>
                        {(config.statuses || STATUSES).map((status) => <option key={status} value={status} disabled={(isFinalRecord(record) && status !== record.status) || Boolean(config.validateStatus?.(record, status))}>{status}</option>)}
                      </select>
                    ) : <div style={styles.recordTitle}>{record.status}</div>}
                    <div style={styles.actions}>
                      {canManage && canEditRecord(record) && <button type="button" style={styles.secondaryButton} onClick={() => startEditRecord(record)}>Edit details</button>}
                      {patient && <button type="button" style={styles.secondaryButton} onClick={() => openPatientChart(patient.id)}>Open chart</button>}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
