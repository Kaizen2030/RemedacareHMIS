// Hospital library: documents (PDF, Word, PowerPoint, Excel, text, images up to 50 MB) and links that are not tied to
// one guide, searchable by title, category, tags and description, read inside the app. Rows live in
// clinical_content_documents with guide_id '_library' (20261228000000_clinical_library.sql).
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { C, Chip, s } from '../ncd/ui'
import { isHttpUrl } from './approval'
import { DOCUMENT_BUCKET, DOCUMENT_TYPES, DocumentViewer, MAX_DOCUMENT_BYTES, documentExtension } from './documents'

export const LIBRARY_ID = '_library'
export const LIBRARY_CATEGORIES = ['National guidelines', 'Hospital protocols & SOPs', 'Formulary & drug information', 'Antimicrobial stewardship', 'Laboratory', 'Nursing', 'Maternity & child health', 'Training material', 'Forms & templates', 'Other']
const PERMISSION_TEXT = 'Only an authorised clinical lead, consultant, head of department, pharmacist or administrator can change the library.'
const friendly = (e) => (/row-level|permission|Only an authorised/i.test(e?.message || '') ? PERMISSION_TEXT : e?.message || 'Something went wrong.')
const sizeText = (n) => (!n ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
export const parseTags = (text) => [...new Set(String(text || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 30)

/** Search across title, file name, category, tags and description (every word must match). */
export function matchesLibrary(entry, query, category) {
  if (category && entry.category !== category) return false
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [entry.title, entry.file_name, entry.category, entry.description, ...(entry.tags || [])].join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

function EntryForm({ entry, onCancel, onSaved, hospitalId }) {
  const isNew = !entry.id
  const [form, setForm] = useState({ kind: entry.kind || 'file', title: entry.title || '', category: entry.category || LIBRARY_CATEGORIES[0], tags: (entry.tags || []).join(', '), description: entry.description || '', link_url: entry.link_url || '' })
  const [file, setFile] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const pickFile = (e) => {
    const f = e.target.files?.[0] || null
    setErr('')
    if (f && !DOCUMENT_TYPES[documentExtension(f.name)]) { setErr('Use PDF, Word (DOCX), PowerPoint (PPTX), Excel (XLSX or XLS), CSV, TXT, PNG, JPG or WebP. Convert older DOC/PPT files to PDF first.'); setFile(null); return }
    if (f && f.size > MAX_DOCUMENT_BYTES) { setErr(`This file is ${sizeText(f.size)}. Files must be 50 MB or smaller: split a large book into chapters, or add it as a link to where it is stored.`); setFile(null); return }
    setFile(f)
    if (f && !form.title) setForm((x) => ({ ...x, title: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') }))
  }
  const save = async (e) => {
    e.preventDefault()
    setErr('')
    const title = form.title.trim()
    if (!title) { setErr('Give the entry a title.'); return }
    const meta = { title, category: form.category || null, tags: parseTags(form.tags), description: form.description.trim() || null }
    if (form.kind === 'link' && !isHttpUrl(form.link_url.trim())) { setErr('Enter a full link starting with https://'); return }
    setBusy(true)
    try {
      if (!isNew) {
        const { error } = await supabase.from('clinical_content_documents').update({ ...meta, ...(form.kind === 'link' ? { link_url: form.link_url.trim() } : {}) }).eq('id', entry.id)
        if (error) { setErr(friendly(error)); return }
      } else if (form.kind === 'link') {
        const { error } = await supabase.from('clinical_content_documents').insert({ hospital_id: hospitalId, guide_id: LIBRARY_ID, kind: 'link', link_url: form.link_url.trim(), file_name: title, ...meta })
        if (error) { setErr(friendly(error)); return }
      } else {
        if (!file) { setErr('Choose a file to upload.'); return }
        const type = DOCUMENT_TYPES[documentExtension(file.name)]
        const objectPath = `${hospitalId}/${LIBRARY_ID}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const up = await supabase.storage.from(DOCUMENT_BUCKET).upload(objectPath, file, { contentType: type.mime, upsert: false })
        if (up.error) { setErr(/exceeded|too large|413/i.test(up.error.message) ? 'The file is larger than your Supabase storage allows. Run docs/sql/46 (raises the limit to 50 MB) or split the file.' : friendly(up.error)); return }
        const { error } = await supabase.from('clinical_content_documents').insert({ hospital_id: hospitalId, guide_id: LIBRARY_ID, kind: 'file', object_path: objectPath, file_name: file.name, file_size: file.size, content_type: type.mime, ...meta })
        if (error) {
          await supabase.storage.from(DOCUMENT_BUCKET).remove([objectPath])
          setErr(friendly(error)); return
        }
      }
      onSaved()
    } catch (x) {
      setErr(x.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={save} style={{ ...s.card, marginBottom: 12 }} aria-label={isNew ? 'Add to library' : 'Edit library entry'}>
      <h3 style={s.h2}>{isNew ? 'Add to the library' : 'Edit library entry'}</h3>
      {isNew && (
        <div role="radiogroup" aria-label="What are you adding?" style={{ display: 'flex', gap: 14, margin: '8px 0', fontSize: 13 }}>
          <label><input type="radio" name="lib-kind" checked={form.kind === 'file'} onChange={() => setForm((f) => ({ ...f, kind: 'file' }))} /> Upload a file (up to 50 MB)</label>
          <label><input type="radio" name="lib-kind" checked={form.kind === 'link'} onChange={() => setForm((f) => ({ ...f, kind: 'link' }))} /> Link to a website or shared drive</label>
        </div>
      )}
      <div style={{ ...s.grid(220), marginTop: 8 }}>
        {isNew && form.kind === 'file' && <div><label style={s.label} htmlFor="lib-file">File</label><input id="lib-file" type="file" accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg,.webp" onChange={pickFile} style={s.input} /></div>}
        {form.kind === 'link' && <div><label style={s.label} htmlFor="lib-url">Link</label><input id="lib-url" type="url" style={s.input} placeholder="https://" value={form.link_url} onChange={set('link_url')} /></div>}
        <div><label style={s.label} htmlFor="lib-title">Title</label><input id="lib-title" style={s.input} value={form.title} onChange={set('title')} maxLength={300} /></div>
        <div><label style={s.label} htmlFor="lib-category">Category</label>
          <select id="lib-category" style={s.input} value={form.category} onChange={set('category')}>{LIBRARY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label style={s.label} htmlFor="lib-tags">Tags (comma separated)</label><input id="lib-tags" style={s.input} placeholder="e.g. sepsis, antibiotics, ICU" value={form.tags} onChange={set('tags')} /></div>
      </div>
      <label style={{ ...s.label, marginTop: 8 }} htmlFor="lib-desc">What is it for? (helps people find it)</label>
      <textarea id="lib-desc" style={s.input} rows={3} maxLength={4000} value={form.description} onChange={set('description')} />
      {err && <div role="alert" style={{ ...s.err, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="submit" style={{ ...s.btn, ...s.pri }} disabled={busy}>{busy ? (form.kind === 'file' && isNew ? 'Uploading…' : 'Saving…') : 'Save'}</button>
        <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  )
}

export default function ClinicalLibrary({ hospitalId, canEdit }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState(null)
  const [reading, setReading] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState('')
  const load = useCallback(async () => {
    if (!hospitalId) { setEntries([]); setLoading(false); return }
    setLoading(true)
    const { data, error: e } = await supabase.from('clinical_content_documents').select('*').eq('hospital_id', hospitalId).eq('guide_id', LIBRARY_ID).order('created_at', { ascending: false })
    setLoading(false)
    if (e) { setError(/column|does not exist/i.test(e.message) ? 'The library needs docs/sql/46_clinical_library.sql to be run in Supabase first.' : e.message); return }
    setError('')
    setEntries(data || [])
  }, [hospitalId])
  useEffect(() => { void load() }, [load])
  const shown = useMemo(() => entries.filter((e) => matchesLibrary(e, q, category)), [entries, q, category])
  const categories = useMemo(() => [...new Set(entries.map((e) => e.category).filter(Boolean))].sort(), [entries])

  const read = async (entry) => {
    if (reading?.id === entry.id) { setReading(null); return }
    const { data, error: e } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(entry.object_path, 3600)
    if (e || !data?.signedUrl) { setError(`"${entry.title || entry.file_name}" could not be opened: ${e?.message || 'file not found in storage'}`); return }
    setReading({ ...entry, signed_url: data.signedUrl })
  }
  const remove = async (entry) => {
    setError('')
    const { error: e } = await supabase.from('clinical_content_documents').delete().eq('id', entry.id)
    if (e) { setError(friendly(e)); return }
    if (entry.kind === 'file' && entry.object_path) {
      const { error: fe } = await supabase.storage.from(DOCUMENT_BUCKET).remove([entry.object_path])
      if (fe) setError(`Removed from the library, but the stored copy could not be deleted: ${fe.message}`)
    }
    setConfirmRemove('')
    if (reading?.id === entry.id) setReading(null)
    void load()
  }

  return (
    <div>
      <div style={{ ...s.card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 12 }}>
        <div style={{ flex: '1 1 260px' }}><label style={s.label} htmlFor="lib-q">Search the library</label>
          <input id="lib-q" style={s.input} placeholder="Title, tag or topic, e.g. sepsis, formulary, EUCAST" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div><label style={s.label} htmlFor="lib-cat-filter">Category</label>
          <select id="lib-cat-filter" style={s.input} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div style={s.sub}>{shown.length} of {entries.length}</div>
        {canEdit && hospitalId && !editing && <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => setEditing({})}>Add to library</button>}
      </div>
      {canEdit && (
        <p style={{ ...s.sub, margin: '0 0 12px' }}>
          Add only documents your hospital wrote or is allowed to share with all staff (Ministry of Health and WHO guidelines, your own protocols, EUCAST tables with citation).
          Purchased books and exam-preparation material are usually licensed to one person and must not be shared here.
        </p>
      )}
      {editing && <EntryForm entry={editing} hospitalId={hospitalId} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
      {error && <div role="alert" style={s.err}>{error}</div>}
      {loading && <p role="status" style={s.sub}>Loading the library…</p>}
      {!loading && !error && entries.length === 0 && (
        <div style={{ ...s.card, ...s.sub }}>The library is empty.{canEdit ? ' Use Add to library to upload your national guidelines, hospital protocols and formulary.' : ' Your clinical lead can add documents here.'}</div>
      )}
      {!loading && entries.length > 0 && shown.length === 0 && <div style={{ ...s.card, ...s.sub }}>Nothing matches.</div>}
      {shown.map((entry) => (
        <article key={entry.id} style={{ ...s.card, marginBottom: 10 }} aria-label={entry.title || entry.file_name}>
          {editing?.id === entry.id ? null : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: C.textStrong }}>{entry.title || entry.file_name}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                    {entry.category && <Chip tone="blue">{entry.category}</Chip>}
                    {(entry.tags || []).map((t) => <Chip key={t} tone="gray">{t}</Chip>)}
                    <span style={s.sub}>{entry.kind === 'link' ? 'Link' : `${DOCUMENT_TYPES[documentExtension(entry.file_name)]?.label || 'File'} · ${sizeText(entry.file_size)}`} · added {String(entry.created_at).slice(0, 10)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {entry.kind === 'link'
                    ? <a href={entry.link_url} target="_blank" rel="noreferrer noopener" style={{ ...s.btn, ...s.soft, textDecoration: 'none' }}>Open link</a>
                    : <button type="button" style={{ ...s.btn, ...s.soft }} aria-expanded={reading?.id === entry.id} onClick={() => void read(entry)}>{reading?.id === entry.id ? 'Close' : 'Read'}</button>}
                  {canEdit && <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setEditing(entry)}>Edit</button>}
                  {canEdit && confirmRemove !== entry.id && <button type="button" style={{ ...s.btn, ...s.ghost, color: C.danger }} onClick={() => setConfirmRemove(entry.id)}>Remove</button>}
                  {canEdit && confirmRemove === entry.id && (
                    <span role="alertdialog" aria-label="Confirm remove" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 12 }}>Remove for everyone?</span>
                      <button type="button" style={{ ...s.btn, background: C.danger, color: '#fff' }} onClick={() => void remove(entry)}>Remove</button>
                      <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setConfirmRemove('')}>Cancel</button>
                    </span>
                  )}
                </div>
              </div>
              {entry.description && <p style={{ fontSize: 13, margin: '8px 0 0', color: C.text, whiteSpace: 'pre-wrap' }}>{entry.description}</p>}
              {reading?.id === entry.id && <DocumentViewer document={reading} />}
            </>
          )}
        </article>
      ))}
    </div>
  )
}
