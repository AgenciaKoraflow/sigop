'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, ImageOff, X } from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import type { PhotoEntityType } from './PhotoUpload'

/** A photo stored on the server, reachable through a (signed) URL. */
export interface RemotePhoto {
  id: string
  url: string
  description?: string | null
  sortOrder?: number | null
}

export interface PhotoGalleryProps {
  /** Kept for API symmetry with {@link PhotoUpload}; not read while rendering. */
  entityId?: string
  /** Kept for API symmetry with {@link PhotoUpload}; not read while rendering. */
  entityType?: PhotoEntityType
  /** Server-side photos, typically with Supabase signed URLs. */
  remotePhotos?: RemotePhoto[]
  className?: string
}

interface GalleryItem {
  id: string
  src: string
  description: string
}

export function PhotoGallery({ remotePhotos, className }: PhotoGalleryProps) {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null)

  const items = React.useMemo<GalleryItem[]>(
    () =>
      (remotePhotos ?? [])
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((photo) => ({
          id: photo.id,
          src: photo.url,
          description: photo.description ?? '',
        })),
    [remotePhotos],
  )

  const count = items.length

  const showPrev = React.useCallback(() => {
    setOpenIndex((current) =>
      current === null ? null : (current - 1 + count) % count,
    )
  }, [count])

  const showNext = React.useCallback(() => {
    setOpenIndex((current) => (current === null ? null : (current + 1) % count))
  }, [count])

  React.useEffect(() => {
    if (openIndex === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenIndex(null)
      if (event.key === 'ArrowLeft') showPrev()
      if (event.key === 'ArrowRight') showNext()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openIndex, showPrev, showNext])

  if (count === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-content-border bg-content-bg py-10 text-ink-muted',
          className,
        )}
      >
        <ImageOff className="h-6 w-6" />
        <p className="text-sm">Nenhuma foto</p>
      </div>
    )
  }

  const active = openIndex === null ? null : items[openIndex]

  return (
    <div className={className}>
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => setOpenIndex(index)}
              className="group relative block aspect-square w-full overflow-hidden rounded-md border border-content-border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.src}
                alt={item.description || `Foto ${index + 1}`}
                loading="lazy"
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
            </button>
          </li>
        ))}
      </ul>

      {/* Lightbox -------------------------------------------------------- */}
      {active && openIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Foto ${openIndex + 1} de ${count}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setOpenIndex(null)}
        >
          <button
            type="button"
            aria-label="Fechar"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            onClick={() => setOpenIndex(null)}
          >
            <X className="h-5 w-5" />
          </button>

          {count > 1 && (
            <>
              <button
                type="button"
                aria-label="Foto anterior"
                className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
                onClick={(event) => {
                  event.stopPropagation()
                  showPrev()
                }}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                aria-label="Próxima foto"
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
                onClick={(event) => {
                  event.stopPropagation()
                  showNext()
                }}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}

          <figure
            className="flex max-h-full max-w-4xl flex-col items-center gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.src}
              alt={active.description || `Foto ${openIndex + 1}`}
              className="max-h-[80vh] w-auto rounded-lg object-contain"
            />
            <figcaption className="flex items-center gap-2 text-xs text-white/80">
              <span>
                {openIndex + 1} / {count}
              </span>
              {active.description && <span>· {active.description}</span>}
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  )
}
