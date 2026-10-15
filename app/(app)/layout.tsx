import type { ReactNode } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { TourProvider } from '@/components/tour/TourProvider'

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <TourProvider>
      <AppShell>{children}</AppShell>
    </TourProvider>
  )
}
