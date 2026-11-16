import { describe, expect, it } from 'vitest'
import { donationProblem, groupStatus, issuableUnits, nextEligible, plasmaCompatible, possibleReaction } from './bloodLoop'

const future = new Date(Date.now() + 10 * 86400000).toISOString()
const unit = (id, group, component = 'Packed Red Cells', extra = {}) => ({ id, blood_group: group, component, status: 'Available', screening_status: 'clear', expiry_at: future, ...extra })

describe('transfusion closed loop rules (mirror the database)', () => {
  it('plasma compatibility is the reverse of red cells', () => {
    expect(plasmaCompatible('AB-', 'O+')).toBe(true)
    expect(plasmaCompatible('O+', 'A+')).toBe(false)
    expect(plasmaCompatible('A+', 'O-')).toBe(true)
    expect(plasmaCompatible('B-', 'A+')).toBe(false)
  })
  it('grouping: single, confirmed, discrepant, voided tests ignored', () => {
    expect(groupStatus([]).status).toBe('none')
    expect(groupStatus([{ result_group: 'A+' }])).toMatchObject({ status: 'single', group: 'A+' })
    expect(groupStatus([{ result_group: 'A+' }, { result_group: 'A+' }]).status).toBe('confirmed')
    expect(groupStatus([{ result_group: 'A+' }, { result_group: 'O+' }]).status).toBe('discrepant')
    expect(groupStatus([{ result_group: 'A+', void_reason: 'WBIT' }, { result_group: 'O+' }])).toMatchObject({ status: 'single', group: 'O+' })
  })
  it('issuable units: crossmatched red cells, emergency group O, compatible plasma', () => {
    const req = { patient_id: 'p1', component: 'Packed Red Cells', status: 'ready' }
    const units = [unit('u1', 'A+'), unit('u2', 'O-'), unit('u3', 'A+', 'Packed Red Cells', { status: 'Reserved', reserved_for_patient_id: 'p2' })]
    const xms = [{ blood_unit_id: 'u1', patient_id: 'p1', result: 'Compatible', expires_at: future }]
    expect(issuableUnits(req, units, xms, { status: 'confirmed', group: 'A+' }).map((x) => x.unit.id)).toEqual(['u1'])
    expect(issuableUnits({ ...req, emergency_release: true }, units, [], { status: 'none' }).map((x) => [x.unit.id, x.emergency])).toEqual([['u2', true]])
    expect(issuableUnits(req, units, xms, { status: 'discrepant' })).toEqual([])
    const ffp = { patient_id: 'p1', component: 'Fresh Frozen Plasma', status: 'requested' }
    expect(issuableUnits(ffp, [unit('f1', 'O+', 'Fresh Frozen Plasma'), unit('f2', 'AB+', 'Fresh Frozen Plasma')], [], { status: 'single', group: 'A+' }).map((x) => x.unit.id)).toEqual(['f2'])
  })
  it('15-minute reaction check and donor eligibility', () => {
    expect(possibleReaction({ temp: 36.8, hr: 80, sbp: 120 }, { temp: 37.9, hr: 85, sbp: 118 })).toBe(true)
    expect(possibleReaction({ temp: 36.8, hr: 80, sbp: 120 }, { temp: 37.2, hr: 90, sbp: 112 })).toBe(false)
    const donor = { sex: 'female', date_of_birth: '1995-05-01', last_donation_at: new Date(Date.now() - 100 * 86400000).toISOString() }
    const ok = { weight_kg: 60, hb: 13, bp_sys: 120, bp_dia: 80, temp: 36.6, questionnaire_ok: true }
    expect(donationProblem(donor, ok)).toMatch(/Too soon/)
    expect(nextEligible(donor).getTime() - new Date(donor.last_donation_at).getTime()).toBe(112 * 86400000)
    expect(donationProblem({ ...donor, sex: 'male' }, ok)).toBe(null)
    expect(donationProblem({ ...donor, sex: 'male' }, { ...ok, hb: 12 })).toMatch(/12.5/)
    expect(donationProblem({ permanently_deferred: true, deferral_reason: 'HBV' }, ok)).toMatch(/Permanently/)
  })
})
