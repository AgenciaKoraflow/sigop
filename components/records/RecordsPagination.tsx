'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  page: number
  totalPages: number
  isFetching: boolean
  onPage: (page: number) => void
}

export function RecordsPagination({ page, totalPages, isFetching, onPage }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-ink-secondary">
      <span>
        Página {page} de {totalPages}
        {isFetching && <span className="ml-2 text-ink-muted">atualizando…</span>}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Próximo
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
