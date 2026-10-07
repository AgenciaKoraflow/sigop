/**
 * Run with: node --experimental-strip-types lib/search/escape.test.ts
 * (no test runner is configured in this project).
 */
import assert from 'node:assert/strict'
import { buildOrIlike, escapeLikeTerm, normalizeSearchTerm, quotePostgrestValue } from './escape.ts'

// Wildcards become literals.
assert.equal(escapeLikeTerm('100%_ok'), '100\\%\\_ok')
assert.equal(escapeLikeTerm('a\\b'), 'a\\\\b')
// `*` is a PostgREST wildcard alias — dropped.
assert.equal(escapeLikeTerm('a*b'), 'ab')
// Control chars / CRLF never survive.
assert.equal(normalizeSearchTerm('a\r\nSet-Cookie: x\u0000'), 'a Set-Cookie: x')
assert.equal(normalizeSearchTerm(null), '')
assert.equal(normalizeSearchTerm('x'.repeat(500)).length, 100)

// Quoting: a quote or backslash cannot terminate the literal.
assert.equal(quotePostgrestValue('a"b'), '"a\\"b"')
assert.equal(quotePostgrestValue('a\\b'), '"a\\\\b"')

// Injection payloads stay inside ONE quoted value per column.
const payloads = [
  'x%,id.neq.0',
  'x),deleted_at.is.null,(a.eq.1',
  '",id.neq.0,"',
  '\\",id.neq.0,\\"',
  'a.ilike.b',
  'or(a.eq.1)',
  '*',
  '%',
  '_',
]
for (const payload of payloads) {
  const out = buildOrIlike(['c1', 'c2'], payload)
  // A bare `*` normalizes to an empty term → no filter at all (not a match-all wildcard).
  if (payload === '*') {
    assert.equal(out, null)
    continue
  }
  assert.ok(out, payload)
  // Re-parse with the PostgREST quoting rules: exactly 2 conditions, each a single quoted value.
  const re = /^c[12]\.ilike\."((?:[^"\\]|\\.)*)"$/
  const parts: string[] = []
  let depth = false
  let cur = ''
  for (let i = 0; i < out.length; i += 1) {
    const ch = out[i]
    if (ch === '\\' && depth) {
      cur += ch + out[++i]
      continue
    }
    if (ch === '"') depth = !depth
    if (ch === ',' && !depth) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  assert.equal(depth, false, `unbalanced quote: ${payload}`)
  assert.equal(parts.length, 2, `extra conditions injected: ${payload}`)
  for (const part of parts) assert.match(part, re, payload)
}

// Legit searches keep working (accents, spaces, dots, dashes).
assert.equal(buildOrIlike(['c'], 'João da Silva'), 'c.ilike."%João da Silva%"')
assert.equal(buildOrIlike(['c'], 'OC-2024.001'), 'c.ilike."%OC-2024.001%"')
assert.equal(buildOrIlike(['c'], '   '), null)

console.log('escape.test: all assertions passed')
