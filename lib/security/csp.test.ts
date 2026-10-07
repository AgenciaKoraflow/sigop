import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildCsp, generateNonce } from './csp.ts'

const base = { nonce: 'abc123', supabaseUrl: 'https://proj.supabase.co' }

describe('buildCsp', () => {
  it('uses a nonce and no unsafe-inline/eval for scripts in production', () => {
    const csp = buildCsp({ ...base, isDev: false })
    const script = csp.split('; ').find((d) => d.startsWith('script-src'))!
    assert.match(script, /'nonce-abc123'/)
    assert.doesNotMatch(script, /unsafe-inline|unsafe-eval/)
  })

  it('allows unsafe-eval only in development', () => {
    assert.match(buildCsp({ ...base, isDev: true }), /script-src[^;]*'unsafe-eval'/)
    assert.doesNotMatch(buildCsp({ ...base, isDev: false }), /unsafe-eval/)
  })

  it('allows the Supabase origin and websocket in connect-src', () => {
    const csp = buildCsp({ ...base, isDev: false })
    assert.match(csp, /connect-src[^;]*https:\/\/proj\.supabase\.co/)
    assert.match(csp, /connect-src[^;]*wss:\/\/proj\.supabase\.co/)
  })

  it('blocks framing, plugins and foreign base/form targets', () => {
    const csp = buildCsp({ ...base, isDev: false })
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      assert.ok(csp.includes(d), d)
    }
  })

  it('does not throw on a malformed Supabase URL', () => {
    assert.doesNotThrow(() => buildCsp({ nonce: 'n', isDev: false, supabaseUrl: 'not a url' }))
  })
})

describe('generateNonce', () => {
  it('returns distinct base64 values', () => {
    const a = generateNonce()
    assert.notEqual(a, generateNonce())
    assert.match(a, /^[A-Za-z0-9+/]+=*$/)
  })
})
