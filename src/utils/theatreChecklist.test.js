import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WHO_PHASES, aldreteTotal, caseStage, phaseProblem } from './theatreChecklist'

describe('WHO checklist', () => {
  it('matches the database item for item (keys and acceptable answers)', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261203000000_theatre.sql'), 'utf8')
    for (const [phase, def] of Object.entries(WHO_PHASES)) {
      const block = sql.split(`when '${phase}' then '{`)[1].split("}'::jsonb")[0]
      const dbItems = JSON.parse(`{${block}}`)
      expect(Object.keys(dbItems).sort(), phase).toEqual(def.items.map((i) => i.key).sort())
      for (const i of def.items) expect(dbItems[i.key].sort(), `${phase}.${i.key}`).toEqual(i.options.map(([v]) => v).sort())
    }
  })
  it('reports the first missing or unsafe item', () => {
    expect(phaseProblem('sign_out', { procedure_recorded: 'yes', counts_correct: 'no' })).toMatch(/counts/)
    expect(phaseProblem('time_out', { team_introduced: 'yes', patient_site_procedure: 'yes', antibiotics: 'na', critical_events: 'yes', sterility: 'yes', imaging: 'na' })).toBe('')
  })
  it('adds up the Aldrete score and tracks the stage', () => {
    expect(aldreteTotal({ activity: 2, respiration: 2, circulation: 2, consciousness: 1, spo2: 2 })).toBe(9)
    expect(aldreteTotal({ activity: 2 })).toBe(null)
    expect(caseStage({ sign_in_at: 'x', time_out_at: 'y' })).toBe('time_out_done')
    expect(caseStage({ status: 'completed' })).toBe('completed')
  })
})
