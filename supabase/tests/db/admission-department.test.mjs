// Inpatients per department (docs/sql/50): admitting_department added and filled in from the visit's department.
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const V1 = '11111111-0000-0000-0000-000000000001', V2 = '11111111-0000-0000-0000-000000000002', V3 = '11111111-0000-0000-0000-000000000003'

describe('admitting department on admissions', () => {
  let db
  before(async () => {
    db = new PGlite()
    await db.exec(read('./stub.sql'))
    await db.exec(`create or replace function public.priv_is_admin(p uuid) returns boolean language sql as $$ select false $$;
      create or replace function public.pay_is_member(p uuid) returns boolean language sql as $$ select false $$;
      create table visits(id uuid primary key, speciality text);
      create table admissions(id serial primary key, hospital_id uuid, visit_id text, status text, admitting_department text);
      alter table admissions drop column admitting_department;
      insert into visits values ('${V1}', 'psychiatry'), ('${V2}', 'Admitted'), ('${V3}', 'General Medicine');
      insert into admissions(visit_id, status) values ('${V1}', 'Active'), ('${V2}', 'Active'), ('${V3}', 'Discharged');`)
    await db.exec(read('../../migrations/20261229000000_merge_duplicate_departments.sql'))
  })

  it('fills existing admissions from the visit, under the proper department name, and is safe to run again', async () => {
    for (let i = 0; i < 2; i++) {
      const rows = (await db.exec(read('../../../docs/sql/50_admission_department.sql'))).at(-1).rows
      assert.equal(rows[0].result, 'OK')
    }
    const got = (await db.query('select visit_id, admitting_department from admissions order by id')).rows.map((r) => r.admitting_department)
    assert.deepEqual(got, ['Mental Health & Psychiatry', null, 'General Medicine'], 'a status-like speciality ("Admitted") is not a department')
    await db.query("update admissions set admitting_department = 'Cardiology' where visit_id = $1", [V3])
    await db.exec(read('../../../docs/sql/50_admission_department.sql'))
    assert.equal((await db.query('select admitting_department d from admissions where visit_id = $1', [V3])).rows[0].d, 'Cardiology', 'an existing value is never overwritten')
  })
})
