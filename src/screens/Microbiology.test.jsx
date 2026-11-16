import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Microbiology from './Microbiology'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [], rpc: {}, rpcCalls: [] } }))
vi.mock('../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, gte: () => q, order: () => q, limit: () => q,
      insert: (row) => {
        db.writes.push([t, 'insert', row])
        const res = Promise.resolve({ error: null })
        res.select = () => ({ single: () => Promise.resolve({ data: { id: 'i1', hospital_id: 'h1', ...row, flags: [], warnings: [], phenotype: {}, status: 'preliminary' }, error: null }) })
        return res
      },
      upsert: (row) => { db.writes.push([t, 'upsert', row]); return Promise.resolve({ error: null }) },
      update: (p) => { db.writes.push([t, 'update', p]); return { eq: () => Promise.resolve({ error: null }) } },
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from, rpc: (fn, args) => { db.rpcCalls.push([fn, args]); return Promise.resolve({ data: typeof db.rpc[fn] === 'function' ? db.rpc[fn](args) : db.rpc[fn] ?? null, error: null }) } } }
})
vi.mock('../context', () => ({ useHospital: () => ({ hospitalId: 'h1' }) }))
vi.mock('../components/PatientSearch', () => ({ default: ({ onPick }) => <button type="button" onClick={() => onPick({ id: 'p1', full_name: 'Jane' })}>pick patient</button> }))

beforeEach(() => {
  db.writes = []; db.rpcCalls = []
  db.tables = {
    micro_organisms: [{ code: 'eco', name: 'Escherichia coli', bp_group: 'ENT' }, { code: 'sau', name: 'Staphylococcus aureus', bp_group: 'STA' }],
    micro_antibiotics: [{ code: 'CRO', name: 'Ceftriaxone' }, { code: 'AMP', name: 'Ampicillin' }],
    micro_specimen_types: [{ code: 'blood', label: 'Blood' }, { code: 'urine', label: 'Urine' }],
    micro_isolates: [{ id: 'x1', hospital_id: 'h1', specimen_date: '2026-11-10', organism_code: 'sau', organism_name: 'Staphylococcus aureus', specimen_type: 'blood', ward: 'ICU', flags: ['MRSA', 'MDR'], warnings: [], phenotype: {}, status: 'preliminary', source: 'manual', patients: { full_name: 'Bob' }, mdr_class: 'MDR', mdr_detail: {} }],
    micro_ast: [],
  }
  db.rpc = {}
})

describe('microbiology surveillance screen', () => {
  it('lists isolates with resistance flags, records a new isolate and adds a MIC result', async () => {
    render(<Microbiology />)
    expect(await screen.findByText('MRSA')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New isolate' }))
    fireEvent.click(screen.getByRole('button', { name: 'pick patient' }))
    await screen.findByRole('option', { name: 'Escherichia coli' })
    fireEvent.change(screen.getByLabelText('Organism'), { target: { value: 'eco' } })
    fireEvent.change(screen.getByLabelText('Specimen number'), { target: { value: 'M-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and add results' }))
    await waitFor(() => expect(db.writes[0]).toEqual(['micro_isolates', 'insert', expect.objectContaining({ patient_id: 'p1', organism_code: 'eco', organism_name: 'Escherichia coli', specimen_no: 'M-1' })]))
    expect(await screen.findByRole('dialog', { name: 'Isolate' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Antibiotic'), { target: { value: 'CRO' } })
    fireEvent.change(screen.getByLabelText('MIC'), { target: { value: '>2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add result' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'micro_ast')).toEqual(['micro_ast', 'upsert', expect.objectContaining({ isolate_id: 'i1', antibiotic: 'CRO', method: 'mic', raw_value: '>2' })]))
  })

  it('imports an instrument CSV and maps a code the database did not recognise', async () => {
    let calls = 0
    db.rpc.micro_import = () => (++calls === 1 ? { created: 1, updated: 0, skipped: 0, unmapped: [{ kind: 'antibiotic', code: 'AM' }], patients_not_found: [] } : { created: 0, updated: 1, skipped: 0, unmapped: [], patients_not_found: [] })
    render(<Microbiology />)
    fireEvent.click(screen.getByRole('tab', { name: 'Instrument import' }))
    const file = new File(['Lab ID,Patient ID,Organism,AM MIC,AM Interp\nM-1,P-1,ESCCOL,>=32,R\n'], 'vitek.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Import' }))
    await waitFor(() => expect(db.rpcCalls.find((c) => c[0] === 'micro_import')[1].p_rows[0]).toMatchObject({ specimen_no: 'M-1', organism: 'ESCCOL', results: [{ code: 'AM', value: '>=32', sir: 'R' }] }))
    fireEvent.change(await screen.findByLabelText('antibiotic: AM'), { target: { value: 'AMP' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save mappings and import again' }))
    await waitFor(() => expect(db.writes.find((w) => w[0] === 'micro_instrument_maps')[2]).toEqual([{ hospital_id: 'h1', instrument: 'VITEK2', kind: 'antibiotic', external_code: 'AM', internal_code: 'AMP' }]))
    expect(await screen.findByText(/updated 1/)).toBeTruthy()
  })

  it('WHONET export downloads a de-identified file by default', async () => {
    db.rpc.micro_whonet_rows = [{ PATIENT_ID: 'abc', ORGANISM: 'eco', SPEC_TYPE: 'ur', results: [{ field: 'CIP_EM', value: '<=0.25' }] }]
    const create = vi.fn(() => 'blob:x'); const revoke = vi.fn()
    globalThis.URL.createObjectURL = create; globalThis.URL.revokeObjectURL = revoke
    render(<Microbiology />)
    fireEvent.click(screen.getByRole('tab', { name: 'WHONET export' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download WHONET file' }))
    expect(await screen.findByText(/1 isolates exported/)).toBeTruthy()
    expect(db.rpcCalls.find((c) => c[0] === 'micro_whonet_rows')[1].p_identifiable).toBe(false)
    expect(create).toHaveBeenCalled()
  })
})
