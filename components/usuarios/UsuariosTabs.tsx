'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BarChart3, Users } from 'lucide-react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui'
import { UsuariosListView } from '@/components/usuarios/UsuariosListView'
import { UsuariosDashboard } from '@/components/usuarios/UsuariosDashboard'

const TABS = ['cadastro', 'dashboard'] as const
type TabKey = (typeof TABS)[number]

/** `/usuarios` split in "Cadastro" (list + CRUD) and "Dashboard" (metrics). */
export function UsuariosTabs() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const param = searchParams.get('aba')
  const tab: TabKey = TABS.includes(param as TabKey) ? (param as TabKey) : 'cadastro'

  const handleChange = (value: string) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value === 'cadastro') next.delete('aba')
    else next.set('aba', value)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <Tabs value={tab} onValueChange={handleChange} className="mx-auto max-w-6xl space-y-5">
      <TabsList>
        <TabsTrigger value="cadastro" className="gap-2">
          <Users className="h-4 w-4" />
          Cadastro de usuários
        </TabsTrigger>
        <TabsTrigger value="dashboard" className="gap-2">
          <BarChart3 className="h-4 w-4" />
          Dashboard
        </TabsTrigger>
      </TabsList>

      <TabsContent value="cadastro" className="mt-0">
        <UsuariosListView />
      </TabsContent>
      <TabsContent value="dashboard" className="mt-0">
        <UsuariosDashboard />
      </TabsContent>
    </Tabs>
  )
}
