import { useCallback, useEffect, useState } from 'react'
import supabase from '../supabase'
import { syncPendingActions } from '../utils/offlineSync'

export default function useOnlineSync() {
  const [isOnlineState, setIsOnlineState] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [syncStatus, setSyncStatus] = useState('idle')

  const runPendingSync = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnlineState(false)
      return { synced: 0, failed: 0, offline: true }
    }

    setSyncStatus('syncing')
    const result = await syncPendingActions(supabase)
    setSyncStatus(result.failed > 0 ? 'failed' : 'idle')
    return result
  }, [])

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnlineState(true)
      await runPendingSync()
    }

    const handleOffline = () => {
      setIsOnlineState(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void handleOnline()
    }

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [runPendingSync])

  return {
    isOnlineState,
    syncStatus,
    syncPendingActions: runPendingSync,
  }
}
