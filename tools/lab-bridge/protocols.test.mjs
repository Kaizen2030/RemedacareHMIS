import { describe, expect, it } from 'vitest'
import { ACK, AstmReceiver, astmChecksum, astmFrame, hl7Ack, MllpReceiver, mllpWrap, NAK, parseAstmRecords, parseHl7 } from './protocols.mjs'

const ASTM_RECORDS = [
  'H|\\^&|||XN-350^00-21^12345|||||||P|1|20261115083000',
  'P|1||P-0042||Otieno^Bob',
  'O|1|LAB-000123||^^^FBC|R|20261115081500|||||||||||||||||20261115083000|||F',
  'R|1|^^^^WBC^1|12.4|10*3/uL||H||||||20261115083000',
  'R|2|^^^^HGB^1|112|g/L||L',
  'R|3|^^^^PLT^1|245|10*3/uL||N',
  'L|1|N',
]

describe('lab bridge protocols', () => {
  it('ASTM E1381: ENQ is acknowledged, frames are checked, ETB frames are joined, EOT delivers the message', () => {
    const got = []
    const rx = new AstmReceiver((m) => got.push(m))
    expect(rx.feed(Buffer.from([0x05]))).toEqual([ACK])
    const text = ASTM_RECORDS.join('\r') + '\r'
    const half = Math.floor(text.length / 2)
    expect(rx.feed(astmFrame(1, text.slice(0, half), false))).toEqual([ACK])
    const bad = astmFrame(2, text.slice(half), true).replace(/..\r\n$/, '00\r\n')
    expect(rx.feed(bad)).toEqual([NAK])
    expect(rx.feed(astmFrame(2, text.slice(half), true))).toEqual([ACK])
    rx.feed(Buffer.from([0x04]))
    expect(got).toHaveLength(1)
    const [r] = parseAstmRecords(got[0])
    expect(r.sample_id).toBe('LAB-000123')
    expect(r.measured_at).toBe('2026-11-15T08:30:00+03:00')
    expect(r.records).toEqual([
      { code: 'WBC', value: '12.4', unit: '10*3/uL', flag: 'H' },
      { code: 'HGB', value: '112', unit: 'g/L', flag: 'L' },
      { code: 'PLT', value: '245', unit: '10*3/uL', flag: 'N' },
    ])
    expect(astmChecksum('1H|\\^&\x03')).toMatch(/^[0-9A-F]{2}$/)
  })

  it('a frame split across TCP packets is reassembled', () => {
    const got = []
    const rx = new AstmReceiver((m) => got.push(m))
    rx.feed('\x05')
    const frame = astmFrame(1, ASTM_RECORDS.join('\r') + '\r', true)
    expect(rx.feed(frame.slice(0, 20))).toEqual([])
    expect(rx.feed(frame.slice(20))).toEqual([ACK])
    rx.feed('\x04')
    expect(parseAstmRecords(got[0])[0].records).toHaveLength(3)
  })

  it('HL7 v2 over MLLP: OBR sample, OBX results with LOINC-style codes, and an ACK', () => {
    const msg = [
      'MSH|^~\\&|BC-5000|Mindray|||20261115090000||ORU^R01|MSG0001|P|2.3.1',
      'PID|1||P-0042||Otieno^Bob',
      'OBR|1||LAB-000124|01001^Automated Count^99MRC||20261115085500|20261115090000',
      'OBX|1|NM|6690-2^WBC^LN||3.1|10*9/L|4.0-10.0|L|||F',
      'OBX|2|NM|718-7^HGB^LN||9.8|g/dL|11.5-17.5|L|||F',
      'OBX|3|NM|777-3^PLT^LN||18|10*9/L|150-400|LL|||F',
    ].join('\r')
    const got = []
    const rx = new MllpReceiver((m) => got.push(m))
    const wrapped = mllpWrap(msg)
    rx.feed(wrapped.slice(0, 30)); rx.feed(wrapped.slice(30))
    expect(got).toHaveLength(1)
    const [r] = parseHl7(got[0])
    expect(r.sample_id).toBe('LAB-000124')
    expect(r.records.map((x) => [x.code, x.value, x.flag])).toEqual([['WBC', '3.1', 'L'], ['HGB', '9.8', 'L'], ['PLT', '18', 'LL']])
    const ack = hl7Ack(got[0])
    expect(ack).toMatch(/^MSH\|\^~\\&\|REMEDACARE/)
    expect(ack.split('\r')[1]).toBe('MSA|AA|MSG0001')
  })
})
