'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeft, Check, Copy, KeyRound, Loader2, Pencil, Power } from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { useToast } from '@/hooks/use-toast'
import { useCurrentUser } from '@/hooks/use-current-user'
import {
  getUserDetail,
  resetUserPassword,
  updateUser,
  type UserListItem,
} from '@/lib/usuarios/data'
import { roleOptionLabel } from '@/lib/usuarios/form'
import { FormUsuario } from '@/components/usuarios/FormUsuario'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Separator,
} from '@/components/ui'

function fmtDay(iso: string | null): string {
  if (!iso) return '—'
  try {
    return format(new Date(iso), 'dd/MM/yyyy', { locale: ptBR })
  } catch {
    return '—'
  }
}

export function DetalheUsuario({ id }: { id: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const { user: currentUser } = useCurrentUser()

  const [detail, setDetail] = React.useState<UserListItem | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [notFound, setNotFound] = React.useState(false)
  const [editing, setEditing] = React.useState(false)

  const [busy, setBusy] = React.useState(false)
  const [confirmToggle, setConfirmToggle] = React.useState(false)
  const [newPassword, setNewPassword] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await getUserDetail(id)
      if (!result) {
        setNotFound(true)
        return
      }
      setDetail(result)
      setNotFound(false)
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  React.useEffect(() => {
    void load()
  }, [load])

  const isSelf = currentUser?.id === id

  async function handleToggleActive() {
    if (!detail) return
    setBusy(true)
    try {
      await updateUser(id, { is_active: !detail.isActive })
      toast({ title: detail.isActive ? 'Usuário desativado' : 'Usuário reativado' })
      setConfirmToggle(false)
      await load()
    } catch (error) {
      toast({
        title: 'Não foi possível alterar o acesso',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleResetPassword() {
    setBusy(true)
    try {
      const { password } = await resetUserPassword(id)
      setNewPassword(password)
    } catch (error) {
      toast({
        title: 'Não foi possível resetar a senha',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-2xl items-center justify-center py-20 text-ink-secondary">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando usuário…
      </div>
    )
  }

  if (notFound || !detail) {
    return (
      <div className="mx-auto max-w-2xl rounded-card border border-content-border bg-white p-8 text-center">
        <p className="text-lg font-semibold text-ink">Usuário não encontrado</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/usuarios')}>
          Voltar para a lista
        </Button>
      </div>
    )
  }

  if (editing) {
    return (
      <FormUsuario
        mode="edit"
        userId={id}
        initialValues={detail}
        onSaved={() => {
          setEditing(false)
          void load()
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 pb-12">
      <Link
        href="/usuarios"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-secondary transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Usuários
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-ink">{detail.fullName}</h1>
            <Badge variant={detail.isActive ? 'synced' : 'error'}>
              {detail.isActive ? 'Ativo' : 'Inativo'}
            </Badge>
          </div>
          <p className="text-sm text-ink-secondary">{detail.email ?? '—'}</p>
        </div>

        <Button variant="primary" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" />
          Editar
        </Button>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Dados</h2>
        <dl className="grid gap-x-6 gap-y-3 rounded-card border border-content-border bg-white p-4 sm:grid-cols-2">
          <Detail label="Papel" value={roleOptionLabel(detail.role)} />
          <Detail label="Unidade" value={detail.unitName} />
          <Detail label="Matrícula" value={detail.badgeNumber} mono />
          <Detail label="Criado em" value={fmtDay(detail.createdAt)} />
        </dl>
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">Ações</h2>
        {isSelf && (
          <p className="rounded-input border border-sync-pending-text/20 bg-sync-pending-bg px-3 py-2 text-xs font-medium text-sync-pending-text">
            Você não pode desativar a própria conta nem alterar o próprio papel.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleResetPassword} disabled={busy}>
            <KeyRound className="h-4 w-4" />
            Resetar senha
          </Button>
          <Button
            variant={detail.isActive ? 'destructive' : 'outline'}
            onClick={() => setConfirmToggle(true)}
            disabled={busy || isSelf}
          >
            <Power className="h-4 w-4" />
            {detail.isActive ? 'Desativar acesso' : 'Reativar acesso'}
          </Button>
        </div>
      </section>

      {/* Toggle confirmation */}
      <Dialog open={confirmToggle} onOpenChange={(open) => !busy && setConfirmToggle(open)}>
        <DialogContent className="max-w-md" aria-describedby="toggle-user">
          <DialogHeader>
            <DialogTitle>
              {detail.isActive ? 'Desativar este usuário?' : 'Reativar este usuário?'}
            </DialogTitle>
            <DialogDescription id="toggle-user">
              {detail.isActive
                ? 'O login será bloqueado imediatamente até você reativar a conta.'
                : 'O usuário volta a poder entrar com a senha atual.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmToggle(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              variant={detail.isActive ? 'destructive' : 'primary'}
              onClick={handleToggleActive}
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {detail.isActive ? 'Desativar' : 'Reativar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New password reveal */}
      <Dialog open={newPassword !== null} onOpenChange={() => setNewPassword(null)}>
        <DialogContent className="max-w-md" aria-describedby="new-password">
          <DialogHeader>
            <DialogTitle>Nova senha provisória</DialogTitle>
            <DialogDescription id="new-password">
              Repasse ao usuário — ela não será exibida novamente. A senha anterior deixou de valer.
            </DialogDescription>
          </DialogHeader>
          {newPassword && <CopyRow label="Senha" value={newPassword} mono />}
          <DialogFooter>
            <Button variant="primary" onClick={() => setNewPassword(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd
        className={cn('mt-0.5 text-sm text-ink', !value && 'text-ink-muted', mono && value && 'font-mono')}
      >
        {value || '—'}
      </dd>
    </div>
  )
}

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <div className="flex items-center gap-2">
        <code
          className={cn(
            'flex-1 rounded-input border border-content-border bg-content-bg px-3 py-2 text-sm',
            mono && 'font-mono',
          )}
        >
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
