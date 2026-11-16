import { beforeEach, describe, expect, it, vi } from 'vitest'
import { searchAcrossHospital } from './globalSearch'

const { rowsByTable, errorsByTable, from } = vi.hoisted(() => ({
  rowsByTable: {},
  errorsByTable: {},
  from: vi.fn(),
}))

vi.mock('../supabase', () => ({ default: { from } }))

function makeQuery(table) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    or: vi.fn(() => query),
    ilike: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    then: (resolve, reject) => Promise.resolve({
      data: rowsByTable[table] || [],
      error: errorsByTable[table] || null,
    }).then(resolve, reject),
  }
  return query
}

describe('global workflow search', () => {
  beforeEach(() => {
    Object.keys(rowsByTable).forEach((table) => delete rowsByTable[table])
    Object.keys(errorsByTable).forEach((table) => delete errorsByTable[table])
    from.mockReset().mockImplementation((table) => makeQuery(table))
  })

  it('returns hospital workflow records as navigable module results', async () => {
    rowsByTable.hospital_workflow_records = [{
      id: 'record-1',
      module_code: 'theatre',
      title: 'TH-204 - Surgery case',
      status: 'Open',
      patient_id: 'patient-1',
      visit_id: 'visit-1',
    }]

    const results = await searchAcrossHospital({ hospitalId: 'hospital-1', query: 'TH-204' })

    expect(results).toContainEqual(expect.objectContaining({
      id: 'record-1',
      category: 'Clinical workflow',
      label: 'TH-204 - Surgery case',
      path: '/theatre',
      state: { searchResult: expect.objectContaining({ patient_id: 'patient-1', visit_id: 'visit-1' }) },
    }))
    expect(from).toHaveBeenCalledWith('hospital_workflow_records')
  })

  it('does not fail global search when role-scoped workflow results are unavailable', async () => {
    errorsByTable.hospital_workflow_records = { message: 'permission denied' }

    await expect(searchAcrossHospital({ hospitalId: 'hospital-1', query: 'patient' })).resolves.toEqual([])
  })
})