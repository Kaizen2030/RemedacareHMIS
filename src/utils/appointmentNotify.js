// SMS / WhatsApp confirmation to the patient after an appointment is booked (same setting as the Appointments screen:
// Settings → Notifications → appointment reminder). Never throws: a failed message must not undo a booking.
import { buildMessage, DEFAULT_TEMPLATES, fetchNotificationConfig, getNotificationSetting, sendPatientNotification } from './notifications'

const whenText = (date, time) => {
  const [y, m, d] = String(date || '').split('-').map(Number)
  const day = y ? new Date(y, m - 1, d).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : ''
  return `${day} ${String(time || '').slice(0, 5)}`.trim()
}

export async function notifyBooking({ appointment, patient, hospitalId, hospitalName }) {
  try {
    if (!patient?.phone) return
    const setting = getNotificationSetting(await fetchNotificationConfig(hospitalId), 'appointment_reminder')
    if (!setting.enabled) return
    const message = buildMessage(setting.template || DEFAULT_TEMPLATES.appointment_reminder, {
      patient_name: patient.full_name || 'Patient',
      hospital_name: hospitalName || 'RemedacareHMS',
      date_time: whenText(appointment.appointment_date, appointment.start_time),
    })
    await sendPatientNotification({ phone: patient.phone, message, hospitalName, notificationType: 'appointment_reminder', patientId: appointment.patient_id, hospitalId })
  } catch (e) {
    console.warn('Appointment notification failed:', e)
  }
}
