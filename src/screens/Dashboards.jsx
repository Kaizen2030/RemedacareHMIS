// Management dashboards: executive (administrators), matron (nursing), pharmacy, claims (finance) and a link to the lab's
// quality panel. Figures come from exec_dashboard / matron_dashboard / pharmacy_dashboard / claims_dashboard
// (20261217000000_dashboards.sql); a figure the database cannot compute shows as "—".
import { useEffect, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import { C, Chip, s } from './ncd/ui'

const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Dashboards are not installed yet. Run docs/sql/35_dashboards.sql in Supabase.'
  if (/administrators|claims staff|clinical staff|pharmacy/i.test(m)) return `${m}.`
  return m
}
const n = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-KE'))
const kes = (v) => (v === null || v === undefined ? '—' : `KES ${Math.round(Number(v)).toLocaleString('en-KE')}`)
const pct = (a, b) => (a === null || a === undefined || !Number(b) ? '—' : `${Math.round((Number(a) / Number(b)) * 100)}%`)
const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)

function Tile({ label, value, sub, warn }) {
  return (
    <div style={{ border: `1px solid ${warn ? C.danger : C.border}`, borderRadius: 10, padding: 12, background: '#fff' }}>
      <div style={s.sub}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: warn ? C.danger : undefined }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.sub }}>{sub}</div>}
    </div>
  )
}
function Section({ title, children }) {
  return <div style={{ marginBottom: 14 }}><div style={{ ...s.label, marginBottom: 6 }}>{title}</div><div style={s.grid(170)}>{children}</div></div>
}
function useRpc(fn, args, deps) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!args.p_hospital) return
    let live = true
    void supabase.rpc(fn, args).then(({ data, error }) => { if (!live) return; if (error) { setErr(friendly(error)); setD(null) } else { setErr(''); setD(data) } })
    return () => { live = false }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return [d, err]
}

export default function Dashboards() {
  const { hospitalId } = useHospital()
  const [tab, setTab] = useState('executive')
  const [range, setRange] = useState({ from: daysAgo(30), to: today() })
  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div><h1 style={s.h1}>Management dashboards</h1><div style={s.sub}>Clinical, money and operations at a glance. Each dashboard shows only to the people allowed to see it.</div></div>
        {['executive', 'claims'].includes(tab) && <div style={{ display: 'flex', gap: 6 }}>
          <input aria-label="From" type="date" style={{ ...s.input, maxWidth: 160 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <input aria-label="To" type="date" style={{ ...s.input, maxWidth: 160 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </div>}
      </div>
      <div role="tablist" aria-label="Dashboards" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['executive', 'Executive'], ['matron', 'Matron / nursing'], ['pharmacy', 'Pharmacy'], ['claims', 'Claims & receivables'], ['lab', 'Laboratory']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...s.btn, ...(tab === k ? s.pri : s.ghost) }}>{l}</button>
        ))}
      </div>
      {tab === 'executive' && <Executive hospitalId={hospitalId} range={range} />}
      {tab === 'matron' && <Matron hospitalId={hospitalId} />}
      {tab === 'pharmacy' && <Pharmacy hospitalId={hospitalId} />}
      {tab === 'claims' && <Claims hospitalId={hospitalId} range={range} />}
      {tab === 'lab' && <div style={{ ...s.card, ...s.sub }}>The laboratory dashboard (worklists, review queue, turnaround times, trends) is on <a href="#/laboratory">Laboratory → Dashboard</a>.</div>}
    </div>
  )
}

function Executive({ hospitalId, range }) {
  const [d, err] = useRpc('exec_dashboard', { p_hospital: hospitalId, p_from: range.from, p_to: range.to }, [hospitalId, range.from, range.to])
  if (err) return <div role="alert" style={s.err}>{err}</div>
  if (!d) return <div style={s.sub}>Loading…</div>
  const v = d.visits || {}, a = d.admissions || {}, b = d.beds || {}, e = d.emergency || {}, t = d.theatre || {}, m = d.maternity || {}, icu = d.icu || {}
  const bill = d.billing || {}, col = d.collected || {}, cl = d.claims || {}, lab = d.lab || {}, ph = d.pharmacy || {}, ex = d.expiring || {}
  const lowBlood = (d.blood || []).filter((x) => Number(x.units) < 2).map((x) => x.blood_group)
  return (
    <div style={s.card}>
      <Section title="Patients">
        <Tile label="Visits" value={n(v.total)} sub={v.opd !== undefined ? `${n(v.opd)} outpatient` : ''} />
        <Tile label="Admissions" value={n(a.admitted)} sub={a.discharged !== undefined ? `${n(a.discharged)} discharged · ALOS ${a.alos_days ?? '—'} days` : ''} />
        <Tile label="Bed occupancy (now)" value={pct(b.occupied, b.total)} sub={b.total !== undefined ? `${n(b.occupied)} of ${n(b.total)} beds · ${n(b.cleaning)} being cleaned` : ''} warn={b.total && b.occupied / b.total > 0.9} />
        <Tile label="Emergency attendances" value={n(e.attendances)} sub={e.attendances !== undefined ? `${n(e.red_orange)} red/orange · ${n(e.left_without_being_seen)} left without being seen` : ''} warn={e.left_without_being_seen > 0} />
        <Tile label="Operations" value={n(t.completed)} sub={t.cancelled !== undefined ? `${n(t.cancelled)} cancelled / postponed · ${n(t.emergency)} emergency` : ''} />
        <Tile label="Deliveries" value={n(m.deliveries)} sub={m.deliveries !== undefined ? `C/S ${pct(m.caesareans, m.deliveries)} · ${n(m.fresh_stillbirths)} fresh stillbirths` : ''} warn={m.maternal_deaths > 0} />
        <Tile label="Maternal deaths" value={n(m.maternal_deaths)} warn={m.maternal_deaths > 0} />
        <Tile label="ICU / HDU" value={n(icu.in_unit)} sub={icu.admissions !== undefined ? `in the unit now · ${n(icu.admissions)} admitted · ${n(icu.deaths)} died` : ''} />
        <Tile label="Facility deaths" value={n(d.deaths?.facility_deaths)} />
        <Tile label="Deteriorating patients (24 h)" value={n(d.deteriorating_now?.patients)} warn={d.deteriorating_now?.patients > 0} sub="NEWS2 / PEWS high" />
      </Section>
      <Section title="Money (collected at the cashier)">
        <Tile label="Billed" value={kes(bill.billed)} />
        <Tile label="Collected" value={kes(col.total)} sub={col.total !== undefined ? `M-Pesa ${kes(col.mpesa)} · cash ${kes(col.cash)}` : ''} />
        <Tile label="Outstanding on bills raised" value={kes(bill.outstanding)} warn={bill.billed && bill.outstanding / bill.billed > 0.3} />
        <Tile label="SHA claims" value={n(cl.total)} sub={cl.total !== undefined ? `${n(cl.rejected)} rejected · ${n(cl.paid)} paid` : ''} warn={cl.total && cl.rejected / cl.total > 0.1} />
      </Section>
      <Section title="Operations">
        <Tile label="Lab tests" value={n(lab.ordered)} sub={lab.ordered !== undefined ? `${pct(lab.resulted, lab.ordered)} resulted · ${n(lab.awaiting_review)} awaiting review` : ''} />
        <Tile label="Pharmacy stock-outs" value={n(ph.stock_outs)} sub={ph.below_reorder !== undefined ? `${n(ph.below_reorder)} below reorder level` : ''} warn={ph.stock_outs > 0} />
        <Tile label="Expiring in 60 days" value={n(ex.batches_60d)} sub={ex.value_60d !== undefined ? kes(ex.value_60d) : ''} />
        <Tile label="Blood groups low (< 2 units)" value={d.blood ? (lowBlood.length ? lowBlood.join(', ') : 'None') : '—'} warn={lowBlood.length > 0} />
        <Tile label="Support requests open" value={n(d.support?.open)} sub={d.support ? `${n(d.support.overdue)} overdue` : ''} warn={d.support?.overdue > 0} />
        <Tile label="Patient files" value={n(d.records?.overdue)} sub={d.records ? `overdue · ${n(d.records.missing)} missing` : ''} warn={d.records?.missing > 0} />
        <Tile label="Controlled drugs not witnessed (> 4 h)" value={n(d.controlled_drugs?.unwitnessed_over_4h)} warn={d.controlled_drugs?.unwitnessed_over_4h > 0} />
      </Section>
      <div style={s.sub}>“—” means the figure is not available in this hospital's database (module not installed or not in use).</div>
    </div>
  )
}

function Matron({ hospitalId }) {
  const [d, err] = useRpc('matron_dashboard', { p_hospital: hospitalId }, [hospitalId])
  if (err) return <div role="alert" style={s.err}>{err}</div>
  if (!d) return <div style={s.sub}>Loading…</div>
  const o = d.observations || {}, r = d.risks || {}, cp = d.care_plans || {}
  return (
    <div style={s.card}>
      <Section title="Early warning (latest observations, 48 h)">
        <Tile label="High score" value={n(o.high)} warn={o.high > 0} /><Tile label="Medium" value={n(o.medium)} />
        <Tile label="Observations overdue" value={n(o.overdue)} warn={o.overdue > 0} /><Tile label="Escalation not recorded" value={n(o.not_escalated)} warn={o.not_escalated > 0} />
        <Tile label="High falls risk" value={n(r.falls_high)} /><Tile label="High pressure-injury risk" value={n(r.pressure_high)} />
        <Tile label="Care plans active" value={n(cp.active)} sub={cp.active !== undefined ? `${n(cp.review_overdue)} review overdue` : ''} warn={cp.review_overdue > 0} />
        <Tile label="Medicines overdue > 1 h" value={n(d.meds_due?.overdue)} warn={d.meds_due?.overdue > 0} />
      </Section>
      <div style={s.label}>Wards</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead><tr>{['Ward', 'Beds', 'Occupied', 'Occupancy', 'Being cleaned'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>{(d.wards || []).map((w) => <tr key={w.ward}><td style={s.td}>{w.ward}</td><td style={s.td}>{w.beds}</td><td style={s.td}>{w.occupied}</td>
          <td style={{ ...s.td, color: w.beds && w.occupied / w.beds > 0.9 ? C.danger : undefined, fontWeight: 700 }}>{pct(w.occupied, w.beds)}</td><td style={s.td}>{w.cleaning}</td></tr>)}</tbody>
      </table>
      <div style={s.label}>Patients with a high or medium score</div>
      {(d.deteriorating || []).map((p, i) => (
        <div key={i} style={{ fontSize: 13, padding: '4px 0', borderTop: `1px solid ${C.border}` }}>
          <Chip tone={p.level === 'high' ? 'red' : 'yellow'}>{String(p.scale).toUpperCase()} {p.score}</Chip> <b>{p.patient}</b> · bed {p.bed || '—'} · {new Date(p.observed_at).toLocaleString('en-KE')}
          {!p.escalated_to && <b style={{ color: C.danger }}> · not escalated</b>}
        </div>
      ))}
      {!(d.deteriorating || []).length && <div style={s.sub}>{d.deteriorating ? 'No patients with a high or medium score.' : '—'}</div>}
    </div>
  )
}

function Pharmacy({ hospitalId }) {
  const [d, err] = useRpc('pharmacy_dashboard', { p_hospital: hospitalId }, [hospitalId])
  if (err) return <div role="alert" style={s.err}>{err}</div>
  if (!d) return <div style={s.sub}>Loading…</div>
  const st = d.stock || {}, ex = d.expiry || {}, rx = d.prescriptions || {}, cd = d.controlled || {}, tu = d.topups || {}
  return (
    <div style={s.card}>
      <Section title="Stock">
        <Tile label="Stock-outs" value={n(st.stock_outs)} warn={st.stock_outs > 0} /><Tile label="Below reorder level" value={n(st.below_reorder)} />
        <Tile label="Expired still on shelf" value={n(ex.expired_on_shelf)} warn={ex.expired_on_shelf > 0} /><Tile label="Expiring ≤ 30 days" value={n(ex.d30)} />
        <Tile label="Expiring 31–90 days" value={n(ex.d90)} sub={ex.value_90d !== undefined ? `value ≤ 90 days ${kes(ex.value_90d)}` : ''} />
      </Section>
      <Section title="Work">
        <Tile label="Prescriptions pending" value={n(rx.pending)} /><Tile label="Approved, not dispensed" value={n(rx.approved)} /><Tile label="Dispensed today" value={n(rx.dispensed_today)} />
        <Tile label="Ward top-ups to issue" value={n(tu.waiting_issue)} /><Tile label="Controlled entries not witnessed" value={n(cd.unwitnessed)} sub={cd.unwitnessed !== undefined ? `${n(cd.unwitnessed_over_4h)} over 4 h · ${n(cd.discrepancies_30d)} count discrepancies (30 d)` : ''} warn={cd.unwitnessed_over_4h > 0} />
      </Section>
      <div style={s.grid(320)}>
        <div><div style={s.label}>Out of stock / below reorder</div>{(d.stock_outs || []).map((x) => <div key={x.drug_name} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}><span>{x.drug_name}</span><b style={{ color: Number(x.quantity) <= 0 ? C.danger : undefined }}>{x.quantity}{x.reorder_level ? ` / ${x.reorder_level}` : ''}</b></div>)}</div>
        <div><div style={s.label}>Expiring within 60 days</div>{(d.expiring || []).map((x, i) => <div key={i} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}><span>{x.drug_name} · {x.batch_number}</span><b style={{ color: new Date(x.expiry_date) < new Date() ? C.danger : undefined }}>{x.expiry_date} · {x.quantity_remaining}</b></div>)}</div>
      </div>
    </div>
  )
}

function Claims({ hospitalId, range }) {
  const [d, err] = useRpc('claims_dashboard', { p_hospital: hospitalId, p_from: range.from, p_to: range.to }, [hospitalId, range.from, range.to])
  if (err) return <div role="alert" style={s.err}>{err}</div>
  if (!d) return <div style={s.sub}>Loading…</div>
  const ag = d.aging || {}
  return (
    <div style={s.card}>
      <Section title="Unpaid insurer / SHA bills by age">
        <Tile label="0–30 days" value={kes(ag.d0_30)} /><Tile label="31–60 days" value={kes(ag.d31_60)} />
        <Tile label="61–90 days" value={kes(ag.d61_90)} warn={ag.d61_90 > 0} /><Tile label="Over 90 days" value={kes(ag.d90_plus)} warn={ag.d90_plus > 0} />
      </Section>
      <div style={s.label}>Billing by payer</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead><tr>{['Payer', 'Bills', 'Billed', 'Outstanding'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
        <tbody>{(d.by_payer || []).map((p) => <tr key={p.payer}><td style={s.td}>{p.payer}</td><td style={s.td}>{p.invoices}</td><td style={s.td}>{kes(p.billed)}</td><td style={{ ...s.td, fontWeight: 700 }}>{kes(p.outstanding)}</td></tr>)}</tbody>
      </table>
      <div style={s.grid(320)}>
        <div><div style={s.label}>SHA claims by status</div>{d.sha_claims ? (d.sha_claims.length ? d.sha_claims.map((c) => <div key={c.status} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between' }}><span>{c.status}</span><b>{c.claims} · {kes(c.amount)}</b></div>) : <div style={s.sub}>No claims in this period.</div>) : <div style={s.sub}>—</div>}</div>
        <div><div style={s.label}>Top rejection reasons</div>{d.rejections ? (d.rejections.length ? d.rejections.map((r) => <div key={r.reason} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between' }}><span>{r.reason}</span><b>{r.claims}</b></div>) : <div style={s.sub}>No rejections.</div>) : <div style={s.sub}>—</div>}</div>
      </div>
    </div>
  )
}
