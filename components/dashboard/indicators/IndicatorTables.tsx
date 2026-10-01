'use client'

import Link from 'next/link'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils/cn'
import { typeBadgeClass } from '@/lib/dashboard/labels'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type {
  AgentProductivityRow,
  RecentIncidentRow,
  TopOffenderRow,
} from '@/lib/dashboard/indicators'

function TableCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden rounded-card border-content-border shadow-card">
      <div className="border-b border-content-border p-4">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-secondary">{subtitle}</p>}
      </div>
      {children}
    </Card>
  )
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-ink-muted">
        {label}
      </TableCell>
    </TableRow>
  )
}

const shortDate = (iso: string | null) =>
  iso ? format(parseISO(iso), 'dd/MM/yyyy', { locale: ptBR }) : '—'

/** Count with a proportional bar, so a ranking reads at a glance. */
function CountBar({ count, max }: { count: number; max: number }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="hidden h-2 w-16 sm:block">
        <span
          className="ml-auto block h-full rounded-l-[4px] bg-[#2a78d6]"
          style={{ width: `${max > 0 ? (count / max) * 100 : 0}%`, minWidth: count > 0 ? 2 : 0 }}
        />
      </span>
      <span className="w-8 text-right font-mono tabular-nums">{count}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top meliantes
// ---------------------------------------------------------------------------
export function TopOffendersTable({ rows }: { rows: TopOffenderRow[] }) {
  const max = Math.max(...rows.map((row) => row.incidentCount), 0)

  return (
    <TableCard
      title="Top meliantes"
      subtitle="Mais vinculados a ocorrências no período (suspeito ou autor)"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Meliante</TableHead>
            <TableHead className="text-right">Ocorrências</TableHead>
            <TableHead>Última</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={3} label="Nenhum meliante vinculado a ocorrências no período" />
          ) : (
            rows.map((row) => {
              const name = row.fullName ?? row.nickname ?? 'Sem nome'
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="font-medium text-ink">
                      {row.id.startsWith('demo-') ? (
                        name
                      ) : (
                        <Link href={`/meliantes/${row.id}`} className="hover:underline">
                          {name}
                        </Link>
                      )}
                    </span>
                    {row.fullName && row.nickname && (
                      <span className="block text-xs text-ink-muted">“{row.nickname}”</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <CountBar count={row.incidentCount} max={max} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-ink-secondary">
                    {shortDate(row.lastOccurredAt)}
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </TableCard>
  )
}

// ---------------------------------------------------------------------------
// Registros por agente
// ---------------------------------------------------------------------------
export function AgentProductivityTable({ rows }: { rows: AgentProductivityRow[] }) {
  const max = Math.max(...rows.map((row) => row.incidentsCreated), 0)

  return (
    <TableCard title="Registros por agente" subtitle="Ocorrências registradas no período">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agente</TableHead>
            <TableHead className="text-right">Ocorrências</TableHead>
            <TableHead className="text-right">% do total</TableHead>
            <TableHead>Último registro</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={4} label="Nenhum registro no período" />
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <span className="font-medium text-ink">{row.fullName ?? '—'}</span>
                  {row.badgeNumber && (
                    <span className="block font-mono text-xs text-ink-muted tabular-nums">
                      {row.badgeNumber}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <CountBar count={row.incidentsCreated} max={max} />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-ink-secondary">
                  {row.pct}%
                </TableCell>
                <TableCell className="whitespace-nowrap text-ink-secondary">
                  {shortDate(row.lastOccurredAt)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableCard>
  )
}

// ---------------------------------------------------------------------------
// Últimas ocorrências
// ---------------------------------------------------------------------------
export function RecentIncidentsTable({ rows }: { rows: RecentIncidentRow[] }) {
  return (
    <TableCard
      title="Últimas ocorrências"
      subtitle="Registros mais recentes no período"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Número</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Data</TableHead>
            <TableHead>Local</TableHead>
            <TableHead>Agente</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={5} label="Nenhuma ocorrência no período" />
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap font-mono text-sm font-medium text-ink">
                  {row.id.startsWith('demo-') ? (
                    row.internalNumber ?? row.id.slice(0, 8)
                  ) : (
                    <Link href={`/ocorrencias/${row.id}`} className="hover:underline">
                      {row.internalNumber ?? row.id.slice(0, 8)}
                    </Link>
                  )}
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      'inline-flex rounded-badge px-2 py-0.5 text-xs font-medium',
                      typeBadgeClass(row.type),
                    )}
                  >
                    {row.typeLabel}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-ink-secondary">
                  {format(parseISO(row.occurredAt), 'dd/MM/yyyy', { locale: ptBR })}
                  <span className="ml-1 text-xs text-ink-muted">
                    ({formatDistanceToNow(parseISO(row.occurredAt), { locale: ptBR, addSuffix: true })})
                  </span>
                </TableCell>
                <TableCell className="text-ink-secondary">{row.location ?? '—'}</TableCell>
                <TableCell className="text-ink-secondary">{row.agentName ?? '—'}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableCard>
  )
}
