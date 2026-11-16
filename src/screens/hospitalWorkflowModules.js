import { canCloseSafetyEvent } from '../utils/qualitySafety'
import { triageEmergency } from '../utils/emergency'
import { canCompleteCase, canStartCase, hasRoomDoubleBooking } from '../utils/theatre'
import { canRequestBodyRelease } from '../utils/morgue'

function toLocalDateTimeInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function toIsoDateTime(value) {
  if (!value) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

const clinicalRoles = ['Admin', 'Doctor', 'Nurse']

export const HOSPITAL_WORKFLOW_MODULES = {
  theatre: {
    code: 'theatre', title: 'Operation Theatre', recordLabel: 'Surgery case', description: 'Patient-linked theatre scheduling with room conflict checks and an operative checklist.', patientMode: 'required', requiresVisit: true, visitRouting: { Open: { status: 'Theatre', speciality: 'Theatre / Surgery' }, 'In Progress': { status: 'Theatre', speciality: 'Theatre / Surgery' }, Completed: { status: 'Admitted', speciality: 'Inpatient / Wards' } }, roles: clinicalRoles, titleField: 'case_reference', statuses: ['Open', 'In Progress', 'Completed', 'Cancelled'],
    initialValues: { checklist_sign_in: 'No', checklist_time_out: 'No', checklist_sign_out: 'No' },
    prepareDetails: (details) => ({
      ...details,
      start_time: toIsoDateTime(details.start_time),
      end_time: toIsoDateTime(details.end_time),
    }),
    prepareForm: (record) => ({
      checklist_sign_in: record.details?.checklist_sign_in || 'No',
      checklist_time_out: record.details?.checklist_time_out || 'No',
      checklist_sign_out: record.details?.checklist_sign_out || 'No',
      start_time: toLocalDateTimeInput(record.details?.start_time),
      end_time: toLocalDateTimeInput(record.details?.end_time),
    }),
    validateRecord: (details, records, { editingId }) => {
      const start = new Date(details.start_time).getTime()
      const end = new Date(details.end_time).getTime()
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'The case end time must be after its start time.'
      const activeSchedule = records
        .filter((record) => record.id !== editingId && !['Completed', 'Cancelled'].includes(record.status))
        .map((record) => ({ id: record.id, ...record.details }))
      return hasRoomDoubleBooking(activeSchedule, { id: editingId, ...details })
        ? 'This operating room is already booked during the selected time.'
        : ''
    },
    validateStatus: (record, status) => {
      if (status !== 'In Progress' && status !== 'Completed') return ''
      const caseDetails = {
        patient_id: record.patient_id,
        surgeon: record.details?.surgeon,
        room_id: record.details?.room_id,
        start_time: record.details?.start_time,
        checklist: {
          sign_in: record.details?.checklist_sign_in === 'Yes',
          time_out: record.details?.checklist_time_out === 'Yes',
          sign_out: record.details?.checklist_sign_out === 'Yes',
        },
      }
      const readiness = status === 'Completed' ? canCompleteCase(caseDetails) : canStartCase(caseDetails)
      return readiness.allowed ? '' : readiness.reason
    },
    fields: [
      { key: 'case_reference', label: 'Case reference', required: true },
      { key: 'procedure', label: 'Procedure', required: true },
      { key: 'surgeon', label: 'Lead surgeon', required: true },
      { key: 'room_id', label: 'Operating room', required: true },
      { key: 'start_time', label: 'Start time', type: 'datetime-local', required: true },
      { key: 'end_time', label: 'End time', type: 'datetime-local', required: true },
      { key: 'checklist_sign_in', label: 'Sign-in checklist', type: 'select', options: ['No', 'Yes'], required: true },
      { key: 'checklist_time_out', label: 'Time-out checklist', type: 'select', options: ['No', 'Yes'], required: true },
      { key: 'checklist_sign_out', label: 'Sign-out checklist', type: 'select', options: ['No', 'Yes'], required: true },
    ],
  },
  morgue: {
    code: 'morgue', title: 'Morgue and Mortuary', recordLabel: 'Mortuary admission', description: 'Body register with verified identity, medico-legal authority, and controlled release.', patientMode: 'optional', roles: ['Admin', 'Doctor', 'Nurse', 'Mortuary Attendant'], titleField: 'body_reference', statuses: ['Open', 'In Progress', 'Release Requested', 'Released', 'Cancelled'], completedStatuses: ['Released'], canEditRecord: (record) => record.status === 'Open',
    prepareForm: (record) => ({
      medico_legal: record.details?.medico_legal ? 'Yes' : 'No',
      id_verified: record.details?.id_verified ? 'Yes' : 'No',
    }),
    prepareDetails: (details) => ({
      ...details,
      medico_legal: details.medico_legal === 'Yes',
      id_verified: details.id_verified === 'Yes',
    }),
    validateStatus: (record, status) => {
      if (status === 'Release Requested') {
        const releaseRequest = canRequestBodyRelease(record.details || {})
        return releaseRequest.allowed ? '' : releaseRequest.reason
      }
      if (status === 'Released') {
        const releaseRequest = canRequestBodyRelease(record.details || {})
        if (!releaseRequest.allowed) return releaseRequest.reason
        if (!record.details?.release_requested_by_user_id) {
          return 'Request release first. A different authenticated staff member must approve it.'
        }
      }
      return ''
    },
    fields: [
      { key: 'body_reference', label: 'Body reference', required: true },
      { key: 'deceased_name', label: 'Deceased name', required: true },
      { key: 'admission_date', label: 'Admission date', type: 'date', required: true },
      { key: 'chamber', label: 'Chamber', required: true },
      { key: 'medico_legal', label: 'Medico-legal case', type: 'select', options: ['No', 'Yes'], required: true },
      { key: 'id_verified', label: 'Identity verified', type: 'select', options: ['No', 'Yes'], required: true },
      { key: 'authority_document', label: 'Authority document reference' },
    ],
  },
  icu: {
    code: 'icu', title: 'ICU & Critical Care', recordLabel: 'ICU admission', description: 'Patient-linked critical-care admissions and status tracking.', patientMode: 'required', requiresVisit: true, visitRouting: { Open: { status: 'ICU', speciality: 'ICU / HDU', assignedDoctor: null }, 'In Progress': { status: 'ICU', speciality: 'ICU / HDU' }, Completed: { status: 'Admitted', speciality: 'Inpatient / Wards' } }, roles: clinicalRoles,
    fields: [
      { key: 'severity', label: 'Severity', type: 'select', options: ['Critical', 'High', 'Moderate', 'Stable'], required: true },
      { key: 'bed_reference', label: 'ICU bed reference', required: true },
      { key: 'oxygen_lpm', label: 'Oxygen requirement (L/min)', type: 'number', min: 0, step: 0.1 },
      { key: 'nurse_ratio', label: 'Nurse-to-patient ratio', placeholder: '1:1' },
      { key: 'clinical_notes', label: 'Clinical notes', type: 'textarea' },
    ],
  },
  emergency: {
    code: 'emergency', title: 'Emergency Department', recordLabel: 'Emergency triage', description: 'Patient-linked emergency presentations and triage handoff.', patientMode: 'required', requiresVisit: true, visitRouting: { Open: { status: 'Emergency', speciality: 'Emergency', assignedDoctor: null }, 'In Progress': { status: 'Emergency', speciality: 'Emergency' } }, roles: clinicalRoles,
    prepareDetails: (details) => ({
      ...details,
      triage_category: triageEmergency({
        severity: details.severity,
        vitals: { systolic: details.bp_systolic, pulse: details.pulse_bpm },
      }),
    }),
    fields: [
      { key: 'chief_complaint', label: 'Chief complaint', required: true },
      { key: 'severity', label: 'Triage code', type: 'select', options: ['Red', 'Yellow', 'Green'], required: true },
      { key: 'bp_systolic', label: 'Systolic blood pressure (mmHg)', type: 'number', min: 0, step: 1 },
      { key: 'pulse_bpm', label: 'Pulse (bpm)', type: 'number', min: 0, step: 1 },
      { key: 'assigned_clinician', label: 'Assigned clinician' },
      { key: 'notes', label: 'Triage notes', type: 'textarea' },
    ],
  },
  dialysis: {
    code: 'dialysis', title: 'Dialysis & Renal Care', recordLabel: 'Dialysis session', description: 'Patient-linked renal session scheduling and clinical monitoring.', patientMode: 'required', requiresVisit: true, visitRouting: { Open: { status: 'Doctor', speciality: 'General Medicine', assignedDoctor: null }, 'In Progress': { status: 'Doctor', speciality: 'General Medicine' } }, roles: clinicalRoles,
    fields: [
      { key: 'session_at', label: 'Session date and time', type: 'datetime-local', required: true },
      { key: 'risk', label: 'Risk', type: 'select', options: ['Low', 'Medium', 'High'], required: true },
      { key: 'access_status', label: 'Vascular access', type: 'select', options: ['Good', 'Compromised', 'Review required'] },
      { key: 'potassium_mmol_l', label: 'Potassium (mmol/L)', type: 'number', min: 0, step: 0.1 },
      { key: 'notes', label: 'Session notes', type: 'textarea' },
    ],
  },
  maternity: {
    code: 'maternity', title: 'Maternity & Neonatal Care', recordLabel: 'Maternity episode', description: 'Patient-linked labour, delivery, and postnatal episode tracking.', patientMode: 'required', requiresVisit: true, visitRouting: { Open: { status: 'Maternity', speciality: 'Maternity', assignedDoctor: null }, 'In Progress': { status: 'Maternity', speciality: 'Maternity' } }, roles: clinicalRoles,
    fields: [
      { key: 'gestational_weeks', label: 'Gestational age (weeks)', type: 'number', min: 0, max: 45, step: 0.1, required: true },
      { key: 'risk', label: 'Risk', type: 'select', options: ['Low', 'Medium', 'High'], required: true },
      { key: 'care_stage', label: 'Care stage', type: 'select', options: ['Antenatal', 'Labour', 'Delivery', 'Postnatal', 'Neonatal'] },
      { key: 'notes', label: 'Clinical notes', type: 'textarea' },
    ],
  },
  telemedicine: {
    code: 'telemedicine', title: 'Telemedicine & Remote Consults', recordLabel: 'Remote consultation', description: 'Patient-linked remote consultation requests and status handoff.', patientMode: 'required', requiresVisit: true, visitRouting: { Open: { status: 'Doctor', speciality: 'OPD / Outpatient', assignedDoctor: null }, 'In Progress': { status: 'Doctor', speciality: 'OPD / Outpatient' } }, roles: clinicalRoles,
    fields: [
      { key: 'reason', label: 'Reason for consultation', required: true },
      { key: 'priority', label: 'Priority', type: 'select', options: ['Routine', 'Urgent', 'Critical'], required: true },
      { key: 'scheduled_at', label: 'Scheduled date and time', type: 'datetime-local' },
      { key: 'connection_status', label: 'Connection status', type: 'select', options: ['Not checked', 'Ready', 'Unstable'] },
    ],
  },
  biomedical: {
    code: 'biomedical', title: 'Biomedical & Equipment', recordLabel: 'Equipment service record', description: 'Equipment service, repair, and calibration records for this hospital.', patientMode: null, roles: ['Admin', 'Lab Technician'], titleField: 'equipment_name',
    fields: [
      { key: 'equipment_name', label: 'Equipment name or asset tag', required: true },
      { key: 'equipment_type', label: 'Equipment type', required: true },
      { key: 'service_type', label: 'Service type', type: 'select', options: ['Preventive maintenance', 'Repair', 'Calibration', 'Inspection'], required: true },
      { key: 'due_date', label: 'Next service due', type: 'date' },
      { key: 'notes', label: 'Service notes', type: 'textarea' },
    ],
  },
  hivtb: {
    code: 'hivtb', title: 'HIV & TB Care', recordLabel: 'HIV/TB care review', description: 'Restricted patient-linked treatment and follow-up review records.', patientMode: 'required', requiresVisit: true, visitRouting: { Open: { status: 'Doctor', speciality: 'OPD / Outpatient', assignedDoctor: null }, 'In Progress': { status: 'Doctor', speciality: 'OPD / Outpatient' } }, roles: clinicalRoles,
    fields: [
      { key: 'care_type', label: 'Care programme', type: 'select', options: ['HIV', 'TB', 'HIV and TB'], required: true },
      { key: 'regimen', label: 'Current regimen', required: true },
      { key: 'adherence_percent', label: 'Adherence (%)', type: 'number', min: 0, max: 100, step: 1 },
      { key: 'follow_up_date', label: 'Next follow-up', type: 'date' },
      { key: 'notes', label: 'Care notes', type: 'textarea' },
    ],
  },
  nutrition: {
    code: 'nutrition', title: 'Nutrition & Dietetics', recordLabel: 'Nutrition assessment', description: 'Patient-linked nutrition assessment and dietitian follow-up.', patientMode: 'required', requiresVisit: true, visitRouting: { Open: { status: 'Doctor', speciality: 'Nutrition & Dietetics', assignedDoctor: null }, 'In Progress': { status: 'Doctor', speciality: 'Nutrition & Dietetics' } }, roles: clinicalRoles,
    fields: [
      { key: 'assessment_date', label: 'Assessment date', type: 'date', required: true },
      { key: 'bmi', label: 'BMI', type: 'number', min: 0, step: 0.1 },
      { key: 'risk', label: 'Nutrition risk', type: 'select', options: ['Low', 'Monitor', 'At risk'], required: true },
      { key: 'diet_plan', label: 'Diet plan', type: 'textarea', required: true },
    ],
  },
  'quality-safety': {
    code: 'quality-safety', title: 'Quality & Safety', recordLabel: 'Safety incident', description: 'Hospital incident reports and corrective-action tracking.', patientMode: 'optional', roles: ['Admin', 'Doctor', 'Nurse', 'Accountant'], titleField: 'incident_type',
    validateStatus: (record, status) => {
      if (status !== 'Completed') return ''
      const canClose = canCloseSafetyEvent({
        rootCauseIdentified: record.details?.root_cause_identified === 'Yes',
        correctiveActionComplete: record.details?.corrective_action_complete === 'Yes',
        approved: record.details?.approved === 'Yes',
      })
      return canClose ? '' : 'Safety incidents require a confirmed root cause, completed corrective action, and approval before closure.'
    },
    fields: [
      { key: 'incident_type', label: 'Incident type', required: true },
      { key: 'severity', label: 'Severity', type: 'select', options: ['Low', 'Moderate', 'High', 'Critical'], required: true },
      { key: 'occurred_at', label: 'Incident date and time', type: 'datetime-local', required: true },
      { key: 'corrective_action', label: 'Immediate action or follow-up', type: 'textarea', required: true },
      { key: 'root_cause_identified', label: 'Root cause identified', type: 'select', options: ['Yes', 'No'], required: true },
      { key: 'corrective_action_complete', label: 'Corrective action complete', type: 'select', options: ['Yes', 'No'], required: true },
      { key: 'approved', label: 'Closure approved', type: 'select', options: ['Yes', 'No'], required: true },
    ],
  },
  payroll: {
    code: 'payroll', title: 'Payroll & Biometric Attendance', recordLabel: 'Payroll entry', description: 'Restricted hospital payroll-period records; access is limited to finance and administrators.', patientMode: null, roles: ['Admin', 'Accountant'], titleField: 'employee_name',
    fields: [
      { key: 'employee_name', label: 'Employee name or staff ID', required: true },
      { key: 'pay_period', label: 'Pay period', type: 'month', required: true },
      { key: 'gross_amount', label: 'Gross amount (KES)', type: 'number', min: 0, step: 0.01, required: true },
      { key: 'deductions', label: 'Deductions (KES)', type: 'number', min: 0, step: 0.01, required: true },
      { key: 'attendance_status', label: 'Attendance status', type: 'select', options: ['Not reconciled', 'Reconciled', 'Exception'], required: true },
    ],
  },
  procurement: {
    code: 'procurement', title: 'Procurement & Supply Chain', recordLabel: 'Purchase request', description: 'Hospital purchase requests and approval status, scoped to the active hospital.', patientMode: null, roles: ['Admin', 'Accountant', 'Pharmacist'], titleField: 'item_name', statuses: ['Open', 'Pending', 'In Progress', 'Received', 'Cancelled'], completedStatuses: ['Received'],
    fields: [
      { key: 'item_name', label: 'Item or service', required: true },
      { key: 'vendor', label: 'Vendor or supplier' },
      { key: 'quantity', label: 'Quantity', type: 'number', min: 1, step: 1, required: true },
      { key: 'estimated_total_kes', label: 'Estimated total (KES)', type: 'number', min: 0, step: 0.01, required: true },
      { key: 'justification', label: 'Purchase justification', type: 'textarea', required: true },
    ],
  },
}
