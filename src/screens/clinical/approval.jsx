// Hospital approval of a clinical guide or pathway version (clinical_guide_approvals).
import { useState } from 'react'
import supabase from '../../supabase'
import { s } from '../ncd/ui'

export function ApprovalBar({ guide, approval, hospitalId, onChanged, canEdit }) {
  const [form, setForm] = useState(null)
  const [err, setErr] = useState('')
  const approve = async () => {
    setErr('')
    const { error } = await supabase.from('clinical_guide_approvals').insert({ hospital_id: hospitalId, guide_id: guide.id, version: guide.version, approver_name: form.name, approver_role: form.role || null, committee_ref: form.ref || null })
    if (error) { setErr(/row-level|permission|Only a consultant/i.test(error.message) ? 'Only a consultant, clinical lead, head of department, pharmacist or administrator can approve.' : error.message); return }
    setForm(null); onChanged()
  }
  const withdraw = async () => {
    const reason = window.prompt('Why is this approval being withdrawn?')
    if (!reason) return
    const { error } = await supabase.from('clinical_guide_approvals').update({ withdrawn_at: new Date().toISOString(), withdraw_reason: reason }).eq('id', approval.id)
    if (error) setErr(error.message); else onChanged()
  }
  return (
    <div style={{ marginBottom: 12 }}>
      {approval ? (
        <div role="status" style={{ ...s.ok, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span>Approved for use at this hospital by {approval.approver_name}{approval.approver_role ? ` (${approval.approver_role})` : ''} on {String(approval.approved_at).slice(0, 10)}{approval.committee_ref ? ` · ${approval.committee_ref}` : ''} · version {guide.version}</span>
          {canEdit && <button type="button" style={{ ...s.btn, ...s.ghost, padding: '2px 8px' }} onClick={withdraw}>Withdraw</button>}
        </div>
      ) : (
        <div role="alert" style={{ ...s.err, background: '#FFFAEB', color: '#B54708', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span><strong>Draft — not yet approved by this hospital.</strong> Use with clinical judgement until your clinical lead or Medicines &amp; Therapeutics Committee approves version {guide.version}.</span>
          {!form && canEdit && <button type="button" style={{ ...s.btn, ...s.pri }} onClick={() => setForm({ name: '', role: '', ref: '' })}>Approve…</button>}
        </div>
      )}
      {form && (
        <div style={{ ...s.grid(160), marginTop: 8, alignItems: 'end' }}>
          <div><label style={s.label} htmlFor="ap-name">Approver name</label><input id="ap-name" style={s.input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
          <div><label style={s.label} htmlFor="ap-role">Role</label><input id="ap-role" style={s.input} placeholder="e.g. Consultant physician" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} /></div>
          <div><label style={s.label} htmlFor="ap-ref">Committee minute (optional)</label><input id="ap-ref" style={s.input} value={form.ref} onChange={(e) => setForm((f) => ({ ...f, ref: e.target.value }))} /></div>
          <button type="button" style={{ ...s.btn, ...s.pri }} disabled={!form.name.trim()} onClick={approve}>Approve this version</button>
        </div>
      )}
      {err && <div role="alert" style={{ ...s.err, marginTop: 8 }}>{err}</div>}
    </div>
  )
}

export function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
