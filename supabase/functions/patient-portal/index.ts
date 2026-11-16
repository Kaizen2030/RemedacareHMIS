// Patient portal API (the web page is #/portal). POST JSON { action, ... }.
//   request_code { phone }            → SMS a 6-digit code (Africa's Talking). Same answer whether or not the number is known.
//   verify       { phone, code }      → { token } (12 h). Codes can also come from reception (Patients → Portal code).
//   summary                            → the phone's patients with appointments, results, medicines, immunisations, bills
//   request_appointment { patient_id, department, earliest_date, latest_date, preferred_times, reason }
//   cancel_appointment  { patient_id, appointment_id }
//   logout
// The session token goes in "Authorization: Bearer rcp_…". Read-mostly; payments stay at the cashier.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { cancelAppointment, findPatient, patientSummary, PortalError, requestAppointment, type PortalPatient } from '../_shared/portalCore.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const db = () => createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false, autoRefreshToken: false } })

async function sendSms(to: string, message: string) {
  const username = Deno.env.get('AT_USERNAME') || ''
  const apiKey = Deno.env.get('AT_API_KEY') || ''
  if (!username || !apiKey) return false
  const host = username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com'
  const form = new URLSearchParams({ username, to: '+' + to, message })
  const sender = Deno.env.get('AT_SENDER_ID')
  if (sender) form.set('from', sender)
  try {
    const res = await fetch(`${host}/version1/messaging`, {
      method: 'POST', headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
      signal: AbortSignal.timeout(15_000),
    })
    return res.ok
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  const admin = db()
  try {
    const body = await req.json().catch(() => ({})) as Record<string, any>
    const action = String(body.action || '')

    if (action === 'request_code') {
      const { data, error } = await admin.rpc('portal_request_code', { p_phone: String(body.phone || '') })
      if (error) throw new PortalError(500, 'Please try again in a moment.')
      if (data.status === 'invalid_phone') throw new PortalError(400, 'Enter a Kenyan mobile number, e.g. 0712 345 678.')
      if (data.status === 'rate_limited') throw new PortalError(429, 'Too many codes requested. Wait 15 minutes, or ask reception for a portal code.')
      if (data.status === 'ok') await sendSms(data.phone, `Your RemedacareHMS portal code is ${data.code}. It expires in 10 minutes. Never share this code.`)
      // Same answer for known and unknown numbers, so the page cannot be used to test who is a patient
      return json({ ok: true, message: 'If this number is registered at a facility using the portal, a code is on its way by SMS. No SMS? Ask reception for a portal code.' })
    }

    if (action === 'verify') {
      const { data, error } = await admin.rpc('portal_verify', { p_phone: String(body.phone || ''), p_code: String(body.code || '') })
      if (error) throw new PortalError(500, 'Please try again in a moment.')
      if (data.status === 'ok') return json({ ok: true, token: data.token, expires_at: data.expires_at })
      const msg: Record<string, string> = {
        invalid_phone: 'Enter a Kenyan mobile number, e.g. 0712 345 678.',
        expired: 'That code has expired or was already used. Request a new one.',
        locked: 'Too many wrong codes. Request a new code.',
        wrong: 'That code is not right. Check the SMS and try again.',
      }
      throw new PortalError(data.status === 'wrong' ? 401 : 400, msg[data.status] || 'Could not sign in.')
    }

    // Everything else needs a session
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token.startsWith('rcp_')) throw new PortalError(401, 'Please sign in.')
    if (action === 'logout') { await admin.rpc('portal_logout', { p_token: token }); return json({ ok: true }) }
    const { data: phone } = await admin.rpc('portal_session_phone', { p_token: token })
    if (!phone) throw new PortalError(401, 'Your session has ended. Please sign in again.')
    const { data: rows, error: pErr } = await admin.rpc('portal_patients', { p_phone: phone })
    if (pErr) throw new PortalError(500, 'Please try again in a moment.')
    const patients = (rows || []) as PortalPatient[]
    const log = (p: PortalPatient | null, event: string, details: unknown = null) =>
      admin.from('portal_events').insert({ phone, hospital_id: p?.hospital_id ?? null, patient_id: p?.patient_id ?? null, event, details }).then(() => null, () => null)

    if (action === 'summary') {
      const records = []
      for (const p of patients) records.push(await patientSummary(admin, p))
      await Promise.all(patients.map((p) => log(p, 'viewed')))
      return json({ ok: true, phone_hint: '07…' + String(phone).slice(-3), records, welcome: patients.find((p) => p.welcome_note)?.welcome_note || null })
    }
    if (action === 'request_appointment') {
      const p = findPatient(patients, body.patient_id)
      await requestAppointment(admin, p, phone, body)
      await log(p, 'appointment_requested', { department: body.department || null })
      return json({ ok: true, message: `Request sent to ${p.hospital_name || 'the facility'}. They will call or SMS you with a time.` })
    }
    if (action === 'cancel_appointment') {
      const p = findPatient(patients, body.patient_id)
      await cancelAppointment(admin, p, String(body.appointment_id || ''))
      await log(p, 'appointment_cancelled', { appointment_id: body.appointment_id })
      return json({ ok: true, message: 'Appointment cancelled.' })
    }
    throw new PortalError(400, 'Unknown action.')
  } catch (e) {
    if (e instanceof PortalError) return json({ error: e.message }, e.status)
    console.error('patient-portal failed:', e)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }
})
