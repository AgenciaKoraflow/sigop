/**
 * Last-active-administrator guard against a real database
 * (sql/030_last_admin_guard.sql must be applied). Covers what unit tests cannot:
 * the trigger, RLS and two truly concurrent transactions.
 *
 * Needs a TEST project (never production) whose ONLY active administrators are
 * the two accounts below, plus one throw-away agent account. Skipped otherwise:
 *   LAST_ADMIN_TEST_URL, LAST_ADMIN_TEST_ANON_KEY, LAST_ADMIN_TEST_SERVICE_KEY,
 *   LAST_ADMIN_TEST_ADMIN_A_ID, LAST_ADMIN_TEST_ADMIN_B_ID,
 *   LAST_ADMIN_TEST_AGENT_EMAIL, LAST_ADMIN_TEST_AGENT_PASSWORD
 * Run: node --test lib/usuarios/last-admin.integration.test.ts
 *
 * Sequential cases (single admin, banned peer, ...) live in
 * sql/tests/030_last_admin_guard.test.sql.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

const env = process.env
const url = env.LAST_ADMIN_TEST_URL
const anonKey = env.LAST_ADMIN_TEST_ANON_KEY
const serviceKey = env.LAST_ADMIN_TEST_SERVICE_KEY
const adminA = env.LAST_ADMIN_TEST_ADMIN_A_ID
const adminB = env.LAST_ADMIN_TEST_ADMIN_B_ID
const agentEmail = env.LAST_ADMIN_TEST_AGENT_EMAIL
const agentPassword = env.LAST_ADMIN_TEST_AGENT_PASSWORD
const configured = Boolean(url && anonKey && serviceKey && adminA && adminB && agentEmail && agentPassword)

async function rest(method: string, path: string, body?: unknown, bearer = serviceKey!) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: anonKey!,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const patch = (id: string, data: Record<string, unknown>, bearer?: string) =>
  rest('PATCH', `profiles?id=eq.${id}`, data, bearer)

const blocked = (r: { status: number; body: unknown }) =>
  r.status >= 400 && JSON.stringify(r.body).includes('last_active_administrator')

const activeAdmins = async () =>
  (await rest('GET', 'profiles?select=id&role=eq.administrator&is_active=eq.true&deleted_at=is.null'))
    .body as { id: string }[]

async function restore() {
  await patch(adminA!, { role: 'administrator', is_active: true })
  await patch(adminB!, { role: 'administrator', is_active: true })
}

describe('last active administrator guard (database)', { skip: !configured && 'LAST_ADMIN_TEST_* not set' }, () => {
  before(async () => {
    const ids = (await activeAdmins()).map((r) => r.id).sort()
    assert.deepEqual(ids, [adminA!, adminB!].sort(), 'test project must have exactly these two active admins')
  })

  after(restore)

  it('2 admins: one may demote the other, then the survivor is protected', async () => {
    assert.equal((await patch(adminB!, { role: 'agent' })).status, 200)
    assert.equal(blocked(await patch(adminA!, { role: 'agent' })), true)
    assert.equal(blocked(await patch(adminA!, { is_active: false })), true)
    assert.equal(blocked(await rest('DELETE', `profiles?id=eq.${adminA}`)), true)
    await restore()
  })

  it('simultaneous demotion of both admins: exactly one succeeds', async () => {
    for (let round = 0; round < 10; round++) {
      const [r1, r2] = await Promise.all([
        patch(adminA!, { role: 'agent' }),
        patch(adminB!, { role: 'agent' }),
      ])
      assert.equal([r1, r2].filter((r) => r.status === 200).length, 1, `round ${round}: one success`)
      assert.equal([r1, r2].filter(blocked).length, 1, `round ${round}: one refusal`)
      assert.equal((await activeAdmins()).length, 1, `round ${round}: one admin must remain`)
      await restore()
    }
  })

  it('simultaneous deactivation mixed with demotion: one admin remains', async () => {
    const [r1, r2] = await Promise.all([
      patch(adminA!, { is_active: false }),
      patch(adminB!, { role: 'supervisor' }),
    ])
    assert.equal([r1, r2].filter((r) => r.status === 200).length, 1)
    assert.equal((await activeAdmins()).length, 1)
    await restore()
  })

  it('a common user cannot change roles directly through PostgREST', async () => {
    const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: agentEmail, password: agentPassword }),
    })
    const { access_token: agentToken } = (await login.json()) as { access_token: string }
    assert.ok(agentToken, 'agent login failed')

    for (const [id, data] of [
      [adminA!, { role: 'agent' }],
      [adminB!, { is_active: false }],
    ] as const) {
      const r = await patch(id, data, agentToken)
      const touched = Array.isArray(r.body) ? r.body.length : 0
      assert.ok(r.status >= 400 || touched === 0, `agent write must be refused (got ${r.status})`)
    }
    assert.equal((await activeAdmins()).length, 2)
  })
})
