function parseRows(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const input = String(text || '').replace(/^\uFEFF/, '')

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++ }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"' && field === '') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.')
  row.push(field)
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows
}

const normalizeHeader = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
const firstHeader = (headers, names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0)

export function parseCsvResults(text) {
  const rows = parseRows(text)
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one result row.')

  const headers = rows[0].map(normalizeHeader)
  const columns = {
    sample: firstHeader(headers, ['sample_id', 'sample_barcode', 'barcode', 'sample']),
    code: firstHeader(headers, ['code', 'analyte', 'test_code']),
    value: firstHeader(headers, ['value', 'result', 'result_value']),
    measuredAt: firstHeader(headers, ['measured_at', 'measured_time', 'test_completed']),
    unit: firstHeader(headers, ['unit', 'units']),
    flag: firstHeader(headers, ['flag', 'abnormal_flag']),
  }
  if (columns.sample === undefined || columns.code === undefined || columns.value === undefined) {
    throw new Error('CSV headers must include sample_id, code and value (sample_barcode/analyte/result are also accepted).')
  }

  const grouped = new Map()
  for (const [index, cells] of rows.slice(1).entries()) {
    const rowNumber = index + 2
    const sampleId = String(cells[columns.sample] || '').trim()
    const code = String(cells[columns.code] || '').trim()
    const value = String(cells[columns.value] || '').trim()
    if (!sampleId && !code && !value) continue
    if (!sampleId || !code || !value) throw new Error(`CSV row ${rowNumber} needs sample_id, code and value.`)
    const measuredAt = columns.measuredAt === undefined ? '' : String(cells[columns.measuredAt] || '').trim()
    const groupKey = `${sampleId}\u0000${measuredAt}`
    let result = grouped.get(groupKey)
    if (!result) {
      result = { sample_id: sampleId, records: [] }
      if (measuredAt) result.measured_at = measuredAt
      grouped.set(groupKey, result)
    }
    result.records.push({
      code,
      value,
      unit: columns.unit === undefined ? '' : String(cells[columns.unit] || '').trim(),
      flag: columns.flag === undefined ? '' : String(cells[columns.flag] || '').trim(),
    })
  }

  if (!grouped.size) throw new Error('CSV has no valid result rows.')
  return [...grouped.values()]
}
