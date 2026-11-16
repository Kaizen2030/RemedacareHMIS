import { describe, expect, it } from 'vitest'
import { getWorkflowVisitUpdate } from './visitHandoff'

describe('workflow visit handoffs', () => {
  it('routes an ICU admission into the shared ICU visit queue', () => {
    expect(getWorkflowVisitUpdate({ visitRouting: { Open: { status: 'ICU', speciality: 'ICU / HDU', assignedDoctor: null } } }, 'Open'))
      .toEqual({ status: 'ICU', speciality: 'ICU / HDU', assigned_doctor_name: null })
  })

  it('does not change a visit when a workflow status has no declared handoff', () => {
    expect(getWorkflowVisitUpdate({ visitRouting: {} }, 'Completed')).toBeNull()
  })
})
