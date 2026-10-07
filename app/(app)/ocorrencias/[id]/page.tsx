import { DetalheOcorrencia } from '@/components/ocorrencias/DetalheOcorrencia'

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <DetalheOcorrencia incidentId={id} />
}
