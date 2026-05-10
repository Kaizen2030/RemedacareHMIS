import { useEffect, useMemo, useState } from 'react'
import { matchesDrugSearch } from '../../utils/pharmacy'
import { parseWorkflowInvoiceNote } from '../../utils/workflowBilling'

function parseServices(services) {
  try {
    const parsed = JSON.parse(services || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

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

function normalizePaymentMethod(method) {
  const normalized = String(method || '').trim()
  if (!normalized) return 'Cash'
  if (normalized === 'SHA (Social Health Authority)') return 'SHA'
  return normalized
}

function getRxStatus(rx) {
  if (rx.status) return rx.status
  if (rx.dispensed_by || rx.dispensed_at) return 'Released'
  return 'Pending'
}

function releaseVisitLabel(invoice) {
  if (!invoice) return ''
  const workflowNote = parseWorkflowInvoiceNote(invoice.notes)
  return workflowNote?.visitId || invoice.notes?.match(/visit ([^|]+)/i)?.[1]?.trim() || ''
}

function RejectModal({ state, onClose, onConfirm, saving, css }) {
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

function ReleaseModal({ state, getRxMeta, hospitalName, pharmacistName, pharmacyStaff, inventory, onClose, onConfirm, saving, canReleaseDrugs, css, C, Badge, formatKES, getStaffRoleLabel }) {
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
  }, [state, pharmacistName, reviewItems, getRxMeta])

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
              disabled={saving || cartItems.length === 0 || !canReleaseDrugs}
              title={!canReleaseDrugs ? 'Only pharmacists can release drugs' : ''}
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

function ReceiptModal({ invoice, hospitalName, onClose, css, C, formatKES }) {
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
            ['Created', invoice.created_at ? new Date(invoice.created_at).toLocaleDateString('en-KE') : '-'],
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

export default function PharmacyPOS({
  rejectModal,
  setRejectModal,
  releaseModal,
  setReleaseModal,
  receiptModal,
  setReceiptModal,
  stewardshipModal,
  setStewardshipModal,
  stewardshipSaving,
  handleRelease,
  handleReject,
  handleSaveStewardshipAdvice,
  getRxMeta,
  hospitalName,
  pharmacistName,
  pharmacyStaff,
  inventory,
  actionBusy,
  canReleaseDrugs,
  C,
  css,
  Badge,
  formatKES,
  getStaffRoleLabel,
}) {
  return (
    <div>
      <RejectModal
        state={rejectModal}
        saving={actionBusy}
        onClose={() => !actionBusy && setRejectModal(null)}
        onConfirm={handleReject}
        css={css}
      />

      <ReleaseModal
        state={releaseModal}
        getRxMeta={getRxMeta}
        hospitalName={hospitalName}
        pharmacistName={pharmacistName}
        pharmacyStaff={pharmacyStaff}
        inventory={inventory}
        saving={actionBusy}
        canReleaseDrugs={canReleaseDrugs}
        onClose={() => !actionBusy && setReleaseModal(null)}
        onConfirm={handleRelease}
        css={css}
        C={C}
        Badge={Badge}
        formatKES={formatKES}
        getStaffRoleLabel={getStaffRoleLabel}
      />

      <ReceiptModal
        invoice={receiptModal}
        hospitalName={hospitalName}
        onClose={() => setReceiptModal(null)}
        css={css}
        C={C}
        formatKES={formatKES}
      />

      {stewardshipModal && (
        <div style={css.overlay}>
          <div style={{ ...css.modal, width: '760px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <h3 style={css.modalTitle}>AMR Stewardship Intervention</h3>
                <div style={css.modalSub}>
                  {stewardshipModal.patientName} - {stewardshipModal.organism}
                  {stewardshipModal.sampleType ? ` - ${stewardshipModal.sampleType}` : ''}
                </div>
              </div>
              <button style={{ ...css.btn, ...css.btnGhost, padding: '7px 12px' }} onClick={() => !stewardshipSaving && setStewardshipModal(null)}>Close</button>
            </div>

            <div style={{ ...css.card, padding: '14px 16px', marginBottom: '14px', background: '#FAFBFD' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: '10px' }}>
                {[
                  ['Patient', stewardshipModal.patientName],
                  ['Organism', stewardshipModal.organism],
                  ['Department', stewardshipModal.department || 'Not captured'],
                  ['Reported', stewardshipModal.reportedAt ? new Date(stewardshipModal.reportedAt).toLocaleDateString('en-KE') : 'Not captured'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div style={{ fontSize: '10px', color: C.sub, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em' }}>{label}</div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: C.text, marginTop: '4px' }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: '14px' }}>
              <div>
                <div style={{ ...css.card, padding: '14px 16px', marginBottom: '12px' }}>
                  <div style={{ fontSize: '11px', color: C.sub, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em', marginBottom: '8px' }}>Current therapy check</div>
                  <div style={{ fontSize: '12px', color: C.sub, lineHeight: 1.6 }}>
                    {stewardshipModal.activePrescriptionMatches.length > 0
                      ? stewardshipModal.activePrescriptionMatches.map(match => `${match.drugName} (${match.classification})`).join(', ')
                      : 'No active prescription linked to this patient right now.'}
                  </div>
                  {stewardshipModal.resistantMatches.length > 0 && (
                    <div style={{ fontSize: '12px', color: C.danger, fontWeight: 700, marginTop: '10px' }}>
                      Resistant overlap: {stewardshipModal.resistantMatches.map(match => match.drugName).join(', ')}
                    </div>
                  )}
                </div>

                <div style={{ ...css.card, padding: '14px 16px' }}>
                  <div style={{ fontSize: '11px', color: C.sub, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em', marginBottom: '8px' }}>Suggested pharmacist note</div>
                  <div style={{ fontSize: '12px', color: C.text, lineHeight: 1.6 }}>{stewardshipModal.suggestedNote}</div>
                </div>
              </div>

              <div>
                <div style={{ ...css.card, padding: '14px 16px', marginBottom: '12px' }}>
                  <div style={{ fontSize: '11px', color: C.sub, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em', marginBottom: '8px' }}>Resistance profile</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    {[
                      { label: `S ${stewardshipModal.sensitiveAgents.length}`, bg: C.primaryL, color: C.primary },
                      { label: `I ${stewardshipModal.intermediateAgents.length}`, bg: C.warnL, color: C.warn },
                      { label: `R ${stewardshipModal.resistantAgents.length}`, bg: C.dangerL, color: C.danger },
                      { label: `NT ${stewardshipModal.notTestedAgents.length}`, bg: '#F3F4F6', color: C.sub },
                    ].map(item => (
                      <span key={item.label} style={{ background: item.bg, color: item.color, borderRadius: '999px', padding: '3px 9px', fontSize: '11px', fontWeight: 700 }}>
                        {item.label}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {stewardshipModal.highRiskFlags.map(flag => (
                      <span key={flag} style={{ background: C.dangerL, color: C.danger, borderRadius: '999px', padding: '3px 9px', fontSize: '11px', fontWeight: 700 }}>
                        {flag}
                      </span>
                    ))}
                    {stewardshipModal.highRiskFlags.length === 0 && (
                      <span style={{ background: '#F3F4F6', color: C.sub, borderRadius: '999px', padding: '3px 9px', fontSize: '11px', fontWeight: 700 }}>
                        No high-risk marker
                      </span>
                    )}
                  </div>
                  {stewardshipModal.sensitiveAgents.length > 0 && (
                    <div style={{ fontSize: '12px', color: C.text, marginTop: '10px', lineHeight: 1.6 }}>
                      Sensitive: {stewardshipModal.sensitiveAgents.slice(0, 6).join(', ')}
                    </div>
                  )}
                  {stewardshipModal.resistantAgents.length > 0 && (
                    <div style={{ fontSize: '12px', color: C.danger, marginTop: '10px', lineHeight: 1.6 }}>
                      Resistant: {stewardshipModal.resistantAgents.slice(0, 6).join(', ')}
                    </div>
                  )}
                </div>

                <div style={{ ...css.card, padding: '14px 16px', marginBottom: '12px', maxHeight: '220px', overflowY: 'auto' }}>
                  <div style={{ fontSize: '11px', color: C.sub, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '.05em', marginBottom: '8px' }}>Full culture susceptibility matrix</div>
                  {stewardshipModal.susceptibilityEntries.length === 0 ? (
                    <div style={{ fontSize: '12px', color: C.sub }}>No antibiotic S/I/R rows were captured on this result.</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
                      {stewardshipModal.susceptibilityEntries.map(entry => {
                        const palette = entry.sir === 'S'
                          ? { bg: C.primaryL, color: C.primary }
                          : entry.sir === 'I'
                            ? { bg: C.warnL, color: C.warn }
                            : entry.sir === 'R'
                              ? { bg: C.dangerL, color: C.danger }
                              : { bg: '#F3F4F6', color: C.sub }

                        return (
                          <div key={entry.key} style={{ border: `1px solid ${C.border}`, borderRadius: '10px', padding: '9px 10px', background: '#fff' }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: C.text }}>{entry.label}</div>
                            <span style={{ display: 'inline-block', marginTop: '6px', background: palette.bg, color: palette.color, borderRadius: '999px', padding: '3px 9px', fontSize: '11px', fontWeight: 700 }}>
                              {entry.sir}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <label style={css.label}>Pharmacy stewardship recommendation</label>
                <textarea
                  style={{ ...css.input, minHeight: '170px', resize: 'vertical' }}
                  value={stewardshipModal.note}
                  onChange={e => setStewardshipModal(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="Document the pharmacist recommendation for this microbiology result"
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '12px', color: C.sub }}>
                Saving here sends the pharmacist recommendation into the stewardship workflow so consultation can acknowledge, accept, reject, or action it inside the app.
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  style={{ ...css.btn, ...css.btnGhost }}
                  onClick={async () => {
                    const text = stewardshipModal.note || stewardshipModal.suggestedNote
                    if (!text) return
                    try {
                      await navigator.clipboard.writeText(text)
                    } catch (_) {}
                  }}
                >
                  Copy Note
                </button>
                <button style={{ ...css.btn, ...css.btnBlue }} disabled={stewardshipSaving} onClick={handleSaveStewardshipAdvice}>
                  {stewardshipSaving ? 'Saving...' : 'Save Intervention'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
