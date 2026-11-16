// MOH 711 / 710 / 731 / 717 from the clinical records, KHIS (DHIS2) export with per-hospital mappings,
// server-side schedules (generated monthly/weekly by the background sweep, emailed when configured) and run history.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { buildDataValueSet, downloadText, mappingKey, rowsToCsv } from '../../utils/khis'
import { C, Chip, s } from '../ncd/ui'

const FORMS = {
  711: 'MOH 711 — Reproductive & child health (ANC, maternity, newborn, PNC)',
  710: 'MOH 710 — Immunisation',
  731: 'MOH 731 — HIV care & treatment, PMTCT, index testing, TB',
  717: 'MOH 717 — Service workload (OPD, inpatient, lab, pharmacy)',
}
const lastMonth = () => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1)
  const y = d.getFullYear(), m = d.getMonth() + 1
  return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }
}

export default function MohReports({ hospitalId, hospitalName }) {
  const [form, setForm] = useState('711')
  const [range, setRange] = useState(lastMonth)
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [settings, setSettings] = useState({ org_unit_uid: '', mfl_code: '' })
  const [mappings, setMappings] = useState([])
  const [mapEdit, setMapEdit] = useState(false)
  const [schedules, setSchedules] = useState([])
  const [runs, setRuns] = useState([])
  const [newSched, setNewSched] = useState({ form: '711', frequency: 'monthly', run_day: 5, recipients: '' })

  const loadMeta = useCallback(async () => {
    const [st, mp, sc, rn] = await Promise.all([
      supabase.from('khis_settings').select('*').eq('hospital_id', hospitalId).maybeSingle(),
      supabase.from('khis_mappings').select('*').eq('hospital_id', hospitalId),
      supabase.from('report_schedules').select('*').eq('hospital_id', hospitalId).order('created_at'),
      supabase.from('report_runs').select('id, form, period_from, period_to, generated_at, email_status, email_error, recipients').eq('hospital_id', hospitalId).order('generated_at', { ascending: false }).limit(30),
    ])
    const e = mp.error || sc.error
    if (e) setErr(/permission|row-level/i.test(e.message) ? 'MOH reports are available to clinical staff and admins.' : `Not installed yet (${e.message}). Run docs/sql/10_moh_reports.sql.`)
    if (st.data) setSettings({ org_unit_uid: st.data.org_unit_uid || '', mfl_code: st.data.mfl_code || '' })
    setMappings(mp.data || []); setSchedules(sc.data || []); setRuns(rn.data || [])
  }, [hospitalId])
  useEffect(() => { if (hospitalId) void loadMeta() }, [hospitalId, loadMeta])

  async function run() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('moh_report', { p_hospital: hospitalId, p_form: form, p_from: range.from, p_to: range.to })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setRows((data || []).map((r) => ({ ...r, value: Number(r.value) })))
  }

  const grouped = useMemo(() => {
    const g = new Map()
    for (const r of rows || []) {
      if (!g.has(r.section)) g.set(r.section, new Map())
      const sec = g.get(r.section)
      if (!sec.has(r.indicator)) sec.set(r.indicator, [])
      sec.get(r.indicator).push(r)
    }
    return g
  }, [rows])
  const khis = useMemo(() => (rows ? buildDataValueSet({ form, rows, mappings, orgUnit: settings.org_unit_uid, from: range.from, to: range.to }) : null), [rows, form, mappings, settings.org_unit_uid, range])
  const mapIndex = useMemo(() => new Map(mappings.map((m) => [mappingKey(m.form, m.indicator, m.disaggregation), m])), [mappings])
  const fname = (ext) => `MOH${form}_${settings.mfl_code || 'facility'}_${range.from}_${range.to}.${ext}`

  async function saveSettings() {
    const { error } = await supabase.from('khis_settings').upsert({ hospital_id: hospitalId, ...settings, updated_at: new Date().toISOString() })
    if (error) setErr(error.message); else void loadMeta()
  }
  async function saveMapping(r, patch) {
    const existing = mapIndex.get(mappingKey(form, r.indicator, r.disaggregation))
    const row = { hospital_id: hospitalId, form, indicator: r.indicator, disaggregation: r.disaggregation, ...(existing || {}), ...patch }
    if (!row.data_element_uid) { if (existing) await supabase.from('khis_mappings').delete().eq('id', existing.id); void loadMeta(); return }
    const { error } = await supabase.from('khis_mappings').upsert(row, { onConflict: 'hospital_id,form,indicator,disaggregation' })
    if (error) setErr(error.message); else void loadMeta()
  }
  async function addSchedule() {
    const recipients = newSched.recipients.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)
    if (recipients.some((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) { setErr('Check the email addresses.'); return }
    const { error } = await supabase.from('report_schedules').insert({ hospital_id: hospitalId, form: newSched.form, frequency: newSched.frequency, run_day: Number(newSched.run_day), recipients })
    if (error) setErr(error.message); else { setNewSched({ ...newSched, recipients: '' }); void loadMeta() }
  }
  async function toggleSchedule(sc) { await supabase.from('report_schedules').update({ active: !sc.active }).eq('id', sc.id); void loadMeta() }
  async function downloadRun(r) {
    const { data } = await supabase.from('report_runs').select('csv').eq('id', r.id).maybeSingle()
    if (data?.csv) downloadText(`MOH${r.form}_${r.period_from}_${r.period_to}.csv`, data.csv)
  }
  function printReport() {
    const w = window.open('', '_blank')
    if (!w) return
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    const body = [...grouped.entries()].map(([sec, inds]) => `<h3>${esc(sec)}</h3><table>${[...inds.entries()].map(([ind, list]) =>
      list.map((r, i) => `<tr><td>${i === 0 ? esc(ind) : ''}</td><td>${esc(r.disaggregation === 'all' ? '' : r.disaggregation)}</td><td style="text-align:right">${r.value}</td></tr>`).join('')).join('')}</table>`).join('')
    w.document.write(`<!doctype html><title>MOH ${form}</title><style>body{font-family:Arial,sans-serif;font-size:12px;padding:20px}table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #ddd;padding:4px}h3{margin:16px 0 4px;color:#0F6E56}</style>
      <h2>${esc(FORMS[form])}</h2><div>${esc(hospitalName || '')} · MFL ${esc(settings.mfl_code || '—')} · ${range.from} to ${range.to}</div>${body}<script>print()</script>`)
    w.document.close()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <div role="alert" style={s.err}>{err}</div>}
      <div style={s.card}>
        <div style={{ ...s.grid(170), alignItems: 'end' }}>
          <div style={{ gridColumn: 'span 2' }}><label style={s.label} htmlFor="moh-form">Report</label>
            <select id="moh-form" style={s.input} value={form} onChange={(e) => { setForm(e.target.value); setRows(null) }}>{Object.entries(FORMS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label style={s.label} htmlFor="moh-from">From</label><input id="moh-from" type="date" style={s.input} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></div>
          <div><label style={s.label} htmlFor="moh-to">To</label><input id="moh-to" type="date" style={s.input} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></div>
          <button type="button" style={{ ...s.btn, ...s.pri }} disabled={busy} onClick={run}>{busy ? 'Counting…' : 'Run report'}</button>
        </div>
      </div>

      {rows && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <h2 style={{ ...s.h2, margin: 0 }}>{FORMS[form]} · {range.from} → {range.to}</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={printReport}>Print / PDF</button>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => downloadText(fname('csv'), rowsToCsv(rows))}>Excel (CSV)</button>
              <button type="button" style={{ ...s.btn, ...s.soft }} disabled={!settings.org_unit_uid || !khis?.mapped} title={!settings.org_unit_uid ? 'Set the KHIS org unit first' : ''}
                onClick={() => downloadText(fname('json').replace('.json', '_KHIS.json'), JSON.stringify(khis.json, null, 2), 'application/json')}>KHIS JSON</button>
              <button type="button" style={{ ...s.btn, ...s.soft }} disabled={!settings.org_unit_uid || !khis?.mapped} onClick={() => downloadText(fname('csv').replace('.csv', '_KHIS.csv'), khis.csv)}>KHIS CSV</button>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setMapEdit((v) => !v)}>{mapEdit ? 'Done mapping' : 'Map to KHIS'}</button>
            </div>
          </div>
          {khis && <div style={{ ...s.sub, marginBottom: 8 }}>KHIS: {khis.mapped} value(s) mapped{khis.unmapped.length ? `, ${khis.unmapped.length} not mapped yet (use "Map to KHIS")` : ''}.</div>}
          {rows.length === 0 && <div style={s.sub}>Nothing recorded for this period.</div>}
          {[...grouped.entries()].map(([sec, inds]) => (
            <div key={sec} style={{ marginBottom: 12 }}>
              <div style={{ ...s.label, color: C.primary, fontSize: 12 }}>{sec}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>{[...inds.entries()].map(([ind, list]) => list.map((r, i) => {
                  const m = mapIndex.get(mappingKey(form, r.indicator, r.disaggregation))
                  return (
                    <tr key={`${ind}-${r.disaggregation}`}>
                      <td style={{ ...s.td, fontWeight: i === 0 ? 700 : 400, width: '45%' }}>{i === 0 ? ind : ''}</td>
                      <td style={s.td}>{r.disaggregation === 'all' ? '' : r.disaggregation}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontWeight: 800 }}>{r.value}</td>
                      {mapEdit && <td style={s.td}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input aria-label="Data element UID" placeholder="Data element UID" style={{ ...s.input, padding: '4px 6px', fontSize: 11 }} defaultValue={m?.data_element_uid || ''} onBlur={(e) => e.target.value !== (m?.data_element_uid || '') && saveMapping(r, { data_element_uid: e.target.value.trim() })} />
                          <input aria-label="Category option combo UID" placeholder="Category option combo" style={{ ...s.input, padding: '4px 6px', fontSize: 11 }} defaultValue={m?.category_option_combo_uid || ''} onBlur={(e) => e.target.value !== (m?.category_option_combo_uid || '') && saveMapping(r, { category_option_combo_uid: e.target.value.trim() || null })} />
                        </div>
                      </td>}
                      {!mapEdit && <td style={{ ...s.td, width: 30 }}>{m ? <Chip tone="green">KHIS</Chip> : null}</td>}
                    </tr>
                  )
                }))}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <div style={s.card}>
        <h2 style={s.h2}>KHIS facility settings</h2>
        <div style={{ ...s.grid(200), alignItems: 'end' }}>
          <div><label style={s.label} htmlFor="khis-ou">KHIS org unit UID</label><input id="khis-ou" style={s.input} value={settings.org_unit_uid} onChange={(e) => setSettings((x) => ({ ...x, org_unit_uid: e.target.value.trim() }))} /></div>
          <div><label style={s.label} htmlFor="khis-mfl">MFL code</label><input id="khis-mfl" style={s.input} value={settings.mfl_code} onChange={(e) => setSettings((x) => ({ ...x, mfl_code: e.target.value.trim() }))} /></div>
          <button type="button" style={{ ...s.btn, ...s.pri }} onClick={saveSettings}>Save</button>
        </div>
        <div style={{ ...s.sub, marginTop: 6 }}>Get your org unit and data element UIDs from your county health records officer (KHIS → Maintenance / API). Map each indicator once; the KHIS files then import into DHIS2 via Import/Export → Data import.</div>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Scheduled reports</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {schedules.length === 0 && <div style={s.sub}>None yet.</div>}
          {schedules.map((sc) => (
            <div key={sc.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', borderBottom: `1px solid ${C.border}`, padding: '6px 0', fontSize: 12 }}>
              <span><strong>MOH {sc.form}</strong> · {sc.frequency === 'monthly' ? `monthly on day ${sc.run_day} (previous month)` : `weekly (previous 7 days)`} · {sc.recipients?.length ? sc.recipients.join(', ') : 'no email — saved in the app'}
                <span style={s.sub}> · next {sc.next_run_at ? new Date(sc.next_run_at).toLocaleString('en-KE') : '—'}</span></span>
              <button type="button" style={{ ...s.btn, ...(sc.active ? s.ghost : s.soft), padding: '4px 9px' }} onClick={() => toggleSchedule(sc)}>{sc.active ? 'Pause' : 'Resume'}</button>
            </div>
          ))}
        </div>
        <div style={{ ...s.grid(150), alignItems: 'end', marginTop: 10 }}>
          <div><label style={s.label} htmlFor="sc-form">Report</label><select id="sc-form" style={s.input} value={newSched.form} onChange={(e) => setNewSched((x) => ({ ...x, form: e.target.value }))}>{Object.keys(FORMS).map((k) => <option key={k} value={k}>MOH {k}</option>)}</select></div>
          <div><label style={s.label} htmlFor="sc-freq">Frequency</label><select id="sc-freq" style={s.input} value={newSched.frequency} onChange={(e) => setNewSched((x) => ({ ...x, frequency: e.target.value, run_day: e.target.value === 'weekly' ? 1 : 5 }))}><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select></div>
          <div><label style={s.label} htmlFor="sc-day">{newSched.frequency === 'weekly' ? 'Weekday (1 = Mon)' : 'Day of month'}</label><input id="sc-day" type="number" min={1} max={newSched.frequency === 'weekly' ? 7 : 28} style={s.input} value={newSched.run_day} onChange={(e) => setNewSched((x) => ({ ...x, run_day: e.target.value }))} /></div>
          <div style={{ gridColumn: 'span 2' }}><label style={s.label} htmlFor="sc-to">Email to (comma separated)</label><input id="sc-to" style={s.input} value={newSched.recipients} placeholder="records@clinic.ke, chrio@county.go.ke" onChange={(e) => setNewSched((x) => ({ ...x, recipients: e.target.value }))} /></div>
          <button type="button" style={{ ...s.btn, ...s.pri }} onClick={addSchedule}>Add schedule</button>
        </div>
        <h3 style={{ ...s.h2, marginTop: 14 }}>Generated reports</h3>
        {runs.length === 0 ? <div style={s.sub}>Reports appear here when a schedule runs (06:00 on the chosen day).</div> : runs.map((r) => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderBottom: `1px solid ${C.border}`, padding: '6px 0', fontSize: 12 }}>
            <span>MOH {r.form} · {r.period_from} → {r.period_to} · {new Date(r.generated_at).toLocaleString('en-KE')} · <Chip tone={r.email_status === 'sent' ? 'green' : r.email_status === 'failed' ? 'red' : 'gray'} title={r.email_error || ''}>{r.email_status.replace('_', ' ')}</Chip></span>
            <button type="button" style={{ ...s.btn, ...s.ghost, padding: '4px 9px' }} onClick={() => downloadRun(r)}>Download</button>
          </div>
        ))}
      </div>
    </div>
  )
}
