'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { resetUserPassword } from '@/lib/usuarios/data'
import { USER_PASSWORD_MIN, generateProvisionalPassword } from '@/lib/usuarios/form'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@/components/ui'

interface Props {
  /** User whose password is being changed; `null` keeps the dialog closed. */
  user: { id: string; fullName: string } | null
  onClose: () => void
}

/**
 * Admin-driven password change: type a new password (or generate one), then
 * the dialog shows it once so it can be handed over to the user.
 */
export function TrocarSenhaDialog({ user, onClose }: Props) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [password, setPassword] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [saved, setSaved] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  const userId = user?.id
  React.useEffect(() => {
    if (!userId) return
    setPassword(generateProvisionalPassword())
    setSaved(null)
    setCopied(false)
  }, [userId])

  const tooShort = password.length < USER_PASSWORD_MIN

  async function handleSave() {
    if (!user || tooShort) return
    setBusy(true)
    try {
      const result = await resetUserPassword(user.id, password)
      setSaved(result.password)
      void queryClient.invalidateQueries({ queryKey: ['users', 'stats'] })
    } catch (error) {
      toast({
        title: 'Não foi possível trocar a senha',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-md" aria-describedby="change-password">
        <DialogHeader>
          <DialogTitle>{saved ? 'Senha alterada' : 'Trocar senha'}</DialogTitle>
          <DialogDescription id="change-password">
            {saved
              ? 'Repasse ao usuário — ela não será exibida novamente. A senha anterior deixou de valer.'
              : `Defina a nova senha de ${user?.fullName ?? 'usuário'}. A senha atual deixa de valer imediatamente.`}
          </DialogDescription>
        </DialogHeader>

        {saved ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-input border border-content-border bg-content-bg px-3 py-2 font-mono text-sm">
              {saved}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(saved)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="new-user-password">Nova senha</Label>
            <div className="flex gap-2">
              <Input
                id="new-user-password"
                type="text"
                autoComplete="off"
                maxLength={72}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={`Mínimo de ${USER_PASSWORD_MIN} caracteres`}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setPassword(generateProvisionalPassword())}
                disabled={busy}
              >
                <RefreshCw className="h-4 w-4" />
                Gerar
              </Button>
            </div>
            {tooShort && (
              <p className="text-xs font-medium text-danger">
                A senha precisa de ao menos {USER_PASSWORD_MIN} caracteres.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {saved ? (
            <Button variant="primary" onClick={onClose}>
              Fechar
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={handleSave} disabled={busy || tooShort}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Trocar senha
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
