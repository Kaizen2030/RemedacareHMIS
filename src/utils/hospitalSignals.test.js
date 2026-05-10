import {
  getSusceptibilityEntries,
  normalizeSusceptibilityKey,
  normalizeSusceptibilityProfile,
} from './hospitalSignals'

describe('hospitalSignals', () => {
  it('normalizes susceptibility keys into a stable format', () => {
    expect(normalizeSusceptibilityKey(' Ceftriaxone / 1g ')).toBe('ceftriaxone_1g')
    expect(normalizeSusceptibilityKey(null)).toBe('')
  })

  it('builds a clean susceptibility profile from mixed object input', () => {
    expect(normalizeSusceptibilityProfile({
      Ceftriaxone: ' s ',
      'Amox / Clav': { sir: 'R', label: 'Amox/Clav' },
      Invalid: { sir: 'maybe' },
      Blank: '',
    })).toEqual({
      ceftriaxone: { key: 'ceftriaxone', label: 'Ceftriaxone', sir: 'S' },
      amox_clav: { key: 'amox_clav', label: 'Amox/Clav', sir: 'R' },
    })
  })

  it('returns sorted susceptibility entries and ignores malformed values', () => {
    const result = getSusceptibilityEntries({
      susceptibility_profile: {
        Amikacin: { sir: 'S' },
        Cefepime: { sir: 'NT' },
      },
      meropenem: 'R',
      piperacillin_tazobactam: 'bad-value',
      nitrofurantoin: null,
    })

    expect(result).toEqual([
      { key: 'amikacin', label: 'Amikacin', sir: 'S' },
      { key: 'meropenem', label: 'Meropenem', sir: 'R' },
    ])
  })

  it('can include not-tested entries when requested', () => {
    const result = getSusceptibilityEntries({
      susceptibility_profile: [{ key: 'cefazolin', sir: 'NT' }],
    }, { includeNotTested: true })

    expect(result).toEqual([{ key: 'cefazolin', label: 'Cefazolin', sir: 'NT' }])
  })

  it('handles empty and null result payloads safely', () => {
    expect(getSusceptibilityEntries(null)).toEqual([])
    expect(normalizeSusceptibilityProfile(null)).toEqual({})
  })
})
