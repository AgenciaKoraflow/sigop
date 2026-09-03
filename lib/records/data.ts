import type { SupabaseClient } from '@supabase/supabase-js'
import {
  startOfDay,
  startOfMonth,
  startOfWeek,
  endOfDay,
} from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { listDraftIncidents, listDraftStops } from '@/lib/db'
import { signPhotoUrls } from '@/lib/fotos/urls'
import type { DraftIncident, DraftStop } from '@/lib/db/schema'
import {
  PAGE_SIZE,
  RECORD_CONFIG,
  type RecordFilters,
  type RecordListItem,
  type RecordVariant,
} from './config'

/**
 * Data layer for the operational listing screens.
 *
 * Online: paginated Supabase query merged, on page 1, with the local drafts
 * still sitting in IndexedDB (which always surface, pinned to the top).
 * Offline: only the local drafts.
 *
 * Reads go through an untyped client on purpose — the generated `Database`
 * types collapse dynamic-table access to unusable unions here, the same reason
 * the sync engine is untyped.
 */

export interface RecordsPage {
  items: RecordListItem[]
  /** Total matching rows on the server (drives pagination). */
  serverCount: number
  /** Local drafts matching the current filters. */
  localCount: number
  /** `serverCount + localCount` — the header counter. */
  total: number
  fromCache: boolean
}

function untyped(): SupabaseClient {
  return createClient() as unknown as SupabaseClient
}

/** Compact, URL-safe code fragment from a UUID. */
function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 6).toUpperCase()
}

/** Strip characters that would break a PostgREST `or` filter. */
function sanitize(term: string): string {
  return term
    .trim()
    .replace(/[%,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolvePeriod(filters: RecordFilters): { from?: string; to?: string } {
  const now = new Date()
  switch (filters.period) {
    case 'today':
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() }
    case 'week':
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }).toISOString(),
        to: endOfDay(now).toISOString(),
      }
    case 'month':
      return { from: startOfMonth(now).toISOString(), to: endOfDay(now).toISOString() }
    case 'custom':
      return {
        from: filters.customFrom
          ? startOfDay(new Date(filters.customFrom)).toISOString()
          : undefined,
        to: filters.customTo
          ? endOfDay(new Date(filters.customTo)).toISOString()
          : undefined,
      }
    default:
      return {}
  }
}

// ---------------------------------------------------------------------------
// Row / draft → RecordListItem
// ---------------------------------------------------------------------------
interface ServerRow {
  id: string
  internal_number?: string | null
  type: string
  status?: string | null
  outcome?: string | null
  description: string | null
  address_district: string | null
  address_city: string | null
  occurred_at?: string
  stopped_at?: string
}

function rowToItem(
  variant: RecordVariant,
  row: ServerRow,
  thumbnailUrl: string | null,
): RecordListItem {
  const cfg = RECORD_CONFIG[variant]
  const occurredAt =
    (variant === 'incident' ? row.occurred_at : row.stopped_at) ??
    new Date().toISOString()

  return {
    id: row.id,
    variant,
    internalNumber: cfg.hasInternalNumber
      ? row.internal_number ?? `OC-${shortId(row.id)}`
      : `AB-${shortId(row.id)}`,
    type: row.type,
    secondary: variant === 'incident' ? row.status ?? null : row.outcome ?? null,
    description: row.description ?? '',
    district: row.address_district,
    city: row.address_city,
    occurredAt,
    thumbnailUrl,
    syncStatus: null,
    isLocal: false,
    href: `${cfg.detailBase}/${row.id}`,
  }
}

function draftToItem(
  variant: RecordVariant,
  draft: DraftIncident | DraftStop,
): RecordListItem {
  const cfg = RECORD_CONFIG[variant]
  const p = draft.payload as Record<string, unknown>

  return {
    id: draft.id,
    variant,
    internalNumber: cfg.hasInternalNumber
      ? (p.internal_number as string) ?? `OC-${shortId(draft.id)}`
      : `AB-${shortId(draft.id)}`,
    type: (p.type as string) ?? 'other',
    secondary: (p[cfg.secondaryColumn] as string) ?? null,
    description: (p.description as string) ?? '',
    district: (p.address_district as string | null) ?? null,
    city: (p.address_city as string | null) ?? null,
    occurredAt: (p[cfg.dateColumn] as string) ?? draft.created_at,
    thumbnailUrl: null,
    syncStatus: draft.status,
    isLocal: true,
    href: `${cfg.detailBase}/${draft.id}`,
  }
}

const byNewest = (a: RecordListItem, b: RecordListItem) =>
  new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()

// ---------------------------------------------------------------------------
// Local drafts
// ---------------------------------------------------------------------------
function draftMatches(item: RecordListItem, filters: RecordFilters): boolean {
  if (filters.type && item.type !== filters.type) return false
  if (filters.secondary && item.secondary !== filters.secondary) return false

  const { from, to } = resolvePeriod(filters)
  const t = new Date(item.occurredAt).getTime()
  if (from && t < new Date(from).getTime()) return false
  if (to && t > new Date(to).getTime()) return false

  const term = sanitize(filters.search).toLowerCase()
  if (term) {
    const haystack = [item.internalNumber, item.description, item.district]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (!haystack.includes(term)) return false
  }
  return true
}

async function fetchDrafts(
  variant: RecordVariant,
  filters: RecordFilters,
): Promise<RecordListItem[]> {
  const drafts =
    variant === 'incident' ? await listDraftIncidents() : await listDraftStops()
  return drafts
    .map((draft) => draftToItem(variant, draft))
    .filter((item) => draftMatches(item, filters))
    .sort(byNewest)
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
async function fetchThumbnails(
  variant: RecordVariant,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (ids.length === 0) return map

  const supabase = untyped()
  const { data } = await supabase
    .from('photos')
    .select('entity_id,storage_path,sort_order')
    .eq('entity_type', variant)
    .in('entity_id', ids)
    .order('sort_order', { ascending: true })

  const firstPathByEntity = new Map<string, string>()
  for (const photo of (data ?? []) as {
    entity_id: string
    storage_path: string | null
  }[]) {
    if (photo.storage_path && !firstPathByEntity.has(photo.entity_id)) {
      firstPathByEntity.set(photo.entity_id, photo.storage_path)
    }
  }

  const signedUrls = await signPhotoUrls(
    supabase,
    Array.from(firstPathByEntity.values()),
  )
  firstPathByEntity.forEach((path, entityId) => {
    const url = signedUrls.get(path)
    if (url) map.set(entityId, url)
  })
  return map
}

async function fetchServer(
  variant: RecordVariant,
  filters: RecordFilters,
): Promise<{ items: RecordListItem[]; count: number }> {
  const cfg = RECORD_CONFIG[variant]

  // `.gte`/`.lte`/`.eq`/`.or` all return the same filter builder, so the
  // conditional chain can reassign; `.order`/`.range` are chained at the end.
  let query = untyped()
    .from(cfg.table)
    .select(cfg.selectColumns, { count: 'exact' })
    .is('deleted_at', null)

  const { from, to } = resolvePeriod(filters)
  if (from) query = query.gte(cfg.dateColumn, from)
  if (to) query = query.lte(cfg.dateColumn, to)
  if (filters.type) query = query.eq('type', filters.type)
  if (filters.secondary) query = query.eq(cfg.secondaryColumn, filters.secondary)

  const term = sanitize(filters.search)
  if (term) {
    query = query.or(
      cfg.searchColumns.map((column) => `${column}.ilike.%${term}%`).join(','),
    )
  }

  const sortColumn = cfg.sortColumnMap[filters.sort.column] ?? cfg.dateColumn
  const start = (filters.page - 1) * PAGE_SIZE

  const { data, count, error } = await query
    .order(sortColumn, {
      ascending: filters.sort.direction === 'asc',
      nullsFirst: false,
    })
    .range(start, start + PAGE_SIZE - 1)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as ServerRow[]
  const thumbs = await fetchThumbnails(
    variant,
    rows.map((row) => row.id),
  )

  return {
    items: rows.map((row) => rowToItem(variant, row, thumbs.get(row.id) ?? null)),
    count: count ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function fetchRecordsPage(
  variant: RecordVariant,
  filters: RecordFilters,
  isOnline: boolean,
): Promise<RecordsPage> {
  const drafts = await fetchDrafts(variant, filters)
  const draftsForPage = filters.page === 1 ? drafts : []

  if (!isOnline) {
    return {
      items: draftsForPage,
      serverCount: 0,
      localCount: drafts.length,
      total: drafts.length,
      fromCache: true,
    }
  }

  const { items: serverItems, count } = await fetchServer(variant, filters)
  const draftIds = new Set(drafts.map((draft) => draft.id))
  const serverOnly = serverItems.filter((item) => !draftIds.has(item.id))

  return {
    items: [...draftsForPage, ...serverOnly],
    serverCount: count,
    localCount: drafts.length,
    total: count + drafts.length,
    fromCache: false,
  }
}
