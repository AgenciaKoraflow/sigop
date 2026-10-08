/**
 * Forgery attempts against audit_log through the real PostgREST endpoint
 * (sql/029_audit_integrity.sql must be applied).
 *
 * Needs a throw-away AGENT account of a TEST project — it is skipped otherwise:
 *   AUDIT_TEST_URL, AUDIT_TEST_ANON_KEY, AUDIT_TEST_EMAIL, AUDIT_TEST_PASSWORD
 * Run: node --test lib/audit/audit-rest.test.ts
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

const url = process.env.AUDIT_TEST_URL
const anonKey = process.env.AUDIT_TEST_ANON_KEY
const email = process.env.AUDIT_TEST_EMAIL
const password = process.env.AUDIT_TEST_PASSWORD
const configured = Boolean(url && anonKey && email && password)

const ZERO_UUID = '00000000-0000-0000-0000-000000000001'

let token = ''
let userId = ''

async function rest(method: string, path: string, body?: unknown, key = token) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: anonKey!,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

/** A write is "refused" when PostgREST answers 401/403/400 or touches no row. */
function assertRefused(r: { status: number; body: unknown }) {
  const rows = Array.isArray(r.body) ? r.body.length : 0
  assert.ok(r.status >= 400 || rows === 0, `write accepted: ${r.status} ${JSON.stringify(r.body)}`)
}

describe('audit_log cannot be forged through PostgREST', { skip: !configured }, () => {
  before(async () => {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const json = (await res.json()) as { access_token: string; user: { id: string } }
    token = json.access_token
    userId = json.user.id
    assert.ok(token, 'sign-in failed')
  })

  const forged = (extra: Record<string, unknown>) => ({
    entity_type: 'incident',
    entity_id: ZERO_UUID,
    operation: 'delete',
    performed_by: userId,
    ...extra,
  })

  it('refuses a fabricated event attributed to self', async () => {
    assertRefused(await rest('POST', 'audit_log', forged({})))
  })

  it('refuses an event attributed to another user', async () => {
    assertRefused(await rest('POST', 'audit_log', forged({ performed_by: ZERO_UUID })))
  })

  it('refuses an event without performed_by', async () => {
    const { performed_by: _omit, ...row } = forged({})
    assertRefused(await rest('POST', 'audit_log', row))
  })

  it('refuses unknown entity_type and operation', async () => {
    assertRefused(await rest('POST', 'audit_log', forged({ entity_type: 'whatever' })))
    assertRefused(await rest('POST', 'audit_log', forged({ operation: 'teleport' })))
  })

  it('refuses a forged password-change event', async () => {
    assertRefused(
      await rest('POST', 'audit_log', forged({ entity_type: 'user_password', operation: 'update' })),
    )
  })

  it('refuses bulk / upsert inserts', async () => {
    assertRefused(await rest('POST', 'audit_log', [forged({}), forged({ operation: 'create' })]))
    assertRefused(await rest('POST', 'audit_log?on_conflict=id', forged({})))
  })

  it('refuses UPDATE and DELETE of history', async () => {
    assertRefused(await rest('PATCH', 'audit_log?id=not.is.null', { operation: 'create' }))
    assertRefused(await rest('DELETE', 'audit_log?id=not.is.null'))
  })

  it('cannot call the audit trigger functions as RPC', async () => {
    for (const fn of ['audit_incident_change', 'audit_offender_change', 'audit_log_before_insert']) {
      const r = await rest('POST', `rpc/${fn}`, {})
      assert.ok(r.status >= 400, `${fn} callable: ${r.status}`)
    }
  })

  it('anon key alone cannot write either', async () => {
    assertRefused(await rest('POST', 'audit_log', forged({}), anonKey!))
  })
})
