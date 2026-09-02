import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { OperationalDashboard } from '@/components/dashboard/OperationalDashboard'

export const metadata = {
  title: 'Dashboard operacional · SIGOP',
}

export default function DashboardPage() {
  return (
    <ProtectedRoute roles={['supervisor', 'administrator']}>
      <OperationalDashboard />
    </ProtectedRoute>
  )
}
