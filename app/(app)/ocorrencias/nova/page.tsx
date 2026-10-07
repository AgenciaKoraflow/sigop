import { FormOcorrencia } from '@/components/ocorrencias/FormOcorrencia'
import type { IncidentType } from '@/types/app.types'
import { INCIDENT_TYPE_OPTIONS } from '@/lib/ocorrencias/form'

const VALID_TYPES = new Set(INCIDENT_TYPE_OPTIONS.map((option) => option.value))

interface NewOccurrencePageProps {
  searchParams: Promise<{ type?: string }>
}

export default async function NewOccurrencePage({ searchParams }: NewOccurrencePageProps) {
  const { type: requestedType } = await searchParams
  const initialType = VALID_TYPES.has(requestedType as IncidentType)
    ? (requestedType as IncidentType)
    : undefined

  return <FormOcorrencia mode="create" initialType={initialType} />
}
