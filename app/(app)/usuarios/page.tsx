import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { UsuariosListView } from '@/components/usuarios/UsuariosListView'

export const metadata = {
  title: 'Usuários · SIGOP',
}

export default function UsuariosPage() {
  return (
    <ProtectedRoute roles={['administrator']}>
      <UsuariosListView />
    </ProtectedRoute>
  )
}
