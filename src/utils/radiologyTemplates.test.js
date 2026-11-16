import { describe, expect, it } from 'vitest'
import { IONISING, buildReport, suggestCritical, suggestTemplate } from './radiologyTemplates'

describe('radiology templates', () => {
  it('picks a template from modality and body region', () => {
    expect(suggestTemplate('X-Ray', 'Chest')).toBe('chest_xray')
    expect(suggestTemplate('Ultrasound', 'Obstetric')).toBe('obstetric_us')
    expect(suggestTemplate('CT', 'Head')).toBe('ct_head')
    expect(suggestTemplate('X-Ray', 'Left wrist')).toBe('msk_xray')
    expect(suggestTemplate('MRI', 'Knee')).toBe('free')
  })
  it('builds report text from answered fields only', () => {
    expect(buildReport('chest_xray', { projection: 'PA', lungs: 'Right upper lobe cavitation', pleura: '' })).toBe('Projection: PA\nLungs and airways: Right upper lobe cavitation')
  })
  it('suggests critical findings', () => {
    expect(suggestCritical('obstetric_us', { cardiac: 'Absent' })).toMatch(/cardiac/)
    expect(suggestCritical('ct_head', { haemorrhage: 'Subdural' })).toMatch(/Subdural/)
    expect(suggestCritical('chest_xray', {}, 'Large right tension pneumothorax')).toMatch(/life-threatening/)
    expect(suggestCritical('chest_xray', { lungs: 'Clear' })).toBe('')
  })
  it('knows which modalities use ionising radiation (same rule as the database)', () => {
    expect(['X-Ray', 'CT', 'Fluoroscopy', 'Mammography'].every((m) => IONISING.test(m))).toBe(true)
    expect(['Ultrasound', 'MRI', 'ECG / Echo'].some((m) => IONISING.test(m))).toBe(false)
  })
})
