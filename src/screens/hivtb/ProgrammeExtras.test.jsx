import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtVisits, DefaulterTracing, HtsRegister, ProgrammeIndicators } from './ProgrammeExtras'

const { db } = vi.hoisted(() => ({ db: { tables: {}, writes: [], rpc: {} } }))
vi.mock('../../supabase', () => {
  const from = (t) => {
    const q = {
      select: () => q, eq: () => q, gte: () => q, order: () => q, limit: () => q,
      insert: (row) => { db.writes.push([t, 'insert', row]); return Promise.resolve({ error: null }) },
      then: (res, rej) => Promise.resolve({ data: db.tables[t] || [], error: null }).then(res, rej),
    }
    return q
  }
  return { default: { from, rpc: (fn) => Promise.resolve({ data: db.rpc[fn] ?? null, error: null }) } }
})
vi.mock('../../components/PatientSearch', () => ({
  default: ({ onPick }) => <button type="button" onClick={() => onPick({ id: 'p1', full_name: 'Jane' })}>pick client</button>,
}))

beforeEach(() => {
  db.writes = []
  db.tables = {
    hts_tests: [{ id: 't1', tested_on: '2026-11-10', entry_point: 'anc', test_kind: 'initial', test1_kit: 'Determine', test1_result: 'reactive', test2_kit: 'First Response', test2_result: 'reactive', final_result: 'positive', linked_art_id: null, patients: { full_name: 'Amina' } }],
    hiv_visits: [], programme_tracing: [],
  }
  db.rpc = {
    programme_defaulters: [
      { programme: 'hiv', record_id: 'a1', full_name: 'Leo', number: '13939-1', phone: '0711', due_date: '2026-11-01', days: 14, band: 'defaulter', attempts: 0, last_trace: null },
      { programme: 'tb', record_id: 'e1', full_name: 'Kim', due_date: '2026-10-20', days: 26, band: 'interrupted', attempts: 1, last_trace: { on: '2026-11-12', outcome: 'not_reached' } },
    ],
    hiv_programme_indicators: {
      indicators: [{ group: 'Testing', key: 'hts_tst_pos', label: 'Tested positive (HTS_TST_POS) — yield', numerator: 2, denominator: 40, percent: 5 }],
      cascade: [{ step: 'Tested', value: 40 }, { step: 'Positive', value: 2 }, { step: 'Linked', value: 2 }, { step: 'Started ART', value: 1 }, { step: 'Current on ART', value: 300 }, { step: 'VL done', value: 250 }, { step: 'Suppressed', value: 240 }],
      by_entry_point: [{ entry_point: 'anc', tested: 10, positive: 1, yield: 10 }],
    },
  }
})

describe('HIV / TB programme screens', () => {
  it('HTS: confirmatory kit appears when reactive; needs consent; saves both kits', async () => {
    render(<HtsRegister hospitalId="h1" />)
    expect(await screen.findByText('Not linked — enrol on ART')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Record HIV test' }))
    fireEvent.click(screen.getByRole('button', { name: 'pick client' }))
    fireEvent.change(screen.getByLabelText('Determine (screening)'), { target: { value: 'reactive' } })
    expect(screen.getByText('Screening reactive — do the confirmatory test')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('First Response (confirmatory)'), { target: { value: 'reactive' } })
    expect(screen.getByText('Result: Positive')).toBeTruthy()
    const save = screen.getByRole('button', { name: 'Save test' })
    expect(save.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Client counselled and consented to testing'))
    fireEvent.click(save)
    await waitFor(() => expect(db.writes[0]).toEqual(['hts_tests', 'insert', expect.objectContaining({ patient_id: 'p1', consent: true, test1_result: 'reactive', test2_result: 'reactive' })]))
  })

  it('visit: any TB symptom is presumptive; the visit saves with the next appointment', async () => {
    const onChanged = vi.fn()
    render(<ArtVisits art={{ id: 'a1', hospital_id: 'h1' }} onChanged={onChanged} />)
    expect(screen.getByText('Not screened')).toBeTruthy()
    for (const l of ['Cough', 'Fever', 'Weight loss']) fireEvent.change(screen.getByLabelText(l), { target: { value: 'no' } })
    expect(screen.getByText('Answer all four TB questions')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save visit' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Night sweats'), { target: { value: 'yes' } })
    expect(screen.getByText('Presumptive TB — send sputum / GeneXpert')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('ARVs given (months)'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save visit' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(db.writes[0][2]).toMatchObject({ art_id: 'a1', tb_night_sweats: true, tb_cough: false, months_dispensed: 3 })
    expect(db.writes[0][2].next_appointment > db.writes[0][2].visit_date).toBe(true)
  })

  it('defaulters: bands and tracing with a promised date', async () => {
    render(<DefaulterTracing hospitalId="h1" />)
    expect(await screen.findByText('Defaulter 8–30 days')).toBeTruthy()
    expect(screen.getByText('not traced')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Record tracing' })[0])
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'reached_will_return' } })
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Promised date'), { target: { value: '2099-01-05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(db.writes[0]).toEqual(['programme_tracing', 'insert', expect.objectContaining({ programme: 'hiv', art_id: 'a1', tb_episode_id: null, outcome: 'reached_will_return', promised_date: '2099-01-05' })]))
  })

  it('indicators: cascade and indicator table', async () => {
    render(<ProgrammeIndicators hospitalId="h1" />)
    expect(await screen.findByText('HIV cascade')).toBeTruthy()
    expect(screen.getByText('Tested positive (HTS_TST_POS) — yield')).toBeTruthy()
    expect(screen.getByText('5%')).toBeTruthy()
    expect(screen.getByText('Testing by entry point')).toBeTruthy()
  })
})
