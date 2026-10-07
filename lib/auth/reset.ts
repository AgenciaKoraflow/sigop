import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSameOriginRequest } from '@/lib/api/request-guards'
import { RESET_CODE_LENGTH } from '@/lib/auth/password'

/**
 * Server-only helpers for the e-mail code password reset.
 * Never import from a 'use client' tree. Nothing here logs codes, tokens,
 * e-mails or provider responses.
 */

export const CODE_TTL_MIN = 10
export const RESET_TOKEN_TTL_MIN = 10
export const MAX_ATTEMPTS = 5

/** Same wording for every failure so nothing reveals which step went wrong. */
export const GENERIC_INVALID = 'Código inválido ou expirado. Solicite um novo.'

export function noStore<T>(response: NextResponse<T>): NextResponse<T> {
  response.headers.set('Cache-Control', 'no-store, max-age=0')
  return response
}

export function jsonNoStore(body: unknown, status = 200) {
  return noStore(NextResponse.json(body, { status }))
}

/** Rejects cross-site browser requests (CSRF defence in depth). */
export function isSameOrigin(request: Request): boolean {
  return isSameOriginRequest(request.headers)
}

function secret(): string {
  const value = process.env.PASSWORD_RESET_SECRET
  if (!value || value.length < 32) throw new Error('reset-secret-missing')
  return value
}

export function hmac(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('hex')
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

export function generateCode(): string {
  return String(randomInt(0, 10 ** RESET_CODE_LENGTH)).padStart(RESET_CODE_LENGTH, '0')
}

export function generateResetToken(): string {
  return randomBytes(32).toString('base64url')
}

// ---------------------------------------------------------------------------
// Browser binding. The code is only redeemable from the browser that asked for
// it: a random value lives in an HttpOnly cookie and its HMAC is stored with the
// code. A third party who knows the address can neither burn the victim's
// attempts nor redeem a code, and a code an attacker requested "for" the victim
// is useless in the victim's browser (and vice-versa).
// ---------------------------------------------------------------------------
export const BINDING_COOKIE = 'sigop_rb'
const BINDING_PATTERN = /^[A-Za-z0-9_-]{43}$/
const BINDING_MAX_AGE_SEC = 30 * 60

export function newBinding(): string {
  return randomBytes(32).toString('base64url')
}

/** The caller's binding cookie, or null when absent/malformed. */
export function readBinding(request: Request): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === BINDING_COOKIE) {
      const value = rest.join('=')
      return BINDING_PATTERN.test(value) ? value : null
    }
  }
  return null
}

/** HMAC of a binding; a missing cookie hashes a throwaway value (never matches). */
export function bindingHash(binding: string | null): string {
  return hmac(`bind:${binding ?? newBinding()}`)
}

const BINDING_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  path: '/api/auth',
}

export function setBindingCookie<T>(response: NextResponse<T>, binding: string): NextResponse<T> {
  response.cookies.set(BINDING_COOKIE, binding, {
    ...BINDING_COOKIE_OPTIONS,
    secure: process.env.NODE_ENV === 'production',
    maxAge: BINDING_MAX_AGE_SEC,
  })
  return response
}

export function clearBindingCookie<T>(response: NextResponse<T>): NextResponse<T> {
  response.cookies.set(BINDING_COOKIE, '', {
    ...BINDING_COOKIE_OPTIONS,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  })
  return response
}

/** 429 for an exhausted IP / IP+identifier budget (independent of the account). */
export function tooManyRequests(retryAfter: number) {
  const response = jsonNoStore(
    { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
    429,
  )
  response.headers.set('Retry-After', String(Math.max(1, retryAfter)))
  return response
}

export function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

export function getDb(): SupabaseClient | null {
  try {
    return createAdminClient() as unknown as SupabaseClient
  } catch {
    return null
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** Sends the code through Resend's REST API. Returns false on any failure. */
export async function sendResetCodeEmail(to: string, code: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  if (!apiKey || !from) return false

  const safeCode = escapeHtml(code)
  const html = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#111">
  <h2 style="margin:0 0 12px">SIGOP — redefinição de senha</h2>
  <p>Use o código abaixo para redefinir sua senha. Ele vale por ${CODE_TTL_MIN} minutos.</p>
  <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:20px 0">${safeCode}</p>
  <p style="font-size:12px;color:#666">Se você não solicitou, ignore este e-mail — sua senha continua a mesma. Nunca compartilhe este código.</p>
</div>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: 'Seu código de redefinição de senha — SIGOP',
        html,
        text: `Seu código de redefinição de senha do SIGOP: ${code}. Válido por ${CODE_TTL_MIN} minutos. Se você não solicitou, ignore este e-mail.`,
      }),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}
