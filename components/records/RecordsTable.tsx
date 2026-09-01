'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, ImageIcon, Pencil } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils/cn'
import { typeBadgeClass, typeLabel } from '@/lib/dashboard/labels'
import type {
  RecordConfig,
  RecordFilters,
  RecordListItem,
  SortColumn,
} from '@/lib/records/config'
import {
  SecondaryBadge,
  SortIcon,
  SyncBadge,
  TableSkeletonRow,
  formatDateTime,
  isDraftRow,
} from './record-ui'

interface Props {
  cfg: RecordConfig
  items: RecordListItem[]
  loading: boolean
  sort: RecordFilters['sort']
  onToggleSort: (column: SortColumn) => void
}

export function RecordsTable({ cfg, items, loading, sort, onToggleSort }: Props) {
  const router = useRouter()

  const columns: { key: SortColumn | null; label: string; align?: 'right' }[] = [
    { key: null, label: 'Foto' },
    { key: cfg.hasInternalNumber ? 'internalNumber' : null, label: 'Número interno' },
    { key: 'type', label: 'Tipo' },
    { key: 'secondary', label: cfg.secondaryFilterLabel },
    { key: 'date', label: 'Data e hora' },
    { key: 'address', label: 'Endereço' },
    { key: null, label: 'Sync' },
    { key: null, label: 'Ações', align: 'right' },
  ]

  return (
    <div className="overflow-hidden rounded-card border border-content-border bg-content-surface shadow-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column, index) => (
              <TableHead
                key={index}
                className={cn('text-xs', column.align === 'right' && 'text-right')}
              >
                {column.key ? (
                  <button
                    type="button"
                    onClick={() => onToggleSort(column.key as SortColumn)}
                    className="inline-flex items-center gap-1 font-medium transition-colors hover:text-ink"
                  >
                    {column.label}
                    <SortIcon
                      active={sort.column === column.key}
                      direction={sort.direction}
                    />
                  </button>
                ) : (
                  column.label
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {loading ? (
            Array.from({ length: 8 }).map((_, index) => (
              <TableSkeletonRow key={index} />
            ))
          ) : items.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="py-16 text-center text-sm text-ink-secondary"
              >
                {cfg.emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <RecordRow
                key={`${item.variant}-${item.id}`}
                item={item}
                onOpen={() => router.push(item.href)}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function RecordRow({
  item,
  onOpen,
}: {
  item: RecordListItem
  onOpen: () => void
}) {
  const place =
    [item.district, item.city].filter(Boolean).join(' · ') || '—'

  return (
    <TableRow
      onClick={onOpen}
      className={cn(
        'cursor-pointer',
        isDraftRow(item) && 'bg-amber-50 hover:bg-amber-100/60',
      )}
    >
      <TableCell>
        <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-content-border bg-content-bg">
          {item.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageIcon className="h-4 w-4 text-ink-muted" />
          )}
        </span>
      </TableCell>

      <TableCell>
        <Link
          href={item.href}
          onClick={(event) => event.stopPropagation()}
          className="reg-number hover:underline"
        >
          {item.internalNumber}
        </Link>
      </TableCell>

      <TableCell>
        <span
          className={cn(
            'inline-flex items-center rounded-badge px-2 py-0.5 text-[11px] font-semibold',
            typeBadgeClass(item.type),
          )}
        >
          {typeLabel(item.variant, item.type)}
        </span>
      </TableCell>

      <TableCell>
        <SecondaryBadge variant={item.variant} value={item.secondary} />
      </TableCell>

      <TableCell className="whitespace-nowrap text-sm text-ink-secondary">
        {formatDateTime(item.occurredAt)}
      </TableCell>

      <TableCell className="max-w-[220px] truncate text-sm text-ink-secondary">
        {place}
      </TableCell>

      <TableCell>
        <SyncBadge item={item} />
      </TableCell>

      <TableCell className="text-right">
        <div
          className="inline-flex items-center gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          <Link
            href={item.href}
            title="Ver detalhe"
            className="rounded p-1.5 text-ink-muted transition-colors hover:bg-content-bg hover:text-ink"
          >
            <Eye className="h-4 w-4" />
          </Link>
          <Link
            href={`${item.href}/editar`}
            title="Editar"
            className="rounded p-1.5 text-ink-muted transition-colors hover:bg-content-bg hover:text-ink"
          >
            <Pencil className="h-4 w-4" />
          </Link>
        </div>
      </TableCell>
    </TableRow>
  )
}
