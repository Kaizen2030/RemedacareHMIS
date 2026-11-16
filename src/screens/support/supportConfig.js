// What each support department works with: request types (with their fields and checklists), registers (assets,
// vehicles, contracts), log books and special panels. Rendered by SupportDesk.jsx; stored in service_requests /
// service_assets / service_logs (20261201000000_support_services.sql).

const req = (label) => ({ label, required: true })
const opt = (label) => ({ label, required: false })

// Housekeeping checklists by area (discharge and terminal cleans come from the database trigger)
export const AREA_CHECKLISTS = {
  'General ward': [req('Bins emptied, liners replaced'), req('Floors swept and mopped'), req('Bed areas, lockers and rails wiped'), req('Hand-wash points cleaned and stocked (soap, towels)'), req('Toilets and showers cleaned'), opt('Windows and ledges dusted')],
  'Isolation room': [req('Correct PPE worn'), req('Chlorine solution freshly prepared (1:10 / approved disinfectant)'), req('All surfaces from clean to dirty, top to bottom'), req('Infectious waste in red bags, sealed'), req('Mop head and cloths changed after the room'), req('Hand hygiene on leaving')],
  'Theatre': [req('Between-case clean: table, lights, surfaces, floor around table'), req('Suction and anaesthesia surfaces wiped'), req('Clinical waste and sharps removed'), req('End-of-day: whole floor, walls to hand height, scrub sinks'), opt('Weekly: ceiling vents and high surfaces')],
  'ICU / HDU': [req('Bed spaces and monitors wiped (approved disinfectant)'), req('High-touch surfaces: rails, pumps, keyboards'), req('Bins and sharps containers checked'), req('Floors mopped'), req('Hand-gel dispensers filled')],
  'Toilets / bathrooms': [req('Toilets, urinals and sinks scrubbed'), req('Floors mopped and dried'), req('Soap, tissue and towels refilled'), req('Bins emptied'), req('Check sheet on the door signed')],
  'OPD / corridors': [req('Floors swept and mopped'), req('Seats and counters wiped'), req('Bins emptied'), opt('Glass and doors cleaned')],
  'Kitchen': [req('Work surfaces cleaned and sanitised'), req('Floors and drains cleaned'), req('Fridges wiped, out-of-date food removed'), req('Utensils washed and stored dry'), req('Waste removed')],
}

const PRIORITY = ['emergency', 'urgent', 'routine', 'low']

export const SUPPORT_DEPARTMENTS = {
  'Housekeeping': {
    code: 'housekeeping', title: 'Housekeeping',
    intro: 'Cleaning jobs with checklists, discharge and terminal cleans created automatically from Wards, spills, deep cleans and supplies.',
    kinds: {
      routine_clean: { label: 'Routine clean', priority: 'routine', fields: [{ key: 'area_type', label: 'Area type', type: 'select', options: Object.keys(AREA_CHECKLISTS), required: true }], checklistFrom: (d) => AREA_CHECKLISTS[d.area_type] || [] },
      discharge_clean: { label: 'Discharge clean', priority: 'urgent', fields: [], checklistFrom: () => [req('Remove used linen and waste'), req('Wipe bed frame, mattress and rails'), req('Wipe locker, table and call bell'), req('Floor around bed cleaned'), req('Bed made with clean linen')] },
      terminal_clean: { label: 'Terminal (infection) clean', priority: 'urgent', fields: [{ key: 'organism', label: 'Infection / reason', type: 'text' }], checklistFrom: () => AREA_CHECKLISTS['Isolation room'] },
      spill: { label: 'Spill / urgent clean', priority: 'urgent', fields: [{ key: 'spill_type', label: 'What was spilled', type: 'select', options: ['Blood / body fluid', 'Vomit / faeces', 'Chemical', 'Water', 'Other'], required: true }], checklistFrom: (d) => (/blood|vomit/i.test(d.spill_type || '') ? [req('Gloves and apron on'), req('Absorb with spill kit / granules'), req('Disinfect area (chlorine 1:10)'), req('Waste in red bag'), req('Area dried, wet-floor sign removed')] : [req('Area made safe (wet-floor sign)'), req('Cleaned and dried')]) },
      deep_clean: { label: 'Deep clean', priority: 'low', fields: [{ key: 'area_type', label: 'Area type', type: 'select', options: Object.keys(AREA_CHECKLISTS), required: true }], checklistFrom: (d) => [...(AREA_CHECKLISTS[d.area_type] || []), req('High surfaces, vents and behind furniture'), req('Curtains changed')] },
      supplies: { label: 'Supplies request', priority: 'routine', fields: [{ key: 'items', label: 'Items and quantities', type: 'textarea', required: true, placeholder: 'e.g. Chlorine 5 L × 2, red bin liners × 1 roll, gloves M × 2 boxes' }] },
    },
    tabs: ['board', 'report'],
    settings: ['hold_beds_for_cleaning'],
  },

  'Kitchen / Catering': {
    code: 'kitchen', title: 'Kitchen / Catering',
    intro: 'Diet orders from the wards turned into a production plan, meal rounds with uneaten-meal records, food-safety temperature logs and staff fitness checks.',
    kinds: {
      special_meal: { label: 'Special meal request', priority: 'urgent', fields: [{ key: 'patient', label: 'Patient', type: 'patient' }, { key: 'diet', label: 'Diet / texture', type: 'select', options: ['Normal', 'Soft', 'Liquid', 'Diabetic', 'Renal', 'Low salt', 'High protein', 'Gluten free', 'Nil by mouth', 'Other'], required: true }, { key: 'allergies', label: 'Allergies', type: 'text' }] },
      kitchen_clean: { label: 'Kitchen hygiene check', priority: 'routine', fields: [], checklistFrom: () => AREA_CHECKLISTS.Kitchen },
      supplies: { label: 'Food / supplies order', priority: 'routine', fields: [{ key: 'items', label: 'Items and quantities', type: 'textarea', required: true }] },
      equipment: { label: 'Equipment fault', priority: 'urgent', fields: [{ key: 'equipment', label: 'Equipment', type: 'text', required: true }] },
    },
    logs: {
      temperature: { label: 'Temperatures', subject: { label: 'Fridge / freezer / hot food', type: 'select', options: ['Fridge 1', 'Fridge 2', 'Freezer', 'Hot holding', 'Cooked food (core)', 'Delivery check'] }, value: { label: 'Temperature', unit: '°C' }, alert: (e) => tempAlert(e.subject, Number(e.value)) },
      meal_round: { label: 'Meal rounds', subject: { label: 'Meal', type: 'select', options: ['Breakfast', 'Lunch', 'Supper', 'Snack'] }, fields: [{ key: 'ward', label: 'Ward', type: 'text', required: true }, { key: 'sent', label: 'Meals sent', type: 'number', required: true }, { key: 'uneaten', label: 'Returned uneaten', type: 'number' }, { key: 'received_by', label: 'Received by (ward)', type: 'text' }] },
      staff_health: { label: 'Food handler fitness', subject: { label: 'Staff name', type: 'text' }, fields: [{ key: 'fit', label: 'Fit to handle food today', type: 'select', options: ['Yes', 'No - sent home'], required: true }, { key: 'symptoms', label: 'Diarrhoea, vomiting, fever, skin infection?', type: 'text' }] },
    },
    tabs: ['production', 'board', 'log:temperature', 'log:meal_round', 'log:staff_health', 'report'],
  },

  'Maintenance & Engineering': {
    code: 'maintenance', title: 'Maintenance & Engineering',
    intro: 'Job cards for buildings, utilities and equipment, an asset register with preventive maintenance (PPM) due dates, and generator, power and water logs.',
    kinds: {
      job: { label: 'Job card', priority: 'routine', fields: [{ key: 'category', label: 'Category', type: 'select', options: ['Electrical', 'Plumbing', 'Civil / building', 'HVAC / ventilation', 'Medical gas', 'Biomedical equipment', 'Carpentry', 'General'], required: true }, { key: 'asset', label: 'Asset (if any)', type: 'asset' }, { key: 'photo_url', label: 'Photo link (optional)', type: 'text' }], completeFields: [{ key: 'materials', label: 'Materials used', type: 'text' }, { key: 'hours', label: 'Hours worked', type: 'number' }, { key: 'cost', label: 'Cost (KES)', type: 'number' }] },
      ppm: { label: 'Preventive maintenance', priority: 'routine', fields: [{ key: 'asset', label: 'Asset', type: 'asset', required: true }], checklistFrom: () => [req('Visual inspection'), req('Function test'), req('Safety / electrical check'), opt('Calibration'), req('Label updated with date')] },
    },
    assets: { kinds: { equipment: 'Medical equipment', biomedical: 'Biomedical (calibrated)', facility: 'Facility / building', generator: 'Generator / power', water: 'Water / pumps' }, ppm: true, statuses: ['working', 'repair', 'out_of_service', 'retired'] },
    logs: {
      generator: { label: 'Generator', subject: { label: 'Generator', type: 'text' }, fields: [{ key: 'hours_run', label: 'Hours run', type: 'number', required: true }, { key: 'fuel_litres', label: 'Fuel added (L)', type: 'number' }, { key: 'reading', label: 'Hour-meter reading', type: 'number' }] },
      outage: { label: 'Power outages', subject: { label: 'Area affected', type: 'text' }, fields: [{ key: 'cause', label: 'Cause', type: 'select', options: ['KPLC supply', 'Internal fault', 'Planned', 'Unknown'] }, { key: 'backup', label: 'Generator took over?', type: 'select', options: ['Yes', 'No', 'Partly'] }], closable: 'Power restored' },
      water: { label: 'Water', subject: { label: 'Tank / supply', type: 'text' }, value: { label: 'Level', unit: '%' }, fields: [{ key: 'note', label: 'Note', type: 'text' }] },
    },
    tabs: ['board', 'assets', 'log:generator', 'log:outage', 'log:water', 'report'],
  },

  'Transport': {
    code: 'transport', title: 'Transport',
    intro: 'Internal patient moves and external transfers with equipment and urgency, the vehicle board, and trip logs with mileage and fuel.',
    kinds: {
      internal: { label: 'Internal patient move', priority: 'urgent', fields: [{ key: 'patient', label: 'Patient', type: 'patient' }, { key: 'from', label: 'From', type: 'text', required: true }, { key: 'to', label: 'To', type: 'text', required: true }, { key: 'equipment', label: 'Needs', type: 'select', options: ['Wheelchair', 'Stretcher / trolley', 'Oxygen', 'Monitor', 'Incubator', 'Escort nurse'] }] },
      external: { label: 'External transfer / ambulance', priority: 'urgent', fields: [{ key: 'patient', label: 'Patient', type: 'patient' }, { key: 'to', label: 'Destination', type: 'text', required: true }, { key: 'reason', label: 'Type', type: 'select', options: ['Referral', 'Emergency pick-up', 'Discharge home', 'Inter-facility return'], required: true }, { key: 'condition', label: 'Clinical condition / needs', type: 'textarea' }, { key: 'vehicle', label: 'Vehicle', type: 'asset' }], completeFields: [{ key: 'crew', label: 'Crew', type: 'text' }, { key: 'handover', label: 'Handed over to / note', type: 'text' }] },
      goods: { label: 'Goods / staff trip', priority: 'routine', fields: [{ key: 'to', label: 'Destination', type: 'text', required: true }, { key: 'purpose', label: 'Purpose', type: 'text', required: true }] },
    },
    assets: { kinds: { vehicle: 'Vehicle' }, statuses: ['available', 'on_trip', 'repair', 'out_of_service', 'retired'], fields: [{ key: 'type', label: 'Type', type: 'select', options: ['Ambulance', 'Utility', 'Staff bus', 'Motorbike', 'Other'] }, { key: 'driver', label: 'Usual driver', type: 'text' }] },
    logs: {
      trip: { label: 'Trip log', subject: { label: 'Vehicle', type: 'asset' }, fields: [{ key: 'driver', label: 'Driver', type: 'text', required: true }, { key: 'purpose', label: 'Purpose / patient', type: 'text', required: true }, { key: 'start_km', label: 'Odometer at start', type: 'number', required: true }, { key: 'fuel_litres', label: 'Fuel (L)', type: 'number' }], closable: 'Trip ended', closeFields: [{ key: 'end_km', label: 'Odometer at end', type: 'number', required: true }] },
    },
    tabs: ['board', 'assets', 'log:trip', 'report'],
  },

  'Security': {
    code: 'security', title: 'Security',
    intro: 'Incident reports, the visitor register (in / out), patrols and shift handovers.',
    kinds: {
      incident: { label: 'Incident', priority: 'urgent', fields: [{ key: 'type', label: 'Type', type: 'select', options: ['Theft', 'Assault / violence', 'Verbal abuse', 'Trespass', 'Fire / smoke', 'Suspicious activity', 'Vandalism', 'Lost property', 'Other'], required: true }, { key: 'people', label: 'People involved', type: 'textarea' }, { key: 'police_ob', label: 'Police OB number (if reported)', type: 'text' }], completeFields: [{ key: 'action', label: 'Action taken', type: 'textarea' }] },
      lost_property: { label: 'Lost / found property', priority: 'low', fields: [{ key: 'item', label: 'Item', type: 'text', required: true }, { key: 'found_where', label: 'Found / lost where', type: 'text' }, { key: 'owner', label: 'Owner (if known)', type: 'text' }] },
    },
    logs: {
      visitor: { label: 'Visitors', subject: { label: 'Visitor name', type: 'text' }, fields: [{ key: 'id_no', label: 'ID number', type: 'text' }, { key: 'phone', label: 'Phone', type: 'text' }, { key: 'visiting', label: 'Visiting (patient / ward / office)', type: 'text', required: true }, { key: 'pass_no', label: 'Pass number', type: 'text' }], closable: 'Signed out' },
      patrol: { label: 'Patrols', subject: { label: 'Route / checkpoint', type: 'text' }, fields: [{ key: 'guard', label: 'Guard', type: 'text', required: true }, { key: 'findings', label: 'Findings', type: 'textarea' }] },
      handover: { label: 'Shift handover', subject: { label: 'Shift', type: 'select', options: ['Day', 'Night'] }, fields: [{ key: 'on_duty', label: 'Guards on duty', type: 'text', required: true }, { key: 'notes', label: 'Handover notes', type: 'textarea', required: true }] },
    },
    tabs: ['board', 'log:visitor', 'log:patrol', 'log:handover', 'report'],
  },

  'Medical Records': {
    code: 'records', title: 'Medical Records',
    intro: 'File requests and movements, release of information with authorisation, incomplete-record (deficiency) follow-up and an ICD-10 coding workspace.',
    kinds: {
      file_request: { label: 'File request', priority: 'routine', fields: [{ key: 'patient', label: 'Patient', type: 'patient', required: true }, { key: 'deliver_to', label: 'Deliver to', type: 'text', required: true }] },
      roi: { label: 'Release of information', priority: 'routine', fields: [{ key: 'patient', label: 'Patient', type: 'patient', required: true }, { key: 'requester', label: 'Requested by', type: 'select', options: ['Patient', 'Next of kin', 'Insurer / SHA', 'Lawyer / court', 'Police', 'Another facility', 'Employer'], required: true }, { key: 'purpose', label: 'Purpose', type: 'text', required: true }], checklistFrom: () => [req("Requester's identity verified"), req('Patient consent or legal authority on file'), req('Only the records needed are released'), req('Copy of what was released kept')], completeFields: [{ key: 'released', label: 'What was released', type: 'textarea' }] },
      deficiency: { label: 'Incomplete record', priority: 'routine', fields: [{ key: 'patient', label: 'Patient', type: 'patient', required: true }, { key: 'missing', label: 'Missing', type: 'select', options: ['Discharge summary', 'Unsigned notes', 'Consent form', 'Operation note', 'Death certificate', 'Diagnosis / code', 'Other'], required: true }, { key: 'clinician', label: 'Responsible clinician', type: 'text', required: true }] },
    },
    logs: {
      file_movement: { label: 'File movements', subject: { label: 'File / patient number', type: 'text' }, fields: [{ key: 'to', label: 'Sent to', type: 'text', required: true }, { key: 'by', label: 'Taken by', type: 'text', required: true }], closable: 'Returned' },
    },
    tabs: ['board', 'coding', 'log:file_movement', 'report'],
  },

  'IT & Systems': {
    code: 'it', title: 'IT & Systems',
    intro: 'Support tickets, user access requests (linked to HR), the IT asset register and a live status board for key systems.',
    kinds: {
      ticket: { label: 'Support ticket', priority: 'routine', fields: [{ key: 'category', label: 'Category', type: 'select', options: ['Hardware', 'Software', 'Network / internet', 'Printer', 'HMIS (RemedacareHMS)', 'Email', 'Phone', 'Other'], required: true }, { key: 'asset', label: 'Device', type: 'asset' }] },
      access: { label: 'User access request', priority: 'routine', fields: [{ key: 'person', label: 'Staff member', type: 'text', required: true }, { key: 'change', label: 'Request', type: 'select', options: ['New user', 'Role change', 'Password reset', 'Remove access (left)'], required: true }, { key: 'role', label: 'Role', type: 'text' }], checklistFrom: () => [req('Approved by head of department'), req('Matches HR record'), req('Account created / changed / removed'), opt('User told how to sign in')] },
    },
    assets: { kinds: { computer: 'Computer', printer: 'Printer', network: 'Network device', scanner: 'Barcode / scanner', phone: 'Phone / tablet', ups: 'UPS' }, statuses: ['working', 'repair', 'out_of_service', 'retired'], fields: [{ key: 'serial', label: 'Serial', type: 'text' }, { key: 'warranty', label: 'Warranty until', type: 'date' }] },
    systems: ['RemedacareHMS', 'Internet', 'Local network', 'Printers', 'Phones / PABX', 'Power backup (UPS)', 'Email'],
    tabs: ['status', 'board', 'assets', 'report'],
  },

  'Administration': {
    code: 'admin', title: 'Administration',
    intro: 'The executive dashboard, patient complaints with investigation, management meeting actions, and the register of contracts, licences and policies with expiry alerts.',
    kinds: {
      complaint: { label: 'Complaint / compliment', priority: 'routine', fields: [{ key: 'from_name', label: 'From', type: 'text', required: true }, { key: 'contact', label: 'Phone / email', type: 'text' }, { key: 'patient', label: 'Patient (if any)', type: 'patient' }, { key: 'category', label: 'About', type: 'select', options: ['Waiting time', 'Staff attitude', 'Clinical care', 'Billing', 'Cleanliness', 'Food', 'Compliment', 'Other'], required: true }], completeFields: [{ key: 'findings', label: 'Investigation findings', type: 'textarea' }, { key: 'feedback', label: 'Feedback given to complainant', type: 'text' }] },
      action: { label: 'Meeting action', priority: 'routine', fields: [{ key: 'meeting', label: 'Meeting', type: 'text', required: true }, { key: 'owner', label: 'Owner', type: 'text', required: true }, { key: 'due', label: 'Due date', type: 'date', required: true }] },
    },
    assets: { kinds: { contract: 'Contract', licence: 'Licence / certificate', policy: 'Policy / SOP' }, statuses: ['active', 'expired', 'retired'], expiry: true, fields: [{ key: 'party', label: 'Other party / issuer', type: 'text' }, { key: 'version', label: 'Version', type: 'text' }, { key: 'link', label: 'Document link', type: 'text' }] },
    tabs: ['kpis', 'board', 'assets', 'report'],
    adminOnly: true,
  },
}

export const PRIORITIES = PRIORITY
export const STATUS_LABEL = { open: 'Open', assigned: 'Assigned', in_progress: 'In progress', on_hold: 'On hold', done: 'Done', verified: 'Verified', cancelled: 'Cancelled' }
export const OPEN_STATUSES = ['open', 'assigned', 'in_progress', 'on_hold']

/** Food-safety limits: fridge 0–8 °C, freezer ≤ −15 °C, hot holding / cooked food ≥ 63 °C. */
export function tempAlert(subject, value) {
  if (!Number.isFinite(value)) return ''
  const s = String(subject || '').toLowerCase()
  if (s.includes('freezer') && value > -15) return 'Freezer too warm (should be −15 °C or colder)'
  if (s.includes('fridge') && (value > 8 || value < 0)) return 'Fridge out of range (0–8 °C)'
  if (s.includes('delivery') && value > 8) return 'Chilled delivery too warm (over 8 °C) — reject'
  if ((s.includes('hot') || s.includes('cooked')) && value < 63) return 'Below 63 °C — reheat to 75 °C or discard'
  return ''
}

/** Build the checklist for a new request. */
export function checklistFor(dept, kind, details = {}) {
  const k = dept?.kinds?.[kind]
  return (k?.checklistFrom ? k.checklistFrom(details) : []).map((i) => ({ label: i.label, required: Boolean(i.required), done: false }))
}

/** Next PPM date (same rule as service_next_ppm in the database). */
export function nextPpm(asset) {
  if (!asset?.ppm_every_days) return null
  const base = asset.last_ppm_on ? new Date(asset.last_ppm_on) : new Date(asset.created_at || Date.now())
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + Number(asset.ppm_every_days)))
  return d.toISOString().slice(0, 10)
}

/** Counts for the report tab: open, overdue, done in 30 days, average hours to complete, by type. */
export function summarise(requests, now = new Date()) {
  const since = now.getTime() - 30 * 86400000
  const open = requests.filter((r) => OPEN_STATUSES.includes(r.status))
  const done = requests.filter((r) => ['done', 'verified'].includes(r.status) && r.completed_at && new Date(r.completed_at).getTime() >= since)
  const hours = done.map((r) => (new Date(r.completed_at) - new Date(r.created_at)) / 3600000).filter((h) => h >= 0)
  const late = done.filter((r) => r.due_at && new Date(r.completed_at) > new Date(r.due_at)).length
  const byKind = {}
  for (const r of requests) {
    const k = (byKind[r.kind] ||= { open: 0, done: 0 })
    if (OPEN_STATUSES.includes(r.status)) k.open += 1
    else if (['done', 'verified'].includes(r.status)) k.done += 1
  }
  return {
    open: open.length,
    overdue: open.filter((r) => r.due_at && new Date(r.due_at) < now).length,
    done30: done.length,
    avgHours: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
    onTimePct: done.length ? Math.round(((done.length - late) / done.length) * 100) : null,
    unverified: requests.filter((r) => r.status === 'done').length,
    byKind,
  }
}
