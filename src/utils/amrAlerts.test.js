import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  executeMicrobiologyQuery: vi.fn(),
  rows: [],
}))

vi.mock('../supabase', () => ({ default: { from: mocks.from } }))
vi.mock('./microbiologyResults', () => ({ executeMicrobiologyQuery: mocks.executeMicrobiologyQuery }))

import { checkAMRAlert } from './amrAlerts'

describe('checkAMRAlert', () => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rows = []
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.order.mockReturnValue(query)
    query.limit.mockReturnValue(query)
    mocks.from.mockReturnValue(query)
    mocks.executeMicrobiologyQuery.mockImplementation(async runQuery => {
      await runQuery('columns')
      return { data: mocks.rows, error: null }
    })
  })

  it('returns a critical alert when a recent isolate is resistant to the drug', async () => {
    mocks.rows = [{
      organism_identified: 'E. coli',
      reported_date: '2026-10-01',
      susceptibility_profile: { amoxicillin: 'R' },
    }]

    await expect(checkAMRAlert('Amoxicillin 500mg', 'patient-1', 'hospital-1')).resolves.toMatchObject({
      alertLevel: 'critical',
      antibiotic: 'Amoxicillin',
      organism: 'E. coli',
    })
  })

  it('returns a warning for intermediate susceptibility and null when there is no match', async () => {
    mocks.rows = [{ susceptibility_profile: { ciprofloxacin: 'I' } }]
    await expect(checkAMRAlert('Ciprofloxacin', 'patient-1', 'hospital-1')).resolves.toMatchObject({ alertLevel: 'warning' })
    await expect(checkAMRAlert('Ceftriaxone', 'patient-1', 'hospital-1')).resolves.toBeNull()
  })

  it('does not query without patient or hospital context', async () => {
    await expect(checkAMRAlert('Amoxicillin', null, 'hospital-1')).resolves.toBeNull()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})