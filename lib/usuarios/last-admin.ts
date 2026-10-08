/**
 * Helpers around the "always keep one active administrator" rule.
 *
 * The rule itself lives in the database (sql/030_last_admin_guard.sql,
 * trigger `tr_profiles_b_last_admin`) so it also holds under concurrency and for
 * writers that bypass the Route Handlers. These helpers only translate its
 * violation into an HTTP answer (unit tested).
 */
export const LAST_ADMIN_VIOLATION = 'last_active_administrator'

export const LAST_ADMIN_MESSAGE =
  'Não é possível remover, rebaixar ou desativar o último administrador ativo. Promova outro administrador antes.'

/** True when a Supabase/PostgREST/Postgres error is the last-admin trigger firing. */
export function isLastAdminViolation(error: { message?: string | null } | null | undefined): boolean {
  return !!error?.message && error.message.includes(LAST_ADMIN_VIOLATION)
}

/** A profile counts as an administrator only while active and not soft-deleted. */
export function isActiveAdministrator(
  profile: { role?: string | null; is_active?: boolean | null; deleted_at?: string | null },
): boolean {
  return (
    profile.role === 'administrator' &&
    profile.is_active !== false &&
    (profile.deleted_at ?? null) === null
  )
}
