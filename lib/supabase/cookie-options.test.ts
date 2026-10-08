import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SESSION_COOKIE_BASE,
  SESSION_MAX_AGE_SECONDS,
  hardenCookie,
} from './cookie-options.ts'

describe('hardenCookie', () => {
  it('forces path, SameSite and Secure over whatever the library asks for', () => {
    const out = hardenCookie({ path: '/x', sameSite: 'none', secure: false })
    assert.equal(out.path, '/')
    assert.equal(out.sameSite, 'lax')
    assert.equal(out.secure, SESSION_COOKIE_BASE.secure)
  })

  it('never emits a Domain attribute (host-only cookie)', () => {
    const out = hardenCookie({ domain: '.example.com' })
    assert.equal('domain' in out, false)
  })

  it('gives a bounded lifetime when the library sets none', () => {
    assert.equal(hardenCookie().maxAge, SESSION_MAX_AGE_SECONDS)
    assert.equal(hardenCookie({}).maxAge, SESSION_MAX_AGE_SECONDS)
    assert.ok(SESSION_MAX_AGE_SECONDS > 0 && SESSION_MAX_AGE_SECONDS <= 60 * 60 * 24 * 30)
  })

  it('keeps maxAge: 0 so sign-out really deletes the cookie', () => {
    assert.equal(hardenCookie({ maxAge: 0 }).maxAge, 0)
  })

  it('does not silently flip HttpOnly (browser client must read the session)', () => {
    assert.equal(hardenCookie({}).httpOnly, undefined)
  })
})
