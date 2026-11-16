import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WaterQuality from './dialysis/WaterQuality'
import { BedIsolation, confirmBedForIsolation } from './wards/WardIsolation'
import VisitorPasses from './support/VisitorPasses'
import ResourcePicker from './appointments/ResourcePicker'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [], rpc: {}, rpcCalls: [], insertError: null, prompt: 'Sr Wanjiru approved' } }))
vi.mock('../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, is: () => q, gte: () => q, order: () => q, limit: () => q,
      insert: (row) => {
        db.writes.push([t, 'insert', row])
        const err = db.insertError && !row.override_reason ? db.insertError : null
        const res = Promise.resolve({ data: null, error: err })
        res.select = () => ({ single: () => Promise.resolve(err ? { data: null, error: err } : { data: { ...row, pass_no: 'VP-261115-001', ward_name: 'Medical Ward', bed_number: 'M02', patients: { full_name: 'Jane' } }, error: null }) })
        return res
      },
      update: (p) => { db.writes.push([t, 'update', p]); return { eq: () => Promise.resolve({ error: null }) } },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from, rpc: (fn, args) => { db.rpcCalls.push([fn, args]); return Promise.resolve(typeof db.rpc[fn] === 'function' ? db.rpc[fn](args) : { data: db.rpc[fn] ?? null, error: null }) } } }
})
vi.mock('../confirmDialog', () => ({ openPromptDialog: () => Promise.resolve(db.prompt) }))
vi.mock('../components/PatientSearch', () => ({
  default: ({ onPick }) => <button type="button" onClick={() => onPick({ id: 'p1', full_name: 'Jane' })}>pick patient</button>,
}))

beforeEach(() => {
  db.writes = []; db.rpcCalls = []; db.insertError = null; db.prompt = 'Sr Wanjiru approved'
  db.tables = { dialysis_water_tests: [], patient_isolation: [], visitor_restrictions: [], visitor_passes: [], scheduling_resources: [] }
  db.rpc = {}
})

describe('safety checks screens', () => {
  it('water: grades as you type, a failed result needs the action, and the status cards show what is due', async () => {
    db.rpc.dialysis_water_status = [{ parameter: 'total_chlorine', value: 0.3, status: 'fail', every_days: 1, overdue: false, next_due: '2026-11-16', blocks_dialysis: true }]
    render(<WaterQuality hospitalId="h1" />)
    expect(await screen.findByText('Total chlorine')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: '0.2' } })
    expect(screen.getByText('Out of limits')).toBeTruthy()
    expect(screen.getByText('Sessions cannot start until a passing chlorine test is recorded.')).toBeTruthy()
    const save = screen.getByRole('button', { name: 'Save result' })
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Action taken/), { target: { value: 'Carbon tank changed' } })
    fireEvent.click(save)
    await waitFor(() => expect(db.writes[0]).toEqual(['dialysis_water_tests', 'insert', expect.objectContaining({ parameter: 'total_chlorine', value: 0.2, action_taken: 'Carbon tank changed' })]))
  })

  it('isolation: placing in an unsuitable bed asks for a reason; starting isolation saves the precaution', async () => {
    db.rpc.bed_isolation_check = 'airborne isolation: a negative-pressure or single room'
    expect(await confirmBedForIsolation('b1', 'p1')).toEqual({ ok: true, reason: 'Sr Wanjiru approved' })
    db.prompt = null
    expect(await confirmBedForIsolation('b1', 'p1')).toEqual({ ok: false })
    db.rpc.bed_isolation_check = null
    expect(await confirmBedForIsolation('b1', 'p1')).toEqual({ ok: true, reason: null })

    render(<BedIsolation hospitalId="h1" bed={{ id: 'b1', isolation_type: null }} patientId="p1" canManageBeds />)
    fireEvent.change(screen.getByLabelText('Precaution'), { target: { value: 'airborne' } })
    fireEvent.change(screen.getByLabelText('Isolation reason'), { target: { value: 'Suspected TB' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start isolation' }))
    await waitFor(() => expect(db.writes[0]).toEqual(['patient_isolation', 'insert', { hospital_id: 'h1', patient_id: 'p1', precaution: 'airborne', reason: 'Suspected TB' }]))
    fireEvent.change(screen.getByLabelText('Bed isolation type'), { target: { value: 'negative_pressure' } })
    await waitFor(() => expect(db.writes.some((w) => w[0] === 'beds' && w[2].isolation_type === 'negative_pressure')).toBe(true))
  })

  it('visitor passes: a restricted visit asks who approved, then issues; the gate checks in by pass number', async () => {
    db.insertError = { message: 'Patient is in airborne isolation — the nurse in charge must approve and give PPE. Record who approved the visit to issue a pass' }
    db.rpc.visitor_pass_action = ({ p_action }) => ({ data: { pass_no: 'VP-261115-001', visitor_name: 'Ann', status: p_action }, error: null })
    render(<VisitorPasses hospitalId="h1" />)
    fireEvent.click(screen.getByRole('button', { name: 'pick patient' }))
    fireEvent.change(screen.getByLabelText('Visitor name'), { target: { value: 'Ann' } })
    fireEvent.click(screen.getByRole('button', { name: 'Issue pass' }))
    expect(await screen.findByText('VP-261115-001')).toBeTruthy()
    expect(db.writes.at(-1)[2]).toMatchObject({ patient_id: 'p1', visitor_name: 'Ann', override_reason: 'Sr Wanjiru approved' })
    fireEvent.change(screen.getByLabelText('Pass number'), { target: { value: 'vp-261115-001' } })
    fireEvent.click(screen.getByRole('button', { name: 'In' }))
    expect(await screen.findByText('VP-261115-001: Ann checked in.')).toBeTruthy()
    expect(db.rpcCalls.find((c) => c[0] === 'visitor_pass_action')[1]).toMatchObject({ p_pass_no: 'vp-261115-001', p_action: 'in', p_reason: null })
  })

  it('appointments: picks a room and equipment from the catalogue', async () => {
    db.tables.scheduling_resources = [{ id: 'r1', name: 'Procedure room 1', kind: 'room', quantity: 1, active: true }, { id: 'r2', name: 'Ultrasound', kind: 'equipment', quantity: 2, active: true }]
    let latest = null
    function Harness() {
      const [form, setForm] = useState({ room: '', resources: [] })
      latest = form
      return <ResourcePicker hospitalId="h1" form={form} setForm={setForm} />
    }
    render(<Harness />)
    fireEvent.change(await screen.findByLabelText('Room'), { target: { value: 'Procedure room 1' } })
    fireEvent.click(screen.getByLabelText(/Ultrasound/))
    await waitFor(() => expect(latest).toMatchObject({ room: 'Procedure room 1', resources: ['Ultrasound'], resources_enabled: true }))
  })
})
