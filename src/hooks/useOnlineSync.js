import { useCallback, useEffect, useState } from 'react'
import supabase from '../supabase'
import { discardOfflineAction, forceSyncOfflineAction, getPendingOfflineActions, subscribeToOfflineQueue, syncPendingActions } from '../utils/offlineSync'

/** Online state + the offline queue: counts for the top bar, retry every minute, and review actions. */
export default function useOnlineSync() {
  const [isOnlineState, setIsOnlineState] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [syncStatus, setSyncStatus] = useState('idle')
  const [queue, setQueue] = useState([])

  const refreshQueue = useCallback(async () => {
    try { setQueue(await getPendingOfflineActions()) } catch (_) { setQueue([]) }
  }, [])

  const runPendingSync = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnlineState(false)
      return { synced: 0, failed: 0, conflicts: 0, offline: true }
    }
    let pending = []
    try { pending = await getPendingOfflineActions() } catch (_) { /* no IndexedDB */ }
    if (!pending.length) { setSyncStatus('idle'); return { synced: 0, failed: 0, conflicts: 0, offline: false } }
    setSyncStatus('syncing')
    const result = await syncPendingActions(supabase).catch(() => ({ synced: 0, failed: 1, conflicts: 0 }))
    setSyncStatus(result.failed > 0 || result.conflicts > 0 ? 'attention' : 'idle')
    await refreshQueue()
    return result
  }, [refreshQueue])

  useEffect(() => {
    const unsubscribe = subscribeToOfflineQueue(setQueue)
    void refreshQueue()
    const handleOnline = async () => { setIsOnlineState(true); await runPendingSync() }
    const handleOffline = () => setIsOnlineState(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    if (typeof navigator !== 'undefined' && navigator.onLine) void handleOnline()
    // "online" events are unreliable on flaky mobile data: retry quietly every minute
    const timer = window.setInterval(() => { if (navigator.onLine) void runPendingSync() }, 60000)
    return () => {
      unsubscribe()
      window.clearInterval(timer)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [runPendingSync, refreshQueue])

  const applyAnyway = useCallback(async (id) => { await forceSyncOfflineAction(supabase, id); await refreshQueue() }, [refreshQueue])
  const discard = useCallback(async (id) => { await discardOfflineAction(id); await refreshQueue() }, [refreshQueue])

  return {
    isOnlineState,
    syncStatus,
    queue,
    pendingCount: queue.filter((i) => i.status === 'pending').length,
    attentionCount: queue.filter((i) => i.status === 'conflict' || i.status === 'failed').length,
    syncPendingActions: runPendingSync,
    applyAnyway,
    discard,
  }
}
