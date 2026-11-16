// Hospital control over clinical content (guides, references, pathways): saved revisions, removing / restoring the
// built-in items, deleting hospital-written ones and "start fresh". Backed by clinical_content_revisions
// (20261225 + 20261228): a built-in item is hidden with content.hidden = true; the 'setting' row for a content type
// with builtin_default = 'hidden' hides every built-in item (including ones added in later app versions) unless that
// item was explicitly restored (hidden = false).
import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'
import { C, s } from '../ncd/ui'

const PERMISSION_TEXT = 'Only an authorised clinical lead, consultant, head of department, pharmacist or administrator can change these items.'
const friendly = (error) => (/row-level|permission|Only an authorised/i.test(error?.message || '') ? PERMISSION_TEXT : error?.message || 'Something went wrong.')

export function findRevision(revisions, type, id) {
  return revisions.find((r) => r.content_type === type && r.content_id === id)
}

export function builtinDefault(revisions, type) {
  return findRevision(revisions, 'setting', type)?.content?.builtin_default === 'hidden' ? 'hidden' : 'shown'
}

/** Is a built-in item removed at this hospital? */
export function isBuiltinHidden(revisions, type, id) {
  const flag = findRevision(revisions, type, id)?.content?.hidden
  if (flag === true) return true
  if (flag === false) return false
  return builtinDefault(revisions, type) === 'hidden'
}

/** Hospital-written items of a type (content.custom === true or the legacy customGuide flag). */
export function customItems(revisions, type) {
  return revisions.filter((r) => r.content_type === type && (r.content?.custom || r.content?.customGuide))
}

export function useClinicalContent(hospitalId) {
  const [revisions, setRevisions] = useState([])
  const [canEdit, setCanEdit] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setRevisions([]); setCanEdit(false); setError('')
    if (!hospitalId) return
    try {
      const [revisionResult, permissionResult] = await Promise.all([
        supabase.from('clinical_content_revisions').select('*').eq('hospital_id', hospitalId),
        supabase.rpc('guide_can_approve', { p_hospital: hospitalId }),
      ])
      if (revisionResult.error) setError(revisionResult.error.message)
      else setRevisions(revisionResult.data || [])
      if (permissionResult.error) setError(permissionResult.error.message)
      else setCanEdit(Boolean(permissionResult.data))
    } catch (e) {
      setError(e.message || 'Could not load clinical content.')
    }
  }, [hospitalId])
  useEffect(() => { void load() }, [load])

  const replaceLocal = (rows, removed = []) => setRevisions((current) => [
    ...current.filter((r) => !rows.some((x) => x.content_type === r.content_type && x.content_id === r.content_id)
      && !removed.some(([t, id]) => r.content_type === t && r.content_id === id)),
    ...rows,
  ])

  /** Save one or many {type, id, content} rows in a single statement. */
  const saveMany = useCallback(async (items) => {
    if (!items.length) return {}
    try {
      const rows = items.map((x) => ({ hospital_id: hospitalId, content_type: x.type, content_id: x.id, content: x.content }))
      const query = supabase.from('clinical_content_revisions')
        .upsert(rows.length === 1 ? rows[0] : rows, { onConflict: 'hospital_id,content_type,content_id' })
        .select('*')
      const { data, error: e } = rows.length === 1 ? await query.single() : await query
      if (e) return { error: friendly(e) }
      if (!data) return { error: 'The saved revision could not be loaded. Please reload and check before editing again.' }
      replaceLocal(Array.isArray(data) ? data : [data])
      return {}
    } catch (e) { return { error: e.message || 'Could not save.' } }
  }, [hospitalId])

  const save = useCallback(async (type, id, content) => {
    const result = await saveMany([{ type, id, content }])
    return result
  }, [saveMany])

  /** Delete hospital-written items (the history keeps a tombstone of each). */
  const removeMany = useCallback(async (type, ids) => {
    if (!ids.length) return {}
    try {
      const { error: e } = await supabase.from('clinical_content_revisions').delete().eq('hospital_id', hospitalId).eq('content_type', type).in('content_id', ids)
      if (e) return { error: friendly(e) }
      replaceLocal([], ids.map((id) => [type, id]))
      return {}
    } catch (e) { return { error: e.message || 'Could not delete.' } }
  }, [hospitalId])

  /** Remove (hide) or restore one built-in item, keeping any local edits. */
  const setHidden = useCallback((type, id, hidden) => {
    const current = findRevision(revisions, type, id)?.content || {}
    return saveMany([{ type, id, content: { ...current, hidden } }])
  }, [revisions, saveMany])

  /** Start fresh: hide every built-in item now and in future versions; optionally delete hospital-written ones. */
  const startFresh = useCallback(async (type, builtinIds, { deleteCustom = false } = {}) => {
    const rows = [{ type: 'setting', id: type, content: { builtin_default: 'hidden', since: new Date().toISOString() } },
      ...builtinIds.map((id) => ({ type, id, content: { ...(findRevision(revisions, type, id)?.content || {}), hidden: true } }))]
    const r1 = await saveMany(rows)
    if (r1.error) return r1
    if (deleteCustom) return removeMany(type, customItems(revisions, type).map((r) => r.content_id))
    return {}
  }, [revisions, saveMany, removeMany])

  /** Bring back every built-in item. */
  const restoreAll = useCallback((type, builtinIds) => saveMany([
    { type: 'setting', id: type, content: { builtin_default: 'shown', since: new Date().toISOString() } },
    ...builtinIds.filter((id) => findRevision(revisions, type, id)).map((id) => ({ type, id, content: { ...findRevision(revisions, type, id).content, hidden: false } })),
  ]), [revisions, saveMany])

  return { revisions, canEdit, error, reload: load, save, saveMany, removeMany, setHidden, startFresh, restoreAll }
}

/** "Manage" panel for editors: start fresh, restore all, and the list of removed built-in items. */
export function ContentManager({ noun, builtinIds, hiddenItems, customCount, fresh, onStartFresh, onRestoreAll, onRestore }) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleteCustom, setDeleteCustom] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async (fn) => {
    setBusy(true); setErr('')
    const r = await fn()
    setBusy(false)
    if (r?.error) setErr(r.error); else { setConfirming(false); setDeleteCustom(false) }
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <button type="button" style={{ ...s.btn, ...s.ghost, width: '100%' }} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Close' : 'Manage'} {noun}{hiddenItems.length ? ` · ${hiddenItems.length} removed` : ''}
      </button>
      {open && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, marginTop: 6, fontSize: 13 }}>
          {fresh ? (
            <p style={{ ...s.sub, margin: '0 0 8px' }}>This hospital started fresh: built-in {noun} stay hidden (including new ones in later updates) unless you restore them.</p>
          ) : (
            <p style={{ ...s.sub, margin: '0 0 8px' }}>Remove any built-in item with its Remove button, or start fresh to write your own set.</p>
          )}
          {!confirming && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {!fresh && <button type="button" style={{ ...s.btn, ...s.ghost, color: C.danger }} onClick={() => setConfirming(true)}>Start fresh…</button>}
              {(fresh || hiddenItems.length > 0) && <button type="button" style={{ ...s.btn, ...s.soft }} disabled={busy} onClick={() => run(onRestoreAll)}>Restore all built-in {noun}</button>}
            </div>
          )}
          {confirming && (
            <div role="alertdialog" aria-label={`Start fresh with ${noun}`} style={{ background: C.dangerL || '#FEF3F2', borderRadius: 8, padding: 10 }}>
              <strong>Hide all {builtinIds.length} built-in {noun}?</strong>
              <p style={{ margin: '4px 0 8px' }}>Staff will only see {noun} your hospital writes. Nothing is lost: you can restore them at any time.</p>
              {customCount > 0 && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                  <input type="checkbox" checked={deleteCustom} onChange={(e) => setDeleteCustom(e.target.checked)} />
                  Also delete the {customCount} {noun} written at this hospital (their wording stays in the history)
                </label>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" style={{ ...s.btn, background: C.danger, color: '#fff' }} disabled={busy} onClick={() => run(() => onStartFresh({ deleteCustom }))}>{busy ? 'Working…' : 'Yes, start fresh'}</button>
                <button type="button" style={{ ...s.btn, ...s.ghost }} disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          )}
          {err && <div role="alert" style={{ ...s.err, marginTop: 8 }}>{err}</div>}
          {hiddenItems.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Removed at this hospital</div>
              {hiddenItems.map((item) => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center', padding: '4px 0', borderTop: `1px solid ${C.border}` }}>
                  <span>{item.title}</span>
                  <button type="button" style={{ ...s.btn, ...s.ghost, padding: '2px 8px' }} disabled={busy} onClick={() => run(() => onRestore(item.id))}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Remove button for one item: hides a built-in item, deletes a hospital-written one (after confirmation). */
export function RemoveItemButton({ custom, title, onHide, onDelete, style }) {
  const [asking, setAsking] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    setErr('')
    const r = custom ? await onDelete() : await onHide()
    if (r?.error) setErr(r.error); else setAsking(false)
  }
  return (
    <span style={style}>
      {!asking && <button type="button" style={{ ...s.btn, ...s.ghost, color: C.danger }} onClick={() => setAsking(true)}>{custom ? 'Delete' : 'Remove'}</button>}
      {asking && (
        <span role="alertdialog" aria-label={`Confirm ${custom ? 'delete' : 'remove'}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12 }}>{custom ? `Delete "${title}" for everyone at this hospital?` : `Remove "${title}" at this hospital? You can restore it later.`}</span>
          <button type="button" style={{ ...s.btn, background: C.danger, color: '#fff', padding: '4px 10px' }} onClick={go}>{custom ? 'Delete' : 'Remove'}</button>
          <button type="button" style={{ ...s.btn, ...s.ghost, padding: '4px 10px' }} onClick={() => setAsking(false)}>Cancel</button>
        </span>
      )}
      {err && <span role="alert" style={{ ...s.err, display: 'block', marginTop: 6 }}>{err}</span>}
    </span>
  )
}
