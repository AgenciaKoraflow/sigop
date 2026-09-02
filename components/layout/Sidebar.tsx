'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { signOut, forceSignOut } from '@/lib/supabase/auth'
import { clearOfflineData } from '@/lib/db'
import { usePermissions } from '@/hooks/use-permissions'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { useCurrentUser, initials, roleLabel } from '@/hooks/use-current-user'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { NAV_ITEMS, isNavItemActive } from './nav-items'

interface SidebarProps {
  /** Called after a nav link is tapped — used to close the mobile drawer. */
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { canViewDashboard } = usePermissions()
  const { stats } = useOnlineStatus()
  const { user } = useCurrentUser()

  const pendingCount = stats.pending + stats.errors + stats.photos

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      const { hasPendingItems } = await signOut()
      if (hasPendingItems) {
        setConfirmOpen(true)
        return
      }
      router.push('/login')
    } finally {
      setSigningOut(false)
    }
  }

  async function handleForceSignOut() {
    setSigningOut(true)
    try {
      await clearOfflineData()
      await forceSignOut()
      setConfirmOpen(false)
      router.push('/login')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-text">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
          SG
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold leading-tight text-white">SIGOP</p>
          <p className="text-nav-section uppercase text-sidebar-muted">
            Gestão de ocorrências
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <p className="px-3 pb-2 pt-3 text-nav-section uppercase text-sidebar-muted">
          Navegação
        </p>
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            if (item.supervisorOnly && !canViewDashboard) return null

            const active = isNavItemActive(pathname, item.href)
            const Icon = item.icon

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border-l-[3px] border-transparent px-4 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'border-l-brand bg-sidebar-active text-white'
                      : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-white',
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.showPendingBadge && pendingCount > 0 && (
                    <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-none text-white">
                      {pendingCount}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-white/5 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
            {initials(user?.fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">
              {user?.fullName ?? 'Não autenticado'}
            </p>
            <p className="truncate text-xs text-sidebar-muted">{roleLabel(user?.role)}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-muted transition-colors hover:bg-red-950/40 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {signingOut && !confirmOpen ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4 shrink-0" />
          )}
          Sair
        </button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => !signingOut && setConfirmOpen(open)}>
        <DialogContent className="max-w-md" aria-describedby="signout-warning">
          <DialogHeader>
            <DialogTitle>Sair com registros pendentes?</DialogTitle>
            <DialogDescription id="signout-warning">
              Você tem {pendingCount}{' '}
              {pendingCount === 1
                ? 'registro que ainda não foi enviado'
                : 'registros que ainda não foram enviados'}{' '}
              ao servidor. Se sair agora, {pendingCount === 1 ? 'ele será perdido' : 'eles serão perdidos'}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={signingOut}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleForceSignOut}
              disabled={signingOut}
            >
              {signingOut && <Loader2 className="h-4 w-4 animate-spin" />}
              Sair mesmo assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
