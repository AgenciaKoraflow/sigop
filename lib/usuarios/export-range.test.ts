import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseExportRange } from './export-range.ts'

describe('parseExportRange', () => {
  it('covers whole São Paulo days, inclusive of the end date', () => {
    const r = parseExportRange('2026-10-01', '2026-10-13')
    assert.ok(r.ok)
    assert.equal(r.range.startIso, '2026-10-01T03:00:00.000Z')
    assert.equal(r.range.endIso, '2026-10-14T03:00:00.000Z')
  })

  it('accepts a single day', () => {
    const r = parseExportRange('2026-10-13', '2026-10-13')
    assert.ok(r.ok)
    assert.equal(r.range.endIso, '2026-10-14T03:00:00.000Z')
  })

  it('refuses missing, malformed, impossible and inverted dates', () => {
    assert.equal(parseExportRange(null, '2026-10-13').ok, false)
    assert.equal(parseExportRange('13/10/2026', '2026-10-13').ok, false)
    assert.equal(parseExportRange('2026-02-31', '2026-03-01').ok, false)
    assert.equal(parseExportRange('2026-10-13', '2026-10-01').ok, false)
  })

  it('caps the period', () => {
    assert.equal(parseExportRange('2024-01-01', '2026-01-01').ok, false)
    assert.equal(parseExportRange('2026-01-01', '2026-12-31').ok, true)
  })
})
