// Starter order-set library. NOT usable as-is: a hospital adopts a set into its own list (order_sets), edits it to its
// protocols, and a doctor approves it before it appears in consultations (20261214000000_problem_list_order_sets.sql).
// Contents follow common Kenyan first-line practice (Kenya National Guidelines / KEML); doses are adult unless stated and
// weight-based doses are written per kg — prescribers confirm every dose for the patient in front of them.

export const ORDER_SET_LIBRARY = [
  {
    id: 'malaria-uncomplicated-adult',
    name: 'Uncomplicated malaria (adult)',
    condition: 'Uncomplicated malaria',
    icd10: ['B50.9', 'B54'],
    labs: [{ test_type: 'Malaria RDT', category: 'Parasitology', priority: 'Urgent' }, { test_type: 'Full Blood Count (FBC)', category: 'Haematology', priority: 'Routine' }],
    medications: [
      { drug_name: 'Artemether-lumefantrine 20/120 mg', dosage: '4 tablets', frequency: 'Twice daily (6 doses: 0, 8, 24, 36, 48, 60 h)', duration: '3 days', route: 'Oral', notes: 'Adults and children ≥ 35 kg; take with food or milk' },
      { drug_name: 'Paracetamol 500 mg', dosage: '1 g', frequency: 'Three times daily as needed', duration: '3 days', route: 'Oral', notes: 'Fever / pain' },
    ],
    instructions: 'Confirm parasitological diagnosis before treating. Return at once with danger signs (cannot drink, vomiting everything, confusion, convulsions). First trimester: follow the pregnancy guideline.',
  },
  {
    id: 'malaria-severe',
    name: 'Severe malaria',
    condition: 'Severe malaria',
    icd10: ['B50.0', 'B50.8'],
    labs: [{ test_type: 'Malaria Smear (Thick & Thin)', category: 'Parasitology', priority: 'STAT' }, { test_type: 'Full Blood Count (FBC)', category: 'Haematology', priority: 'STAT' },
      { test_type: 'Random Blood Sugar', category: 'Biochemistry', priority: 'STAT' }, { test_type: 'Urea & Electrolytes', category: 'Biochemistry', priority: 'Urgent' }],
    medications: [{ drug_name: 'Artesunate injection', dosage: '2.4 mg/kg (3 mg/kg if under 20 kg)', frequency: 'At 0, 12 and 24 hours, then once daily', duration: 'Until able to take oral ACT (minimum 24 h)', route: 'IV', notes: 'Then a full 3-day oral ACT course' }],
    instructions: 'Admit. Check glucose and treat hypoglycaemia. Monitor GCS, urine output and haemoglobin. Transfuse if Hb < 5 g/dL (or < 7 with distress).',
  },
  {
    id: 'sepsis-adult',
    name: 'Sepsis (adult) — first hour',
    condition: 'Sepsis',
    icd10: ['A41.9', 'R65.2'],
    labs: [{ test_type: 'Blood Culture & Sensitivity', category: 'Microbiology', priority: 'STAT' }, { test_type: 'Full Blood Count (FBC)', category: 'Haematology', priority: 'STAT' },
      { test_type: 'Urea & Electrolytes', category: 'Biochemistry', priority: 'STAT' }, { test_type: 'Liver Function Tests (LFTs)', category: 'Biochemistry', priority: 'Urgent' },
      { test_type: 'CRP', category: 'Immunology', priority: 'Urgent' }, { test_type: 'Random Blood Sugar', category: 'Biochemistry', priority: 'STAT' }],
    medications: [
      { drug_name: 'Ceftriaxone 1 g injection', dosage: '2 g', frequency: 'Once daily', duration: 'Review at 48–72 h with cultures', route: 'IV', notes: 'Empirical — adjust to the source and your antibiogram' },
      { drug_name: 'Sodium chloride 0.9% 1 L', dosage: '30 mL/kg', frequency: 'Bolus if hypotensive or lactate high', duration: 'Reassess after each 500 mL', route: 'IV', notes: 'Stop if crackles / rising JVP' },
    ],
    instructions: 'Blood cultures BEFORE the first antibiotic dose; antibiotics within 1 hour. Monitor BP, urine output (> 0.5 mL/kg/h) and NEWS2 hourly. Find and control the source.',
  },
  {
    id: 'dka-adult',
    name: 'Diabetic ketoacidosis (adult)',
    condition: 'Diabetic ketoacidosis',
    icd10: ['E10.1', 'E11.1'],
    labs: [{ test_type: 'Random Blood Sugar', category: 'Biochemistry', priority: 'STAT' }, { test_type: 'Urea & Electrolytes', category: 'Biochemistry', priority: 'STAT' },
      { test_type: 'Urinalysis (Dipstick)', category: 'Urinalysis', priority: 'STAT' }, { test_type: 'Full Blood Count (FBC)', category: 'Haematology', priority: 'Urgent' }],
    medications: [
      { drug_name: 'Sodium chloride 0.9% 1 L', dosage: '1 L', frequency: 'Over the first hour, then per fluid protocol', duration: '', route: 'IV', notes: '' },
      { drug_name: 'Soluble (regular) insulin', dosage: '0.1 units/kg/hour', frequency: 'Fixed-rate infusion', duration: 'Until ketones clear and pH normal', route: 'IV', notes: 'Start after potassium is known; add dextrose when glucose < 14 mmol/L' },
      { drug_name: 'Potassium chloride', dosage: 'Per serum potassium', frequency: 'Added to fluids', duration: '', route: 'IV', notes: 'Hold if K > 5.5 or no urine output' },
    ],
    instructions: 'Hourly glucose, 2–4-hourly potassium, strict intake–output. Look for and treat the trigger (infection, missed insulin).',
  },
  {
    id: 'pre-eclampsia-severe',
    name: 'Severe pre-eclampsia / eclampsia',
    condition: 'Pre-eclampsia with severe features',
    icd10: ['O14.1', 'O15'],
    labs: [{ test_type: 'Full Blood Count (FBC)', category: 'Haematology', priority: 'STAT' }, { test_type: 'Liver Function Tests (LFTs)', category: 'Biochemistry', priority: 'STAT' },
      { test_type: 'Urea & Electrolytes', category: 'Biochemistry', priority: 'STAT' }, { test_type: 'Urinalysis (Dipstick)', category: 'Urinalysis', priority: 'STAT' },
      { test_type: 'Blood Group & Cross Match', category: 'Haematology', priority: 'Urgent' }],
    medications: [
      { drug_name: 'Magnesium sulphate 50% injection', dosage: '4 g IV over 15–20 min + 10 g IM (5 g each buttock) loading', frequency: 'Then 5 g IM every 4 hours (or IV maintenance per protocol)', duration: '24 h after delivery or last fit', route: 'IV / IM', notes: 'Check reflexes, RR > 16, urine > 30 mL/h before each dose; calcium gluconate at the bedside' },
      { drug_name: 'Nifedipine 10 mg', dosage: '10 mg', frequency: 'Repeat every 30 min if BP ≥ 160/110', duration: 'Until BP controlled', route: 'Oral', notes: 'Or IV labetalol / hydralazine per protocol' },
    ],
    instructions: 'Senior obstetric review. Plan delivery. Strict fluid balance (avoid overload). Monitor BP every 15 min until stable.',
  },
  {
    id: 'pneumonia-adult-nonsevere',
    name: 'Community-acquired pneumonia (adult, non-severe)',
    condition: 'Pneumonia',
    icd10: ['J18.9'],
    labs: [{ test_type: 'Full Blood Count (FBC)', category: 'Haematology', priority: 'Routine' }, { test_type: 'X-Ray', category: 'Radiology', priority: 'Routine', notes: 'Chest PA' }],
    medications: [{ drug_name: 'Amoxicillin 500 mg', dosage: '1 g', frequency: 'Three times daily', duration: '5 days', route: 'Oral', notes: '' }],
    instructions: 'Admit if CURB-65 ≥ 2, SpO₂ < 92% or unable to take oral medicines. Review in 48 hours.',
  },
  {
    id: 'hypertension-new',
    name: 'New hypertension — work-up and start',
    condition: 'Hypertension',
    icd10: ['I10'],
    labs: [{ test_type: 'Urea & Electrolytes', category: 'Biochemistry', priority: 'Routine' }, { test_type: 'Creatinine', category: 'Biochemistry', priority: 'Routine' },
      { test_type: 'Urinalysis (Dipstick)', category: 'Urinalysis', priority: 'Routine' }, { test_type: 'Lipid Profile', category: 'Biochemistry', priority: 'Routine' },
      { test_type: 'HbA1c', category: 'Biochemistry', priority: 'Routine' }],
    medications: [{ drug_name: 'Amlodipine 5 mg', dosage: '5 mg', frequency: 'Once daily', duration: '30 days', route: 'Oral', notes: 'Or a thiazide-like diuretic per guideline' }],
    instructions: 'Confirm with repeat readings. Lifestyle: salt < 5 g/day, activity, weight, stop smoking. ECG. Review in 2–4 weeks; enrol in the NCD register.',
  },
  {
    id: 'diarrhoea-child-some-dehydration',
    name: 'Acute diarrhoea with some dehydration (child)',
    condition: 'Acute gastroenteritis',
    icd10: ['A09', 'E86'],
    labs: [],
    medications: [
      { drug_name: 'Oral rehydration salts (low osmolarity)', dosage: '75 mL/kg', frequency: 'Over 4 hours (Plan B)', duration: 'Then after each loose stool', route: 'Oral', notes: '' },
      { drug_name: 'Zinc sulphate 20 mg dispersible', dosage: '20 mg (10 mg if under 6 months)', frequency: 'Once daily', duration: '10–14 days', route: 'Oral', notes: '' },
    ],
    instructions: 'Continue breastfeeding and feeding. Reassess after 4 hours. Return if not drinking, blood in stool or worse.',
  },
]

/** Order sets suggested for the diagnosis codes / text in the consultation (approved, active sets only). */
export function suggestOrderSets(sets = [], { codes = [], text = '' } = {}) {
  const cs = codes.filter(Boolean).map((c) => String(c).toUpperCase())
  const t = String(text || '').toLowerCase()
  return sets.filter((s) => s.active).filter((s) => (s.icd10 || []).some((x) => cs.some((c) => c.startsWith(String(x).toUpperCase()) || String(x).toUpperCase().startsWith(c)))
    || (s.condition && t && t.includes(String(s.condition).toLowerCase().split(' ')[0])))
}

/** Rows to add to the consultation when a set is applied. */
export function orderSetRows(set) {
  return {
    rx: (set.medications || []).map((m) => ({ drug_name: m.drug_name || '', dosage: m.dosage || '', frequency: m.frequency || '', duration: m.duration || '', quantity: '', prn: false,
      patient_instructions: [m.route, m.notes].filter(Boolean).join(' · '), aware_classification: '', amr_override_reason: '', cds_acknowledged: false })),
    labs: (set.labs || []).map((l) => ({ test_type: l.test_type, priority: l.priority || 'Routine', notes: l.notes || `Order set: ${set.name}`, category: l.category || 'Other' })),
  }
}
