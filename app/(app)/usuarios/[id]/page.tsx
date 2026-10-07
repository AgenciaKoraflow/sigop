import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { DetalheUsuario } from '@/components/usuarios/DetalheUsuario'

export const metadata = {
  title: 'Usuário · SIGOP',
}

export default async function UsuarioDetalhePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ editar?: string }>
}) {
  const { id } = await params
  const { editar } = await searchParams
  return (
    <ProtectedRoute roles={['administrator']}>
      <DetalheUsuario id={id} startEditing={editar === '1'} />
    </ProtectedRoute>
  )
}
