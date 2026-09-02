'use client'

import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  buildIndicatorsCsv,
  downloadCsv,
  periodLabel,
  type DashboardIndicators,
  type IndicatorFilters,
} from '@/lib/dashboard/indicators'

interface Props {
  data?: DashboardIndicators
  filters: IndicatorFilters
  disabled?: boolean
}

export function ExportMenu({ data, filters, disabled }: Props) {
  const stamp = new Date().toISOString().slice(0, 10)

  function handleCsv() {
    if (!data) return
    downloadCsv(`sigop-dashboard-${stamp}.csv`, buildIndicatorsCsv(data, filters))
  }

  function handlePdf() {
    // No PDF lib in the bundle — the browser's "Salvar como PDF" print target
    // renders the dashboard 1:1 and is offline-safe.
    if (typeof window !== 'undefined') window.print()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9" disabled={disabled || !data}>
          <Download />
          Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={handleCsv}>
          <FileSpreadsheet />
          Exportar CSV
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handlePdf}>
          <FileText />
          Exportar PDF (impressão)
        </DropdownMenuItem>
        <p className="px-2 pt-1 text-[11px] text-ink-muted">
          Período: {periodLabel(filters)}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
