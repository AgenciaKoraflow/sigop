'use client'

import {
  CalendarCheck,
  CalendarRange,
  KeyRound,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  EyeOff,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import type { UserStats } from '@/lib/usuarios/data'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface CardDef {
  label: string
  icon: LucideIcon
  iconWrap: string
  value: (stats: UserStats) => number
  hint: (stats: UserStats) => string
}

const formatNumber = (value: number) => value.toLocaleString('pt-BR')

const share = (part: number, total: number) =>
  total > 0 ? `${Math.round((part / total) * 100)}% do total` : '—'

const CARDS: CardDef[] = [
  {
    label: 'Total de usuários',
    icon: Users,
    iconWrap: 'bg-kpi-total-bg text-kpi-total-icon',
    value: (s) => s.total,
    hint: () => 'Cadastrados',
  },
  {
    label: 'Ativos',
    icon: UserCheck,
    iconWrap: 'bg-kpi-running-bg text-kpi-running-icon',
    value: (s) => s.active,
    hint: (s) => share(s.active, s.total),
  },
  {
    label: 'Inativos',
    icon: UserX,
    iconWrap: 'bg-kpi-pending-bg text-kpi-pending-icon',
    value: (s) => s.inactive,
    hint: () => 'Login bloqueado',
  },
  {
    label: 'Nunca acessaram',
    icon: EyeOff,
    iconWrap: 'bg-kpi-pending-bg text-kpi-pending-icon',
    value: (s) => s.neverLoggedIn,
    hint: (s) => share(s.neverLoggedIn, s.total),
  },
  {
    label: 'Login no dia',
    icon: CalendarCheck,
    iconWrap: 'bg-kpi-sla-bg text-kpi-sla-icon',
    value: (s) => s.loggedInToday,
    hint: () => 'Entraram hoje',
  },
  {
    label: 'Login 7 dias',
    icon: CalendarRange,
    iconWrap: 'bg-kpi-sla-bg text-kpi-sla-icon',
    value: (s) => s.loggedInLast7Days,
    hint: (s) => share(s.loggedInLast7Days, s.total),
  },
  {
    label: 'Trocas de senha',
    icon: KeyRound,
    iconWrap: 'bg-kpi-total-bg text-kpi-total-icon',
    value: (s) => s.passwordChanges,
    hint: (s) => `${formatNumber(s.passwordChangesLast30Days)} nos últimos 30 dias`,
  },
  {
    label: 'Novos 30 dias',
    icon: UserPlus,
    iconWrap: 'bg-kpi-running-bg text-kpi-running-icon',
    value: (s) => s.newLast30Days,
    hint: () => 'Criados no período',
  },
]

export function UserStatsCards({
  data,
  isLoading,
  isError,
}: {
  data?: UserStats
  isLoading?: boolean
  isError?: boolean
}) {
  return (
    <section aria-label="Indicadores de usuários" className="space-y-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {CARDS.map((def) => {
          const Icon = def.icon
          return (
            <Card key={def.label} className="rounded-card border-content-border p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="kpi-label">{def.label}</p>
                  {isLoading ? (
                    <Skeleton className="mt-2 h-[30px] w-16" />
                  ) : (
                    <p className="mt-2 text-kpi-value text-ink">
                      {data ? formatNumber(def.value(data)) : '—'}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-ink-secondary">
                    {data ? def.hint(data) : ' '}
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
      {isError && (
        <p className="text-xs font-medium text-danger">
          Não foi possível carregar os indicadores de usuários.
        </p>
      )}
    </section>
  )
}
