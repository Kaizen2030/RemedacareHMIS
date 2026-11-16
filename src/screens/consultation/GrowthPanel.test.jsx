import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GrowthPanel, { isUnderFive } from './GrowthPanel'

const { db } = vi.hoisted(() => ({ db: { writes: [], rows: [] } }))
vi.mock('../../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, order: () => q,
      insert: (row) => { db.writes.push([t, row]); return Promise.resolve({ error: null }) },
      then: (res, rej) => Promise.resolve({ data: db.rows, error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from } }
})

const dob = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10)
beforeEach(() => { db.writes = []; db.rows = [{ id: 'g1', measured_on: '2026-10-01', age_days: 360, weight_kg: 8.1, length_cm: 72, waz: -1.2, haz: -0.9, whz: -1.1, hcz: null, flags: [] }] })

describe('growth panel', () => {
  it('knows who is under five', () => {
    expect(isUnderFive({ date_of_birth: dob })).toBe(true)
    expect(isUnderFive({ age: 7 })).toBe(false)
    expect(isUnderFive({ age: 3 })).toBe(true)
  })
  it('previews z-scores and alerts, saves, and draws the WHO chart', async () => {
    render(<GrowthPanel hospitalId="h1" patientId="p1" visitId="v1" patient={{ date_of_birth: dob, gender: 'Male' }} />)
    expect(await screen.findByRole('img', { name: /Weight-for-age chart/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Weight kg'), { target: { value: '7.2' } })
    fireEvent.change(screen.getByLabelText('Length cm'), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText('MUAC cm'), { target: { value: '11.3' } })
    expect(screen.getByText(/Severe acute malnutrition/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save measurement' }))
    await waitFor(() => expect(db.writes[0][1]).toMatchObject({ patient_id: 'p1', visit_id: 'v1', sex: 'Male', weight_kg: 7.2, length_cm: 70, muac_cm: 11.3, measured: 'length', age_days: null }))
  })
})
