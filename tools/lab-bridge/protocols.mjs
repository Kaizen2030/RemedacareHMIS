// Analyser protocols for the RemedacareHMS lab bridge — no dependencies, so they can be tested anywhere.
//   ASTM E1381 (low level: ENQ/ACK, framed records with checksums, ETB continuation, EOT) + ASTM E1394 records
//   HL7 v2 over MLLP (0x0B … 0x1C 0x0D) with an ACK back to the analyser
// Output for both: [{ sample_id, measured_at, records: [{ code, value, unit, flag }], raw }]

export const ENQ = 0x05, ACK = 0x06, NAK = 0x15, EOT = 0x04, STX = 0x02, ETX = 0x03, ETB = 0x17, CR = 0x0d, LF = 0x0a
const VT = 0x0b, FS = 0x1c

/** E1381 checksum: sum of bytes from the frame number up to and including ETX/ETB, modulo 256, two hex digits. */
export function astmChecksum(body) {
  let sum = 0
  for (let i = 0; i < body.length; i++) sum = (sum + body.charCodeAt(i)) & 0xff
  return sum.toString(16).toUpperCase().padStart(2, '0')
}

/** Build one E1381 frame (used by tests and by the simulator). */
export function astmFrame(frameNo, text, last = true) {
  const body = `${frameNo % 8}${text}${String.fromCharCode(last ? ETX : ETB)}`
  return `${String.fromCharCode(STX)}${body}${astmChecksum(body)}\r\n`
}

/**
 * Stateful E1381 receiver. Feed it bytes (Buffer or string); it returns the bytes to send back (ACK / NAK) and
 * calls onMessage(text) with the complete record text at EOT.
 */
export class AstmReceiver {
  constructor(onMessage) { this.onMessage = onMessage; this.buf = ''; this.records = []; this.partial = '' }
  feed(chunk) {
    const out = []
    this.buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('latin1')
    for (;;) {
      const c = this.buf.charCodeAt(0)
      if (!this.buf.length) break
      if (c === ENQ) { this.buf = this.buf.slice(1); this.records = []; this.partial = ''; out.push(ACK); continue }
      if (c === EOT) {
        this.buf = this.buf.slice(1)
        if (this.records.length) this.onMessage(this.records.join('\r'))
        this.records = []; this.partial = ''
        continue
      }
      if (c === STX) {
        const end = this.buf.search(/[\x03\x17]/)
        if (end < 0 || this.buf.length < end + 3) break                      // wait for the rest of the frame
        const body = this.buf.slice(1, end + 1)
        const sum = this.buf.slice(end + 1, end + 3)
        let next = end + 3
        while (next < this.buf.length && (this.buf.charCodeAt(next) === CR || this.buf.charCodeAt(next) === LF)) next++
        this.buf = this.buf.slice(next)
        if (astmChecksum(body).toUpperCase() !== sum.toUpperCase()) { out.push(NAK); continue }
        const text = body.slice(1, -1)                                         // drop frame number and ETX/ETB
        this.partial += text
        if (body.charCodeAt(body.length - 1) === ETX) {
          this.records.push(...this.partial.split('\r').filter(Boolean))
          this.partial = ''
        }
        out.push(ACK)
        continue
      }
      this.buf = this.buf.slice(1)                                             // stray byte
    }
    return out
  }
}

/** YYYYMMDD[HHMM[SS]] (analyser local time, Kenya +03:00) → ISO string, or null. */
export function astmDate(s, offset = '+03:00') {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}${offset}`
}

/** Parse ASTM E1394 record text (records separated by CR) into results per sample. */
export function parseAstmRecords(text) {
  const lines = String(text || '').split(/\r\n|\r|\n/).map((l) => l.replace(/^[0-7](?=[HPOCMRLQ]\|)/, '')).filter((l) => /^[HPOCMRLQ]\|/.test(l))
  let fd = '|', cd = '^'
  const out = []; let cur = null
  for (const l of lines) {
    if (l[0] === 'H') { fd = l[1]; cd = l[3] || '^'; continue }
    const f = l.split(fd), comp = (x) => String(x ?? '').split(cd)
    if (f[0] === 'O') {
      const sample = comp(f[2])[0] || comp(f[3])[0] || ''
      cur = { sample_id: sample.trim(), measured_at: astmDate(f[22] || f[7] || f[6]), records: [], raw: '' }
      out.push(cur); continue
    }
    if (f[0] === 'R' && cur) {
      const id = comp(f[2])
      // E1394 puts the test code in component 4 (^^^CODE); Sysmex sends ^^^^CODE^dilution — take the first non-numeric part from component 4 on
      const code = (id.slice(3).find((x) => x && !/^\d+$/.test(x)) || id.filter(Boolean).find((x) => !/^\d+$/.test(x)) || id.filter(Boolean).pop() || '').trim()
      cur.records.push({ code, value: comp(f[3])[0].trim(), unit: comp(f[4])[0].trim(), flag: String(f[6] || '').trim() })
      if (f[12] && !cur.fromResult) { cur.measured_at = astmDate(f[12]) || cur.measured_at; cur.fromResult = true }   // R.13 = test completed
    }
  }
  for (const r of out) { r.raw = lines.join('\r'); delete r.fromResult }
  return out.filter((r) => r.sample_id)
}

/** Stateful MLLP receiver: feed bytes, get complete HL7 messages via onMessage(text). */
export class MllpReceiver {
  constructor(onMessage) { this.onMessage = onMessage; this.buf = '' }
  feed(chunk) {
    this.buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    for (;;) {
      const start = this.buf.indexOf(String.fromCharCode(VT))
      const end = this.buf.indexOf(String.fromCharCode(FS) + String.fromCharCode(CR), start + 1)
      if (start < 0 || end < 0) break
      const msg = this.buf.slice(start + 1, end)
      this.buf = this.buf.slice(end + 2)
      this.onMessage(msg)
    }
  }
}

export const mllpWrap = (msg) => `${String.fromCharCode(VT)}${msg}${String.fromCharCode(FS)}\r`

/** Parse an HL7 v2 ORU message (OBR = sample, OBX = results). */
export function parseHl7(message) {
  const segs = String(message || '').split(/\r\n|\r|\n/).filter(Boolean)
  const msh = segs.find((s) => s.startsWith('MSH'))
  const fd = msh ? msh[3] : '|', cd = msh ? msh[4] : '^'
  const out = []; let cur = null
  for (const s of segs) {
    const f = s.split(fd), comp = (x) => String(x ?? '').split(cd)
    if (f[0] === 'OBR') {
      const sample = comp(f[3])[0] || comp(f[2])[0] || ''
      cur = { sample_id: sample.trim(), measured_at: astmDate(f[7]), records: [], raw: segs.join('\r') }
      out.push(cur); continue
    }
    if (f[0] === 'SPM' && cur && !cur.sample_id) { cur.sample_id = comp(f[2])[0].trim(); continue }
    if (f[0] === 'OBX' && cur) {
      const id = comp(f[3])
      const code = ((id[1] && !/^\d+-\d$/.test(id[1]) ? id[1] : '') || (id[0] && !/^\d+-\d$/.test(id[0]) ? id[0] : id[1] || id[0]) || '').trim()
      cur.records.push({ code, value: comp(f[5])[0].trim(), unit: comp(f[6])[0].trim(), flag: String(f[8] || '').trim() })
      if (!cur.measured_at && f[14]) cur.measured_at = astmDate(f[14])
    }
  }
  return out.filter((r) => r.sample_id)
}

/** HL7 ACK for a received message (MSA|AA, or AE with an error text). */
export function hl7Ack(message, ok = true, text = '') {
  const segs = String(message || '').split(/\r\n|\r|\n/)
  const msh = (segs.find((s) => s.startsWith('MSH')) || 'MSH|^~\\&').split('|')
  const now = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const control = msh[9] || ''
  return [`MSH|^~\\&|REMEDACARE|LAB|${msh[2] || ''}|${msh[3] || ''}|${now}||ACK|${control}|P|${msh[11] || '2.3.1'}`,
    `MSA|${ok ? 'AA' : 'AE'}|${control}${text ? `|${text}` : ''}`].join('\r')
}
