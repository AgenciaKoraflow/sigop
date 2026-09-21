'use client'

import * as React from 'react'
import { FileDown, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { usePermissions } from '@/hooks/use-permissions'
import { ReportForbiddenError } from '@/lib/ocorrencias/relatorio'

interface Props {
  incidentId: string
}

/** Admin-only "Exportar PDF" action for the incident detail screen. */
export function ExportarRelatorioButton({ incidentId }: Props) {
  const { toast } = useToast()
  const perms = usePermissions()
  const [busy, setBusy] = React.useState(false)

  if (!perms.isAdmin) return null

  async function handleExport() {
    if (busy) return
    setBusy(true)
    try {
      // Heavy deps are only fetched when the admin actually exports.
      const [{ loadIncidentReport }, { pdf }, { RelatorioOcorrenciaPdf }] = await Promise.all([
        import('@/lib/ocorrencias/relatorio'),
        import('@react-pdf/renderer'),
        import('@/components/ocorrencias/relatorio/RelatorioOcorrenciaPdf'),
      ])

      const report = await loadIncidentReport(incidentId)
      const blob = await pdf(<RelatorioOcorrenciaPdf report={report} />).toBlob()

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `relatorio-${report.internalNumber}-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)

      toast({ title: 'Relatório gerado', description: 'O PDF foi baixado.' })
    } catch (error) {
      toast({
        title:
          error instanceof ReportForbiddenError
            ? 'Sem permissão para exportar'
            : 'Não foi possível gerar o relatório',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void handleExport()} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
      {busy ? 'Gerando…' : 'Exportar PDF'}
    </Button>
  )
}
