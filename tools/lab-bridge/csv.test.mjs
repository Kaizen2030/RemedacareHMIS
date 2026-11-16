import { describe, expect, it } from 'vitest'
import { parseCsvResults } from './csv.mjs'

describe('lab bridge CSV import', () => {
  it('groups rows by barcode and measurement time, including quoted commas', () => {
    const rows = parseCsvResults([
      'sample_id,measured_at,code,value,unit,flag',
      'LAB-001,2026-11-15T08:30:00+03:00,WBC,3.2,10*9/L,L',
      'LAB-001,2026-11-15T08:30:00+03:00,HGB,"12,4",g/dL,N',
      'LAB-002,2026-11-15T08:31:00+03:00,PLT,90,10*9/L,L',
    ].join('\r\n'))
    expect(rows).toEqual([
      { sample_id: 'LAB-001', measured_at: '2026-11-15T08:30:00+03:00', records: [
        { code: 'WBC', value: '3.2', unit: '10*9/L', flag: 'L' },
        { code: 'HGB', value: '12,4', unit: 'g/dL', flag: 'N' },
      ] },
      { sample_id: 'LAB-002', measured_at: '2026-11-15T08:31:00+03:00', records: [
        { code: 'PLT', value: '90', unit: '10*9/L', flag: 'L' },
      ] },
    ])
  })

  it('rejects missing headers, malformed quoting and incomplete result rows', () => {
    expect(() => parseCsvResults('sample_id,value\nLAB-001,4')).toThrow(/headers must include/)
    expect(() => parseCsvResults('sample_id,code,value\nLAB-001,"WBC,4')).toThrow(/unclosed quoted/)
    expect(() => parseCsvResults('sample_id,code,value\nLAB-001,WBC,')).toThrow(/row 2/)
  })
})
