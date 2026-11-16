import { describe, expect, it } from 'vitest'
import { ageInYears, doseMg, egfrCkdEpi2021, identifyDrugs, runCds, timesPerDay } from './cds'

const rules = (alerts) => alerts.map((a) => `${a.severity}:${a.rule}`)
const rx = (drug_name, dosage = '', frequency = '') => ({ drug_name, dosage, frequency })

describe('drug identification and dose parsing', () => {
  it('finds generics, brands and combination products', () => {
    expect(identifyDrugs('Augmentin 625mg').map((d) => d.id)).toEqual(['co-amoxiclav'])
    expect(identifyDrugs('TLD (TDF/3TC/DTG)').map((d) => d.id).sort()).toEqual(['dolutegravir', 'tenofovir'])
    expect(identifyDrugs('RHZE tabs').map((d) => d.id).sort()).toEqual(['ethambutol', 'isoniazid', 'pyrazinamide', 'rifampicin'])
    expect(identifyDrugs('Panadol')[0].id).toBe('paracetamol')
    expect(identifyDrugs('Vitamin C')).toEqual([])
  })
  it('parses doses and frequencies', () => {
    expect(doseMg('500mg')).toBe(500)
    expect(doseMg('1 g')).toBe(1000)
    expect(doseMg('250mg/5ml 10ml')).toBe(500)
    expect(doseMg('125 mcg')).toBe(0.125)
    expect(doseMg('2 tabs')).toBeNull()
    expect(timesPerDay('TDS')).toBe(3)
    expect(timesPerDay('8 hourly')).toBe(3)
    expect(timesPerDay('BD')).toBe(2)
    expect(timesPerDay('nocte')).toBe(1)
    expect(timesPerDay('PRN')).toBeNull()
    expect(timesPerDay('Every 8 hours')).toBe(3)
    expect(timesPerDay('Every 6 hours')).toBe(4)
    expect(timesPerDay('Three times daily')).toBe(3)
    expect(timesPerDay('Four times daily')).toBe(4)
    expect(timesPerDay('Stat (once)')).toBe(1)
    expect(timesPerDay('As needed')).toBeNull()
  })
  it('age and eGFR', () => {
    expect(ageInYears({ age: '8 months' })).toBeCloseTo(0.667, 2)
    expect(ageInYears({ age: 45 })).toBe(45)
    expect(egfrCkdEpi2021(80, 50, 'Male')).toBeGreaterThan(90)
    expect(egfrCkdEpi2021(300, 70, 'Female')).toBeLessThan(15)
    expect(egfrCkdEpi2021(80, 10, 'Male')).toBeNull()
  })
})

describe('runCds', () => {
  it('allergy: direct and class match block; cross-reactivity warns; "NKDA" is ignored', () => {
    expect(rules(runCds({ rows: [rx('Amoxicillin')], patient: { allergies: 'Penicillin - rash' } }))).toContain('danger:allergy')
    expect(rules(runCds({ rows: [rx('Ceftriaxone')], patient: { allergies: 'penicillin' } }))).toContain('warning:allergy_cross')
    expect(rules(runCds({ rows: [rx('Septrin')], patient: { allergies: 'sulfa drugs' } }))).toContain('danger:allergy')
    expect(runCds({ rows: [rx('Amoxicillin')], patient: { allergies: 'NKDA' } })).toEqual([])
    expect(runCds({ rows: [rx('Aspirin 75mg', '75mg', 'OD')], patient: { allergies: 'seasonal hay fever', age: 60 } })).toEqual([])
  })
  it('adult dose limits', () => {
    expect(rules(runCds({ rows: [rx('Paracetamol', '1g', 'QID')], patient: { age: 40 } }))).toEqual([])
    expect(rules(runCds({ rows: [rx('Paracetamol', '1.5g', 'TDS')], patient: { age: 40 } }))).toContain('danger:dose_single:paracetamol')
    expect(rules(runCds({ rows: [rx('Paracetamol', '1g', '4 hourly')], patient: { age: 40 } }))).toContain('danger:dose_daily:paracetamol')
  })
  it('paediatric dose by weight, and asks for weight when missing', () => {
    expect(rules(runCds({ rows: [rx('Paracetamol syrup', '120mg/5ml 5ml', 'QID')], patient: { age: 2, weight_kg: 12 } }))).toEqual([])
    expect(rules(runCds({ rows: [rx('Paracetamol', '500mg', 'TDS')], patient: { age: 2, weight_kg: 12 } }))).toContain('danger:dose_paed:paracetamol')
    expect(rules(runCds({ rows: [rx('Paracetamol', '120mg', 'TDS')], patient: { age: 2 } }))).toContain('info:dose_paed_weight:paracetamol')
  })
  it('age, pregnancy and kidney rules', () => {
    expect(rules(runCds({ rows: [rx('Aspirin')], patient: { age: 6 } }))).toContain('danger:min_age:aspirin')
    expect(rules(runCds({ rows: [rx('Doxycycline')], patient: { age: 30, pregnant: true } }))).toContain('danger:pregnancy:doxycycline')
    expect(rules(runCds({ rows: [rx('Enalapril')], patient: { age: 30, pregnancy_status: 'Pregnant' } }))).toContain('danger:pregnancy:enalapril')
    expect(rules(runCds({ rows: [rx('Metformin', '500mg', 'BD')], patient: { age: 60 }, labs: { egfr: 25 } }))).toContain('danger:renal:metformin')
    expect(rules(runCds({ rows: [rx('Metformin', '500mg', 'BD')], patient: { age: 60 }, labs: { egfr: 40 } }))).toContain('warning:renal:metformin')
    expect(rules(runCds({ rows: [rx('TLD')], patient: { age: 60, sex: 'F' }, labs: { creatinine: 250 } }))).toContain('danger:renal:tenofovir')
  })
  it('interactions with new drugs and with what the patient already takes', () => {
    const a = runCds({ rows: [rx('Ibuprofen')], activeMeds: ['Warfarin 5mg'], patient: { age: 70 } })
    expect(a[0]).toMatchObject({ rowIndex: 0, severity: 'danger', rule: 'interaction:warfarin+nsaid' })
    expect(a[0].message).toMatch(/already taking/)
    expect(rules(runCds({ rows: [rx('Sildenafil'), rx('Isosorbide dinitrate')], patient: { age: 60 } }))).toContain('danger:interaction:pde5 inhibitor+nitrate')
    expect(rules(runCds({ rows: [rx('Rifampicin')], activeMeds: ['TLD'], patient: { age: 30 } }))).toContain('danger:interaction:rifamycin+dolutegravir')
    expect(rules(runCds({ rows: [rx('Ferrous sulphate')], activeMeds: ['Dolutegravir'], patient: { age: 30 } }))).toContain('warning:interaction:dolutegravir+polyvalent cation')
    // two drugs the patient already takes are not re-flagged
    expect(runCds({ rows: [rx('Paracetamol')], activeMeds: ['Warfarin', 'Ibuprofen'], patient: { age: 70 } })).toEqual([])
  })
  it('hospital interaction rules from the database are applied', () => {
    expect(rules(runCds({ rows: [rx('Amlodipine'), rx('Simvastatin')], extraInteractions: [{ a: 'amlodipine', b: 'simvastatin', severity: 'moderate', message: 'Max simvastatin 20 mg' }], patient: { age: 50 } })))
      .toContain('warning:interaction:amlodipine+simvastatin')
  })
  it('duplicate therapy', () => {
    expect(rules(runCds({ rows: [rx('Ibuprofen'), rx('Diclofenac')], patient: { age: 40 } }))).toContain('warning:duplicate:nsaid')
    expect(rules(runCds({ rows: [rx('Omeprazole')], activeMeds: ['Esomeprazole'], patient: { age: 40 } }))).toContain('warning:duplicate:ppi')
    expect(runCds({ rows: [rx('TLD')], patient: { age: 40 } })).toEqual([])
  })
  it('abnormal potassium with drugs that raise it', () => {
    expect(rules(runCds({ rows: [rx('Spironolactone')], labs: { potassium: 5.9 }, patient: { age: 60 } }))).toContain('danger:lab_potassium')
  })
})
