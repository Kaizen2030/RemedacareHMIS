const MAX_RESULTS = 100
const MAX_RECORDS_PER_RESULT = 500
const MAX_RECORDS_TOTAL = 2000
const MAX_RAW_LENGTH = 20000

export function validateLabPayload(value: unknown): { ok: true; payload: { results: Record<string, unknown>[] } } | { ok: false; message: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, message: 'Send a JSON object.' }
  const results = (value as Record<string, unknown>).results
  if (!Array.isArray(results) || results.length < 1 || results.length > MAX_RESULTS) {
    return { ok: false, message: `Send between 1 and ${MAX_RESULTS} results.` }
  }

  let totalRecords = 0
  for (const [resultIndex, result] of results.entries()) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return { ok: false, message: `Result ${resultIndex + 1} must be an object.` }
    const row = result as Record<string, unknown>
    if (typeof row.sample_id !== 'string' || row.sample_id.trim().length < 1 || row.sample_id.length > 120) {
      return { ok: false, message: `Result ${resultIndex + 1} needs a sample ID of 1–120 characters.` }
    }
    if (row.measured_at !== undefined && row.measured_at !== null && row.measured_at !== '') {
      if (typeof row.measured_at !== 'string' || row.measured_at.length > 64 || Number.isNaN(Date.parse(row.measured_at))) {
        return { ok: false, message: `Result ${resultIndex + 1} has an invalid measurement time.` }
      }
    }
    if (!Array.isArray(row.records) || row.records.length < 1 || row.records.length > MAX_RECORDS_PER_RESULT) {
      return { ok: false, message: `Result ${resultIndex + 1} needs 1–${MAX_RECORDS_PER_RESULT} records.` }
    }
    totalRecords += row.records.length
    if (totalRecords > MAX_RECORDS_TOTAL) return { ok: false, message: `A request can contain at most ${MAX_RECORDS_TOTAL} records.` }

    for (const [recordIndex, record] of row.records.entries()) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, message: `Result ${resultIndex + 1}, record ${recordIndex + 1} must be an object.` }
      const item = record as Record<string, unknown>
      if (typeof item.code !== 'string' || item.code.trim().length < 1 || item.code.length > 120) {
        return { ok: false, message: `Result ${resultIndex + 1}, record ${recordIndex + 1} needs an analyser code.` }
      }
      if (!['string', 'number'].includes(typeof item.value) || String(item.value).length > 120) {
        return { ok: false, message: `Result ${resultIndex + 1}, record ${recordIndex + 1} has an invalid value.` }
      }
      for (const field of ['unit', 'flag'] as const) {
        if (item[field] !== undefined && item[field] !== null && (typeof item[field] !== 'string' || item[field].length > 80)) {
          return { ok: false, message: `Result ${resultIndex + 1}, record ${recordIndex + 1} has an invalid ${field}.` }
        }
      }
    }
    if (row.raw !== undefined && row.raw !== null && (typeof row.raw !== 'string' || row.raw.length > MAX_RAW_LENGTH)) {
      return { ok: false, message: `Result ${resultIndex + 1} raw message is too long.` }
    }
  }
  return { ok: true, payload: { results: results as Record<string, unknown>[] } }
}
