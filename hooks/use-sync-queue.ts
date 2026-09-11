'use client'

import { useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { enqueueSync, saveDraftIncident } from '@/lib/db'
import type { DraftIncident } from '@/lib/db/schema'
import { createQueueItem, processQueue } from '@/lib/sync/queue'

type WriteOperation = 'create' | 'update'

// Incident drafts run first in the sync queue (priority bucket 1).
const ENTITY_PRIORITY = 1

/**
 * Offline-first writes for SIGOP forms.
 *
 * The order matters: persist the draft locally first, enqueue the sync unit
 * second, then opportunistically flush the queue if we happen to be online.
 */
export function useSyncQueue() {
  const saveIncident = useCallback(
    async (
      payload: Record<string, unknown>,
      operation: WriteOperation = 'create',
      baselineVersion: number | null = null,
    ) => {
      const id = (payload.id as string) ?? uuidv4()
      const now = new Date().toISOString()
      const data = { ...payload, id }

      const draft: DraftIncident = {
        id,
        entity_type: 'incident',
        operation,
        payload: data,
        status: 'pending',
        sync_attempts: 0,
        last_error: null,
        next_attempt_at: null,
        local_version: 1,
        remote_version: operation === 'update' ? baselineVersion : null,
        created_at: now,
        updated_at: now,
      }

      // 1. Save locally FIRST.
      await saveDraftIncident(draft)

      // 2. Enqueue for sync.
      await enqueueSync(createQueueItem('incident', operation, data, ENTITY_PRIORITY))

      // 3. Try to sync immediately if online (never block the caller).
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        void processQueue().catch(() => {})
      }

      return id
    },
    [],
  )

  return { saveIncident }
}
