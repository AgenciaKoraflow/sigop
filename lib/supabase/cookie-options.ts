import type { CookieOptions } from '@supabase/ssr'

/**
 * Session cookie attributes enforced on every Supabase client (browser, server
 * and middleware).
 *
 * `HttpOnly` stays OFF on purpose, and cannot be turned on without a rewrite:
 * the browser client reads the session from `document.cookie` to authenticate
 * every direct REST / Storage / RPC call (35 modules) and to refresh the token.
 * An HttpOnly cookie would make `createBrowserClient` see no session at all.
 * Supabase SSR documents the same trade-off. The XSS exposure is reduced by:
 *   - the nonce-based CSP (middleware.ts / lib/security/csp.ts),
 *   - server-side revocation that is effective immediately, not at JWT expiry
 *     (sql/032: `session_alive()` is part of every RLS gate),
 *   - refresh-token rotation with reuse detection (Auth server setting).
 * Moving to HttpOnly would require proxying all data access through Route
 * Handlers (BFF); that is a separate project, not a cookie flag.
 *
 * - `SameSite=Lax`: cross-site POSTs never carry the session.
 * - `Secure`: on outside development.
 * - `Path=/`, no `Domain`: host-only cookie, never shared with sibling
 *   subdomains (a `Domain` attribute would widen who can read/overwrite it).
 * - `Max-Age`: a sliding window. Every token refresh rewrites the cookie, so an
 *   abandoned browser profile stops holding a live session after this long.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14

export const SESSION_COOKIE_BASE: CookieOptions = {
  path: '/',
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_MAX_AGE_SECONDS,
}

/**
 * Forces the security attributes on whatever the Supabase library asks to set.
 * `maxAge` is only defaulted: a removal arrives with `maxAge: 0` and must keep
 * it, otherwise the cookie would be re-issued instead of deleted on sign-out.
 */
export function hardenCookie(options?: CookieOptions): CookieOptions {
  // `domain` is dropped on purpose: the cookie stays host-only.
  const { domain: _domain, ...rest } = options ?? {}
  return {
    ...rest,
    path: SESSION_COOKIE_BASE.path,
    sameSite: SESSION_COOKIE_BASE.sameSite,
    secure: SESSION_COOKIE_BASE.secure,
    maxAge: options?.maxAge ?? SESSION_MAX_AGE_SECONDS,
  }
}
