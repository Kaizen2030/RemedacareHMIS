export function calculatePayrollLine({ grossPay = 0, deductions = 0 }) {
  const gross = Number(grossPay || 0)
  const totalDeductions = Number(deductions || 0)
  if (!Number.isFinite(gross) || !Number.isFinite(totalDeductions) || gross < 0 || totalDeductions < 0) {
    throw new Error('Payroll amounts must be non-negative numbers')
  }
  if (totalDeductions > gross) {
    throw new Error('Deductions cannot exceed gross pay')
  }
  return { grossPay: Number(gross.toFixed(2)), deductions: Number(totalDeductions.toFixed(2)), netPay: Number((gross - totalDeductions).toFixed(2)) }
}

export function calculateNetSalary({ basic = 0, allowances = 0, deductions = 0, nhif = 0, nssf = 0 }) {
  return calculatePayrollLine({
    grossPay: Number(basic || 0) + Number(allowances || 0),
    deductions: Number(deductions || 0) + Number(nhif || 0) + Number(nssf || 0),
  }).netPay
}

export function getAttendanceStatus({ shiftMinutes = 0, requiredMinutes = 480 }) {
  const reachedRequiredMinutes = Number(shiftMinutes || 0) >= Number(requiredMinutes || 0)
  return {
    status: reachedRequiredMinutes ? 'present' : 'late',
    shiftMinutes: Number(shiftMinutes || 0),
    requiredMinutes: Number(requiredMinutes || 0),
    isOnTime: reachedRequiredMinutes,
  }
}
