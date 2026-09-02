'use client'

import {
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Target,
  UserCheck,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { DashboardKpiSet } from '@/lib/dashboard/indicators'

interface CardDef {
  key: keyof DashboardKpiSet
  label: string
  hint: string
  icon: LucideIcon
  iconWrap: string
  suffix?: string
}

const CARDS: CardDef[] = [
  {
    key: 'totalIncidents',
    label: 'Total de ocorrências',
    hint: 'No período',
    icon: FileText,
    iconWrap: 'bg-kpi-total-bg text-kpi-total-icon',
  },
  {
    key: 'pending',
    label: 'Pendentes',
    hint: 'Aberta + em andamento',
    icon: Clock,
    iconWrap: 'bg-kpi-pending-bg text-kpi-pending-icon',
  },
  {
    key: 'closed',
    label: 'Encerradas',
    hint: 'No período',
    icon: CheckCircle,
    iconWrap: 'bg-kpi-done-bg text-kpi-done-icon',
  },
  {
    key: 'totalStops',
    label: 'Total de abordagens',
    hint: 'No período',
    icon: UserCheck,
    iconWrap: 'bg-kpi-running-bg text-kpi-running-icon',
  },
  {
    key: 'flagrante',
    label: 'Flagrantes registrados',
    hint: 'Ocorrências + abordagens',
    icon: AlertTriangle,
    iconWrap: 'bg-kpi-backlog-bg text-kpi-backlog-icon',
  },
  {
    key: 'closureRate',
    label: 'Taxa de encerramento',
    hint: 'Encerradas / total',
    icon: Target,
    iconWrap: 'bg-kpi-sla-bg text-kpi-sla-icon',
    suffix: '%',
  },
]

export function IndicatorKpiCards({
  kpis,
  loading,
}: {
  kpis?: DashboardKpiSet
  loading?: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">
      {CARDS.map((def) => {
        const Icon = def.icon
        return (
          <Card
            key={def.key}
            className="rounded-card border-content-border p-4 shadow-card"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="kpi-label">{def.label}</p>
                {loading || !kpis ? (
                  <Skeleton className="mt-2 h-[30px] w-16" />
                ) : (
                  <p className="mt-2 text-kpi-value text-ink">
                    {kpis[def.key].toLocaleString('pt-BR')}
                    {def.suffix}
                  </p>
                )}
                <p className="mt-1.5 text-xs text-ink-secondary">{def.hint}</p>
              </div>
              <span
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-icon',
                  def.iconWrap,
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
