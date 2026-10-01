import { describe, expect, it } from 'vitest'
import { generateSampleBarcode, getSampleStatusFromLabRow } from './labWorkflow'

describe('lab workflow helpers', () => {
  it('generates a sample barcode with a stable prefix and unique suffix', () => {
    const date = new Date('2026-01-02T03:04:05.000Z')
    const first = generateSampleBarcode(date)
    const second = generateSampleBarcode(date)

    expect(first).toMatch(/^SMP-1767323045000-[A-Z0-9]{6}$/)
    expect(second).not.toBe(first)
  })

  it('maps lab rows to the recognized sample workflow states', () => {
    expect(getSampleStatusFromLabRow({})).toBe('Ordered')
    expect(getSampleStatusFromLabRow({ sample_collected_at: 'now' })).toBe('Collected')
    expect(getSampleStatusFromLabRow({ status: 'In Progress' })).toBe('In Progress')
    expect(getSampleStatusFromLabRow({ results_ready_at: 'now' })).toBe('Resulted')
    expect(getSampleStatusFromLabRow({ sample_status: 'Referred Out', status: 'In Progress' })).toBe('Referred Out')
  })
})