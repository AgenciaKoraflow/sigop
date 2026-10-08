import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_UPLOAD_BYTES, validateJpegBytes } from './server-validate.ts'

const enc = (s: string) => Array.from(new TextEncoder().encode(s))
const seg = (marker: number, payload: number[]) => [
  0xff,
  marker,
  (payload.length + 2) >> 8,
  (payload.length + 2) & 0xff,
  ...payload,
]
const SOF = seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0])
const SOS = seg(0xda, [1, 1, 0, 0, 0x3f, 0])
const jpeg = (...parts: number[][]) =>
  new Uint8Array([0xff, 0xd8, ...parts.flat(), 0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9])
const valid = () => jpeg(seg(0xe0, enc('JFIF\0')), SOF, SOS)

describe('validateJpegBytes', () => {
  it('accepts a well-formed JPEG', () => {
    assert.deepEqual(validateJpegBytes(valid()), { ok: true })
  })

  it('rejects SVG / HTML / empty / oversized', () => {
    assert.equal(validateJpegBytes(new TextEncoder().encode('<svg onload=alert(1)/>')).ok, false)
    assert.equal(validateJpegBytes(new TextEncoder().encode('<!doctype html>')).ok, false)
    assert.equal(validateJpegBytes(new Uint8Array()).ok, false)
    assert.equal(validateJpegBytes(new Uint8Array(MAX_UPLOAD_BYTES + 1)).ok, false)
  })

  it('rejects JPEG magic followed by non-JPEG junk', () => {
    const junk = new Uint8Array([0xff, 0xd8, 0xff, ...enc('<script>alert(1)</script>'), 0xff, 0xd9])
    assert.equal(validateJpegBytes(junk).ok, false)
  })

  it('rejects trailing data after EOI and truncated files', () => {
    assert.equal(validateJpegBytes(new Uint8Array([...valid(), ...enc('<html>')])).ok, false)
    assert.equal(validateJpegBytes(valid().slice(0, -2)).ok, false)
  })

  it('rejects comment segments and markup in header segments', () => {
    assert.equal(validateJpegBytes(jpeg(seg(0xfe, enc('hello')), SOF, SOS)).ok, false)
    assert.equal(validateJpegBytes(jpeg(seg(0xe1, enc('<svg onload=x>')), SOF, SOS)).ok, false)
  })

  it('rejects a scan without a frame header', () => {
    assert.equal(validateJpegBytes(jpeg(SOS)).ok, false)
  })
})
