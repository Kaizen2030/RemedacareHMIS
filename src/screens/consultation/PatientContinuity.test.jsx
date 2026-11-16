import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrderSetPicker, PatientContinuity } from './PatientContinuity'
import { ORDER_SET_LIBRARY, orderSetRows, suggestOrderSets } from '../../utils/orderSetLibrary'
import { LAB_COMMON_TESTS } from '../../utils/labCatalog'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [] } }))
vi.mock('../../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, order: () => q, limit: () => q,
      insert: (row) => { db.writes.push([t, 'insert', row]); return Promise.resolve({ error: null }) },
      update: (p) => { db.writes.push([t, 'update', p]); return { eq: () => Promise.resolve({ error: null }) } },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from } }
})
vi.mock('../../confirmDialog', () => ({ openPromptDialog: () => Promise.resolve('Ankle swelling') }))

beforeEach(() => {
  db.writes = []
  db.tables = {
    patient_problems: [{ id: 'p1', problem: 'Hypertension', icd10: 'I10', status: 'active', chronic: true }],
    patient_medications: [{ id: 'm1', drug: 'Amlodipine', dose: '5 mg', frequency: 'OD', status: 'active', source: 'prescribed_here' }],
    medication_reviews: [],
    order_sets: [{ ...ORDER_SET_LIBRARY[0], id: 'os1', active: true, version: 1 }],
  }
})

describe('order set library', () => {
  it('every library test name exists in the lab catalogue', () => {
    for (const set of ORDER_SET_LIBRARY) for (const l of set.labs) expect(LAB_COMMON_TESTS[l.category], `${set.id}: ${l.category}`).toContain(l.test_type)
  })
  it('suggests by diagnosis code and builds consultation rows', () => {
    const sets = [{ ...ORDER_SET_LIBRARY[0], active: true }, { ...ORDER_SET_LIBRARY[2], active: false }]
    expect(suggestOrderSets(sets, { codes: ['B54'] }).map((s) => s.id)).toEqual(['malaria-uncomplicated-adult'])
    expect(suggestOrderSets(sets, { codes: ['A41.9'] })).toEqual([])   // not approved / active
    const rows = orderSetRows(ORDER_SET_LIBRARY[0])
    expect(rows.rx[0]).toMatchObject({ drug_name: 'Artemether-lumefantrine 20/120 mg', dosage: '4 tablets', duration: '3 days' })
    expect(rows.labs[0]).toMatchObject({ test_type: 'Malaria RDT', category: 'Parasitology', priority: 'Urgent' })
  })
})

describe('patient continuity panel', () => {
  it('offers today\'s diagnosis and prescription for the lists, and stops a medicine with a reason', async () => {
    render(<PatientContinuity hospitalId="h1" patientId="pt" visitId="v1" diagnoses={[{ code: 'E11.9', description: 'Type 2 diabetes' }, { code: 'I10', description: 'Hypertension' }]} prescriptions={[{ drug_name: 'Metformin 500 mg', dosage: '500 mg', frequency: 'BD' }]} />)
    expect(await screen.findByText(/Hypertension \(I10\)/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /\+ Hypertension/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Type 2 diabetes (today)' }))
    await waitFor(() => expect(db.writes[0]).toEqual(['patient_problems', 'insert', expect.objectContaining({ problem: 'Type 2 diabetes', icd10: 'E11.9', visit_id: 'v1' })]))
    fireEvent.click(screen.getByRole('button', { name: /Metformin 500 mg \(prescribed today/ }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'patient_medications')[2]).toMatchObject({ drug: 'Metformin 500 mg', source: 'prescribed_here' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop Amlodipine' }))
    await waitFor(() => expect(db.writes.find((w) => w[1] === 'update')[2]).toEqual({ status: 'stopped', stop_reason: 'Ankle swelling' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark medicines reviewed' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'medication_reviews')).toBeTruthy())
  })

  it('the order set picker suggests by diagnosis, logs the use and hands back rows', async () => {
    const onApply = vi.fn()
    render(<OrderSetPicker hospitalId="h1" patientId="pt" visitId="v1" diagnoses={[{ code: 'B54' }]} onApply={onApply} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use “Uncomplicated malaria (adult)”' }))
    await waitFor(() => expect(onApply).toHaveBeenCalled())
    expect(db.writes[0]).toEqual(['order_set_uses', 'insert', { hospital_id: 'h1', order_set_id: 'os1', patient_id: 'pt', visit_id: 'v1' }])
    expect(onApply.mock.calls[0][0].rx).toHaveLength(2)
    expect(screen.getByText(/Review every line before saving/)).toBeTruthy()
  })
})
