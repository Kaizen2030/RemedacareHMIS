export const THEME_STORAGE_KEY = 'remedacare:theme-mode'

export const THEME_MODES = {
  light: 'light',
  dark: 'dark',
}

export const LIGHT_PALETTE = {
  primary: '#5B21B6',
  primaryDark: '#3B0764',
  primaryL: '#F3E8FF',
  accent: '#D4AF37',
  success: '#16A34A',
  successL: '#F0FDF4',
  danger: '#DC2626',
  dangerDark: '#B91C1C',
  dangerL: '#FEF2F2',
  dangerSoft: '#FEE2E2',
  warn: '#D97706',
  warnDark: '#C07000',
  warnL: '#FFFBEB',
  blue: '#2563EB',
  blueL: '#EFF6FF',
  info: '#3B82F6',
  purple: '#7C3AED',
  purpleL: '#F5F3FF',
  teal: '#0891B2',
  tealL: '#ECFEFF',
  orange: '#EA580C',
  orangeL: '#FFF7ED',
  pink: '#EC4899',
  text: '#111827',
  textStrong: '#111111',
  sub: '#6B7280',
  subStrong: '#4B5563',
  muted: '#9CA3AF',
  mutedStrong: '#64748B',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  border: '#E9DDF7',
  borderSoft: '#F0E6FB',
  bg: '#FFFFFF',
  bgAlt: '#FAF7FF',
  panel: '#FFFFFF',
  white: '#FFFFFF',
  overlay: 'rgba(15, 23, 42, 0.42)',
  chartBars: ['#5B21B6', '#D4AF37', '#3B82F6', '#E24B4A', '#8B5CF6', '#14B8A6', '#F97316', '#EC4899'],
}

export const DARK_PALETTE = {
  primary: '#C4B5FD',
  primaryDark: '#5B21B6',
  primaryL: '#24123D',
  accent: '#F2D16B',
  success: '#22C55E',
  successL: '#13281E',
  danger: '#F87171',
  dangerDark: '#DC2626',
  dangerL: '#33191D',
  dangerSoft: '#4C1D24',
  warn: '#F59E0B',
  warnDark: '#D97706',
  warnL: '#3B2B0D',
  blue: '#60A5FA',
  blueL: '#16243C',
  info: '#60A5FA',
  purple: '#A78BFA',
  purpleL: '#281E46',
  teal: '#22D3EE',
  tealL: '#152B32',
  orange: '#FB923C',
  orangeL: '#3B2414',
  pink: '#F472B6',
  text: '#F1F5F9',
  textStrong: '#FFFFFF',
  sub: '#94A3B8',
  subStrong: '#CBD5E1',
  muted: '#64748B',
  mutedStrong: '#94A3B8',
  surface: '#1A1D27',
  card: '#171B24',
  border: '#45315E',
  borderSoft: '#56416E',
  bg: '#0F1117',
  bgAlt: '#141827',
  panel: '#161A22',
  white: '#FFFFFF',
  overlay: 'rgba(2, 6, 23, 0.62)',
  chartBars: ['#C4B5FD', '#F2D16B', '#60A5FA', '#F87171', '#A78BFA', '#22D3EE', '#FB923C', '#F472B6'],
}

function cssVar(name, fallback) {
  return `var(${name}, ${fallback})`
}

export const colors = {
  primary: cssVar('--color-primary', LIGHT_PALETTE.primary),
  primaryDark: cssVar('--color-primary-dark', LIGHT_PALETTE.primaryDark),
  primaryL: cssVar('--color-primary-light', LIGHT_PALETTE.primaryL),
  accent: cssVar('--color-accent', LIGHT_PALETTE.accent),
  success: cssVar('--color-success', LIGHT_PALETTE.success),
  successL: cssVar('--color-success-light', LIGHT_PALETTE.successL),
  danger: cssVar('--color-danger', LIGHT_PALETTE.danger),
  dangerDark: cssVar('--color-danger-dark', LIGHT_PALETTE.dangerDark),
  dangerL: cssVar('--color-danger-light', LIGHT_PALETTE.dangerL),
  dangerSoft: cssVar('--color-danger-soft', LIGHT_PALETTE.dangerSoft),
  warn: cssVar('--color-warn', LIGHT_PALETTE.warn),
  warnDark: cssVar('--color-warn-dark', LIGHT_PALETTE.warnDark),
  warnL: cssVar('--color-warn-light', LIGHT_PALETTE.warnL),
  blue: cssVar('--color-blue', LIGHT_PALETTE.blue),
  blueL: cssVar('--color-blue-light', LIGHT_PALETTE.blueL),
  info: cssVar('--color-info', LIGHT_PALETTE.info),
  purple: cssVar('--color-purple', LIGHT_PALETTE.purple),
  purpleL: cssVar('--color-purple-light', LIGHT_PALETTE.purpleL),
  teal: cssVar('--color-teal', LIGHT_PALETTE.teal),
  tealL: cssVar('--color-teal-light', LIGHT_PALETTE.tealL),
  orange: cssVar('--color-orange', LIGHT_PALETTE.orange),
  orangeL: cssVar('--color-orange-light', LIGHT_PALETTE.orangeL),
  pink: cssVar('--color-pink', LIGHT_PALETTE.pink),
  text: cssVar('--color-text', LIGHT_PALETTE.text),
  textStrong: cssVar('--color-text-strong', LIGHT_PALETTE.textStrong),
  sub: cssVar('--color-sub', LIGHT_PALETTE.sub),
  subStrong: cssVar('--color-sub-strong', LIGHT_PALETTE.subStrong),
  muted: cssVar('--color-muted', LIGHT_PALETTE.muted),
  mutedStrong: cssVar('--color-muted-strong', LIGHT_PALETTE.mutedStrong),
  surface: cssVar('--color-surface', LIGHT_PALETTE.surface),
  card: cssVar('--color-card', LIGHT_PALETTE.card),
  border: cssVar('--color-border', LIGHT_PALETTE.border),
  borderSoft: cssVar('--color-border-soft', LIGHT_PALETTE.borderSoft),
  bg: cssVar('--color-bg', LIGHT_PALETTE.bg),
  bgAlt: cssVar('--color-bg-alt', LIGHT_PALETTE.bgAlt),
  panel: cssVar('--color-panel', LIGHT_PALETTE.panel),
  white: cssVar('--color-white', LIGHT_PALETTE.white),
  overlay: cssVar('--color-overlay', LIGHT_PALETTE.overlay),
  chartBars: [
    cssVar('--chart-bar-1', LIGHT_PALETTE.chartBars[0]),
    cssVar('--chart-bar-2', LIGHT_PALETTE.chartBars[1]),
    cssVar('--chart-bar-3', LIGHT_PALETTE.chartBars[2]),
    cssVar('--chart-bar-4', LIGHT_PALETTE.chartBars[3]),
    cssVar('--chart-bar-5', LIGHT_PALETTE.chartBars[4]),
    cssVar('--chart-bar-6', LIGHT_PALETTE.chartBars[5]),
    cssVar('--chart-bar-7', LIGHT_PALETTE.chartBars[6]),
    cssVar('--chart-bar-8', LIGHT_PALETTE.chartBars[7]),
  ],
}

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  xxl: '24px',
}

export const typography = {
  fontFamily: "'DM Sans','Segoe UI',sans-serif",
  systemFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: 'monospace',
}

export function getThemePalette(mode = THEME_MODES.light) {
  return mode === THEME_MODES.dark ? DARK_PALETTE : LIGHT_PALETTE
}

export function getStoredThemeMode() {
  if (typeof window === 'undefined') return THEME_MODES.light
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === THEME_MODES.dark || stored === THEME_MODES.light) return stored
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return THEME_MODES.dark
  return THEME_MODES.light
}

export function applyThemeMode(mode = THEME_MODES.light) {
  if (typeof document === 'undefined') return

  const palette = getThemePalette(mode)
  const root = document.documentElement
  root.dataset.theme = mode
  root.style.colorScheme = mode
  root.style.setProperty('--color-primary', palette.primary)
  root.style.setProperty('--color-primary-dark', palette.primaryDark)
  root.style.setProperty('--color-primary-light', palette.primaryL)
  root.style.setProperty('--color-accent', palette.accent)
  root.style.setProperty('--color-success', palette.success)
  root.style.setProperty('--color-success-light', palette.successL)
  root.style.setProperty('--color-danger', palette.danger)
  root.style.setProperty('--color-danger-dark', palette.dangerDark)
  root.style.setProperty('--color-danger-light', palette.dangerL)
  root.style.setProperty('--color-danger-soft', palette.dangerSoft)
  root.style.setProperty('--color-warn', palette.warn)
  root.style.setProperty('--color-warn-dark', palette.warnDark)
  root.style.setProperty('--color-warn-light', palette.warnL)
  root.style.setProperty('--color-blue', palette.blue)
  root.style.setProperty('--color-blue-light', palette.blueL)
  root.style.setProperty('--color-info', palette.info)
  root.style.setProperty('--color-purple', palette.purple)
  root.style.setProperty('--color-purple-light', palette.purpleL)
  root.style.setProperty('--color-teal', palette.teal)
  root.style.setProperty('--color-teal-light', palette.tealL)
  root.style.setProperty('--color-orange', palette.orange)
  root.style.setProperty('--color-orange-light', palette.orangeL)
  root.style.setProperty('--color-pink', palette.pink)
  root.style.setProperty('--color-text', palette.text)
  root.style.setProperty('--color-text-strong', palette.textStrong)
  root.style.setProperty('--color-sub', palette.sub)
  root.style.setProperty('--color-sub-strong', palette.subStrong)
  root.style.setProperty('--color-muted', palette.muted)
  root.style.setProperty('--color-muted-strong', palette.mutedStrong)
  root.style.setProperty('--color-surface', palette.surface)
  root.style.setProperty('--color-card', palette.card)
  root.style.setProperty('--color-border', palette.border)
  root.style.setProperty('--color-border-soft', palette.borderSoft)
  root.style.setProperty('--color-bg', palette.bg)
  root.style.setProperty('--color-bg-alt', palette.bgAlt)
  root.style.setProperty('--color-panel', palette.panel)
  root.style.setProperty('--color-white', palette.white)
  root.style.setProperty('--color-overlay', palette.overlay)
  palette.chartBars.forEach((color, index) => {
    root.style.setProperty(`--chart-bar-${index + 1}`, color)
  })

  document.body.style.background = palette.bg
  document.body.style.color = palette.text
  document.body.style.fontFamily = typography.systemFontFamily

  const metaTheme = document.querySelector('meta[name="theme-color"]')
  if (metaTheme) {
    metaTheme.setAttribute('content', palette.bg)
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
  }
}
