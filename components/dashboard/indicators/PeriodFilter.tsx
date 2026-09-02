'use client'

import { cn } from '@/lib/utils/cn'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  PERIOD_OPTIONS,
  type DashboardPeriod,
  type IndicatorFilters,
} from '@/lib/dashboard/indicators'
import type { UnitOption } from '@/hooks/use-dashboard-indicators'

const ALL_UNITS = '__all__'

interface Props {
  filters: IndicatorFilters
  onChange: (next: Partial<IndicatorFilters>) => void
  /** Administrator only — when omitted the "Unidade" select is hidden. */
  units?: UnitOption[]
  unitsLoading?: boolean
}

export function PeriodFilter({ filters, onChange, units, unitsLoading }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PERIOD_OPTIONS.map((option) => {
        const active = filters.period === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange({ period: option.value as DashboardPeriod })}
            className={cn(
              'h-9 rounded-input border px-3.5 text-sm font-medium transition-colors',
              active
                ? 'border-brand bg-brand text-white'
                : 'border-content-border bg-content-surface text-ink-secondary hover:text-ink',
            )}
          >
            {option.label}
            {option.value === 'custom' && ' →'}
          </button>
        )
      })}

      {filters.period === 'custom' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={filters.customFrom ?? ''}
            max={filters.customTo || undefined}
            onChange={(event) => onChange({ customFrom: event.target.value })}
            className="h-9 w-[150px]"
            aria-label="Data inicial"
          />
          <span className="text-xs text-ink-muted">até</span>
          <Input
            type="date"
            value={filters.customTo ?? ''}
            min={filters.customFrom || undefined}
            onChange={(event) => onChange({ customTo: event.target.value })}
            className="h-9 w-[150px]"
            aria-label="Data final"
          />
        </div>
      )}

      {units && (
        <Select
          value={filters.unitId ?? ALL_UNITS}
          onValueChange={(value) =>
            onChange({ unitId: value === ALL_UNITS ? undefined : value })
          }
        >
          <SelectTrigger className="ml-auto h-9 w-[190px]">
            <SelectValue placeholder={unitsLoading ? 'Carregando…' : 'Unidade'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_UNITS}>Todas as unidades</SelectItem>
            {units.map((unit) => (
              <SelectItem key={unit.id} value={unit.id}>
                {unit.code ? `${unit.code} — ${unit.name}` : unit.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
