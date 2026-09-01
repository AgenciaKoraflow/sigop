'use client'

import Link from 'next/link'
import { ImageIcon, MapPin } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils/cn'
import { typeBadgeClass, typeLabel } from '@/lib/dashboard/labels'
import type { RecordConfig, RecordListItem } from '@/lib/records/config'
import { SecondaryBadge, SyncBadge, formatDateTime, isDraftRow } from './record-ui'

interface Props {
  cfg: RecordConfig
  items: RecordListItem[]
  loading: boolean
}

export function RecordsCards({ cfg, items, loading }: Props) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-card border border-content-border bg-content-surface shadow-card"
          >
            <Skeleton className="h-40 w-full rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-card border border-content-border bg-content-surface py-16 text-center text-sm text-ink-secondary shadow-card">
        {cfg.emptyLabel}
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <Link
          key={`${item.variant}-${item.id}`}
          href={item.href}
          className={cn(
            'group overflow-hidden rounded-card border border-content-border bg-content-surface shadow-card transition-colors hover:border-brand/40',
            isDraftRow(item) && 'bg-amber-50',
          )}
        >
          <div className="relative h-40 w-full overflow-hidden bg-content-bg">
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnailUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <ImageIcon className="h-8 w-8 text-ink-muted" />
              </div>
            )}
            <span className="absolute right-2 top-2">
              <SyncBadge item={item} />
            </span>
          </div>

          <div className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="reg-number">{item.internalNumber}</span>
              <span
                className={cn(
                  'inline-flex items-center rounded-badge px-2 py-0.5 text-[11px] font-semibold',
                  typeBadgeClass(item.type),
                )}
              >
                {typeLabel(item.variant, item.type)}
              </span>
              <SecondaryBadge variant={item.variant} value={item.secondary} />
            </div>

            <p className="line-clamp-2 min-h-[2.5rem] text-sm text-ink-secondary">
              {item.description || 'Sem descrição'}
            </p>

            <div className="flex items-center gap-1 text-xs text-ink-muted">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {[item.district, item.city].filter(Boolean).join(' · ') || '—'}
              </span>
              <span aria-hidden>·</span>
              <span className="shrink-0">{formatDateTime(item.occurredAt)}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
