'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AlertCircle,
  Clock,
  Link2,
  Loader2,
  MapPin,
  Save,
  Trash2,
  UserPlus,
} from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { createClient } from '@/lib/supabase/client'
import {
  getDraftIncident,
  readSetting,
  saveDraftIncident,
  saveSetting,
} from '@/lib/db'
import type { DraftIncident } from '@/lib/db/schema'
import { createQueueItem, enqueueSync, processQueue } from '@/lib/sync/queue'
import { useSyncQueue } from '@/hooks/use-sync-queue'
import { useCurrentUser, initials } from '@/hooks/use-current-user'
import { useToast } from '@/hooks/use-toast'
import { SYNC_LABELS } from '@/lib/dashboard/labels'
import {
  AUTOSAVE_DELAY_MS,
  INCIDENT_DESCRIPTION_MAX,
  INCIDENT_DESCRIPTION_MIN,
  INCIDENT_STATUS_OPTIONS,
  INCIDENT_TYPE_OPTIONS,
  MAX_PHOTOS_PER_INCIDENT,
  OFFENDER_ROLE_OPTIONS,
  emptyIncidentForm,
  fetchViaCep,
  formatCoord,
  fromIncidentPayload,
  incidentFormSchema,
  maskCep,
  offendersSettingKey,
  offenderRoleLabel,
  parseGoogleMapsUrl,
  toDatetimeLocal,
  toIncidentPayload,
  type IncidentFormValues,
  type LinkedOffender,
  type OffenderRole,
} from '@/lib/ocorrencias/form'
import type { SyncStatus } from '@/types/app.types'
import { PhotoUpload } from '@/components/fotos/PhotoUpload'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CreateOffenderDialog, LinkOffenderDialog } from './OffenderDialogs'

const LocationMap = dynamic(() => import('./LocationMap').then((m) => m.LocationMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-52 w-full items-center justify-center rounded-input border border-content-border bg-content-bg text-sm text-ink-secondary">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando mapa…
    </div>
  ),
})

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function untyped(): SupabaseClient {
  return createClient() as unknown as SupabaseClient
}

export interface FormOcorrenciaProps {
  mode: 'create' | 'edit'
  incidentId?: string
}

export function FormOcorrencia({ mode, incidentId }: FormOcorrenciaProps) {
  const router = useRouter()
  const { toast } = useToast()
  const { user } = useCurrentUser()
  const { saveIncident } = useSyncQueue()

  // A stable id for the whole lifetime of the form. Photos in IndexedDB are
  // keyed by this, so it must exist before the first render.
  const [id] = React.useState(() => incidentId ?? newId())

  const form = useForm<IncidentFormValues>({
    resolver: zodResolver(incidentFormSchema),
    defaultValues: emptyIncidentForm(),
    mode: 'onBlur',
  })
  const { control, register, watch, setValue, getValues, formState } = form

  const [loading, setLoading] = React.useState(mode === 'edit')
  const [loadError, setLoadError] = React.useState(false)
  const [notFound, setNotFound] = React.useState(false)
  const [existsOnServer, setExistsOnServer] = React.useState(false)
  const [localStatus, setLocalStatus] = React.useState<SyncStatus | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const [offenders, setOffenders] = React.useState<LinkedOffender[]>([])
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [pendingRemove, setPendingRemove] = React.useState<string | null>(null)

  // GPS
  const [gpsLoading, setGpsLoading] = React.useState(false)
  const [gpsError, setGpsError] = React.useState<string | null>(null)

  // CEP
  const [cepLoading, setCepLoading] = React.useState(false)
  const [cepError, setCepError] = React.useState<string | null>(null)

  // Google Maps link
  const [gmapsInput, setGmapsInput] = React.useState('')
  const [gmapsError, setGmapsError] = React.useState<string | null>(null)

  // Autosave bookkeeping
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null)
  const [, forceTick] = React.useState(0)
  const baselineRef = React.useRef<string>('')

  const latitude = watch('latitude')
  const longitude = watch('longitude')
  const typeValue = watch('type')
  const description = watch('description') ?? ''

  // -------------------------------------------------------------------------
  // Load existing incident (edit mode)
  // -------------------------------------------------------------------------
  React.useEffect(() => {
    if (mode !== 'edit' || !incidentId) return
    let cancelled = false

    ;(async () => {
      try {
        // 1. Local draft wins — it is the freshest copy.
        const draft = await getDraftIncident(incidentId)
        if (draft && !cancelled) {
          form.reset(fromIncidentPayload(draft.payload))
          setLocalStatus(draft.status)
          setExistsOnServer(draft.operation === 'update')
          const savedOffenders = (await readSetting(
            offendersSettingKey(incidentId),
          )) as LinkedOffender[] | undefined
          if (savedOffenders && !cancelled) setOffenders(savedOffenders)
          return
        }

        // 2. Fall back to the server.
        const supabase = untyped()
        const { data, error } = await supabase
          .from('incidents')
          .select('*')
          .eq('id', incidentId)
          .is('deleted_at', null)
          .maybeSingle()
        if (error) throw new Error(error.message)

        if (!data) {
          if (!cancelled) setNotFound(true)
          return
        }

        if (!cancelled) {
          form.reset(fromIncidentPayload(data as Record<string, unknown>))
          setExistsOnServer(true)
        }

        const { data: links } = await supabase
          .from('incident_offenders')
          .select(
            'id, role, offenders ( id, full_name, social_name, nickname, main_photo_url )',
          )
          .eq('incident_id', incidentId)

        if (!cancelled && links) {
          setOffenders(
            (links as unknown as RawLink[]).map((link) => ({
              linkId: link.id,
              offenderId: link.offenders?.id ?? '',
              role: (link.role as OffenderRole | null) ?? null,
              fullName: link.offenders?.full_name || link.offenders?.social_name || 'Sem nome',
              nickname: link.offenders?.nickname ?? null,
              photoUrl: link.offenders?.main_photo_url ?? null,
              isNew: false,
            })),
          )
        }
      } catch {
        if (!cancelled) setLoadError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, incidentId])

  // Snapshot used to detect real changes for autosave.
  const snapshot = JSON.stringify({ values: watch(), offenders })

  React.useEffect(() => {
    if (loading) return
    // Establish the baseline once, right after load.
    if (!baselineRef.current) {
      baselineRef.current = snapshot
      return
    }
    if (snapshot === baselineRef.current) return

    const timer = setTimeout(() => {
      void persistDraft({ silent: true })
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, loading])

  // "salvo há X segundos" ticker
  React.useEffect(() => {
    if (!lastSavedAt) return
    const interval = setInterval(() => forceTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [lastSavedAt])

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------
  const buildPayload = React.useCallback(
    (values: IncidentFormValues, operation: 'create' | 'update') => {
      const payload = toIncidentPayload(id, values, user?.id ?? null)
      if (operation === 'update') {
        delete payload.created_by
        if (user?.id) payload.updated_by = user.id
      }
      return payload
    },
    [id, user?.id],
  )

  const persistDraft = React.useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const values = getValues()
      const operation: 'create' | 'update' = existsOnServer ? 'update' : 'create'
      const payload = buildPayload(values, operation)
      const now = new Date().toISOString()
      const existing = await getDraftIncident(id)

      const draft: DraftIncident = {
        id,
        entity_type: 'incident',
        operation,
        payload,
        status: 'draft',
        sync_attempts: 0,
        last_error: null,
        next_attempt_at: null,
        local_version: (existing?.local_version ?? 0) + 1,
        remote_version: existing?.remote_version ?? null,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      }

      await saveDraftIncident(draft)
      await saveSetting(offendersSettingKey(id), offenders)

      baselineRef.current = JSON.stringify({ values, offenders })
      setLocalStatus('draft')
      setLastSavedAt(new Date())
      if (!silent) toast({ title: 'Rascunho salvo localmente' })
    },
    [buildPayload, existsOnServer, getValues, id, offenders, toast],
  )

  const handleSaveDraft = async () => {
    try {
      await persistDraft()
      if (mode === 'create') router.replace(`/ocorrencias/${id}`)
    } catch {
      toast({
        title: 'Não foi possível salvar o rascunho',
        variant: 'destructive',
      })
    }
  }

  const onFinalize = form.handleSubmit(
    async (values) => {
      if (!user) {
        toast({
          title: 'Aguarde',
          description: 'Ainda estamos carregando seu perfil. Tente novamente em instantes.',
          variant: 'destructive',
        })
        return
      }

      setSubmitting(true)
      try {
        const operation: 'create' | 'update' = existsOnServer ? 'update' : 'create'
        const payload = buildPayload(values, operation)

        // Persists the draft locally (status "pending") AND enqueues the sync unit.
        await saveIncident(payload, operation)
        await saveSetting(offendersSettingKey(id), offenders)

        for (const offender of offenders) {
          if (offender.isNew && offender.draft) {
            await enqueueSync(
              createQueueItem(
                'offender',
                'create',
                { ...offender.draft, created_by: user.id },
                1,
              ),
            )
          }
          await enqueueSync(
            createQueueItem(
              'link',
              'create',
              {
                table: 'incident_offenders',
                id: offender.linkId,
                incident_id: id,
                offender_id: offender.offenderId,
                role: offender.role,
                created_by: user.id,
              },
              3,
            ),
          )
        }

        baselineRef.current = JSON.stringify({ values, offenders })
        setLocalStatus('pending')
        setLastSavedAt(new Date())

        const online = typeof navigator !== 'undefined' && navigator.onLine
        if (online) void processQueue().catch(() => {})

        toast({
          title: 'Ocorrência salva',
          description: online
            ? 'Enviando para o servidor…'
            : 'Sem conexão — será sincronizada automaticamente.',
        })

        if (mode === 'create') {
          router.push(`/ocorrencias/${id}`)
        } else {
          router.refresh()
        }
      } catch (error) {
        toast({
          title: 'Erro ao finalizar a ocorrência',
          description: error instanceof Error ? error.message : 'Tente novamente.',
          variant: 'destructive',
        })
      } finally {
        setSubmitting(false)
      }
    },
    () => {
      toast({
        title: 'Revise o formulário',
        description: 'Há campos obrigatórios ou inválidos destacados em vermelho.',
        variant: 'destructive',
      })
    },
  )

  // -------------------------------------------------------------------------
  // Location handlers
  // -------------------------------------------------------------------------
  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('Este dispositivo não suporta geolocalização.')
      return
    }
    setGpsLoading(true)
    setGpsError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setValue('latitude', Number(position.coords.latitude.toFixed(7)), { shouldDirty: true })
        setValue('longitude', Number(position.coords.longitude.toFixed(7)), { shouldDirty: true })
        setGpsLoading(false)
      },
      (error) => {
        setGpsLoading(false)
        setGpsError(
          error.code === error.PERMISSION_DENIED
            ? 'Permissão de localização negada. Habilite o GPS para o navegador.'
            : 'Não foi possível obter sua localização. Tente novamente.',
        )
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    )
  }

  const lookupCep = async () => {
    setCepLoading(true)
    setCepError(null)
    try {
      const result = await fetchViaCep(getValues('address_zip') ?? '')
      setValue('address_street', result.address_street, { shouldDirty: true })
      setValue('address_district', result.address_district, { shouldDirty: true })
      setValue('address_city', result.address_city, { shouldDirty: true })
      setValue('address_state', result.address_state, { shouldDirty: true })
    } catch (error) {
      setCepError(error instanceof Error ? error.message : 'Falha ao consultar o CEP')
    } finally {
      setCepLoading(false)
    }
  }

  const extractFromGmaps = () => {
    const coords = parseGoogleMapsUrl(gmapsInput)
    if (!coords) {
      setGmapsError('Não encontramos coordenadas nesse link. Cole a URL completa do Google Maps.')
      return
    }
    setGmapsError(null)
    setValue('latitude', Number(coords.lat.toFixed(7)), { shouldDirty: true })
    setValue('longitude', Number(coords.lng.toFixed(7)), { shouldDirty: true })
    setValue('gmaps_link', gmapsInput.trim(), { shouldDirty: true })
  }

  const clearCoords = () => {
    setValue('latitude', null, { shouldDirty: true })
    setValue('longitude', null, { shouldDirty: true })
  }

  // -------------------------------------------------------------------------
  // Offender handlers
  // -------------------------------------------------------------------------
  const addOffender = (offender: Omit<LinkedOffender, 'linkId' | 'role'>) => {
    setOffenders((current) => {
      if (current.some((o) => o.offenderId === offender.offenderId)) return current
      return [...current, { ...offender, linkId: newId(), role: 'suspect' }]
    })
  }

  const setOffenderRole = (linkId: string, role: OffenderRole) => {
    setOffenders((current) =>
      current.map((o) => (o.linkId === linkId ? { ...o, role } : o)),
    )
  }

  const removeOffender = (linkId: string) => {
    setOffenders((current) => current.filter((o) => o.linkId !== linkId))
    setPendingRemove(null)
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center py-20 text-ink-secondary">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando ocorrência…
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl rounded-card border border-content-border bg-white p-8 text-center">
        <p className="text-lg font-semibold text-ink">Ocorrência não encontrada</p>
        <p className="mt-1 text-sm text-ink-secondary">
          O registro pode ter sido removido ou o link está incorreto.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/ocorrencias')}>
          Voltar para a lista
        </Button>
      </div>
    )
  }

  const secondsAgo = lastSavedAt
    ? Math.max(0, Math.floor((Date.now() - lastSavedAt.getTime()) / 1000))
    : null
  const locationError = formState.errors.address_street?.message
  const occurredError = formState.errors.occurred_at?.message

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-28">
      {/* Header ------------------------------------------------------------ */}
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-ink">
            {mode === 'create' ? 'Nova ocorrência' : 'Editar ocorrência'}
          </h1>
          {localStatus && (
            <Badge variant={localStatus === 'draft' ? 'draft' : localStatus}>
              {localStatus === 'draft' ? 'Rascunho local' : SYNC_LABELS[localStatus]}
            </Badge>
          )}
        </div>
        <p className="text-sm text-ink-secondary">
          Preencha as seções abaixo. Os dados são salvos automaticamente no dispositivo.
        </p>
        {loadError && (
          <p className="mt-2 flex items-center gap-2 rounded-input border border-sync-pending-text/20 bg-sync-pending-bg px-3 py-2 text-xs font-medium text-sync-pending-text">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Não foi possível carregar do servidor — exibindo o que existe localmente.
          </p>
        )}
      </header>

      {/* SEÇÃO 1 — Identificação ---------------------------------------- */}
      <section className="space-y-4">
        <SectionTitle index={1}>Identificação</SectionTitle>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de ocorrência" error={formState.errors.type?.message} required>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {INCIDENT_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <span className="mr-2">{option.emoji}</span>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          <Field label="Status" error={formState.errors.status?.message}>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INCIDENT_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        </div>

        {typeValue && (
          <Field label="Subtipo" hint="Detalhe livre, ex.: “furto de fiação”, “tentativa”">
            <Input placeholder="Descreva o subtipo (opcional)" {...register('subtype')} />
          </Field>
        )}

        <Field
          label="Data e hora da ocorrência"
          error={occurredError}
          required
        >
          <div className="flex gap-2">
            <Input type="datetime-local" className="flex-1" {...register('occurred_at')} />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setValue('occurred_at', toDatetimeLocal(new Date()), { shouldDirty: true })
              }
            >
              <Clock className="h-4 w-4" />
              Agora
            </Button>
          </div>
        </Field>

        <Field
          label="Descrição detalhada"
          error={formState.errors.description?.message}
          required
          hint={`${description.trim().length}/${INCIDENT_DESCRIPTION_MAX} caracteres (mínimo ${INCIDENT_DESCRIPTION_MIN})`}
        >
          <Textarea
            rows={5}
            maxLength={INCIDENT_DESCRIPTION_MAX}
            placeholder="Relate o que aconteceu: quem, o quê, quando, como, itens envolvidos…"
            {...register('description')}
          />
        </Field>
      </section>

      <Separator />

      {/* SEÇÃO 2 — Localização ----------------------------------------- */}
      <section className="space-y-4">
        <SectionTitle index={2}>Localização</SectionTitle>
        {locationError && (
          <p className="flex items-center gap-2 rounded-input border border-danger/20 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {locationError}
          </p>
        )}

        <Tabs defaultValue="gps">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="gps">📍 GPS</TabsTrigger>
            <TabsTrigger value="address">🏠 Endereço</TabsTrigger>
            <TabsTrigger value="link">🔗 Google Maps</TabsTrigger>
          </TabsList>

          {/* --- GPS ------------------------------------------------------ */}
          <TabsContent value="gps" className="space-y-3">
            <Button type="button" variant="primary" onClick={useMyLocation} disabled={gpsLoading}>
              {gpsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MapPin className="h-4 w-4" />
              )}
              Usar minha localização
            </Button>

            {gpsError && <p className="text-xs font-medium text-danger">{gpsError}</p>}

            {latitude != null && longitude != null ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-input border border-content-border bg-content-bg px-3 py-2">
                  <p className="font-mono text-sm text-ink">
                    Lat {formatCoord(latitude)} · Long {formatCoord(longitude)}
                  </p>
                  <Button type="button" variant="ghost" size="sm" onClick={clearCoords}>
                    Limpar
                  </Button>
                </div>
                <LocationMap
                  lat={latitude}
                  lng={longitude}
                  onChange={(lat, lng) => {
                    setValue('latitude', Number(lat.toFixed(7)), { shouldDirty: true })
                    setValue('longitude', Number(lng.toFixed(7)), { shouldDirty: true })
                  }}
                />
                <p className="text-xs text-ink-secondary">Toque no mapa para ajustar o pino.</p>
              </div>
            ) : (
              <p className="text-sm text-ink-secondary">
                Nenhuma coordenada capturada ainda.
              </p>
            )}
          </TabsContent>

          {/* --- Endereço manual --------------------------------------- */}
          <TabsContent value="address" className="space-y-4">
            <div className="flex items-end gap-2">
              <Field label="CEP" className="flex-1">
                <Controller
                  control={control}
                  name="address_zip"
                  render={({ field }) => (
                    <Input
                      inputMode="numeric"
                      placeholder="00000-000"
                      value={field.value ?? ''}
                      onChange={(event) => field.onChange(maskCep(event.target.value))}
                    />
                  )}
                />
              </Field>
              <Button type="button" variant="outline" onClick={lookupCep} disabled={cepLoading}>
                {cepLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Buscar
              </Button>
            </div>
            {cepError && <p className="text-xs font-medium text-danger">{cepError}</p>}

            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <Field label="Logradouro">
                <Input placeholder="Rua, avenida…" {...register('address_street')} />
              </Field>
              <Field label="Número">
                <Input placeholder="nº / s/n" {...register('address_number')} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Bairro">
                <Input {...register('address_district')} />
              </Field>
              <Field label="Cidade">
                <Input {...register('address_city')} />
              </Field>
              <Field label="UF">
                <Input maxLength={2} {...register('address_state')} />
              </Field>
            </div>
          </TabsContent>

          {/* --- Link Google Maps ------------------------------------- */}
          <TabsContent value="link" className="space-y-3">
            <Field label="URL do Google Maps">
              <Textarea
                rows={3}
                placeholder="Cole aqui o link compartilhado do Google Maps"
                value={gmapsInput}
                onChange={(event) => setGmapsInput(event.target.value)}
              />
            </Field>
            <Button type="button" variant="outline" onClick={extractFromGmaps}>
              <Link2 className="h-4 w-4" />
              Extrair localização
            </Button>
            {gmapsError ? (
              <p className="text-xs font-medium text-danger">{gmapsError}</p>
            ) : latitude != null && longitude != null ? (
              <p className="font-mono text-sm text-ink">
                Lat {formatCoord(latitude)} · Long {formatCoord(longitude)}
              </p>
            ) : null}
          </TabsContent>
        </Tabs>
      </section>

      <Separator />

      {/* SEÇÃO 3 — Fotos --------------------------------------------------- */}
      <section className="space-y-3">
        <SectionTitle index={3}>Fotos</SectionTitle>
        <p className="rounded-input border border-content-border bg-content-bg px-3 py-2 text-xs text-ink-secondary">
          Máximo de {MAX_PHOTOS_PER_INCIDENT} fotos por ocorrência. As fotos são comprimidas e
          guardadas no dispositivo até a sincronização.
        </p>
        <PhotoUpload entityId={id} entityType="incident" maxPhotos={MAX_PHOTOS_PER_INCIDENT} />
      </section>

      <Separator />

      {/* SEÇÃO 4 — Pessoas envolvidas ----------------------------------- */}
      <section className="space-y-4">
        <SectionTitle index={4}>Pessoas envolvidas</SectionTitle>

        {offenders.length === 0 ? (
          <p className="text-sm text-ink-secondary">Nenhum meliante vinculado.</p>
        ) : (
          <ul className="space-y-2">
            {offenders.map((offender) => (
              <li
                key={offender.linkId}
                className="flex flex-wrap items-center gap-3 rounded-input border border-content-border bg-white p-3"
              >
                <Avatar className="h-10 w-10">
                  {offender.photoUrl && (
                    <AvatarImage src={offender.photoUrl} alt={offender.fullName ?? ''} />
                  )}
                  <AvatarFallback>{initials(offender.fullName)}</AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {offender.fullName ?? 'Sem nome'}
                    {offender.nickname && (
                      <span className="text-ink-secondary"> · &ldquo;{offender.nickname}&rdquo;</span>
                    )}
                  </p>
                  <p className="text-xs text-ink-secondary">
                    {offender.isNew ? 'Novo cadastro (aguardando sync)' : offenderRoleLabel(offender.role)}
                  </p>
                </div>

                <Select
                  value={offender.role ?? undefined}
                  onValueChange={(value) => setOffenderRole(offender.linkId, value as OffenderRole)}
                >
                  <SelectTrigger className="h-9 w-40">
                    <SelectValue placeholder="Papel" />
                  </SelectTrigger>
                  <SelectContent>
                    {OFFENDER_ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover ${offender.fullName ?? 'meliante'}`}
                  onClick={() => setPendingRemove(offender.linkId)}
                >
                  <Trash2 className="h-4 w-4 text-danger" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setLinkDialogOpen(true)}>
            <Link2 className="h-4 w-4" />
            Vincular meliante existente
          </Button>
          <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Cadastrar novo meliante
          </Button>
        </div>
      </section>

      {/* Sticky footer ------------------------------------------------- */}
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-content-border bg-white/95 backdrop-blur lg:pl-sidebar">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-secondary">
            {secondsAgo === null
              ? 'Rascunho ainda não salvo'
              : secondsAgo < 3
                ? 'Rascunho salvo automaticamente agora mesmo'
                : `Rascunho salvo automaticamente há ${secondsAgo}s`}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={submitting}>
              <Save className="h-4 w-4" />
              Salvar rascunho
            </Button>
            <Button type="button" variant="primary" onClick={onFinalize} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Finalizar ocorrência
            </Button>
          </div>
        </div>
      </footer>

      {/* Dialogs ------------------------------------------------------- */}
      <LinkOffenderDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        linkedIds={offenders.map((o) => o.offenderId)}
        onLink={addOffender}
      />
      <CreateOffenderDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={addOffender}
      />

      <Dialog open={pendingRemove !== null} onOpenChange={(open) => !open && setPendingRemove(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover vínculo?</DialogTitle>
            <DialogDescription>
              O meliante deixará de estar vinculado a esta ocorrência. O cadastro dele não é
              excluído.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRemove(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => pendingRemove && removeOffender(pendingRemove)}
            >
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------
interface RawLink {
  id: string
  role: string | null
  offenders: {
    id: string
    full_name: string | null
    social_name: string | null
    nickname: string | null
    main_photo_url: string | null
  } | null
}

function SectionTitle({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
        {index}
      </span>
      <h2 className="text-lg font-semibold text-ink">{children}</h2>
    </div>
  )
}

function Field({
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label>
        {label}
        {required && <span className="text-danger"> *</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-secondary">{hint}</p>
      ) : null}
    </div>
  )
}
