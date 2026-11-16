// Common billable services per department, offered to administrators as one-click additions to the hospital's charge
// codes (Settings → Charge codes). No prices are suggested: each hospital sets its own tariff.
import { canonicalDepartmentName } from '../utils/departmentNames'

const S = (name, category = 'Procedure') => ({ name, category })

export const DEPARTMENT_SERVICES = {
  Dental: [S('Simple tooth extraction'), S('Surgical extraction'), S('Scaling and polishing'), S('Amalgam filling'), S('Composite filling'), S('Root canal treatment (per canal)'), S('Periapical dental X-ray', 'Imaging')],
  'Eye Clinic': [S('Refraction'), S('Tonometry (intraocular pressure)'), S('Dilated fundus examination'), S('Removal of corneal foreign body'), S('Spectacle dispensing', 'Other')],
  ENT: [S('Ear wax removal / syringing'), S('Removal of ear or nose foreign body'), S('Nasal packing'), S('Pure-tone audiometry'), S('Tympanometry')],
  Physiotherapy: [S('Physiotherapy session (30 minutes)'), S('Physiotherapy session (60 minutes)'), S('Therapeutic ultrasound'), S('TENS session'), S('Splint or orthosis fitting')],
  Cardiology: [S('Resting ECG (12-lead)'), S('Echocardiogram', 'Imaging'), S('24-hour Holter monitoring'), S('Exercise stress test'), S('24-hour ambulatory BP monitoring')],
  Neurology: [S('Electroencephalogram (EEG)'), S('Nerve conduction study'), S('Lumbar puncture')],
  Dermatology: [S('Skin biopsy'), S('Cryotherapy'), S('Wart or skin tag removal'), S('Incision and drainage')],
  Orthopaedics: [S('Plaster of Paris (POP) cast application'), S('POP cast removal'), S('Closed fracture reduction'), S('Joint aspiration or injection'), S('Wound dressing')],
  'Obstetrics & Gynaecology': [S('Obstetric ultrasound', 'Imaging'), S('Pap smear'), S('VIA / VILI cervical screening'), S('IUCD insertion'), S('Contraceptive implant insertion'), S('Contraceptive implant removal')],
  Maternity: [S('Normal delivery'), S('Episiotomy / perineal repair'), S('Obstetric ultrasound', 'Imaging'), S('CTG monitoring')],
  Paediatrics: [S('Nebulisation'), S('Growth monitoring and counselling', 'Other'), S('Lumbar puncture')],
  Urology: [S('Urethral catheterisation'), S('Suprapubic catheter change'), S('Uroflowmetry'), S('Bladder scan (post-void residual)', 'Imaging')],
  'Mental Health & Psychiatry': [S('Psychotherapy session'), S('Counselling session'), S('Psychological assessment')],
  'General Medicine': [S('Nebulisation'), S('Wound dressing'), S('IV cannulation'), S('Resting ECG (12-lead)'), S('Capillary blood glucose', 'Lab')],
  Emergency: [S('Wound suturing'), S('Wound dressing'), S('Nebulisation'), S('IV fluid administration'), S('Resuscitation')],
  Oncology: [S('Chemotherapy administration'), S('Bone marrow aspiration'), S('Port flush')],
  'Nutrition & Dietetics': [S('Nutrition assessment', 'Consultation'), S('Diet counselling session', 'Consultation')],
  'Community Health': [S('Home visit', 'Other'), S('Health education session', 'Other')],
}

const PREFIX = {
  Dental: 'DENT', 'Eye Clinic': 'EYE', ENT: 'ENT', Physiotherapy: 'PHYSIO', Cardiology: 'CARDIO', Neurology: 'NEURO', Dermatology: 'DERM', Orthopaedics: 'ORTHO',
  'Obstetrics & Gynaecology': 'OBGYN', Maternity: 'MAT', Paediatrics: 'PAEDS', Urology: 'UROL', 'Mental Health & Psychiatry': 'PSYCH', 'General Medicine': 'GENMED',
  Emergency: 'EMERG', Oncology: 'ONCO', 'Nutrition & Dietetics': 'NUTR', 'Community Health': 'COMM',
}

/** Stable charge code for a suggested service, e.g. PROC-DENT-SIMPLE-TOOTH-EXTRACTION. */
export function serviceCode(department, name) {
  const dept = PREFIX[canonicalDepartmentName(department)] || canonicalDepartmentName(department).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'DEPT'
  const slug = String(name).toUpperCase().replace(/\([^)]*\)/g, '').replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36)
  return `PROC-${dept}-${slug}`
}

export function suggestedServices(department) {
  return DEPARTMENT_SERVICES[canonicalDepartmentName(department)] || []
}
