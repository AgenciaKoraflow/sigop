import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { safeGoogleMapsUrl, safeImageUrl } from './safe-url.ts'

const HOST = 'abc.supabase.co'

describe('safeImageUrl', () => {
  it('accepts https URLs on the Supabase host only', () => {
    assert.equal(
      safeImageUrl('https://abc.supabase.co/storage/v1/object/sign/x.jpg?token=1', HOST),
      'https://abc.supabase.co/storage/v1/object/sign/x.jpg?token=1',
    )
  })

  it('rejects other hosts, internal addresses, userinfo and non-https schemes', () => {
    for (const bad of [
      'https://evil.example/pixel.png',
      'https://abc.supabase.co.evil.example/x.jpg',
      'https://abc.supabase.co@evil.example/x.jpg',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x.jpg',
      'http://abc.supabase.co/x.jpg',
      'javascript:alert(1)',
      'data:image/svg+xml,<svg/>',
      '//evil.example/x.jpg',
      'photos/abc.jpg',
      '',
      null,
      undefined,
    ]) {
      assert.equal(safeImageUrl(bad as string | null, HOST), null, String(bad))
    }
  })

  it('fails closed when no host is configured', () => {
    assert.equal(safeImageUrl('https://abc.supabase.co/x.jpg', null), null)
  })
})

describe('safeGoogleMapsUrl', () => {
  it('allows Google Maps and refuses look-alikes', () => {
    assert.ok(safeGoogleMapsUrl('https://maps.app.goo.gl/abc'))
    assert.equal(safeGoogleMapsUrl('https://google.com.evil.example/maps'), null)
    assert.equal(safeGoogleMapsUrl('https://evil.example/?u=google.com'), null)
  })
})
