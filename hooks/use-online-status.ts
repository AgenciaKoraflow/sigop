'use client'

import { useCallback, useEffect, useState } from 'react'
import { countPending, processQueue } from '@/lib/sync/queue'

/**
 * Global connection / sync status for SIGOP's offline layer.
 *
 * Identifiers are kept in English to match the rest of the codebase; the
 * user-facing copy that consumes this hook stays in Portuguese.
 */
export type ConnectionStatus = 'online' | 'offline' | 'syncing' | 'error'

export interface SyncStats {
  /** Entity drafts still waiting in the sync queue. */
  pending: number
  /** Queue items that exhausted a sync attempt and are in error. */
  errors: number
  /** Photos captured offline still waiting to upload. */
  photos: number
}

const isOffline = () => typeof navigator !== 'undefined' && !navigator.onLine

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [status, setStatus] = useState<ConnectionStatus>('online')
  const [stats, setStats] = useState<SyncStats>({ pending: 0, errors: 0, photos: 0 })
  const [lastSync, setLastSync] = useState<Date | null>(null)

  const refreshStats = useCallback(async () => {
    const counts = await countPending()
    setStats({ pending: counts.total, errors: counts.errors, photos: counts.photos })
    setStatus((prev) => {
      if (prev === 'syncing') return prev
      if (isOffline()) return 'offline'
      if (counts.errors > 0) return 'error'
      return 'online'
    })
  }, [])

  const syncNow = useCallback(async () => {
    if (isOffline()) return
    setStatus('syncing')
    try {
      await processQueue()
      setLastSync(new Date())
    } catch {
      setStatus('error')
      return
    }
    await refreshStats()
  }, [refreshStats])

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      void syncNow()
    }
    const handleOffline = () => {
      setIsOnline(false)
      setStatus('offline')
    }
    const handleVisibility = () => {
      if (!document.hidden && navigator.onLine) void syncNow()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibility)

    // Check current state on mount.
    if (isOffline()) setStatus('offline')
    void refreshStats()

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [syncNow, refreshStats])

  return { isOnline, status, stats, lastSync, syncNow }
}
