export const APP_SHORTCUTS = [
  { id: 'dashboard', label: 'Dashboard', combo: 'G then D', keys: ['g', 'd'], path: '/dashboard', type: 'navigation' },
  { id: 'patients', label: 'Patients', combo: 'G then P', keys: ['g', 'p'], path: '/patients', type: 'navigation' },
  { id: 'appointments', label: 'Appointments', combo: 'G then A', keys: ['g', 'a'], path: '/appointments', type: 'navigation' },
  { id: 'laboratory', label: 'Laboratory', combo: 'G then L', keys: ['g', 'l'], path: '/laboratory', type: 'navigation' },
  { id: 'pharmacy', label: 'Pharmacy', combo: 'G then H', keys: ['g', 'h'], path: '/pharmacy', type: 'navigation' },
  { id: 'billing', label: 'Billing', combo: 'G then B', keys: ['g', 'b'], path: '/billing', type: 'navigation' },
  { id: 'search', label: 'Search', combo: 'Ctrl/Cmd + K', type: 'command' },
  { id: 'help', label: 'Keyboard shortcuts', combo: '?', type: 'command' },
]

export function resolveShortcutSequence(keys) {
  const matches = APP_SHORTCUTS.filter((shortcut) => shortcut.keys && keys.every((key, index) => shortcut.keys[index] === key))
  return {
    exact: matches.find((shortcut) => shortcut.keys.length === keys.length) || null,
    hasLongerPrefix: matches.some((shortcut) => shortcut.keys.length > keys.length),
  }
}

export function shouldIgnoreShortcutTarget(target) {
  const element = target instanceof Element ? target : null
  if (!element) return false
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
}
