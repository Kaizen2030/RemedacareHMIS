// Scheduling helpers shared by Appointments, its schedule manager / waiting list, and Consultation.
// The database (20261116000000_scheduling.sql) is the source of truth: it refuses double-bookings and
// bookings outside working hours, so these helpers only make the UI friendly and fast.
import supabase from '../supabase'

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const ACTIVE_STATUSES = ['Scheduled', 'Confirmed', 'Arrived']

/** YYYY-MM-DD in the computer's local calendar (not UTC, which is "yesterday" before 3 a.m. in Kenya). */
export function localDateKey(date = new Date()) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addMinutesToTime(time, minutes) {
  const [h = 0, m = 0] = String(time || '00:00').split(':').map(Number)
  const total = h * 60 + m + Number(minutes || 0)
  const wrapped = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

export const timeToMinutes = (time) => {
  const [h = 0, m = 0] = String(time || '00:00').split(':').map(Number)
  return h * 60 + m
}

/** Slots for one clinician on one day from the database: [{ slot:'09:00', end:'09:30', available, reason }]. */
export async function fetchSlots({ hospitalId, clinicianId, date, minutes = 30 }) {
  if (!hospitalId || !clinicianId || !date) return []
  const { data, error } = await supabase.rpc('sched_available_slots', {
    p_hospital: hospitalId, p_clinician: String(clinicianId), p_date: date, p_minutes: Number(minutes) || 30,
  })
  if (error) throw new Error(error.message)
  return (data || []).map((row) => ({
    slot: String(row.slot).slice(0, 5), end: String(row.slot_end).slice(0, 5), available: Boolean(row.available), reason: row.reason || null,
  }))
}

/**
 * Turn a database refusal into something a receptionist can act on.
 * needsOverride = the clinician is off / outside hours (an override reason can book anyway);
 * a double-booking can never be overridden.
 */
export function friendlyScheduleError(message = '') {
  const msg = String(message || '')
  if (/already has an appointment/i.test(msg)) return { message: msg.replace(/^.*?:\s*/, ''), needsOverride: false, kind: 'double_booking' }
  if (/outside working hours|on leave|not available/i.test(msg)) return { message: msg.replace(/^.*?:\s*/, ''), needsOverride: true, kind: 'outside_schedule' }
  if (/row-level security|permission denied/i.test(msg)) return { message: 'You do not have permission to change appointments.', needsOverride: false, kind: 'rls' }
  return { message: msg || 'Could not save the appointment.', needsOverride: false, kind: 'other' }
}

/** Dates for a recurring series: every N weeks, `count` visits in total (first included). */
export function recurrenceDates(startDate, everyWeeks = 1, count = 1) {
  const n = Math.max(1, Math.min(52, Number(count) || 1))
  const step = Math.max(1, Math.min(26, Number(everyWeeks) || 1)) * 7
  const [y, m, d] = String(startDate).split('-').map(Number)
  return Array.from({ length: n }, (_, i) => localDateKey(new Date(y, m - 1, d + i * step)))
}

/** A private video room for telehealth appointments (Jitsi Meet, no account needed). */
export function telehealthLink(seed = '') {
  const rand = (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, '').slice(0, 16)
  const tag = String(seed).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()
  return `https://meet.jit.si/remedacare-${tag ? `${tag}-` : ''}${rand}`
}

/** Weekly windows for a clinician on a weekday, from rows of provider_schedules (client-side shading only). */
export function windowsFor(schedules = [], clinicianId, date) {
  const dow = new Date(`${date}T12:00:00`).getDay()
  return schedules
    .filter((s) => s.active !== false && String(s.staff_id) === String(clinicianId) && Number(s.weekday) === dow
      && (!s.valid_from || date >= s.valid_from) && (!s.valid_to || date <= s.valid_to))
    .map((s) => [timeToMinutes(s.start_time), timeToMinutes(s.end_time)])
}

/** Is [start, start+minutes) inside the clinician's template on that date? null = clinician has no template. */
export function insideTemplate(schedules = [], exceptions = [], clinicianId, date, start, minutes = 30) {
  const own = schedules.filter((s) => s.active !== false && String(s.staff_id) === String(clinicianId))
  const from = timeToMinutes(start), to = from + Number(minutes || 30)
  const blocked = exceptions.some((e) => String(e.staff_id) === String(clinicianId) && ['leave', 'off'].includes(e.kind)
    && date >= e.starts_on && date <= e.ends_on
    && (!e.start_time || (timeToMinutes(e.start_time) < to && timeToMinutes(e.end_time) > from)))
  if (blocked) return false
  if (own.length === 0) return null
  const extra = exceptions.some((e) => String(e.staff_id) === String(clinicianId) && e.kind === 'extra'
    && date >= e.starts_on && date <= e.ends_on && (!e.start_time || (timeToMinutes(e.start_time) <= from && timeToMinutes(e.end_time) >= to)))
  return extra || windowsFor(own, clinicianId, date).some(([a, b]) => a <= from && b >= to)
}
