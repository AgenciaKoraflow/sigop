import type { SupabaseClient } from '@supabase/supabase-js'
import {
  startOfDay,
  startOfMonth,
  startOfWeek,
  endOfDay,
} from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { listDraftIncidents } from '@/lib/db'
import { signPhotoUrls } from '@/lib/fotos/urls'
import type { DraftIncident } from '@/lib/db/schema'
import { PAGE_SIZE, RECORD_CONFIG, type RecordFilters, type RecordListItem } from './config'

/**
 * Data layer for the `/ocorrencias` listing screen.
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
  description: string | null
  address_street: string | null
  address_district: string | null
  address_city: string | null
  occurred_at: string
}

function rowToItem(row: ServerRow, thumbnailUrl: string | null): RecordListItem {
  return {
    id: row.id,
    internalNumber: row.internal_number ?? `OC-${shortId(row.id)}`,
    type: row.type,
    description: row.description ?? '',
    street: row.address_street,
    district: row.address_district,
    city: row.address_city,
    occurredAt: row.occurred_at,
    thumbnailUrl,
    syncStatus: null,
    isLocal: false,
    href: `${RECORD_CONFIG.detailBase}/${row.id}`,
  }
}

function draftToItem(draft: DraftIncident): RecordListItem {
  const p = draft.payload as Record<string, unknown>

  return {
    id: draft.id,
    internalNumber: (p.internal_number as string) ?? `OC-${shortId(draft.id)}`,
    type: (p.type as string) ?? 'other',
    description: (p.description as string) ?? '',
    street: (p.address_street as string | null) ?? null,
    district: (p.address_district as string | null) ?? null,
    city: (p.address_city as string | null) ?? null,
    occurredAt: (p[RECORD_CONFIG.dateColumn] as string) ?? draft.created_at,
    thumbnailUrl: null,
    syncStatus: draft.status,
    isLocal: true,
    href: `${RECORD_CONFIG.detailBase}/${draft.id}`,
  }
}

const byNewest = (a: RecordListItem, b: RecordListItem) =>
  new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()

// ---------------------------------------------------------------------------
// Local drafts
// ---------------------------------------------------------------------------
function draftMatches(item: RecordListItem, filters: RecordFilters): boolean {
  if (filters.type && item.type !== filters.type) return false

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

async function fetchDrafts(filters: RecordFilters): Promise<RecordListItem[]> {
  const drafts = await listDraftIncidents()
  return drafts
    .map((draft) => draftToItem(draft))
    .filter((item) => draftMatches(item, filters))
    .sort(byNewest)
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
async function fetchThumbnails(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (ids.length === 0) return map

  const supabase = untyped()
  const { data } = await supabase
    .from('photos')
    .select('entity_id,storage_path,sort_order')
    .eq('entity_type', 'incident')
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
  filters: RecordFilters,
): Promise<{ items: RecordListItem[]; count: number }> {
  // `.gte`/`.lte`/`.eq`/`.or` all return the same filter builder, so the
  // conditional chain can reassign; `.order`/`.range` are chained at the end.
  let query = untyped()
    .from(RECORD_CONFIG.table)
    .select(RECORD_CONFIG.selectColumns, { count: 'exact' })
    .is('deleted_at', null)

  const { from, to } = resolvePeriod(filters)
  if (from) query = query.gte(RECORD_CONFIG.dateColumn, from)
  if (to) query = query.lte(RECORD_CONFIG.dateColumn, to)
  if (filters.type) query = query.eq('type', filters.type)

  const term = sanitize(filters.search)
  if (term) {
    query = query.or(
      RECORD_CONFIG.searchColumns.map((column) => `${column}.ilike.%${term}%`).join(','),
    )
  }

  const sortColumn = RECORD_CONFIG.sortColumnMap[filters.sort.column] ?? RECORD_CONFIG.dateColumn
  const start = (filters.page - 1) * PAGE_SIZE

  const { data, count, error } = await query
    .order(sortColumn, {
      ascending: filters.sort.direction === 'asc',
      nullsFirst: false,
    })
    .range(start, start + PAGE_SIZE - 1)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as ServerRow[]
  const thumbs = await fetchThumbnails(rows.map((row) => row.id))

  return {
    items: rows.map((row) => rowToItem(row, thumbs.get(row.id) ?? null)),
    count: count ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function fetchRecordsPage(
  filters: RecordFilters,
  isOnline: boolean,
): Promise<RecordsPage> {
  const drafts = await fetchDrafts(filters)
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

  const { items: serverItems, count } = await fetchServer(filters)
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
