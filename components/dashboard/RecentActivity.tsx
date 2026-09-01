'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, ImageIcon, MapPin } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils/cn'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { ActivityItem, RangeKey } from '@/lib/dashboard/types'
import { STATUS_LABELS, SYNC_LABELS, typeBadgeClass, typeLabel } from '@/lib/dashboard/labels'

const DAY_MS = 24 * 60 * 60 * 1000

const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: 'today', label: 'Hoje', days: 0 },
  { key: '7d', label: '7 dias', days: 7 },
  { key: '30d', label: '30 dias', days: 30 },
]

function cutoffFor(range: RangeKey): number {
  if (range === 'today') {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }
  const cfg = RANGES.find((r) => r.key === range)!
  return Date.now() - cfg.days * DAY_MS
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const place =
    [item.district, item.city].filter(Boolean).join(' · ') || 'Local não informado'
  const relative = formatDistanceToNow(new Date(item.occurredAt), {
    addSuffix: true,
    locale: ptBR,
  })

  return (
    <Link
      href={item.href}
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-content-bg"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-icon border border-content-border bg-content-bg">
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
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="reg-number">{item.internalNumber}</span>
          <span
            className={cn(
              'inline-flex items-center rounded-badge px-2 py-0.5 text-[11px] font-semibold',
              typeBadgeClass(item.entityType),
            )}
          >
            {typeLabel(item.kind, item.entityType)}
          </span>
          {item.status && (
            <Badge variant={item.status}>{STATUS_LABELS[item.status]}</Badge>
          )}
          {item.syncStatus && (
            <Badge variant={item.syncStatus}>{SYNC_LABELS[item.syncStatus]}</Badge>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1 text-xs text-ink-secondary">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{place}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{relative}</span>
        </div>
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted transition-colors group-hover:text-ink-secondary" />
    </Link>
  )
}

export function RecentActivity({
  items,
  loading,
}: {
  items: ActivityItem[]
  loading: boolean
}) {
  const [range, setRange] = useState<RangeKey>('today')

  const filtered = useMemo(() => {
    const cutoff = cutoffFor(range)
    return items
      .filter((item) => new Date(item.occurredAt).getTime() >= cutoff)
      .sort(
        (a, b) =>
          new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      )
  }, [items, range])

  return (
    <section className="rounded-card border border-content-border bg-content-surface shadow-card">
      <header className="flex flex-col gap-3 border-b border-content-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[15px] font-semibold text-ink">Atividade recente</h2>
        <div className="flex gap-1 rounded-input bg-content-bg p-1">
          {RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setRange(option.key)}
              aria-pressed={range === option.key}
              className={cn(
                'rounded-[6px] px-3 py-1 text-xs font-medium transition-colors',
                range === option.key
                  ? 'bg-content-surface text-ink shadow-sm'
                  : 'text-ink-secondary hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <ul className="divide-y divide-content-border">
          {Array.from({ length: 4 }).map((_, index) => (
            <li key={index} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-10 w-10 rounded-icon" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-44" />
                <Skeleton className="h-3 w-28" />
              </div>
            </li>
          ))}
        </ul>
      ) : filtered.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-ink-secondary">
          Nenhum registro no período selecionado.
        </p>
      ) : (
        <ul className="divide-y divide-content-border">
          {filtered.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <ActivityRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
