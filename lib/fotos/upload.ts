type PhotoEntityType = 'incident' | 'offender'

interface UploadPhotoInput {
  blob: Blob
  photoId: string
  entityType: PhotoEntityType
  entityId: string
  description?: string
  sortOrder?: number
}

/** Sends a photo through `POST /api/fotos` (server-side content validation). */
export async function uploadPhoto(input: UploadPhotoInput): Promise<string> {
  const form = new FormData()
  form.set('file', input.blob, `${input.photoId}.jpg`)
  form.set('photo_id', input.photoId)
  form.set('entity_type', input.entityType)
  form.set('entity_id', input.entityId)
  form.set('description', input.description ?? '')
  form.set('sort_order', String(input.sortOrder ?? 0))

  const response = await fetch('/api/fotos', { method: 'POST', body: form })
  const body = (await response.json().catch(() => null)) as
    | { storage_path?: string; error?: string }
    | null
  if (!response.ok || !body?.storage_path) {
    throw new Error(body?.error ?? 'Falha ao enviar a foto')
  }
  return body.storage_path
}
