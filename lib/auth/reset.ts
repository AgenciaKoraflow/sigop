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
const EMAIL_COOLDOWN_SEC = 60
const EMAIL_MAX_PER_HOUR = 5
const IP_MAX_PER_HOUR = 20

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

export function clientIpHash(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return hmac(`ip:${forwarded || request.headers.get('x-real-ip') || 'unknown'}`)
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

/** True when the e-mail or IP exceeded the request budget (or is cooling down). */
export async function isRateLimited(db: SupabaseClient, email: string, ipHash: string) {
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
  const cooldown = new Date(Date.now() - EMAIL_COOLDOWN_SEC * 1000).toISOString()

  const [byEmail, byIp, recent] = await Promise.all([
    db.from('password_reset_codes').select('id', { count: 'exact', head: true })
      .eq('email', email).gte('created_at', hourAgo),
    db.from('password_reset_codes').select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash).gte('created_at', hourAgo),
    db.from('password_reset_codes').select('id', { count: 'exact', head: true })
      .eq('email', email).gte('created_at', cooldown),
  ])
  return (
    (byEmail.count ?? 0) >= EMAIL_MAX_PER_HOUR ||
    (byIp.count ?? 0) >= IP_MAX_PER_HOUR ||
    (recent.count ?? 0) > 0
  )
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
