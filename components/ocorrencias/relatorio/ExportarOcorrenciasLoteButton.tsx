'use client'

import * as React from 'react'
import { format, startOfMonth } from 'date-fns'
import { FileDown, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { usePermissions } from '@/hooks/use-permissions'
import { RECORD_CONFIG } from '@/lib/records/config'

/** Sentinel for the "all types" option (Radix forbids an empty item value). */
const ALL = '__all__'

const DATE_INPUT_FORMAT = 'yyyy-MM-dd'

/**
 * Admin-only "Exportar em massa" action for the incidents listing: asks for a
 * period and a type, then downloads one PDF with every matching incident.
 */
export function ExportarOcorrenciasLoteButton({ className }: { className?: string }) {
  const { toast } = useToast()
  const perms = usePermissions()

  const [open, setOpen] = React.useState(false)
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [type, setType] = React.useState(ALL)
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState<{
    done: number
    total: number
  } | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  if (!perms.isAdmin) return null

  function handleOpenChange(next: boolean) {
    if (busy) return
    if (next) {
      // Default to the current month so the common case is one click.
      const today = new Date()
      setFrom(format(startOfMonth(today), DATE_INPUT_FORMAT))
      setTo(format(today, DATE_INPUT_FORMAT))
      setType(ALL)
      setError(null)
    }
    setOpen(next)
  }

  async function handleExport(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!from || !to) {
      setError('Informe a data inicial e a data final.')
      return
    }
    if (from > to) {
      setError('A data inicial não pode ser posterior à data final.')
      return
    }

    setBusy(true)
    setError(null)
    setProgress(null)
    try {
      // Heavy deps are only fetched when the admin actually exports.
      const [{ loadBulkIncidentReport }, { pdf }, { RelatorioOcorrenciasLotePdf }] =
        await Promise.all([
          import('@/lib/ocorrencias/relatorio'),
          import('@react-pdf/renderer'),
          import('@/components/ocorrencias/relatorio/RelatorioOcorrenciaPdf'),
        ])

      const bulk = await loadBulkIncidentReport(
        { from, to, type: type === ALL ? undefined : type },
        (done, total) => setProgress({ done, total }),
      )
      const blob = await pdf(<RelatorioOcorrenciasLotePdf bulk={bulk} />).toBlob()

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `relatorio-ocorrencias-${from}_a_${to}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)

      toast({
        title: 'Relatório gerado',
        description: `O PDF com ${bulk.reports.length} ocorrência(s) foi baixado.`,
      })
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível gerar o relatório.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const busyLabel = !progress
    ? 'Buscando ocorrências…'
    : progress.done < progress.total
      ? `Preparando ${progress.done} de ${progress.total}…`
      : 'Montando PDF…'

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className={className}
        onClick={() => handleOpenChange(true)}
      >
        <FileDown />
        Exportar em massa
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <form onSubmit={(event) => void handleExport(event)} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Exportar ocorrências em PDF</DialogTitle>
              <DialogDescription>
                Gera um único PDF com todas as ocorrências do período e do tipo selecionados.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bulk-export-from">Data inicial</Label>
                <Input
                  id="bulk-export-from"
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(event) => setFrom(event.target.value)}
                  disabled={busy}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bulk-export-to">Data final</Label>
                <Input
                  id="bulk-export-to"
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(event) => setTo(event.target.value)}
                  disabled={busy}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bulk-export-type">Tipo</Label>
              <Select value={type} onValueChange={setType} disabled={busy}>
                <SelectTrigger id="bulk-export-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos</SelectItem>
                  {RECORD_CONFIG.typeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error && (
              <p className="rounded-input border border-danger/20 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
                {error}
              </p>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={busy}
              >
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <FileDown />}
                {busy ? busyLabel : 'Exportar PDF'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
