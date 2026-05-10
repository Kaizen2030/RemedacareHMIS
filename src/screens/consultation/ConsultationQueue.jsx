import { useMemo } from 'react'

const AVATAR_COLORS = ['#E1F5EE', '#E3F0FB', '#F0EAFC', '#FFF3DC', '#FCEBEB', '#EAF3DE']

export default function ConsultationQueue({
  visits = [],
  search = '',
  setSearch = () => {},
  filterSpec = 'All',
  setFilterSpec = () => {},
  selected,
  onSelect = () => {},
  loading,
  refresh = () => {},
  styles = {},
}) {
  const specCounts = useMemo(() => {
    const counts = {}
    visits.forEach(visit => {
      const key = visit.speciality || 'Unassigned'
      counts[key] = (counts[key] || 0) + 1
    })
    return counts
  }, [visits])

  const filtered = useMemo(() => {
    return visits.filter(visit => {
      const name = visit.patients?.full_name?.toLowerCase() || ''
      const matchSearch = name.includes(search.toLowerCase()) || visit.visit_number?.includes(search)
      const matchSpec = filterSpec === 'All' || visit.speciality === filterSpec
      return matchSearch && matchSpec
    })
  }, [visits, search, filterSpec])

  return (
    <div style={styles.leftPanel}>
      <div style={styles.panelHeader}>
        <div>
          <div style={styles.panelTitle}>Doctor Queue</div>
          <div style={styles.panelSub}>{visits.length} patients waiting</div>
        </div>
        <button style={styles.refreshBtn} onClick={refresh}>
          ↻
        </button>
      </div>

      <div style={{ position: 'relative', marginBottom: '10px' }}>
        <input
          style={{ ...styles.input, paddingLeft: '30px', fontSize: '13px' }}
          placeholder="Search patient..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <button
          style={{ ...styles.chip, ...(filterSpec === 'All' ? styles.chipActive : {}) }}
          onClick={() => setFilterSpec('All')}
        >
          All ({visits.length})
        </button>
        {Object.entries(specCounts).map(([spec, count]) => (
          <button
            key={spec}
            style={{ ...styles.chip, ...(filterSpec === spec ? styles.chipActive : {}) }}
            onClick={() => setFilterSpec(filterSpec === spec ? 'All' : spec)}
          >
            {spec} ({count})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={styles.emptyQueue}>
          <div style={{ fontSize: '32px' }}></div>
          <div style={{ marginTop: '8px', fontSize: '13px', color: '#999' }}>No patients in queue</div>
        </div>
      ) : (
        filtered.map((visit, index) => {
          const patient = visit.patients || {}
          const isSelected = selected?.id === visit.id
          return (
            <div
              key={visit.id}
              style={{ ...styles.queueItem, ...(isSelected ? styles.queueItemActive : {}) }}
              onClick={() => onSelect(visit)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{ ...styles.avatar, background: AVATAR_COLORS[index % AVATAR_COLORS.length], flexShrink: 0 }}
                >
                  {patient.full_name?.charAt(0)?.toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: '13px',
                      color: isSelected ? '#0F6E56' : '#111',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {patient.full_name}
                  </div>
                  <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
                    {patient.age && `${patient.age}y`} {patient.gender} • {visit.visit_type}
                  </div>
                  {visit.chief_complaint && (
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#666',
                        marginTop: '2px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      💬 {visit.chief_complaint}
                    </div>
                  )}
                  {visit.speciality && (
                    <div style={{ fontSize: '10px', color: '#7B5EA7', marginTop: '2px', fontWeight: 600 }}>
                      {visit.speciality}
                    </div>
                  )}
                  {visit.lab_requested && (
                    <div style={{ fontSize: '10px', color: '#0F6E56', marginTop: '2px', fontWeight: 700 }}>
                      🔬 Returning from Lab
                    </div>
                  )}
                  {(visit.admission_fee || visit.admission_payment_method) && (
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#555',
                        marginTop: '4px',
                        display: 'flex',
                        gap: '10px',
                        flexWrap: 'wrap',
                      }}
                    >
                      {visit.admission_fee ? ( <span>💰 KES {parseFloat(visit.admission_fee || 0).toLocaleString()}</span> ) : null}
                      {visit.admission_payment_method ? <span>Payment: {visit.admission_payment_method}</span> : null}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
                {visit.priority === 'Emergency' && <span style={{ ...styles.pill, background: '#FCEBEB', color: '#A32D2D', fontSize: '10px' }}></span>}
                {visit.priority === 'Urgent' && (
                  <span style={{ ...styles.pill, background: '#FFF3DC', color: '#C07000', fontSize: '10px' }}>⚡</span>
                )}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
