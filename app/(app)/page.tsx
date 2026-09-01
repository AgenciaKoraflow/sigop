'use client'

import { AlertTriangle } from 'lucide-react'
import { useDashboardData } from '@/hooks/use-dashboard-data'
import { QuickActions } from '@/components/dashboard/QuickActions'
import { KpiRow } from '@/components/dashboard/KpiRow'
import { RecentActivity } from '@/components/dashboard/RecentActivity'
import { DemoBanner, OfflineBanner } from '@/components/dashboard/DashboardBanners'

export default function DashboardPage() {
  const { data, isLoading, isError } = useDashboardData()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-bold text-ink">Painel Operacional</h1>
          <p className="text-sm text-ink-secondary">Visão do dia</p>
        </div>
        <QuickActions />
      </div>

      {data?.fromCache && <OfflineBanner />}
      {data?.isDemo && <DemoBanner />}
      {isError && !data && (
        <div className="flex items-center gap-2 rounded-input border border-danger/20 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Não foi possível carregar o painel. Tente novamente em instantes.
        </div>
      )}

      <KpiRow kpis={data?.kpis} loading={isLoading} />

      <RecentActivity items={data?.items ?? []} loading={isLoading} />
    </div>
  )
}
