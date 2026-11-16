// Specialty clinic templates: structured assessments with validated scores. The database recomputes the scores and
// flags (specialty_score() in 20261209000000_specialty_assessments.sql); scoreAssessment() mirrors it for the preview.

const opts = (labels) => labels.map((l, i) => [String(i), l])
const FREQ = opts(['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)'])

export const PHQ9 = [
  'Little interest or pleasure in doing things', 'Feeling down, depressed or hopeless', 'Trouble falling or staying asleep, or sleeping too much',
  'Feeling tired or having little energy', 'Poor appetite or overeating', 'Feeling bad about yourself — or that you are a failure',
  'Trouble concentrating on things', 'Moving or speaking so slowly others notice — or being fidgety or restless',
  'Thoughts that you would be better off dead, or of hurting yourself',
]
export const GAD7 = [
  'Feeling nervous, anxious or on edge', 'Not being able to stop or control worrying', 'Worrying too much about different things', 'Trouble relaxing',
  'Being so restless that it is hard to sit still', 'Becoming easily annoyed or irritable', 'Feeling afraid as if something awful might happen',
]
export const CSSRS = [
  ['c1', 'Past month: wished you were dead or could go to sleep and not wake up?'],
  ['c2', 'Past month: had any actual thoughts of killing yourself?'],
  ['c3', 'Thought about how you might do this (a method)?'],
  ['c4', 'Had these thoughts and some intention of acting on them?'],
  ['c5', 'Started to work out or worked out the details of how to kill yourself, and intend to carry it out?'],
  ['c6', 'Past 3 months: done anything, started to, or prepared to end your life?'],
]
export const AUDITC = [
  ['a1', 'How often do you have a drink containing alcohol?', opts(['Never (0)', 'Monthly or less (1)', '2–4 times a month (2)', '2–3 times a week (3)', '4 or more times a week (4)'])],
  ['a2', 'How many drinks on a typical day when drinking?', opts(['1–2 (0)', '3–4 (1)', '5–6 (2)', '7–9 (3)', '10 or more (4)'])],
  ['a3', 'How often 6 or more drinks on one occasion?', opts(['Never (0)', 'Less than monthly (1)', 'Monthly (2)', 'Weekly (3)', 'Daily or almost daily (4)'])],
]
export const MSE = ['Appearance and behaviour', 'Speech', 'Mood (patient\'s words)', 'Affect', 'Thought form', 'Thought content (delusions, obsessions, suicidal / homicidal ideas)', 'Perception (hallucinations)', 'Cognition (orientation, attention, memory)', 'Insight', 'Judgement']

export const BARTHEL = [
  ['feeding', 'Feeding', [['0', 'Unable (0)'], ['5', 'Needs help cutting, spreading (5)'], ['10', 'Independent (10)']]],
  ['bathing', 'Bathing', [['0', 'Dependent (0)'], ['5', 'Independent (5)']]],
  ['grooming', 'Grooming', [['0', 'Needs help (0)'], ['5', 'Independent face / hair / teeth / shaving (5)']]],
  ['dressing', 'Dressing', [['0', 'Dependent (0)'], ['5', 'Needs help, does about half (5)'], ['10', 'Independent (10)']]],
  ['bowels', 'Bowels', [['0', 'Incontinent (0)'], ['5', 'Occasional accident (5)'], ['10', 'Continent (10)']]],
  ['bladder', 'Bladder', [['0', 'Incontinent or catheterised (0)'], ['5', 'Occasional accident (5)'], ['10', 'Continent (10)']]],
  ['toilet', 'Toilet use', [['0', 'Dependent (0)'], ['5', 'Needs some help (5)'], ['10', 'Independent (10)']]],
  ['transfers', 'Transfers (bed to chair)', [['0', 'Unable (0)'], ['5', 'Major help (5)'], ['10', 'Minor help (10)'], ['15', 'Independent (15)']]],
  ['mobility', 'Mobility on level surfaces', [['0', 'Immobile (0)'], ['5', 'Wheelchair independent (5)'], ['10', 'Walks with help (10)'], ['15', 'Independent (15)']]],
  ['stairs', 'Stairs', [['0', 'Unable (0)'], ['5', 'Needs help (5)'], ['10', 'Independent (10)']]],
]

export const CHADS = [['chf', 'Heart failure / LV dysfunction (1)'], ['htn', 'Hypertension (1)'], ['diabetes', 'Diabetes (1)'], ['stroke', 'Previous stroke / TIA / thromboembolism (2)'], ['vascular', 'Vascular disease: MI, peripheral arterial disease, aortic plaque (1)']]

// FDI tooth numbers, permanent dentition
export const TEETH = [[18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28], [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]]
export const TOOTH_STATUS = [['sound', 'Sound', '#fff'], ['caries', 'Caries (D)', '#FECACA'], ['filled', 'Filled (F)', '#BFDBFE'], ['missing', 'Missing (M)', '#E5E7EB'],
  ['extract', 'For extraction (D)', '#FCA5A5'], ['rct', 'Root canal', '#DDD6FE'], ['crown', 'Crown (F)', '#FDE68A']]

/** Template definitions. Field kinds: scale (items scored by options), yesno, select, text, number, va, teeth, bpe, checks. */
export const TEMPLATES = {
  mental_health: {
    title: 'Mental health assessment',
    match: /mental|psychiat/i,
    sections: [
      { key: 'phq', title: 'PHQ-9 (depression) — over the last 2 weeks', kind: 'scale', items: PHQ9.map((q, i) => [`q${i + 1}`, q, FREQ]) },
      { key: 'gad', title: 'GAD-7 (anxiety) — over the last 2 weeks', kind: 'scale', items: GAD7.map((q, i) => [`g${i + 1}`, q, FREQ]) },
      { key: 'cssrs', title: 'Suicide risk screen (C-SSRS)', kind: 'yesno', items: CSSRS },
      { key: 'audit', title: 'Alcohol (AUDIT-C)', kind: 'scale', items: AUDITC },
      { key: 'mse', title: 'Mental state examination', kind: 'text', items: MSE.map((l, i) => [`mse${i + 1}`, l]) },
    ],
  },
  eye: {
    title: 'Eye examination',
    match: /eye|ophthal|optom/i,
    sections: [
      { key: 'va', title: 'Visual acuity (Snellen 6/…, or CF / HM / PL / NPL)', kind: 'va', items: [['va_r', 'Right — presenting'], ['va_l', 'Left — presenting'], ['ph_r', 'Right — pinhole'], ['ph_l', 'Left — pinhole'], ['bcva_r', 'Right — best corrected'], ['bcva_l', 'Left — best corrected']] },
      { key: 'iop', title: 'Intraocular pressure (mmHg)', kind: 'number', items: [['iop_r', 'Right IOP'], ['iop_l', 'Left IOP']] },
      { key: 'exam', title: 'Examination', kind: 'text', items: [['lids', 'Lids and adnexa'], ['conj', 'Conjunctiva / sclera'], ['cornea', 'Cornea'], ['ac', 'Anterior chamber'], ['lens', 'Lens (cataract grade)'], ['fundus', 'Fundus / cup-disc ratio'], ['refraction', 'Refraction / spectacle prescription']] },
    ],
  },
  dental: {
    title: 'Dental examination',
    match: /dental|dent|oral/i,
    sections: [
      { key: 'teeth', title: 'Tooth chart (FDI) — tap a tooth to change its status', kind: 'teeth' },
      { key: 'bpe', title: 'Basic periodontal examination (BPE) — highest code per sextant', kind: 'bpe', items: [['s1', 'Upper right'], ['s2', 'Upper front'], ['s3', 'Upper left'], ['s4', 'Lower left'], ['s5', 'Lower front'], ['s6', 'Lower right']] },
      { key: 'oral', title: 'Oral examination', kind: 'text', items: [['soft_tissue', 'Soft tissues / mucosa'], ['hygiene', 'Oral hygiene'], ['occlusion', 'Occlusion'], ['xray', 'Radiographs'], ['done', 'Treatment done today'], ['plan', 'Treatment plan']] },
    ],
  },
  ent: {
    title: 'ENT examination',
    match: /\bent\b|ear|nose|throat|otolaryn/i,
    sections: [
      { key: 'ear', title: 'Ears', kind: 'select', items: [
        ['tm_r', 'Right tympanic membrane', [['normal', 'Normal'], ['wax', 'Wax'], ['effusion', 'Effusion / retracted'], ['perforation', 'Perforation'], ['inflamed', 'Inflamed / bulging']]],
        ['tm_l', 'Left tympanic membrane', [['normal', 'Normal'], ['wax', 'Wax'], ['effusion', 'Effusion / retracted'], ['perforation', 'Perforation'], ['inflamed', 'Inflamed / bulging']]],
        ['discharge', 'Ear discharge', [['none', 'None'], ['lt2w', 'Under 2 weeks'], ['ge2w', '2 weeks or more']]],
        ['whisper', 'Whisper test', [['pass', 'Hears both ears'], ['fail_r', 'Fails right'], ['fail_l', 'Fails left'], ['fail_both', 'Fails both']]],
        ['rinne', 'Rinne', [['normal', 'Positive both (normal)'], ['neg_r', 'Negative right'], ['neg_l', 'Negative left']]],
        ['weber', 'Weber', [['central', 'Central'], ['right', 'Lateralises right'], ['left', 'Lateralises left']]],
      ] },
      { key: 'throat', title: 'Nose and throat', kind: 'select', items: [
        ['tonsils', 'Tonsil size (Brodsky)', [['0', '0 — removed'], ['1', '1 — within pillars'], ['2', '2 — up to 50% of airway'], ['3', '3 — 50–75%'], ['4', '4 — over 75% (kissing)']]],
        ['snoring', 'Snoring / witnessed apnoea', [['no', 'No'], ['snoring', 'Snoring'], ['apnoea', 'Witnessed apnoea']]],
      ] },
      { key: 'notes', title: 'Findings', kind: 'text', items: [['nose', 'Nose (septum, turbinates, polyps)'], ['pharynx', 'Pharynx / larynx'], ['neck', 'Neck']] },
    ],
  },
  physio: {
    title: 'Physiotherapy assessment',
    match: /physio|rehab|occupational/i,
    sections: [
      { key: 'pain', title: 'Pain', kind: 'number', items: [['pain_rest', 'Pain at rest (0–10)'], ['pain_move', 'Pain on movement (0–10)']] },
      { key: 'barthel', title: 'Barthel index (activities of daily living)', kind: 'scale', items: BARTHEL },
      { key: 'exam', title: 'Examination and plan', kind: 'text', items: [['rom', 'Range of movement (joint, degrees)'], ['power', 'Muscle power (MRC 0–5 by muscle group)'], ['gait', 'Gait / balance'], ['goals', 'Goals (SMART)'], ['treatment', 'Treatment given'], ['home', 'Home exercise programme']] },
    ],
  },
  cardiology: {
    title: 'Cardiology assessment',
    match: /cardi/i,
    sections: [
      { key: 'nyha', title: 'Functional class', kind: 'select', items: [['nyha', 'NYHA class', [['1', 'I — no limitation'], ['2', 'II — slight limitation, comfortable at rest'], ['3', 'III — marked limitation, comfortable only at rest'], ['4', 'IV — symptoms at rest']]],
        ['af', 'Atrial fibrillation / flutter', [['no', 'No'], ['yes', 'Yes']]], ['sex', 'Sex', [['male', 'Male'], ['female', 'Female']]]] },
      { key: 'age', title: 'Age', kind: 'number', items: [['age', 'Age (years)']] },
      { key: 'chads', title: 'CHA₂DS₂-VASc risk factors', kind: 'checks', items: CHADS },
      { key: 'notes', title: 'Findings', kind: 'text', items: [['ecg', 'ECG'], ['echo', 'Echocardiogram (EF %)'], ['plan', 'Plan']] },
    ],
  },
  dermatology: {
    title: 'Skin assessment',
    match: /derma|skin/i,
    sections: [
      { key: 'extent', title: 'Extent and symptoms', kind: 'number', items: [['bsa', 'Body surface area affected (%) — patient\'s palm ≈ 1%'], ['itch', 'Itch (0–10)']] },
      { key: 'lesion', title: 'Lesions', kind: 'text', items: [['morphology', 'Morphology (macule, papule, plaque, vesicle…)'], ['distribution', 'Distribution / sites'], ['colour', 'Colour, scale, border'], ['other', 'Hair, nails, mucosa'], ['plan', 'Plan']] },
    ],
  },
  orthopaedics: {
    title: 'Orthopaedic / fracture clinic',
    match: /ortho|fracture/i,
    sections: [
      { key: 'injury', title: 'Fracture', kind: 'select', items: [
        ['side', 'Side', [['left', 'Left'], ['right', 'Right'], ['bilateral', 'Bilateral'], ['na', 'Not applicable']]],
        ['fracture_type', 'Closed / open', [['closed', 'Closed'], ['open', 'Open']]],
        ['gustilo', 'Open fracture grade (Gustilo)', [['na', 'Not open'], ['I', 'I — wound < 1 cm, clean'], ['II', 'II — 1–10 cm, moderate soft tissue'], ['IIIA', 'IIIA — extensive, bone covered'], ['IIIB', 'IIIB — periosteal stripping, needs flap'], ['IIIC', 'IIIC — arterial injury needing repair']]],
        ['displacement', 'Displacement', [['undisplaced', 'Undisplaced'], ['displaced', 'Displaced'], ['comminuted', 'Comminuted'], ['angulated', 'Angulated']]],
        ['management', 'Management', [['pop', 'POP / cast'], ['splint', 'Splint / sling'], ['traction', 'Traction'], ['orif', 'ORIF (plate / screws)'], ['im_nail', 'Intramedullary nail'], ['ex_fix', 'External fixator'], ['arthroplasty', 'Arthroplasty'], ['conservative', 'Conservative']]],
      ] },
      { key: 'nv', title: 'Neurovascular status distal to the injury', kind: 'select', items: [
        ['pulse', 'Distal pulse', [['present', 'Present'], ['weak', 'Weak'], ['absent', 'Absent']]],
        ['cap_refill', 'Capillary refill', [['lt2', 'Under 2 seconds'], ['gt2', 'Over 2 seconds']]],
        ['sensation', 'Sensation', [['normal', 'Normal'], ['reduced', 'Reduced / numb']]],
        ['movement', 'Active movement of digits', [['normal', 'Normal'], ['reduced', 'Reduced / absent']]],
        ["passive_stretch_pain", "Pain on passive stretch of the muscles", [['no', 'No'], ['yes', 'Yes']]],
        ["pain_out_of_proportion", "Pain out of proportion to the injury", [['no', 'No'], ['yes', 'Yes']]],
      ] },
      { key: 'follow', title: 'Follow-up', kind: 'select', items: [
        ['cast', 'Cast / splint check', [['ok', 'Satisfactory'], ['tight', 'Tight / swelling'], ['loose', 'Loose'], ['broken', 'Broken / soft'], ['soiled', 'Wet / soiled']]],
        ['union', 'Union', [['not_assessed', 'Not assessed'], ['not_united', 'Not yet united'], ['clinical', 'Clinically united'], ['radiological', 'Radiologically united'], ['malunion', 'Malunion'], ['non_union', 'Non-union']]],
      ] },
      { key: 'nums', title: 'Time and pain', kind: 'number', items: [['weeks', 'Weeks since injury / surgery'], ['pain', 'Pain (0–10)']] },
      { key: 'notes', title: 'Findings and plan', kind: 'text', items: [['site', 'Bone and site (e.g. distal radius, midshaft tibia)'], ['xray', 'X-ray findings'], ['function', 'Function / range of movement'], ['plan', 'Plan (next review, cast removal, physio)']] },
    ],
  },
  oncology: {
    title: 'Oncology assessment and chemotherapy cycle',
    match: /oncol|cancer|haemato-?onc/i,
    sections: [
      { key: 'dx', title: 'Diagnosis and staging', kind: 'text', items: [['primary', 'Primary site'], ['histology', 'Histology / grade'], ['tnm', 'TNM (e.g. T2 N1 M0)'], ['stage', 'Stage'], ['regimen', 'Regimen (e.g. AC-T, FOLFOX, CHOP)']] },
      { key: 'status', title: 'Performance and intent', kind: 'select', items: [
        ['ecog', 'ECOG performance status', [['0', '0 — fully active'], ['1', '1 — restricted strenuous activity'], ['2', '2 — ambulatory, self-care, no work'], ['3', '3 — limited self-care, in bed > 50%'], ['4', '4 — completely disabled']]],
        ['intent', 'Treatment intent', [['curative', 'Curative'], ['adjuvant', 'Adjuvant'], ['neoadjuvant', 'Neoadjuvant'], ['palliative', 'Palliative']]],
      ] },
      { key: 'cycle', title: 'This cycle', kind: 'number', items: [['cycle_number', 'Cycle number'], ['height_cm', 'Height (cm)'], ['weight_kg', 'Weight (kg)'], ['anc', 'Neutrophils (×10⁹/L)'], ['platelets', 'Platelets (×10⁹/L)'], ['hb', 'Hb (g/dL)'], ['dose_mg_m2', 'Main drug dose (mg/m²)']] },
      { key: 'tox', title: 'Toxicity and plan', kind: 'text', items: [['toxicity', 'Toxicity since last cycle (CTCAE grade)'], ['plan', 'Plan']] },
    ],
  },
}

// Neurology: Glasgow Coma Scale and NIH Stroke Scale (NIHSS, 15 items, 0–42)
export const GCS = [
  ['gcs_e', 'Eye opening', [['4', 'Spontaneous (4)'], ['3', 'To voice (3)'], ['2', 'To pain (2)'], ['1', 'None (1)']]],
  ['gcs_v', 'Verbal response', [['5', 'Oriented (5)'], ['4', 'Confused (4)'], ['3', 'Inappropriate words (3)'], ['2', 'Incomprehensible sounds (2)'], ['1', 'None (1)']]],
  ['gcs_m', 'Motor response', [['6', 'Obeys commands (6)'], ['5', 'Localises pain (5)'], ['4', 'Withdraws from pain (4)'], ['3', 'Abnormal flexion (3)'], ['2', 'Extension (2)'], ['1', 'None (1)']]],
]
const MOTOR = opts(['No drift (0)', 'Drift (1)', 'Some effort against gravity (2)', 'No effort against gravity (3)', 'No movement (4)'])
export const NIHSS = [
  ['n1a', '1a Level of consciousness', opts(['Alert (0)', 'Not alert, rousable by minor stimulation (1)', 'Not alert, needs repeated stimulation (2)', 'Unresponsive / reflex responses only (3)'])],
  ['n1b', '1b Questions (month, age)', opts(['Both correct (0)', 'One correct (1)', 'Neither correct (2)'])],
  ['n1c', '1c Commands (open/close eyes, grip)', opts(['Both correct (0)', 'One correct (1)', 'Neither correct (2)'])],
  ['n2', '2 Best gaze', opts(['Normal (0)', 'Partial gaze palsy (1)', 'Forced deviation (2)'])],
  ['n3', '3 Visual fields', opts(['No loss (0)', 'Partial hemianopia (1)', 'Complete hemianopia (2)', 'Bilateral hemianopia / blind (3)'])],
  ['n4', '4 Facial palsy', opts(['Normal (0)', 'Minor (1)', 'Partial (2)', 'Complete (3)'])],
  ['n5a', '5a Motor arm — left', MOTOR], ['n5b', '5b Motor arm — right', MOTOR],
  ['n6a', '6a Motor leg — left', MOTOR], ['n6b', '6b Motor leg — right', MOTOR],
  ['n7', '7 Limb ataxia', opts(['Absent (0)', 'Present in one limb (1)', 'Present in two limbs (2)'])],
  ['n8', '8 Sensory', opts(['Normal (0)', 'Mild to moderate loss (1)', 'Severe or total loss (2)'])],
  ['n9', '9 Best language', opts(['No aphasia (0)', 'Mild to moderate aphasia (1)', 'Severe aphasia (2)', 'Mute / global aphasia (3)'])],
  ['n10', '10 Dysarthria', opts(['Normal (0)', 'Mild to moderate (1)', 'Severe (2)'])],
  ['n11', '11 Extinction and inattention', opts(['None (0)', 'In one sensory modality (1)', 'Profound / more than one modality (2)'])],
]

// Urology: International Prostate Symptom Score (IPSS, 7 items 0–35) + quality of life
const IPSS_FREQ = opts(['Not at all (0)', 'Less than 1 time in 5 (1)', 'Less than half the time (2)', 'About half the time (3)', 'More than half the time (4)', 'Almost always (5)'])
export const IPSS = [
  ['i1', 'Incomplete emptying — sensation of not emptying the bladder', IPSS_FREQ],
  ['i2', 'Frequency — urinating again less than 2 hours after finishing', IPSS_FREQ],
  ['i3', 'Intermittency — stopping and starting several times', IPSS_FREQ],
  ['i4', 'Urgency — difficult to postpone urination', IPSS_FREQ],
  ['i5', 'Weak stream', IPSS_FREQ],
  ['i6', 'Straining — pushing or straining to begin', IPSS_FREQ],
  ['i7', 'Nocturia — times up at night to urinate', opts(['None (0)', '1 time (1)', '2 times (2)', '3 times (3)', '4 times (4)', '5 or more times (5)'])],
]

TEMPLATES.neurology = {
  title: 'Neurology assessment',
  match: /neuro|stroke/i,
  sections: [
    { key: 'gcs', title: 'Glasgow Coma Scale', kind: 'scale', items: GCS },
    { key: 'nihss', title: 'NIH Stroke Scale (score every item)', kind: 'scale', items: NIHSS },
    { key: 'timing', title: 'Timing', kind: 'number', items: [['onset_hours', 'Hours since symptom onset / last seen well']] },
    { key: 'notes', title: 'Findings and plan', kind: 'text', items: [['ct', 'Brain CT / MRI'], ['seizures', 'Seizures (type, frequency, last seizure)'], ['cranial', 'Cranial nerves'], ['reflexes', 'Tone, reflexes, plantars'], ['plan', 'Plan']] },
  ],
}
TEMPLATES.urology = {
  title: 'Urology assessment',
  match: /urolog|prostat/i,
  sections: [
    { key: 'ipss', title: 'IPSS — over the past month', kind: 'scale', items: IPSS },
    { key: 'qol', title: 'Quality of life', kind: 'select', items: [['ipss_qol', 'If you spent the rest of your life with your urinary condition as it is now, how would you feel?', opts(['Delighted (0)', 'Pleased (1)', 'Mostly satisfied (2)', 'Mixed (3)', 'Mostly dissatisfied (4)', 'Unhappy (5)', 'Terrible (6)'])]] },
    { key: 'nums', title: 'Measurements', kind: 'number', items: [['psa', 'PSA (ng/mL)'], ['prostate_ml', 'Prostate volume (mL)'], ['pvr_ml', 'Post-void residual (mL)'], ['qmax', 'Peak flow Qmax (mL/s)']] },
    { key: 'notes', title: 'Findings and plan', kind: 'text', items: [['dre', 'Digital rectal examination'], ['haematuria', 'Haematuria / urinalysis'], ['imaging', 'Ultrasound / imaging'], ['plan', 'Plan']] },
  ],
}

export function templateFor(speciality) {
  return Object.entries(TEMPLATES).find(([, t]) => t.match.test(String(speciality || '')))?.[0] || null
}

const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
const sumKeys = (d, keys) => { const vals = keys.map((k) => n(d[k])); return vals.some((v) => v === null) ? null : vals.reduce((a, b) => a + b, 0) }

/** Snellen 6/x or 20/x, CF, HM, PL, NPL -> decimal acuity */
export function vaDecimal(v) {
  const s = String(v || '').trim().toUpperCase()
  if (!s) return null
  if (s === 'CF') return 0.02
  if (s === 'HM') return 0.01
  if (s === 'PL') return 0.001
  if (s === 'NPL') return 0
  const m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  return m && Number(m[2]) > 0 ? Math.round((Number(m[1]) / Number(m[2])) * 1000) / 1000 : null
}

export function whoVisionCategory(dec) {
  if (dec === null) return null
  if (dec >= 0.5) return 'No impairment'
  if (dec >= 0.3) return 'Mild impairment'
  if (dec >= 0.1) return 'Moderate impairment'
  if (dec >= 0.05) return 'Severe impairment'
  return 'Blindness'
}

/** Same rules as specialty_score() in the database. Returns { scores, flags }. */
export function scoreAssessment(template, d = {}) {
  const scores = {}, flags = []
  if (template === 'mental_health') {
    const phq = sumKeys(d, PHQ9.map((_, i) => `q${i + 1}`)), gad = sumKeys(d, GAD7.map((_, i) => `g${i + 1}`))
    if (phq !== null) { scores.phq9 = phq; scores.phq9_band = phq >= 20 ? 'Severe' : phq >= 15 ? 'Moderately severe' : phq >= 10 ? 'Moderate' : phq >= 5 ? 'Mild' : 'Minimal' }
    if (gad !== null) { scores.gad7 = gad; scores.gad7_band = gad >= 15 ? 'Severe' : gad >= 10 ? 'Moderate' : gad >= 5 ? 'Mild' : 'Minimal' }
    const yes = (k) => d[k] === 'yes'
    const risk = yes('c4') || yes('c5') || yes('c6') ? 'high' : yes('c3') ? 'moderate' : yes('c1') || yes('c2') ? 'low' : CSSRS.some(([k]) => d[k] === 'no') ? 'none' : null
    if (risk) scores.suicide_risk = risk
    if (risk === 'high' || n(d.q9) > 0) flags.push(risk === 'high' ? 'HIGH suicide risk: do not leave the patient alone; same-day psychiatric review; remove means' : 'PHQ-9 item 9 positive: complete the suicide risk screen now')
    else if (risk === 'moderate') flags.push('Moderate suicide risk: safety plan and early review')
    const audit = sumKeys(d, ['a1', 'a2', 'a3'])
    if (audit !== null) { scores.audit_c = audit; if (audit >= (d.sex === 'female' ? 3 : 4)) flags.push('AUDIT-C positive: hazardous drinking — brief intervention') }
    if (phq !== null && phq >= 15) flags.push('PHQ-9 15 or more: treatment for depression indicated')
    if (gad !== null && gad >= 10) flags.push('GAD-7 10 or more: probable anxiety disorder')
  } else if (template === 'eye') {
    const r = vaDecimal(d.va_r), l = vaDecimal(d.va_l)
    if (r !== null || l !== null) { const better = Math.max(r ?? -1, l ?? -1); scores.better_eye_decimal = better; scores.who_category = whoVisionCategory(better) }
    for (const [k, eye] of [['iop_r', 'right'], ['iop_l', 'left']]) if (n(d[k]) > 21) flags.push(`Raised intraocular pressure ${eye} (${d[k]} mmHg): glaucoma assessment`)
    if (scores.who_category && !/No|Mild/.test(scores.who_category)) flags.push(`${scores.who_category} (better eye): refer / register for low-vision services`)
    for (const [p, ph, eye] of [['va_r', 'ph_r', 'right'], ['va_l', 'ph_l', 'left']]) {
      const a = vaDecimal(d[p]), b = vaDecimal(d[ph])
      if (a !== null && b !== null && b > a) flags.push(`Pinhole improves the ${eye} eye: refractive error — refraction needed`)
    }
  } else if (template === 'dental') {
    const t = d.teeth || {}
    const vals = Object.values(t)
    scores.D = vals.filter((v) => v === 'caries' || v === 'extract').length
    scores.M = vals.filter((v) => v === 'missing').length
    scores.F = vals.filter((v) => v === 'filled' || v === 'crown').length
    scores.DMFT = scores.D + scores.M + scores.F
    const bpe = ['s1', 's2', 's3', 's4', 's5', 's6'].map((k) => n(d[k])).filter((v) => v !== null)
    if (bpe.length) { scores.bpe_max = Math.max(...bpe); if (scores.bpe_max === 4) flags.push('BPE code 4 (pocket over 5.5 mm): full periodontal charting and treatment') }
    if (vals.some((v) => v === 'extract')) flags.push('Teeth marked for extraction')
  } else if (template === 'ent') {
    const tons = n(d.tonsils)
    if (tons !== null) scores.tonsil_grade = tons
    if (tons >= 3 && ['snoring', 'apnoea'].includes(d.snoring)) flags.push('Large tonsils with snoring / apnoea: assess for obstructive sleep apnoea — consider tonsillectomy referral')
    if ((d.tm_r === 'perforation' || d.tm_l === 'perforation') && d.discharge === 'ge2w') flags.push('Perforation with discharge 2 weeks or more: chronic suppurative otitis media')
    if (/^fail/.test(d.whisper || '')) flags.push('Failed whisper test: audiometry')
  } else if (template === 'physio') {
    const b = sumKeys(d, BARTHEL.map(([k]) => k))
    if (b !== null) { scores.barthel = b; scores.barthel_band = b === 100 ? 'Independent' : b >= 91 ? 'Slight dependency' : b >= 61 ? 'Moderate dependency' : b >= 21 ? 'Severe dependency' : 'Total dependency' }
    if (n(d.pain_move) >= 7) flags.push('Severe pain on movement: review analgesia')
  } else if (template === 'cardiology') {
    const age = n(d.age), female = d.sex === 'female'
    if (d.af === 'yes' && age !== null && d.sex) {
      const s = (d.chf ? 1 : 0) + (d.htn ? 1 : 0) + (d.diabetes ? 1 : 0) + (d.stroke ? 2 : 0) + (d.vascular ? 1 : 0) + (age >= 75 ? 2 : age >= 65 ? 1 : 0) + (female ? 1 : 0)
      scores.cha2ds2_vasc = s
      const male = s - (female ? 1 : 0)
      scores.anticoagulation = male >= 2 ? 'Recommended' : male === 1 ? 'Consider' : 'Not indicated'
      if (male >= 2) flags.push(`CHA₂DS₂-VASc ${s}: oral anticoagulation recommended unless contraindicated (check bleeding risk)`)
    }
    if (n(d.nyha) >= 3) flags.push(`NYHA class ${d.nyha === '4' ? 'IV' : 'III'}: optimise heart failure treatment`)
  } else if (template === 'dermatology') {
    const bsa = n(d.bsa)
    if (bsa !== null) { scores.bsa = bsa; scores.extent = bsa > 10 ? 'Severe (over 10%)' : bsa >= 3 ? 'Moderate (3–10%)' : 'Mild (under 3%)' }
    if (bsa > 10) flags.push('Over 10% body surface: consider systemic treatment / specialist review')
  } else if (template === 'orthopaedics') {
    if (d.fracture_type) scores.fracture = d.fracture_type === 'open' ? `open${d.gustilo && d.gustilo !== 'na' ? ` ${d.gustilo}` : ''}` : 'closed'
    if (n(d.weeks) !== null) scores.weeks = n(d.weeks)
    if (d.union) scores.union = d.union
    if (d.fracture_type === 'open') flags.push('Open fracture: IV antibiotics within 1 hour, tetanus prophylaxis, debridement within 24 hours')
    if (/^III/.test(d.gustilo || '')) flags.push('Gustilo III: urgent orthopaedic and plastic surgery review')
    if (d.pulse === 'absent' || d.cap_refill === 'gt2' || d.sensation === 'reduced' || d.movement === 'reduced') flags.push('Neurovascular compromise: urgent review — reduce the fracture / split the cast')
    if (d.passive_stretch_pain === 'yes' || d.pain_out_of_proportion === 'yes') flags.push('Possible compartment syndrome: split the cast to skin, keep the limb at heart level, urgent surgical review (fasciotomy)')
    if (d.cast === 'tight') flags.push('Tight cast: split or replace now')
    if (d.union === 'non_union' || (n(d.weeks) >= 24 && d.union === 'not_united')) flags.push('Non-union: refer for surgical review')
  } else if (template === 'oncology') {
    const h = n(d.height_cm), w = n(d.weight_kg)
    if (h > 0 && w > 0) {
      scores.bsa = Math.round(Math.sqrt((h * w) / 3600) * 100) / 100
      if (n(d.dose_mg_m2) > 0) scores.planned_dose_mg = Math.round(n(d.dose_mg_m2) * scores.bsa)
    }
    if (d.ecog !== undefined && d.ecog !== '') scores.ecog = n(d.ecog)
    if (n(d.cycle_number) !== null) scores.cycle = n(d.cycle_number)
    if (n(d.ecog) >= 3) flags.push('ECOG 3–4: chemotherapy is usually not appropriate — review treatment intent')
    if (n(d.anc) !== null && n(d.anc) < 1.5) flags.push('Neutrophils below 1.5 ×10⁹/L: delay the cycle')
    if (n(d.platelets) !== null && n(d.platelets) < 100) flags.push('Platelets below 100 ×10⁹/L: delay the cycle')
    if (n(d.hb) !== null && n(d.hb) < 8) flags.push('Hb below 8 g/dL: consider transfusion before chemotherapy')
  } else if (template === 'neurology') {
    const gcs = sumKeys(d, GCS.map(([k]) => k))
    if (gcs !== null) { scores.gcs = gcs; scores.gcs_band = gcs <= 8 ? 'Severe' : gcs <= 12 ? 'Moderate' : 'Mild' }
    const nih = sumKeys(d, NIHSS.map(([k]) => k))
    if (nih !== null) { scores.nihss = nih; scores.nihss_band = nih === 0 ? 'No stroke symptoms' : nih <= 4 ? 'Minor stroke' : nih <= 15 ? 'Moderate stroke' : nih <= 20 ? 'Moderate to severe stroke' : 'Severe stroke' }
    if (gcs !== null && gcs <= 8) flags.push('GCS 8 or less: protect the airway — urgent senior / ICU review')
    if (n(d.onset_hours) !== null && n(d.onset_hours) <= 4.5 && nih !== null && nih > 0) flags.push('Stroke symptoms within 4.5 hours of onset: urgent brain CT — assess for thrombolysis where available')
    if (nih !== null && nih >= 16) flags.push('NIHSS 16 or more: severe stroke — high-dependency care, swallow screen before oral intake')
  } else if (template === 'urology') {
    const ipss = sumKeys(d, IPSS.map(([k]) => k))
    if (ipss !== null) { scores.ipss = ipss; scores.ipss_band = ipss >= 20 ? 'Severe' : ipss >= 8 ? 'Moderate' : 'Mild' }
    if (n(d.ipss_qol) !== null) scores.ipss_qol = n(d.ipss_qol)
    if (ipss !== null && ipss >= 20) flags.push('IPSS 20 or more: severe lower urinary tract symptoms — urology review for medical or surgical treatment')
    if (n(d.psa) !== null && n(d.psa) > 4) flags.push('PSA above 4 ng/mL: repeat and assess for prostate cancer (consider age and prostate size)')
    if (n(d.pvr_ml) !== null && n(d.pvr_ml) >= 300) flags.push('Post-void residual 300 mL or more: chronic urinary retention — catheter and urology review')
  }
  return { scores, flags }
}

/** One-paragraph summary for the consultation notes. */
export function summarise(template, d, { scores, flags }) {
  const t = TEMPLATES[template]
  if (!t) return ''
  const parts = Object.entries(scores).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
  const text = t.sections.filter((s) => s.kind === 'text').flatMap((s) => s.items).filter(([k]) => d[k]).map(([k, l]) => `${l}: ${d[k]}`)
  return [`${t.title}.`, parts.length ? `${parts.join('; ')}.` : '', text.length ? `${text.join('. ')}.` : '', flags.length ? `Alerts: ${flags.join('; ')}.` : ''].filter(Boolean).join(' ')
}
