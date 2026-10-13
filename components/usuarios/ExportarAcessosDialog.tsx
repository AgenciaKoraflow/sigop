'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@/components/ui'

/** Today as YYYY-MM-DD in the browser's local calendar (not UTC). */
function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

interface Props {
  open: boolean
  onClose: () => void
}

export function ExportarAcessosDialog({ open, onClose }: Props) {
  const { toast } = useToast()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [busy, setBusy] = useState(false)

  async function handleExport() {
    setBusy(true)
    try {
      const query = new URLSearchParams({ from, to })
      const res = await fetch(`/api/usuarios/export-acessos?${query}`, {
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || 'Não foi possível exportar os acessos.')
      }

      const total = Number(res.headers.get('X-Export-Total') ?? 0)
      const missing = Number(res.headers.get('X-Export-Without-Password') ?? 0)
      if (total === 0) {
        toast({ title: 'Nenhum acesso criado nesse período' })
        return
      }

      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `acessos_${from}_a_${to}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(href)

      toast({
        title: `${total} acesso${total === 1 ? '' : 's'} exportado${total === 1 ? '' : 's'}`,
        description:
          missing > 0
            ? `${missing} sem senha provisória (já trocaram a senha ou foram criados antes deste recurso).`
            : undefined,
      })
      onClose()
    } catch (error) {
      toast({
        title: 'Não foi possível exportar',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const invalid = !from || !to || to < from

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-md" aria-describedby="export-acessos">
        <DialogHeader>
          <DialogTitle>Exportar acessos</DialogTitle>
          <DialogDescription id="export-acessos">
            Planilha com link do sistema, login e senha provisória dos acessos criados no período.
            A senha só aparece enquanto o usuário não tiver trocado a senha no primeiro login.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm font-medium text-ink">
            Data inicial
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm font-medium text-ink">
            Data final
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleExport} disabled={busy || invalid}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download />}
            Exportar planilha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
