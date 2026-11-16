// Printable payment receipt (thermal-friendly width). Output is HTML-escaped.
import { METHOD_LABELS } from './methods'
import { formatKES } from './money'
import { openPrintPreview } from '../printSystem'

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const row = (k, v) => (v ? `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px dashed #D1D5DB;"><span style="color:#6B7280;">${esc(k)}</span><strong style="text-align:right;">${esc(v)}</strong></div>` : '')

function tenderDetail(p) {
  const masked = p.card_last4 ? `${p.card_brand || 'Card'} •••• ${p.card_last4}` : ''
  return [p.reference, masked, p.bank_name, p.cheque_no && p.cheque_no !== p.reference ? `Cheque ${p.cheque_no}` : '']
    .filter(Boolean).join(' · ')
}

/**
 * @param payment  the main ledger row (receipt no., date)
 * @param lines    optional: every row of a split payment, printed together on one receipt
 * @param invoice  invoice totals AFTER this payment (pass the recomputed invoice, not a stale copy)
 */
export function buildPaymentReceiptHtml({ payment, lines = null, invoice, hospitalProfile = {} }) {
  const isRefund = payment.kind === 'refund'
  const tenders = (lines && lines.length ? lines : [payment])
  const split = tenders.length > 1
  const receiptNos = tenders.map((t) => t.receipt_no).filter(Boolean)
  const cash = tenders.filter((t) => t.method === 'cash')
  const tendered = cash.reduce((s, t) => s + Number(t.tendered || 0), 0)
  const change = cash.reduce((s, t) => s + Number(t.change_given || 0), 0)
  const total = tenders.reduce((s, t) => s + Number(t.amount || 0), 0)

  const tenderRows = split
    ? `<div style="margin:10px 0 4px;font-weight:700;">Paid with</div>${tenders.map((t) => row(
        `${METHOD_LABELS[t.method] || t.method}${tenderDetail(t) ? ` (${tenderDetail(t)})` : ''}${t.status !== 'completed' ? ` — ${String(t.status).toUpperCase()}` : ''}`,
        formatKES(t.amount))).join('')}${row('Total received', formatKES(total))}`
    : `${row('Method', METHOD_LABELS[payment.method] || payment.method)}
       ${row('Reference', payment.reference)}
       ${row('Card', payment.card_last4 ? `${payment.card_brand || 'Card'} •••• ${payment.card_last4}` : '')}
       ${row('Bank', payment.bank_name)}
       ${row('Cheque no.', payment.cheque_no)}
       ${row(isRefund ? 'Refunded' : 'Amount paid', formatKES(payment.amount))}
       ${payment.status !== 'completed' ? row('Status', String(payment.status).toUpperCase()) : ''}`

  return `
    <div style="max-width:420px;margin:0 auto;font-family:system-ui,Arial,sans-serif;font-size:13px;">
      <h2 style="text-align:center;margin:0 0 2px;">${isRefund ? 'REFUND VOUCHER' : 'PAYMENT RECEIPT'}</h2>
      <div style="text-align:center;color:#6B7280;margin-bottom:12px;">${esc(receiptNos.length ? receiptNos.join(', ') : 'Pending confirmation')}</div>
      ${row('Date', new Date(payment.completed_at || payment.created_at || Date.now()).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }))}
      ${row('Patient', invoice?.patient_name)}
      ${row('Invoice', invoice?.invoice_no)}
      ${tenderRows}
      ${tendered > 0 ? row('Cash received', formatKES(tendered)) : ''}
      ${change > 0 ? row('Change given', formatKES(change)) : ''}
      ${invoice ? `<div style="margin-top:12px;">${row('Invoice total', formatKES(invoice.amount_kes))}${row('Total paid', formatKES(invoice.paid_kes))}${row('Balance', formatKES(invoice.balance_kes))}</div>` : ''}
      ${payment.notes && isRefund ? row('Reason', payment.notes) : ''}
      <p style="text-align:center;color:#6B7280;margin-top:16px;">Served by: ${esc(payment.created_by_role || 'cashier')}<br/>${esc(hospitalProfile?.receipt_footer || 'Thank you.')}</p>
    </div>`
}

export function printPaymentReceipt(args) {
  const nos = (args.lines || [args.payment]).map((p) => p.receipt_no).filter(Boolean)
  return openPrintPreview({
    title: `Receipt ${nos.join(', ')}`.trim(),
    hospitalProfile: args.hospitalProfile || {},
    bodyHtml: buildPaymentReceiptHtml(args),
  })
}
