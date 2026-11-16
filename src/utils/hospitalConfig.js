// Hospital configuration kept in the database (20261124000000_configuration.sql): payer price lists, the role
// matrix and department form changes. Every helper falls back to the code defaults when nothing is configured or
// the tables are not installed yet, so a hospital that never opens Settings → Configuration works as before.
import { setRolePermissionOverrides } from '../access'

const notInstalled = (error) => /does not exist|schema cache|Could not find/i.test(error?.message || '')

// ---------------------------------------------------------------- roles

/** Load this hospital's role matrix into access.js. Returns the rows (empty = defaults). */
export async function loadRoleOverrides(supabase, hospitalId) {
  if (!hospitalId) { setRolePermissionOverrides([]); return [] }
  const { data, error } = await supabase.from('role_permissions').select('role, screens, actions').eq('hospital_id', hospitalId)
  if (error) { setRolePermissionOverrides([]); return [] }
  setRolePermissionOverrides(data || [])
  return data || []
}

/** Screens every role must keep, so nobody is locked out of the app entirely. */
export const ALWAYS_ALLOWED_SCREENS = ['/dashboard']

// ---------------------------------------------------------------- department forms

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'datetime-local', 'select']

/**
 * Apply saved changes to a module's default fields.
 * override: [{ key, label?, required?, hidden?, options?, type?, custom? }] — custom fields are appended.
 * Built-in fields keep their key and type (the safety checks read them); a field required by default stays required.
 */
export function mergeWorkflowFields(defaultFields = [], override = []) {
  const byKey = new Map((override || []).filter((f) => f && f.key).map((f) => [f.key, f]))
  const merged = []
  for (const field of defaultFields) {
    const o = byKey.get(field.key)
    if (!o) { merged.push(field); continue }
    if (o.hidden && !field.required) continue
    const next = { ...field }
    if (typeof o.label === 'string' && o.label.trim()) next.label = o.label.trim()
    if (o.required === true) next.required = true
    if (field.type === 'select' && Array.isArray(o.options) && o.options.length) next.options = o.options.map(String)
    merged.push(next)
  }
  const builtIn = new Set(defaultFields.map((f) => f.key))
  for (const o of override || []) {
    if (!o?.custom || !o.key || builtIn.has(o.key) || o.hidden) continue
    const type = FIELD_TYPES.includes(o.type) ? o.type : 'text'
    const field = { key: o.key, label: String(o.label || o.key), required: Boolean(o.required), type: type === 'text' ? undefined : type }
    if (type === 'select') field.options = (o.options || []).map(String).filter(Boolean)
    merged.push(field)
  }
  return merged
}

/** Problems with a form override before it is saved ('' when fine). */
export function validateWorkflowOverride(defaultFields = [], override = []) {
  const builtIn = new Set(defaultFields.map((f) => f.key))
  const seen = new Set()
  for (const o of override || []) {
    if (!o?.key) return 'Every field needs a key.'
    if (seen.has(o.key)) return `The field "${o.key}" appears twice.`
    seen.add(o.key)
    if (o.custom) {
      if (builtIn.has(o.key)) return `"${o.key}" is already a built-in field; pick another name.`
      if (!/^x_[a-z0-9_]{1,40}$/.test(o.key)) return `Custom field keys start with x_ and use lower-case letters, numbers and _ (got "${o.key}").`
      if (!String(o.label || '').trim()) return `The custom field "${o.key}" needs a label.`
      if (o.type === 'select' && !(o.options || []).filter(Boolean).length) return `The list "${o.label}" needs at least one option.`
    } else {
      const field = defaultFields.find((f) => f.key === o.key)
      if (!field) return `"${o.key}" is not a field of this form.`
      if (o.hidden && field.required) return `"${field.label}" is required by the safety checks and cannot be hidden.`
    }
  }
  return ''
}

/** Turn a field key from a label: "Blood loss (ml)" → x_blood_loss_ml */
export function customFieldKey(label) {
  const slug = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return slug ? `x_${slug}` : ''
}

const formCache = new Map()

/** The saved override for one module (cached per hospital for the session; Settings clears it on save). */
export async function loadWorkflowOverride(supabase, hospitalId, moduleCode) {
  if (!hospitalId || !moduleCode) return []
  const key = `${hospitalId}:${moduleCode}`
  if (formCache.has(key)) return formCache.get(key)
  try {
    const { data, error } = await supabase.from('workflow_form_overrides').select('fields')
      .eq('hospital_id', hospitalId).eq('module_code', moduleCode).maybeSingle()
    const fields = error || !Array.isArray(data?.fields) ? [] : data.fields
    if (!error || notInstalled(error)) formCache.set(key, fields)
    return fields
  } catch {
    return [] // a form change must never stop a department screen from loading
  }
}
export function clearWorkflowOverrideCache() { formCache.clear() }

// ---------------------------------------------------------------- prices

/** Which kind of price list applies (mirrors config_payer_type in the database). */
export function payerTypeFor(paymentMethod, insurer) {
  const m = String(paymentMethod || '')
  if (/(sha|nhif|social health)/i.test(m)) return 'sha'
  if (/insur/i.test(m) && /^(sha|nhif)/i.test(String(insurer || ''))) return 'sha'
  if (/insur/i.test(m)) return 'insurance'
  if (/(corporate|company|employer)/i.test(m)) return 'corporate'
  if (/staff/i.test(m)) return 'staff'
  return 'cash'
}

/**
 * The amount to bill for a charge code: the payer's price list if one sets it, otherwise the base tariff.
 * Never throws: when the price lists are not installed or the lookup fails, the base price is used.
 * → { amount, priceList }  (priceList is null when the base tariff applied)
 */
export async function priceForPayer(supabase, hospitalId, chargeCode, basePrice, { paymentMethod, insurer } = {}) {
  const base = { amount: Number(basePrice || 0), priceList: null }
  if (!hospitalId || !chargeCode || payerTypeFor(paymentMethod, insurer) === 'cash') return base
  try {
    const { data, error } = await supabase.rpc('config_price', {
      p_hospital: hospitalId, p_code: chargeCode, p_payment_method: paymentMethod || null, p_insurer: insurer || null,
    })
    const row = Array.isArray(data) ? data[0] : data
    if (error || !row || row.price_kes === null || row.price_kes === undefined) return base
    return { amount: Number(row.price_kes), priceList: row.price_list || null }
  } catch {
    return base
  }
}
