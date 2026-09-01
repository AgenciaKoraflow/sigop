'use client'

import Link from 'next/link'
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useOnlineStatus } from '@/hooks/use-online-status'

const records = (n: number) => (n === 1 ? 'registro' : 'registros')

/**
 * 36px status bar that sits directly below the topbar in the authenticated
 * layout (sticky, so it stays visible while the content scrolls).
 *
 * Hidden entirely while online with an empty queue; otherwise it reflects the
 * connection / sync state and offers a manual "Sincronizar agora" action.
 */
export function SyncIndicator() {
  const { status, stats, syncNow } = useOnlineStatus()

  const pendingCount = stats.pending + stats.photos
  const hasPending = pendingCount > 0

  // Online and nothing queued: render nothing.
  if (
    (status === 'online' || status === 'syncing') &&
    !hasPending &&
    stats.errors === 0
  ) {
    return null
  }

  let tone: string
  let icon: React.ReactNode
  let message: React.ReactNode

  if (status === 'offline') {
    tone = 'bg-sync-pending-bg text-sync-pending-text'
    icon = <WifiOff className="h-4 w-4 animate-pulse" />
    message = 'Sem internet — seus dados serão sincronizados quando a conexão voltar'
  } else if (status === 'syncing') {
    tone = 'bg-sync-syncing-bg text-sync-syncing-text'
    icon = <RefreshCw className="h-4 w-4 animate-spin" />
    message = `Sincronizando ${pendingCount} ${records(pendingCount)}...`
  } else if (status === 'error') {
    tone = 'bg-sync-error-bg text-sync-error-text'
    icon = <AlertTriangle className="h-4 w-4" />
    message = (
      <Link href="/pendentes" className="underline underline-offset-2">
        {stats.errors} {records(stats.errors)} com falha — ver pendentes
      </Link>
    )
  } else {
    // Online with a non-empty queue.
    tone = 'bg-sync-draft-bg text-sync-draft-text'
    icon = <RefreshCw className="h-4 w-4" />
    message = `${pendingCount} ${records(pendingCount)} aguardando sincronização`
  }

  const showSyncButton =
    hasPending && status !== 'offline' && status !== 'syncing'

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'sticky top-topbar z-[9] flex h-9 items-center justify-center gap-2 border-b border-content-border px-4 text-xs font-medium',
        tone,
      )}
    >
      {icon}
      <span>{message}</span>
      {showSyncButton && (
        <button
          type="button"
          onClick={() => void syncNow()}
          className="ml-2 rounded bg-black/5 px-2 py-0.5 font-medium transition-colors hover:bg-black/10"
        >
          Sincronizar agora
        </button>
      )}
    </div>
  )
}
