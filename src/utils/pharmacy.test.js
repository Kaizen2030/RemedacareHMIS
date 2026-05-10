import { findInventoryMatch, normalizeDrugText } from './pharmacy'

describe('pharmacy utilities', () => {
  it('normalizes drug names into searchable text', () => {
    expect(normalizeDrugText(' Amox/Clav 625mg ')).toBe('amox clav 625mg')
    expect(normalizeDrugText(null)).toBe('')
  })

  it('finds the best inventory match from exact and fuzzy candidates', () => {
    const inventory = [
      { id: '1', drug_name: 'Amoxicillin', generic_name: 'Amoxicillin', category: 'Antibiotic', strength: '500mg' },
      { id: '2', drug_name: 'Co-amoxiclav', generic_name: 'Amoxicillin Clavulanate', category: 'Antibiotic', strength: '625mg' },
      { id: '3', drug_name: 'Ceftriaxone', generic_name: 'Ceftriaxone', category: 'Injection', strength: '1g' },
    ]

    expect(findInventoryMatch('Co Amoxiclav 625', inventory)?.id).toBe('2')
    expect(findInventoryMatch('ctx', inventory)?.id).toBe('3')
    expect(findInventoryMatch('unknown', inventory)).toBeNull()
  })
})
