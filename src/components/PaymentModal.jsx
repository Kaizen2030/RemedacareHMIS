import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { canManagePayments, canPerformAction } from '../access'
import { colors as C, typography } from '../theme'
import {
  cancelPendingPayment, errorMessage, fetchPaymentStatus, getPaymentSettings, listInvoicePayments,
  newIdempotencyKey, pollUntilSettled, recordManualPayments, refundPayment, resolvePendingPayment,
  startOnlinePayment,
} from '../utils/payments/api'
import { changeDue, formatKES, invoiceTotalsFromLedger, openAmount, parseAmountInput, refundableAmount, roundMoney, sumAmounts } from '../utils/payments/money'
import {
  availableMethods, CARD_BRANDS, KENYAN_BANKS, METHOD_LABELS, ONLINE_METHODS, PAYMENT_METHODS,
  STATUS_STYLE, validateTenders,
} from '../utils/payments/methods'
import { normalizeKenyanPhone } from '../utils/payments/phone'
import { printPaymentReceipt } from '../utils/payments/receipt'
import { openPromptDialog } from '../confirmDialog'

const css = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { background: C.surface, borderRadius: 14, width: 720, maxWidth: '97vw', maxHeight: '94vh', overflowY: 'auto', boxShadow: '0 24px 70px rgba(0,0,0,.28)', fontFamily: typography.fontFamily, color: C.text, fontSize: 13 },
  head: { padding: '18px 22px 12px', borderBottom: `1px solid ${C.border}` },
  body: { padding: '16px 22px 22px' },
  h: { fontSize: 16, fontWeight: 800, margin: 0 },
  sub: { fontSize: 12, color: C.sub, marginTop: 2 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 12 },
  kpi: { background: C.bgAlt, border: `1px solid ${C.border}`, borderRadius: 9, padding: '8px 12px' },
  kpiL: { fontSize: 10, fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '.5px' },
  kpiV: { fontSize: 17, fontWeight: 800, marginTop: 2 },
  tabs: { display: 'flex', gap: 4, padding: '0 22px', borderBottom: `1px solid ${C.border}` },
  tab: { padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: C.sub, borderBottom: '2px solid transparent' },
  tabOn: { color: C.primary, borderBottom: `2px solid ${C.primary}` },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: { padding: '7px 11px', borderRadius: 20, border: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: C.text },
  line: { border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 10, background: C.bgAlt },
  lbl: { display: 'block', fontSize: 10, fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 3 },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: C.surface, color: C.text, outline: 'none' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 },
  btn: { padding: '9px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  pri: { background: C.primary, color: '#fff' },
  ghost: { background: C.surface, border: `1px solid ${C.border}`, color: C.text },
  dng: { background: C.dangerL, color: C.danger },
  small: { padding: '4px 9px', fontSize: 11, borderRadius: 6 },
  err: { background: C.dangerL, color: C.danger, borderRadius: 8, padding: '9px 12px', marginBottom: 10, fontSize: 12 },
  ok: { background: C.successL, color: C.success, borderRadius: 8, padding: '9px 12px', marginBottom: 10, fontSize: 12, fontWeight: 600 },
  warn: { background: C.warnL, color: C.warn, borderRadius: 8, padding: '9px 12px', marginBottom: 10, fontSize: 12 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.sub, textTransform: 'uppercase', padding: '7px 8px', borderBottom: `2px solid ${C.border}` },
  td: { padding: '9px 8px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top', fontSize: 12 },
}

const TONES = { green: [C.successL, C.success], yellow: [C.warnL, C.warn], red: [C.dangerL, C.danger], gray: ['#F3F4F6', C.sub] }
function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || { label: status, tone: 'gray' }
  const [bg, fg] = TONES[s.tone]
  return <span style={{ background: bg, color: fg, borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 700 }}>{s.label}</span>
}

function Field({ label, children }) {
  return <div><label style={css.lbl}>{label}</label>{children}</div>
}

const blankLine = (method, amount = '') => ({ key: newIdempotencyKey(), method, amount: amount === '' ? '' : String(amount), tendered: '', reference: '', phone: '', email: '', card_brand: 'Visa', card_last4: '', bank_name: '', cheque_no: '', terminal_id: '', notes: '' })

/**
 * initialLine (optional): what the screen already knows, e.g. { method: 'mpesa_manual', reference: 'SGH7K2L9QX' }
 * from a registration form. Used to pre-fill the first line when that method is enabled; the cashier can change it.
 */
export default function PaymentModal({ invoice, hospitalId, userRole, hospitalProfile, onClose, onChanged, initialLine = null }) {
  const canTake = canPerformAction(userRole, 'record_payment')
  const canManage = canManagePayments(userRole)

  const [tab, setTab] = useState('pay')
  const [settings, setSettings] = useState(null)
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [lines, setLines] = useState([])
  const [errors, setErrors] = useState([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [online, setOnline] = useState(null) // { payment, action, startedAt }
  const [refunding, setRefunding] = useState(null) // { payment, amount, reason, reference }
  const [localInvoice, setLocalInvoice] = useState(invoice)
  const attemptKeys = useRef({ manual: newIdempotencyKey(), online: newIdempotencyKey() })
  const abortRef = useRef(null)
  const mounted = useRef(true)

  useEffect(() => () => { mounted.current = false; abortRef.current?.abort() }, [])

  const reload = useCallback(async () => {
    try {
      const rows = await listInvoicePayments(invoice.id)
      if (mounted.current) setPayments(rows)
      return rows
    } catch (e) {
      if (mounted.current) setErrors([e.message])
      return []
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [invoice.id])

  useEffect(() => {
    let live = true
    ;(async () => {
      const [s, rows] = await Promise.all([getPaymentSettings(hospitalId).catch(() => null), reload()])
      if (!live) return
      setSettings(s)
      const open = openAmount(invoice, rows)
      const enabled = availableMethods(s?.enabled_methods)
      const hinted = initialLine?.method && enabled.some((m) => m.id === initialLine.method) ? initialLine.method : null
      const first = blankLine(hinted || enabled[0]?.id || 'cash', open > 0 ? open : '')
      if (hinted && initialLine.reference) first.reference = String(initialLine.reference)
      setLines([first])
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalId, invoice.id, reload])

  const methods = useMemo(() => availableMethods(settings?.enabled_methods), [settings])
  const open = useMemo(() => openAmount(localInvoice, payments), [localInvoice, payments])
  const paidSoFar = useMemo(() => roundMoney(Math.max(0, Number(localInvoice.amount_kes || 0) - open)), [localInvoice, open])
  const entered = sumAmounts(lines)
  const remainingAfter = roundMoney(open - entered)
  const hasOnline = lines.some((l) => ONLINE_METHODS.includes(l.method))

  const patchLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = (method) => {
    if (ONLINE_METHODS.includes(method) && hasOnline) { setErrors(['Only one online (STK / card) payment can be started at a time']); return }
    setErrors([])
    setLines((ls) => [...ls, blankLine(method, remainingAfter > 0 ? remainingAfter : '')])
  }
  const removeLine = (key) => setLines((ls) => ls.filter((l) => l.key !== key))

  // Latest invoice for async callbacks (polling, receipts) — state in a closure would be stale.
  const invoiceRef = useRef(invoice)
  useEffect(() => { invoiceRef.current = localInvoice }, [localInvoice])

  /** Recompute totals from the ledger (same rule as the DB trigger) and return the fresh invoice. */
  function refreshInvoice(rows) {
    const next = invoiceTotalsFromLedger(invoiceRef.current, rows)
    invoiceRef.current = next
    setLocalInvoice(next)
    onChanged?.()
    return next
  }

  function resetForNextAttempt(rows) {
    attemptKeys.current = { manual: newIdempotencyKey(), online: newIdempotencyKey() }
    const nextOpen = openAmount(invoiceRef.current, rows)
    setLines([blankLine(methods[0]?.id || 'cash', nextOpen > 0 ? nextOpen : '')])
  }

  async function submit() {
    setNotice('')
    const errs = validateTenders(lines, open, { allowPartial: settings?.allow_partial !== false })
    if (errs.length) { setErrors(errs); return }
    setErrors([])
    setBusy(true)
    const manual = lines.filter((l) => !ONLINE_METHODS.includes(l.method))
    const onlineLine = lines.find((l) => ONLINE_METHODS.includes(l.method))
    try {
      let recorded = []
      if (manual.length) {
        recorded = await recordManualPayments({ invoiceId: invoice.id, lines: manual, idempotencyKey: attemptKeys.current.manual })
        attemptKeys.current.manual = newIdempotencyKey()
      }
      if (onlineLine) {
        try {
          const res = await startOnlinePayment({
            invoiceId: invoice.id, method: onlineLine.method, amount: parseAmountInput(onlineLine.amount),
            phone: onlineLine.phone, email: onlineLine.email, payerName: localInvoice.patient_name,
            idempotencyKey: attemptKeys.current.online,
          })
          attemptKeys.current.online = newIdempotencyKey()
          setOnline({ payment: res.payment, action: res.action, startedAt: Date.now() })
          const rows = await reload()
          await refreshInvoice(rows)
          startPolling(res.payment.id)
          if (res.action?.type === 'redirect' && res.action.url) window.open(res.action.url, '_blank', 'noopener')
        } catch (e) {
          const rows = await reload()
          await refreshInvoice(rows)
          setErrors([recorded.length ? `${recorded.length} payment(s) were saved, but the online payment failed: ${e.message}` : e.message])
          attemptKeys.current.online = newIdempotencyKey()
        }
      } else {
        const rows = await reload()
        const fresh = refreshInvoice(rows)
        const receipts = recorded.map((r) => r.receipt_no).filter(Boolean)
        const pendingCheques = recorded.filter((r) => r.status === 'pending')
        const reviews = recorded.filter((r) => r.needs_review && r.review_note).map((r) => r.review_note)
        setNotice([
          `Recorded ${recorded.length} payment${recorded.length > 1 ? 's' : ''}${receipts.length ? ` — receipt ${receipts.join(', ')}` : ''}.`,
          pendingCheques.length ? `${pendingCheques.length} cheque${pendingCheques.length > 1 ? 's are' : ' is'} pending until finance marks it cleared.` : '',
          ...reviews.map((n) => `⚠ ${n}`),
        ].filter(Boolean).join(' '))
        resetForNextAttempt(rows)
        const done = recorded.filter((r) => r.status === 'completed')
        if (done.length) printPaymentReceipt({ payment: done[0], lines: recorded, invoice: fresh, hospitalProfile })
      }
    } catch (e) {
      setErrors([await errorMessage(e)])
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  function startPolling(paymentId) {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    pollUntilSettled(paymentId, {
      signal: ctrl.signal, intervalMs: 3000, timeoutMs: 180000,
      onUpdate: (p) => mounted.current && p && setOnline((o) => (o ? { ...o, payment: p } : o)),
    }).then(async (final) => {
      if (!mounted.current || ctrl.signal.aborted || !final) return
      const rows = await reload()
      const fresh = refreshInvoice(rows)
      if (final.status === 'completed') {
        setNotice(`Payment received — receipt ${final.receipt_no || ''}${final.needs_review && final.review_note ? ` ⚠ ${final.review_note}` : ''}`)
        printPaymentReceipt({ payment: final, invoice: fresh, hospitalProfile })
        setOnline(null)
        resetForNextAttempt(rows)
      }
    })
  }

  async function checkNow() {
    if (!online) return
    try {
      const p = await fetchPaymentStatus(online.payment.id)
      if (p) setOnline((o) => ({ ...o, payment: p }))
      const rows = await reload()
      await refreshInvoice(rows)
    } catch (e) { setErrors([e.message]) }
  }

  async function cancelOnline(paymentId) {
    try {
      abortRef.current?.abort()
      await cancelPendingPayment(paymentId, 'Cancelled by cashier')
      setOnline(null)
      const rows = await reload()
      await refreshInvoice(rows)
      resetForNextAttempt(rows)
      setNotice('Payment request cancelled. If the patient already paid, it will be matched automatically and flagged for review.')
    } catch (e) { setErrors([e.message]) }
  }

  async function doResolve(p, outcome) {
    const note = outcome === 'bounced' ? (await openPromptDialog('Why did the cheque bounce?', { title: 'Cheque bounced', placeholder: 'e.g. insufficient funds', tone: 'danger' })) || '' : ''
    if (outcome === 'bounced' && !note.trim()) return
    try {
      await resolvePendingPayment(p.id, outcome, note)
      const rows = await reload(); await refreshInvoice(rows)
    } catch (e) { setErrors([e.message]) }
  }

  async function doRefund() {
    const { payment, amount, reason, reference } = refunding
    const amt = parseAmountInput(amount)
    const max = refundableAmount(payment, payments)
    if (!(amt > 0) || amt > max + 0.001) { setErrors([`Refund must be between 0 and ${formatKES(max)}`]); return }
    if (!reason.trim()) { setErrors(['Enter a refund reason']); return }
    setBusy(true)
    try {
      const row = await refundPayment({ payment, amount: amt, reason: reason.trim(), reference })
      setRefunding(null); setErrors([])
      const rows = await reload(); await refreshInvoice(rows)
      setNotice(`Refund ${row?.receipt_no || ''} recorded. ${['paystack', 'flutterwave'].includes(payment.provider) ? 'The gateway will return the money to the customer.' : 'Remember to hand over / send the money outside the app.'}`)
    } catch (e) { setErrors([e.message]) } finally { setBusy(false) }
  }

  const elapsed = online ? Math.floor((Date.now() - online.startedAt) / 1000) : 0
  const [, tick] = useState(0)
  useEffect(() => { if (!online) return undefined; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [online])

  const pendingCount = payments.filter((p) => p.status === 'pending').length
  const reviewCount = payments.filter((p) => p.needs_review).length

  function renderLine(l, idx) {
    const m = PAYMENT_METHODS[l.method]
    return (
      <div key={l.key} style={css.line}>
        <div style={{ ...css.grid2, gridTemplateColumns: '1.3fr 1fr auto', alignItems: 'end' }}>
          <Field label={lines.length > 1 ? `Method (line ${idx + 1})` : 'Method'}>
            <select style={css.input} value={l.method} onChange={(e) => {
              const next = e.target.value
              if (ONLINE_METHODS.includes(next) && lines.some((x) => x.key !== l.key && ONLINE_METHODS.includes(x.method))) { setErrors(['Only one online payment per attempt']); return }
              patchLine(l.key, { method: next })
            }}>
              {methods.map((x) => <option key={x.id} value={x.id}>{x.icon} {x.label}</option>)}
            </select>
          </Field>
          <Field label="Amount (KES)">
            <input style={css.input} inputMode="decimal" value={l.amount} onChange={(e) => patchLine(l.key, { amount: e.target.value })} placeholder="0" />
          </Field>
          {lines.length > 1 ? <button style={{ ...css.btn, ...css.dng, ...css.small }} onClick={() => removeLine(l.key)} aria-label="Remove line">✕</button> : <span />}
        </div>
        <div style={{ fontSize: 11, color: C.sub, margin: '6px 0 8px' }}>{m?.hint}</div>

        {l.method === 'cash' && (
          <div style={css.grid2}>
            <Field label="Cash received (optional)">
              <input style={css.input} inputMode="decimal" value={l.tendered} onChange={(e) => patchLine(l.key, { tendered: e.target.value })} placeholder="e.g. 2000" />
            </Field>
            <div style={{ alignSelf: 'end', fontWeight: 800, fontSize: 15, color: C.primary, paddingBottom: 6 }}>
              {l.tendered !== '' && parseAmountInput(l.tendered) >= parseAmountInput(l.amount) ? `Change: ${formatKES(changeDue(parseAmountInput(l.tendered), parseAmountInput(l.amount)))}` : ''}
            </div>
          </div>
        )}
        {l.method === 'mpesa' && (
          <div style={css.grid2}>
            <Field label="Patient M-Pesa number">
              <input style={css.input} inputMode="tel" value={l.phone} onChange={(e) => patchLine(l.key, { phone: e.target.value })} placeholder="0712 345 678" />
            </Field>
            <div style={{ alignSelf: 'end', fontSize: 11, color: normalizeKenyanPhone(l.phone) ? C.success : C.muted, paddingBottom: 8 }}>
              {normalizeKenyanPhone(l.phone) ? `✓ Will prompt +${normalizeKenyanPhone(l.phone)}` : 'Whole shillings only'}
            </div>
          </div>
        )}
        {(l.method === 'mpesa_manual' || l.method === 'airtel_money') && (
          <div style={css.grid2}>
            <Field label={l.method === 'mpesa_manual' ? 'M-Pesa code (10 chars)' : 'Airtel transaction ID'}>
              <input style={{ ...css.input, textTransform: 'uppercase' }} value={l.reference} maxLength={l.method === 'mpesa_manual' ? 10 : 30} onChange={(e) => patchLine(l.key, { reference: e.target.value })} placeholder="SGH7K2L9QX" />
            </Field>
            <Field label="Payer phone (optional)">
              <input style={css.input} inputMode="tel" value={l.phone} onChange={(e) => patchLine(l.key, { phone: e.target.value })} />
            </Field>
          </div>
        )}
        {l.method === 'card_online' && (
          <Field label="Customer email (for the gateway receipt)">
            <input style={css.input} type="email" value={l.email} onChange={(e) => patchLine(l.key, { email: e.target.value })} placeholder={settings?.fallback_email ? `Optional — default ${settings.fallback_email}` : 'patient@example.com'} />
          </Field>
        )}
        {l.method === 'card_pos' && (
          <div style={css.grid3}>
            <Field label="Approval / RRN code"><input style={css.input} value={l.reference} onChange={(e) => patchLine(l.key, { reference: e.target.value })} /></Field>
            <Field label="Card brand">
              <select style={css.input} value={l.card_brand} onChange={(e) => patchLine(l.key, { card_brand: e.target.value })}>{CARD_BRANDS.map((b) => <option key={b}>{b}</option>)}</select>
            </Field>
            <Field label="Last 4 digits"><input style={css.input} inputMode="numeric" maxLength={4} value={l.card_last4} onChange={(e) => patchLine(l.key, { card_last4: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Terminal ID (optional)"><input style={css.input} value={l.terminal_id} onChange={(e) => patchLine(l.key, { terminal_id: e.target.value })} /></Field>
          </div>
        )}
        {l.method === 'bank_transfer' && (
          <div style={css.grid2}>
            <Field label="Bank reference / slip no."><input style={css.input} value={l.reference} onChange={(e) => patchLine(l.key, { reference: e.target.value })} /></Field>
            <Field label="Bank">
              <select style={css.input} value={l.bank_name} onChange={(e) => patchLine(l.key, { bank_name: e.target.value })}><option value="">Select…</option>{KENYAN_BANKS.map((b) => <option key={b}>{b}</option>)}</select>
            </Field>
            {(settings?.bank_account_no) && <div style={{ gridColumn: '1 / -1', fontSize: 11, color: C.sub }}>Hospital account: {settings.bank_name} · {settings.bank_account_name} · {settings.bank_account_no}</div>}
          </div>
        )}
        {l.method === 'cheque' && (
          <div style={css.grid2}>
            <Field label="Cheque number"><input style={css.input} value={l.cheque_no} onChange={(e) => patchLine(l.key, { cheque_no: e.target.value })} /></Field>
            <Field label="Drawer's bank">
              <select style={css.input} value={l.bank_name} onChange={(e) => patchLine(l.key, { bank_name: e.target.value })}><option value="">Select…</option>{KENYAN_BANKS.map((b) => <option key={b}>{b}</option>)}</select>
            </Field>
          </div>
        )}
        {l.method === 'other' && <Field label="Note"><input style={css.input} value={l.notes} onChange={(e) => patchLine(l.key, { notes: e.target.value })} /></Field>}
      </div>
    )
  }

  return (
    <div style={css.overlay} role="dialog" aria-modal="true" aria-label="Take payment">
      <div style={css.modal}>
        <div style={css.head}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h3 style={css.h}>Payment — {localInvoice.invoice_no || 'Invoice'}</h3>
              <div style={css.sub}>{localInvoice.patient_name}{localInvoice.insurer ? ` · ${localInvoice.insurer}` : ''}</div>
            </div>
            <button style={{ ...css.btn, ...css.ghost, ...css.small, alignSelf: 'flex-start' }} onClick={onClose}>Close</button>
          </div>
          <div style={css.kpis}>
            <div style={css.kpi}><div style={css.kpiL}>Invoice total</div><div style={css.kpiV}>{formatKES(localInvoice.amount_kes)}</div></div>
            <div style={css.kpi}><div style={css.kpiL}>Paid</div><div style={{ ...css.kpiV, color: C.success }}>{formatKES(paidSoFar)}</div></div>
            <div style={css.kpi}><div style={css.kpiL}>Open balance</div><div style={{ ...css.kpiV, color: open > 0 ? C.danger : C.success }}>{formatKES(open)}</div></div>
          </div>
        </div>

        <div style={css.tabs}>
          <button style={{ ...css.tab, ...(tab === 'pay' ? css.tabOn : {}) }} onClick={() => setTab('pay')}>Take payment</button>
          <button style={{ ...css.tab, ...(tab === 'history' ? css.tabOn : {}) }} onClick={() => setTab('history')}>
            History ({payments.length}){pendingCount > 0 ? ` · ${pendingCount} pending` : ''}{reviewCount > 0 ? ` · ⚠ ${reviewCount}` : ''}
          </button>
        </div>

        <div style={css.body}>
          {errors.map((e, i) => <div key={i} style={css.err}>{e}</div>)}
          {notice && <div style={css.ok}>{notice}</div>}

          {tab === 'pay' && (
            <>
              {!canTake && <div style={css.warn}>Your role cannot record payments.</div>}
              {canTake && online && (
                <div style={{ ...css.line, textAlign: 'center', background: C.warnL }}>
                  <div style={{ fontSize: 28 }}>{online.action?.type === 'redirect' ? '💳' : '📲'}</div>
                  <div style={{ fontWeight: 800, fontSize: 15, marginTop: 4 }}>
                    {online.payment.status === 'pending' ? 'Waiting for the patient…' : <StatusBadge status={online.payment.status} />}
                  </div>
                  <div style={{ color: C.sub, margin: '6px 0 10px' }}>{online.action?.message}</div>
                  {online.payment.status === 'pending' && <div style={{ fontSize: 12, color: C.sub }}>{formatKES(online.payment.amount)} · {elapsed}s</div>}
                  {['failed', 'expired', 'cancelled'].includes(online.payment.status) && <div style={{ color: C.danger, marginBottom: 8 }}>{online.payment.failure_reason || 'The payment did not complete.'}</div>}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {online.action?.type === 'redirect' && online.action.url && online.payment.status === 'pending' && (
                      <button style={{ ...css.btn, ...css.pri }} onClick={() => window.open(online.action.url, '_blank', 'noopener')}>Open secure checkout</button>
                    )}
                    {online.payment.status === 'pending' ? (
                      <>
                        <button style={{ ...css.btn, ...css.ghost }} onClick={checkNow}>Check status</button>
                        <button style={{ ...css.btn, ...css.dng }} onClick={() => cancelOnline(online.payment.id)}>Cancel request</button>
                      </>
                    ) : (
                      <button style={{ ...css.btn, ...css.pri }} onClick={async () => { setOnline(null); const rows = await reload(); resetForNextAttempt(rows) }}>Try again</button>
                    )}
                  </div>
                </div>
              )}

              {canTake && !online && open <= 0 && <div style={css.ok}>This invoice is fully paid. 🎉</div>}
              {canTake && !online && open > 0 && (
                <>
                  <div style={css.chips}>
                    <span style={{ ...css.lbl, alignSelf: 'center', margin: 0 }}>{lines.length === 1 ? 'Pay with:' : 'Add another:'}</span>
                    {methods.map((m) => (
                      <button key={m.id} style={{ ...css.chip, ...(lines.length === 1 && lines[0].method === m.id ? { border: `1px solid ${C.primary}`, background: C.primaryL, color: C.primary } : {}) }}
                        onClick={() => (lines.length === 1 ? patchLine(lines[0].key, { method: m.id }) : addLine(m.id))}>{m.icon} {m.label}</button>
                    ))}
                    {lines.length === 1 && remainingAfter >= 0 && (
                      <button style={{ ...css.chip, borderStyle: 'dashed' }} onClick={() => addLine(methods.find((m) => !ONLINE_METHODS.includes(m.id))?.id || 'cash')} title="Lower the first amount, then add a second method">＋ Split payment</button>
                    )}
                  </div>
                  {lines.map(renderLine)}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 14px', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ fontSize: 12 }}>
                      Entered <strong>{formatKES(entered)}</strong> · Left after this <strong style={{ color: remainingAfter < 0 ? C.danger : C.text }}>{formatKES(remainingAfter)}</strong>
                      {lines.length === 1 && <button style={{ ...css.btn, ...css.ghost, ...css.small, marginLeft: 8 }} onClick={() => patchLine(lines[0].key, { amount: String(open) })}>Pay full balance</button>}
                    </div>
                    <button style={{ ...css.btn, ...css.pri, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>
                      {busy ? 'Processing…' : hasOnline ? 'Send payment request' : `Record ${formatKES(entered)}`}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'history' && (
            <>
              {loading && <div style={{ color: C.sub }}>Loading…</div>}
              {!loading && payments.length === 0 && <div style={{ color: C.sub }}>No payments recorded yet.</div>}
              {payments.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={css.table}>
                    <thead><tr><th style={css.th}>When</th><th style={css.th}>Method</th><th style={css.th}>Reference</th><th style={{ ...css.th, textAlign: 'right' }}>Amount</th><th style={css.th}>Status</th><th style={css.th} /></tr></thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} style={p.kind === 'refund' ? { background: C.dangerL } : undefined}>
                          <td style={css.td}>{new Date(p.completed_at || p.created_at).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' })}<div style={{ color: C.muted, fontSize: 10 }}>{p.receipt_no || ''}</div></td>
                          <td style={css.td}>{p.kind === 'refund' ? 'Refund · ' : ''}{METHOD_LABELS[p.method] || p.method}{p.card_last4 && <div style={{ color: C.muted, fontSize: 10 }}>{p.card_brand} ••{p.card_last4}</div>}</td>
                          <td style={css.td}>{p.reference || p.cheque_no || '—'}{p.failure_reason && <div style={{ color: C.danger, fontSize: 10 }}>{p.failure_reason}</div>}{p.needs_review && <div style={{ color: C.warn, fontSize: 10 }}>⚠ {p.review_note || 'Needs review'}</div>}</td>
                          <td style={{ ...css.td, textAlign: 'right', fontWeight: 700 }}>{p.kind === 'refund' ? '−' : ''}{formatKES(p.amount)}</td>
                          <td style={css.td}><StatusBadge status={p.status} /></td>
                          <td style={{ ...css.td, whiteSpace: 'nowrap' }}>
                            {p.status === 'completed' && <button style={{ ...css.btn, ...css.ghost, ...css.small }} onClick={() => printPaymentReceipt({ payment: p, invoice: localInvoice, hospitalProfile })}>Receipt</button>}{' '}
                            {p.status === 'pending' && ONLINE_METHODS.includes(p.method) && <button style={{ ...css.btn, ...css.ghost, ...css.small }} onClick={async () => { try { await fetchPaymentStatus(p.id); const rows = await reload(); await refreshInvoice(rows) } catch (e) { setErrors([e.message]) } }}>Check</button>}{' '}
                            {p.status === 'pending' && p.kind === 'payment' && ONLINE_METHODS.includes(p.method) && canTake && <button style={{ ...css.btn, ...css.dng, ...css.small }} onClick={() => cancelOnline(p.id)}>Cancel</button>}{' '}
                            {p.status === 'pending' && p.method === 'cheque' && canManage && (<><button style={{ ...css.btn, ...css.pri, ...css.small }} onClick={() => doResolve(p, 'cleared')}>Cleared</button>{' '}<button style={{ ...css.btn, ...css.dng, ...css.small }} onClick={() => doResolve(p, 'bounced')}>Bounced</button></>)}
                            {p.kind === 'payment' && p.status === 'completed' && canManage && refundableAmount(p, payments) > 0 && (
                              <button style={{ ...css.btn, ...css.dng, ...css.small }} onClick={() => setRefunding({ payment: p, amount: String(refundableAmount(p, payments)), reason: '', reference: '' })}>Refund</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {refunding && (
                <div style={{ ...css.line, marginTop: 14, background: C.dangerL }}>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>Refund {refunding.payment.receipt_no} · max {formatKES(refundableAmount(refunding.payment, payments))}</div>
                  <div style={css.grid2}>
                    <Field label="Refund amount"><input style={css.input} value={refunding.amount} onChange={(e) => setRefunding({ ...refunding, amount: e.target.value })} /></Field>
                    <Field label={['paystack', 'flutterwave'].includes(refunding.payment.provider) ? 'Gateway refunds the customer' : 'Payout reference (optional)'}>
                      <input style={css.input} disabled={['paystack', 'flutterwave'].includes(refunding.payment.provider)} value={refunding.reference} onChange={(e) => setRefunding({ ...refunding, reference: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Reason (required, kept in the audit trail)"><input style={css.input} value={refunding.reason} onChange={(e) => setRefunding({ ...refunding, reason: e.target.value })} /></Field>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button style={{ ...css.btn, ...css.dng }} disabled={busy} onClick={doRefund}>{busy ? 'Saving…' : 'Confirm refund'}</button>
                    <button style={{ ...css.btn, ...css.ghost }} onClick={() => setRefunding(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
