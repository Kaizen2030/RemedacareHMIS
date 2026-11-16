import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getStoredThemeMode, THEME_MODES, THEME_STORAGE_KEY } from './theme'

describe('startup theme', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.matchMedia = vi.fn(() => ({ matches: true }))
  })

  it('starts in light mode and clears an old dark preference even when the device prefers dark', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, THEME_MODES.dark)

    expect(getStoredThemeMode()).toBe(THEME_MODES.light)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(THEME_MODES.light)
    expect(window.matchMedia).not.toHaveBeenCalled()
  })
})
