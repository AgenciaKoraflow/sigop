import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/usuarios/guard'
import { PASSWORD_AUDIT_ENTITY } from '@/lib/usuarios/form'

export const dynamic = 'force-dynamic'

const DAY_MS = 24 * 60 * 60 * 1000
const AUTH_PAGE_SIZE = 1000

interface ProfileRow {
  id: string
  is_active: boolean | null
  created_at: string | null
}

/**
 * GET /api/usuarios/stats?todayStart=<ISO>
 * Counters for the `/usuarios` dashboard. Login dates live in `auth.users`
 * (`last_sign_in_at`), which only the service-role Auth Admin API can read —
 * hence a Route Handler instead of a direct `profiles` read.
 *
 * `todayStart` is the caller's local midnight, so "login no dia" follows the
 * admin's timezone rather than the server's.
 */
export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Configuração do servidor ausente.' },
      { status: 503 },
    )
  }
  const db = admin as unknown as SupabaseClient

  const now = Date.now()
  const todayParam = Date.parse(new URL(request.url).searchParams.get('todayStart') ?? '')
  // Ignore anything that is not a plausible "midnight of today".
  const todayStart =
    Number.isFinite(todayParam) && todayParam <= now && now - todayParam <= DAY_MS
      ? todayParam
      : new Date(now).setUTCHours(0, 0, 0, 0)
  const sevenDaysAgo = now - 7 * DAY_MS
  const thirtyDaysAgo = now - 30 * DAY_MS

  const loadProfiles = (hideDeleted: boolean) => {
    const query = db.from('profiles').select('id,is_active,created_at')
    return hideDeleted ? query.is('deleted_at', null) : query
  }
  let { data: profiles, error: profilesError } = await loadProfiles(true)
  // `profiles.deleted_at` only exists once sql/015 is applied.
  if (profilesError && /deleted_at/i.test(profilesError.message)) {
    ;({ data: profiles, error: profilesError } = await loadProfiles(false))
  }
  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 })
  }

  const lastSignIn = new Map<string, string | null>()
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    for (const user of data.users) lastSignIn.set(user.id, user.last_sign_in_at ?? null)
    if (data.users.length < AUTH_PAGE_SIZE) break
  }

  const stats = {
    total: 0,
    active: 0,
    inactive: 0,
    neverLoggedIn: 0,
    loggedInToday: 0,
    loggedInLast7Days: 0,
    newLast30Days: 0,
    passwordChanges: 0,
    passwordChangesLast30Days: 0,
  }

  for (const profile of (profiles ?? []) as ProfileRow[]) {
    stats.total += 1
    if (profile.is_active ?? true) stats.active += 1
    else stats.inactive += 1

    const signedInAt = lastSignIn.get(profile.id)
    if (!signedInAt) {
      stats.neverLoggedIn += 1
    } else {
      const at = Date.parse(signedInAt)
      if (at >= todayStart) stats.loggedInToday += 1
      if (at >= sevenDaysAgo) stats.loggedInLast7Days += 1
    }

    if (profile.created_at && Date.parse(profile.created_at) >= thirtyDaysAgo) {
      stats.newLast30Days += 1
    }
  }

  // Password changes are recorded in `audit_log` by the reset-password handler.
  const countPasswordChanges = (since?: number) => {
    const query = db
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', PASSWORD_AUDIT_ENTITY)
    return since ? query.gte('performed_at', new Date(since).toISOString()) : query
  }
  const [allChanges, recentChanges] = await Promise.all([
    countPasswordChanges(),
    countPasswordChanges(thirtyDaysAgo),
  ])
  stats.passwordChanges = allChanges.count ?? 0
  stats.passwordChangesLast30Days = recentChanges.count ?? 0

  return NextResponse.json(stats)
}
