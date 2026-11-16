import { describe, expect, it } from 'vitest'
import { canonicalDepartmentName, DEPARTMENT_SYNONYMS, findExistingDepartment, uniqueDepartmentNames } from './departmentNames'

describe('department names', () => {
  it('maps spellings and synonyms of the same department to one proper name', () => {
    expect(canonicalDepartmentName('Psychiatry')).toBe('Mental Health & Psychiatry')
    expect(canonicalDepartmentName('  mental   health ')).toBe('Mental Health & Psychiatry')
    expect(canonicalDepartmentName('Ophamology')).toBe('Eye Clinic')
    expect(canonicalDepartmentName('OBS GYN')).toBe('Obstetrics & Gynaecology')
    expect(canonicalDepartmentName('aorthopaedics')).toBe('Orthopaedics')
    expect(canonicalDepartmentName('Burns   Unit ')).toBe('Burns Unit')
    expect(canonicalDepartmentName('')).toBe('')
  })

  it('the menu list from the user\'s hospital has no duplicates', () => {
    const fromDb = ['Cardiology', 'Community Health', 'Dental', 'Dermatology', 'ENT', 'Eye Clinic', 'General Medicine', 'Mental Health', 'Mortuary', 'Neurology',
      'Nutrition', 'Obs Gyn', 'Oncology', 'Ophthalmology', 'Orthopaedics', 'Paediatrics', 'Physiotherapy', 'Psychiatry', 'psychiatry ', 'Urology']
    expect(uniqueDepartmentNames(fromDb)).toEqual(['Cardiology', 'Community Health', 'Dental', 'Dermatology', 'ENT', 'Eye Clinic', 'General Medicine',
      'Mental Health & Psychiatry', 'Mortuary', 'Neurology', 'Nutrition & Dietetics', 'Obstetrics & Gynaecology', 'Oncology', 'Orthopaedics', 'Paediatrics', 'Physiotherapy', 'Urology'])
  })

  it('spots an attempt to add a department that already exists under another name', () => {
    expect(findExistingDepartment('Psychiatry', ['Mental Health', 'Cardiology'])).toBe('Mental Health')
    expect(findExistingDepartment('Burns Unit', ['Mental Health'])).toBeNull()
    expect(findExistingDepartment('Psychiatry', ['Psychiatry'], 'Psychiatry')).toBeNull()
  })

  it('no synonym belongs to two departments', () => {
    const seen = new Map()
    for (const [canon, list] of Object.entries(DEPARTMENT_SYNONYMS)) for (const s of list) {
      expect(seen.get(s), `${s} in ${canon} and ${seen.get(s)}`).toBeUndefined()
      seen.set(s, canon)
    }
  })
})

describe('admitting department from a visit', () => {
  it('uses the proper department name and ignores visit statuses', async () => {
    const { admittingDepartmentFrom } = await import('./departmentNames')
    expect(admittingDepartmentFrom('psychiatry')).toBe('Mental Health & Psychiatry')
    expect(admittingDepartmentFrom('General Medicine')).toBe('General Medicine')
    expect(admittingDepartmentFrom('Admission Requested')).toBe('')
    expect(admittingDepartmentFrom('Admitted')).toBe('')
    expect(admittingDepartmentFrom('')).toBe('')
  })
})

describe('staff role groups', () => {
  it('groups common Kenyan job titles', async () => {
    const { staffRoleGroup, roleSummary } = await import('./staffRoles')
    expect(staffRoleGroup({ job_title: 'Clinical Officer' })).toBe('Clinical officers')
    expect(staffRoleGroup({ job_title: 'Medical Officer' })).toBe('Doctors')
    expect(staffRoleGroup({ job_title: 'Nursing Officer II' })).toBe('Nurses & midwives')
    expect(staffRoleGroup({ role: 'Pharmaceutical Technologist' })).toBe('Pharmacy')
    expect(staffRoleGroup({ job_title: 'Medical Laboratory Technologist' })).toBe('Laboratory & imaging')
    expect(staffRoleGroup({ job_title: 'Records clerk' })).toBe('Support & admin')
    expect(roleSummary([{ job_title: 'Nurse' }, { job_title: 'Nurse' }, { job_title: 'Consultant' }])).toBe('1 Doctors · 2 Nurses & midwives')
  })
})
