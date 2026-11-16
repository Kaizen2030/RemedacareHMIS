import { describe, expect, it } from 'vitest'
import { calculateNetSalary, calculatePayrollLine, getAttendanceStatus } from './payroll'

describe('payroll utils', () => {
  it('calculates net salary after statutory deductions', () => {
    expect(calculateNetSalary({ basic: 50000, allowances: 12000, deductions: 3500, nhif: 600, nssf: 1200 })).toBe(56700)
  })

  it('does not allow payroll deductions to exceed the approved gross pay', () => {
    expect(() => calculatePayrollLine({ grossPay: 5000, deductions: 5001 })).toThrow('Deductions cannot exceed gross pay')
  })

  it('flags biometric attendance as late when under the required minutes', () => {
    expect(getAttendanceStatus({ shiftMinutes: 420, requiredMinutes: 480 })).toMatchObject({ status: 'late' })
  })

  it('marks complete attendance when minutes exceed required hours', () => {
    expect(getAttendanceStatus({ shiftMinutes: 500, requiredMinutes: 480 })).toMatchObject({ status: 'present' })
  })
})
