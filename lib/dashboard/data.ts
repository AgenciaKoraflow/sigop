import { createClient } from '@/lib/supabase/client'
import { signPhotoUrls } from '@/lib/fotos/urls'
import type { ActivityItem, DashboardData } from './types'
import { buildMockDashboard } from './mock'

const DAY_MS = 24 * 60 * 60 * 1000
const FEED_LIMIT = 40

const since30d = () => new Date(Date.now() - 30 * DAY_MS).toISOString()

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
  address_street: string | null
  address_district: string | null
  address_city: string | null
  occurred_at: string
}

interface PhotoRow {
  entity_id: string
  storage_path: string | null
  sort_order: number | null
}

function incidentToItem(row: IncidentRow, thumbnailUrl: string | null): ActivityItem {
  return {
    id: row.id,
    internalNumber: row.internal_number ?? `OC-${shortId(row.id)}`,
    entityType: row.type,
    street: row.address_street,
    district: row.address_district,
    city: row.address_city,
    occurredAt: row.occurred_at,
    thumbnailUrl,
    href: `/ocorrencias/${row.id}`,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function fetchDashboardData(): Promise<DashboardData> {
  const supabase = createClient()
  const since = since30d()

  const incidentsRes = await supabase
    .from('incidents')
    .select(
      'id,internal_number,type,address_street,address_district,address_city,occurred_at',
    )
    .is('deleted_at', null)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(FEED_LIMIT)

  if (incidentsRes.error) throw new Error(incidentsRes.error.message)

  const incidents = (incidentsRes.data ?? []) as IncidentRow[]

  // First photo (lowest sort_order) per entity, for the row thumbnail.
  const entityIds = incidents.map((i) => i.id)
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

  const items = incidents
    .map((row) => incidentToItem(row, thumbs.get(row.id) ?? null))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())

  if (items.length === 0) {
    // Empty database — show demo data so the screen is not blank.
    return buildMockDashboard()
  }

  return { items, isDemo: false, generatedAt: new Date().toISOString() }
}
