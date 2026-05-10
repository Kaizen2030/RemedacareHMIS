import {
  clearOfflineAction,
  enqueueOfflineAction,
  getPendingOfflineActions,
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

          return {
            add(value) {
              const id = nextId++
              items.push({ ...value, id })
              complete()
              return id
            },
            getAll() {
              complete()
              return [...items]
            },
            delete(id) {
              items = items.filter((item) => item.id !== id)
              complete()
              return undefined
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

    await expect(syncPendingActions(supabase)).resolves.toEqual({ synced: 2, failed: 0, offline: false })
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

    await expect(syncPendingActions(supabase)).resolves.toEqual({ synced: 0, failed: 1, offline: false })
    await expect(getPendingOfflineActions()).resolves.toHaveLength(1)
  })

  it('short-circuits sync while offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })

    const supabase = {
      from() {
        throw new Error('Should not be called while offline')
      },
    }

    await expect(syncPendingActions(supabase)).resolves.toEqual({ synced: 0, failed: 0, offline: true })
  })
})
