export default function PharmacyStockPanel({
  summary = {},
  statusCounts = {},
  pharmacistName = '',
  setPharmacistName,
  pharmacyStaff = [],
  stewardshipAlerts = [],
  stewardshipSummary = {},
  inventory = [],
  loading,
  fetchData,
  openStewardshipModal,
  C,
  css,
  StatCard,
  Badge,
  formatKES,
  getStaffRoleLabel,
}) {
  return (
    <div>
      <div style={css.header}>
        <div>
          <h1 style={css.title}>Pharmacy and Prescription Queue</h1>
          <div style={css.subtitle}>
            Consultant prescriptions land here automatically, grouped into patient cards, with pharmacist approval, POS drug search, cart review, and receipt creation at release.
          </div>
        </div>
        <button style={{ ...css.btn, ...css.btnGhost }} onClick={fetchData}>Refresh</button>
      </div>

      <div style={css.statsRow}>
        <StatCard label="Patient Cards" value={summary.patientCards} sub={`${summary.pendingPatients} still need review`} accent={C.primary} />
        <StatCard label="Prescription Lines" value={summary.totalLines} sub={`${statusCounts.Pending} pending | ${statusCounts.Approved} approved`} accent={C.warn} />
        <StatCard label="Queue Value" value={formatKES(summary.totalValue)} sub={`${formatKES(summary.readyValue)} ready to dispense`} accent={C.blue} />
        <StatCard label="Released Today" value={summary.releasedToday} sub={`${statusCounts.Released} total released lines`} accent={C.success} />
      </div>

      <div style={css.banner}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge color="yellow" label="Pending" />
          <span style={{ color: C.muted }}>to</span>
          <Badge color="blue" label="Approved" />
          <span style={{ color: C.muted }}>to</span>
          <Badge color="green" label="Released with receipt" />
        </div>
        <div style={{ fontSize: '12px', color: C.sub, flex: 1, minWidth: '220px' }}>
          Each patient card keeps pending, approved, rejected, and released lines together so pharmacy can see the whole medication story, then search stock by name or abbreviation before adding drugs to the POS cart.
        </div>
        <div style={{ minWidth: '280px', flex: 1 }}>
          <label style={css.label} htmlFor="pharmacy-queue-pharmacist">Pharmacist Handling Queue</label>
          <select
            id="pharmacy-queue-pharmacist"
            style={{ ...css.input, cursor: 'pointer' }}
            value={pharmacistName}
            onChange={e => setPharmacistName(e.target.value)}
            disabled={pharmacyStaff.length === 0}
          >
            <option value="">
              {pharmacyStaff.length > 0 ? 'Select pharmacist handling this queue' : 'No pharmacy staff found'}
            </option>
            {pharmacyStaff.map(member => (
              <option key={member.id} value={member.full_name}>
                {member.full_name} - {getStaffRoleLabel(member)}
              </option>
            ))}
          </select>
          <div style={{ fontSize: '11px', color: C.sub, marginTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {pharmacyStaff.length > 0
              ? `${pharmacyStaff.length} active pharmacy staff loaded. On-duty team members appear first in the dropdown.`
              : 'No active pharmacy staff found in HR / departments.'}
          </div>
        </div>
      </div>

      {stewardshipAlerts.length > 0 && (
        <div style={{ ...css.card, padding: '16px 18px', marginBottom: '16px', border: `1px solid ${C.danger}33`, background: 'linear-gradient(135deg, #FEF2F2, #FFF7ED)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div style={{ minWidth: '260px', flex: 2 }}>
              <div style={{ fontSize: '15px', fontWeight: 800, color: C.text }}>AMR Stewardship Watchlist</div>
              <div style={{ fontSize: '12px', color: C.sub, marginTop: '5px' }}>
                Recent microbiology results now surface here so pharmacy can review resistant isolates, compare them to active prescriptions, and advise the prescriber from one queue.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {[
                { label: 'Pending review', value: stewardshipSummary.pendingReview, bg: '#FFFFFF', color: C.text },
                { label: 'Awaiting prescriber', value: stewardshipSummary.awaitingPrescriber, bg: C.blueL, color: C.blue },
                { label: 'High severity', value: stewardshipSummary.highSeverity, bg: C.dangerL, color: C.danger },
                { label: 'Rx resistant overlap', value: stewardshipSummary.resistantOverlap, bg: C.warnL, color: C.warn },
              ].map(item => (
                <div key={item.label} style={{ minWidth: '118px', borderRadius: '12px', padding: '10px 12px', background: item.bg, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: '10px', color: C.sub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{item.label}</div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: item.color, marginTop: '4px' }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: '12px' }}>
            {stewardshipAlerts.slice(0, 4).map(item => (
              <div key={item.id} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: '12px', padding: '14px 15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: C.text }}>{item.patientName}</div>
                    <div style={{ fontSize: '11px', color: C.sub, marginTop: '3px' }}>
                      {item.organism}
                      {item.sampleType ? ` - ${item.sampleType}` : ''}
                      {item.department ? ` - ${item.department}` : ''}
                    </div>
                  </div>
                  <Badge color={item.severity === 'high' ? 'red' : item.severity === 'medium' ? 'yellow' : 'gray'} label={item.severity === 'high' ? 'Urgent' : item.severity === 'medium' ? 'Review' : 'Info'} />
                </div>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
                  {item.highRiskFlags.map(flag => (
                    <span key={flag} style={{ background: C.dangerL, color: C.danger, borderRadius: '999px', padding: '3px 9px', fontSize: '11px', fontWeight: 700 }}>
                      {flag}
                    </span>
                  ))}
                  {item.currentAdvice && (
                    <span style={{ background: C.primaryL, color: C.primary, borderRadius: '999px', padding: '3px 9px', fontSize: '11px', fontWeight: 700 }}>
                      Advisory saved
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '11px', color: C.sub, marginTop: '10px', lineHeight: 1.5 }}>
                  Reported: {item.reportedAt ? new Date(item.reportedAt).toLocaleDateString('en-KE') : 'Date not captured'}
                </div>
                <div style={{ fontSize: '12px', color: C.sub, marginTop: '8px', lineHeight: 1.5 }}>
                  {item.resistantMatches.length > 0
                    ? `Current therapy flagged resistant: ${item.resistantMatches.map(match => match.drugName).join(', ')}.`
                    : item.activePrescriptionMatches.length > 0
                      ? `Active therapy checked: ${item.activePrescriptionMatches.map(match => `${match.drugName} (${match.classification})`).join(', ')}.`
                      : 'No active prescription is linked to this patient right now, but pharmacy can still advise the team.'}
                </div>
                {item.susceptibilityEntries.length > 0 && (
                  <div style={{ fontSize: '11px', color: C.sub, marginTop: '8px' }}>
                    Full S/I/R profile ready: S {item.sensitiveAgents.length} • I {item.intermediateAgents.length} • R {item.resistantAgents.length}
                  </div>
                )}
                {item.sensitiveAgents.length > 0 && (
                  <div style={{ fontSize: '12px', color: C.text, marginTop: '8px', lineHeight: 1.5 }}>
                    Susceptible options: <strong>{item.sensitiveAgents.slice(0, 4).join(', ')}</strong>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', marginTop: '12px' }}>
                  <div style={{ fontSize: '11px', color: item.requiresReview ? C.warn : item.awaitingPrescriber ? C.blue : C.primary, fontWeight: 700 }}>
                    {item.requiresReview
                      ? 'Awaiting pharmacist intervention note'
                      : item.awaitingPrescriber
                        ? `Sent to prescriber${item.latestIntervention?.prescriber_decision ? ` • ${item.latestIntervention.prescriber_decision}` : ''}`
                        : 'Intervention note recorded'}
                  </div>
                  <button style={{ ...css.btn, ...css.btnSoft, padding: '7px 12px' }} onClick={() => openStewardshipModal(item)}>
                    {item.requiresReview ? 'Review isolate' : 'Open S/I/R'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {inventory.length === 0 && !loading && (
        <div style={{ ...css.card, padding: '14px 16px', marginBottom: '16px', border: `1px solid ${C.warn}55`, background: C.warnL }}>
          <div style={{ fontSize: '14px', fontWeight: 800, color: C.text }}>Pharmacy inventory is empty for this hospital</div>
          <div style={{ fontSize: '12px', color: C.sub, marginTop: '6px' }}>
            Prescriptions can still arrive and be grouped into patient cards, but release and receipt creation will stay blocked until drugs are added in the Inventory screen with stock quantity and selling price.
          </div>
        </div>
      )}
    </div>
  )
}
