// Structured radiology report templates. Each field is a short structured answer; buildReport() turns them into
// the readable report text (saved in report_text) while the answers are kept in radiology_orders.structured.

export const MODALITIES = ['X-Ray', 'Ultrasound', 'CT', 'MRI', 'Fluoroscopy', 'Mammography', 'ECG / Echo', 'Other']

export const TEMPLATES = {
  chest_xray: {
    label: 'Chest X-ray', match: (m, r) => /x-?ray/i.test(m) && /chest|thorax|cxr/i.test(r || ''),
    fields: [
      { key: 'projection', label: 'Projection', options: ['PA', 'AP', 'AP supine', 'Lateral'] },
      { key: 'lungs', label: 'Lungs and airways', placeholder: 'Clear / consolidation / cavitation / nodules…' },
      { key: 'pleura', label: 'Pleura', placeholder: 'No effusion or pneumothorax' },
      { key: 'heart', label: 'Heart size', options: ['Normal (CTR < 0.5)', 'Enlarged', 'Not assessable (AP film)'] },
      { key: 'mediastinum', label: 'Mediastinum and hila' },
      { key: 'bones', label: 'Bones and soft tissues' },
      { key: 'lines', label: 'Lines / tubes' },
    ],
  },
  obstetric_us: {
    label: 'Obstetric ultrasound', match: (m, r) => /ultra|sound|us\b/i.test(m) && /obst|pregn|fet|dating|anomaly/i.test(r || ''),
    fields: [
      { key: 'fetuses', label: 'Number of fetuses', options: ['Single', 'Twins', 'Triplets or more'] },
      { key: 'cardiac', label: 'Fetal cardiac activity', options: ['Present', 'Absent'] },
      { key: 'fhr', label: 'Fetal heart rate (bpm)', type: 'number' },
      { key: 'presentation', label: 'Presentation', options: ['Cephalic', 'Breech', 'Transverse', 'Variable / early pregnancy'] },
      { key: 'placenta', label: 'Placenta', placeholder: 'Fundal / anterior / posterior; clear of os / low-lying / praevia' },
      { key: 'liquor', label: 'Liquor (AFI cm or deepest pool)' },
      { key: 'bpd', label: 'BPD (mm)', type: 'number' }, { key: 'hc', label: 'HC (mm)', type: 'number' },
      { key: 'ac', label: 'AC (mm)', type: 'number' }, { key: 'fl', label: 'FL (mm)', type: 'number' },
      { key: 'crl', label: 'CRL (mm, early pregnancy)', type: 'number' },
      { key: 'efw', label: 'Estimated fetal weight (g)', type: 'number' },
      { key: 'ga', label: 'Gestational age by scan (weeks + days)', placeholder: 'e.g. 32 + 4' },
      { key: 'edd', label: 'EDD by scan', type: 'date' },
    ],
  },
  abdominal_us: {
    label: 'Abdominal / pelvic ultrasound', match: (m, r) => /ultra|sound/i.test(m) && /abdo|pelv|liver|renal|kidney|gall|kub/i.test(r || ''),
    fields: [
      { key: 'liver', label: 'Liver' }, { key: 'gallbladder', label: 'Gallbladder and bile ducts' }, { key: 'pancreas', label: 'Pancreas' },
      { key: 'spleen', label: 'Spleen' }, { key: 'right_kidney', label: 'Right kidney (size, echotexture, hydronephrosis)' },
      { key: 'left_kidney', label: 'Left kidney' }, { key: 'bladder', label: 'Urinary bladder' },
      { key: 'pelvis', label: 'Uterus / ovaries or prostate' }, { key: 'free_fluid', label: 'Free fluid', options: ['None', 'Small', 'Moderate', 'Large'] },
    ],
  },
  ct_head: {
    label: 'CT head (non-contrast)', match: (m, r) => /\bct\b|computed/i.test(m) && /head|brain|skull/i.test(r || ''),
    fields: [
      { key: 'haemorrhage', label: 'Haemorrhage', options: ['None', 'Extradural', 'Subdural', 'Subarachnoid', 'Intracerebral', 'Intraventricular'] },
      { key: 'infarct', label: 'Infarct / ischaemia', placeholder: 'None / territory and age' },
      { key: 'midline_shift', label: 'Midline shift (mm)', type: 'number' },
      { key: 'ventricles', label: 'Ventricles', options: ['Normal', 'Dilated (hydrocephalus)', 'Effaced'] },
      { key: 'mass', label: 'Mass / oedema' },
      { key: 'skull', label: 'Skull and fractures' },
      { key: 'sinuses', label: 'Sinuses and mastoids' },
    ],
  },
  msk_xray: {
    label: 'Bone / joint X-ray', match: (m, r) => /x-?ray/i.test(m) && /(arm|leg|hand|foot|wrist|ankle|knee|hip|femur|tibia|humerus|radius|ulna|shoulder|elbow|spine|pelvis|finger|toe)/i.test(r || ''),
    fields: [
      { key: 'region', label: 'Region and views' },
      { key: 'fracture', label: 'Fracture', options: ['None seen', 'Present'] },
      { key: 'fracture_detail', label: 'Fracture details (bone, site, pattern, displacement, angulation)' },
      { key: 'joints', label: 'Joints / alignment' },
      { key: 'soft_tissue', label: 'Soft tissues / foreign body' },
    ],
  },
  free: { label: 'Free text', match: () => false, fields: [] },
}

export function suggestTemplate(modality, region) {
  const hit = Object.entries(TEMPLATES).find(([, t]) => t.match(String(modality || ''), String(region || '')))
  return hit ? hit[0] : 'free'
}

/** Turn the structured answers into report text: one line per answered field. */
export function buildReport(templateKey, answers = {}) {
  const t = TEMPLATES[templateKey]
  if (!t) return ''
  return t.fields
    .filter((f) => answers[f.key] !== undefined && String(answers[f.key]).trim() !== '')
    .map((f) => `${f.label}: ${String(answers[f.key]).trim()}`)
    .join('\n')
}

/** Findings that should normally be flagged as critical (suggestion only — the reporter decides). */
export function suggestCritical(templateKey, answers = {}, text = '') {
  const t = `${text} ${Object.values(answers).join(' ')}`.toLowerCase()
  if (templateKey === 'obstetric_us' && answers.cardiac === 'Absent') return 'No fetal cardiac activity'
  if (templateKey === 'ct_head' && answers.haemorrhage && answers.haemorrhage !== 'None') return `Intracranial haemorrhage (${answers.haemorrhage})`
  if (templateKey === 'ct_head' && Number(answers.midline_shift) >= 5) return `Midline shift ${answers.midline_shift} mm`
  if (/tension pneumothorax|pneumoperitoneum|free (intraperitoneal )?air|ectopic|aortic dissection|cord compression|placental abruption/.test(t)) return 'Possible life-threatening finding — confirm and notify'
  return ''
}

export const PREGNANCY_CHECK = {
  not_pregnant: 'Not pregnant (asked / test negative)',
  pregnant_justified: 'Pregnant — examination justified, shielding used',
  unknown_justified: 'Unknown — examination justified',
  na: 'Not applicable (male / child / post-menopausal)',
}

export const IONISING = /(x-?ray|radiograph|\bct\b|computed|fluoro|mammo|dexa|interventional|angio)/i
