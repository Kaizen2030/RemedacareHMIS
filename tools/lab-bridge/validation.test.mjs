import { describe, expect, it } from 'vitest'
import { validateLabPayload } from '../../supabase/functions/_shared/labIngestValidation.ts'

const validPayload = {
  results: [{
    sample_id: 'LAB-001',
    measured_at: '2026-11-15T08:30:00+03:00',
    records: [{ code: 'WBC', value: '3.2', unit: '10*9/L', flag: 'L' }],
  }],
}

describe('lab ingest payload validation', () => {
  it('accepts a bounded result batch', () => {
    expect(validateLabPayload(validPayload)).toEqual({ ok: true, payload: validPayload })
  })

  it('rejects empty results, missing barcodes, invalid timestamps and oversized raw messages', () => {
    expect(validateLabPayload({ results: [] }).ok).toBe(false)
    expect(validateLabPayload({ results: [{ ...validPayload.results[0], sample_id: '' }] }).ok).toBe(false)
    expect(validateLabPayload({ results: [{ ...validPayload.results[0], measured_at: 'yesterday' }] }).ok).toBe(false)
    expect(validateLabPayload({ results: [{ ...validPayload.results[0], raw: 'x'.repeat(20001) }] }).ok).toBe(false)
  })
})
