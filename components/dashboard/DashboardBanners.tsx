import { FlaskConical } from 'lucide-react'

/** Shown when there are no records yet and the panel is rendering demo data. */
export function DemoBanner() {
  return (
    <div className="flex items-center gap-2 rounded-input border border-brand/20 bg-brand-light px-3 py-2 text-xs font-medium text-brand">
      <FlaskConical className="h-3.5 w-3.5 shrink-0" />
      Dados de demonstração — nenhum registro no banco ainda
    </div>
  )
}
