'use client'

import Link from 'next/link'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn } from '@/lib/utils/cn'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { STATUS_LABELS } from '@/lib/dashboard/labels'
import type {
  AgentProductivityRow,
  StaleIncidentRow,
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

// ---------------------------------------------------------------------------
// Top meliantes
// ---------------------------------------------------------------------------
export function TopOffendersTable({ rows }: { rows: TopOffenderRow[] }) {
  return (
    <TableCard title="Top meliantes" subtitle="Mais abordados no período">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Apelido</TableHead>
            <TableHead className="text-right">Abordagens</TableHead>
            <TableHead>Última abordagem</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={4} label="Nenhuma abordagem no período" />
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-ink">
                  {row.id.startsWith('demo-') ? (
                    row.fullName ?? '—'
                  ) : (
                    <Link href={`/meliantes/${row.id}`} className="hover:underline">
                      {row.fullName ?? '—'}
                    </Link>
                  )}
                </TableCell>
                <TableCell className="text-ink-secondary">{row.nickname ?? '—'}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {row.stopCount}
                </TableCell>
                <TableCell className="text-ink-secondary">
                  {row.lastStoppedAt
                    ? format(parseISO(row.lastStoppedAt), "dd/MM/yyyy 'às' HH:mm", {
                        locale: ptBR,
                      })
                    : '—'}
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
// Produtividade por agente
// ---------------------------------------------------------------------------
export function AgentProductivityTable({ rows }: { rows: AgentProductivityRow[] }) {
  return (
    <TableCard title="Produtividade por agente" subtitle="Registros criados no período">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Matrícula</TableHead>
            <TableHead className="text-right">Ocorrências</TableHead>
            <TableHead className="text-right">Abordagens</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={4} label="Nenhum registro no período" />
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-ink">{row.fullName ?? '—'}</TableCell>
                <TableCell className="font-mono text-ink-secondary tabular-nums">
                  {row.badgeNumber ?? '—'}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {row.incidentsCreated}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {row.stopsCreated}
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
// Ocorrências sem encerramento > 7 dias
// ---------------------------------------------------------------------------
export function StaleIncidentsTable({ rows }: { rows: StaleIncidentRow[] }) {
  return (
    <TableCard
      title="Ocorrências sem encerramento > 7 dias"
      subtitle={`${rows.length} ${rows.length === 1 ? 'ocorrência' : 'ocorrências'} em aberto há mais de uma semana`}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Número</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Data</TableHead>
            <TableHead>Agente</TableHead>
            <TableHead className="text-right">Dias em aberto</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={5} label="Nenhuma ocorrência atrasada 🎉" />
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} className="bg-amber-50 hover:bg-amber-100/70">
                <TableCell className="font-mono text-sm font-medium text-ink">
                  {row.id.startsWith('demo-') ? (
                    row.internalNumber ?? row.id.slice(0, 8)
                  ) : (
                    <Link href={`/ocorrencias/${row.id}`} className="hover:underline">
                      {row.internalNumber ?? row.id.slice(0, 8)}
                    </Link>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-ink-secondary">{row.typeLabel}</span>
                </TableCell>
                <TableCell className="text-ink-secondary">
                  {format(parseISO(row.occurredAt), 'dd/MM/yyyy', { locale: ptBR })}
                  <span className="ml-1 text-xs text-ink-muted">
                    ({formatDistanceToNow(parseISO(row.occurredAt), { locale: ptBR })})
                  </span>
                </TableCell>
                <TableCell className="text-ink-secondary">{row.agentName ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <Badge
                    variant={row.status === 'in_progress' ? 'in_progress' : 'open'}
                    className={cn(
                      'font-mono tabular-nums',
                      row.daysOpen >= 15 && 'bg-status-in-flagrante-bg text-status-in-flagrante-text',
                    )}
                    title={STATUS_LABELS[row.status]}
                  >
                    {row.daysOpen}d
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableCard>
  )
}
