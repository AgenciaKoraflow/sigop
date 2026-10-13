/**
 * Reversible encryption for provisional passwords (sql/033). AES-256-GCM with a
 * server-only key — isomorphic-free (Web Crypto only) so it is unit testable.
 *
 * Stored format: `v1.<iv b64url>.<ciphertext+tag b64url>`. The user id is bound
 * as additional authenticated data, so a ciphertext copied to another row fails
 * to decrypt.
 */

const VERSION = 'v1'

function toB64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function fromB64Url(value: string): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.from(value, 'base64url')
  const out = new Uint8Array(buffer.length)
  out.set(buffer)
  return out
}

async function importKey(rawKey: string | undefined): Promise<CryptoKey> {
  if (!rawKey) throw new Error('PROVISIONAL_CREDENTIALS_KEY is not set')
  const bytes = Buffer.from(rawKey, 'base64')
  if (bytes.length !== 32) {
    throw new Error('PROVISIONAL_CREDENTIALS_KEY must be 32 bytes, base64 (openssl rand -base64 32)')
  }
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptProvisionalPassword(
  plaintext: string,
  userId: string,
  rawKey: string | undefined = process.env.PROVISIONAL_CREDENTIALS_KEY,
): Promise<string> {
  const key = await importKey(rawKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(userId) },
    key,
    new TextEncoder().encode(plaintext),
  )
  return `${VERSION}.${toB64Url(iv)}.${toB64Url(new Uint8Array(encrypted))}`
}

/** Returns `null` when the value is malformed, tampered with, or bound to another user. */
export async function decryptProvisionalPassword(
  stored: string,
  userId: string,
  rawKey: string | undefined = process.env.PROVISIONAL_CREDENTIALS_KEY,
): Promise<string | null> {
  const [version, iv, data] = stored.split('.')
  if (version !== VERSION || !iv || !data) return null
  try {
    const key = await importKey(rawKey)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64Url(iv), additionalData: new TextEncoder().encode(userId) },
      key,
      fromB64Url(data),
    )
    return new TextDecoder().decode(decrypted)
  } catch {
    return null
  }
}
