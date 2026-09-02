'use client'

import { useState } from 'react'
import { AlertTriangle, FlaskConical, Lock } from 'lucide-react'
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
import { SyncAlertBanners } from './indicators/SyncAlertBanners'
import { IndicatorKpiCards } from './indicators/IndicatorKpiCards'
import {
  StatusDonutChart,
  TypeDistributionChart,
  VolumeChart,
} from './indicators/IndicatorCharts'
import {
  AgentProductivityTable,
  StaleIncidentsTable,
  TopOffendersTable,
} from './indicators/IndicatorTables'

export function OperationalDashboard() {
  const { role, isAdmin, canViewDashboard } = usePermissions()

  const [filters, setFilters] = useState<IndicatorFilters>({ period: 'month' })
  const patch = (next: Partial<IndicatorFilters>) =>
    setFilters((prev) => ({ ...prev, ...next }))

  const { data, isLoading, isError, isFetching } = useDashboardIndicators(filters)
  const units = useUnits(isAdmin)

  // Role still resolving — avoid flashing "access denied".
  if (role === null) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
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
            O dashboard de indicadores operacionais está disponível apenas para
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
          <h1 className="text-2xl font-bold text-ink">Dashboard operacional</h1>
          <p className="text-sm text-ink-secondary">
            Indicadores consolidados de ocorrências e abordagens
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

      {data && <SyncAlertBanners alerts={data.syncAlerts} />}

      <IndicatorKpiCards kpis={data?.kpis} loading={isLoading} />

      {isLoading || !data ? (
        <ChartSkeletons />
      ) : (
        <>
          <VolumeChart data={data.daily} />

          <div className="grid gap-4 lg:grid-cols-2">
            <TypeDistributionChart data={data.byType} />
            <StatusDonutChart data={data.byStatus} />
          </div>

          <div className="space-y-4">
            <TopOffendersTable rows={data.topOffenders} />
            <AgentProductivityTable rows={data.agentProductivity} />
            <StaleIncidentsTable rows={data.staleIncidents} />
          </div>
        </>
      )}
    </div>
  )
}

function ChartSkeletons() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-72 rounded-card" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
      <Skeleton className="h-56 rounded-card" />
    </div>
  )
}
