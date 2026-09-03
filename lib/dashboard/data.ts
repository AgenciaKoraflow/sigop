import { createClient } from '@/lib/supabase/client'
import {
  cacheRecords,
  clearRecentCache,
  listRecentCache,
  listDraftIncidents,
  listDraftStops,
  readSetting,
  saveSetting,
} from '@/lib/db'
import type { RecentRecordCache } from '@/lib/db/schema'
import { signPhotoUrls } from '@/lib/fotos/urls'
import type { ActivityItem, DashboardData, DashboardKpis } from './types'
import { buildMockDashboard } from './mock'

const DAY_MS = 24 * 60 * 60 * 1000
const FEED_LIMIT = 40
const KPI_SETTING_KEY = 'dashboard:kpis'

const since30d = () => new Date(Date.now() - 30 * DAY_MS).toISOString()

const byNewest = (a: ActivityItem, b: ActivityItem) =>
  new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()

/** Compact, URL-safe code fragment from a UUID. */
function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 6).toUpperCase()
}

// ---------------------------------------------------------------------------
// Row shapes (only the columns we select)
// ---------------------------------------------------------------------------
interface IncidentRow {
  id: string
  internal_number: string | null
  type: string
  status: string
  address_district: string | null
  address_city: string | null
  occurred_at: string
}

interface StopRow {
  id: string
  type: string
  address_district: string | null
  address_city: string | null
  stopped_at: string
}

interface PhotoRow {
  entity_id: string
  storage_path: string | null
  sort_order: number | null
}

function incidentToItem(row: IncidentRow, thumbnailUrl: string | null): ActivityItem {
  return {
    id: row.id,
    kind: 'incident',
    internalNumber: row.internal_number ?? `OC-${shortId(row.id)}`,
    entityType: row.type,
    status: (row.status as ActivityItem['status']) ?? null,
    district: row.address_district,
    city: row.address_city,
    occurredAt: row.occurred_at,
    thumbnailUrl,
    syncStatus: null,
    href: `/ocorrencias/${row.id}`,
  }
}

function stopToItem(row: StopRow, thumbnailUrl: string | null): ActivityItem {
  return {
    id: row.id,
    kind: 'stop',
    internalNumber: `AB-${shortId(row.id)}`,
    entityType: row.type,
    status: null,
    district: row.address_district,
    city: row.address_city,
    occurredAt: row.stopped_at,
    thumbnailUrl,
    syncStatus: null,
    href: `/abordagens/${row.id}`,
  }
}

// ---------------------------------------------------------------------------
// Local drafts (offline store) merged on top of server rows
// ---------------------------------------------------------------------------
async function mergeLocalDrafts(serverItems: ActivityItem[]): Promise<ActivityItem[]> {
  const [draftIncidents, draftStops] = await Promise.all([
    listDraftIncidents(),
    listDraftStops(),
  ])

  const byId = new Map(serverItems.map((item) => [item.id, item]))

  for (const draft of draftIncidents) {
    const p = draft.payload as Record<string, unknown>
    byId.set(draft.id, {
      id: draft.id,
      kind: 'incident',
      internalNumber: (p.internal_number as string) ?? `OC-${shortId(draft.id)}`,
      entityType: (p.type as string) ?? 'other',
      status: (p.status as ActivityItem['status']) ?? 'open',
      district: (p.address_district as string | null) ?? null,
      city: (p.address_city as string | null) ?? null,
      occurredAt: (p.occurred_at as string) ?? draft.created_at,
      thumbnailUrl: null,
      syncStatus: draft.status,
      href: `/ocorrencias/${draft.id}`,
    })
  }

  for (const draft of draftStops) {
    const p = draft.payload as Record<string, unknown>
    byId.set(draft.id, {
      id: draft.id,
      kind: 'stop',
      internalNumber: `AB-${shortId(draft.id)}`,
      entityType: (p.type as string) ?? 'stop',
      status: null,
      district: (p.address_district as string | null) ?? null,
      city: (p.address_city as string | null) ?? null,
      occurredAt: (p.stopped_at as string) ?? draft.created_at,
      thumbnailUrl: null,
      syncStatus: draft.status,
      href: `/abordagens/${draft.id}`,
    })
  }

  return Array.from(byId.values()).sort(byNewest)
}

function deriveKpis(items: ActivityItem[]): DashboardKpis {
  return {
    totalIncidents: items.filter((i) => i.kind === 'incident').length,
    inProgress: items.filter((i) => i.status === 'in_progress').length,
    closed: items.filter((i) => i.status === 'closed').length,
    stops: items.filter((i) => i.kind === 'stop').length,
  }
}

// ---------------------------------------------------------------------------
// Local cache persistence
// ---------------------------------------------------------------------------
async function persistCache(
  items: ActivityItem[],
  kpis: DashboardKpis,
  generatedAt: string,
): Promise<void> {
  const records: RecentRecordCache[] = items
    .filter((item) => !item.id.startsWith('demo-'))
    .map((item) => ({
      id: item.id,
      type: item.kind,
      data: item as unknown as Record<string, unknown>,
      cached_at: generatedAt,
    }))

  await clearRecentCache()
  if (records.length > 0) await cacheRecords(records)
  await saveSetting(KPI_SETTING_KEY, { kpis, generatedAt })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Online path: Supabase via TanStack Query, then refresh the local cache. */
export async function fetchDashboardOnline(): Promise<DashboardData> {
  const supabase = createClient()
  const since = since30d()

  const [
    incidentsRes,
    stopsRes,
    totalRes,
    inProgressRes,
    closedRes,
    stopsCountRes,
  ] = await Promise.all([
    supabase
      .from('incidents')
      .select(
        'id,internal_number,type,status,address_district,address_city,occurred_at',
      )
      .is('deleted_at', null)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(FEED_LIMIT),
    supabase
      .from('stops')
      .select('id,type,address_district,address_city,stopped_at')
      .is('deleted_at', null)
      .gte('stopped_at', since)
      .order('stopped_at', { ascending: false })
      .limit(FEED_LIMIT),
    supabase
      .from('incidents')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .gte('occurred_at', since),
    supabase
      .from('incidents')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('status', 'in_progress'),
    supabase
      .from('incidents')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('status', 'closed')
      .gte('occurred_at', since),
    supabase
      .from('stops')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .gte('stopped_at', since),
  ])

  if (incidentsRes.error) throw new Error(incidentsRes.error.message)
  if (stopsRes.error) throw new Error(stopsRes.error.message)

  const incidents = (incidentsRes.data ?? []) as IncidentRow[]
  const stops = (stopsRes.data ?? []) as StopRow[]

  // First photo (lowest sort_order) per entity, for the row thumbnail.
  const entityIds = [...incidents.map((i) => i.id), ...stops.map((s) => s.id)]
  const thumbs = new Map<string, string>()
  if (entityIds.length > 0) {
    const { data: photos } = await supabase
      .from('photos')
      .select('entity_id,storage_path,sort_order')
      .in('entity_id', entityIds)
      .order('sort_order', { ascending: true })

    const rows = (photos ?? []) as PhotoRow[]
    const firstPathByEntity = new Map<string, string>()
    for (const photo of rows) {
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
      if (url) thumbs.set(entityId, url)
    })
  }

  const serverItems = [
    ...incidents.map((row) => incidentToItem(row, thumbs.get(row.id) ?? null)),
    ...stops.map((row) => stopToItem(row, thumbs.get(row.id) ?? null)),
  ]

  const items = await mergeLocalDrafts(serverItems)
  const kpis: DashboardKpis = {
    totalIncidents: totalRes.count ?? 0,
    inProgress: inProgressRes.count ?? 0,
    closed: closedRes.count ?? 0,
    stops: stopsCountRes.count ?? 0,
  }

  const hasRealData =
    items.length > 0 || kpis.totalIncidents > 0 || kpis.stops > 0

  if (!hasRealData) {
    // Empty database — show demo data so the screen is not blank.
    return buildMockDashboard()
  }

  const generatedAt = new Date().toISOString()
  await persistCache(items, kpis, generatedAt).catch(() => {})

  return { kpis, items, isDemo: false, fromCache: false, generatedAt }
}

/** Offline path: read the last snapshot from IndexedDB. */
export async function fetchDashboardOffline(): Promise<DashboardData> {
  const [cached, snapshot] = await Promise.all([
    listRecentCache(),
    readSetting(KPI_SETTING_KEY) as Promise<
      { kpis: DashboardKpis; generatedAt: string } | undefined
    >,
  ])

  const cachedItems = cached
    .map((record) => record.data as unknown as ActivityItem)
    .filter(Boolean)

  const items = await mergeLocalDrafts(cachedItems)

  if (items.length === 0 && !snapshot) {
    return { ...buildMockDashboard(), fromCache: true }
  }

  return {
    kpis: snapshot?.kpis ?? deriveKpis(items),
    items,
    isDemo: false,
    fromCache: true,
    generatedAt: snapshot?.generatedAt ?? new Date().toISOString(),
  }
}
