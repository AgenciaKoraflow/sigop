/**
 * Server-side JPEG validation for `POST /api/fotos`. Kept free of imports so it
 * can be unit-tested with the Node test runner (`npm test`).
 *
 * The browser pipeline always re-encodes to JPEG, but a caller can skip it. The
 * Storage bucket only checks the *declared* Content-Type, so the real bytes are
 * checked here: the file must be a structurally valid baseline/progressive JPEG
 * (marker segments parse, a scan starts, it ends with EOI). Comment segments and
 * markup inside the header segments are refused to stop polyglot payloads
 * (JPEG + HTML/SVG/script) from being stored.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export type ServerPhotoValidation = { ok: true } | { ok: false; reason: string }

const MARKUP = [
  '<svg',
  '<html',
  '<script',
  '<?xml',
  '<!doctype',
  '<iframe',
  '<body',
  'javascript:',
  'mz\x90\x00',
]

function hasMarkup(bytes: Uint8Array, start: number, end: number): boolean {
  let text = ''
  for (let i = start; i < end; i++) text += String.fromCharCode(bytes[i])
  const lower = text.toLowerCase()
  return MARKUP.some((token) => lower.includes(token))
}

export function validateJpegBytes(bytes: Uint8Array): ServerPhotoValidation {
  if (bytes.length === 0) return { ok: false, reason: 'Arquivo vazio.' }
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, reason: 'Arquivo acima de 5 MB.' }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { ok: false, reason: 'O conteúdo não é um JPEG.' }
  }
  // EOI must close the file; trailing data after it is where polyglots hide.
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    return { ok: false, reason: 'JPEG truncado ou com dados após o fim da imagem.' }
  }

  let pos = 2
  let sawFrame = false
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) return { ok: false, reason: 'JPEG malformado.' }
    while (bytes[pos] === 0xff && pos < bytes.length) pos++ // fill bytes
    const marker = bytes[pos++]
    if (marker === undefined) return { ok: false, reason: 'JPEG malformado.' }

    if (marker === 0xd9) {
      return sawFrame && pos === bytes.length
        ? { ok: true }
        : { ok: false, reason: 'JPEG malformado.' }
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue // no length

    if (pos + 2 > bytes.length) return { ok: false, reason: 'JPEG malformado.' }
    const length = (bytes[pos] << 8) | bytes[pos + 1]
    if (length < 2 || pos + length > bytes.length) return { ok: false, reason: 'JPEG malformado.' }

    if (marker === 0xfe) return { ok: false, reason: 'Segmento de comentário não permitido.' }
    if (hasMarkup(bytes, pos + 2, pos + length)) {
      return { ok: false, reason: 'Conteúdo suspeito dentro do arquivo.' }
    }
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) sawFrame = true

    pos += length
    if (marker === 0xda) {
      if (!sawFrame) return { ok: false, reason: 'JPEG malformado.' }
      // Entropy-coded data: skip to the next real marker (FF followed by non-0, non-RSTn).
      while (pos < bytes.length - 1) {
        if (bytes[pos] === 0xff) {
          const next = bytes[pos + 1]
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break
        }
        pos++
      }
    }
  }
  return { ok: false, reason: 'JPEG malformado.' }
}
