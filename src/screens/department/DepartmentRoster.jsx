// The department runs its own duty roster (staff_shifts) and HR / administrators choose who manages the department
// (department_managers, 20261231200000_department_control.sql). The database decides who may change which shift:
// HR / admin, a named manager of this department, or an in-charge / HOD of this department.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { localDateKey } from '../../utils/scheduling'
import { ROLE_GROUPS, staffRoleGroup } from '../../utils/staffRoles'

const PAGE = 20
const mondayOf = (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Department rosters are not installed yet. Run docs/sql/51_department_control.sql in Supabase.'
  if (/row-level|policy/i.test(m)) return 'You can only change the roster of a department you manage.'
  if (/duplicate key|unique/i.test(m)) return 'That shift is already on the roster.'
  return m
}
const TONE = { D: '#EFF8FF', N: '#F4F3FF', AM: '#ECFDF3', PM: '#FFFAEB', OC: '#FEF3F2', OFF: '#F2F4F7' }

export default function DepartmentRoster({ hospitalId, department, staff, matchesDepartment, css, SectionCard, EmptyState }) {
  const [week, setWeek] = useState(() => mondayOf(new Date()))
  const [shifts, setShifts] = useState([])
  const [types, setTypes] = useState([])
  const [canEdit, setCanEdit] = useState(false)
  const [canAppoint, setCanAppoint] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [page, setPage] = useState(0)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => localDateKey(addDays(week, i))), [week])
  const people = useMemo(() => staff.filter((p) => !['Terminated', 'Deceased', 'Rejected', 'Resigned'].includes(p.status)), [staff])

  const load = useCallback(async () => {
    if (!hospitalId) return
    const [sh, ty, perm, hr] = await Promise.all([
      supabase.from('staff_shifts').select('*').eq('hospital_id', hospitalId).gte('shift_date', days[0]).lte('shift_date', days[6]),
      supabase.from('hr_shift_types').select('*').order('code'),
      supabase.rpc('dept_manages', { p_hospital: hospitalId, p_department: department, p_what: 'roster' }),
      supabase.rpc('hr_can_manage', { p_hospital: hospitalId }),
    ])
    if (sh.error) { setErr(friendly(sh.error)); return }
    setShifts(sh.data || [])
    const byCode = new Map(); for (const t of ty.data || []) if ((!t.hospital_id || t.hospital_id === hospitalId) && (!byCode.has(t.code) || t.hospital_id)) byCode.set(t.code, t)
    setTypes([...byCode.values()])
    setCanEdit(Boolean(perm.data)); setCanAppoint(Boolean(hr.data))
    if (perm.error && /does not exist|schema cache/i.test(perm.error.message)) setErr(friendly(perm.error))
  }, [hospitalId, department, days])
  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => { const c = {}; people.forEach((p) => { const g = staffRoleGroup(p); c[g] = (c[g] || 0) + 1 }); return ROLE_GROUPS.filter((g) => c[g]).map((g) => [g, c[g]]) }, [people])
  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return people.filter((p) => (!role || staffRoleGroup(p) === role) && words.every((w) => `${p.full_name} ${p.job_title || ''} ${p.role || ''}`.toLowerCase().includes(w)))
      .sort((a, b) => ROLE_GROUPS.indexOf(staffRoleGroup(a)) - ROLE_GROUPS.indexOf(staffRoleGroup(b)) || String(a.full_name).localeCompare(String(b.full_name)))
  }, [people, q, role])
  useEffect(() => { setPage(0) }, [q, role])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE)
  const cellOf = (personId, date) => shifts.find((x) => x.staff_id === personId && x.shift_date === date)
  const perDay = days.map((d) => shifts.filter((x) => x.shift_date === d && x.shift_code !== 'OFF' && people.some((p) => p.id === x.staff_id)).length)

  async function setCell(person, date, code) {
    setErr(''); setMsg('')
    const existing = shifts.filter((x) => x.staff_id === person.id && x.shift_date === date)
    for (const x of existing) { const { error } = await supabase.from('staff_shifts').delete().eq('id', x.id); if (error) { setErr(friendly(error)); return } }
    if (code) {
      const { error } = await supabase.from('staff_shifts').insert({ hospital_id: hospitalId, staff_id: person.id, shift_date: date, shift_code: code, unit: department })
      if (error) setErr(`${person.full_name}, ${date}: ${friendly(error)}`)
    }
    void load()
  }
  async function copyLastWeek() {
    setBusy(true); setErr(''); setMsg('')
    const prev = Array.from({ length: 7 }, (_, i) => localDateKey(addDays(week, i - 7)))
    const { data, error } = await supabase.from('staff_shifts').select('*').eq('hospital_id', hospitalId).gte('shift_date', prev[0]).lte('shift_date', prev[6])
    if (error) { setBusy(false); setErr(friendly(error)); return }
    const ids = new Set(people.map((p) => p.id))
    let added = 0; const problems = []
    for (const s of (data || []).filter((x) => ids.has(x.staff_id))) {
      const date = days[prev.indexOf(s.shift_date)]
      if (!date || cellOf(s.staff_id, date)) continue
      const { error: e } = await supabase.from('staff_shifts').insert({ hospital_id: hospitalId, staff_id: s.staff_id, shift_date: date, shift_code: s.shift_code, unit: department })
      if (e) problems.push(`${people.find((p) => p.id === s.staff_id)?.full_name || 'Staff'} ${date}: ${friendly(e)}`); else added++
    }
    setBusy(false)
    setMsg(`${added} shift${added === 1 ? '' : 's'} copied from last week${problems.length ? `; ${problems.length} skipped` : ''}.`)
    if (problems.length) setErr(problems.slice(0, 4).join(' · '))
    void load()
  }

  return (
    <>
      <SectionCard title="Duty roster" note={canEdit ? `You can change the ${department} roster. Double-booking and shifts during approved leave are refused; a warning marks short rest or long weekly hours.` : `Only ${department}'s managers, HR or an administrator can change this roster.`}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <button type="button" style={{ ...css.backBtn, padding: '5px 10px' }} aria-label="Previous week" onClick={() => setWeek((w) => addDays(w, -7))}>‹</button>
          <strong style={{ fontSize: 13.5 }}>Week of {new Date(`${days[0]}T12:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
          <button type="button" style={{ ...css.backBtn, padding: '5px 10px' }} aria-label="Next week" onClick={() => setWeek((w) => addDays(w, 7))}>›</button>
          <button type="button" style={{ ...css.backBtn, padding: '5px 10px' }} onClick={() => setWeek(mondayOf(new Date()))}>This week</button>
          {canEdit && <button type="button" style={{ ...css.backBtn, padding: '5px 10px', marginLeft: 'auto' }} disabled={busy} onClick={() => void copyLastWeek()}>{busy ? 'Copying…' : 'Copy last week'}</button>}
        </div>
        {(people.length > 12 || counts.length > 1) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <div role="group" aria-label="Filter the roster by role" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['', people.length], ...counts].map(([g, n]) => (
                <button key={g || 'all'} type="button" aria-pressed={role === g} onClick={() => setRole(g)}
                  style={{ ...css.backBtn, padding: '4px 10px', fontSize: 12.5, ...(role === g ? { background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' } : {}) }}>{g || 'All'} ({n})</button>
              ))}
            </div>
            {people.length > 12 && <input type="search" aria-label="Search the roster" placeholder="Search name or title" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ marginLeft: 'auto', padding: '6px 10px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 13, minWidth: 200 }} />}
          </div>
        )}
        {err && <div role="alert" style={{ color: '#912018', fontSize: 13, marginBottom: 8 }}>{err}</div>}
        {msg && <div role="status" style={{ color: '#05603A', fontSize: 13, marginBottom: 8 }}>{msg}</div>}
        {people.length === 0 ? <EmptyState message="No staff are assigned to this department yet." /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...css.table, minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={css.th}>Staff</th>
                  {days.map((d, i) => <th key={d} style={{ ...css.th, textAlign: 'center' }}>{new Date(`${d}T12:00:00`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric' })}<div style={{ fontWeight: 600, fontSize: 11 }}>{perDay[i]} on</div></th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td style={{ ...css.td, padding: '6px 12px', whiteSpace: 'nowrap' }}><strong>{p.full_name}</strong><div style={{ fontSize: 12, color: '#475467' }}>{p.job_title || p.role || staffRoleGroup(p)}</div></td>
                    {days.map((d) => {
                      const x = cellOf(p.id, d)
                      const flags = x?.flags || []
                      return (
                        <td key={d} style={{ ...css.td, padding: 4, textAlign: 'center', background: x ? TONE[x.shift_code] || '#fff' : undefined }} title={flags.join(' · ')}>
                          {canEdit ? (
                            <select aria-label={`${p.full_name}, ${d}`} value={x?.shift_code || ''} onChange={(e) => void setCell(p, d, e.target.value)}
                              style={{ width: '100%', minWidth: 58, padding: '4px', fontSize: 12.5, fontWeight: 700, border: flags.length ? '2px solid #B54708' : '1px solid #D0D5DD', borderRadius: 6, background: 'transparent' }}>
                              <option value="">—</option>{types.map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}
                            </select>
                          ) : <span style={{ fontWeight: 700, fontSize: 12.5 }}>{x?.shift_code || '—'}</span>}
                          {flags.length > 0 && <div style={{ color: '#B54708', fontSize: 11, fontWeight: 700 }}>! {flags.length}</div>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, fontSize: 13 }}>
            <button type="button" style={{ ...css.backBtn, padding: '4px 10px' }} disabled={page === 0} onClick={() => setPage((n) => n - 1)}>‹ Previous</button>
            <span>{page * PAGE + 1}–{Math.min(filtered.length, (page + 1) * PAGE)} of {filtered.length}</span>
            <button type="button" style={{ ...css.backBtn, padding: '4px 10px' }} disabled={page >= pages - 1} onClick={() => setPage((n) => n + 1)}>Next ›</button>
          </div>
        )}
        <p style={{ fontSize: 12, color: '#475467', margin: '8px 0 0' }}>{types.map((t) => `${t.code} = ${t.label}`).join(' · ')}</p>
      </SectionCard>
      {canAppoint && <DepartmentManagers hospitalId={hospitalId} department={department} staff={people} matchesDepartment={matchesDepartment} css={css} SectionCard={SectionCard} EmptyState={EmptyState} />}
    </>
  )
}

/** HR / administrators choose who runs the department: roster and / or leave approval. */
function DepartmentManagers({ hospitalId, department, staff, matchesDepartment, css, SectionCard, EmptyState }) {
  const [rows, setRows] = useState([])
  const [pick, setPick] = useState('')
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('department_managers').select('*').eq('hospital_id', hospitalId)
    if (error) { setErr(friendly(error)); return }
    setErr(''); setRows((data || []).filter((m) => matchesDepartment(m.department)))
  }, [hospitalId, matchesDepartment])
  useEffect(() => { void load() }, [load])
  const name = (id) => staff.find((s) => s.id === id)?.full_name || 'Staff member'
  const add = async () => {
    if (!pick) return
    const { error } = await supabase.from('department_managers').insert({ hospital_id: hospitalId, department, staff_id: pick, can_roster: true, can_approve_leave: true })
    if (error) { setErr(friendly(error)); return }
    setPick(''); void load()
  }
  const toggle = async (m, field) => { const { error } = await supabase.from('department_managers').update({ [field]: !m[field] }).eq('id', m.id); if (error) setErr(friendly(error)); void load() }
  const remove = async (m) => { const { error } = await supabase.from('department_managers').delete().eq('id', m.id); if (error) setErr(friendly(error)); void load() }
  const candidates = staff.filter((s) => !rows.some((m) => m.staff_id === s.id))
  return (
    <SectionCard title="Department managers" count={rows.length} note={`Who runs ${department}: the duty roster and leave approval for its staff. HR and administrators can always do both.`}>
      {err && <div role="alert" style={{ color: '#912018', fontSize: 13, marginBottom: 8 }}>{err}</div>}
      {rows.length === 0 ? <EmptyState message="No managers named yet. In-charges and HODs of this department can still run its roster." /> : (
        <div style={{ overflowX: 'auto' }}><table style={css.table}>
          <thead><tr>{['Manager', 'Runs the roster', 'Approves leave', ''].map((h, i) => <th key={i} style={css.th}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.id}>
              <td style={{ ...css.td, fontWeight: 700 }}>{name(m.staff_id)}</td>
              <td style={css.td}><input type="checkbox" aria-label={`${name(m.staff_id)} runs the roster`} checked={m.can_roster} onChange={() => void toggle(m, 'can_roster')} style={{ accentColor: '#0F6E56' }} /></td>
              <td style={css.td}><input type="checkbox" aria-label={`${name(m.staff_id)} approves leave`} checked={m.can_approve_leave} onChange={() => void toggle(m, 'can_approve_leave')} style={{ accentColor: '#0F6E56' }} /></td>
              <td style={{ ...css.td, textAlign: 'right' }}><button type="button" style={{ ...css.dangerBtn, padding: '4px 10px' }} onClick={() => void remove(m)}>Remove</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <select aria-label="Staff member to make a manager" value={pick} onChange={(e) => setPick(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 13, minWidth: 240 }}>
          <option value="">Choose a staff member…</option>
          {candidates.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.job_title ? ` — ${s.job_title}` : ''}</option>)}
        </select>
        <button type="button" style={{ ...css.backBtn, background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' }} disabled={!pick} onClick={() => void add()}>Make manager</button>
      </div>
    </SectionCard>
  )
}
