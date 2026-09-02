'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { v4 as uuidv4 } from 'uuid'
import { AlertCircle, Camera, ImagePlus, Loader2, Save, X } from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { savePendingPhoto, deletePendingPhoto, getPhotosByEntity } from '@/lib/db'
import { createQueueItem, enqueueSync, processQueue } from '@/lib/sync/queue'
import { useCurrentUser, initials } from '@/hooks/use-current-user'
import { useToast } from '@/hooks/use-toast'
import { compressImage, createPreviewURL, revokePreviewURL } from '@/lib/fotos/compress'
import { getOffenderDetail } from '@/lib/meliantes/data'
import {
  EYE_COLOR_OPTIONS,
  GENDER_OPTIONS,
  HAIR_COLOR_OPTIONS,
  MAX_PHOTOS_PER_OFFENDER,
  SKIN_COLOR_OPTIONS,
  emptyOffenderForm,
  maskCpf,
  offenderDisplayName,
  offenderFormSchema,
  toOffenderPayload,
  type OffenderFormValues,
} from '@/lib/meliantes/form'
import { PhotoUpload } from '@/components/fotos/PhotoUpload'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Textarea,
} from '@/components/ui'

export interface FormMelianteProps {
  mode: 'create' | 'edit'
  offenderId?: string
  /** Pre-fill for "criar novo" flows coming from BuscaMeliante. */
  initialValues?: Partial<OffenderFormValues>
  /** Called with the offender id after a successful save. */
  onSaved?: (id: string) => void
  /** Cancel handler — defaults to `router.back()`. */
  onCancel?: () => void
}

const MAIN_PHOTO_DESCRIPTION = 'Foto principal'

export function FormMeliante({
  mode,
  offenderId,
  initialValues,
  onSaved,
  onCancel,
}: FormMelianteProps) {
  const router = useRouter()
  const { toast } = useToast()
  const { user } = useCurrentUser()

  const [id] = React.useState(() => offenderId ?? uuidv4())
  const mainPhotoIdRef = React.useRef<string>(uuidv4())

  const form = useForm<OffenderFormValues>({
    resolver: zodResolver(offenderFormSchema),
    defaultValues: { ...emptyOffenderForm(), ...initialValues },
    mode: 'onBlur',
  })
  const { control, register, formState, handleSubmit } = form

  const [loading, setLoading] = React.useState(mode === 'edit')
  const [loadError, setLoadError] = React.useState(false)
  const [notFound, setNotFound] = React.useState(false)
  const [existsOnServer, setExistsOnServer] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  // Main photo -------------------------------------------------------------
  const [mainPhotoPreview, setMainPhotoPreview] = React.useState<string | null>(null)
  const [mainPhotoRemoteUrl, setMainPhotoRemoteUrl] = React.useState<string | null>(null)
  const [mainPhotoBusy, setMainPhotoBusy] = React.useState(false)
  const cameraInputRef = React.useRef<HTMLInputElement>(null)
  const galleryInputRef = React.useRef<HTMLInputElement>(null)

  // ---------------------------------------------------------------------------
  // Load (edit mode)
  // ---------------------------------------------------------------------------
  React.useEffect(() => {
    if (mode !== 'edit' || !offenderId) return
    let cancelled = false

    ;(async () => {
      try {
        const detail = await getOffenderDetail(offenderId)
        if (cancelled) return
        if (!detail) {
          setNotFound(true)
          return
        }

        form.reset(detail.values)
        setExistsOnServer(!detail.isLocalOnly)

        // A locally captured main photo (position 0) wins over the server one.
        const local = await getPhotosByEntity(offenderId)
        const localMain = local.find((photo) => photo.position === 0)
        if (!cancelled) {
          if (localMain) {
            mainPhotoIdRef.current = localMain.id
            setMainPhotoPreview(createPreviewURL(localMain.blob))
          } else {
            const remoteMain =
              detail.photos.find((photo) => (photo.sortOrder ?? 0) === 0) ?? detail.photos[0]
            setMainPhotoRemoteUrl(remoteMain?.url ?? detail.offender.main_photo_url ?? null)
          }
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
  }, [mode, offenderId])

  React.useEffect(() => {
    return () => {
      if (mainPhotoPreview) revokePreviewURL(mainPhotoPreview)
    }
  }, [mainPhotoPreview])

  // ---------------------------------------------------------------------------
  // Main photo handlers
  // ---------------------------------------------------------------------------
  const handleMainPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setMainPhotoBusy(true)
    try {
      const blob = await compressImage(file)
      await savePendingPhoto({
        id: mainPhotoIdRef.current,
        entity_type: 'offender',
        entity_id: id,
        blob,
        mime_type: blob.type || 'image/jpeg',
        size_bytes: blob.size,
        description: MAIN_PHOTO_DESCRIPTION,
        position: 0,
        status: 'pending',
        sync_attempts: 0,
        last_error: null,
        created_at: new Date().toISOString(),
      })
      setMainPhotoPreview((prev) => {
        if (prev) revokePreviewURL(prev)
        return createPreviewURL(blob)
      })
      setMainPhotoRemoteUrl(null)
    } catch {
      toast({ title: 'Não foi possível processar a foto', variant: 'destructive' })
    } finally {
      setMainPhotoBusy(false)
    }
  }

  const removeMainPhoto = async () => {
    await deletePendingPhoto(mainPhotoIdRef.current)
    setMainPhotoPreview((prev) => {
      if (prev) revokePreviewURL(prev)
      return null
    })
    setMainPhotoRemoteUrl(null)
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  const onSubmit = handleSubmit(
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
        const payload = toOffenderPayload(id, values, user.id, operation)

        await enqueueSync(createQueueItem('offender', operation, payload, 1))

        const online = typeof navigator !== 'undefined' && navigator.onLine
        if (online) void processQueue().catch(() => {})

        toast({
          title: mode === 'create' ? 'Meliante cadastrado' : 'Cadastro atualizado',
          description: online
            ? 'Enviando para o servidor…'
            : 'Sem conexão — será sincronizado automaticamente.',
        })

        if (onSaved) {
          onSaved(id)
        } else if (mode === 'create') {
          router.push(`/meliantes/${id}`)
        } else {
          router.refresh()
        }
      } catch (error) {
        toast({
          title: 'Erro ao salvar o cadastro',
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

  const handleCancel = () => {
    if (onCancel) onCancel()
    else router.back()
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center py-20 text-ink-secondary">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando cadastro…
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl rounded-card border border-content-border bg-white p-8 text-center">
        <p className="text-lg font-semibold text-ink">Meliante não encontrado</p>
        <p className="mt-1 text-sm text-ink-secondary">
          O cadastro pode ter sido removido ou o link está incorreto.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/meliantes')}>
          Voltar para a lista
        </Button>
      </div>
    )
  }

  const errors = formState.errors
  const previewName = offenderDisplayName({
    full_name: form.watch('full_name'),
    social_name: form.watch('social_name'),
    nickname: form.watch('nickname'),
  })
  const mainPhotoSrc = mainPhotoPreview ?? mainPhotoRemoteUrl

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-28">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink">
          {mode === 'create' ? 'Novo meliante' : 'Editar meliante'}
        </h1>
        <p className="text-sm text-ink-secondary">
          Preencha os dados de identificação e características físicas.
        </p>
        {loadError && (
          <p className="mt-2 flex items-center gap-2 rounded-input border border-sync-pending-text/20 bg-sync-pending-bg px-3 py-2 text-xs font-medium text-sync-pending-text">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Não foi possível carregar do servidor — exibindo o que existe localmente.
          </p>
        )}
      </header>

      {/* SEÇÃO 1 — Identificação -------------------------------------------- */}
      <section className="space-y-4">
        <SectionTitle index={1}>Identificação</SectionTitle>

        <Field label="Nome completo" required error={errors.full_name?.message}>
          <Input placeholder="Nome civil completo" {...register('full_name')} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome social" error={errors.social_name?.message}>
            <Input {...register('social_name')} />
          </Field>
          <Field label="Apelido" error={errors.nickname?.message}>
            <Input {...register('nickname')} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CPF" error={errors.cpf?.message}>
            <Controller
              control={control}
              name="cpf"
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
          <Field label="RG" error={errors.rg?.message}>
            <Input placeholder="Registro geral" {...register('rg')} />
          </Field>
        </div>

        <Field label="Data de nascimento" error={errors.birth_date?.message} className="sm:max-w-xs">
          <Input type="date" {...register('birth_date')} />
        </Field>
      </section>

      <Separator />

      {/* SEÇÃO 2 — Características físicas --------------------------------- */}
      <section className="space-y-4">
        <SectionTitle index={2}>Características físicas</SectionTitle>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Gênero">
            <SelectField control={control} name="gender" options={GENDER_OPTIONS} />
          </Field>
          <Field label="Altura (m)" hint="Ex.: 1.75">
            <Input inputMode="decimal" placeholder="1.75" {...register('height_m')} />
          </Field>
          <Field label="Peso (kg)" hint="Ex.: 72">
            <Input inputMode="decimal" placeholder="72" {...register('weight_kg')} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Cor de pele">
            <SelectField control={control} name="skin_color" options={SKIN_COLOR_OPTIONS} />
          </Field>
          <Field label="Cor dos olhos">
            <SelectField control={control} name="eye_color" options={EYE_COLOR_OPTIONS} />
          </Field>
          <Field label="Cor do cabelo">
            <SelectField control={control} name="hair_color" options={HAIR_COLOR_OPTIONS} />
          </Field>
        </div>

        <Field label="Sinais particulares" hint="Tatuagens, cicatrizes, marcas de nascença…">
          <Textarea rows={3} {...register('distinguishing_marks')} />
        </Field>

        <Field label="Descrição física livre">
          <Textarea
            rows={3}
            placeholder="Compleição, estilo de barba/cabelo, forma de andar, vestimenta habitual…"
            {...register('physical_description')}
          />
        </Field>
      </section>

      <Separator />

      {/* SEÇÃO 3 — Foto -------------------------------------------------- */}
      <section className="space-y-4">
        <SectionTitle index={3}>Foto</SectionTitle>

        <div className="space-y-2">
          <Label>Foto principal</Label>
          <div className="flex items-center gap-4">
            <Avatar className="h-[120px] w-[120px] shrink-0 border border-content-border">
              {mainPhotoSrc && <AvatarImage src={mainPhotoSrc} alt={previewName} />}
              <AvatarFallback className="text-2xl font-semibold">
                {initials(previewName)}
              </AvatarFallback>
            </Avatar>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={mainPhotoBusy}
                  onClick={() => cameraInputRef.current?.click()}
                >
                  {mainPhotoBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                  Câmera
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={mainPhotoBusy}
                  onClick={() => galleryInputRef.current?.click()}
                >
                  <ImagePlus className="h-4 w-4" />
                  Galeria
                </Button>
                {mainPhotoSrc && (
                  <Button type="button" variant="ghost" size="sm" onClick={removeMainPhoto}>
                    <X className="h-4 w-4" />
                    Remover
                  </Button>
                )}
              </div>
              <p className="text-xs text-ink-secondary">
                A foto é comprimida e guardada no dispositivo até a sincronização.
              </p>
            </div>
          </div>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={handleMainPhoto}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleMainPhoto}
          />
        </div>

        <div className="space-y-2">
          <Label>Fotos adicionais</Label>
          <PhotoUpload
            entityId={id}
            entityType="offender"
            startPosition={1}
            excludeId={mainPhotoIdRef.current}
            maxPhotos={MAX_PHOTOS_PER_OFFENDER - 1}
          />
        </div>
      </section>

      {/* Sticky footer ------------------------------------------------- */}
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-content-border bg-white/95 backdrop-blur lg:pl-sidebar">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-2 px-4 py-3">
          <Button type="button" variant="outline" onClick={handleCancel} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={onSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {mode === 'create' ? 'Cadastrar meliante' : 'Salvar alterações'}
          </Button>
        </div>
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------
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

function SelectField({
  control,
  name,
  options,
}: {
  control: import('react-hook-form').Control<OffenderFormValues>
  name: keyof OffenderFormValues
  options: { value: string; label: string }[]
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select value={field.value || undefined} onValueChange={field.onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  )
}
