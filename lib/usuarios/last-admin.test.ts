import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateAdminAccess } from './access.ts'
import {
  LAST_ADMIN_VIOLATION,
  isActiveAdministrator,
  isLastAdminViolation,
} from './last-admin.ts'

describe('isLastAdminViolation', () => {
  it('recognises the trigger message as PostgREST/Postgres reports it', () => {
    assert.equal(isLastAdminViolation({ message: LAST_ADMIN_VIOLATION }), true)
    assert.equal(isLastAdminViolation({ message: `Database error: ${LAST_ADMIN_VIOLATION}` }), true)
  })

  it('ignores every other error', () => {
    assert.equal(isLastAdminViolation({ message: 'duplicate key value violates unique constraint' }), false)
    assert.equal(isLastAdminViolation({ message: '' }), false)
    assert.equal(isLastAdminViolation(null), false)
    assert.equal(isLastAdminViolation(undefined), false)
  })
})

describe('isActiveAdministrator', () => {
  it('is true only for an active, non-deleted administrator', () => {
    assert.equal(isActiveAdministrator({ role: 'administrator', is_active: true, deleted_at: null }), true)
    assert.equal(isActiveAdministrator({ role: 'administrator' }), true)
    assert.equal(isActiveAdministrator({ role: 'administrator', is_active: false }), false)
    assert.equal(isActiveAdministrator({ role: 'administrator', deleted_at: '2026-01-01' }), false)
    assert.equal(isActiveAdministrator({ role: 'supervisor', is_active: true }), false)
    assert.equal(isActiveAdministrator({ role: 'agent', is_active: true }), false)
  })
})

describe('admin gate (common user calling the admin endpoints directly)', () => {
  const user = { app_metadata: {} }

  it('refuses agents and supervisors', () => {
    assert.equal(evaluateAdminAccess(user, { role: 'agent', is_active: true }), 'forbidden')
    assert.equal(evaluateAdminAccess(user, { role: 'supervisor', is_active: true }), 'forbidden')
  })

  it('refuses unauthenticated callers and missing profiles', () => {
    assert.equal(evaluateAdminAccess(null, null), 'unauthenticated')
    assert.equal(evaluateAdminAccess(user, null), 'forbidden')
  })

  it('refuses a deactivated or soft-deleted administrator', () => {
    assert.equal(evaluateAdminAccess(user, { role: 'administrator', is_active: false }), 'forbidden')
    assert.equal(evaluateAdminAccess(user, { role: 'administrator', deleted_at: '2026-01-01' }), 'forbidden')
  })

  it('lets an active administrator through', () => {
    assert.equal(evaluateAdminAccess(user, { role: 'administrator', is_active: true }), null)
  })
})
