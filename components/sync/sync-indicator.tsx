'use client'

import Link from 'next/link'
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useOnlineStatus } from '@/hooks/use-online-status'

const records = (n: number) => (n === 1 ? 'registro' : 'registros')

/**
 * Fixed 36px status bar for the authenticated layout.
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
    tone = 'bg-amber-900/20 text-amber-400'
    icon = <WifiOff className="h-4 w-4 animate-pulse" />
    message = 'Sem internet — seus dados serão sincronizados quando a conexão voltar'
  } else if (status === 'syncing') {
    tone = 'bg-blue-900/20 text-blue-400'
    icon = <RefreshCw className="h-4 w-4 animate-spin" />
    message = `Sincronizando ${pendingCount} ${records(pendingCount)}...`
  } else if (status === 'error') {
    tone = 'bg-red-900/20 text-red-400'
    icon = <AlertTriangle className="h-4 w-4" />
    message = (
      <Link href="/pendentes" className="underline underline-offset-2">
        {stats.errors} {records(stats.errors)} com falha — ver pendentes
      </Link>
    )
  } else {
    // Online with a non-empty queue.
    tone = 'bg-slate-800/40 text-slate-200'
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
        'fixed inset-x-0 top-0 z-50 flex h-9 items-center justify-center gap-2 px-4 text-xs font-medium',
        tone,
      )}
    >
      {icon}
      <span>{message}</span>
      {showSyncButton && (
        <button
          type="button"
          onClick={() => void syncNow()}
          className="ml-2 rounded bg-white/10 px-2 py-0.5 font-medium transition-colors hover:bg-white/20"
        >
          Sincronizar agora
        </button>
      )}
    </div>
  )
}
