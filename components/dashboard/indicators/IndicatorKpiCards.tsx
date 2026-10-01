'use client'

import { format, parseISO } from 'date-fns'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarRange,
  FileText,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { DashboardKpiSet } from '@/lib/dashboard/indicators'

interface CardDef {
  label: string
  icon: LucideIcon
  iconWrap: string
  value: (kpis: DashboardKpiSet) => number | null
  hint: (kpis: DashboardKpiSet) => React.ReactNode
}

const formatNumber = (value: number) => value.toLocaleString('pt-BR')

/**
 * Change against the previous same-length range. Deliberately neutral ink —
 * more ocorrências is not "good" or "bad" by itself (more incidents, or just
 * more registering).
 */
function PeriodDelta({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) return <>No período</>
  if (previous === 0) {
    return <>{current === 0 ? 'Igual ao período anterior' : 'Sem registros no período anterior'}</>
  }

  const change = Math.round(((current - previous) / previous) * 100)
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : ArrowRight
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span className="inline-flex items-center gap-0.5 font-semibold text-ink">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {change > 0 ? '+' : ''}
        {change}%
      </span>
      vs. período anterior ({formatNumber(previous)})
    </span>
  )
}

const CARDS: CardDef[] = [
  {
    label: 'Ocorrências',
    icon: FileText,
    iconWrap: 'bg-kpi-total-bg text-kpi-total-icon',
    value: (k) => k.totalIncidents,
    hint: (k) => <PeriodDelta current={k.totalIncidents} previous={k.previousTotal} />,
  },
  {
    label: 'Média por dia',
    icon: CalendarRange,
    iconWrap: 'bg-kpi-sla-bg text-kpi-sla-icon',
    value: (k) => k.avgIncidentsPerDay,
    hint: (k) =>
      k.peakDay && k.peakDay.count > 0
        ? `Pico em ${format(parseISO(k.peakDay.day), 'dd/MM')}: ${formatNumber(k.peakDay.count)}`
        : 'No período',
  },
  {
    label: 'Meliantes envolvidos',
    icon: Users,
    iconWrap: 'bg-kpi-pending-bg text-kpi-pending-icon',
    value: (k) => k.offendersInvolved,
    hint: (k) => {
      if (k.offendersInvolved === null) return 'Indicador indisponível'
      const parts = [
        `${formatNumber(k.repeatOffenders ?? 0)} ${
          k.repeatOffenders === 1 ? 'reincidente' : 'reincidentes'
        }`,
      ]
      if (k.incidentsWithOffender !== null && k.totalIncidents > 0) {
        parts.push(
          `em ${Math.round((k.incidentsWithOffender / k.totalIncidents) * 100)}% das ocorrências`,
        )
      }
      return parts.join(' · ')
    },
  },
  {
    label: 'Agentes com registro',
    icon: ShieldCheck,
    iconWrap: 'bg-kpi-running-bg text-kpi-running-icon',
    value: (k) => k.activeAgents,
    hint: (k) =>
      k.activeAgents > 0
        ? `${(k.totalIncidents / k.activeAgents).toLocaleString('pt-BR', {
            maximumFractionDigits: 1,
          })} ocorrências por agente`
        : 'No período',
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
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {CARDS.map((def) => {
        const Icon = def.icon
        const value = kpis ? def.value(kpis) : null
        return (
          <Card
            key={def.label}
            className="rounded-card border-content-border p-4 shadow-card"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="kpi-label">{def.label}</p>
                {loading || !kpis ? (
                  <Skeleton className="mt-2 h-[30px] w-16" />
                ) : (
                  <p className="mt-2 text-kpi-value text-ink">
                    {value === null ? '—' : formatNumber(value)}
                  </p>
                )}
                <p className="mt-1.5 text-xs text-ink-secondary">
                  {loading || !kpis ? 'No período' : def.hint(kpis)}
                </p>
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
