'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, WifiOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { searchOffenders, type OffenderSearchResult } from '@/lib/meliantes/data'
import { CardMeliante } from '@/components/meliantes/CardMeliante'

const SEARCH_DEBOUNCE_MS = 400

export default function OffendersPage() {
  const { isOnline } = useOnlineStatus()
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [results, setResults] = useState<OffenderSearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    searchOffenders(debounced)
      .then((rows) => {
        if (cancelled) return
        setResults(rows)
        setError(null)
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar os meliantes. Tente novamente.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  const isSearching = debounced.length > 0

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-ink">
          Meliantes{' '}
          {!loading && (
            <span className="font-semibold text-ink-muted">({results.length})</span>
          )}
        </h1>
        <Button asChild variant="primary" size="lg" className="w-full justify-center sm:w-auto">
          <Link href="/meliantes/nova">
            <Plus />
            Novo meliante
          </Link>
        </Button>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Buscar por nome, apelido ou CPF…"
          className="pl-9"
        />
      </div>

      {!isOnline && (
        <p className="flex items-center gap-2 rounded-input border border-sync-pending-text/20 bg-sync-pending-bg px-3 py-2 text-xs font-medium text-sync-pending-text">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          Sem conexão — a busca de meliantes precisa de internet.
        </p>
      )}

      {error && (
        <p className="rounded-input border border-danger/20 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="space-y-3 rounded-card border border-content-border bg-content-surface p-4 shadow-card"
            >
              <div className="flex gap-3">
                <Skeleton className="h-14 w-14 rounded-full" />
                <div className="flex-1 space-y-2 py-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-6 w-full" />
            </div>
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-card border border-content-border bg-content-surface py-16 text-center text-sm text-ink-secondary shadow-card">
          {isSearching
            ? 'Nenhum meliante encontrado para essa busca.'
            : 'Nenhum meliante cadastrado ainda.'}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((offender) => (
            <CardMeliante key={offender.id} offender={offender} />
          ))}
        </div>
      )}
    </div>
  )
}
