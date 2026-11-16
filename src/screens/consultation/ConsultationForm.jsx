import ConsultationPrescriptions from './ConsultationPrescriptions'
import DiagnosisPicker from '../../components/DiagnosisPicker'
import { PatientBanner } from '../../ui'
import SpecialtyAssessment from './SpecialtyAssessment'
import GrowthPanel, { isUnderFive } from './GrowthPanel'
import { OrderSetPicker, PatientContinuity } from './PatientContinuity'

export default function ConsultationForm({
  form,
  setForm,
  vitals,
  saving,
  savingDraft,
  onSave,
  onSaveDraft,
  onCancel = () => {},
  onBookFollowUp = null,
  departmentNames = [],
  referralGroups = [],
  wardsList = [],
  showRx,
  setShowRx,
  showLabOrders,
  setShowLabOrders,
  rxList = [],
  setRxList = () => {},
  updateRxField = () => {},
  inventory = [],
  labOrders = [],
  setLabOrders = () => {},
  getLabTestsForCategory = () => [],
  LAB_TEST_CATEGORIES = [],
  hasLabResults,
  completedLabsThisVisit = [],
  canSaveConsultation = true,
  canOrderLabs = true,
  styles = {},
  cdsAlertsByRow = {},
  onCdsAcknowledge = null,
  onCdsReasonChange = null,
  canAcknowledgeDanger = true,
  showPregnancyPrompt = false,
  patientAllergies = '',
  patient = null,
  accessBlocked = false,
  hospitalId = null,
  patientId = null,
  visitId = null,
}) {
  if (accessBlocked) return <div role="alert" style={{ padding: 16, background: '#FEF3F2', color: '#B42318', borderRadius: 10, fontWeight: 700 }}>This record is confidential. Open it again and give a reason to continue.</div>
  return (
    <div>
      {patient && <PatientBanner patient={{ ...patient, allergies: patient.allergies ?? patientAllergies }}
        alerts={[/^pregnant/i.test(form.pregnancy_status || '') && 'Pregnant', /breastfeeding/i.test(form.pregnancy_status || '') && 'Breastfeeding']} />}
      <div style={styles.sectionLabel}>Doctor Details</div>
      <div style={styles.formGrid2}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Doctor Name *</label>
          <input
            style={styles.input}
            placeholder="Dr. ..."
            value={form.doctor_name}
            onChange={e => setForm({ ...form, doctor_name: e.target.value })}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Speciality</label>
          <select
            style={styles.input}
            value={form.speciality}
            onChange={e => setForm({ ...form, speciality: e.target.value })}
          >
            <option value="">-- Select --</option>
            {departmentNames.map(spec => (
              <option key={spec}>{spec}</option>
            ))}
          </select>
          {form.disposition.includes('Refer') && (
            <div style={{ fontSize: '11px', color: '#555', marginTop: '6px' }}>
              This is the receiving specialist department for the referral.
            </div>
          )}
        </div>
      </div>

      {hospitalId && patientId && (
        <PatientContinuity hospitalId={hospitalId} patientId={patientId} visitId={visitId} diagnoses={form.diagnoses || []} prescriptions={rxList} doctorName={form.doctor_name} />
      )}
      <div style={styles.sectionLabel}>Clinical Information</div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Presenting Complaint</label>
        <input
          style={styles.input}
          placeholder="Chief complaint as reported by patient"
          value={form.presenting_complaint}
          onChange={e => setForm({ ...form, presenting_complaint: e.target.value })}
        />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>History of Presenting Illness</label>
        <textarea
          style={{ ...styles.input, height: '80px', resize: 'vertical' }}
          placeholder="Duration, onset, associated symptoms, relevant past history..."
          value={form.history}
          onChange={e => setForm({ ...form, history: e.target.value })}
        />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Examination Findings</label>
        <textarea
          style={{ ...styles.input, height: '80px', resize: 'vertical' }}
          placeholder="General appearance, systemic examination findings..."
          value={form.examination_findings}
          onChange={e => setForm({ ...form, examination_findings: e.target.value })}
        />
      </div>

      {hospitalId && patientId && (
        <SpecialtyAssessment hospitalId={hospitalId} patientId={patientId} visitId={visitId} speciality={form.speciality} doctorName={form.doctor_name}
          onInsertSummary={(text) => setForm({ ...form, examination_findings: [form.examination_findings, text].filter(Boolean).join('\n\n') })} />
      )}
      {hospitalId && patientId && (isUnderFive(patient) || /paed|child|nutrition/i.test(form.speciality || '')) && (
        <GrowthPanel hospitalId={hospitalId} patientId={patientId} visitId={visitId} patient={patient} />
      )}

      <div style={styles.sectionLabel}>Diagnosis</div>
      <div style={styles.formGrid2}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Diagnosis *</label>
          <input
            style={{ ...styles.input, fontWeight: '600' }}
            placeholder="e.g. Malaria, Pneumonia, UTI..."
            value={form.diagnosis}
            onChange={e => setForm({ ...form, diagnosis: e.target.value })}
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label} htmlFor="consult-icd">ICD-10 code (search)</label>
          <DiagnosisPicker
            id="consult-icd"
            inputStyle={styles.input}
            code={form.icd_code}
            description={form.icd10_description}
            onPick={row => setForm({
              ...form,
              icd_code: row.code,
              icd10_description: row.description,
              icd11_code: row.icd11_code || '',
              diagnosis: form.diagnosis?.trim() ? form.diagnosis : row.description,
            })}
          />
        </div>
      </div>
      {hospitalId && (
        <OrderSetPicker hospitalId={hospitalId} patientId={patientId} visitId={visitId} diagnoses={form.diagnoses || []} diagnosisText={form.diagnosis || ''}
          onApply={({ rx, labs }, set) => {
            if (rx.length) { setRxList([...rxList.filter((r) => r.drug_name?.trim()), ...rx]); setShowRx(true) }
            if (labs.length) { setLabOrders([...labOrders.filter((l) => l.test_type), ...labs]); setShowLabOrders(true) }
            if (set.instructions) setForm({ ...form, treatment_plan: [form.treatment_plan, `${set.name}: ${set.instructions}`].filter(Boolean).join('\n') })
          }} />
      )}
      <div style={styles.formGroup}>
        <label style={styles.label}>Treatment Plan</label>
        <textarea
          style={{ ...styles.input, height: '70px', resize: 'vertical' }}
          placeholder="Management plan, procedures, referrals..."
          value={form.treatment_plan}
          onChange={e => setForm({ ...form, treatment_plan: e.target.value })}
        />
      </div>
      <div style={styles.formGroup}>
        <label style={styles.label}>Additional Notes</label>
        <textarea
          style={{ ...styles.input, height: '60px', resize: 'vertical' }}
          placeholder="Any other clinical notes..."
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
        />
      </div>

      {showPregnancyPrompt && (
        <div style={styles.formGroup}>
          <label style={styles.label} htmlFor="consult-pregnancy">Pregnancy status * <span style={{ fontWeight: 400 }}>(needed for safe prescribing)</span></label>
          <select id="consult-pregnancy" style={styles.input} value={form.pregnancy_status || ''} onChange={e => setForm({ ...form, pregnancy_status: e.target.value })}>
            <option value="">-- Select --</option>
            <option value="Not pregnant">Not pregnant</option>
            <option value="Pregnant">Pregnant</option>
            <option value="Possibly pregnant">Possibly pregnant / unsure</option>
            <option value="Breastfeeding">Breastfeeding</option>
          </select>
        </div>
      )}
      {patientAllergies && !/^\s*(nil|none|nkda|no known)/i.test(patientAllergies) && (
        <div role="note" style={{ background: '#FEF3F2', color: '#B42318', border: '1px solid #FDA29B', borderRadius: 8, padding: '8px 10px', fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
          Allergies: {patientAllergies}
        </div>
      )}

      <ConsultationPrescriptions
        showRx={showRx}
        setShowRx={setShowRx}
        rxList={rxList}
        updateRxField={updateRxField}
        inventory={inventory}
        setRxList={setRxList}
        styles={styles}
        cdsAlertsByRow={cdsAlertsByRow}
        onCdsAcknowledge={onCdsAcknowledge}
        onCdsReasonChange={onCdsReasonChange}
        canAcknowledgeDanger={canAcknowledgeDanger}
      />

      <div style={{ ...styles.sectionLabel, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>🔬 Lab Orders</span>
        <button
          style={styles.toggleBtn}
          onClick={() => setShowLabOrders(!showLabOrders)}
          disabled={!canOrderLabs}
          title={!canOrderLabs ? 'Only doctors can order lab tests' : ''}
        >
          {showLabOrders ? '− Hide' : '+ Order Lab Tests'}
        </button>
      </div>
      {showLabOrders && (
        <div style={{ marginBottom: '16px' }}>
          {labOrders.map((lab, index) => (
            <div key={index} style={styles.rxRow}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Category</label>
                  <select
                    style={styles.input}
                    value={lab.category}
                    onChange={e => {
                      const next = [...labOrders]
                      next[index].category = e.target.value
                      setLabOrders(next)
                    }}
                  >
                    {LAB_TEST_CATEGORIES.map(category => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Test Name</label>
                  <input
                    style={styles.input}
                    list={`consult-lab-tests-${index}`}
                    placeholder={lab.category === 'Microbiology' ? 'e.g. Bacterial Culture & Sensitivity (C&S)' : 'e.g. Full Blood Count'}
                    value={lab.test_type}
                    onChange={e => {
                      const next = [...labOrders]
                      next[index].test_type = e.target.value
                      setLabOrders(next)
                    }}
                  />
                  <datalist id={`consult-lab-tests-${index}`}>
                    {getLabTestsForCategory(lab.category).map(test => (
                      <option key={test} value={test} />
                    ))}
                  </datalist>
                  {lab.category === 'Microbiology' && (
                    <div style={{ fontSize: 11, color: '#0F6E56', marginTop: 5 }}>
                      Pick a C&S request here so the lab order can later feed the antibiogram workflow.
                    </div>
                  )}
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Priority</label>
                  <select
                    style={styles.input}
                    value={lab.priority}
                    onChange={e => {
                      const next = [...labOrders]
                      next[index].priority = e.target.value
                      setLabOrders(next)
                    }}
                  >
                    <option>Routine</option>
                    <option>Urgent</option>
                    <option>STAT</option>
                  </select>
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Notes</label>
                  <input
                    style={styles.input}
                    placeholder="Instructions"
                    value={lab.notes}
                    onChange={e => {
                      const next = [...labOrders]
                      next[index].notes = e.target.value
                      setLabOrders(next)
                    }}
                  />
                </div>
              </div>
              {labOrders.length > 1 && (
                <button style={styles.removeBtn} onClick={() => setLabOrders(labOrders.filter((_, j) => j !== index))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <button
            style={styles.addRowBtn}
            onClick={() => setLabOrders([...labOrders, { test_type: '', priority: 'Routine', notes: '', category: 'Haematology' }])}
          >
            + Add Another Test
          </button>
        </div>
      )}

      <div style={styles.sectionLabel}>Disposition *</div>

      {hasLabResults && (
        <div
          style={{
            background: 'linear-gradient(135deg, #f0faf7, #e8f5ff)',
            border: '1.5px solid #9FE1CB',
            borderRadius: 12,
            padding: '14px 16px',
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, color: '#0F6E56', marginBottom: 10 }}>
            🔬 Lab Results Summary — decide next step:
          </div>
          {completedLabsThisVisit.some(l => l.interpretation && (l.interpretation.toLowerCase().includes('abnormal') || l.interpretation.toLowerCase().includes('positive'))) && (
            <div
              style={{
                background: '#FCEBEB',
                border: '1px solid #F09595',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: '#A32D2D', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Abnormal / Positive Results
              </div>
              {completedLabsThisVisit
                .filter(l => l.interpretation && (l.interpretation.toLowerCase().includes('abnormal') || l.interpretation.toLowerCase().includes('positive')))
                .map(l => (
                  <div
                    key={l.id}
                    style={{ fontSize: 12, color: '#A32D2D', marginBottom: 4, display: 'flex', gap: 8, alignItems: 'baseline' }}
                  >
                    <span style={{ fontWeight: 700 }}>{l.test_type}</span>
                    {l.result_value && <span style={{ fontWeight: 600 }}>{l.result_value}</span>}
                    {l.reference_range && <span style={{ color: '#888', fontSize: 11 }}>Ref: {l.reference_range}</span>}
                    <span style={{ fontSize: 11, fontStyle: 'italic' }}>{l.interpretation}</span>
                  </div>
                ))}
            </div>
          )}
          {completedLabsThisVisit.some(l => l.interpretation && (l.interpretation.toLowerCase().includes('normal') || l.interpretation.toLowerCase().includes('negative'))) && (
            <div style={{ background: '#E1F5EE', border: '1px solid #9FE1CB', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                Normal / Negative
              </div>
              {completedLabsThisVisit
                .filter(l => l.interpretation && (l.interpretation.toLowerCase().includes('normal') || l.interpretation.toLowerCase().includes('negative')))
                .map(l => (
                  <div key={l.id} style={{ fontSize: 12, color: '#0F6E56', marginBottom: 2 }}>
                    <span style={{ fontWeight: 600 }}>{l.test_type}</span>
                    {l.result_value && <span style={{ marginLeft: 8 }}>{l.result_value}</span>}
                  </div>
                ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Select your decision below ↓</div>
        </div>
      )}

      <div style={styles.dispositionGrid}>
        {DISPOSITIONS.map(disposition => (
          <div
            key={disposition}
            style={{ ...styles.dispOption, ...(form.disposition === disposition ? styles.dispOptionActive : {}) }}
            onClick={() => {
              setForm({ ...form, disposition })
              if (disposition.includes('Lab')) setShowLabOrders(true)
              if (disposition.includes('Pharmacy') || disposition.includes('Admit')) setShowRx(true)
            }}
          >
            <span style={{ fontSize: '16px' }}>
              {disposition.includes('Home') ? '🏠' : disposition.includes('Admit') ? '' : disposition.includes('Refer') ? '↗' : disposition.includes('Lab') ? '🔬' : disposition.includes('Pharmacy') ? '' : ''}
            </span>
            <span style={{ fontSize: '13px', fontWeight: '500' }}>{disposition}</span>
          </div>
        ))}
      </div>

      {form.disposition?.includes('Refer') && (
        <div style={{ background: '#EAF5EF', border: '1.5px solid #B4E5D0', borderRadius: 12, padding: '16px', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#7B5EA7', marginBottom: 12 }}>↗ Referral Details</div>
          <div style={styles.formGrid2}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Refer to Department *</label>
              <select
                style={{ ...styles.input, borderColor: '#B4E5D0' }}
                value={form.refer_department}
                onChange={e => setForm({ ...form, refer_department: e.target.value, speciality: e.target.value })}
              >
                <option value="">-- Select Department --</option>
                {referralGroups.map(group => (
                  <optgroup key={group.group} label={group.group}>
                    {group.options.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Ward / Unit (optional)</label>
              <select
                style={{ ...styles.input, borderColor: '#B4E5D0' }}
                value={form.refer_ward}
                onChange={e => setForm({ ...form, refer_ward: e.target.value })}
              >
                <option value="">-- Select Ward --</option>
                {wardsList.length > 0
                  ? wardsList.map(ward => (
                      <option key={ward.id} value={ward.name}>
                        {ward.name}
                        {ward.ward_type ? ` (${ward.ward_type})` : ''}
                      </option>
                    ))
                  : ['General Ward', 'Maternity Ward', 'Paediatric Ward', 'ICU / HDU', 'Surgical Ward', 'Private Ward', 'Casualty'].map(ward => (
                      <option key={ward} value={ward}>
                        {ward}
                      </option>
                    ))}
              </select>
            </div>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Attention / Specialist Name (optional)</label>
            <input
              style={{ ...styles.input, borderColor: '#B4E5D0' }}
              placeholder="e.g. Dr. Ochieng — Cardiology, or leave blank"
              value={form.refer_to}
              onChange={e => setForm({ ...form, refer_to: e.target.value })}
            />
            <div style={{ fontSize: 11, color: '#7B5EA7', marginTop: 4 }}>
              The patient will appear in the {form.refer_department || 'selected department'}'s queue automatically.
            </div>
          </div>
        </div>
      )}

      <div style={styles.formGroup}>
        <label style={styles.label}>Follow-up Date (if applicable)</label>
        <input
          style={styles.input}
          type="date"
          value={form.follow_up_date}
          onChange={e => setForm({ ...form, follow_up_date: e.target.value })}
        />
        {onBookFollowUp && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
            {[[14, '2 weeks'], [28, '1 month'], [90, '3 months']].map(([days, label]) => (
              <button key={days} type="button" style={{ ...styles.cancelBtn, padding: '5px 10px', fontSize: '11px' }}
                onClick={() => onBookFollowUp({ inDays: days })}>Book in {label}</button>
            ))}
            {form.follow_up_date && (
              <button type="button" style={{ ...styles.cancelBtn, padding: '5px 10px', fontSize: '11px' }}
                onClick={() => onBookFollowUp({ date: form.follow_up_date })}>Book on {form.follow_up_date}</button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
        <button style={styles.cancelBtn} onClick={onCancel}>
          Cancel
        </button>
        <button style={{ ...styles.submitBtn, background: '#7B5EA7', flex: 1 }} onClick={onSaveDraft} disabled={savingDraft}>
          {savingDraft ? 'Saving Draft...' : '💾 Save Draft'}
        </button>
        <button
          style={{ ...styles.submitBtn, flex: 1 }}
          onClick={onSave}
          disabled={saving || !canSaveConsultation}
          title={!canSaveConsultation ? 'Only doctors and clinical officers can save consultations' : ''}
        >
          {saving ? 'Saving...' : ' Save Consultation & Proceed'}
        </button>
      </div>
    </div>
  )
}

const DISPOSITIONS = ['OPD - Send Home', 'Admit - Inpatient', 'Refer to Specialist', 'Send to Lab', 'Send to Pharmacy', 'Emergency Admit']
