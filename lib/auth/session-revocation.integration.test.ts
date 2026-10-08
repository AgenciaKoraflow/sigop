/**
 * Session revocation against a real Supabase project: for each revocation event
 * the session is probed BEFORE (must work) and AFTER (must be dead), on all three
 * surfaces a stolen token could use:
 *   - Auth server   GET  /auth/v1/user                 (what middleware.ts calls)
 *   - refresh       POST /auth/v1/token?grant_type=refresh_token
 *   - PostgREST/RLS POST /rest/v1/rpc/account_usable   (needs sql/020 + sql/032)
 *
 * The events replay the exact Admin API + `revoke_user_sessions` sequence used by
 * the Route Handlers (usuarios/[id], usuarios/[id]/reset-password,
 * auth/reset-password, auth/change-password), so a regression in the primitives
 * or in the SQL gate shows up here.
 *
 * Needs a TEST project (never production); it creates and deletes its own
 * throw-away users. Skipped unless these are set:
 *   SESSION_TEST_URL, SESSION_TEST_ANON_KEY, SESSION_TEST_SERVICE_KEY
 * Run: node --test lib/auth/session-revocation.integration.test.ts
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { after, describe, it } from 'node:test'

const url = process.env.SESSION_TEST_URL
const anonKey = process.env.SESSION_TEST_ANON_KEY
const serviceKey = process.env.SESSION_TEST_SERVICE_KEY
const configured = Boolean(url && anonKey && serviceKey)

const PASSWORD = 'Sess!on-Test-9876'
const createdUsers: string[] = []

const json = { 'Content-Type': 'application/json' }
const svc = () => ({ apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, ...json })
const usr = (token: string) => ({ apikey: anonKey!, Authorization: `Bearer ${token}`, ...json })

interface Tokens {
  access_token: string
  refresh_token: string
}

async function createUser(role: 'agent' | 'supervisor' | 'administrator' = 'agent') {
  const email = `session-test-${randomBytes(6).toString('hex')}@example.test`
  const token = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(token, 'utf8').digest('hex')

  const ticket = await fetch(`${url}/rest/v1/user_provisioning_tickets`, {
    method: 'POST',
    headers: svc(),
    body: JSON.stringify({ token_hash: `\\x${hash}`, email, role }),
  })
  assert.ok(ticket.ok, `ticket failed: ${await ticket.text()}`)

  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: svc(),
    body: JSON.stringify({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Session Test', provision_token: token },
    }),
  })
  const body = (await res.json()) as { id?: string }
  assert.ok(body.id, `createUser failed: ${JSON.stringify(body)}`)
  createdUsers.push(body.id)
  return { id: body.id, email }
}

async function login(email: string, password = PASSWORD) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey!, ...json },
    body: JSON.stringify({ email, password }),
  })
  return { status: res.status, tokens: (await res.json()) as Tokens }
}

async function mustLogin(email: string) {
  const { status, tokens } = await login(email)
  assert.equal(status, 200, 'login must succeed')
  return tokens
}

const authUserStatus = async (access: string) =>
  (await fetch(`${url}/auth/v1/user`, { headers: usr(access) })).status

const refreshStatus = async (refresh: string) =>
  (
    await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: anonKey!, ...json },
      body: JSON.stringify({ refresh_token: refresh }),
    })
  ).status

/** RLS view of the token: TRUE only for a live session of a usable account. */
async function rlsUsable(access: string): Promise<boolean> {
  const res = await fetch(`${url}/rest/v1/rpc/account_usable`, {
    method: 'POST',
    headers: usr(access),
    body: '{}',
  })
  return res.ok && (await res.json()) === true
}

async function myRole(access: string): Promise<string | null> {
  const res = await fetch(`${url}/rest/v1/rpc/my_role`, {
    method: 'POST',
    headers: usr(access),
    body: '{}',
  })
  return res.ok ? ((await res.json()) as string | null) : null
}

const revoke = (id: string) =>
  fetch(`${url}/rest/v1/rpc/revoke_user_sessions`, {
    method: 'POST',
    headers: svc(),
    body: JSON.stringify({ p_user: id }),
  })

const adminUpdate = (id: string, body: object) =>
  fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'PUT', headers: svc(), body: JSON.stringify(body) })

const patchProfile = (id: string, body: object) =>
  fetch(`${url}/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', headers: svc(), body: JSON.stringify(body) })

async function assertAlive(t: Tokens, label: string) {
  assert.equal(await authUserStatus(t.access_token), 200, `${label}: Auth getUser must accept`)
  assert.equal(await rlsUsable(t.access_token), true, `${label}: RLS must accept`)
}

async function assertDead(t: Tokens, label: string) {
  assert.notEqual(await authUserStatus(t.access_token), 200, `${label}: Auth getUser must refuse`)
  assert.equal(await rlsUsable(t.access_token), false, `${label}: RLS must refuse the old access token`)
  assert.notEqual(await refreshStatus(t.refresh_token), 200, `${label}: refresh token must be dead`)
}

describe('session revocation (live Auth + RLS)', { skip: !configured && 'SESSION_TEST_* not set' }, () => {
  after(async () => {
    for (const id of createdUsers) {
      await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svc() })
    }
  })

  it('logout (global) kills the access and refresh token', async () => {
    const u = await createUser()
    const a = await mustLogin(u.email)
    const b = await mustLogin(u.email) // second device
    await assertAlive(a, 'before')
    await assertAlive(b, 'before (device 2)')

    const out = await fetch(`${url}/auth/v1/logout?scope=global`, { method: 'POST', headers: usr(a.access_token) })
    assert.ok(out.ok)

    await assertDead(a, 'after logout')
    await assertDead(b, 'after logout (device 2)')
  })

  it('logout scope=others keeps the caller and kills the rest (password-change flow)', async () => {
    const u = await createUser()
    const mine = await mustLogin(u.email)
    const stolen = await mustLogin(u.email)
    await assertAlive(mine, 'before')
    await assertAlive(stolen, 'before (other)')

    const out = await fetch(`${url}/auth/v1/logout?scope=others`, { method: 'POST', headers: usr(mine.access_token) })
    assert.ok(out.ok)

    await assertAlive(mine, 'caller survives')
    await assertDead(stolen, 'other session')
  })

  it('password change / reset revokes old sessions; old password stops working', async () => {
    const u = await createUser()
    const old = await mustLogin(u.email)
    await assertAlive(old, 'before')

    assert.ok((await adminUpdate(u.id, { password: `${PASSWORD}-new` })).ok)
    assert.ok((await revoke(u.id)).ok)

    await assertDead(old, 'after password change')
    assert.notEqual((await login(u.email, PASSWORD)).status, 200, 'old password must fail')
    assert.equal((await login(u.email, `${PASSWORD}-new`)).status, 200, 'new password works')
  })

  it('deactivation (ban + revoke) blocks login and kills sessions', async () => {
    const u = await createUser()
    const old = await mustLogin(u.email)
    await assertAlive(old, 'before')

    assert.ok((await adminUpdate(u.id, { ban_duration: '876000h' })).ok)
    assert.ok((await patchProfile(u.id, { is_active: false })).ok)
    assert.ok((await revoke(u.id)).ok)

    await assertDead(old, 'after deactivation')
    assert.notEqual((await login(u.email)).status, 200, 'banned user cannot log in')

    // Reactivation restores access (new login only; the old session stays dead).
    assert.ok((await adminUpdate(u.id, { ban_duration: 'none' })).ok)
    assert.ok((await patchProfile(u.id, { is_active: true })).ok)
    await assertDead(old, 'old session after reactivation')
    await assertAlive(await mustLogin(u.email), 'fresh login after reactivation')
  })

  it('deactivation WITHOUT revoke is still cut off by RLS (account_usable)', async () => {
    const u = await createUser()
    const old = await mustLogin(u.email)
    assert.ok((await patchProfile(u.id, { is_active: false })).ok)
    assert.equal(await rlsUsable(old.access_token), false)
  })

  it('deletion kills sessions', async () => {
    const u = await createUser()
    const old = await mustLogin(u.email)
    await assertAlive(old, 'before')

    const del = await fetch(`${url}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: svc() })
    assert.ok(del.ok)
    await revoke(u.id)

    await assertDead(old, 'after deletion')
    assert.notEqual((await login(u.email)).status, 200, 'deleted user cannot log in')
  })

  it('role change revokes sessions; the new login carries the new role', async () => {
    const u = await createUser('agent')
    const old = await mustLogin(u.email)
    await assertAlive(old, 'before')
    assert.equal(await myRole(old.access_token), 'agent')

    assert.ok((await patchProfile(u.id, { role: 'supervisor' })).ok)
    assert.ok((await revoke(u.id)).ok)

    await assertDead(old, 'after role change')
    assert.equal(await myRole(old.access_token), null, 'old token resolves no role')
    const fresh = await mustLogin(u.email)
    assert.equal(await myRole(fresh.access_token), 'supervisor')
  })

  it('refresh-token rotation: a used refresh token cannot be replayed', { timeout: 60_000 }, async () => {
    const u = await createUser()
    const first = await mustLogin(u.email)

    const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: anonKey!, ...json },
      body: JSON.stringify({ refresh_token: first.refresh_token }),
    })
    assert.equal(res.status, 200)
    const second = (await res.json()) as Tokens
    assert.notEqual(second.refresh_token, first.refresh_token, 'refresh token must rotate')
    await assertAlive(second, 'rotated session')

    // Auth tolerates a replay inside the reuse interval (default 10 s) for
    // flaky networks; past it, a replay is theft and must fail.
    await new Promise((r) => setTimeout(r, 12_000))
    assert.notEqual(
      await refreshStatus(first.refresh_token),
      200,
      'replaying a rotated refresh token must fail — enable "Detect and revoke potentially compromised refresh tokens" in Auth settings',
    )
  })
})
