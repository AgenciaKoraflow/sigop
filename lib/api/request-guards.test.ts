import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isSameOriginRequest, isUuid } from './request-guards.ts'

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
})

describe('isUuid', () => {
  it('accepts canonical UUIDs', () => {
    assert.equal(isUuid('3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c'), true)
    assert.equal(isUuid('3F2B8C1E-9A4D-4E7B-8C2A-1D5E6F7A8B9C'), true)
  })

  it('rejects tampered ids', () => {
    for (const bad of [
      '',
      'me',
      '1',
      '../admin',
      "x' or '1'='1",
      '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c; drop table profiles',
      '3f2b8c1e9a4d4e7b8c2a1d5e6f7a8b9c',
      null,
      undefined,
      42,
      ['3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c'],
    ]) {
      assert.equal(isUuid(bad), false, String(bad))
    }
  })
})

describe('isSameOriginRequest', () => {
  it('allows same-origin browser calls', () => {
    assert.equal(
      isSameOriginRequest(headers({ origin: 'https://app.example.com', host: 'app.example.com' })),
      true,
    )
  })

  it('prefers x-forwarded-host behind a proxy', () => {
    assert.equal(
      isSameOriginRequest(
        headers({ origin: 'https://app.example.com', host: 'internal:3000', 'x-forwarded-host': 'app.example.com' }),
      ),
      true,
    )
  })

  it('rejects a foreign Origin', () => {
    assert.equal(
      isSameOriginRequest(headers({ origin: 'https://evil.example', host: 'app.example.com' })),
      false,
    )
  })

  it('rejects a malformed Origin', () => {
    assert.equal(isSameOriginRequest(headers({ origin: 'not a url', host: 'app.example.com' })), false)
  })

  it('rejects Sec-Fetch-Site: cross-site even without Origin', () => {
    assert.equal(isSameOriginRequest(headers({ 'sec-fetch-site': 'cross-site' })), false)
  })

  it('allows non-browser callers (auth is enforced per route)', () => {
    assert.equal(isSameOriginRequest(headers({})), true)
  })
})
