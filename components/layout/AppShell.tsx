'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { SyncIndicator } from '@/components/sync/sync-indicator'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

/**
 * SIGOP authenticated layout shell.
 *
 * Dark fixed sidebar (280px) + white fixed topbar (56px) + light grey content
 * area. Below `lg` the sidebar collapses into a drawer toggled from the topbar.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen bg-content-bg">
      {/* Desktop sidebar — fixed, full height */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-sidebar lg:block">
        <Sidebar />
      </aside>

      {/* Mobile sidebar — drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="w-sidebar border-0 bg-sidebar p-0 [&>button]:hidden"
        >
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Topbar — fixed, offset by the sidebar on desktop */}
      <header className="fixed inset-x-0 top-0 z-10 h-topbar border-b border-content-border bg-white lg:left-sidebar">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
      </header>

      {/* Content area */}
      <div className="lg:pl-sidebar">
        <div className="pt-topbar">
          <SyncIndicator />
          <main className="min-h-[calc(100vh-theme(spacing.topbar))] p-4 sm:p-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
