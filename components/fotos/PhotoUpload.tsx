'use client'

import * as React from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Camera, ImagePlus, Loader2, UploadCloud, X } from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import { useCurrentUser } from '@/hooks/use-current-user'
import {
  compressImage,
  createPreviewURL,
  formatSize,
  revokePreviewURL,
} from '@/lib/fotos/compress'
import { PHOTO_BUCKET, signPhotoUrls } from '@/lib/fotos/urls'

export type PhotoEntityType = 'incident' | 'offender'

/** Summary of a single managed photo, emitted through `onPhotosChange`. */
export interface ManagedPhoto {
  id: string
  position: number
  sizeBytes: number
  status: 'uploading' | 'done' | 'error'
}

export interface PhotoUploadProps {
  entityId: string
  entityType: PhotoEntityType
  onPhotosChange?: (photos: ManagedPhoto[]) => void
  /** Hard cap on the number of photos. Default: 10. */
  maxPhotos?: number
  /**
   * First `position` (a.k.a. `sort_order`) assigned to photos managed here.
   * Use `1` when another control owns the position-`0` "main" photo. Default: 0.
   */
  startPosition?: number
  /**
   * Photo id to hide from this uploader (e.g. the "main" photo managed by a
   * sibling control that writes to the same entity).
   */
  excludeId?: string
}

type ItemStatus = 'compressing' | 'uploading' | 'done' | 'error'

interface UploadItem {
  id: string
  previewUrl: string
  status: ItemStatus
  progress: number
  originalBytes: number
  compressedBytes: number
  storagePath: string | null
  error?: string
}

const DEFAULT_MAX_PHOTOS = 10

function untyped(): SupabaseClient {
  return createClient() as unknown as SupabaseClient
}

function objectPathFor(userId: string, entityType: PhotoEntityType, entityId: string, id: string) {
  return `${userId}/${entityType}/${entityId}/${id}.jpg`
}

async function loadExistingPhotos(
  entityType: PhotoEntityType,
  entityId: string,
): Promise<UploadItem[]> {
  const supabase = untyped()
  const { data } = await supabase
    .from('photos')
    .select('id, storage_path, size_bytes, sort_order')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('sort_order', { ascending: true })

  const rows = (data ?? []) as {
    id: string
    storage_path: string | null
    size_bytes: number | null
    sort_order: number | null
  }[]

  const signedUrls = await signPhotoUrls(supabase, rows.map((row) => row.storage_path))

  return rows
    .filter((row) => row.storage_path && signedUrls.has(row.storage_path))
    .map((row) => ({
      id: row.id,
      previewUrl: signedUrls.get(row.storage_path as string) as string,
      status: 'done' as const,
      progress: 100,
      originalBytes: row.size_bytes ?? 0,
      compressedBytes: row.size_bytes ?? 0,
      storagePath: row.storage_path,
    }))
}

function toManagedStatus(status: ItemStatus): ManagedPhoto['status'] {
  return status === 'error' ? 'error' : status === 'done' ? 'done' : 'uploading'
}

export function PhotoUpload({
  entityId,
  entityType,
  onPhotosChange,
  maxPhotos = DEFAULT_MAX_PHOTOS,
  startPosition = 0,
  excludeId,
}: PhotoUploadProps) {
  const { toast } = useToast()
  const { user } = useCurrentUser()
  const [items, setItems] = React.useState<UploadItem[]>([])
  const [isDragging, setIsDragging] = React.useState(false)

  const cameraInputRef = React.useRef<HTMLInputElement>(null)
  const galleryInputRef = React.useRef<HTMLInputElement>(null)

  // Mirror of `items` for use inside async callbacks and unmount cleanup.
  const itemsRef = React.useRef<UploadItem[]>([])
  React.useEffect(() => {
    itemsRef.current = items
  }, [items])

  // Load photos already uploaded for this entity.
  React.useEffect(() => {
    let cancelled = false
    loadExistingPhotos(entityType, entityId).then((loaded) => {
      if (cancelled) return
      setItems(loaded.filter((item) => item.id !== excludeId))
    })
    return () => {
      cancelled = true
    }
  }, [entityId, entityType, excludeId])

  // Revoke locally-created preview URLs (compression previews) on unmount.
  React.useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => {
        if (item.previewUrl && !item.storagePath) revokePreviewURL(item.previewUrl)
      })
    }
  }, [])

  // Notify the parent whenever the set of photos changes.
  React.useEffect(() => {
    onPhotosChange?.(
      items.map((item, index) => ({
        id: item.id,
        position: index,
        sizeBytes: item.compressedBytes,
        status: toManagedStatus(item.status),
      })),
    )
  }, [items, onPhotosChange])

  const processFile = React.useCallback(
    async (file: File) => {
      if (!user) {
        toast({ title: 'Aguarde o carregamento do perfil', variant: 'destructive' })
        return
      }

      const id = uuidv4()
      const originalBytes = file.size

      setItems((prev) => [
        ...prev,
        {
          id,
          previewUrl: '',
          status: 'compressing',
          progress: 15,
          originalBytes,
          compressedBytes: 0,
          storagePath: null,
        },
      ])

      try {
        const blob = await compressImage(file)
        const previewUrl = createPreviewURL(blob)
        const position = itemsRef.current.length + startPosition

        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, previewUrl, compressedBytes: blob.size, progress: 55, status: 'uploading' }
              : item,
          ),
        )

        const objectPath = objectPathFor(user.id, entityType, entityId, id)
        const supabase = untyped()

        const { error: uploadError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(objectPath, blob, { contentType: blob.type || 'image/jpeg', upsert: true })
        if (uploadError) throw new Error(uploadError.message)

        const { error: dbError } = await supabase.from('photos').upsert(
          {
            id,
            storage_path: objectPath,
            public_url: null,
            entity_type: entityType,
            entity_id: entityId,
            description: '',
            sort_order: position,
            size_bytes: blob.size,
            mime_type: blob.type || 'image/jpeg',
            created_by: user.id,
          },
          { onConflict: 'id' },
        )
        if (dbError) throw new Error(dbError.message)

        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, status: 'done', progress: 100, storagePath: objectPath }
              : item,
          ),
        )
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Falha ao processar a imagem'
        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, status: 'error', error: message, progress: 100 }
              : item,
          ),
        )
        toast({
          title: 'Erro ao adicionar foto',
          description: message,
          variant: 'destructive',
        })
      }
    },
    [entityId, entityType, startPosition, toast, user],
  )

  const handleFiles = React.useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return
      const images = Array.from(fileList).filter((file) =>
        file.type.startsWith('image/'),
      )
      const slotsLeft = maxPhotos - itemsRef.current.length

      if (slotsLeft <= 0) {
        toast({
          title: 'Limite de fotos atingido',
          description: `Máximo de ${maxPhotos} fotos por registro.`,
          variant: 'destructive',
        })
        return
      }

      const selected = images.slice(0, slotsLeft)
      if (images.length > slotsLeft) {
        toast({
          title: 'Algumas fotos foram ignoradas',
          description: `O limite é de ${maxPhotos} fotos por registro.`,
        })
      }

      for (const file of selected) {
        // Sequential so `position` stays stable and the UI updates in order.
        // eslint-disable-next-line no-await-in-loop
        await processFile(file)
      }
    },
    [maxPhotos, processFile, toast],
  )

  const removePhoto = React.useCallback(
    async (id: string) => {
      const target = itemsRef.current.find((item) => item.id === id)
      setItems((prev) => {
        if (target?.previewUrl && !target.storagePath) revokePreviewURL(target.previewUrl)
        return prev.filter((item) => item.id !== id)
      })

      const supabase = untyped()
      if (target?.storagePath) {
        await supabase.storage.from(PHOTO_BUCKET).remove([target.storagePath])
      }
      await supabase.from('photos').delete().eq('id', id)

      // Re-pack sort_order for the remaining photos so ordering stays contiguous.
      const remaining = itemsRef.current.filter((item) => item.id !== id)
      await Promise.all(
        remaining.map((item, index) =>
          supabase.from('photos').update({ sort_order: index + startPosition }).eq('id', item.id),
        ),
      )
    },
    [startPosition],
  )

  const atLimit = items.length >= maxPhotos

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">Fotos</span>
        <Badge variant={atLimit ? 'error' : 'secondary'}>
          {items.length}/{maxPhotos} fotos
        </Badge>
      </div>

      {/* Drag-and-drop area ------------------------------------------------ */}
      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!atLimit) setIsDragging(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          setIsDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          if (!atLimit) void handleFiles(event.dataTransfer.files)
        }}
        className={cn(
          'rounded-lg border-2 border-dashed p-6 text-center transition-colors',
          isDragging
            ? 'border-brand bg-brand-light'
            : 'border-content-border bg-content-bg',
          atLimit && 'pointer-events-none opacity-60',
        )}
      >
        <UploadCloud className="mx-auto h-8 w-8 text-ink-muted" />
        <p className="mt-2 text-sm text-ink-secondary">
          Arraste fotos aqui ou use os botões abaixo
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={atLimit}
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera className="mr-1.5 h-4 w-4" />
            Tirar foto
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={atLimit}
            onClick={() => galleryInputRef.current?.click()}
          >
            <ImagePlus className="mr-1.5 h-4 w-4" />
            Galeria
          </Button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            void handleFiles(event.target.files)
            event.target.value = ''
          }}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {/* Preview grid ---------------------------------------------------- */}
      {items.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {items.map((item, index) => (
            <li key={item.id} className="space-y-1">
              <div className="group relative aspect-square overflow-hidden rounded-md border border-content-border bg-muted">
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.previewUrl}
                    alt={`Foto ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
                  </div>
                )}

                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                  {index + 1}
                </span>

                <button
                  type="button"
                  onClick={() => void removePhoto(item.id)}
                  aria-label={`Remover foto ${index + 1}`}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>

                {(item.status === 'compressing' || item.status === 'uploading') && (
                  <Progress
                    value={item.progress}
                    className="absolute inset-x-0 bottom-0 h-1 rounded-none"
                  />
                )}
              </div>

              <p
                className={cn(
                  'text-[11px] leading-tight',
                  item.status === 'error' ? 'text-danger' : 'text-ink-secondary',
                )}
              >
                {captionFor(item)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function captionFor(item: UploadItem): string {
  switch (item.status) {
    case 'compressing':
      return 'Comprimindo...'
    case 'uploading':
      return 'Enviando...'
    case 'done':
      return 'Enviada'
    case 'error':
      return item.error ?? 'Falha ao processar'
    default:
      return formatSize(item.compressedBytes)
  }
}
