'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeft, FileText, Loader2, Pencil, ShieldAlert } from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { initials } from '@/hooks/use-current-user'
import {
  getOffenderDetail,
  type OffenderDetail,
} from '@/lib/meliantes/data'
import {
  characteristicLabel,
  offenderDisplayName,
} from '@/lib/meliantes/form'
import { stopOutcomeLabel } from '@/lib/abordagens/form'
import { offenderRoleLabel } from '@/lib/ocorrencias/form'
import {
  INCIDENT_TYPE_LABELS,
  STATUS_LABELS,
  STOP_TYPE_LABELS,
} from '@/lib/dashboard/labels'
import { FormMeliante } from '@/components/meliantes/FormMeliante'
import { PhotoGallery } from '@/components/fotos/PhotoGallery'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
  } catch {
    return '—'
  }
}

function fmtDay(iso: string | null): string {
  if (!iso) return '—'
  try {
    return format(new Date(iso), 'dd/MM/yyyy', { locale: ptBR })
  } catch {
    return '—'
  }
}

export default function OffenderDetailPage({ params }: { params: { id: string } }) {
  const { id } = params
  const router = useRouter()

  const [detail, setDetail] = React.useState<OffenderDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [notFound, setNotFound] = React.useState(false)
  const [editing, setEditing] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await getOffenderDetail(id)
      if (!result) {
        setNotFound(true)
        return
      }
      setDetail(result)
      setNotFound(false)
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  React.useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center py-20 text-ink-secondary">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando ficha…
      </div>
    )
  }

  if (notFound || !detail) {
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

  if (editing) {
    return (
      <FormMeliante
        mode="edit"
        offenderId={id}
        onSaved={() => {
          setEditing(false)
          void load()
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  const { offender, stops, incidents, photos, isLocalOnly } = detail
  const name = offenderDisplayName(offender)
  const mainPhoto = photos.find((photo) => (photo.sortOrder ?? 0) === 0) ?? photos[0]
  const mainPhotoUrl = mainPhoto?.url ?? offender.main_photo_url ?? null

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-12">
      <Link
        href="/meliantes"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Meliantes
      </Link>

      {/* Header --------------------------------------------------------- */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Avatar className="h-32 w-32 shrink-0 border border-content-border">
          {mainPhotoUrl && <AvatarImage src={mainPhotoUrl} alt={name} />}
          <AvatarFallback className="text-3xl font-semibold">{initials(name)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-ink">{name}</h1>
            {isLocalOnly && <Badge variant="pending">Aguardando sincronização</Badge>}
          </div>
          {offender.nickname && (
            <p className="text-sm text-ink-secondary">&ldquo;{offender.nickname}&rdquo;</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="secondary" className="gap-1">
              <ShieldAlert className="h-3 w-3" />
              {stops.length} {stops.length === 1 ? 'abordagem' : 'abordagens'}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <FileText className="h-3 w-3" />
              {incidents.length} {incidents.length === 1 ? 'ocorrência' : 'ocorrências'}
            </Badge>
          </div>
        </div>

        <Button variant="primary" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" />
          Editar
        </Button>
      </header>

      {/* Identificação ------------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Identificação</h2>
        <dl className="grid gap-x-6 gap-y-3 rounded-card border border-content-border bg-white p-4 sm:grid-cols-2">
          <Detail label="Nome completo" value={offender.full_name} />
          <Detail label="Nome social" value={offender.social_name} />
          <Detail label="Apelido" value={offender.nickname} />
          <Detail label="CPF" value={offender.cpf} mono />
          <Detail label="RG" value={offender.rg} mono />
          <Detail label="Data de nascimento" value={fmtDay(offender.birth_date)} />
        </dl>
      </section>

      {/* Características físicas -------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Características físicas</h2>
        <dl className="grid gap-x-6 gap-y-3 rounded-card border border-content-border bg-white p-4 sm:grid-cols-2">
          <Detail label="Gênero" value={characteristicLabel('gender', offender.gender)} />
          <Detail
            label="Altura"
            value={offender.height_m != null ? `${offender.height_m} m` : null}
          />
          <Detail
            label="Peso"
            value={offender.weight_kg != null ? `${offender.weight_kg} kg` : null}
          />
          <Detail label="Cor de pele" value={characteristicLabel('skin_color', offender.skin_color)} />
          <Detail label="Cor dos olhos" value={characteristicLabel('eye_color', offender.eye_color)} />
          <Detail label="Cor do cabelo" value={characteristicLabel('hair_color', offender.hair_color)} />
          <Detail
            label="Sinais particulares"
            value={offender.distinguishing_marks}
            className="sm:col-span-2"
          />
          <Detail
            label="Descrição física"
            value={offender.physical_description}
            className="sm:col-span-2"
          />
        </dl>
      </section>

      {/* Histórico de abordagens ------------------------------------ */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">
          Histórico de abordagens{' '}
          <span className="text-sm font-normal text-ink-muted">({stops.length})</span>
        </h2>
        {stops.length === 0 ? (
          <EmptyRow>Nenhuma abordagem vinculada.</EmptyRow>
        ) : (
          <ul className="space-y-2">
            {stops.map((stop) => (
              <li key={stop.linkId}>
                <Link
                  href={`/abordagens/${stop.stopId}`}
                  className="block rounded-card border border-content-border bg-white p-3 transition-colors hover:border-brand/40"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={stop.type === 'in_flagrante' ? 'in_flagrante' : 'secondary'}
                    >
                      {STOP_TYPE_LABELS[stop.type ?? ''] ?? stop.type ?? '—'}
                    </Badge>
                    <span className="text-xs text-ink-secondary">
                      {fmtDate(stop.stoppedAt)}
                    </span>
                    <span className="ml-auto text-xs font-medium text-ink-secondary">
                      {stopOutcomeLabel(stop.outcome)}
                    </span>
                  </div>
                  {stop.description && (
                    <p className="mt-1.5 line-clamp-2 text-sm text-ink-secondary">
                      {stop.description}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Histórico de ocorrências --------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">
          Ocorrências vinculadas{' '}
          <span className="text-sm font-normal text-ink-muted">({incidents.length})</span>
        </h2>
        {incidents.length === 0 ? (
          <EmptyRow>Nenhuma ocorrência vinculada.</EmptyRow>
        ) : (
          <ul className="space-y-2">
            {incidents.map((incident) => (
              <li key={incident.linkId}>
                <Link
                  href={`/ocorrencias/${incident.incidentId}`}
                  className="block rounded-card border border-content-border bg-white p-3 transition-colors hover:border-brand/40"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {incident.internalNumber && (
                      <Badge variant="secondary">{incident.internalNumber}</Badge>
                    )}
                    <span className="text-xs text-ink-secondary">
                      {INCIDENT_TYPE_LABELS[incident.type ?? ''] ?? incident.type ?? '—'} ·{' '}
                      {fmtDay(incident.occurredAt)}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-xs font-medium text-ink-secondary">
                        {offenderRoleLabel(incident.role)}
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
                        >
                          {STATUS_LABELS[incident.status as 'open'] ?? incident.status}
                        </Badge>
                      )}
                    </span>
                  </div>
                  {incident.description && (
                    <p className="mt-1.5 line-clamp-2 text-sm text-ink-secondary">
                      {incident.description}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator />

      {/* Galeria de fotos ---------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Galeria de fotos</h2>
        <PhotoGallery entityId={id} entityType="offender" remotePhotos={photos} />
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------
function Detail({
  label,
  value,
  mono,
  className,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-sm text-ink',
          !value && 'text-ink-muted',
          mono && value && 'font-mono',
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
