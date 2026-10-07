import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/database.types'
import { isSameOriginRequest } from '@/lib/api/request-guards'
import { buildCsp, generateNonce } from '@/lib/security/csp'
import { hardenCookie } from '@/lib/supabase/cookie-options'

type CookieToSet = { name: string; value: string; options: CookieOptions }

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export async function middleware(request: NextRequest) {
  // Central CSRF gate for every API write: a cross-site browser request never
  // reaches a handler. Handlers keep their own check as defence in depth.
  if (
    request.nextUrl.pathname.startsWith('/api') &&
    MUTATING_METHODS.has(request.method) &&
    !isSameOriginRequest(request.headers)
  ) {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 403 })
  }

  // Per-request nonce CSP. Next reads the CSP from the *request* headers and
  // stamps the nonce on its own scripts; the same value goes on the response.
  const nonce = generateNonce()
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV !== 'production',
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  })
  request.headers.set('x-nonce', nonce)
  request.headers.set('Content-Security-Policy', csp)

  let response = NextResponse.next({ request })
  response.headers.set('Content-Security-Policy', csp)

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        // The session is stored split across several cookies (`…-auth-token.0`,
        // `.1`, …) and a token refresh rewrites all of them. They must land on
        // ONE response: rebuilding the response per cookie (the old
        // get/set/remove API) kept only the last chunk, leaving the browser
        // with a half-updated session — i.e. a random logout on the next page.
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          response.headers.set('Content-Security-Policy', csp)
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, hardenCookie(options)),
          )
        },
      },
    }
  )

  const { data: { user }, error } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // A redirect is a fresh response: carry over any refreshed session cookies,
  // otherwise the rotated refresh token is lost and the session dies.
  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url))
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
    return redirect
  }

  // The Auth server being unreachable (timeout, 5xx) says nothing about the
  // session, so don't treat it as "signed out". Data stays protected by RLS.
  if (!user && error && isAuthRetryableFetchError(error)) {
    return response
  }

  // Route protection: unauthenticated users are pushed to /login; an
  // authenticated user hitting /login is sent back to the app root.
  // API routes are left alone — their handlers do their own auth and must be
  // able to answer with a JSON 401/403 instead of an HTML redirect.
  const isPublic = pathname.startsWith('/login') || pathname.startsWith('/esqueci-senha')
  if (!user && !isPublic && !pathname.startsWith('/api')) {
    return redirectTo('/login')
  }

  // First-login gate: a user flagged by the server (app_metadata is only
  // writable with the service role) can reach nothing but the change page.
  const mustChange = user?.app_metadata?.must_change_password === true
  if (user && mustChange && pathname !== '/trocar-senha' && !pathname.startsWith('/api')) {
    return redirectTo('/trocar-senha')
  }
  if (user && !mustChange && pathname === '/trocar-senha') {
    return redirectTo('/')
  }
  if (user && (pathname === '/login' || pathname.startsWith('/esqueci-senha'))) {
    return redirectTo('/')
  }

  return response
}

export const config = {
  // Skip the auth round-trip for Next internals, the PWA service-worker assets
  // and any static file request (images, fonts). Every match still costs one
  // `auth.getUser()` call against the Supabase Auth server, so the tighter this
  // is, the fewer per-navigation round-trips.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js|workbox-|.*\\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot)$).*)',
  ],
}
