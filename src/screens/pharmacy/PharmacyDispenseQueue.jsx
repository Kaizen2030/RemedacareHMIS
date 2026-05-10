export default function PharmacyDispenseQueue({
  rxSearch,
  setRxSearch,
  rxFilter,
  setRxFilter,
  filteredGroups = [],
  statusCounts = {},
  loading,
  expandedGroups = {},
  toggleGroup,
  getRxMeta,
  actionBusy,
  canApprovePrescription,
  canReleaseDrugs,
  handleApprove,
  setRejectModal,
  openReleaseModal,
  FILTERS = [],
  C,
  css,
  EmptyState,
  PatientGroupCard,
  Badge,
}) {
  const totalLines = filteredGroups.reduce((sum, group) => sum + group.drugs.length, 0)

  return (
    <div>
      <div style={css.toolbar}>
        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <input
            style={css.input}
            placeholder="Search patient, doctor, visit number, or drug"
            value={rxSearch}
            onChange={e => setRxSearch(e.target.value)}
          />
        </div>
        <div style={css.chips}>
          {FILTERS.map(filter => (
            <button
              key={filter}
              style={{ ...css.chip, ...(rxFilter === filter ? css.chipActive : {}) }}
              onClick={() => setRxFilter(filter)}
            >
              {filter} ({statusCounts[filter] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {filteredGroups.length > 0 && (
        <div style={{ fontSize: '12px', color: C.sub, marginBottom: '12px' }}>
          Showing <strong>{filteredGroups.length}</strong> patient card{filteredGroups.length !== 1 ? 's' : ''} and <strong>{totalLines}</strong> prescription line{totalLines !== 1 ? 's' : ''}.
        </div>
      )}

      {loading ? (
        <EmptyState title="Loading pharmacy queue..." text="We are collecting prescriptions and stock details." />
      ) : filteredGroups.length === 0 ? (
        <EmptyState title="No prescriptions in this view" text="Try another filter or wait for new consultant prescriptions to arrive." />
      ) : (
        <div style={css.groupList}>
          {filteredGroups.map(group => (
            <PatientGroupCard
              key={group.key}
              group={group}
              expanded={!!expandedGroups[group.key]}
              onToggle={() => toggleGroup(group.key)}
              getRxMeta={getRxMeta}
              actionBusy={actionBusy}
              canApprovePrescription={canApprovePrescription}
              canReleaseDrugs={canReleaseDrugs}
              onApprove={handleApprove}
              onReject={rx => setRejectModal({ rx, group })}
              onRelease={openReleaseModal}
            />
          ))}
        </div>
      )}
    </div>
  )
}
