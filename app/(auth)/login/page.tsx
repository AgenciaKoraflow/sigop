'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Shield,
  BarChart2,
  Users,
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
} from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { createClient } from '@/lib/supabase/client'

const loginSchema = z.object({
  email: z.string().min(1, 'Informe seu email').email('Email inválido'),
  password: z.string().min(6, 'A senha deve ter no mínimo 6 caracteres'),
  rememberMe: z.boolean().optional(),
})

type LoginValues = z.infer<typeof loginSchema>

const FEATURES = [
  { icon: Shield, label: 'Cadastro de ocorrências e abordagens' },
  { icon: BarChart2, label: 'Dashboard operacional em tempo real' },
  { icon: Users, label: 'Funcionamento offline e sincronização' },
]

export default function LoginPage() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  })

  async function onSubmit(values: LoginValues) {
    setAuthError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    })

    if (error) {
      setAuthError('Email ou senha incorretos')
      return
    }

    router.push('/')
    router.refresh()
  }

  const loading = isSubmitting

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* ---------------------------------------------------------------- */}
      {/* Left panel — hero (hidden on mobile)                             */}
      {/* ---------------------------------------------------------------- */}
      <aside
        className="hidden w-[42%] flex-col justify-between p-12 text-white md:flex"
        style={{
          background:
            'linear-gradient(160deg, #0a0f1e 0%, #0a0f1e 45%, #0d1526 100%)',
        }}
      >
        {/* Brand + status */}
        <div className="space-y-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">
              SG
            </div>
            <div>
              <p className="text-lg font-bold leading-tight text-white">SIGOP</p>
              <p className="text-nav-section uppercase text-sidebar-muted">
                Gestão de ocorrências
              </p>
            </div>
          </div>

          <span
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
            style={{
              backgroundColor: 'rgba(30,58,110,0.6)',
              border: '1px solid rgba(59,130,246,0.3)',
              color: '#93c5fd',
            }}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-400" />
            </span>
            Sistema Ativo
          </span>
        </div>

        {/* Hero copy */}
        <div className="space-y-5">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Gestão de
            <br />
            <span style={{ color: '#3b5fc0' }}>Ocorrências</span>
          </h1>
          <p className="max-w-sm text-sm leading-relaxed text-sidebar-muted">
            Cadastro, consulta e gestão de ocorrências operacionais e abordagens
            de campo.
          </p>

          <ul className="space-y-3 pt-2">
            {FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-sm text-white/90">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
                  <Icon className="h-4 w-4 text-[#93c5fd]" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <p className="text-xs text-sidebar-muted">
          © 2025 SIGOP · Todos os direitos reservados
        </p>
      </aside>

      {/* ---------------------------------------------------------------- */}
      {/* Right panel — form                                              */}
      {/* ---------------------------------------------------------------- */}
      <main className="flex flex-1 items-center justify-center bg-content-bg px-4 py-10">
        <div className="w-full max-w-[400px] rounded-2xl bg-white p-10 shadow-modal">
          {/* Mobile-only compact brand */}
          <div className="mb-8 flex items-center gap-2 md:hidden">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-xs font-bold text-white">
              SG
            </div>
            <span className="text-base font-bold text-ink">SIGOP</span>
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-ink">Bem-vindo de volta</h2>
            <p className="text-sm font-normal text-ink-secondary">
              Acesse sua conta para continuar
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5">
            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-ink">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="seu@email.com"
                disabled={loading}
                className={cn(
                  'flex h-10 w-full rounded-input border border-content-border bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60',
                  errors.email && 'border-danger focus-visible:ring-danger',
                )}
                {...register('email')}
              />
              {errors.email && (
                <p className="text-xs font-medium text-danger">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-ink">
                Senha
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  disabled={loading}
                  className={cn(
                    'flex h-10 w-full rounded-input border border-content-border bg-white px-3 py-2 pr-10 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60',
                    errors.password && 'border-danger focus-visible:ring-danger',
                  )}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={loading}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-secondary"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs font-medium text-danger">
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* Remember me */}
            <label className="flex items-center gap-2 text-sm text-ink-secondary">
              <input
                type="checkbox"
                disabled={loading}
                className="h-4 w-4 rounded border-content-border text-brand accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                {...register('rememberMe')}
              />
              Manter conectado
            </label>

            {/* Auth error */}
            {authError && (
              <p className="rounded-input bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
                {authError}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-input bg-brand text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Acessando…
                </>
              ) : (
                <>
                  Acessar Sistema
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
