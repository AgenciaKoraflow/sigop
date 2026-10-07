'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { searchOffenders, type OffenderSearchResult } from '@/lib/meliantes/data'
import { CardMeliante } from '@/components/meliantes/CardMeliante'
import { RecordsPagination } from '@/components/records/RecordsPagination'

const SEARCH_DEBOUNCE_MS = 400
const OFFENDERS_PAGE_SIZE = 20

export default function OffendersPage() {
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [results, setResults] = useState<OffenderSearchResult[]>([])
  const [page, setPage] = useState(1)
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
        if (!cancelled) setError('Não foi possível carregar os suspeitos. Tente novamente.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  // Reset to the first page whenever the search changes.
  useEffect(() => {
    setPage(1)
  }, [debounced])

  const isSearching = debounced.length > 0
  const totalPages = Math.max(1, Math.ceil(results.length / OFFENDERS_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = results.slice(
    (currentPage - 1) * OFFENDERS_PAGE_SIZE,
    currentPage * OFFENDERS_PAGE_SIZE,
  )

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-ink">
          Suspeitos{' '}
          {!loading && (
            <span className="font-semibold text-ink-muted">({results.length})</span>
          )}
        </h1>
        <Button asChild variant="primary" size="lg" className="w-full justify-center sm:w-auto">
          <Link href="/meliantes/nova">
            <Plus />
            Novo suspeito
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
            ? 'Nenhum suspeito encontrado para essa busca.'
            : 'Nenhum suspeito cadastrado ainda.'}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pageItems.map((offender) => (
              <CardMeliante key={offender.id} offender={offender} />
            ))}
          </div>
          {totalPages > 1 && (
            <RecordsPagination
              page={currentPage}
              totalPages={totalPages}
              isFetching={false}
              onPage={setPage}
            />
          )}
        </>
      )}
    </div>
  )
}
