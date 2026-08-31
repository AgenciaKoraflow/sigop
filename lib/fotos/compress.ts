/**
 * Client-side image compression for SIGOP.
 *
 * Rules enforced here:
 *  - Photos are always handled as `Blob`, never base64.
 *  - Compression runs before a photo is persisted to IndexedDB or uploaded.
 *
 * Identifiers are kept in English to match the rest of the codebase; only
 * user-facing error messages stay in Portuguese.
 */

export interface CompressionOptions {
  /** Maximum output width in pixels. Default: 1200. */
  maxWidth?: number
  /** Maximum output height in pixels. Default: 1200. */
  maxHeight?: number
  /** JPEG quality between 0 and 1. Default: 0.82. */
  quality?: number
  /** Upper bound for the output size in megabytes. Default: 5. */
  maxSizeMB?: number
}

const DEFAULTS = {
  maxWidth: 1200,
  maxHeight: 1200,
  quality: 0.82,
  maxSizeMB: 5,
} as const

/** Lowest quality we will drop to while trying to satisfy `maxSizeMB`. */
const MIN_QUALITY = 0.4
/** Quality decrement applied on each re-encode attempt. */
const QUALITY_STEP = 0.1

/**
 * Compress and downscale an image, returning a JPEG `Blob`.
 *
 * The source is drawn onto a canvas scaled to fit within `maxWidth`/`maxHeight`
 * (aspect ratio preserved, never upscaled). If the encoded result is larger
 * than `maxSizeMB`, quality is reduced step by step down to `MIN_QUALITY`.
 */
export async function compressImage(
  file: File | Blob,
  options: CompressionOptions = {},
): Promise<Blob> {
  const {
    maxWidth = DEFAULTS.maxWidth,
    maxHeight = DEFAULTS.maxHeight,
    quality = DEFAULTS.quality,
    maxSizeMB = DEFAULTS.maxSizeMB,
  } = options

  const maxBytes = maxSizeMB * 1024 * 1024
  const image = await loadImageElement(file)

  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  const { width, height } = scaleToFit(sourceWidth, sourceHeight, maxWidth, maxHeight)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D não é suportado neste dispositivo')
  }
  ctx.drawImage(image, 0, 0, width, height)

  let currentQuality = quality
  let blob = await canvasToBlob(canvas, currentQuality)

  while (blob.size > maxBytes && currentQuality > MIN_QUALITY) {
    currentQuality = Math.max(MIN_QUALITY, currentQuality - QUALITY_STEP)
    blob = await canvasToBlob(canvas, currentQuality)
  }

  return blob
}

/** Human-readable byte size, e.g. `842 B`, `12.3 KB`, `1.4 MB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Create an object URL for previewing a blob in an `<img>`. */
export function createPreviewURL(blob: Blob): string {
  return URL.createObjectURL(blob)
}

/** Release an object URL created by {@link createPreviewURL}. */
export function revokePreviewURL(url: string): void {
  URL.revokeObjectURL(url)
}

// =============================================
// Internal helpers
// =============================================

function loadImageElement(source: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não foi possível carregar a imagem'))
    }

    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Falha ao comprimir a imagem'))
          return
        }
        resolve(blob)
      },
      'image/jpeg',
      quality,
    )
  })
}

function scaleToFit(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height }
  }
  const ratio = Math.min(maxWidth / width, maxHeight / height)
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  }
}
