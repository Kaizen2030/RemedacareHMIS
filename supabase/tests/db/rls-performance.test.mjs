// RLS performance rewrite (docs/sql/45): same access decisions, evaluated once per statement instead of per row.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111', H2 = '22222222-2222-2222-2222-222222222222'
const USERS = {
  receptionist: '00000000-0000-0000-0000-0000000000a1', accountant: '00000000-0000-0000-0000-0000000000a2', cashier: '00000000-0000-0000-0000-0000000000a3',
  owner: '00000000-0000-0000-0000-0000000000a4', suspended: '00000000-0000-0000-0000-0000000000a5', finance: '00000000-0000-0000-0000-0000000000a6',
  nurse: '00000000-0000-0000-0000-0000000000c1', otherHospital: '00000000-0000-0000-0000-0000000000b1',
  hr: '00000000-0000-0000-0000-0000000000f1', lab: '00000000-0000-0000-0000-0000000000f2', consultant: '00000000-0000-0000-0000-0000000000f3',
  pharmacist: '00000000-0000-0000-0000-0000000000f4', records: '00000000-0000-0000-0000-0000000000f5', nobody: '00000000-0000-0000-0000-0000000000ff',
}
const CHECKS = ['pay_is_member', 'clin_can_access', 'priv_is_admin', 'blood_is_staff', 'hr_can_manage', 'hr_can_roster', 'guide_can_approve', 'pharm_is_staff',
  'rec_can_access', 'can_manage_payments', 'can_take_payments', 'mortuary_can_access', 'is_payments_admin', 'lab_instrument_can_manage', 'service_is_records_staff']
const as = (db, user) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user || ''}', false);${user ? ' set role authenticated;' : ''}`)

describe('RLS performance rewrite', () => {
  let db, firstRun
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    const extra = [['f1', 'hr@a.ke', 'HR Manager'], ['f2', 'lab@a.ke', 'Lab Technician'], ['f3', 'cons@a.ke', 'Consultant Physician'], ['f4', 'pharm@a.ke', 'Pharmacist'], ['f5', 'his@a.ke', 'Health Records Officer']]
    for (const [id, email, role] of extra) {
      await db.exec(`insert into auth.users values ('00000000-0000-0000-0000-0000000000${id}', '${email}');
        insert into hospital_users(user_id, hospital_id, role) values ('00000000-0000-0000-0000-0000000000${id}', '${H1}', '${role}');
        insert into staff(hospital_id, email, full_name, role, status) values ('${H1}', '${email}', '${role}', '${role}', 'Active');`)
    }
    await db.exec(read('../../migrations/20261114000000_payments_ledger.sql').replace(/create extension if not exists pgcrypto;/i, ''))
    for (const f of ['08_hiv_tb_maternity', '11_audit_privacy', '25_blood_transfusion', '32_problem_list_order_sets', '33_records_file_locator', '36_hr_roster_leave', '41_clinical_guides']) {
      await db.exec(read(`../../../docs/sql/${f}.sql`))
    }
    await db.exec(`create table if not exists lab_tests (id uuid primary key default gen_random_uuid(), hospital_id uuid, patient_id uuid, patient_name text, test_type text, created_at timestamptz default now());`)
    for (const f of ['34_lab_quality', '44_lab_instruments']) await db.exec(read(`../../../docs/sql/${f}.sql`))
    firstRun = (await db.exec(read('../../../docs/sql/45_rls_performance.sql'))).at(-1).rows
  })

  it('reports OK and every policy check is rewritten', async () => {
    assert.ok(firstRun.every((r) => r.result === 'OK' || /^\d+ policies/.test(r.result)), JSON.stringify(firstRun))
    const left = (await db.query(`select count(*)::int n from pg_policies where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '\\m(${CHECKS.join('|')})\\(hospital_id\\)'`)).rows[0].n
    assert.equal(left, 0, 'no per-row checks left')
    const fast = (await db.query(`select count(*)::int n from pg_policies where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'rls_hospitals'`)).rows[0].n
    assert.ok(fast > 40, `${fast} policies use the once-per-statement form`)
  })

  it('gives exactly the same yes / no as the original check, for every user, check and hospital', async () => {
    let compared = 0
    for (const [who, id] of Object.entries(USERS)) {
      await as(db, id)
      for (const fn of CHECKS) {
        if (!(await db.query(`select to_regprocedure('public.${fn}(uuid)') p`)).rows[0].p) continue
        for (const h of [H1, H2]) {
          const r = (await db.query(`select public.${fn}($1::uuid) as original, $1::uuid = any (public.rls_hospitals('${fn}')) as rewritten`, [h])).rows[0]
          assert.equal(r.rewritten, r.original, `${who} / ${fn} / ${h === H1 ? 'H1' : 'H2'}`)
          compared++
        }
      }
    }
    assert.ok(compared > 300, `${compared} decisions compared`)
  })

  it('is safe to run again and refuses non-membership checks', async () => {
    await as(db, null)
    const again = (await db.exec(read('../../../docs/sql/45_rls_performance.sql'))).at(-1).rows
    assert.ok(again.every((r) => r.result === 'OK' || /^\d+ policies/.test(r.result)), JSON.stringify(again))
    await as(db, USERS.nurse)
    await assert.rejects(db.query("select public.rls_hospitals('hr_my_staff_id')"), /not a membership-based check/)
  })

  it('every table with a hospital_id has an index on it', async () => {
    await as(db, null)
    const missing = (await db.query(`select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'hospital_id' and not a.attisdropped
      where c.relkind = 'r' and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)`)).rows
    assert.deepEqual(missing, [])
  })
})
