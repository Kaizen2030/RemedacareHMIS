// Top-bar sync state: offline / N changes waiting / N need review, with a panel to retry, apply anyway or discard.
import { useState } from 'react'

const TABLE_LABEL = { vitals: 'Vitals', nursing_notes: 'Nursing note', fluid_balance: 'Fluid balance', mar_doses: 'Medicine dose', ward_round_notes: 'Ward round note',
  pharmacy_inventory: 'Stock', invoices: 'Bill', prescriptions: 'Prescription', beds: 'Bed', admissions: 'Admission' }

export default function SyncIndicator({ online, syncStatus, queue = [], onRetry, onApply, onDiscard }) {
  const [open, setOpen] = useState(false)
  const pending = queue.filter((i) => i.status === 'pending').length
  const attention = queue.filter((i) => i.status !== 'pending').length
  if (online && !queue.length && syncStatus !== 'syncing') return null
  const tone = attention ? ['#FEF3F2', '#B42318'] : !online ? ['#FFFAEB', '#B54708'] : ['#EFF8FF', '#175CD3']
  const label = syncStatus === 'syncing' ? 'Syncing…'
    : attention ? `${attention} change${attention === 1 ? '' : 's'} need review`
      : !online ? (pending ? `Offline · ${pending} saved on this device` : 'Offline')
        : `${pending} waiting to sync`
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}
        style={{ border: 'none', borderRadius: 999, padding: '6px 12px', fontWeight: 800, fontSize: 12, cursor: 'pointer', background: tone[0], color: tone[1] }}>
        <span aria-hidden="true">{online ? '⟳' : '⚠'}</span> {label}
      </button>
      {open && (
        <div role="dialog" aria-label="Offline changes" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 'min(380px, 92vw)', maxHeight: 420, overflowY: 'auto', zIndex: 60,
          background: '#fff', border: '1px solid #EAECF0', borderRadius: 12, boxShadow: '0 16px 40px rgba(15,23,42,.18)', padding: 12, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>Changes on this device</strong>
            <button type="button" disabled={!online} onClick={onRetry} style={{ border: '1px solid #D0D5DD', background: '#fff', borderRadius: 8, padding: '4px 9px', cursor: online ? 'pointer' : 'not-allowed', fontWeight: 700 }}>Sync now</button>
          </div>
          {!online && <div style={{ color: '#B54708', marginBottom: 8 }}>You are offline. Vitals, notes and medicine doses are saved here and sent automatically when the connection returns. Payments are not possible offline.</div>}
          {queue.length === 0 && <div style={{ color: '#667085' }}>Everything is synced.</div>}
          {queue.map((i) => (
            <div key={i.id} style={{ borderTop: '1px solid #F2F4F7', padding: '8px 0' }}>
              <div><strong>{i.label || `${TABLE_LABEL[i.table] || i.table} (${i.operation})`}</strong> · {new Date(i.createdAt).toLocaleString('en-KE')}</div>
              <div style={{ color: i.status === 'pending' ? '#667085' : '#B42318' }}>
                {i.status === 'pending' ? 'Waiting to sync' : i.status === 'conflict' ? i.lastError : `Not accepted: ${i.lastError || 'unknown error'}`}
              </div>
              {i.status !== 'pending' && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  {i.status === 'conflict' && <button type="button" onClick={() => onApply?.(i.id)} style={{ border: 'none', background: '#FEF3F2', color: '#B42318', borderRadius: 7, padding: '4px 9px', fontWeight: 700, cursor: 'pointer' }}>Apply mine anyway</button>}
                  {i.status === 'failed' && <button type="button" onClick={() => onApply?.(i.id)} style={{ border: 'none', background: '#EFF8FF', color: '#175CD3', borderRadius: 7, padding: '4px 9px', fontWeight: 700, cursor: 'pointer' }}>Try again</button>}
                  <button type="button" onClick={() => onDiscard?.(i.id)} style={{ border: '1px solid #D0D5DD', background: '#fff', borderRadius: 7, padding: '4px 9px', fontWeight: 700, cursor: 'pointer' }}>Discard</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
