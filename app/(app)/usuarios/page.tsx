import { Suspense } from 'react'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { UsuariosTabs } from '@/components/usuarios/UsuariosTabs'

export const metadata = {
  title: 'Usuários · SIGOP',
}

export default function UsuariosPage() {
  return (
    <ProtectedRoute roles={['administrator']}>
      <Suspense fallback={null}>
        <UsuariosTabs />
      </Suspense>
    </ProtectedRoute>
  )
}
