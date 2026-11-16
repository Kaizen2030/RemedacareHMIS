// One proper name per department. Different spellings and synonyms of the SAME department (e.g. "Psychiatry" and
// "Mental Health", "Ophthalmology" and "Eye Clinic") map to one canonical name, so the menu, HR and Settings never show
// the same department twice. Only true synonyms are merged; related but separate units (e.g. Maternity vs
// Obstetrics & Gynaecology clinic) stay separate. The SQL in docs/sql/47 uses the same table.

export const DEPARTMENT_SYNONYMS = {
  'Mental Health & Psychiatry': ['mental health', 'mental health & psychiatry', 'mental health and psychiatry', 'psychiatry', 'psychiatric', 'psychiatric unit', 'psychiatric clinic', 'psychiatry clinic', 'mental health clinic', 'mental health unit'],
  'Eye Clinic': ['eye clinic', 'eye', 'eye unit', 'eye / optical', 'eye/optical', 'optical', 'ophthalmology', 'opthalmology', 'ophthamology', 'ophamology', 'opthamology', 'ophthalmology clinic'],
  Dental: ['dental', 'dentistry', 'dental clinic', 'dental unit', 'dental services'],
  'Nutrition & Dietetics': ['nutrition', 'nutrition & dietetics', 'nutrition and dietetics', 'dietetics', 'nutrition and dietetic', 'nutrition department'],
  'Obstetrics & Gynaecology': ['obstetrics & gynaecology', 'obstetrics and gynaecology', 'obstetrics & gynecology', 'obstetrics and gynecology', 'obs & gyn', 'obs & gynae', 'obs gyn', 'obs/gyn', 'obs / gyn', 'obgyn', 'ob/gyn', 'ob-gyn', 'o&g', 'obs and gynae', 'gynaecology', 'gynecology'],
  Orthopaedics: ['orthopaedics', 'orthopedics', 'orthopaedic', 'orthopedic', 'ortho', 'aorthopaedics', 'orthopaedic clinic'],
  ENT: ['ent', 'e.n.t', 'e.n.t.', 'ear nose & throat', 'ear, nose & throat', 'ear nose and throat', 'ear, nose and throat', 'ent clinic'],
  Paediatrics: ['paediatrics', 'pediatrics', 'paeds', 'peds', 'peadiatrics', 'paediatric', 'pediatric', 'paediatric clinic'],
  Physiotherapy: ['physiotherapy', 'physio', 'physical therapy', 'physiotherapy unit'],
  'General Medicine': ['general medicine', 'medicine', 'internal medicine', 'medical department'],
  Mortuary: ['mortuary', 'morgue', 'funeral home'],
  Cardiology: ['cardiology', 'cardiac clinic', 'cardiac unit', 'heart clinic'],
  Dermatology: ['dermatology', 'skin clinic', 'derm'],
  Neurology: ['neurology', 'neuro', 'neurology clinic'],
  Oncology: ['oncology', 'cancer clinic', 'cancer centre', 'cancer center', 'oncology unit'],
  Urology: ['urology', 'urology clinic'],
  'Community Health': ['community health', 'community health services', 'public health', 'community health department'],
  'Radiology & Imaging': ['radiology', 'imaging', 'radiology & imaging', 'radiology and imaging', 'x-ray', 'xray', 'x ray'],
  Laboratory: ['laboratory', 'lab', 'labs', 'medical laboratory'],
  'IT & Systems': ['it', 'ict', 'it & systems', 'it and systems', 'information technology', 'ict department'],
}

const LOOKUP = new Map(Object.entries(DEPARTMENT_SYNONYMS).flatMap(([canon, list]) => [[canon.toLowerCase(), canon], ...list.map((s) => [s, canon])]))

/** Lower-case, single spaces, "and" → "&" variants handled by the synonym table. */
export const departmentKey = (name) => String(name || '').replace(/\s+/g, ' ').trim().toLowerCase()

/** The proper name for any spelling; unknown names are returned tidied (trimmed, single spaces). */
export function canonicalDepartmentName(name) {
  const tidy = String(name || '').replace(/\s+/g, ' ').trim()
  if (!tidy) return ''
  return LOOKUP.get(tidy.toLowerCase()) || tidy
}

/** Unique canonical names from a list of names (first-seen order), merging spellings and synonyms. */
export function uniqueDepartmentNames(names) {
  const seen = new Map()
  for (const n of names || []) {
    const canon = canonicalDepartmentName(n)
    if (canon && !seen.has(canon.toLowerCase())) seen.set(canon.toLowerCase(), canon)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** If `name` is the same department as one already in `existing` (other than `exceptName`), return that one. */
export function findExistingDepartment(name, existing, exceptName = '') {
  const canon = canonicalDepartmentName(name).toLowerCase()
  const except = canonicalDepartmentName(exceptName).toLowerCase()
  if (!canon || canon === except) return null
  return (existing || []).find((n) => canonicalDepartmentName(n).toLowerCase() === canon) || null
}

const NOT_A_DEPARTMENT = /^(admitted|admission requested|inpatient \/ wards|inpatient|wards?|general|doctor|lab|pharmacy|prescription|completed|referred)$/i

/** The department an admission is under, from a visit's speciality ('' when it is only a status such as "Admitted"). */
export function admittingDepartmentFrom(speciality) {
  const canon = canonicalDepartmentName(speciality)
  return canon && !NOT_A_DEPARTMENT.test(canon) ? canon : ''
}
