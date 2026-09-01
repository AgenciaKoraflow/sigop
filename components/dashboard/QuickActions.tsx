import Link from 'next/link'
import { Plus, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** The two quick-action buttons at the top of the operational panel. */
export function QuickActions() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button asChild variant="primary" size="lg" className="w-full justify-center sm:w-auto">
        <Link href="/ocorrencias/nova">
          <Plus />
          Nova Ocorrência
        </Link>
      </Button>
      <Button asChild variant="outline" size="lg" className="w-full justify-center sm:w-auto">
        <Link href="/abordagens/nova">
          <UserPlus />
          Nova Abordagem
        </Link>
      </Button>
    </div>
  )
}
