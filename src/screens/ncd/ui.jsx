import { colors as C, typography } from '../../theme'

export const TONES = {
  green: [C.successL, C.success], red: [C.dangerL, C.danger], yellow: [C.warnL, C.warn], gray: ['#F2F4F7', '#475467'], blue: ['#EFF8FF', '#175CD3'],
}
export const s = {
  page: { padding: '20px 24px', maxWidth: 1440, margin: '0 auto', color: C.text, fontFamily: typography.fontFamily, fontSize: 13 },
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 },
  h1: { fontSize: 22, margin: 0, color: C.textStrong },
  h2: { fontSize: 15, margin: '0 0 12px', color: C.textStrong },
  sub: { color: C.sub, fontSize: 12 },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, color: C.text, fontSize: 13 },
  btn: { padding: '8px 13px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12 },
  pri: { background: C.primary, color: '#fff' },
  ghost: { background: C.surface, color: C.text, border: `1px solid ${C.border}` },
  soft: { background: C.primaryL, color: C.primary },
  danger: { background: C.dangerL, color: C.danger },
  th: { textAlign: 'left', padding: '9px 8px', color: C.sub, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', fontSize: 11, textTransform: 'uppercase' },
  td: { padding: '9px 8px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' },
  err: { background: C.dangerL, color: C.danger, borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 12 },
  ok: { background: C.successL, color: C.success, borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: 12, fontWeight: 600 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', justifyContent: 'flex-end', zIndex: 1000 },
  drawer: { width: 640, maxWidth: '100vw', height: '100vh', overflowY: 'auto', background: C.surface, padding: 20, boxShadow: '-20px 0 60px rgba(15,23,42,.25)', boxSizing: 'border-box' },
  grid: (min = 150) => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 8 }),
}
export { C }

export function Chip({ tone = 'gray', children, title }) {
  const [bg, fg] = TONES[tone] || TONES.gray
  return <span title={title} style={{ background: bg, color: fg, borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>{children}</span>
}
