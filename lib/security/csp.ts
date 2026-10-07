/**
 * Content-Security-Policy builder. Kept free of imports so it can be unit-tested
 * with the Node test runner (`npm test`).
 *
 * Scripts are nonce-based: the middleware mints one nonce per request and Next
 * stamps it on its own inline/bootstrap scripts, so `unsafe-inline` is not
 * needed for `script-src`. `unsafe-eval` is only allowed in development (React
 * Refresh). `style-src` keeps `unsafe-inline` because React `style={}`
 * attributes, Leaflet and Recharts all emit inline styles; the risk is far
 * lower than for scripts and nonces cannot cover style attributes.
 */

export interface CspOptions {
  nonce: string
  isDev: boolean
  /** NEXT_PUBLIC_SUPABASE_URL, e.g. https://xxxx.supabase.co */
  supabaseUrl?: string
}

export function buildCsp({ nonce, isDev, supabaseUrl }: CspOptions): string {
  let supabaseHttp = ''
  let supabaseWs = ''
  try {
    if (supabaseUrl) {
      const url = new URL(supabaseUrl)
      supabaseHttp = url.origin
      supabaseWs = `wss://${url.host}`
    }
  } catch {
    // Misconfigured URL: fall through with no Supabase origin rather than throw.
  }

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      // Lets nonce-approved scripts load their own chunks; 'self' stays as the
      // fallback for browsers without CSP3 support.
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    // Signed Storage photos, OSM tiles, camera/compression previews (blob:/data:).
    'img-src': ["'self'", 'data:', 'blob:', supabaseHttp, 'https://*.tile.openstreetmap.org'].filter(Boolean),
    // Supabase REST/Auth/Storage/Realtime, ViaCEP and Nominatim (called from the browser).
    'connect-src': [
      "'self'",
      supabaseHttp,
      supabaseWs,
      'https://viacep.com.br',
      'https://nominatim.openstreetmap.org',
      ...(isDev ? ['ws://localhost:*', 'http://localhost:*'] : []),
    ].filter(Boolean),
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'media-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  }

  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`)
  if (!isDev) parts.push('upgrade-insecure-requests')
  return parts.join('; ')
}

export function generateNonce(): string {
  // Web Crypto is available in the Edge runtime (middleware) and Node 18+.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary)
}
