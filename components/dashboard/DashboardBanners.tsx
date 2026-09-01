import { FlaskConical } from 'lucide-react'

/** Shown when the feed is served from the local cache (offline). */
export function OfflineBanner() {
  return (
    <div className="flex items-center gap-2 rounded-input border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
      <span className="text-sm leading-none">●</span>
      Exibindo dados salvos localmente — podem estar desatualizados
    </div>
  )
}

/** Shown when there are no records yet and the panel is rendering demo data. */
export function DemoBanner() {
  return (
    <div className="flex items-center gap-2 rounded-input border border-brand/20 bg-brand-light px-3 py-2 text-xs font-medium text-brand">
      <FlaskConical className="h-3.5 w-3.5 shrink-0" />
      Dados de demonstração — nenhum registro no banco ainda
    </div>
  )
}
