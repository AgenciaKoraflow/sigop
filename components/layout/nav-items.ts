import {
  BarChart2,
  CloudOff,
  FileText,
  LayoutDashboard,
  UserCheck,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react'

/**
 * Primary navigation for the authenticated shell. Shared by the sidebar (to
 * render the menu) and the topbar (to resolve the current section title).
 *
 * `label` values are user-facing copy and stay in Portuguese.
 */
export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  /** Only visible to supervisor / administrator roles. */
  supervisorOnly?: boolean
  /** Only visible to the administrator role. */
  adminOnly?: boolean
  /** Render the pending-count badge next to this item. */
  showPendingBadge?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Ocorrências', href: '/ocorrencias', icon: FileText },
  { label: 'Abordagens', href: '/abordagens', icon: UserCheck },
  { label: 'Meliantes', href: '/meliantes', icon: Users },
  { label: 'Pendentes', href: '/pendentes', icon: CloudOff, showPendingBadge: true },
  { label: 'Painel', href: '/dashboard', icon: BarChart2, supervisorOnly: true },
  { label: 'Usuários', href: '/usuarios', icon: UserCog, adminOnly: true },
]

/** Whether a nav item should render as active for the given pathname. */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Section title for the topbar, derived from the current route. */
export function getSectionTitle(pathname: string): string {
  const match = NAV_ITEMS.filter((item) => item.href !== '/').find((item) =>
    isNavItemActive(pathname, item.href),
  )
  return match?.label ?? 'Dashboard'
}
