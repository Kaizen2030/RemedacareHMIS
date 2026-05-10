function vitalChips(vitals) {
  if (!vitals) return []
  return [
    vitals.bp_systolic ? `BP ${vitals.bp_systolic}/${vitals.bp_diastolic}` : null,
    vitals.pulse_bpm ? `Pulse ${vitals.pulse_bpm}` : null,
    vitals.temperature_c ? `Temp ${vitals.temperature_c}°C` : null,
    vitals.oxygen_sat ? `SpO2 ${vitals.oxygen_sat}%` : null,
    vitals.blood_sugar ? `Sugar ${vitals.blood_sugar}` : null,
  ].filter(Boolean)
}

export default function PatientWorkflowCard({
  patientName,
  patient = {},
  visit = {},
  latestVitals = null,
  badges = [],
  accentColor = '#0F6E56',
  background = '#FFFFFF',
  compact = false,
  extraMeta = [],
  children,
}) {
  const vitals = vitalChips(latestVitals)

  return (
    <div
      style={{
        background,
        borderRadius: compact ? 10 : 12,
        border: '1px solid #E5E7EB',
        borderLeft: `4px solid ${accentColor}`,
        padding: compact ? '12px 14px' : '14px 16px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: compact ? 14 : 15, fontWeight: 800, color: '#111827' }}>
              {patientName || patient?.full_name || 'Patient'}
            </div>
            {badges.map((badge, index) => (
              <span
                key={`${badge.label}-${index}`}
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  background: badge.bg || '#F3F4F6',
                  color: badge.color || '#6B7280',
                  padding: '2px 8px',
                  borderRadius: 999,
                }}
              >
                {badge.label}
              </span>
            ))}
          </div>

          <div style={{ fontSize: '12px', color: '#6B7280', marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(patient?.age || patient?.gender) && <span>{patient?.age ? `${patient.age}y` : ''} {patient?.gender || ''}</span>}
            {patient?.phone && <span>{patient.phone}</span>}
            {patient?.blood_group && <span>Blood {patient.blood_group}</span>}
            {(visit?.visit_number || visit?.visitNumber) && <span>Visit {visit.visit_number || visit.visitNumber}</span>}
            {(visit?.visit_type || visit?.visitType) && <span>{visit.visit_type || visit.visitType}</span>}
            {(visit?.assigned_doctor_name || visit?.doctor) && <span>Dr. {visit.assigned_doctor_name || visit.doctor}</span>}
            {(visit?.speciality || visit?.specialty) && <span>{visit.speciality || visit.specialty}</span>}
            {(visit?.ward || visit?.bed_no || visit?.bedNo) && <span>{visit.ward || 'Ward'}{visit.bed_no || visit.bedNo ? ` / ${visit.bed_no || visit.bedNo}` : ''}</span>}
            {extraMeta.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}
          </div>

          {(patient?.allergies || visit?.allergies) && (
            <div style={{ fontSize: '11px', color: '#A32D2D', marginTop: 6, fontWeight: 700 }}>
              Allergy: {patient?.allergies || visit?.allergies}
            </div>
          )}
          {(patient?.chronic_conditions || visit?.chronic_conditions) && (
            <div style={{ fontSize: '11px', color: '#C07000', marginTop: 4, fontWeight: 700 }}>
              Chronic: {patient?.chronic_conditions || visit?.chronic_conditions}
            </div>
          )}
          {(visit?.chief_complaint || visit?.chiefComplaint) && (
            <div style={{ fontSize: '12px', color: '#374151', marginTop: 8 }}>
              <strong>Complaint:</strong> {visit.chief_complaint || visit.chiefComplaint}
            </div>
          )}
        </div>

        {vitals.length > 0 && (
          <div style={{ minWidth: compact ? 180 : 220, flex: 1 }}>
            <div style={{ fontSize: '10px', color: '#2563EB', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Latest Vitals
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {vitals.map(label => (
                <span
                  key={label}
                  style={{ fontSize: '10px', fontWeight: 700, background: '#EFF6FF', color: '#1D4ED8', padding: '3px 8px', borderRadius: 999 }}
                >
                  {label}
                </span>
              ))}
            </div>
            <div style={{ fontSize: '10px', color: '#6B7280', marginTop: 6 }}>
              {latestVitals?.recorded_by ? `By ${latestVitals.recorded_by}` : 'Recorded'}
              {latestVitals?.recorded_at ? ` · ${new Date(latestVitals.recorded_at).toLocaleString('en-KE')}` : ''}
            </div>
          </div>
        )}
      </div>

      {children ? <div style={{ marginTop: 12 }}>{children}</div> : null}
    </div>
  )
}
