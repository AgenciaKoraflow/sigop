import { softDeleteRecord } from '@/lib/supabase/soft-delete'

/** DELETE /api/meliantes/[id] — soft-delete an offender (administrators only). */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  return softDeleteRecord('offenders', 'offender', params.id, 'Meliante não encontrado.')
}
