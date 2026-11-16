// Clinical guides (our own summaries, approved per hospital) and the references behind the clinical rules.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import supabase from '../supabase'
import { useHospital } from '../context'
import { CLINICAL_REFERENCES, REFERENCE_TOPICS } from '../data/clinicalReferences'
import { CLINICAL_GUIDES } from '../data/clinicalGuides'
import { C, Chip, s } from './ncd/ui'
import { ApprovalBar, isHttpUrl } from './clinical/approval'
import { ClinicalDocumentPanel } from './clinical/documents'
import ReaderLayout, { ReaderSection, ReaderTools } from './clinical/ReaderLayout'
import { builtinDefault, ContentManager, customItems, findRevision, isBuiltinHidden, RemoveItemButton, useClinicalContent } from './clinical/content'
import ClinicalLibrary from './clinical/ClinicalLibrary'

function GuideRevisionEditor({ guide, onCancel, onSave }) {
  const [form, setForm] = useState(() => ({
    topic: guide.topic,
    title: guide.title,
    summary: guide.summary,
    sections: guide.sections.map((section) => ({ heading: section.heading, points: [...section.points] })),
    kenya: [...(guide.kenya || [])],
    sources: guide.sources.map((source) => ({ ...source })),
  }))
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async (event) => {
    event.preventDefault()
    if (!form.title.trim() || !form.summary.trim() || (guide.customGuide && !form.topic.trim()) || !form.sections.length || form.sections.some((section) => !section.heading.trim() || !section.points.some((point) => point.trim()))) {
      setErr('Enter a title, summary, at least one section, and at least one point for each section.')
      return
    }
    if (form.sources.some((source) => !source.text.trim())) {
      setErr('Each source needs a description.')
      return
    }
    if (form.sources.some((source) => (source.url || '').trim() && !isHttpUrl(source.url.trim()))) {
      setErr('Source links must use http or https.')
      return
    }
    setErr('')
    setSaving(true)
    const result = await onSave({
      ...guide,
      topic: guide.customGuide ? form.topic.trim() : guide.topic,
      title: form.title.trim(),
      summary: form.summary.trim(),
      sections: form.sections.map((section) => ({ heading: section.heading.trim(), points: section.points.map((point) => point.trim()).filter(Boolean) })),
      kenya: form.kenya.map((point) => point.trim()).filter(Boolean),
      sources: form.sources.map((source) => ({ text: source.text.trim(), url: (source.url || '').trim() || null })),
    })
    setSaving(false)
    if (result?.error) setErr(result.error)
  }
  const updateSection = (index, changes) => setForm((current) => ({ ...current, sections: current.sections.map((section, i) => i === index ? { ...section, ...changes } : section) }))
  const updateSource = (index, changes) => setForm((current) => ({ ...current, sources: current.sources.map((source, i) => i === index ? { ...source, ...changes } : source) }))
  return (
    <form onSubmit={save} style={{ ...s.card, marginBottom: 12 }}>
      <h3 style={s.h2}>{guide.id ? 'Revise guide content' : 'Create a new guide'}</h3>
      <div style={{ ...s.grid(220), marginTop: 10 }}>
        {guide.customGuide && <div><label style={s.label} htmlFor="guide-topic">Topic</label><input id="guide-topic" style={s.input} value={form.topic} onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))} /></div>}
        <div><label style={s.label} htmlFor="guide-title">Title</label><input id="guide-title" style={s.input} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
        <div><label style={s.label} htmlFor="guide-summary">Summary</label><textarea id="guide-summary" style={s.input} rows={3} value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} /></div>
      </div>
      <h4 style={s.h2}>Sections</h4>
      {form.sections.map((section, index) => (
        <div key={index} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 10 }}>
          <div style={{ ...s.grid(220), alignItems: 'end' }}>
            <div><label style={s.label} htmlFor={`guide-heading-${index}`}>Section heading</label><input id={`guide-heading-${index}`} style={s.input} value={section.heading} onChange={(e) => updateSection(index, { heading: e.target.value })} /></div>
            <div><label style={s.label} htmlFor={`guide-points-${index}`}>Points (one per line)</label><textarea id={`guide-points-${index}`} style={s.input} rows={5} value={section.points.join('\n')} onChange={(e) => updateSection(index, { points: e.target.value.split('\n') })} /></div>
          </div>
          <button type="button" style={{ ...s.btn, ...s.ghost, marginTop: 6 }} disabled={form.sections.length < 2} onClick={() => setForm((f) => ({ ...f, sections: f.sections.filter((_, i) => i !== index) }))}>Remove section</button>
        </div>
      ))}
      <button type="button" style={{ ...s.btn, ...s.soft, marginTop: 8 }} onClick={() => setForm((f) => ({ ...f, sections: [...f.sections, { heading: '', points: [''] }] }))}>Add section</button>
      <div style={{ marginTop: 12 }}>
        <label style={s.label} htmlFor="guide-kenya">Local guidance (one point per line)</label>
        <textarea id="guide-kenya" style={s.input} rows={4} value={form.kenya.join('\n')} onChange={(e) => setForm((f) => ({ ...f, kenya: e.target.value.split('\n') }))} />
      </div>
      <h4 style={{ ...s.h2, marginTop: 12 }}>Sources</h4>
      {form.sources.map((source, index) => (
        <div key={index} style={{ ...s.grid(220), alignItems: 'end', marginTop: 8 }}>
          <div><label style={s.label} htmlFor={`guide-source-${index}`}>Source description</label><input id={`guide-source-${index}`} style={s.input} value={source.text} onChange={(e) => updateSource(index, { text: e.target.value })} /></div>
          <div><label style={s.label} htmlFor={`guide-source-url-${index}`}>Source URL (optional)</label><input id={`guide-source-url-${index}`} style={s.input} type="url" value={source.url || ''} onChange={(e) => updateSource(index, { url: e.target.value })} /></div>
          <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setForm((f) => ({ ...f, sources: f.sources.filter((_, i) => i !== index) }))}>Remove source</button>
        </div>
      ))}
      <button type="button" style={{ ...s.btn, ...s.soft, marginTop: 8 }} onClick={() => setForm((f) => ({ ...f, sources: [...f.sources, { text: '', url: '' }] }))}>Add source</button>
      {err && <div role="alert" style={{ ...s.err, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button type="submit" style={{ ...s.btn, ...s.pri }} disabled={saving}>{saving ? 'Saving…' : guide.id ? 'Save revision' : 'Create guide'}</button>
        <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
      <p style={{ ...s.sub, marginTop: 8 }}>Topic and RemedacareHMS navigation links stay fixed. Saving creates a new draft version that must be approved again.</p>
    </form>
  )
}

function effectiveGuide(base, revision) {
  const customGuide = Boolean(base.customGuide || revision?.content?.customGuide)
  const baseVersion = revision?.content?.version || base.version
  const revisionNumber = revision?.revision || 0
  const version = revisionNumber > (customGuide ? 1 : 0)
    ? `${baseVersion}-r${customGuide ? revisionNumber - 1 : revisionNumber}`
    : baseVersion
  return {
    ...base,
    ...(revision?.content || {}),
    id: base.id,
    topic: customGuide ? (revision?.content?.topic || base.topic) : base.topic,
    inSystem: base.inSystem || [],
    customGuide,
    baseVersion,
    version,
  }
}

function revisionPayload(guide) {
  const { baseVersion, version, ...content } = guide
  return { ...content, version: baseVersion || version }
}

function Guides({ initial, hospitalId, content }) {
  const { revisions, canEdit } = content
  const [open, setOpen] = useState(initial || '')
  const [readerRequested, setReaderRequested] = useState(Boolean(initial))
  const [closedSections, setClosedSections] = useState({})
  const [editing, setEditing] = useState(false)
  const [newGuide, setNewGuide] = useState(null)
  const [approvals, setApprovals] = useState([])
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    if (!hospitalId) return
    const { data, error } = await supabase.from('clinical_guide_approvals').select('*').eq('hospital_id', hospitalId).is('withdrawn_at', null)
    if (error) { setErr(error.message); return }
    setErr('')
    setApprovals(data || [])
  }, [hospitalId])
  useEffect(() => { void load() }, [load])
  const customGuides = customItems(revisions, 'guide')
    .map((item) => ({ ...item.content, id: item.content_id, inSystem: [], customGuide: true }))
  const builtinIds = CLINICAL_GUIDES.map((g) => g.id)
  const hiddenIds = new Set(builtinIds.filter((id) => isBuiltinHidden(revisions, 'guide', id)))
  const visible = [...CLINICAL_GUIDES.filter((g) => !hiddenIds.has(g.id)), ...customGuides]
  const all = [...CLINICAL_GUIDES, ...customGuides]
  // A guide opened by link (?guide=…) still shows even if this hospital removed it, with a notice.
  const baseGuide = all.find((g) => g.id === open) || visible[0] || null
  const revision = baseGuide ? findRevision(revisions, 'guide', baseGuide.id) : null
  const guide = baseGuide ? effectiveGuide(baseGuide, revision) : null
  const approvalFor = (g) => approvals.find((a) => a.guide_id === g.id && a.version === g.version)
  const saveRevision = async (updatedGuide) => {
    const guideId = updatedGuide.id || `local-${crypto.randomUUID()}`
    const result = await content.save('guide', guideId, revisionPayload({
      ...updatedGuide,
      id: guideId,
      customGuide: Boolean(updatedGuide.customGuide),
      version: updatedGuide.baseVersion || updatedGuide.version || '1.0',
    }))
    if (!result.error) {
      setOpen(guideId)
      setNewGuide(null)
      setEditing(false)
      await load()
    }
    return result
  }
  const startNew = () => {
    setNewGuide({ id: '', version: '1.0', baseVersion: '1.0', topic: 'Hospital guidance', title: '', summary: '', sections: [], kenya: [], inSystem: [], sources: [], customGuide: true })
    setEditing(true)
  }
  const removeGuide = async (g) => {
    if (g.customGuide) {
      const r = await content.removeMany('guide', [g.id])
      if (!r.error) setOpen('')
      return r
    }
    const r = await content.setHidden('guide', g.id, true)
    if (!r.error) setOpen('')
    return r
  }
  return (
    <ReaderLayout listLabel="Guide list" backLabel="All guides" hasSelection={Boolean(guide) || editing} readerRequested={readerRequested || editing}
      onBack={() => { setReaderRequested(false); setEditing(false); setNewGuide(null) }}
      list={<nav aria-label="Guides">
        {canEdit && hospitalId && <button type="button" style={{ ...s.btn, ...s.pri, width: '100%', marginBottom: 8 }} onClick={startNew}>Add guide</button>}
        {canEdit && hospitalId && (
          <ContentManager noun="guides" builtinIds={builtinIds} customCount={customGuides.length}
            hiddenItems={CLINICAL_GUIDES.filter((g) => hiddenIds.has(g.id)).map((g) => ({ id: g.id, title: effectiveGuide(g, findRevision(revisions, 'guide', g.id)).title }))}
            fresh={builtinDefault(revisions, 'guide') === 'hidden'}
            onStartFresh={({ deleteCustom }) => content.startFresh('guide', builtinIds, { deleteCustom })}
            onRestoreAll={() => content.restoreAll('guide', builtinIds)}
            onRestore={(id) => content.setHidden('guide', id, false)} />
        )}
        {visible.map((g) => {
          const item = effectiveGuide(g, findRevision(revisions, 'guide', g.id))
          return <button key={g.id} type="button" onClick={() => { setOpen(g.id); setNewGuide(null); setEditing(false); setReaderRequested(true) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 6px', border: 'none', borderRadius: 8, cursor: 'pointer', background: guide && g.id === guide.id ? C.primaryL : 'transparent', borderLeft: `3px solid ${guide && g.id === guide.id ? C.primary : 'transparent'}`, color: C.text, marginBottom: 2 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{item.title}</div>
            <div style={{ display: 'flex', gap: 4, marginTop: 3 }}><span style={s.sub}>{item.topic}</span>{item.customGuide && <Chip tone="blue">hospital</Chip>}{approvalFor(item) ? <Chip tone="green">approved</Chip> : <Chip tone="yellow">draft</Chip>}</div>
          </button>
        })}
        {visible.length === 0 && <p style={{ ...s.sub, padding: 6 }}>No guides at this hospital yet.{canEdit ? ' Use Add guide to write the first one.' : ' Your clinical lead can add them.'}</p>}
      </nav>}
      article={<>
      {editing && <GuideRevisionEditor key={newGuide ? 'new' : guide.id + guide.version} guide={newGuide || guide} onCancel={() => { setEditing(false); setNewGuide(null) }} onSave={saveRevision} />}
      {!editing && !guide && <div style={{ ...s.card, ...s.sub }}>Nothing to show. {canEdit ? 'Add a guide, or restore the built-in ones under Manage guides.' : ''}</div>}
      {!editing && guide && <article className="rc-reader-article" style={{ ...s.card, maxWidth: 860, padding: '18px 22px' }} aria-label={guide.title}>
        {canEdit && hospitalId && (
          <div className="rc-reader-noprint" style={{ float: 'right', display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '60%' }}>
            <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => setEditing(true)}>Edit guide</button>
            {!hiddenIds.has(guide.id) && <RemoveItemButton custom={guide.customGuide} title={guide.title} onHide={() => removeGuide(guide)} onDelete={() => removeGuide(guide)} />}
          </div>
        )}
        <h2 style={{ ...s.h1, fontSize: 21, lineHeight: 1.3 }}>{guide.title}</h2>
        <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.6, margin: '8px 0 12px' }}>{guide.summary}</p>
        {hiddenIds.has(guide.id) && (
          <div role="status" style={{ ...s.err, background: '#F2F4F7', color: '#344054', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>This guide has been removed at your hospital. It is shown because a link pointed here.</span>
            {canEdit && <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => void content.setHidden('guide', guide.id, false)}>Restore it</button>}
          </div>
        )}
        <ApprovalBar guide={guide} approval={approvalFor(guide)} hospitalId={hospitalId} onChanged={load} canEdit={canEdit} />
        {revision && !guide.customGuide && baseGuide.version !== guide.baseVersion && (
          <div role="alert" style={{ ...s.err, background: '#EFF8FF', color: '#175CD3', marginBottom: 12 }}>
            RemedacareHMS has a newer version of this guide ({baseGuide.version}). Your hospital's edited copy is based on {guide.baseVersion}.
            Compare them with the clinical lead and edit this guide to bring in the changes.
          </div>
        )}
        {err && <div role="alert" style={{ ...s.err, marginBottom: 8 }}>{err}</div>}
        {(guide.sections || []).length > 1 && (
          <ReaderTools allOpen={guide.sections.every((_, i) => !closedSections[`${guide.id}|${i}`])}
            onExpandAll={() => setClosedSections((c) => ({ ...c, ...Object.fromEntries(guide.sections.map((_, i) => [`${guide.id}|${i}`, false])) }))}
            onCollapseAll={() => setClosedSections((c) => ({ ...c, ...Object.fromEntries(guide.sections.map((_, i) => [`${guide.id}|${i}`, true])) }))} />
        )}
        {(guide.sections || []).map((sec, index) => (
          <ReaderSection key={`${guide.id}-${index}`} title={sec.heading} open={!closedSections[`${guide.id}|${index}`]}
            onToggle={(isOpen) => setClosedSections((c) => ({ ...c, [`${guide.id}|${index}`]: !isOpen }))}>
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6, fontSize: 14 }}>{sec.points.map((p, i) => <li key={i} style={{ marginBottom: 6 }}>{p}</li>)}</ul>
          </ReaderSection>
        ))}
        {guide.kenya?.length > 0 && (
          <section style={{ marginBottom: 14, background: '#F0FDF9', borderRadius: 10, padding: 12 }}>
            <h3 style={s.h2}>In Kenya</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>{guide.kenya.map((p, index) => <li key={index}>{p}</li>)}</ul>
          </section>
        )}
        {guide.inSystem?.length > 0 && (
          <section style={{ marginBottom: 14 }}>
            <h3 style={s.h2}>In RemedacareHMS</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{guide.inSystem.map((l) => <a key={l.label} href={`#${l.path}`} style={{ ...s.btn, ...s.soft, textDecoration: 'none' }}>{l.label}</a>)}</div>
          </section>
        )}
        {(guide.sources || []).length > 0 && (
          <section>
            <h3 style={s.h2}>Based on</h3>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
              {guide.sources.map((src, index) => <li key={index}>{src.url ? <a href={src.url} target="_blank" rel="noreferrer noopener" style={{ color: C.primary }}>{src.text}</a> : src.text}</li>)}
            </ol>
          </section>
        )}
        <p style={{ ...s.sub, marginTop: 8 }}>{guide.customGuide ? `Written by this hospital (version ${guide.version}).` : `Written for RemedacareHMS from the primary sources above (version ${guide.version}).`} Doses and choices must follow the patient's results, the hospital formulary and current national guidelines.</p>
        <div className="rc-reader-noprint"><ClinicalDocumentPanel guide={guide} hospitalId={hospitalId} canEdit={canEdit} /></div>
      </article>}
      </>} />
  )
}

function ReferenceRevisionEditor({ reference, onCancel, onSave }) {
  const [form, setForm] = useState(() => ({ ...reference }))
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async (event) => {
    event.preventDefault()
    if (!form.title.trim() || !form.publisher.trim() || !(form.where || '').trim()) {
      setErr('Title, publisher and “Used in” are required.')
      return
    }
    if ((form.url || '').trim() && !isHttpUrl(form.url.trim())) {
      setErr('Reference links must use http or https.')
      return
    }
    setErr('')
    setSaving(true)
    const result = await onSave({ ...reference, ...form, title: form.title.trim(), publisher: form.publisher.trim(), where: form.where.trim(), note: (form.note || '').trim() || null, url: (form.url || '').trim() || null })
    setSaving(false)
    if (result?.error) setErr(result.error)
  }
  return (
    <form onSubmit={save} style={{ ...s.card, marginBottom: 12 }}>
      <h3 style={s.h2}>{reference.id ? 'Edit reference' : 'Add a reference'}</h3>
      <div style={{ ...s.grid(220), marginTop: 8 }}>
        {reference.custom && <div><label style={s.label} htmlFor="ref-topic-edit">Topic</label>
          <select id="ref-topic-edit" style={s.input} value={form.topic} onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}>{REFERENCE_TOPICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>}
        <div><label style={s.label} htmlFor="ref-title-edit">Title</label><input id="ref-title-edit" style={s.input} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
        <div><label style={s.label} htmlFor="ref-publisher-edit">Publisher</label><input id="ref-publisher-edit" style={s.input} value={form.publisher} onChange={(e) => setForm((f) => ({ ...f, publisher: e.target.value }))} /></div>
        <div><label style={s.label} htmlFor="ref-year-edit">Year</label><input id="ref-year-edit" style={s.input} type="number" value={form.year ?? ''} onChange={(e) => setForm((f) => ({ ...f, year: e.target.value ? Number(e.target.value) : null }))} /></div>
        <div><label style={s.label} htmlFor="ref-url-edit">URL</label><input id="ref-url-edit" style={s.input} type="url" value={form.url || ''} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} /></div>
        <div><label style={s.label} htmlFor="ref-used-edit">Used in</label><input id="ref-used-edit" style={s.input} placeholder="e.g. Hospital antibiotic policy" value={form.where || ''} onChange={(e) => setForm((f) => ({ ...f, where: e.target.value }))} /></div>
        <div><label style={s.label} htmlFor="ref-note-edit">Note</label><textarea id="ref-note-edit" style={s.input} rows={3} value={form.note || ''} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></div>
      </div>
      {err && <div role="alert" style={{ ...s.err, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="submit" style={{ ...s.btn, ...s.pri }} disabled={saving}>{saving ? 'Saving…' : 'Save reference'}</button>
        <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
      <p style={{ ...s.sub, marginTop: 8 }}>{reference.custom ? 'Saved for this hospital only.' : 'The topic grouping stays fixed. Changes are saved for this hospital only.'}</p>
    </form>
  )
}

function referenceId(reference) {
  return `${reference.topic}:${reference.title}`
}

function References({ initialTopic, hospitalId, content }) {
  const { revisions, canEdit } = content
  const [topic, setTopic] = useState(initialTopic || '')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState('')
  const [adding, setAdding] = useState(null)
  const builtinIds = useMemo(() => CLINICAL_REFERENCES.map(referenceId), [])
  const hiddenIds = useMemo(() => new Set(builtinIds.filter((id) => isBuiltinHidden(revisions, 'reference', id))), [builtinIds, revisions])
  const custom = useMemo(() => customItems(revisions, 'reference').map((r) => ({ ...r.content, id: r.content_id, custom: true })), [revisions])
  const all = useMemo(() => [
    ...CLINICAL_REFERENCES.map((base) => {
      const id = referenceId(base)
      return { ...base, ...(findRevision(revisions, 'reference', id)?.content || {}), topic: base.topic, id }
    }).filter((r) => !hiddenIds.has(r.id)),
    ...custom,
  ], [revisions, hiddenIds, custom])
  const rows = all.filter((r) => (!topic || r.topic === topic)
    && (!q || `${r.title} ${r.publisher} ${r.where} ${r.note || ''}`.toLowerCase().includes(q.toLowerCase())))
  const saveRevision = async (reference) => {
    const { id, ...rest } = reference
    const result = await content.save('reference', id || `local-${crypto.randomUUID()}`, rest)
    if (!result.error) { setEditing(''); setAdding(null) }
    return result
  }
  const remove = (r) => (r.custom ? content.removeMany('reference', [r.id]) : content.setHidden('reference', r.id, true))
  const groups = REFERENCE_TOPICS.filter(([k]) => rows.some((r) => r.topic === k))
  return (
    <>
      <div style={{ ...s.card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 12 }}>
        <div><label style={s.label} htmlFor="ref-topic">Topic</label>
          <select id="ref-topic" style={s.input} value={topic} onChange={(e) => setTopic(e.target.value)}><option value="">All topics</option>{REFERENCE_TOPICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div style={{ flex: '1 1 260px' }}><label style={s.label} htmlFor="ref-q">Search</label>
          <input id="ref-q" style={s.input} placeholder="e.g. EUCAST, vancomycin, NEWS2" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div style={s.sub}>{rows.length} of {all.length}</div>
        {canEdit && hospitalId && <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => setAdding({ id: '', custom: true, topic: topic || REFERENCE_TOPICS[0][0], title: '', publisher: '', year: null, url: '', where: '', note: '' })}>Add reference</button>}
      </div>
      {canEdit && hospitalId && (
        <div style={{ maxWidth: 420 }}>
          <ContentManager noun="references" builtinIds={builtinIds} customCount={custom.length}
            hiddenItems={CLINICAL_REFERENCES.filter((r) => hiddenIds.has(referenceId(r))).map((r) => ({ id: referenceId(r), title: r.title }))}
            fresh={builtinDefault(revisions, 'reference') === 'hidden'}
            onStartFresh={({ deleteCustom }) => content.startFresh('reference', builtinIds, { deleteCustom })}
            onRestoreAll={() => content.restoreAll('reference', builtinIds)}
            onRestore={(id) => content.setHidden('reference', id, false)} />
        </div>
      )}
      {adding && <ReferenceRevisionEditor reference={adding} onCancel={() => setAdding(null)} onSave={saveRevision} />}
      {groups.map(([k, label]) => (
        <div key={k} style={{ ...s.card, marginBottom: 12 }}>
          <h2 style={s.h2}>{label}</h2>
          {rows.filter((r) => r.topic === k).map((r) => (
            <article key={r.id} style={{ padding: '10px 0', borderTop: `1px solid ${C.border}` }}>
              {editing === r.id ? <ReferenceRevisionEditor key={r.id} reference={r} onCancel={() => setEditing('')} onSave={saveRevision} /> : <>
              {canEdit && hospitalId && (
                <span style={{ float: 'right', display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setEditing(r.id)}>Edit</button>
                  <RemoveItemButton custom={r.custom} title={r.title} onHide={() => remove(r)} onDelete={() => remove(r)} />
                </span>
              )}
              <div style={{ fontWeight: 800, color: C.textStrong }}>
                {r.url ? <a href={r.url} target="_blank" rel="noreferrer noopener" style={{ color: C.primary }}>{r.title}</a> : r.title}
                {r.custom && <span style={{ marginLeft: 6 }}><Chip tone="blue">hospital</Chip></span>}
              </div>
              <div style={s.sub}>{r.publisher}{r.year ? ` · ${r.year}` : ''}</div>
              <div style={{ fontSize: 12, marginTop: 4 }}><strong>Used in:</strong> {r.where}</div>
              {r.note && <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{r.note}</div>}
              </>}
            </article>
          ))}
        </div>
      ))}
      {rows.length === 0 && <div style={{ ...s.card, ...s.sub }}>{all.length ? 'Nothing matches.' : 'No references at this hospital yet.'}</div>}
    </>
  )
}

export default function ClinicalReferences() {
  const [params] = useSearchParams()
  const { hospitalId } = useHospital()
  const [tab, setTab] = useState(params.get('library') ? 'library' : params.get('topic') ? 'references' : 'guides')
  const content = useClinicalContent(hospitalId)
  return (
    <section style={s.page}>
      <header style={{ marginBottom: 14 }}>
        <h1 style={s.h1}>Clinical guides &amp; references</h1>
        <p style={{ ...s.sub, margin: '5px 0 0' }}>Guides written for RemedacareHMS from primary guidelines, approved by each hospital, the publications the clinical rules are built on, and your hospital's own library of documents. Local policy and your laboratory's own ranges take precedence.</p>
      </header>
      <nav role="tablist" style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 14 }}>
        {[['guides', 'Clinical guides'], ['references', 'References'], ['library', 'Library']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} style={{ padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700, color: tab === k ? C.primary : C.sub, borderBottom: `2px solid ${tab === k ? C.primary : 'transparent'}` }}>{l}</button>
        ))}
      </nav>
      {content.error && <div role="alert" style={{ ...s.err, marginBottom: 10 }}>{content.error}</div>}
      {tab === 'guides' && <Guides initial={params.get('guide')} hospitalId={hospitalId} content={content} />}
      {tab === 'references' && <References initialTopic={params.get('topic')} hospitalId={hospitalId} content={content} />}
      {tab === 'library' && <ClinicalLibrary hospitalId={hospitalId} canEdit={content.canEdit} />}
    </section>
  )
}
