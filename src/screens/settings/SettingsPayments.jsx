import { useCallback, useEffect, useState } from 'react'
import supabase from '../../supabase'
import { colors as C, typography } from '../../theme'
import { notifyError, notifySuccess } from '../../notifications'
import { errorMessage } from '../../utils/payments/api'
import { PAYMENT_METHODS } from '../../utils/payments/methods'

const PROVIDERS = {
  daraja: {
    label: 'Safaricom M-Pesa (Daraja)', for: 'M-Pesa STK Push',
    fields: [
      ['consumer_key', 'Consumer key'], ['consumer_secret', 'Consumer secret'],
      ['shortcode', 'Paybill / store number'], ['passkey', 'Lipa na M-Pesa passkey'],
      ['till_number', 'Till number (Buy Goods only — leave blank for Paybill)'],
    ],
  },
  paystack: { label: 'Paystack', for: 'Cards, M-Pesa, bank', fields: [['secret_key', 'Secret key (sk_live_… / sk_test_…)']] },
  flutterwave: { label: 'Flutterwave', for: 'Cards, M-Pesa, Airtel, bank', fields: [['secret_key', 'Secret key'], ['webhook_hash', 'Secret hash (set the same value in the Flutterwave dashboard)']] },
  pesapal: { label: 'Pesapal', for: 'Cards, M-Pesa, Airtel, bank', fields: [['consumer_key', 'Consumer key'], ['consumer_secret', 'Consumer secret']] },
}

const s = {
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, marginBottom: 16 },
  h: { fontSize: 14, fontWeight: 800, margin: '0 0 4px' },
  sub: { fontSize: 12, color: C.sub, marginBottom: 12 },
  lbl: { display: 'block', fontSize: 10, fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 3 },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: C.surface, color: C.text, outline: 'none' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 },
  btn: { padding: '9px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: C.primary, color: '#fff' },
  chk: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 0' },
  badge: (ok) => ({ display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ok ? C.successL : C.warnL, color: ok ? C.success : C.warn }),
  code: { fontFamily: 'monospace', fontSize: 11, background: C.bgAlt, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px', wordBreak: 'break-all', display: 'block', marginTop: 4 },
}

const DEFAULTS = {
  enabled_methods: ['cash', 'mpesa_manual', 'card_pos', 'bank_transfer', 'cheque'],
  mpesa_provider: 'daraja', card_provider: 'paystack', mpesa_paybill: '', mpesa_till: '',
  bank_name: '', bank_account_name: '', bank_account_no: '', fallback_email: '', allow_partial: true,
}

export default function SettingsPayments({ hospitalId }) {
  const [form, setForm] = useState(DEFAULTS)
  const [status, setStatus] = useState({})      // provider -> { environment, keys[] }
  const [creds, setCreds] = useState({})        // provider -> { environment, values }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!hospitalId) return
    const [{ data: row }, { data: st }] = await Promise.all([
      supabase.from('hospital_payment_settings').select('*').eq('hospital_id', hospitalId).maybeSingle(),
      supabase.rpc('payment_credentials_status', { p_hospital: hospitalId }),
    ])
    if (row) setForm({ ...DEFAULTS, ...row })
    setStatus(Object.fromEntries((st || []).map((r) => [r.provider, { environment: r.environment, keys: r.configured_keys || [] }])))
    setLoading(false)
  }, [hospitalId])

  useEffect(() => { load() }, [load])

  const toggleMethod = (id) => setForm((f) => ({
    ...f, enabled_methods: f.enabled_methods.includes(id) ? f.enabled_methods.filter((m) => m !== id) : [...f.enabled_methods, id],
  }))
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function saveSettings() {
    if (!form.enabled_methods.length) { notifyError('Enable at least one payment method.'); return }
    setSaving(true)
    const payload = { ...form, hospital_id: hospitalId, updated_at: new Date().toISOString() }
    const { error } = await supabase.from('hospital_payment_settings').upsert(payload, { onConflict: 'hospital_id' })
    setSaving(false)
    if (error) notifyError(await errorMessage(error)); else notifySuccess('Payment settings saved.')
  }

  async function saveCreds(provider) {
    const c = creds[provider] || {}
    const values = Object.fromEntries(Object.entries(c.values || {}).filter(([, v]) => String(v || '').trim()))
    if (!Object.keys(values).length && !status[provider]) { notifyError('Enter the credentials first.'); return }
    setSaving(true)
    const { error } = await supabase.rpc('set_payment_credentials', {
      p_hospital: hospitalId, p_provider: provider, p_environment: c.environment || status[provider]?.environment || 'sandbox', p_credentials: values,
    })
    setSaving(false)
    if (error) { notifyError(await errorMessage(error)); return }
    setCreds((prev) => ({ ...prev, [provider]: { environment: c.environment, values: {} } }))
    notifySuccess(`${PROVIDERS[provider].label} credentials saved. They are write-only and never shown again.`)
    load()
  }

  const fnBase = `${import.meta.env.VITE_SUPABASE_URL || 'https://<project>.supabase.co'}/functions/v1/payments-webhook`
  const needs = (provider) => !status[provider]
  const warnings = []
  if (form.enabled_methods.includes('mpesa') && needs(form.mpesa_provider)) warnings.push(`M-Pesa STK Push is enabled but ${PROVIDERS[form.mpesa_provider].label} is not configured.`)
  if (form.enabled_methods.includes('card_online') && needs(form.card_provider)) warnings.push(`Online card checkout is enabled but ${PROVIDERS[form.card_provider].label} is not configured.`)
  if (status[form.mpesa_provider]?.environment === 'sandbox' && form.enabled_methods.includes('mpesa')) warnings.push('M-Pesa is in SANDBOX mode — no real money will move.')

  if (loading) return <div style={{ color: C.sub, padding: 20 }}>Loading payment settings…</div>

  return (
    <div style={{ fontFamily: typography.fontFamily, color: C.text, fontSize: 13 }}>
      {warnings.map((w) => <div key={w} style={{ background: C.warnL, color: C.warn, borderRadius: 8, padding: '9px 12px', marginBottom: 10, fontSize: 12 }}>{w}</div>)}

      <div style={s.card}>
        <h3 style={s.h}>Payment methods</h3>
        <div style={s.sub}>Choose what cashiers can use. Online methods also need a gateway below.</div>
        <div style={s.grid}>
          {Object.values(PAYMENT_METHODS).map((m) => (
            <label key={m.id} style={s.chk}>
              <input type="checkbox" checked={form.enabled_methods.includes(m.id)} onChange={() => toggleMethod(m.id)} />
              <span>{m.icon} {m.label}</span>
            </label>
          ))}
        </div>
        <div style={{ ...s.grid, marginTop: 14 }}>
          <div><label style={s.lbl}>M-Pesa STK provider</label>
            <select style={s.input} value={form.mpesa_provider} onChange={(e) => set('mpesa_provider', e.target.value)}>
              {['daraja', 'paystack', 'flutterwave'].map((p) => <option key={p} value={p}>{PROVIDERS[p].label}</option>)}
            </select></div>
          <div><label style={s.lbl}>Card / online checkout provider</label>
            <select style={s.input} value={form.card_provider} onChange={(e) => set('card_provider', e.target.value)}>
              {['paystack', 'flutterwave', 'pesapal'].map((p) => <option key={p} value={p}>{PROVIDERS[p].label}</option>)}
            </select></div>
          <div><label style={s.lbl}>Fallback email for gateway receipts</label>
            <input style={s.input} type="email" value={form.fallback_email || ''} onChange={(e) => set('fallback_email', e.target.value)} placeholder="accounts@hospital.co.ke" /></div>
        </div>
        <label style={{ ...s.chk, marginTop: 8 }}><input type="checkbox" checked={form.allow_partial} onChange={(e) => set('allow_partial', e.target.checked)} /> Allow partial payments</label>
      </div>

      <div style={s.card}>
        <h3 style={s.h}>Hospital collection details</h3>
        <div style={s.sub}>Shown to cashiers when a patient wants to pay by Paybill, Till or bank transfer.</div>
        <div style={s.grid}>
          <div><label style={s.lbl}>M-Pesa Paybill</label><input style={s.input} value={form.mpesa_paybill || ''} onChange={(e) => set('mpesa_paybill', e.target.value)} /></div>
          <div><label style={s.lbl}>M-Pesa Till (Buy Goods)</label><input style={s.input} value={form.mpesa_till || ''} onChange={(e) => set('mpesa_till', e.target.value)} /></div>
          <div><label style={s.lbl}>Bank</label><input style={s.input} value={form.bank_name || ''} onChange={(e) => set('bank_name', e.target.value)} /></div>
          <div><label style={s.lbl}>Account name</label><input style={s.input} value={form.bank_account_name || ''} onChange={(e) => set('bank_account_name', e.target.value)} /></div>
          <div><label style={s.lbl}>Account number</label><input style={s.input} value={form.bank_account_no || ''} onChange={(e) => set('bank_account_no', e.target.value)} /></div>
        </div>
        <button style={{ ...s.btn, marginTop: 14, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={saveSettings}>Save payment settings</button>
      </div>

      {Object.entries(PROVIDERS).map(([key, p]) => {
        const st = status[key]
        const c = creds[key] || { environment: st?.environment || 'sandbox', values: {} }
        return (
          <div key={key} style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div><h3 style={s.h}>{p.label}</h3><div style={s.sub}>{p.for}</div></div>
              <span style={s.badge(!!st)}>{st ? `Configured · ${st.environment}` : 'Not configured'}</span>
            </div>
            <div style={s.grid}>
              <div><label style={s.lbl}>Environment</label>
                <select style={s.input} value={c.environment} onChange={(e) => setCreds((prev) => ({ ...prev, [key]: { ...c, environment: e.target.value } }))}>
                  <option value="sandbox">Sandbox (testing)</option><option value="live">Live (real money)</option>
                </select></div>
              {p.fields.map(([f, label]) => (
                <div key={f}><label style={s.lbl}>{label}{st?.keys?.includes(f) ? ' ✓ saved' : ''}</label>
                  <input style={s.input} type="password" autoComplete="new-password" placeholder={st?.keys?.includes(f) ? '•••••••• (leave blank to keep)' : ''}
                    value={c.values?.[f] || ''} onChange={(e) => setCreds((prev) => ({ ...prev, [key]: { ...c, values: { ...(c.values || {}), [f]: e.target.value } } }))} /></div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.sub, marginTop: 10 }}>
              Webhook / callback URL to register with the provider (Daraja and Pesapal URLs are generated automatically per payment):
              <code style={s.code}>{`${fnBase}?provider=${key}`}</code>
            </div>
            <button style={{ ...s.btn, marginTop: 12, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={() => saveCreds(key)}>Save {p.label} credentials</button>
          </div>
        )
      })}
    </div>
  )
}
