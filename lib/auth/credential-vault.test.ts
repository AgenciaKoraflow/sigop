import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decryptProvisionalPassword, encryptProvisionalPassword } from './credential-vault.ts'

const KEY = Buffer.alloc(32, 7).toString('base64')
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64')
const USER = '11111111-1111-4111-8111-111111111111'

describe('credential vault', () => {
  it('round-trips a password', async () => {
    const stored = await encryptProvisionalPassword('Abc23456789xyz', USER, KEY)
    assert.equal(await decryptProvisionalPassword(stored, USER, KEY), 'Abc23456789xyz')
  })

  it('never stores the plaintext and uses a fresh IV each time', async () => {
    const a = await encryptProvisionalPassword('Abc23456789xyz', USER, KEY)
    const b = await encryptProvisionalPassword('Abc23456789xyz', USER, KEY)
    assert.equal(a.includes('Abc23456789xyz'), false)
    assert.notEqual(a, b)
  })

  it('refuses a ciphertext moved to another user', async () => {
    const stored = await encryptProvisionalPassword('Abc23456789xyz', USER, KEY)
    assert.equal(
      await decryptProvisionalPassword(stored, '22222222-2222-4222-8222-222222222222', KEY),
      null,
    )
  })

  it('refuses a wrong key, garbage and tampering', async () => {
    const stored = await encryptProvisionalPassword('Abc23456789xyz', USER, KEY)
    assert.equal(await decryptProvisionalPassword(stored, USER, OTHER_KEY), null)
    assert.equal(await decryptProvisionalPassword('nope', USER, KEY), null)
    assert.equal(await decryptProvisionalPassword(stored.slice(0, -2) + 'AA', USER, KEY), null)
  })

  it('rejects a missing or short key', async () => {
    await assert.rejects(encryptProvisionalPassword('x', USER, undefined))
    await assert.rejects(encryptProvisionalPassword('x', USER, Buffer.alloc(8).toString('base64')))
  })
})
