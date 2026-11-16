// Care pathways: step-by-step bedside workflows. Built-in pathways come from src/data/carePathways.js; each hospital can
// edit, remove, restore, add its own or start fresh (clinical_content_revisions, content_type 'pathway'), approve a
// version (clinical_guide_approvals, guide_id 'pathway:<id>') and attach files. During an encounter, staff can tick
// steps and copy the ticked steps into the clinical note.
import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../supabase'
import { useHospital } from '../context'
import { CARE_PATHWAYS, PATHWAY_VERSION, suggestPathwayId } from '../data/carePathways'
import { CLINICAL_GUIDES } from '../data/clinicalGuides'
import { C, Chip, s } from './ncd/ui'
import OrderSetsAdmin from './OrderSetsAdmin'
import { ApprovalBar, isHttpUrl } from './clinical/approval'
import { ClinicalDocumentPanel } from './clinical/documents'
import { builtinDefault, ContentManager, customItems, findRevision, isBuiltinHidden, RemoveItemButton, useClinicalContent } from './clinical/content'
import ReaderLayout, { ReaderArticle, ReaderSection, ReaderTools } from './clinical/ReaderLayout'

const lines = (text) => String(text || '').split('\n').map((x) => x.trim()).filter(Boolean)

/** Built-in pathway with the hospital's saved edits applied; hospital-written pathways are returned as saved. */
export function effectivePathway(base, revision) {
  const content = revision?.content || {}
  const custom = Boolean(base.custom || content.custom)
  const baseVersion = custom ? (content.version || '1') : base.version || PATHWAY_VERSION
  const n = revision?.revision || 0
  const version = n > (custom ? 1 : 0) ? `${baseVersion}-r${custom ? n - 1 : n}` : baseVersion
  return { stages: [], redFlags: [], sources: [], guideIds: [], inSystem: [], match: [], ...base, ...content, id: base.id, custom, baseVersion, version }
}

function PathwayEditor({ pathway, onCancel, onSave }) {
  const [form, setForm] = useState(() => ({
    title: pathway.title || '', category: pathway.category || '', summary: pathway.summary || '',
    match: (pathway.match || []).join(', '),
    stages: (pathway.stages?.length ? pathway.stages : [{ heading: '', points: [] }]).map((st) => ({ heading: st.heading, points: (st.points || []).join('\n') })),
    redFlags: (pathway.redFlags || []).join('\n'),
    sources: (pathway.sources || []).map((x) => ({ text: x.text, url: x.url || '' })),
  }))
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const setStage = (i, patch) => setForm((f) => ({ ...f, stages: f.stages.map((st, j) => (j === i ? { ...st, ...patch } : st)) }))
  const move = (i, d) => setForm((f) => {
    const st = [...f.stages]; const j = i + d
    if (j < 0 || j >= st.length) return f
    ;[st[i], st[j]] = [st[j], st[i]]
    return { ...f, stages: st }
  })
  const save = async (e) => {
    e.preventDefault()
    const stages = form.stages.map((st) => ({ heading: st.heading.trim(), points: lines(st.points) })).filter((st) => st.heading || st.points.length)
    if (!form.title.trim() || !form.summary.trim()) { setErr('Give the pathway a title and a one-line summary.'); return }
    if (!stages.length || stages.some((st) => !st.heading || !st.points.length)) { setErr('Each step needs a heading and at least one point.'); return }
    const sources = form.sources.filter((x) => x.text.trim() || x.url.trim())
    if (sources.some((x) => !x.text.trim())) { setErr('Each source needs a description.'); return }
    if (sources.some((x) => x.url.trim() && !isHttpUrl(x.url.trim()))) { setErr('Source links must start with http:// or https://'); return }
    setErr(''); setSaving(true)
    const r = await onSave({
      title: form.title.trim(), category: form.category.trim() || 'Hospital pathways', summary: form.summary.trim(),
      match: form.match.split(',').map((m) => m.trim()).filter(Boolean), stages, redFlags: lines(form.redFlags),
      sources: sources.map((x) => ({ text: x.text.trim(), url: x.url.trim() || null })),
    })
    setSaving(false)
    if (r?.error) setErr(r.error)
  }
  return (
    <form onSubmit={save} style={{ ...s.card }} aria-label={pathway.id ? 'Edit pathway' : 'New pathway'}>
      <h2 style={s.h2}>{pathway.id ? 'Edit pathway' : 'New pathway'}</h2>
      <div style={{ ...s.grid(220), marginTop: 8 }}>
        <div><label style={s.label} htmlFor="pw-title">Title</label><input id="pw-title" style={s.input} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
        <div><label style={s.label} htmlFor="pw-category">Category</label><input id="pw-category" style={s.input} list="pw-categories" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
          <datalist id="pw-categories">{[...new Set(CARE_PATHWAYS.map((p) => p.category))].map((c) => <option key={c} value={c} />)}</datalist></div>
        <div><label style={s.label} htmlFor="pw-match">Diagnosis words that suggest it (comma separated)</label><input id="pw-match" style={s.input} placeholder="e.g. snakebite, envenomation" value={form.match} onChange={(e) => setForm((f) => ({ ...f, match: e.target.value }))} /></div>
      </div>
      <label style={{ ...s.label, marginTop: 8 }} htmlFor="pw-summary">Summary</label>
      <textarea id="pw-summary" style={s.input} rows={2} value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} />
      <h3 style={{ ...s.h2, marginTop: 14 }}>Steps</h3>
      {form.stages.map((st, i) => (
        <div key={i} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 10 }}>
          <div style={{ ...s.grid(240), alignItems: 'start' }}>
            <div><label style={s.label} htmlFor={`pw-stage-${i}`}>Step {i + 1} heading</label><input id={`pw-stage-${i}`} style={s.input} placeholder="e.g. First hour" value={st.heading} onChange={(e) => setStage(i, { heading: e.target.value })} /></div>
            <div><label style={s.label} htmlFor={`pw-points-${i}`}>What to do (one point per line)</label><textarea id={`pw-points-${i}`} style={s.input} rows={5} value={st.points} onChange={(e) => setStage(i, { points: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button type="button" style={{ ...s.btn, ...s.ghost }} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move step ${i + 1} up`}>↑</button>
            <button type="button" style={{ ...s.btn, ...s.ghost }} disabled={i === form.stages.length - 1} onClick={() => move(i, 1)} aria-label={`Move step ${i + 1} down`}>↓</button>
            <button type="button" style={{ ...s.btn, ...s.ghost }} disabled={form.stages.length < 2} onClick={() => setForm((f) => ({ ...f, stages: f.stages.filter((_, j) => j !== i) }))}>Remove step</button>
          </div>
        </div>
      ))}
      <button type="button" style={{ ...s.btn, ...s.soft, marginTop: 8 }} onClick={() => setForm((f) => ({ ...f, stages: [...f.stages, { heading: '', points: '' }] }))}>Add step</button>
      <label style={{ ...s.label, marginTop: 14 }} htmlFor="pw-red">Red flags: call a senior / escalate (one per line)</label>
      <textarea id="pw-red" style={s.input} rows={4} value={form.redFlags} onChange={(e) => setForm((f) => ({ ...f, redFlags: e.target.value }))} />
      <h3 style={{ ...s.h2, marginTop: 14 }}>Sources</h3>
      {form.sources.map((x, i) => (
        <div key={i} style={{ ...s.grid(220), alignItems: 'end', marginTop: 6 }}>
          <div><label style={s.label} htmlFor={`pw-src-${i}`}>Source</label><input id={`pw-src-${i}`} style={s.input} value={x.text} onChange={(e) => setForm((f) => ({ ...f, sources: f.sources.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) }))} /></div>
          <div><label style={s.label} htmlFor={`pw-src-url-${i}`}>Link (optional)</label><input id={`pw-src-url-${i}`} type="url" style={s.input} value={x.url} onChange={(e) => setForm((f) => ({ ...f, sources: f.sources.map((y, j) => (j === i ? { ...y, url: e.target.value } : y)) }))} /></div>
          <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setForm((f) => ({ ...f, sources: f.sources.filter((_, j) => j !== i) }))}>Remove source</button>
        </div>
      ))}
      <button type="button" style={{ ...s.btn, ...s.soft, marginTop: 8 }} onClick={() => setForm((f) => ({ ...f, sources: [...f.sources, { text: '', url: '' }] }))}>Add source</button>
      {err && <div role="alert" style={{ ...s.err, marginTop: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="submit" style={{ ...s.btn, ...s.pri }} disabled={saving}>{saving ? 'Saving…' : 'Save pathway'}</button>
        <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
      <p style={{ ...s.sub, marginTop: 8 }}>Saving creates a new version for this hospital. It shows as a draft until your clinical lead approves it.</p>
    </form>
  )
}

export default function CarePathways() {
  const { navigationState, clearNavigationState, navigate, hospitalId } = useHospital()
  const content = useClinicalContent(hospitalId)
  const { revisions, canEdit } = content
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [readerRequested, setReaderRequested] = useState(false)
  const [encounter, setEncounter] = useState(null)
  const [editing, setEditing] = useState(null)
  const [ticked, setTicked] = useState({})
  const [openSteps, setOpenSteps] = useState({})
  const [copied, setCopied] = useState('')
  const [approvals, setApprovals] = useState([])

  const builtinIds = useMemo(() => CARE_PATHWAYS.map((p) => p.id), [])
  const hiddenIds = useMemo(() => new Set(builtinIds.filter((id) => isBuiltinHidden(revisions, 'pathway', id))), [builtinIds, revisions])
  const custom = useMemo(() => customItems(revisions, 'pathway').map((r) => effectivePathway({ id: r.content_id, custom: true }, r)), [revisions])
  const all = useMemo(() => [...CARE_PATHWAYS.map((p) => effectivePathway(p, findRevision(revisions, 'pathway', p.id))), ...custom], [revisions, custom])
  const visible = useMemo(() => all.filter((p) => p.custom || !hiddenIds.has(p.id)), [all, hiddenIds])
  const categories = useMemo(() => [...new Set(visible.map((p) => p.category).filter(Boolean))], [visible])

  useEffect(() => {
    if (!navigationState) return
    const suggested = suggestPathwayId(visible, navigationState.suggestedProtocol, navigationState.diagnosisText, navigationState.suggestedCondition)
    setEncounter({ patientId: navigationState.patientId || null, patientName: navigationState.patientName || '', suggestedId: suggested })
    if (suggested) { setSelectedId(suggested); setReaderRequested(true) }
    clearNavigationState?.()
  }, [navigationState, clearNavigationState, visible])

  const loadApprovals = useCallback(async () => {
    if (!hospitalId) return
    const { data } = await supabase.from('clinical_guide_approvals').select('*').eq('hospital_id', hospitalId).is('withdrawn_at', null).like('guide_id', 'pathway:%')
    setApprovals(data || [])
  }, [hospitalId])
  useEffect(() => { void loadApprovals() }, [loadApprovals])

  const filtered = visible.filter((p) => (!category || p.category === category)
    && (!search.trim() || `${p.title} ${p.category} ${p.summary} ${(p.match || []).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())))
  const selected = all.find((p) => p.id === selectedId) || filtered[0] || null
  const approvalTarget = selected ? { id: `pathway:${selected.id}`, version: selected.version } : null
  const approval = selected && approvals.find((a) => a.guide_id === approvalTarget.id && a.version === approvalTarget.version)
  const tickKey = (si, pi) => `${selected?.id}|${si}|${pi}`
  const tickedLines = selected ? (selected.stages || []).flatMap((st, si) => st.points.map((p, pi) => (ticked[tickKey(si, pi)] ? `${st.heading}: ${p}` : null))).filter(Boolean) : []
  // The first step starts open; the reader can open, close, expand or collapse the rest.
  const stepOpen = (si) => openSteps[`${selected?.id}|${si}`] ?? si === 0
  const setAllSteps = (open) => setOpenSteps((o) => ({ ...o, ...Object.fromEntries((selected?.stages || []).map((_, si) => [`${selected.id}|${si}`, open])) }))
  const allOpen = Boolean(selected?.stages?.length) && selected.stages.every((_, si) => stepOpen(si))

  const choose = (id) => { setSelectedId(id); setEditing(null); setReaderRequested(true) }
  const savePathway = async (fields) => {
    const isNew = !editing.id
    const id = editing.id || `local-${crypto.randomUUID()}`
    const base = isNew ? { custom: true, version: '1' } : (findRevision(revisions, 'pathway', id)?.content || {})
    const payload = { ...base, ...fields, ...(editing.custom || isNew ? { custom: true } : {}), version: isNew ? '1' : (editing.custom ? editing.baseVersion : editing.baseVersion || PATHWAY_VERSION) }
    if (!editing.custom && !isNew) payload.hidden = base.hidden
    const r = await content.save('pathway', id, payload)
    if (!r.error) { setEditing(null); setSelectedId(id); setReaderRequested(true) }
    return r
  }
  const removePathway = async (p) => {
    const r = p.custom ? await content.removeMany('pathway', [p.id]) : await content.setHidden('pathway', p.id, true)
    if (!r.error) { setSelectedId(''); setReaderRequested(false) }
    return r
  }
  const copyTicked = async () => {
    const text = `Care pathway: ${selected.title} (version ${selected.version})\n` + tickedLines.map((l) => `✓ ${l}`).join('\n')
    try { await navigator.clipboard.writeText(text); setCopied('Copied. Paste it into the consultation note.') } catch { setCopied('Copy failed: select and copy the list manually.') }
    setTimeout(() => setCopied(''), 4000)
  }

  const list = (
    <>
      {canEdit && hospitalId && <button type="button" style={{ ...s.btn, ...s.pri, width: '100%', marginBottom: 8 }} onClick={() => { setEditing({ id: '', custom: true }); setReaderRequested(true) }}>Add pathway</button>}
      {canEdit && hospitalId && (
        <ContentManager noun="pathways" builtinIds={builtinIds} customCount={custom.length}
          hiddenItems={all.filter((p) => !p.custom && hiddenIds.has(p.id)).map((p) => ({ id: p.id, title: p.title }))}
          fresh={builtinDefault(revisions, 'pathway') === 'hidden'}
          onStartFresh={({ deleteCustom }) => content.startFresh('pathway', builtinIds, { deleteCustom })}
          onRestoreAll={() => content.restoreAll('pathway', builtinIds)}
          onRestore={(id) => content.setHidden('pathway', id, false)} />
      )}
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search pathways" aria-label="Search pathways" style={{ ...s.input, marginBottom: 8 }} />
      <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter pathways by category" style={{ ...s.input, marginBottom: 10 }}>
        <option value="">All pathways</option>
        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <nav aria-label="Care pathways" style={{ display: 'grid', gap: 2 }}>
        {filtered.map((p) => {
          const ok = approvals.some((a) => a.guide_id === `pathway:${p.id}` && a.version === p.version)
          const current = selected?.id === p.id
          return (
            <button key={p.id} type="button" onClick={() => choose(p.id)} aria-current={current ? 'page' : undefined}
              style={{ textAlign: 'left', padding: '8px 10px', border: 'none', borderLeft: `3px solid ${current ? C.primary : 'transparent'}`, borderRadius: 6, background: current ? C.primaryL : 'transparent', color: C.text, cursor: 'pointer' }}>
              <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>{p.title}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={s.sub}>{p.category}</span>
                {p.custom && <Chip tone="blue">hospital</Chip>}
                {ok ? <Chip tone="green">approved</Chip> : <Chip tone="yellow">draft</Chip>}
                {encounter?.suggestedId === p.id && <Chip tone="blue">suggested</Chip>}
              </div>
            </button>
          )
        })}
      </nav>
      {filtered.length === 0 && <div style={{ ...s.sub, padding: 10 }}>{visible.length ? 'No pathway matches this search.' : `No pathways at this hospital yet.${canEdit ? ' Use Add pathway to write one.' : ''}`}</div>}
    </>
  )

  const article = editing
    ? <PathwayEditor key={editing.id || 'new'} pathway={editing} onCancel={() => setEditing(null)} onSave={savePathway} />
    : !selected
      ? <div style={{ ...s.card, ...s.sub }}>Choose a pathway.</div>
      : (
        <ReaderArticle label={selected.title}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 280px' }}>
              <div style={{ color: C.primary, fontSize: 11, textTransform: 'uppercase', fontWeight: 800, letterSpacing: '.04em' }}>{selected.category}</div>
              <h2 style={{ ...s.h1, fontSize: 21, marginTop: 4, lineHeight: 1.3 }}>{selected.title}</h2>
              <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.6, margin: '8px 0 0' }}>{selected.summary}</p>
            </div>
            {canEdit && hospitalId && (
              <div className="rc-reader-noprint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => setEditing(selected)}>Edit pathway</button>
                {!(!selected.custom && hiddenIds.has(selected.id)) && <RemoveItemButton custom={selected.custom} title={selected.title} onHide={() => removePathway(selected)} onDelete={() => removePathway(selected)} />}
              </div>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            {!selected.custom && hiddenIds.has(selected.id) && (
              <div role="status" style={{ ...s.err, background: '#F2F4F7', color: '#344054' }}>
                This pathway has been removed at your hospital.{canEdit && <> <button type="button" style={{ ...s.btn, ...s.soft, marginLeft: 6 }} onClick={() => void content.setHidden('pathway', selected.id, false)}>Restore it</button></>}
              </div>
            )}
            <ApprovalBar guide={approvalTarget} approval={approval} hospitalId={hospitalId} onChanged={loadApprovals} canEdit={canEdit} />
          </div>

          {selected.redFlags?.length > 0 && (
            <section role="note" aria-label="Red flags" style={{ background: C.dangerL, color: C.text, borderRadius: 10, padding: '10px 14px', marginBottom: 6, borderLeft: `4px solid ${C.danger}` }}>
              <h3 style={{ ...s.h2, color: C.danger, margin: '0 0 4px' }}>Red flags: call a senior now</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.55 }}>{selected.redFlags.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </section>
          )}

          <ReaderTools allOpen={allOpen} onExpandAll={() => setAllSteps(true)} onCollapseAll={() => setAllSteps(false)} />
          {(selected.stages || []).map((st, si) => {
            const done = st.points.filter((_, pi) => ticked[tickKey(si, pi)]).length
            return (
              <ReaderSection key={`${selected.id}-${si}`} id={`step-${si + 1}`} open={stepOpen(si)} onToggle={(open) => setOpenSteps((o) => ({ ...o, [`${selected.id}|${si}`]: open }))}
                title={<><span style={{ color: C.primary }}>{si + 1}.</span> {st.heading}</>} badge={done ? `${done}/${st.points.length} done` : `${st.points.length} steps`}>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {st.points.map((p, pi) => (
                    <li key={pi} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '5px 0', fontSize: 14, lineHeight: 1.6 }}>
                      <input type="checkbox" id={`pw-tick-${si}-${pi}`} checked={Boolean(ticked[tickKey(si, pi)])} onChange={(e) => setTicked((t) => ({ ...t, [tickKey(si, pi)]: e.target.checked }))} style={{ marginTop: 5, width: 16, height: 16, flexShrink: 0 }} />
                      <label htmlFor={`pw-tick-${si}-${pi}`} style={{ cursor: 'pointer', color: ticked[tickKey(si, pi)] ? C.sub : C.text }}>{p}</label>
                    </li>
                  ))}
                </ul>
              </ReaderSection>
            )
          })}

          <div className="rc-reader-noprint" style={{ position: 'sticky', bottom: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '10px 0', margin: '8px 0 14px' }}>
            <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!tickedLines.length} onClick={() => void copyTicked()}>Copy ticked steps for the note ({tickedLines.length})</button>
            {tickedLines.length > 0 && <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setTicked({})}>Clear ticks</button>}
            {copied && <span role="status" style={s.sub}>{copied}</span>}
            {encounter?.patientId && <button type="button" onClick={() => navigate?.('consultation', { patientId: encounter.patientId })} style={{ ...s.btn, ...s.ghost }}>Return to consultation</button>}
          </div>

          {(selected.guideIds?.length > 0 || selected.inSystem?.length > 0) && (
            <section className="rc-reader-noprint" style={{ marginBottom: 14 }}>
              <h3 style={s.h2}>Related</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(selected.guideIds || []).map((g) => CLINICAL_GUIDES.find((x) => x.id === g)).filter(Boolean).map((g) => <a key={g.id} href={`#/references?guide=${g.id}`} style={{ ...s.btn, ...s.soft, textDecoration: 'none' }}>Guide: {g.title}</a>)}
                {(selected.inSystem || []).map((l) => <a key={l.path} href={`#${l.path}`} style={{ ...s.btn, ...s.ghost, textDecoration: 'none' }}>{l.label}</a>)}
              </div>
            </section>
          )}

          {selected.sources?.length > 0 && (
            <section>
              <h3 style={s.h2}>Based on</h3>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
                {selected.sources.map((x, i) => <li key={i}>{x.url ? <a href={x.url} target="_blank" rel="noreferrer noopener" style={{ color: C.primary }}>{x.text}</a> : x.text}</li>)}
              </ol>
            </section>
          )}
          <p role="note" style={{ ...s.sub, marginTop: 10, padding: 10, background: C.bgAlt, borderRadius: 8 }}>
            {selected.custom ? 'Written by this hospital' : 'Written for RemedacareHMS from the sources above'} (version {selected.version}). Doses must be checked against the patient's weight, kidney and liver function, allergies, the hospital formulary and current Ministry of Health guidelines. This pathway supports, and does not replace, clinical judgement.
          </p>
          <div className="rc-reader-noprint"><ClinicalDocumentPanel guide={{ id: `pathway-${selected.id}` }} hospitalId={hospitalId} canEdit={canEdit} /></div>
        </ReaderArticle>
      )

  return (
    <section style={s.page}>
      <header className="rc-reader-noprint" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={s.h1}>Care Pathways</h1>
          <p style={{ ...s.sub, margin: '5px 0 0' }}>Step-by-step bedside workflows. Your hospital can edit, remove or replace any of them; approved versions are marked.</p>
        </div>
        {encounter?.patientName && <div style={{ padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, fontSize: 12 }}><strong>Patient:</strong> {encounter.patientName}</div>}
      </header>
      {content.error && <div role="alert" style={s.err}>{content.error}</div>}
      <ReaderLayout list={list} article={article} hasSelection={Boolean(selected || editing)} readerRequested={readerRequested || Boolean(editing)}
        onBack={() => { setReaderRequested(false); setEditing(null) }} backLabel="All pathways" listLabel="Pathway list" />
      <div className="rc-reader-noprint"><OrderSetsAdmin hospitalId={hospitalId} /></div>
    </section>
  )
}
