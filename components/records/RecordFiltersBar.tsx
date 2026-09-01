'use client'

import { LayoutGrid, Search, Table2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils/cn'
import type { PeriodKey, RecordConfig, RecordFilters } from '@/lib/records/config'

export type ViewMode = 'table' | 'cards'

const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mês' },
  { value: 'custom', label: 'Personalizado' },
]

/** Sentinel for the "no filter" option (Radix forbids an empty item value). */
const ALL = '__all__'

interface Props {
  cfg: RecordConfig
  filters: RecordFilters
  search: string
  onSearch: (value: string) => void
  onPatch: (next: Partial<RecordFilters>) => void
  onClear: () => void
  hasActiveFilters: boolean
  view: ViewMode
  onViewChange: (view: ViewMode) => void
}

export function RecordFiltersBar({
  cfg,
  filters,
  search,
  onSearch,
  onPatch,
  onClear,
  hasActiveFilters,
  view,
  onViewChange,
}: Props) {
  return (
    <div className="space-y-3 rounded-card border border-content-border bg-content-surface p-3 shadow-card">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={cfg.searchPlaceholder}
            className="pl-9"
            aria-label="Buscar"
          />
        </div>

        <div className="flex items-center gap-1 self-start rounded-input bg-content-bg p-1 lg:self-auto">
          <ViewButton
            active={view === 'cards'}
            onClick={() => onViewChange('cards')}
            label="Cards"
          >
            <LayoutGrid className="h-4 w-4" />
          </ViewButton>
          <ViewButton
            active={view === 'table'}
            onClick={() => onViewChange('table')}
            label="Tabela"
          >
            <Table2 className="h-4 w-4" />
          </ViewButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.period ?? ''}
          onValueChange={(value) =>
            onPatch({ period: (value || undefined) as PeriodKey | undefined })
          }
        >
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.type ?? ALL}
          onValueChange={(value) =>
            onPatch({ type: value === ALL ? undefined : value })
          }
        >
          <SelectTrigger className="h-9 w-[170px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os tipos</SelectItem>
            {cfg.typeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.secondary ?? ALL}
          onValueChange={(value) =>
            onPatch({ secondary: value === ALL ? undefined : value })
          }
        >
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder={cfg.secondaryFilterLabel} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{`${cfg.secondaryFilterLabel}: todos`}</SelectItem>
            {cfg.secondaryOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filters.period === 'custom' && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={filters.customFrom ?? ''}
              onChange={(event) => onPatch({ customFrom: event.target.value })}
              className="h-9 w-[150px]"
              aria-label="Data inicial"
            />
            <span className="text-xs text-ink-muted">até</span>
            <Input
              type="date"
              value={filters.customTo ?? ''}
              onChange={(event) => onPatch({ customTo: event.target.value })}
              className="h-9 w-[150px]"
              aria-label="Data final"
            />
          </div>
        )}

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-9 text-ink-secondary"
          >
            <X className="mr-1 h-4 w-4" />
            Limpar filtros
          </Button>
        )}
      </div>
    </div>
  )
}

function ViewButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        'flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-content-surface text-ink shadow-sm'
          : 'text-ink-secondary hover:text-ink',
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
