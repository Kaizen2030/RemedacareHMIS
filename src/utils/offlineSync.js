const DB_NAME = 'remedacare_offline_db'
const DB_VERSION = 1
const SYNC_STORE = 'sync_queue'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(SYNC_STORE)) {
        db.createObjectStore(SYNC_STORE, { keyPath: 'id', autoIncrement: true })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore(mode, callback) {
  const db = await openDb()
  const tx = db.transaction(SYNC_STORE, mode)
  const store = tx.objectStore(SYNC_STORE)
  const result = await callback(store)

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export function isOnline() {
  return typeof navigator !== 'undefined' && navigator.onLine
}

export async function enqueueOfflineAction(action) {
  if (!action || !action.table || !action.operation || !action.payload) {
    throw new Error('Invalid offline action: table, operation and payload are required.')
  }

  return withStore('readwrite', (store) => {
    const item = {
      table: action.table,
      operation: action.operation,
      payload: action.payload,
      where: action.where || null,
      createdAt: new Date().toISOString(),
      status: 'pending',
    }
    return store.add(item)
  })
}

export async function getPendingOfflineActions() {
  return withStore('readonly', (store) => store.getAll())
}

export async function clearOfflineAction(id) {
  return withStore('readwrite', (store) => store.delete(id))
}

async function runSupabaseAction(supabase, action) {
  const query = supabase.from(action.table)

  switch (action.operation) {
    case 'insert':
      return query.insert(action.payload)
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

export async function syncPendingActions(supabase) {
  if (!isOnline()) {
    return { synced: 0, failed: 0, offline: true }
  }

  const pending = await getPendingOfflineActions()
  let synced = 0
  let failed = 0

  for (const item of pending) {
    try {
      const { error } = await runSupabaseAction(supabase, item)
      if (error) {
        console.warn('Offline sync failed for item', item.id, error)
        failed += 1
        continue
      }
      await clearOfflineAction(item.id)
      synced += 1
    } catch (error) {
      console.warn('Offline sync exception for item', item.id, error)
      failed += 1
    }
  }

  return { synced, failed, offline: false }
}

export async function performSyncableAction(supabase, action) {
  if (isOnline()) {
    const result = await runSupabaseAction(supabase, action)
    if (!result.error) {
      return { ...result, offlineQueued: false }
    }

    await enqueueOfflineAction(action)
    return { data: null, error: result.error, offlineQueued: true }
  }

  await enqueueOfflineAction(action)
  return { data: null, error: null, offlineQueued: true }
}
