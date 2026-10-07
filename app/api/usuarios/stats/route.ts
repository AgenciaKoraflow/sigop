import { NextResponse } from 'next/server'
import { adminUnavailable, serverError } from '@/lib/api/errors'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/usuarios/guard'
import { PASSWORD_AUDIT_ENTITY } from '@/lib/usuarios/form'

export const dynamic = 'force-dynamic'

const DAY_MS = 24 * 60 * 60 * 1000
const AUTH_PAGE_SIZE = 1000
const DB_PAGE_SIZE = 1000
const PERIODS = [7, 30, 90]
const DORMANT_AFTER_DAYS = 30
const TOP_LIMIT = 10
const WEEKS_SHOWN = 12

interface ProfileRow {
  id: string
  full_name: string
  email: string | null
  role: string
  is_active: boolean | null
  created_at: string | null
  units: { name: string | null } | { name: string | null }[] | null
}

function unitName(units: ProfileRow['units']): string | null {
  if (!units) return null
  return (Array.isArray(units) ? units[0]?.name : units.name) ?? null
}

/** Reads every row of a query, working around the PostgREST row cap. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data, error } = await build(from, from + DB_PAGE_SIZE - 1)
    if (error) return { rows, error: error.message }
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < DB_PAGE_SIZE) break
  }
  return { rows, error: null }
}

/**
 * GET /api/usuarios/stats?todayStart=<ISO>&tz=<getTimezoneOffset>&days=7|30|90
 * Everything the `/usuarios` dashboard tab shows. Login dates live in
 * `auth.users` and login counts in `login_events` (sql/018) — both only
 * readable with the service role, hence a Route Handler.
 *
 * `todayStart` / `tz` are the admin's local midnight and UTC offset, so "hoje"
 * and the per-day buckets follow their timezone rather than the server's.
 */
export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return adminUnavailable(err)
  }
  const db = admin as unknown as SupabaseClient

  const params = new URL(request.url).searchParams
  const now = Date.now()
  const todayParam = Date.parse(params.get('todayStart') ?? '')
  // Ignore anything that is not a plausible "midnight of today".
  const todayStart =
    Number.isFinite(todayParam) && todayParam <= now && now - todayParam <= DAY_MS
      ? todayParam
      : new Date(now).setUTCHours(0, 0, 0, 0)
  const tzParam = Number(params.get('tz'))
  const tzOffsetMin = Number.isFinite(tzParam) && Math.abs(tzParam) <= 14 * 60 ? tzParam : 0
  const daysParam = Number(params.get('days'))
  const days = PERIODS.includes(daysParam) ? daysParam : 30

  /** Local calendar day (YYYY-MM-DD) of a timestamp. */
  const localDay = (ts: number) => new Date(ts - tzOffsetMin * 60_000).toISOString().slice(0, 10)
  const dayDiff = (ts: number) => Math.floor((now - ts) / DAY_MS)

  const periodStart = todayStart - (days - 1) * DAY_MS
  const sevenDaysAgo = now - 7 * DAY_MS
  const thirtyDaysAgo = now - 30 * DAY_MS

  // --- Profiles --------------------------------------------------------------
  const loadProfiles = (hideDeleted: boolean) =>
    fetchAll<ProfileRow>((from, to) => {
      const query = db
        .from('profiles')
        .select('id,full_name,email,role,is_active,created_at,units(name)')
      return (hideDeleted ? query.is('deleted_at', null) : query)
        .order('id', { ascending: true })
        .range(from, to)
    })
  let profiles = await loadProfiles(true)
  // `profiles.deleted_at` only exists once sql/015 is applied.
  if (profiles.error && /deleted_at/i.test(profiles.error)) profiles = await loadProfiles(false)
  if (profiles.error) return serverError('stats profiles', new Error(profiles.error))

  // --- Last sign-in (auth.users) ---------------------------------------------
  const lastSignIn = new Map<string, number | null>()
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE })
    if (error) return serverError('stats listUsers', error)
    for (const user of data.users) {
      lastSignIn.set(user.id, user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : null)
    }
    if (data.users.length < AUTH_PAGE_SIZE) break
  }

  // --- Login events (sql/018) ------------------------------------------------
  const events = await fetchAll<{ user_id: string; logged_at: string }>((from, to) =>
    db
      .from('login_events')
      .select('user_id,logged_at')
      .gte('logged_at', new Date(periodStart).toISOString())
      .order('logged_at', { ascending: true })
      .range(from, to),
  )
  const trackingAvailable = !events.error
  let trackingSince: string | null = null
  if (trackingAvailable) {
    const { data } = await db
      .from('login_events')
      .select('logged_at')
      .order('logged_at', { ascending: true })
      .limit(1)
    trackingSince = (data as { logged_at: string }[] | null)?.[0]?.logged_at ?? null
  }

  // --- KPIs + per-user buckets -----------------------------------------------
  const kpis = {
    total: 0,
    active: 0,
    inactive: 0,
    neverLoggedIn: 0,
    loggedInToday: 0,
    loggedInLast7Days: 0,
    newLast30Days: 0,
    passwordChanges: 0,
    passwordChangesLast30Days: 0,
    loginsInPeriod: events.rows.length,
  }

  const byId = new Map(profiles.rows.map((profile) => [profile.id, profile]))
  const neverLoggedIn: {
    id: string
    fullName: string
    email: string | null
    role: string
    unitName: string | null
    isActive: boolean
    createdAt: string | null
    daysSinceCreated: number | null
  }[] = []
  const dormant: {
    id: string
    fullName: string
    role: string
    unitName: string | null
    lastLoginAt: string
    daysSince: number
  }[] = []
  const roleTotals = new Map<string, { total: number; active: number }>()
  const unitTotals = new Map<string, { total: number; active: number }>()
  const bump = (map: Map<string, { total: number; active: number }>, key: string, active: boolean) => {
    const entry = map.get(key) ?? { total: 0, active: 0 }
    entry.total += 1
    if (active) entry.active += 1
    map.set(key, entry)
  }

  for (const profile of profiles.rows) {
    const active = profile.is_active ?? true
    kpis.total += 1
    if (active) kpis.active += 1
    else kpis.inactive += 1
    bump(roleTotals, profile.role, active)
    bump(unitTotals, unitName(profile.units) ?? 'Sem unidade', active)

    const signedInAt = lastSignIn.get(profile.id) ?? null
    const createdAt = profile.created_at ? Date.parse(profile.created_at) : null
    if (signedInAt === null) {
      kpis.neverLoggedIn += 1
      neverLoggedIn.push({
        id: profile.id,
        fullName: profile.full_name,
        email: profile.email,
        role: profile.role,
        unitName: unitName(profile.units),
        isActive: active,
        createdAt: profile.created_at,
        daysSinceCreated: createdAt === null ? null : dayDiff(createdAt),
      })
    } else {
      if (signedInAt >= todayStart) kpis.loggedInToday += 1
      if (signedInAt >= sevenDaysAgo) kpis.loggedInLast7Days += 1
      if (active && signedInAt < now - DORMANT_AFTER_DAYS * DAY_MS) {
        dormant.push({
          id: profile.id,
          fullName: profile.full_name,
          role: profile.role,
          unitName: unitName(profile.units),
          lastLoginAt: new Date(signedInAt).toISOString(),
          daysSince: dayDiff(signedInAt),
        })
      }
    }
    if (createdAt !== null && createdAt >= thirtyDaysAgo) kpis.newLast30Days += 1
  }

  // --- Logins per day + ranking ----------------------------------------------
  const perDay = new Map<string, { logins: number; users: Set<string> }>()
  for (let i = 0; i < days; i += 1) {
    perDay.set(localDay(periodStart + i * DAY_MS), { logins: 0, users: new Set() })
  }
  const perUser = new Map<string, { logins: number; last: number }>()
  for (const event of events.rows) {
    const at = Date.parse(event.logged_at)
    const bucket = perDay.get(localDay(at))
    if (bucket) {
      bucket.logins += 1
      bucket.users.add(event.user_id)
    }
    const entry = perUser.get(event.user_id) ?? { logins: 0, last: 0 }
    entry.logins += 1
    entry.last = Math.max(entry.last, at)
    perUser.set(event.user_id, entry)
  }

  const topAccessed = Array.from(perUser.entries())
    .filter(([id]) => byId.has(id))
    .sort((a, b) => b[1].logins - a[1].logins || b[1].last - a[1].last)
    .slice(0, TOP_LIMIT)
    .map(([id, entry]) => {
      const profile = byId.get(id)!
      return {
        id,
        fullName: profile.full_name,
        role: profile.role,
        unitName: unitName(profile.units),
        logins: entry.logins,
        lastLoginAt: new Date(entry.last).toISOString(),
      }
    })

  // --- Password changes (audit_log) ------------------------------------------
  const weekMs = 7 * DAY_MS
  const weeksStart = todayStart - (WEEKS_SHOWN - 1) * weekMs
  const changes = await fetchAll<{ performed_at: string }>((from, to) =>
    db
      .from('audit_log')
      .select('performed_at')
      .eq('entity_type', PASSWORD_AUDIT_ENTITY)
      .order('performed_at', { ascending: true })
      .range(from, to),
  )
  kpis.passwordChanges = changes.rows.length
  const perWeek = new Map<string, number>()
  for (let i = 0; i < WEEKS_SHOWN; i += 1) perWeek.set(localDay(weeksStart + i * weekMs), 0)
  for (const change of changes.rows) {
    const at = Date.parse(change.performed_at)
    if (at >= thirtyDaysAgo) kpis.passwordChangesLast30Days += 1
    if (at < weeksStart) continue
    const index = Math.min(WEEKS_SHOWN - 1, Math.floor((at - weeksStart) / weekMs))
    const key = localDay(weeksStart + index * weekMs)
    perWeek.set(key, (perWeek.get(key) ?? 0) + 1)
  }

  const rank = (map: Map<string, { total: number; active: number }>) =>
    Array.from(map.entries())
      .map(([label, value]) => ({ label, ...value }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'pt-BR'))

  return NextResponse.json({
    days,
    kpis,
    loginTracking: { available: trackingAvailable, since: trackingSince },
    loginsPerDay: Array.from(perDay.entries()).map(([day, value]) => ({
      day,
      logins: value.logins,
      users: value.users.size,
    })),
    topAccessed,
    neverLoggedIn: neverLoggedIn.sort(
      (a, b) => (b.daysSinceCreated ?? -1) - (a.daysSinceCreated ?? -1),
    ),
    dormant: dormant.sort((a, b) => b.daysSince - a.daysSince),
    byRole: rank(roleTotals),
    byUnit: rank(unitTotals),
    passwordChangesPerWeek: Array.from(perWeek.entries()).map(([weekStart, count]) => ({
      weekStart,
      count,
    })),
  })
}
