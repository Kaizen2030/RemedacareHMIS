// Department protocols, SOPs, policies and rules (docs/sql/52): an uploaded file (PDF, Word, PowerPoint, Excel, image)
// and/or written rules. The department's managers publish and update them; each change of content is a new revision,
// earlier revisions stay in history, and staff confirm they have read the current one ("Read by 12 of 40").
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { localDateKey } from '../../utils/scheduling'
import { DocumentViewer, DOCUMENT_TYPES, documentExtension } from '../clinical/documents'

export const PROTOCOL_BUCKET = 'department-documents'
const MAX_BYTES = 25 * 1024 * 1024
const KINDS = { protocol: 'Protocol', sop: 'Standard operating procedure', policy: 'Policy', rules: 'Rules', form: 'Form or checklist', other: 'Other' }
const ACCEPT = Object.keys(DOCUMENT_TYPES).map((x) => `.${x}`).join(',')
const BLANK = { title: '', kind: 'protocol', version_label: '', effective_on: '', review_on: '', must_read: true, summary: '', body: '', change_note: '', file: null }
const field = { padding: '7px 10px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', background: '#fff', color: '#101828' }
const lbl = { display: 'block', fontSize: 12.5, fontWeight: 700, color: '#344054', marginBottom: 4 }
const friendly = (e) => {
  const m = String(e?.message || e || '')
  if (/does not exist|schema cache/i.test(m)) return 'Department protocols are not installed yet (docs/sql/52).'
  if (/row-level|permission/i.test(m)) return 'Only this department\'s managers, HR or an administrator can change its protocols.'
  return m.replace(/^.*?ERROR:\s*/, '') || 'Could not save.'
}
const safeName = (n) => String(n).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-80)
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

function checkFile(file) {
  if (!file) return ''
  if (!DOCUMENT_TYPES[documentExtension(file.name)]) return 'Use a PDF, Word, PowerPoint, Excel, CSV, text or image file.'
  if (file.size > MAX_BYTES) return 'The file is larger than 25 MB.'
  return ''
}

function Editor({ value, onChange, editing, css, onSave, onClose, busy }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  return (
    <div role="group" aria-label={editing ? 'Update document' : 'New document'} style={{ border: '1px solid #D0D5DD', borderRadius: 10, padding: 14, marginBottom: 12, background: '#FCFCFD' }}>
      <strong style={{ display: 'block', fontSize: 14.5, marginBottom: 10 }}>{editing ? `Update: ${editing.title}` : 'New protocol or document'}</strong>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <div style={{ gridColumn: 'span 2' }}><label style={lbl} htmlFor="pr-title">Title</label>
          <input id="pr-title" style={field} value={value.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Management of severe pre-eclampsia" /></div>
        <div><label style={lbl} htmlFor="pr-kind">Type</label>
          <select id="pr-kind" style={field} value={value.kind} onChange={(e) => set('kind', e.target.value)}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label style={lbl} htmlFor="pr-version">Version (your numbering)</label>
          <input id="pr-version" style={field} value={value.version_label} onChange={(e) => set('version_label', e.target.value)} placeholder="e.g. v3, 2026" /></div>
        <div><label style={lbl} htmlFor="pr-from">In use from</label>
          <input id="pr-from" type="date" style={field} value={value.effective_on} onChange={(e) => set('effective_on', e.target.value)} /></div>
        <div><label style={lbl} htmlFor="pr-review">Next review</label>
          <input id="pr-review" type="date" style={field} value={value.review_on} onChange={(e) => set('review_on', e.target.value)} /></div>
      </div>
      <div style={{ marginTop: 10 }}><label style={lbl} htmlFor="pr-summary">Short summary (shown in the list)</label>
        <input id="pr-summary" style={field} value={value.summary} onChange={(e) => set('summary', e.target.value)} placeholder="What it covers and who it applies to" /></div>
      <div style={{ marginTop: 10 }}><label style={lbl} htmlFor="pr-body">Written rules or steps (optional if you attach a file)</label>
        <textarea id="pr-body" rows={8} style={{ ...field, resize: 'vertical', lineHeight: 1.5 }} value={value.body} onChange={(e) => set('body', e.target.value)}
          placeholder={'1. ...\n2. ...'} /></div>
      <div style={{ marginTop: 10 }}><label style={lbl} htmlFor="pr-file">{editing?.file_name ? `Replace the file (now: ${editing.file_name})` : 'Attach a file (PDF, Word, PowerPoint, Excel, image; up to 25 MB)'}</label>
        <input id="pr-file" type="file" accept={ACCEPT} onChange={(e) => set('file', e.target.files?.[0] || null)} style={{ fontSize: 13 }} /></div>
      {editing && <div style={{ marginTop: 10 }}><label style={lbl} htmlFor="pr-note">What changed (kept in the history)</label>
        <input id="pr-note" style={field} value={value.change_note} onChange={(e) => set('change_note', e.target.value)} placeholder="e.g. new magnesium sulphate regimen" /></div>}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 13, fontWeight: 600 }}>
        <input type="checkbox" checked={value.must_read} onChange={(e) => set('must_read', e.target.checked)} style={{ accentColor: '#0F6E56' }} />
        Every staff member of the department must read it
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" disabled={busy} style={{ ...css.backBtn, background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' }} onClick={onSave}>{busy ? 'Saving…' : editing ? 'Save update' : 'Publish'}</button>
        <button type="button" style={css.backBtn} onClick={onClose}>Close</button>
        {editing && <span style={{ fontSize: 12.5, color: '#475467' }}>Changing the title, rules or file makes a new revision: staff are asked to read it again.</span>}
      </div>
    </div>
  )
}

export default function DepartmentProtocols({ hospitalId, department, staff = [], css, SectionCard, EmptyState, onCount }) {
  const [docs, setDocs] = useState([])
  const [reads, setReads] = useState([])
  const [canPublish, setCanPublish] = useState(false)
  const [me, setMe] = useState({ user: null, staff: null })
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState(null)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [view, setView] = useState('active')
  const [q, setQ] = useState('')
  const today = localDateKey(new Date())

  const load = useCallback(async () => {
    if (!hospitalId) return
    const [d, perm, mine, user] = await Promise.all([
      supabase.from('department_documents').select('*').eq('hospital_id', hospitalId).eq('department', department).order('title'),
      supabase.rpc('dept_can_publish', { p_hospital: hospitalId, p_department: department }),
      supabase.rpc('hr_my_staff_id', { p_hospital: hospitalId }),
      supabase.auth?.getUser ? supabase.auth.getUser().catch(() => ({ data: null })) : Promise.resolve({ data: null }),
    ])
    if (d.error) { setErr(friendly(d.error)); return }
    const rows = (d.data || []).filter((x) => x.department === department)
    setDocs(rows)
    setCanPublish(Boolean(perm.data))
    setMe({ staff: mine?.data || null, user: user?.data?.user?.id || null })
    if (rows.length) {
      const r = await supabase.from('department_document_reads').select('document_id, revision, user_id, staff_id, read_at').eq('hospital_id', hospitalId).in('document_id', rows.map((x) => x.id))
      setReads(r.data || [])
    } else setReads([])
  }, [hospitalId, department])
  useEffect(() => { void load() }, [load])

  const deptStaffIds = useMemo(() => new Set(staff.filter((s) => String(s.status || 'Active') === 'Active').map((s) => s.id)), [staff])
  const readsOf = useCallback((doc) => reads.filter((r) => r.document_id === doc.id && r.revision === doc.revision), [reads])
  const iRead = useCallback((doc) => readsOf(doc).some((r) => (me.user && r.user_id === me.user) || (me.staff && r.staff_id === me.staff)), [readsOf, me])
  const active = docs.filter((x) => x.status !== 'archived')
  const archived = docs.filter((x) => x.status === 'archived')
  const unread = active.filter((x) => x.must_read && !iRead(x))
  useEffect(() => { onCount?.(unread.length) }, [unread.length, onCount])
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = (view === 'active' ? active : archived).filter((x) => words.every((w) => `${x.title} ${x.summary || ''} ${KINDS[x.kind] || ''}`.toLowerCase().includes(w)))
  const open = docs.find((x) => x.id === openId) || null

  async function upload(docId, file) {
    const path = `${hospitalId}/${docId}/${Date.now()}-${safeName(file.name)}`
    const { error } = await supabase.storage.from(PROTOCOL_BUCKET).upload(path, file, { contentType: DOCUMENT_TYPES[documentExtension(file.name)]?.mime || file.type, upsert: false })
    if (error) throw error
    return { file_path: path, file_name: file.name, file_type: documentExtension(file.name), file_size: file.size }
  }
  async function save() {
    const f = form
    if (!f.title.trim()) { setErr('Give the document a title.'); return }
    const bad = checkFile(f.file); if (bad) { setErr(bad); return }
    if (!editing && !f.file && !f.body.trim()) { setErr('Attach a file or write the rules.'); return }
    setBusy(true); setErr('')
    try {
      const fields = { title: f.title.trim(), kind: f.kind, version_label: f.version_label.trim() || null, effective_on: f.effective_on || null, review_on: f.review_on || null,
        must_read: f.must_read, summary: f.summary.trim() || null, body: f.body.trim() || null }
      if (editing) {
        const fileFields = f.file ? await upload(editing.id, f.file) : {}
        const { error } = await supabase.from('department_documents').update({ ...fields, ...fileFields, change_note: f.change_note.trim() || null }).eq('id', editing.id)
        if (error) throw error
        setNotice(`Updated ${fields.title}.`)
      } else {
        const { data, error } = await supabase.from('department_documents').insert({ hospital_id: hospitalId, department, ...fields }).select('id').single()
        if (error) throw error
        if (f.file) {
          try {
            const fileFields = await upload(data.id, f.file)
            const { error: e2 } = await supabase.from('department_documents').update(fileFields).eq('id', data.id)
            if (e2) throw e2
          } catch (e) {
            await supabase.from('department_documents').delete().eq('id', data.id) // no half-made document without its file
            throw e
          }
        }
        setNotice(`Published ${fields.title}.`)
      }
      setForm(null); setEditing(null); void load()
    } catch (e) { setErr(friendly(e)) } finally { setBusy(false) }
  }
  async function confirmRead(doc) {
    const { error } = await supabase.from('department_document_reads').insert({ document_id: doc.id, hospital_id: hospitalId, revision: doc.revision })
    if (error && !/duplicate|unique/i.test(error.message)) { setErr(friendly(error)); return }
    setNotice(`Recorded: you have read ${doc.title}.`); void load()
  }
  async function setStatus(doc, status) {
    const { error } = await supabase.from('department_documents').update({ status }).eq('id', doc.id)
    if (error) { setErr(friendly(error)); return }
    setNotice(status === 'archived' ? `${doc.title} is archived: kept for the record, no longer in use.` : `${doc.title} is back in use.`); void load()
  }
  async function remove(doc) {
    const hist = await supabase.from('department_document_history').select('file_path').eq('document_id', doc.id)
    const paths = [...new Set([doc.file_path, ...(hist.data || []).map((h) => h.file_path)].filter(Boolean))]
    const { error } = await supabase.from('department_documents').delete().eq('id', doc.id)
    if (error) { setErr(friendly(error)); return }
    if (paths.length) await supabase.storage.from(PROTOCOL_BUCKET).remove(paths)
    setOpenId(null); setNotice(`${doc.title} is deleted.`); void load()
  }
  const startEdit = (doc) => {
    setEditing(doc); setNotice(''); setErr('')
    setForm({ ...BLANK, title: doc.title || '', kind: doc.kind || 'protocol', version_label: doc.version_label || '', effective_on: doc.effective_on || '', review_on: doc.review_on || '',
      must_read: doc.must_read !== false, summary: doc.summary || '', body: doc.body || '' })
  }

  if (open) return <ProtocolReader doc={open} css={css} SectionCard={SectionCard} EmptyState={EmptyState} hospitalId={hospitalId} staff={staff} deptStaffIds={deptStaffIds}
    reads={readsOf(open)} iRead={iRead(open)} canPublish={canPublish} err={err} notice={notice}
    onBack={() => { setOpenId(null); setNotice(''); setErr('') }} onRead={() => void confirmRead(open)} onEdit={() => { setOpenId(null); startEdit(open) }}
    onArchive={() => void setStatus(open, open.status === 'archived' ? 'active' : 'archived')} onDelete={() => void remove(open)} />

  const primary = { ...css.backBtn, background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' }
  return (
    <SectionCard title="Protocols and rules" count={active.length}
      note={canPublish ? `You publish and update ${department}'s protocols. Staff confirm they have read each new revision.` : `Rules and procedures for ${department}. Open each one and confirm you have read it.`}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {[['active', `In use (${active.length})`], ['archived', `Archived (${archived.length})`]].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}
            style={{ ...css.backBtn, padding: '5px 12px', ...(view === k ? { background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' } : {}) }}>{l}</button>
        ))}
        {docs.length > 8 && <input type="search" aria-label="Search protocols" placeholder="Search title or summary" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #D0D5DD', borderRadius: 8, fontSize: 13, minWidth: 220 }} />}
        {canPublish && !form && <button type="button" style={{ ...primary, marginLeft: 'auto' }} onClick={() => { setForm({ ...BLANK }); setEditing(null); setNotice(''); setErr('') }}>Add protocol or document</button>}
      </div>
      {form && <Editor value={form} onChange={setForm} editing={editing} css={css} busy={busy} onSave={() => void save()} onClose={() => { setForm(null); setEditing(null); setErr('') }} />}
      {unread.length > 0 && !form && <div style={{ border: '1px solid #912018', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13, fontWeight: 600, color: '#912018' }}>
        You have {unread.length} {unread.length === 1 ? 'document' : 'documents'} to read.</div>}
      {notice && <div role="status" style={{ color: '#05603A', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{notice}</div>}
      {err && <div role="alert" style={{ color: '#912018', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{err}</div>}
      {list.length === 0 ? <EmptyState message={view === 'archived' ? 'Nothing archived.' : words.length ? 'Nothing matches this search.' : `No protocols for ${department} yet.${canPublish ? ' Use Add protocol or document.' : ''}`} /> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {list.map((doc) => {
            const readCount = new Set(readsOf(doc).map((r) => r.staff_id).filter((id) => deptStaffIds.has(id))).size
            const overdue = doc.review_on && doc.review_on < today
            const mine = iRead(doc)
            return (
              <div key={doc.id} style={{ border: '1px solid #EAECF0', borderRadius: 10, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: '#fff' }}>
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <button type="button" onClick={() => { setOpenId(doc.id); setNotice(''); setErr('') }}
                    style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontSize: 15, fontWeight: 800, color: '#101828', textAlign: 'left', fontFamily: 'inherit' }}>{doc.title}</button>
                  <div style={{ fontSize: 12.5, color: '#475467', marginTop: 2 }}>
                    {KINDS[doc.kind] || 'Document'}{doc.version_label ? ` · ${doc.version_label}` : ''} · revision {doc.revision}{doc.file_name ? ` · ${(DOCUMENT_TYPES[documentExtension(doc.file_name)]?.label) || 'File'}` : ''}{doc.body ? ' · written rules' : ''}
                  </div>
                  {doc.summary && <div style={{ fontSize: 13, color: '#344054', marginTop: 4 }}>{doc.summary}</div>}
                </div>
                <div style={{ fontSize: 12.5, minWidth: 170 }}>
                  {doc.review_on && <div style={{ color: overdue ? '#B54708' : '#475467', fontWeight: overdue ? 700 : 500 }}>{overdue ? 'Review overdue since ' : 'Review by '}{fmtDate(doc.review_on)}</div>}
                  {doc.must_read && deptStaffIds.size > 0 && <div style={{ color: '#344054' }}>Read by {readCount} of {deptStaffIds.size} staff</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
                  {doc.status === 'archived' ? <span style={{ fontSize: 12.5, color: '#475467', fontWeight: 700 }}>Archived</span>
                    : mine ? <span style={{ fontSize: 12.5, color: '#05603A', fontWeight: 700 }}>You have read this</span>
                    : doc.must_read ? <span style={{ fontSize: 12.5, color: '#912018', fontWeight: 700 }}>Not read yet</span> : null}
                  <button type="button" style={{ ...css.backBtn, padding: '4px 12px' }} onClick={() => { setOpenId(doc.id); setNotice(''); setErr('') }} aria-label={`Open ${doc.title}`}>Open</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

// names in columns, 24 at a time: large departments stay on one screen
function NameGrid({ title, tone, people, detail, css }) {
  const [all, setAll] = useState(false)
  const shown = all ? people : people.slice(0, 24)
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: tone, marginBottom: 4 }}>{title}</div>
      {people.length === 0 ? <div style={{ fontSize: 13, color: '#475467' }}>Nobody.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', columnGap: 16 }}>
          {shown.map((s) => <div key={s.id} style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px solid #EAECF0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.full_name}<span style={{ color: '#475467' }}>{detail(s) ? ` · ${detail(s)}` : ''}</span></div>)}
        </div>
      )}
      {people.length > 24 && <button type="button" style={{ ...css.backBtn, padding: '3px 10px', marginTop: 6, fontSize: 12.5 }} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${people.length}`}</button>}
    </div>
  )
}

function ProtocolReader({ doc, css, SectionCard, EmptyState, hospitalId, staff, deptStaffIds, reads, iRead, canPublish, err, notice, onBack, onRead, onEdit, onArchive, onDelete }) {
  const [url, setUrl] = useState('')
  const [urlErr, setUrlErr] = useState('')
  const [history, setHistory] = useState([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showWho, setShowWho] = useState(false)
  useEffect(() => {
    let live = true
    setUrl(''); setUrlErr('')
    if (doc.file_path) {
      supabase.storage.from(PROTOCOL_BUCKET).createSignedUrl(doc.file_path, 3600).then(({ data, error }) => {
        if (!live) return
        if (error || !data?.signedUrl) setUrlErr('The file could not be opened. Try again, or ask the department manager to upload it again.')
        else setUrl(data.signedUrl)
      })
    }
    supabase.from('department_document_history').select('*').eq('document_id', doc.id).order('revision', { ascending: false }).then(({ data }) => { if (live) setHistory((data || []).filter((h) => h.document_id === doc.id)) })
    return () => { live = false }
  }, [doc.id, doc.file_path, hospitalId])
  const readers = new Map(reads.map((r) => [r.staff_id, r]))
  const people = staff.filter((s) => deptStaffIds.has(s.id))
  const done = people.filter((s) => readers.has(s.id))
  const notYet = people.filter((s) => !readers.has(s.id))

  return (
    <SectionCard title={doc.title}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <button type="button" style={css.backBtn} onClick={onBack}>‹ All protocols</button>
        <span style={{ fontSize: 12.5, color: '#475467' }}>
          {KINDS[doc.kind] || 'Document'}{doc.version_label ? ` · ${doc.version_label}` : ''} · revision {doc.revision}{doc.effective_on ? ` · in use from ${fmtDate(doc.effective_on)}` : ''}{doc.review_on ? ` · next review ${fmtDate(doc.review_on)}` : ''}
        </span>
        {canPublish && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" style={css.backBtn} onClick={onEdit}>Update</button>
            <button type="button" style={css.backBtn} onClick={onArchive}>{doc.status === 'archived' ? 'Put back in use' : 'Archive'}</button>
            {!confirmDelete ? <button type="button" style={css.dangerBtn} onClick={() => setConfirmDelete(true)}>Delete</button> : (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: '#912018' }}>Delete with all revisions and read records?</span>
                <button type="button" style={css.dangerBtn} onClick={onDelete}>Delete for good</button>
                <button type="button" style={css.backBtn} onClick={() => setConfirmDelete(false)}>Keep</button>
              </span>
            )}
          </span>
        )}
      </div>
      {notice && <div role="status" style={{ color: '#05603A', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{notice}</div>}
      {err && <div role="alert" style={{ color: '#912018', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{err}</div>}
      {doc.summary && <p style={{ fontSize: 14, color: '#344054', margin: '0 0 10px' }}>{doc.summary}</p>}
      {doc.body && <div style={{ whiteSpace: 'pre-wrap', fontSize: 14.5, lineHeight: 1.6, color: '#101828', border: '1px solid #EAECF0', borderRadius: 8, padding: '12px 16px', background: '#fff', maxWidth: 900 }}>{doc.body}</div>}
      {doc.file_path && (urlErr ? <div role="alert" style={{ color: '#912018', fontSize: 13, marginTop: 8 }}>{urlErr}</div>
        : url ? <DocumentViewer document={{ file_name: doc.file_name, signed_url: url }} /> : <p role="status" style={{ fontSize: 13, color: '#475467' }}>Opening the file…</p>)}
      {!doc.body && !doc.file_path && <EmptyState message="This document has no content yet." />}

      {doc.status !== 'archived' && (
        <div style={{ marginTop: 14, padding: '10px 14px', border: `1px solid ${iRead ? '#05603A' : '#D0D5DD'}`, borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {iRead ? <strong style={{ color: '#05603A', fontSize: 13.5 }}>You have read revision {doc.revision}.</strong> : (
            <>
              <button type="button" style={{ ...css.backBtn, background: '#0F6E56', color: '#fff', borderColor: '#0F6E56' }} onClick={onRead}>I have read and understood this</button>
              <span style={{ fontSize: 12.5, color: '#475467' }}>Your name and the time are recorded for revision {doc.revision}.</span>
            </>
          )}
        </div>
      )}

      {canPublish && doc.must_read && people.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button type="button" style={css.backBtn} aria-expanded={showWho} onClick={() => setShowWho((v) => !v)}>{showWho ? 'Hide' : 'Show'} who has read it ({done.length} of {people.length})</button>
          {showWho && (
            <div style={{ marginTop: 10, display: 'grid', gap: 14 }}>
              <NameGrid title={`Not read yet (${notYet.length})`} tone="#912018" people={notYet} css={css} detail={(s) => s.job_title || ''} />
              <NameGrid title={`Read (${done.length})`} tone="#05603A" people={done} css={css} detail={(s) => new Date(readers.get(s.id).read_at).toLocaleDateString('en-KE')} />
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#344054', marginBottom: 6 }}>Earlier revisions</div>
          <table style={css.table}>
            <thead><tr>{['Revision', 'Title', 'Version', 'Changed', 'Change note'].map((h) => <th key={h} style={css.th}>{h}</th>)}</tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id}><td style={css.td}>{h.revision}</td><td style={css.td}>{h.title}{h.file_name ? <div style={{ fontSize: 12, color: '#475467' }}>{h.file_name}</div> : null}</td><td style={css.td}>{h.version_label || '—'}</td>
                <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{new Date(h.changed_at).toLocaleDateString('en-KE')}</td><td style={css.td}>{h.change_note || '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}
