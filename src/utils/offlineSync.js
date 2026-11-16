// Offline write queue (IndexedDB) with idempotent replay and per-table conflict rules.
//
//  * Only NETWORK failures are queued. A refusal (permissions, validation, constraint) is returned at once —
//    retrying it later would never succeed.
//  * Every queued insert carries a client-generated id and is replayed with "insert … on conflict do nothing",
//    so a request that reached the server before the connection dropped is never applied twice.
//  * Updates to REVIEW tables (stock, billing, prescriptions, beds, MAR) are checked against the values the user
//    saw when editing (`base`). If another device changed them meanwhile the item is held as a CONFLICT for a
//    person to apply or discard. Other tables (notes, vitals…) are last-write-wins.
//  * The payments ledger is never written offline.
const DB_NAME = 'remedacare_offline_db'
const DB_VERSION = 1
const SYNC_STORE = 'sync_queue'

export const BLOCKED_TABLES = new Set(['payments', 'payment_events', 'receipt_counters', 'hospital_payment_credentials'])
export const REVIEW_TABLES = new Set(['invoices', 'pharmacy_inventory', 'drug_batches', 'prescriptions', 'credit_debts', 'sales_ledger',
  'mar_doses', 'beds', 'admissions', 'hiv_art', 'appointments'])
const NON_UUID_TABLES = new Set(['audit_log'])
// Tables found (at run time) to use number ids: remembered so client ids are not sent to them again.
try { JSON.parse(localStorage.getItem('remedacare-non-uuid-tables') || '[]').forEach((t) => NON_UUID_TABLES.add(t)) } catch (_) { /* no storage */ }
function rememberNonUuid(table) {
  NON_UUID_TABLES.add(table)
  try { localStorage.setItem('remedacare-non-uuid-tables', JSON.stringify([...NON_UUID_TABLES])) } catch (_) { /* no storage */ }
}
const isIdTypeError = (error) => /invalid input syntax for type (bigint|integer|smallint)|non-DEFAULT value into column "id"|column "id" .*identity/i.test(String(error?.message || ''))
const withoutId = (payload) => (Array.isArray(payload) ? payload.map(({ id, ...row }) => row) : (({ id, ...row }) => row)(payload))
const MAX_ATTEMPTS = 8

const listeners = new Set()
export function subscribeToOfflineQueue(listener) { listeners.add(listener); return () => listeners.delete(listener) }
async function emitChange() {
  if (!listeners.size) return
  try { const items = await getPendingOfflineActions(); listeners.forEach((l) => l(items)) } catch (_) { /* ignore */ }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(SYNC_STORE)) db.createObjectStore(SYNC_STORE, { keyPath: 'id', autoIncrement: true })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore(mode, callback) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, mode)
    const store = tx.objectStore(SYNC_STORE)
    let result
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      db.close?.()
      if (error) reject(error)
      else resolve(result)
    }
    tx.oncomplete = () => finish()
    tx.onerror = () => finish(tx.error || new Error('Offline database transaction failed.'))
    tx.onabort = () => finish(tx.error || new Error('Offline database transaction aborted.'))
    try {
      const operation = callback(store)
      if (operation && typeof operation === 'object' && 'onsuccess' in operation) {
        operation.onsuccess = () => { result = operation.result }
        operation.onerror = () => finish(operation.error || new Error('Offline database request failed.'))
      } else {
        result = operation
      }
    } catch (error) {
      finish(error)
      try { tx.abort() } catch (_) {}
    }
  })
}

export function isOnline() {
  return typeof navigator !== 'undefined' && navigator.onLine
}

const uuid = () => (globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
}))

/** True for "could not reach the server" — the only failures worth retrying later. */
export function isNetworkError(error) {
  if (!error) return false
  const msg = String(error.message || error.details || error || '')
  return error.name === 'TypeError' && /fetch|network|load failed/i.test(msg)
    || /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet_disconnected|timeout|timed out/i.test(msg)
    || error.status === 0 || error.code === 'ECONNRESET'
}

export async function enqueueOfflineAction(action) {
  if (!action || !action.table || !action.operation || !action.payload) {
    throw new Error('Invalid offline action: table, operation and payload are required.')
  }
  if (BLOCKED_TABLES.has(action.table)) throw new Error('Payments cannot be recorded offline. Reconnect and take the payment at the cashier.')
  const clientId = action.clientId || uuid()
  let payload = action.payload
  if (action.operation === 'insert' && !NON_UUID_TABLES.has(action.table) && action.clientIds !== false) {
    payload = Array.isArray(payload)
      ? payload.map((row) => ({ id: row.id || uuid(), ...row }))
      : { id: payload.id || clientId, ...payload }
  }
  const item = {
    clientId,
    table: action.table,
    operation: action.operation,
    payload,
    where: action.where || null,
    base: action.base || null,               // values the user saw (for REVIEW tables)
    label: action.label || null,             // human description for the sync panel
    createdAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    lastError: null,
  }
  const id = await withStore('readwrite', (store) => store.add(item))
  void emitChange()
  return id
}

export async function getPendingOfflineActions() {
  const all = await withStore('readonly', (store) => store.getAll())
  return [...(all || [])].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

export async function clearOfflineAction(id) {
  const r = await withStore('readwrite', (store) => store.delete(id))
  void emitChange()
  return r
}
export const discardOfflineAction = clearOfflineAction

async function saveItem(item) {
  return withStore('readwrite', (store) => (store.put ? store.put(item) : undefined))
}

async function runSupabaseAction(supabase, action) {
  const query = supabase.from(action.table)
  switch (action.operation) {
    case 'insert': {
      // idempotent: replaying a request that already reached the server inserts nothing
      if (!NON_UUID_TABLES.has(action.table) && action.clientIds !== false && typeof query.upsert === 'function') {
        const res = await query.upsert(action.payload, { onConflict: 'id', ignoreDuplicates: true })
        if (res?.error && isIdTypeError(res.error)) {
          rememberNonUuid(action.table)
          return supabase.from(action.table).insert(withoutId(action.payload))
        }
        return res
      }
      return query.insert(NON_UUID_TABLES.has(action.table) ? withoutId(action.payload) : action.payload)
    }
    case 'update':
      if (!action.where || !action.where.column || action.where.value == null) {
        return { data: null, error: new Error('Offline update operations require a where clause.') }
      }
      return query.update(action.payload).eq(action.where.column, action.where.value)
    case 'delete':
      if (!action.where || !action.where.column || action.where.value == null) {
        return { data: null, error: new Error('Offline delete operations require a where clause.') }
      }
      return query.delete().eq(action.where.column, action.where.value)
    case 'upsert':
      return query.upsert(action.payload)
    default:
      return { data: null, error: new Error(`Unsupported offline operation: ${action.operation}`) }
  }
}

/** For REVIEW tables: has anyone changed the fields we are about to overwrite since the user saw them? */
async function detectConflict(supabase, item) {
  if (item.operation !== 'update' || !REVIEW_TABLES.has(item.table) || !item.base || !item.where) return null
  const fields = Object.keys(item.base)
  if (!fields.length) return null
  const { data, error } = await supabase.from(item.table).select(fields.join(',')).eq(item.where.column, item.where.value).maybeSingle()
  if (error) return isNetworkError(error) ? { network: true } : null
  if (!data) return { reason: 'The record no longer exists.' }
  const changed = fields.filter((f) => JSON.stringify(data[f] ?? null) !== JSON.stringify(item.base[f] ?? null))
  return changed.length ? { reason: `Changed on another device while you were offline: ${changed.join(', ')}.`, current: data } : null
}

export async function syncPendingActions(supabase, { force = new Set() } = {}) {
  if (!isOnline()) return { synced: 0, failed: 0, conflicts: 0, offline: true }
  const pending = await getPendingOfflineActions()
  let synced = 0, failed = 0, conflicts = 0
  for (const item of pending) {
    if (item.status === 'conflict' && !force.has(item.id)) { conflicts++; continue }
    if (item.status === 'failed' && (item.attempts || 0) >= MAX_ATTEMPTS && !force.has(item.id)) { failed++; continue }
    try {
      if (!force.has(item.id)) {
        const c = await detectConflict(supabase, item)
        if (c?.network) break
        if (c) {
          await saveItem({ ...item, status: 'conflict', lastError: c.reason, current: c.current || null })
          conflicts++
          continue
        }
      }
      const { error } = await runSupabaseAction(supabase, item)
      if (error) {
        if (isNetworkError(error)) break                  // still offline: keep order, try again later
        await saveItem({ ...item, status: 'failed', attempts: (item.attempts || 0) + 1, lastError: error.message || String(error) })
        failed++
        continue
      }
      await clearOfflineAction(item.id)
      synced++
    } catch (error) {
      if (isNetworkError(error)) break
      await saveItem({ ...item, status: 'failed', attempts: (item.attempts || 0) + 1, lastError: error?.message || String(error) }).catch(() => {})
      failed++
    }
  }
  void emitChange()
  return { synced, failed, conflicts, offline: false }
}

/** Apply a held conflict anyway (overwrite) or retry a failed item now. */
export async function forceSyncOfflineAction(supabase, id) {
  return syncPendingActions(supabase, { force: new Set([id]) })
}

/**
 * Write now when online; queue on network failure or when offline.
 * Returns { data, error, offlineQueued }. A non-network error is returned as-is and NOT queued.
 */
export async function performSyncableAction(supabase, action) {
  if (BLOCKED_TABLES.has(action?.table)) {
    if (isOnline()) return { ...(await runSupabaseAction(supabase, action)), offlineQueued: false }
    return { data: null, error: new Error('Payments cannot be recorded offline.'), offlineQueued: false }
  }
  if (isOnline()) {
    const prepared = action.operation === 'insert' && !NON_UUID_TABLES.has(action.table) && action.clientIds !== false && !Array.isArray(action.payload)
      ? { ...action, payload: { id: action.payload.id || uuid(), ...action.payload } } : action
    try {
      const result = await runSupabaseAction(supabase, prepared)
      if (!result.error) return { ...result, offlineQueued: false }
      if (!isNetworkError(result.error)) return { data: null, error: result.error, offlineQueued: false }
    } catch (error) {
      if (!isNetworkError(error)) return { data: null, error, offlineQueued: false }
    }
    await enqueueOfflineAction(prepared)
    return { data: null, error: null, offlineQueued: true }
  }
  await enqueueOfflineAction(action)
  return { data: null, error: null, offlineQueued: true }
}
