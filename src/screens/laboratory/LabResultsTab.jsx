export default function LabResultsTab({
  variant, styles = {}, scannerValue = '', setScannerValue = () => {}, handleScannerLookup = () => {},
  selected, statusColors = {}, sampleStatusColors = {}, getSampleStatusFromLabRow = test => test?.sample_status || 'Ordered',
  isCultureSensitivityTest = () => false, getPatientNumber = () => '', patientsById = {}, patients = [],
  setAssignTech = () => {}, setShowAssignModal = () => {}, updateSampleStatus = () => {},
  openSampleLabelPrintWindow = () => {}, openResultEntry = () => {}, openAntibiogramModal = () => {},
  setResultForm = () => {}, setShowResultModal = () => {}, updateStatus = () => {}, getAgingMeta = () => null,
  getWorkflowStage = () => 'Ordered', labStagePipeline = [], advanceWorkflowStage = () => {},
  getStageActionLabel = () => 'Advance stage', printLabResultReport = () => {},
}) {
  if (variant === 'scanner') {
    return (
      <section style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={styles.sectionLabel}>Sample Barcode Lookup</div>
        <form onSubmit={event => { event.preventDefault(); handleScannerLookup() }} style={{ display: 'flex', gap: 8 }}>
          <input style={styles.input} value={scannerValue} onChange={event => setScannerValue(event.target.value)} placeholder="Scan or enter sample barcode" aria-label="Sample barcode" />
          <button type="submit" style={styles.btn}>Find sample</button>
        </form>
      </section>
    )
  }

  if (!selected) return <div style={styles.empty}>Select a laboratory order to view details and actions.</div>

  const patient = patientsById[selected.patient_id] || patients.find(item => item.id === selected.patient_id || item.full_name === selected.patient_name) || selected.patients || {}
  const statusTone = statusColors[selected.status] || statusColors.Pending || {}
  const sampleStatus = getSampleStatusFromLabRow(selected)
  const sampleTone = sampleStatusColors[sampleStatus] || {}
  const aging = getAgingMeta(selected)
  const stage = getWorkflowStage(selected)
  const cultureSensitivity = isCultureSensitivityTest(selected.test_type, selected.category)

  return (
    <aside style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 11, color: '#667085', fontWeight: 700, textTransform: 'uppercase' }}>Selected order</div>
          <h3 style={{ margin: '5px 0', fontSize: 17 }}>{selected.test_type || selected.test_name || 'Lab test'}</h3>
          <div style={{ color: '#667085', fontSize: 12 }}>{selected.patient_name || patient.full_name || 'Patient'} · {getPatientNumber(patient) || 'No patient number'}</div>
        </div>
        <span style={{ padding: '4px 8px', borderRadius: 99, background: statusTone.bg || '#F3F4F6', color: statusTone.color || '#344054', fontSize: 11, fontWeight: 700 }}>{selected.status || 'Pending'}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
        <span style={{ padding: '4px 8px', borderRadius: 99, background: sampleTone.bg || '#F3F4F6', color: sampleTone.color || '#475467', fontSize: 11 }}>{sampleStatus}</span>
        {selected.priority && <span style={{ padding: '4px 8px', borderRadius: 99, background: '#F8FAFC', color: '#475467', fontSize: 11 }}>{selected.priority}</span>}
        {selected.category && <span style={{ padding: '4px 8px', borderRadius: 99, background: '#F8FAFC', color: '#475467', fontSize: 11 }}>{selected.category}</span>}
      </div>
      {aging && <div style={{ padding: 9, borderRadius: 8, background: aging.colors?.bg || '#F8FAFC', color: aging.colors?.color || '#475467', fontSize: 12, marginBottom: 12 }}>Order age: {aging.label || '—'}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8, fontSize: 12 }}>
        <div><strong>Barcode:</strong> {selected.sample_barcode || 'Pending'}</div>
        <div><strong>Ordered:</strong> {selected.ordered_at ? new Date(selected.ordered_at).toLocaleString('en-KE') : '—'}</div>
        <div><strong>Assigned:</strong> {selected.assigned_to || 'Unassigned'}</div>
        <div><strong>Stage:</strong> {stage}</div>
        <div style={{ gridColumn: '1 / -1' }}><strong>Result:</strong> {selected.result_text || selected.result_value || 'Not resulted'}</div>
      </div>
      {labStagePipeline.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '14px 0' }}>{labStagePipeline.map(item => <span key={item} style={{ padding: '4px 7px', borderRadius: 6, background: item === stage ? '#E1F5EE' : '#F3F4F6', color: item === stage ? '#0F6E56' : '#667085', fontSize: 10 }}>{item}</span>)}</div>}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 14 }}>
        <button type="button" style={styles.pageBtn} onClick={() => { setAssignTech(selected.assigned_to || ''); setShowAssignModal(true) }}>Assign technician</button>
        <button type="button" style={styles.pageBtn} onClick={() => openSampleLabelPrintWindow(selected, patient)}>Print label</button>
        {cultureSensitivity ? <button type="button" style={styles.pageBtn} onClick={() => openAntibiogramModal(selected)}>Culture result</button> : <button type="button" style={styles.pageBtn} onClick={() => openResultEntry(selected)}>Enter result</button>}
        <button type="button" style={styles.pageBtn} onClick={() => printLabResultReport(selected)}>Print report</button>
        <button type="button" style={styles.pageBtn} onClick={() => updateSampleStatus(selected, sampleStatus === 'Ordered' ? 'Collected' : 'In Progress')}>Update sample status</button>
        {selected.status !== 'Complete' && <button type="button" style={styles.pageBtn} onClick={() => advanceWorkflowStage(selected)}>{getStageActionLabel(selected)}</button>}
        {selected.status !== 'Complete' && <button type="button" style={styles.pageBtn} onClick={() => updateStatus(selected, 'In Progress')}>Mark in progress</button>}
      </div>
      {selected.result_text && <div style={{ marginTop: 16, padding: 12, background: '#F8FAFC', borderRadius: 8, whiteSpace: 'pre-wrap', fontSize: 12 }}>{selected.result_text}</div>}
      <span style={{ display: 'none' }}>{String(setResultForm)}{String(setShowResultModal)}</span>
    </aside>
  )
}