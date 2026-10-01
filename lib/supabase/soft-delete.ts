import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/usuarios/guard'

/**
 * Shared body of the admin-only `DELETE` Route Handlers for incidents and
 * offenders. Server-only (service-role key).
 *
 * Deleting is a soft delete (`deleted_at`), so the record leaves every screen
 * but stays in the database. It cannot be done from the browser client: once
 * `deleted_at` is set the row no longer passes the table's SELECT policy
 * (`deleted_at IS NULL`), and Postgres rejects an UPDATE whose result the
 * caller cannot see.
 */
export async function softDeleteRecord(
  table: 'incidents' | 'offenders',
  entityType: 'incident' | 'offender',
  id: string,
  notFoundMessage: string,
): Promise<NextResponse> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Configuração do servidor ausente.' },
      { status: 503 },
    )
  }
  const db = admin as unknown as SupabaseClient

  const { data, error } = await db
    .from(table)
    .update({ deleted_at: new Date().toISOString(), updated_by: gate.userId })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: notFoundMessage }, { status: 404 })
  }

  // Best effort — the record is already gone from the app at this point.
  await db.from('audit_log').insert({
    entity_type: entityType,
    entity_id: id,
    operation: 'delete',
    performed_by: gate.userId,
  })

  return NextResponse.json({ id })
}
