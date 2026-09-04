import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { DetalheUsuario } from '@/components/usuarios/DetalheUsuario'

export const metadata = {
  title: 'Usuário · SIGOP',
}

export default function UsuarioDetalhePage({ params }: { params: { id: string } }) {
  return (
    <ProtectedRoute roles={['administrator']}>
      <DetalheUsuario id={params.id} />
    </ProtectedRoute>
  )
}
