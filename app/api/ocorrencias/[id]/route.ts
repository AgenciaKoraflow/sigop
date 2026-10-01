import { softDeleteRecord } from '@/lib/supabase/soft-delete'

/** DELETE /api/ocorrencias/[id] — soft-delete an incident (administrators only). */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  return softDeleteRecord('incidents', 'incident', params.id, 'Ocorrência não encontrada.')
}
