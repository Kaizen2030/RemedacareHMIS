export function generateSampleBarcode(date = new Date()) {
  const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime()
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, '0')
  return `SMP-${timestamp}-${suffix}`
}

export function getSampleStatusFromLabRow(row = {}) {
  const sampleStatus = String(row.sample_status || '').trim().toLowerCase()
  const status = String(row.status || '').trim().toLowerCase()

  if (sampleStatus === 'referred out') return 'Referred Out'
  if (row.results_ready_at || row.reviewed_at || sampleStatus === 'resulted' || status === 'complete' || status === 'resulted') {
    return 'Resulted'
  }
  if (row.processing_started_at || sampleStatus === 'in progress' || status === 'in progress') return 'In Progress'
  if (row.sample_collected_at || sampleStatus === 'collected') return 'Collected'
  return 'Ordered'
}