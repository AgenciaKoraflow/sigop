import {
  AlertTriangle,
  CalendarClock,
  FileText,
  UserCheck,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { DashboardKpis } from '@/lib/dashboard/types'

interface KpiDef {
  key: keyof DashboardKpis
  label: string
  description: string
  icon: LucideIcon
  iconWrap: string
}

const KPIS: KpiDef[] = [
  {
    key: 'totalIncidents',
    label: 'Total de ocorrências',
    description: 'Últimos 30 dias',
    icon: FileText,
    iconWrap: 'bg-kpi-total-bg text-kpi-total-icon',
  },
  {
    key: 'today',
    label: 'Registradas hoje',
    description: 'Ocorrências de hoje',
    icon: CalendarClock,
    iconWrap: 'bg-kpi-running-bg text-kpi-running-icon',
  },
  {
    key: 'flagrante',
    label: 'Flagrantes',
    description: 'Ocorrências + abordagens · 30 dias',
    icon: AlertTriangle,
    iconWrap: 'bg-kpi-backlog-bg text-kpi-backlog-icon',
  },
  {
    key: 'stops',
    label: 'Abordagens',
    description: 'Últimos 30 dias',
    icon: UserCheck,
    iconWrap: 'bg-kpi-sla-bg text-kpi-sla-icon',
  },
]

export function KpiRow({
  kpis,
  loading,
}: {
  kpis?: DashboardKpis
  loading?: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {KPIS.map((def) => {
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
                  </p>
                )}
                <p className="mt-1.5 text-xs text-ink-secondary">{def.description}</p>
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
