import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getClientIp, normalizeIp, UNKNOWN_IP } from './client-ip.ts'

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
})

describe('getClientIp', () => {
  it('ignores forwarding headers when no proxy is trusted (spoofable)', () => {
    assert.equal(getClientIp(headers({ 'x-forwarded-for': '9.9.9.9' }), {}), UNKNOWN_IP)
  })

  it('on Vercel prefers the edge-set header over a client-supplied chain', () => {
    const env = { VERCEL: '1' }
    assert.equal(
      getClientIp(headers({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }), env),
      '203.0.113.7',
    )
    assert.equal(getClientIp(headers({ 'x-real-ip': '203.0.113.8' }), env), '203.0.113.8')
  })

  it('honours TRUSTED_IP_HEADER and nothing else', () => {
    const env = { TRUSTED_IP_HEADER: 'CF-Connecting-IP', VERCEL: '1' }
    assert.equal(
      getClientIp(headers({ 'cf-connecting-ip': '198.51.100.4', 'x-forwarded-for': '1.1.1.1' }), env),
      '198.51.100.4',
    )
  })

  it('rejects garbage so a header cannot mint unlimited buckets', () => {
    const env = { VERCEL: '1' }
    for (const bad of ['', 'not-an-ip', '1.1.1.1.1', '999.1.1.1', "1.1.1.1'; drop table x"]) {
      assert.equal(getClientIp(headers({ 'x-vercel-forwarded-for': bad }), env), UNKNOWN_IP, bad)
    }
  })

  it('strips ports', () => {
    assert.equal(getClientIp(headers({ 'x-real-ip': '203.0.113.9:4711' }), { VERCEL: '1' }), '203.0.113.9')
  })

  it('buckets IPv6 by /64 so rotating the host part does not dodge limits', () => {
    const env = { VERCEL: '1' }
    const a = getClientIp(headers({ 'x-real-ip': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }), env)
    const b = getClientIp(headers({ 'x-real-ip': '2001:db8:1:2::1' }), env)
    const c = getClientIp(headers({ 'x-real-ip': '2001:db8:1:3::1' }), env)
    assert.equal(a, b)
    assert.notEqual(a, c)
  })
})

describe('normalizeIp', () => {
  it('leaves IPv4 alone and canonicalises IPv6 prefixes', () => {
    assert.equal(normalizeIp('203.0.113.7'), '203.0.113.7')
    assert.equal(normalizeIp('2001:0db8:0000:0001::5'), '2001:db8:0:1::/64')
    assert.equal(normalizeIp('::1'), '0:0:0:0::/64')
  })
})
