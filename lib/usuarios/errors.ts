/**
 * Maps Auth / profile failures of the user-management routes to messages an
 * administrator can act on. Pure functions: the Route Handlers do the lookups
 * and pass the facts in.
 */

export interface ApiFailure {
  error: string
  status: number
  /** Machine-readable reason, so the UI can offer a shortcut (e.g. open the user). */
  code?: string
}

interface AuthErrorLike {
  code?: string
  message?: string
  status?: number
}

/** The e-mail's current owner, as found in `profiles`. */
export interface ExistingAccount {
  id: string
  full_name: string | null
  is_active: boolean | null
  deleted_at: string | null
}

/** A GoTrue (Auth admin API) error → status + message. */
export function describeAuthError(error: AuthErrorLike | null, fallback: string): ApiFailure {
  const message = error?.message ?? ''
  switch (error?.code) {
    case 'email_exists':
    case 'user_already_exists':
      return { error: 'Já existe um usuário com esse e-mail.', status: 409, code: 'email_exists' }
    case 'weak_password':
      return {
        error: 'A senha é muito fraca. Use letras maiúsculas e minúsculas, números e símbolos.',
        status: 400,
        code: 'weak_password',
      }
    case 'same_password':
      return { error: 'A nova senha deve ser diferente da atual.', status: 400, code: 'same_password' }
    case 'email_address_invalid':
    case 'validation_failed':
      return { error: 'Informe um e-mail válido.', status: 400, code: 'invalid_email' }
    case 'user_not_found':
      return { error: 'Usuário não encontrado.', status: 404, code: 'user_not_found' }
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return { error: 'Muitas tentativas seguidas. Aguarde um instante e tente de novo.', status: 429 }
  }
  if (/already been registered|already exists/i.test(message)) {
    return { error: 'Já existe um usuário com esse e-mail.', status: 409, code: 'email_exists' }
  }
  // The `handle_new_user` trigger on auth.users raised (see sql/014).
  if (/database error/i.test(message)) {
    return {
      error: 'O banco recusou a criação do perfil do usuário (trigger handle_new_user). Avise o suporte técnico.',
      status: 500,
      code: 'profile_trigger',
    }
  }
  if (error?.status === 429) {
    return { error: 'Muitas tentativas seguidas. Aguarde um instante e tente de novo.', status: 429 }
  }
  return { error: fallback, status: 400 }
}

/** The e-mail is taken: say by whom, and what state that account is in. */
export function describeEmailTaken(existing: ExistingAccount | null): ApiFailure {
  if (!existing) {
    return {
      error:
        'Esse e-mail já está registrado no login, mas sem perfil no sistema. Avise o suporte técnico para regularizar.',
      status: 409,
      code: 'email_orphan',
    }
  }
  if (existing.deleted_at) {
    return {
      error:
        'Esse e-mail pertenceu a um usuário que foi excluído e ainda está reservado. Avise o suporte técnico para liberá-lo.',
      status: 409,
      code: 'email_deleted',
    }
  }
  const name = existing.full_name?.trim() || 'sem nome'
  if (existing.is_active === false) {
    return {
      error: `Já existe um usuário inativo com esse e-mail (${name}). Reative-o em vez de criar outro.`,
      status: 409,
      code: 'email_inactive',
    }
  }
  return {
    error: `Já existe um usuário com esse e-mail (${name}).`,
    status: 409,
    code: 'email_exists',
  }
}

/** The badge number is held by another (non-deleted) profile. */
export function describeBadgeTaken(badge: string, holder: { full_name: string | null } | null): ApiFailure {
  const who = holder?.full_name?.trim()
  return {
    error: who
      ? `A matrícula ${badge} já está em uso por ${who}.`
      : `A matrícula ${badge} já está em uso por outro usuário.`,
    status: 409,
    code: 'badge_taken',
  }
}
