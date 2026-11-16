import { useEffect, useMemo, useState } from 'react'
import { canPerformAction, resolveRole } from '../access'
import { useHospital } from '../context'
import supabase from '../supabase'
import { colors as C, typography } from '../theme'
import {
  BLOOD_GROUPS,
  BLOOD_SCREENING_STATUSES,
  BLOOD_UNIT_STATUSES,
  canSetBloodUnitStatus,
  canTransitionBloodUnitStatus,
  determineExpiryAlertState,
  isBloodUnitEligibleForIssue,
} from '../utils/bloodBank'
import { openPromptDialog } from '../confirmDialog'
import { Bedside, Donors, Reactions, Requests, Stats as BloodStats, useBloodStaff } from './blood/BloodLoop'

const UNIT_COLUMNS = 'id, unit_reference, blood_group, component, status, screening_status, expiry_at, issued_to_patient_id, issued_by, issued_at'

const css = {
  page: {
    minHeight: '100vh',
    background: C.bg,
    fontFamily: typography.fontFamily,
    fontSize: '13px',
    color: C.text,
  },
  wrap: { padding: '20px 24px', maxWidth: '1400px', margin: '0 auto' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: '18px',
    flexWrap: 'wrap',
  },
  h1: { fontSize: '18px', fontWeight: 700, margin: 0 },
  subtext: { fontSize: '12px', color: C.sub, marginBottom: '16px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' },
  stat: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '14px 16px' },
  statLbl: { fontSize: '11px', color: C.sub, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '4px' },
  statVal: { fontSize: '22px', fontWeight: 800 },
  statSub: { fontSize: '11px', color: C.muted, marginTop: '3px' },
  toolbar: { display: 'flex', gap: '10px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' },
  SearchInput: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: '7px', fontSize: '13px', background: C.surface, color: C.text },
  select: { padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: '7px', fontSize: '13px', background: C.surface, color: C.text },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: '7px', fontSize: '13px', background: C.surface, color: C.text },
  button: { padding: '8px 14px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '12px' },
  buttonPrimary: { background: C.primary, color: '#fff' },
  buttonGhost: { background: C.surface, border: `1px solid ${C.border}`, color: C.text },
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: '10px', overflow: 'hidden', marginBottom: '16px' },
  cardHead: { padding: '12px 16px', borderBottom: `1px solid ${C.border}`, fontSize: '13px', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' },
  cardBody: { padding: '12px 16px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '9px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '.5px', borderBottom: `2px solid ${C.border}`, background: '#FAFBFD', whiteSpace: 'nowrap' },
  td: { padding: '11px 14px', borderBottom: `1px solid ${C.border}`, fontSize: '13px', verticalAlign: 'middle' },
  badge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 700 },
  note: { background: C.warningL || '#FFF7E6', border: `1px solid ${C.warn || '#D97706'}`, color: C.warn || '#B45309', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', marginBottom: '18px' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  formCard: { background: '#F8FAFC', border: `1px solid ${C.border}`, borderRadius: '10px', padding: '16px', marginBottom: '18px' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' },
  label: { display: 'block', color: C.sub, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '6px' },
}

const TABS = [['requests', 'Requests & issue'], ['bedside', 'Bedside transfusion'], ['stock', 'Stock'], ['reactions', 'Reactions'], ['donors', 'Donors'], ['stats', 'Statistics']]

function nextDate(daysAhead = 30) {
  const date = new Date()
  date.setDate(date.getDate() + daysAhead)
  return date.toISOString().slice(0, 10)
}

const toneMap = {
  green: { bg: C.primaryL || '#EAF5EF', color: C.primary || '#0F6E56' },
  red: { bg: C.dangerL || '#FCEBEB', color: C.danger || '#A32D2D' },
  yellow: { bg: C.warnL || '#FFF3DC', color: C.warn || '#C07000' },
  blue: { bg: '#E3F0FB', color: '#1A6FB5' },
  purple: { bg: C.purpleL || '#F3E8FF', color: C.purple || '#7B5EA7' },
  neutral: { bg: '#F3F4F6', color: C.sub },
}

function StatusPill({ tone = 'neutral', label }) {
  return <span style={{ ...css.badge, ...toneMap[tone] }}>{label}</span>
}

export default function BloodBank() {
  const { hospitalId, userRole } = useHospital()
  const canManage = resolveRole(userRole) === 'Admin' || canPerformAction(userRole, 'manage_blood_bank')
  const [units, setUnits] = useState([])
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingUnitId, setSavingUnitId] = useState('')
  const [error, setError] = useState('')
  const [patientsError, setPatientsError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [tab, setTab] = useState('requests')
  const staff = useBloodStaff(hospitalId)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    unit_reference: '',
    group: 'A+',
    component: 'Whole Blood',
    status: 'Pending',
    screening_status: 'pending',
    expiry_at: nextDate(30),
  })

  useEffect(() => {
    let active = true
    async function loadUnits() {
      setLoading(true)
      setError('')
      if (!hospitalId) {
        setUnits([])
        setPatients([])
        setError('Select an active hospital to view blood inventory.')
        setLoading(false)
        return
      }
      const [unitResult, patientResult] = await Promise.all([
        supabase.from('blood_bank_units').select(UNIT_COLUMNS).eq('hospital_id', hospitalId).order('created_at', { ascending: false }),
        supabase.from('patients').select('id, full_name, patient_number, blood_group').eq('hospital_id', hospitalId).order('full_name').limit(500),
      ])
      if (!active) return
      const { data, error: loadError } = unitResult
      if (loadError) {
        setUnits([])
        const message = String(loadError.message || loadError)
        setError(loadError.code === 'PGRST205' || message.includes('blood_bank_units') || message.includes('schema cache')
          ? 'Database setup required. Apply supabase/migrations/20261002000000_create_blood_bank_units.sql in Supabase, then reload.'
          : `Could not load blood inventory: ${message}`)
      } else {
        setUnits(data || [])
      }
      if (patientResult.error) {
        setPatients([])
        setPatientsError(`Could not load patient recipients: ${patientResult.error.message}`)
      } else {
        setPatients(patientResult.data || [])
        setPatientsError('')
      }
      setLoading(false)
    }
    void loadUnits()
    if (!hospitalId) return () => { active = false }
    const channel = supabase.channel(`blood-bank-live-${hospitalId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'blood_bank_units',
        filter: `hospital_id=eq.${hospitalId}`,
      }, () => { void loadUnits() })
      .subscribe()
    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [hospitalId])

  const filteredUnits = useMemo(() => {
    return units.filter((unit) => {
      const matchesSearch = !search || `${unit.unit_reference} ${unit.blood_group} ${unit.component} ${unit.status}`.toLowerCase().includes(search.toLowerCase())
      const matchesFilter = filter === 'All' || unit.status === filter
      return matchesSearch && matchesFilter
    })
  }, [filter, search, units])

  const selectedPatient = patients.find((patient) => String(patient.id) === String(selectedPatientId))
  const patientGroup = selectedPatient?.blood_group || ''

  const stats = useMemo(() => {
    if (loading || error) {
      return { available: null, expiringSoon: null, pending: null, activeDonors: null }
    }
    const available = units.filter((unit) => unit.status === 'Available' && isBloodUnitEligibleForIssue(unit)).length
    const expiringSoon = units.filter((unit) => determineExpiryAlertState(unit).tone === 'warning' || determineExpiryAlertState(unit).tone === 'danger').length

    return { available, expiringSoon, pending: null, activeDonors: null }
  }, [error, loading, units])

  const handleAddUnit = (event) => {
    event.preventDefault()
    const unitReference = form.unit_reference.trim()
    if (!unitReference) {
      window.notifyFromLegacyAlert?.('Enter a blood unit reference first.')
      return
    }
    if (!hospitalId) {
      setError('Select an active hospital before registering a blood unit.')
      return
    }
    if (!canSetBloodUnitStatus(form.status, form.screening_status)) {
      setError('A unit must have clear screening before it can be marked available.')
      return
    }

    async function saveUnit() {
      setSavingUnitId('new')
      setError('')
      const { data, error: saveError } = await supabase.from('blood_bank_units').insert({
        hospital_id: hospitalId,
        unit_reference: unitReference,
        blood_group: form.group,
        component: form.component,
        status: form.status,
        screening_status: form.screening_status,
        expiry_at: new Date(form.expiry_at).toISOString(),
      }).select(UNIT_COLUMNS).single()
      if (saveError) {
        setError(`Could not save blood unit: ${saveError.message}`)
      } else {
        setUnits((current) => [data, ...current])
        setForm({ unit_reference: '', group: 'A+', component: 'Whole Blood', status: 'Pending', screening_status: 'pending', expiry_at: nextDate(30) })
        setShowForm(false)
      }
      setSavingUnitId('')
    }
    void saveUnit()
  }

  const handleStatusChange = async (unit, status) => {
    if (!canTransitionBloodUnitStatus(unit, status)) {
      setError('That stock transition is not allowed. Confirm screening and expiry, then follow the unit status workflow.')
      return
    }
    let discard_reason
    if (status === 'Discarded') {
      discard_reason = await openPromptDialog(`Why is ${unit.unit_reference} being discarded?`, { title: 'Discard unit', placeholder: 'e.g. Expired; bag damaged; returned more than 30 minutes after issue', confirmLabel: 'Discard', tone: 'danger' })
      if (!discard_reason?.trim()) return
    }
    setSavingUnitId(unit.id)
    setError('')
    const { data, error: updateError } = await supabase.from('blood_bank_units')
      .update(discard_reason ? { status, discard_reason: discard_reason.trim() } : { status })
      .eq('hospital_id', hospitalId)
      .eq('id', unit.id)
      .select(UNIT_COLUMNS)
      .single()
    if (updateError) {
      setError(`Could not update ${unit.unit_reference}: ${updateError.message}`)
    } else {
      setUnits((current) => current.map((item) => item.id === unit.id ? data : item))
    }
    setSavingUnitId('')
  }

  const handleScreeningChange = async (unit, screening_status) => {
    setSavingUnitId(unit.id)
    setError('')
    const nextStatus = unit.status === 'Available' && !['clear', 'negative'].includes(screening_status) ? 'Quarantine' : unit.status
    const { data, error: updateError } = await supabase.from('blood_bank_units')
      .update({ screening_status, status: nextStatus })
      .eq('hospital_id', hospitalId)
      .eq('id', unit.id)
      .select(UNIT_COLUMNS)
      .single()
    if (updateError) {
      setError(`Could not update screening for ${unit.unit_reference}: ${updateError.message}`)
    } else {
      setUnits((current) => current.map((item) => item.id === unit.id ? data : item))
    }
    setSavingUnitId('')
  }

  return (
    <div style={css.page}>
      <div style={css.wrap}>
        <div style={css.header}>
          <div>
            <h1 style={css.h1}>Blood Bank</h1>
            <div style={css.subtext}>Closed loop: request → grouping → crossmatch → issue → bedside check → observations → reaction reporting.</div>
          </div>
          {tab === 'stock' && <button type="button" style={{ ...css.button, ...css.buttonPrimary }} disabled={!canManage || Boolean(error)} onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Close Form' : 'Add unit to stock'}
          </button>}
        </div>

        <div role="tablist" aria-label="Blood bank sections" style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...css.button, ...(tab === k ? css.buttonPrimary : css.buttonGhost) }}>{l}</button>)}
        </div>
        {tab === 'requests' && <Requests hospitalId={hospitalId} staff={staff || canManage} />}
        {tab === 'bedside' && <Bedside hospitalId={hospitalId} />}
        {tab === 'reactions' && <Reactions hospitalId={hospitalId} />}
        {tab === 'donors' && <Donors hospitalId={hospitalId} />}
        {tab === 'stats' && <BloodStats hospitalId={hospitalId} />}
        {tab === 'stock' && (<>

        {showForm && (
          <form onSubmit={handleAddUnit} style={css.formCard}>
            <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '12px' }}>Add blood unit</div>
            <div style={css.formGrid}>
              <div>
                <label style={css.label}>Unit reference</label>
                <input style={css.input} value={form.unit_reference} onChange={(event) => setForm((prev) => ({ ...prev, unit_reference: event.target.value }))} placeholder="e.g. BB-1024" required />
              </div>
              <div>
                <label style={css.label}>Blood group</label>
                <select style={css.select} value={form.group} onChange={(event) => setForm((prev) => ({ ...prev, group: event.target.value }))}>
                  {BLOOD_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
                </select>
              </div>
              <div>
                <label style={css.label}>Component</label>
                <select style={css.select} value={form.component} onChange={(event) => setForm((prev) => ({ ...prev, component: event.target.value }))}>
                  {['Whole Blood', 'Packed Red Cells', 'Platelets', 'Fresh Frozen Plasma', 'Cryoprecipitate'].map((component) => <option key={component} value={component}>{component}</option>)}
                </select>
              </div>
              <div>
                <label style={css.label}>Status</label>
                <select style={css.select} value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
                  <option value="Pending">Pending</option>
                  <option value="Quarantine">Quarantine</option>
                </select>
              </div>
              <div>
                <label style={css.label}>Screening</label>
                <select style={css.select} value={form.screening_status} onChange={(event) => setForm((prev) => ({ ...prev, screening_status: event.target.value }))}>
                  {BLOOD_SCREENING_STATUSES.map((status) => <option key={status} value={status}>{status === 'recheck' ? 'Re-check' : status}</option>)}
                </select>
              </div>
              <div>
                <label style={css.label}>Expiry date</label>
                <input type="date" style={css.input} value={form.expiry_at} onChange={(event) => setForm((prev) => ({ ...prev, expiry_at: event.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '14px', justifyContent: 'flex-end' }}>
              <button type="button" style={{ ...css.button, ...css.buttonGhost }} onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" style={{ ...css.button, ...css.buttonPrimary }} disabled={savingUnitId === 'new'}>{savingUnitId === 'new' ? 'Saving...' : 'Save unit'}</button>
            </div>
          </form>
        )}

        {error && <div role="alert" style={css.note}>{error}</div>}

        <div style={css.note}>
          <strong>NEEDS CLINICAL REVIEW:</strong> blood compatibility rules and transfusion safety thresholds must be confirmed by a qualified transfusion officer before any live clinical use.
        </div>

        <div style={css.statsRow}>
          <div style={css.stat}>
            <div style={css.statLbl}>Available Units</div>
            <div style={css.statVal}>{stats.available ?? '—'}</div>
            <div style={css.statSub}>Ready for issue</div>
          </div>
          <div style={css.stat}>
            <div style={css.statLbl}>Expiring Soon</div>
            <div style={css.statVal}>{stats.expiringSoon ?? '—'}</div>
            <div style={css.statSub}>Within 7 days</div>
          </div>
        </div>

        <div style={css.row2}>
          <div style={css.card}>
            <div style={css.cardHead}>
              <span>Blood inventory</span>
              <StatusPill tone={error || loading ? 'yellow' : 'green'} label={error ? 'Connection unavailable' : loading ? 'Loading stock' : 'Live stock'} />
            </div>
            <div style={css.cardBody}>
              <div style={css.toolbar}>
                <div style={{ flex: 1 }}>
                  <input
                    style={css.SearchInput}
                    placeholder="Search unit, blood group or component"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <select style={css.select} value={filter} onChange={(event) => setFilter(event.target.value)}>
                  <option value="All">All statuses</option>
                  <option value="Available">Available</option>
                  <option value="Reserved">Reserved</option>
                  <option value="Quarantine">Quarantine</option>
                  <option value="Pending">Pending</option>
                  <option value="Issued">Issued</option>
                  <option value="Discarded">Discarded</option>
                </select>
              </div>

              {loading ? (
                <div style={{ padding: '18px 12px', color: C.sub, textAlign: 'center' }}>Loading blood inventory...</div>
              ) : error ? (
                <div style={{ padding: '18px 12px', color: C.sub, textAlign: 'center' }}>Inventory records are unavailable until the database issue above is resolved.</div>
              ) : filteredUnits.length === 0 ? (
                <div style={{ padding: '18px 12px', color: C.sub, textAlign: 'center' }}>{filter === 'All' && !search ? 'No blood inventory records yet. Register a unit to begin tracking stock.' : 'No blood units match this filter.'}</div>
              ) : (
                <table style={css.table}>
                  <thead>
                    <tr>
                      <th style={css.th}>Unit</th>
                      <th style={css.th}>Group</th>
                      <th style={css.th}>Component</th>
                      <th style={css.th}>Screening</th>
                      <th style={css.th}>Status</th>
                      <th style={css.th}>Recipient</th>
                      <th style={css.th}>Expiry</th>
                      <th style={css.th}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUnits.map((unit) => {
                      const expiryState = determineExpiryAlertState(unit)
                      const recipient = patients.find((patient) => String(patient.id) === String(unit.issued_to_patient_id))

                      return (
                        <tr key={unit.id}>
                          <td style={css.td}>{unit.unit_reference}</td>
                          <td style={css.td}>{unit.blood_group}</td>
                          <td style={css.td}>{unit.component}</td>
                          <td style={css.td}>
                            {canManage ? (
                              <select aria-label={`Screening for ${unit.unit_reference}`} style={css.select} value={unit.screening_status} disabled={savingUnitId === unit.id || unit.status === 'Issued' || unit.status === 'Discarded'} onChange={(event) => void handleScreeningChange(unit, event.target.value)}>
                                {BLOOD_SCREENING_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                              </select>
                            ) : <StatusPill tone={unit.screening_status === 'clear' ? 'green' : 'yellow'} label={unit.screening_status} />}
                          </td>
                          <td style={css.td}>
                            {canManage ? (
                              <select aria-label={`Status for ${unit.unit_reference}`} style={css.select} value={unit.status} disabled={savingUnitId === unit.id || unit.status === 'Issued' || unit.status === 'Discarded'} onChange={(event) => void handleStatusChange(unit, event.target.value)}>
                                {BLOOD_UNIT_STATUSES.filter((status) => canTransitionBloodUnitStatus(unit, status)).map((status) => <option key={status} value={status}>{status}</option>)}
                              </select>
                            ) : <StatusPill tone={unit.status === 'Available' ? 'green' : unit.status === 'Quarantine' || unit.status === 'Discarded' ? 'red' : unit.status === 'Pending' ? 'yellow' : unit.status === 'Reserved' ? 'blue' : 'purple'} label={unit.status} />}
                          </td>
                          <td style={css.td}>{recipient?.full_name || (unit.status === 'Issued' ? 'Recipient unavailable' : '—')}</td>
                          <td style={css.td}>
                            <div>{new Date(unit.expiry_at).toLocaleDateString('en-KE')}</div>
                            <div style={{ fontSize: '11px', color: expiryState.tone === 'danger' ? C.danger : expiryState.tone === 'warning' ? C.warn : C.sub }}>{expiryState.label}</div>
                          </td>
                          <td style={css.td}>
                            {['Available', 'Reserved'].includes(unit.status) && (
                              <button type="button" style={{ ...css.button, ...css.buttonGhost }} onClick={() => setTab('requests')}>
                                {unit.status === 'Reserved' ? 'Reserved — issue from request' : 'Issue from a request'}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div style={css.card}>
            <div style={css.cardHead}>
              <span>Compatibility check</span>
              <StatusPill tone="blue" label="Clinical review" />
            </div>
            <div style={css.cardBody}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: C.sub, marginBottom: '8px', textTransform: 'uppercase' }}>Recipient patient</label>
              <select aria-label="Recipient patient" value={selectedPatientId} onChange={(event) => setSelectedPatientId(event.target.value)} style={{ ...css.select, width: '100%', marginBottom: '12px' }}>
                <option value="">Select registered patient</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>{patient.full_name}{patient.blood_group ? ` · ${patient.blood_group}` : ' · Blood group missing'}</option>
                ))}
              </select>
              {patientsError && <div role="alert" style={{ ...css.note, marginBottom: '8px' }}>{patientsError}</div>}
              {selectedPatientId && !patientGroup && <div style={{ ...css.note, marginBottom: '8px' }}>The selected patient has no recorded blood group. Record and verify ABO/Rh before issue.</div>}

              {BLOOD_GROUPS.map((group) => {
                const compatible = units.some((unit) => unit.component === 'Packed Red Cells' && unit.blood_group === group && unit.status === 'Available' && isBloodUnitEligibleForIssue(unit))
                return (
                  <div key={group} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}>
                    <span style={{ fontWeight: 600 }}>{group}</span>
                    <StatusPill tone={error || loading ? 'yellow' : compatible ? 'green' : 'neutral'} label={error || loading ? 'Stock unknown' : compatible ? 'Stock available' : 'Out of stock'} />
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        </>)}
      </div>
    </div>
  )
}
