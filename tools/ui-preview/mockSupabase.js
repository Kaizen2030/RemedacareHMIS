// Stand-in for src/supabase.js in the UI preview: every query returns empty data (or the rows in window.__PREVIEW_DB__),
// so screens render without a login or a network. Never used by the real app.
const tables = () => (typeof window !== 'undefined' && window.__PREVIEW_DB__) || {}

function query(table) {
  const result = () => ({ data: tables()[table] || [], error: null, count: (tables()[table] || []).length })
  const q = {}
  for (const m of ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'ilike', 'like', 'or', 'not', 'order', 'limit', 'range', 'match', 'filter', 'contains', 'textSearch', 'insert', 'update', 'upsert', 'delete']) q[m] = () => q
  q.single = () => Promise.resolve({ data: (tables()[table] || [])[0] || null, error: null })
  q.maybeSingle = q.single
  q.then = (res, rej) => Promise.resolve(result()).then(res, rej)
  return q
}
const channel = () => { const c = { on: () => c, subscribe: () => c, unsubscribe: () => {} }; return c }

export default {
  from: query,
  rpc: (name) => Promise.resolve({ data: ({ hr_my_staff_id: 'bs9', leave_balances: { 'Annual Leave': { entitled: 21, used: 6, pending: 10 }, 'Sick Leave': { entitled: 14, used: 2, pending: 0 } } })[name] ?? (['guide_can_approve', 'dept_manages', 'hr_can_manage', 'services_can_manage', 'dept_can_publish'].includes(name) ? true : null), error: null }),
  channel,
  removeChannel: () => {},
  auth: {
    getSession: () => Promise.resolve({ data: { session: null } }),
    getUser: () => Promise.resolve({ data: { user: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  storage: { from: () => ({ upload: () => Promise.resolve({}), createSignedUrl: () => Promise.resolve({ data: null }), remove: () => Promise.resolve({}) }) },
  functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
}

export const isLocalPreview = true
