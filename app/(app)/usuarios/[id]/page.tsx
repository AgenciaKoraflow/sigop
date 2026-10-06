import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { DetalheUsuario } from '@/components/usuarios/DetalheUsuario'

export const metadata = {
  title: 'Usuário · SIGOP',
}

export default function UsuarioDetalhePage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { editar?: string }
}) {
  return (
    <ProtectedRoute roles={['administrator']}>
      <DetalheUsuario id={params.id} startEditing={searchParams.editar === '1'} />
    </ProtectedRoute>
  )
}
