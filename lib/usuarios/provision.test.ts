import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateAdminAccess } from './access.ts'
import { buildProvisionedUserAttributes, generateProvisionToken, sha256Hex } from './provision.ts'

describe('buildProvisionedUserAttributes', () => {
  const attrs = buildProvisionedUserAttributes({
    fullName: 'Fulano',
    token: 'a'.repeat(64),
    mustChangePasswordFlag: 'must_change_password',
  })

  it('never carries a role in user_metadata or app_metadata', () => {
    assert.equal('role' in attrs.user_metadata, false)
    assert.equal('role' in attrs.app_metadata, false)
  })

  it('forces the first-login password change', () => {
    assert.equal(attrs.app_metadata.must_change_password, true)
  })
})

describe('provision token', () => {
  it('is 256-bit hex and unique', () => {
    const a = generateProvisionToken()
    assert.match(a, /^[0-9a-f]{64}$/)
    assert.notEqual(a, generateProvisionToken())
  })

  it('hashes like Postgres sha256()', async () => {
    // sha256('abc') — well-known vector
    assert.equal(
      await sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('evaluateAdminAccess (requireAdmin decision)', () => {
  const admin = { role: 'administrator', is_active: true, deleted_at: null }

  it('lets an active, usable administrator create users', () => {
    assert.equal(evaluateAdminAccess({ app_metadata: {} }, admin), null)
  })

  it('refuses anonymous callers', () => {
    assert.equal(evaluateAdminAccess(null, null), 'unauthenticated')
  })

  it('refuses a regular user (agent / supervisor)', () => {
    for (const role of ['agent', 'supervisor']) {
      assert.equal(evaluateAdminAccess({ app_metadata: {} }, { ...admin, role }), 'forbidden')
    }
  })

  it('ignores a self-declared role in user_metadata / app_metadata', () => {
    const user = { app_metadata: { role: 'administrator' }, user_metadata: { role: 'administrator' } }
    assert.equal(evaluateAdminAccess(user, { ...admin, role: 'agent' }), 'forbidden')
    assert.equal(evaluateAdminAccess(user, null), 'forbidden')
  })

  it('refuses deactivated, deleted, or provisional-password admins', () => {
    assert.equal(evaluateAdminAccess({}, { ...admin, is_active: false }), 'forbidden')
    assert.equal(evaluateAdminAccess({}, { ...admin, deleted_at: '2026-10-07' }), 'forbidden')
    assert.equal(
      evaluateAdminAccess({ app_metadata: { must_change_password: true } }, admin),
      'must_change_password',
    )
  })
})
