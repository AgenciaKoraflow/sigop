'use client'

import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableRow } from '@/components/ui/table'
import { SYNC_LABELS } from '@/lib/dashboard/labels'
import type { RecordListItem, SortDirection } from '@/lib/records/config'

export function formatDateTime(iso: string): string {
  try {
    return format(new Date(iso), "dd/MM/yy 'às' HH:mm", { locale: ptBR })
  } catch {
    return '—'
  }
}

/** A row is visually flagged while it is still an unsynced local draft. */
export function isDraftRow(item: RecordListItem): boolean {
  return item.isLocal && (item.syncStatus === 'draft' || item.syncStatus === 'pending')
}

export function SortIcon({
  active,
  direction,
}: {
  active: boolean
  direction: SortDirection
}) {
  if (!active) return <ChevronsUpDown className="h-3.5 w-3.5 text-ink-muted" />
  return direction === 'asc' ? (
    <ArrowUp className="h-3.5 w-3.5" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5" />
  )
}

/** Synchronisation status badge — local drafts get an extra "Local" tag. */
export function SyncBadge({ item }: { item: RecordListItem }) {
  if (item.isLocal) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <Badge variant="draft">Local</Badge>
        {item.syncStatus && item.syncStatus !== 'draft' && (
          <Badge variant={item.syncStatus}>{SYNC_LABELS[item.syncStatus]}</Badge>
        )}
      </span>
    )
  }
  return <Badge variant="synced">{SYNC_LABELS.synced}</Badge>
}

export function TableSkeletonRow() {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell>
        <Skeleton className="h-10 w-10 rounded-full" />
      </TableCell>
      {Array.from({ length: 5 }).map((_, index) => (
        <TableCell key={index}>
          <Skeleton className="h-4 w-full max-w-[120px]" />
        </TableCell>
      ))}
      <TableCell>
        <Skeleton className="ml-auto h-4 w-12" />
      </TableCell>
    </TableRow>
  )
}
