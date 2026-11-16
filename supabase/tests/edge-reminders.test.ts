import { describe, expect, it } from 'vitest'
import { buildMessage, confirmPage, parseAfricasTalking, skipReason } from '../functions/appointments-reminders/logic.ts'

const now = Date.parse('2026-11-14T06:00:00Z')
const rem = (over: Record<string, unknown> = {}) => ({
  id: 'r1', hospital_id: 'h1', appointment_id: 'a1', kind: '48h', due_at: '2026-11-14T05:55:00Z',
  phone: '0712345678', message: null, confirm_token: 'abc123abc123abc123', attempts: 0, ...over,
}) as any
const appt = (over: Record<string, unknown> = {}) => ({
  status: 'Scheduled', starts_at: '2026-11-16T06:00:00Z', doctor_name: 'Dr Otieno', patient_name: 'Jane Wanjiku', ...over,
})

describe('appointment reminder rules', () => {
  it('sends when switched on, phone valid and appointment still ahead', () => {
    expect(skipReason(rem(), appt(), true, now)).toBeNull()
  })
  it('skips with a reason the clinic can understand', () => {
    expect(skipReason(rem(), appt(), false, now)).toMatch(/switched off/)
    expect(skipReason(rem({ phone: '12' }), appt(), true, now)).toMatch(/phone/)
    expect(skipReason(rem(), appt({ status: 'Cancelled' }), true, now)).toMatch(/Cancelled/)
    expect(skipReason(rem(), appt({ starts_at: '2026-11-14T05:00:00Z' }), true, now)).toMatch(/passed/)
    expect(skipReason(rem({ due_at: '2026-11-13T20:00:00Z' }), appt(), true, now)).toMatch(/Too late/)
    expect(skipReason(rem({ kind: 'missed' }), appt({ status: 'Arrived' }), true, now)).toMatch(/no longer/)
  })
  it('builds the message from the hospital template in Nairobi time with a confirm link', () => {
    const msg = buildMessage(rem(), appt(), {
      hospitalName: 'Afya Clinic',
      template: 'Dear {{patient_name}}, reminder: you have an appointment at {{hospital_name}} on {{date_time}}. Reply CANCEL to cancel.',
      confirmBase: 'https://x.supabase.co/functions/v1/appointments-reminders',
    })
    expect(msg).toMatch(/^Dear Jane, reminder: you have an appointment at Afya Clinic on Mon,? 16 Nov,? 09:00\./)
    expect(msg).toContain('With Dr Otieno.')
    expect(msg).not.toMatch(/Reply CANCEL/)
    expect(msg).toMatch(/Confirm: https:\/\/x\.supabase\.co\/functions\/v1\/appointments-reminders\?confirm=abc123abc123abc123$/)
  })
  it('missed-visit and waiting-list offer messages', () => {
    expect(buildMessage(rem({ kind: 'missed', confirm_token: null }), appt(), { hospitalName: 'Afya', confirmBase: '' })).toMatch(/we missed you at Afya today/)
    expect(buildMessage(rem({ kind: 'offer', message: 'A slot is free on Mon 16 Nov at 09:00.' }), null, { hospitalName: 'Afya', confirmBase: '' }))
      .toBe('Afya: A slot is free on Mon 16 Nov at 09:00.')
  })
  it("reads Africa's Talking responses", () => {
    expect(parseAfricasTalking({ SMSMessageData: { Recipients: [{ status: 'Success', messageId: 'ATX1' }] } })).toEqual({ ok: true, messageId: 'ATX1' })
    expect(parseAfricasTalking({ SMSMessageData: { Message: 'Sent to 0/1', Recipients: [{ status: 'InsufficientBalance' }] } }).error).toBe('InsufficientBalance')
    expect(parseAfricasTalking({}).ok).toBe(false)
  })
  it('the confirm page escapes text', () => {
    expect(confirmPage(false, '<script>x</script>')).toContain('&lt;script&gt;')
  })
})
