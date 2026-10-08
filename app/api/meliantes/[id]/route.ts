import { softDeleteRecord } from '@/lib/supabase/soft-delete'

/** DELETE /api/meliantes/[id] — soft-delete an offender (administrators only). */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params
  return softDeleteRecord('offenders', params.id, 'Suspeito não encontrado.')
}
