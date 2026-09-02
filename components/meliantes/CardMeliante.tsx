'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { FileText, ShieldAlert } from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { initials } from '@/hooks/use-current-user'
import { offenderDisplayName } from '@/lib/meliantes/form'
import type { OffenderSearchResult } from '@/lib/meliantes/data'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

export interface CardMelianteProps {
  offender: OffenderSearchResult
  className?: string
}

/** Result card for the offender search / listing grid. */
export function CardMeliante({ offender, className }: CardMelianteProps) {
  const name = offenderDisplayName({
    full_name: offender.fullName,
    social_name: offender.socialName,
    nickname: offender.nickname,
  })

  const lastStop = offender.lastStoppedAt
    ? format(new Date(offender.lastStoppedAt), "dd/MM/yyyy", { locale: ptBR })
    : null

  return (
    <Link
      href={`/meliantes/${offender.id}`}
      className={cn(
        'group flex flex-col gap-3 rounded-card border border-content-border bg-content-surface p-4 shadow-card transition-colors hover:border-brand/40',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar className="h-14 w-14 shrink-0">
          {offender.mainPhotoUrl && <AvatarImage src={offender.mainPhotoUrl} alt={name} />}
          <AvatarFallback className="text-sm font-semibold">{initials(name)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{name}</p>
          {offender.nickname ? (
            <p className="truncate text-xs text-ink-secondary">&ldquo;{offender.nickname}&rdquo;</p>
          ) : (
            <p className="truncate text-xs text-ink-muted">Sem apelido</p>
          )}
          {offender.cpf && (
            <p className="mt-0.5 truncate font-mono text-[11px] text-ink-muted">CPF {offender.cpf}</p>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-content-divider pt-3">
        <Badge variant="secondary" className="gap-1">
          <ShieldAlert className="h-3 w-3" />
          {offender.stopCount} {offender.stopCount === 1 ? 'abordagem' : 'abordagens'}
        </Badge>
        {offender.incidentCount > 0 && (
          <Badge variant="outline" className="gap-1">
            <FileText className="h-3 w-3" />
            {offender.incidentCount} {offender.incidentCount === 1 ? 'ocorrência' : 'ocorrências'}
          </Badge>
        )}
        <span className="ml-auto text-[11px] text-ink-muted">
          {lastStop ? `Última abordagem: ${lastStop}` : 'Sem abordagens'}
        </span>
      </div>
    </Link>
  )
}
