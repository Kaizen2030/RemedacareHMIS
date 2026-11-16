// Fictional rows for UI previews (same isolates as tools/test-data/vitek2-compact-sample-report.pdf).
const row = (id, patient_name, organism_identified, sample_type, collection_date, ward_department, flags, sir, extra = {}) => ({
  id, hospital_id: 'preview', patient_name, organism_identified, sample_type, collection_date, ward_department, growth: 'Heavy', ...flags, ...sir, ...extra,
})

const today = new Date().toISOString()
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString()

export const PREVIEW_DB = {
  staff: [
    { id: 's1', full_name: 'Dr A. Otieno', department: 'General Medicine', role_category: 'Doctor', job_title: 'Consultant Physician', status: 'Active', current_shift: 'Day', phone: '0700 000 001' },
    { id: 's2', full_name: 'Dr B. Wanjiru', department: 'General Medicine', role_category: 'Doctor', job_title: 'Medical Officer', status: 'Active', current_shift: 'Day', phone: '0700 000 002' },
    { id: 's3', full_name: 'C. Mutua', department: 'General Medicine', role_category: 'Nurse', job_title: 'Nursing Officer', status: 'On Leave', current_shift: '—', phone: '0700 000 003' },
  ],
  visits: [
    { id: 'v1', patient_id: 'p8', visit_id: 'VIS-1001', visit_number: 'VIS-1001', status: 'Doctor', speciality: 'General Medicine', patients: { full_name: 'TEST PATIENT 08', age: 46, gender: 'Female' }, chief_complaint: 'Fever and cough for 5 days', assigned_doctor_name: 'Dr A. Otieno', created_at: today },
    { id: 'v2', patient_id: 'p9', visit_id: 'VIS-1002', visit_number: 'VIS-1002', status: 'Lab', speciality: 'General Medicine', patients: { full_name: 'TEST PATIENT 09', age: 63, gender: 'Male' }, chief_complaint: 'Headache, BP 182/110', assigned_doctor_name: 'Dr B. Wanjiru', created_at: today },
  ],
  admissions: [
    { id: 'ad1', patient_id: 'p8', status: 'Active', admitting_department: 'General Medicine', ward: 'Medical Ward', bed_no: 'M-04', admission_date: daysAgo(6), admitting_doctor: 'Dr A. Otieno', target_discharge_date: daysAgo(1).slice(0, 10), admission_type: 'Emergency' },
    { id: 'ad2', patient_id: 'p9', status: 'Active', admitting_department: 'General Medicine', ward: 'Medical Ward', bed_no: 'M-11', admission_date: daysAgo(2), admitting_doctor: 'Dr B. Wanjiru', target_discharge_date: daysAgo(-3).slice(0, 10), resuscitation_status: 'DNACPR', isolation_required: true, admission_type: 'Elective' },
  ],
  patients: [{ id: 'p8', full_name: 'TEST PATIENT 08', patient_number: 'P-0008', age: 46, gender: 'Female' }, { id: 'p9', full_name: 'TEST PATIENT 09', patient_number: 'P-0009', age: 63, gender: 'Male' }],
  charge_codes: [
    { id: 'cc1', code: 'CONS-GENMED', name: 'General medicine consultation', department: 'General Medicine', category: 'Consultation', unit_price_kes: 1500, is_active: true },
    { id: 'cc2', code: 'PROC-GENMED-NEBULISATION', name: 'Nebulisation', department: 'General Medicine', category: 'Procedure', unit_price_kes: 500, is_active: true },
    { id: 'cc3', code: 'PROC-GENMED-WOUND-DRESSING', name: 'Wound dressing', department: 'General Medicine', category: 'Procedure', unit_price_kes: 800, is_active: true },
  ],
  lab_tests: [
    { id: 'l1', visit_id: 'v1', test_type: 'Full blood count', status: 'Complete', resulted_at: today, result_text: 'WBC 16.2, Hb 11.8, platelets 310' },
    { id: 'l2', visit_id: 'v1', test_type: 'Malaria RDT', status: 'Complete', resulted_at: today, result_text: 'Negative' },
    { id: 'l3', visit_id: 'v2', test_type: 'Urea & electrolytes', status: 'Pending' },
  ],
  radiology_orders: [{ id: 'i1', visit_id: 'v1', modality: 'X-ray', body_region: 'Chest', status: 'Reported', reported_at: today, impression: 'Right lower lobe consolidation' }],
  prescriptions: [{ id: 'p1', visit_id: 'v2', drug_name: 'Amlodipine', dosage: '10 mg', frequency: 'OD', status: 'Pending' }],
  lab_critical_alerts: [{ id: 'a1', patient_id: 'p9', status: 'open', message: 'Potassium 6.4 mmol/L is critically high' }],
  referrals: [
    { id: 'r1', visit_id: 'v7', patient_name: 'TEST PATIENT 13', referring_department: 'Emergency', referring_doctor: 'Dr E. Kiprop', receiving_department: 'General Medicine', referral_reason: 'Community-acquired pneumonia, CURB-65 of 2 — admit under medicine', urgency: 'Urgent', status: 'Sent', status_notes: [], created_at: today },
    { id: 'r2', visit_id: 'v6', patient_name: 'TEST PATIENT 14', referring_department: 'General Medicine', referring_doctor: 'Dr A. Otieno', receiving_department: 'Cardiology', referral_reason: 'New atrial fibrillation', urgency: 'Routine', status: 'Received', status_notes: [], created_at: daysAgo(1) },
    { id: 'r3', visit_id: 'v5', patient_name: 'TEST PATIENT 15', referring_department: 'General Medicine', referring_doctor: 'Dr B. Wanjiru', receiving_department: 'Neurology', referral_reason: 'Recurrent seizures', urgency: 'Routine', status: 'Declined', declined_reason: 'Manage in medicine; neurology clinic booked for Monday', status_notes: [], created_at: daysAgo(3) },
  ],
  consultations: [
    { id: 'c1', speciality: 'General Medicine', patient_name: 'TEST PATIENT 10', doctor_name: 'Dr A. Otieno', disposition: 'Completed', created_at: today },
    { id: 'c2', speciality: 'General Medicine', patient_name: 'TEST PATIENT 11', doctor_name: 'Dr B. Wanjiru', disposition: 'Admitted', created_at: daysAgo(2) },
    { id: 'c3', speciality: 'General Medicine', patient_name: 'TEST PATIENT 12', doctor_name: 'Dr A. Otieno', disposition: 'Referred', refer_to: 'Cardiology', created_at: daysAgo(9) },
  ],
  microbiology_results: [
    row('m1', 'TEST PATIENT 01', 'Escherichia coli', 'Urine', '2026-11-10', 'Medical Ward 2', { esbl: true },
      { ampicillin: 'R', amox_clav: 'R', piperacillin_tazo: 'R', cefuroxime: 'R', ceftriaxone: 'R', ceftazidime: 'R', cefepime: 'R', meropenem: 'S', amikacin: 'S', gentamicin: 'R', ciprofloxacin: 'R', cotrimoxazole: 'R', nitrofurantoin: 'S' },
      { gram_stain: 'Gram-negative rods', colony_count: '>10^5 CFU/ml' }),
    row('m2', 'TEST PATIENT 02', 'Klebsiella pneumoniae', 'Blood', '2026-11-10', 'ICU', { esbl: true, carbapenem_r: true },
      { ampicillin: 'R', amox_clav: 'R', piperacillin_tazo: 'R', ceftriaxone: 'R', ceftazidime: 'R', cefepime: 'R', imipenem: 'R', meropenem: 'R', amikacin: 'R', gentamicin: 'R', ciprofloxacin: 'R', cotrimoxazole: 'R' }),
    row('m3', 'TEST PATIENT 03', 'Staphylococcus aureus', 'Wound Swab', '2026-11-11', 'Surgical Ward', { mrsa: true },
      { gentamicin: 'S', ciprofloxacin: 'R', erythromycin: 'R', clindamycin: 'S', linezolid: 'S', vancomycin: 'S', tetracycline: 'S', cotrimoxazole: 'S' }),
    row('m4', 'TEST PATIENT 04', 'Pseudomonas aeruginosa', 'Sputum', '2026-11-11', 'ICU', {},
      { piperacillin_tazo: 'I', ceftazidime: 'I', cefepime: 'I', imipenem: 'I', meropenem: 'I', amikacin: 'S', ciprofloxacin: 'I', levofloxacin: 'I' }),
    row('m5', 'TEST PATIENT 05', 'Klebsiella pneumoniae', 'Urine', '2026-11-12', 'OPD', {},
      { ampicillin: 'R', amox_clav: 'S', piperacillin_tazo: 'S', ceftriaxone: 'S', ceftazidime: 'S', cefepime: 'S', meropenem: 'S', amikacin: 'S', gentamicin: 'S', ciprofloxacin: 'S', cotrimoxazole: 'S' }),
    row('m6', 'TEST PATIENT 06', 'Acinetobacter baumannii complex', 'Blood', '2026-11-12', 'ICU', { carbapenem_r: true },
      { imipenem: 'R', meropenem: 'R', amikacin: 'R', gentamicin: 'R', ciprofloxacin: 'R', levofloxacin: 'R', cotrimoxazole: 'R' }),
    row('m7', 'TEST PATIENT 07', 'Enterococcus faecalis', 'Urine', '2026-11-13', 'Maternity', {},
      { ampicillin: 'S', vancomycin: 'S', linezolid: 'S', nitrofurantoin: 'S' }),
  ],
}

// ?big=1 → a large department (45 staff on today's roster) to check that lists stay manageable
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('big')) {
  const day = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString() }
  const names = ['Achieng', 'Barasa', 'Chepkoech', 'Dida', 'Ekai', 'Fundi', 'Gathoni', 'Hassan', 'Imani', 'Jeptoo', 'Kamau', 'Lokwang', 'Mwangi', 'Njeri', 'Odhiambo']
  const big = Array.from({ length: 45 }, (_, i) => ({ id: `bs${i}`, full_name: `${names[i % 15]} ${i + 1} (test)`, department: 'General Medicine', job_title: i < 5 ? 'Medical Officer' : i < 8 ? 'Clinical Officer' : 'Nursing Officer', status: 'Active', current_shift: i % 3 ? 'Day' : 'Night' }))
  PREVIEW_DB.staff = big
  PREVIEW_DB.hr_shift_types = [{ code: 'D', label: 'Day 07:00–19:00', hours: 12, counts_as_work: true }, { code: 'N', label: 'Night 19:00–07:00', hours: 12, counts_as_work: true }]
  PREVIEW_DB.staff_leave = [
    { id: 'lv1', staff_id: 'bs9', leave_type: 'Annual', start_date: '2026-12-01', end_date: '2026-12-12', days: 10, status: 'requested', reason: 'Family travel' },
    { id: 'lv2', staff_id: 'bs14', leave_type: 'Study', start_date: '2026-11-24', end_date: '2026-11-28', days: 5, status: 'requested', reason: 'KMTC examinations' },
    { id: 'lv3', staff_id: 'bs20', leave_type: 'Maternity', start_date: '2026-10-01', end_date: '2026-12-31', days: 90, status: 'approved' },
  ]
  PREVIEW_DB.department_documents = [
    { id: 'pd1', department: 'General Medicine', title: 'Sepsis: first hour on the ward', kind: 'protocol', version_label: 'v2 2026', revision: 3, must_read: true, status: 'active', summary: 'Recognition, cultures before antibiotics, fluids and escalation for adults.', body: '1. Screen with qSOFA at every observation round.\n2. Take blood cultures before the first antibiotic dose.\n3. Give the first antibiotic dose within one hour.\n4. Escalate to the medical officer on call if systolic BP stays below 90 mmHg after 30 ml/kg.', review_on: '2027-06-30', effective_on: '2026-07-01' },
    { id: 'pd2', department: 'General Medicine', title: 'Handover at shift change (SBAR)', kind: 'sop', version_label: 'v1', revision: 1, must_read: true, status: 'active', summary: 'Bedside handover for every patient using SBAR.', body: 'Situation, Background, Assessment, Recommendation.', review_on: '2026-09-30' },
    { id: 'pd3', department: 'General Medicine', title: 'Visiting hours and visitor rules', kind: 'rules', revision: 1, must_read: false, status: 'active', summary: 'Two visitors per bed; 12:30-14:00 and 17:00-19:00.', body: 'Two visitors per bed at a time.' },
  ]
  PREVIEW_DB.department_document_reads = [{ document_id: 'pd1', revision: 3, staff_id: 'bs1', read_at: '2026-11-10T08:00:00Z' }, { document_id: 'pd1', revision: 3, staff_id: 'bs2', read_at: '2026-11-11T08:00:00Z' }, { document_id: 'pd2', revision: 1, staff_id: 'bs9', read_at: '2026-11-12T08:00:00Z' }]
  PREVIEW_DB.department_managers = [{ id: 'dm1', department: 'General Medicine', staff_id: 'bs5', can_roster: true, can_approve_leave: true }]
  PREVIEW_DB.staff_shifts = big.slice(0, 38).map((s, i) => ({ id: `sh${i}`, staff_id: s.id, shift_date: day(12).slice(0, 10), shift_code: i % 4 ? 'D' : 'N', unit: 'General Medicine', starts_at: i % 4 ? day(0) : day(19), ends_at: i % 4 ? day(23) : new Date(Date.now() + 86400000).toISOString() }))
}
