'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/hooks/use-permissions'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { useCurrentUser, initials, roleLabel } from '@/hooks/use-current-user'
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

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
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
          className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-muted transition-colors hover:bg-red-950/40 hover:text-red-400"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sair
        </button>
      </div>
    </div>
  )
}
