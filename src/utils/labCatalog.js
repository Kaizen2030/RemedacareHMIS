export const LAB_TEST_CATEGORIES = [
  'Haematology',
  'Biochemistry',
  'Microbiology',
  'Immunology',
  'Urinalysis',
  'Parasitology',
  'Serology',
  'Histology',
  'Radiology',
  'Other',
]

export const LAB_COMMON_TESTS = {
  Haematology: ['Full Blood Count (FBC)', 'Haemoglobin', 'ESR', 'Blood Smear', 'Platelet Count', 'Prothrombin Time (PT)', 'APTT', 'Blood Group & Cross Match'],
  Biochemistry: ['Fasting Blood Sugar', 'Random Blood Sugar', 'HbA1c', 'Urea & Electrolytes', 'Creatinine', 'Liver Function Tests (LFTs)', 'Lipid Profile', 'Uric Acid', 'Thyroid Function (TSH/T4)', 'PSA'],
  Microbiology: [
    'Bacterial Culture & Sensitivity (C&S)',
    'Blood Culture & Sensitivity',
    'Urine Culture & Sensitivity',
    'Sputum Culture & Sensitivity',
    'Wound Swab Culture & Sensitivity',
    'Stool Culture & Sensitivity',
    'CSF Culture & Sensitivity',
    'HVS Culture & Sensitivity',
    'Blood Culture',
    'Urine Culture',
    'Sputum Culture',
    'Wound Swab C&S',
    'Stool Culture',
    'CSF Culture',
    'HVS Culture',
  ],
  Immunology: ['HIV Rapid Test', 'HIV ELISA', 'CD4 Count', 'Viral Load', 'ANA', 'Rheumatoid Factor', 'CRP', 'Widal Test'],
  Urinalysis: ['Urinalysis (Dipstick)', 'Urine Microscopy', 'Urine Protein:Creatinine Ratio', '24hr Urine Protein'],
  Parasitology: ['Malaria RDT', 'Malaria Smear (Thick & Thin)', 'Stool O&P', 'Typhoid Test (Widal)', 'Brucella Test'],
  Serology: ['Hepatitis B (HBsAg)', 'Hepatitis C', 'VDRL/RPR (Syphilis)', 'Toxoplasmosis IgG/IgM', 'CMV IgG/IgM'],
  Histology: ['Biopsy - Tissue', 'FNAC', 'PAP Smear', 'Bone Marrow Biopsy'],
  Radiology: ['X-Ray', 'Ultrasound', 'CT Scan', 'MRI', 'Mammogram', 'Echocardiogram'],
  Other: ['COVID-19 Antigen', 'COVID-19 PCR', 'Pregnancy Test (urine)', 'Dengue NS1', 'Leptospira'],
}

export function getLabTestsForCategory(category) {
  return LAB_COMMON_TESTS[category] || []
}

export function isMicrobiologySensitivityOrder(testType = '', category = '') {
  const name = String(testType || '').toLowerCase()
  const group = String(category || '').toLowerCase()
  if (group === 'microbiology' && (name.includes('c&s') || name.includes('culture') || name.includes('sensitivity') || name.includes('susceptibility'))) {
    return true
  }
  return name.includes('culture & sensitivity') || name.includes('c&s') || name.includes('susceptibility')
}

export function inferMicrobiologySampleType(testType = '') {
  const name = String(testType || '').toLowerCase()
  if (name.includes('urine')) return 'Urine'
  if (name.includes('blood')) return 'Blood'
  if (name.includes('sputum')) return 'Sputum'
  if (name.includes('wound')) return 'Wound Swab'
  if (name.includes('stool')) return 'Stool'
  if (name.includes('csf')) return 'CSF'
  if (name.includes('hvs')) return 'HVS'
  return 'Other'
}

export function deriveMicrobiologyResultSummary({ resultValue = '', resultText = '', interpretation = '' } = {}) {
  const combined = [resultValue, resultText, interpretation].filter(Boolean).join(' ').toLowerCase()
  const noGrowth = combined.includes('no growth')
  const organism = noGrowth ? null : String(resultValue || '').trim() || null
  return {
    organismIdentified: organism,
    growth: noGrowth ? 'No Growth' : null,
  }
}
