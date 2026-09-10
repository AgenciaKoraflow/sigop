'use client'

import { useRouter } from 'next/navigation'
import { ChevronDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { INCIDENT_TYPE_OPTIONS } from '@/lib/ocorrencias/form'

/**
 * The single "open new record" entry point at the top of the operational
 * panel. Clicking it drops down every record type — the incident types plus
 * "Abordagem" — instead of splitting into separate incident/stop buttons.
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
        <DropdownMenuLabel>Ocorrência</DropdownMenuLabel>
        {INCIDENT_TYPE_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => router.push(`/ocorrencias/nova?type=${option.value}`)}
          >
            <span className="mr-1">{option.emoji}</span>
            {option.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/abordagens/nova')}>
          <span className="mr-1">🧍</span>
          Abordagem
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
