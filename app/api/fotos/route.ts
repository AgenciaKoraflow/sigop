import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminUnavailable, serverError } from '@/lib/api/errors'
import { isSameOriginRequest, isUuid } from '@/lib/api/request-guards'
import { validateJpegBytes, MAX_UPLOAD_BYTES } from '@/lib/fotos/server-validate'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const BUCKET = 'operational-photos'

const fail = (error: string, status: number) => NextResponse.json({ error }, { status })

/**
 * POST /api/fotos — the only way a photo reaches Storage.
 *
 * multipart/form-data: `file`, `photo_id`, `entity_type` (incident|offender),
 * `entity_id`, optional `description`, `sort_order`.
 *
 * Direct Storage INSERT is closed to browsers (sql/031): this handler checks the
 * real bytes (JPEG structure, not the declared MIME or extension), derives the
 * object path from the session (never from the request), lets RLS decide whether
 * the caller may attach to the entity (author / unit scope), then writes the
 * object with the service role.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(await headers())) return fail('Requisição inválida.', 403)

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return fail('Arquivo acima de 5 MB.', 413)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('Não autenticado.', 401)
  if (user.app_metadata?.must_change_password === true) {
    return fail('Troque a senha provisória antes de continuar.', 403)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail('Requisição inválida.', 400)
  }

  const file = form.get('file')
  const photoId = form.get('photo_id')
  const entityType = form.get('entity_type')
  const entityId = form.get('entity_id')
  const description = String(form.get('description') ?? '').slice(0, 500)
  const sortOrder = Number.parseInt(String(form.get('sort_order') ?? '0'), 10)

  if (!(file instanceof Blob)) return fail('Arquivo ausente.', 400)
  if (!isUuid(photoId) || !isUuid(entityId)) return fail('Identificador inválido.', 400)
  if (entityType !== 'incident' && entityType !== 'offender') return fail('Tipo de entidade inválido.', 400)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000) return fail('Ordem inválida.', 400)
  if (file.size > MAX_UPLOAD_BYTES) return fail('Arquivo acima de 5 MB.', 413)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const check = validateJpegBytes(bytes)
  if (!check.ok) return fail(check.reason, 415)

  const storagePath = `${user.id}/${entityType}/${entityId}/${photoId}.jpg`
  const db = supabase as unknown as SupabaseClient

  // Row first, with the caller's own session: RLS (can_attach_to, created_by,
  // path prefix) is the authorization decision.
  const { error: insertError } = await db.from('photos').insert({
    id: photoId,
    storage_path: storagePath,
    public_url: null,
    entity_type: entityType,
    entity_id: entityId,
    description,
    sort_order: sortOrder,
    size_bytes: bytes.length,
    mime_type: 'image/jpeg',
    created_by: user.id,
  })
  if (insertError) {
    if (insertError.code === '23505') {
      // Retry of the same upload is fine; someone else's photo id is not.
      const { data: own } = await db
        .from('photos')
        .select('id')
        .eq('id', photoId)
        .eq('storage_path', storagePath)
        .maybeSingle()
      if (!own) return fail('Identificador de foto já utilizado.', 409)
    } else if (insertError.code === '42501') {
      return fail('Sem permissão para anexar fotos a este registro.', 403)
    } else {
      return serverError('photo insert', insertError, 400)
    }
  }

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    await db.from('photos').delete().eq('id', photoId)
    return adminUnavailable(err)
  }

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: 'image/jpeg', upsert: true })
  if (uploadError) {
    await db.from('photos').delete().eq('id', photoId)
    return serverError('photo upload', uploadError, 502)
  }

  return NextResponse.json({ id: photoId, storage_path: storagePath, size_bytes: bytes.length })
}
