import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_INPUT_BYTES, detectImageType, validatePhotoFile } from './validate.ts'

const bytes = (...values: number[]) => new Uint8Array(values)
const text = (value: string) => new TextEncoder().encode(value)
const blob = (data: Uint8Array | string, type = 'image/jpeg') =>
  new Blob([typeof data === 'string' ? text(data) : data], { type })

describe('detectImageType', () => {
  it('recognises real image signatures', () => {
    assert.equal(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)), 'jpeg')
    assert.equal(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'png')
    assert.equal(detectImageType(text('RIFF\x00\x00\x00\x00WEBPVP8 ')), 'webp')
    assert.equal(detectImageType(text('\x00\x00\x00\x18ftypheic')), 'heic')
  })

  it('rejects SVG, HTML, scripts and truncated input', () => {
    assert.equal(detectImageType(text('<svg xmlns="http://www.w3.org/2000/svg"/>')), null)
    assert.equal(detectImageType(text('<!doctype html><script>')), null)
    assert.equal(detectImageType(text('GIF89a')), null)
    assert.equal(detectImageType(text('RIFF\x00\x00\x00\x00WAVE')), null)
    assert.equal(detectImageType(text('\x00\x00\x00\x18ftypmp42')), null)
    assert.equal(detectImageType(bytes()), null)
    assert.equal(detectImageType(bytes(0xff, 0xd8)), null)
  })
})

describe('validatePhotoFile', () => {
  it('accepts a JPEG regardless of the declared MIME', async () => {
    const result = await validatePhotoFile(blob(bytes(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3), 'text/plain'))
    assert.deepEqual(result, { ok: true, type: 'jpeg' })
  })

  it('rejects an SVG that claims to be image/jpeg', async () => {
    const result = await validatePhotoFile(blob('<svg onload="alert(1)"/>', 'image/jpeg'))
    assert.equal(result.ok, false)
  })

  it('rejects an empty file and an oversized file', async () => {
    assert.equal((await validatePhotoFile(blob(bytes()))).ok, false)
    const huge = { size: MAX_INPUT_BYTES + 1, slice: () => blob(bytes(0xff, 0xd8, 0xff)) } as unknown as Blob
    assert.equal((await validatePhotoFile(huge)).ok, false)
  })
})
