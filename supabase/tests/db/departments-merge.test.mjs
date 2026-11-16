// Merge duplicate departments (docs/sql/47).
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { DEPARTMENT_SYNONYMS } from '../../../src/utils/departmentNames.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const H1 = '11111111-1111-1111-1111-111111111111', H2 = '22222222-2222-2222-2222-222222222222'

describe('merge duplicate departments', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`create or replace function public.priv_is_admin(p uuid) returns boolean language sql as $$ select false $$;
      alter table staff add column department text;
      create table departments(id uuid primary key default gen_random_uuid(), hospital_id uuid, name text, bed_count int, created_at timestamptz default now());`)
    await db.exec(read('../../migrations/20261229000000_merge_duplicate_departments.sql'))
  })

  it('SQL synonym table matches the app (src/utils/departmentNames.js)', async () => {
    for (const [canon, list] of Object.entries(DEPARTMENT_SYNONYMS)) {
      for (const s of [canon, ...list]) {
        const r = (await db.query('select public.department_canonical($1) c', [`  ${s.toUpperCase()}  `])).rows[0].c
        assert.equal(r, canon, `${s} → ${r}`)
      }
    }
    assert.equal((await db.query("select public.department_canonical('  Burns   Unit ') c")).rows[0].c, 'Burns Unit')
  })

  it('keeps one row per department under its proper name, moves staff, leaves other hospitals alone', async () => {
    await db.exec(`insert into departments(hospital_id, name, bed_count, created_at) values
      ('${H1}', 'Mental Health', 4, now() - interval '3 days'), ('${H1}', 'Psychiatry', 10, now() - interval '2 days'), ('${H1}', 'psychiatry ', 0, now()),
      ('${H1}', 'Ophthalmology', 0, now()), ('${H1}', 'Eye Clinic', 2, now()), ('${H1}', 'Cardiology', 0, now()), ('${H1}', 'aorthopaedics', 0, now()),
      ('${H2}', 'Psychiatry', 0, now());
      insert into staff(hospital_id, email, full_name, role, department) values ('${H1}', 'p@a.ke', 'Dr P', 'Doctor', 'Psychiatry'), ('${H1}', 'e@a.ke', 'Nurse E', 'Nurse', 'ophthalmology'),
      ('${H2}', 'q@a.ke', 'Dr Q', 'Doctor', 'Psychiatry');`)
    const preview = (await db.query('select * from department_merge_preview($1)', [H1])).rows
    assert.deepEqual(preview.map((r) => [r.department, r.rows_removed]), [['Eye Clinic', 1], ['Mental Health & Psychiatry', 2], ['Orthopaedics', 0]])
    const summary = (await db.query('select department_merge($1) s', [H1])).rows[0].s
    assert.equal(summary.rows_removed, 3)
    const names = (await db.query('select name, bed_count from departments where hospital_id = $1 order by name', [H1])).rows
    assert.deepEqual(names.map((r) => r.name), ['Cardiology', 'Eye Clinic', 'Mental Health & Psychiatry', 'Orthopaedics'])
    assert.equal(names.find((r) => r.name === 'Mental Health & Psychiatry').bed_count, 10, 'keeps the largest bed count')
    const staff = (await db.query('select full_name, department from staff where hospital_id = $1 and department is not null order by full_name', [H1])).rows
    assert.deepEqual(staff.map((r) => r.department), ['Mental Health & Psychiatry', 'Eye Clinic'])
    assert.equal((await db.query('select name from departments where hospital_id = $1', [H2])).rows[0].name, 'Psychiatry', 'other hospital untouched')
    assert.equal((await db.query('select department_merge($1) s', [H1])).rows[0].s.departments_fixed, 0, 'running again changes nothing')
  })

  it('a signed-in non-admin cannot merge', async () => {
    await db.exec("select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false); set role authenticated;")
    await assert.rejects(db.query('select department_merge($1)', [H2]), /Only an administrator/)
    await db.exec('reset role')
  })
})
