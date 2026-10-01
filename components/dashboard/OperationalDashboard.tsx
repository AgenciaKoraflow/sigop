'use client'

import { useState } from 'react'
import { AlertTriangle, FlaskConical, Lock } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useDashboardIndicators,
  useUnits,
} from '@/hooks/use-dashboard-indicators'
import type { IndicatorFilters } from '@/lib/dashboard/indicators'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PeriodFilter } from './indicators/PeriodFilter'
import { ExportMenu } from './indicators/ExportMenu'
import { IndicatorKpiCards } from './indicators/IndicatorKpiCards'
import {
  GeographyChart,
  TypeDistributionChart,
  VolumeChart,
  WeekdayHourHeatmap,
} from './indicators/IndicatorCharts'
import {
  AgentProductivityTable,
  RecentIncidentsTable,
  TopOffendersTable,
} from './indicators/IndicatorTables'

export function OperationalDashboard() {
  const { role, isAdmin, canViewDashboard } = usePermissions()

  const [filters, setFilters] = useState<IndicatorFilters>({ period: 'month' })
  const patch = (next: Partial<IndicatorFilters>) =>
    setFilters((prev) => ({ ...prev, ...next }))

  const { data, isLoading, isError, isFetching, isPlaceholderData } =
    useDashboardIndicators(filters)
  const units = useUnits(isAdmin)

  // Role still resolving — avoid flashing "access denied".
  if (role === null) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-card" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-card" />
      </div>
    )
  }

  if (!canViewDashboard) {
    return (
      <div className="mx-auto max-w-lg pt-16">
        <Card className="rounded-card border-content-border p-8 text-center shadow-card">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
            <Lock className="h-6 w-6" />
          </span>
          <h1 className="text-lg font-semibold text-ink">Acesso restrito</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            O painel de indicadores operacionais está disponível apenas para
            supervisores e administradores. Fale com a coordenação se você precisa
            desse acesso.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-bold text-ink">Painel operacional</h1>
          <p className="text-sm text-ink-secondary">
            Indicadores das ocorrências registradas: volume, tipo, região e horário
            {isFetching && !isLoading ? ' · atualizando…' : ''}
          </p>
        </div>
        <ExportMenu data={data} filters={filters} disabled={isLoading} />
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-content-border bg-content-surface p-3 shadow-card">
        <PeriodFilter
          filters={filters}
          onChange={patch}
          units={isAdmin ? units.data ?? [] : undefined}
          unitsLoading={units.isLoading}
        />
      </div>

      {data?.isMock && (
        <div className="flex items-center gap-2 rounded-input border border-brand/20 bg-brand-light px-3 py-2 text-xs font-medium text-brand">
          <FlaskConical className="h-3.5 w-3.5 shrink-0" />
          Dados de demonstração — nenhum registro no período selecionado
        </div>
      )}

      {isError && !data && (
        <div className="flex items-center gap-2 rounded-input border border-danger/20 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Não foi possível carregar os indicadores. Tente novamente em instantes.
        </div>
      )}

      {isAdmin && data?.isLegacyPayload && (
        <div className="flex items-center gap-2 rounded-input border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-medium text-ink">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          Banco desatualizado: execute sql/017_dashboard_stats_unified.sql para liberar os
          indicadores por região, horário e meliantes envolvidos.
        </div>
      )}

      {/* Hold the previous numbers (dimmed) while a filter change refetches. */}
      <div
        className={cn(
          'space-y-6 transition-opacity',
          isPlaceholderData && 'opacity-60',
        )}
      >
        <IndicatorKpiCards kpis={data?.kpis} loading={isLoading} />

        {isLoading || !data ? (
          <ChartSkeletons />
        ) : (
          <>
            <VolumeChart data={data.volume} />

            <div className="grid gap-4 lg:grid-cols-2">
              <TypeDistributionChart data={data.byType} />
              {data.geography && <GeographyChart data={data.geography} />}
            </div>

            {data.weekdayHour && <WeekdayHourHeatmap data={data.weekdayHour} />}

            <div className="grid gap-4 lg:grid-cols-2">
              <TopOffendersTable rows={data.topOffenders} />
              <AgentProductivityTable rows={data.agentProductivity} />
            </div>

            <RecentIncidentsTable rows={data.recentIncidents} />
          </>
        )}
      </div>
    </div>
  )
}

function ChartSkeletons() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-80 rounded-card" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
      <Skeleton className="h-72 rounded-card" />
    </div>
  )
}
