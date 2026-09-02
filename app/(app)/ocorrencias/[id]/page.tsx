import { DetalheOcorrencia } from '@/components/ocorrencias/DetalheOcorrencia'

export default function IncidentDetailPage({ params }: { params: { id: string } }) {
  return <DetalheOcorrencia incidentId={params.id} />
}
