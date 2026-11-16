// Order set management: adopt from the starter library, edit to local protocol, approve (doctor / administrator) and switch
// on. Any edit withdraws the approval (the database enforces it). Data: order_sets (20261214000000_problem_list_order_sets.sql).
import { useCallback, useEffect, useState } from 'react'
import supabase from '../supabase'
import { LAB_TEST_CATEGORIES, getLabTestsForCategory } from '../utils/labCatalog'
import { ORDER_SET_LIBRARY } from '../utils/orderSetLibrary'
import { C, Chip, s } from './ncd/ui'

const friendly = (e) => {
  const m = e?.message || String(e || '')
  if (/does not exist|schema cache|Could not find/i.test(m)) return 'Order sets are not installed yet. Run docs/sql/32_problem_list_order_sets.sql in Supabase.'
  if (/duplicate key|unique/i.test(m)) return 'An order set with that name already exists.'
  return m
}
const blankMed = { drug_name: '', dosage: '', frequency: '', duration: '', route: '', notes: '' }

export default function OrderSetsAdmin({ hospitalId }) {
  const [sets, setSets] = useState([])
  const [edit, setEdit] = useState(null)
  const [me, setMe] = useState(null)
  const [canApprove, setCanApprove] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(async () => {
    if (!hospitalId) return
    const { data, error } = await supabase.from('order_sets').select('*').eq('hospital_id', hospitalId).order('name')
    if (error) setErr(friendly(error)); else { setErr(''); setSets(data || []) }
  }, [hospitalId])
  useEffect(() => {
    if (!hospitalId) return
    void load()
    void supabase.auth?.getUser?.().then(({ data }) => setMe(data?.user?.id || null))
    void supabase.rpc?.('order_set_can_approve', { p_hospital: hospitalId })?.then(({ data }) => setCanApprove(Boolean(data)))
  }, [load, hospitalId])
  const act = async (p, ok) => { setErr(''); setMsg(''); const { error } = await p; if (error) setErr(friendly(error)); else { if (ok) setMsg(ok); void load() } }
  const adopted = (id) => sets.some((x) => x.source === `library:${id}`)
  async function adopt(lib) {
    await act(supabase.from('order_sets').insert({ hospital_id: hospitalId, name: lib.name, condition: lib.condition, icd10: lib.icd10, labs: lib.labs, medications: lib.medications, instructions: lib.instructions, source: `library:${lib.id}` }),
      `${lib.name} added to your list. Review it, then a doctor approves it.`)
  }
  async function saveEdit() {
    const row = { name: edit.name, condition: edit.condition || null, icd10: String(edit.icd10_text || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
      labs: edit.labs.filter((l) => l.test_type), medications: edit.medications.filter((m) => m.drug_name.trim()), instructions: edit.instructions || null }
    if (edit.id) await act(supabase.from('order_sets').update(row).eq('id', edit.id), 'Saved. Changes need approval again before the set can be used.')
    else await act(supabase.from('order_sets').insert({ ...row, hospital_id: hospitalId, source: 'custom' }), 'Order set created. A doctor must approve it.')
    setEdit(null)
  }
  return (
    <div style={{ marginTop: 16 }}>
      <h2 style={s.h2}>Order sets</h2>
      <div style={{ ...s.sub, marginBottom: 8 }}>One-click bundles of tests, medicines and instructions for a condition. A set is only offered in consultations after a doctor approves it; editing it withdraws the approval.</div>
      {err && <div role="alert" style={s.err}>{err}</div>}
      {msg && <div style={s.ok}>{msg}</div>}
      {edit && <Editor edit={edit} setEdit={setEdit} onSave={saveEdit} />}
      <div style={s.grid(320)}>
        {sets.map((o) => (
          <div key={o.id} style={{ ...s.card, borderColor: o.active ? C.success : C.border }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><b>{o.name}</b><Chip tone={o.active ? 'green' : o.approved_by ? 'blue' : 'yellow'}>{o.active ? 'In use' : o.approved_by ? 'Approved, off' : 'Needs approval'}</Chip></div>
            <div style={s.sub}>v{o.version}{o.icd10?.length ? ` · ${o.icd10.join(', ')}` : ''}{o.approved_by_name ? ` · approved by ${o.approved_by_name}` : ''}</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>{o.labs.length} test(s) · {o.medications.length} medicine(s)</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setEdit({ ...o, icd10_text: (o.icd10 || []).join(', '), labs: [...o.labs], medications: [...o.medications] })}>Edit</button>
              {!o.approved_by && canApprove && <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => act(supabase.from('order_sets').update({ approved_by: me, approved_by_name: window.prompt('Your name for the approval record') || 'Doctor', active: true }).eq('id', o.id), `${o.name} approved and in use.`)}>Approve and use</button>}
              {o.approved_by && <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => act(supabase.from('order_sets').update({ active: !o.active }).eq('id', o.id))}>{o.active ? 'Switch off' : 'Switch on'}</button>}
            </div>
            {!o.approved_by && !canApprove && <div style={{ ...s.sub, marginTop: 4 }}>A doctor or administrator must approve it.</div>}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0 6px' }}>
        <b>Starter library</b>
        <button type="button" style={{ ...s.btn, ...s.soft }} onClick={() => setEdit({ name: '', condition: '', icd10_text: '', labs: [], medications: [{ ...blankMed }], instructions: '' })}>+ Write your own</button>
      </div>
      <div style={s.grid(300)}>
        {ORDER_SET_LIBRARY.map((l) => (
          <div key={l.id} style={s.card}>
            <b>{l.name}</b>
            <div style={{ fontSize: 12, marginTop: 4 }}>{l.medications.map((m) => m.drug_name).join(', ') || 'No medicines'}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              {adopted(l.id) ? <Chip tone="green">In your list</Chip> : <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => adopt(l)}>Add to our list</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Editor({ edit, setEdit, onSave }) {
  const setMed = (i, k, v) => setEdit({ ...edit, medications: edit.medications.map((m, j) => (j === i ? { ...m, [k]: v } : m)) })
  const setLab = (i, k, v) => setEdit({ ...edit, labs: edit.labs.map((l, j) => (j === i ? { ...l, [k]: v, ...(k === 'category' ? { test_type: '' } : {}) } : l)) })
  return (
    <div style={{ ...s.card, borderColor: C.primary, marginBottom: 12 }}>
      <div style={s.grid(220)}>
        <div><label style={s.label} htmlFor="os-name">Name</label><input id="os-name" style={s.input} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
        <div><label style={s.label} htmlFor="os-cond">Condition</label><input id="os-cond" style={s.input} value={edit.condition || ''} onChange={(e) => setEdit({ ...edit, condition: e.target.value })} /></div>
        <div><label style={s.label} htmlFor="os-icd">ICD-10 codes (comma separated)</label><input id="os-icd" style={s.input} value={edit.icd10_text} onChange={(e) => setEdit({ ...edit, icd10_text: e.target.value })} /></div>
      </div>
      <div style={{ ...s.label, marginTop: 10 }}>Tests</div>
      {edit.labs.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
          <select aria-label={`Test ${i + 1} category`} style={{ ...s.input, width: 160 }} value={l.category || ''} onChange={(e) => setLab(i, 'category', e.target.value)}><option value="">Category…</option>{LAB_TEST_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <select aria-label={`Test ${i + 1}`} style={{ ...s.input, width: 260 }} value={l.test_type || ''} onChange={(e) => setLab(i, 'test_type', e.target.value)}><option value="">Test…</option>{getLabTestsForCategory(l.category).map((t) => <option key={t}>{t}</option>)}</select>
          <select aria-label={`Test ${i + 1} priority`} style={{ ...s.input, width: 120 }} value={l.priority || 'Routine'} onChange={(e) => setLab(i, 'priority', e.target.value)}>{['Routine', 'Urgent', 'STAT'].map((p) => <option key={p}>{p}</option>)}</select>
          <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setEdit({ ...edit, labs: edit.labs.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setEdit({ ...edit, labs: [...edit.labs, { category: '', test_type: '', priority: 'Routine' }] })}>+ Test</button>
      <div style={{ ...s.label, marginTop: 10 }}>Medicines</div>
      {edit.medications.map((m, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.5fr 1fr 0.8fr 1.5fr auto', gap: 4, marginBottom: 4 }}>
          {[['drug_name', 'Medicine'], ['dosage', 'Dose'], ['frequency', 'How often'], ['duration', 'Duration'], ['route', 'Route'], ['notes', 'Notes']].map(([k, l]) => <input key={k} aria-label={`${l} ${i + 1}`} placeholder={l} style={s.input} value={m[k] || ''} onChange={(e) => setMed(i, k, e.target.value)} />)}
          <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setEdit({ ...edit, medications: edit.medications.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setEdit({ ...edit, medications: [...edit.medications, { ...blankMed }] })}>+ Medicine</button>
      <label style={{ ...s.label, marginTop: 10 }} htmlFor="os-instr">Instructions</label>
      <textarea id="os-instr" rows={3} style={s.input} value={edit.instructions || ''} onChange={(e) => setEdit({ ...edit, instructions: e.target.value })} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
        <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => setEdit(null)}>Cancel</button>
        <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!edit.name?.trim()} onClick={onSave}>Save</button>
      </div>
    </div>
  )
}
