/** Pure authorization decision behind `requireAdmin` (unit tested). */
export type AdminDenial = 'unauthenticated' | 'must_change_password' | 'forbidden'

export function evaluateAdminAccess(
  user: { app_metadata?: Record<string, unknown> | null } | null,
  profile: { role?: string | null; is_active?: boolean | null; deleted_at?: string | null } | null,
): AdminDenial | null {
  if (!user) return 'unauthenticated'
  if (user.app_metadata?.must_change_password === true) return 'must_change_password'
  if (
    profile?.role !== 'administrator' ||
    profile.is_active === false ||
    (profile.deleted_at ?? null) !== null
  ) {
    return 'forbidden'
  }
  return null
}
