'use client'

import * as React from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Info } from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { useUserDashboard } from '@/hooks/use-users'
import type { DashboardPeriod, DistributionRow, UserDashboard } from '@/lib/usuarios/data'
import { roleOptionLabel } from '@/lib/usuarios/form'
import { UserStatsCards } from '@/components/usuarios/UserStatsCards'
import {
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui'
import { Card } from '@/components/ui/card'

const SERIES = '#2a78d6'
const SERIES_2 = '#d9822b'
const MUTED_SLICE = '#c9c8c1'
const AXIS = '#898781'
const GRID = '#e1e0d9'

const tooltipStyle = {
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  fontSize: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
}

const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: 7, label: 'Últimos 7 dias' },
  { value: 30, label: 'Últimos 30 dias' },
  { value: 90, label: 'Últimos 90 dias' },
]

const fmtDay = (iso: string, pattern = 'dd/MM') => {
  try {
    return format(parseISO(iso), pattern, { locale: ptBR })
  } catch {
    return '—'
  }
}

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—'
  try {
    return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
  } catch {
    return '—'
  }
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

function ChartCard({
  title,
  subtitle,
  className,
  children,
}: {
  title: string
  subtitle?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn('rounded-card border-content-border p-4 shadow-card', className)}>
      <div className="mb-4 min-w-0">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-secondary">{subtitle}</p>}
      </div>
      {children}
    </Card>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-40 items-center justify-center text-center text-sm text-ink-muted">
      {label}
    </div>
  )
}

function UserLink({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/usuarios/${id}`} className="font-medium text-ink hover:underline">
      {name}
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------
function LoginsPerDayChart({ data }: { data: UserDashboard['loginsPerDay'] }) {
  if (data.every((point) => point.logins === 0)) {
    return <EmptyState label="Nenhum login registrado no período." />
  }
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={(value: string) => fmtDay(value)}
            tick={{ fill: AXIS, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: AXIS, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(value: string) => fmtDay(value, "EEEE, dd 'de' MMM")}
            formatter={(value: number, name: string) => [value, name]}
          />
          <Bar dataKey="logins" name="Logins" fill={SERIES} radius={[3, 3, 0, 0]} />
          <Line
            dataKey="users"
            name="Usuários únicos"
            stroke={SERIES_2}
            strokeWidth={2}
            dot={false}
            type="monotone"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

function StatusDonut({ active, inactive }: { active: number; inactive: number }) {
  const total = active + inactive
  if (total === 0) return <EmptyState label="Nenhum usuário cadastrado." />
  const slices = [
    { name: 'Ativos', value: active, color: SERIES },
    { name: 'Inativos', value: inactive, color: MUTED_SLICE },
  ]
  return (
    <div>
      <div className="relative h-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="90%"
              paddingAngle={active > 0 && inactive > 0 ? 2 : 0}
              stroke="none"
            >
              {slices.map((slice) => (
                <Cell key={slice.name} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-ink">{total.toLocaleString('pt-BR')}</span>
          <span className="text-xs text-ink-secondary">usuários</span>
        </div>
      </div>
      <Legend
        items={slices.map((slice) => ({
          color: slice.color,
          label: `${slice.name}: ${slice.value.toLocaleString('pt-BR')}`,
        }))}
      />
    </div>
  )
}

/** Horizontal bars; the dark part is the share of active users. */
function DistributionBars({ rows, labelOf }: { rows: DistributionRow[]; labelOf?: (key: string) => string }) {
  if (rows.length === 0) return <EmptyState label="Sem dados." />
  const max = Math.max(...rows.map((row) => row.total), 1)
  return (
    <div>
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li
            key={row.label}
            className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3rem] items-center gap-3"
            title={`${labelOf ? labelOf(row.label) : row.label}: ${row.active} ativos de ${row.total}`}
          >
            <span className="truncate text-sm text-ink">{labelOf ? labelOf(row.label) : row.label}</span>
            <span className="relative block h-2.5 rounded-r-[4px] bg-[#f0f1f3]">
              <span
                className="absolute inset-y-0 left-0 block rounded-r-[4px]"
                style={{ width: `${(row.total / max) * 100}%`, backgroundColor: MUTED_SLICE }}
              />
              <span
                className="absolute inset-y-0 left-0 block rounded-r-[4px]"
                style={{ width: `${(row.active / max) * 100}%`, backgroundColor: SERIES }}
              />
            </span>
            <span className="text-right text-sm font-medium tabular-nums text-ink">{row.total}</span>
          </li>
        ))}
      </ul>
      <Legend
        items={[
          { color: SERIES, label: 'Ativos' },
          { color: MUTED_SLICE, label: 'Inativos' },
        ]}
      />
    </div>
  )
}

function PasswordChangesChart({ data }: { data: UserDashboard['passwordChangesPerWeek'] }) {
  if (data.every((point) => point.count === 0)) {
    return <EmptyState label="Nenhuma troca de senha registrada ainda." />
  }
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="weekStart"
            tickFormatter={(value: string) => fmtDay(value)}
            tick={{ fill: AXIS, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            minTickGap={16}
          />
          <YAxis allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(value: string) => `Semana de ${fmtDay(value)}`}
          />
          <Bar dataKey="count" name="Trocas de senha" fill={SERIES} radius={[3, 3, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
function TopAccessedTable({ rows }: { rows: UserDashboard['topAccessed'] }) {
  if (rows.length === 0) return <EmptyState label="Nenhum acesso registrado no período." />
  const max = Math.max(...rows.map((row) => row.logins), 1)
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-8 text-xs">#</TableHead>
          <TableHead className="text-xs">Usuário</TableHead>
          <TableHead className="text-xs">Acessos</TableHead>
          <TableHead className="hidden text-xs sm:table-cell">Último acesso</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={row.id}>
            <TableCell className="text-sm tabular-nums text-ink-muted">{index + 1}</TableCell>
            <TableCell>
              <UserLink id={row.id} name={row.fullName} />
              <p className="text-xs text-ink-muted">
                {roleOptionLabel(row.role)}
                {row.unitName ? ` · ${row.unitName}` : ''}
              </p>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <span className="block h-2 w-16 rounded-r-[4px] bg-[#f0f1f3] sm:w-24">
                  <span
                    className="block h-full rounded-r-[4px]"
                    style={{ width: `${(row.logins / max) * 100}%`, backgroundColor: SERIES }}
                  />
                </span>
                <span className="text-sm font-semibold tabular-nums text-ink">{row.logins}</span>
              </div>
            </TableCell>
            <TableCell className="hidden text-xs text-ink-secondary sm:table-cell">
              {fmtDateTime(row.lastLoginAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function NeverLoggedInTable({ rows }: { rows: UserDashboard['neverLoggedIn'] }) {
  if (rows.length === 0) return <EmptyState label="Todos os usuários já acessaram o sistema." />
  return (
    <div className="max-h-80 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-xs">Usuário</TableHead>
            <TableHead className="hidden text-xs sm:table-cell">Papel</TableHead>
            <TableHead className="text-xs">Cadastrado há</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className={cn(!row.isActive && 'opacity-60')}>
              <TableCell>
                <UserLink id={row.id} name={row.fullName} />
                <p className="text-xs text-ink-muted">{row.email ?? '—'}</p>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <Badge variant="secondary">{roleOptionLabel(row.role)}</Badge>
              </TableCell>
              <TableCell className="text-sm text-ink-secondary">
                {row.daysSinceCreated === null
                  ? '—'
                  : row.daysSinceCreated === 0
                    ? 'hoje'
                    : `${row.daysSinceCreated} ${plural(row.daysSinceCreated, 'dia', 'dias')}`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function DormantTable({ rows }: { rows: UserDashboard['dormant'] }) {
  if (rows.length === 0) return <EmptyState label="Nenhum usuário ativo parado há mais de 30 dias." />
  return (
    <div className="max-h-80 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-xs">Usuário</TableHead>
            <TableHead className="hidden text-xs sm:table-cell">Último acesso</TableHead>
            <TableHead className="text-xs">Sem acessar há</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <UserLink id={row.id} name={row.fullName} />
                <p className="text-xs text-ink-muted">
                  {roleOptionLabel(row.role)}
                  {row.unitName ? ` · ${row.unitName}` : ''}
                </p>
              </TableCell>
              <TableCell className="hidden text-xs text-ink-secondary sm:table-cell">
                {fmtDateTime(row.lastLoginAt)}
              </TableCell>
              <TableCell className="text-sm text-ink-secondary">
                {row.daysSince} {plural(row.daysSince, 'dia', 'dias')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export function UsuariosDashboard() {
  const [days, setDays] = React.useState<DashboardPeriod>(30)
  const { data, isLoading, isError } = useUserDashboard(days)

  const tracking = data?.loginTracking

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-ink">Dashboard de usuários</h1>
        <Select value={String(days)} onValueChange={(value) => setDays(Number(value) as DashboardPeriod)}>
          <SelectTrigger className="sm:w-48" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={String(option.value)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {isError && (
        <p className="rounded-input border border-danger/20 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
          Não foi possível carregar o dashboard. Tente novamente em instantes.
        </p>
      )}

      {tracking && !tracking.available && (
        <p className="flex items-start gap-2 rounded-input border border-sync-pending-text/20 bg-sync-pending-bg px-3 py-2 text-xs font-medium text-sync-pending-text">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          O registro de acessos ainda não está ativo no banco (aplique sql/018_login_events.sql).
          Ranking e gráfico de logins ficam vazios até lá.
        </p>
      )}
      {tracking?.available && tracking.since && (
        <p className="flex items-start gap-2 text-xs text-ink-secondary">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Contagem de acessos registrada desde {fmtDateTime(tracking.since)}. Antes disso, só o
          último login de cada usuário é conhecido.
        </p>
      )}

      <UserStatsCards data={data?.kpis} isLoading={isLoading} isError={isError} />

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Logins por dia"
          subtitle={
            data
              ? `${data.kpis.loginsInPeriod.toLocaleString('pt-BR')} ${plural(data.kpis.loginsInPeriod, 'login', 'logins')} no período`
              : undefined
          }
          className="lg:col-span-2"
        >
          {isLoading || !data ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <LoginsPerDayChart data={data.loginsPerDay} />
              <Legend
                items={[
                  { color: SERIES, label: 'Logins' },
                  { color: SERIES_2, label: 'Usuários únicos' },
                ]}
              />
            </>
          )}
        </ChartCard>

        <ChartCard title="Ativos × inativos" subtitle="Situação atual do cadastro">
          {isLoading || !data ? (
            <Skeleton className="h-44 w-full" />
          ) : (
            <StatusDonut active={data.kpis.active} inactive={data.kpis.inactive} />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Ranking: mais acessados" subtitle={`Top 10 por número de logins — ${PERIOD_OPTIONS.find((o) => o.value === days)?.label.toLowerCase()}`}>
          {isLoading || !data ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <TopAccessedTable rows={data.topAccessed} />
          )}
        </ChartCard>

        <ChartCard
          title="Nunca acessaram"
          subtitle={data ? `${data.neverLoggedIn.length} ${plural(data.neverLoggedIn.length, 'usuário', 'usuários')} sem nenhum login` : undefined}
        >
          {isLoading || !data ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <NeverLoggedInTable rows={data.neverLoggedIn} />
          )}
        </ChartCard>

        <ChartCard
          title="Parados há 30+ dias"
          subtitle="Usuários ativos que não entram há mais de 30 dias"
        >
          {isLoading || !data ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <DormantTable rows={data.dormant} />
          )}
        </ChartCard>

        <ChartCard title="Trocas de senha por semana" subtitle="Últimas 12 semanas">
          {isLoading || !data ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <PasswordChangesChart data={data.passwordChangesPerWeek} />
          )}
        </ChartCard>

        <ChartCard title="Usuários por papel">
          {isLoading || !data ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <DistributionBars rows={data.byRole} labelOf={roleOptionLabel} />
          )}
        </ChartCard>

        <ChartCard title="Usuários por unidade">
          {isLoading || !data ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <DistributionBars rows={data.byUnit} />
          )}
        </ChartCard>
      </div>
    </div>
  )
}
