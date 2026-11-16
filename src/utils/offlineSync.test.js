import {
  clearOfflineAction,
  enqueueOfflineAction,
  forceSyncOfflineAction,
  getPendingOfflineActions,
  isNetworkError,
  performSyncableAction,
  syncPendingActions,
} from './offlineSync'

function createIndexedDbMock() {
  let items = []
  let nextId = 1
  const stores = new Set()

  const createDatabase = () => ({
    objectStoreNames: {
      contains(name) {
        return stores.has(name)
      },
    },
    createObjectStore(name) {
      stores.add(name)
      return {}
    },
    transaction() {
      const tx = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore() {
          const complete = () => {
            window.setTimeout(() => tx.oncomplete?.(), 0)
          }
          const createRequest = (result) => {
            const request = { result: undefined, error: null, onsuccess: null, onerror: null }
            window.setTimeout(() => {
              request.result = result
              request.onsuccess?.({ target: request })
              complete()
            }, 0)
            return request
          }

          return {
            add(value) {
              const id = nextId++
              items.push({ ...value, id })
              return createRequest(id)
            },
            getAll() {
              return createRequest([...items])
            },
            delete(id) {
              items = items.filter((item) => item.id !== id)
              return createRequest(undefined)
            },
            put(value) {
              items = items.map((item) => (item.id === value.id ? { ...value } : item))
              return createRequest(value.id)
            },
          }
        },
      }

      return tx
    },
  })

  return {
    open() {
      const request = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, error: null }
      queueMicrotask(() => {
        request.result = createDatabase()
        request.onupgradeneeded?.({ target: { result: request.result } })
        request.onsuccess?.()
      })
      return request
    },
    reset() {
      items = []
      nextId = 1
      stores.clear()
    },
  }
}

describe('offlineSync', () => {
  const indexedDbMock = createIndexedDbMock()

  beforeAll(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: indexedDbMock,
    })
  })

  beforeEach(async () => {
    indexedDbMock.reset()
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
    const pending = await getPendingOfflineActions()
    await Promise.all(pending.map((item) => clearOfflineAction(item.id)))
  })

  it('validates offline actions before enqueueing them', async () => {
    await expect(enqueueOfflineAction({ table: 'patients' })).rejects.toThrow(
      'Invalid offline action: table, operation and payload are required.',
    )
  })

  it('syncs pending actions through the mocked supabase client and clears successful items', async () => {
    await enqueueOfflineAction({ table: 'patients', operation: 'insert', payload: { full_name: 'Amina' } })
    await enqueueOfflineAction({ table: 'patients', operation: 'insert', payload: { full_name: 'Omondi' } })

    const supabase = {
      from(table) {
        return {
          insert(payload) {
            return Promise.resolve({ data: [{ table, ...payload }], error: null })
          },
        }
      },
    }

    await expect(syncPendingActions(supabase)).resolves.toEqual({ synced: 2, failed: 0, conflicts: 0, offline: false })
    await expect(getPendingOfflineActions()).resolves.toEqual([])
  })

  it('keeps failed actions in the queue for retry', async () => {
    await enqueueOfflineAction({ table: 'patients', operation: 'insert', payload: { full_name: 'Retry Case' } })

    const supabase = {
      from() {
        return {
          insert() {
            return Promise.resolve({ data: null, error: new Error('Insert failed') })
          },
        }
      },
    }

    await expect(syncPendingActions(supabase)).resolves.toEqual({ synced: 0, failed: 1, conflicts: 0, offline: false })
    const left = await getPendingOfflineActions()
    expect(left).toHaveLength(1)
    expect(left[0]).toMatchObject({ status: 'failed', attempts: 1, lastError: 'Insert failed' })
  })

  it('short-circuits sync while offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })

    const supabase = {
      from() {
        throw new Error('Should not be called while offline')
      },
    }

    await expect(syncPendingActions(supabase)).resolves.toEqual({ synced: 0, failed: 0, conflicts: 0, offline: true })
  })

  // ── hardened behaviour ────────────────────────────────────────────────────
  const netError = () => Object.assign(new TypeError('Failed to fetch'), {})

  it('recognises network failures only', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError({ message: 'NetworkError when attempting to fetch resource.' })).toBe(true)
    expect(isNetworkError({ message: 'new row violates row-level security policy' })).toBe(false)
    expect(isNetworkError(null)).toBe(false)
  })

  it('online: a refusal is returned and NOT queued; a dropped connection is queued with a client id', async () => {
    const refusing = { from: () => ({ upsert: async () => ({ data: null, error: { message: 'permission denied for table vitals' } }) }) }
    const r1 = await performSyncableAction(refusing, { table: 'vitals', operation: 'insert', payload: { pulse: 80 } })
    expect(r1.offlineQueued).toBe(false)
    expect(r1.error.message).toMatch(/permission denied/)
    expect(await getPendingOfflineActions()).toHaveLength(0)

    const dropping = { from: () => ({ upsert: async () => { throw netError() } }) }
    const r2 = await performSyncableAction(dropping, { table: 'vitals', operation: 'insert', payload: { pulse: 81 } })
    expect(r2).toMatchObject({ offlineQueued: true, error: null })
    const [queued] = await getPendingOfflineActions()
    expect(queued.payload.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(queued.payload.pulse).toBe(81)
  })

  it('replay is idempotent: inserts use on-conflict-do-nothing on the client id', async () => {
    await enqueueOfflineAction({ table: 'nursing_notes', operation: 'insert', payload: { note: 'Turned patient' } })
    const calls = []
    const supabase = { from: (t) => ({ upsert: async (payload, opts) => { calls.push({ t, payload, opts }); return { data: null, error: null } } }) }
    await syncPendingActions(supabase)
    expect(calls[0].opts).toEqual({ onConflict: 'id', ignoreDuplicates: true })
    expect(calls[0].payload.id).toBeTruthy()
  })

  it('stops at the first network failure and keeps the order', async () => {
    await enqueueOfflineAction({ table: 'vitals', operation: 'insert', payload: { pulse: 1 } })
    await enqueueOfflineAction({ table: 'vitals', operation: 'insert', payload: { pulse: 2 } })
    const supabase = { from: () => ({ upsert: async () => ({ data: null, error: netError() }) }) }
    await expect(syncPendingActions(supabase)).resolves.toEqual({ synced: 0, failed: 0, conflicts: 0, offline: false })
    const left = await getPendingOfflineActions()
    expect(left.map((i) => i.payload.pulse)).toEqual([1, 2])
    expect(left.every((i) => i.status === 'pending')).toBe(true)
  })

  it('two devices: a stock change made elsewhere is held for review, then can be applied anyway', async () => {
    await enqueueOfflineAction({ table: 'pharmacy_inventory', operation: 'update', payload: { quantity_in_stock: 40 },
      where: { column: 'id', value: 'drug-1' }, base: { quantity_in_stock: 50 }, label: 'Stock count Amoxicillin' })
    let updated = 0
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { quantity_in_stock: 45 }, error: null }) }) }),
        update: () => ({ eq: async () => { updated++; return { data: null, error: null } } }),
      }),
    }
    await expect(syncPendingActions(supabase)).resolves.toMatchObject({ synced: 0, conflicts: 1 })
    const [held] = await getPendingOfflineActions()
    expect(held).toMatchObject({ status: 'conflict', current: { quantity_in_stock: 45 } })
    expect(held.lastError).toMatch(/quantity_in_stock/)
    expect(updated).toBe(0)
    await forceSyncOfflineAction(supabase, held.id)
    expect(updated).toBe(1)
    expect(await getPendingOfflineActions()).toHaveLength(0)
  })

  it('notes are last-write-wins (no conflict check)', async () => {
    await enqueueOfflineAction({ table: 'nursing_notes', operation: 'update', payload: { note: 'v2' }, where: { column: 'id', value: 'n1' }, base: { note: 'v1' } })
    let updated = 0
    const supabase = { from: () => ({ update: () => ({ eq: async () => { updated++; return { error: null } } }) }) }
    await syncPendingActions(supabase)
    expect(updated).toBe(1)
  })

  it('payments are never queued offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    const r = await performSyncableAction({}, { table: 'payments', operation: 'insert', payload: { amount: 100 } })
    expect(r.error.message).toMatch(/offline/)
    expect(r.offlineQueued).toBe(false)
    await expect(enqueueOfflineAction({ table: 'payments', operation: 'insert', payload: { amount: 1 } })).rejects.toThrow(/Payments cannot be recorded offline/)
  })
})

describe('number-id tables', () => {
  it('a table that rejects client ids is retried without one and remembered', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
    const calls = []
    const supabase = {
      from: () => ({
        upsert: async () => { calls.push('upsert'); return { data: null, error: { message: 'invalid input syntax for type bigint: "abc"' } } },
        insert: async (payload) => { calls.push(['insert', 'id' in payload]); return { data: null, error: null } },
      }),
    }
    const r = await performSyncableAction(supabase, { table: 'legacy_counts', operation: 'insert', payload: { n: 1 } })
    expect(r.error).toBeNull()
    expect(calls).toEqual(['upsert', ['insert', false]])
    await performSyncableAction(supabase, { table: 'legacy_counts', operation: 'insert', payload: { n: 2 } })
    expect(calls.at(-1)).toEqual(['insert', false])
  })
})
