import { describe, expect, it } from 'vitest'
import { MOH405_COLUMNS, MOH406_COLUMNS, cell, tally405, tally406, toCsv } from './maternityRegisters'

describe('MOH 405 / 406 registers', () => {
  it('ANC totals', () => {
    const rows = [
      { visit: '1st', contact_number: 1, ga_weeks: 10, age: '17', iptp: null, td: 1, ifas: 'Yes', hb: 10.2, hiv: 'tested_negative', tb_screening: 'negative', missing: [] },
      { visit: '1st', contact_number: 1, ga_weeks: 20, age: '28', hiv: 'known_positive', syphilis: 'positive', missing: ['MUAC'] },
      { visit: 'Re-visit', contact_number: 4, iptp: 3, llin: 'Yes', hb: 12, missing: [] },
    ]
    expect(tally405(rows)).toMatchObject({
      'New clients (1st ANC)': 2, 'Re-visits': 1, '1st ANC before 12 weeks': 1, '4th ANC contact': 1, 'Adolescents (10–19) — new clients': 1,
      'IPTp-SP dose 3+': 1, 'Td given': 1, 'Anaemia (Hb < 11)': 1, 'HIV tested at ANC': 1, 'HIV positive (known + new)': 1, 'Syphilis positive': 1, 'Rows with blank required cells': 1,
    })
  })
  it('maternity totals count mothers once and babies separately', () => {
    const rows = [
      { serial: '1a', mode: 'svd', baby_outcome: 'live_birth', birth_weight_g: 2300, apgar_5: 6, bf_1h: 'Yes', uterotonic: 'oxytocin', blood_loss_ml: 600, mother_hiv: 'positive', infant_arv: 'AZT+NVP', missing: [] },
      { serial: '1b', mode: 'svd', baby_outcome: 'fresh_stillbirth', blood_loss_ml: 600, mother_hiv: 'positive', missing: [] },
      { serial: '2', mode: 'caesarean', baby_outcome: 'live_birth', birth_weight_g: 3400, apgar_5: 9, uterotonic: 'none', mother_condition: 'died', missing: ['mother HIV'] },
    ]
    expect(tally406(rows)).toMatchObject({
      Deliveries: 2, 'Normal (SVD)': 1, 'Caesarean section': 1, 'Live births': 2, 'Fresh stillbirths': 1, 'Low birth weight (< 2500 g)': 1, 'APGAR < 7 at 5 min': 1,
      'Breastfed within 1 hour': 1, 'Uterotonic given (AMTSL)': 1, 'PPH (≥ 500 ml)': 1, 'Maternal deaths': 1, 'Mothers HIV positive': 1, 'HEI given ARV prophylaxis': 1, 'Rows with blank required cells': 1,
    })
  })
  it('formats cells and CSV in register order', () => {
    const mode = MOH406_COLUMNS.find((c) => c[0] === 'mode')
    expect(cell(mode, { mode: 'caesarean' })).toBe('C/S')
    const csv = toCsv(MOH405_COLUMNS.slice(0, 6), [{ serial: 1, visit_date: '2026-11-15', anc_number: 'ANC/1', visit: '1st', contact_number: 1, name: 'Wanjiku, Jane' }])
    expect(csv.split('\n')[0]).toBe('S/No,Date,ANC No.,1st / Re-visit,Contact #,Full name')
    expect(csv.split('\n')[1]).toMatch(/^1,15\/11\/2026,ANC\/1,1st,1,"Wanjiku, Jane"$/)
  })
})
