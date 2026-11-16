import { describe, expect, it } from 'vitest'
import { buildDataValueSet, dhis2Period, rowsToCsv } from './khis'

describe('KHIS / DHIS2 export', () => {
  it('periods', () => {
    expect(dhis2Period('2026-10-01', '2026-10-31')).toBe('202610')
    expect(dhis2Period('2026-02-01', '2026-02-28')).toBe('202602')
    expect(dhis2Period('2026-10-05', '2026-10-11')).toBe('20261005')
  })
  it('maps rows to data values and reports what is unmapped', () => {
    const rows = [
      { section: 'ANC', indicator: 'New ANC clients (1st contact)', disaggregation: '15-19', value: 4 },
      { section: 'ANC', indicator: 'New ANC clients (1st contact)', disaggregation: '20-24', value: 7 },
      { section: 'ANC', indicator: 'Given IFAS', disaggregation: 'all', value: 11 },
    ]
    const mappings = [
      { form: '711', indicator: 'New ANC clients (1st contact)', disaggregation: '15-19', data_element_uid: 'DE1', category_option_combo_uid: 'COC1519', data_set_uid: 'DS711' },
      { form: '711', indicator: 'Given IFAS', disaggregation: 'all', data_element_uid: 'DE2' },
      { form: '731', indicator: 'Given IFAS', disaggregation: 'all', data_element_uid: 'WRONG' },
    ]
    const out = buildDataValueSet({ form: '711', rows, mappings, orgUnit: 'OU1', from: '2026-10-01', to: '2026-10-31' })
    expect(out.mapped).toBe(2)
    expect(out.unmapped.map((r) => r.disaggregation)).toEqual(['20-24'])
    expect(out.json).toMatchObject({ dataSet: 'DS711', period: '202610', orgUnit: 'OU1' })
    expect(out.json.dataValues).toEqual([
      { dataElement: 'DE1', categoryOptionCombo: 'COC1519', period: '202610', orgUnit: 'OU1', value: '4' },
      { dataElement: 'DE2', period: '202610', orgUnit: 'OU1', value: '11' },
    ])
    expect(out.csv.split('\n')).toEqual(['dataelement,period,orgunit,categoryoptioncombo,attributeoptioncombo,value', 'DE1,202610,OU1,COC1519,,4', 'DE2,202610,OU1,,,11'])
  })
  it('CSV escapes commas and quotes', () => {
    expect(rowsToCsv([{ section: 'A', indicator: 'x, "y"', disaggregation: 'all', value: 1 }]).split('\n')[1]).toBe('A,"x, ""y""",all,1')
  })
})
