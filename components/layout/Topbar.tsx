'use client'

import { Menu } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useCurrentUser, initials, roleLabel } from '@/hooks/use-current-user'
import { getSectionTitle } from './nav-items'

interface TopbarProps {
  /** Opens the mobile sidebar drawer. */
  onMenuClick: () => void
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const pathname = usePathname()
  const { user } = useCurrentUser()
  const title = getSectionTitle(pathname)

  return (
    <div className="flex h-full items-center gap-3 px-4">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Abrir menu"
        className="-ml-1 rounded-md p-2 text-ink-secondary transition-colors hover:bg-content-bg lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="h-6 w-px bg-content-border lg:hidden" />

      <h1 className="text-[15px] font-semibold text-ink">{title}</h1>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right leading-tight sm:block">
          <p className="text-sm font-medium text-ink">
            {user?.fullName ?? 'Não autenticado'}
          </p>
          <p className="text-xs text-ink-secondary">{roleLabel(user?.role)}</p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
          {initials(user?.fullName)}
        </div>
      </div>
    </div>
  )
}
