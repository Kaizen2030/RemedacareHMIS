// Public page opened from the QR code on a printed referral letter: a read-only summary of that one visit for the
// receiving clinician, no RemedacareHMS account needed. The token in the link is checked by the server
// (referral_share_resolve): it opens only that visit, expires, can be revoked, and every opening is logged.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

const BASE = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

/** Turn a FHIR document bundle into the sections a clinician reads. Exported for tests. */
export function summariseBundle(bundle) {
  const all = (bundle?.entry || []).map((e) => e.resource).filter(Boolean)
  const of = (type) => all.filter((r) => r.resourceType === type)
  const patient = of('Patient')[0] || {}
  const encounter = of('Encounter')[0] || {}
  const org = of('Organization')[0] || {}
  const qty = (o) => o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit || ''}`.trim()
    : o.component ? o.component.map((c) => c.valueQuantity?.value).filter((v) => v !== undefined).join('/') + ' mmHg'
      : o.valueString || ''
  return {
    facility: org.name || 'Referring facility',
    patient: {
      name: patient.name?.[0]?.text || 'Unknown',
      gender: patient.gender || '',
      birthDate: patient.birthDate || '',
      ids: (patient.identifier || []).filter((i) => /national-id|sha|mrn/.test(i.system || '')).map((i) => ({ label: /national-id/.test(i.system) ? 'National ID' : /sha/.test(i.system) ? 'SHA no.' : 'Patient no.', value: i.value })),
      allergies: (patient.extension || []).find((x) => /allergies/.test(x.url))?.valueString || '',
    },
    visit: { start: encounter.period?.start || '', reason: encounter.reasonCode?.[0]?.text || encounter.type?.[0]?.text || '', status: encounter.status || '' },
    diagnoses: of('Condition').map((c) => ({ code: c.code?.coding?.[0]?.code || '', text: c.code?.text || c.code?.coding?.[0]?.display || '' })),
    vitals: of('Observation').map((o) => ({ name: o.code?.text || o.code?.coding?.[0]?.display || '', value: qty(o), at: o.effectiveDateTime || '' })),
    medicines: of('MedicationRequest').map((m) => ({ name: m.medicationCodeableConcept?.text || '', how: m.dosageInstruction?.[0]?.text || '', status: m.status })),
    labs: of('DiagnosticReport').map((d) => ({ name: d.code?.text || '', status: d.status, conclusion: d.conclusion || '' })),
    expires: bundle?.meta?.tag?.find((t) => t.code === 'expires')?.display || '',
  }
}

const css = {
  page: { minHeight: '100vh', background: '#F4F7F6', fontFamily: 'Inter, system-ui, Arial, sans-serif', color: '#101828', padding: '16px' },
  wrap: { maxWidth: 820, margin: '0 auto' },
  card: { background: '#fff', border: '1px solid #E4E7EC', borderRadius: 12, padding: 16, marginBottom: 12 },
  h2: { fontSize: 14, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '.04em', color: '#475467' },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid #F2F4F7', fontSize: 14 },
  sub: { color: '#667085', fontSize: 12 },
}
const date = (v) => (v ? new Date(v).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: v.length > 10 ? 'short' : undefined }) : '—')

function Section({ title, items, render, empty }) {
  return (
    <section style={css.card}>
      <h2 style={css.h2}>{title}</h2>
      {items.length ? items.map(render) : <div style={css.sub}>{empty}</div>}
    </section>
  )
}

export default function SharedReferral() {
  const { token = '' } = useParams()
  const [state, setState] = useState({ loading: true, error: '', data: null })

  useEffect(() => {
    let active = true
    fetch(`${BASE}/functions/v1/fhir-bundle?share=${encodeURIComponent(token)}`, { headers: { Accept: 'application/fhir+json', apikey: ANON } })
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (!active) return
        if (!r.ok) setState({ loading: false, error: body?.issue?.[0]?.diagnostics || 'This link could not be opened.', data: null })
        else setState({ loading: false, error: '', data: summariseBundle(body) })
      })
      .catch(() => active && setState({ loading: false, error: 'No internet connection. Try again.', data: null }))
    return () => { active = false }
  }, [token])

  const d = state.data
  return (
    <main style={css.page}>
      <div style={css.wrap}>
        <div style={{ ...css.card, background: '#0F6E56', color: '#fff', border: 'none' }}>
          <div style={{ fontSize: 12, opacity: 0.85 }}>RemedacareHMS · Referral record</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{d ? d.facility : 'Referral'}</div>
          <div style={{ fontSize: 12, marginTop: 6, opacity: 0.9 }}>Confidential medical information for the receiving clinician. This opening is recorded.</div>
        </div>
        {state.loading && <div style={css.card} role="status">Loading the referral record…</div>}
        {state.error && <div style={{ ...css.card, borderColor: '#FDA29B', background: '#FEF3F2', color: '#B42318' }} role="alert">{state.error}</div>}
        {d && <>
          <section style={css.card}>
            <h2 style={css.h2}>Patient</h2>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{d.patient.name}</div>
            <div style={css.sub}>{[d.patient.gender, d.patient.birthDate && `born ${d.patient.birthDate}`].filter(Boolean).join(' · ')}</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>{d.patient.ids.map((i) => <span key={i.label}><b>{i.label}:</b> {i.value}</span>)}</div>
            {d.patient.allergies && <div style={{ marginTop: 10, padding: '8px 10px', background: '#FEF3F2', color: '#B42318', borderRadius: 8, fontWeight: 700 }}>Allergies: {d.patient.allergies}</div>}
          </section>
          <section style={css.card}>
            <h2 style={css.h2}>Visit</h2>
            <div style={css.row}><span>Seen</span><span>{date(d.visit.start)}</span></div>
            <div style={css.row}><span>Reason</span><span>{d.visit.reason || '—'}</span></div>
          </section>
          <Section title="Diagnoses" items={d.diagnoses} empty="None recorded" render={(x, i) => <div key={i} style={css.row}><span>{x.text}</span><span style={css.sub}>{x.code}</span></div>} />
          <Section title="Vital signs" items={d.vitals} empty="None recorded" render={(x, i) => <div key={i} style={css.row}><span>{x.name}</span><span><b>{x.value}</b> <span style={css.sub}>{date(x.at)}</span></span></div>} />
          <Section title="Medicines" items={d.medicines} empty="None prescribed" render={(x, i) => <div key={i} style={css.row}><span>{x.name}</span><span style={css.sub}>{x.how}</span></div>} />
          <Section title="Laboratory" items={d.labs} empty="No tests" render={(x, i) => <div key={i} style={css.row}><span>{x.name}</span><span style={css.sub}>{x.conclusion || x.status}</span></div>} />
          {d.expires && <div style={{ ...css.sub, textAlign: 'center' }}>This link stops working on {date(d.expires)}.</div>}
        </>}
      </div>
    </main>
  )
}
