import { useEffect, useMemo, useState } from 'react'
import { canPerformAction } from '../../access'
import supabase from '../../supabase'
import { useHospital } from '../../context'
import useStaff from '../../hooks/useStaff'
import { findInventoryMatch as matchInventoryDrug, matchesDrugSearch, normalizeDrugText } from '../../utils/pharmacy'
import PatientWorkflowCard from '../../components/PatientWorkflowCard'
import { executeWithFallback, omitKeys } from '../../utils/dbCompat'
import { broadcastAntibiogramUpdated, broadcastPrescriptionsChanged, broadcastStewardshipChanged, broadcastWorkflowChanged } from '../../utils/workflowEvents'
import { buildWorkflowInvoiceNote, createServiceLine, parseWorkflowInvoiceNote, SERVICE_SOURCES, stringifyServiceLines } from '../../utils/workflowBilling'
import { buildAmrInterventions, summarizeAmrInterventions } from '../../utils/hospitalSignals'
import { executeMicrobiologyQuery } from '../../utils/microbiologyResults'
import { logAudit } from '../../utils/audit'
import { colors as C, typography } from '../../theme'
import PharmacyDispenseQueue from './PharmacyDispenseQueue'
import PharmacyPOS from './PharmacyPOS'
import PharmacyStockPanel from './PharmacyStockPanel'

const PAYMENT_OPTIONS = [
  'Cash',
  'M-Pesa',
  'Credit',
  'Insurance',
  'SHA',
  'SHA (Social Health Authority)',
  'AAR Insurance',
  'Jubilee Insurance',
  'Britam',
  'CIC Insurance',
  'APA Insurance',
  'Sanlam',
  'Old Mutual',
  'NHIF',
  'Corporate Scheme',
  'Other',
]

const NON_INSURANCE = ['Cash', 'M-Pesa']
const SHA_METHOD = 'SHA (Social Health Authority)'
const CREDIT_METHOD = 'Credit'
const FILTERS = ['Pending', 'Approved', 'Released', 'Rejected', 'All']
const PHARMACY_QUEUE_VISIT_STATUSES = ['Prescription', 'Pharmacy', 'Admission Requested', 'Admitted']

const css = {
  page: { minHeight: '100vh', background: C.bg, color: C.text, fontFamily: typography.fontFamily },
  wrap: { padding: '20px 24px', maxWidth: '1480px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '14px', marginBottom: '16px', flexWrap: 'wrap' },
  title: { fontSize: '20px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' },
  subtitle: { fontSize: '12px', color: C.sub, margin: '4px 0 0' },
  toolbar: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '16px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: '8px', background: C.surface, fontSize: '13px', color: C.text, outline: 'none' },
  select: { padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: '8px', background: C.surface, fontSize: '13px', color: C.text, outline: 'none' },
  btn: { border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '12px', padding: '9px 14px' },
  btnPri: { background: C.primary, color: '#fff' },
  btnGhost: { background: C.surface, color: C.text, border: `1px solid ${C.border}` },
  btnBlue: { background: C.blue, color: '#fff' },
  btnDanger: { background: C.dangerL, color: C.danger },
  btnSoft: { background: C.primaryL, color: C.primary },
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: '14px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: '12px', marginBottom: '16px' },
  stat: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '16px' },
  statLabel: { fontSize: '11px', color: C.sub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' },
  statValue: { fontSize: '28px', fontWeight: 800, lineHeight: 1.1, marginTop: '4px' },
  statSub: { fontSize: '12px', color: C.sub, marginTop: '6px' },
  banner: { background: 'linear-gradient(135deg, #EFF6FF, #F0FDF4)', border: '1px solid #BFDBFE', borderRadius: '14px', padding: '14px 16px', marginBottom: '16px', display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' },
  chips: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' },
  chip: { padding: '6px 14px', borderRadius: '999px', border: `1px solid ${C.border}`, background: C.surface, color: C.sub, cursor: 'pointer', fontSize: '12px', fontWeight: 700 },
  chipActive: { background: C.primary, color: '#fff', borderColor: C.primary },
  groupList: { display: 'flex', flexDirection: 'column', gap: '12px' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 999 },
  modal: { width: '720px', maxWidth: '96vw', maxHeight: '90vh', overflowY: 'auto', background: C.surface, borderRadius: '18px', boxShadow: '0 28px 80px rgba(15,23,42,.28)', padding: '22px' },
  modalTitle: { fontSize: '17px', fontWeight: 800, margin: 0 },
  modalSub: { fontSize: '12px', color: C.sub, marginTop: '4px' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  label: { fontSize: '11px', color: C.sub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px', display: 'block' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '10px 12px', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.05em', color: C.sub, borderBottom: `1px solid ${C.border}`, background: '#FAFBFD' },
  td: { padding: '10px 12px', borderBottom: `1px solid ${C.border}`, fontSize: '13px', verticalAlign: 'top' },
}

function formatKES(value) {
  return `KES ${Number(value || 0).toLocaleString()}`
}

function getRxStatus(rx) {
  if (rx.status) return rx.status
  if (rx.dispensed_by || rx.dispensed_at) return 'Released'
  return 'Pending'
}

function nextVisitStatusAfterPharmacyAction(currentStatus) {
  if (['Admission Requested', 'Admitted'].includes(currentStatus)) return currentStatus
  return 'Pharmacy'
}

function formatVitalSummary(vitals) {
  if (!vitals) return []
  return [
    vitals.bp_systolic ? `BP ${vitals.bp_systolic}/${vitals.bp_diastolic}` : null,
    vitals.pulse_bpm ? `Pulse ${vitals.pulse_bpm}` : null,
    vitals.temperature_c ? `Temp ${vitals.temperature_c}°C` : null,
    vitals.oxygen_sat ? `SpO2 ${vitals.oxygen_sat}%` : null,
    vitals.blood_sugar ? `Sugar ${vitals.blood_sugar}` : null,
  ].filter(Boolean)
}

function parseServices(services) {
  if (!services) return []
  try {
    const parsed = JSON.parse(services)
    return Array.isArray(parsed)
      ? parsed.map(item => ({
          label: item.label || item.drug || item.name || 'Drug',
          qty: Number(item.qty || item.quantity || item.qty_sold || 1),
          unit_price: Number(item.unit_price || item.price || 0),
          total: Number(item.total || item.total_kes || 0),
        }))
      : []
  } catch (_) {
    return []
  }
}

function normalizePaymentMethod(method) {
  const normalized = String(method || '').trim()
  if (!normalized) return 'Cash'
  if (normalized === SHA_METHOD) return 'SHA'
  return normalized
}

function isCreditPaymentMethod(method) {
  return normalizePaymentMethod(method) === CREDIT_METHOD
}

function isInsurancePaymentMethod(method) {
  const normalized = normalizePaymentMethod(method)
  return !NON_INSURANCE.includes(normalized) && normalized !== CREDIT_METHOD
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function isPharmacyStaffMember(member) {
  if (!member) return false
  const department = normalizeText(member.department)
  const roleCategory = normalizeText(member.role_category)
  const role = normalizeText(member.role)
  const jobTitle = normalizeText(member.job_title)

  if (department === 'pharmacy' || roleCategory === 'pharmacy') return true

  const combined = `${role} ${jobTitle}`
  const pharmacyTokens = ['pharmacy', 'pharmacist', 'pharmaceutical', 'dispens', 'chemist', 'pharm tech', 'pharmtech']
  return pharmacyTokens.some(token => combined.includes(token))
}

function getStaffRoleLabel(member) {
  return member?.job_title || member?.role || member?.role_category || member?.department || 'Pharmacy staff'
}

function Badge({ color = 'gray', label }) {
  const palette = {
    green: { bg: C.successL, color: C.success },
    yellow: { bg: C.warnL, color: C.warn },
    blue: { bg: C.blueL, color: C.blue },
    red: { bg: C.dangerL, color: C.danger },
    purple: { bg: C.purpleL, color: C.purple },
    gray: { bg: '#F3F4F6', color: C.sub },
  }[color] || { bg: '#F3F4F6', color: C.sub }

  return (
    <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: '999px', background: palette.bg, color: palette.color, fontSize: '11px', fontWeight: 700 }}>
      {label}
    </span>
  )
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ ...css.stat, borderTop: `4px solid ${accent || C.primary}` }}>
      <div style={css.statLabel}>{label}</div>
      <div style={css.statValue}>{value}</div>
      <div style={css.statSub}>{sub}</div>
    </div>
  )
}

function EmptyState({ title, text }) {
  return (
    <div style={{ ...css.card, padding: '46px 20px', textAlign: 'center', color: C.sub }}>
      <div style={{ fontSize: '15px', fontWeight: 800, color: C.text }}>{title}</div>
      <div style={{ fontSize: '12px', marginTop: '8px' }}>{text}</div>
    </div>
  )
}

function RejectModal({ state, onClose, onConfirm, saving }) {
  const [reason, setReason] = useState(state?.rx?.reject_reason || '')

  useEffect(() => {
    setReason(state?.rx?.reject_reason || '')
  }, [state])

  if (!state?.rx) return null

  return (
    <div style={css.overlay}>
      <div style={{ ...css.modal, width: '540px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start', marginBottom: '14px' }}>
          <div>
            <h3 style={css.modalTitle}>Reject Prescription</h3>
            <div style={css.modalSub}>{state.group?.patientName || state.rx.patient_name} - {state.rx.drug_name}</div>
          </div>
          <button style={{ ...css.btn, ...css.btnGhost, padding: '7px 12px' }} onClick={onClose}>Close</button>
        </div>

        <label style={css.label}>Reason</label>
        <textarea
          style={{ ...css.input, minHeight: '120px', resize: 'vertical' }}
          placeholder="Explain why this prescription is being rejected"
          value={reason}
          onChange={e => setReason(e.target.value)}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button style={{ ...css.btn, ...css.btnGhost }} onClick={onClose}>Cancel</button>
          <button
            style={{ ...css.btn, ...css.btnDanger }}
            disabled={saving}
            onClick={() => onConfirm(reason)}
          >
            {saving ? 'Saving...' : 'Reject Prescription'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ReleaseModal({ state, getRxMeta, hospitalName, pharmacistName, pharmacyStaff, inventory, onClose, onConfirm, saving }) {
  const reviewItems = useMemo(() => {
    if (!state) return []
    if (state.group?.drugs?.length) {
      return state.group.drugs.filter(rx => getRxStatus(rx) === 'Approved')
    }
    return state.items || []
  }, [state])
  const [form, setForm] = useState({
    payment_method: 'Cash',
    mpesa_ref: '',
    notes: '',
    released_by: pharmacistName || '',
  })
  const [posLines, setPosLines] = useState([])
  const [activeRxId, setActiveRxId] = useState(null)
  const [inventorySearch, setInventorySearch] = useState('')

  useEffect(() => {
    const preferredIds = new Set((state?.items || []).map(rx => rx.id))
    const nextLines = reviewItems.map(rx => {
      const meta = getRxMeta(rx)
      const hasSuggestedStock = Number(meta.stockLeft || 0) >= Number(meta.quantity || 0)
      const include = preferredIds.size === 0 ? hasSuggestedStock : preferredIds.has(rx.id)

      return {
        rxId: rx.id,
        inventoryId: meta.stockItem?.id ? String(meta.stockItem.id) : '',
        include,
        requestedQty: meta.quantity,
        searchText: meta.stockItem?.drug_name || rx.drug_name || '',
      }
    })

    setForm({
      payment_method: 'Cash',
      mpesa_ref: '',
      notes: '',
      released_by: pharmacistName || '',
    })
    setPosLines(nextLines)
    setActiveRxId(nextLines[0]?.rxId || null)
    setInventorySearch(nextLines[0]?.searchText || '')
  }, [state, pharmacistName, reviewItems])

  if (!reviewItems.length) return null

  const reviewMap = new Map(reviewItems.map(rx => [rx.id, rx]))
  const inventoryMap = new Map((inventory || []).map(item => [String(item.id), item]))
  const activeLine = posLines.find(line => line.rxId === activeRxId) || posLines[0] || null
  const patientName = state.group?.patientName || reviewItems[0]?.patients?.full_name || reviewItems[0]?.patient_name || 'Patient'
  const inventoryResults = ((inventory || []).filter(item => {
    if (!inventorySearch.trim()) return true
    return matchesDrugSearch(inventorySearch, item)
  }))
    .sort((a, b) => {
      const stockDiff = Number(b.quantity_in_stock || 0) - Number(a.quantity_in_stock || 0)
      if (stockDiff !== 0) return stockDiff
      return String(a.drug_name || '').localeCompare(String(b.drug_name || ''))
    })
    .slice(0, 80)

  const cartItems = posLines
    .map(line => {
      const rx = reviewMap.get(line.rxId)
      const inventoryItem = inventoryMap.get(String(line.inventoryId))
      if (!rx || !line.include || !inventoryItem) return null
      const qty = Math.max(1, Number(rx.quantity || 1))
      const unitPrice = Number(inventoryItem.selling_price || 0)
      const subtotal = unitPrice * qty

      return {
        rx,
        inventoryItem,
        qty,
        unitPrice,
        subtotal,
      }
    })
    .filter(Boolean)

  const readyCount = cartItems.length
  const reviewCount = Math.max(0, reviewItems.length - readyCount)
  const total = cartItems.reduce((sum, item) => sum + item.subtotal, 0)

  function updateLine(rxId, patch) {
    setPosLines(current => current.map(line => (line.rxId === rxId ? { ...line, ...patch } : line)))
  }

  function focusLine(rxId) {
    const rx = reviewMap.get(rxId)
    setActiveRxId(rxId)
    setInventorySearch(rx?.drug_name || '')
  }

  function assignInventory(item) {
    if (!activeLine) return
    updateLine(activeLine.rxId, {
      inventoryId: String(item.id),
      include: true,
      searchText: item.drug_name || '',
    })
    setInventorySearch(item.drug_name || '')
  }

  return (
    <div style={css.overlay}>
      <div style={{ ...css.modal, width: '1160px', maxWidth: '98vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start', marginBottom: '14px' }}>
          <div>
            <h3 style={css.modalTitle}>Pharmacy POS and Release Cart</h3>
            <div style={css.modalSub}>{hospitalName || 'Hospital'} - {patientName}</div>
          </div>
          <button style={{ ...css.btn, ...css.btnGhost, padding: '7px 12px' }} onClick={onClose}>Close</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
            <div style={{ ...css.card, padding: '14px 16px', background: '#FAFBFD' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '12px', color: C.sub }}>
                  Approved lines waiting for POS matching: <strong style={{ color: C.text }}>{reviewItems.length}</strong>
                </div>
                <div style={{ fontSize: '12px', color: C.sub }}>
                  In cart <strong style={{ color: C.primary }}>{readyCount}</strong> | Back to review <strong style={{ color: C.danger }}>{reviewCount}</strong>
                </div>
              </div>
              <div style={{ fontSize: '11px', color: C.sub, marginTop: '10px' }}>
                Click a prescription line, search all stocked drugs by name or abbreviation, then add the matching item to the cart. Any approved line left out of the cart is sent back for pharmacist review after release.
              </div>
            </div>

            <div style={{ ...css.card, padding: '14px 16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: C.text, marginBottom: '10px' }}>Prescription Review Lines</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {reviewItems.map(rx => {
                  const meta = getRxMeta(rx)
                  const line = posLines.find(item => item.rxId === rx.id)
                  const assignedItem = line?.inventoryId ? inventoryMap.get(String(line.inventoryId)) : null
                  const isActive = activeRxId === rx.id
                  const inCart = !!(line?.include && assignedItem)

                  return (
                    <div
                      key={rx.id}
                      style={{
                        border: `1px solid ${isActive ? '#86EFAC' : C.border}`,
                        borderLeft: `4px solid ${inCart ? C.primary : C.warn}`,
                        borderRadius: '12px',
                        padding: '12px 13px',
                        background: isActive ? '#F0FDF4' : '#FFFFFF',
                        cursor: 'pointer',
                      }}
                      onClick={() => focusLine(rx.id)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: '180px' }}>
                          <div style={{ fontSize: '13px', fontWeight: 800, color: C.text }}>{rx.drug_name}</div>
                          <div style={{ fontSize: '11px', color: C.sub, marginTop: '4px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {rx.dosage && <span>{rx.dosage}</span>}
                            {rx.frequency && <span>{rx.frequency}</span>}
                            {rx.duration && <span>{rx.duration}</span>}
                            <span>Qty {meta.quantity}</span>
                          </div>
                          <div style={{ fontSize: '11px', color: assignedItem ? C.primary : C.sub, marginTop: '8px' }}>
                            {assignedItem
                              ? `POS match: ${assignedItem.drug_name} (${Number(assignedItem.quantity_in_stock || 0)} in stock)`
                              : `Suggested stock: ${meta.stockLabel}`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                          <Badge color={inCart ? 'green' : 'yellow'} label={inCart ? 'In cart' : 'Review'} />
                          {meta.stockItem && (
                            <button
                              style={{ ...css.btn, ...css.btnGhost, padding: '7px 10px' }}
                              onClick={event => {
                                event.stopPropagation()
                                focusLine(rx.id)
                                updateLine(rx.id, {
                                  inventoryId: String(meta.stockItem.id),
                                  include: true,
                                  searchText: meta.stockItem.drug_name,
                                })
                              }}
                            >
                              Use Suggested Match
                            </button>
                          )}
                          <button
                            style={{ ...css.btn, ...(line?.include ? css.btnDanger : css.btnSoft), padding: '7px 10px' }}
                            onClick={event => {
                              event.stopPropagation()
                              updateLine(rx.id, { include: !line?.include })
                            }}
                          >
                            {line?.include ? 'Keep for Review' : 'Add Back to Cart'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ ...css.card, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 800, color: C.text }}>Drug Search</div>
                  <div style={{ fontSize: '11px', color: C.sub, marginTop: '4px' }}>
                    {activeLine ? `Assigning stock for ${reviewMap.get(activeLine.rxId)?.drug_name || 'selected line'}` : 'Select a line to assign stock'}
                  </div>
                </div>
                <div style={{ minWidth: '280px', flex: 1 }}>
                  <input
                    style={css.input}
                    value={inventorySearch}
                    onChange={e => setInventorySearch(e.target.value)}
                    placeholder="Search all stocked drugs by name, generic, or abbreviation"
                  />
                </div>
              </div>
              <div style={{ maxHeight: '280px', overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: '12px' }}>
                {inventoryResults.length === 0 ? (
                  <div style={{ padding: '26px 18px', textAlign: 'center', color: C.sub, fontSize: '12px' }}>
                    No stock item matched this search.
                  </div>
                ) : inventoryResults.map(item => {
                  const stock = Number(item.quantity_in_stock || 0)
                  const assignedTo = posLines.find(line => String(line.inventoryId) === String(item.id) && line.include)
                  const assignedRx = assignedTo ? reviewMap.get(assignedTo.rxId) : null

                  return (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '11px 12px', borderBottom: `1px solid ${C.border}`, alignItems: 'center' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>{item.drug_name}</div>
                        <div style={{ fontSize: '11px', color: C.sub, marginTop: '3px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {item.generic_name && <span>{item.generic_name}</span>}
                          {item.strength && <span>{item.strength}</span>}
                          <span>{stock} in stock</span>
                          <span>{formatKES(item.selling_price || 0)}</span>
                          {item.location && <span>{item.location}</span>}
                        </div>
                        {assignedRx && (
                          <div style={{ fontSize: '11px', color: C.blue, marginTop: '4px' }}>
                            Already assigned to {assignedRx.drug_name}
                          </div>
                        )}
                      </div>
                      <button
                        style={{ ...css.btn, ...(stock > 0 ? css.btnSoft : css.btnDanger), padding: '7px 11px' }}
                        disabled={!activeLine || stock <= 0}
                        onClick={() => assignInventory(item)}
                      >
                        {stock > 0 ? 'Use for Active Line' : 'Out of Stock'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
            <div style={{ ...css.card, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 800, color: C.text }}>Release Cart</div>
                <Badge color="purple" label={`${formatKES(total)} total`} />
              </div>
              {cartItems.length === 0 ? (
                <div style={{ padding: '26px 10px', textAlign: 'center', color: C.sub, fontSize: '12px' }}>
                  No drugs in the release cart yet. Select a prescription line, pick a stock item, then leave it marked for release.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {cartItems.map(item => (
                    <div key={item.rx.id} style={{ border: `1px solid ${C.border}`, borderRadius: '12px', padding: '11px 12px', background: '#FAFBFD' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 800, color: C.text }}>{item.inventoryItem.drug_name}</div>
                          <div style={{ fontSize: '11px', color: C.sub, marginTop: '4px' }}>
                            Prescribed as {item.rx.drug_name} · Qty {item.qty}
                          </div>
                        </div>
                        <button
                          style={{ ...css.btn, ...css.btnDanger, padding: '7px 10px' }}
                          onClick={() => updateLine(item.rx.id, { include: false })}
                        >
                          Remove
                        </button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '8px', fontSize: '12px' }}>
                        <span style={{ color: C.sub }}>{formatKES(item.unitPrice)} each</span>
                        <strong style={{ color: C.text }}>{formatKES(item.subtotal)}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ ...css.card, padding: '14px 16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: C.text, marginBottom: '10px' }}>Billing and Receipt</div>
              <div style={css.row2}>
                <div>
                  <label style={css.label}>Released By</label>
                  {pharmacyStaff?.length > 0 ? (
                    <select
                      style={{ ...css.input, cursor: 'pointer' }}
                      value={form.released_by}
                      onChange={e => setForm(prev => ({ ...prev, released_by: e.target.value }))}
                    >
                      <option value="">Select pharmacist</option>
                      {pharmacyStaff.map(member => (
                        <option key={member.id} value={member.full_name}>
                          {member.full_name} - {getStaffRoleLabel(member)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      style={css.input}
                      value={form.released_by}
                      onChange={e => setForm(prev => ({ ...prev, released_by: e.target.value }))}
                      placeholder="Pharmacist name"
                    />
                  )}
                </div>
                <div>
                  <label style={css.label}>Payment Method</label>
                  <select
                    style={{ ...css.input, cursor: 'pointer' }}
                    value={form.payment_method}
                    onChange={e => setForm(prev => ({ ...prev, payment_method: e.target.value }))}
                  >
                    {PAYMENT_OPTIONS.map(option => <option key={option}>{option}</option>)}
                  </select>
                </div>
              </div>

              {normalizePaymentMethod(form.payment_method) === 'M-Pesa' && (
                <div>
                  <label style={css.label}>M-Pesa Reference</label>
                  <input
                    style={css.input}
                    value={form.mpesa_ref}
                    onChange={e => setForm(prev => ({ ...prev, mpesa_ref: e.target.value.toUpperCase() }))}
                    placeholder="e.g. SGH123ABC"
                  />
                </div>
              )}

              <div>
                <label style={css.label}>Release Notes</label>
                <textarea
                  style={{ ...css.input, minHeight: '90px', resize: 'vertical' }}
                  value={form.notes}
                  onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Optional note for this pharmacy receipt or review handoff"
                />
              </div>

              <div style={{ background: '#F8FAFC', border: `1px solid ${C.border}`, borderRadius: '12px', padding: '12px 13px', fontSize: '12px', color: C.sub }}>
                Cash and M-Pesa close the pharmacy invoice immediately. SHA, Insurance, and Credit stay visible as unpaid pharmacy billing until follow-up happens in the other finance screens.
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '14px' }}>
          <div style={{ fontSize: '12px', color: C.sub }}>
            {reviewCount > 0
              ? `${reviewCount} line${reviewCount !== 1 ? 's' : ''} will return to pharmacist review after this release.`
              : 'All approved lines are in the cart and ready for release.'}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ ...css.btn, ...css.btnGhost }} onClick={onClose}>Cancel</button>
            <button
              style={{ ...css.btn, ...css.btnBlue }}
              disabled={saving || cartItems.length === 0}
              onClick={() => onConfirm({ ...form, lines: posLines })}
            >
              {saving ? 'Processing...' : `Release Cart and Create Receipt (${formatKES(total)})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReceiptModal({ invoice, hospitalName, onClose }) {
  if (!invoice) return null

  const items = parseServices(invoice.services)
  const workflowNote = parseWorkflowInvoiceNote(invoice.notes)
  const receiptNote = workflowNote?.summary || invoice.notes

  function handlePrint() {
    const rows = items.map(item => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${item.label || ''}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:center;">${item.qty || 0}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;">${formatKES(item.unit_price || 0)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${formatKES(item.total || 0)}</td>
      </tr>
    `).join('')

    const printWindow = window.open('', '_blank', 'width=900,height=800')
    if (!printWindow) return

    printWindow.document.write(`
      <html>
        <head>
          <title>${invoice.invoice_no}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            .muted { color: #6b7280; font-size: 12px; }
            .summary { margin-top: 18px; border-top: 2px solid #e5e7eb; padding-top: 12px; }
            .row { display: flex; justify-content: space-between; margin: 6px 0; }
          </style>
        </head>
        <body>
          <div style="text-align:center;margin-bottom:20px;">
            <div style="font-size:24px;font-weight:800;">${hospitalName || 'Hospital'}</div>
            <div class="muted">Pharmacy Receipt</div>
          </div>
          <div class="row"><strong>Invoice No</strong><span>${invoice.invoice_no || '-'}</span></div>
          <div class="row"><strong>Receipt No</strong><span>${invoice.receipt_number || '-'}</span></div>
          <div class="row"><strong>Patient</strong><span>${invoice.patient_name || '-'}</span></div>
          <div class="row"><strong>Date</strong><span>${invoice.created_at ? new Date(invoice.created_at).toLocaleString('en-KE') : '-'}</span></div>
          <table>
            <thead>
              <tr>
                <th style="text-align:left;padding-bottom:8px;">Drug</th>
                <th style="text-align:center;padding-bottom:8px;">Qty</th>
                <th style="text-align:right;padding-bottom:8px;">Unit Price</th>
                <th style="text-align:right;padding-bottom:8px;">Subtotal</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="summary">
            <div class="row"><span>Total</span><strong>${formatKES(invoice.amount_kes || 0)}</strong></div>
            <div class="row"><span>Paid</span><strong>${formatKES(invoice.paid_kes || 0)}</strong></div>
            <div class="row"><span>Balance</span><strong>${formatKES(invoice.balance_kes || 0)}</strong></div>
            <div class="row"><span>Payment</span><span>${invoice.payment_method || '-'}</span></div>
            <div class="row"><span>Status</span><span>${invoice.status || '-'}</span></div>
          </div>
          ${receiptNote ? `<div style="margin-top:12px;color:#6b7280;font-size:12px;">${receiptNote}</div>` : ''}
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  return (
    <div style={css.overlay}>
      <div style={{ ...css.modal, width: '760px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h3 style={css.modalTitle}>Pharmacy Receipt</h3>
            <div style={css.modalSub}>{hospitalName || 'Hospital'} - {invoice.patient_name}</div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ ...css.btn, ...css.btnGhost }} onClick={handlePrint}>Print</button>
            <button style={{ ...css.btn, ...css.btnGhost }} onClick={onClose}>Close</button>
          </div>
        </div>

        <div style={{ ...css.card, padding: '14px 16px', marginBottom: '16px', background: '#FAFBFD' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: '12px' }}>
            {[
              ['Invoice No', invoice.invoice_no || '-'],
              ['Receipt No', invoice.receipt_number || '-'],
              ['Payment', invoice.payment_method || '-'],
              ['Status', invoice.status || '-'],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: '10px', color: C.sub, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em' }}>{label}</div>
                <div style={{ fontSize: '13px', fontWeight: 800, marginTop: '4px' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        <table style={{ ...css.table, marginBottom: '16px' }}>
          <thead>
            <tr>
              <th style={css.th}>Drug</th>
              <th style={{ ...css.th, textAlign: 'center' }}>Qty</th>
              <th style={{ ...css.th, textAlign: 'right' }}>Unit Price</th>
              <th style={{ ...css.th, textAlign: 'right' }}>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.label}-${index}`}>
                <td style={css.td}><strong>{item.label}</strong></td>
                <td style={{ ...css.td, textAlign: 'center' }}>{item.qty}</td>
                <td style={{ ...css.td, textAlign: 'right' }}>{formatKES(item.unit_price || 0)}</td>
                <td style={{ ...css.td, textAlign: 'right', fontWeight: 800 }}>{formatKES(item.total || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ ...css.card, padding: '14px 16px' }}>
          {[
            ['Patient', invoice.patient_name || '-'],
            ['Visit', invoice.visit_id || releaseVisitLabel(invoice) || '-'],
            ['Created', invoice.created_at ? new Date(invoice.created_at).toLocaleString('en-KE') : '-'],
            ['Total Amount', formatKES(invoice.amount_kes || 0)],
            ['Amount Paid', formatKES(invoice.paid_kes || 0)],
            ['Balance', formatKES(invoice.balance_kes || 0)],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ color: C.sub, fontSize: '12px' }}>{label}</span>
              <span style={{ fontWeight: 700, fontSize: '13px' }}>{value}</span>
            </div>
          ))}
          {receiptNote && (
            <div style={{ marginTop: '12px', fontSize: '12px', color: C.sub }}>
              {receiptNote}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RxRow({ rx, meta, actionBusy, canApprovePrescription, canReleaseDrugs, onApprove, onReject, onRelease }) {
  const status = getRxStatus(rx)
  const statusMeta = {
    Pending: { color: 'yellow', label: 'Pending' },
    Approved: { color: 'blue', label: 'Approved' },
    Released: { color: 'green', label: 'Released' },
    Rejected: { color: 'red', label: 'Rejected' },
  }[status] || { color: 'gray', label: status }

  return (
    <div style={{ padding: '12px 14px', border: `1px solid ${C.border}`, borderRadius: '12px', background: '#FBFCFE' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <div style={{ fontSize: '14px', fontWeight: 800, marginBottom: '4px' }}>{rx.drug_name}</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '12px', color: C.sub }}>
            {rx.dosage && <span>{rx.dosage}</span>}
            {rx.frequency && <span>{rx.frequency}</span>}
            {rx.duration && <span>{rx.duration}</span>}
            <span>Qty {meta.quantity}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
            <Badge color={statusMeta.color} label={statusMeta.label} />
            <Badge color={meta.stockColor} label={meta.stockLabel} />
            <Badge color="purple" label={`${formatKES(meta.unitPrice)} each`} />
            <Badge color="gray" label={`Line total ${formatKES(meta.lineTotal)}`} />
          </div>
          {(rx.approved_by || rx.dispensed_by || rx.reject_reason) && (
            <div style={{ marginTop: '10px', fontSize: '11px', color: C.sub, lineHeight: 1.6 }}>
              {rx.approved_by && <div>Approved by {rx.approved_by}</div>}
              {rx.dispensed_by && <div>Released by {rx.dispensed_by}{rx.dispensed_at ? ` on ${new Date(rx.dispensed_at).toLocaleString('en-KE')}` : ''}</div>}
              {rx.reject_reason && <div style={{ color: C.danger }}>Reason: {rx.reject_reason}</div>}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {status === 'Pending' && (
            <>
              <button
                style={{ ...css.btn, ...css.btnSoft }}
                disabled={actionBusy || !canApprovePrescription}
                title={!canApprovePrescription ? 'Only pharmacists can approve prescriptions' : ''}
                onClick={() => onApprove([rx])}
              >
                {actionBusy ? 'Working...' : 'Approve'}
              </button>
              <button style={{ ...css.btn, ...css.btnDanger }} disabled={actionBusy} onClick={() => onReject(rx)}>
                Reject
              </button>
            </>
          )}

          {status === 'Approved' && (
            <>
              <button
                style={{ ...css.btn, ...css.btnBlue }}
                disabled={actionBusy || !canReleaseDrugs}
                title={!canReleaseDrugs ? 'Only pharmacists can release drugs' : ''}
                onClick={() => onRelease(rx)}
              >
                {actionBusy ? 'Working...' : 'Release'}
              </button>
              <button style={{ ...css.btn, ...css.btnDanger }} disabled={actionBusy} onClick={() => onReject(rx)}>
                Reject
              </button>
            </>
          )}

          {status === 'Rejected' && (
            <button
              style={{ ...css.btn, ...css.btnSoft }}
              disabled={actionBusy || !canApprovePrescription}
              title={!canApprovePrescription ? 'Only pharmacists can approve prescriptions' : ''}
              onClick={() => onApprove([rx])}
            >
              Re-approve
            </button>
          )}

          {status === 'Released' && (
            <Badge color="green" label="Receipt created" />
          )}
        </div>
      </div>
    </div>
  )
}

function releaseVisitLabel(invoice) {
  if (!invoice) return ''
  const workflowNote = parseWorkflowInvoiceNote(invoice.notes)
  return workflowNote?.visitId || invoice.notes?.match(/visit ([^|]+)/i)?.[1]?.trim() || ''
}

function PatientGroupCard({
  group,
  expanded,
  onToggle,
  getRxMeta,
  actionBusy,
  canApprovePrescription,
  canReleaseDrugs,
  onApprove,
  onReject,
  onRelease,
}) {
  const counts = { Pending: 0, Approved: 0, Released: 0, Rejected: 0 }
  let totalAmount = 0
  let approvedAmount = 0
  let releasedAmount = 0

  group.drugs.forEach(rx => {
    const status = getRxStatus(rx)
    const meta = getRxMeta(rx)
    counts[status] = (counts[status] || 0) + 1
    totalAmount += meta.lineTotal
    if (status === 'Approved') approvedAmount += meta.lineTotal
    if (status === 'Released') releasedAmount += meta.lineTotal
  })

  const pendingDrugs = group.drugs.filter(rx => getRxStatus(rx) === 'Pending')
  const approvedDrugs = group.drugs.filter(rx => getRxStatus(rx) === 'Approved')
  const needsReview = counts.Released > 0 && (counts.Pending > 0 || counts.Approved > 0 || counts.Rejected > 0)
  const latestDate = group.drugs.reduce((latest, rx) => {
    const time = new Date(rx.created_at || 0).getTime()
    return time > latest ? time : latest
  }, 0)

  return (
    <div style={{ ...css.card, overflow: 'hidden', borderLeft: `4px solid ${counts.Pending ? C.warn : counts.Approved ? C.blue : counts.Released ? C.success : C.danger}` }}>
      <div style={{ padding: '16px', cursor: 'pointer' }} onClick={onToggle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '260px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '16px', fontWeight: 800 }}>{group.patientName}</div>
              {group.allergies && <Badge color="red" label="Allergy noted" />}
              {group.visitStatus && <Badge color="gray" label={group.visitStatus} />}
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '12px', color: C.sub, marginTop: '6px' }}>
              {(group.age || group.gender) && <span>{group.age ? `${group.age}y` : ''} {group.gender || ''}</span>}
              {group.phone && <span>{group.phone}</span>}
              {group.bloodGroup && <span>Blood {group.bloodGroup}</span>}
              {group.visitNumber && <span>Visit {group.visitNumber}</span>}
              {group.visitType && <span>{group.visitType}</span>}
              {group.doctor && <span>Dr. {group.doctor}</span>}
              {group.speciality && <span>{group.speciality}</span>}
              {(group.ward || group.bedNo) && <span>{group.ward || 'Ward'}{group.bedNo ? ` / ${group.bedNo}` : ''}</span>}
              {latestDate > 0 && <span>{new Date(latestDate).toLocaleString('en-KE')}</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
              {counts.Pending > 0 && <Badge color="yellow" label={`${counts.Pending} pending`} />}
              {counts.Approved > 0 && <Badge color="blue" label={`${counts.Approved} approved`} />}
              {counts.Released > 0 && <Badge color="green" label={`${counts.Released} released`} />}
              {counts.Rejected > 0 && <Badge color="red" label={`${counts.Rejected} rejected`} />}
              {needsReview && <Badge color="red" label="Review needed" />}
            </div>
          </div>

          <div style={{ minWidth: '220px', textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: C.sub, textTransform: 'uppercase', fontWeight: 700 }}>Estimated Total</div>
            <div style={{ fontSize: '24px', fontWeight: 800, marginTop: '4px' }}>{formatKES(totalAmount)}</div>
            <div style={{ fontSize: '12px', color: C.sub, marginTop: '6px' }}>
              Ready now {formatKES(approvedAmount)} | Released {formatKES(releasedAmount)}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginTop: '16px' }}>
          <div style={{ fontSize: '12px', color: C.sub }}>
            {group.drugs.length} prescription line{group.drugs.length !== 1 ? 's' : ''}. Filters decide which cards appear, but each card keeps the full patient story.
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
            {pendingDrugs.length > 0 && (
              <button
                style={{ ...css.btn, ...css.btnSoft }}
                disabled={actionBusy || !canApprovePrescription}
                title={!canApprovePrescription ? 'Only pharmacists can approve prescriptions' : ''}
                onClick={() => onApprove(pendingDrugs)}
              >
                {actionBusy ? 'Working...' : `Approve all pending (${pendingDrugs.length})`}
              </button>
            )}
            {approvedDrugs.length > 0 && (
              <button
                style={{ ...css.btn, ...css.btnBlue }}
                disabled={actionBusy || !canReleaseDrugs}
                title={!canReleaseDrugs ? 'Only pharmacists can release drugs' : ''}
                onClick={() => onRelease(group, approvedDrugs)}
              >
                {actionBusy ? 'Working...' : `Release approved (${approvedDrugs.length})`}
              </button>
            )}
            <button style={{ ...css.btn, ...css.btnGhost }} onClick={onToggle}>
              {expanded ? 'Hide details' : 'Show details'}
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${C.border}`, background: '#FCFDFE' }}>
          <div style={{ marginTop: '14px' }}>
            <PatientWorkflowCard
              patientName={group.patientName}
              patient={{
                age: group.age,
                gender: group.gender,
                phone: group.phone,
                blood_group: group.bloodGroup,
                allergies: group.allergies,
                chronic_conditions: group.chronicConditions,
              }}
              visit={{
                visitNumber: group.visitNumber,
                visitType: group.visitType,
                doctor: group.doctor,
                speciality: group.speciality,
                chiefComplaint: group.chiefComplaint,
                ward: group.ward,
                bedNo: group.bedNo,
              }}
              latestVitals={group.latestVitals}
              badges={[
                ...(group.visitStatus ? [{ label: group.visitStatus, bg: '#F3F4F6', color: '#6B7280' }] : []),
                ...(group.allergies ? [{ label: 'Allergy noted', bg: C.dangerL, color: C.danger }] : []),
              ]}
              accentColor={counts.Pending ? C.warn : counts.Approved ? C.blue : counts.Released ? C.success : C.danger}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' }}>
            {group.drugs.map(rx => (
              <RxRow
                key={rx.id}
                rx={rx}
                meta={getRxMeta(rx)}
                actionBusy={actionBusy}
                canApprovePrescription={canApprovePrescription}
                canReleaseDrugs={canReleaseDrugs}
                onApprove={onApprove}
                onReject={onReject}
                onRelease={selectedRx => onRelease(group, [selectedRx])}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Pharmacy() {
  const { hospitalId, hospitalName, userRole } = useHospital()
  const { activeStaff, availableStaff } = useStaff()

  const [prescriptions, setPrescriptions] = useState([])
  const [inventory, setInventory] = useState([])
  const [microbiologyResults, setMicrobiologyResults] = useState([])
  const [stewardshipInterventions, setStewardshipInterventions] = useState([])
  const [stewardshipSchemaReady, setStewardshipSchemaReady] = useState(true)
  const [latestVitalsByVisit, setLatestVitalsByVisit] = useState({})
  const [loading, setLoading] = useState(true)
  const [rxSearch, setRxSearch] = useState('')
  const [rxFilter, setRxFilter] = useState('Pending')
  const [pharmacistName, setPharmacistName] = useState('')
  const [expandedGroups, setExpandedGroups] = useState({})
  const [actionBusy, setActionBusy] = useState(false)
  const [rejectModal, setRejectModal] = useState(null)
  const [releaseModal, setReleaseModal] = useState(null)
  const [receiptModal, setReceiptModal] = useState(null)
  const [stewardshipModal, setStewardshipModal] = useState(null)
  const [stewardshipSaving, setStewardshipSaving] = useState(false)

  const pharmacyStaff = useMemo(() => {
    const onDutyIds = new Set(availableStaff.filter(isPharmacyStaffMember).map(member => member.id))
    return activeStaff
      .filter(isPharmacyStaffMember)
      .sort((a, b) => {
        const availabilityDiff = Number(onDutyIds.has(b.id)) - Number(onDutyIds.has(a.id))
        if (availabilityDiff !== 0) return availabilityDiff
        return String(a.full_name || '').localeCompare(String(b.full_name || ''))
      })
  }, [activeStaff, availableStaff])
  const canApprovePrescription = canPerformAction(userRole, 'approve_prescription')
  const canReleaseDrugs = canPerformAction(userRole, 'release_drugs')

  useEffect(() => {
    if (pharmacyStaff.length === 0) {
      if (pharmacistName) setPharmacistName('')
      return
    }

    const stillExists = pharmacyStaff.some(member => member.full_name === pharmacistName)
    if (!stillExists) {
      setPharmacistName(pharmacyStaff[0].full_name || '')
    }
  }, [pharmacistName, pharmacyStaff])

  async function fetchData() {
    if (!hospitalId) {
      setPrescriptions([])
      setInventory([])
      setMicrobiologyResults([])
      setStewardshipInterventions([])
      setStewardshipSchemaReady(true)
      setLatestVitalsByVisit({})
      setLoading(false)
      return
    }

    setLoading(true)

    try {
      // Run core queries — wrap optional ones so they never crash the whole fetch
      const [rxResult, stockResult] = await Promise.all([
        supabase.from('prescriptions').select('*').eq('hospital_id', hospitalId).in('status', ['Pending', 'Approved', 'Released', 'Rejected']).order('created_at', { ascending: false }),
        supabase.from('pharmacy_inventory').select('id, drug_name, generic_name, category, dosage_form, strength, quantity_in_stock, reorder_level, selling_price, unit_cost, expiry_date, supplier, location').eq('hospital_id', hospitalId).order('drug_name'),
      ])

      if (rxResult.error) console.error('Pharmacy prescriptions load failed', rxResult.error)
      if (stockResult.error) console.error('Pharmacy inventory load failed', stockResult.error)

      // Microbiology — executeMicrobiologyQuery returns rows array directly, not {data,error}
      let microRows = []
      try {
        const microResult = await executeMicrobiologyQuery(select =>
          supabase.from('microbiology_results').select(select).eq('hospital_id', hospitalId).order('updated_at', { ascending: false }).limit(120),
        )
        microRows = Array.isArray(microResult) ? microResult : (microResult?.data || [])
      } catch (e) {
        console.warn('Pharmacy microbiology load failed', e)
      }

      // Stewardship interventions — table may not exist yet
      let interventionRows = []
      let stewardshipReady = true
      try {
        const interventionResult = await executeWithFallback(
          () => supabase.from('stewardship_interventions').select('*').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(240),
          async compatError => ({ data: [], error: null, compatFallback: true, compatError }),
        )
        if (interventionResult?.compatError) {
          console.warn('Stewardship table not available yet', interventionResult.compatError)
          stewardshipReady = false
        }
        if (interventionResult?.compatFallback) stewardshipReady = false
        interventionRows = interventionResult?.data || []
      } catch (e) {
        console.warn('Stewardship interventions load failed', e)
        stewardshipReady = false
      }

      const allRx = rxResult.data || []

      // Fetch patients and visits separately
      const patientIds = [...new Set(allRx.map(r => r.patient_id).filter(Boolean))]
      const visitIds = [...new Set(allRx.map(r => r.visit_id).filter(Boolean))]

      const [pRes, vRes] = await Promise.all([
        patientIds.length > 0
          ? supabase.from('patients').select('id,full_name,age,gender,phone,blood_group,allergies,chronic_conditions').in('id', patientIds)
          : Promise.resolve({ data: [] }),
        visitIds.length > 0
          ? supabase.from('visits').select('*').in('id', visitIds)
          : Promise.resolve({ data: [] }),
      ])

      const pMap = Object.fromEntries((pRes.data || []).map(p => [p.id, p]))
      const vMap = Object.fromEntries((vRes.data || []).map(v => [v.id, v]))

      const enrichedRx = allRx.map(rx => ({
        ...rx,
        patients: pMap[rx.patient_id] || null,
        visits: vMap[rx.visit_id] || null,
      }))

      // Fetch vitals by visit
      let vitalsByVisit = {}
      if (visitIds.length > 0) {
        try {
          const { data: vitalsRows, error: vitalsError } = await supabase
            .from('vitals')
            .select('id, visit_id, patient_id, bp_systolic, bp_diastolic, pulse_bpm, temperature_c, oxygen_sat, blood_sugar, respiratory_rate, recorded_by, recorded_at')
            .eq('hospital_id', hospitalId)
            .in('visit_id', visitIds)
            .order('recorded_at', { ascending: false })

          if (vitalsError) {
            console.error('Pharmacy vitals load failed', vitalsError)
          } else {
            vitalsByVisit = (vitalsRows || []).reduce((acc, row) => {
              if (!acc[row.visit_id]) acc[row.visit_id] = row
              return acc
            }, {})
          }
        } catch (e) {
          console.warn('Pharmacy vitals load error', e)
        }
      }

      // Filter: show prescriptions from pharmacy-relevant visits, plus all Released ones
      const filteredRx = enrichedRx.filter(row => {
        const rxStatus = getRxStatus(row)
        if (rxStatus === 'Released') return true
        const visitStatus = row.visits?.status
        // If visit status missing (no FK), show pending/approved anyway
        if (!visitStatus) return ['Pending', 'Approved'].includes(rxStatus)
        return PHARMACY_QUEUE_VISIT_STATUSES.includes(visitStatus)
      })

      setPrescriptions(filteredRx)
      setInventory(stockResult.data || [])
      setMicrobiologyResults(microRows)
      setStewardshipInterventions(interventionRows)
      setStewardshipSchemaReady(stewardshipReady)
      setLatestVitalsByVisit(vitalsByVisit)
    } catch (err) {
      console.error('Pharmacy fetchData crashed', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [hospitalId])

  useEffect(() => {
    if (!hospitalId) return undefined

    const timer = setInterval(fetchData, 30000)
    const localHandler = () => fetchData()
    const channel = supabase
      .channel(`pharmacy-screen-${hospitalId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prescriptions', filter: `hospital_id=eq.${hospitalId}` }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pharmacy_inventory', filter: `hospital_id=eq.${hospitalId}` }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'microbiology_results', filter: `hospital_id=eq.${hospitalId}` }, () => fetchData())
      .subscribe()

    window.addEventListener('remedacare:prescriptions_changed', localHandler)
    window.addEventListener('remedacare:antibiogram_updated', localHandler)
    window.addEventListener('remedacare:stewardship_changed', localHandler)

    return () => {
      clearInterval(timer)
      window.removeEventListener('remedacare:prescriptions_changed', localHandler)
      window.removeEventListener('remedacare:antibiogram_updated', localHandler)
      window.removeEventListener('remedacare:stewardship_changed', localHandler)
      supabase.removeChannel(channel)
    }
  }, [hospitalId])

  function findInventoryMatch(drugName) {
    const normalized = normalizeDrugText(drugName)
    if (!normalized) return null

    const exact = inventory.find(item => normalizeDrugText(item.drug_name) === normalized)
    if (exact) return exact

    return matchInventoryDrug(drugName, inventory)
  }

  function getRxMeta(rx) {
    const quantity = Math.max(1, Number(rx.quantity || 1))
    const stockItem = findInventoryMatch(rx.drug_name)
    const unitPrice = Number(stockItem?.selling_price || 0)
    const lineTotal = unitPrice * quantity
    const stockLeft = Number(stockItem?.quantity_in_stock || 0)
    let stockLabel = 'No stock match'
    let stockColor = 'red'

    if (stockItem) {
      if (stockLeft >= quantity) {
        stockLabel = `${stockLeft} in stock`
        stockColor = 'green'
      } else if (stockLeft > 0) {
        stockLabel = `Only ${stockLeft} left`
        stockColor = 'yellow'
      } else {
        stockLabel = 'Out of stock'
        stockColor = 'red'
      }
    }

    return {
      rx,
      stockItem,
      quantity,
      unitPrice,
      lineTotal,
      stockLeft,
      stockLabel,
      stockColor,
    }
  }

  const grouped = useMemo(() => {
    const map = new Map()
    prescriptions.forEach(rx => {
      const key = rx.visit_id || rx.patient_id || rx.id
      if (!map.has(key)) {
        map.set(key, {
          key,
          patientName: rx.patients?.full_name || rx.patient_name || 'Unknown patient',
          age: rx.patients?.age || null,
          gender: rx.patients?.gender || null,
          phone: rx.patients?.phone || null,
          bloodGroup: rx.patients?.blood_group || null,
          visitNumber: rx.visits?.visit_number || null,
          visitType: rx.visits?.visit_type || null,
          doctor: rx.visits?.assigned_doctor_name || rx.prescribed_by || null,
          speciality: rx.visits?.speciality || null,
          allergies: rx.patients?.allergies || null,
          chronicConditions: rx.patients?.chronic_conditions || null,
          chiefComplaint: rx.visits?.chief_complaint || null,
          ward: rx.visits?.ward || null,
          bedNo: rx.visits?.bed_no || null,
          visitStatus: rx.visits?.status || null,
          visitId: rx.visit_id || null,
          patientId: rx.patients?.id || rx.patient_id || null,
          latestVitals: latestVitalsByVisit[rx.visit_id] || null,
          drugs: [],
        })
      }
      const group = map.get(key)
      if (!group.latestVitals && latestVitalsByVisit[rx.visit_id]) group.latestVitals = latestVitalsByVisit[rx.visit_id]
      if (!group.phone && rx.patients?.phone) group.phone = rx.patients.phone
      if (!group.bloodGroup && rx.patients?.blood_group) group.bloodGroup = rx.patients.blood_group
      if (!group.chronicConditions && rx.patients?.chronic_conditions) group.chronicConditions = rx.patients.chronic_conditions
      group.drugs.push(rx)
    })

    return Array.from(map.values()).sort((a, b) => {
      const aLatest = Math.max(...a.drugs.map(rx => new Date(rx.created_at || 0).getTime()))
      const bLatest = Math.max(...b.drugs.map(rx => new Date(rx.created_at || 0).getTime()))
      return bLatest - aLatest
    })
  }, [latestVitalsByVisit, prescriptions])

  const filteredGroups = useMemo(() => {
    return grouped.filter(group => {
      const search = rxSearch.trim().toLowerCase()
      const statusMatch = rxFilter === 'All' || group.drugs.some(rx => getRxStatus(rx) === rxFilter)
      const searchMatch = !search ||
        group.patientName.toLowerCase().includes(search) ||
        String(group.visitNumber || '').toLowerCase().includes(search) ||
        String(group.doctor || '').toLowerCase().includes(search) ||
        group.drugs.some(rx => matchesDrugSearch(search, { drug_name: rx.drug_name }))

      return statusMatch && searchMatch
    })
  }, [grouped, rxFilter, rxSearch])

  const stewardshipAlerts = useMemo(() => {
    try {
      return buildAmrInterventions({ results: microbiologyResults, prescriptions, interventions: stewardshipInterventions, maxAgeDays: 21 })
    } catch (e) {
      console.warn('buildAmrInterventions error', e)
      return []
    }
  }, [microbiologyResults, prescriptions, stewardshipInterventions])

  const stewardshipSummary = useMemo(() => {
    try {
      return summarizeAmrInterventions(stewardshipAlerts)
    } catch (e) {
      console.warn('summarizeAmrInterventions error', e)
      return { pendingReview: 0, awaitingPrescriber: 0, highSeverity: 0, resistantOverlap: 0 }
    }
  }, [stewardshipAlerts])

  const statusCounts = useMemo(() => {
    const counts = { All: prescriptions.length, Pending: 0, Approved: 0, Released: 0, Rejected: 0 }
    prescriptions.forEach(rx => {
      const status = getRxStatus(rx)
      counts[status] = (counts[status] || 0) + 1
    })
    return counts
  }, [prescriptions])

  const summary = useMemo(() => {
    let totalValue = 0
    let pendingPatients = 0
    let readyValue = 0
    let releasedToday = 0
    const today = new Date().toISOString().split('T')[0]

    grouped.forEach(group => {
      let hasPending = false
      group.drugs.forEach(rx => {
        const meta = getRxMeta(rx)
        totalValue += meta.lineTotal
        if (getRxStatus(rx) === 'Pending') hasPending = true
        if (getRxStatus(rx) === 'Approved') readyValue += meta.lineTotal
        if ((rx.dispensed_at || '').startsWith(today)) releasedToday += 1
      })
      if (hasPending) pendingPatients += 1
    })

    return {
      patientCards: grouped.length,
      totalLines: prescriptions.length,
      totalValue,
      pendingPatients,
      readyValue,
      releasedToday,
    }
  }, [grouped, prescriptions])

  function openStewardshipModal(item) {
    setStewardshipModal({
      ...item,
      note: item.latestIntervention?.recommendation || item.currentAdvice || item.suggestedNote,
    })
  }

  async function handleSaveStewardshipAdvice() {
    if (!stewardshipModal?.id) return
    if (!pharmacistName.trim()) {
      window.notifyFromLegacyAlert('Select the pharmacist handling this queue before saving an AMR intervention note.')
      return
    }

    const note = String(stewardshipModal.note || '').trim()
    if (!note) {
      window.notifyFromLegacyAlert('Enter the stewardship advice to save.')
      return
    }

    setStewardshipSaving(true)
    const now = new Date().toISOString()
    const advisory = `Reviewed by ${pharmacistName.trim()} on ${new Date().toLocaleString('en-KE')}: ${note}`
    const latestIntervention = stewardshipModal.latestIntervention || null
    const canUpdateLatest = latestIntervention && ['pending_acknowledgement', 'acknowledged'].includes(String(latestIntervention.status || '').toLowerCase())
    const interventionPayload = {
      hospital_id: hospitalId,
      microbiology_result_id: stewardshipModal.id,
      patient_id: stewardshipModal.patientId || null,
      visit_id: stewardshipModal.visitId || null,
      pharmacist_name: pharmacistName.trim(),
      recommendation: note,
      status: latestIntervention?.status || 'pending_acknowledgement',
      prescriber_name: latestIntervention?.prescriber_name || null,
      acknowledged_at: latestIntervention?.acknowledged_at || null,
      prescriber_decision: latestIntervention?.prescriber_decision || 'Pending',
      prescriber_response: latestIntervention?.prescriber_response || null,
      action_taken: latestIntervention?.action_taken || null,
      outcome_status: latestIntervention?.outcome_status || 'Monitoring',
      outcome_notes: latestIntervention?.outcome_notes || null,
      updated_at: now,
    }

    const result = await executeWithFallback(
      () => {
        if (canUpdateLatest) {
          return supabase
            .from('stewardship_interventions')
            .update(interventionPayload)
            .eq('id', latestIntervention.id)
            .eq('hospital_id', hospitalId)
        }

        return supabase
          .from('stewardship_interventions')
          .insert({
            ...interventionPayload,
            status: 'pending_acknowledgement',
            prescriber_decision: 'Pending',
            created_at: now,
          })
      },
      async compatError => {
        const fallbackResult = await supabase
          .from('microbiology_results')
          .update({ ai_suggestion: advisory, updated_at: now })
          .eq('id', stewardshipModal.id)
          .eq('hospital_id', hospitalId)

        return { ...fallbackResult, compatFallback: true, compatError }
      },
    )

    setStewardshipSaving(false)

    if (result.error) {
      window.notifyFromLegacyAlert(`Could not save stewardship advice: ${result.error.message}`)
      return
    }

    if (result.compatFallback) {
      setStewardshipSchemaReady(false)
      window.notifyFromLegacyAlert('The new stewardship table is not available yet, so the note was saved in the legacy microbiology field. Run next_upgrade_relations_and_stewardship.sql to enable prescriber acknowledgement tracking.')
    }

    broadcastAntibiogramUpdated({ id: stewardshipModal.id })
    broadcastStewardshipChanged({ microbiology_result_id: stewardshipModal.id, patient_id: stewardshipModal.patientId || null, visit_id: stewardshipModal.visitId || null })

    setStewardshipModal(null)
    fetchData()
  }

  function validateApprovalItems(rxList) {
    const eligible = []
    const blocked = []

    rxList.forEach(rx => {
      const meta = getRxMeta(rx)
      if (!meta.stockItem) {
        blocked.push(`${rx.drug_name}: no matching inventory item`)
        return
      }
      if (meta.stockLeft < meta.quantity) {
        blocked.push(`${rx.drug_name}: need ${meta.quantity}, only ${meta.stockLeft} available`)
        return
      }
      eligible.push(rx)
    })

    return { eligible, blocked }
  }

  async function handleApprove(rxList) {
    if (!rxList?.length) return
    if (!canApprovePrescription) {
      window.notifyFromLegacyAlert('Only pharmacists can approve prescriptions.')
      return
    }
    if (!pharmacistName.trim()) {
      window.notifyFromLegacyAlert('Select the pharmacist handling this queue before approving.')
      return
    }

    const { eligible, blocked } = validateApprovalItems(rxList)
    if (eligible.length === 0) {
      window.notifyFromLegacyAlert(`Approval blocked:\n\n${blocked.join('\n')}`)
      return
    }
    if (blocked.length > 0) {
      window.notifyFromLegacyAlert(`Some lines stayed pending because inventory could not support approval yet:\n\n${blocked.join('\n')}`)
    }

    setActionBusy(true)
    const ids = eligible.map(rx => rx.id)
    const { error } = await supabase
      .from('prescriptions')
      .update({
        status: 'Approved',
        approved_by: pharmacistName.trim(),
        reject_reason: null,
        dispensed_by: null,
        dispensed_at: null,
      })
      .in('id', ids)
      .eq('hospital_id', hospitalId)

    setActionBusy(false)

    if (error) {
      window.notifyFromLegacyAlert(`Could not approve prescription(s): ${error.message}`)
      return
    }

    broadcastPrescriptionsChanged({ ids, source: 'pharmacy-approve' })
    broadcastWorkflowChanged({ source: 'pharmacy-approve', ids, pharmacist_name: pharmacistName.trim() })
    fetchData()

    // Update visit status to Pharmacy
    try {
      const visitRows = [...new Map(
        eligible
          .filter(rx => rx.visit_id)
          .map(rx => [rx.visit_id, rx.visits?.status || null]),
      ).entries()]

      for (const [visitId, currentStatus] of visitRows) {
        await supabase
          .from('visits')
          .update({ status: nextVisitStatusAfterPharmacyAction(currentStatus) })
          .eq('id', visitId)
          .eq('hospital_id', hospitalId)
      }
    } catch (e) {
      console.error('Error updating visit status:', e)
    }
  }

  async function handleReject(reason) {
    if (!rejectModal?.rx) return
    if (!reason.trim()) {
      window.notifyFromLegacyAlert('Please enter a rejection reason.')
      return
    }

    setActionBusy(true)
    const { error } = await supabase
      .from('prescriptions')
      .update({
        status: 'Rejected',
        approved_by: null,
        reject_reason: reason.trim(),
        dispensed_by: null,
        dispensed_at: null,
      })
      .eq('id', rejectModal.rx.id)
      .eq('hospital_id', hospitalId)

    setActionBusy(false)

    if (error) {
      window.notifyFromLegacyAlert(`Could not reject the prescription: ${error.message}`)
      return
    }

    setRejectModal(null)
    broadcastPrescriptionsChanged({ id: rejectModal.rx.id, source: 'pharmacy-reject' })
    broadcastWorkflowChanged({ source: 'pharmacy-reject', id: rejectModal.rx.id })
    fetchData()
  }

  function openReleaseModal(group, items) {
    if (!items?.length) return
    setReleaseModal({ group, items })
  }

  function validateReleaseItems(items) {
    const stockByInventoryId = new Map()
    const problems = []

    items.forEach(item => {
      if (!item?.inventoryItem) {
        problems.push(`${item?.rx?.drug_name || 'Drug'}: not found in pharmacy inventory`)
        return
      }
      const quantity = Math.max(1, Number(item.quantity || item.rx?.quantity || 1))
      const unitPrice = Number(item.inventoryItem.selling_price || 0)
      if (unitPrice <= 0) {
        problems.push(`${item.inventoryItem.drug_name || item.rx?.drug_name}: missing selling price`)
      }

      const current = stockByInventoryId.get(item.inventoryItem.id) || {
        drugName: item.inventoryItem.drug_name,
        quantityNeeded: 0,
        stockLeft: Number(item.inventoryItem.quantity_in_stock || 0),
        item: item.inventoryItem,
      }
      current.quantityNeeded += quantity
      stockByInventoryId.set(item.inventoryItem.id, current)
    })

    stockByInventoryId.forEach(item => {
      if (item.stockLeft < item.quantityNeeded) {
        problems.push(`${item.drugName}: need ${item.quantityNeeded}, only ${item.stockLeft} in stock`)
      }
    })

    return {
      problems,
      stockByInventoryId,
    }
  }

  async function handleRelease(form) {
    if (!releaseModal?.items?.length) return
    if (!canReleaseDrugs) {
      window.notifyFromLegacyAlert('Only pharmacists can release drugs.')
      return
    }
    if (!form.released_by.trim()) {
      window.notifyFromLegacyAlert('Select the pharmacist handling the release.')
      return
    }

    const paymentMethod = normalizePaymentMethod(form.payment_method)
    if (paymentMethod === 'M-Pesa' && !form.mpesa_ref.trim()) {
      window.notifyFromLegacyAlert('Enter the M-Pesa reference before releasing.')
      return
    }

    const reviewItems = releaseModal.group?.drugs?.length
      ? releaseModal.group.drugs.filter(rx => getRxStatus(rx) === 'Approved')
      : releaseModal.items

    const lineSelections = Array.isArray(form.lines) ? form.lines : []
    const selectionMap = new Map(lineSelections.map(line => [line.rxId, line]))
    const unresolvedSelections = reviewItems
      .filter(rx => selectionMap.get(rx.id)?.include && !selectionMap.get(rx.id)?.inventoryId)
      .map(rx => rx.drug_name)

    if (unresolvedSelections.length > 0) {
      window.notifyFromLegacyAlert(`Some selected lines do not have a POS stock match yet:\n\n${unresolvedSelections.join('\n')}`)
      return
    }

    const selectedItems = reviewItems
      .map(rx => {
        const line = selectionMap.get(rx.id)
        if (!line?.include) return null
        const inventoryItem = inventory.find(item => String(item.id) === String(line.inventoryId))
        return {
          rx,
          inventoryItem,
          quantity: Math.max(1, Number(rx.quantity || line.requestedQty || 1)),
        }
      })
      .filter(Boolean)

    if (selectedItems.length === 0) {
      window.notifyFromLegacyAlert('Add at least one approved drug to the POS cart before releasing.')
      return
    }

    const missingInventory = selectedItems.filter(item => !item.inventoryItem).map(item => item.rx.drug_name)
    if (missingInventory.length > 0) {
      window.notifyFromLegacyAlert(`These cart lines lost their inventory match and need to be selected again:\n\n${missingInventory.join('\n')}`)
      return
    }

    const { problems, stockByInventoryId } = validateReleaseItems(selectedItems)
    if (problems.length > 0) {
      window.notifyFromLegacyAlert(`Release blocked:\n\n${problems.join('\n')}`)
      return
    }

    const soldAt = new Date().toISOString()
    const ids = selectedItems.map(item => item.rx.id)
    const reviewResetIds = reviewItems.filter(rx => !ids.includes(rx.id)).map(rx => rx.id)
    const patientName = releaseModal.group?.patientName || selectedItems[0]?.rx?.patients?.full_name || selectedItems[0]?.rx?.patient_name || 'Patient'
    const patientId = releaseModal.group?.patientId || selectedItems[0]?.rx?.patient_id || null
    const visitId = releaseModal.group?.visitId || selectedItems[0]?.rx?.visit_id || null
    const receiptNumber = `RX-${Date.now().toString().slice(-8)}`
    const invoiceNo = `INV-${Date.now().toString().slice(-6)}`
    const items = selectedItems.map(item => {
      const unitPrice = Number(item.inventoryItem.selling_price || 0)
      const total = unitPrice * item.quantity
      return createServiceLine({
        label: item.inventoryItem.drug_name || item.rx.drug_name,
        qty: item.quantity,
        unitPrice,
        total,
        source: SERVICE_SOURCES.PHARMACY,
        sourceId: item.rx.id,
        visitId,
        meta: {
          dosage: item.rx.dosage || null,
          frequency: item.rx.frequency || null,
          prescription_id: item.rx.id,
          prescribed_drug: item.rx.drug_name,
          dispensed_drug: item.inventoryItem.drug_name || item.rx.drug_name,
        },
      })
    })
    const amount = items.reduce((sum, item) => sum + Number(item.total || 0), 0)
    const isInsurance = isInsurancePaymentMethod(paymentMethod)
    const isCredit = isCreditPaymentMethod(paymentMethod)
    const paidAmount = NON_INSURANCE.includes(paymentMethod) ? amount : 0
    const balanceAmount = NON_INSURANCE.includes(paymentMethod) ? 0 : amount
    const invoiceStatus = NON_INSURANCE.includes(paymentMethod) ? 'Paid' : 'Pending'
    const insurer = paymentMethod === 'SHA' ? 'SHA' : (isInsurance ? paymentMethod : null)
    const receiptSummary = [
      form.notes.trim(),
      reviewResetIds.length > 0 ? `${reviewResetIds.length} line(s) returned for pharmacist review after partial dispensing` : null,
    ].filter(Boolean).join(' | ') || `Pharmacy receipt: ${receiptNumber}`

    setActionBusy(true)

    for (const [, stock] of stockByInventoryId) {
      const newQty = Math.max(0, stock.stockLeft - stock.quantityNeeded)
      const { error } = await supabase
        .from('pharmacy_inventory')
        .update({ quantity_in_stock: newQty })
        .eq('id', stock.item.id)
        .eq('hospital_id', hospitalId)

      if (error) {
        setActionBusy(false)
        window.notifyFromLegacyAlert(`Stock update failed for ${stock.item.drug_name}: ${error.message}`)
        return
      }
    }

    const { error: rxError } = await supabase
      .from('prescriptions')
      .update({
        status: 'Released',
        dispensed_by: form.released_by.trim(),
        dispensed_at: soldAt,
        reject_reason: null,
      })
      .in('id', ids)
      .eq('hospital_id', hospitalId)

    if (rxError) {
      setActionBusy(false)
      window.notifyFromLegacyAlert(`Prescription release failed: ${rxError.message}`)
      return
    }

    if (reviewResetIds.length > 0) {
      const { error: reviewResetError } = await supabase
        .from('prescriptions')
        .update({
          status: 'Pending',
          approved_by: null,
          dispensed_by: null,
          dispensed_at: null,
          reject_reason: null,
        })
        .in('id', reviewResetIds)
        .eq('hospital_id', hospitalId)

      if (reviewResetError) {
        console.warn('Could not return unreleased items to review', reviewResetError)
      }
    }

    const ledgerRows = items.map(item => ({
      hospital_id: hospitalId,
      patient_id: patientId,
      visit_id: visitId || null,
      customer_name: patientName,
      receipt_number: receiptNumber,
      drug_name: item.label,
      qty_sold: item.qty,
      total_kes: item.total,
      payment_method: paymentMethod,
      mpesa_ref: form.mpesa_ref.trim() || null,
      served_by: form.released_by.trim(),
      notes: receiptSummary,
      prescription_id: item.prescription_id || item.source_id,
      sold_at: soldAt,
    }))

    const { error: ledgerError } = await executeWithFallback(
      () => supabase.from('sales_ledger').insert(ledgerRows),
      async () => supabase.from('sales_ledger').insert(ledgerRows.map(row => omitKeys(row, ['visit_id']))),
    )

    if (ledgerError) {
      setActionBusy(false)
      window.notifyFromLegacyAlert(`Sales ledger save failed: ${ledgerError.message}`)
      return
    }

    const invoicePayload = {
      hospital_id: hospitalId,
      patient_id: patientId,
      visit_id: visitId,
      patient_name: patientName,
      invoice_no: invoiceNo,
      services: stringifyServiceLines(items),
      amount_kes: amount,
      paid_kes: paidAmount,
      balance_kes: balanceAmount,
      payment_method: paymentMethod,
      insurer,
      sha_member_no: null,
      status: invoiceStatus,
      notes: buildWorkflowInvoiceNote({
        source: SERVICE_SOURCES.PHARMACY,
        sourceId: receiptNumber,
        visitId,
        summary: receiptSummary,
      }),
      paid_at: invoiceStatus === 'Paid' ? soldAt : null,
      created_at: soldAt,
    }

    const { data: createdInvoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert(invoicePayload)
      .select('*')
      .single()

    setActionBusy(false)

    if (invoiceError) {
      window.notifyFromLegacyAlert(`Invoice creation failed: ${invoiceError.message}`)
      return
    }

    if (isCredit) {
      const creditPayload = {
        hospital_id: hospitalId,
        patient_id: patientId,
        visit_id: visitId,
        type: 'Debt',
        category: 'Pharmacy',
        description: `Pharmacy receipt ${receiptNumber}`,
        amount_charged: amount,
        amount_paid: 0,
        balance: amount,
        status: 'Pending',
        payment_method: CREDIT_METHOD,
        notes: receiptSummary,
        created_by: form.released_by.trim(),
      }

      const { error: creditError } = await supabase.from('credit_debts').insert(creditPayload)
      if (creditError) {
        console.warn('Credit ledger insert failed', creditError)
        window.notifyFromLegacyAlert(`Receipt created, but automatic credit ledger posting failed: ${creditError.message}`)
      }
    }

    await logAudit(supabase, {
      hospitalId,
      userRole,
      action: 'drug_released',
      targetTable: 'prescriptions',
      targetId: releaseModal?.group?.key,
      details: {
        pharmacist: pharmacistName,
        patient: releaseModal?.group?.patientName,
      },
    })

    setReleaseModal(null)
    setReceiptModal({
      ...(createdInvoice || invoicePayload),
      receipt_number: receiptNumber,
    })

    broadcastPrescriptionsChanged({ ids, source: 'pharmacy-release' })
    broadcastWorkflowChanged({
      source: 'pharmacy-release',
      ids,
      receipt_number: receiptNumber,
      invoice_no: invoiceNo,
      payment_method: paymentMethod,
      review_reset_ids: reviewResetIds,
    })

    fetchData()

    // Keep inpatient/admission visits in their workflow; outpatient visits move into Pharmacy stage.
    try {
      const visitRows = [...new Map(
        selectedItems
          .filter(item => item.rx.visit_id)
          .map(item => [item.rx.visit_id, item.rx.visits?.status || null]),
      ).entries()]

      for (const [currentVisitId, currentStatus] of visitRows) {
        await supabase
          .from('visits')
          .update({ status: nextVisitStatusAfterPharmacyAction(currentStatus) })
          .eq('id', currentVisitId)
          .eq('hospital_id', hospitalId)
      }
    } catch (e) {
      console.error('Error updating visit status:', e)
    }
  }

  function toggleGroup(groupKey) {
    setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }))
  }

  return (
    <div style={css.page}>
      <div style={css.wrap}>
        <PharmacyStockPanel
          summary={summary}
          statusCounts={statusCounts}
          pharmacistName={pharmacistName}
          setPharmacistName={setPharmacistName}
          pharmacyStaff={pharmacyStaff}
          stewardshipAlerts={stewardshipAlerts}
          stewardshipSummary={stewardshipSummary}
          inventory={inventory}
          loading={loading}
          fetchData={fetchData}
          openStewardshipModal={openStewardshipModal}
          C={C}
          css={css}
          StatCard={StatCard}
          Badge={Badge}
          formatKES={formatKES}
          getStaffRoleLabel={getStaffRoleLabel}
        />

        <PharmacyDispenseQueue
          rxSearch={rxSearch}
          setRxSearch={setRxSearch}
          rxFilter={rxFilter}
          setRxFilter={setRxFilter}
          filteredGroups={filteredGroups}
          statusCounts={statusCounts}
          loading={loading}
          expandedGroups={expandedGroups}
          toggleGroup={toggleGroup}
          getRxMeta={getRxMeta}
          actionBusy={actionBusy}
          canApprovePrescription={canApprovePrescription}
          canReleaseDrugs={canReleaseDrugs}
          handleApprove={handleApprove}
          setRejectModal={setRejectModal}
          openReleaseModal={openReleaseModal}
          FILTERS={FILTERS}
          C={C}
          css={css}
          EmptyState={EmptyState}
          PatientGroupCard={PatientGroupCard}
          Badge={Badge}
        />

      <PharmacyPOS
        rejectModal={rejectModal}
        setRejectModal={setRejectModal}
        releaseModal={releaseModal}
        setReleaseModal={setReleaseModal}
        receiptModal={receiptModal}
        setReceiptModal={setReceiptModal}
        stewardshipModal={stewardshipModal}
        setStewardshipModal={setStewardshipModal}
        stewardshipSaving={stewardshipSaving}
        handleRelease={handleRelease}
        handleReject={handleReject}
        handleSaveStewardshipAdvice={handleSaveStewardshipAdvice}
        getRxMeta={getRxMeta}
        hospitalName={hospitalName}
        pharmacistName={pharmacistName}
        pharmacyStaff={pharmacyStaff}
        inventory={inventory}
        actionBusy={actionBusy}
        canReleaseDrugs={canReleaseDrugs}
        C={C}
        css={css}
        Badge={Badge}
        formatKES={formatKES}
        getStaffRoleLabel={getStaffRoleLabel}
      />
    </div>
  </div>
  )
}
