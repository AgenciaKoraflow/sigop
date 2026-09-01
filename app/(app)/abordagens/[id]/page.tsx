import { FormAbordagem } from '@/components/abordagens/FormAbordagem'

export default function EditStopPage({ params }: { params: { id: string } }) {
  return <FormAbordagem mode="edit" stopId={params.id} />
}
