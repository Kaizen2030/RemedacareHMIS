import { useEffect, useMemo, useState } from 'react'
import SkeletonLoader from '../components/SkeletonLoader'
import supabase from '../supabase'
import { useHospital } from '../context'
import { executeWithFallback } from '../utils/dbCompat'
import { buildAmrInterventions, summarizeAmrInterventions } from '../utils/hospitalSignals'
import { executeMicrobiologyQuery } from '../utils/microbiologyResults'
import { colors as C, typography } from '../theme'

const PAY_COLORS = {
  Cash: C.primary,
  'M-Pesa': '#059669',
  Insurance: C.blue,
  SHA: C.warn,
  'SHA (Social Health Authority)': C.warn,
  Credit: C.purple,
}

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
    marginBottom: '4px',
    gap: '12px',
    flexWrap: 'wrap',
  },
  h1: { fontSize: '18px', fontWeight: 700, margin: 0 },
  subtext: { fontSize: '12px', color: C.sub, marginBottom: '16px' },
  alertRow: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' },
  alertChip: {
    borderRadius: '999px',
    border: 'none',
    padding: '7px 12px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '12px',
    marginBottom: '20px',
  },
  kpiCard: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: '10px',
    padding: '14px 16px',
  },
  kpiLbl: {
    fontSize: '11px',
    color: C.sub,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '.5px',
    marginBottom: '4px',
  },
  kpiVal: { fontSize: '20px', fontWeight: 800, letterSpacing: '-0.5px' },
  kpiSub: { fontSize: '11px', color: C.muted, marginTop: '3px' },
  row: { display: 'flex', gap: '16px', marginBottom: '16px', alignItems: 'flex-start', flexWrap: 'wrap' },
  card: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: '10px',
    overflow: 'hidden',
    marginBottom: '0',
  },
  cardHead: {
    padding: '12px 16px',
    borderBottom: `1px solid ${C.border}`,
    fontSize: '13px',
    fontWeight: 600,
    color: C.text,
    background: '#FAFBFD',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
  },
  cardBody: { padding: '12px 16px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    padding: '9px 14px',
    textAlign: 'left',
    fontSize: '11px',
    fontWeight: 700,
    color: C.sub,
    textTransform: 'uppercase',
    letterSpacing: '.5px',
    borderBottom: `2px solid ${C.border}`,
    background: '#FAFBFD',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '11px 14px',
    borderBottom: `1px solid ${C.border}`,
    fontSize: '13px',
    verticalAlign: 'middle',
  },
  pill: {
    display: 'inline-block',
    padding: '2px 9px',
    borderRadius: '20px',
    fontSize: '11px',
    fontWeight: 600,
  },
  btn: {
    padding: '8px 14px',
    borderRadius: '7px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '12px',
    whiteSpace: 'nowrap',
  },
  btnPri: { background: C.primary, color: '#fff' },
  btnGhost: { background: C.surface, border: `1px solid ${C.border}`, color: C.text },
  progressTrack: { height: '6px', background: '#F0F0F0', borderRadius: '99px', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: '99px', transition: 'width 0.4s ease' },
  empty: { color: C.muted, textAlign: 'center', padding: '30px 0', fontSize: '13px' },
}

function formatKES(value) {
  return `KES ${Number(value || 0).toLocaleString()}`
}

function pillStyle(bg, color) {
  return { ...css.pill, background: bg, color }
}

function KPICard({ label, value, color, sub, onClick }) {
  const interactive = typeof onClick === 'function'
  return (
    <button
      type="button"
      onClick={interactive ? onClick : undefined}
      style={{
        ...css.kpiCard,
        textAlign: 'left',
        cursor: interactive ? 'pointer' : 'default',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        boxShadow: interactive ? '0 1px 4px rgba(0,0,0,.04)' : 'none',
      }}
    >
      <div style={css.kpiLbl}>{label}</div>
      <div style={{ ...css.kpiVal, color: color || C.text }}>{value}</div>
      {sub && <div style={css.kpiSub}>{sub}</div>}
    </button>
  )
}

function AlertChip({ color, label, onClick }) {
  const palette = {
    green: { bg: C.primaryL, color: C.primary },
    yellow: { bg: C.warnL, color: C.warn },
    red: { bg: C.dangerL, color: C.danger },
    blue: { bg: C.blueL, color: C.blue },
    purple: { bg: C.purpleL, color: C.purple },
  }[color] || { bg: '#F3F4F6', color: C.sub }

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...css.alertChip, background: palette.bg, color: palette.color }}
    >
      {label}
    </button>
  )
}

export default function Dashboard() {
  const { hospitalId, navigate } = useHospital()
  const [stats, setStats] = useState({
    revenue: 0,
    transactions: 0,
    patients: 0,
    labs: 0,
    pendingRx: 0,
    approvedRx: 0,
    lowStock: 0,
    discharged: 0,
    unpaidInvoices: 0,
    activeAdmissions: 0,
    doctorQueue: 0,
    pendingReferrals: 0,
    freeBeds: 0,
    occupiedBeds: 0,
    criticalBeds: 0,
    maintenanceBeds: 0,
    pendingMpesa: 0,
    pendingSha: 0,
    pendingInsurance: 0,
    pendingStewardship: 0,
  })
  const [weeklyRevenue, setWeeklyRevenue] = useState([])
  const [recentSales, setRecentSales] = useState([])
  const [recentAdmissions, setRecentAdmissions] = useState([])
  const [pendingLabs, setPendingLabs] = useState([])
  const [pendingRxQueue, setPendingRxQueue] = useState([])
  const [bedMap, setBedMap] = useState([])
  const [payBreakdown, setPayBreakdown] = useState([])
  const [loading, setLoading] = useState(true)
  const [hoveredBar, setHoveredBar] = useState(null)
  const [financeRecon, setFinanceRecon] = useState({ cash: 0, mpesa: 0, sha: 0, insurance: 0, credit: 0, total: 0 })

  useEffect(() => {
    if (!hospitalId) { setLoading(false); return }
    fetchDashboard()
    const timer = setInterval(fetchDashboard, 60000)
    const localHandler = () => fetchDashboard(false)
    const channel = supabase
      .channel(`dashboard-live-${hospitalId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `hospital_id=eq.${hospitalId}` }, () => fetchDashboard(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admissions', filter: `hospital_id=eq.${hospitalId}` }, () => fetchDashboard(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'beds', filter: `hospital_id=eq.${hospitalId}` }, () => fetchDashboard(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prescriptions', filter: `hospital_id=eq.${hospitalId}` }, () => fetchDashboard(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lab_tests', filter: `hospital_id=eq.${hospitalId}` }, () => fetchDashboard(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices', filter: `hospital_id=eq.${hospitalId}` }, () => fetchDashboard(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_ledger', filter: `hospital_id=eq.${hospitalId}` }, () => fetchDashboard(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pharmacy_inventory', filter: `hospital_id=eq.${hospitalId}` }, () => fetchDashboard(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mpesa_transactions', filter: `hospital_id=eq.${hospitalId}` }, () => fetchDashboard(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sha_claims', filter: `hospital_id=eq.${hospitalId}` }, () => fetchDashboard(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'insurance_claims', filter: `hospital_id=eq.${hospitalId}` }, () => fetchDashboard(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'microbiology_results', filter: `hospital_id=eq.${hospitalId}` }, () => fetchDashboard(false))
      .subscribe()

    window.addEventListener('remedacare:workflow_changed', localHandler)
    window.addEventListener('remedacare:prescriptions_changed', localHandler)
    window.addEventListener('remedacare:antibiogram_updated', localHandler)
    window.addEventListener('remedacare:stewardship_changed', localHandler)

    return () => {
      clearInterval(timer)
      try { supabase.removeChannel(channel) } catch (_) {}
      window.removeEventListener('remedacare:workflow_changed', localHandler)
      window.removeEventListener('remedacare:prescriptions_changed', localHandler)
      window.removeEventListener('remedacare:antibiogram_updated', localHandler)
      window.removeEventListener('remedacare:stewardship_changed', localHandler)
    }
  }, [hospitalId])

  async function fetchDashboard(showSpinner = true) {
    if (!hospitalId) return
    if (showSpinner) setLoading(true)

    try {
      const today = new Date()
      const todayIso = today.toISOString().split('T')[0]
      const weekStart = new Date(today)
      weekStart.setDate(today.getDate() - 6)
      const weekStartIso = weekStart.toISOString().split('T')[0]

      const [
        salesTodayResult,
        salesWeekResult,
        patientCountResult,
        pendingLabsCountResult,
        pendingLabsResult,
        pendingRxCountResult,
        pendingRxResult,
        approvedRxCountResult,
        stockRowsResult,
        unpaidCountResult,
        dischargedCountResult,
        activeAdmissionsCountResult,
        activeAdmissionsResult,
        doctorQueueCountResult,
        referralCountResult,
        bedRowsResult,
        mpesaPendingCountResult,
        invoicesTodayResult,
        shaPendingCountResult,
        insurancePendingCountResult,
        microbiologyResultsResult,
        activePrescriptionResult,
        stewardshipInterventionsResult,
      ] = await Promise.all([
        supabase
          .from('sales_ledger')
          .select('*')
          .eq('hospital_id', hospitalId)
          .gte('sold_at', todayIso)
          .order('sold_at', { ascending: false }),
        supabase
          .from('sales_ledger')
          .select('sold_at, total_kes, payment_method')
          .eq('hospital_id', hospitalId)
          .gte('sold_at', weekStartIso),
        supabase
          .from('patients')
          .select('id', { count: 'exact', head: true })
          .eq('hospital_id', hospitalId),
        supabase
          .from('lab_tests')
          .select('id', { count: 'exact', head: true })
          .eq('hospital_id', hospitalId)
          .in('status', ['Pending', 'In Progress', 'Critical']),
        supabase
          .from('lab_tests')
          .select('id, test_type, patient_name, priority, status, ordered_at, visit_id')
          .eq('hospital_id', hospitalId)
          .in('status', ['Pending', 'In Progress', 'Critical'])
          .order('ordered_at', { ascending: false })
          .limit(6),
        supabase
          .from('prescriptions')
          .select('id', { count: 'exact', head: true })
          .eq('hospital_id', hospitalId)
          .eq('status', 'Pending'),
        supabase
          .from('prescriptions')
          .select('id, drug_name, status, patient_name, created_at, patients(full_name), visits(visit_number, status)')
          .eq('hospital_id', hospitalId)
          .in('status', ['Pending', 'Approved'])
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('prescriptions')
          .select('id', { count: 'exact', head: true })
          .eq('hospital_id', hospitalId)
          .eq('status', 'Approved'),
        supabase
          .from('pharmacy_inventory')
          .select('id, quantity_in_stock, reorder_level'),
        supabase
          .from('invoices')
          .select('id', { count: 'exact', head: true })
          .eq('hospital_id', hospitalId)
          .in('status', ['Pending', 'Partial']),
        supabase
          .from('admissions')
          .select('id', { count: 'exact', head: true })
          .eq('hospital_id', hospitalId)
          .eq('status', 'Discharged')
          .gte('discharge_date', todayIso),
        supabase
          .from('admissions')
          .select('id', { count: 'exact', head: true })
          .eq('hospital_id', hospitalId)
          .eq('status', 'Active'),
        supabase
          .from('admissions')
          .select('id, admission_date, ward, bed_no, diagnosis, visit_id, patients(full_name, phone)')
          .eq('hospital_id', hospitalId)
          .eq('status', 'Active')
          .order('admission_date', { ascending: false })
          .limit(20),
        supabase
          .from('visits')
          .select('id', { count: 'exact', head: true })
          .eq('hospital_id', hospitalId)
          .eq('status', 'Doctor'),
        supabase
          .from('visits')
          .select('id', { count: 'exact', head: true })
          .eq('hospital_id', hospitalId)
          .eq('status', 'Doctor')
          .eq('outcome', 'Referred'),
        supabase
          .from('beds')
          .select('status')
          .eq('hospital_id', hospitalId),
        supabase
          .from('mpesa_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('hospital_id', hospitalId)
          .eq('status', 'Pending'),
        supabase
          .from('invoices')
          .select('payment_method, paid_kes, amount_kes, balance_kes, status, created_at')
          .eq('hospital_id', hospitalId)
          .gte('created_at', new Date().toISOString().split('T')[0]),
        supabase
          .from('sha_claims')
          .select('id', { count: 'exact', head: true })
          .eq('hospital_id', hospitalId)
          .in('status', ['Pending', 'Submitted', 'Under Review', 'Appealed']),
        supabase
          .from('insurance_claims')
          .select('id', { count: 'exact', head: true })
          .eq('hospital_id', hospitalId)
          .in('status', ['Draft', 'Pending', 'Pre-auth', 'Submitted', 'Under Review', 'Appealed']),
        executeMicrobiologyQuery(select =>
          supabase
            .from('microbiology_results')
            .select(select)
            .eq('hospital_id', hospitalId)
            .order('updated_at', { ascending: false })
            .limit(80),
        ),
        supabase
          .from('prescriptions')
          .select('id, patient_id, patient_name, drug_name, status')
          .eq('hospital_id', hospitalId)
          .in('status', ['Pending', 'Approved', 'Released'])
          .order('created_at', { ascending: false })
          .limit(200),
        executeWithFallback(
          () => supabase
            .from('stewardship_interventions')
            .select('*')
            .eq('hospital_id', hospitalId)
            .order('created_at', { ascending: false })
            .limit(120),
          async () => ({ data: [], error: null, compatFallback: true }),
        ),
      ])

      const salesToday = salesTodayResult.data || []
      const salesWeek = salesWeekResult.data || []
      const pendingLabRows = pendingLabsResult.data || []
      const pendingRxRows = pendingRxResult.data || []
      const stockRows = stockRowsResult.data || []
      const activeAdmissions = activeAdmissionsResult.data || []
      const bedRows = bedRowsResult.data || []
      const stewardshipItems = buildAmrInterventions({
        results: microbiologyResultsResult.data || [],
        prescriptions: activePrescriptionResult.data || [],
        interventions: stewardshipInterventionsResult.data || [],
        maxAgeDays: 21,
      })
      const stewardshipSummary = summarizeAmrInterventions(stewardshipItems)

      const revenue = salesToday.reduce((sum, sale) => sum + Number(sale.total_kes || 0), 0)

      const days = []
      for (let i = 6; i >= 0; i -= 1) {
        const day = new Date(today)
        day.setDate(today.getDate() - i)
        days.push({
          label: day.toLocaleDateString('en-KE', { weekday: 'short' }),
          date: day.toISOString().split('T')[0],
          amount: 0,
        })
      }

      const payMethods = {}
      salesWeek.forEach(sale => {
        const dateKey = sale.sold_at?.split('T')[0]
        const day = days.find(item => item.date === dateKey)
        const amount = Number(sale.total_kes || 0)
        if (day) day.amount += amount

        const method = sale.payment_method || 'Cash'
        payMethods[method] = (payMethods[method] || 0) + amount
      })

      const totalPay = Object.values(payMethods).reduce((sum, amount) => sum + amount, 0) || 1
      const lowStockCount = stockRows.filter(item => {
        const qty = Number(item.quantity_in_stock || 0)
        const reorder = Number(item.reorder_level || 10)
        return qty <= reorder
      }).length

      const bedStats = { free: 0, occupied: 0, critical: 0, maintenance: 0 }
      bedRows.forEach(row => {
        const key = String(row.status || 'Free').toLowerCase()
        if (bedStats[key] !== undefined) bedStats[key] += 1
      })

      const wardGroups = activeAdmissions.reduce((acc, admission) => {
        const ward = admission.ward || 'General'
        acc[ward] = acc[ward] || []
        acc[ward].push(admission)
        return acc
      }, {})

      // Finance reconciliation for today
      const invToday = invoicesTodayResult?.data || []
      const recon = invToday.reduce((acc, inv) => {
        const method = (inv.payment_method || '').toLowerCase()
        const paid = Number(inv.paid_kes || 0)
        const amount = Number(inv.amount_kes || 0)
        if (method === 'cash') acc.cash += paid
        else if (method === 'm-pesa') acc.mpesa += paid
        else if (method.includes('sha')) acc.sha += amount
        else if (method === 'credit') acc.credit += amount
        else acc.insurance += amount
        acc.total += paid
        return acc
      }, { cash: 0, mpesa: 0, sha: 0, insurance: 0, credit: 0, total: 0 })
      setFinanceRecon(recon)

      setStats({
        revenue,
        transactions: salesToday.length,
        patients: patientCountResult.count || 0,
        labs: pendingLabsCountResult.count || 0,
        pendingRx: pendingRxCountResult.count || 0,
        approvedRx: approvedRxCountResult.count || 0,
        lowStock: lowStockCount,
        discharged: dischargedCountResult.count || 0,
        unpaidInvoices: unpaidCountResult.count || 0,
        activeAdmissions: activeAdmissionsCountResult.count || 0,
        doctorQueue: doctorQueueCountResult.count || 0,
        pendingReferrals: referralCountResult.count || 0,
        freeBeds: bedStats.free,
        occupiedBeds: bedStats.occupied,
        criticalBeds: bedStats.critical,
        maintenanceBeds: bedStats.maintenance,
        pendingMpesa: mpesaPendingCountResult.count || 0,
        pendingSha: shaPendingCountResult.count || 0,
        pendingInsurance: insurancePendingCountResult.count || 0,
        pendingStewardship: stewardshipSummary.needingAttention || stewardshipSummary.pendingReview || 0,
      })

      setWeeklyRevenue(days)
      setRecentSales(salesToday.slice(0, 6))
      setPendingLabs(pendingLabRows)
      setPendingRxQueue(pendingRxRows)
      setRecentAdmissions(activeAdmissions)
      setBedMap(Object.entries(wardGroups).slice(0, 5))
      setPayBreakdown(
        Object.entries(payMethods)
          .sort((a, b) => b[1] - a[1])
          .map(([method, amount]) => ({
            method,
            amount,
            pct: Math.round((amount / totalPay) * 100),
          })),
      )
    } catch (err) {
      console.error('Dashboard error:', err)
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  const alerts = useMemo(() => {
    const next = []
    if (stats.doctorQueue > 0) next.push({ color: 'purple', label: `${stats.doctorQueue} waiting for doctor`, screen: 'consultation' })
    if (stats.labs > 0) next.push({ color: 'yellow', label: `${stats.labs} pending lab results`, screen: 'lab' })
    if (stats.pendingRx > 0) next.push({ color: 'yellow', label: `${stats.pendingRx} pending Rx review`, screen: 'pharmacy' })
    if (stats.approvedRx > 0) next.push({ color: 'blue', label: `${stats.approvedRx} approved Rx ready`, screen: 'pharmacy' })
    if (stats.pendingStewardship > 0) next.push({ color: 'red', label: `${stats.pendingStewardship} AMR stewardship alerts`, screen: 'pharmacy' })
    if (stats.lowStock > 0) next.push({ color: 'red', label: `${stats.lowStock} low stock items`, screen: 'inventory' })
    if (stats.unpaidInvoices > 0) next.push({ color: 'red', label: `${stats.unpaidInvoices} unpaid invoices`, screen: 'billing' })
    if (stats.pendingMpesa > 0) next.push({ color: 'blue', label: `${stats.pendingMpesa} M-Pesa confirmations`, screen: 'mpesa' })
    if (stats.pendingSha > 0) next.push({ color: 'yellow', label: `${stats.pendingSha} SHA claims pending`, screen: 'sha' })
    if (stats.pendingInsurance > 0) next.push({ color: 'purple', label: `${stats.pendingInsurance} insurance follow-ups`, screen: 'insurance' })
    return next
  }, [stats])

  const maxRev = Math.max(...weeklyRevenue.map(d => d.amount), 1)
  const todayStr = new Date().toLocaleDateString('en-KE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  if (loading) {
    return (
      <div style={{ height: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
        <div style={{ width: '220px' }}>
          <SkeletonLoader rows={3} height={14} width={['40%', '100%', '65%']} />
        </div>
        <p style={{ color: C.sub, marginTop: 12, fontSize: '13px' }}>Loading dashboard...</p>
      </div>
    )
  }

  return (
    <div style={css.page}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}} tr:hover td{background:#FAFBFD}'}</style>
      <div style={css.wrap}>
        <div style={css.header}>
          <div>
            <h1 style={css.h1}>Dashboard</h1>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ ...css.btn, ...css.btnGhost }} onClick={() => fetchDashboard()}>Refresh</button>
            <button style={{ ...css.btn, ...css.btnPri }} onClick={() => navigate?.('patients')}>+ Admit Patient</button>
          </div>
        </div>

        <div style={css.subtext}>{todayStr} - auto-refreshes every 60 seconds</div>

        {alerts.length > 0 && (
          <div style={css.alertRow}>
            {alerts.map(alert => (
              <AlertChip
                key={`${alert.screen}-${alert.label}`}
                color={alert.color}
                label={alert.label}
                onClick={() => navigate?.(alert.screen)}
              />
            ))}
          </div>
        )}

        <div style={css.kpiGrid}>
          <KPICard label="Today's Revenue" value={formatKES(stats.revenue)} color={C.primary} onClick={() => navigate?.('billing')} />
          <KPICard label="Transactions" value={stats.transactions} color={C.blue} sub="Sales today" onClick={() => navigate?.('billing')} />
          <KPICard label="Registered Patients" value={stats.patients} color={C.purple} onClick={() => navigate?.('patients')} />
          <KPICard label="Active Admissions" value={stats.activeAdmissions} color={C.primary} sub="Inpatients" onClick={() => navigate?.('wards')} />
          <KPICard label="Doctor Queue" value={stats.doctorQueue} color={stats.doctorQueue > 0 ? C.warn : C.muted} sub="Awaiting review" onClick={() => navigate?.('consultation')} />
          <KPICard label="Pending Rx" value={stats.pendingRx} color={stats.pendingRx > 0 ? C.warn : C.muted} sub="Awaiting pharmacist review" onClick={() => navigate?.('pharmacy')} />
          <KPICard label="Approved Rx" value={stats.approvedRx} color={stats.approvedRx > 0 ? C.blue : C.muted} sub="Ready for release" onClick={() => navigate?.('pharmacy')} />
          <KPICard label="Pending Labs" value={stats.labs} color={stats.labs > 0 ? C.warn : C.muted} sub={stats.labs > 0 ? 'Awaiting results' : 'All clear'} onClick={() => navigate?.('lab')} />
          <KPICard label="Free Beds" value={stats.freeBeds} color={stats.freeBeds > 0 ? C.primary : C.danger} sub={stats.freeBeds > 0 ? 'Available now' : 'No free beds'} onClick={() => navigate?.('wards')} />
          <KPICard label="Low Stock Items" value={stats.lowStock} color={stats.lowStock > 0 ? C.danger : C.muted} sub={stats.lowStock > 0 ? 'Below reorder level' : 'Stock OK'} onClick={() => navigate?.('inventory')} />
          <KPICard label="Discharged Today" value={stats.discharged} color={C.primary} onClick={() => navigate?.('wards')} />
          <KPICard label="Unpaid Invoices" value={stats.unpaidInvoices} color={stats.unpaidInvoices > 0 ? C.danger : C.muted} sub={stats.unpaidInvoices > 0 ? 'Needs billing follow-up' : 'All settled'} onClick={() => navigate?.('billing')} />
        </div>

        {/* ── Finance Reconciliation Panel ── */}
        <div style={{ background: '#fff', border: '1px solid #E8ECF2', borderRadius: '12px', marginBottom: '16px', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E8ECF2', background: '#FAFBFD', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: '13px' }}>Today's Finance Reconciliation</span>
            <button style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #E8ECF2', background: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }} onClick={() => navigate?.('billing')}>View Billing →</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 0 }}>
            {[
              { lbl: 'Cash', val: financeRecon.cash, color: '#374151', bg: '#F9FAFB', icon: '💵' },
              { lbl: 'M-Pesa', val: financeRecon.mpesa, color: '#16A34A', bg: '#F0FDF4', icon: '📱' },
              { lbl: 'SHA', val: financeRecon.sha, color: '#2563EB', bg: '#EFF6FF', icon: '🏥' },
              { lbl: 'Insurance', val: financeRecon.insurance, color: '#D97706', bg: '#FFFBEB', icon: '🛡️' },
              { lbl: 'Credit', val: financeRecon.credit, color: '#7C3AED', bg: '#F5F3FF', icon: '📋' },
              { lbl: 'Total Collected', val: financeRecon.total, color: '#16A34A', bg: '#F0FDF4', icon: '✅' },
            ].map(({ lbl, val, color, bg, icon }, i, arr) => (
              <div key={lbl} style={{ padding: '14px 16px', background: bg, borderRight: i < arr.length - 1 ? '1px solid #E8ECF2' : 'none' }}>
                <div style={{ fontSize: '11px', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '6px' }}>{icon} {lbl}</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color, letterSpacing: '-0.5px' }}>KES {Number(val || 0).toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '10px 16px', background: '#F8FAFC', borderTop: '1px solid #E8ECF2', display: 'flex', gap: '20px' }}>
            <span style={{ fontSize: '12px', color: '#6B7280' }}>
              SHA Pending: <strong style={{ color: '#2563EB' }}>{stats.pendingSha}</strong> claims
            </span>
            <span style={{ fontSize: '12px', color: '#6B7280' }}>
              Insurance Pending: <strong style={{ color: '#D97706' }}>{stats.pendingInsurance}</strong> claims
            </span>
            <span style={{ fontSize: '12px', color: '#6B7280' }}>
              M-Pesa Unconfirmed: <strong style={{ color: '#DC2626' }}>{stats.pendingMpesa}</strong>
            </span>
            <span style={{ fontSize: '12px', color: '#6B7280' }}>
              Unpaid Invoices: <strong style={{ color: '#DC2626' }}>{stats.unpaidInvoices}</strong>
            </span>
            <span onClick={() => navigate?.('sha')} style={{ fontSize: '12px', color: '#2563EB', cursor: 'pointer', marginLeft: 'auto', fontWeight: 600 }}>SHA Claims →</span>
            <span onClick={() => navigate?.('insurance')} style={{ fontSize: '12px', color: '#D97706', cursor: 'pointer', fontWeight: 600 }}>Insurance →</span>
            <span onClick={() => navigate?.('mpesa')} style={{ fontSize: '12px', color: '#16A34A', cursor: 'pointer', fontWeight: 600 }}>M-Pesa →</span>
          </div>
        </div>

        <div style={css.row}>
          <div style={{ ...css.card, flex: 2, minWidth: '360px' }}>
            <div style={css.cardHead}>
              <span>Weekly Revenue</span>
              <span style={{ fontSize: '12px', color: C.sub }}>Last 7 days</span>
            </div>
            <div style={{ padding: '16px 20px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', height: '160px', gap: '8px', position: 'relative' }}>
                {weeklyRevenue.map((day, index) => {
                  const h = (day.amount / maxRev) * 100 || 4
                  const isToday = index === 6
                  const isHovered = hoveredBar === index
                  return (
                    <div
                      key={day.date}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', cursor: 'default' }}
                      onMouseEnter={() => setHoveredBar(index)}
                      onMouseLeave={() => setHoveredBar(null)}
                    >
                      {isHovered && day.amount > 0 && (
                        <div style={{ position: 'absolute', top: '-28px', background: C.text, color: '#fff', fontSize: '11px', padding: '3px 8px', borderRadius: '4px', whiteSpace: 'nowrap', zIndex: 10 }}>
                          {formatKES(day.amount)}
                        </div>
                      )}
                      <div style={{ fontSize: '10px', color: C.muted, height: '16px', textAlign: 'center' }}>
                        {day.amount > 0 ? `${(day.amount / 1000).toFixed(1)}k` : ''}
                      </div>
                      <div style={{ height: '120px', width: '100%', background: '#F3F4F6', borderRadius: '4px', display: 'flex', alignItems: 'flex-end' }}>
                        <div
                          style={{
                            width: '100%',
                            height: `${h}%`,
                            borderRadius: '4px 4px 0 0',
                            background: isToday ? C.primary : '#86EFAC',
                            opacity: isHovered ? 0.85 : 1,
                            transition: 'height 0.3s ease',
                          }}
                        />
                      </div>
                      <div style={{ fontSize: '11px', marginTop: '6px', color: isToday ? C.primary : C.sub, fontWeight: isToday ? 600 : 400 }}>
                        {day.label}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div style={{ ...css.card, flex: 1, minWidth: '280px' }}>
            <div style={css.cardHead}>
              <span>Recent Sales</span>
              <span style={{ fontSize: '12px', color: C.sub }}>Today</span>
            </div>
            <div style={{ padding: '0 16px' }}>
              {recentSales.length === 0 ? (
                <p style={css.empty}>No sales today</p>
              ) : recentSales.map((sale, index) => (
                <div key={`${sale.id || index}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: C.text }}>{sale.drug_name || 'Service'}</div>
                    <div style={{ fontSize: '11px', color: C.sub, marginTop: '2px' }}>
                      {(sale.payment_method || 'Cash')} - {(sale.quantity || sale.qty_sold || 1)} unit(s)
                    </div>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: C.primary }}>{formatKES(sale.total_kes || 0)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={css.row}>
          <div style={{ ...css.card, flex: 1, minWidth: '280px' }}>
            <div style={css.cardHead}>
              <span>Pending Labs</span>
              <span style={pillStyle(C.warnL, C.warn)}>{stats.labs}</span>
            </div>
            <div style={{ padding: '0 16px' }}>
              {pendingLabs.length === 0 ? (
                <p style={css.empty}>No pending tests</p>
              ) : pendingLabs.map(lab => (
                <div key={lab.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: C.text }}>{lab.test_type || 'Lab Test'}</div>
                    <div style={{ fontSize: '11px', color: C.sub, marginTop: '2px' }}>{lab.patient_name || '-'}</div>
                  </div>
                  <span style={pillStyle(lab.priority === 'STAT' ? C.dangerL : lab.priority === 'Urgent' ? C.warnL : '#F3F4F6', lab.priority === 'STAT' ? C.danger : lab.priority === 'Urgent' ? C.warn : C.sub)}>
                    {lab.priority || 'Routine'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...css.card, flex: 1, minWidth: '280px' }}>
            <div style={css.cardHead}>
              <span>Prescription Queue</span>
              <span style={pillStyle(C.blueL, C.blue)}>{stats.pendingRx + stats.approvedRx}</span>
            </div>
            <div style={{ padding: '0 16px' }}>
              {pendingRxQueue.length === 0 ? (
                <p style={css.empty}>No prescriptions waiting</p>
              ) : pendingRxQueue.map(rx => (
                <div key={rx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: C.text }}>{rx.drug_name}</div>
                    <div style={{ fontSize: '11px', color: C.sub, marginTop: '2px' }}>
                      {rx.patients?.full_name || rx.patient_name || '-'}
                      {rx.visits?.visit_number ? ` - ${rx.visits.visit_number}` : ''}
                    </div>
                  </div>
                  <span style={pillStyle(rx.status === 'Approved' ? C.blueL : C.warnL, rx.status === 'Approved' ? C.blue : C.warn)}>
                    {rx.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...css.card, flex: 1, minWidth: '280px' }}>
            <div style={css.cardHead}>
              <span>Payment Mix</span>
              <span style={{ fontSize: '12px', color: C.sub }}>This week</span>
            </div>
            <div style={{ padding: '12px 16px' }}>
              {payBreakdown.length === 0 ? (
                <p style={css.empty}>No transactions yet</p>
              ) : payBreakdown.map(item => (
                <div key={item.method} style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                    <span style={{ fontSize: '13px', color: C.text }}>{item.method}</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: PAY_COLORS[item.method] || C.primary }}>{item.pct}%</span>
                  </div>
                  <div style={css.progressTrack}>
                    <div style={{ ...css.progressFill, width: `${item.pct}%`, background: PAY_COLORS[item.method] || C.primary }} />
                  </div>
                  <div style={{ fontSize: '11px', color: C.muted, marginTop: '3px' }}>{formatKES(item.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={css.row}>
          <div style={{ ...css.card, flex: 1, minWidth: '320px' }}>
            <div style={css.cardHead}>
              <span>Ward Bed Map</span>
              <span style={{ fontSize: '12px', color: C.sub }}>{stats.activeAdmissions} active admission(s)</span>
            </div>
            <div style={{ padding: '12px 16px' }}>
              {bedMap.length === 0 ? (
                <p style={css.empty}>No active inpatients</p>
              ) : bedMap.map(([ward, admissions]) => (
                <div key={ward} style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: C.primary, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {ward} Ward
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {admissions.map(admission => (
                      <button
                        key={admission.id}
                        type="button"
                        title={admission.patients?.full_name || 'Patient'}
                        onClick={() => navigate?.('wards')}
                        style={{ background: C.primaryL, borderRadius: '6px', padding: '6px 10px', textAlign: 'center', minWidth: '54px', border: '1px solid #86EFAC', cursor: 'pointer' }}
                      >
                        <span style={{ fontSize: '11px', fontWeight: 600, color: C.primary }}>{admission.bed_no || '-'}</span>
                        <span style={{ fontSize: '9px', color: C.sub, marginTop: '2px', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {(admission.patients?.full_name || '').split(' ')[0] || 'Patient'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...css.card, flex: 2, minWidth: '420px' }}>
            <div style={css.cardHead}>
              <span>Recent Admissions</span>
              <span style={{ fontSize: '12px', color: C.sub }}>Active inpatients</span>
            </div>
            {recentAdmissions.length === 0 ? (
              <p style={css.empty}>No active admissions</p>
            ) : (
              <table style={css.table}>
                <thead>
                  <tr>
                    {['Patient', 'Ward', 'Bed', 'Diagnosis', 'Admitted'].map(h => (
                      <th key={h} style={css.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentAdmissions.map(admission => (
                    <tr key={admission.id}>
                      <td style={css.td}>
                        <div style={{ fontWeight: 600, color: C.text }}>{admission.patients?.full_name || '-'}</div>
                        <div style={{ fontSize: '11px', color: C.sub }}>{admission.patients?.phone || '-'}</div>
                      </td>
                      <td style={css.td}>{admission.ward || '-'}</td>
                      <td style={css.td}>{admission.bed_no || '-'}</td>
                      <td style={css.td}>{admission.diagnosis || '-'}</td>
                      <td style={css.td}>
                        <span style={pillStyle(C.primaryL, C.primary)}>
                          {admission.admission_date ? new Date(admission.admission_date).toLocaleDateString('en-KE') : '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
