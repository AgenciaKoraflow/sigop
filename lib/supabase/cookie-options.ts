import type { CookieOptions } from '@supabase/ssr'

/**
 * Session cookie attributes enforced on every Supabase client (browser, server
 * and middleware). `HttpOnly` stays off on purpose: the browser client reads the
 * session to authenticate Storage/REST calls. `SameSite=Lax` keeps cross-site
 * POSTs from carrying the session; `Secure` is on outside development.
 */
export const SESSION_COOKIE_BASE: CookieOptions = {
  path: '/',
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
}

export function hardenCookie(options?: CookieOptions): CookieOptions {
  return { ...options, ...SESSION_COOKIE_BASE }
}
