import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MohRegister from './MohRegister'

const { calls } = vi.hoisted(() => ({ calls: [] }))
vi.mock('../../supabase', () => ({
  default: {
    rpc: (fn, args) => {
      calls.push([fn, args])
      if (fn === 'moh406_register') return Promise.resolve({ data: [{ serial: '1', name: 'Jane', mode: 'svd', baby_outcome: 'live_birth', missing: ['APGAR 5'] }, { serial: '2', name: 'Amina', mode: 'caesarean', baby_outcome: 'live_birth', missing: [] }], error: null })
      return Promise.resolve({ data: [], error: null })
    },
  },
}))

describe('MOH register view', () => {
  it('shows MOH 406 in register order with blanks and totals; can filter to incomplete rows', async () => {
    render(<MohRegister hospitalId="h1" range={{ from: '2026-11-01', to: '2026-11-30' }} />)
    fireEvent.change(screen.getByLabelText('Register'), { target: { value: '406' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show register' }))
    expect(await screen.findByText(/MOH 406 — Maternity register · 2026-11-01 to 2026-11-30 · 2 row/)).toBeTruthy()
    expect(calls[0]).toEqual(['moh406_register', { p_hospital: 'h1', p_from: '2026-11-01', p_to: '2026-11-30' }])
    expect(screen.getByText('C/S')).toBeTruthy()
    expect(screen.getByText('APGAR 5', { selector: 'td' })).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Only rows with blank cells'))
    expect(screen.queryByText('Amina')).toBeNull()
    expect(screen.getByText('Caesarean section').nextSibling.textContent).toBe('1')
  })
})
