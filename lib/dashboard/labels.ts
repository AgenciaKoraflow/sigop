import type { SyncStatus } from '@/types/app.types'

/** Portuguese display copy for the dashboard. Keys stay aligned with the schema. */

export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  theft: 'Furto',
  robbery: 'Roubo',
  vandalism: 'Vandalismo',
  in_flagrante: 'Flagrante',
  suspicious: 'Suspeita',
  stop: 'Abordagem',
  other: 'Outro',
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

export function typeLabel(type: string): string {
  return INCIDENT_TYPE_LABELS[type] ?? type
}
