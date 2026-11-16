// MOH 405 (ANC) and MOH 406 (maternity) register layouts, period totals and CSV export. Rows come from
// moh405_register / moh406_register (20261210000000_maternity_registers.sql).

const d = (v) => (v ? new Date(v).toLocaleDateString('en-KE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '')
const dt = (v) => (v ? new Date(v).toLocaleString('en-KE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const MODE = { svd: 'SVD', assisted_vaginal: 'Assisted', breech: 'Breech', caesarean: 'C/S' }
const OUTCOME = { live_birth: 'Live', fresh_stillbirth: 'FSB', macerated_stillbirth: 'MSB', early_neonatal_death: 'ENND' }

export const MOH405_COLUMNS = [
  ['serial', 'S/No'], ['visit_date', 'Date', d], ['anc_number', 'ANC No.'], ['visit', '1st / Re-visit'], ['contact_number', 'Contact #'], ['name', 'Full name'],
  ['age', 'Age'], ['residence', 'Village / estate'], ['phone', 'Telephone'], ['marital_status', 'Marital status'], ['gravida', 'Gravida'], ['parity', 'Parity'],
  ['lmp', 'LMP', d], ['edd', 'EDD', d], ['ga_weeks', 'Gestation (wks)'], ['muac', 'MUAC (cm)'], ['height', 'Height (cm)'], ['weight', 'Weight (kg)'], ['bp', 'BP'],
  ['hb', 'Hb (g/dL)'], ['rbs', 'RBS'], ['urine', 'Urinalysis'], ['blood_group', 'Blood group'], ['syphilis', 'Syphilis (VDRL/RPR)'], ['hiv', 'HIV status / test'],
  ['partner_hiv', 'Partner HIV'], ['maternal_art', 'Maternal ART'], ['iptp', 'IPTp-SP dose'], ['td', 'Td dose'], ['ifas', 'IFAS'], ['llin', 'LLIN'], ['deworming', 'Deworming'],
  ['tb_screening', 'TB screening'], ['counselling', 'Counselling'], ['referred_to', 'Referred to'], ['risk_flags', 'Remarks / risks'],
]

export const MOH406_COLUMNS = [
  ['serial', 'S/No'], ['admitted_at', 'Date of admission', d], ['ip_number', 'IP No.'], ['name', 'Full name'], ['age', 'Age'], ['gravida', 'Gravida'], ['parity', 'Parity'],
  ['anc_visits', 'ANC visits'], ['ga_weeks', 'Gestation (wks)'], ['delivered_at', 'Date & time of delivery', dt], ['labour_hours', 'Duration of labour (h)'],
  ['mode', 'Mode of delivery', (v) => MODE[v] || v || ''], ['placenta_complete', 'Placenta complete'], ['uterotonic', 'Uterotonic'], ['blood_loss_ml', 'Blood loss (ml)'],
  ['perineum', 'Perineum'], ['mother_condition', 'Condition of mother'], ['complications', 'Complications'], ['baby_sex', 'Sex'], ['birth_weight_g', 'Birth weight (g)'],
  ['apgar_1', 'APGAR 1'], ['apgar_5', 'APGAR 5'], ['baby_outcome', 'Birth outcome', (v) => OUTCOME[v] || v || ''], ['resuscitated', 'Resuscitated'], ['bf_1h', 'BF within 1 h'],
  ['teo', 'TEO'], ['vitamin_k', 'Vit K'], ['chlorhexidine', 'Chlorhexidine'], ['mother_hiv', 'Mother HIV'], ['maternal_arv', 'ARV to mother'], ['infant_arv', 'ARV to baby'],
  ['delivered_by', 'Conducted by'], ['discharged_at', 'Date of discharge', d],
]

export const cell = (col, row) => {
  const [k, , fmt] = col
  const v = row?.[k]
  if (fmt) return fmt(v)
  return v === null || v === undefined ? '' : String(v)
}

const pos = (v) => /positive/.test(String(v || ''))

/** Totals for the bottom of the ANC register (also the MOH 711 ANC section). */
export function tally405(rows = []) {
  const firsts = rows.filter((r) => r.visit === '1st')
  return {
    'New clients (1st ANC)': firsts.length,
    'Re-visits': rows.length - firsts.length,
    '1st ANC before 12 weeks': firsts.filter((r) => Number(r.ga_weeks) > 0 && Number(r.ga_weeks) < 12).length,
    '4th ANC contact': rows.filter((r) => Number(r.contact_number) === 4).length,
    '8th ANC contact': rows.filter((r) => Number(r.contact_number) === 8).length,
    'Adolescents (10–19) — new clients': firsts.filter((r) => Number(r.age) >= 10 && Number(r.age) <= 19).length,
    'IPTp-SP dose 1': rows.filter((r) => Number(r.iptp) === 1).length,
    'IPTp-SP dose 3+': rows.filter((r) => Number(r.iptp) >= 3).length,
    'Td given': rows.filter((r) => Number(r.td) > 0).length,
    'IFAS given': rows.filter((r) => r.ifas === 'Yes').length,
    'LLIN given': rows.filter((r) => r.llin === 'Yes').length,
    'Anaemia (Hb < 11)': rows.filter((r) => r.hb !== null && r.hb !== undefined && r.hb !== '' && Number(r.hb) < 11).length,
    'HIV tested at ANC': rows.filter((r) => /^tested_/.test(r.hiv || '')).length,
    'HIV positive (known + new)': firsts.filter((r) => pos(r.hiv)).length,
    'Syphilis positive': rows.filter((r) => r.syphilis === 'positive').length,
    'TB screened': rows.filter((r) => r.tb_screening && r.tb_screening !== 'not_done').length,
    'Rows with blank required cells': rows.filter((r) => (r.missing || []).length).length,
  }
}

/** Totals for the bottom of the maternity register (MOH 711 maternity section). */
export function tally406(rows = []) {
  const byMother = new Map()
  for (const r of rows) { const k = String(r.serial).replace(/[a-z]$/, ''); if (!byMother.has(k)) byMother.set(k, r) }   // twins repeat the mother's columns
  const mothers = [...byMother.values()]
  const live = rows.filter((r) => r.baby_outcome === 'live_birth')
  return {
    Deliveries: mothers.length,
    'Normal (SVD)': mothers.filter((r) => r.mode === 'svd').length,
    'Assisted vaginal': mothers.filter((r) => r.mode === 'assisted_vaginal').length,
    'Breech': mothers.filter((r) => r.mode === 'breech').length,
    'Caesarean section': mothers.filter((r) => r.mode === 'caesarean').length,
    'Live births': live.length,
    'Fresh stillbirths': rows.filter((r) => r.baby_outcome === 'fresh_stillbirth').length,
    'Macerated stillbirths': rows.filter((r) => r.baby_outcome === 'macerated_stillbirth').length,
    'Early neonatal deaths': rows.filter((r) => r.baby_outcome === 'early_neonatal_death').length,
    'Low birth weight (< 2500 g)': live.filter((r) => Number(r.birth_weight_g) > 0 && Number(r.birth_weight_g) < 2500).length,
    'APGAR < 7 at 5 min': live.filter((r) => r.apgar_5 !== null && r.apgar_5 !== undefined && Number(r.apgar_5) < 7).length,
    'Babies resuscitated': rows.filter((r) => r.resuscitated === 'Yes').length,
    'Breastfed within 1 hour': live.filter((r) => r.bf_1h === 'Yes').length,
    'Uterotonic given (AMTSL)': mothers.filter((r) => r.uterotonic && r.uterotonic !== 'none').length,
    'PPH (≥ 500 ml)': mothers.filter((r) => Number(r.blood_loss_ml) >= 500).length,
    'Maternal deaths': mothers.filter((r) => r.mother_condition === 'died').length,
    'Mothers HIV positive': mothers.filter((r) => r.mother_hiv === 'positive').length,
    'HEI given ARV prophylaxis': live.filter((r) => r.mother_hiv === 'positive' && r.infant_arv).length,
    'Rows with blank required cells': rows.filter((r) => (r.missing || []).length).length,
  }
}

export function toCsv(columns, rows) {
  const esc = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return [columns.map((c) => esc(c[1])).join(','), ...rows.map((r) => columns.map((c) => esc(cell(c, r))).join(','))].join('\n')
}
