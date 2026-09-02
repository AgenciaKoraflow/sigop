'use client'

import Link from 'next/link'
import { AlertTriangle, CloudOff } from 'lucide-react'
import type { SyncAlertCounts } from '@/lib/dashboard/indicators'

/**
 * Two dashboard banners driven by the local sync queue:
 * pending conflicts and failed uploads. Both link to `/pendentes`.
 */
export function SyncAlertBanners({ alerts }: { alerts: SyncAlertCounts }) {
  if (alerts.conflicts === 0 && alerts.errors === 0) return null

  return (
    <div className="space-y-2">
      {alerts.conflicts > 0 && (
        <Link
          href="/pendentes"
          className="flex items-center gap-2 rounded-input border border-sync-conflict-text/20 bg-sync-conflict-bg px-3 py-2 text-xs font-medium text-sync-conflict-text hover:underline"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {alerts.conflicts}{' '}
          {alerts.conflicts === 1 ? 'conflito aguarda' : 'conflitos aguardam'} resolução
          — ver pendentes
        </Link>
      )}
      {alerts.errors > 0 && (
        <Link
          href="/pendentes"
          className="flex items-center gap-2 rounded-input border border-danger/20 bg-danger/10 px-3 py-2 text-xs font-medium text-danger hover:underline"
        >
          <CloudOff className="h-3.5 w-3.5 shrink-0" />
          {alerts.errors}{' '}
          {alerts.errors === 1 ? 'registro com falha' : 'registros com falha'} de envio
        </Link>
      )}
    </div>
  )
}
