import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLINICAL_GUIDES } from './clinicalGuides'

const app = readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8')

describe('clinical guides content', () => {
  it('every guide has a unique id, a version, content and sources', () => {
    const ids = CLINICAL_GUIDES.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining(['resistant-organisms', 'sepsis', 'tb-drugs', 'endocarditis-emboli', 'influenza-high-risk', 'urinalysis',
      'malaria', 'meningitis', 'pneumonia', 'uti', 'typhoid', 'hiv-oi', 'surgical-prophylaxis']))
    for (const g of CLINICAL_GUIDES) {
      expect(g.version).toMatch(/^\d{4}-\d{2}$/)
      expect(g.sections.length).toBeGreaterThan(1)
      for (const sec of g.sections) expect(sec.points.length).toBeGreaterThan(0)
      expect(g.sources.length).toBeGreaterThan(0)
    }
  })

  it('every "In RemedacareHMS" link goes to a real screen or guide', () => {
    for (const g of CLINICAL_GUIDES) {
      for (const l of g.inSystem || []) {
        const [path, query] = l.path.split('?')
        expect(app.includes(`'${path}'`), `${g.id}: ${l.path}`).toBe(true)
        if (query?.startsWith('guide=')) expect(CLINICAL_GUIDES.some((x) => x.id === query.slice(6)), `${g.id}: ${l.path}`).toBe(true)
      }
    }
  })
})
