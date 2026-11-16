import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ICU from './ICU'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [] } }))
vi.mock('../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, is: () => q, in: () => q, gte: () => q, order: () => q, limit: () => q,
      insert: (row) => { db.writes.push([t, 'insert', row]); return Promise.resolve({ error: null }) },
      update: (p) => { db.writes.push([t, 'update', p]); return q },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from, rpc: () => Promise.resolve({ data: { admissions: 0 }, error: null }) } }
})
vi.mock('../context', () => ({ useHospital: () => ({ hospitalId: 'h1' }) }))
vi.mock('../hooks/useAccessLog', () => ({ default: () => true }))
vi.mock('../components/PatientSearch', () => ({ default: () => null }))

const now = Date.now()
beforeEach(() => {
  db.writes = []
  db.tables = {
    icu_admissions: [{ id: 'a1', hospital_id: 'h1', patient_id: 'p1', unit: 'ICU', bed_label: 'B2', diagnosis: 'Septic shock', code_status: 'dnar', admitted_at: new Date(now - 30 * 3600000).toISOString(), weight_kg: 70, height_cm: 170, sex: 'male', patients: { full_name: 'Jane Wanjiku', age: 54 } }],
    icu_entries: [
      { id: 'e1', admission_id: 'a1', kind: 'ventilator', recorded_at: new Date(now - 3600000).toISOString(), data: { mode: 'VC-AC', vt: 600 }, calc: { vt_ml_kg: 9.1 }, flags: ['Tidal volume above 8 mL/kg predicted body weight (lung-protective 6–8)'] },
      { id: 'e2', admission_id: 'a1', kind: 'infusion', recorded_at: new Date(now - 7200000).toISOString(), data: { drug: 'Noradrenaline', action: 'start', dose: 0.1, dose_unit: 'mcg/kg/min', amount: 4, volume_ml: 50, second_checker: 'N. W' }, calc: { rate_ml_h: 5.3, high_alert: true }, flags: [] },
    ],
  }
})

describe('ICU', () => {
  it('shows the unit board with ventilation, infusions, warnings and overdue tasks', async () => {
    render(<ICU />)
    expect(await screen.findByText(/Jane Wanjiku/)).toBeTruthy()
    expect(screen.getByText('DNAR')).toBeTruthy()
    expect(screen.getByText('VC-AC · 9.1 mL/kg')).toBeTruthy()
    expect(screen.getByText('Noradrenaline 5.3 mL/h')).toBeTruthy()
    expect(screen.getByText(/Tidal volume above 8/)).toBeTruthy()
    expect(screen.getByText('Vitals overdue')).toBeTruthy()
    expect(screen.getByText('Daily goals not done today')).toBeTruthy()
    expect(screen.getByText('Day 2')).toBeTruthy()
  })

  it('calculates the pump rate and insists on a second checker for high-alert drugs', async () => {
    render(<ICU />)
    fireEvent.click(await screen.findByText(/Jane Wanjiku/))
    fireEvent.click(await screen.findByRole('tab', { name: 'Infusions' }))
    expect(screen.getByText(/Running now/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Drug'), { target: { value: 'Adrenaline' } })
    fireEvent.change(screen.getByLabelText('Dose'), { target: { value: '0.05' } })
    fireEvent.change(screen.getByLabelText('mg in syringe/bag'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Made up to mL'), { target: { value: '50' } })
    expect(screen.getByText('2.6 mL/h')).toBeTruthy() // 0.05 × 70 × 60 / 80
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/second nurse must check/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Second checker/), { target: { value: 'Nurse Achieng' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'icu_entries')[2]).toMatchObject({ kind: 'infusion', data: { drug: 'Adrenaline', second_checker: 'Nurse Achieng', weight_kg: 70 } }))
  })

  it('shows a live SOFA and requires an outcome to discharge', async () => {
    render(<ICU />)
    fireEvent.click(await screen.findByText(/Jane Wanjiku/))
    fireEvent.click(await screen.findByRole('tab', { name: 'SOFA' }))
    fireEvent.change(screen.getByLabelText('GCS'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Platelets ×10⁹/L'), { target: { value: '40' } })
    expect(screen.getByText('6')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Discharge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discharge from unit' }))
    expect(await screen.findByText(/Choose where the patient went/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'ward' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discharge from unit' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'icu_admissions' && w[1] === 'update')[2]).toMatchObject({ outcome: 'ward' }))
  })
})
