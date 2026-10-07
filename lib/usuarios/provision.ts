/**
 * Provisioning of a login user (isomorphic-free: no server imports, so it is unit
 * testable). See sql/026_signup_lockdown.sql.
 *
 * The role is NEVER sent in `user_metadata` (user-controlled on public sign-up).
 * It is stored in a server-written ticket; the database trigger on auth.users
 * refuses any insert that does not redeem a ticket, and takes the profile role
 * from the ticket.
 */

export const PROVISION_TOKEN_KEY = 'provision_token'

/** 256-bit single-use token, CSPRNG. */
export function generateProvisionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Hex SHA-256 — matches `sha256(convert_to(token, 'UTF8'))` in the trigger. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** What `auth.admin.createUser` receives besides credentials. No role anywhere. */
export function buildProvisionedUserAttributes(input: {
  fullName: string
  token: string
  mustChangePasswordFlag: string
}) {
  return {
    app_metadata: { [input.mustChangePasswordFlag]: true },
    user_metadata: { full_name: input.fullName, [PROVISION_TOKEN_KEY]: input.token },
  }
}
