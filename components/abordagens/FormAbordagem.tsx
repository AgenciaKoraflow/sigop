'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { v4 as uuidv4 } from 'uuid'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AlertCircle,
  Camera,
  ChevronDown,
  Clock,
  Link2,
  Loader2,
  MapPin,
  Save,
  Search,
  UserPlus,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { createClient } from '@/lib/supabase/client'
import {
  getDraftStop,
  readSetting,
  saveDraftStop,
  savePendingPhoto,
  saveSetting,
} from '@/lib/db'
import type { DraftStop } from '@/lib/db/schema'
import { createQueueItem, enqueueSync, processQueue } from '@/lib/sync/queue'
import { useSyncQueue } from '@/hooks/use-sync-queue'
import { useCurrentUser, initials } from '@/hooks/use-current-user'
import { useToast } from '@/hooks/use-toast'
import { SYNC_LABELS, INCIDENT_TYPE_LABELS } from '@/lib/dashboard/labels'
import type { SyncStatus } from '@/types/app.types'
import {
  compressImage,
  createPreviewURL,
  revokePreviewURL,
} from '@/lib/fotos/compress'
import {
  fetchViaCep,
  formatCoord,
  maskCep,
  parseGoogleMapsUrl,
  toDatetimeLocal,
} from '@/lib/ocorrencias/form'
import {
  AUTOSAVE_DELAY_MS,
  GENDER_OPTIONS,
  MAX_PHOTOS_PER_STOP,
  STOP_DESCRIPTION_MAX,
  STOP_DESCRIPTION_MIN,
  STOP_OUTCOME_OPTIONS,
  STOP_TYPE_OPTIONS,
  emptyStopForm,
  fromStopPayload,
  hasSubjectData,
  maskCpf,
  stopExtrasSettingKey,
  stopFormSchema,
  toOffenderPayload,
  toStopPayload,
  type StopFormExtras,
  type StopFormValues,
} from '@/lib/abordagens/form'
import { PhotoUpload } from '@/components/fotos/PhotoUpload'
import { BuscaMeliante } from '@/components/meliantes/BuscaMeliante'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui'

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

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function untyped(): SupabaseClient {
  return createClient() as unknown as SupabaseClient
}

interface FoundIncident {
  id: string
  internal_number: string | null
  type: string
  description: string
  occurred_at: string
}

export interface FormAbordagemProps {
  mode: 'create' | 'edit'
  stopId?: string
}

export function FormAbordagem({ mode, stopId }: FormAbordagemProps) {
  const router = useRouter()
  const { toast } = useToast()
  const { user } = useCurrentUser()
  const { saveStop } = useSyncQueue()

  // Stable id for the whole lifetime of the form. Photos in IndexedDB are keyed
  // by this, so it must exist before the first render.
  const [id] = React.useState(() => stopId ?? newId())
  // Stable ids for the companion records (would-be new offender + link row).
  const subjectIdRef = React.useRef<string>(uuidv4())
  const linkIdRef = React.useRef<string>(uuidv4())

  const form = useForm<StopFormValues>({
    resolver: zodResolver(stopFormSchema),
    defaultValues: emptyStopForm(),
    mode: 'onBlur',
  })
  const { control, register, watch, setValue, getValues, formState } = form

  const [loading, setLoading] = React.useState(mode === 'edit')
  const [loadError, setLoadError] = React.useState(false)
  const [notFound, setNotFound] = React.useState(false)
  const [existsOnServer, setExistsOnServer] = React.useState(false)
  const [localStatus, setLocalStatus] = React.useState<SyncStatus | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  // Subject block (simple mode is collapsed by default)
  const [subjectExpanded, setSubjectExpanded] = React.useState(false)

  // Subject photo
  const [photoBlob, setPhotoBlob] = React.useState<Blob | null>(null)
  const [photoPreview, setPhotoPreview] = React.useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = React.useState(false)
  const photoInputRef = React.useRef<HTMLInputElement>(null)

  // GPS / CEP / Google Maps
  const [gpsLoading, setGpsLoading] = React.useState(false)
  const [gpsError, setGpsError] = React.useState<string | null>(null)
  const [cepLoading, setCepLoading] = React.useState(false)
  const [cepError, setCepError] = React.useState<string | null>(null)
  const [gmapsInput, setGmapsInput] = React.useState('')
  const [gmapsError, setGmapsError] = React.useState<string | null>(null)

  // Incident link lookup
  const [incidentQuery, setIncidentQuery] = React.useState('')
  const [incidentLoading, setIncidentLoading] = React.useState(false)
  const [incidentError, setIncidentError] = React.useState<string | null>(null)
  const [foundIncident, setFoundIncident] = React.useState<FoundIncident | null>(null)

  // Autosave bookkeeping
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null)
  const [, forceTick] = React.useState(0)
  const baselineRef = React.useRef<string>('')
  // Server `version` seen when this edit began — the optimistic-concurrency
  // baseline. Null for brand-new stops.
  const serverBaselineVersion = React.useRef<number | null>(null)

  const typeValue = watch('type')
  const latitude = watch('latitude')
  const longitude = watch('longitude')
  const description = watch('description') ?? ''
  const linkIncident = watch('link_incident')
  const subjectExistingId = watch('subject_existing_id')
  const isFlagrante = typeValue === 'in_flagrante'
  const subjectOpen = isFlagrante || subjectExpanded

  // -------------------------------------------------------------------------
  // Load existing stop (edit mode)
  // -------------------------------------------------------------------------
  React.useEffect(() => {
    if (mode !== 'edit' || !stopId) return
    let cancelled = false

    ;(async () => {
      try {
        const extras = (await readSetting(stopExtrasSettingKey(stopId))) as
          | StopFormExtras
          | undefined
        if (extras && !cancelled) {
          subjectIdRef.current = extras.subjectId
          linkIdRef.current = extras.linkId
          if (extras.subjectPhoto) {
            setPhotoBlob(extras.subjectPhoto)
            setPhotoPreview(createPreviewURL(extras.subjectPhoto))
          }
        }

        // 1. Local draft wins — freshest copy.
        const draft = await getDraftStop(stopId)
        if (draft && !cancelled) {
          const base = fromStopPayload(draft.payload)
          form.reset({
            ...base,
            incident_number: extras?.incidentNumber ?? '',
            subject_existing_id: extras?.subjectExistingId ?? null,
            subject_existing_label: extras?.subjectExistingLabel ?? '',
            subject: extras?.subject ?? base.subject,
          })
          setLocalStatus(draft.status)
          setExistsOnServer(draft.operation === 'update')
          serverBaselineVersion.current = draft.remote_version ?? null
          if (base.type === 'stop' && extras && hasSubjectData(extras.subject)) {
            setSubjectExpanded(true)
          }
          if (base.incident_id) {
            void loadIncidentCard(base.incident_id)
          }
          return
        }

        // 2. Fall back to the server.
        const supabase = untyped()
        const { data, error } = await supabase
          .from('stops')
          .select('*')
          .eq('id', stopId)
          .is('deleted_at', null)
          .maybeSingle()
        if (error) throw new Error(error.message)
        if (!data) {
          if (!cancelled) setNotFound(true)
          return
        }

        const base = fromStopPayload(data as Record<string, unknown>)

        const { data: links } = await supabase
          .from('stop_offenders')
          .select(
            'offender_id, offenders ( id, full_name, social_name, nickname, main_photo_url )',
          )
          .eq('stop_id', stopId)
          .limit(1)

        const linkedOffender = (links as RawStopLink[] | null)?.[0]?.offenders ?? null
        const linkedLabel = linkedOffender
          ? linkedOffender.full_name ||
            linkedOffender.social_name ||
            linkedOffender.nickname ||
            'Meliante vinculado'
          : ''

        if (!cancelled) {
          form.reset({
            ...base,
            subject_existing_id: linkedOffender?.id ?? null,
            subject_existing_label: linkedLabel,
          })
          setExistsOnServer(true)
          const v = (data as Record<string, unknown>).version
          serverBaselineVersion.current = typeof v === 'number' ? v : null
          if (base.incident_id) void loadIncidentCard(base.incident_id)
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
  }, [mode, stopId])

  // Snapshot used to detect real changes for autosave.
  const snapshot = JSON.stringify({ values: watch(), photo: photoBlob?.size ?? 0 })

  React.useEffect(() => {
    if (loading) return
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

  // Revoke the photo preview URL on unmount / replacement.
  React.useEffect(() => {
    return () => {
      if (photoPreview) revokePreviewURL(photoPreview)
    }
  }, [photoPreview])

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------
  const buildPayload = React.useCallback(
    (values: StopFormValues, operation: 'create' | 'update') => {
      const payload = toStopPayload(id, values, user?.id ?? null)
      if (operation === 'update') {
        delete payload.created_by
        if (user?.id) payload.updated_by = user.id
      }
      return payload
    },
    [id, user?.id],
  )

  const buildExtras = React.useCallback(
    (values: StopFormValues): StopFormExtras => ({
      subjectId: subjectIdRef.current,
      subject: values.subject,
      subjectExistingId: values.subject_existing_id,
      subjectExistingLabel: values.subject_existing_label ?? '',
      linkId: linkIdRef.current,
      incidentNumber: values.incident_number ?? '',
      subjectPhoto: photoBlob,
    }),
    [photoBlob],
  )

  const persistDraft = React.useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const values = getValues()
      const operation: 'create' | 'update' = existsOnServer ? 'update' : 'create'
      const payload = buildPayload(values, operation)
      const now = new Date().toISOString()
      const existing = await getDraftStop(id)

      const draft: DraftStop = {
        id,
        entity_type: 'stop',
        operation,
        payload,
        status: 'draft',
        sync_attempts: 0,
        last_error: null,
        next_attempt_at: null,
        local_version: (existing?.local_version ?? 0) + 1,
        remote_version: existing?.remote_version ?? serverBaselineVersion.current,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      }

      await saveDraftStop(draft)
      await saveSetting(stopExtrasSettingKey(id), buildExtras(values))

      baselineRef.current = JSON.stringify({ values, photo: photoBlob?.size ?? 0 })
      setLocalStatus('draft')
      setLastSavedAt(new Date())
      if (!silent) toast({ title: 'Rascunho salvo localmente' })
    },
    [buildExtras, buildPayload, existsOnServer, getValues, id, photoBlob, toast],
  )

  const handleSaveDraft = async () => {
    try {
      await persistDraft()
      if (mode === 'create') router.replace(`/abordagens/${id}`)
    } catch {
      toast({ title: 'Não foi possível salvar o rascunho', variant: 'destructive' })
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

        // Persists the draft locally (status "pending") AND enqueues the stop
        // sync unit (priority bucket 1).
        await saveStop(payload, operation, serverBaselineVersion.current)
        await saveSetting(stopExtrasSettingKey(id), buildExtras(values))

        // ---- Subject (abordado) ------------------------------------------
        const wantsSubject =
          values.type === 'in_flagrante' ||
          Boolean(values.subject_existing_id) ||
          hasSubjectData(values.subject)

        if (wantsSubject) {
          let offenderId = values.subject_existing_id

          if (!offenderId) {
            // Brand-new offender: its own queue item (priority bucket 1).
            offenderId = subjectIdRef.current
            await enqueueSync(
              createQueueItem(
                'offender',
                'create',
                toOffenderPayload(offenderId, values.subject, user.id),
                1,
              ),
            )

            if (photoBlob) {
              await savePendingPhoto({
                id: uuidv4(),
                entity_type: 'offender',
                entity_id: offenderId,
                blob: photoBlob,
                mime_type: photoBlob.type || 'image/jpeg',
                size_bytes: photoBlob.size,
                description: 'Foto da abordagem',
                position: 0,
                status: 'pending',
                sync_attempts: 0,
                last_error: null,
                created_at: new Date().toISOString(),
              })
            }
          }

          // ---- Link abordagem <-> meliante (priority bucket 3) ----------
          await enqueueSync(
            createQueueItem(
              'link',
              'create',
              {
                table: 'stop_offenders',
                id: linkIdRef.current,
                stop_id: id,
                offender_id: offenderId,
              },
              3,
            ),
          )
        }

        baselineRef.current = JSON.stringify({ values, photo: photoBlob?.size ?? 0 })
        setLocalStatus('pending')
        setLastSavedAt(new Date())

        const online = typeof navigator !== 'undefined' && navigator.onLine
        if (online) void processQueue().catch(() => {})

        toast({
          title: 'Abordagem salva',
          description: online
            ? 'Enviando para o servidor…'
            : 'Sem conexão — será sincronizada automaticamente.',
        })

        if (mode === 'create') router.push(`/abordagens/${id}`)
        else router.refresh()
      } catch (error) {
        toast({
          title: 'Erro ao finalizar a abordagem',
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
  // Subject photo
  // -------------------------------------------------------------------------
  const handlePhotoInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    try {
      const blob = await compressImage(file)
      setPhotoBlob(blob)
      setPhotoPreview((prev) => {
        if (prev) revokePreviewURL(prev)
        return createPreviewURL(blob)
      })
    } catch {
      toast({ title: 'Não foi possível processar a foto', variant: 'destructive' })
    } finally {
      setPhotoBusy(false)
    }
  }

  const removePhoto = () => {
    setPhotoBlob(null)
    setPhotoPreview((prev) => {
      if (prev) revokePreviewURL(prev)
      return null
    })
  }

  // -------------------------------------------------------------------------
  // Existing offender search (reuses the incident form's dialog)
  // -------------------------------------------------------------------------
  const linkExistingSubject = (offender: {
    offenderId: string
    fullName: string | null
    nickname: string | null
  }) => {
    setValue('subject_existing_id', offender.offenderId, { shouldDirty: true, shouldValidate: true })
    setValue(
      'subject_existing_label',
      offender.fullName || offender.nickname || 'Meliante vinculado',
      { shouldDirty: true },
    )
  }

  const clearExistingSubject = () => {
    setValue('subject_existing_id', null, { shouldDirty: true, shouldValidate: true })
    setValue('subject_existing_label', '', { shouldDirty: true })
  }

  // -------------------------------------------------------------------------
  // Incident link
  // -------------------------------------------------------------------------
  const loadIncidentCard = React.useCallback(async (incidentId: string) => {
    try {
      const supabase = untyped()
      const { data } = await supabase
        .from('incidents')
        .select('id, internal_number, type, description, occurred_at')
        .eq('id', incidentId)
        .maybeSingle()
      if (data) setFoundIncident(data as FoundIncident)
    } catch {
      /* best effort */
    }
  }, [])

  const searchIncident = async () => {
    const term = incidentQuery.trim()
    if (term.length < 3) {
      setIncidentError('Digite ao menos 3 caracteres do número interno.')
      return
    }
    setIncidentLoading(true)
    setIncidentError(null)
    setFoundIncident(null)
    try {
      const supabase = untyped()
      const { data, error } = await supabase
        .from('incidents')
        .select('id, internal_number, type, description, occurred_at')
        .ilike('internal_number', `%${term}%`)
        .is('deleted_at', null)
        .order('occurred_at', { ascending: false })
        .limit(1)
      if (error) throw new Error(error.message)
      const hit = (data as FoundIncident[] | null)?.[0]
      if (!hit) {
        setIncidentError('Nenhuma ocorrência encontrada com esse número.')
        return
      }
      setFoundIncident(hit)
    } catch {
      setIncidentError('Não foi possível buscar a ocorrência (verifique a conexão).')
    } finally {
      setIncidentLoading(false)
    }
  }

  const confirmIncident = () => {
    if (!foundIncident) return
    setValue('incident_id', foundIncident.id, { shouldDirty: true })
    setValue('incident_number', foundIncident.internal_number ?? '', { shouldDirty: true })
  }

  const detachIncident = () => {
    setValue('incident_id', null, { shouldDirty: true })
    setValue('incident_number', '', { shouldDirty: true })
    setFoundIncident(null)
    setIncidentQuery('')
  }

  const confirmedIncidentId = watch('incident_id')

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center py-20 text-ink-secondary">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando abordagem…
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl rounded-card border border-content-border bg-white p-8 text-center">
        <p className="text-lg font-semibold text-ink">Abordagem não encontrada</p>
        <p className="mt-1 text-sm text-ink-secondary">
          O registro pode ter sido removido ou o link está incorreto.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/abordagens')}>
          Voltar para a lista
        </Button>
      </div>
    )
  }

  const secondsAgo = lastSavedAt
    ? Math.max(0, Math.floor((Date.now() - lastSavedAt.getTime()) / 1000))
    : null
  const errors = formState.errors

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-28">
      {/* Header ---------------------------------------------------------- */}
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-ink">
            {mode === 'create' ? 'Nova abordagem' : 'Editar abordagem'}
          </h1>
          {localStatus && (
            <Badge variant={localStatus === 'draft' ? 'draft' : localStatus}>
              {localStatus === 'draft' ? 'Rascunho local' : SYNC_LABELS[localStatus]}
            </Badge>
          )}
        </div>
        <p className="text-sm text-ink-secondary">
          Os dados são salvos automaticamente no dispositivo enquanto você preenche.
        </p>
        {loadError && (
          <p className="mt-2 flex items-center gap-2 rounded-input border border-sync-pending-text/20 bg-sync-pending-bg px-3 py-2 text-xs font-medium text-sync-pending-text">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Não foi possível carregar do servidor — exibindo o que existe localmente.
          </p>
        )}
      </header>

      {/* CAMPO PRINCIPAL — tipo ---------------------------------------- */}
      <section className="space-y-3">
        <Label>
          Tipo de abordagem <span className="text-danger">*</span>
        </Label>
        <div className="grid gap-3 sm:grid-cols-2">
          {STOP_TYPE_OPTIONS.map((option) => {
            const selected = typeValue === option.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setValue('type', option.value, { shouldDirty: true })
                  form.clearErrors('subject')
                }}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-card border-2 p-4 text-left transition-colors',
                  selected
                    ? 'border-brand bg-brand text-white'
                    : 'border-content-border bg-white text-ink hover:border-brand/40',
                )}
              >
                <span className="text-2xl leading-none">{option.emoji}</span>
                <span className="text-base font-semibold">{option.label}</span>
                <span
                  className={cn(
                    'text-xs',
                    selected ? 'text-white/80' : 'text-ink-secondary',
                  )}
                >
                  {option.hint}
                </span>
              </button>
            )
          })}
        </div>
        {errors.type?.message && (
          <p className="text-xs font-medium text-danger">{errors.type.message}</p>
        )}
      </section>

      <Separator />

      {/* SEÇÃO — Dados da abordagem ----------------------------------- */}
      <section className="space-y-4">
        <SectionTitle index={1}>Dados da abordagem</SectionTitle>

        <Field
          label="Descrição"
          required
          error={errors.description?.message}
          hint={`${description.trim().length}/${STOP_DESCRIPTION_MAX} caracteres (mínimo ${STOP_DESCRIPTION_MIN})`}
        >
          <Textarea
            rows={5}
            maxLength={STOP_DESCRIPTION_MAX}
            placeholder="Relate a abordagem: motivo, quem foi abordado, o que foi encontrado, encaminhamentos…"
            {...register('description')}
          />
        </Field>

        <Field label="Data e hora" required error={errors.stopped_at?.message}>
          <div className="flex gap-2">
            <Input type="datetime-local" className="flex-1" {...register('stopped_at')} />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setValue('stopped_at', toDatetimeLocal(new Date()), { shouldDirty: true })
              }
            >
              <Clock className="h-4 w-4" />
              Agora
            </Button>
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Resultado" error={errors.outcome?.message}>
            <Controller
              control={control}
              name="outcome"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o resultado" />
                  </SelectTrigger>
                  <SelectContent>
                    {STOP_OUTCOME_OPTIONS.map((option) => (
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

        <Field label="Observações" hint="Opcional">
          <Textarea
            rows={3}
            placeholder="Informações adicionais sobre a abordagem."
            {...register('notes')}
          />
        </Field>
      </section>

      <Separator />

      {/* SEÇÃO — Dados do abordado (CONDICIONAL) --------------------- */}
      <section className="space-y-4">
        <SectionTitle index={2}>Dados do abordado</SectionTitle>

        {!subjectOpen ? (
          <button
            type="button"
            onClick={() => setSubjectExpanded(true)}
            className="flex items-center gap-2 rounded-input border border-dashed border-content-border bg-content-bg px-3 py-2.5 text-sm font-medium text-brand transition-colors hover:bg-brand-light"
          >
            <UserPlus className="h-4 w-4" />
            Adicionar dados do abordado (opcional)
          </button>
        ) : (
          <div className="space-y-4 rounded-card border border-content-border bg-white p-4">
            {isFlagrante ? (
              <p className="flex items-center gap-2 rounded-input border border-status-in-flagrante-text/20 bg-status-in-flagrante-bg px-3 py-2 text-xs font-medium text-status-in-flagrante-text">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                Flagrante: identificação completa do conduzido é obrigatória.
              </p>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-xs text-ink-secondary">Todos os campos são opcionais.</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSubjectExpanded(false)}
                >
                  <ChevronDown className="h-4 w-4 rotate-180" />
                  Recolher
                </Button>
              </div>
            )}

            {/* Existing offender search (flagrante) --------------------- */}
            {isFlagrante && (
              <div className="space-y-2">
                {subjectExistingId ? (
                  <div className="flex items-center gap-3 rounded-input border border-brand/30 bg-brand-light p-3">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback>
                        {initials(watch('subject_existing_label'))}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {watch('subject_existing_label') || 'Meliante vinculado'}
                      </p>
                      <p className="text-xs text-ink-secondary">Meliante já cadastrado</p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={clearExistingSubject}>
                      Trocar
                    </Button>
                  </div>
                ) : (
                  <BuscaMeliante
                    label="Buscar meliante existente"
                    onSelect={(selected) =>
                      linkExistingSubject({
                        offenderId: selected.id,
                        fullName: selected.fullName,
                        nickname: selected.nickname,
                      })
                    }
                  />
                )}
              </div>
            )}

            {/* Manual fields ------------------------------------------- */}
            {!(isFlagrante && subjectExistingId) && (
              <>
                {isFlagrante ? (
                  <>
                    <Field
                      label="Nome completo"
                      required
                      error={errors.subject?.full_name?.message}
                    >
                      <Input placeholder="Nome civil completo" {...register('subject.full_name')} />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="CPF" required error={errors.subject?.cpf?.message}>
                        <Controller
                          control={control}
                          name="subject.cpf"
                          render={({ field }) => (
                            <Input
                              inputMode="numeric"
                              placeholder="999.999.999-99"
                              value={field.value ?? ''}
                              onChange={(event) => field.onChange(maskCpf(event.target.value))}
                            />
                          )}
                        />
                      </Field>
                      <Field label="RG" required error={errors.subject?.rg?.message}>
                        <Input placeholder="Registro geral" {...register('subject.rg')} />
                      </Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Data de nascimento">
                        <Input type="date" {...register('subject.birth_date')} />
                      </Field>
                      <Field label="Gênero">
                        <Controller
                          control={control}
                          name="subject.gender"
                          render={({ field }) => (
                            <Select
                              value={field.value || undefined}
                              onValueChange={field.onChange}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione" />
                              </SelectTrigger>
                              <SelectContent>
                                {GENDER_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </Field>
                      <Field label="Apelido">
                        <Input {...register('subject.nickname')} />
                      </Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Altura (m)" hint="Ex.: 1.78">
                        <Input inputMode="decimal" placeholder="1.78" {...register('subject.height_m')} />
                      </Field>
                      <Field label="Peso (kg)" hint="Ex.: 74">
                        <Input inputMode="decimal" placeholder="74" {...register('subject.weight_kg')} />
                      </Field>
                    </div>
                    <Field label="Descrição física">
                      <Textarea rows={3} {...register('subject.physical_description')} />
                    </Field>
                    <Field label="Sinais particulares">
                      <Textarea
                        rows={2}
                        placeholder="Tatuagens, cicatrizes, marcas de nascença…"
                        {...register('subject.distinguishing_marks')}
                      />
                    </Field>

                    {/* Foto do meliante -------------------------------- */}
                    <div className="space-y-2">
                      <Label>Foto do meliante</Label>
                      {photoPreview ? (
                        <div className="flex items-start gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photoPreview}
                            alt="Foto do meliante"
                            className="h-28 w-28 rounded-input border border-content-border object-cover"
                          />
                          <Button type="button" variant="outline" size="sm" onClick={removePhoto}>
                            <X className="h-4 w-4" />
                            Remover
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={photoBusy}
                          onClick={() => photoInputRef.current?.click()}
                        >
                          {photoBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Camera className="h-4 w-4" />
                          )}
                          Tirar foto
                        </Button>
                      )}
                      <input
                        ref={photoInputRef}
                        type="file"
                        accept="image/*"
                        capture="user"
                        className="hidden"
                        onChange={handlePhotoInput}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Nome social">
                        <Input {...register('subject.social_name')} />
                      </Field>
                      <Field label="Apelido">
                        <Input {...register('subject.nickname')} />
                      </Field>
                    </div>
                    <Field label="Descrição física">
                      <Textarea rows={3} {...register('subject.physical_description')} />
                    </Field>
                    <Field label="Observações">
                      <Textarea rows={2} {...register('subject.notes')} />
                    </Field>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <Separator />

      {/* SEÇÃO — Localização ----------------------------------------- */}
      <section className="space-y-4">
        <SectionTitle index={3}>Localização</SectionTitle>

        <Tabs defaultValue="gps">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="gps">📍 GPS</TabsTrigger>
            <TabsTrigger value="address">🏠 Endereço</TabsTrigger>
            <TabsTrigger value="link">🔗 Google Maps</TabsTrigger>
          </TabsList>

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
              <p className="text-sm text-ink-secondary">Nenhuma coordenada capturada ainda.</p>
            )}
          </TabsContent>

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

      {/* SEÇÃO — Vínculo com ocorrência ----------------------------- */}
      <section className="space-y-4">
        <SectionTitle index={4}>Vínculo com ocorrência</SectionTitle>

        <div className="flex items-center justify-between rounded-input border border-content-border bg-white px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-ink">Vincular a uma ocorrência existente</p>
            <p className="text-xs text-ink-secondary">
              Relacione esta abordagem a uma ocorrência já registrada.
            </p>
          </div>
          <Controller
            control={control}
            name="link_incident"
            render={({ field }) => (
              <Switch
                checked={field.value}
                onCheckedChange={(checked) => {
                  field.onChange(checked)
                  if (!checked) detachIncident()
                }}
              />
            )}
          />
        </div>

        {linkIncident && (
          <div className="space-y-3">
            {confirmedIncidentId && foundIncident ? (
              <IncidentCard
                incident={foundIncident}
                confirmed
                onDetach={detachIncident}
              />
            ) : (
              <>
                <div className="flex items-end gap-2">
                  <Field label="Número interno" className="flex-1">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                      <Input
                        className="pl-9"
                        placeholder="OC-2024-000042"
                        value={incidentQuery}
                        onChange={(event) => setIncidentQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void searchIncident()
                          }
                        }}
                      />
                    </div>
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={searchIncident}
                    disabled={incidentLoading}
                  >
                    {incidentLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Buscar
                  </Button>
                </div>
                {incidentError && (
                  <p className="text-xs font-medium text-danger">{incidentError}</p>
                )}
                {foundIncident && (
                  <IncidentCard
                    incident={foundIncident}
                    onConfirm={confirmIncident}
                  />
                )}
              </>
            )}
          </div>
        )}
      </section>

      <Separator />

      {/* SEÇÃO — Fotos --------------------------------------------------- */}
      <section className="space-y-3">
        <SectionTitle index={5}>Fotos</SectionTitle>
        <p className="rounded-input border border-content-border bg-content-bg px-3 py-2 text-xs text-ink-secondary">
          Máximo de {MAX_PHOTOS_PER_STOP} fotos por abordagem. As fotos são comprimidas e guardadas
          no dispositivo até a sincronização.
        </p>
        <PhotoUpload entityId={id} entityType="stop" maxPhotos={MAX_PHOTOS_PER_STOP} />
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
              Finalizar abordagem
            </Button>
          </div>
        </div>
      </footer>

    </div>
  )
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------
interface RawStopLink {
  offender_id: string
  offenders: {
    id: string
    full_name: string | null
    social_name: string | null
    nickname: string | null
    main_photo_url: string | null
  } | null
}

function IncidentCard({
  incident,
  confirmed,
  onConfirm,
  onDetach,
}: {
  incident: FoundIncident
  confirmed?: boolean
  onConfirm?: () => void
  onDetach?: () => void
}) {
  const when = new Date(incident.occurred_at)
  return (
    <div
      className={cn(
        'space-y-2 rounded-card border p-3',
        confirmed ? 'border-brand/30 bg-brand-light' : 'border-content-border bg-white',
      )}
    >
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{incident.internal_number ?? 'sem número'}</Badge>
        <span className="text-xs text-ink-secondary">
          {INCIDENT_TYPE_LABELS[incident.type] ?? incident.type} ·{' '}
          {Number.isNaN(when.getTime()) ? '—' : when.toLocaleDateString('pt-BR')}
        </span>
      </div>
      <p className="line-clamp-2 text-sm text-ink">{incident.description}</p>
      <div className="flex justify-end gap-2">
        {confirmed ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDetach}>
            <X className="h-4 w-4" />
            Desvincular
          </Button>
        ) : (
          <Button type="button" variant="primary" size="sm" onClick={onConfirm}>
            Confirmar vínculo
          </Button>
        )}
      </div>
    </div>
  )
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
