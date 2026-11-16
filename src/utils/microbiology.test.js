import { describe, expect, it } from 'vitest'
import { buildWhonetCsv, guessColumns, normaliseDate, parseAstValue, parseAstm, parseDelimited, sirFromBreakpoint, tableToImportRows } from './microbiology'

describe('microbiology helpers', () => {
  it('reads instrument values and applies breakpoints', () => {
    expect(parseAstValue('≤ 0.25')).toEqual({ comparator: '<=', value: 0.25 })
    expect(parseAstValue('>=32')).toEqual({ comparator: '>=', value: 32 })
    expect(parseAstValue('R')).toEqual({ comparator: null, value: null })
    expect(sirFromBreakpoint('mic', '=', 2, 1, 2)).toBe('I')
    expect(sirFromBreakpoint('disk', '=', 18, 22, 19)).toBe('R')
    expect(sirFromBreakpoint('mic', '<=', 2, 1, 2)).toBeNull()
  })

  it('parses an ASTM E1394 capture with framing characters into isolates', () => {
    const astm = [
      '\x021H|\\^&|||VITEK2^9.02|||||||P|1|20261114\r\x0399\r\n',
      '\x022P|1||P-002||Otieno^Bob||19650101|M\r\x03AB\r\n',
      '\x023O|1|M-2611-01||^^^AST|R|20261113|||||||||ur\r\x03CD\r\n',
      '\x024R|1|^^^ORG|ESCCOL||||||F\r\x03EF\r\n',
      '\x025R|2|^^^AM|>=32|ug/mL||R||F\r\x0301\r\n',
      '\x026R|3|^^^CIP|<=0.25|ug/mL||S||F\r\x0302\r\n',
      '\x027R|4|^^^ESBL|POS|||||F\r\x0303\r\n',
      '\x020L|1|N\r\x0304\r\n',
    ].join('')
    const rows = parseAstm(astm)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ specimen_no: 'M-2611-01', patient_number: 'P-002', specimen_type: 'ur', specimen_date: '2026-11-13', organism: 'ESCCOL' })
    expect(rows[0].results[0]).toEqual({ code: 'AM', method: 'mic', value: '>=32', sir: 'R' })
    expect(rows[0].results[1]).toEqual({ code: 'CIP', method: 'mic', value: '<=0.25', sir: 'S' })
  })

  it('reads a VITEK-style wide CSV (MIC + interpretation columns) and a long export', () => {
    const wide = 'Lab ID,Patient ID,Specimen,Collection Date,Organism,Ampicillin MIC,Ampicillin Interp,CIP_EM,AMK_ED30\n' +
      'M-01,P-001,Urine,13/11/2026,Escherichia coli,>=32,R,<=0.25,22\n' +
      'M-02,P-002,Blood,14/11/2026,Klebsiella pneumoniae,,R,1,\n'
    const t = parseDelimited(wide)
    const g = guessColumns(t[0])
    expect(g.layout).toBe('wide')
    expect(g.roles).toMatchObject({ specimen_no: 0, patient_number: 1, specimen_type: 2, specimen_date: 3, organism: 4 })
    const rows = tableToImportRows(t, g)
    expect(rows[0]).toMatchObject({ specimen_no: 'M-01', specimen_date: '2026-11-13', organism: 'Escherichia coli' })
    expect(rows[0].results).toEqual(expect.arrayContaining([
      { code: 'Ampicillin', method: 'mic', value: '>=32', sir: 'R' },
      { code: 'CIP', method: 'mic', value: '<=0.25', sir: '' },
      { code: 'AMK', method: 'disk', value: '22', sir: '' },
    ]))
    expect(rows[1].results.find((r) => r.code === 'Ampicillin')).toEqual({ code: 'Ampicillin', method: 'sir', value: '', sir: 'R' })

    const long = 'Specimen No;Patient No;Organism;Antibiotic;MIC;Interpretation\nS1;P-9;Staphylococcus aureus;Cefoxitin screen;POS;R\nS1;P-9;Staphylococcus aureus;Vancomycin;1;S\n'
    const lt = parseDelimited(long)
    const lr = tableToImportRows(lt)
    expect(lr).toHaveLength(1)
    expect(lr[0].results).toEqual([{ code: 'Cefoxitin screen', method: 'mic', value: 'POS', sir: 'R' }, { code: 'Vancomycin', method: 'mic', value: '1', sir: 'S' }])
  })

  it('handles quoted CSV fields and Kenyan dates; builds WHONET CSV', () => {
    expect(parseDelimited('a,"b, c","d ""q"""\n')).toEqual([['a', 'b, c', 'd "q"']])
    expect(normaliseDate('5/3/2026')).toBe('2026-03-05')
    expect(normaliseDate('20261113')).toBe('2026-11-13')
    const csv = buildWhonetCsv([{ PATIENT_ID: 'x', ORGANISM: 'eco', SPEC_TYPE: 'ur', results: [{ field: 'CIP_EM', value: '<=0.25' }, { field: 'AMP_ED10', value: '6' }] }], 'KNH')
    const [h, r] = csv.split('\r\n')
    expect(h.endsWith('AMP_ED10,CIP_EM')).toBe(true)
    expect(r.startsWith('KNH,x,')).toBe(true)
    expect(r.endsWith('6,<=0.25')).toBe(true)
  })
})
