const ROLE_PERMISSIONS = {
  Admin: {
    screens: ['*'],
    actions: ['*'],
  },
  Doctor: {
    screens: ['/dashboard', '/patients', '/consultation',
              '/wards', '/laboratory', '/prescriptions', '/departments',
              '/antibiogram', '/reports', '/settings'],
    actions: ['write_diagnosis', 'order_labs', 'write_prescription',
              'admit_patient', 'discharge_patient', 'record_vitals', 'view_pharmacy',
              'view_department'],
  },
  Nurse: {
    screens: ['/dashboard', '/patients', '/wards',
              '/prescriptions', '/laboratory', '/departments'],
    actions: ['record_vitals', 'register_patient', 'admit_patient', 'discharge_patient', 'view_labs',
              'view_department'],
  },
  Pharmacist: {
    screens: ['/dashboard', '/pharmacy', '/inventory', '/departments',
              '/prescriptions', '/expiry', '/reports'],
    actions: ['approve_prescription', 'release_drugs',
              'manage_inventory', 'view_patients', 'view_department'],
  },
  'Lab Technician': {
    screens: ['/dashboard', '/laboratory', '/antibiogram', '/departments',
              '/patients'],
    actions: ['post_lab_results', 'manage_antibiogram',
              'view_patients', 'view_department'],
  },
  Receptionist: {
    screens: ['/dashboard', '/patients', '/billing',
              '/mpesa', '/sha-claims', '/insurance'],
    actions: ['register_patient', 'create_invoice',
              'record_payment', 'view_patients', 'view_department'],
  },
  Accountant: {
    screens: ['/dashboard', '/billing', '/credit', '/mpesa',
              '/sha-claims', '/insurance', '/reports', '/etims'],
    actions: ['create_invoice', 'record_payment',
              'manage_claims', 'view_reports', 'view_department'],
  },
}

const ROLE_ALIASES = {
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
  'Front Desk': 'Receptionist',
  'Patient Coordinator': 'Receptionist',
}

export function resolveRole(role) {
  if (!role) return 'Receptionist'
  if (ROLE_PERMISSIONS[role]) return role
  if (ROLE_ALIASES[role]) return ROLE_ALIASES[role]
  const lower = role.toLowerCase()
  const exact = Object.keys(ROLE_PERMISSIONS)
    .find(r => r.toLowerCase() === lower)
  if (exact) return exact
  if (lower.includes('doctor') || lower.includes('physician') ||
      lower.includes('surgeon') || lower.includes('clinical'))
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
  const perms = ROLE_PERMISSIONS[resolved]
  if (!perms) return false
  if (perms.screens.includes('*')) return true
  return perms.screens.some(s => path === s || path.startsWith(s + '/'))
}

export function canPerformAction(role, action) {
  const resolved = resolveRole(role)
  const perms = ROLE_PERMISSIONS[resolved]
  if (!perms) return false
  if (perms.actions.includes('*')) return true
  return perms.actions.includes(action)
}
