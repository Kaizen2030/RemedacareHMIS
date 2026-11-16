// MOH 405 / MOH 406 register view: the paper register's columns, blank required cells highlighted, period totals,
// print and CSV. Data: moh405_register / moh406_register (20261210000000_maternity_registers.sql).
import { useState } from 'react'
import supabase from '../../supabase'
import { C, s } from '../ncd/ui'
import { MOH405_COLUMNS, MOH406_COLUMNS, cell, tally405, tally406, toCsv } from '../../utils/maternityRegisters'

const REGISTERS = {
  405: { title: 'MOH 405 — Antenatal care register', fn: 'moh405_register', columns: MOH405_COLUMNS, tally: tally405 },
  406: { title: 'MOH 406 — Maternity register', fn: 'moh406_register', columns: MOH406_COLUMNS, tally: tally406 },
}
const friendly = (e) => (/does not exist|schema cache|Could not find/i.test(e?.message || '') ? 'Registers not installed yet. Run docs/sql/28_maternity_registers.sql in Supabase.' : e?.message || String(e))

export default function MohRegister({ hospitalId, range }) {
  const [which, setWhich] = useState('405')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [onlyGaps, setOnlyGaps] = useState(false)
  const reg = REGISTERS[which]
  async function run(w = which) {
    setErr('')
    const { data, error } = await supabase.rpc(REGISTERS[w].fn, { p_hospital: hospitalId, p_from: range.from, p_to: range.to })
    if (error) { setErr(friendly(error)); setRows(null); return }
    setRows(data || [])
  }
  function download() {
    const blob = new Blob([toCsv(reg.columns, rows || [])], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `MOH${which}_${range.from}_${range.to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const shown = (rows || []).filter((r) => !onlyGaps || (r.missing || []).length)
  const totals = rows ? reg.tally(rows) : null
  return (
    <div style={{ ...s.card, marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <div><label style={s.label} htmlFor="moh-reg">Register</label>
          <select id="moh-reg" style={{ ...s.input, width: 300 }} value={which} onChange={(e) => { setWhich(e.target.value); setRows(null) }}>
            {Object.entries(REGISTERS).map(([k, r]) => <option key={k} value={k}>{r.title}</option>)}
          </select>
        </div>
        <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => run()}>Show register</button>
        {rows && <>
          <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => window.print()}>Print</button>
          <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={download}>Download CSV</button>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} />Only rows with blank cells</label>
        </>}
      </div>
      {err && <div role="alert" style={{ ...s.err, marginTop: 10 }}>{err}</div>}
      {rows && (
        <>
          <h3 style={{ ...s.h2, marginTop: 12 }}>{reg.title} · {range.from} to {range.to} · {rows.length} row(s)</h3>
          <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: '100%' }}>
              <thead><tr>{reg.columns.map((c) => <th key={c[0]} style={{ ...s.th, fontSize: 10, whiteSpace: 'normal', minWidth: 60, border: `1px solid ${C.border}` }}>{c[1]}</th>)}<th style={{ ...s.th, fontSize: 10, border: `1px solid ${C.border}` }}>Blank required cells</th></tr></thead>
              <tbody>{shown.map((r) => (
                <tr key={`${r.serial}`}>
                  {reg.columns.map((c) => <td key={c[0]} style={{ ...s.td, padding: '5px 6px', border: `1px solid ${C.border}`, whiteSpace: c[0] === 'name' ? 'nowrap' : undefined }}>{cell(c, r)}</td>)}
                  <td style={{ ...s.td, padding: '5px 6px', border: `1px solid ${C.border}`, color: C.danger, fontWeight: 700 }}>{(r.missing || []).join(', ')}</td>
                </tr>
              ))}</tbody>
            </table>
            {!shown.length && <div style={{ ...s.sub, padding: 12 }}>{rows.length ? 'Every row is complete.' : 'Nothing recorded in this period.'}</div>}
          </div>
          <h3 style={{ ...s.h2, marginTop: 14 }}>Totals for the period</h3>
          <div style={s.grid(220)}>
            {Object.entries(totals).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, border: `1px solid ${k.startsWith('Rows with') && v ? C.danger : C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
                <span>{k}</span><b style={{ color: k.startsWith('Rows with') && v ? C.danger : undefined }}>{v}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
