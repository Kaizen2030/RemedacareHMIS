// Runs supabase/migrations/20261114000000_payments_ledger.sql on PGlite (real Postgres 16
// compiled to WebAssembly) against a Supabase-shaped stub, and asserts the ledger rules.
//   cd supabase/tests/db && npm install && npm test
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const MIGRATION = readFileSync(new URL('../../migrations/20261114000000_payments_ledger.sql', import.meta.url), 'utf8')
  .replace(/create extension if not exists pgcrypto;/i, '') // gen_random_uuid() is core in PG13+
const STUB = readFileSync(new URL('./stub.sql', import.meta.url), 'utf8')

const H1 = '11111111-1111-1111-1111-111111111111'
const U = {
  rec: '00000000-0000-0000-0000-0000000000a1', acc: '00000000-0000-0000-0000-0000000000a2',
  cashier: '00000000-0000-0000-0000-0000000000a3', owner: '00000000-0000-0000-0000-0000000000a4',
  suspended: '00000000-0000-0000-0000-0000000000a5', finance: '00000000-0000-0000-0000-0000000000a6',
  nurse: '00000000-0000-0000-0000-0000000000c1', otherHospital: '00000000-0000-0000-0000-0000000000b1',
}
const JANE = '99999999-0000-0000-0000-000000000001'
const BOB = '99999999-0000-0000-0000-000000000002'

async function boot({ beforeMigration = '' } = {}) {
  const db = new PGlite()
  await db.exec(STUB)
  if (beforeMigration) await db.exec(beforeMigration)
  await db.exec(MIGRATION)
  // Supabase gives service_role full table access through default privileges
  await db.exec('grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;')
  return db
}
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)
const asService = (db) => db.exec(`select set_config('request.jwt.claim.sub', '', false); set role service_role;`)
const rows = async (db, sql, p) => (await db.query(sql, p)).rows
const row = async (db, sql, p) => (await rows(db, sql, p))[0]
async function fails(db, sql, p, pattern) {
  let msg = null
  try { await db.query(sql, p) } catch (e) { msg = e.message }
  assert.ok(msg, `expected failure: ${sql}`)
  if (pattern) assert.match(msg, pattern)
  return msg
}
let invoiceSeq = 0
async function invoice(db, { amount = 5000, patient = JANE, name = 'Jane', method = 'Cash', paid = 0, status = 'Pending' } = {}) {
  await as(db, null)
  const no = `INV-${++invoiceSeq}`
  const r = await row(db, `insert into invoices(hospital_id, patient_id, patient_name, invoice_no, amount_kes, paid_kes, balance_kes, payment_method, status)
    values ($1,$2,$3,$4,$5::numeric,$6::numeric,$5::numeric-$6::numeric,$7,$8) returning id`, [H1, patient, name, no, amount, paid, method, status])
  return r.id
}
const pay = (db, inv, lines, key = null) =>
  rows(db, 'select * from record_manual_payments($1, $2::jsonb, $3)', [inv, JSON.stringify(lines), key])
async function inv(db, id) {
  await as(db, null)
  const r = await row(db, 'select paid_kes::float as paid, balance_kes::float as balance, status, payment_method from invoices where id = $1', [id])
  return r
}

describe('roles are resolved the way the app resolves them', () => {
  let db, id
  before(async () => { db = await boot(); id = await invoice(db, { amount: 100000 }) })
  const level = async (u) => { await as(db, null); return (await row(db, 'select pay_access_level($1, $2) as l', [H1, u])).l }

  it('maps job titles like resolveRole() in access.js', async () => {
    const cases = { Receptionist: 'receptionist', 'Front Desk': 'receptionist', Cashier: 'accountant', 'Senior Finance Officer': 'accountant',
      'Accounts Clerk': 'accountant', 'Hospital Administrator': 'admin', Nurse: 'clinical', 'Clinical Officer': 'clinical',
      'Pharmacy Billing': 'clinical', staff: 'unknown', '': 'unknown' }
    for (const [title, want] of Object.entries(cases)) {
      assert.equal((await row(db, 'select pay_canonical_role($1) as c', [title])).c, want, title)
    }
  })
  it('gives each user the right level', async () => {
    assert.equal(await level(U.rec), 'take')
    assert.equal(await level(U.acc), 'manage')
    assert.equal(await level(U.cashier), 'take', 'hospital_users.role = "staff" falls back to staff.role = Cashier')
    assert.equal(await level(U.owner), 'manage', 'hospital owner_email is admin')
    assert.equal(await level(U.finance), 'manage')
    assert.equal(await level(U.suspended), 'member', 'suspended staff can view but not take money')
    assert.equal(await level(U.nurse), 'member')
    assert.equal(await level(U.otherHospital), null)
  })
  it('enforces those levels in the RPCs', async () => {
    for (const u of [U.rec, U.cashier, U.owner, U.finance, U.acc]) {
      await as(db, u); await pay(db, id, [{ method: 'cash', amount: 10 }])
    }
    for (const u of [U.nurse, U.suspended, U.otherHospital]) {
      await as(db, u); await fails(db, 'select * from record_manual_payments($1, $2::jsonb)', [id, '[{"method":"cash","amount":1}]'], /not allowed/)
    }
  })
  it('a deactivated hospital_users link removes access', async () => {
    await as(db, null); await db.query('update hospital_users set active = false where user_id = $1', [U.rec])
    assert.equal(await level(U.rec), null)
    await db.query('update hospital_users set active = true where user_id = $1', [U.rec])
  })
})

describe('manual and split payments', () => {
  let db
  before(async () => { db = await boot() })

  it('records a split atomically and recomputes the invoice in the database', async () => {
    const id = await invoice(db, { amount: 5000 })
    await as(db, U.rec)
    const r = await pay(db, id, [{ method: 'cash', amount: 3500, tendered: 4000 }, { method: 'mpesa_manual', amount: 1500, reference: 'sgh7k2l9qx' }], 'split-1')
    assert.equal(r.length, 2)
    assert.equal(Number(r[0].change_given), 500)
    assert.equal(r[1].reference, 'SGH7K2L9QX')
    assert.match(r[0].receipt_no, /^RCP-\d{4}-000001$/)
    assert.match(r[1].receipt_no, /^RCP-\d{4}-000002$/)
    assert.deepEqual(await inv(db, id), { paid: 5000, balance: 0, status: 'Paid', payment_method: 'Split' })
  })
  it('replays the same idempotency key instead of charging twice', async () => {
    const id = await invoice(db, { amount: 1000 })
    await as(db, U.rec)
    const a = await pay(db, id, [{ method: 'cash', amount: 400 }], 'dbl-click-key')
    const b = await pay(db, id, [{ method: 'cash', amount: 400 }], 'dbl-click-key')
    assert.deepEqual(b.map((x) => x.id), a.map((x) => x.id))
    assert.equal((await inv(db, id)).paid, 400)
    const other = await invoice(db, { amount: 1000 })
    await as(db, U.rec)
    await fails(db, 'select * from record_manual_payments($1, $2::jsonb, $3)', [other, '[{"method":"cash","amount":1}]', 'dbl-click-key'], /different invoice/)
  })
  it('treats % and _ in keys literally', async () => {
    const id = await invoice(db, { amount: 1000 })
    await as(db, U.rec)
    await pay(db, id, [{ method: 'cash', amount: 1 }], 'abc_')
    const r = await pay(db, id, [{ method: 'cash', amount: 2 }], 'abcd') // 'abc_' would LIKE-match 'abcd:'
    assert.equal(Number(r[0].amount), 2)
  })
  it('rejects overpayment and bad lines', async () => {
    const id = await invoice(db, { amount: 1000 })
    await as(db, U.rec)
    const bad = (lines, re) => fails(db, 'select * from record_manual_payments($1, $2::jsonb)', [id, JSON.stringify(lines)], re)
    await bad([{ method: 'cash', amount: 1000.01 }], /exceeds the open balance/)
    await bad([{ method: 'cash', amount: 600 }, { method: 'cash', amount: 600 }], /exceeds the open balance/)
    await bad([{ method: 'mpesa_manual', amount: 10, reference: 'BAD' }], /10 letters/)
    await bad([{ method: 'card_pos', amount: 10, reference: '123456' }], /last 4/)
    await bad([{ method: 'cheque', amount: 10 }], /Cheque number/)
    await bad([{ method: 'bank_transfer', amount: 10 }], /reference is required/)
    await bad([{ method: 'cash', amount: 500, tendered: 400 }], /tendered is less/)
    await bad([{ method: 'cash', amount: 'abc' }], /valid amount/)
    await bad([{ method: 'mpesa', amount: 10 }], /cannot be recorded manually/)
    await bad([], /No payment lines/)
    assert.equal((await inv(db, id)).paid, 0, 'nothing partial was saved')
  })
  it('refuses payments on cancelled invoices', async () => {
    const id = await invoice(db, { amount: 1000, status: 'Cancelled' })
    await as(db, U.rec)
    await fails(db, 'select * from record_manual_payments($1, $2::jsonb)', [id, '[{"method":"cash","amount":1}]'], /cancelled/)
  })
})

describe('transaction reference rules (M-Pesa codes, bank refs, cheques)', () => {
  let db
  before(async () => { db = await boot() })
  const try_ = (id, lines) => rows(db, 'select * from record_manual_payments($1, $2::jsonb)', [id, JSON.stringify(lines)])

  it('blocks the same code twice on one invoice', async () => {
    const id = await invoice(db, { amount: 1000 })
    await as(db, U.rec)
    await try_(id, [{ method: 'mpesa_manual', amount: 100, reference: 'QAZ1WSX2ED' }])
    await fails(db, 'select * from record_manual_payments($1, $2::jsonb)', [id, '[{"method":"mpesa_manual","amount":100,"reference":"qaz1wsx2ed"}]'], /already been used on this invoice/)
  })
  it('allows one M-Pesa payment across the SAME patient\'s invoices, flagged for review', async () => {
    const consult = await invoice(db, { amount: 1000 }), pharmacy = await invoice(db, { amount: 2000 })
    await as(db, U.rec)
    const [a] = await try_(consult, [{ method: 'mpesa_manual', amount: 1000, reference: 'RFV3TGB4YH' }])
    const [b] = await try_(pharmacy, [{ method: 'mpesa_manual', amount: 2000, reference: 'RFV3TGB4YH' }])
    assert.equal(a.needs_review, false)
    assert.equal(b.needs_review, true)
    assert.match(b.review_note, /also used on invoice INV-/)
  })
  it('blocks re-using a code for a DIFFERENT patient', async () => {
    const jane = await invoice(db, { amount: 1000 }), bob = await invoice(db, { amount: 1000, patient: BOB, name: 'Bob' })
    await as(db, U.rec)
    await try_(jane, [{ method: 'mpesa_manual', amount: 500, reference: 'UJM5IKL6OP' }])
    await fails(db, 'select * from record_manual_payments($1, $2::jsonb)', [bob, '[{"method":"mpesa_manual","amount":500,"reference":"UJM5IKL6OP"}]'], /another patient/)
  })
  it('blocks re-using a code a gateway already confirmed', async () => {
    const a = await invoice(db, { amount: 1000 }), b = await invoice(db, { amount: 1000 })
    await as(db, null)
    await db.query(`insert into payments(hospital_id, invoice_id, patient_id, method, provider, status, amount, reference, provider_reference)
      values ($1,$2,$3,'mpesa','daraja','completed',1000,'STK9ABCDE1','ws_CO_x')`, [H1, a, JANE])
    await as(db, U.rec)
    await fails(db, 'select * from record_manual_payments($1, $2::jsonb)', [b, '[{"method":"mpesa_manual","amount":100,"reference":"stk9abcde1"}]'], /already received through daraja/)
  })
  it('lets one corporate cheque / bank transfer cover several patients, flagged', async () => {
    const a = await invoice(db, { amount: 3000 }), b = await invoice(db, { amount: 3000, patient: BOB, name: 'Bob' })
    await as(db, U.rec)
    await try_(a, [{ method: 'bank_transfer', amount: 3000, reference: 'RTGS-777' }])
    const [r] = await try_(b, [{ method: 'bank_transfer', amount: 3000, reference: 'rtgs-777' }])
    assert.equal(r.needs_review, true)
  })
})

describe('cheques, cancellation and refunds', () => {
  let db
  before(async () => { db = await boot() })

  it('cheque stays pending, reserves the balance, and only finance can resolve it', async () => {
    const id = await invoice(db, { amount: 1000 })
    await as(db, U.rec)
    const [c] = await pay(db, id, [{ method: 'cheque', amount: 1000, cheque_no: '004512', bank_name: 'KCB' }])
    assert.equal(c.status, 'pending')
    assert.equal(c.receipt_no, null)
    assert.equal(Number((await row(db, 'select invoice_open_amount($1) as o', [id])).o), 0)
    assert.equal((await inv(db, id)).status, 'Pending')
    await as(db, U.rec)
    await fails(db, 'select resolve_pending_payment($1, $2)', [c.id, 'cleared'], /finance/)
    await fails(db, 'select cancel_pending_payment($1)', [c.id], /cancel a cheque/)
    await as(db, U.cashier)
    await fails(db, 'select resolve_pending_payment($1, $2)', [c.id, 'cleared'], /finance/)
    await as(db, U.acc)
    await db.query('select resolve_pending_payment($1, $2)', [c.id, 'cleared'])
    assert.equal((await inv(db, id)).status, 'Paid')
  })
  it('a bounced cheque re-opens the balance', async () => {
    const id = await invoice(db, { amount: 700 })
    await as(db, U.rec)
    const [c] = await pay(db, id, [{ method: 'cheque', amount: 700, cheque_no: '77' }])
    await as(db, U.acc)
    const r = await row(db, 'select * from resolve_pending_payment($1, $2, $3)', [c.id, 'bounced', 'Account closed'])
    assert.equal(r.status, 'failed')
    assert.equal(Number((await row(db, 'select invoice_open_amount($1) as o', [id])).o), 700)
  })
  it('refunds: finance only, reason required, never more than was paid', async () => {
    const id = await invoice(db, { amount: 2000 })
    await as(db, U.rec)
    const [p] = await pay(db, id, [{ method: 'cash', amount: 2000 }])
    for (const u of [U.rec, U.cashier]) {
      await as(db, u)
      await fails(db, 'select record_manual_refund($1, $2, $3)', [p.id, 100, 'x'], /finance/)
    }
    await as(db, U.acc)
    await fails(db, 'select record_manual_refund($1, $2, $3)', [p.id, 100, ' '], /reason/)
    const r = await row(db, 'select * from record_manual_refund($1, $2, $3, $4)', [p.id, 500, 'Overcharged consult', 'CASH-OUT-1'])
    assert.match(r.receipt_no, /^RFD-/)
    await fails(db, 'select record_manual_refund($1, $2, $3)', [p.id, 1500.01, 'too much'], /between 0 and 1500/)
    assert.deepEqual(await inv(db, id), { paid: 1500, balance: 500, status: 'Partial', payment_method: 'Cash' })
  })
})

describe('the ledger cannot be bypassed', () => {
  let db, id, p
  before(async () => {
    db = await boot(); id = await invoice(db, { amount: 1000 })
    await as(db, U.rec); [p] = await pay(db, id, [{ method: 'cash', amount: 1000 }])
  })

  it('completed payments are immutable even for the database owner', async () => {
    await as(db, null)
    await fails(db, 'update payments set amount = 1 where id = $1', [p.id], /immutable/)
    await fails(db, "update payments set status = 'pending' where id = $1", [p.id], /immutable/)
  })
  it('browsers cannot write payments or read secrets', async () => {
    await as(db, U.acc)
    await fails(db, `insert into payments(hospital_id, invoice_id, method, amount) values ($1, $2, 'cash', 1)`, [H1, id], /permission denied/)
    await fails(db, 'update payments set amount = 9', [], /permission denied/)
    await fails(db, 'select * from hospital_payment_credentials', [], /permission denied/)
    await fails(db, 'select * from receipt_counters', [], /permission denied/)
    await fails(db, 'select * from payment_events', [], /permission denied/)
  })
  it('internal and service-only functions are not callable from the browser', async () => {
    await as(db, U.acc)
    await fails(db, "select next_receipt_no($1, 'RCP')", [H1], /permission denied/)
    await fails(db, 'select recompute_invoice_payments($1)', [id], /permission denied/)
    await fails(db, "select payments_audit($1, 'fake', null, '{}'::jsonb)", [H1], /permission denied/)
    await fails(db, 'select * from pay_user_context($1, $2)', [H1, U.owner], /permission denied/)
    await fails(db, `select create_online_payment($1, $2, 'mpesa', 'daraja', 1, 'k-1234567', 'x', null, null)`, [id, U.acc], /permission denied/)
    await fails(db, 'select create_gateway_refund($1, $2, 1, $3)', [p.id, U.acc, 'x'], /permission denied/)
  })
  it('row level security keeps hospitals apart', async () => {
    await as(db, U.otherHospital)
    assert.equal((await rows(db, 'select * from payments')).length, 0)
    assert.equal((await row(db, 'select invoice_open_amount($1) as o', [id])).o, null)
    await as(db, U.nurse)
    assert.equal((await rows(db, 'select * from payments')).length, 1, 'members can see their hospital ledger')
  })
  it('only admins can change payment settings and credentials', async () => {
    await as(db, U.acc)
    await fails(db, `select set_payment_credentials($1, 'paystack', 'sandbox', '{"secret_key":"sk_test_x"}')`, [H1], /administrator/)
    await fails(db, 'insert into hospital_payment_settings(hospital_id) values ($1)', [H1], /row-level security/)
    await as(db, U.owner)
    await db.query(`select set_payment_credentials($1, 'paystack', 'sandbox', '{"secret_key":"sk_test_x","blank":""}')`, [H1])
    const s = await row(db, 'select * from payment_credentials_status($1)', [H1])
    assert.deepEqual(s.configured_keys, ['secret_key'])
    await db.query('insert into hospital_payment_settings(hospital_id) values ($1)', [H1])
    await as(db, U.acc)
    assert.equal((await rows(db, 'select * from payment_credentials_status($1)', [H1])).length, 0)
  })
})

describe('edge-function RPCs (service role)', () => {
  let db
  before(async () => { db = await boot() })
  const start = (inv, user, amount, key, method = 'mpesa') =>
    row(db, `select create_online_payment($1, $2, $3, 'daraja', $4, $5, 'Jane', '254712345678', null) as r`, [inv, user, method, amount, key]).then((x) => x.r)

  it('reserves the balance atomically and replays by key', async () => {
    const id = await invoice(db, { amount: 1000 })
    await asService(db)
    const a = await start(id, U.cashier, 600, 'online-key-1')
    assert.equal(a.replay, false)
    assert.equal(a.payment.status, 'pending')
    assert.equal((await start(id, U.cashier, 600, 'online-key-1')).replay, true)
    await fails(db, `select create_online_payment($1, $2, 'mpesa', 'daraja', 401, 'online-key-2', 'J', null, null)`, [id, U.cashier], /exceeds the open balance \(KES 400/)
    await fails(db, `select create_online_payment($1, $2, 'mpesa', 'daraja', 1, 'online-key-3', 'J', null, null)`, [id, U.nurse], /cannot take payments/)
    await fails(db, `select create_online_payment($1, $2, 'mpesa', 'daraja', 1, 'online-key-4', 'J', null, null)`, [id, U.otherHospital], /do not belong/)
    await fails(db, `select create_online_payment($1, $2, 'mpesa', 'daraja', 100, 'online-key-5', 'J', null, null, false)`, [id, U.cashier], /Partial payments are disabled/)
  })
  it('a payment confirmed after it was cancelled still counts, and is flagged by the edge code', async () => {
    const id = await invoice(db, { amount: 1000 })
    await asService(db)
    const { payment } = await start(id, U.rec, 1000, 'late-key-1')
    await as(db, U.rec)
    await db.query('select cancel_pending_payment($1, $2)', [payment.id, 'patient left'])
    await as(db, null)
    await db.query("update payments set status = 'completed', reference = 'LATE1ABCDE', needs_review = true where id = $1", [payment.id])
    assert.equal((await inv(db, id)).status, 'Paid')
  })
  it('gateway refunds are reserved as pending first and cannot be over-issued', async () => {
    const id = await invoice(db, { amount: 1000 })
    await as(db, null)
    const p = await row(db, `insert into payments(hospital_id, invoice_id, method, provider, status, amount, provider_reference)
      values ($1, $2, 'card_online', 'paystack', 'completed', 1000, 'ps-1') returning id`, [H1, id])
    await asService(db)
    await fails(db, 'select create_gateway_refund($1, $2, 100, $3)', [p.id, U.cashier, 'x'], /finance/)
    const r = await row(db, 'select * from create_gateway_refund($1, $2, 600, $3)', [p.id, U.acc, 'Duplicate charge'])
    assert.equal(r.status, 'pending')
    await fails(db, 'select create_gateway_refund($1, $2, 401, $3)', [p.id, U.acc, 'again'], /between 0 and 400/)
    assert.equal(Number((await row(db, 'select invoice_open_amount($1) as o', [id])).o), 0, 'a pending refund does not re-open the balance')
    await as(db, null)
    await db.query("update payments set status = 'completed', provider_reference = 'refund:99' where id = $1", [r.id])
    assert.deepEqual(await inv(db, id), { paid: 400, balance: 600, status: 'Partial', payment_method: 'Card' })
    const m = await row(db, `insert into payments(hospital_id, invoice_id, method, status, amount) values ($1, $2, 'cash', 'completed', 100) returning id`, [H1, await invoice(db, { amount: 100 })])
    await asService(db)
    await fails(db, 'select create_gateway_refund($1, $2, 10, $3)', [m.id, U.acc, 'x'], /no refund API/)
  })
})

describe('legacy screens that write invoices.paid_kes directly', () => {
  let db
  before(async () => { db = await boot() })

  it('turns a new paid invoice and later top-ups into ledger rows', async () => {
    const id = await invoice(db, { amount: 1000, paid: 300, method: 'M-Pesa', status: 'Partial' })
    await as(db, U.rec)
    await db.query('update invoices set paid_kes = 1000, status = $2 where id = $1', [id, 'Paid'])
    await as(db, null)
    const p = await rows(db, 'select method, amount::float, source, receipt_no from payments where invoice_id = $1 order by created_at', [id])
    assert.deepEqual(p.map((x) => [x.method, x.amount, x.source]), [['mpesa_manual', 300, 'legacy_sync'], ['mpesa_manual', 700, 'legacy_sync']])
    assert.ok(p.every((x) => /^RCP-/.test(x.receipt_no)))
    assert.deepEqual(await inv(db, id), { paid: 1000, balance: 0, status: 'Paid', payment_method: 'M-Pesa' })
  })
  it('never lets a stale form erase a real payment (and audits the attempt)', async () => {
    const id = await invoice(db, { amount: 2000 })
    await as(db, U.rec)
    await pay(db, id, [{ method: 'cash', amount: 500 }])
    // "Edit invoice" was opened before the payment, so the form still says paid 0
    await db.query("update invoices set amount_kes = 2500, paid_kes = 0, balance_kes = 2500, status = 'Pending' where id = $1", [id])
    assert.deepEqual(await inv(db, id), { paid: 500, balance: 2000, status: 'Partial', payment_method: 'Cash' })
    await as(db, null)
    assert.equal((await rows(db, "select 1 from payments where invoice_id = $1 and kind = 'refund'", [id])).length, 0)
    assert.equal((await rows(db, "select 1 from audit_log where action = 'legacy_paid_decrease_blocked'")).length, 1)
  })
  it('re-derives balance and status when the amount changes', async () => {
    const id = await invoice(db, { amount: 1000 })
    await as(db, U.rec)
    await pay(db, id, [{ method: 'cash', amount: 1000 }])
    await db.query('update invoices set amount_kes = 1500 where id = $1', [id])
    assert.deepEqual(await inv(db, id), { paid: 1000, balance: 500, status: 'Partial', payment_method: 'Cash' })
    await db.query("update invoices set status = 'Cancelled' where id = $1", [id])
    await db.query('update invoices set amount_kes = 900 where id = $1', [id])
    assert.equal((await inv(db, id)).status, 'Cancelled', 'Cancelled is kept')
  })
  it('bridges every write in a multi-statement transaction', async () => {
    const a = await invoice(db, { amount: 100 }), b = await invoice(db, { amount: 100 })
    await db.exec(`begin; update invoices set paid_kes = 50 where id = '${a}'; update invoices set paid_kes = 60 where id = '${b}'; commit;`)
    const r = await row(db, "select coalesce(sum(amount),0)::float as s from payments where invoice_id = $1", [b])
    assert.equal(r.s, 60)
  })
  it('insurer payments are labelled, and the insurer label on the invoice is kept', async () => {
    const id = await invoice(db, { amount: 4000, method: 'AAR Insurance' })
    await as(db, U.acc)
    await db.query('update invoices set paid_kes = 4000 where id = $1', [id])
    await as(db, null)
    const p = await row(db, 'select method, notes from payments where invoice_id = $1', [id])
    assert.equal(p.method, 'other')
    assert.match(p.notes, /AAR Insurance/)
    assert.equal((await inv(db, id)).payment_method, 'AAR Insurance')
  })
})

describe('installing on an existing database', () => {
  it('back-fills historic paid amounts once, and re-running the migration is safe', async () => {
    const legacy = `insert into invoices(id, hospital_id, patient_name, invoice_no, amount_kes, paid_kes, balance_kes, status, payment_method, paid_at) values
      ('cccccccc-0000-0000-0000-000000000001', '${H1}', 'Old', 'INV-OLD-1', 800, 800, 0, 'Paid', 'Cash', '2026-01-05'),
      ('cccccccc-0000-0000-0000-000000000002', '${H1}', 'Old', 'INV-OLD-2', 800, 300, 500, 'Partial', 'M-Pesa', null);`
    const db = await boot({ beforeMigration: legacy })
    await as(db, null)
    const back = await rows(db, "select receipt_no, method, amount::float from payments where source = 'legacy_backfill' order by receipt_no")
    assert.equal(back.length, 2)
    assert.ok(back.every((x) => x.receipt_no.startsWith('LEG-')))
    assert.deepEqual(back.map((x) => x.method).sort(), ['cash', 'mpesa_manual'])
    assert.deepEqual(await inv(db, 'cccccccc-0000-0000-0000-000000000002'), { paid: 300, balance: 500, status: 'Partial', payment_method: 'M-Pesa' })

    await db.exec(MIGRATION) // second run
    assert.equal((await rows(db, 'select 1 from payments')).length, 2, 'no duplicate back-fill')
    const id = await invoice(db, { amount: 100 })
    await as(db, U.rec)
    const [p] = await pay(db, id, [{ method: 'cash', amount: 100 }])
    assert.match(p.receipt_no, /^RCP-\d{4}-000001$/, 'real receipts start at 1; LEG- numbers do not consume them')
  })
  // The older RemedacareHMS schema, exactly as found on the live project (2026-11-14).
  const OLD_SCHEMA = `
    create table payments(id uuid primary key default gen_random_uuid(), hospital_id uuid, invoice_id uuid, patient_id uuid,
      visit_id uuid, amount_kes numeric, payment_method text, mpesa_ref text, insurer text, sha_member_no text, notes text,
      received_by text, paid_at timestamptz, created_at timestamptz default now());
    create index payments_invoice_idx on payments(invoice_id);
    create function sync_invoice_on_payment() returns trigger language plpgsql as $f$
    begin
      update invoices set paid_kes = (select coalesce(sum(amount_kes), 0) from payments where invoice_id = coalesce(new.invoice_id, old.invoice_id))
       where id = coalesce(new.invoice_id, old.invoice_id);
      return new;
    end $f$;
    create trigger trigger_sync_invoice_on_payment after insert or update or delete on payments for each row execute function sync_invoice_on_payment();
    create table invoice_items(id uuid primary key default gen_random_uuid(), invoice_id uuid, total_kes numeric);
    create function sync_invoice_totals() returns trigger language plpgsql as $f$
    begin
      update invoices set
        amount_kes = (select coalesce(sum(total_kes), 0) from invoice_items where invoice_id = coalesce(new.invoice_id, old.invoice_id)),
        balance_kes = (select coalesce(sum(total_kes), 0) from invoice_items where invoice_id = coalesce(new.invoice_id, old.invoice_id))
                    - (select coalesce(sum(amount_kes), 0) from payments where invoice_id = coalesce(new.invoice_id, old.invoice_id))
       where id = coalesce(new.invoice_id, old.invoice_id);
      return new;
    end $f$;
    create trigger trigger_sync_invoice_on_item after insert or update or delete on invoice_items for each row execute function sync_invoice_totals();
    grant select, insert, update, delete on payments, invoice_items to authenticated;`

  it('moves an EMPTY old payments table aside and keeps invoice_items working', async () => {
    const db = await boot({ beforeMigration: OLD_SCHEMA })
    await as(db, null)
    assert.ok((await row(db, "select to_regclass('public.payments_old_20261114') is not null as x")).x, 'old table renamed')
    assert.ok((await row(db, "select exists (select 1 from information_schema.columns where table_name = 'payments' and column_name = 'refund_of') as x")).x, 'new ledger created')
    assert.equal((await rows(db, "select 1 from pg_trigger where tgname = 'trigger_sync_invoice_on_payment'")).length, 0)
    assert.ok((await row(db, "select to_regclass('public.payments_invoice_idx_old20261114') is not null as x")).x, 'old indexes renamed')

    const id = await invoice(db, { amount: 0 })
    await as(db, U.rec)
    await db.query('insert into invoice_items(invoice_id, total_kes) values ($1, 600), ($1, 400)', [id])
    assert.deepEqual(await inv(db, id), { paid: 0, balance: 1000, status: 'Pending', payment_method: 'Cash' })
    await as(db, U.rec)
    await pay(db, id, [{ method: 'cash', amount: 300 }])
    await db.query('insert into invoice_items(invoice_id, total_kes) values ($1, 500)', [id])
    assert.deepEqual(await inv(db, id), { paid: 300, balance: 1200, status: 'Partial', payment_method: 'Cash' })

    await db.exec(MIGRATION) // re-run is still safe
    assert.equal((await rows(db, 'select 1 from payments')).length, 1)
  })
  it('refuses to install over an old payments table that has data', async () => {
    const withRows = OLD_SCHEMA + ` insert into invoices(id, hospital_id, invoice_no, amount_kes) values ('eeeeeeee-0000-0000-0000-000000000001', '${H1}', 'X', 100);
      insert into payments(hospital_id, invoice_id, amount_kes) values ('${H1}', 'eeeeeeee-0000-0000-0000-000000000001', 50);`
    await assert.rejects(boot({ beforeMigration: withRows }), /older public\.payments table with data/)
  })
  it('skips invoices with no hospital and never blocks their saves', async () => {
    const orphan = `insert into invoices(id, hospital_id, patient_name, invoice_no, amount_kes, paid_kes, balance_kes, status, payment_method)
      values ('dddddddd-0000-0000-0000-000000000001', null, 'Orphan', 'INV-ORPH', 500, 200, 300, 'Partial', 'Cash');`
    const db = await boot({ beforeMigration: orphan })
    await as(db, null)
    assert.equal((await rows(db, 'select 1 from payments')).length, 0)
    await db.query("update invoices set paid_kes = 500 where invoice_no = 'INV-ORPH'")
    assert.equal(Number((await row(db, "select paid_kes from invoices where invoice_no = 'INV-ORPH'")).paid_kes), 500)
  })
  it('writes audit entries whether audit_log uses text or jsonb/uuid columns', async () => {
    for (const ddl of ['', `alter table audit_log alter column details type jsonb using details::jsonb;
                           alter table audit_log alter column target_id type uuid using target_id::uuid;`]) {
      const db = await boot({ beforeMigration: ddl })
      const id = await invoice(db, { amount: 100 })
      await as(db, U.rec)
      await pay(db, id, [{ method: 'cash', amount: 100 }])
      await as(db, null)
      const a = await row(db, "select details::text as d, target_id::text as t from audit_log where action = 'payment_recorded'")
      assert.ok(a, `audit row written (${ddl ? 'jsonb/uuid' : 'text'} columns)`)
      assert.match(a.d, /"method": ?"cash"/)
    }
  })
  it('adds payment_id to mpesa_transactions for the M-Pesa screen', async () => {
    const db = await boot()
    const c = await row(db, "select 1 as x from information_schema.columns where table_name = 'mpesa_transactions' and column_name = 'payment_id'")
    assert.equal(c?.x, 1)
  })
})

describe('cash-up view', () => {
  it('nets refunds per method and day', async () => {
    const db = await boot()
    const id = await invoice(db, { amount: 3000 })
    await as(db, U.rec)
    const [cash] = await pay(db, id, [{ method: 'cash', amount: 2000 }, { method: 'mpesa_manual', amount: 1000, reference: 'NET1ABCDE2' }])
    await as(db, U.acc)
    await db.query('select record_manual_refund($1, 300, $2)', [cash.id, 'change error'])
    const s = await rows(db, 'select method, sum(gross)::float as gross, sum(coalesce(refunds,0))::float as refunds, sum(net)::float as net, sum(txn_count)::int as n from payment_daily_summary group by method order by method')
    assert.deepEqual(s, [
      { method: 'cash', gross: 2000, refunds: 300, net: 1700, n: 1 },
      { method: 'mpesa_manual', gross: 1000, refunds: 0, net: 1000, n: 1 },
    ])
  })
})
