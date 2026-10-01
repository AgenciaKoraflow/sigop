'use client'

import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/utils/cn'
import { Card } from '@/components/ui/card'
import type {
  GeoBreakdown,
  GeoDimension,
  TypeBreakdownEntry,
  VolumeSeries,
  WeekdayHourCell,
} from '@/lib/dashboard/indicators'

/**
 * Visualisations for the operational dashboard. Every chart shows a single
 * measure (ocorrências), so they all share one hue: bars use the series blue
 * and the heatmap uses the same blue as a light → dark ramp.
 */

const SERIES = '#2a78d6'
/** Sequential blue ramp, lightest → darkest, for the heatmap. */
const HEAT_RAMP = ['#cde2fb', '#9ec5f4', '#5598e7', '#256abf', '#104281']
const HEAT_EMPTY = '#f0f1f3'

const AXIS = '#898781'
const GRID = '#e1e0d9'

const tooltipStyle = {
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  fontSize: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
}

const plural = (count: number) => (count === 1 ? 'ocorrência' : 'ocorrências')

function ChartCard({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title: string
  subtitle?: React.ReactNode
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn('rounded-card border-content-border p-4 shadow-card', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {subtitle && <p className="text-xs text-ink-secondary">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-48 items-center justify-center text-sm text-ink-muted">
      {label}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ranked horizontal bars (shared by "por tipo" and "por região")
// ---------------------------------------------------------------------------
interface RankRow {
  key: string
  label: string
  detail?: string | null
  count: number
  pct: number
}

function RankBars({ rows }: { rows: RankRow[] }) {
  const max = Math.max(...rows.map((row) => row.count), 1)

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li
          key={row.key}
          className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_4.75rem] items-center gap-3"
          title={`${row.label}: ${row.count} ${plural(row.count)} (${row.pct}%)`}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm text-ink">{row.label}</span>
            {row.detail && (
              <span className="block truncate text-[11px] leading-tight text-ink-muted">
                {row.detail}
              </span>
            )}
          </span>
          <span className="h-2.5">
            <span
              className="block h-full rounded-r-[4px]"
              style={{
                width: `${(row.count / max) * 100}%`,
                minWidth: row.count > 0 ? 2 : 0,
                backgroundColor: SERIES,
              }}
            />
          </span>
          <span className="text-right text-sm tabular-nums text-ink">
            {row.count.toLocaleString('pt-BR')}
            <span className="ml-1.5 inline-block w-8 text-xs text-ink-muted">{row.pct}%</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// 1 — Ocorrências ao longo do tempo
// ---------------------------------------------------------------------------
export function VolumeChart({ data }: { data: VolumeSeries }) {
  const monthly = data.granularity === 'month'

  const rows = useMemo(
    () =>
      data.points.map((point) => {
        const date = parseISO(point.bucket)
        return {
          incidents: point.incidents,
          label: format(date, monthly ? 'MMM/yy' : 'dd/MM', { locale: ptBR }),
          fullLabel: format(date, monthly ? "MMMM 'de' yyyy" : "EEEE, dd 'de' MMMM", {
            locale: ptBR,
          }),
        }
      }),
    [data.points, monthly],
  )

  const total = rows.reduce((sum, row) => sum + row.incidents, 0)
  const average = rows.length > 0 ? total / rows.length : 0
  const averageLabel = average.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

  return (
    <ChartCard
      title={monthly ? 'Ocorrências por mês' : 'Ocorrências por dia'}
      subtitle={
        total === 0
          ? 'Registros no período'
          : `Média de ${averageLabel} por ${monthly ? 'mês' : 'dia'} no período`
      }
    >
      {total === 0 ? (
        <EmptyState label="Sem ocorrências no período" />
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
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
                cursor={{ fill: 'rgba(15,23,42,0.04)' }}
                contentStyle={tooltipStyle}
                labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullLabel ?? ''}
                formatter={(value: number) => [value, plural(value)]}
              />
              <ReferenceLine
                y={average}
                stroke={AXIS}
                strokeDasharray="4 4"
                label={{
                  value: `média ${averageLabel}`,
                  position: 'insideTopRight',
                  fontSize: 11,
                  fill: AXIS,
                }}
              />
              <Bar
                dataKey="incidents"
                fill={SERIES}
                radius={[3, 3, 0, 0]}
                maxBarSize={32}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// 2 — Ocorrências por tipo
// ---------------------------------------------------------------------------
export function TypeDistributionChart({ data }: { data: TypeBreakdownEntry[] }) {
  return (
    <ChartCard title="Ocorrências por tipo" subtitle="Quantidade e participação no total">
      {data.length === 0 ? (
        <EmptyState label="Sem ocorrências no período" />
      ) : (
        <RankBars
          rows={data.map((entry) => ({
            key: entry.type,
            label: entry.label,
            count: entry.count,
            pct: entry.pct,
          }))}
        />
      )}
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// 3 — Ocorrências por região (Contratada / Município da AT / AT)
// ---------------------------------------------------------------------------
const GEO_TABS: { value: GeoDimension; label: string; missing: string }[] = [
  { value: 'contractor', label: 'Contratada', missing: 'sem contratada' },
  { value: 'municipality', label: 'Município', missing: 'sem município da AT' },
  { value: 'territorialArea', label: 'AT', missing: 'sem AT' },
]

export function GeographyChart({ data }: { data: Record<GeoDimension, GeoBreakdown> }) {
  const [dimension, setDimension] = useState<GeoDimension>('contractor')
  const tab = GEO_TABS.find((t) => t.value === dimension) ?? GEO_TABS[0]
  const breakdown = data[dimension]

  return (
    <ChartCard
      title="Ocorrências por região"
      subtitle="As 10 com mais registros no período"
      action={
        <div
          role="group"
          aria-label="Agrupar por"
          className="inline-flex rounded-input border border-content-border p-0.5"
        >
          {GEO_TABS.map((option) => {
            const active = option.value === dimension
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setDimension(option.value)}
                className={cn(
                  'h-7 rounded-[6px] px-2.5 text-xs font-medium transition-colors',
                  active ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink',
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      }
    >
      {breakdown.entries.length === 0 ? (
        <EmptyState label={`Nenhuma ocorrência com ${tab.label.toLowerCase()} informada`} />
      ) : (
        <RankBars
          rows={breakdown.entries.map((entry) => ({
            key: entry.id,
            label: entry.name,
            detail: entry.detail,
            count: entry.count,
            pct: entry.pct,
          }))}
        />
      )}
      {breakdown.unassigned > 0 && (
        <p className="mt-4 border-t border-content-divider pt-3 text-xs text-ink-secondary">
          {breakdown.unassigned.toLocaleString('pt-BR')} {plural(breakdown.unassigned)}{' '}
          {tab.missing} — fora deste ranking.
        </p>
      )}
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// 4 — Quando acontecem (dia da semana × hora)
// ---------------------------------------------------------------------------
/** Rows run Monday → Sunday; values are Postgres `DOW` (0 = Sunday). */
const WEEKDAYS: { dow: number; short: string; long: string }[] = [
  { dow: 1, short: 'Seg', long: 'segunda-feira' },
  { dow: 2, short: 'Ter', long: 'terça-feira' },
  { dow: 3, short: 'Qua', long: 'quarta-feira' },
  { dow: 4, short: 'Qui', long: 'quinta-feira' },
  { dow: 5, short: 'Sex', long: 'sexta-feira' },
  { dow: 6, short: 'Sáb', long: 'sábado' },
  { dow: 0, short: 'Dom', long: 'domingo' },
]

const DAY_PARTS: { label: string; from: number; to: number }[] = [
  { label: 'madrugada (0h–6h)', from: 0, to: 6 },
  { label: 'manhã (6h–12h)', from: 6, to: 12 },
  { label: 'tarde (12h–18h)', from: 12, to: 18 },
  { label: 'noite (18h–24h)', from: 18, to: 24 },
]

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

const hourRange = (hour: number) => `${hour}h–${hour + 1}h`

function heatColor(count: number, max: number): string {
  if (count <= 0 || max <= 0) return HEAT_EMPTY
  const step = Math.min(Math.ceil((count / max) * HEAT_RAMP.length), HEAT_RAMP.length)
  return HEAT_RAMP[step - 1]
}

export function WeekdayHourHeatmap({ data }: { data: WeekdayHourCell[] }) {
  const [hovered, setHovered] = useState<{ dow: number; hour: number } | null>(null)

  const { counts, max, total, busiestDay, busiestPart } = useMemo(() => {
    const counts = new Map<string, number>()
    const perDay = new Map<number, number>()
    const perPart = DAY_PARTS.map(() => 0)
    let max = 0
    let total = 0

    for (const cell of data) {
      counts.set(`${cell.dow}-${cell.hour}`, cell.count)
      perDay.set(cell.dow, (perDay.get(cell.dow) ?? 0) + cell.count)
      const part = DAY_PARTS.findIndex((p) => cell.hour >= p.from && cell.hour < p.to)
      if (part >= 0) perPart[part] += cell.count
      max = Math.max(max, cell.count)
      total += cell.count
    }

    const topDay = WEEKDAYS.reduce((best, day) =>
      (perDay.get(day.dow) ?? 0) > (perDay.get(best.dow) ?? 0) ? day : best,
    )
    const topPart = perPart.indexOf(Math.max(...perPart))

    return {
      counts,
      max,
      total,
      busiestDay: { ...topDay, count: perDay.get(topDay.dow) ?? 0 },
      busiestPart: { ...DAY_PARTS[topPart], count: perPart[topPart] },
    }
  }, [data])

  const pct = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0)

  const hoveredDay = hovered ? WEEKDAYS.find((d) => d.dow === hovered.dow) : null
  const hoveredCount = hovered ? counts.get(`${hovered.dow}-${hovered.hour}`) ?? 0 : 0

  return (
    <ChartCard
      title="Quando as ocorrências acontecem"
      subtitle="Dia da semana × hora do fato (horário de Brasília)"
    >
      {total === 0 ? (
        <EmptyState label="Sem ocorrências no período" />
      ) : (
        <>
          <p className="mb-3 min-h-[1.25rem] text-xs text-ink-secondary" aria-live="polite">
            {hovered && hoveredDay ? (
              <>
                <span className="font-semibold capitalize text-ink">{hoveredDay.long}</span>,{' '}
                {hourRange(hovered.hour)}:{' '}
                <span className="font-semibold text-ink">
                  {hoveredCount} {plural(hoveredCount)}
                </span>
              </>
            ) : (
              <>
                Mais ocorrências na{' '}
                <span className="font-semibold text-ink">{busiestPart.label}</span> (
                {pct(busiestPart.count)}%) e {busiestDay.dow === 0 || busiestDay.dow === 6 ? 'no' : 'na'}{' '}
                <span className="font-semibold text-ink">{busiestDay.long}</span> (
                {pct(busiestDay.count)}%).
              </>
            )}
          </p>

          <div className="overflow-x-auto">
            <div
              className="grid min-w-[560px] gap-[2px]"
              style={{ gridTemplateColumns: '2.25rem repeat(24, minmax(0, 1fr))' }}
              onMouseLeave={() => setHovered(null)}
            >
              <span />
              {HOURS.map((hour) => (
                <span
                  key={hour}
                  className="pb-1 text-left text-[10px] tabular-nums text-ink-muted"
                >
                  {hour % 3 === 0 ? `${hour}h` : ''}
                </span>
              ))}

              {WEEKDAYS.map((day) => (
                <div key={day.dow} className="contents">
                  <span className="flex items-center text-xs text-ink-secondary">{day.short}</span>
                  {HOURS.map((hour) => {
                    const count = counts.get(`${day.dow}-${hour}`) ?? 0
                    const active = hovered?.dow === day.dow && hovered.hour === hour
                    return (
                      <span
                        key={hour}
                        role="img"
                        aria-label={`${day.long}, ${hourRange(hour)}: ${count} ${plural(count)}`}
                        title={`${day.short}, ${hourRange(hour)}: ${count} ${plural(count)}`}
                        onMouseEnter={() => setHovered({ dow: day.dow, hour })}
                        className={cn(
                          'h-7 rounded-[3px]',
                          active && 'ring-2 ring-ink ring-offset-1',
                        )}
                        style={{ backgroundColor: heatColor(count, max) }}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-ink-muted">
            <span>0</span>
            <span className="h-3 w-4 rounded-[3px]" style={{ backgroundColor: HEAT_EMPTY }} />
            {HEAT_RAMP.map((color) => (
              <span key={color} className="h-3 w-4 rounded-[3px]" style={{ backgroundColor: color }} />
            ))}
            <span>{max} por hora</span>
          </div>
        </>
      )}
    </ChartCard>
  )
}
