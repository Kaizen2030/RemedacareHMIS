import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../supabase'
import { colors as C, typography } from '../theme'
import { errorMessage, fetchDailySummary } from '../utils/payments/api'
import { formatKES, parseAmountInput, roundMoney } from '../utils/payments/money'
import { METHOD_LABELS } from '../utils/payments/methods'
import { openPrintPreview } from '../utils/printSystem'

const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date())
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const st = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { background: C.surface, borderRadius: 14, width: 820, maxWidth: '97vw', maxHeight: '94vh', overflowY: 'auto', padding: 22, fontFamily: typography.fontFamily, color: C.text, fontSize: 13, boxShadow: '0 24px 70px rgba(0,0,0,.28)' },
  th: { textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.sub, textTransform: 'uppercase', padding: '7px 8px', borderBottom: `2px solid ${C.border}` },
  td: { padding: '8px', borderBottom: `1px solid ${C.border}` },
  input: { padding: '7px 9px', border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: C.surface, color: C.text },
  btn: { padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: 'pointer', fontWeight: 700, fontSize: 12 },
}

export default function PaymentsCashUp({ hospitalId, hospitalProfile, onClose }) {
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState(todayISO())
  const [rows, setRows] = useState([])
  const [issues, setIssues] = useState([])
  const [counted, setCounted] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [summary, exc] = await Promise.all([
        fetchDailySummary(hospitalId, from, to),
        supabase.from('payments').select('id, invoice_id, method, provider, kind, status, amount, reference, needs_review, review_note, created_at, receipt_no')
          .eq('hospital_id', hospitalId).or('needs_review.eq.true,status.eq.pending').order('created_at', { ascending: false }).limit(100),
      ])
      setRows(summary)
      setIssues((exc.data || []).filter((p) => p.needs_review || (p.status === 'pending' && (p.method === 'cheque' || Date.now() - new Date(p.created_at).getTime() > 30 * 60000))))
    } catch (e) { setErr(await errorMessage(e)) } finally { setLoading(false) }
  }, [hospitalId, from, to])

  useEffect(() => { load() }, [load])

  const byMethod = useMemo(() => {
    const m = {}
    rows.forEach((r) => {
      const x = (m[r.method] ||= { method: r.method, gross: 0, refunds: 0, net: 0, fees: 0, count: 0 })
      x.gross += Number(r.gross || 0); x.refunds += Number(r.refunds || 0); x.net += Number(r.net || 0)
      x.fees += Number(r.gateway_fees || 0); x.count += Number(r.txn_count || 0)
    })
    return Object.values(m).sort((a, b) => b.net - a.net)
  }, [rows])
  const totals = byMethod.reduce((t, x) => ({ gross: t.gross + x.gross, refunds: t.refunds + x.refunds, net: t.net + x.net, fees: t.fees + x.fees }), { gross: 0, refunds: 0, net: 0, fees: 0 })
  const expectedCash = byMethod.find((x) => x.method === 'cash')?.net || 0
  const variance = counted === '' ? null : roundMoney(parseAmountInput(counted) - expectedCash)

  function exportCsv() {
    const lines = [['Method', 'Gross', 'Refunds', 'Net', 'Gateway fees', 'Transactions'], ...byMethod.map((x) => [METHOD_LABELS[x.method] || x.method, x.gross, x.refunds, x.net, x.fees, x.count])]
    const csv = lines.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = `cash-up_${from}_${to}.csv`; a.click()
  }

  function print() {
    const body = `<h2>Cash-up report</h2><p>${esc(from)} → ${esc(to)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th align="left">Method</th><th align="right">Gross</th><th align="right">Refunds</th><th align="right">Net</th></tr></thead><tbody>
      ${byMethod.map((x) => `<tr><td>${esc(METHOD_LABELS[x.method] || x.method)}</td><td align="right">${formatKES(x.gross)}</td><td align="right">${formatKES(x.refunds)}</td><td align="right">${formatKES(x.net)}</td></tr>`).join('')}
      <tr><td><strong>Total</strong></td><td align="right"><strong>${formatKES(totals.gross)}</strong></td><td align="right"><strong>${formatKES(totals.refunds)}</strong></td><td align="right"><strong>${formatKES(totals.net)}</strong></td></tr></tbody></table>
      <p>Expected cash in drawer: <strong>${formatKES(expectedCash)}</strong>${variance !== null ? ` · Counted: <strong>${formatKES(parseAmountInput(counted))}</strong> · Variance: <strong>${formatKES(variance)}</strong>` : ''}</p>
      <p style="margin-top:36px">Cashier signature: ____________________ &nbsp;&nbsp; Supervisor: ____________________</p>`
    openPrintPreview({ title: 'Cash-up report', hospitalProfile, bodyHtml: body })
  }

  return (
    <div style={st.overlay} role="dialog" aria-modal="true" aria-label="Cash-up">
      <div style={st.modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Cash-up & reconciliation</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={st.input} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <span>→</span>
            <input style={st.input} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            <button style={st.btn} onClick={onClose}>Close</button>
          </div>
        </div>
        {err && <div style={{ background: C.dangerL, color: C.danger, borderRadius: 8, padding: 10, margin: '12px 0' }}>{err}</div>}
        {loading ? <div style={{ color: C.sub, padding: 20 }}>Loading…</div> : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
              <thead><tr><th style={st.th}>Method</th><th style={{ ...st.th, textAlign: 'right' }}>Gross</th><th style={{ ...st.th, textAlign: 'right' }}>Refunds</th><th style={{ ...st.th, textAlign: 'right' }}>Net</th><th style={{ ...st.th, textAlign: 'right' }}>Gateway fees</th><th style={{ ...st.th, textAlign: 'right' }}>Txns</th></tr></thead>
              <tbody>
                {byMethod.length === 0 && <tr><td colSpan={6} style={{ ...st.td, color: C.sub }}>No completed payments in this period.</td></tr>}
                {byMethod.map((x) => (
                  <tr key={x.method}><td style={st.td}>{METHOD_LABELS[x.method] || x.method}</td>
                    <td style={{ ...st.td, textAlign: 'right' }}>{formatKES(x.gross)}</td>
                    <td style={{ ...st.td, textAlign: 'right', color: x.refunds ? C.danger : C.muted }}>{formatKES(x.refunds)}</td>
                    <td style={{ ...st.td, textAlign: 'right', fontWeight: 700 }}>{formatKES(x.net)}</td>
                    <td style={{ ...st.td, textAlign: 'right', color: C.muted }}>{x.fees ? formatKES(x.fees) : '—'}</td>
                    <td style={{ ...st.td, textAlign: 'right' }}>{x.count}</td></tr>
                ))}
                {byMethod.length > 0 && (
                  <tr style={{ background: C.bgAlt, fontWeight: 800 }}><td style={st.td}>Total</td>
                    <td style={{ ...st.td, textAlign: 'right' }}>{formatKES(totals.gross)}</td><td style={{ ...st.td, textAlign: 'right' }}>{formatKES(totals.refunds)}</td>
                    <td style={{ ...st.td, textAlign: 'right' }}>{formatKES(totals.net)}</td><td style={{ ...st.td, textAlign: 'right' }}>{formatKES(totals.fees)}</td><td style={st.td} /></tr>
                )}
              </tbody>
            </table>

            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0', padding: 12, background: C.bgAlt, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <div>Expected cash in drawer: <strong>{formatKES(expectedCash)}</strong></div>
              <label>Counted: <input style={{ ...st.input, width: 120 }} inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0" /></label>
              {variance !== null && <strong style={{ color: variance === 0 ? C.success : C.danger }}>{variance === 0 ? 'Balanced ✓' : `${variance > 0 ? 'Over' : 'Short'} by ${formatKES(Math.abs(variance))}`}</strong>}
              <span style={{ flex: 1 }} />
              <button style={st.btn} onClick={exportCsv}>Export CSV</button>
              <button style={st.btn} onClick={print}>Print</button>
            </div>

            <h4 style={{ margin: '4px 0 8px' }}>Needs attention ({issues.length})</h4>
            {issues.length === 0 ? <div style={{ color: C.success }}>Nothing outstanding. 🎉</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {issues.map((p) => (
                    <tr key={p.id}>
                      <td style={st.td}>{new Date(p.created_at).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td style={st.td}>{METHOD_LABELS[p.method] || p.method} · {formatKES(p.amount)}</td>
                      <td style={{ ...st.td, color: p.needs_review ? C.warn : C.sub }}>{p.needs_review ? `⚠ ${p.review_note || 'Needs review'}` : p.method === 'cheque' ? 'Cheque awaiting clearance' : 'Pending > 30 min — check the gateway'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  )
}
