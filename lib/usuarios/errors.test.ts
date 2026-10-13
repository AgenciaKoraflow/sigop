import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeAuthError, describeBadgeTaken, describeEmailTaken } from './errors.ts'

describe('describeAuthError', () => {
  it('maps duplicate e-mail by code and by message', () => {
    const byCode = describeAuthError({ code: 'email_exists' }, 'x')
    assert.equal(byCode.status, 409)
    assert.equal(byCode.code, 'email_exists')

    const byMessage = describeAuthError(
      { message: 'A user with this email address has already been registered' },
      'x',
    )
    assert.equal(byMessage.status, 409)
  })

  it('maps password and rate-limit failures', () => {
    assert.equal(describeAuthError({ code: 'weak_password' }, 'x').status, 400)
    assert.match(describeAuthError({ code: 'same_password' }, 'x').error, /diferente da atual/)
    assert.equal(describeAuthError({ code: 'over_request_rate_limit' }, 'x').status, 429)
  })

  it('flags the profile trigger failure', () => {
    const failure = describeAuthError({ message: 'Database error creating new user' }, 'x')
    assert.equal(failure.status, 500)
    assert.equal(failure.code, 'profile_trigger')
  })

  it('falls back for anything unknown', () => {
    assert.deepEqual(describeAuthError({ code: 'boom' }, 'Falha ao criar o usuário.'), {
      error: 'Falha ao criar o usuário.',
      status: 400,
    })
  })
})

describe('describeEmailTaken', () => {
  const base = { id: 'u1', full_name: 'Maria Silva', is_active: true, deleted_at: null }

  it('names an active owner', () => {
    assert.match(describeEmailTaken(base).error, /Maria Silva/)
  })

  it('tells an inactive owner apart', () => {
    assert.equal(describeEmailTaken({ ...base, is_active: false }).code, 'email_inactive')
  })

  it('tells a deleted owner apart', () => {
    const deleted = { ...base, deleted_at: '2026-10-07T16:45:24Z' }
    assert.equal(describeEmailTaken(deleted).code, 'email_deleted')
  })

  it('handles a login with no profile', () => {
    assert.equal(describeEmailTaken(null).code, 'email_orphan')
  })
})

describe('describeBadgeTaken', () => {
  it('names the holder when known', () => {
    assert.equal(
      describeBadgeTaken('1234', { full_name: 'João' }).error,
      'A matrícula 1234 já está em uso por João.',
    )
    assert.match(describeBadgeTaken('1234', null).error, /outro usuário/)
  })
})
