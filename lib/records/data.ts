import type { SupabaseClient } from '@supabase/supabase-js'
import {
  startOfDay,
  startOfMonth,
  startOfWeek,
  endOfDay,
} from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { signPhotoUrls } from '@/lib/fotos/urls'
import { PAGE_SIZE, RECORD_CONFIG, type RecordFilters, type RecordListItem } from './config'

/**
 * Data layer for the `/ocorrencias` listing screen: paginated Supabase query.
 *
 * Reads go through an untyped client on purpose — the generated `Database`
 * types collapse dynamic-table access to unusable unions here (see the
 * `supabase-typed-writes-never` note).
 */

export interface RecordsPage {
  items: RecordListItem[]
  /** Total matching rows on the server (drives pagination). */
  total: number
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
    href: `${RECORD_CONFIG.detailBase}/${row.id}`,
  }
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
export async function fetchRecordsPage(filters: RecordFilters): Promise<RecordsPage> {
  const { items, count } = await fetchServer(filters)
  return { items, total: count }
}
