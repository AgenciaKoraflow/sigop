import type { IncidentStatus, SyncStatus } from '@/types/app.types'

/** Portuguese display copy for the dashboard. Keys stay aligned with the schema. */

export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  theft: 'Furto',
  robbery: 'Roubo',
  vandalism: 'Vandalismo',
  in_flagrante: 'Flagrante',
  suspicious: 'Suspeita',
  other: 'Outro',
}

export const STOP_TYPE_LABELS: Record<string, string> = {
  stop: 'Abordagem',
  in_flagrante: 'Flagrante',
}

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  open: 'Aberta',
  in_progress: 'Em andamento',
  closed: 'Encerrada',
  archived: 'Arquivada',
}

export const SYNC_LABELS: Record<SyncStatus, string> = {
  draft: 'Rascunho',
  pending: 'Pendente',
  syncing: 'Sincronizando',
  synced: 'Sincronizado',
  error: 'Erro',
  conflict: 'Conflito',
}

/** Pill classes for the incident/stop type badge (Badge has no `type` variant). */
export function typeBadgeClass(type: string): string {
  switch (type) {
    case 'in_flagrante':
      return 'bg-status-in-flagrante-bg text-status-in-flagrante-text'
    case 'robbery':
    case 'theft':
      return 'bg-status-open-bg text-status-open-text'
    case 'vandalism':
      return 'bg-status-in-progress-bg text-status-in-progress-text'
    default:
      return 'bg-content-bg text-ink-secondary'
  }
}

export function typeLabel(kind: 'incident' | 'stop', type: string): string {
  const map = kind === 'incident' ? INCIDENT_TYPE_LABELS : STOP_TYPE_LABELS
  return map[type] ?? type
}
