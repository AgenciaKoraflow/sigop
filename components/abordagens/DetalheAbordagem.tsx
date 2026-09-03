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
  CloudOff,
  ExternalLink,
  FileText,
  History,
  ImagePlus,
  Loader2,
  MapPin,
  Pencil,
  ShieldAlert,
  UserPlus,
} from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { createClient } from '@/lib/supabase/client'
import { deleteDraftStop, getDB, getDraftStop, readSetting } from '@/lib/db'
import type { SyncStatus } from '@/types/app.types'
import { usePermissions } from '@/hooks/use-permissions'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { useCurrentUser, initials } from '@/hooks/use-current-user'
import { useToast } from '@/hooks/use-toast'
import { createQueueItem, enqueueSync, processQueue } from '@/lib/sync/queue'
import {
  MAX_PHOTOS_PER_STOP,
  stopExtrasSettingKey,
  stopOutcomeLabel,
  type StopFormExtras,
} from '@/lib/abordagens/form'
import { characteristicLabel, offenderDisplayName } from '@/lib/meliantes/form'
import {
  INCIDENT_TYPE_LABELS,
  STATUS_LABELS,
  STOP_TYPE_LABELS,
  SYNC_LABELS,
} from '@/lib/dashboard/labels'
import { PhotoGallery, type RemotePhoto } from '@/components/fotos/PhotoGallery'
import { signPhotoUrls } from '@/lib/fotos/urls'
import { PhotoUpload } from '@/components/fotos/PhotoUpload'
import { BuscaMeliante } from '@/components/meliantes/BuscaMeliante'
import { FormAbordagem } from '@/components/abordagens/FormAbordagem'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
interface StopScalar {
  id: string
  type: string
  outcome: string | null
  stopped_at: string | null
  description: string | null
  notes: string | null
  address_street: string | null
  address_district: string | null
  address_city: string | null
  latitude: number | null
  longitude: number | null
  incident_id: string | null
  created_at: string | null
}

interface OffenderView {
  linkId: string
  offenderId: string
  name: string
  nickname: string | null
  photoUrl: string | null
  /** Full record — populated for the flagrante highlight block. */
  full: {
    full_name: string | null
    social_name: string | null
    nickname: string | null
    cpf: string | null
    rg: string | null
    birth_date: string | null
    gender: string | null
    height_m: number | null
    weight_kg: number | null
    skin_color: string | null
    eye_color: string | null
    hair_color: string | null
    distinguishing_marks: string | null
    physical_description: string | null
  } | null
}

interface LinkedIncidentView {
  id: string
  internalNumber: string | null
  type: string | null
  status: string | null
  occurredAt: string | null
  description: string | null
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

interface StopDetail {
  stop: StopScalar
  source: 'remote' | 'local'
  syncStatus: SyncStatus | null
  agentName: string | null
  offenders: OffenderView[]
  incident: LinkedIncidentView | null
  photos: RemotePhoto[]
  audit: AuditEntry[]
}

const FIELD_LABELS: Record<string, string> = {
  type: 'Tipo',
  outcome: 'Resultado',
  description: 'Descrição',
  notes: 'Observações',
  stopped_at: 'Data da abordagem',
  address_street: 'Logradouro',
  address_district: 'Bairro',
  address_city: 'Cidade',
  latitude: 'Latitude',
  longitude: 'Longitude',
  incident_id: 'Ocorrência vinculada',
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
    const label = STOP_TYPE_LABELS[value] ?? stopOutcomeLabel(value)
    if (label && label !== '—') return label
    return value.length > 80 ? `${value.slice(0, 80)}…` : value
  }
  return String(value)
}

function toStopScalar(id: string, row: Record<string, unknown>): StopScalar {
  const str = (key: string) =>
    row[key] === null || row[key] === undefined ? null : String(row[key])
  const num = (key: string) =>
    row[key] === null || row[key] === undefined ? null : Number(row[key])
  return {
    id,
    type: str('type') ?? 'stop',
    outcome: str('outcome'),
    stopped_at: str('stopped_at'),
    description: str('description'),
    notes: str('notes'),
    address_street: str('address_street'),
    address_district: str('address_district'),
    address_city: str('address_city'),
    latitude: num('latitude'),
    longitude: num('longitude'),
    incident_id: str('incident_id'),
    created_at: str('created_at'),
  }
}

interface RawStopOffenderLink {
  id: string
  offender_id: string
  offenders: Record<string, unknown> | null
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
async function loadStopDetail(
  id: string,
  isOnline: boolean,
  canViewAudit: boolean,
): Promise<StopDetail | null> {
  let draft: Awaited<ReturnType<typeof getDraftStop>> | undefined
  try {
    draft = await getDraftStop(id)
  } catch {
    draft = undefined
  }

  let serverRow: Record<string, unknown> | null = null
  let agentName: string | null = null
  let offenders: OffenderView[] = []
  let incident: LinkedIncidentView | null = null
  let photos: RemotePhoto[] = []
  let audit: AuditEntry[] = []

  if (isOnline) {
    const supabase = untyped()
    const { data } = await supabase
      .from('stops')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    serverRow = (data as Record<string, unknown>) ?? null

    if (serverRow) {
      const [linkRes, photoRes, auditRes] = await Promise.all([
        supabase
          .from('stop_offenders')
          .select('id, offender_id, offenders ( * )')
          .eq('stop_id', id),
        supabase
          .from('photos')
          .select('id, storage_path, description, sort_order')
          .eq('entity_type', 'stop')
          .eq('entity_id', id)
          .order('sort_order', { ascending: true }),
        canViewAudit
          ? supabase
              .from('audit_log')
              .select('id, operation, performed_at, performed_by, previous_data, new_data')
              .eq('entity_type', 'stop')
              .eq('entity_id', id)
              .order('performed_at', { ascending: false })
              .limit(50)
          : Promise.resolve({ data: [] as RawAuditRow[] }),
      ])

      offenders = ((linkRes.data ?? []) as unknown as RawStopOffenderLink[]).map((link) => {
        const raw = link.offenders ?? {}
        const num = (key: string) =>
          raw[key] === null || raw[key] === undefined ? null : Number(raw[key])
        const str = (key: string) =>
          raw[key] === null || raw[key] === undefined ? null : String(raw[key])
        return {
          linkId: link.id,
          offenderId: (str('id') as string) ?? link.offender_id,
          name: offenderDisplayName({
            full_name: str('full_name'),
            social_name: str('social_name'),
            nickname: str('nickname'),
          }),
          nickname: str('nickname'),
          photoUrl: str('main_photo_url'),
          full: {
            full_name: str('full_name'),
            social_name: str('social_name'),
            nickname: str('nickname'),
            cpf: str('cpf'),
            rg: str('rg'),
            birth_date: str('birth_date'),
            gender: str('gender'),
            height_m: num('height_m'),
            weight_kg: num('weight_kg'),
            skin_color: str('skin_color'),
            eye_color: str('eye_color'),
            hair_color: str('hair_color'),
            distinguishing_marks: str('distinguishing_marks'),
            physical_description: str('physical_description'),
          },
        }
      })

      const photoRows = (photoRes.data ?? []) as unknown as {
        id: string
        storage_path: string | null
        description: string | null
        sort_order: number | null
      }[]
      const signedUrls = await signPhotoUrls(
        supabase,
        photoRows.map((photo) => photo.storage_path),
      )
      photos = photoRows
        .filter((photo) => photo.storage_path && signedUrls.has(photo.storage_path))
        .map((photo) => ({
          id: photo.id,
          url: signedUrls.get(photo.storage_path as string) as string,
          description: photo.description,
          sortOrder: photo.sort_order,
        }))

      const auditRows = (auditRes.data ?? []) as unknown as RawAuditRow[]
      const profileIds = [serverRow.created_by as string | null]
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
      agentName = serverRow.created_by
        ? profileNames.get(serverRow.created_by as string) ?? null
        : null
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
        await deleteDraftStop(id)
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
  const stop = toStopScalar(id, merged)

  // Local draft: recover the linked offender / incident number from the extras.
  if (effectiveDraft) {
    try {
      const extras = (await readSetting(stopExtrasSettingKey(id))) as
        | StopFormExtras
        | undefined
      if (extras && offenders.length === 0 && extras.subjectExistingId) {
        offenders = [
          {
            linkId: extras.linkId,
            offenderId: extras.subjectExistingId,
            name: extras.subjectExistingLabel || 'Meliante vinculado',
            nickname: null,
            photoUrl: null,
            full: null,
          },
        ]
      }
    } catch {
      /* IndexedDB unavailable — ignore. */
    }
  }

  // Linked incident card.
  if (isOnline && stop.incident_id) {
    try {
      const supabase = untyped()
      const { data: inc } = await supabase
        .from('incidents')
        .select('id, internal_number, type, status, occurred_at, description')
        .eq('id', stop.incident_id)
        .maybeSingle()
      if (inc) {
        const row = inc as Record<string, unknown>
        incident = {
          id: row.id as string,
          internalNumber: (row.internal_number as string | null) ?? null,
          type: (row.type as string | null) ?? null,
          status: (row.status as string | null) ?? null,
          occurredAt: (row.occurred_at as string | null) ?? null,
          description: (row.description as string | null) ?? null,
        }
      }
    } catch {
      /* best effort */
    }
  }

  return {
    stop,
    source: effectiveDraft ? 'local' : 'remote',
    syncStatus: effectiveDraft ? effectiveDraft.status : null,
    agentName,
    offenders,
    incident,
    photos,
    audit,
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export interface DetalheAbordagemProps {
  stopId: string
}

export function DetalheAbordagem({ stopId: id }: DetalheAbordagemProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { user } = useCurrentUser()
  const perms = usePermissions()
  const { isOnline } = useOnlineStatus()

  const [editing, setEditing] = React.useState(false)
  const [showUpload, setShowUpload] = React.useState(false)
  const [linkOpen, setLinkOpen] = React.useState(false)

  const canEdit = perms.isAgent || perms.isSupervisor || perms.isAdmin

  const queryKey = React.useMemo(
    () => ['stop-detail', id, isOnline, perms.canViewAuditLog] as const,
    [id, isOnline, perms.canViewAuditLog],
  )

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => loadStopDetail(id, isOnline, perms.canViewAuditLog),
  })

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['stop-detail', id] })
  }, [queryClient, id])

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
              table: 'stop_offenders',
              id: newId(),
              stop_id: id,
              offender_id: offenderId,
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
        <FormAbordagem mode="edit" stopId={id} />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center py-20 text-ink-secondary">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando abordagem…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-3xl rounded-card border border-content-border bg-white p-8 text-center">
        <p className="text-lg font-semibold text-ink">
          {!isOnline ? 'Abordagem indisponível offline' : 'Abordagem não encontrada'}
        </p>
        <p className="mt-1 text-sm text-ink-secondary">
          {!isOnline
            ? 'Não há cópia local desta abordagem neste dispositivo. Conecte-se para carregá-la.'
            : 'O registro pode ter sido removido ou o link está incorreto.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" onClick={() => router.push('/abordagens')}>
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

  const { stop, source, syncStatus, agentName, offenders, incident, photos, audit } = data
  const internalNumber = `AB-${shortId(stop.id)}`
  const isLocal = source === 'local'
  const isFlagrante = stop.type === 'in_flagrante'
  const hasCoords = stop.latitude != null && stop.longitude != null
  const gmapsLink = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${stop.latitude},${stop.longitude}`
    : null

  const addressLine = [stop.address_street, stop.address_district, stop.address_city]
    .filter((part) => part && String(part).trim())
    .join(', ')

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-16">
      <Link
        href="/abordagens"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Abordagens
      </Link>

      {/* Header ----------------------------------------------------------- */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="font-mono text-2xl font-bold tracking-tight text-ink">
              {internalNumber}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={isFlagrante ? 'in_flagrante' : 'secondary'}>
                {STOP_TYPE_LABELS[stop.type] ?? stop.type}
              </Badge>
              {stop.outcome && (
                <Badge variant="outline">{stopOutcomeLabel(stop.outcome)}</Badge>
              )}
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

          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              Editar
            </Button>
          )}
        </div>
      </header>

      {/* Flagrante — dados do meliante em destaque --------------------- */}
      {isFlagrante && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-status-in-flagrante-text">
            <ShieldAlert className="h-4 w-4" />
            Flagrante · dados do conduzido
          </h2>
          {offenders.length === 0 ? (
            <EmptyRow>Nenhum meliante identificado nesta abordagem.</EmptyRow>
          ) : (
            offenders.map((offender) => (
              <div
                key={offender.linkId}
                className="space-y-3 rounded-card border-2 border-status-in-flagrante-text/30 bg-status-in-flagrante-bg/40 p-4"
              >
                <Link
                  href={`/meliantes/${offender.offenderId}`}
                  className="flex items-center gap-3"
                >
                  <Avatar className="h-14 w-14 shrink-0 border border-content-border">
                    {offender.photoUrl && (
                      <AvatarImage src={offender.photoUrl} alt={offender.name} />
                    )}
                    <AvatarFallback className="text-lg">
                      {initials(offender.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-ink">
                      {offender.name}
                    </p>
                    {offender.nickname && (
                      <p className="text-xs text-ink-secondary">
                        &ldquo;{offender.nickname}&rdquo;
                      </p>
                    )}
                    <p className="mt-0.5 text-xs font-medium text-brand">Ver ficha completa →</p>
                  </div>
                </Link>

                {offender.full && (
                  <dl className="grid gap-x-6 gap-y-3 border-t border-status-in-flagrante-text/20 pt-3 sm:grid-cols-2">
                    <Detail label="Nome completo" value={offender.full.full_name} />
                    <Detail label="Nome social" value={offender.full.social_name} />
                    <Detail label="CPF" value={offender.full.cpf} mono />
                    <Detail label="RG" value={offender.full.rg} mono />
                    <Detail
                      label="Data de nascimento"
                      value={
                        offender.full.birth_date
                          ? offender.full.birth_date.slice(0, 10).split('-').reverse().join('/')
                          : null
                      }
                    />
                    <Detail
                      label="Gênero"
                      value={characteristicLabel('gender', offender.full.gender)}
                    />
                    <Detail
                      label="Altura"
                      value={
                        offender.full.height_m != null ? `${offender.full.height_m} m` : null
                      }
                    />
                    <Detail
                      label="Peso"
                      value={
                        offender.full.weight_kg != null ? `${offender.full.weight_kg} kg` : null
                      }
                    />
                    <Detail
                      label="Sinais particulares"
                      value={offender.full.distinguishing_marks}
                      className="sm:col-span-2"
                    />
                    <Detail
                      label="Descrição física"
                      value={offender.full.physical_description}
                      className="sm:col-span-2"
                      multiline
                    />
                  </dl>
                )}
              </div>
            ))
          )}
        </section>
      )}

      {/* SEÇÃO 1 — Informações gerais ----------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Informações gerais</h2>
        <dl className="grid gap-x-6 gap-y-3 rounded-card border border-content-border bg-white p-4 sm:grid-cols-2">
          <Detail label="Data e hora" value={fmtDateTime(stop.stopped_at)} />
          <Detail label="Tipo" value={STOP_TYPE_LABELS[stop.type] ?? stop.type} />
          <Detail label="Resultado" value={stopOutcomeLabel(stop.outcome)} />
          <Detail label="Agente responsável" value={agentName} />
          <Detail label="Registrada em" value={fmtDateTime(stop.created_at)} />
          <Detail
            label="Descrição"
            value={stop.description}
            className="sm:col-span-2"
            multiline
          />
          {stop.notes && (
            <Detail
              label="Observações"
              value={stop.notes}
              className="sm:col-span-2"
              multiline
            />
          )}
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
                Lat {stop.latitude?.toFixed(6)} · Long {stop.longitude?.toFixed(6)}
              </p>
              <LocationMap lat={stop.latitude as number} lng={stop.longitude as number} />
            </>
          )}

          {gmapsLink && (
            <a
              href={gmapsLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand transition-colors hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              Abrir no Google Maps
            </a>
          )}

          {!hasCoords && !addressLine && (
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
            <PhotoUpload entityId={id} entityType="stop" maxPhotos={MAX_PHOTOS_PER_STOP} />
          </div>
        )}

        <PhotoGallery entityId={id} entityType="stop" remotePhotos={photos} />
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
          <EmptyRow>Nenhum meliante vinculado a esta abordagem.</EmptyRow>
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
                      {isFlagrante ? 'Conduzido (flagrante)' : 'Abordado'}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator />

      {/* SEÇÃO 5 — Ocorrência vinculada ---------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Ocorrência vinculada</h2>
        {!stop.incident_id ? (
          <EmptyRow>Esta abordagem não está vinculada a nenhuma ocorrência.</EmptyRow>
        ) : !incident ? (
          <Link
            href={`/ocorrencias/${stop.incident_id}`}
            className="block rounded-card border border-content-border bg-white p-3 text-sm font-medium text-brand transition-colors hover:border-brand/40"
          >
            Abrir ocorrência vinculada →
          </Link>
        ) : (
          <Link
            href={`/ocorrencias/${incident.id}`}
            className="block rounded-card border border-content-border bg-white p-3 transition-colors hover:border-brand/40"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-ink">
                <FileText className="h-3.5 w-3.5 text-ink-muted" />
                {incident.internalNumber ?? `OC-${shortId(incident.id)}`}
              </span>
              <span className="text-xs text-ink-secondary">
                {INCIDENT_TYPE_LABELS[incident.type ?? ''] ?? incident.type ?? '—'} ·{' '}
                {fmtDateTime(incident.occurredAt)}
              </span>
              {incident.status && (
                <Badge
                  variant={
                    (['open', 'in_progress', 'closed', 'archived'] as const).includes(
                      incident.status as 'open',
                    )
                      ? (incident.status as 'open')
                      : 'secondary'
                  }
                  className="ml-auto"
                >
                  {STATUS_LABELS[incident.status as keyof typeof STATUS_LABELS] ??
                    incident.status}
                </Badge>
              )}
            </div>
            {incident.description && (
              <p className="mt-1.5 line-clamp-2 text-sm text-ink-secondary">
                {incident.description}
              </p>
            )}
          </Link>
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

      {/* Dialog — vincular meliante ---------------------------------- */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular meliante</DialogTitle>
            <DialogDescription>
              Busque um meliante já cadastrado para vinculá-lo a esta abordagem.
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
  mono,
  multiline,
}: {
  label: string
  value: string | null | undefined
  className?: string
  mono?: boolean
  multiline?: boolean
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-sm text-ink',
          !value && 'text-ink-muted',
          mono && value && 'font-mono',
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
