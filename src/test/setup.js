import '@testing-library/jest-dom'
import { vi } from 'vitest'

if (!window.notifyFromLegacyAlert) {
  window.notifyFromLegacyAlert = vi.fn()
}

if (!window.alert) {
  window.alert = vi.fn()
}
