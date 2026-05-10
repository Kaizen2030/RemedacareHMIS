import { useEffect, useState, useMemo, useCallback } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'

// ── Constants ──────────────────────────────────────────────────────────────────
const DOSE_TIMES = ['Morning', 'Afternoon', 'Evening', 'Night']
const DOSE_ICONS = { Morning: '🌅', Afternoon: '☀️', Evening: '🌆', Night: '🌙' }
const DOSE_HOURS = { Morning: '08:00', Afternoon: '14:00', Evening: '18:00', Night: '22:00' }

const PAGE_SIZE = 100
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

const FLAG_COLORS = {
  Normal:   { bg: '#E1F5EE', color: '#0F6E56', border: '#9FE1CB', icon: '✅' },
  Warning:  { bg: '#FFF3DC', color: '#C07000', border: '#FAC775', icon: '⚠️' },
  Critical: { bg: '#FCEBEB', color: '#A32D2D', border: '#F09595', icon: '🚨' },
}

const STATUS_COLORS = {
  Given:   { bg: '#E1F5EE', color: '#0F6E56' },
  Missed:  { bg: '#FCEBEB', color: '#A32D2D' },
  Held:    { bg: '#FFF3DC', color: '#C07000' },
  Pending: { bg: '#FFF3DC', color: '#C07000' },
}

const RX_STATUS_META = {
  Pending:  { bg: '#FFF3DC', color: '#C07000', icon: '⏳' },
  Approved: { bg: '#E3F0FB', color: '#1565C0', icon: '✅' },
  Released: { bg: '#E1F5EE', color: '#0F6E56', icon: '🟢' },
  Rejected: { bg: '#FCEBEB', color: '#A32D2D', icon: '❌' },
}

const AVATAR_COLORS = ['#E1F5EE', '#E3F0FB', '#F0EAFC', '#FFF3DC', '#FCEBEB', '#EAF3DE']

// ── Pure helpers ───────────────────────────────────────────────────────────────
function getRxStatus(rx) { return rx.status || 'Pending' }

function vitalFlag(v) {
  if (!v) return 'Normal'
  const issues = []
  if (v.bp_systolic   && (v.bp_systolic > 160   || v.bp_systolic < 90))      issues.push('BP')
  if (v.temperature_c && (v.temperature_c > 38.5 || v.temperature_c < 35.5)) issues.push('Temp')
  if (v.oxygen_sat    &&  v.oxygen_sat < 92)                                  issues.push('SpO2')
  if (v.pulse_bpm     && (v.pulse_bpm > 120      || v.pulse_bpm < 50))        issues.push('Pulse')
  if (v.blood_sugar   && (v.blood_sugar > 11     || v.blood_sugar < 3.5))     issues.push('Sugar')
  if (!issues.length) return 'Normal'
  if (issues.length >= 2 || (v.oxygen_sat && v.oxygen_sat < 88)) return 'Critical'
  return 'Warning'
}

function latestVitalChips(v) {
  if (!v) return []
  return [
    v.bp_systolic   ? `BP ${v.bp_systolic}/${v.bp_diastolic}` : null,
    v.pulse_bpm     ? `Pulse ${v.pulse_bpm}`                   : null,
    v.temperature_c ? `Temp ${v.temperature_c}\u00b0C`         : null,
    v.oxygen_sat    ? `SpO2 ${v.oxygen_sat}%`                  : null,
    v.blood_sugar   ? `Sugar ${v.blood_sugar}`                  : null,
  ].filter(Boolean)
}

function getFrequencyTimes(freq) {
  if (!freq) return ['Morning']
  const f = freq.toLowerCase()
  if (f.includes('four') || f.includes('6 hour'))  return ['Morning','Afternoon','Evening','Night']
  if (f.includes('three') || f.includes('8 hour')) return ['Morning','Afternoon','Night']
  if (f.includes('twice') || f.includes('two'))    return ['Morning','Evening']
  if (f.includes('night') || f.includes('nocte'))  return ['Night']
  return ['Morning']
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function mergeVitals(arrays) {
  const seen = new Set()
  const all = [].concat(...arrays).filter(v => {
    if (!v?.id || seen.has(v.id)) return false
    seen.add(v.id)
    return true
  })
  return all.sort((a, b) => new Date(b.recorded_at || 0) - new Date(a.recorded_at || 0))
}

// Helper: extract consistent fields from an enriched admission object
function admFields(adm) {
  return {
    patientName: adm.patientName || adm.patients?.full_name || '—',
    age:         adm.patientAge  || adm.patients?.age       || null,
    gender:      adm.patientGender || adm.patients?.gender  || null,
    blood:       adm.patientBlood  || adm.patients?.blood_group || null,
    allergies:   adm.patientAllergies || adm.patients?.allergies || null,
    chronic:     adm.patientChronic   || adm.patients?.chronic_conditions || null,
    ward:        adm.ward    || adm.visits?.ward    || null,
    bedNo:       adm.bed_no  || adm.visits?.bed_no  || null,
    doctor:      adm.admitting_doctor || adm.visits?.assigned_doctor_name || null,
    diagnosis:   adm.diagnosis || adm.visits?.doctor_notes || null,
  }
}

// ── Shared micro components ────────────────────────────────────────────────────
function Pill({ bg, color, border, children, style = {} }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
      background: bg, color, border: border ? `1px solid ${border}` : 'none',
      display: 'inline-flex', alignItems: 'center', gap: 4, ...style,
    }}>
      {children}
    </span>
  )
}

function Spinner({ size = 28 }) {
  return (
    <div style={{
      width: size, height: size, flexShrink: 0,
      border: '3px solid #e8ebe8', borderTop: '3px solid #0F6E56',
      borderRadius: '50%', animation: 'spin 0.9s linear infinite',
    }} />
  )
}

function VitalChips({ vitals, compact }) {
  if (!vitals) return null
  const chips = latestVitalChips(vitals)
  if (!chips.length) return null
  const flag = vitalFlag(vitals)
  const fc = FLAG_COLORS[flag]
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
      <Pill bg={fc.bg} color={fc.color} border={fc.border}>{fc.icon} {flag}</Pill>
      {chips.map(c => (
        <span key={c} style={{ fontSize: compact ? 10 : 11, fontWeight: 600, background: '#EFF6FF', color: '#1565C0', padding: '2px 8px', borderRadius: 99 }}>{c}</span>
      ))}
    </div>
  )
}

// ── Inpatient card ──────────────────────────────────────────────────────────────
function InpatientCard({ adm, index, latestVitals, admissionRx, medLogs, marDate, expanded, onToggle, marLoading, onLogDose, onRecordVitals, onViewHistory }) {
  const flag = vitalFlag(latestVitals)
  const fc   = FLAG_COLORS[flag]
  const isCritical = flag === 'Critical'
  const f = admFields(adm)

  function getDoseLog(rxId, time) {
    return (medLogs || []).find(l => l.prescription_id === rxId && l.scheduled_time === time)
  }

  return (
    <div style={{
      background: '#fff',
      border: `1.5px solid ${isCritical ? '#F09595' : expanded ? '#0F6E56' : '#e8e8e8'}`,
      borderLeft: `5px solid ${isCritical ? '#A32D2D' : flag === 'Warning' ? '#C07000' : '#0F6E56'}`,
      borderRadius: 14, overflow: 'hidden',
      boxShadow: isCritical ? '0 0 0 2px #FCEBEB, 0 4px 20px rgba(163,45,45,.12)' : expanded ? '0 4px 20px rgba(0,0,0,.07)' : '0 1px 4px rgba(0,0,0,.04)',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', userSelect: 'none', flexWrap: 'wrap', background: isCritical ? '#FFF5F5' : expanded ? '#FAFBFD' : '#fff' }} onClick={onToggle}>
        <div style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0, background: AVATAR_COLORS[index % AVATAR_COLORS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: '#0F6E56' }}>
          {f.patientName.charAt(0).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>{f.patientName}</span>
            {isCritical && <span style={{ fontSize: 10, fontWeight: 800, background: '#FCEBEB', color: '#A32D2D', padding: '2px 8px', borderRadius: 99 }}>🚨 CRITICAL</span>}
            {f.allergies && <span style={{ fontSize: 10, fontWeight: 700, background: '#FCEBEB', color: '#A32D2D', padding: '1px 7px', borderRadius: 99 }}>⚠️ ALLERGY</span>}
          </div>
          <div style={{ fontSize: 11, color: '#777', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {f.age    && <span>👤 {f.age}y {f.gender || ''}</span>}
            {f.blood  && <span>🩸 {f.blood}</span>}
            {f.ward   && <span>🛏 {f.ward}{f.bedNo ? ` / Bed ${f.bedNo}` : ''}</span>}
            {f.doctor && <span style={{ color: '#7B5EA7', fontWeight: 600 }}>🩺 Dr. {f.doctor}</span>}
            {adm.admission_date && <span>Admitted {new Date(adm.admission_date).toLocaleDateString('en-KE')}</span>}
          </div>
          {latestVitals ? (
            <div style={{ marginTop: 8 }}>
              <VitalChips vitals={latestVitals} compact />
              <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
                {latestVitals.recorded_by && `By ${latestVitals.recorded_by} · `}{fmtDateTime(latestVitals.recorded_at)}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#bbb', marginTop: 6 }}>No vitals recorded yet</div>
          )}
          {f.allergies && <div style={{ fontSize: 11, color: '#A32D2D', marginTop: 5, fontWeight: 600 }}>⚠️ {f.allergies}</div>}
          {f.chronic   && <div style={{ fontSize: 11, color: '#C07000', marginTop: 2 }}>🩺 {f.chronic}</div>}
          {f.diagnosis && <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>📋 {f.diagnosis}</div>}
        </div>

        <div style={{ display: 'flex', gap: 7, flexShrink: 0, flexWrap: 'wrap', alignItems: 'flex-start' }} onClick={e => e.stopPropagation()}>
          <button style={s.actionBtn('#0F6E56')} onClick={() => onRecordVitals(adm)}>❤️ Vitals</button>
          <button style={s.actionBtn('#1565C0')} onClick={() => onViewHistory(adm)}>📊 History</button>
          <span style={{ fontSize: 12, color: '#bbb', paddingTop: 9, paddingLeft: 4 }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* MAR */}
      {expanded && (
        <div style={{ borderTop: '1.5px solid #f0f0f0', background: '#FAFBFD' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#0F6E56' }}>
              💊 MAR — {new Date(marDate).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
            {marLoading && <Spinner size={18} />}
          </div>

          {!marLoading && !(admissionRx || []).length ? (
            <div style={{ padding: '28px 20px', textAlign: 'center', color: '#aaa' }}>
              <div style={{ fontSize: 32 }}>📋</div>
              <div style={{ marginTop: 8, fontSize: 13 }}>No prescriptions found for this patient.</div>
              <div style={{ fontSize: 11, marginTop: 4, color: '#ccc' }}>Drugs appear here after the pharmacist approves or releases them in the Pharmacy screen.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    <th style={s.th}>Drug / Dosage</th>
                    <th style={s.th}>Frequency</th>
                    <th style={s.th}>Rx Status</th>
                    {DOSE_TIMES.map(t => (
                      <th key={t} style={{ ...s.th, textAlign: 'center', minWidth: 80 }}>
                        {DOSE_ICONS[t]} {t}
                        <div style={{ fontSize: 9, color: '#bbb', fontWeight: 400 }}>{DOSE_HOURS[t]}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(admissionRx || []).map(rx => {
                    const activeTimes = getFrequencyTimes(rx.frequency)
                    return (
                      <tr key={rx.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={s.td}>
                          <div style={{ fontWeight: 700, color: '#111', fontSize: 13 }}>💊 {rx.drug_name}</div>
                          {rx.dosage   && <div style={{ fontSize: 11, color: '#888' }}>{rx.dosage}</div>}
                          {rx.duration && <div style={{ fontSize: 10, color: '#bbb' }}>{rx.duration}</div>}
                        </td>
                        <td style={s.td}><div style={{ fontSize: 12, color: '#555' }}>{rx.frequency || '—'}</div></td>
                        <td style={s.td}>
                          <Pill bg={rx.status === 'Released' ? '#E1F5EE' : rx.status === 'Approved' ? '#E3F0FB' : '#FFF3DC'} color={rx.status === 'Released' ? '#0F6E56' : rx.status === 'Approved' ? '#1565C0' : '#C07000'}>
                            {rx.status === 'Released' ? '🟢' : rx.status === 'Approved' ? '✅' : '⏳'} {rx.status}
                          </Pill>
                          <div style={{ fontSize: 10, color: '#aaa', marginTop: 3 }}>{rx.dispensed_by || rx.approved_by || ''}</div>
                        </td>
                        {DOSE_TIMES.map(time => {
                          const isActive = activeTimes.includes(time)
                          const log = getDoseLog(rx.id, time)
                          const sc  = log ? (STATUS_COLORS[log.status] || STATUS_COLORS.Pending) : null
                          return (
                            <td key={time} style={{ ...s.td, textAlign: 'center', padding: '8px 6px' }}>
                              {isActive ? (
                                rx.status === 'Released' ? (
                                  <button style={{ padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, minWidth: 70, lineHeight: 1.3, background: log ? sc.bg : '#f0f0f0', color: log ? sc.color : '#888' }}
                                    onClick={() => onLogDose(adm, rx, time, log)}>
                                    {log ? log.status : '— Log'}
                                    {log?.given_by && <div style={{ fontSize: 9, opacity: 0.75, marginTop: 2 }}>{log.given_by}</div>}
                                  </button>
                                ) : (
                                  <span style={{ fontSize: 10, color: '#C07000', fontWeight: 600, display: 'block', lineHeight: 1.4 }}>Pending<br />pharmacy</span>
                                )
                              ) : (
                                <span style={{ color: '#e0e0e0', fontSize: 16 }}>—</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── PatientRxCard (All Prescriptions tab) ──────────────────────────────────────
function PatientRxCard({ group, selectedRx, onSelect }) {
  const [open, setOpen] = useState(false)
  const counts = { Pending: 0, Approved: 0, Released: 0, Rejected: 0 }
  group.drugs.forEach(rx => { const st = getRxStatus(rx); if (counts[st] !== undefined) counts[st]++ })
  const hasSelected = group.drugs.some(r => r.id === selectedRx?.id)
  const needsReview = counts.Released > 0 && (counts.Pending > 0 || counts.Approved > 0 || counts.Rejected > 0)
  useEffect(() => { if (hasSelected && !open) setOpen(true) }, [hasSelected])
  const borderColor = counts.Pending > 0 ? '#C07000' : counts.Approved > 0 ? '#1565C0' : counts.Released > 0 ? '#0F6E56' : '#A32D2D'

  return (
    <div style={{ background: '#fff', border: `1px solid ${hasSelected ? '#0F6E56' : '#eee'}`, borderLeft: `4px solid ${borderColor}`, borderRadius: 12, overflow: 'hidden', boxShadow: open ? '0 4px 16px rgba(0,0,0,.07)' : '0 1px 4px rgba(0,0,0,.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', cursor: 'pointer', userSelect: 'none', background: open ? '#FAFBFD' : '#fff', flexWrap: 'wrap' }} onClick={() => setOpen(o => !o)}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: '#E1F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, color: '#0F6E56' }}>
          {group.patientName?.charAt(0)?.toUpperCase() || '?'}
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#111', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            👤 {group.patientName}
            {group.allergies && <span style={{ fontSize: 10, fontWeight: 700, background: '#FCEBEB', color: '#A32D2D', padding: '1px 7px', borderRadius: 99 }}>⚠️ ALLERGY</span>}
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {group.age    && <span>{group.age}y {group.gender || ''}</span>}
            {group.doctor && <span style={{ color: '#7B5EA7', fontWeight: 600 }}>🩺 Dr. {group.doctor}</span>}
            {group.visitNumber && <span>📋 {group.visitNumber}</span>}
          </div>
        </div>
        <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '5px 14px', textAlign: 'center', flexShrink: 0, border: '1px solid #eee' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#111', lineHeight: 1 }}>{group.drugs.length}</div>
          <div style={{ fontSize: 10, color: '#888', fontWeight: 600 }}>drug{group.drugs.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flexShrink: 0 }}>
          {counts.Pending  > 0 && <Pill bg="#FFF3DC" color="#C07000">⏳ {counts.Pending}</Pill>}
          {counts.Approved > 0 && <Pill bg="#E3F0FB" color="#1565C0">✅ {counts.Approved}</Pill>}
          {counts.Released > 0 && <Pill bg="#E1F5EE" color="#0F6E56">🟢 {counts.Released}</Pill>}
          {counts.Rejected > 0 && <Pill bg="#FCEBEB" color="#A32D2D">❌ {counts.Rejected}</Pill>}
          {needsReview && <Pill bg="#FEF2F2" color="#B91C1C" border="#FECACA">Review needed</Pill>}
        </div>
        <span style={{ fontSize: 13, color: '#aaa' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ borderTop: '1px solid #f0f0f0', padding: '12px 16px' }}>
          {group.latestVitals && <div style={{ marginBottom: 10 }}><VitalChips vitals={group.latestVitals} /></div>}
          {group.drugs.map(rx => {
            const status = getRxStatus(rx)
            const sm = RX_STATUS_META[status] || RX_STATUS_META.Pending
            const isSelected = selectedRx?.id === rx.id
            return (
              <div key={rx.id} onClick={() => onSelect(isSelected ? null : rx)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 6, flexWrap: 'wrap', background: isSelected ? '#E1F5EE' : '#FAFBFD', border: `1.5px solid ${isSelected ? '#0F6E56' : '#eee'}`, borderLeft: `3px solid ${sm.color}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>💊 {rx.drug_name}
                    {rx.dosage && <span style={{ fontWeight: 400, color: '#888', marginLeft: 6, fontSize: 12 }}>{rx.dosage}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {rx.frequency && <span>🔄 {rx.frequency}</span>}
                    {rx.duration  && <span>📅 {rx.duration}</span>}
                    {rx.quantity  && <span>📦 {rx.quantity}</span>}
                  </div>
                </div>
                <Pill bg={sm.bg} color={sm.color}>{sm.icon} {status}</Pill>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── LOG DOSE MODAL ─────────────────────────────────────────────────────────────
function LogDoseModal({ state, marDate, onClose, onSave, saving }) {
  const [form, setForm] = useState({ status: 'Given', given_by: '', notes: '' })
  useEffect(() => {
    if (!state) return
    setForm({ status: state.existingLog?.status || 'Given', given_by: state.existingLog?.given_by || '', notes: state.existingLog?.notes || '' })
  }, [state])
  if (!state) return null
  const { adm, rx, time } = state
  const f = admFields(adm)
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={{ ...s.modal, maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div>
            <h2 style={s.modalTitle}>{DOSE_ICONS[time]} Log {time} Dose</h2>
            <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{rx.drug_name}{rx.dosage ? ` — ${rx.dosage}` : ''}</div>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={s.modalBody}>
          <div style={{ background: '#E1F5EE', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12 }}>
            <div style={{ fontWeight: 700 }}>👤 {f.patientName}</div>
            <div style={{ color: '#555', marginTop: 2 }}>
              {f.ward && `🛏 ${f.ward}${f.bedNo ? ` / Bed ${f.bedNo}` : ''} · `}
              Scheduled: <strong>{DOSE_HOURS[time]}</strong> · {new Date(marDate).toLocaleDateString('en-KE')}
            </div>
          </div>
          <div style={s.formGroup}>
            <label style={s.label}>Status *</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['Given','Missed','Held'].map(st => (
                <button key={st} style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, background: form.status === st ? (st === 'Given' ? '#0F6E56' : st === 'Missed' ? '#A32D2D' : '#C07000') : '#f0f0f0', color: form.status === st ? '#fff' : '#555' }}
                  onClick={() => setForm(f => ({ ...f, status: st }))}>{st}</button>
              ))}
            </div>
          </div>
          {form.status === 'Given' && (
            <div style={s.formGroup}>
              <label style={s.label}>Administered By (Nurse / Staff) *</label>
              <input style={s.input} placeholder="Full name of nurse who gave this dose" value={form.given_by} onChange={e => setForm(f => ({ ...f, given_by: e.target.value }))} />
            </div>
          )}
          <div style={s.formGroup}>
            <label style={s.label}>Notes (optional)</label>
            <input style={s.input} placeholder="e.g. Patient vomited, dose repeated…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <div style={s.modalFooter}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={s.submitBtn} disabled={saving} onClick={() => onSave(form)}>{saving ? 'Saving…' : '✅ Save Log'}</button>
        </div>
      </div>
    </div>
  )
}

// ── RECORD VITALS MODAL ────────────────────────────────────────────────────────
function RecordVitalsModal({ adm, onClose, onSave, saving }) {
  const [form, setForm] = useState({ bp_systolic:'', bp_diastolic:'', pulse_bpm:'', temperature_c:'', oxygen_sat:'', blood_sugar:'', respiratory_rate:'', recorded_by:'', notes:'' })
  useEffect(() => { setForm({ bp_systolic:'', bp_diastolic:'', pulse_bpm:'', temperature_c:'', oxygen_sat:'', blood_sugar:'', respiratory_rate:'', recorded_by:'', notes:'' }) }, [adm])
  if (!adm) return null
  const f = admFields(adm)
  const previewFlag = (form.bp_systolic || form.pulse_bpm) ? vitalFlag(form) : null
  const pfc = previewFlag ? FLAG_COLORS[previewFlag] : null
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={{ ...s.modal, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div>
            <h2 style={s.modalTitle}>❤️ Record Vitals</h2>
            <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>
              {f.patientName}{f.ward ? ` · 🛏 ${f.ward}${f.bedNo ? ` / Bed ${f.bedNo}` : ''}` : ''}
            </div>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={s.modalBody}>
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '12px 14px', marginBottom: 18 }}>
            <label style={{ ...s.label, color: '#1565C0', fontSize: 13 }}>👩‍⚕️ Recorded By (Nurse / Staff) *</label>
            <input style={{ ...s.input, fontSize: 14, fontWeight: 600 }} placeholder="Enter your full name — required" value={form.recorded_by} onChange={e => setForm(f => ({ ...f, recorded_by: e.target.value }))} autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {[
              ['BP Systolic','bp_systolic','e.g. 120','mmHg'],
              ['BP Diastolic','bp_diastolic','e.g. 80','mmHg'],
              ['Pulse','pulse_bpm','e.g. 72','bpm'],
              ['Temperature','temperature_c','e.g. 36.6','°C'],
              ['Oxygen Sat (SpO2)','oxygen_sat','e.g. 98','%'],
              ['Blood Sugar','blood_sugar','e.g. 5.4','mmol/L'],
              ['Respiratory Rate','respiratory_rate','e.g. 16','/min'],
            ].map(([label, field, ph, unit]) => (
              <div key={field} style={s.formGroup}>
                <label style={s.label}>{label} <span style={{ color: '#bbb', fontWeight: 400 }}>({unit})</span></label>
                <input style={s.input} type="number" step="0.1" placeholder={ph} value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} />
              </div>
            ))}
          </div>
          {pfc && (
            <div style={{ background: pfc.bg, border: `1px solid ${pfc.border}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontWeight: 700, color: pfc.color, fontSize: 13 }}>
              {pfc.icon} {previewFlag === 'Critical' ? 'Critical — will flag immediately for doctor review' : previewFlag === 'Warning' ? 'Warning — some values outside normal range' : 'All values within normal range'}
            </div>
          )}
          <div style={s.formGroup}>
            <label style={s.label}>Nurse Notes / Observations (visible to doctor &amp; pharmacy)</label>
            <textarea style={{ ...s.input, minHeight: 70, resize: 'vertical' }} placeholder="Any concerns, symptoms, or medication observations to flag…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <div style={s.modalFooter}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={s.submitBtn} disabled={saving} onClick={() => onSave(form)}>{saving ? 'Saving…' : '✅ Save Vitals'}</button>
        </div>
      </div>
    </div>
  )
}

// ── VITALS HISTORY MODAL ───────────────────────────────────────────────────────
function VitalsHistoryModal({ adm, history, onClose }) {
  if (!adm) return null
  const f = admFields(adm)
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={{ ...s.modal, maxWidth: 860 }} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div>
            <h2 style={s.modalTitle}>📊 Vitals History</h2>
            <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{f.patientName} · {history.length} reading{history.length !== 1 ? 's' : ''}</div>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '0 22px 20px', overflowX: 'auto' }}>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa' }}>
              <div style={{ fontSize: 36 }}>📊</div>
              <div style={{ marginTop: 8 }}>No vitals recorded yet — use the ❤️ Vitals button on the patient card</div>
            </div>
          ) : (
            <>
              {(() => {
                const latest = history[0]
                const flag = latest.flag || vitalFlag(latest)
                const fc = FLAG_COLORS[flag]
                return (
                  <div style={{ background: fc.bg, border: `1px solid ${fc.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: fc.color }}>Latest Reading</span>
                      <Pill bg={fc.bg} color={fc.color} border={fc.border}>{fc.icon} {flag}</Pill>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
                      {[['❤️ BP', latest.bp_systolic ? `${latest.bp_systolic}/${latest.bp_diastolic}` : null,'mmHg'],['💓 Pulse',latest.pulse_bpm,'bpm'],['🌡️ Temp',latest.temperature_c,'°C'],['🫁 SpO2',latest.oxygen_sat,'%'],['🩸 Sugar',latest.blood_sugar,'mmol/L'],['🫀 RR',latest.respiratory_rate,'/min']].filter(([,v])=>v).map(([label,val,unit])=>(
                        <div key={label} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: fc.color }}>{val}</div>
                          <div style={{ fontSize: 10, color: '#aaa' }}>{unit}</div>
                        </div>
                      ))}
                    </div>
                    {latest.notes && <div style={{ marginTop: 10, fontSize: 12, color: fc.color, fontStyle: 'italic' }}>📝 {latest.notes}</div>}
                    <div style={{ fontSize: 11, color: '#888', marginTop: 8, textAlign: 'right' }}>By {latest.recorded_by} · {fmtDateTime(latest.recorded_at)}</div>
                  </div>
                )
              })()}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    {['Time','BP','Pulse','Temp','SpO2','Sugar','RR','By','Notes','Flag'].map(h => <th key={h} style={s.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {history.map(v => {
                    const flag = v.flag || vitalFlag(v)
                    const fc = FLAG_COLORS[flag]
                    return (
                      <tr key={v.id} style={{ borderBottom: '1px solid #f5f5f5', background: flag === 'Critical' ? '#fff8f8' : flag === 'Warning' ? '#fffdf5' : '#fff' }}>
                        <td style={s.td}>{fmtDateTime(v.recorded_at)}</td>
                        <td style={s.td}>{v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '—'}</td>
                        <td style={s.td}>{v.pulse_bpm || '—'}</td>
                        <td style={s.td}>{v.temperature_c ? `${v.temperature_c}°C` : '—'}</td>
                        <td style={s.td}>{v.oxygen_sat ? `${v.oxygen_sat}%` : '—'}</td>
                        <td style={s.td}>{v.blood_sugar || '—'}</td>
                        <td style={s.td}>{v.respiratory_rate || '—'}</td>
                        <td style={s.td}>{v.recorded_by || '—'}</td>
                        <td style={{ ...s.td, maxWidth: 140, fontSize: 11, color: '#666' }}>{v.notes || '—'}</td>
                        <td style={s.td}><Pill bg={fc.bg} color={fc.color}>{fc.icon} {flag}</Pill></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════════════════════════
export default function Prescriptions() {
  const { hospitalId } = useHospital()

  const [tab,     setTab]     = useState('inpatient')
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)

  const [prescriptions,   setPrescriptions]   = useState([])
  const [prescriptionPage, setPrescriptionPage] = useState(1)
  const [prescriptionPageSize, setPrescriptionPageSize] = useState(PAGE_SIZE)
  const [prescriptionTotalCount, setPrescriptionTotalCount] = useState(0)
  const [admissions,      setAdmissions]      = useState([])
  const [latestVitalsMap, setLatestVitalsMap] = useState({})

  const [admissionRxMap,  setAdmissionRxMap]  = useState({})
  const [medLogsMap,      setMedLogsMap]      = useState({})
  const [vitalHistoryMap, setVitalHistoryMap] = useState({})
  const [expandedAdm,     setExpandedAdm]     = useState({})
  const [marLoadingMap,   setMarLoadingMap]   = useState({})
  const [marDate, setMarDate] = useState(new Date().toISOString().split('T')[0])

  const [logDoseModal,      setLogDoseModal]      = useState(null)
  const [recordVitalsModal, setRecordVitalsModal] = useState(null)
  const [vitalHistoryModal, setVitalHistoryModal] = useState(null)

  const [rxSearch,   setRxSearch]   = useState('')
  const [rxFilter,   setRxFilter]   = useState('All')
  const [selectedRx, setSelectedRx] = useState(null)

  // ── fetchAll ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!hospitalId) { setLoading(false); return }
    setLoading(true)
    try {
      // 1. Prescriptions
      const start = (prescriptionPage - 1) * prescriptionPageSize
      const end = prescriptionPage * prescriptionPageSize - 1
      const { data: rxData, count: rxCount } = await supabase.from('prescriptions')
        .select('*', { count: 'exact' })
        .eq('hospital_id', hospitalId)
        .order('created_at', { ascending: false })
        .range(start, end)
      const allRx = rxData || []
      setPrescriptionTotalCount(rxCount || 0)

      // 2. Active admissions table rows
      const { data: admData } = await supabase.from('admissions').select('*').eq('hospital_id', hospitalId).eq('status', 'Active').order('admission_date', { ascending: false })
      const allAdm = admData || []

      // 3. Visits with status Admitted / Admission Requested (catches admissions not yet in admissions table)
      const { data: admVisitData } = await supabase.from('visits').select('*').eq('hospital_id', hospitalId).in('status', ['Admitted', 'Admission Requested']).order('created_at', { ascending: false })
      const admittedVisits = admVisitData || []

      // 4. Unique IDs
      const admPatIds  = allAdm.map(a => a.patient_id).filter(Boolean)
      const admVisIds  = allAdm.map(a => a.visit_id).filter(Boolean)
      const visPatIds  = admittedVisits.map(v => v.patient_id).filter(Boolean)
      const visIds     = admittedVisits.map(v => v.id).filter(Boolean)
      const rxPatIds   = allRx.map(r => r.patient_id).filter(Boolean)
      const rxVisIds   = allRx.map(r => r.visit_id).filter(Boolean)

      const patientIds = [...new Set([...admPatIds, ...visPatIds, ...rxPatIds])]
      const visitIds   = [...new Set([...admVisIds, ...visIds,    ...rxVisIds])]

      // 5. Patients + visits
      const [pRes, vRes] = await Promise.all([
        patientIds.length ? supabase.from('patients').select('id,full_name,age,gender,phone,blood_group,allergies,chronic_conditions').in('id', patientIds) : Promise.resolve({ data: [] }),
        visitIds.length   ? supabase.from('visits').select('id,visit_number,visit_type,assigned_doctor_name,speciality,chief_complaint,ward,bed_no,status,doctor_notes').in('id', visitIds) : Promise.resolve({ data: [] }),
      ])
      const pMap = Object.fromEntries((pRes.data || []).map(p => [p.id, p]))
      const vMap = Object.fromEntries((vRes.data || []).map(v => [v.id, v]))

      // 6. Beds — pull ward + bed_no for occupied/critical beds
      let bedByPatient = {}
      let bedByVisit   = {}
      if (patientIds.length) {
        try {
          const { data: bedRows } = await supabase
            .from('beds')
            .select('patient_id,visit_id,bed_number,wards(name)')
            .eq('hospital_id', hospitalId)
            .in('status', ['Occupied','Critical'])
            .in('patient_id', patientIds)
          ;(bedRows || []).forEach(b => {
            const info = { ward: b.wards?.name || null, bed_no: b.bed_number || null }
            if (b.patient_id) bedByPatient[b.patient_id] = info
            if (b.visit_id)   bedByVisit[b.visit_id]   = info
          })
        } catch (e) { console.warn('beds fetch', e) }
      }

      // 7. Enrich prescriptions
      const enrichedRx = allRx.map(rx => ({
        ...rx,
        patients: pMap[rx.patient_id] || null,
        visits:   vMap[rx.visit_id]   || null,
      }))

      // 8. Build enriched admissions — merge admissions table + admitted visits
      const seenPatients = new Set()
      const enrichedAdm  = []

      allAdm.forEach(a => {
        seenPatients.add(a.patient_id)
        const visit   = vMap[a.visit_id] || null
        const patient = pMap[a.patient_id] || null
        const bedInfo = bedByPatient[a.patient_id] || bedByVisit[a.visit_id] || {}
        enrichedAdm.push({
          ...a,
          patients: patient,
          visits:   visit,
          ward:   a.ward   || bedInfo.ward   || visit?.ward   || null,
          bed_no: a.bed_no || bedInfo.bed_no || visit?.bed_no || null,
          patientName:    patient?.full_name         || '—',
          patientAge:     patient?.age               || null,
          patientGender:  patient?.gender            || null,
          patientBlood:   patient?.blood_group       || null,
          patientAllergies:   patient?.allergies         || null,
          patientChronic:     patient?.chronic_conditions || null,
          admitting_doctor:   a.admitting_doctor || visit?.assigned_doctor_name || null,
        })
      })

      // Add visits that have no admission row yet
      admittedVisits.forEach(v => {
        if (seenPatients.has(v.patient_id)) return
        const patient = pMap[v.patient_id] || null
        const bedInfo = bedByVisit[v.id] || bedByPatient[v.patient_id] || {}
        enrichedAdm.push({
          id:             `visit-${v.id}`,
          visit_id:       v.id,
          patient_id:     v.patient_id,
          hospital_id:    hospitalId,
          status:         'Active',
          admission_date: v.created_at,
          diagnosis:      v.doctor_notes || null,
          ward:           v.ward   || bedInfo.ward   || null,
          bed_no:         v.bed_no || bedInfo.bed_no || null,
          patients:       patient,
          visits:         v,
          patientName:    patient?.full_name         || '—',
          patientAge:     patient?.age               || null,
          patientGender:  patient?.gender            || null,
          patientBlood:   patient?.blood_group       || null,
          patientAllergies:   patient?.allergies         || null,
          patientChronic:     patient?.chronic_conditions || null,
          admitting_doctor:   v.assigned_doctor_name || null,
        })
      })

      // 9. Vitals — merge both tables + visit-linked vitals
      let latestVitals = {}
      if (patientIds.length) {
        const safeQuery = async (fn) => { try { const r = await fn(); return r.data || [] } catch { return [] } }
        const [monRows, stdRows] = await Promise.all([
          safeQuery(() => supabase.from('vitals_monitoring').select('*').eq('hospital_id', hospitalId).in('patient_id', patientIds).order('recorded_at', { ascending: false })),
          safeQuery(() => supabase.from('vitals').select('*').eq('hospital_id', hospitalId).in('patient_id', patientIds).order('recorded_at', { ascending: false })),
        ])
        let visitVit = []
        if (visitIds.length) {
          visitVit = await safeQuery(() => supabase.from('vitals').select('*').eq('hospital_id', hospitalId).in('visit_id', visitIds).order('recorded_at', { ascending: false }))
        }
        const all = mergeVitals([monRows, stdRows, visitVit])
        all.forEach(row => {
          const pid = row.patient_id
          if (!pid) return
          if (!latestVitals[pid] || new Date(row.recorded_at) > new Date(latestVitals[pid].recorded_at)) {
            latestVitals[pid] = row
          }
        })
      }

      setPrescriptions(enrichedRx)
      setAdmissions(enrichedAdm)
      setLatestVitalsMap(latestVitals)
    } catch (err) {
      console.error('Prescriptions fetchAll error', err)
    } finally {
      setLoading(false)
    }
  }, [hospitalId, prescriptionPage, prescriptionPageSize])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Realtime
  useEffect(() => {
    if (!hospitalId) return
    const ch = supabase.channel('prescriptions-v3')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prescriptions', filter: `hospital_id=eq.${hospitalId}` }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admissions', filter: `hospital_id=eq.${hospitalId}` }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vitals_monitoring', filter: `hospital_id=eq.${hospitalId}` }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `hospital_id=eq.${hospitalId}` }, fetchAll)
      .subscribe()
    const h = () => fetchAll()
    window.addEventListener('remedacare:prescriptions_changed', h)
    window.addEventListener('remedacare:workflow_changed', h)
    return () => {
      supabase.removeChannel(ch)
      window.removeEventListener('remedacare:prescriptions_changed', h)
      window.removeEventListener('remedacare:workflow_changed', h)
    }
  }, [hospitalId, fetchAll])

  // ── Per-admission data loaders ────────────────────────────────────────────────
  async function loadAdmissionData(adm, date = marDate) {
    const admId = adm.id
    setMarLoadingMap(m => ({ ...m, [admId]: true }))
    let rx = []

    // Try by visit_id first
    if (adm.visit_id) {
      const { data } = await supabase.from('prescriptions').select('*')
        .eq('hospital_id', hospitalId).eq('visit_id', adm.visit_id)
        .not('status', 'eq', 'Rejected')
        .order('created_at', { ascending: false })
      rx = data || []
    }
    // Fall back to patient_id (handles mismatched visit IDs between admission + prescription)
    if (!rx.length && adm.patient_id) {
      const { data } = await supabase.from('prescriptions').select('*')
        .eq('hospital_id', hospitalId).eq('patient_id', adm.patient_id)
        .not('status', 'eq', 'Rejected')
        .order('created_at', { ascending: false })
      rx = data || []
    }

    const { data: logs } = await supabase.from('medication_logs').select('*')
      .eq('hospital_id', hospitalId).eq('patient_id', adm.patient_id)
      .eq('scheduled_date', date)

    setAdmissionRxMap(m => ({ ...m, [admId]: rx }))
    setMedLogsMap(m => ({ ...m, [admId]: logs || [] }))
    setMarLoadingMap(m => ({ ...m, [admId]: false }))
  }

  async function loadVitalHistory(adm) {
    const safeQ = async (fn) => { try { const r = await fn(); return r.data || [] } catch { return [] } }
    const [mon, std] = await Promise.all([
      safeQ(() => supabase.from('vitals_monitoring').select('*').eq('hospital_id', hospitalId).eq('patient_id', adm.patient_id).order('recorded_at', { ascending: false }).limit(40)),
      safeQ(() => supabase.from('vitals').select('*').eq('hospital_id', hospitalId).eq('patient_id', adm.patient_id).order('recorded_at', { ascending: false }).limit(40)),
    ])
    let byVisit = []
    if (adm.visit_id) {
      byVisit = await safeQ(() => supabase.from('vitals').select('*').eq('hospital_id', hospitalId).eq('visit_id', adm.visit_id).order('recorded_at', { ascending: false }).limit(40))
    }
    const merged = mergeVitals([mon, std, byVisit]).slice(0, 40)
    setVitalHistoryMap(m => ({ ...m, [adm.id]: merged }))
    return merged
  }

  async function handleToggleExpand(adm) {
    const isOpen = expandedAdm[adm.id]
    setExpandedAdm(m => ({ ...m, [adm.id]: !isOpen }))
    if (!isOpen && !admissionRxMap[adm.id]) {
      await loadAdmissionData(adm)
    }
  }

  // Reload all open cards when MAR date changes
  useEffect(() => {
    const openIds = Object.keys(expandedAdm).filter(k => expandedAdm[k])
    openIds.forEach(admId => {
      const adm = admissions.find(a => String(a.id) === admId)
      if (adm) loadAdmissionData(adm, marDate)
    })
  }, [marDate]) // eslint-disable-line

  // ── Save dose log ─────────────────────────────────────────────────────────────
  async function handleSaveDoseLog(form) {
    if (!logDoseModal) return
    const { adm, rx, time } = logDoseModal
    if (form.status === 'Given' && !form.given_by.trim()) { window.notifyFromLegacyAlert('Enter the name of the nurse who administered this dose.'); return }
    setSaving(true)
    const existing = (medLogsMap[adm.id] || []).find(l => l.prescription_id === rx.id && l.scheduled_time === time)
    if (existing) {
      await supabase.from('medication_logs').update({ status: form.status, given_by: form.given_by, notes: form.notes, given_at: form.status === 'Given' ? new Date().toISOString() : null }).eq('id', existing.id)
    } else {
      await supabase.from('medication_logs').insert({
        hospital_id: hospitalId, prescription_id: rx.id, patient_id: adm.patient_id,
        drug_name: rx.drug_name, dosage: rx.dosage,
        scheduled_time: time, scheduled_date: marDate,
        status: form.status, given_by: form.given_by,
        given_at: form.status === 'Given' ? new Date().toISOString() : null,
        notes: form.notes,
      })
    }
    setLogDoseModal(null)
    await loadAdmissionData(adm)
    setSaving(false)
  }

  // ── Save vitals ───────────────────────────────────────────────────────────────
  async function handleSaveVitals(form) {
    if (!recordVitalsModal) return
    const adm = recordVitalsModal
    if (!form.recorded_by.trim()) { window.notifyFromLegacyAlert('Enter the name of the nurse recording these vitals.'); return }
    if (!form.bp_systolic && !form.pulse_bpm) { window.notifyFromLegacyAlert('Enter at least BP or Pulse.'); return }
    setSaving(true)
    try {
      const flag   = vitalFlag(form)
      const toNum  = v => (v !== '' && v != null) ? Number(v) : null
      const syntheticId = typeof adm.id === 'string' && adm.id.startsWith('visit-')

      // Build payload WITHOUT admission_id — vitals_monitoring doesn't have that column
      const cleanPayload = {
        hospital_id:      hospitalId,
        patient_id:       adm.patient_id,
        visit_id:         adm.visit_id || null,
        bp_systolic:      toNum(form.bp_systolic),
        bp_diastolic:     toNum(form.bp_diastolic),
        pulse_bpm:        toNum(form.pulse_bpm),
        temperature_c:    toNum(form.temperature_c),
        oxygen_sat:       toNum(form.oxygen_sat),
        blood_sugar:      toNum(form.blood_sugar),
        respiratory_rate: toNum(form.respiratory_rate),
        recorded_by:      form.recorded_by,
        notes:            form.notes || null,
        flag,
        recorded_at:      new Date().toISOString(),
      }

      // vitals_monitoring (ward board) — no admission_id column
      const { error: vmErr } = await supabase.from('vitals_monitoring').insert(cleanPayload)
      if (vmErr) console.warn('vitals_monitoring insert error:', vmErr.message)

      // vitals (consultation + triage) — include admission_id if real admission
      const { error: vErr } = await supabase.from('vitals').insert({
        ...cleanPayload,
        admission_id: syntheticId ? null : adm.id,
      })
      if (vErr) console.warn('vitals insert error:', vErr.message)

      setRecordVitalsModal(null)
      const updated = await loadVitalHistory(adm)
      if (updated?.length) setLatestVitalsMap(m => ({ ...m, [adm.patient_id]: updated[0] }))
    } catch (err) {
      console.error('handleSaveVitals error', err)
      window.notifyFromLegacyAlert('Failed to save vitals. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleViewHistory(adm) {
    await loadVitalHistory(adm)
    setVitalHistoryModal(adm)
  }

  // ── Prescriptions tab grouping ────────────────────────────────────────────────
  const groupedPrescriptions = useMemo(() => {
    const map = new Map()
    prescriptions.forEach(rx => {
      const key = rx.visit_id || rx.patient_id || rx.id
      if (!map.has(key)) {
        map.set(key, {
          key,
          patientName: rx.patients?.full_name || rx.patient_name || '—',
          age: rx.patients?.age, gender: rx.patients?.gender,
          doctor: rx.visits?.assigned_doctor_name || rx.prescribed_by,
          visitNumber: rx.visits?.visit_number,
          allergies: rx.patients?.allergies,
          latestVitals: latestVitalsMap[rx.patient_id] || null,
          drugs: [],
        })
      }
      const grp = map.get(key)
      if (!grp.latestVitals && latestVitalsMap[rx.patient_id]) grp.latestVitals = latestVitalsMap[rx.patient_id]
      grp.drugs.push(rx)
    })
    return Array.from(map.values()).sort((a, b) => {
      const at = Math.max(...a.drugs.map(r => new Date(r.created_at || 0).getTime()))
      const bt = Math.max(...b.drugs.map(r => new Date(r.created_at || 0).getTime()))
      return bt - at
    })
  }, [prescriptions, latestVitalsMap])

  const filteredGroups = useMemo(() => {
    return groupedPrescriptions.filter(grp => {
      const statusMatch = rxFilter === 'All' || grp.drugs.some(rx => getRxStatus(rx) === rxFilter)
      const q = rxSearch.toLowerCase()
      const searchMatch = !q || grp.patientName.toLowerCase().includes(q) || grp.doctor?.toLowerCase().includes(q) || grp.visitNumber?.toLowerCase().includes(q) || grp.drugs.some(rx => rx.drug_name?.toLowerCase().includes(q))
      return statusMatch && searchMatch
    })
  }, [groupedPrescriptions, rxFilter, rxSearch])

  const rxCounts = useMemo(() => {
    const c = { All: prescriptions.length, Pending: 0, Approved: 0, Released: 0, Rejected: 0 }
    prescriptions.forEach(rx => { const st = getRxStatus(rx); if (c[st] !== undefined) c[st]++ })
    return c
  }, [prescriptions])

  const sortedAdmissions = useMemo(() => {
    const order = { Critical: 0, Warning: 1, Normal: 2 }
    return [...admissions].sort((a, b) => {
      const af = order[vitalFlag(latestVitalsMap[a.patient_id])] ?? 2
      const bf = order[vitalFlag(latestVitalsMap[b.patient_id])] ?? 2
      return af - bf
    })
  }, [admissions, latestVitalsMap])

  const criticalCount = admissions.filter(a => vitalFlag(latestVitalsMap[a.patient_id]) === 'Critical').length

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ height: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <Spinner size={36} />
      <p style={{ color: '#0F6E56', marginTop: 14, fontWeight: 600 }}>Loading…</p>
    </div>
  )

  return (
    <div style={s.page}>
      <style>{`
        @keyframes spin    { to { transform: rotate(360deg) } }
        @keyframes fadeIn  { from { opacity:0;transform:translateY(8px) } to { opacity:1;transform:translateY(0) } }
        @keyframes slideIn { from { opacity:0;transform:translateX(16px) } to { opacity:1;transform:translateX(0) } }
      `}</style>

      {/* Header */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>💊 Prescriptions &amp; Inpatient Care</h1>
          <p style={s.subtitle}>
            {admissions.length} active inpatient{admissions.length !== 1 ? 's' : ''}
            {criticalCount > 0 && <span style={{ color: '#A32D2D', fontWeight: 700 }}> · 🚨 {criticalCount} critical</span>}
            {' · '}{prescriptions.length} total prescriptions
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#888', fontWeight: 600 }}>MAR Date:</label>
          <input type="date" style={{ ...s.input, width: 164 }} value={marDate} onChange={e => setMarDate(e.target.value)} />
          <button style={s.refreshBtn} onClick={fetchAll}>↻ Refresh</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabRow}>
        {[
          { key: 'inpatient',     label: '🛏 Inpatient Care',    count: admissions.length,           sub: 'inpatients' },
          { key: 'prescriptions', label: '📋 All Prescriptions', count: groupedPrescriptions.length,  sub: 'patients' },
        ].map(t => (
          <button key={t.key} style={{ ...s.tabBtn, ...(tab === t.key ? s.tabBtnActive : {}) }} onClick={() => setTab(t.key)}>
            {t.label}
            <span style={{ ...s.tabCount, ...(tab === t.key ? s.tabCountActive : {}) }}>{t.count} {t.sub}</span>
            {t.key === 'inpatient' && criticalCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 800, background: '#FCEBEB', color: '#A32D2D', padding: '1px 7px', borderRadius: 99, marginLeft: 4 }}>🚨 {criticalCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* ══ INPATIENT CARE ══ */}
      {tab === 'inpatient' && (
        <div>
          {sortedAdmissions.length === 0 ? (
            <div style={s.empty}>
              <div style={{ fontSize: 48 }}>🛏</div>
              <div style={{ marginTop: 12, color: '#888', fontSize: 14 }}>No active inpatients found</div>
              <div style={{ marginTop: 6, color: '#bbb', fontSize: 12, maxWidth: 400, margin: '8px auto 0' }}>
                Patients appear here when admitted via the Patients screen (Pharmacy → Admit outcome) or when a visit status is set to "Admitted". Check that the admission status is "Active" in the database.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sortedAdmissions.map((adm, i) => (
                <InpatientCard
                  key={adm.id}
                  adm={adm}
                  index={i}
                  latestVitals={latestVitalsMap[adm.patient_id] || null}
                  admissionRx={admissionRxMap[adm.id] || []}
                  medLogs={medLogsMap[adm.id] || []}
                  marDate={marDate}
                  expanded={!!expandedAdm[adm.id]}
                  onToggle={() => handleToggleExpand(adm)}
                  marLoading={!!marLoadingMap[adm.id]}
                  onLogDose={(a, rx, time, existingLog) => setLogDoseModal({ adm: a, rx, time, existingLog })}
                  onRecordVitals={a => setRecordVitalsModal(a)}
                  onViewHistory={a => handleViewHistory(a)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ ALL PRESCRIPTIONS ══ */}
      {tab === 'prescriptions' && (
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13 }}>🔍</span>
                <input style={{ ...s.input, paddingLeft: 30 }} placeholder="Search patient, drug, doctor, visit…" value={rxSearch} onChange={e => setRxSearch(e.target.value)} />
              </div>
              {['All','Pending','Approved','Released','Rejected'].map(f => (
                <button key={f} style={{ ...s.chip, ...(rxFilter === f ? s.chipActive : {}) }} onClick={() => setRxFilter(f)}>{f} ({rxCounts[f] ?? 0})</button>
              ))}
            </div>
            {filteredGroups.length > 0 && (
              <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
                <strong>{filteredGroups.length}</strong> patient{filteredGroups.length !== 1 ? 's' : ''} · <strong>{filteredGroups.reduce((n, g) => n + g.drugs.length, 0)}</strong> lines{rxFilter !== 'All' && ` · ${rxFilter}`}
              </div>
            )}
            {filteredGroups.length === 0 ? (
              <div style={s.empty}><div style={{ fontSize: 48 }}>💊</div><div style={{ marginTop: 12, color: '#888' }}>No prescriptions found</div></div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {filteredGroups.map(grp => <PatientRxCard key={grp.key} group={grp} selectedRx={selectedRx} onSelect={setSelectedRx} />)}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, color: '#555' }}>
                    Showing {prescriptions.length} of {prescriptionTotalCount || 0} prescriptions
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 12, color: '#555' }}>Show:</label>
                    <select style={{ ...s.input, width: 'auto' }} value={prescriptionPageSize} onChange={e => { setPrescriptionPageSize(Number(e.target.value)); setPrescriptionPage(1) }}>
                      {PAGE_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}</option>)}
                    </select>
                    <button style={{ ...s.btn, ...(prescriptionPage <= 1 ? s.btnGhost : s.btnPri), padding: '8px 12px' }} disabled={prescriptionPage <= 1} onClick={() => setPrescriptionPage(prev => Math.max(prev - 1, 1))}>← Previous</button>
                    <span style={{ fontSize: 12, color: '#555' }}>Page {prescriptionPage} of {Math.max(1, Math.ceil((prescriptionTotalCount || 0) / prescriptionPageSize))}</span>
                    <button style={{ ...s.btn, ...(prescriptionPage >= Math.ceil((prescriptionTotalCount || 0) / prescriptionPageSize) ? s.btnGhost : s.btnPri), padding: '8px 12px' }} disabled={prescriptionPage >= Math.ceil((prescriptionTotalCount || 0) / prescriptionPageSize)} onClick={() => setPrescriptionPage(prev => prev + 1)}>Next →</button>
                  </div>
                </div>
              </>
            )}
          </div>

          {selectedRx && (
            <div style={{ ...s.detailPanel, animation: 'slideIn 0.2s ease' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Prescription Detail</div>
                <button style={s.closeBtn} onClick={() => setSelectedRx(null)}>✕</button>
              </div>
              <div style={{ background: '#E1F5EE', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{selectedRx.patients?.full_name || selectedRx.patient_name}</div>
                {selectedRx.patients?.allergies && <div style={{ fontSize: 11, color: '#A32D2D', marginTop: 4, fontWeight: 600 }}>⚠️ {selectedRx.patients.allergies}</div>}
              </div>
              {(() => {
                const selectedGroup = groupedPrescriptions.find(group => group.drugs.some(rx => rx.id === selectedRx.id))
                if (!selectedGroup) return null
                const releasedCount = selectedGroup.drugs.filter(rx => getRxStatus(rx) === 'Released').length
                const openCount = selectedGroup.drugs.filter(rx => getRxStatus(rx) !== 'Released').length
                if (!(releasedCount > 0 && openCount > 0)) return null
                return (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: '#B91C1C', fontWeight: 600 }}>
                    Partial dispensing detected. {openCount} line{openCount !== 1 ? 's' : ''} still need pharmacist review against patient history before the prescription is fully completed.
                  </div>
                )
              })()}
              {selectedRx.visits?.assigned_doctor_name && (
                <div style={{ background: '#F0EAFC', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12 }}>
                  <span style={{ color: '#7B5EA7', fontWeight: 700 }}>🩺 Dr. {selectedRx.visits.assigned_doctor_name}</span>
                  {selectedRx.visits.speciality && <span style={{ color: '#888', marginLeft: 8 }}>{selectedRx.visits.speciality}</span>}
                </div>
              )}
              {selectedRx.visits?.ward && (
                <div style={{ background: '#EAF3DE', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#3B6D11' }}>
                  🛏 {selectedRx.visits.ward}{selectedRx.visits.bed_no ? ` / Bed ${selectedRx.visits.bed_no}` : ''}
                </div>
              )}
              {[
                ['Drug',          selectedRx.drug_name],
                ['Dosage',        selectedRx.dosage    || '—'],
                ['Frequency',     selectedRx.frequency || '—'],
                ['Duration',      selectedRx.duration  || '—'],
                ['Quantity',      selectedRx.quantity  || '—'],
                ['Status',        getRxStatus(selectedRx)],
                ['Visit',         selectedRx.visits?.visit_number || '—'],
                ['Prescribed By', selectedRx.prescribed_by || '—'],
                ['Approved By',   selectedRx.approved_by   || '—'],
                ['Released By',   selectedRx.dispensed_by  || '—'],
                ['Reject Reason', selectedRx.reject_reason || '—'],
              ].map(([label, val]) => (
                <div key={label} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #f5f5f5' }}>
                  <div style={{ fontSize: 10, color: '#aaa', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
                  <div style={{ fontSize: 13, color: '#111', fontWeight: 500 }}>{val}</div>
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#888', padding: '10px 12px', background: '#f9fafb', borderRadius: 8, textAlign: 'center', marginTop: 12 }}>
                Dispensing is managed in Pharmacy. MAR logging is in Inpatient Care after release.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <LogDoseModal state={logDoseModal} marDate={marDate} onClose={() => !saving && setLogDoseModal(null)} onSave={handleSaveDoseLog} saving={saving} />
      {recordVitalsModal && <RecordVitalsModal adm={recordVitalsModal} onClose={() => !saving && setRecordVitalsModal(null)} onSave={handleSaveVitals} saving={saving} />}
      {vitalHistoryModal && <VitalsHistoryModal adm={vitalHistoryModal} history={vitalHistoryMap[vitalHistoryModal.id] || []} onClose={() => setVitalHistoryModal(null)} />}
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = {
  page:          { padding: '20px 24px', flex: 1, overflowY: 'auto', background: '#f7f8f7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', minHeight: '100vh', boxSizing: 'border-box' },
  header:        { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  title:         { fontSize: 22, fontWeight: 800, margin: 0, color: '#111' },
  subtitle:      { color: '#777', margin: '4px 0 0', fontSize: 13 },
  refreshBtn:    { background: '#0F6E56', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 },
  tabRow:        { display: 'flex', gap: 4, marginBottom: 16, background: '#fff', padding: '6px 8px', borderRadius: 10, border: '1px solid #eee', flexWrap: 'wrap' },
  tabBtn:        { padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#888', borderRadius: 7, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' },
  tabBtnActive:  { background: '#0F6E56', color: '#fff' },
  tabCount:      { fontSize: 11, padding: '2px 7px', borderRadius: 99, background: '#f0f0f0', color: '#666', fontWeight: 700 },
  tabCountActive:{ background: 'rgba(255,255,255,0.25)', color: '#fff' },
  detailPanel:   { width: 290, flexShrink: 0, background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 16, overflowY: 'auto', maxHeight: 'calc(100vh - 160px)' },
  chip:          { fontSize: 12, padding: '6px 14px', borderRadius: 99, border: '1px solid #e0e0e0', background: '#fff', cursor: 'pointer', fontWeight: 500, color: '#555', whiteSpace: 'nowrap' },
  chipActive:    { background: '#0F6E56', color: '#fff', border: '1px solid #0F6E56' },
  empty:         { textAlign: 'center', padding: '80px 20px', color: '#999' },
  th:            { fontSize: 11, color: '#888', fontWeight: 600, textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #f0f0f0', textTransform: 'uppercase', whiteSpace: 'nowrap' },
  td:            { fontSize: 13, color: '#333', padding: '10px 12px', verticalAlign: 'middle' },
  closeBtn:      { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#aaa' },
  overlay:       { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal:         { background: '#fff', borderRadius: 16, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.2)', animation: 'fadeIn 0.2s ease' },
  modalHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 24px', borderBottom: '1px solid #f0f0f0' },
  modalTitle:    { fontSize: 17, fontWeight: 700, margin: 0, color: '#111' },
  modalBody:     { padding: '20px 24px', overflowY: 'auto', flex: 1 },
  modalFooter:   { padding: '14px 24px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end', gap: 10 },
  formGroup:     { marginBottom: 14 },
  label:         { fontSize: 12, color: '#666', display: 'block', marginBottom: 5, fontWeight: 600 },
  input:         { width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#111', fontFamily: 'inherit' },
  cancelBtn:     { padding: '10px 20px', border: '1px solid #ddd', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#555' },
  submitBtn:     { padding: '10px 24px', border: 'none', borderRadius: 8, background: '#0F6E56', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  actionBtn: bg => ({ background: bg, color: '#fff', border: 'none', padding: '7px 13px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }),
}
