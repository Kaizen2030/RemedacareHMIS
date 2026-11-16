export default function LabReferralsTab({
  referrals = [], pendingReferrals = [], overdueReferrals = [], referralResultsThisMonth = 0,
  search = '', setSearch = () => {}, extractStandaloneReferralTestName = () => 'Standalone referral',
  getReferralDisplayStatus = referral => referral?.status || 'Sent', getPatientNumber = () => '',
  openReferralResultModal = () => {}, markReferralOverdue = () => {}, styles = {},
}) {
  const term = String(search || '').trim().toLowerCase()
  const filtered = referrals.filter(referral => [referral.patient_name, referral.receiving_lab, referral.test_type, extractStandaloneReferralTestName(referral)]
    .some(value => String(value || '').toLowerCase().includes(term)))

  return (
    <section style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
        {[['Open referrals', pendingReferrals.length], ['Overdue', overdueReferrals.length], ['Results this month', referralResultsThisMonth]].map(([label, value]) => (
          <div key={label} style={styles.metricCard}><div style={styles.metricLabel}>{label}</div><div style={styles.metricValue}>{value}</div></div>
        ))}
      </div>
      <input style={styles.input} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search patient, lab, or test" aria-label="Search referrals" />
      {filtered.length === 0 ? <div style={styles.empty}>No lab referrals match this search.</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {filtered.map(referral => {
            const status = getReferralDisplayStatus(referral)
            return (
              <article key={referral.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <strong>{referral.patient_name || 'Patient'}</strong>
                    <div style={{ color: '#667085', fontSize: 12, marginTop: 4 }}>{extractStandaloneReferralTestName(referral)} · {referral.receiving_lab || 'External laboratory'}</div>
                    <div style={{ color: '#667085', fontSize: 11, marginTop: 4 }}>Patient no. {getPatientNumber(referral.patients || referral) || '—'} · {status}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 7 }}>
                    <button type="button" style={styles.btn} onClick={() => openReferralResultModal(referral)}>Record result</button>
                    {status !== 'Overdue' && status !== 'Result Received' && <button type="button" style={styles.pageBtn} onClick={() => markReferralOverdue(referral)}>Mark overdue</button>}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}