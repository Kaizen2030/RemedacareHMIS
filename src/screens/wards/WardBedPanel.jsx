import WardMar from './WardMar'
import WardObservations from './WardObservations'
import { BedIsolation } from './WardIsolation'
import { PatientBanner } from '../../ui'
import usePatientAccessLog from '../../hooks/useAccessLog'

function DisplayValue({ label, value }) {
  return <div style={{ padding: '9px 10px', background: '#F8FAF9', borderRadius: 8 }}><div style={{ color: '#667085', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div><div style={{ color: '#1F2937', fontSize: 13, marginTop: 4 }}>{value || '—'}</div></div>
}

export default function WardBedPanel({
  bed,
  patient,
  visit,
  admission,
  vitals,
  vitalsTrend = [],
  consultations = [],
  workflow = {},
  rounds = [],
  followUps = [],
  ward,
  userRole,
  canManageWards = false,
  canAdmitPatient = false,
  canDischarge = false,
  canTransfer = false,
  canSetDnr = false,
  saving = false,
  onClose = () => {},
  onSetBedStatus = () => {},
  daysAdmitted = () => '—',
  bedColors = {},
  latestRound,
  admissionQueue = [],
  bedPanelTab = 'overview',
  setBedPanelTab = () => {},
  dischargeChecklist = {},
  dischargeForm = {},
  setDischargeForm = () => {},
  onChecklistChange = () => {},
  onQuickAdmit = () => {},
  onOpenRoundModal = () => {},
  roundForm = {},
  setRoundForm = () => {},
  printDischargeSummary = () => {},
  onOpenDischarge = () => {},
  onOpenTransfer = () => {},
  onDeleteBed = () => {},
  nursingProps = {},
  onIsolationChanged = () => {},
  styles = {},
  hospitalId = null,
}) {
  const tone = bedColors[bed?.status] || bedColors.Free || {}
  const isOccupied = Boolean(bed?.patient_id)
  const patientName = patient?.full_name || bed?.patients?.full_name || bed?.patient_name
  const tabs = ['overview', 'observations', 'medication', 'nursing', 'isolation', 'rounds', 'discharge']
  const recordAllowed = usePatientAccessLog(hospitalId || bed?.hospital_id, bed?.patient_id || patient?.id, 'ward')
  const notes = nursingProps.nursingNotes || []
  const fluidEntries = nursingProps.fluidEntries || []
  const workflowData = workflow || {}

  if (!bed) return null

  return (
    <div
      style={styles.bedOverlay}
      role="presentation"
      onClick={onClose}
      onKeyDown={event => { if (event.key === 'Escape') onClose() }}
    >
    <aside style={styles.sidePanel} role="dialog" aria-modal="true" aria-label={`Bed ${bed.bed_number || 'details'}`} tabIndex={-1} onClick={event => event.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: '#667085', fontWeight: 700, textTransform: 'uppercase' }}>{ward?.name || 'Ward'}</div>
          <h2 style={{ margin: '4px 0 0', fontSize: 20, color: '#111827' }}>{bed ? `Bed ${bed.bed_number || ''}` : 'Bed details'}</h2>
          {bed && <span style={{ display: 'inline-block', marginTop: 7, padding: '4px 8px', borderRadius: 99, color: tone.color || '#344054', background: tone.bg || '#F3F4F6', fontSize: 11, fontWeight: 700 }}>{bed.status || 'Free'}</span>}
        </div>
        <button type="button" style={styles.closeBtn} onClick={onClose} aria-label="Close bed details">×</button>
      </div>

        <>
          <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #E6ECE8', margin: '16px 0', overflowX: 'auto' }}>
            {tabs.map(tab => <button key={tab} type="button" onClick={() => setBedPanelTab(tab)} style={{ ...styles.chip, ...(bedPanelTab === tab ? styles.chipActive : {}), textTransform: 'capitalize' }}>{tab}</button>)}
          </div>

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>
            {isOccupied ? (
              <>
                {canTransfer && <button type="button" style={styles.btn} disabled={saving} onClick={() => onOpenTransfer()}>Transfer patient</button>}
                {canDischarge && <button type="button" style={{ ...styles.btn, background: '#A32D2D' }} disabled={saving} onClick={onOpenDischarge}>Start discharge</button>}
                <button type="button" style={styles.pageBtn} disabled={saving} onClick={printDischargeSummary}>Print summary</button>
              </>
            ) : (
              <>
                {canAdmitPatient && <button type="button" style={styles.btn} disabled={saving || !['Free', 'Reserved'].includes(bed.status)} onClick={() => onQuickAdmit()}>Quick admit</button>}
                {canManageWards && <button type="button" style={styles.pageBtn} disabled={saving} onClick={() => onSetBedStatus(bed, bed.status === 'Maintenance' ? 'Free' : 'Maintenance')}>{bed.status === 'Maintenance' ? 'Mark free' : 'Maintenance'}</button>}
                {canManageWards && <button type="button" style={{ ...styles.pageBtn, color: '#A32D2D' }} disabled={saving} onClick={() => onDeleteBed(bed)}>Delete bed</button>}
              </>
            )}
          </div>

          {isOccupied && !recordAllowed && <div role="alert" style={{ padding: 16, background: '#FEF3F2', color: '#B42318', borderRadius: 10, fontWeight: 700 }}>This record is confidential. Open it again and give a reason to continue.</div>}
          {isOccupied && recordAllowed && <PatientBanner patient={{ ...(bed?.patients || {}), ...(patient || {}) }}
            alerts={[admission?.isolation_required && 'Isolation', String(admission?.resuscitation_status || '').toUpperCase() === 'DNR' && 'DNR — do not resuscitate']} />}

          {bedPanelTab === 'overview' && (
            <div style={{ display: 'grid', gap: 14 }}>
              <section>
                <div style={styles.sideSectionLabel}>Patient & Admission</div>
                {isOccupied ? <>
                  <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>{patientName || 'Patient record'}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
                    <DisplayValue label="Admission" value={admission?.admission_date ? new Date(admission.admission_date).toLocaleDateString('en-KE') : daysAdmitted(bed.admitted_at)} />
                    <DisplayValue label="Admission type" value={admission?.admission_type} />
                    <DisplayValue label="Diagnosis" value={visit?.diagnosis || admission?.diagnosis} />
                    <DisplayValue label="Resuscitation" value={admission?.resuscitation_status || 'Not recorded'} />
                  </div>
                </> : <div style={{ color: '#667085', fontSize: 13 }}>This bed is available for admission.</div>}
              </section>

              {isOccupied && <>
                <section>
                  <div style={styles.sideSectionLabel}>Latest Vitals</div>
                  {vitals ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
                    <DisplayValue label="Blood pressure" value={vitals.bp_systolic ? `${vitals.bp_systolic}/${vitals.bp_diastolic} mmHg` : ''} />
                    <DisplayValue label="Pulse" value={vitals.pulse_bpm ? `${vitals.pulse_bpm} bpm` : ''} />
                    <DisplayValue label="Temperature" value={vitals.temperature_c ? `${vitals.temperature_c} °C` : ''} />
                    <DisplayValue label="SpO₂" value={vitals.oxygen_sat ? `${vitals.oxygen_sat}%` : ''} />
                  </div> : <div style={{ color: '#667085', fontSize: 12 }}>No vitals recorded for this visit.</div>}
                  {vitalsTrend.length > 1 && <div style={{ marginTop: 8, color: '#667085', fontSize: 11 }}>{vitalsTrend.length} recent vital observations available.</div>}
                </section>
                <section>
                  <div style={styles.sideSectionLabel}>Workflow Summary</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
                    <DisplayValue label="Invoices" value={(workflowData.invoices || []).length} />
                    <DisplayValue label="Lab tests" value={(workflowData.labTests || []).length} />
                    <DisplayValue label="Prescriptions" value={(workflowData.prescriptions || []).length} />
                  </div>
                  {consultations[0]?.diagnosis && <div style={{ marginTop: 8, fontSize: 12, color: '#475467' }}>Latest diagnosis: {consultations[0].diagnosis}</div>}
                  {latestRound && <div style={{ marginTop: 8, fontSize: 12, color: '#475467' }}>Latest round: {latestRound.current_condition || 'Condition not recorded'} · {latestRound.plan_for_today || 'No plan recorded'}</div>}
                </section>
              </>}
              {admissionQueue.length > 0 && !isOccupied && <div style={{ color: '#667085', fontSize: 12 }}>{admissionQueue.length} admission request(s) waiting for a bed in this ward.</div>}
            </div>
          )}

          {bedPanelTab === 'nursing' && <div style={{ display: 'grid', gap: 14 }}>
            <section>
              <div style={styles.sideSectionLabel}>New Nursing Note</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
                <label style={styles.formGroup}><span style={styles.label}>Nurse</span><input style={styles.input} value={nursingProps.nursingForm?.nurse_name || ''} onChange={event => nursingProps.setNursingForm?.({ ...nursingProps.nursingForm, nurse_name: event.target.value })} /></label>
                <label style={styles.formGroup}><span style={styles.label}>Note type</span><select style={styles.input} value={nursingProps.nursingForm?.note_type || 'General'} onChange={event => nursingProps.setNursingForm?.({ ...nursingProps.nursingForm, note_type: event.target.value })}>{(nursingProps.nursingNoteTypes || ['General']).map(type => <option key={type}>{type}</option>)}</select></label>
              </div>
              <textarea style={{ ...styles.input, minHeight: 72 }} value={nursingProps.nursingForm?.note_text || ''} onChange={event => nursingProps.setNursingForm?.({ ...nursingProps.nursingForm, note_text: event.target.value })} placeholder="Record nursing observations or handover" />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" style={styles.btn} disabled={saving || !nursingProps.nursingForm?.note_text?.trim()} onClick={nursingProps.onSaveNursingNote}>Save note</button>
                <button type="button" style={styles.pageBtn} onClick={nursingProps.onOpenVitalsShortcut}>Record vitals</button>
                <button type="button" style={styles.pageBtn} onClick={nursingProps.onOpenPatientsFlow}>Open patient workflow</button>
              </div>
            </section>
            <section>
              <div style={styles.sideSectionLabel}>Fluid Balance</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <select style={styles.input} value={nursingProps.fluidForm?.entry_type || 'Oral Intake'} onChange={event => nursingProps.setFluidForm?.({ ...nursingProps.fluidForm, entry_type: event.target.value })}>{(nursingProps.fluidEntryTypes || ['Oral Intake']).map(type => <option key={type}>{type}</option>)}</select>
                <input style={styles.input} type="number" min="0" value={nursingProps.fluidForm?.volume_ml || ''} onChange={event => nursingProps.setFluidForm?.({ ...nursingProps.fluidForm, volume_ml: event.target.value })} placeholder="Volume (ml)" />
              </div>
              <input style={{ ...styles.input, marginTop: 8 }} value={nursingProps.fluidForm?.fluid_description || ''} onChange={event => nursingProps.setFluidForm?.({ ...nursingProps.fluidForm, fluid_description: event.target.value })} placeholder="Fluid / output description" />
              <button type="button" style={{ ...styles.btn, marginTop: 8 }} disabled={saving || !nursingProps.fluidForm?.volume_ml} onClick={nursingProps.onSaveFluidEntry}>Save fluid entry</button>
            </section>
            <section>
              <div style={styles.sideSectionLabel}>Recent Nursing Notes</div>
              {notes.length === 0 ? <div style={{ color: '#667085', fontSize: 12 }}>No nursing notes recorded.</div> : notes.slice(0, 8).map(note => <div key={note.id} style={{ borderBottom: '1px solid #E6ECE8', padding: '8px 0', fontSize: 12 }}><strong>{note.note_type || 'General'} · {note.nurse_name || note.created_by || 'Staff'}</strong><div style={{ marginTop: 3, color: '#475467' }}>{note.note_text}</div></div>)}
              {fluidEntries.length > 0 && <div style={{ marginTop: 10, fontSize: 12, color: '#475467' }}>{fluidEntries.length} fluid balance record(s) logged.</div>}
            </section>
          </div>}

          {bedPanelTab === 'observations' && (isOccupied && recordAllowed
            ? <WardObservations hospitalId={hospitalId || bed?.hospital_id} patient={{ ...(bed?.patients || {}), ...(patient || {}), id: patient?.id || bed?.patient_id }}
                visitId={visit?.id || bed?.visit_id} bedId={bed?.id} fluidEntries={fluidEntries} styles={styles} />
            : <div style={{ color: '#667085', fontSize: 12 }}>Admit a patient to this bed to chart observations.</div>)}

          {bedPanelTab === 'isolation' && (
            <BedIsolation hospitalId={hospitalId || bed?.hospital_id} bed={bed} patientId={isOccupied ? (patient?.id || bed?.patient_id) : null}
              canManageBeds={canManageWards} styles={styles} onChanged={onIsolationChanged} />
          )}

          {bedPanelTab === 'medication' && (isOccupied && (visit?.id || bed?.visit_id)
            ? <WardMar hospitalId={hospitalId || bed?.hospital_id} visitId={visit?.id || bed?.visit_id} patientId={patient?.id || bed?.patient_id}
                prescriptions={workflowData.prescriptions || []} styles={styles} />
            : <div style={{ color: '#667085', fontSize: 12 }}>Admit a patient to this bed to see the medication chart.</div>)}

          {bedPanelTab === 'rounds' && <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><div style={styles.sideSectionLabel}>Ward Rounds</div><button type="button" style={styles.btn} onClick={onOpenRoundModal}>Add round</button></div>
            {rounds.length === 0 ? <div style={{ color: '#667085', fontSize: 12 }}>No round notes recorded for this bed yet.</div> : rounds.map(round => <article key={round.id} style={{ padding: '10px 0', borderBottom: '1px solid #E6ECE8' }}><strong style={{ fontSize: 12 }}>{round.current_condition || 'Condition not recorded'} · {round.clinician_name || 'Clinician'}</strong><div style={{ color: '#667085', fontSize: 11, marginTop: 3 }}>{round.note_date ? new Date(round.note_date).toLocaleString('en-KE') : ''}</div><div style={{ fontSize: 12, marginTop: 6 }}>{round.plan_for_today || 'No plan recorded'}</div></article>)}
            {followUps.length > 0 && <div style={{ marginTop: 14 }}><div style={styles.sideSectionLabel}>Follow-ups</div>{followUps.slice(0, 5).map(item => <div key={item.id} style={{ fontSize: 12, padding: '6px 0' }}>{item.title || item.reason || 'Follow-up'} · {item.status || 'Scheduled'}</div>)}</div>}
            {roundForm && setRoundForm && <span style={{ display: 'none' }}>{String(roundForm.current_condition || '')}</span>}
          </section>}

          {bedPanelTab === 'discharge' && <section>
            <div style={styles.sideSectionLabel}>Discharge Readiness</div>
            {(dischargeChecklist.checklistItems || []).map(item => <label key={item.key} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '9px 0', borderBottom: '1px solid #E6ECE8', fontSize: 12 }}><input type="checkbox" checked={Boolean(item.checked)} onChange={event => onChecklistChange({ [item.key]: event.target.checked })} /><span>{item.label}</span></label>)}
            <div style={{ fontSize: 12, color: '#667085', marginTop: 10 }}>{dischargeChecklist.readyCount || 0} checklist item(s) complete</div>
            <textarea style={{ ...styles.input, minHeight: 72, marginTop: 10 }} value={dischargeForm.override_reason || ''} onChange={event => onChecklistChange({ override_reason: event.target.value })} placeholder="Admin override reason, if required" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" style={styles.pageBtn} disabled={!isOccupied} onClick={printDischargeSummary}>Print discharge summary</button>
              <button type="button" style={{ ...styles.btn, background: '#A32D2D' }} disabled={!canDischarge || !isOccupied || saving} onClick={onOpenDischarge}>Continue discharge</button>
            </div>
          </section>}
        </>
    </aside>
    </div>
  )
}