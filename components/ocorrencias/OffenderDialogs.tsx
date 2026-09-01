'use client'

import * as React from 'react'
import { Loader2, Search, UserPlus } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { initials } from '@/hooks/use-current-user'
import type { LinkedOffender } from '@/lib/ocorrencias/form'

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

interface OffenderRow {
  id: string
  full_name: string | null
  social_name: string | null
  nickname: string | null
  cpf: string | null
  main_photo_url: string | null
}

// ===========================================================================
// Link an existing offender (search by name / CPF)
// ===========================================================================
export function LinkOffenderDialog({
  open,
  onOpenChange,
  linkedIds,
  onLink,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  linkedIds: string[]
  onLink: (offender: Omit<LinkedOffender, 'linkId' | 'role'>) => void
}) {
  const [term, setTerm] = React.useState('')
  const [results, setResults] = React.useState<OffenderRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    const trimmed = term.trim()
    if (trimmed.length < 2) {
      setResults([])
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        // Untyped client: the generated types collapse `.rpc` args to `never`
        // under this project's supabase-js pairing (same reason writes are untyped).
        const supabase = createClient() as unknown as SupabaseClient
        const { data, error: rpcError } = await supabase.rpc('search_offenders', {
          term: trimmed,
        })
        if (cancelled) return
        if (rpcError) throw new Error(rpcError.message)
        setResults((data ?? []) as unknown as OffenderRow[])
        setError(null)
      } catch {
        if (!cancelled) setError('Não foi possível buscar meliantes (verifique a conexão)')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [term, open])

  React.useEffect(() => {
    if (!open) {
      setTerm('')
      setResults([])
      setError(null)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular meliante existente</DialogTitle>
          <DialogDescription>Busque por nome, nome social, apelido ou CPF.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Ex.: João da Silva ou 123.456.789-00"
            className="pl-9"
          />
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {loading && (
            <p className="flex items-center gap-2 px-1 py-3 text-sm text-ink-secondary">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
            </p>
          )}
          {error && <p className="px-1 py-3 text-sm text-danger">{error}</p>}
          {!loading && !error && term.trim().length >= 2 && results.length === 0 && (
            <p className="px-1 py-3 text-sm text-ink-secondary">Nenhum meliante encontrado.</p>
          )}

          {results.map((offender) => {
            const alreadyLinked = linkedIds.includes(offender.id)
            const name = offender.full_name || offender.social_name || 'Sem nome'
            return (
              <button
                key={offender.id}
                type="button"
                disabled={alreadyLinked}
                onClick={() => {
                  onLink({
                    offenderId: offender.id,
                    fullName: name,
                    nickname: offender.nickname,
                    photoUrl: offender.main_photo_url,
                    isNew: false,
                  })
                  onOpenChange(false)
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-input border border-transparent px-2 py-2 text-left transition-colors hover:border-content-border hover:bg-content-bg',
                  alreadyLinked && 'cursor-not-allowed opacity-50 hover:border-transparent hover:bg-transparent',
                )}
              >
                <Avatar className="h-9 w-9">
                  {offender.main_photo_url && <AvatarImage src={offender.main_photo_url} alt={name} />}
                  <AvatarFallback>{initials(name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {name}
                    {offender.nickname && (
                      <span className="text-ink-secondary"> · &ldquo;{offender.nickname}&rdquo;</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-ink-secondary">
                    {offender.cpf ? `CPF ${offender.cpf}` : 'CPF não informado'}
                    {alreadyLinked && ' · já vinculado'}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Create a new offender (compact form)
// ===========================================================================
export function CreateOffenderDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (offender: Omit<LinkedOffender, 'linkId' | 'role'>) => void
}) {
  const [fullName, setFullName] = React.useState('')
  const [nickname, setNickname] = React.useState('')
  const [cpf, setCpf] = React.useState('')
  const [physicalDescription, setPhysicalDescription] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setFullName('')
      setNickname('')
      setCpf('')
      setPhysicalDescription('')
      setTouched(false)
    }
  }, [open])

  const nameInvalid = touched && fullName.trim().length < 3

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (fullName.trim().length < 3) return

    const id = newId()
    onCreate({
      offenderId: id,
      fullName: fullName.trim(),
      nickname: nickname.trim() || null,
      photoUrl: null,
      isNew: true,
      draft: {
        id,
        full_name: fullName.trim(),
        nickname: nickname.trim() || null,
        cpf: cpf.trim() || null,
        physical_description: physicalDescription.trim() || null,
      },
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cadastrar novo meliante</DialogTitle>
          <DialogDescription>
            Cadastro resumido. O cadastro completo pode ser feito depois na ficha do meliante.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="offender-name">
              Nome completo <span className="text-danger">*</span>
            </Label>
            <Input
              id="offender-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={nameInvalid}
              className={cn(nameInvalid && 'border-danger focus-visible:ring-danger')}
            />
            {nameInvalid && (
              <p className="text-xs font-medium text-danger">Informe ao menos 3 caracteres</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="offender-nickname">Apelido</Label>
              <Input
                id="offender-nickname"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offender-cpf">CPF</Label>
              <Input
                id="offender-cpf"
                value={cpf}
                onChange={(event) => setCpf(event.target.value)}
                inputMode="numeric"
                placeholder="000.000.000-00"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="offender-description">Descrição física</Label>
            <Textarea
              id="offender-description"
              value={physicalDescription}
              onChange={(event) => setPhysicalDescription(event.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary">
              <UserPlus className="h-4 w-4" />
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
