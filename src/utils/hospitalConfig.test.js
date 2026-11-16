import { describe, it, expect, vi, afterEach } from 'vitest'
import { mergeWorkflowFields, validateWorkflowOverride, customFieldKey, payerTypeFor, priceForPayer, loadRoleOverrides } from './hospitalConfig'
import { canAccessScreen, canPerformAction, setRolePermissionOverrides } from '../access'

const FIELDS = [
  { key: 'procedure', label: 'Procedure', required: true },
  { key: 'notes', label: 'Notes', type: 'textarea' },
  { key: 'asa', label: 'ASA class', type: 'select', options: ['I', 'II'] },
]

describe('department form changes', () => {
  it('relabels, hides optional fields, adds custom fields and keeps safety-critical ones', () => {
    const out = mergeWorkflowFields(FIELDS, [
      { key: 'procedure', label: 'Operation', hidden: true, required: false },
      { key: 'notes', hidden: true },
      { key: 'asa', options: ['I', 'II', 'III'], required: true },
      { key: 'x_blood_loss_ml', label: 'Blood loss (ml)', type: 'number', custom: true },
    ])
    expect(out.map((f) => f.key)).toEqual(['procedure', 'asa', 'x_blood_loss_ml'])
    expect(out[0]).toMatchObject({ label: 'Operation', required: true })
    expect(out[1]).toMatchObject({ required: true, options: ['I', 'II', 'III'] })
    expect(out[2]).toMatchObject({ type: 'number', required: false })
  })
  it('defaults pass through untouched with no override', () => {
    expect(mergeWorkflowFields(FIELDS, [])).toEqual(FIELDS)
  })
  it('refuses unsafe or malformed overrides', () => {
    expect(validateWorkflowOverride(FIELDS, [{ key: 'procedure', hidden: true }])).toMatch(/cannot be hidden/)
    expect(validateWorkflowOverride(FIELDS, [{ key: 'notes', custom: true, label: 'x' }])).toMatch(/built-in/)
    expect(validateWorkflowOverride(FIELDS, [{ key: 'Bad Key', custom: true, label: 'x' }])).toMatch(/x_/)
    expect(validateWorkflowOverride(FIELDS, [{ key: 'x_a', custom: true, label: 'A', type: 'select', options: [] }])).toMatch(/option/)
    expect(validateWorkflowOverride(FIELDS, [{ key: 'nope' }])).toMatch(/not a field/)
    expect(validateWorkflowOverride(FIELDS, [{ key: 'notes', hidden: true }, { key: 'x_ok', custom: true, label: 'OK' }])).toBe('')
    expect(customFieldKey('Blood loss (ml)')).toBe('x_blood_loss_ml')
  })
})

describe('payer prices', () => {
  it('maps payment methods to price lists like the database does', () => {
    expect(payerTypeFor('SHA (Social Health Authority)')).toBe('sha')
    expect(payerTypeFor('Insurance', 'NHIF')).toBe('sha')
    expect(payerTypeFor('Insurance', 'AAR')).toBe('insurance')
    expect(payerTypeFor('M-Pesa')).toBe('cash')
  })
  it('uses the payer price when set and the base tariff otherwise, never throwing', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ price_kes: '400.00', price_list: 'SHA tariff' }], error: null })
    expect(await priceForPayer({ rpc }, 'h', 'CONS-OPD', 500, { paymentMethod: 'SHA' })).toEqual({ amount: 400, priceList: 'SHA tariff' })
    expect(await priceForPayer({ rpc }, 'h', 'CONS-OPD', 500, { paymentMethod: 'Cash' })).toEqual({ amount: 500, priceList: null })
    expect(rpc).toHaveBeenCalledTimes(1)
    const missing = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'function config_price does not exist' } }) }
    expect(await priceForPayer(missing, 'h', 'CONS-OPD', 500, { paymentMethod: 'SHA' })).toEqual({ amount: 500, priceList: null })
    const boom = { rpc: vi.fn().mockRejectedValue(new Error('offline')) }
    expect(await priceForPayer(boom, 'h', 'CONS-OPD', 500, { paymentMethod: 'Insurance' })).toEqual({ amount: 500, priceList: null })
  })
})

describe('role matrix overrides', () => {
  afterEach(() => setRolePermissionOverrides([]))
  it('replaces a role\'s screens and actions but never restricts Admin', async () => {
    expect(canAccessScreen('Nurse', '/laboratory')).toBe(true)
    const eq = vi.fn().mockResolvedValue({ data: [{ role: 'Nurse', screens: ['/dashboard', '/wards'], actions: ['record_vitals'] }, { role: 'Admin', screens: [], actions: [] }], error: null })
    await loadRoleOverrides({ from: () => ({ select: () => ({ eq }) }) }, 'h')
    expect(canAccessScreen('Nurse', '/laboratory')).toBe(false)
    expect(canAccessScreen('Registered Nurse', '/wards/3')).toBe(true)
    expect(canPerformAction('Nurse', 'register_patient')).toBe(false)
    expect(canAccessScreen('Admin', '/settings')).toBe(true)
    expect(canAccessScreen('Doctor', '/consultation')).toBe(true)
  })
  it('falls back to defaults when the table is missing', async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: { message: 'relation "role_permissions" does not exist' } })
    await loadRoleOverrides({ from: () => ({ select: () => ({ eq }) }) }, 'h')
    expect(canAccessScreen('Nurse', '/laboratory')).toBe(true)
  })
})
