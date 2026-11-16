#!/usr/bin/env node
// RemedacareHMS load test — measures how fast the busiest screens' queries are on YOUR Supabase project, with several
// staff working at once. Read-only: it never writes. Use a staging copy of production if you can (Supabase branching or a
// restored backup); running it against the live project is safe but adds load while it runs.
//
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=... TEST_EMAIL=nurse@hospital.ke TEST_PASSWORD=... \
//   HOSPITAL_ID=<uuid> node tools/load-test/run.mjs [concurrent users, default 20] [seconds, default 60]
//
// Sign in with an ordinary clinical account (not an owner) so row-level security is exercised as staff experience it.
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD, HOSPITAL_ID } = process.env
const USERS = Number(process.argv[2] || 20)
const SECONDS = Number(process.argv[3] || 60)
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD || !HOSPITAL_ID) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD and HOSPITAL_ID (see the top of this file).')
  process.exit(1)
}

const since = new Date(Date.now() - 30 * 86400000).toISOString()
// What the busiest screens ask for (same filters, order and page sizes as the app).
const SCENARIOS = {
  'Patients list': (db) => db.from('patients').select('*').eq('hospital_id', HOSPITAL_ID).order('created_at', { ascending: false }).limit(50),
  'Patient search': (db) => db.from('patients').select('id, full_name, patient_number, phone').eq('hospital_id', HOSPITAL_ID).ilike('full_name', '%an%').limit(20),
  'Visits today': (db) => db.from('visits').select('*').eq('hospital_id', HOSPITAL_ID).gte('created_at', new Date().toISOString().slice(0, 10)).limit(100),
  'Lab worklist': (db) => db.from('lab_tests').select('*').eq('hospital_id', HOSPITAL_ID).order('created_at', { ascending: false }).limit(100),
  'Cashier invoices': (db) => db.from('invoices').select('*').eq('hospital_id', HOSPITAL_ID).gte('created_at', since).order('created_at', { ascending: false }).limit(100),
  'Pharmacy queue': (db) => db.from('prescriptions').select('*').eq('hospital_id', HOSPITAL_ID).order('created_at', { ascending: false }).limit(100),
  'Appointments': (db) => db.from('appointments').select('*').eq('hospital_id', HOSPITAL_ID).gte('appointment_date', new Date().toISOString().slice(0, 10)).limit(100),
  'Ward beds': (db) => db.from('beds').select('*').eq('hospital_id', HOSPITAL_ID).limit(300),
  'HIV clients': (db) => db.from('hiv_art').select('*').eq('hospital_id', HOSPITAL_ID).order('next_vl_due', { ascending: true }).limit(100),
  'Critical results': (db) => db.from('lab_critical_alerts').select('*').eq('hospital_id', HOSPITAL_ID).neq('status', 'acknowledged').limit(50),
}

const timings = Object.fromEntries(Object.keys(SCENARIOS).map((k) => [k, []]))
const errors = Object.fromEntries(Object.keys(SCENARIOS).map((k) => [k, 0]))
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

async function worker(db, until) {
  const names = Object.keys(SCENARIOS)
  while (Date.now() < until) {
    const name = names[Math.floor(Math.random() * names.length)]
    const t = performance.now()
    const { error } = await SCENARIOS[name](db)
    const ms = performance.now() - t
    if (error) { if (!/does not exist|schema cache/i.test(error.message)) errors[name]++; } else timings[name].push(ms)
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 700))   // a person clicks, reads, clicks again
  }
}

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const { error: signInError } = await db.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD })
if (signInError) { console.error('Sign-in failed:', signInError.message); process.exit(1) }
console.log(`Running ${USERS} simultaneous users for ${SECONDS} s against ${new URL(SUPABASE_URL).host} …`)
const until = Date.now() + SECONDS * 1000
await Promise.all(Array.from({ length: USERS }, () => worker(db, until)))

console.log('\nScreen query            requests   typical (p50)   slow (p95)   errors')
let worst = 0
for (const name of Object.keys(SCENARIOS)) {
  const p50 = pct(timings[name], 0.5), p95 = pct(timings[name], 0.95)
  worst = Math.max(worst, p95 || 0)
  const flag = p95 == null ? '  (table not installed)' : p95 > 1500 ? '  ← too slow' : p95 > 700 ? '  ← watch' : ''
  console.log(`${name.padEnd(22)} ${String(timings[name].length).padStart(8)} ${p50 == null ? '—'.padStart(15) : `${p50.toFixed(0)} ms`.padStart(15)} ${p95 == null ? '—'.padStart(12) : `${p95.toFixed(0)} ms`.padStart(12)} ${String(errors[name]).padStart(8)}${flag}`)
}
console.log(`\nVerdict: ${worst <= 700 ? 'GOOD — screens should feel instant.' : worst <= 1500 ? 'OK — usable; check the rows marked "watch".' : 'SLOW — run docs/sql/45_rls_performance.sql (again) and share this output.'}`)
console.log('Times include the network from this computer to Supabase; run it from the hospital network for realistic numbers.')
