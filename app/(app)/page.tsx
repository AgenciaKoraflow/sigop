'use client'

import { AlertTriangle } from 'lucide-react'
import { useDashboardData } from '@/hooks/use-dashboard-data'
import { QuickActions } from '@/components/dashboard/QuickActions'
import { RecentActivity } from '@/components/dashboard/RecentActivity'
import { DemoBanner, OfflineBanner } from '@/components/dashboard/DashboardBanners'
import { Card } from '@/components/ui/card'

export default function DashboardPage() {
  const { data, isLoading, isError } = useDashboardData()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {data?.fromCache && <OfflineBanner />}
      {data?.isDemo && <DemoBanner />}
      {isError && !data && (
        <div className="flex items-center gap-2 rounded-input border border-danger/20 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Não foi possível carregar o painel. Tente novamente em instantes.
        </div>
      )}

      <Card className="flex flex-col items-center gap-3 rounded-card border-content-border p-8 text-center shadow-card sm:p-12">
        <h1 className="text-2xl font-bold text-ink">Bem-vindo ao SIGOP</h1>
        <p className="max-w-md text-sm text-ink-secondary">
          Registre uma nova ocorrência ou abordagem em poucos passos.
        </p>
        <div className="mt-2">
          <QuickActions />
        </div>
      </Card>

      <RecentActivity items={data?.items ?? []} loading={isLoading} />
    </div>
  )
}
