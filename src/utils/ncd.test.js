import { describe, expect, it } from 'vitest'
import { describeTargets, evaluateControl, fieldsFor, mergeTargets, pct, recallState } from './ncd'

describe('NCD helpers mirror the database rules', () => {
  it('control evaluation', () => {
    const htn = { bp_sys_max: 139, bp_dia_max: 89 }
    expect(evaluateControl({ bp_sys: 130, bp_dia: 85 }, htn)).toBe('controlled')
    expect(evaluateControl({ bp_sys: 140, bp_dia: 85 }, htn)).toBe('uncontrolled')
    expect(evaluateControl({ bp_sys: '', weight_kg: 70 }, htn)).toBe('unknown')
    expect(evaluateControl({ act_score: 21 }, { act_score_min: 20 })).toBe('controlled')
  })
  it('targets read like the guideline and patient overrides win', () => {
    expect(describeTargets({ bp_sys_max: 139, bp_dia_max: 89 })).toBe('BP systolic < 140, BP diastolic < 90')
    expect(describeTargets({ hba1c_max: 6.9 })).toBe('HbA1c ≤ 6.9')
    expect(mergeTargets({ hba1c_max: 6.9, fbs_max: 7 }, { hba1c_max: 7.4 }, { hba1c_max: 7.9 })).toEqual({ hba1c_max: 7.9, fbs_max: 7 })
  })
  it('recall state', () => {
    const today = new Date(2026, 10, 20, 9)
    expect(recallState({ status: 'active', next_visit_due: '2026-11-25' }, today).key).toBe('due_soon')
    expect(recallState({ status: 'active', next_visit_due: '2026-11-18' }, today).key).toBe('late')
    expect(recallState({ status: 'active', next_visit_due: '2026-11-10' }, today)).toMatchObject({ key: 'overdue', label: 'Overdue 10 days' })
    expect(recallState({ status: 'active', next_visit_due: '2026-10-10' }, today).key).toBe('ltfu_soon')
    expect(recallState({ status: 'ltfu', next_visit_due: '2026-10-10' }, today).key).toBe('ltfu')
    expect(recallState({ status: 'died', next_visit_due: '2026-10-10' }, today)).toBeNull()
  })
  it('fields per condition and percentages', () => {
    expect(fieldsFor('dm')).toEqual(['bp_sys', 'bp_dia', 'fbs', 'rbs', 'hba1c', 'weight_kg', 'height_cm'])
    expect(fieldsFor('unknown_x')).toContain('bp_sys')
    expect(pct(1, 3)).toBe(33)
    expect(pct(1, 0)).toBe(0)
  })
})
