'use client'

import * as React from 'react'
import { v4 as uuidv4 } from 'uuid'
import { Camera, ImagePlus, Loader2, UploadCloud, X } from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/hooks/use-toast'
import {
  compressImage,
  createPreviewURL,
  formatSize,
  revokePreviewURL,
} from '@/lib/fotos/compress'
import {
  deletePendingPhoto,
  getPhotosByEntity,
  savePendingPhoto,
} from '@/lib/db'
import type { PendingPhoto } from '@/lib/db/schema'
import { processQueue } from '@/lib/sync/queue'

export type PhotoEntityType = PendingPhoto['entity_type']

/** Summary of a single managed photo, emitted through `onPhotosChange`. */
export interface ManagedPhoto {
  id: string
  position: number
  sizeBytes: number
  status: PendingPhoto['status']
}

export interface PhotoUploadProps {
  entityId: string
  entityType: PhotoEntityType
  onPhotosChange?: (photos: ManagedPhoto[]) => void
  /** Hard cap on the number of photos. Default: 10. */
  maxPhotos?: number
}

type ItemStatus = 'compressing' | 'saved' | 'uploading' | 'synced' | 'error'

interface UploadItem {
  id: string
  previewUrl: string
  status: ItemStatus
  progress: number
  originalBytes: number
  compressedBytes: number
  error?: string
}

const DEFAULT_MAX_PHOTOS = 10

function toManagedStatus(status: ItemStatus): PendingPhoto['status'] {
  switch (status) {
    case 'synced':
      return 'synced'
    case 'uploading':
      return 'syncing'
    case 'error':
      return 'error'
    default:
      return 'pending'
  }
}

export function PhotoUpload({
  entityId,
  entityType,
  onPhotosChange,
  maxPhotos = DEFAULT_MAX_PHOTOS,
}: PhotoUploadProps) {
  const { toast } = useToast()
  const [items, setItems] = React.useState<UploadItem[]>([])
  const [isDragging, setIsDragging] = React.useState(false)

  const cameraInputRef = React.useRef<HTMLInputElement>(null)
  const galleryInputRef = React.useRef<HTMLInputElement>(null)

  // Mirror of `items` for use inside async callbacks and unmount cleanup.
  const itemsRef = React.useRef<UploadItem[]>([])
  React.useEffect(() => {
    itemsRef.current = items
  }, [items])

  // Load any photos already captured offline for this entity.
  React.useEffect(() => {
    let cancelled = false
    getPhotosByEntity(entityId).then((records) => {
      if (cancelled) return
      const loaded = records
        .slice()
        .sort((a, b) => a.position - b.position)
        .map<UploadItem>((record) => ({
          id: record.id,
          previewUrl: createPreviewURL(record.blob),
          status: record.status === 'error' ? 'error' : 'saved',
          progress: 100,
          originalBytes: record.size_bytes,
          compressedBytes: record.size_bytes,
          error: record.last_error ?? undefined,
        }))
      setItems(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [entityId])

  // Revoke every preview URL when the component unmounts.
  React.useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => {
        if (item.previewUrl) revokePreviewURL(item.previewUrl)
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

  const reconcileWithStore = React.useCallback(async () => {
    const stored = await getPhotosByEntity(entityId)
    const byId = new Map(stored.map((record) => [record.id, record]))
    setItems((prev) =>
      prev.map((item) => {
        const record = byId.get(item.id)
        if (!record) {
          // Gone from the pending store means the sync engine uploaded it.
          return { ...item, status: 'synced', progress: 100 }
        }
        if (record.status === 'error') {
          return { ...item, status: 'error', error: record.last_error ?? undefined }
        }
        return item
      }),
    )
  }, [entityId])

  const processFile = React.useCallback(
    async (file: File) => {
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
        },
      ])

      try {
        const blob = await compressImage(file)
        const previewUrl = createPreviewURL(blob)
        const position = itemsRef.current.length

        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  previewUrl,
                  compressedBytes: blob.size,
                  progress: 70,
                  status: 'saved',
                }
              : item,
          ),
        )

        const record: PendingPhoto = {
          id,
          entity_type: entityType,
          entity_id: entityId,
          blob,
          mime_type: blob.type || 'image/jpeg',
          size_bytes: blob.size,
          description: '',
          position,
          status: 'pending',
          sync_attempts: 0,
          last_error: null,
          created_at: new Date().toISOString(),
        }
        await savePendingPhoto(record)

        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, progress: 100 } : item,
          ),
        )

        if (typeof navigator !== 'undefined' && navigator.onLine) {
          setItems((prev) =>
            prev.map((item) =>
              item.id === id ? { ...item, status: 'uploading', progress: 90 } : item,
            ),
          )
          void processQueue()
            .then(reconcileWithStore)
            .catch(() => reconcileWithStore())
        }
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
    [entityId, entityType, reconcileWithStore, toast],
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
      await deletePendingPhoto(id)

      setItems((prev) => {
        const target = prev.find((item) => item.id === id)
        if (target?.previewUrl) revokePreviewURL(target.previewUrl)
        return prev.filter((item) => item.id !== id)
      })

      // Re-pack positions in the pending store so ordering stays contiguous.
      const remaining = await getPhotosByEntity(entityId)
      await Promise.all(
        remaining
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((record, index) =>
            record.position === index
              ? Promise.resolve()
              : savePendingPhoto({ ...record, position: index }),
          ),
      )
    },
    [entityId],
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
    case 'synced':
      return 'Sincronizada'
    case 'error':
      return item.error ?? 'Falha ao processar'
    default:
      return `${formatSize(item.originalBytes)} → ${formatSize(item.compressedBytes)} · aguardando sync`
  }
}
