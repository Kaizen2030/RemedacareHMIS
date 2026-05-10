export default function ConsultationLabResults({
  labResults = [],
  allPatientLabs = [],
  antibiograms = [],
  stewardshipItems = [],
  stewardshipDrafts = {},
  stewardshipSchemaReady = true,
  selected,
  styles = {},
}) {
  function interpColor(interp) {
    if (!interp) return null
    const lower = interp.toLowerCase()
    if (lower.includes('abnormal') || lower.includes('positive')) return { bg: '#FCEBEB', color: '#A32D2D' }
    if (lower.includes('normal') || lower.includes('negative')) return { bg: '#E1F5EE', color: '#0F6E56' }
    return { bg: '#FFF3DC', color: '#C07000' }
  }

  return (
    <div>
      {labResults.length > 0 && (
        <div style={{ background: '#E1F5EE', border: '1px solid #9FE1CB', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0F6E56' }}>Lab Status Summary</div>
              <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                {labResults.filter(l => l.status === 'Complete').length} of {labResults.length} complete
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[['Complete', '#0F6E56', 'DONE'], ['In Progress', '#1a6fb5', 'PROCESSING'], ['Pending', '#C07000', 'PENDING']].map(([status, color, label]) => {
                const count = labResults.filter(l => l.status === status).length
                return count > 0 ? (
                  <div key={status} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color }}>{count}</div>
                    <div style={{ fontSize: 10, color, fontWeight: 600 }}>{label}</div>
                  </div>
                ) : null
              })}
            </div>
          </div>
        </div>
      )}

      {stewardshipItems.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={styles.sectionLabel}>Microbiology / C&S Results</div>
          {!stewardshipSchemaReady && (
            <div style={{ background: '#FFF7ED', border: '1px solid #FCD34D', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: '#9A3412', marginBottom: 12 }}>
              Apply next_upgrade_relations_and_stewardship.sql to enable full prescriber acknowledgement tracking.
            </div>
          )}
          {stewardshipItems.map(item => {
            const decision = item.latestIntervention?.prescriber_decision || 'Pending'
            const statusColor = decision === 'Accepted'
              ? { bg: '#E1F5EE', color: '#0F6E56' }
              : decision === 'Rejected'
                ? { bg: '#FCEBEB', color: '#A32D2D' }
                : decision === 'Actioned'
                  ? { bg: '#E3F0FB', color: '#1a6fb5' }
                  : { bg: '#FFF3DC', color: '#C07000' }
            return (
              <div key={item.id} style={{ background: '#FAFBFD', borderRadius: 12, padding: 16, border: '1px solid #E5E7EB', marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>{item.organism}</span>
                      {item.sampleType && <span style={{ ...styles.pill, background: '#E3F0FB', color: '#1a6fb5', fontSize: 11 }}>{item.sampleType}</span>}
                      <span style={{ ...styles.pill, background: statusColor.bg, color: statusColor.color, fontSize: 11 }}>{decision}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                      Reported {item.reportedAt ? new Date(item.reportedAt).toLocaleString('en-KE') : 'date not captured'}
                      {item.highRiskFlags.length > 0 ? ` • ${item.highRiskFlags.join(', ')}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[
                      { label: `S ${item.sensitiveAgents.length}`, bg: '#E1F5EE', color: '#0F6E56' },
                      { label: `I ${item.intermediateAgents.length}`, bg: '#FFF3DC', color: '#C07000' },
                      { label: `R ${item.resistantAgents.length}`, bg: '#FCEBEB', color: '#A32D2D' },
                    ].map(chip => (
                      <span key={chip.label} style={{ background: chip.bg, color: chip.color, borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>{chip.label}</span>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8 }}>Full susceptibility (S / I / R)</div>
                  {item.susceptibilityEntries.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#999' }}>No antibiotic-by-antibiotic susceptibility rows captured.</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                      {item.susceptibilityEntries.map(entry => {
                        const p = entry.sir === 'S' ? { bg: '#E1F5EE', color: '#0F6E56' } : entry.sir === 'I' ? { bg: '#FFF3DC', color: '#C07000' } : entry.sir === 'R' ? { bg: '#FCEBEB', color: '#A32D2D' } : { bg: '#F3F4F6', color: '#666' }
                        return (
                          <div key={entry.key} style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: '10px 12px' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#111' }}>{entry.label}</div>
                            <span style={{ display: 'inline-block', marginTop: 6, background: p.bg, color: p.color, borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>{entry.sir}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={styles.sectionLabel}>Lab Tests — This Visit</div>
        {labResults.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px', color: '#999' }}>
            <div style={{ fontSize: '32px' }}>🔬</div>
            <div style={{ marginTop: '8px' }}>No lab tests ordered for this visit</div>
          </div>
        ) : (
          labResults.map(lab => {
            const sc = { Pending: { bg: '#FFF3DC', color: '#C07000' }, 'In Progress': { bg: '#E3F0FB', color: '#1a6fb5' }, Complete: { bg: '#E1F5EE', color: '#0F6E56' }, Critical: { bg: '#FCEBEB', color: '#A32D2D' } }[lab.status] || {}
            const ic = interpColor(lab.interpretation)
            return (
              <div key={lab.id} style={{ background: '#f9fafb', borderRadius: 10, padding: 16, border: '1px solid #eee', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>{lab.test_type}</span>
                  <span style={{ ...styles.pill, background: sc.bg, color: sc.color, fontSize: 11 }}>{lab.status}</span>
                  {lab.category && <span style={{ ...styles.pill, background: '#f0f0f0', color: '#666', fontSize: 11 }}>{lab.category}</span>}
                  {lab.priority !== 'Routine' && <span style={{ ...styles.pill, background: '#FFF3DC', color: '#C07000', fontSize: 11 }}>{lab.priority}</span>}
                </div>
                {lab.status === 'Complete' ? (
                  <div>
                    {lab.result_value && (
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 20, fontWeight: 800, color: '#0F6E56' }}>{lab.result_value}</span>
                        {lab.reference_range && <span style={{ fontSize: 12, color: '#888' }}>Ref: {lab.reference_range}</span>}
                      </div>
                    )}
                    {lab.result_text && <div style={{ background: '#fff', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#333', border: '1px solid #e8e8e8', marginBottom: 8, whiteSpace: 'pre-wrap' }}>{lab.result_text}</div>}
                    {lab.interpretation && ic && <div style={{ ...styles.pill, ...ic, fontSize: 12, padding: '4px 10px', display: 'inline-block', marginBottom: 6 }}>{lab.interpretation}</div>}
                    {lab.result_notes && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>📝 {lab.result_notes}</div>}
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>
                      {lab.performed_by && `By: ${lab.performed_by}`}
                      {lab.resulted_at && ` • ${new Date(lab.resulted_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: '#aaa', fontStyle: 'italic' }}>
                    {lab.status === 'In Progress' ? '⏳ Test in progress...' : '⏳ Awaiting processing'}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {allPatientLabs.filter(l => l.visit_id !== selected?.id).length > 0 && (
        <div>
          <div style={styles.sectionLabel}>Previous Lab History — This Patient</div>
          {allPatientLabs.filter(l => l.visit_id !== selected?.id).map(lab => (
            <div key={lab.id} style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 14px', border: '1px solid #eee', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 6 }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13, color: '#111' }}>{lab.test_type}</span>
                  {lab.category && <span style={{ ...styles.pill, background: '#f0f0f0', color: '#666', fontSize: 10, marginLeft: 6 }}>{lab.category}</span>}
                </div>
                <span style={{ fontSize: 11, color: '#888' }}>{lab.ordered_at ? new Date(lab.ordered_at).toLocaleDateString('en-KE') : '—'}</span>
              </div>
              {lab.result_value && <div style={{ fontSize: 13, fontWeight: 700, color: '#0F6E56', marginTop: 4 }}>{lab.result_value}{lab.reference_range && <span style={{ fontSize: 11, color: '#888', fontWeight: 400, marginLeft: 8 }}>Ref: {lab.reference_range}</span>}</div>}
              {lab.interpretation && <span style={{ ...styles.pill, ...(interpColor(lab.interpretation) || {}), fontSize: 11, marginTop: 4, display: 'inline-block' }}>{lab.interpretation}</span>}
            </div>
          ))}
        </div>
      )}

      {antibiograms.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={styles.sectionLabel}>🧬 Antibiograms — Drug Sensitivity Results</div>
          {antibiograms.map(abio => (
            <div key={abio.id} style={{ background: '#E1F5EE', borderRadius: 10, padding: 14, border: '1px solid #9FE1CB', marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0F6E56', marginBottom: 8 }}>{abio.organism || 'Organism Identified'}</div>
              {abio.result_summary && <div style={{ fontSize: 13, color: '#333', background: '#fff', borderRadius: 8, padding: '10px 12px', marginBottom: 8, border: '1px solid #9FE1CB', whiteSpace: 'pre-wrap' }}>{abio.result_summary}</div>}
              {abio.interpretation && <div style={{ fontSize: 12, color: '#0F6E56', fontWeight: 600, padding: '6px 10px', background: '#E1F5EE', borderRadius: 6, display: 'inline-block', border: '1px solid #9FE1CB' }}>{abio.interpretation}</div>}
              {abio.created_at && <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>Generated: {new Date(abio.created_at).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
