// Scheduling engine: supabase/migrations/20261116000000_scheduling.sql on PGlite.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAYMENTS = read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, '')
const SCHED = read('../../migrations/20261116000000_scheduling.sql')

const H1 = '11111111-1111-1111-1111-111111111111', H2 = '22222222-2222-2222-2222-222222222222'
const REC = '00000000-0000-0000-0000-0000000000a1', OTHER = '00000000-0000-0000-0000-0000000000b1'
const DR_A = 'aaaaaaaa-0000-0000-0000-00000000000a', DR_B = 'bbbbbbbb-0000-0000-0000-00000000000b'
const PAT = '99999999-0000-0000-0000-000000000001', PAT2 = '99999999-0000-0000-0000-000000000002'

// The appointments table as the Appointments screen writes it.
const APPTS = `
  alter table patients add column phone text;
  update patients set phone = '0712345678';
  create table appointments(id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, doctor_id uuid,
    doctor_name text, department text, appointment_type text, appointment_date date, start_time time, end_time time,
    duration_minutes int, status text default 'Scheduled', notes text, visit_id uuid, created_by text,
    cancellation_reason text, completed_at timestamptz, created_at timestamptz default now());
  grant select, insert, update, delete on appointments to authenticated;
`

// A date some days ahead with a known weekday (Monday) so reminders are in the future.
function nextWeekday(dow, weeksAhead = 1) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 7 * weeksAhead)
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
const MON = nextWeekday(1), TUE = nextWeekday(2)

async function boot({ seedOverlap = false } = {}) {
  const db = new PGlite({ extensions: { btree_gist } })
  await db.exec(read('./stub.sql'))
  await db.exec(PAYMENTS)
  await db.exec(APPTS)
  if (seedOverlap) {
    await db.exec(`insert into appointments(hospital_id, patient_id, doctor_id, doctor_name, appointment_date, start_time, end_time, duration_minutes)
      values ('${H1}', '${PAT}', '${DR_A}', 'Dr A', '${MON}', '09:00', '09:30', 30), ('${H1}', '${PAT2}', '${DR_A}', 'Dr A', '${MON}', '09:15', '09:45', 30)`)
  }
  await db.exec(SCHED)
  return db
}
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const book = (db, { dr = DR_A, name = 'Dr A', date = MON, start = '09:00', mins = 30, patient = PAT, extra = '' } = {}) =>
  db.query(`insert into appointments(hospital_id, patient_id, doctor_id, doctor_name, appointment_date, start_time, duration_minutes${extra ? ', schedule_override_reason' : ''})
            values ($1, $2, $3, $4, $5, $6, $7${extra ? ', $8' : ''}) returning *`,
  [H1, patient, dr, name, date, start, mins, ...(extra ? [extra] : [])]).then((r) => r.rows[0])
async function refused(promise, re) {
  let msg = null
  try { await promise } catch (e) { msg = e.message }
  assert.ok(msg, 'should have been refused')
  if (re) assert.match(msg, re)
}

describe('no double-booking per clinician', () => {
  let db
  before(async () => { db = await boot(); await as(db, null) })

  it('refuses an overlapping booking for the same clinician, with a clear message', async () => {
    const a = await book(db, { start: '09:00' })
    assert.ok(a.starts_at && a.ends_at, 'starts_at / ends_at are filled in')
    await refused(book(db, { start: '09:15', patient: PAT2 }), /Dr A already has an appointment from 09:00 to 09:30/)
  })
  it('another clinician at the same time and back-to-back bookings are fine', async () => {
    await book(db, { dr: DR_B, name: 'Dr B', start: '09:00' })
    await book(db, { start: '09:30', patient: PAT2 })
  })
  it('a cancelled appointment frees the slot', async () => {
    await db.query("update appointments set status = 'Cancelled' where doctor_id = $1 and start_time = '09:30'", [DR_A])
    await book(db, { start: '09:30', patient: PAT2 })
  })
  it('rescheduling onto a taken slot is refused', async () => {
    const x = await book(db, { start: '11:00' })
    await refused(db.query("update appointments set start_time = '09:10' where id = $1", [x.id]), /already has an appointment/)
  })
  it('the database constraint is in place too', async () => {
    const { rows } = await db.query("select 1 from pg_constraint where conname = 'appointments_no_clinician_overlap'")
    assert.equal(rows.length, 1)
  })
})

describe('working hours, leave and extra sessions', () => {
  let db
  before(async () => {
    db = await boot(); await as(db, null)
    await db.exec(`insert into provider_schedules(hospital_id, staff_id, weekday, start_time, end_time, slot_minutes)
                   values ('${H1}', '${DR_A}', 1, '08:00', '13:00', 30)`)
  })

  it('a clinician with no schedule can be booked any time (old behaviour kept)', async () => {
    await book(db, { dr: DR_B, name: 'Dr B', date: TUE, start: '19:00' })
  })
  it('outside working hours is refused and names the hours', async () => {
    await refused(book(db, { start: '14:00' }), /outside working hours \(08:00–13:00\)/)
    await refused(book(db, { date: TUE, start: '09:00' }), /no clinic on Tuesday/)
  })
  it('an override reason allows it', async () => {
    await book(db, { start: '14:00', extra: 'Emergency review agreed with Dr A' })
  })
  it('leave blocks the day; an extra session opens time', async () => {
    await db.exec(`insert into provider_schedule_exceptions(hospital_id, staff_id, kind, starts_on, ends_on, reason)
                   values ('${H1}', '${DR_A}', 'leave', '${MON}'::date + 7, '${MON}'::date + 7, 'Annual leave')`)
    await refused(book(db, { date: nextWeekday(1, 2), start: '09:00' }), /on leave \(Annual leave\)/)
    await db.exec(`insert into provider_schedule_exceptions(hospital_id, staff_id, kind, starts_on, ends_on, start_time, end_time)
                   values ('${H1}', '${DR_A}', 'extra', '${TUE}', '${TUE}', '14:00', '16:00')`)
    await book(db, { date: TUE, start: '14:30' })
  })
  it('available slots: booked, outside hours and free are reported', async () => {
    await book(db, { start: '10:00' })
    await as(db, REC)
    const { rows } = await db.query('select slot::text, available, reason from sched_available_slots($1, $2, $3, 30)', [H1, DR_A, MON])
    assert.equal(rows[0].slot, '08:00:00')
    assert.equal(rows.at(-1).slot, '12:30:00', 'last slot ends at 13:00')
    assert.deepEqual(rows.find((r) => r.slot === '10:00:00'), { slot: '10:00:00', available: false, reason: 'booked' })
    assert.equal(rows.find((r) => r.slot === '11:00:00').available, true)
    await as(db, OTHER)
    await refused(db.query('select * from sched_available_slots($1, $2, $3, 30)', [H1, DR_A, MON]), /Not a member/)
    await as(db, null)
  })
})

describe('reminders, waiting list and missed visits', () => {
  let db
  before(async () => { db = await boot(); await as(db, null) })

  it('a future booking queues 48 h and 2 h SMS reminders with the patient phone', async () => {
    const a = await book(db, { start: '10:00' })
    const { rows } = await db.query('select kind, phone, status, confirm_token from appointment_reminders where appointment_id = $1 order by kind', [a.id])
    assert.deepEqual(rows.map((r) => [r.kind, r.phone, r.status]), [['2h', '0712345678', 'queued'], ['48h', '0712345678', 'queued']])
    assert.ok(rows[0].confirm_token.length >= 16)
  })
  it('rescheduling replaces the queued reminders; cancelling cancels them', async () => {
    const a = await book(db, { start: '11:00' })
    await db.query("update appointments set start_time = '12:00' where id = $1", [a.id])
    let { rows } = await db.query("select status, count(*)::int n from appointment_reminders where appointment_id = $1 group by status order by status", [a.id])
    assert.deepEqual(rows, [{ status: 'cancelled', n: 2 }, { status: 'queued', n: 2 }])
    await db.query("update appointments set status = 'Cancelled' where id = $1", [a.id]);
    ({ rows } = await db.query("select count(*)::int n from appointment_reminders where appointment_id = $1 and status = 'queued'", [a.id]))
    assert.equal(rows[0].n, 0)
  })
  it('the SMS confirm link confirms the appointment once', async () => {
    const a = await book(db, { start: '13:00' })
    const { rows: [r] } = await db.query("select confirm_token from appointment_reminders where appointment_id = $1 and kind = '48h'", [a.id])
    const { rows: [c] } = await db.query('select sched_confirm_by_token($1) as res', [r.confirm_token])
    assert.equal(c.res.ok, true)
    const { rows: [after] } = await db.query('select status, confirmation_channel from appointments where id = $1', [a.id])
    assert.deepEqual(after, { status: 'Confirmed', confirmation_channel: 'sms_link' })
    const { rows: [bad] } = await db.query("select sched_confirm_by_token('nope-nope-nope-nope') as res")
    assert.equal(bad.res.ok, false)
  })
  it('a cancellation offers the freed slot to the first matching patient on the waiting list', async () => {
    await db.query(`insert into appointment_waitlist(hospital_id, patient_name, phone, staff_id, earliest_date, latest_date)
                    values ($1, 'Too late', '0700000001', $2, $3::date + 30, null), ($1, 'Wanjiru', '0700000002', null, null, null)`, [H1, DR_A, MON])
    const a = await book(db, { start: '15:00', extra: 'late clinic' })
    await db.query("update appointments set status = 'Cancelled' where id = $1", [a.id])
    const { rows } = await db.query("select patient_name, status, offered_slot->>'start_time' as t from appointment_waitlist order by created_at, patient_name")
    assert.deepEqual(rows.map((r) => [r.patient_name, r.status]), [['Too late', 'waiting'], ['Wanjiru', 'offered']])
    assert.equal(rows[1].t, '15:00:00')
    const { rows: sms } = await db.query("select phone, message from appointment_reminders where kind = 'offer'")
    assert.equal(sms[0].phone, '0700000002')
    assert.match(sms[0].message, /A slot is free on/)
  })
  it('missed visits are flagged No-Show and get a missed-visit SMS', async () => {
    await db.exec("select set_config('app.sched_backfill', 'on', false)")
    const past = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10)
    await db.query(`insert into appointments(hospital_id, patient_id, doctor_id, doctor_name, appointment_date, start_time, duration_minutes)
                    values ($1, $2, $3, 'Dr A', $4, '00:00', 30)`, [H1, PAT, DR_B, past])
    await db.exec("select set_config('app.sched_backfill', '', false)")
    await db.query("update appointments set starts_at = now() - interval '3 hours', ends_at = now() - interval '150 minutes' where doctor_id = $1", [DR_B])
    const { rows: [n] } = await db.query('select sched_flag_missed() as n')
    assert.equal(n.n, 1)
    const { rows } = await db.query("select a.status, (select count(*)::int from appointment_reminders r where r.appointment_id = a.id::text and r.kind = 'missed') as sms from appointments a where doctor_id = $1", [DR_B])
    assert.deepEqual(rows[0], { status: 'No-Show', sms: 1 })
  })
})

describe('security and install on messy data', () => {
  it('other hospitals cannot see schedules; the browser cannot write reminders or run the sweep', async () => {
    const db = await boot(); await as(db, null)
    await db.exec(`insert into provider_schedules(hospital_id, staff_id, weekday, start_time, end_time) values ('${H1}', '${DR_A}', 1, '08:00', '13:00')`)
    await as(db, OTHER)
    assert.equal((await db.query('select * from provider_schedules')).rows.length, 0)
    await as(db, REC)
    assert.equal((await db.query('select * from provider_schedules')).rows.length, 1)
    await refused(db.query("insert into appointment_reminders(hospital_id, appointment_id, kind, due_at) values ($1, 'x', '2h', now())", [H1]))
    await refused(db.query('select sched_flag_missed()'))
  })
  it('installs even when old data already has double-bookings (constraint skipped, trigger still blocks)', async () => {
    const db = await boot({ seedOverlap: true }); await as(db, null)
    const { rows } = await db.query("select 1 from pg_constraint where conname = 'appointments_no_clinician_overlap'")
    assert.equal(rows.length, 0)
    await refused(book(db, { start: '09:20' }), /already has an appointment/)
  })
  it('is safe to run twice', async () => {
    const db = await boot()
    await db.exec(SCHED)
  })
})

describe('the paste-ready SQL file', () => {
  it('docs/sql/05_scheduling.sql installs and its health check reports OK', async () => {
    const db = new PGlite({ extensions: { btree_gist } })
    await db.exec(read('./stub.sql'))
    await db.exec(PAYMENTS)
    await db.exec(APPTS)
    const res = await db.exec(read('../../../docs/sql/05_scheduling.sql'))
    const rows = res.at(-1).rows
    assert.deepEqual(rows.slice(0, 3).map((r) => r.result), ['OK', 'OK', 'OK'])
  })
})
