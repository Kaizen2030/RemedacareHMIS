const ROLE_PERMISSIONS = {
  Admin: {
    screens: ['*'],
    actions: ['*'],
  },
  Doctor: {
    screens: ['/dashboard', '/critical-results', '/references', '/patients', '/appointments', '/consultation',
              '/wards', '/blood-bank', '/morgue', '/theatre', '/telemedicine', '/maternity', '/dialysis', '/emergency', '/icu', '/nutrition', '/hivtb', '/biomedical', '/quality-safety', '/laboratory', '/prescriptions', '/departments', '/care-pathways', '/chronic-disease',
              '/antibiogram', '/microbiology', '/reports', '/settings', '/pharmacy-controls', '/dashboards'],
    actions: ['write_diagnosis', 'order_labs', 'write_prescription',
              'admit_patient', 'discharge_patient', 'record_vitals', 'view_pharmacy',
              'view_department'],
  },
  Nurse: {
    screens: ['/dashboard', '/critical-results', '/references', '/patients', '/wards', '/blood-bank', '/morgue', '/theatre', '/telemedicine', '/maternity', '/dialysis', '/emergency', '/icu', '/nutrition', '/hivtb', '/biomedical', '/quality-safety',
              '/prescriptions', '/laboratory', '/departments', '/care-pathways', '/chronic-disease', '/pharmacy-controls', '/dashboards'],
    actions: ['record_vitals', 'register_patient', 'admit_patient', 'discharge_patient', 'view_labs',
              'view_department'],
  },
  Pharmacist: {
    screens: ['/dashboard', '/critical-results', '/references', '/pharmacy', '/inventory', '/departments', '/procurement', '/nutrition', '/quality-safety',
              '/prescriptions', '/expiry', '/antibiogram', '/microbiology', '/reports', '/pharmacy-controls', '/dashboards'],
    actions: ['approve_prescription', 'release_drugs',
              'manage_inventory', 'view_patients', 'view_department'],
  },
  HR: {
    screens: ['/dashboard', '/hr', '/departments', '/reports'],
    actions: ['view_department', 'manage_staff', 'view_hr'],
  },
  'Transfusion Officer': {
    screens: ['/dashboard', '/blood-bank'],
    actions: ['manage_blood_bank'],
  },
  'Mortuary Attendant': {
    screens: ['/dashboard', '/morgue', '/departments'],
    actions: ['manage_morgue'],
  },
  'Lab Technician': {
    screens: ['/dashboard', '/critical-results', '/references', '/laboratory', '/blood-bank', '/biomedical', '/antibiogram', '/microbiology', '/departments',
              '/patients', '/telemedicine', '/hivtb', '/quality-safety'],
    actions: ['post_lab_results', 'manage_antibiogram', 'manage_blood_bank',
              'view_patients', 'view_department'],
  },
  Receptionist: {
    screens: ['/dashboard', '/patients', '/appointments', '/billing', '/telemedicine', '/emergency', '/nutrition', '/departments',
              '/mpesa', '/sha-claims', '/insurance'],
    actions: ['register_patient', 'create_invoice',
              'record_payment', 'view_patients', 'view_department'],
  },
  Accountant: {
    screens: ['/dashboard', '/hr', '/billing', '/credit', '/mpesa', '/payroll', '/procurement', '/quality-safety', '/biomedical',
              '/sha-claims', '/insurance', '/reports', '/etims', '/dashboards'],
    actions: ['create_invoice', 'record_payment', 'refund_payment',
              'manage_claims', 'view_reports', 'view_department', 'manage_payroll'],
  },
}

const ROLE_ALIASES = {
  Registrar: 'Doctor',
  Intern: 'Doctor',
  'Medical Intern': 'Doctor',
  Dentist: 'Doctor',
  Anaesthetist: 'Doctor',
  Paediatrician: 'Doctor',
  Obstetrician: 'Doctor',
  Gynaecologist: 'Doctor',
  Sonographer: 'Lab Technician',
  'Clinical Officer': 'Doctor',
  'Medical Officer': 'Doctor',
  'Consultant': 'Doctor',
  'Specialist': 'Doctor',
  'General Practitioner': 'Doctor',
  'Nursing Officer': 'Nurse',
  'Senior Nursing Officer': 'Nurse',
  'Registered Nurse': 'Nurse',
  'Nursing Officer I': 'Nurse',
  'Nursing Officer II': 'Nurse',
  'Midwife': 'Nurse',
  'Senior Pharmacist': 'Pharmacist',
  'Pharmaceutical Technologist': 'Pharmacist',
  'Pharmacy Technician': 'Pharmacist',
  'Lab Scientist': 'Lab Technician',
  'Medical Laboratory Technician': 'Lab Technician',
  MLT: 'Lab Technician',
  Microbiologist: 'Lab Technician',
  Radiologist: 'Lab Technician',
  Radiographer: 'Lab Technician',
  'Finance Officer': 'Accountant',
  Cashier: 'Accountant',
  'Billing Officer': 'Accountant',
  'HR Manager': 'HR',
  'HR Officer': 'HR',
  'Human Resources Officer': 'HR',
  'Front Desk': 'Receptionist',
  'Patient Coordinator': 'Receptionist',
}

// Hospital-specific overrides from Settings → Configuration (role_permissions table). Admin is never overridden.
let ROLE_OVERRIDES = {}
export const DEFAULT_ROLE_PERMISSIONS = ROLE_PERMISSIONS
export const CONFIGURABLE_ROLES = Object.keys(ROLE_PERMISSIONS).filter((r) => r !== 'Admin')
export const ALL_SCREENS = [...new Set(Object.values(ROLE_PERMISSIONS).flatMap((p) => p.screens).filter((s) => s !== '*'))].sort()
export const ALL_ACTIONS = [...new Set([...Object.values(ROLE_PERMISSIONS).flatMap((p) => p.actions).filter((a) => a !== '*'), 'manage_payroll'])].sort()

/** rows: [{ role, screens, actions }]; pass [] to go back to the defaults. */
export function setRolePermissionOverrides(rows = []) {
  ROLE_OVERRIDES = {}
  for (const row of rows || []) {
    if (!row?.role || row.role === 'Admin' || !ROLE_PERMISSIONS[row.role]) continue
    ROLE_OVERRIDES[row.role] = { screens: [...(row.screens || [])], actions: [...(row.actions || [])] }
  }
}

export function getRolePermissions(role) {
  return ROLE_OVERRIDES[role] || ROLE_PERMISSIONS[role] || null
}

export function resolveRole(role) {
  if (!role) return 'Receptionist'
  if (ROLE_PERMISSIONS[role]) return role
  if (ROLE_ALIASES[role]) return ROLE_ALIASES[role]
  const lower = role.toLowerCase().trim()
  const exact = Object.keys(ROLE_PERMISSIONS)
    .find(r => r.toLowerCase() === lower)
  if (exact) return exact
  const alias = Object.keys(ROLE_ALIASES).find(r => r.toLowerCase() === lower)   // "medical officer" as typed
  if (alias) return ROLE_ALIASES[alias]
  if (lower.includes('doctor') || lower.includes('physician') ||
      lower.includes('surgeon') || lower.includes('clinical') ||
      lower.includes('medical officer') || lower.includes('practitioner'))
    return 'Doctor'
  if (lower.includes('nurse') || lower.includes('nursing') ||
      lower.includes('midwife'))
    return 'Nurse'
  if (lower.includes('pharma'))
    return 'Pharmacist'
  if (lower.includes('lab') || lower.includes('technician') ||
      lower.includes('radiolog') || lower.includes('mlt'))
    return 'Lab Technician'
  if (lower.includes('account') || lower.includes('finance') ||
      lower.includes('cashier') || lower.includes('billing'))
    return 'Accountant'
  if (lower.includes('reception') || lower.includes('front desk') ||
      lower.includes('coordinator'))
    return 'Receptionist'
  if (lower.includes('admin'))
    return 'Admin'
  return 'Receptionist'
}

export function canAccessScreen(role, path) {
  const resolved = resolveRole(role)
  const perms = getRolePermissions(resolved)
  if (!perms) return false
  if (perms.screens.includes('*')) return true
  return perms.screens.some(s => path === s || path.startsWith(s + '/'))
}

export function canAccessPayroll(role) {
  const resolved = resolveRole(role)
  const perms = getRolePermissions(resolved)
  if (!perms) return false
  if (perms.screens.includes('*')) return true
  return perms.screens.includes('/payroll') || perms.actions.includes('manage_payroll')
}

/**
 * Refunds, clearing/bouncing cheques. Mirrors pay_access_level() in the payments migration:
 * admins and accountants/finance — but NOT cashiers or billing officers, even though those
 * titles resolve to Accountant for screen access (segregation of duties).
 */
export function canManagePayments(role) {
  if (!canPerformAction(role, 'refund_payment')) return false
  if (resolveRole(role) === 'Admin') return true
  return !/cashier|billing/i.test(String(role || ''))
}

export function canPerformAction(role, action) {
  const resolved = resolveRole(role)
  const perms = getRolePermissions(resolved)
  if (!perms) return false
  if (perms.actions.includes('*')) return true
  return perms.actions.includes(action)
}
