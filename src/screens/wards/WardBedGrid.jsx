import { useMemo } from 'react'

const BED_FILTERS = ['All', 'Free', 'Occupied', 'Critical', 'Reserved', 'Cleaning', 'Maintenance', 'Male', 'Female', 'Isolation']
const genderOf = bed => String(bed.patients?.gender || bed.patients?.sex || '').trim().toLowerCase()
function matchesBedFilter(bed, filter, isolationVisitIds) {
  if (filter === 'All') return true
  if (filter === 'Male') return genderOf(bed).startsWith('m')
  if (filter === 'Female') return genderOf(bed).startsWith('f')
  if (filter === 'Isolation') return Boolean(bed.visit_id && isolationVisitIds?.has(String(bed.visit_id)))
  return bed.status === filter
}

export default function WardBedGrid({
  beds = [],
  selectedBed,
  onSelectBed = () => {},
  onQuickAdmit = () => {},
  bedPage = 1,
  setBedPage = () => {},
  bedSearch = '',
  setBedSearch = () => {},
  bedFilter = 'All',
  setBedFilter = () => {},
  onOpenAddBeds = () => {},
  canManageWards = false,
  canAdmitPatient = false,
  admissionQueue = [],
  styles = {},
  bedColors = {},
  latestRoundByVisit = new Map(),
  daysAdmitted = () => '—',
  bedsPerPage = 60,
  isolationVisitIds = new Set(),
}) {
  const filteredBeds = useMemo(() => {
    const query = String(bedSearch || '').trim().toLowerCase()
    return [...beds]
      .filter(bed => matchesBedFilter(bed, bedFilter, isolationVisitIds))
      .filter(bed => !query || [bed.bed_number, bed.status, bed.patients?.full_name, bed.notes].some(value => String(value || '').toLowerCase().includes(query)))
      .sort((left, right) => String(left.bed_number || '').localeCompare(String(right.bed_number || ''), undefined, { numeric: true }))
  }, [beds, bedFilter, bedSearch, isolationVisitIds])
  const pageCount = Math.max(1, Math.ceil(filteredBeds.length / bedsPerPage))
  const safePage = Math.min(Math.max(1, Number(bedPage) || 1), pageCount)
  const pageBeds = filteredBeds.slice((safePage - 1) * bedsPerPage, safePage * bedsPerPage)
  const selectedBedIsAvailable = selectedBed && ['Free', 'Reserved'].includes(selectedBed.status) && !selectedBed.patient_id

  return (
    <section style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', background: '#fff', border: '1px solid #E6ECE8', borderRadius: 14, padding: 16, alignSelf: 'flex-start' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={styles.sectionLabel}>Bed Map <span style={{ color: '#667085', fontWeight: 500 }}>({filteredBeds.length})</span></div>
        {canManageWards && <button type="button" style={{ ...styles.btn, padding: '7px 11px' }} onClick={onOpenAddBeds}>+ Add beds</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 8, marginBottom: 14 }}>
        <input style={styles.input} value={bedSearch} onChange={event => { setBedSearch(event.target.value); setBedPage(1) }} placeholder="Search bed or patient" aria-label="Search beds" />
        <select style={styles.input} value={bedFilter} onChange={event => { setBedFilter(event.target.value); setBedPage(1) }} aria-label="Filter by bed status">
          {BED_FILTERS.map(filter => <option key={filter}>{filter}</option>)}
        </select>
        <button type="button" style={{ ...styles.btn, gridColumn: '1 / -1', ...(!selectedBedIsAvailable || !canAdmitPatient ? styles.btnDisabled : {}) }} disabled={!selectedBedIsAvailable || !canAdmitPatient} onClick={() => onQuickAdmit()}>
          Quick admit selected
        </button>
      </div>

      {pageBeds.length === 0 ? <div style={styles.empty}>No beds match these filters.</div> : (
        <div style={styles.bedGrid}>
          {pageBeds.map(bed => {
            const tone = bedColors[bed.status] || bedColors.Free || {}
            const patientName = bed.patients?.full_name || bed.patient_name
            const latestRound = bed.visit_id ? latestRoundByVisit.get(bed.visit_id) : null
            const active = selectedBed?.id === bed.id
            return (
              <button
                type="button"
                key={bed.id}
                onClick={() => onSelectBed(bed)}
                aria-pressed={active}
                title={[bed.status, patientName, bed.visit_id && daysAdmitted(bed.admitted_at)].filter(Boolean).join(' · ')}
                style={{
                  ...styles.bedCard,
                  border: `1px solid ${active ? '#0F6E56' : tone.border || '#D1D5DB'}`,
                  background: active ? '#D9F1E7' : tone.bg || '#F3F4F6',
                  color: tone.color || '#344054',
                  outline: active ? '2px solid #0F6E56' : 'none',
                  outlineOffset: 1,
                }}
              >
                <strong style={{ fontSize: 13 }}>{bed.bed_number || 'Bed'}</strong>
                <span style={{ fontSize: 10, marginTop: 3 }}>{bed.status || 'Free'}</span>
                {patientName && <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, marginTop: 3 }}>{patientName}</span>}
                {bed.admitted_at && <span style={{ fontSize: 9, marginTop: 2 }}>{daysAdmitted(bed.admitted_at)}</span>}
                {latestRound && <span style={{ fontSize: 9, marginTop: 2 }}>Round updated</span>}
              </button>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#667085' }}>Page {safePage} of {pageCount}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={styles.pageBtn} disabled={safePage <= 1} onClick={() => setBedPage(safePage - 1)}>Previous</button>
          <button type="button" style={styles.pageBtn} disabled={safePage >= pageCount} onClick={() => setBedPage(safePage + 1)}>Next</button>
        </div>
      </div>

      {admissionQueue.length > 0 && (
        <div style={{ borderTop: '1px solid #E6ECE8', marginTop: 16, paddingTop: 14 }}>
          <div style={styles.sectionLabel}>Bed Requests</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {admissionQueue.slice(0, 5).map(request => (
              <div key={request.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', border: '1px solid #E6ECE8', borderRadius: 8, padding: 9 }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 12 }}>{request.patients?.full_name || request.patient_name || 'Patient awaiting bed'}</strong>
                  <div style={{ fontSize: 11, color: '#667085', marginTop: 3 }}>{request.priority || 'Routine'} · {request.admission_type || 'Elective'}</div>
                </div>
                <button type="button" style={{ ...styles.pageBtn, ...(!selectedBedIsAvailable || !canAdmitPatient ? styles.btnDisabled : {}) }} disabled={!selectedBedIsAvailable || !canAdmitPatient} onClick={() => onQuickAdmit(request)}>Admit</button>
              </div>
            ))}
          </div>
          {!selectedBedIsAvailable && <div style={{ fontSize: 11, color: '#667085', marginTop: 6 }}>Select a free or reserved bed to admit a request.</div>}
        </div>
      )}
    </section>
  )
}