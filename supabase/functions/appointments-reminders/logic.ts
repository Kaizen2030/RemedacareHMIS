// Pure helpers for the appointment reminder sender (unit-tested in supabase/tests/edge-reminders.test.ts).
import { normalizeKenyanPhone } from '../_shared/phone.ts'

export const DEFAULT_REMINDER_TEMPLATE =
  'Dear {{patient_name}}, reminder: you have an appointment at {{hospital_name}} on {{date_time}}.'

export type ReminderRow = {
  id: string; hospital_id: string; appointment_id: string; kind: '48h' | '2h' | 'missed' | 'offer'
  due_at: string; phone: string | null; message: string | null; confirm_token: string | null; attempts: number
}
export type AppointmentInfo = {
  patient_name?: string | null; doctor_name?: string | null; starts_at?: string | null; status?: string | null
}

export function formatNairobi(iso: string) {
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '')

/** Whether a queued reminder should still be sent, and if not, why. */
export function skipReason(r: ReminderRow, appt: AppointmentInfo | null, enabled: boolean, now = Date.now()): string | null {
  if (!enabled) return 'Appointment reminders are switched off in Settings → Notifications'
  if (!normalizeKenyanPhone(r.phone)) return 'No valid Kenyan phone number on the patient record'
  if (r.kind === 'offer') return null
  if (!appt) return 'Appointment no longer exists'
  if (r.kind === 'missed') return appt.status === 'No-Show' ? null : 'Visit is no longer marked missed'
  if (!['Scheduled', 'Confirmed'].includes(appt.status || 'Scheduled')) return `Appointment is ${appt.status}`
  if (!appt.starts_at || new Date(appt.starts_at).getTime() <= now) return 'Appointment time has passed'
  if (now - new Date(r.due_at).getTime() > 6 * 3600e3) return 'Too late to send this reminder'
  return null
}

export function buildMessage(r: ReminderRow, appt: AppointmentInfo | null, opts: {
  hospitalName: string; template?: string | null; confirmBase: string
}): string {
  const name = (appt?.patient_name || '').split(' ')[0] || 'patient'
  if (r.kind === 'offer') return `${opts.hospitalName}: ${r.message || 'An earlier appointment slot is now free. Call us to take it.'}`
  if (r.kind === 'missed') {
    return `Dear ${name}, we missed you at ${opts.hospitalName} today. Please call us to book a new appointment.`
  }
  const when = appt?.starts_at ? formatNairobi(appt.starts_at) : ''
  const base = fill(opts.template || DEFAULT_REMINDER_TEMPLATE, {
    patient_name: name, hospital_name: opts.hospitalName, date_time: when, doctor_name: appt?.doctor_name || '',
  }).replace(/\s*Reply CANCEL to cancel\.?/i, '').trim()
  const withDoctor = appt?.doctor_name && !base.includes(appt.doctor_name) ? `${base} With ${appt.doctor_name}.` : base
  return r.confirm_token ? `${withDoctor} Confirm: ${opts.confirmBase}?confirm=${r.confirm_token}` : withDoctor
}

/** Africa's Talking bulk SMS response → ok / error text. */
export function parseAfricasTalking(body: any): { ok: boolean; error?: string; messageId?: string } {
  const rec = body?.SMSMessageData?.Recipients?.[0]
  if (rec && /success/i.test(String(rec.status))) return { ok: true, messageId: rec.messageId }
  return { ok: false, error: rec?.status || body?.SMSMessageData?.Message || 'SMS provider rejected the message' }
}

export function confirmPage(ok: boolean, text: string) {
  const color = ok ? '#027A48' : '#B42318'
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Appointment</title></head><body style="font-family:system-ui,sans-serif;display:flex;min-height:90vh;align-items:center;justify-content:center;margin:0;padding:16px;background:#F8FAFC">
<div style="max-width:420px;background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:28px;text-align:center">
<div style="font-size:40px">${ok ? '✅' : '⚠️'}</div><h1 style="font-size:20px;color:${color}">${ok ? 'Appointment confirmed' : 'Could not confirm'}</h1>
<p style="color:#475467;line-height:1.5">${esc(text)}</p></div></body></html>`
}
