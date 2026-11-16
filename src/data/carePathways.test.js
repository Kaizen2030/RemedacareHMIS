import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARE_PATHWAYS, PATHWAY_VERSION, suggestPathwayId } from './carePathways'
import { CLINICAL_GUIDES } from './clinicalGuides'
import { EUCAST_DOSAGES, eucastDoseNote } from './eucastDosages'

const root = process.cwd()
const app = readFileSync(join(root, 'src', 'App.jsx'), 'utf8')
const consultation = readFileSync(join(root, 'src', 'screens', 'consultation', 'index.jsx'), 'utf8')
const micro = readFileSync(join(root, 'supabase', 'migrations', '20261221000000_microbiology.sql'), 'utf8')

describe('care pathways content', () => {
  it('every pathway is complete: unique id, steps with points, red flags and http(s) sources', () => {
    const ids = CARE_PATHWAYS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(CARE_PATHWAYS.length).toBeGreaterThanOrEqual(15)
    for (const p of CARE_PATHWAYS) {
      expect(p.title && p.summary && p.category, p.id).toBeTruthy()
      expect(p.stages.length, p.id).toBeGreaterThanOrEqual(3)
      for (const st of p.stages) {
        expect(st.heading, p.id).toBeTruthy()
        expect(st.points.length, `${p.id}: ${st.heading}`).toBeGreaterThan(0)
      }
      expect(p.redFlags.length, p.id).toBeGreaterThan(0)
      expect(p.sources.length, p.id).toBeGreaterThan(0)
      for (const src of p.sources) if (src.url) expect(src.url, p.id).toMatch(/^https:\/\//)
    }
    expect(PATHWAY_VERSION).toMatch(/^\d{4}-\d{2}$/)
  })

  it('keeps every pathway id the consultation screen can suggest', () => {
    const suggested = [...consultation.matchAll(/return '([a-z0-9-]+)'/g)].map((m) => m[1])
      .concat([...consultation.matchAll(/\? '([a-z0-9-]+)' : '([a-z0-9-]+)'/g)].flatMap((m) => [m[1], m[2]]))
      .filter((id) => /malaria|hiv|diabetes|hypertension|tb-|pneumonia/.test(id))
    expect(suggested.length).toBeGreaterThan(5)
    for (const id of suggested) expect(CARE_PATHWAYS.some((p) => p.id === id), id).toBe(true)
  })

  it('links only to real guides and screens', () => {
    for (const p of CARE_PATHWAYS) {
      for (const g of p.guideIds) expect(CLINICAL_GUIDES.some((x) => x.id === g), `${p.id}: guide ${g}`).toBe(true)
      for (const l of p.inSystem) expect(app.includes(`'${l.path}'`), `${p.id}: ${l.path}`).toBe(true)
    }
  })

  it('suggests a pathway from an id or from diagnosis words, preferring the most specific match', () => {
    expect(suggestPathwayId(CARE_PATHWAYS, 'malaria-severe')).toBe('malaria-severe')
    expect(suggestPathwayId(CARE_PATHWAYS, null, 'Severe malaria with prostration')).toBe('malaria-severe')
    expect(suggestPathwayId(CARE_PATHWAYS, null, 'Malaria, uncomplicated')).toBe('malaria-uncomplicated')
    expect(suggestPathwayId(CARE_PATHWAYS, null, 'Urosepsis with septic shock')).toBe('sepsis-adult')
    expect(suggestPathwayId(CARE_PATHWAYS, null, 'VAP day 6 on ventilator')).toBe('hap-vap')
    expect(suggestPathwayId(CARE_PATHWAYS, null, 'Severe pre-eclampsia at 34 weeks')).toBe('pre-eclampsia')
    expect(suggestPathwayId(CARE_PATHWAYS, null, 'Sprained ankle')).toBe('')
    const own = [...CARE_PATHWAYS, { id: 'local-1', match: ['snakebite'] }]
    expect(suggestPathwayId(own, null, 'Snakebite to the left foot')).toBe('local-1')
  })
})

describe('EUCAST dosages', () => {
  it('only uses antibiotic codes the microbiology module knows', () => {
    for (const code of Object.keys(EUCAST_DOSAGES)) expect(micro.includes(`('${code}', '`), code).toBe(true)
  })
  it('explains what an I result needs', () => {
    expect(eucastDoseNote('MEM', 'I')).toBe('Needs the high dosage: 2 g × 3 IV over 3 hours')
    expect(eucastDoseNote('MEM', 'S')).toMatch(/standard dosage: 1 g × 3/)
    expect(eucastDoseNote('ETP', 'I')).toBeNull()
    expect(eucastDoseNote('MEM', 'R')).toBeNull()
    expect(eucastDoseNote('XXX', 'I')).toBeNull()
  })
})
