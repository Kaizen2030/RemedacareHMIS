// Admin: AI providers for the AI Clinical Assist, Antibiogram and Insurance screens. The providers are tried in
// order; if one is busy (rate limit), out of credit, slow to start or down, the next one answers.
// Keys are saved with hospital_secret_set (encrypted, server-only; never shown again). The order and models are
// saved the same way as "ai_providers" and read back through the gemini-proxy function (administrators only).
import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'

export const AI_PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini', where: 'aistudio.google.com > Get API key', photos: true,
    models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'] },
  { id: 'claude', label: 'Anthropic Claude', where: 'platform.claude.com > API keys', photos: true,
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2', 'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5'] },
  { id: 'openai', label: 'OpenAI ChatGPT', where: 'platform.openai.com > API keys', photos: true,
    models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini'] },
  { id: 'grok', label: 'xAI Grok', where: 'console.x.ai > API keys', photos: false, models: ['grok-3-mini', 'grok-3', 'grok-4'] },
  { id: 'deepseek', label: 'DeepSeek', where: 'platform.deepseek.com > API keys', photos: false, models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'groq', label: 'Groq (fast, free tier)', where: 'console.groq.com > API keys', photos: false, models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
  { id: 'mistral', label: 'Mistral', where: 'console.mistral.ai > API keys', photos: false, models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'] },
  { id: 'openrouter', label: 'OpenRouter (many models, one key)', where: 'openrouter.ai > Keys', photos: true, models: ['openrouter/auto'] },
]
const OTHER = '__other__'

async function callProxy(body) {
  const { data, error } = await supabase.functions.invoke('gemini-proxy', { body })
  let message = data?.error
  if (error && !message) {
    try { message = JSON.parse(await error.context?.text?.())?.error } catch { /* keep */ }
    message = message || error.message
  }
  if (message) throw new Error(message)
  return data
}

function ModelPicker({ row, defaultModel, onChange, onLoad, loading }) {
  const options = row.liveModels?.length ? row.liveModels : row.models.map((id) => ({ id }))
  const known = !row.model || options.some((option) => option.id === row.model)
  const [typing, setTyping] = useState(!known)
  const name = row.label.split(' (')[0]
  return <label style={st.label}>Model
    <select style={st.input} value={typing ? OTHER : (row.model || '')} onChange={(e) => {
      if (e.target.value === OTHER) { setTyping(true); return }
      setTyping(false); onChange(e.target.value)
    }}>
      <option value="">Default ({defaultModel || row.models[0]})</option>
      {options.map((option) => <option key={option.id} value={option.id}>{option.name && option.name !== option.id ? `${option.name} (${option.id})` : option.id}</option>)}
      <option value={OTHER}>Other… (type a name)</option>
    </select>
    {typing && <input style={st.input} value={row.model || ''} placeholder="Exact model name" onChange={(e) => onChange(e.target.value)} />}
    <button type="button" style={st.link} onClick={onLoad} disabled={loading}>
      {loading ? 'Loading models…' : row.liveModels?.length ? `↻ ${row.liveModels.length} models from ${name}` : `Load all models from ${name}`}
    </button>
  </label>
}

export default function SettingsAi({ hospitalId }) {
  const [rows, setRows] = useState([])
  const [defaults, setDefaults] = useState({})
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await callProxy({ action: 'ai_settings', hospital_id: hospitalId })
      const saved = Array.isArray(data?.providers) ? data.providers : []
      const order = (id) => { const i = saved.findIndex((row) => row.provider === id); return i < 0 ? 100 + AI_PROVIDERS.findIndex((p) => p.id === id) : i }
      setRows(AI_PROVIDERS.map((provider) => {
        const row = saved.find((item) => item.provider === provider.id) || {}
        return { ...provider, enabled: Boolean(row.enabled), model: row.model || '', hasKey: Boolean(data?.keys_saved?.[provider.id]), key: '' }
      }).sort((a, b) => order(a.id) - order(b.id)))
      setDefaults(data?.defaults || {})
      setErr('')
    } catch (error) {
      setErr(/not deployed|Failed to send|404/i.test(error.message) ? 'The AI service is not deployed yet.' : error.message)
    }
  }, [hospitalId])
  useEffect(() => { if (hospitalId) void load() }, [hospitalId, load])

  const run = async (label, fn) => {
    setBusy(label); setErr(''); setMsg('')
    try { await fn() } catch (error) { setErr(error.message) } finally { setBusy('') }
  }
  const update = (id, patch) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  const move = (index, step) => setRows((current) => {
    const target = index + step
    if (target < 0 || target >= current.length) return current
    const next = [...current]; [next[index], next[target]] = [next[target], next[index]]
    return next
  })

  // Saves every typed key and the order / models / on-off of all providers.
  const persist = async (list) => {
    for (const row of list) {
      if (row.key.trim()) {
        const { error } = await supabase.rpc('hospital_secret_set', { p_hospital: hospitalId, p_name: `ai_${row.id}_key`, p_value: row.key.trim() })
        if (error) throw new Error(error.message)
      }
      if (row.enabled && !row.hasKey && !row.key.trim()) throw new Error(`Paste the ${row.label} key before switching it on.`)
    }
    const config = list.filter((row) => row.enabled || row.hasKey || row.key.trim()).map((row) => ({ provider: row.id, enabled: row.enabled, model: row.model.trim() || null }))
    const { error } = await supabase.rpc('hospital_secret_set', { p_hospital: hospitalId, p_name: 'ai_providers', p_value: JSON.stringify(config) })
    if (error) throw new Error(error.message)
    setRows((current) => current.map((row) => ({ ...row, hasKey: row.hasKey || Boolean(row.key.trim()), key: '' })))
  }

  const save = () => run('save', async () => { await persist(rows); setMsg('AI providers saved. The assistant tries them in this order.') })

  const test = (row) => run(`test-${row.id}`, async () => {
    const list = rows.map((item) => (item.id === row.id ? { ...item, enabled: true } : item))
    await persist(list)
    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, enabled: true, hasKey: true, key: '' } : item)))
    const data = await callProxy({ action: 'test', hospital_id: hospitalId, provider: row.id, model: row.model.trim() || undefined })
    setMsg(data?.message || `${row.label} works.`)
  })

  const loadModels = (row) => run(`models-${row.id}`, async () => {
    const data = await callProxy({ action: 'models', hospital_id: hospitalId, provider: row.id, api_key: row.key.trim() || undefined })
    if (!Array.isArray(data?.models) || !data.models.length) throw new Error(`${row.label} returned no chat models for this key.`)
    update(row.id, { liveModels: data.models })
    setMsg(`${data.models.length} ${row.label} models loaded. Pick one from the list.`)
  })

  return (
    <div style={st.card}>
      <div style={st.title}>AI providers</div>
      <p style={st.note}>
        The AI Clinical Assist, Antibiogram and Insurance screens try these in order. If the first is busy (like the Gemini rate limit),
        out of credit or down, the next one answers, and answers appear word by word as they are written. Patient identifiers are removed
        before anything is sent to any AI. Providers marked "text only" are skipped when a photo is attached. With none switched on,
        the hospital uses the built-in Gemini key.
      </p>
      {err && <p style={st.error}>{err}</p>}
      {msg && <p style={st.ok}>{msg}</p>}
      {rows.map((row, index) => (
        <div key={row.id} style={st.row}>
          <div style={st.order}>
            <button type="button" style={st.arrow} onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${row.label} up`}>▲</button>
            <span>{index + 1}</span>
            <button type="button" style={st.arrow} onClick={() => move(index, 1)} disabled={index === rows.length - 1} aria-label={`Move ${row.label} down`}>▼</button>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={{ ...st.label, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#0f172a', fontWeight: 700 }}>
              <input type="checkbox" checked={row.enabled} onChange={(e) => update(row.id, { enabled: e.target.checked })} />
              {row.label}{!row.photos && <span style={st.tag}>text only</span>}
            </label>
            <div style={st.grid}>
              <label style={st.label}>API key{row.hasKey ? ' (saved; leave blank to keep)' : ''}
                <input style={st.input} type="password" autoComplete="new-password" value={row.key} placeholder={`From ${row.where}`} onChange={(e) => update(row.id, { key: e.target.value })} />
              </label>
              <ModelPicker row={row} defaultModel={defaults[row.id]} loading={busy === `models-${row.id}`} onChange={(value) => update(row.id, { model: value })} onLoad={() => loadModels(row)} />
            </div>
          </div>
          {(row.hasKey || row.key.trim()) && <button type="button" style={st.secondary} disabled={Boolean(busy)} onClick={() => test(row)}>{busy === `test-${row.id}` ? 'Testing…' : 'Test'}</button>}
        </div>
      ))}
      <button type="button" style={{ ...st.primary, marginTop: 10 }} disabled={Boolean(busy) || !rows.length} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save AI providers'}</button>
      <p style={st.hint}>Test saves that provider and switches it on, then asks it a one-word question. Keys are stored encrypted and are never shown again.</p>
    </div>
  )
}

const st = {
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 16 },
  title: { fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 6 },
  note: { fontSize: 12, color: '#64748b', margin: '0 0 12px', lineHeight: 1.5 },
  error: { fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 10 },
  ok: { fontSize: 12, color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10 },
  row: { display: 'flex', gap: 12, alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, marginBottom: 8 },
  order: { display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 12, color: '#64748b', fontWeight: 700 },
  arrow: { border: 'none', background: 'transparent', cursor: 'pointer', color: '#0f766e', fontSize: 11, padding: 2 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 6 },
  label: { display: 'block', fontSize: 11, color: '#64748b' },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 7, fontSize: 13, boxSizing: 'border-box', marginTop: 4 },
  tag: { fontSize: 10, fontWeight: 700, color: '#64748b', background: '#f1f5f9', borderRadius: 20, padding: '2px 8px' },
  primary: { background: '#0f766e', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  secondary: { background: '#fff', color: '#0f766e', border: '1px solid #0f766e', borderRadius: 7, padding: '7px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  link: { display: 'block', marginTop: 4, padding: 0, border: 'none', background: 'transparent', color: '#0f766e', fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' },
  hint: { fontSize: 11, color: '#94a3b8', marginTop: 8 },
}
