'use client'

import * as React from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  ArrowLeft,
  Archive,
  CloudOff,
  ExternalLink,
  History,
  ImagePlus,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  UserPlus,
} from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { createClient } from '@/lib/supabase/client'
import { deleteDraftIncident, getDB, getDraftIncident, readSetting } from '@/lib/db'
import type { SyncStatus } from '@/types/app.types'
import { usePermissions } from '@/hooks/use-permissions'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { useCurrentUser, initials } from '@/hooks/use-current-user'
import { useToast } from '@/hooks/use-toast'
import { useSyncQueue } from '@/hooks/use-sync-queue'
import { createQueueItem, enqueueSync, processQueue } from '@/lib/sync/queue'
import {
  MAX_PHOTOS_PER_INCIDENT,
  offendersSettingKey,
  offenderRoleLabel,
} from '@/lib/ocorrencias/form'
import {
  INCIDENT_TYPE_LABELS,
  STATUS_LABELS,
  STOP_TYPE_LABELS,
  SYNC_LABELS,
  typeBadgeClass,
} from '@/lib/dashboard/labels'
import { STOP_OUTCOME_LABELS } from '@/lib/records/config'
import { PhotoGallery, type RemotePhoto } from '@/components/fotos/PhotoGallery'
import { PhotoUpload } from '@/components/fotos/PhotoUpload'
import { BuscaMeliante } from '@/components/meliantes/BuscaMeliante'
import { FormOcorrencia } from '@/components/ocorrencias/FormOcorrencia'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function untyped(): SupabaseClient {
  return createClient() as unknown as SupabaseClient
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** Compact fallback code fragment from a UUID (mirrors lib/records/data). */
function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 6).toUpperCase()
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
  } catch {
    return '—'
  }
}

const LocationMap = dynamic(
  () => import('@/components/ocorrencias/LocationMap').then((m) => m.LocationMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-52 w-full items-center justify-center rounded-input border border-content-border bg-content-bg text-sm text-ink-secondary">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando mapa…
      </div>
    ),
  },
)

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------
interface IncidentScalar {
  id: string
  internal_number: string | null
  type: string
  subtype: string | null
  status: string
  description: string | null
  occurred_at: string | null
  address_street: string | null
  address_number: string | null
  address_district: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  latitude: number | null
  longitude: number | null
  gmaps_link: string | null
  created_at: string | null
  updated_at: string | null
}

interface LinkedOffenderView {
  linkId: string
  offenderId: string
  role: string | null
  name: string
  nickname: string | null
  photoUrl: string | null
}

interface LinkedStopView {
  id: string
  type: string | null
  outcome: string | null
  stoppedAt: string | null
  description: string | null
  agentName: string | null
}

interface AuditChange {
  field: string
  from: unknown
  to: unknown
}

interface AuditEntry {
  id: string
  operation: string
  performedAt: string | null
  performerName: string | null
  changes: AuditChange[]
}

interface IncidentDetail {
  incident: IncidentScalar
  source: 'remote' | 'local'
  syncStatus: SyncStatus | null
  offenders: LinkedOffenderView[]
  stops: LinkedStopView[]
  photos: RemotePhoto[]
  audit: AuditEntry[]
}

const FIELD_LABELS: Record<string, string> = {
  type: 'Tipo',
  subtype: 'Subtipo',
  status: 'Status',
  description: 'Descrição',
  occurred_at: 'Data da ocorrência',
  address_street: 'Logradouro',
  address_number: 'Número',
  address_district: 'Bairro',
  address_city: 'Cidade',
  address_state: 'UF',
  address_zip: 'CEP',
  latitude: 'Latitude',
  longitude: 'Longitude',
  gmaps_link: 'Link do Google Maps',
}

const IGNORED_DIFF_KEYS = new Set([
  'id',
  'created_at',
  'updated_at',
  'synced_at',
  'deleted_at',
  'version',
  'created_by',
  'updated_by',
  'unit_id',
])

function summarizeChanges(prev: unknown, next: unknown): AuditChange[] {
  const p = prev && typeof prev === 'object' ? (prev as Record<string, unknown>) : {}
  const n = next && typeof next === 'object' ? (next as Record<string, unknown>) : {}
  const keys = Object.keys(p).concat(Object.keys(n).filter((key) => !(key in p)))
  const changes: AuditChange[] = []
  for (const key of keys) {
    if (IGNORED_DIFF_KEYS.has(key)) continue
    if (JSON.stringify(p[key] ?? null) === JSON.stringify(n[key] ?? null)) continue
    changes.push({ field: key, from: p[key] ?? null, to: n[key] ?? null })
  }
  return changes
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') {
    const label =
      INCIDENT_TYPE_LABELS[value] ??
      STATUS_LABELS[value as keyof typeof STATUS_LABELS] ??
      null
    if (label) return label
    return value.length > 80 ? `${value.slice(0, 80)}…` : value
  }
  return String(value)
}

function toIncidentScalar(id: string, row: Record<string, unknown>): IncidentScalar {
  const str = (key: string) =>
    row[key] === null || row[key] === undefined ? null : String(row[key])
  const num = (key: string) =>
    row[key] === null || row[key] === undefined ? null : Number(row[key])
  return {
    id,
    internal_number: str('internal_number'),
    type: str('type') ?? 'other',
    subtype: str('subtype'),
    status: str('status') ?? 'open',
    description: str('description'),
    occurred_at: str('occurred_at'),
    address_street: str('address_street'),
    address_number: str('address_number'),
    address_district: str('address_district'),
    address_city: str('address_city'),
    address_state: str('address_state'),
    address_zip: str('address_zip'),
    latitude: num('latitude'),
    longitude: num('longitude'),
    gmaps_link: str('gmaps_link'),
    created_at: str('created_at'),
    updated_at: str('updated_at'),
  }
}

interface RawOffenderLink {
  id: string
  role: string | null
  offender_id: string
  offenders: {
    id: string
    full_name: string | null
    social_name: string | null
    nickname: string | null
    main_photo_url: string | null
  } | null
}

interface RawStopRow {
  id: string
  type: string | null
  outcome: string | null
  stopped_at: string | null
  description: string | null
  created_by: string | null
}

interface RawAuditRow {
  id: string
  operation: string
  performed_at: string | null
  performed_by: string | null
  previous_data: unknown
  new_data: unknown
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
async function loadIncidentDetail(
  id: string,
  isOnline: boolean,
  canViewAudit: boolean,
): Promise<IncidentDetail | null> {
  let draft: Awaited<ReturnType<typeof getDraftIncident>> | undefined
  try {
    draft = await getDraftIncident(id)
  } catch {
    draft = undefined
  }

  let serverRow: Record<string, unknown> | null = null
  let offenders: LinkedOffenderView[] = []
  let stops: LinkedStopView[] = []
  let photos: RemotePhoto[] = []
  let audit: AuditEntry[] = []

  if (isOnline) {
    const supabase = untyped()
    const { data } = await supabase
      .from('incidents')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    serverRow = (data as Record<string, unknown>) ?? null

    if (serverRow) {
      const [linkRes, stopRes, photoRes, auditRes] = await Promise.all([
        supabase
          .from('incident_offenders')
          .select(
            'id, role, offender_id, offenders ( id, full_name, social_name, nickname, main_photo_url )',
          )
          .eq('incident_id', id),
        supabase
          .from('stops')
          .select('id, type, outcome, stopped_at, description, created_by')
          .eq('incident_id', id)
          .is('deleted_at', null)
          .order('stopped_at', { ascending: false }),
        supabase
          .from('photos')
          .select('id, public_url, description, sort_order')
          .eq('entity_type', 'incident')
          .eq('entity_id', id)
          .order('sort_order', { ascending: true }),
        canViewAudit
          ? supabase
              .from('audit_log')
              .select('id, operation, performed_at, performed_by, previous_data, new_data')
              .eq('entity_type', 'incident')
              .eq('entity_id', id)
              .order('performed_at', { ascending: false })
              .limit(50)
          : Promise.resolve({ data: [] as RawAuditRow[] }),
      ])

      offenders = ((linkRes.data ?? []) as unknown as RawOffenderLink[]).map((link) => ({
        linkId: link.id,
        offenderId: link.offenders?.id ?? link.offender_id,
        role: link.role,
        name:
          link.offenders?.full_name?.trim() ||
          link.offenders?.social_name?.trim() ||
          link.offenders?.nickname?.trim() ||
          'Sem nome',
        nickname: link.offenders?.nickname ?? null,
        photoUrl: link.offenders?.main_photo_url ?? null,
      }))

      const stopRows = (stopRes.data ?? []) as unknown as RawStopRow[]
      const auditRows = (auditRes.data ?? []) as unknown as RawAuditRow[]

      const profileIds = stopRows
        .map((row) => row.created_by)
        .concat(auditRows.map((row) => row.performed_by))
        .filter((value, index, all): value is string =>
          Boolean(value) && all.indexOf(value) === index,
        )
      const profileNames = new Map<string, string>()
      if (profileIds.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', profileIds)
        for (const profile of (profileRows ?? []) as { id: string; full_name: string }[]) {
          profileNames.set(profile.id, profile.full_name)
        }
      }

      stops = stopRows.map((row) => ({
        id: row.id,
        type: row.type,
        outcome: row.outcome,
        stoppedAt: row.stopped_at,
        description: row.description,
        agentName: row.created_by ? profileNames.get(row.created_by) ?? null : null,
      }))

      photos = ((photoRes.data ?? []) as unknown as {
        id: string
        public_url: string | null
        description: string | null
        sort_order: number | null
      }[])
        .filter((photo) => Boolean(photo.public_url))
        .map((photo) => ({
          id: photo.id,
          url: photo.public_url as string,
          description: photo.description,
          sortOrder: photo.sort_order,
        }))

      audit = auditRows.map((row) => ({
        id: row.id,
        operation: row.operation,
        performedAt: row.performed_at,
        performerName: row.performed_by ? profileNames.get(row.performed_by) ?? null : null,
        changes:
          row.operation === 'update'
            ? summarizeChanges(row.previous_data, row.new_data)
            : [],
      }))
    }
  }

  // A draft whose sync-queue entry is already gone AND that the server now
  // knows about is stale — drop it so the screen shows the authoritative copy.
  let effectiveDraft = draft
  if (draft && isOnline && serverRow) {
    let queued: Awaited<ReturnType<Awaited<ReturnType<typeof getDB>>['get']>> | undefined
    try {
      const db = await getDB()
      queued = await db.get('sync_queue', id)
    } catch {
      queued = undefined
    }
    const stillPending = Boolean(queued) && queued?.status !== 'synced'
    if (!stillPending) {
      try {
        await deleteDraftIncident(id)
      } catch {
        /* ignore */
      }
      effectiveDraft = undefined
    }
  }

  if (!effectiveDraft && !serverRow) return null

  const merged: Record<string, unknown> = {
    ...(serverRow ?? {}),
    ...(effectiveDraft ? effectiveDraft.payload : {}),
  }
  const incident = toIncidentScalar(id, merged)

  // Local draft: recover the offender links stored alongside the draft.
  if (effectiveDraft && offenders.length === 0) {
    try {
      const saved = (await readSetting(offendersSettingKey(id))) as
        | {
            linkId: string
            offenderId: string
            role: string | null
            fullName: string | null
            nickname: string | null
            photoUrl: string | null
          }[]
        | undefined
      if (Array.isArray(saved)) {
        offenders = saved.map((entry) => ({
          linkId: entry.linkId,
          offenderId: entry.offenderId,
          role: entry.role,
          name: entry.fullName?.trim() || entry.nickname?.trim() || 'Sem nome',
          nickname: entry.nickname,
          photoUrl: entry.photoUrl,
        }))
      }
    } catch {
      /* IndexedDB unavailable — ignore. */
    }
  }

  return {
    incident,
    source: effectiveDraft ? 'local' : 'remote',
    syncStatus: effectiveDraft ? effectiveDraft.status : null,
    offenders,
    stops,
    photos,
    audit,
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export interface DetalheOcorrenciaProps {
  incidentId: string
}

export function DetalheOcorrencia({ incidentId: id }: DetalheOcorrenciaProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { user } = useCurrentUser()
  const { saveIncident } = useSyncQueue()
  const perms = usePermissions()
  const { isOnline } = useOnlineStatus()

  const [editing, setEditing] = React.useState(false)
  const [showUpload, setShowUpload] = React.useState(false)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [confirmAction, setConfirmAction] = React.useState<'close' | 'archive' | null>(null)
  const [working, setWorking] = React.useState(false)

  const queryKey = React.useMemo(
    () => ['incident-detail', id, isOnline, perms.canViewAuditLog] as const,
    [id, isOnline, perms.canViewAuditLog],
  )

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => loadIncidentDetail(id, isOnline, perms.canViewAuditLog),
  })

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['incident-detail', id] })
  }, [queryClient, id])

  // -----------------------------------------------------------------------
  // Status transitions (Encerrar / Arquivar) — offline-first via sync queue
  // -----------------------------------------------------------------------
  const applyStatus = React.useCallback(
    async (next: 'closed' | 'archived') => {
      if (!data) return
      setWorking(true)
      try {
        const inc = data.incident
        const payload: Record<string, unknown> = {
          id: inc.id,
          type: inc.type,
          subtype: inc.subtype,
          description: inc.description,
          status: next,
          occurred_at: inc.occurred_at,
          address_street: inc.address_street,
          address_number: inc.address_number,
          address_district: inc.address_district,
          address_city: inc.address_city,
          address_state: inc.address_state,
          address_zip: inc.address_zip,
          latitude: inc.latitude,
          longitude: inc.longitude,
          gmaps_link: inc.gmaps_link,
        }
        if (user?.id) payload.updated_by = user.id

        await saveIncident(payload, 'update')

        toast({
          title: next === 'closed' ? 'Ocorrência encerrada' : 'Ocorrência arquivada',
          description: isOnline
            ? 'Enviando para o servidor…'
            : 'Sem conexão — será sincronizada automaticamente.',
        })
        setConfirmAction(null)
        refresh()
      } catch (error) {
        toast({
          title: 'Não foi possível concluir a ação',
          description: error instanceof Error ? error.message : 'Tente novamente.',
          variant: 'destructive',
        })
      } finally {
        setWorking(false)
      }
    },
    [data, isOnline, refresh, saveIncident, toast, user?.id],
  )

  const linkOffender = React.useCallback(
    async (offenderId: string) => {
      if (!user) {
        toast({ title: 'Aguarde o carregamento do perfil', variant: 'destructive' })
        return
      }
      try {
        await enqueueSync(
          createQueueItem(
            'link',
            'create',
            {
              table: 'incident_offenders',
              id: newId(),
              incident_id: id,
              offender_id: offenderId,
              role: 'suspect',
              created_by: user.id,
            },
            3,
          ),
        )
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          void processQueue().catch(() => {})
        }
        toast({
          title: 'Meliante vinculado',
          description: isOnline
            ? 'Enviando para o servidor…'
            : 'Sem conexão — será sincronizado automaticamente.',
        })
        setLinkOpen(false)
        refresh()
      } catch (error) {
        toast({
          title: 'Não foi possível vincular',
          description: error instanceof Error ? error.message : 'Tente novamente.',
          variant: 'destructive',
        })
      }
    },
    [id, isOnline, refresh, toast, user],
  )

  // -----------------------------------------------------------------------
  // Render states
  // -----------------------------------------------------------------------
  if (editing) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <button
          type="button"
          onClick={() => {
            setEditing(false)
            refresh()
          }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para os detalhes
        </button>
        <FormOcorrencia mode="edit" incidentId={id} />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center py-20 text-ink-secondary">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando ocorrência…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-3xl rounded-card border border-content-border bg-white p-8 text-center">
        <p className="text-lg font-semibold text-ink">
          {!isOnline ? 'Ocorrência indisponível offline' : 'Ocorrência não encontrada'}
        </p>
        <p className="mt-1 text-sm text-ink-secondary">
          {!isOnline
            ? 'Não há cópia local desta ocorrência neste dispositivo. Conecte-se para carregá-la.'
            : 'O registro pode ter sido removido ou o link está incorreto.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" onClick={() => router.push('/ocorrencias')}>
            Voltar para a lista
          </Button>
          {isOnline && (
            <Button variant="primary" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          )}
        </div>
      </div>
    )
  }

  const { incident, source, syncStatus, offenders, stops, photos, audit } = data
  const internalNumber = incident.internal_number ?? `OC-${shortId(incident.id)}`
  const isLocal = source === 'local'
  const hasCoords = incident.latitude != null && incident.longitude != null

  const addressLine = [
    incident.address_street,
    incident.address_number,
    incident.address_district,
    incident.address_city,
    incident.address_state,
  ]
    .filter((part) => part && String(part).trim())
    .join(', ')

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-16">
      <Link
        href="/ocorrencias"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Ocorrências
      </Link>

      {/* Header ----------------------------------------------------------- */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="font-mono text-2xl font-bold tracking-tight text-ink">
              {internalNumber}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  typeBadgeClass(incident.type),
                )}
              >
                {INCIDENT_TYPE_LABELS[incident.type] ?? incident.type}
                {incident.subtype ? ` · ${incident.subtype}` : ''}
              </span>
              <Badge
                variant={
                  (['open', 'in_progress', 'closed', 'archived'] as const).includes(
                    incident.status as 'open',
                  )
                    ? (incident.status as 'open')
                    : 'secondary'
                }
              >
                {STATUS_LABELS[incident.status as keyof typeof STATUS_LABELS] ??
                  incident.status}
              </Badge>
              {isLocal ? (
                <Badge variant={syncStatus ?? 'draft'} className="gap-1">
                  <CloudOff className="h-3 w-3" />
                  {syncStatus && syncStatus !== 'draft'
                    ? SYNC_LABELS[syncStatus]
                    : 'Rascunho local'}
                </Badge>
              ) : (
                <Badge variant="synced">{SYNC_LABELS.synced}</Badge>
              )}
            </div>
            {isLocal && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-sync-pending-text">
                <CloudOff className="h-3.5 w-3.5" />
                Visualizando versão local {isOnline ? '(ainda não sincronizada)' : '(offline)'}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {perms.canEditIncident && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" />
                Editar
              </Button>
            )}
            {perms.canCloseIncident && incident.status !== 'closed' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmAction('close')}
              >
                <Lock className="h-4 w-4" />
                Encerrar
              </Button>
            )}
            {perms.canArchive && incident.status !== 'archived' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmAction('archive')}
              >
                <Archive className="h-4 w-4" />
                Arquivar
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* SEÇÃO 1 — Informações gerais ----------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Informações gerais</h2>
        <dl className="grid gap-x-6 gap-y-3 rounded-card border border-content-border bg-white p-4 sm:grid-cols-2">
          <Detail label="Data e hora" value={fmtDateTime(incident.occurred_at)} />
          <Detail
            label="Tipo / subtipo"
            value={
              (INCIDENT_TYPE_LABELS[incident.type] ?? incident.type) +
              (incident.subtype ? ` · ${incident.subtype}` : '')
            }
          />
          <Detail
            label="Status"
            value={
              STATUS_LABELS[incident.status as keyof typeof STATUS_LABELS] ??
              incident.status
            }
          />
          <Detail label="Registrada em" value={fmtDateTime(incident.created_at)} />
          <Detail
            label="Descrição"
            value={incident.description}
            className="sm:col-span-2"
            multiline
          />
        </dl>
      </section>

      {/* SEÇÃO 2 — Localização ---------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Localização</h2>
        <div className="space-y-3 rounded-card border border-content-border bg-white p-4">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
            <p className="text-sm text-ink">{addressLine || 'Endereço não informado'}</p>
          </div>

          {hasCoords && (
            <>
              <p className="font-mono text-xs text-ink-secondary">
                Lat {incident.latitude?.toFixed(6)} · Long {incident.longitude?.toFixed(6)}
              </p>
              <LocationMap lat={incident.latitude as number} lng={incident.longitude as number} />
            </>
          )}

          {incident.gmaps_link && (
            <a
              href={incident.gmaps_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand transition-colors hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              Abrir no Google Maps
            </a>
          )}

          {!hasCoords && !incident.gmaps_link && !addressLine && (
            <p className="text-sm text-ink-muted">Nenhuma informação de localização.</p>
          )}
        </div>
      </section>

      {/* SEÇÃO 3 — Galeria de fotos ---------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Galeria de fotos</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowUpload((current) => !current)}
          >
            <ImagePlus className="h-4 w-4" />
            {showUpload ? 'Concluir' : 'Adicionar foto'}
          </Button>
        </div>

        {showUpload && (
          <div className="rounded-card border border-content-border bg-white p-4">
            <PhotoUpload
              entityId={id}
              entityType="incident"
              maxPhotos={MAX_PHOTOS_PER_INCIDENT}
            />
          </div>
        )}

        <PhotoGallery entityId={id} entityType="incident" remotePhotos={photos} />
      </section>

      <Separator />

      {/* SEÇÃO 4 — Pessoas envolvidas ------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">
            Pessoas envolvidas{' '}
            <span className="text-sm font-normal text-ink-muted">({offenders.length})</span>
          </h2>
          <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Vincular meliante
          </Button>
        </div>

        {offenders.length === 0 ? (
          <EmptyRow>Nenhum meliante vinculado a esta ocorrência.</EmptyRow>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {offenders.map((offender) => (
              <li key={offender.linkId}>
                <Link
                  href={`/meliantes/${offender.offenderId}`}
                  className="flex items-center gap-3 rounded-card border border-content-border bg-white p-3 transition-colors hover:border-brand/40"
                >
                  <Avatar className="h-11 w-11 shrink-0">
                    {offender.photoUrl && (
                      <AvatarImage src={offender.photoUrl} alt={offender.name} />
                    )}
                    <AvatarFallback>{initials(offender.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{offender.name}</p>
                    {offender.nickname && (
                      <p className="truncate text-xs text-ink-secondary">
                        &ldquo;{offender.nickname}&rdquo;
                      </p>
                    )}
                    <p className="mt-0.5 text-xs font-medium text-ink-muted">
                      {offenderRoleLabel(offender.role)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator />

      {/* SEÇÃO 5 — Abordagens vinculadas ---------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">
          Abordagens vinculadas{' '}
          <span className="text-sm font-normal text-ink-muted">({stops.length})</span>
        </h2>
        {stops.length === 0 ? (
          <EmptyRow>Nenhuma abordagem vinculada.</EmptyRow>
        ) : (
          <ul className="space-y-2">
            {stops.map((stop) => (
              <li key={stop.id}>
                <Link
                  href={`/abordagens/${stop.id}`}
                  className="block rounded-card border border-content-border bg-white p-3 transition-colors hover:border-brand/40"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={stop.type === 'in_flagrante' ? 'in_flagrante' : 'secondary'}
                    >
                      {STOP_TYPE_LABELS[stop.type ?? ''] ?? stop.type ?? '—'}
                    </Badge>
                    <span className="text-xs text-ink-secondary">
                      {fmtDateTime(stop.stoppedAt)}
                    </span>
                    <span className="ml-auto text-xs font-medium text-ink-secondary">
                      {STOP_OUTCOME_LABELS[stop.outcome ?? ''] ?? stop.outcome ?? '—'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    Agente: {stop.agentName ?? '—'}
                  </p>
                  {stop.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-ink-secondary">
                      {stop.description}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* SEÇÃO 6 — Histórico (supervisor / admin) ------------------- */}
      {perms.canViewAuditLog && (
        <>
          <Separator />
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
              <History className="h-4 w-4 text-ink-muted" />
              Histórico de alterações
            </h2>
            {!isOnline ? (
              <EmptyRow>Conecte-se para carregar o histórico de auditoria.</EmptyRow>
            ) : audit.length === 0 ? (
              <EmptyRow>Nenhuma alteração registrada.</EmptyRow>
            ) : (
              <ol className="space-y-3 border-l border-content-border pl-4">
                {audit.map((entry) => (
                  <li key={entry.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand" />
                    <div className="rounded-card border border-content-border bg-white p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="secondary">{operationLabel(entry.operation)}</Badge>
                        <span className="font-medium text-ink">
                          {entry.performerName ?? 'Usuário desconhecido'}
                        </span>
                        <span className="text-ink-muted">{fmtDateTime(entry.performedAt)}</span>
                      </div>
                      {entry.changes.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs text-ink-secondary">
                          {entry.changes.map((change) => (
                            <li key={change.field}>
                              <span className="font-medium text-ink">
                                {FIELD_LABELS[change.field] ?? change.field}:
                              </span>{' '}
                              <span className="line-through">{displayValue(change.from)}</span>{' '}
                              → <span className="text-ink">{displayValue(change.to)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}

      {/* Dialogs -------------------------------------------------------- */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular meliante</DialogTitle>
            <DialogDescription>
              Busque um meliante já cadastrado para vinculá-lo a esta ocorrência.
            </DialogDescription>
          </DialogHeader>
          <BuscaMeliante
            autoFocus
            excludeIds={offenders.map((offender) => offender.offenderId)}
            onSelect={(selected) => void linkOffender(selected.id)}
            onCreateNew={() => router.push('/meliantes/nova')}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === 'close' ? 'Encerrar ocorrência?' : 'Arquivar ocorrência?'}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === 'close'
                ? 'A ocorrência será marcada como encerrada. Você ainda poderá consultá-la.'
                : 'A ocorrência será arquivada e sairá das listagens operacionais padrão.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)} disabled={working}>
              Cancelar
            </Button>
            <Button
              variant={confirmAction === 'archive' ? 'destructive' : 'primary'}
              disabled={working}
              onClick={() =>
                void applyStatus(confirmAction === 'close' ? 'closed' : 'archived')
              }
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {confirmAction === 'close' ? 'Encerrar' : 'Arquivar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------
function operationLabel(operation: string): string {
  switch (operation) {
    case 'create':
      return 'Criação'
    case 'update':
      return 'Alteração'
    case 'delete':
      return 'Exclusão'
    case 'sync':
      return 'Sincronização'
    case 'conflict_resolved':
      return 'Conflito resolvido'
    default:
      return operation
  }
}

function Detail({
  label,
  value,
  className,
  multiline,
}: {
  label: string
  value: string | null | undefined
  className?: string
  multiline?: boolean
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-sm text-ink',
          !value && 'text-ink-muted',
          multiline && 'whitespace-pre-wrap',
        )}
      >
        {value || '—'}
      </dd>
    </div>
  )
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-card border border-dashed border-content-border bg-content-bg px-3 py-6 text-center text-sm text-ink-secondary">
      {children}
    </p>
  )
}
