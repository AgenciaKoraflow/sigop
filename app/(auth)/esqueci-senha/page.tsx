'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

import { AuthShell, authButtonClass, authInputClass } from '@/components/auth/AuthShell'
import {
  PASSWORD_MIN,
  RESET_CODE_LENGTH,
  emailSchema,
  newPasswordSchema,
} from '@/lib/auth/password'

type Step = 'email' | 'code' | 'password' | 'done'

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: res.ok, data }
  } catch {
    return { ok: false, data: { error: 'Sem conexão. Tente novamente.' } }
  }
}

export default function EsqueciSenhaPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const messageOf = (data: Record<string, unknown>, fallback: string) =>
    typeof data.error === 'string' ? data.error : fallback

  async function requestCode(event?: FormEvent) {
    event?.preventDefault()
    setError(null)
    setInfo(null)
    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) return setError('Informe um e-mail válido.')
    setLoading(true)
    const { ok, data } = await post('/api/auth/forgot-password', { email: parsed.data })
    setLoading(false)
    if (!ok) return setError(messageOf(data, 'Não foi possível enviar o código.'))
    setEmail(parsed.data)
    setCode('')
    setStep('code')
    setInfo(`Se ${parsed.data} estiver cadastrado, enviamos um código de ${RESET_CODE_LENGTH} dígitos.`)
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (code.length !== RESET_CODE_LENGTH) return setError(`Digite os ${RESET_CODE_LENGTH} dígitos do código.`)
    setLoading(true)
    const { ok, data } = await post('/api/auth/verify-reset-code', { email, code })
    setLoading(false)
    if (!ok || typeof data.token !== 'string') {
      return setError(messageOf(data, 'Código inválido ou expirado.'))
    }
    setToken(data.token)
    setCode('')
    setInfo(null)
    setStep('password')
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const parsed = newPasswordSchema.safeParse(password)
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Senha inválida.')
    if (password !== confirm) return setError('As senhas não conferem.')
    setLoading(true)
    const { ok, data } = await post('/api/auth/reset-password', { email, token, password })
    setLoading(false)
    if (!ok) return setError(messageOf(data, 'Não foi possível trocar a senha.'))
    setPassword('')
    setConfirm('')
    setToken('')
    setStep('done')
  }

  const errorBox = error && (
    <p role="alert" className="rounded-input bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
      {error}
    </p>
  )
  const infoBox = info && (
    <p className="rounded-input bg-brand/10 px-3 py-2 text-sm text-ink-secondary">{info}</p>
  )
  const spinner = loading && <Loader2 className="h-4 w-4 animate-spin" />

  if (step === 'done') {
    return (
      <AuthShell title="Senha alterada" subtitle="Sua senha foi redefinida com sucesso.">
        <button type="button" className={authButtonClass} onClick={() => router.push('/login')}>
          Ir para o login
        </button>
      </AuthShell>
    )
  }

  if (step === 'password') {
    return (
      <AuthShell title="Nova senha" subtitle="Código confirmado. Defina sua nova senha.">
        <form onSubmit={resetPassword} className="space-y-5" autoComplete="off">
          <div className="space-y-1.5">
            <label htmlFor="new-password" className="text-sm font-medium text-ink">Nova senha</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              placeholder={`Mínimo ${PASSWORD_MIN} caracteres, com letras e números`}
              className={authInputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="confirm-password" className="text-sm font-medium text-ink">Confirmar senha</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              className={authInputClass}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={loading}
            />
          </div>
          {errorBox}
          <button type="submit" disabled={loading} className={authButtonClass}>
            {spinner}
            Salvar nova senha
          </button>
        </form>
      </AuthShell>
    )
  }

  if (step === 'code') {
    return (
      <AuthShell title="Digite o código" subtitle={`Enviamos um código de ${RESET_CODE_LENGTH} dígitos para o seu e-mail.`}>
        <form onSubmit={verifyCode} className="space-y-5" autoComplete="off">
          {infoBox}
          <div className="space-y-1.5">
            <label htmlFor="reset-code" className="text-sm font-medium text-ink">Código</label>
            <input
              id="reset-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={RESET_CODE_LENGTH}
              placeholder="000000"
              className={`${authInputClass} text-center font-mono text-lg tracking-[0.5em]`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, RESET_CODE_LENGTH))}
              disabled={loading}
            />
          </div>
          {errorBox}
          <button type="submit" disabled={loading} className={authButtonClass}>
            {spinner}
            Confirmar código
          </button>
          <button
            type="button"
            onClick={() => void requestCode()}
            disabled={loading}
            className="w-full text-sm font-medium text-brand hover:underline disabled:opacity-60"
          >
            Reenviar código
          </button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Esqueci minha senha" subtitle="Informe seu e-mail para receber um código de verificação.">
      <form onSubmit={requestCode} className="space-y-5" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium text-ink">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="seu@email.com"
            className={authInputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
        </div>
        {errorBox}
        <button type="submit" disabled={loading} className={authButtonClass}>
          {spinner}
          Enviar código
        </button>
        <Link href="/login" className="block text-center text-sm font-medium text-brand hover:underline">
          Voltar ao login
        </Link>
      </form>
    </AuthShell>
  )
}
