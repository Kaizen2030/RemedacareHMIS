export default function LabOrdersTab({
  styles = {}, filterStatus = 'All', setFilterStatus = () => {}, counts = {}, search = '', setSearch = () => {},
  dateFrom = '', setDateFrom = () => {}, dateTo = '', setDateTo = () => {}, filterPatient = 'All', setFilterPatient = () => {}, uniquePatients = [],
  filterSource = 'All', setFilterSource = () => {}, filterPriority = 'All', setFilterPriority = () => {}, filterCategory = 'All', setFilterCategory = () => {},
  labTestCategories = [], filtered = [], setSelected = () => {}, selected, isCultureSensitivityTest = () => false,
  formatKES = value => String(value || 0), statusColors = {}, sampleStatusColors = {}, getSampleStatusFromLabRow = test => test?.sample_status || 'Ordered',
  priorityColors = {}, invoices = [], hasLinkedLabInvoice = () => false, updateStatus = () => {}, updateSampleStatus = () => {}, getAgingMeta = () => null,
  advanceWorkflowStage = () => {}, getStageActionLabel = () => 'Advance stage', openSampleLabelPrintWindow = () => {}, openResultEntry = () => {},
  printLabResultReport = () => {}, patientsById = {}, patients = [], openAntibiogramModal = () => {}, setShowResultModal = () => {}, setResultForm = () => {},
  setAssignTech = () => {}, setShowAssignModal = () => {}, testTotalCount = 0, tests = [], testPageSize = 25, setTestPageSize = () => {},
  pageSizeOptions = [25, 50, 100], testPage = 1, setTestPage = () => {}, detailPanel = null,
  onCollectPayment = null,
}) {
  const totalPages = Math.max(1, Math.ceil(testTotalCount / testPageSize))
  return (
    <section style={{ display: 'grid', gridTemplateColumns: selected ? 'minmax(0,1fr) minmax(310px,.85fr)' : '1fr', gap: 14, alignItems: 'start' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, marginBottom: 12 }}>
          {['All', 'Pending', 'In Progress', 'Complete'].map(status => {
            const count = counts[status] ?? counts[status.toLowerCase().replace(' ', '')] ?? (status === 'All' ? tests.length : 0)
            return <button type="button" key={status} style={{ ...styles.metricCard, cursor: 'pointer', textAlign: 'left', border: filterStatus === status ? '1px solid #0F6E56' : '1px solid #E5E7EB' }} onClick={() => setFilterStatus(status)}><div style={styles.metricLabel}>{status}</div><div style={styles.metricValue}>{count}</div></button>
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 8, marginBottom: 12 }}>
          <input style={styles.input} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tests, patient, barcode" aria-label="Search lab orders" />
          <select style={styles.input} aria-label="Filter by patient" value={filterPatient} onChange={event => setFilterPatient(event.target.value)}><option value="All">All patients</option>{uniquePatients.map(patient => <option key={patient}>{patient}</option>)}</select>
          <select style={styles.input} aria-label="Filter by priority" value={filterPriority} onChange={event => setFilterPriority(event.target.value)}>{['All', 'Routine', 'Urgent', 'STAT'].map(value => <option key={value} value={value}>{value === 'All' ? 'All priorities' : value}</option>)}</select>
          <select style={styles.input} aria-label="Filter by category" value={filterCategory} onChange={event => setFilterCategory(event.target.value)}><option value="All">All categories</option>{labTestCategories.map(value => <option key={value}>{value}</option>)}</select>
          <select style={styles.input} aria-label="Filter by source" value={filterSource} onChange={event => setFilterSource(event.target.value)}>{['All', 'Doctor', 'Walk-in'].map(value => <option key={value} value={value}>{value === 'All' ? 'All sources' : value}</option>)}</select>
          <input style={styles.input} type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} aria-label="From date" />
          <input style={styles.input} type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} aria-label="To date" />
        </div>
        {filtered.length === 0 ? <div style={styles.empty}>No tests match the selected filters.</div> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {filtered.map(test => {
              const statusTone = statusColors[test.status] || statusColors.Pending || {}
              const sampleStatus = getSampleStatusFromLabRow(test)
              const sampleTone = sampleStatusColors[sampleStatus] || {}
              const priorityTone = priorityColors[test.priority] || {}
              const aging = getAgingMeta(test)
              const patient = patientsById[test.patient_id] || patients.find(item => item.id === test.patient_id) || {}
              return (
                <article key={test.id} style={{ border: selected?.id === test.id ? '1px solid #0F6E56' : '1px solid #E5E7EB', borderRadius: 10, padding: 12, background: '#fff' }}>
                  <button type="button" onClick={() => setSelected(test)} style={{ display: 'block', width: '100%', border: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer', padding: 0, color: '#1F2937' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}><strong>{test.test_type || test.test_name || 'Lab test'}</strong><span style={{ background: statusTone.bg || '#F3F4F6', color: statusTone.color || '#475467', borderRadius: 99, padding: '3px 8px', fontSize: 10 }}>{test.status || 'Pending'}</span></div>
                    <div style={{ fontSize: 12, color: '#667085', marginTop: 4 }}>{test.patient_name || patient.full_name || 'Patient'} · {test.sample_barcode || 'No barcode'} · {test.category || 'Other'}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                      <span style={{ background: sampleTone.bg || '#F3F4F6', color: sampleTone.color || '#475467', padding: '3px 7px', borderRadius: 99, fontSize: 10 }}>{sampleStatus}</span>
                      {test.priority && <span style={{ background: priorityTone.bg || '#F8FAFC', color: priorityTone.color || '#475467', padding: '3px 7px', borderRadius: 99, fontSize: 10 }}>{test.priority}</span>}
                      {aging && <span style={{ color: aging.colors?.color || '#667085', fontSize: 10, padding: '3px 2px' }}>{aging.label}</span>}
                      {(() => {
                        const inv = invoices.find(item => hasLinkedLabInvoice([item], test))
                        if (!inv) return null
                        const due = Number(inv.balance_kes || 0)
                        if (inv.status === 'Paid' || due <= 0) return <span style={{ background: '#ECFDF3', color: '#027A48', padding: '3px 7px', borderRadius: 99, fontSize: 10, fontWeight: 700 }}>Paid</span>
                        if (inv.insurer) return <span style={{ background: '#EFF8FF', color: '#175CD3', padding: '3px 7px', borderRadius: 99, fontSize: 10, fontWeight: 700 }}>Billed to {inv.insurer}</span>
                        return <span style={{ background: '#FFFAEB', color: '#B54708', padding: '3px 7px', borderRadius: 99, fontSize: 10, fontWeight: 700 }}>Unpaid · {formatKES(due)}</span>
                      })()}
                    </div>
                  </button>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
                    <button type="button" style={styles.pageBtn} onClick={() => openSampleLabelPrintWindow(test, patient)}>Label</button>
                    {isCultureSensitivityTest(test.test_type, test.category) ? <button type="button" style={styles.pageBtn} onClick={() => openAntibiogramModal(test)}>Enter C&amp;S</button> : <button type="button" style={styles.pageBtn} onClick={() => openResultEntry(test)}>Enter result</button>}
                    <button type="button" style={styles.pageBtn} onClick={() => { setSelected(test); setAssignTech(test.assigned_to || ''); setShowAssignModal(true) }}>Assign</button>
                    <button type="button" style={styles.pageBtn} onClick={() => advanceWorkflowStage(test)}>{getStageActionLabel(test)}</button>
                    {test.status !== 'Complete' && <button type="button" style={styles.pageBtn} onClick={() => updateStatus(test, 'In Progress')}>In progress</button>}
                    <button type="button" style={styles.pageBtn} onClick={() => printLabResultReport(test)}>Print report</button>
                    {onCollectPayment && (() => {
                      const inv = invoices.find(item => hasLinkedLabInvoice([item], test))
                      return inv && !inv.insurer && inv.status !== 'Paid' && Number(inv.balance_kes || 0) > 0
                        ? <button type="button" style={{ ...styles.pageBtn, background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' }} onClick={() => onCollectPayment(inv)}>Collect {formatKES(inv.balance_kes)}</button>
                        : null
                    })()}
                  </div>
                </article>
              )
            })}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <span style={{ fontSize: 12, color: '#667085' }}>{testTotalCount} orders · page {testPage} of {totalPages}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select style={{ ...styles.input, width: 'auto' }} aria-label="Rows per page" value={testPageSize} onChange={event => { setTestPageSize(Number(event.target.value)); setTestPage(1) }}>{pageSizeOptions.map(size => <option key={size} value={size}>{size} / page</option>)}</select>
            <button type="button" style={styles.pageBtn} disabled={testPage <= 1} onClick={() => setTestPage(testPage - 1)}>Previous</button>
            <button type="button" style={styles.pageBtn} disabled={testPage >= totalPages} onClick={() => setTestPage(testPage + 1)}>Next</button>
          </div>
        </div>
      </div>
      {selected && detailPanel}
      <span style={{ display: 'none' }}>{String(filterSource)}{String(filterCategory)}{String(setResultForm)}{String(setShowResultModal)}</span>
    </section>
  )
}