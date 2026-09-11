'use client'

import { useRouter } from 'next/navigation'
import { ChevronDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { INCIDENT_TYPE_OPTIONS } from '@/lib/ocorrencias/form'

/**
 * The single "open new record" entry point. Clicking it drops down every
 * record type, including "Abordagem" — just one more `incidents.type` value,
 * not a separate flow.
 */
export function QuickActions() {
  const router = useRouter()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary" size="lg" className="w-full justify-center sm:w-auto">
          <Plus />
          Abrir novo registro
          <ChevronDown className="opacity-80" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Tipo de registro</DropdownMenuLabel>
        {INCIDENT_TYPE_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => router.push(`/ocorrencias/nova?type=${option.value}`)}
          >
            <span className="mr-1">{option.emoji}</span>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
