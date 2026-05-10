import { executeWithFallback } from './dbCompat'

export const MICROBIOLOGY_RESULT_BASE_COLUMNS = [
  'id',
  'hospital_id',
  'patient_id',
  'visit_id',
  'lab_test_id',
  'patient_name',
  'sample_type',
  'collection_date',
  'received_date',
  'reported_date',
  'organism_identified',
  'colony_count',
  'gram_stain',
  'growth',
  'diagnosis',
  'ward_department',
  'clinical_notes',
  'performed_by',
  'verified_by',
  'esbl',
  'mrsa',
  'vre',
  'carbapenem_r',
  'ai_suggestion',
  'susceptibility_profile',
  'created_at',
  'updated_at',
]

export const MICROBIOLOGY_RESULT_ANTIBIOTIC_COLUMNS = [
  'amoxicillin',
  'amox_clav',
  'ampicillin',
  'cotrimoxazole',
  'ciprofloxacin',
  'levofloxacin',
  'norfloxacin',
  'gentamicin',
  'amikacin',
  'ceftriaxone',
  'cefuroxime',
  'ceftazidime',
  'cefepime',
  'meropenem',
  'imipenem',
  'piperacillin_tazo',
  'nitrofurantoin',
  'tetracycline',
  'doxycycline',
  'clindamycin',
  'erythromycin',
  'azithromycin',
  'vancomycin',
  'linezolid',
  'chloramphenicol',
  'metronidazole',
]

export const MICROBIOLOGY_RESULT_SELECT_COLUMNS = [
  ...MICROBIOLOGY_RESULT_BASE_COLUMNS,
  ...MICROBIOLOGY_RESULT_ANTIBIOTIC_COLUMNS,
]

export const MICROBIOLOGY_RESULTS_SELECT = MICROBIOLOGY_RESULT_SELECT_COLUMNS.join(', ')

export async function executeMicrobiologyQuery(runQuery) {
  return executeWithFallback(
    () => runQuery(MICROBIOLOGY_RESULTS_SELECT),
    async compatError => {
      const fallbackResult = await runQuery('*')
      return { ...fallbackResult, compatFallback: true, compatError }
    },
  )
}
