'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CloudOff,
  FileText,
  ImageIcon,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCw,
  Trash2,
  UserRound,
  Users,
  Zap,
} from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import {
  resetAllBackoff,
  retryQueueItemNow,
  retryPendingPhotoNow,
} from '@/lib/db'
import { processQueue } from '@/lib/sync/queue'
import {
  discardPendingItem,
  loadPendingSnapshot,
  resolveConflictKeepLocal,
  resolveConflictUseServer,
  type ConflictView,
  type PendingGroupKey,
  type PendingItemView,
} from '@/lib/sync/pendentes'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { usePermissions } from '@/hooks/use-permissions'
import { useCurrentUser } from '@/hooks/use-current-user'
import { useToast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// ---------------------------------------------------------------------------
// Static maps
// ---------------------------------------------------------------------------
const POLL_INTERVAL_MS = 5000

const GROUP_ICON: Record<PendingGroupKey, React.ComponentType<{ className?: string }>> = {
  incident: FileText,
  stop: UserRound,
  offender: Users,
  link: Link2,
  photo: ImageIcon,
}

const GROUP_ITEM_LABEL: Record<PendingGroupKey, string> = {
  incident: 'Ocorrência',
  stop: 'Abordagem',
  offender: 'Meliante',
  link: 'Vínculo',
  photo: 'Foto',
}

const OPERATION_LABEL: Record<string, string> = {
  create: 'Criando',
  update: 'Atualizando',
  delete: 'Removendo',
  upload: 'Enviando',
}

const STATUS_BADGE: Record<
  string,
  { label: string; variant: 'pending' | 'syncing' | 'error' | 'conflict' | 'draft' }
> = {
  draft: { label: 'Rascunho', variant: 'draft' },
  pending: { label: 'Pendente', variant: 'pending' },
  syncing: { label: 'Sincronizando', variant: 'syncing' },
  error: { label: 'Erro', variant: 'error' },
  conflict: { label: 'Conflito', variant: 'conflict' },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
  } catch {
    return '—'
  }
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'nunca'
  try {
    return formatDistanceToNow(new Date(iso), { locale: ptBR, addSuffix: true })
  } catch {
    return '—'
  }
}

/** "próxima em Xmin" copy from an ISO backoff timestamp in the future. */
function backoffLabel(nextAttemptAt: string | null): string | null {
  if (!nextAttemptAt) return null
  const delta = new Date(nextAttemptAt).getTime() - Date.now()
  if (delta <= 0) return null
  const minutes = Math.round(delta / 60000)
  if (minutes >= 1) return `próxima em ${minutes} min`
  return `próxima em ${Math.max(1, Math.round(delta / 1000))} s`
}

function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

// ===========================================================================
// Component
// ===========================================================================
export function TelaPendentes() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { isOnline, syncNow } = useOnlineStatus()
  const perms = usePermissions()
  const { user } = useCurrentUser()

  const [syncing, setSyncing] = React.useState(false)
  const [resettingBackoff, setResettingBackoff] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState<Partial<Record<PendingGroupKey, boolean>>>({})
  const [pendingDiscard, setPendingDiscard] = React.useState<PendingItemView | null>(null)
  const [discarding, setDiscarding] = React.useState(false)
  const [resolvingConflictId, setResolvingConflictId] = React.useState<string | null>(null)

  const queryKey = React.useMemo(() => ['pending-snapshot', isOnline] as const, [isOnline])

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => loadPendingSnapshot(isOnline),
    refetchInterval: POLL_INTERVAL_MS,
  })

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['pending-snapshot'] })
  }, [queryClient])

  // ---------------------------------------------------------------------
  // Header actions
  // ---------------------------------------------------------------------
  const handleSyncNow = React.useCallback(async () => {
    if (!isOnline) {
      toast({ title: 'Sem conexão', description: 'Conecte-se para sincronizar.', variant: 'destructive' })
      return
    }
    setSyncing(true)
    try {
      await syncNow()
      toast({ title: 'Sincronização concluída' })
    } catch {
      toast({ title: 'Falha na sincronização', variant: 'destructive' })
    } finally {
      setSyncing(false)
      refresh()
    }
  }, [isOnline, syncNow, toast, refresh])

  const handleResetBackoff = React.useCallback(async () => {
    setResettingBackoff(true)
    try {
      await resetAllBackoff()
      toast({
        title: 'Backoff redefinido',
        description: 'Todos os itens com erro serão tentados novamente.',
      })
      if (isOnline) void processQueue().catch(() => {})
    } catch {
      toast({ title: 'Não foi possível redefinir', variant: 'destructive' })
    } finally {
      setResettingBackoff(false)
      refresh()
    }
  }, [isOnline, toast, refresh])

  // ---------------------------------------------------------------------
  // Item actions
  // ---------------------------------------------------------------------
  const handleRetryItem = React.useCallback(
    async (item: PendingItemView) => {
      try {
        if (item.kind === 'photo') await retryPendingPhotoNow(item.id)
        else await retryQueueItemNow(item.id)
        if (isOnline) await processQueue()
        toast({ title: 'Tentando novamente…' })
      } catch {
        toast({ title: 'Falha ao tentar novamente', variant: 'destructive' })
      } finally {
        refresh()
      }
    },
    [isOnline, toast, refresh],
  )

  const confirmDiscard = React.useCallback(async () => {
    if (!pendingDiscard) return
    setDiscarding(true)
    try {
      await discardPendingItem(pendingDiscard)
      toast({ title: 'Rascunho local descartado' })
      setPendingDiscard(null)
    } catch {
      toast({ title: 'Não foi possível descartar', variant: 'destructive' })
    } finally {
      setDiscarding(false)
      refresh()
    }
  }, [pendingDiscard, toast, refresh])

  // ---------------------------------------------------------------------
  // Conflict actions
  // ---------------------------------------------------------------------
  const handleResolveConflict = React.useCallback(
    async (conflict: ConflictView, keepLocal: boolean) => {
      setResolvingConflictId(conflict.id)
      try {
        if (keepLocal) await resolveConflictKeepLocal(conflict, user?.id ?? null)
        else await resolveConflictUseServer(conflict, user?.id ?? null)
        toast({
          title: keepLocal ? 'Versão local mantida' : 'Versão do servidor aplicada',
          description: 'Decisão registrada na auditoria.',
        })
      } catch (error) {
        toast({
          title: 'Não foi possível resolver o conflito',
          description: error instanceof Error ? error.message : 'Tente novamente.',
          variant: 'destructive',
        })
      } finally {
        setResolvingConflictId(null)
        refresh()
      }
    },
    [user?.id, toast, refresh],
  )

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-4xl items-center justify-center py-20 text-ink-secondary">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando fila de sincronização…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-4xl rounded-card border border-content-border bg-white p-8 text-center">
        <p className="text-lg font-semibold text-ink">Não foi possível ler a fila local</p>
        <p className="mt-1 text-sm text-ink-secondary">
          O armazenamento offline (IndexedDB) pode estar indisponível neste navegador.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => void refetch()}>
          Tentar novamente
        </Button>
      </div>
    )
  }

  const { counts, groups, conflicts, lastSuccessfulSync, isEmpty } = data
  const isSyncing = syncing

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-16">
      {/* HEADER --------------------------------------------------------- */}
      <header className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Sincronização</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Itens aguardando envio ao servidor
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <CountCard
            label={counts.pending === 1 ? 'item pendente' : 'itens pendentes'}
            value={counts.pending}
            tone="pending"
          />
          <CountCard
            label={counts.errors === 1 ? 'com erro' : 'com erro'}
            value={counts.errors}
            tone="error"
          />
          <CountCard
            label={counts.photos === 1 ? 'foto pendente' : 'fotos pendentes'}
            value={counts.photos}
            tone="photo"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-ink-muted">
            <CheckCircle2 className="h-3.5 w-3.5 text-sync-synced-text" />
            Última sincronização bem-sucedida:{' '}
            <span className="font-medium text-ink-secondary">
              {lastSuccessfulSync
                ? `${fmtDateTime(lastSuccessfulSync)} (${fmtRelative(lastSuccessfulSync)})`
                : 'nunca'}
            </span>
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleResetBackoff()}
              disabled={resettingBackoff || counts.errors === 0}
            >
              <RotateCw className={cn('h-4 w-4', resettingBackoff && 'animate-spin')} />
              Tentar novamente
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSyncNow()}
              disabled={isSyncing || !isOnline}
            >
              <RefreshCw className={cn('h-4 w-4', isSyncing && 'animate-spin')} />
              Sincronizar agora
            </Button>
          </div>
        </div>

        {!isOnline && (
          <p className="flex items-center gap-1.5 rounded-input bg-sync-pending-bg px-3 py-2 text-xs font-medium text-sync-pending-text">
            <CloudOff className="h-4 w-4" />
            Sem conexão — a sincronização será retomada automaticamente quando a internet voltar.
          </p>
        )}
      </header>

      {/* EMPTY STATE -------------------------------------------------- */}
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-content-border bg-white py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sync-synced-bg">
            <CheckCircle2 className="h-8 w-8 text-sync-synced-text" />
          </div>
          <p className="mt-4 text-lg font-semibold text-ink">Tudo sincronizado!</p>
          <p className="mt-1 max-w-sm text-sm text-ink-secondary">
            Não há ocorrências, abordagens ou fotos aguardando envio ao servidor.
          </p>
        </div>
      ) : (
        <>
          {/* CONFLICTS ---------------------------------------------- */}
          {conflicts.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
                <Zap className="h-5 w-5 text-sync-conflict-text" />
                Conflitos de edição
                <Badge variant="conflict">{conflicts.length}</Badge>
              </h2>
              <div className="space-y-4">
                {conflicts.map((conflict) => (
                  <ConflictCard
                    key={conflict.id}
                    conflict={conflict}
                    canResolve={perms.canResolveConflicts}
                    resolving={resolvingConflictId === conflict.id}
                    onKeepLocal={() => void handleResolveConflict(conflict, true)}
                    onUseServer={() => void handleResolveConflict(conflict, false)}
                  />
                ))}
              </div>
              <Separator />
            </section>
          )}

          {/* PENDING GROUPS --------------------------------------- */}
          {groups.map((group) => {
            const Icon = GROUP_ICON[group.key]
            const isCollapsed = collapsed[group.key] ?? false
            return (
              <section key={group.key} className="space-y-3">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((current) => ({
                      ...current,
                      [group.key]: !isCollapsed,
                    }))
                  }
                  className="flex w-full items-center gap-2 text-left"
                >
                  <Icon className="h-4 w-4 text-ink-muted" />
                  <h2 className="text-lg font-semibold text-ink">
                    {group.label}{' '}
                    <span className="text-sm font-normal text-ink-muted">
                      ({group.items.length})
                    </span>
                  </h2>
                  <ChevronDown
                    className={cn(
                      'ml-auto h-4 w-4 text-ink-muted transition-transform',
                      isCollapsed && '-rotate-90',
                    )}
                  />
                </button>

                {!isCollapsed && (
                  <ul className="space-y-2">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <PendingItemCard
                          item={item}
                          onRetry={() => void handleRetryItem(item)}
                          onDiscard={() => setPendingDiscard(item)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </>
      )}

      {/* DISCARD CONFIRMATION ----------------------------------------- */}
      <Dialog
        open={pendingDiscard !== null}
        onOpenChange={(open) => !open && setPendingDiscard(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Tem certeza?</DialogTitle>
            <DialogDescription>
              Esta ação removerá o rascunho local permanentemente e não poderá ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDiscard(null)}
              disabled={discarding}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDiscard()}
              disabled={discarding}
            >
              {discarding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ===========================================================================
// Presentational pieces
// ===========================================================================
function CountCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'pending' | 'error' | 'photo'
}) {
  const toneClass =
    tone === 'error'
      ? 'bg-sync-error-bg text-sync-error-text'
      : tone === 'photo'
        ? 'bg-sync-syncing-bg text-sync-syncing-text'
        : 'bg-sync-pending-bg text-sync-pending-text'

  return (
    <div className={cn('rounded-card border border-content-border bg-white p-4')}>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold',
            toneClass,
          )}
        >
          {value}
        </span>
        <span className="text-sm font-medium text-ink-secondary">{label}</span>
      </div>
    </div>
  )
}

function PendingItemCard({
  item,
  onRetry,
  onDiscard,
}: {
  item: PendingItemView
  onRetry: () => void
  onDiscard: () => void
}) {
  const Icon = GROUP_ICON[item.kind]
  const status = STATUS_BADGE[item.status] ?? STATUS_BADGE.pending
  const backoff = backoffLabel(item.nextAttemptAt)
  const showProgress = item.kind === 'photo' && item.progress !== null

  return (
    <div className="rounded-card border border-content-border bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-ink-muted" />
        <span className="text-sm font-medium text-ink">{GROUP_ITEM_LABEL[item.kind]}</span>
        <code className="rounded bg-content-bg px-1.5 py-0.5 font-mono text-xs text-ink-secondary">
          {shortId(item.id)}
        </code>
        <Badge variant="secondary">{OPERATION_LABEL[item.operation] ?? item.operation}</Badge>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      {(item.attempts > 0 || backoff) && (
        <p className="mt-2 text-xs text-ink-muted">
          {item.attempts} {item.attempts === 1 ? 'tentativa' : 'tentativas'}
          {backoff ? ` — ${backoff}` : ''}
        </p>
      )}

      {item.status === 'error' && item.lastError && (
        <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-sync-error-text">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {item.lastError}
        </p>
      )}

      {showProgress && (
        <Progress value={item.progress ?? 0} className="mt-3 h-1.5" />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {item.editHref && (
          <Button asChild variant="outline" size="sm">
            <Link href={item.editHref}>
              <Pencil className="h-3.5 w-3.5" />
              Editar
            </Link>
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          Tentar agora
        </Button>
        <Button variant="ghost" size="sm" onClick={onDiscard} className="text-sync-error-text">
          <Trash2 className="h-3.5 w-3.5" />
          Descartar
        </Button>
      </div>
    </div>
  )
}

function ConflictCard({
  conflict,
  canResolve,
  resolving,
  onKeepLocal,
  onUseServer,
}: {
  conflict: ConflictView
  canResolve: boolean
  resolving: boolean
  onKeepLocal: () => void
  onUseServer: () => void
}) {
  const changedFields = new Set(conflict.diffs.map((diff) => diff.field))
  const allFields = conflict.diffs.length > 0 ? conflict.diffs : []

  return (
    <div className="rounded-card border border-sync-conflict-bg bg-white p-4">
      <p className="text-sm font-semibold text-ink">{conflict.title}</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        Detectado {fmtRelative(conflict.detectedAt)} · versão local v{conflict.localVersion} ·
        versão do servidor v{conflict.remoteVersion}
      </p>

      {allFields.length === 0 ? (
        <p className="mt-3 text-xs text-ink-secondary">
          O servidor tem uma versão mais recente, mas os campos coincidem.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ConflictColumn
            title="Versão local"
            className="border-amber-200 bg-amber-50"
            diffs={allFields}
            side="local"
            changedFields={changedFields}
          />
          <ConflictColumn
            title="Versão do servidor"
            className="border-blue-200 bg-blue-50"
            diffs={allFields}
            side="remote"
            changedFields={changedFields}
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {canResolve ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onKeepLocal}
              disabled={resolving}
              className="border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
            >
              {resolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Manter versão local
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onUseServer}
              disabled={resolving}
              className="border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100"
            >
              {resolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Usar versão do servidor
            </Button>
          </>
        ) : (
          <p className="text-xs text-ink-muted">
            Apenas supervisores e administradores podem resolver conflitos.
          </p>
        )}
      </div>
    </div>
  )
}

function ConflictColumn({
  title,
  className,
  diffs,
  side,
  changedFields,
}: {
  title: string
  className: string
  diffs: ConflictView['diffs']
  side: 'local' | 'remote'
  changedFields: Set<string>
}) {
  return (
    <div className={cn('rounded-input border p-3', className)}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
        {title}
      </p>
      <dl className="space-y-2">
        {diffs.map((diff) => (
          <div key={diff.field}>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              {diff.label}
            </dt>
            <dd
              className={cn(
                'mt-0.5 whitespace-pre-wrap break-words text-xs text-ink',
                changedFields.has(diff.field) && 'rounded bg-yellow-200/70 px-1 py-0.5',
              )}
            >
              {side === 'local' ? diff.local : diff.remote}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
