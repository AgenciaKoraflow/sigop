'use client'

import * as React from 'react'
import { AlertTriangle, Loader2, Search, UserPlus } from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { initials } from '@/hooks/use-current-user'
import { maskCpf, offenderDisplayName } from '@/lib/meliantes/form'
import {
  findOffenderByCpf,
  searchOffenders,
  type OffenderSearchResult,
  type SelectedOffender,
} from '@/lib/meliantes/data'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const SEARCH_DEBOUNCE_MS = 400
const MIN_TERM_LENGTH = 2

export interface BuscaMelianteProps {
  /** Called when the user picks an existing offender. */
  onSelect: (offender: SelectedOffender) => void
  /**
   * Called when nothing matches and the user chooses to register a new
   * offender. Receives the current search term (name or CPF) for pre-filling.
   * When omitted the "Criar novo" action is hidden.
   */
  onCreateNew?: (term: string) => void
  /** Offenders already linked — shown as disabled, cannot be picked twice. */
  excludeIds?: string[]
  label?: string
  placeholder?: string
  className?: string
  autoFocus?: boolean
}

function toSelected(offender: OffenderSearchResult): SelectedOffender {
  return {
    id: offender.id,
    fullName: offender.fullName,
    socialName: offender.socialName,
    nickname: offender.nickname,
    cpf: offender.cpf,
    mainPhotoUrl: offender.mainPhotoUrl,
  }
}

/**
 * Reusable offender picker for the incident and stop forms.
 *
 * Search-as-you-type by name / social name / nickname / CPF, results in a
 * dropdown, a "Criar novo" fallback, and a CPF de-duplication warning when the
 * typed CPF already belongs to a registered offender.
 */
export function BuscaMeliante({
  onSelect,
  onCreateNew,
  excludeIds = [],
  label = 'Buscar meliante',
  placeholder = 'Nome, apelido ou CPF…',
  className,
  autoFocus = false,
}: BuscaMelianteProps) {
  const [term, setTerm] = React.useState('')
  const [results, setResults] = React.useState<OffenderSearchResult[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)
  const [cpfMatch, setCpfMatch] = React.useState<SelectedOffender | null>(null)

  const containerRef = React.useRef<HTMLDivElement>(null)
  const excluded = React.useMemo(() => new Set(excludeIds), [excludeIds])
  const trimmed = term.trim()
  const cpfDigits = trimmed.replace(/\D/g, '')

  // Close the dropdown when clicking away.
  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // Debounced search.
  React.useEffect(() => {
    if (trimmed.length < MIN_TERM_LENGTH) {
      setResults([])
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const rows = await searchOffenders(trimmed)
        if (cancelled) return
        setResults(rows)
        setError(null)
      } catch {
        if (!cancelled) setError('Não foi possível buscar meliantes (verifique a conexão).')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed])

  // Debounced CPF de-duplication check (only once the CPF is complete).
  React.useEffect(() => {
    if (cpfDigits.length !== 11) {
      setCpfMatch(null)
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const match = await findOffenderByCpf(trimmed)
        if (cancelled) return
        setCpfMatch(
          match
            ? {
                id: match.id,
                fullName: match.fullName,
                socialName: match.socialName,
                nickname: match.nickname,
                cpf: match.cpf,
                mainPhotoUrl: null,
              }
            : null,
        )
      } catch {
        if (!cancelled) setCpfMatch(null)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [cpfDigits, trimmed])

  const handleChange = (raw: string) => {
    // Auto-mask when the user is clearly typing a CPF (digits only).
    const next = /^\d[\d.\-\s]*$/.test(raw) && raw.replace(/\D/g, '').length >= 3 ? maskCpf(raw) : raw
    setTerm(next)
    setOpen(true)
  }

  const pick = (offender: SelectedOffender) => {
    onSelect(offender)
    setOpen(false)
    setTerm('')
    setResults([])
    setCpfMatch(null)
  }

  const showDedupAlert = cpfMatch && !excluded.has(cpfMatch.id)
  const showNoResults =
    open && !loading && !error && trimmed.length >= MIN_TERM_LENGTH && results.length === 0
  const showResults = open && results.length > 0

  return (
    <div ref={containerRef} className={cn('space-y-2', className)}>
      {label && <Label>{label}</Label>}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-muted" />
        )}
        <Input
          value={term}
          autoFocus={autoFocus}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="pl-9"
          aria-expanded={showResults}
          role="combobox"
        />
      </div>

      {/* CPF de-duplication warning ---------------------------------------- */}
      {showDedupAlert && (
        <div className="flex flex-col gap-2 rounded-input border border-sync-conflict-text/30 bg-sync-conflict-bg p-3 text-sync-conflict-text">
          <p className="flex items-start gap-2 text-xs font-medium">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Já existe um cadastro com este CPF:{' '}
            <strong>
              {offenderDisplayName({
                full_name: cpfMatch.fullName,
                social_name: cpfMatch.socialName,
                nickname: cpfMatch.nickname,
              })}
            </strong>
            . Deseja usar o cadastro existente?
          </p>
          <div>
            <Button type="button" size="sm" variant="primary" onClick={() => pick(cpfMatch)}>
              Usar cadastro existente
            </Button>
          </div>
        </div>
      )}

      {/* Results dropdown ------------------------------------------------- */}
      {(showResults || showNoResults || error) && (
        <div className="rounded-input border border-content-border bg-white shadow-card">
          {error && <p className="px-3 py-3 text-sm text-danger">{error}</p>}

          {showResults && (
            <ul className="max-h-72 divide-y divide-content-divider overflow-y-auto">
              {results.map((offender) => {
                const name = offenderDisplayName({
                  full_name: offender.fullName,
                  social_name: offender.socialName,
                  nickname: offender.nickname,
                })
                const alreadyLinked = excluded.has(offender.id)
                return (
                  <li
                    key={offender.id}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <Avatar className="h-8 w-8 shrink-0">
                      {offender.mainPhotoUrl && (
                        <AvatarImage src={offender.mainPhotoUrl} alt={name} />
                      )}
                      <AvatarFallback className="text-[11px]">{initials(name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{name}</p>
                      <p className="truncate text-xs text-ink-secondary">
                        {offender.nickname ? `"${offender.nickname}"` : 'Sem apelido'}
                        {offender.cpf ? ` · CPF ${offender.cpf}` : ''}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={alreadyLinked ? 'ghost' : 'outline'}
                      disabled={alreadyLinked}
                      onClick={() => pick(toSelected(offender))}
                    >
                      {alreadyLinked ? 'Já vinculado' : 'Selecionar'}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}

          {showNoResults && (
            <div className="flex flex-col items-start gap-2 px-3 py-3">
              <p className="text-sm text-ink-secondary">Nenhum meliante encontrado.</p>
              {onCreateNew && (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    onCreateNew(trimmed)
                    setOpen(false)
                  }}
                >
                  <UserPlus className="h-4 w-4" />
                  Criar novo
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
