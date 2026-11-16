import { colors as C } from '../../theme'

const EMPTY_STATS = { total: 0, occupied: 0, critical: 0, reserved: 0, free: 0, maintenance: 0 }

export default function WardOverview({
  wards = [],
  beds = [],
  transfers = [],
  onSelectWard = () => {},
  canManageWards = false,
  canTransfer = false,
  onOpenAddWard = () => {},
  onApproveTransfer = () => {},
  styles = {},
  wardIcons = {},
  wardStats = () => EMPTY_STATS,
}) {
  const pendingTransfers = transfers.filter(transfer => transfer.status === 'Pending')
  const totalFree = beds.filter(bed => bed.status === 'Free').length
  const totalOccupied = beds.filter(bed => ['Occupied', 'Critical'].includes(bed.status)).length

  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={styles.sectionLabel}>Ward Operations</div>
        {canManageWards && <button type="button" style={styles.btn} onClick={onOpenAddWard}>+ Add Ward</button>}
      </div>

      <div style={styles.statsRow}>
        {[['Wards', wards.length], ['Free beds', totalFree], ['Occupied', totalOccupied], ['Pending transfers', pendingTransfers.length]].map(([label, value]) => (
          <div key={label} style={{ ...styles.statChip, background: C.surface, border: `1px solid ${C.border}` }}><div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>{value}</div><div style={{ fontSize: 11, color: C.sub }}>{label}</div></div>
        ))}
      </div>

      {wards.length === 0 ? (
        <div style={styles.empty}>No wards have been set up yet.</div>
      ) : (
        <div style={styles.wardGrid}>
          {wards.map(ward => {
            const stats = wardStats(ward.id) || EMPTY_STATS
            const occupancy = stats.total ? Math.round(((stats.occupied + stats.critical + stats.reserved) / stats.total) * 100) : 0
            return (
              <button
                type="button"
                key={ward.id}
                onClick={() => onSelectWard(ward)}
                style={{ ...styles.wardCard, border: `1px solid ${C.border}`, textAlign: 'left', color: C.text }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>{ward.name || 'Unnamed ward'}</div>
                    <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>{ward.ward_type || 'General'}{ward.floor ? ` · Floor ${ward.floor}` : ''}</div>
                  </div>
                  <span style={{ background: C.primaryL, color: C.primaryDark, borderRadius: 8, padding: '5px 8px', fontSize: 11, fontWeight: 800 }}>{wardIcons[ward.ward_type] || 'WARD'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, marginTop: 16 }}>
                  {[['Free', stats.free], ['Occupied', stats.occupied], ['Critical', stats.critical], ['Reserved', stats.reserved], ['Maintenance', stats.maintenance], ['Total', stats.total]].map(([label, value]) => (
                    <div key={label} style={{ background: C.bgAlt, borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
                      <div style={{ fontWeight: 800, color: label === 'Free' ? C.primaryDark : C.text, fontSize: 15 }}>{value}</div>
                      <div style={{ color: C.sub, fontSize: 10 }}>{label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, fontSize: 12 }}>
                  <span style={{ color: C.sub }}>Occupancy</span><strong>{occupancy}%</strong>
                </div>
                <div style={{ height: 7, background: C.borderSoft, borderRadius: 99, overflow: 'hidden', marginTop: 5 }}>
                  <div style={{ height: '100%', width: `${occupancy}%`, background: C.primary }} />
                </div>
                <div style={{ color: C.primary, fontSize: 12, fontWeight: 700, marginTop: 12 }}>Open ward beds →</div>
              </button>
            )
          })}
        </div>
      )}

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
        <div style={styles.sectionLabel}>Pending Bed Transfers</div>
        {pendingTransfers.length === 0 ? <div style={{ color: C.sub, fontSize: 13 }}>No pending transfer requests.</div> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {pendingTransfers.map(transfer => (
              <div key={transfer.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${C.borderSoft}`, padding: '8px 0' }}>
                <div>
                  <strong>{transfer.patients?.full_name || transfer.patient_name || 'Patient'}</strong>
                  <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>
                    Bed transfer request{transfer.reason ? ` · ${transfer.reason}` : ''}
                    {transfer.requested_by ? ` · Requested by ${transfer.requested_by}` : ''}
                  </div>
                </div>
                {canTransfer && <button type="button" style={{ ...styles.btn, padding: '7px 12px' }} onClick={() => onApproveTransfer(transfer)}>Approve transfer</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}