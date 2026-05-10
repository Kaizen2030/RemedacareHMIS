import { useEffect, useMemo, useState } from 'react'
import { canPerformAction } from '../access'
import SkeletonLoader from '../components/SkeletonLoader'
import supabase from '../supabase'
import { useHospital } from '../context'
import useStaff from '../hooks/useStaff'
import PatientWorkflowCard from '../components/PatientWorkflowCard'
import { buildWorkflowInvoiceNote, createServiceLine, inferInvoiceSource, SERVICE_SOURCES, stringifyServiceLines } from '../utils/workflowBilling'
import { colors as C, typography } from '../theme'

const css = {
  page: { minHeight: '100vh', background: C.bg, fontFamily: typography.fontFamily, fontSize: '13px', color: C.text },
  wrap: { padding: '20px 24px', maxWidth: '1500px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px', gap: '10px', flexWrap: 'wrap' },
  h1: { fontSize: '18px', fontWeight: 700, margin: 0 },
  subtext: { fontSize: '12px', color: C.sub, marginBottom: '18px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px', marginBottom: '20px' },
  stat: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '16px' },
  statLbl: { fontSize: '11px', color: C.sub, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '4px' },
  statVal: { fontSize: '24px', fontWeight: 800, letterSpacing: '-0.5px' },
  statSub: { fontSize: '11px', marginTop: '3px' },
  workflowGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '12px', marginBottom: '18px' },
  workflowCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '15px' },
  toolbar: { display: 'flex', gap: '10px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' },
  searchWrap: { position: 'relative', flex: 1 },
  searchInput: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: '7px', fontSize: '13px', outline: 'none', background: C.surface },
  select: { padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: '7px', fontSize: '13px', background: C.surface, color: C.text, cursor: 'pointer', outline: 'none' },
  btn: { padding: '8px 16px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '12px' },
  btnPri: { background: C.primary, color: '#fff' },
  btnGhost: { background: C.surface, border: `1px solid ${C.border}`, color: C.text },
  btnBlue: { background: C.blueL, color: C.blue, border: 'none' },
  btnDng: { background: C.dangerL, color: C.danger, border: 'none' },
  btnPurple: { background: C.purpleL, color: C.purple, border: 'none' },
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: '10px', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '9px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '.5px', borderBottom: `2px solid ${C.border}`, background: '#FAFBFD', whiteSpace: 'nowrap' },
  td: { padding: '11px 14px', borderBottom: `1px solid ${C.border}`, fontSize: '13px', verticalAlign: 'middle' },
  badge: { display: 'inline-block', padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' },
  modal: { background: C.surface, borderRadius: '12px', padding: '24px', width: '560px', maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,.2)', maxHeight: '90vh', overflowY: 'auto' },
  modalH: { fontSize: '15px', fontWeight: 700, marginBottom: '16px' },
  lbl: { fontSize: '11px', fontWeight: 600, color: C.sub, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: '4px', display: 'block' },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: '7px', fontSize: '13px', color: C.text, outline: 'none', background: C.surface, marginBottom: '10px' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  row3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' },
  receipt: { background: C.surface, borderRadius: '12px', padding: '32px', width: '620px', maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,.2)', maxHeight: '90vh', overflowY: 'auto' },
}

const PAYMENT_OPTIONS = ['Cash', 'M-Pesa', 'Credit', 'Insurance', 'SHA', 'SHA (Social Health Authority)', 'AAR Insurance', 'Jubilee Insurance', 'Britam', 'CIC Insurance', 'APA Insurance', 'Sanlam', 'Old Mutual', 'NHIF', 'Corporate Scheme', 'Other']
const STATUS_OPTIONS = ['Pending', 'Paid', 'Partial', 'Approved', 'Cancelled']
const NON_INSURANCE = ['Cash', 'M-Pesa']
const SHA_METHOD = 'SHA (Social Health Authority)'
const SHA_METHODS = ['SHA', 'SHA (Social Health Authority)']
const PRIVATE_INSURERS = ['AAR Insurance', 'Jubilee Insurance', 'Britam', 'CIC Insurance', 'APA Insurance', 'Sanlam', 'Old Mutual', 'NHIF', 'Corporate Scheme', 'Insurance']

// Auto-post invoice to SHA claims or insurance claims after billing saves
async function autoPostClaimFromInvoice(invoice, hospitalId) {
  if (!invoice || !hospitalId) return
  const method = invoice.payment_method || ''
  const isSHA = SHA_METHODS.some(m => method.includes(m))
  const isPrivateInsurer = PRIVATE_INSURERS.some(m => method.includes(m)) && !isSHA

  if (isSHA) {
    // check not already there
    const { data: existing } = await supabase.from('sha_claims').select('id').eq('hospital_id', hospitalId).or(`invoice_id.eq.${invoice.id},invoice_no.eq.${invoice.invoice_no}`).limit(1)
    if (existing && existing.length > 0) return
    await supabase.from('sha_claims').insert({
      hospital_id: hospitalId,
      patient_name: invoice.patient_name,
      patient_id: invoice.patient_id || null,
      visit_id: invoice.visit_id || null,
      invoice_id: invoice.id || null,
      sha_number: invoice.sha_member_no || '',
      id_number: '',
      service_type: invoice.services || 'Outpatient Consultation',
      amount_claimed: parseFloat(invoice.amount_kes || 0),
      visit_date: invoice.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      notes: JSON.stringify({ source: 'Billing', invoice_no: invoice.invoice_no, invoice_id: invoice.id || null, patient_id: invoice.patient_id || null, visit_id: invoice.visit_id || null, notes: invoice.notes || '' }),
      status: 'Pending',
      created_at: new Date().toISOString(),
    })
  } else if (isPrivateInsurer) {
    const { data: existing } = await supabase.from('insurance_claims').select('id').eq('hospital_id', hospitalId).or(`invoice_id.eq.${invoice.id},invoice_no.eq.${invoice.invoice_no}`).limit(1).maybeSingle()
    if (existing) return
    await supabase.from('insurance_claims').insert({
      hospital_id: hospitalId,
      patient_name: invoice.patient_name,
      patient_id: invoice.patient_id || null,
      visit_id: invoice.visit_id || null,
      invoice_id: invoice.id || null,
      invoice_no: invoice.invoice_no || null,
      insurer: invoice.insurer || method,
      member_no: invoice.sha_member_no || '',
      service_description: invoice.services || 'Medical Services',
      amount_claimed: parseFloat(invoice.amount_kes || 0),
      visit_date: invoice.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      notes: JSON.stringify({ source: 'Billing', invoice_no: invoice.invoice_no, invoice_id: invoice.id || null }),
      status: 'Draft',
      created_at: new Date().toISOString(),
    })
  }
}

function formatKES(value) {
  return `KES ${Number(value || 0).toLocaleString()}`
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function parseServices(services) {
  if (!services) return null
  try {
    const parsed = JSON.parse(services)
    if (Array.isArray(parsed)) {
      return parsed.map(item => ({
        label: item.drug || item.service || item.label || item.name || 'Service',
        qty: Number(item.qty || item.quantity || item.qty_sold || 1),
        unit_price: Number(item.unit_price || item.price || 0),
        total: Number(item.total || item.total_kes || item.amount || 0),
      }))
    }
  } catch (_) {}
  return null
}

function buildGenericServiceLines(invoice) {
  const parsed = parseServices(invoice.services)
  if (parsed && parsed.length > 0) return parsed

  const parts = String(invoice.services || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return [{ label: 'Service', qty: 1, unit_price: Number(invoice.amount_kes || 0), total: Number(invoice.amount_kes || 0) }]
  if (parts.length === 1) return [{ label: parts[0], qty: 1, unit_price: Number(invoice.amount_kes || 0), total: Number(invoice.amount_kes || 0) }]

  return parts.map(label => ({ label, qty: 1, unit_price: 0, total: 0 }))
}

function isLinkedLabInvoice(invoice, test) {
  if (!invoice || !test) return false
  const note = String(invoice.notes || '')
  if (note.startsWith(`WF|${SERVICE_SOURCES.LABORATORY}|${test.id}|`)) return true
  if (test.visit_id && invoice.visit_id === test.visit_id) {
    return String(invoice.services || '').toLowerCase().includes(String(test.test_type || '').toLowerCase())
  }
  return false
}

function isConsultationInvoice(invoice) {
  const text = `${invoice?.services || ''} ${invoice?.notes || ''}`.toLowerCase()
  return text.includes('consultation fee')
}

function isPharmacyInvoice(invoice) {
  const text = `${invoice?.services || ''} ${invoice?.notes || ''}`.toLowerCase()
  return text.includes('pharmacy receipt') || text.includes('source_rx_id') || text.includes('pharmacy release')
}

function receiptHtml({ invoice, hospitalName, visitLabel }) {
  const lines = buildGenericServiceLines(invoice)
  const rows = lines.map(line => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${line.label}</td>
      <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:center;">${line.qty || 1}</td>
      <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;">${line.unit_price ? formatKES(line.unit_price) : '-'}</td>
      <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${line.total ? formatKES(line.total) : '-'}</td>
    </tr>
  `).join('')

  return `
    <html>
      <head>
        <title>${invoice.invoice_no || 'Receipt'}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          .muted { color: #6b7280; font-size: 12px; }
          .summary { margin-top: 18px; border-top: 2px solid #e5e7eb; padding-top: 12px; }
          .row { display: flex; justify-content: space-between; margin: 6px 0; gap: 12px; }
        </style>
      </head>
      <body>
        <div style="text-align:center;margin-bottom:20px;">
          <div style="font-size:24px;font-weight:800;">${hospitalName || 'Hospital'}</div>
          <div class="muted">Billing Receipt</div>
        </div>
        <div class="row"><strong>Invoice No</strong><span>${invoice.invoice_no || '-'}</span></div>
        <div class="row"><strong>Patient</strong><span>${invoice.patient_name || '-'}</span></div>
        <div class="row"><strong>Visit</strong><span>${visitLabel || invoice.visit_id || '-'}</span></div>
        <div class="row"><strong>Date</strong><span>${invoice.created_at ? new Date(invoice.created_at).toLocaleString('en-KE') : '-'}</span></div>
        <table>
          <thead>
            <tr>
              <th style="text-align:left;padding-bottom:8px;">Item</th>
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
        ${invoice.notes ? `<div style="margin-top:12px;color:#6b7280;font-size:12px;">${invoice.notes}</div>` : ''}
      </body>
    </html>
  `
}

function Badge({ color, label }) {
  const p = {
    green: { bg: C.successL, color: C.success },
    red: { bg: C.dangerL, color: C.danger },
    yellow: { bg: C.warnL, color: C.warn },
    blue: { bg: C.blueL, color: C.blue },
    purple: { bg: C.purpleL, color: C.purple },
    gray: { bg: '#F3F4F6', color: C.sub },
  }[color] || { bg: '#F3F4F6', color: C.sub }
  return <span style={{ ...css.badge, background: p.bg, color: p.color }}>{label}</span>
}

function statusBadge(status) {
  const map = { Paid: 'green', Partial: 'yellow', Pending: 'yellow', Approved: 'blue', Cancelled: 'red' }
  return <Badge color={map[status] || 'gray'} label={status || '—'} />
}

function paymentBadge(method) {
  const color = method === 'Cash' ? 'gray' : method === 'M-Pesa' ? 'green' : NON_INSURANCE.includes(method) ? 'gray' : 'blue'
  return <Badge color={color} label={method || '—'} />
}

function ItemsDetailModal({ invoice, onClose }) {
  const items = buildGenericServiceLines(invoice)

  return (
    <div style={css.overlay}>
      <div style={{ ...css.modal, width: '640px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div style={css.modalH}>Invoice Details</div>
            <div style={{ fontSize: '12px', color: C.sub, marginTop: '-12px' }}>
              {invoice.invoice_no} · {invoice.patient_name}
            </div>
          </div>
          <button style={{ ...css.btn, ...css.btnGhost, padding: '5px 10px' }} onClick={onClose}>Close</button>
        </div>

        <table style={{ ...css.table, marginBottom: '16px' }}>
          <thead>
            <tr>
              <th style={css.th}>Item</th>
              <th style={{ ...css.th, textAlign: 'center' }}>Qty</th>
              <th style={{ ...css.th, textAlign: 'right' }}>Unit Price</th>
              <th style={{ ...css.th, textAlign: 'right' }}>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.label}-${index}`}>
                <td style={css.td}><strong>{item.label}</strong></td>
                <td style={{ ...css.td, textAlign: 'center' }}>{item.qty || 1}</td>
                <td style={{ ...css.td, textAlign: 'right', color: C.sub }}>{item.unit_price ? formatKES(item.unit_price) : '—'}</td>
                <td style={{ ...css.td, textAlign: 'right', fontWeight: 700 }}>{item.total ? formatKES(item.total) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ borderTop: `2px solid ${C.border}`, paddingTop: '12px', marginBottom: '16px' }}>
          {[
            ['Total Amount', formatKES(invoice.amount_kes || 0), false],
            ['Amount Paid', formatKES(invoice.paid_kes || 0), false],
            ['Balance', formatKES(invoice.balance_kes || 0), true],
          ].map(([k, v, isBal]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '13px' }}>
              <span style={{ color: C.sub }}>{k}</span>
              <span style={{ fontWeight: isBal ? 800 : 600, color: isBal ? ((invoice.balance_kes || 0) > 0 ? C.danger : C.success) : C.text }}>{v}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '13px' }}>
            <span style={{ color: C.sub }}>Payment</span>
            <span>{invoice.payment_method || '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '13px' }}>
            <span style={{ color: C.sub }}>Status</span>
            <span>{statusBadge(invoice.status)}</span>
          </div>
        </div>

        {invoice.notes && (
          <div style={{ background: C.bg, borderRadius: '7px', padding: '10px 12px', fontSize: '12px', color: C.sub }}>
            📝 {invoice.notes}
          </div>
        )}
      </div>
    </div>
  )
}

function InvoiceModal({ invoice, patients, visits, onClose, onSave }) {
  const editing = !!invoice?.id
  const [form, setForm] = useState({
    patient_name: invoice?.patient_name || '',
    patient_id: invoice?.patient_id || '',
    visit_id: invoice?.visit_id || '',
    services: invoice?.services || '',
    amount_kes: invoice?.amount_kes || '',
    paid_kes: invoice?.paid_kes || 0,
    payment_method: invoice?.payment_method || 'Cash',
    insurer: invoice?.insurer || '',
    sha_member_no: invoice?.sha_member_no || '',
    status: invoice?.status || 'Pending',
    notes: invoice?.notes || '',
    handled_by: '',
    split_payment: invoice?.split_payment || false,
    split_method: invoice?.split_method || 'Cash',
    split_amount: invoice?.split_amount || 0,
  })
  const [patSearch, setPatSearch] = useState(invoice?.patient_name || '')
  const [showPats, setShowPats] = useState(false)

  const isInsurance = !NON_INSURANCE.includes(form.payment_method)
  const balance = Math.max(0, (Number(form.amount_kes) || 0) - (Number(form.paid_kes) || 0))
  const filteredPats = patients.filter(p => p.full_name.toLowerCase().includes(patSearch.toLowerCase())).slice(0, 6)
  const isStructuredInvoice = !!parseServices(invoice?.services)

  function updateField(key, value) {
    setForm(prev => {
      const next = { ...prev, [key]: value }
      if (key === 'payment_method') {
        if (value === SHA_METHOD) next.insurer = 'SHA'
        else if (!NON_INSURANCE.includes(value)) next.insurer = value
        else next.insurer = ''
      }
      return next
    })
  }

  return (
    <div style={css.overlay}>
      <div style={css.modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={css.modalH}>{editing ? 'Edit Invoice' : 'New Invoice'}</div>
          <button style={{ ...css.btn, ...css.btnGhost, padding: '5px 10px' }} onClick={onClose}>Close</button>
        </div>

        <label style={css.lbl}>Patient *</label>
        <div style={{ position: 'relative', marginBottom: '10px' }}>
          <input
            style={{ ...css.input, marginBottom: 0 }}
            placeholder="Search patient name..."
            value={patSearch}
            onChange={e => {
              setPatSearch(e.target.value)
              setForm(prev => ({ ...prev, patient_name: e.target.value, patient_id: '', visit_id: '' }))
              setShowPats(true)
            }}
            onFocus={() => setShowPats(true)}
          />
          {showPats && filteredPats.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: C.surface, border: `1px solid ${C.border}`, borderRadius: '7px', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
              {filteredPats.map(p => (
                <div
                  key={p.id}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', borderBottom: `1px solid ${C.border}` }}
                  onClick={() => {
                    setForm(prev => ({
                      ...prev,
                      patient_name: p.full_name,
                      patient_id: p.id,
                      visit_id: '',
                      insurer: prev.insurer || p.insurer || '',
                      sha_member_no: prev.sha_member_no || p.sha_member_no || '',
                    }))
                    setPatSearch(p.full_name)
                    setShowPats(false)
                  }}
                >
                  <strong>{p.full_name}</strong>
                  <span style={{ color: C.sub, fontSize: '11px', marginLeft: '8px' }}>{p.patient_no} · {p.phone}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <label style={css.lbl}>Visit</label>
        <select
          style={css.input}
          value={form.visit_id}
          onChange={e => {
            const selectedVisit = visits.find(v => v.id === e.target.value)
            setForm(prev => ({
              ...prev,
              visit_id: e.target.value,
              patient_id: selectedVisit?.patient_id || prev.patient_id,
              patient_name: selectedVisit?.patient_name || prev.patient_name,
            }))
            if (selectedVisit?.patient_name) setPatSearch(selectedVisit.patient_name)
          }}
        >
          <option value="">Choose visit for encounter tracking</option>
          {visits.map(v => (
            <option key={v.id} value={v.id}>
              {v.visit_number}{v.patient_name ? ` — ${v.patient_name}` : ''}
            </option>
          ))}
        </select>

        <label style={css.lbl}>Services {isStructuredInvoice && <span style={{ color: C.primary, fontWeight: 400, textTransform: 'none' }}>(structured invoice)</span>}</label>
        {isStructuredInvoice ? (
          <div style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: '7px', fontSize: '12px', color: C.sub, marginBottom: '10px', background: C.bg }}>
            {parseServices(invoice.services)?.length || 0} item line(s) saved in structured format
          </div>
        ) : (
          <input style={css.input} placeholder="e.g. Consultation, Lab, Pharmacy" value={form.services} onChange={e => updateField('services', e.target.value)} />
        )}

        <div style={css.row3}>
          <div>
            <label style={css.lbl}>Total Amount (KES) *</label>
            <input style={css.input} type="number" placeholder="0" value={form.amount_kes} onChange={e => updateField('amount_kes', e.target.value)} />
          </div>
          <div>
            <label style={css.lbl}>Amount Paid (KES)</label>
            <input style={css.input} type="number" placeholder="0" value={form.paid_kes} onChange={e => updateField('paid_kes', e.target.value)} />
          </div>
          <div>
            <label style={css.lbl}>Balance</label>
            <div style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: '7px', fontSize: '13px', fontWeight: 700, color: balance > 0 ? C.danger : C.success, marginBottom: '10px' }}>
              {formatKES(balance)}
            </div>
          </div>
        </div>

        <div style={css.row2}>
          <div>
            <label style={css.lbl}>Payment Method</label>
            <select style={{ ...css.input, cursor: 'pointer' }} value={form.payment_method} onChange={e => updateField('payment_method', e.target.value)}>
              {PAYMENT_OPTIONS.map(option => <option key={option}>{option}</option>)}
            </select>
          </div>
          <div>
            <label style={css.lbl}>Status</label>
            <select style={{ ...css.input, cursor: 'pointer' }} value={form.status} onChange={e => updateField('status', e.target.value)}>
              {STATUS_OPTIONS.map(option => <option key={option}>{option}</option>)}
            </select>
          </div>
        </div>

        {isInsurance && (
          <div style={css.row2}>
            <div>
              <label style={css.lbl}>Insurer</label>
              <input style={css.input} placeholder="Insurance provider" value={form.insurer} onChange={e => updateField('insurer', e.target.value)} />
            </div>
            <div>
              <label style={css.lbl}>{form.payment_method === SHA_METHOD ? 'SHA Member No' : 'Policy / Member No'}</label>
              <input style={css.input} placeholder="Member number" value={form.sha_member_no} onChange={e => updateField('sha_member_no', e.target.value)} />
            </div>
          </div>
        )}

        {isInsurance && (
          <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '8px', padding: '12px', marginBottom: '10px' }}>
            <label style={{ ...css.lbl, color: '#92400E' }}>Split Payment (patient co-pay)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <input type="checkbox" id="splitpay" checked={form.split_payment} onChange={e => updateField('split_payment', e.target.checked)} />
              <label htmlFor="splitpay" style={{ fontSize: '12px', cursor: 'pointer' }}>Patient pays additional co-pay (Cash / M-Pesa)</label>
            </div>
            {form.split_payment && (
              <div style={css.row2}>
                <div>
                  <label style={css.lbl}>Co-pay Method</label>
                  <select style={{ ...css.input, cursor: 'pointer' }} value={form.split_method} onChange={e => updateField('split_method', e.target.value)}>
                    <option>Cash</option><option>M-Pesa</option>
                  </select>
                </div>
                <div>
                  <label style={css.lbl}>Co-pay Amount (KES)</label>
                  <input style={css.input} type="number" placeholder="0" value={form.split_amount} onChange={e => updateField('split_amount', e.target.value)} />
                </div>
              </div>
            )}
          </div>
        )}

        <label style={css.lbl}>Notes</label>
        <textarea style={{ ...css.input, height: '60px', resize: 'vertical' }} placeholder="Optional notes..." value={form.notes} onChange={e => updateField('notes', e.target.value)} />

        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          <button style={{ ...css.btn, ...css.btnGhost, flex: 1, padding: '10px' }} onClick={onClose}>Cancel</button>
          <button style={{ ...css.btn, ...css.btnPri, flex: 2, padding: '10px' }} onClick={() => onSave(form, invoice?.id)}>
            {editing ? 'Save Changes' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ReceiptModal({ invoice, hospitalName, visitLabel, canPrint, onClose, onPrint }) {
  if (!invoice) return null
  const items = buildGenericServiceLines(invoice)

  return (
    <div style={css.overlay}>
      <div style={css.receipt}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 800 }}>{hospitalName || 'Hospital'}</div>
            <div style={{ fontSize: '12px', color: C.sub }}>Billing Receipt</div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ ...css.btn, ...css.btnGhost }} onClick={onClose}>Close</button>
            <button
              style={{ ...css.btn, ...css.btnPri }}
              onClick={() => {
                if (!canPrint) {
                  window.notifyFromLegacyAlert('Only Admin and Cashier users can print billing receipts.')
                  return
                }
                onPrint(invoice)
              }}
            >
              Print
            </button>
          </div>
        </div>

        <div style={{ background: C.bg, borderRadius: '8px', padding: '12px 16px', marginBottom: '20px' }}>
          <div style={css.lbl}>Invoice</div>
          <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{invoice.invoice_no}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', marginTop: '12px' }}>
            <div>
              <div style={css.lbl}>Patient</div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>{invoice.patient_name}</div>
            </div>
            <div>
              <div style={css.lbl}>Visit</div>
              <div>{visitLabel || invoice.visit_id || '—'}</div>
            </div>
            <div>
              <div style={css.lbl}>Date</div>
              <div>{invoice.created_at ? new Date(invoice.created_at).toLocaleDateString('en-KE') : '—'}</div>
            </div>
          </div>
          {invoice.insurer && (
            <div style={{ fontSize: '12px', color: C.blue, marginTop: '8px' }}>{invoice.insurer}</div>
          )}
        </div>

        <table style={{ ...css.table, marginBottom: '20px' }}>
          <thead>
            <tr>
              <th style={css.th}>Item</th>
              <th style={{ ...css.th, textAlign: 'center' }}>Qty</th>
              <th style={{ ...css.th, textAlign: 'right' }}>Unit Price</th>
              <th style={{ ...css.th, textAlign: 'right' }}>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.label}-${index}`}>
                <td style={css.td}><strong>{item.label}</strong></td>
                <td style={{ ...css.td, textAlign: 'center' }}>{item.qty || 1}</td>
                <td style={{ ...css.td, textAlign: 'right' }}>{item.unit_price ? formatKES(item.unit_price) : '—'}</td>
                <td style={{ ...css.td, textAlign: 'right', fontWeight: 700 }}>{item.total ? formatKES(item.total) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ borderTop: `2px solid ${C.border}`, paddingTop: '12px' }}>
          {[
            ['Total Amount', formatKES(invoice.amount_kes || 0)],
            ['Amount Paid', formatKES(invoice.paid_kes || 0)],
            ['Balance', formatKES(invoice.balance_kes || 0)],
            ['Payment', invoice.payment_method || '—'],
            ['Status', invoice.status || '—'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '13px' }}>
              <span style={{ color: C.sub }}>{k}</span>
              <span style={{ fontWeight: k === 'Balance' ? 700 : 500, color: k === 'Balance' ? ((invoice.balance_kes || 0) > 0 ? C.danger : C.success) : C.text }}>{v}</span>
            </div>
          ))}
        </div>

        {invoice.notes && (
          <div style={{ marginTop: '12px', padding: '10px', background: C.bg, borderRadius: '7px', fontSize: '12px', color: C.sub }}>
            📝 {invoice.notes}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Billing() {
  const { hospitalId, hospitalName, userRole, navigationState, clearNavigationState } = useHospital()
  const isAdmin = ['Admin', 'admin'].includes(userRole || '')
  const canPrint = isAdmin || ['Cashier', 'cashier'].includes(userRole || '')
  const canDeleteInvoice = canPerformAction(userRole, 'delete_invoice')

  const [invoices, setInvoices] = useState([])
  const [patients, setPatients] = useState([])
  const [visits, setVisits] = useState([])
  const [labTests, setLabTests] = useState([])
  const [search, setSearch] = useState('')
  const [statusF, setStatusF] = useState('all')
  const [paymentF, setPaymentF] = useState('all')
  const [dateF, setDateF] = useState('month')
  const [focusContext, setFocusContext] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editInv, setEditInv] = useState(null)
  const [viewInv, setViewInv] = useState(null)
  const [detailInv, setDetailInv] = useState(null)
  const [loading, setLoading] = useState(false)

  const { staff: allStaff } = useStaff()
  const billingStaff = allStaff.filter(s =>
    ['cashier', 'billing', 'accounts', 'finance', 'revenue'].some(token =>
      `${s.role || ''} ${s.department || ''} ${s.role_category || ''}`.toLowerCase().includes(token),
    ) ||
    s.department === 'Administration' ||
    s.role_category === 'Administration',
  )
  const availableBillingStaff = billingStaff.filter(s => ['active', 'Active'].includes(s.status) && !(s.current_shift || '').toLowerCase().includes('off'))

  useEffect(() => {
    if (!hospitalId) return

    const localHandler = () => loadData(false)
    const channel = supabase
      .channel(`billing-screen-${hospitalId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `hospital_id=eq.${hospitalId}` }, () => loadData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lab_tests', filter: `hospital_id=eq.${hospitalId}` }, () => loadData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `hospital_id=eq.${hospitalId}` }, () => loadData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admissions', filter: `hospital_id=eq.${hospitalId}` }, () => loadData(false))
      .subscribe()

    window.addEventListener('remedacare:workflow_changed', localHandler)
    window.addEventListener('remedacare:prescriptions_changed', localHandler)

    return () => {
      try { supabase.removeChannel(channel) } catch (_) {}
      window.removeEventListener('remedacare:workflow_changed', localHandler)
      window.removeEventListener('remedacare:prescriptions_changed', localHandler)
    }
  }, [hospitalId])

  useEffect(() => {
    if (!hospitalId) return
    loadData()
  }, [hospitalId, dateF])

  useEffect(() => {
    if (navigationState?.screen !== 'billing') return

    const patientName = navigationState.patientName || ''
    const visitId = navigationState.visitId || ''
    const focusValue = patientName || visitId || ''

    if (focusValue) {
      setSearch(String(focusValue))
      setDateF('all')
      setStatusF('all')
      setPaymentF('all')
      setFocusContext({
        patientName,
        visitId,
        source: navigationState.source || 'workflow',
      })
    }

    clearNavigationState?.()
  }, [navigationState, clearNavigationState])

  async function loadData(showSpinner = true) {
    if (!hospitalId) return
    if (showSpinner) setLoading(true)

    const [{ data: inv }, { data: pats }, { data: vts }, { data: labs }] = await Promise.all([
      (() => {
        const query = supabase
          .from('invoices')
          .select('*')
          .eq('hospital_id', hospitalId)
          .order('created_at', { ascending: false })

        if (dateF !== 'all') {
          const now = new Date()
          const rangeStart = new Date(now)
          rangeStart.setHours(0, 0, 0, 0)
          if (dateF === 'week') {
            rangeStart.setDate(now.getDate() - 7)
          } else if (dateF === 'month') {
            rangeStart.setDate(1)
          }
          query.gte('created_at', rangeStart.toISOString())
        }

        return query
      })(),
      supabase
        .from('patients')
        .select('id, full_name, patient_no, phone, age, gender, blood_group, allergies, chronic_conditions, insurer, sha_member_no')
        .eq('hospital_id', hospitalId)
        .order('full_name'),
      supabase
        .from('visits')
        .select('id, visit_number, patient_id, visit_type, status, chief_complaint, assigned_doctor_name, speciality, created_at, patients(full_name, age, gender, phone, blood_group, allergies, chronic_conditions, patient_no)')
        .eq('hospital_id', hospitalId)
        .order('created_at', { ascending: false }),
      supabase
        .from('lab_tests')
        .select('id, visit_id, patient_id, patient_name, test_type, category, priority, status, assigned_to, amount, payment_method, ordered_at')
        .eq('hospital_id', hospitalId)
        .order('ordered_at', { ascending: false }),
    ])

    setInvoices(inv || [])
    setPatients(pats || [])
    setLabTests(labs || [])
    setVisits((vts || []).map(visit => ({
      id: visit.id,
      visit_number: visit.visit_number || visit.id,
      patient_id: visit.patient_id,
      visit_type: visit.visit_type,
      status: visit.status,
      chief_complaint: visit.chief_complaint,
      assigned_doctor_name: visit.assigned_doctor_name,
      speciality: visit.speciality,
      patient_name: visit.patients?.full_name || '',
      patient_age: visit.patients?.age || null,
      patient_gender: visit.patients?.gender || null,
      phone: visit.patients?.phone || '',
      patient_no: visit.patients?.patient_no || '',
      blood_group: visit.patients?.blood_group || '',
      allergies: visit.patients?.allergies || '',
      chronic_conditions: visit.patients?.chronic_conditions || '',
      created_at: visit.created_at,
    })))
    if (showSpinner) setLoading(false)
  }

  const visitLabelById = useMemo(() => visits.reduce((acc, visit) => {
    acc[visit.id] = visit.visit_number || visit.id
    return acc
  }, {}), [visits])

  const todayStr = new Date().toISOString().slice(0, 10)
  const todayInvs = invoices.filter(i => i.created_at?.slice(0, 10) === todayStr)
  const todayRev = todayInvs.reduce((a, i) => a + (Number(i.paid_kes) || 0), 0)
  const unpaid = invoices.filter(i => ['Pending', 'Partial'].includes(i.status))
  const unpaidAmt = unpaid.reduce((a, i) => a + (Number(i.balance_kes) || 0), 0)
  const mpesaAmt = invoices.filter(i => i.payment_method === 'M-Pesa').reduce((a, i) => a + (Number(i.paid_kes) || 0), 0)
  const cashAmt = invoices.filter(i => i.payment_method === 'Cash' && i.created_at?.slice(0, 10) === todayStr).reduce((a, i) => a + (Number(i.paid_kes) || 0), 0)
  const insureAmt = invoices.filter(i => !NON_INSURANCE.includes(i.payment_method)).reduce((a, i) => a + (Number(i.balance_kes || i.amount_kes) || 0), 0)
  const shaAmt = invoices.filter(i => SHA_METHODS.some(m => (i.payment_method || '').includes(m))).reduce((a, i) => a + (Number(i.amount_kes) || 0), 0)
  const creditAmt = invoices.filter(i => i.payment_method === 'Credit').reduce((a, i) => a + (Number(i.balance_kes) || 0), 0)
  const focusedVisitId = focusContext?.visitId || null
  const focusedPatientName = normalizeText(focusContext?.patientName)

  function matchesFocusContext(visitId, patientName) {
    if (!focusContext) return true
    if (focusedVisitId) return visitId === focusedVisitId
    if (focusedPatientName) return normalizeText(patientName) === focusedPatientName
    return true
  }

  const filtered = invoices.filter(inv => {
    const created = new Date(inv.created_at || 0)
    const now = new Date()
    const matchDate =
      dateF === 'all' ||
      (dateF === 'today' && created.toDateString() === now.toDateString()) ||
      (dateF === 'week' && (now - created) < 7 * 86400000) ||
      (dateF === 'month' && created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear())
    const matchStatus = statusF === 'all' || inv.status === statusF
    const matchPay = paymentF === 'all' || inv.payment_method === paymentF
    const q = search.trim().toLowerCase()
    const serviceText = parseServices(inv.services)?.map(item => item.label).join(' ') || inv.services || ''
    const matchSearch = !q ||
      inv.patient_name?.toLowerCase().includes(q) ||
      inv.invoice_no?.toLowerCase().includes(q) ||
      serviceText.toLowerCase().includes(q) ||
      String(visitLabelById[inv.visit_id] || inv.visit_id || '').toLowerCase().includes(q)
    return matchDate && matchStatus && matchPay && matchSearch && matchesFocusContext(inv.visit_id, inv.patient_name)
  })

  const visitGroups = Object.values(invoices.reduce((acc, inv) => {
    if (!inv.visit_id) return acc
    const key = inv.visit_id
    acc[key] = acc[key] || { visit_id: key, patient_name: inv.patient_name || 'Unknown', invoice_count: 0, amount: 0, paid: 0, balance: 0 }
    acc[key].invoice_count += 1
    acc[key].amount += Number(inv.amount_kes) || 0
    acc[key].paid += Number(inv.paid_kes) || 0
    acc[key].balance += Number(inv.balance_kes) || 0
    return acc
  }, {}))
    .filter(group => matchesFocusContext(group.visit_id, group.patient_name))
    .sort((a, b) => b.amount - a.amount)

  const workflowCards = useMemo(() => {
    const q = search.trim().toLowerCase()

    return visits
      .map(visit => {
        const visitInvoices = invoices.filter(inv => inv.visit_id === visit.id)
        const visitLabTests = labTests.filter(test => test.visit_id === visit.id)
        if (visitInvoices.length === 0 && visitLabTests.length === 0) return null

        const consultationInvoices = visitInvoices.filter(isConsultationInvoice)
        const pharmacyInvoices = visitInvoices.filter(isPharmacyInvoice)
        const labChargeLines = visitLabTests.map(test => {
          const linkedInvoice = visitInvoices.find(inv => isLinkedLabInvoice(inv, test)) || null
          return { test, linkedInvoice }
        })

        const totalAmount = visitInvoices.reduce((sum, inv) => sum + (Number(inv.amount_kes) || 0), 0)
        const totalBalance = visitInvoices.reduce((sum, inv) => sum + (Number(inv.balance_kes) || 0), 0)
        const unbilledLabs = labChargeLines.filter(line => !line.linkedInvoice)
        const haystack = [
          visit.patient_name,
          visit.visit_number,
          visit.visit_type,
          visit.assigned_doctor_name,
          visit.chief_complaint,
          ...visitLabTests.map(test => test.test_type),
          ...visitInvoices.map(inv => inv.services),
        ].join(' ').toLowerCase()

        if (!matchesFocusContext(visit.id, visit.patient_name)) return null
        if (q && !haystack.includes(q)) return null

        return {
          visit,
          visitInvoices,
          consultationInvoices,
          pharmacyInvoices,
          labChargeLines,
          totalAmount,
          totalBalance,
          unbilledLabs,
          lastActivityAt: Math.max(
            ...visitInvoices.map(inv => new Date(inv.created_at || 0).getTime()),
            ...visitLabTests.map(test => new Date(test.ordered_at || 0).getTime()),
            new Date(visit.created_at || 0).getTime(),
          ),
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, 8)
  }, [visits, invoices, labTests, search, focusContext])

  async function handleSave(form, id) {
    if (!form.patient_name || !form.amount_kes) {
      window.notifyFromLegacyAlert('Patient name and amount are required.')
      return
    }

    setLoading(true)
    const amount = Number(form.amount_kes) || 0
    const paid = Number(form.paid_kes) || 0
    const balance = Math.max(0, amount - paid)
    const isInsurance = !NON_INSURANCE.includes(form.payment_method)

    let status = form.status
    if (status !== 'Cancelled') {
      if (balance <= 0 && amount > 0) status = 'Paid'
      else if (paid > 0) status = 'Partial'
      else if (isInsurance) status = 'Pending'
      else status = 'Pending'
    }

    const payload = {
      hospital_id: hospitalId,
      patient_name: form.patient_name,
      patient_id: form.patient_id || null,
      visit_id: form.visit_id || null,
      invoice_no: id ? editInv.invoice_no : `INV-${Date.now().toString().slice(-6)}`,
      services: form.services,
      amount_kes: amount,
      paid_kes: paid,
      balance_kes: balance,
      payment_method: form.payment_method,
      insurer: form.payment_method === SHA_METHOD ? 'SHA' : (isInsurance ? (form.insurer || form.payment_method) : null),
      sha_member_no: form.sha_member_no || null,
      status,
      notes: form.notes || null,
      paid_at: status === 'Paid' ? new Date().toISOString() : null,
      split_payment: form.split_payment || false,
      split_method: form.split_payment ? (form.split_method || 'Cash') : null,
      split_amount: form.split_payment ? (Number(form.split_amount) || 0) : null,
      billed_by: form.handled_by || null,
    }

    const { data: saved, error } = id
      ? await supabase.from('invoices').update(payload).eq('id', id).eq('hospital_id', hospitalId).select().single()
      : await supabase.from('invoices').insert(payload).select().single()

    if (error) {
      window.notifyFromLegacyAlert(`Error saving invoice: ${error.message}`)
    } else {
      // Auto-post SHA / Insurance claim on save (no manual import needed)
      if (!id && saved) {
        try { await autoPostClaimFromInvoice(saved, hospitalId) } catch (_) {}
      }
      setShowModal(false)
      setEditInv(null)
      await loadData(false)
    }
    setLoading(false)
  }

  function createInvoiceFromLabTest(test, visit) {
    const amount = Number(test.amount || 0)
    setEditInv({
      patient_name: visit?.patient_name || test.patient_name || '',
      patient_id: visit?.patient_id || test.patient_id || '',
      visit_id: visit?.id || test.visit_id || '',
      services: stringifyServiceLines([
        createServiceLine({
          label: test.test_type,
          qty: 1,
          unitPrice: amount,
          total: amount,
          source: SERVICE_SOURCES.LABORATORY,
          sourceId: test.id,
          visitId: visit?.id || test.visit_id || '',
          meta: { category: test.category, priority: test.priority },
        }),
      ]),
      amount_kes: amount || '',
      paid_kes: 0,
      payment_method: test.payment_method || 'Cash',
      insurer: '',
      sha_member_no: '',
      status: 'Pending',
      notes: buildWorkflowInvoiceNote({
        source: SERVICE_SOURCES.LABORATORY,
        sourceId: test.id,
        visitId: visit?.id || test.visit_id || '',
        summary: `Billing created for ${test.test_type}`,
      }),
    })
    setShowModal(true)
  }

  async function markPaid(inv) {
    const { error } = await supabase
      .from('invoices')
      .update({
        status: 'Paid',
        paid_kes: Number(inv.amount_kes || 0),
        balance_kes: 0,
        paid_at: new Date().toISOString(),
      })
      .eq('id', inv.id)
      .eq('hospital_id', hospitalId)

    if (error) window.notifyFromLegacyAlert(`Error: ${error.message}`)
    else loadData(false)
  }

  async function handleDeleteInvoice(inv) {
    if (!canDeleteInvoice) {
      window.notifyFromLegacyAlert('Only admins can delete invoices.')
      return
    }

    const confirmed = await window.openConfirmDialog(`Delete invoice ${inv.invoice_no || ''}?`)
    if (!confirmed) return

    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', inv.id)
      .eq('hospital_id', hospitalId)

    if (error) window.notifyFromLegacyAlert(`Error deleting invoice: ${error.message}`)
    else loadData(false)
  }

  function exportCSV() {
    const headers = ['Invoice No', 'Patient', 'Visit', 'Services', 'Amount', 'Paid', 'Balance', 'Payment', 'Insurer', 'Status', 'Date']
    const rows = filtered.map(i => [
      i.invoice_no,
      i.patient_name,
      visitLabelById[i.visit_id] || i.visit_id || '',
      (parseServices(i.services)?.map(x => `${x.label}×${x.qty}`).join('; ')) || (i.services || ''),
      i.amount_kes,
      i.paid_kes || 0,
      i.balance_kes || 0,
      i.payment_method,
      i.insurer || '',
      i.status,
      i.created_at ? new Date(i.created_at).toLocaleDateString() : '',
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = `billing_${todayStr}.csv`
    a.click()
  }

  function printInvoiceReceipt(invoice) {
    if (!canPrint) {
      window.notifyFromLegacyAlert('Only Admin and Cashier users can print billing receipts.')
      return
    }

    const visitLabel = visitLabelById[invoice.visit_id] || invoice.visit_id || ''
    const printWindow = window.open('', '_blank', 'width=900,height=800')
    if (!printWindow) return
    printWindow.document.write(receiptHtml({ invoice, hospitalName, visitLabel }))
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  function renderServicesCell(inv) {
    const items = parseServices(inv.services)
    const source = inferInvoiceSource(inv)
    if (items) {
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', maxWidth: '180px' }}>
          <span style={{ background: '#F3F4F6', color: C.sub, borderRadius: '4px', padding: '1px 6px', fontSize: '10px', fontWeight: 700 }}>
            {source}
          </span>
          {items.slice(0, 2).map((item, index) => (
            <span key={`${item.label}-${index}`} style={{ background: C.primaryL, color: C.primary, borderRadius: '4px', padding: '1px 6px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {item.label} ×{item.qty}
            </span>
          ))}
          {items.length > 2 && (
            <span style={{ background: '#F3F4F6', color: C.sub, borderRadius: '4px', padding: '1px 6px', fontSize: '11px' }}>
              +{items.length - 2} more
            </span>
          )}
        </div>
      )
    }

    return (
      <div>
        <span style={{ display: 'inline-block', background: '#F3F4F6', color: C.sub, borderRadius: '4px', padding: '1px 6px', fontSize: '10px', fontWeight: 700, marginBottom: '4px' }}>
          {source}
        </span>
        <span style={{ fontSize: '12px', color: C.sub, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>
          {inv.services || '—'}
        </span>
      </div>
    )
  }

  return (
    <div style={css.page}>
      <div style={css.wrap}>
        <div style={css.header}>
          <div><h1 style={css.h1}>Billing & Invoicing</h1></div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ ...css.btn, ...css.btnGhost }} onClick={exportCSV} disabled={!isAdmin} title={!isAdmin ? 'Admin only' : ''}>Export CSV</button>
            <button style={{ ...css.btn, ...css.btnPri }} onClick={() => { setEditInv(null); setShowModal(true) }}>+ New Invoice</button>
          </div>
        </div>

        <div style={css.subtext}>
          Today: {formatKES(todayRev)} · {todayInvs.length} invoice(s)
        </div>

        {focusContext && (
          <div style={{ marginBottom: '12px', padding: '10px 12px', background: C.purpleL, border: `1px solid ${C.purple}22`, borderRadius: '10px', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '12px', color: C.purple, fontWeight: 600 }}>
              Billing focus: {focusContext.patientName || 'Selected patient'}
              {focusContext.visitId ? ` · Visit ${visitLabelById[focusContext.visitId] || focusContext.visitId}` : ''}
              {focusContext.source ? ` · From ${focusContext.source}` : ''}
            </div>
            <button
              style={{ ...css.btn, ...css.btnPurple, padding: '6px 12px' }}
              onClick={() => {
                setFocusContext(null)
                setSearch('')
              }}
            >
              Clear focus
            </button>
          </div>
        )}

        <div style={{ marginBottom: '12px', fontSize: '12px', color: C.sub }}>
          Available billing staff in HR: {availableBillingStaff.length > 0 ? availableBillingStaff.map(s => s.full_name).join(', ') : 'None currently active'}
        </div>

        <div style={{ ...css.statsRow, gridTemplateColumns: 'repeat(6,1fr)' }}>
          {[
            { lbl: "Today's Revenue", val: formatKES(todayRev), sub: `${todayInvs.length} invoices`, color: C.success },
            { lbl: 'Cash Today', val: formatKES(cashAmt), sub: 'cash payments', color: C.text },
            { lbl: 'M-Pesa Collected', val: formatKES(mpesaAmt), sub: 'via M-Pesa', color: C.primary },
            { lbl: 'SHA Billed', val: formatKES(shaAmt), sub: 'SHA invoices total', color: C.blue },
            { lbl: 'Insurance Pending', val: formatKES(insureAmt), sub: 'private insurers', color: C.warn },
            { lbl: 'Credit Outstanding', val: formatKES(creditAmt), sub: `${unpaid.length} unpaid`, color: C.danger },
          ].map(({ lbl, val, sub, color }) => (
            <div key={lbl} style={css.stat}>
              <div style={css.statLbl}>{lbl}</div>
              <div style={{ ...css.statVal, color, fontSize: '20px' }}>{val}</div>
              <div style={{ ...css.statSub, color }}>{sub}</div>
            </div>
          ))}
        </div>

        {visitGroups.length > 0 && (
          <div style={{ ...css.card, marginBottom: '18px', padding: '14px 16px' }}>
            <div style={{ marginBottom: '12px', fontWeight: 700 }}>Visit billing groups</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '12px' }}>
              {visitGroups.slice(0, 4).map(group => (
                <div key={group.visit_id} style={{ background: '#F8FAFC', border: '1px solid #E8ECF2', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>{group.patient_name}</div>
                  <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '8px' }}>Visit: {visitLabelById[group.visit_id] || group.visit_id}</div>
                  <div style={{ fontSize: '12px', marginBottom: '4px' }}>Invoices: {group.invoice_count}</div>
                  <div style={{ fontSize: '12px', marginBottom: '4px' }}>Total: {formatKES(group.amount)}</div>
                  <div style={{ fontSize: '12px', marginBottom: '4px' }}>Paid: {formatKES(group.paid)}</div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: group.balance > 0 ? C.danger : C.success }}>Balance: {formatKES(group.balance)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {workflowCards.length > 0 && (
          <div style={{ marginBottom: '18px' }}>
            <div style={{ fontWeight: 700, marginBottom: '10px' }}>Department Workflow Patient Cards</div>
            <div style={{ fontSize: '12px', color: C.sub, marginBottom: '12px' }}>
              This gives billing a real patient-by-patient view of consultation, lab, and pharmacy activity so charges can be completed from departmental work, not only from finished invoices.
            </div>
            <div style={css.workflowGrid}>
              {workflowCards.map(card => (
                <div key={card.visit.id} style={css.workflowCard}>
                  <PatientWorkflowCard
                    patientName={card.visit.patient_name || 'Unknown patient'}
                    patient={{
                      age: card.visit.patient_age,
                      gender: card.visit.patient_gender,
                      phone: card.visit.phone,
                      blood_group: card.visit.blood_group,
                      allergies: card.visit.allergies,
                      chronic_conditions: card.visit.chronic_conditions,
                    }}
                    visit={{
                      visit_number: card.visit.visit_number,
                      visit_type: card.visit.visit_type,
                      assigned_doctor_name: card.visit.assigned_doctor_name,
                      speciality: card.visit.speciality,
                      chief_complaint: card.visit.chief_complaint,
                      status: card.visit.status,
                    }}
                    badges={[
                      { label: card.visit.status || 'Active', bg: '#F3F4F6', color: C.sub },
                      { label: `${visitLabelById[card.visit.id] || card.visit.id}`, bg: C.primaryL, color: C.primary },
                    ]}
                    accentColor={card.totalBalance > 0 ? C.danger : C.success}
                    extraMeta={[`Balance ${formatKES(card.totalBalance)}`, `Total billed ${formatKES(card.totalAmount)}`]}
                  />

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                    <Badge color="blue" label={`${card.consultationInvoices.length} consultation`} />
                    <Badge color="purple" label={`${card.labChargeLines.length} lab order${card.labChargeLines.length !== 1 ? 's' : ''}`} />
                    <Badge color="green" label={`${card.pharmacyInvoices.length} pharmacy`} />
                    {card.unbilledLabs.length > 0 && <Badge color="yellow" label={`${card.unbilledLabs.length} lab charge pending`} />}
                  </div>

                  {card.labChargeLines.length > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '11px', color: C.sub, fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>Lab Orders</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {card.labChargeLines.slice(0, 4).map(({ test, linkedInvoice }) => (
                          <div key={test.id} style={{ background: '#FAFBFD', border: `1px solid ${C.border}`, borderRadius: '10px', padding: '10px 12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '13px', fontWeight: 700 }}>{test.test_type}</div>
                                <div style={{ fontSize: '11px', color: C.sub, marginTop: '4px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                  {test.category && <span>{test.category}</span>}
                                  {test.priority && <span>{test.priority}</span>}
                                  <span>{test.status}</span>
                                  <span>{test.assigned_to || 'Unassigned'}</span>
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '12px', fontWeight: 700 }}>{test.amount ? formatKES(test.amount) : 'Set charge'}</div>
                                <div style={{ fontSize: '11px', color: linkedInvoice ? C.success : C.warn, marginTop: '4px' }}>
                                  {linkedInvoice ? `Invoiced ${linkedInvoice.invoice_no || ''}`.trim() : 'Not billed'}
                                </div>
                              </div>
                            </div>
                            {!linkedInvoice && (
                              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                                <button
                                  style={{ ...css.btn, ...css.btnPurple, padding: '6px 10px', fontSize: '11px' }}
                                  onClick={() => createInvoiceFromLabTest(test, card.visit)}
                                >
                                  Create Lab Invoice
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                        {card.labChargeLines.length > 4 && (
                          <div style={{ fontSize: '11px', color: C.sub }}>+{card.labChargeLines.length - 4} more lab item(s) on this visit</div>
                        )}
                      </div>
                    </div>
                  )}

                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '10px', display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '11px', color: C.sub }}>
                      {card.visit.assigned_doctor_name ? `Doctor: ${card.visit.assigned_doctor_name}` : 'Doctor not captured'}
                      {card.visit.speciality ? ` • ${card.visit.speciality}` : ''}
                    </div>
                    <button style={{ ...css.btn, ...css.btnGhost, padding: '6px 10px', fontSize: '11px' }} onClick={() => setSearch(card.visit.visit_number || card.visit.patient_name || '')}>
                      Focus This Patient
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={css.toolbar}>
          <div style={css.searchWrap}>
            <input style={css.searchInput} placeholder="Search patient, invoice no, visit, services..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {['today', 'week', 'month', 'all'].map(f => (
            <button key={f} style={{ ...css.btn, ...(dateF === f ? css.btnPri : css.btnGhost), padding: '7px 14px' }} onClick={() => setDateF(f)}>
              {f === 'all' ? 'All Time' : f === 'today' ? 'Today' : f === 'week' ? 'This Week' : 'This Month'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <select style={css.select} value={statusF} onChange={e => setStatusF(e.target.value)}>
            <option value="all">All Status</option>
            {STATUS_OPTIONS.map(option => <option key={option}>{option}</option>)}
          </select>
          <select style={css.select} value={paymentF} onChange={e => setPaymentF(e.target.value)}>
            <option value="all">All Payments</option>
            {PAYMENT_OPTIONS.map(option => <option key={option}>{option}</option>)}
          </select>
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: C.sub, alignSelf: 'center' }}>
            {filtered.length} records · {formatKES(filtered.reduce((a, i) => a + (Number(i.amount_kes) || 0), 0))} total
          </span>
        </div>

        <div style={css.card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={css.table}>
              <thead>
                <tr>
                  {['Invoice #', 'Patient', 'Visit', 'Services', 'Amount', 'Paid', 'Balance', 'Payment', 'Status', 'Date', ''].map(h => (
                    <th key={h} style={css.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={11} style={{ ...css.td, padding: '24px' }}>
                      <SkeletonLoader rows={3} height={14} width={['100%', '92%', '84%']} />
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={11} style={{ ...css.td, textAlign: 'center', color: C.muted, padding: '40px' }}>No invoices found</td></tr>
                )}
                {!loading && filtered.map(inv => (
                  <tr key={inv.id}>
                    <td style={{ ...css.td, fontFamily: 'monospace', fontSize: '12px', color: C.sub }}>{inv.invoice_no}</td>
                    <td style={css.td}>
                      <strong style={{ fontSize: '13px' }}>{inv.patient_name}</strong>
                      {inv.insurer && <div style={{ fontSize: '11px', color: C.blue, marginTop: '1px' }}>{inv.insurer}</div>}
                    </td>
                    <td style={css.td}>{visitLabelById[inv.visit_id] || inv.visit_id || '—'}</td>
                    <td style={{ ...css.td, maxWidth: '200px' }}>{renderServicesCell(inv)}</td>
                    <td style={{ ...css.td, fontWeight: 700 }}>{formatKES(inv.amount_kes || 0)}</td>
                    <td style={{ ...css.td, color: C.success, fontWeight: 600 }}>{formatKES(inv.paid_kes || 0)}</td>
                    <td style={{ ...css.td, fontWeight: 700, color: (inv.balance_kes || 0) > 0 ? C.danger : C.success }}>{formatKES(inv.balance_kes || 0)}</td>
                    <td style={css.td}>{paymentBadge(inv.payment_method)}</td>
                    <td style={css.td}>{statusBadge(inv.status)}</td>
                    <td style={{ ...css.td, fontSize: '11px', color: C.sub }}>{inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-KE') : '—'}</td>
                    <td style={css.td}>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'nowrap' }}>
                        <button style={{ ...css.btn, ...css.btnBlue, padding: '5px 10px', fontSize: '11px' }} onClick={() => setViewInv(inv)}>View</button>
                        <button style={{ ...css.btn, ...css.btnGhost, padding: '5px 10px', fontSize: '11px' }} onClick={() => printInvoiceReceipt(inv)}>Print</button>
                        <button style={{ ...css.btn, ...css.btnGhost, padding: '5px 10px', fontSize: '11px' }} onClick={() => { setEditInv(inv); setShowModal(true) }}>Edit</button>
                        <button
                          style={{ ...css.btn, ...css.btnDng, padding: '5px 10px', fontSize: '11px' }}
                          onClick={() => handleDeleteInvoice(inv)}
                          disabled={!canDeleteInvoice}
                          title={!canDeleteInvoice ? 'Only admins can delete invoices' : ''}
                        >
                          Delete
                        </button>
                        {buildGenericServiceLines(inv).length > 1 && (
                          <button style={{ ...css.btn, ...css.btnPurple, padding: '5px 9px', fontSize: '11px' }} onClick={() => setDetailInv(inv)}>
                            Items
                          </button>
                        )}
                        {['Pending', 'Partial'].includes(inv.status) && (
                          <button style={{ ...css.btn, ...css.btnPri, padding: '5px 10px', fontSize: '11px' }} onClick={() => markPaid(inv)}>Paid</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showModal && (
        <InvoiceModal
          invoice={editInv}
          patients={patients}
          visits={visits}
          onClose={() => { setShowModal(false); setEditInv(null) }}
          onSave={handleSave}
        />
      )}

      {viewInv && (
        <ReceiptModal
          invoice={viewInv}
          hospitalName={hospitalName}
          visitLabel={visitLabelById[viewInv.visit_id] || viewInv.visit_id || '—'}
          canPrint={canPrint}
          onClose={() => setViewInv(null)}
          onPrint={printInvoiceReceipt}
        />
      )}

      {detailInv && (
        <ItemsDetailModal
          invoice={detailInv}
          onClose={() => setDetailInv(null)}
        />
      )}
    </div>
  )
}
