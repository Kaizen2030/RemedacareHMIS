import { canAccessScreen, canManagePayments, canPerformAction, resolveRole } from './access'

describe('payment permissions (must match pay_access_level() in the payments migration)', () => {
  it('lets front-desk and finance roles take payments, not clinical staff', () => {
    for (const r of ['Receptionist', 'Front Desk', 'Cashier', 'Billing Officer', 'Accountant', 'Admin']) {
      expect(canPerformAction(r, 'record_payment')).toBe(true)
    }
    for (const r of ['Nurse', 'Doctor', 'Pharmacist', 'Lab Technician']) {
      expect(canPerformAction(r, 'record_payment')).toBe(false)
    }
  })

  it('keeps refunds with finance and admins — cashiers cannot refund what they collected', () => {
    for (const r of ['Admin', 'Accountant', 'Finance Officer', 'Senior Finance Officer']) expect(canManagePayments(r)).toBe(true)
    for (const r of ['Cashier', 'Billing Officer', 'Senior Cashier', 'Receptionist', 'Nurse']) expect(canManagePayments(r)).toBe(false)
  })
})

describe('pharmacist antibiogram permissions', () => {
  it('can review the antibiogram without receiving laboratory editing rights', () => {
    expect(canAccessScreen('Pharmacist', '/antibiogram')).toBe(true)
    expect(canPerformAction('Pharmacist', 'manage_antibiogram')).toBe(false)
  })

  it('keeps antibiogram maintenance with laboratory staff', () => {
    expect(canPerformAction('Lab Technician', 'manage_antibiogram')).toBe(true)
  })
})

describe('job titles typed in any case', () => {
  it('maps Kenyan clinical titles to Doctor regardless of capitals', () => {
    for (const t of ['medical officer', 'Medical Officer', 'SENIOR MEDICAL OFFICER', 'consultant', 'Registrar', 'general practitioner', 'Dentist'])
      expect(resolveRole(t), t).toBe('Doctor')
    expect(resolveRole('IT Specialist')).toBe('Receptionist')
  })
})
