import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '../../supabase'
import { C, s } from '../ncd/ui'
import LabBridgeDownload from './LabBridgeDownload'

const protocols = [
  ['astm', 'ASTM E1381/E1394'],
  ['hl7', 'HL7 v2 / MLLP'],
  ['csv', 'CSV import'],
]
const departments = ['haematology', 'chemistry', 'immunoassay', 'microbiology', 'other']
const ingestUrl = `${String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')}/functions/v1/lab-ingest`

function friendly(error) {
  const message = error?.message || String(error || '')
  if (/does not exist|schema cache|Could not find/i.test(message)) {
    return 'Analyser support is not installed yet. Run docs/sql/44_lab_instruments.sql in Supabase and deploy the lab-ingest function.'
  }
  return message
}

function formatTime(value) {
  if (!value) return 'Time not provided'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Invalid time' : date.toLocaleString('en-KE')
}

function ResultValues({ values }) {
  return Object.entries(values || {}).map(([template, analytes]) => (
    <div key={template} style={{ marginTop: 6 }}>
      <b>{template.toUpperCase()}</b>
      <ul style={{ margin: '4px 0 0 18px' }}>
        {Object.entries(analytes || {}).map(([analyte, value]) => <li key={analyte}>{analyte}: {String(value)}</li>)}
      </ul>
    </div>
  ))
}

export default function LabAnalyserInbox({ hospitalId }) {
  const [instruments, setInstruments] = useState([])
  const [results, setResults] = useState([])
  const [orders, setOrders] = useState([])
  const [canManage, setCanManage] = useState(false)
  const [form, setForm] = useState({ name: '', model: '', protocol: 'astm', department: 'haematology' })
  const [oneTimeKey, setOneTimeKey] = useState(null)
  const [matchByResult, setMatchByResult] = useState({})
  const [rejectByResult, setRejectByResult] = useState({})
  const [reviewedUnmapped, setReviewedUnmapped] = useState({})
  const [statusFilter, setStatusFilter] = useState('pending')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const instrumentById = useMemo(() => new Map(instruments.map((item) => [item.id, item])), [instruments])
  const visibleResults = useMemo(() => statusFilter === 'all' ? results : results.filter((item) => item.status === statusFilter), [results, statusFilter])

  const load = useCallback(async () => {
    if (!hospitalId) return
    setLoading(true)
    setError('')
    try {
      const [instrumentResponse, resultResponse, orderResponse, permissionResponse] = await Promise.all([
        supabase.from('lab_instruments').select('id, name, model, protocol, department, auto_accept, active, last_seen_at, created_at').eq('hospital_id', hospitalId).order('created_at', { ascending: false }),
        supabase.from('lab_instrument_results').select('*').eq('hospital_id', hospitalId).order('received_at', { ascending: false }).limit(200),
        supabase.from('lab_tests').select('id, sample_barcode, patient_name, test_type, status, created_at').eq('hospital_id', hospitalId).order('created_at', { ascending: false }).limit(500),
        supabase.rpc('lab_instrument_can_manage', { p_hospital: hospitalId }),
      ])
      const failure = instrumentResponse.error || resultResponse.error || orderResponse.error || permissionResponse.error
      if (failure) { setError(friendly(failure)); return }
      setInstruments(instrumentResponse.data || [])
      setResults(resultResponse.data || [])
      setOrders(orderResponse.data || [])
      setCanManage(Boolean(permissionResponse.data))
    } catch (loadError) {
      setError(friendly(loadError))
    } finally {
      setLoading(false)
    }
  }, [hospitalId])

  useEffect(() => { void load() }, [load])

  async function createInstrument(event) {
    event.preventDefault()
    if (!form.name.trim()) { setError('Enter an analyser name.'); return }
    setSaving(true)
    setError('')
    setMessage('')
    setOneTimeKey(null)
    try {
      const { data, error: createError } = await supabase.rpc('lab_instrument_create', {
        p_hospital: hospitalId,
        p_name: form.name.trim(),
        p_model: form.model.trim(),
        p_protocol: form.protocol,
        p_department: form.department,
      })
      if (createError) { setError(friendly(createError)); return }
      const created = Array.isArray(data) ? data[0] : data
      if (!created?.id || !created?.key) { setError('The server did not return the one-time analyser key. No key was shown; check the database response before retrying.'); return }
      setOneTimeKey(created)
      setMessage('Analyser registered. Copy the key now; it cannot be retrieved again.')
      setForm((current) => ({ ...current, name: '', model: '' }))
      await load()
    } catch (createError) {
      setError(friendly(createError))
    } finally {
      setSaving(false)
    }
  }

  async function revokeInstrument(instrument) {
    if (!window.confirm(`Revoke the key for ${instrument.name}? Its bridge will stop sending results.`)) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const { error: revokeError } = await supabase.from('lab_instruments').update({ active: false, revoked_at: new Date().toISOString() }).eq('id', instrument.id).eq('hospital_id', hospitalId)
      if (revokeError) { setError(friendly(revokeError)); return }
      setMessage(`${instrument.name} was revoked.`)
      await load()
    } catch (revokeError) {
      setError(friendly(revokeError))
    } finally {
      setSaving(false)
    }
  }

  async function runAction(name, args, success) {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const { error: actionError } = await supabase.rpc(name, args)
      if (actionError) { setError(friendly(actionError)); return false }
      setMessage(success)
      await load()
      return true
    } catch (actionError) {
      setError(friendly(actionError))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function acceptResult(result) {
    if (result.unmapped?.length && !reviewedUnmapped[result.id]) {
      setError('Review the unmapped analyser codes and confirm before accepting this partial result.')
      return
    }
    await runAction('lab_instrument_accept', { p_result: result.id }, 'Analyser result accepted and added to the laboratory order.')
  }

  async function matchResult(result) {
    const labTestId = matchByResult[result.id] || result.lab_test_id
    if (!labTestId) { setError('Choose a laboratory order to match this sample.'); return }
    await runAction('lab_instrument_match', { p_result: result.id, p_lab_test: String(labTestId) }, 'Sample matched to the selected laboratory order.')
  }

  async function rejectResult(result) {
    const reason = String(rejectByResult[result.id] || '').trim()
    if (!reason) { setError('Enter a reason before rejecting a result.'); return }
    const rejected = await runAction('lab_instrument_reject', { p_result: result.id, p_reason: reason }, 'Analyser result rejected.')
    if (rejected) setRejectByResult((current) => ({ ...current, [result.id]: '' }))
  }

  if (!hospitalId) return <div role="alert" style={s.err}>Select a hospital before opening the analyser inbox.</div>

  return (
    <section style={{ ...s.card, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2 style={{ ...s.h2, margin: 0 }}>Analyzer inbox</h2>
          <p style={{ ...s.sub, marginTop: 4 }}>ASTM, HL7/MLLP and CSV results wait for laboratory review. Auto-accept remains off for new instruments.</p>
        </div>
        <button type="button" style={{ ...s.btn, ...s.ghost }} onClick={() => void load()} disabled={loading}>Refresh inbox</button>
      </div>

      {error && <div role="alert" style={{ ...s.err, marginTop: 10 }}>{error}</div>}
      {message && <div role="status" style={{ ...s.ok, marginTop: 10 }}>{message}</div>}

      {oneTimeKey && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginTop: 12 }}>
          <b>One-time bridge key</b>
          <p style={s.sub}>Copy this to the lab bridge environment now. It is not stored in readable form and cannot be shown again.</p>
          <label style={s.label} htmlFor="lab-bridge-endpoint">Ingest endpoint</label>
          <input id="lab-bridge-endpoint" readOnly style={s.input} value={ingestUrl} />
          <label style={{ ...s.label, marginTop: 8 }} htmlFor="lab-bridge-key">Analyser key</label>
          <input id="lab-bridge-key" readOnly style={s.input} value={oneTimeKey.key} />
          <LabBridgeDownload name={instrumentById.get(oneTimeKey.id)?.name || 'Analyser'} protocol={instrumentById.get(oneTimeKey.id)?.protocol || 'astm'} apiKey={oneTimeKey.key} endpoint={ingestUrl} />
        </div>
      )}

      {canManage && (
        <details style={{ marginTop: 12 }} open={instruments.length === 0}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Connect an analyser</summary>
          <p style={{ ...s.sub, margin: '6px 0' }}>Create one key per device. Keep it in the bridge machine’s environment, never in source control. The bridge supports ASTM/HL7 over TCP or serial; CSV uses file import.</p>
          <form onSubmit={createInstrument} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, alignItems: 'end' }}>
            <div><label style={s.label} htmlFor="lab-instrument-name">Analyser name</label><input id="lab-instrument-name" style={s.input} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></div>
            <div><label style={s.label} htmlFor="lab-instrument-model">Make / model</label><input id="lab-instrument-model" style={s.input} value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} /></div>
            <div><label style={s.label} htmlFor="lab-instrument-protocol">Protocol</label><select id="lab-instrument-protocol" style={s.input} value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value })}>{protocols.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div><label style={s.label} htmlFor="lab-instrument-department">Department</label><select id="lab-instrument-department" style={s.input} value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })}>{departments.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
            <button type="submit" style={{ ...s.btn, ...s.pri }} disabled={saving}>{saving ? 'Connecting…' : 'Create bridge key'}</button>
          </form>
        </details>
      )}

      <div style={{ marginTop: 14 }}>
        <h3 style={s.h2}>Connected instruments</h3>
        {instruments.length ? instruments.map((instrument) => (
          <div key={instrument.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${C.border}`, padding: '8px 0' }}>
            <span><b>{instrument.name}</b> {instrument.model && `· ${instrument.model}`} · {instrument.protocol.toUpperCase()} · {instrument.department}
              {instrument.auto_accept && <b style={{ color: C.danger }}> · Auto-accept is enabled</b>}
              <span style={s.sub}> · {instrument.active && !instrument.revoked_at ? 'Active' : 'Revoked'} · Last seen {formatTime(instrument.last_seen_at)}</span>
            </span>
            {canManage && instrument.active && !instrument.revoked_at && <button type="button" style={{ ...s.btn, ...s.ghost }} disabled={saving} onClick={() => void revokeInstrument(instrument)}>Revoke key</button>}
          </div>
        )) : <p style={s.sub}>No analysers registered for this hospital.</p>}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
        <h3 style={{ ...s.h2, margin: 0, marginRight: 'auto' }}>Incoming results</h3>
        <label htmlFor="lab-instrument-status" style={s.label}>Status</label>
        <select id="lab-instrument-status" style={{ ...s.input, width: 'auto' }} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="pending">Pending</option><option value="unmatched">Unmatched</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="all">All</option>
        </select>
      </div>
      {loading && <p role="status" style={s.sub}>Loading analyser results…</p>}
      {visibleResults.map((result) => {
        const instrument = instrumentById.get(result.instrument_id)
        const closed = result.status === 'accepted' || result.status === 'rejected'
        const unmapped = Array.isArray(result.unmapped) ? result.unmapped : []
        const orderId = matchByResult[result.id] || result.lab_test_id || ''
        return (
          <article key={result.id} aria-label={`Analyzer result ${result.sample_id}`} style={{ borderTop: `1px solid ${C.border}`, padding: '12px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div><b>{result.sample_id}</b> · {result.test_type || result.template_key || 'Unmatched order'} · {instrument?.name || 'Unknown analyser'}</div>
              <span>{result.status} · received {formatTime(result.received_at)}</span>
            </div>
            <div style={s.sub}>Measured {formatTime(result.measured_at)}{result.patient_name ? ` · ${result.patient_name}` : ''}</div>
            {result.lab_test_id && <div style={s.sub}>Matched order: {orders.find((order) => String(order.id) === String(result.lab_test_id))?.test_type || result.lab_test_id}</div>}
            <ResultValues values={result.result_values} />
            {result.flags && Object.keys(result.flags).length > 0 && <div style={{ marginTop: 6 }}><b>Instrument flags:</b> {JSON.stringify(result.flags)}</div>}
            {unmapped.length > 0 && (
              <div role="alert" style={{ ...s.err, marginTop: 8 }}>
                Unmapped analyser codes are not added to the structured order: {unmapped.map((item) => `${item.code}=${item.value} ${item.unit || ''}`).join('; ')}
              </div>
            )}
            {result.reject_reason && <div style={{ ...s.sub, marginTop: 6 }}>Rejected: {result.reject_reason}</div>}
            {result.raw && <details style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer' }}>Raw analyser message</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 180, overflow: 'auto' }}>{result.raw}</pre></details>}
            {!closed && (
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                {result.status === 'unmatched' && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <select aria-label={`Order for sample ${result.sample_id}`} style={s.input} value={orderId} onChange={(event) => setMatchByResult((current) => ({ ...current, [result.id]: event.target.value }))}>
                      <option value="">Choose matching lab order</option>
                      {orders.map((order) => <option key={order.id} value={order.id}>{order.sample_barcode || 'No barcode'} · {order.test_type || 'Lab test'} · {order.patient_name || 'Patient'} · {formatTime(order.created_at)}</option>)}
                    </select>
                    <button type="button" style={{ ...s.btn, ...s.soft }} disabled={saving || !orderId} onClick={() => void matchResult(result)}>Match order</button>
                  </div>
                )}
                {unmapped.length > 0 && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
                    <input type="checkbox" checked={Boolean(reviewedUnmapped[result.id])} onChange={(event) => setReviewedUnmapped((current) => ({ ...current, [result.id]: event.target.checked }))} />
                    I reviewed these unmapped codes; only the listed mapped values will be added to the lab order.
                  </label>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={{ ...s.btn, ...s.pri }} disabled={saving || !result.lab_test_id || !Object.keys(result.result_values || {}).length || (unmapped.length > 0 && !reviewedUnmapped[result.id])} onClick={() => void acceptResult(result)}>Accept result</button>
                  <input aria-label={`Reason for rejecting ${result.sample_id}`} style={s.input} placeholder="Reason for rejection" value={rejectByResult[result.id] || ''} onChange={(event) => setRejectByResult((current) => ({ ...current, [result.id]: event.target.value }))} />
                  <button type="button" style={{ ...s.btn, ...s.ghost }} disabled={saving || !String(rejectByResult[result.id] || '').trim()} onClick={() => void rejectResult(result)}>Reject</button>
                </div>
              </div>
            )}
          </article>
        )
      })}
      {!loading && !visibleResults.length && <p style={s.sub}>No {statusFilter === 'all' ? '' : `${statusFilter} `}analyser results in the inbox.</p>}
    </section>
  )
}
