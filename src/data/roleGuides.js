// In-app quick-start guides, one per role (keys match resolveRole() in access.js). Each step names the screen it
// happens on; `path` lets the Help panel open that screen. Keep steps short: what to do, in the order a shift runs.

const COMMON_TIPS = [
  'Ctrl + K (Cmd + K on Mac) searches patients, invoices, staff and drugs from any screen.',
  'Something not working? Open Help → Report a problem. It sends the screen you were on to the IT desk automatically.',
  'Never share your sign-in. Every action is recorded against the person who is signed in.',
  'Sign out (bottom-left ↩) when you leave a shared computer.',
]

export const ROLE_GUIDES = {
  Receptionist: {
    title: 'Reception and front desk',
    intro: 'You register patients, send them to the right queue and book appointments. Money is taken only at the cashier.',
    steps: [
      { title: 'Search before you register', text: 'Search by name, phone or ID number first, so the same patient does not get two files.', path: '/patients' },
      { title: 'Register a new patient', text: 'Patients → + Register Patient. Fields marked * are required. Add next of kin and the payment type (cash, SHA, insurance).', path: '/patients' },
      { title: 'Send to the next step', text: 'After registering, send the patient to triage / vitals or straight to a doctor’s queue.', path: '/patients' },
      { title: 'Book appointments', text: 'Appointments → choose doctor, date and time. Reminders can go out by SMS.', path: '/appointments' },
      { title: 'Direct patients to the cashier', text: 'Bills are created by the services ordered. Send the patient to the Billing cashier queue to pay.', path: '/billing' },
    ],
  },
  Nurse: {
    title: 'Nursing',
    intro: 'Triage and vitals, ward care, medication rounds and handover.',
    steps: [
      { title: 'Take vitals', text: 'Patients → open the patient → Vitals. Abnormal values are highlighted and the early-warning score is calculated for you.', path: '/patients' },
      { title: 'Admit and manage beds', text: 'Ward & Beds → choose a free bed → Admit. Transfer and discharge are on the bed card.', path: '/wards' },
      { title: 'Ward rounds and charts', text: 'On the bed card: rounds, fluid balance, observations and medication administration.', path: '/wards' },
      { title: 'Act on critical results', text: 'Critical results & TDM lists results that need someone to call the doctor. Record who you told and when.', path: '/critical-results' },
      { title: 'Report incidents', text: 'Falls, medication errors and near-misses go in Quality & Safety. Reporting is blame-free.', path: '/quality-safety' },
    ],
  },
  Doctor: {
    title: 'Doctors and clinical officers',
    intro: 'Your queue, the consultation note, orders and prescriptions.',
    steps: [
      { title: 'Open your queue', text: 'Consultation shows patients waiting for you. Click a patient to start.', path: '/consultation' },
      { title: 'Write the note', text: 'History, examination, diagnosis (ICD-10 search) and plan. The note saves a draft as you type, so a power cut does not lose it.', path: '/consultation' },
      { title: 'Order tests and prescribe', text: 'Lab and imaging orders go to those departments at once. Prescriptions go to the Pharmacy queue, with allergy and interaction checks.', path: '/consultation' },
      { title: 'Use the guides', text: 'Clinical guides & references has local treatment guides (malaria, pneumonia, sepsis and more) and dose / renal calculators.', path: '/references' },
      { title: 'Respond to critical results', text: 'Critical results & TDM shows values that need action now, with drug-level (TDM) advice.', path: '/critical-results' },
    ],
  },
  'Lab Technician': {
    title: 'Laboratory',
    intro: 'Receive samples, enter or import results, validate and release.',
    steps: [
      { title: 'Work the order list', text: 'Laboratory → Orders. Filter by priority; STAT orders are on top. Receive the sample to start the clock.', path: '/laboratory' },
      { title: 'Enter results', text: 'Open the order and type the results, or accept them from the Analyser inbox if an analyser is connected.', path: '/laboratory' },
      { title: 'Validate and release', text: 'A second person validates where your lab requires it. Released results go straight to the doctor.', path: '/laboratory' },
      { title: 'Critical values', text: 'Critical values are flagged automatically. Phone the ward and record the read-back in Critical results.', path: '/critical-results' },
      { title: 'Microbiology', text: 'Culture and sensitivity results feed the Antibiogram and Microbiology surveillance automatically.', path: '/microbiology' },
    ],
  },
  Pharmacist: {
    title: 'Pharmacy',
    intro: 'Review prescriptions, dispense against stock and keep the inventory right.',
    steps: [
      { title: 'Choose who is on duty', text: 'Pharmacy → pick the pharmacist handling the queue at the top, so each release is signed.', path: '/pharmacy' },
      { title: 'Review each patient card', text: 'Approve or reject each line. Allergy, interaction and stewardship (AMR) warnings show on the card.', path: '/pharmacy' },
      { title: 'Dispense', text: 'Add approved drugs to the cart, check quantities and release. Release is blocked if stock is not enough.', path: '/pharmacy' },
      { title: 'Watch stock and expiry', text: 'Drug Inventory for stock levels and reorder points; Expiry Alerts for batches running out of date.', path: '/inventory' },
      { title: 'Controlled drugs', text: 'Controlled drugs & ward stock keeps the register; every movement needs a witness.', path: '/pharmacy-controls' },
    ],
  },
  Accountant: {
    title: 'Cashier and finance',
    intro: 'All money is received at the Billing cashier queue. Nobody else takes payments.',
    steps: [
      { title: 'Work the cashier queue', text: 'Billing → open the patient’s bill, confirm the items and take payment (cash, M-Pesa, card, SHA, insurance).', path: '/billing' },
      { title: 'Match M-Pesa payments', text: 'M-Pesa shows incoming payments; match each one to a bill so nothing is left unallocated.', path: '/mpesa' },
      { title: 'Claims', text: 'SHA Claims and Insurance Claims collect the visit details for submission and track what has been paid.', path: '/sha-claims' },
      { title: 'Credit and debts', text: 'Credit & Debts lists patients who owe money, with ageing and payment plans.', path: '/credit' },
      { title: 'Close the day', text: 'Reports → end-of-day cash summary. Count the cash and record any difference.', path: '/reports' },
    ],
  },
  HR: {
    title: 'Human resources',
    intro: 'Staff records, duty rosters, leave and licences.',
    steps: [
      { title: 'Staff records', text: 'HR & Staff → add staff with role and department. The role decides which screens the person can see.', path: '/hr' },
      { title: 'Rosters and leave', text: 'Plan the duty roster and approve leave requests from the same screen.', path: '/hr' },
      { title: 'Licences', text: 'Keep registration numbers and expiry dates current; expiring licences are flagged.', path: '/hr' },
    ],
  },
  'Transfusion Officer': {
    title: 'Blood bank',
    intro: 'Donors, stock, cross-match and issue.',
    steps: [
      { title: 'Stock', text: 'Blood Bank shows units by group and expiry. Use the oldest suitable unit first.', path: '/blood-bank' },
      { title: 'Cross-match and issue', text: 'Record the cross-match, then issue the unit to the named patient. Transfusion reactions are reported from the same record.', path: '/blood-bank' },
    ],
  },
  'Mortuary Attendant': {
    title: 'Mortuary',
    intro: 'Admissions, storage and release of bodies.',
    steps: [
      { title: 'Admit', text: 'Mortuary → record the deceased, where they came from and the storage chamber.', path: '/morgue' },
      { title: 'Release', text: 'Check the documents and the identity of the person collecting, then record the release.', path: '/morgue' },
    ],
  },
  Admin: {
    title: 'Administrator',
    intro: 'Set up the hospital, users and what each role may do.',
    steps: [
      { title: 'Hospital profile', text: 'Settings → hospital name, logo, receipt details and departments.', path: '/settings' },
      { title: 'Users and roles', text: 'Settings → add users and give each the right role. Change what a role can see under role permissions.', path: '/settings' },
      { title: 'Prices and stock', text: 'Set service prices and load the drug inventory before go-live, or bills and dispensing will be blocked.', path: '/inventory' },
      { title: 'Problem reports', text: 'Reports from Help → Report a problem arrive as IT & Systems tickets. Check that queue daily (add an “IT & Systems” department in Settings if it is not in the menu).', path: '/departments/IT%20%26%20Systems' },
      { title: 'Watch the hospital', text: 'Management dashboards show queues, revenue and turnaround times across departments.', path: '/dashboards' },
    ],
  },
}

export function guideForRole(resolvedRole) {
  const guide = ROLE_GUIDES[resolvedRole] || ROLE_GUIDES.Receptionist
  return { ...guide, role: ROLE_GUIDES[resolvedRole] ? resolvedRole : 'Staff', tips: COMMON_TIPS }
}
