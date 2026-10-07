'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

import { AuthShell, authButtonClass, authInputClass } from '@/components/auth/AuthShell'
import { PASSWORD_MIN, newPasswordSchema } from '@/lib/auth/password'
import { createClient } from '@/lib/supabase/client'

/** Mandatory first-login screen: the middleware blocks everything else until done. */
export default function TrocarSenhaPage() {
  const router = useRouter()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const parsed = newPasswordSchema.safeParse(password)
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Senha inválida.')
    if (password !== confirm) return setError('As senhas não conferem.')
    if (!current) return setError('Informe a senha atual (provisória).')

    setLoading(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, password }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível trocar a senha.')
        return
      }
      setCurrent('')
      setPassword('')
      setConfirm('')
      router.replace('/')
      router.refresh()
    } catch {
      setError('Sem conexão. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  async function onSignOut() {
    await createClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <AuthShell
      title="Crie sua senha"
      subtitle="Por segurança, troque a senha provisória antes de acessar o sistema."
    >
      <form onSubmit={onSubmit} className="space-y-5" autoComplete="off">
        <div className="space-y-1.5">
          <label htmlFor="current-password" className="text-sm font-medium text-ink">Senha atual (provisória)</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            className={authInputClass}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={loading}
          />
        </div>
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
          <label htmlFor="confirm-password" className="text-sm font-medium text-ink">Confirmar nova senha</label>
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
        {error && (
          <p role="alert" className="rounded-input bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading} className={authButtonClass}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar e acessar
        </button>
        <button
          type="button"
          onClick={() => void onSignOut()}
          disabled={loading}
          className="w-full text-sm font-medium text-ink-secondary hover:underline disabled:opacity-60"
        >
          Sair
        </button>
      </form>
    </AuthShell>
  )
}
