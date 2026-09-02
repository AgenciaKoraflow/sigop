import { DetalheAbordagem } from '@/components/abordagens/DetalheAbordagem'

export default function StopDetailPage({ params }: { params: { id: string } }) {
  return <DetalheAbordagem stopId={params.id} />
}
