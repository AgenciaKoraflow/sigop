'use client'

import { useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useCurrentUser } from '@/hooks/use-current-user'
import type { UserRole } from '@/types/app.types'

interface ProtectedRouteProps {
  /** Roles allowed to see the wrapped content. */
  roles: UserRole[]
  /** Where to send a signed-in user who lacks one of `roles`. Defaults to `/`. */
  redirectTo?: string
  children: ReactNode
}

/**
 * Client-side role gate. The middleware already blocks unauthenticated access;
 * this guards individual screens that only some roles may open (e.g. the
 * operational dashboard). While the profile is loading it renders a spinner to
 * avoid flashing the content before the role is known.
 */
export function ProtectedRoute({ roles, redirectTo = '/', children }: ProtectedRouteProps) {
  const router = useRouter()
  const { user, loading } = useCurrentUser()

  const allowed = !loading && user !== null && roles.includes(user.role)

  useEffect(() => {
    if (loading) return
    if (user === null) {
      router.replace('/login')
      return
    }
    if (!roles.includes(user.role)) {
      router.replace(redirectTo)
    }
  }, [loading, user, roles, redirectTo, router])

  if (!allowed) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-ink-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}
