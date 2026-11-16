// Search-as-you-type ICD-10 picker (with the ICD-11 code where mapped). Keyboard: ↑ ↓ Enter Esc.
import { useEffect, useRef, useState } from 'react'
import { searchDiagnoses } from '../utils/icd10Kenya'

export default function DiagnosisPicker({ code = '', description = '', onPick, inputStyle = {}, id = 'dx-search', placeholder = 'Search diagnosis or ICD-10 code (e.g. malaria, J18)' }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults([]); return undefined }
    const controller = new AbortController()
    const t = setTimeout(async () => {
      const rows = await searchDiagnoses(term, { signal: controller.signal, limit: 12 })
      if (!controller.signal.aborted) { setResults(rows); setActive(0); setOpen(true) }
    }, 200)
    return () => { clearTimeout(t); controller.abort() }
  }, [q])

  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const pick = (row) => { onPick?.(row); setQ(''); setResults([]); setOpen(false) }
  const onKey = (e) => {
    if (!open || !results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    if (e.key === 'Enter') { e.preventDefault(); pick(results[active]) }
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" autoComplete="off"
        style={inputStyle} value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} onFocus={() => results.length && setOpen(true)} />
      {code && (
        <div style={{ fontSize: 11, color: '#475467', marginTop: 4 }}>
          Coded: <strong>{code}</strong>{description ? ` — ${description}` : ''}
        </div>
      )}
      {open && results.length > 0 && (
        <ul id={`${id}-list`} role="listbox" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', margin: '4px 0 0', padding: 0, listStyle: 'none', background: '#fff', border: '1px solid #D0D5DD', borderRadius: 8, boxShadow: '0 12px 28px rgba(15,23,42,.14)', maxHeight: 280, overflowY: 'auto' }}>
          {results.map((r, i) => (
            <li key={r.code} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(r) }} onMouseEnter={() => setActive(i)}
              style={{ padding: '8px 10px', cursor: 'pointer', background: i === active ? '#F0FDF4' : '#fff', borderBottom: '1px solid #F2F4F7', fontSize: 13 }}>
              <strong style={{ fontFamily: 'monospace' }}>{r.code}</strong> {r.description}
              {r.icd11_code && <span style={{ marginLeft: 6, fontSize: 11, color: '#175CD3' }}>ICD-11 {r.icd11_code}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
