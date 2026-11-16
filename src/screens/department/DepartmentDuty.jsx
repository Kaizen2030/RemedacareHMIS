// Who is on duty in a department today, from the HR duty roster (staff_shifts, hr_shift_types) and approved leave
// (staff_leave), 20261218000000_hr_roster_leave.sql. Covers the department's own staff and anyone rostered to this unit.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { localDateKey } from '../../utils/scheduling'
import { roleSummary } from '../../utils/staffRoles'

const LIMIT = 6 // people shown per group before "Show all"

const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return localDateKey(new Date(y, m - 1, d + n)) }

/**
 * Sort today's roster into: on duty now, later today, on call, on leave, not rostered.
 * shifts: staff_shifts for yesterday and today; types: hr_shift_types; leave: approved staff_leave; staff: department staff.
 */
export function dutyBoard({ shifts = [], types = [], leave = [], staff = [], extraStaff = [], matchesDepartment = () => false, now = new Date() }) {
  const today = localDateKey(now)
  const t = now.getTime()
  const typeOf = (code) => types.find((x) => x.code === code) || null
  const deptIds = new Set(staff.map((s) => s.id))
  const people = new Map([...extraStaff, ...staff].map((s) => [s.id, s]))
  const relevant = shifts.filter((s) => deptIds.has(s.staff_id) || matchesDepartment(s.unit))
  const onLeave = leave.filter((l) => String(l.status || 'approved') === 'approved' && l.start_date <= today && l.end_date >= today && (deptIds.has(l.staff_id)))
  const leaveIds = new Set(onLeave.map((l) => l.staff_id))
  const row = (s) => {
    const ty = typeOf(s.shift_code)
    return { id: s.id, staff: people.get(s.staff_id) || { id: s.staff_id, full_name: 'Staff member' }, code: s.shift_code, label: ty?.label || s.shift_code, unit: s.unit, starts: s.starts_at, ends: s.ends_at, oncall: ty ? ty.counts_as_work === false && Number(ty.hours) > 0 : /^OC$/i.test(s.shift_code) }
  }
  const working = relevant.filter((s) => !/^OFF$/i.test(s.shift_code) && !leaveIds.has(s.staff_id)).map(row)
  const nowOn = working.filter((r) => !r.oncall && r.starts && r.ends && new Date(r.starts).getTime() <= t && t < new Date(r.ends).getTime())
  const later = working.filter((r) => !r.oncall && r.starts && new Date(r.starts).getTime() > t && localDateKey(new Date(r.starts)) === today)
  const oncall = working.filter((r) => r.oncall && (!r.ends || t < new Date(r.ends).getTime()) && (!r.starts || new Date(r.starts).getTime() <= t + 86400000))
  const rosteredToday = new Set(relevant.filter((s) => s.shift_date === today || (s.ends_at && new Date(s.ends_at).getTime() > t)).map((s) => s.staff_id))
  const notRostered = staff.filter((s) => String(s.status || 'Active') === 'Active' && !rosteredToday.has(s.id) && !leaveIds.has(s.id))
  const byStart = (a, b) => String(a.starts || '').localeCompare(String(b.starts || ''))
  return {
    nowOn: nowOn.sort(byStart), later: later.sort(byStart), oncall,
    onLeave: onLeave.map((l) => ({ ...l, staff: people.get(l.staff_id) })),
    notRostered,
  }
}

export default function DepartmentDuty({ hospitalId, staff, matchesDepartment, navigate, css, SectionCard, EmptyState, onCount }) {
  const [data, setData] = useState({ shifts: [], types: [], leave: [], extraStaff: [] })
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState({})
  const today = localDateKey(new Date())
  const staffKey = staff.map((s) => s.id).join(',')
  const load = useCallback(async () => {
    if (!hospitalId) return
    const [shiftsRes, typesRes, leaveRes] = await Promise.all([
      supabase.from('staff_shifts').select('*').eq('hospital_id', hospitalId).gte('shift_date', addDays(today, -1)).lte('shift_date', today),
      supabase.from('hr_shift_types').select('*'),
      staff.length ? supabase.from('staff_leave').select('*').eq('hospital_id', hospitalId).lte('start_date', today).gte('end_date', today) : Promise.resolve({ data: [] }),
    ])
    if (shiftsRes.error) { setError(/does not exist|schema cache/i.test(shiftsRes.error.message) ? 'The duty roster is not installed yet (docs/sql/36).' : shiftsRes.error.message); return }
    setError('')
    const types = (typesRes.data || []).filter((x) => !x.hospital_id || x.hospital_id === hospitalId)
      .sort((a, b) => (a.hospital_id ? 0 : 1) - (b.hospital_id ? 0 : 1)) // hospital's own codes win over the defaults
    const shifts = shiftsRes.data || []
    const known = new Set(staff.map((s) => s.id))
    const missing = [...new Set(shifts.filter((s) => !known.has(s.staff_id) && matchesDepartment(s.unit)).map((s) => s.staff_id))]
    let extraStaff = []
    if (missing.length) extraStaff = (await supabase.from('staff').select('id, full_name, job_title, role, role_category, phone').eq('hospital_id', hospitalId).in('id', missing)).data || []
    setData({ shifts, types, leave: leaveRes.data || [], extraStaff })
  }, [hospitalId, today, staffKey, matchesDepartment]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 5 * 60000); return () => clearInterval(id) }, [])
  const board = useMemo(() => dutyBoard({ ...data, staff, matchesDepartment, now: new Date() }), [data, staff, matchesDepartment, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onCount?.(board.nowOn.length) }, [board.nowOn.length, onCount])
  const person = (s) => <><span style={{ fontWeight: 700 }}>{s?.full_name || '—'}</span>{(s?.job_title || s?.role) && <span style={{ color: '#475467' }}> · {s.job_title || s.role}</span>}</>
  // large departments: search by name, groups show 6 people until "Show all"
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const hit = (s) => words.every((w) => `${s?.full_name || ''} ${s?.job_title || ''} ${s?.role || ''}`.toLowerCase().includes(w))
  const Group = ({ id, title, rows, render, empty }) => {
    const list = rows.filter((r) => hit(r.staff))
    const all = expanded[id]
    const shown = all ? list : list.slice(0, LIMIT)
    return (
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: '#344054', margin: '0 0 2px' }}>{title} <span style={css.sectionCount}>{rows.length}</span></div>
        {rows.length > 0 && <div style={{ fontSize: 12, color: '#475467', marginBottom: 4 }}>{roleSummary(rows.map((r) => r.staff))}</div>}
        {list.length === 0 ? <div style={{ fontSize: 13, color: '#475467', padding: '4px 0' }}>{rows.length ? 'No match for this search.' : empty}</div> : shown.map((r) => <div key={r.id} style={{ fontSize: 13, padding: '5px 0', borderBottom: '1px solid #EAECF0' }}>{render(r)}</div>)}
        {list.length > LIMIT && <button type="button" style={{ ...css.backBtn, padding: '3px 10px', marginTop: 6, fontSize: 12.5 }} onClick={() => setExpanded((e) => ({ ...e, [id]: !all }))}>{all ? 'Show fewer' : `Show all ${list.length}`}</button>}
      </div>
    )
  }
  const totalPeople = staff.length + data.extraStaff.length
  const notRostered = board.notRostered.filter(hit)

  return (
    <SectionCard title="On duty today" count={board.nowOn.length}>
      {error ? <EmptyState message={error} /> : (
        <>
          {totalPeople > 12 && (
            <input type="search" aria-label="Search the duty list" placeholder="Search name or title" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 13, minWidth: 220, marginBottom: 10 }} />
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
            <Group id="now" title="On duty now" rows={board.nowOn} empty="Nobody rostered on duty right now." render={(r) => <>{person(r.staff)}<div style={{ fontSize: 12, color: '#475467' }}>{r.label}{r.ends ? ` · until ${hhmm(r.ends)}` : ''}{r.unit ? ` · ${r.unit}` : ''}</div></>} />
            <Group id="later" title="Later today" rows={board.later} empty="No later shifts today." render={(r) => <>{person(r.staff)}<div style={{ fontSize: 12, color: '#475467' }}>{r.label} · from {hhmm(r.starts)}</div></>} />
            <Group id="oncall" title="On call" rows={board.oncall} empty="No one on call." render={(r) => <>{person(r.staff)}{r.staff?.phone && <div style={{ fontSize: 12, color: '#475467' }}>{r.staff.phone}</div>}</>} />
            <Group id="leave" title="On leave today" rows={board.onLeave} empty="Nobody on leave." render={(l) => <>{person(l.staff)}<div style={{ fontSize: 12, color: '#475467' }}>{l.leave_type} · back after {l.end_date}</div></>} />
          </div>
          {notRostered.length > 0 && (
            <p style={{ fontSize: 12.5, color: '#344054', margin: '10px 0 0' }}>
              <strong>Not on today's roster ({notRostered.length}):</strong>{' '}
              {(expanded.not ? notRostered : notRostered.slice(0, 8)).map((s) => s.full_name).join(', ')}{!expanded.not && notRostered.length > 8 ? ` and ${notRostered.length - 8} more` : ''}.
              {notRostered.length > 8 && <button type="button" style={{ ...css.backBtn, padding: '2px 8px', marginLeft: 6, fontSize: 12 }} onClick={() => setExpanded((e) => ({ ...e, not: !e.not }))}>{expanded.not ? 'Show fewer' : 'Show all'}</button>}
            </p>
          )}
          <div style={{ marginTop: 10 }}><button type="button" style={{ ...css.backBtn, padding: '5px 12px' }} onClick={() => { const el = document.getElementById('dept-roster-grid'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); else navigate?.('hr') }}>Go to the weekly roster</button></div>
        </>
      )}
    </SectionCard>
  )
}
