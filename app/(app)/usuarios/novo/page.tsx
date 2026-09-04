import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { FormUsuario } from '@/components/usuarios/FormUsuario'

export const metadata = {
  title: 'Novo usuário · SIGOP',
}

export default function NovoUsuarioPage() {
  return (
    <ProtectedRoute roles={['administrator']}>
      <FormUsuario mode="create" />
    </ProtectedRoute>
  )
}
