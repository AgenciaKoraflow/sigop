/**
 * Upload validation for photos. Kept free of imports so it can be unit-tested
 * with the Node test runner (`npm test`).
 *
 * The MIME type and file name a browser reports are attacker-controlled, so the
 * decision is made on the file's leading bytes ("magic numbers"). Only raster
 * formats the canvas pipeline can re-encode are accepted; SVG/HTML/anything
 * else is rejected even when it is labelled `image/*`.
 */

/** Largest file we are willing to decode in the browser (before compression). */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024

export type DetectedImageType = 'jpeg' | 'png' | 'webp' | 'heic'

export type PhotoValidation =
  | { ok: true; type: DetectedImageType }
  | { ok: false; reason: string }

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((value, index) => bytes[offset + index] === value)
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = ''
  for (let i = start; i < end && i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'])

/** Identify an image from its first bytes; `null` when it is not an allowed type. */
export function detectImageType(head: Uint8Array): DetectedImageType | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'webp'
  if (ascii(head, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(head, 8, 12))) return 'heic'
  return null
}

/** Validate size and real content of a user-selected file. */
export async function validatePhotoFile(file: Blob): Promise<PhotoValidation> {
  if (file.size === 0) return { ok: false, reason: 'Arquivo vazio' }
  if (file.size > MAX_INPUT_BYTES) {
    return { ok: false, reason: 'Arquivo muito grande (máximo 25 MB)' }
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const type = detectImageType(head)
  if (!type) return { ok: false, reason: 'Formato não suportado. Use JPEG, PNG, WebP ou HEIC' }
  return { ok: true, type }
}
