import { FormOcorrencia } from '@/components/ocorrencias/FormOcorrencia'

export default function EditOccurrencePage({ params }: { params: { id: string } }) {
  return <FormOcorrencia mode="edit" incidentId={params.id} />
}
