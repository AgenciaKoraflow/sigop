import { NextResponse } from 'next/server'

/**
 * Error responses for `app/api/**`. Database / Auth error text (table, column,
 * constraint and env-var names) stays in the server log; the browser only gets
 * a generic message.
 */
export function serverError(context: string, error: unknown, status = 500, message = 'Não foi possível concluir a operação.') {
  const detail = error instanceof Error ? error.message : (error as { message?: string } | null)?.message
  console.error(`[api] ${context}${detail ? `: ${detail}` : ''}`)
  return NextResponse.json({ error: message }, { status })
}

/** A path id that is not a UUID never reaches the database. */
export function invalidId() {
  return NextResponse.json({ error: 'Identificador inválido.' }, { status: 400 })
}

/** The service-role client could not be built (missing server config). */
export function adminUnavailable(error: unknown) {
  return serverError('admin client unavailable', error, 503, 'Serviço indisponível no momento.')
}
