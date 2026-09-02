'use client'

import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '@/components/ui/card'
import type {
  DailyVolumePoint,
  StatusBreakdownEntry,
  TypeBreakdownEntry,
} from '@/lib/dashboard/indicators'

/**
 * Recharts visualisations for the operational dashboard. Colours come from the
 * validated categorical palette (blue / orange / aqua / yellow / magenta /
 * green); the status donut reuses SIGOP's reserved operational-status hues so it
 * matches the badges everywhere else.
 */

// Validated categorical palette (light surface) — fixed order, never cycled.
const SERIES = {
  incidents: '#2a78d6',
  stops: '#eb6834',
}

const BAR_PALETTE = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
]

const STATUS_COLORS: Record<string, string> = {
  open: '#1d4ed8',
  in_progress: '#c2410c',
  closed: '#15803d',
  archived: '#6b7280',
}

const AXIS = '#898781'
const GRID = '#e1e0d9'

const tooltipStyle = {
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  fontSize: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <Card className="rounded-card border-content-border p-4 shadow-card">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-secondary">{subtitle}</p>}
      </div>
      {children}
    </Card>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-ink-muted">
      {label}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1 — Volume por dia (LineChart)
// ---------------------------------------------------------------------------
export function VolumeChart({ data }: { data: DailyVolumePoint[] }) {
  const rows = useMemo(
    () =>
      data.map((point) => ({
        ...point,
        label: format(parseISO(point.day), 'dd/MM'),
      })),
    [data],
  )

  return (
    <ChartCard
      title="Volume por dia"
      subtitle="Ocorrências e abordagens registradas no período"
    >
      {rows.length === 0 ? (
        <EmptyState label="Sem registros no período" />
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: AXIS }}
                tickLine={false}
                axisLine={{ stroke: GRID }}
                minTickGap={16}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: AXIS }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(label) => `Dia ${label}`}
              />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="incidents"
                name="Ocorrências"
                stroke={SERIES.incidents}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="stops"
                name="Abordagens"
                stroke={SERIES.stops}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// 2 — Distribuição por tipo (horizontal BarChart)
// ---------------------------------------------------------------------------
export function TypeDistributionChart({ data }: { data: TypeBreakdownEntry[] }) {
  return (
    <ChartCard
      title="Distribuição por tipo"
      subtitle="Ocorrências por natureza, com proporção do total"
    >
      {data.length === 0 ? (
        <EmptyState label="Sem ocorrências no período" />
      ) : (
        <div
          className="w-full"
          style={{ height: Math.max(data.length * 44 + 24, 200) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={data}
              margin={{ top: 0, right: 44, bottom: 0, left: 8 }}
            >
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fontSize: 11, fill: AXIS }}
                tickLine={false}
                axisLine={{ stroke: GRID }}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={92}
                tick={{ fontSize: 12, fill: '#52514e' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, _name, entry) => [
                  `${value} (${(entry?.payload as TypeBreakdownEntry).pct}%)`,
                  'Ocorrências',
                ]}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20} label={{
                position: 'right',
                fontSize: 11,
                fill: '#52514e',
                formatter: (value: number) => `${value}`,
              }}>
                {data.map((entry, index) => (
                  <Cell key={entry.type} fill={BAR_PALETTE[index % BAR_PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// 3 — Status atual (donut)
// ---------------------------------------------------------------------------
export function StatusDonutChart({ data }: { data: StatusBreakdownEntry[] }) {
  const total = data.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <ChartCard title="Status atual" subtitle="Distribuição das ocorrências por status">
      {total === 0 ? (
        <EmptyState label="Sem ocorrências no período" />
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={58}
                outerRadius={92}
                paddingAngle={2}
                strokeWidth={2}
              >
                {data.map((entry) => (
                  <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#6b7280'} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number) => [
                  `${value} (${Math.round((value / total) * 100)}%)`,
                  'Ocorrências',
                ]}
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value, entry) => {
                  const count = (entry?.payload as unknown as StatusBreakdownEntry)?.count ?? 0
                  return `${value} — ${count}`
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}
