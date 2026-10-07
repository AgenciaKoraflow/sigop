'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, KeyRound, Loader2, Pencil, Power, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { useToast } from '@/hooks/use-toast'
import { useCurrentUser } from '@/hooks/use-current-user'
import {
  deleteUser,
  getUserDetail,
  updateUser,
  type UserListItem,
} from '@/lib/usuarios/data'
import { roleOptionLabel } from '@/lib/usuarios/form'
import { FormUsuario } from '@/components/usuarios/FormUsuario'
import { TrocarSenhaDialog } from '@/components/usuarios/TrocarSenhaDialog'
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

export function DetalheUsuario({
  id,
  startEditing = false,
}: {
  id: string
  startEditing?: boolean
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { user: currentUser } = useCurrentUser()

  const [detail, setDetail] = React.useState<UserListItem | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [notFound, setNotFound] = React.useState(false)
  const [editing, setEditing] = React.useState(startEditing)

  const [busy, setBusy] = React.useState(false)
  const [confirmToggle, setConfirmToggle] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [changingPassword, setChangingPassword] = React.useState(false)

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
      toast({ title: detail.isActive ? 'Usuário inativado' : 'Usuário ativado' })
      setConfirmToggle(false)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
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

  async function handleDelete() {
    setBusy(true)
    try {
      await deleteUser(id)
      toast({ title: 'Usuário excluído' })
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      router.push('/usuarios')
    } catch (error) {
      toast({
        title: 'Não foi possível excluir o usuário',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      })
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
          void queryClient.invalidateQueries({ queryKey: ['users'] })
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
            Você não pode inativar ou excluir a própria conta nem alterar o próprio papel.
          </p>
        )}
        <div className="flex gap-2 sm:flex-wrap">
          <Button variant="outline" onClick={() => setChangingPassword(true)} disabled={busy}>
            <KeyRound className="h-4 w-4" />
            Trocar senha
          </Button>
          <Button
            variant={detail.isActive ? 'destructive' : 'outline'}
            onClick={() => setConfirmToggle(true)}
            disabled={busy || isSelf}
            aria-label={detail.isActive ? 'Inativar' : 'Ativar'}
            title={detail.isActive ? 'Inativar' : 'Ativar'}
          >
            <Power className="h-4 w-4" />
            <span className="hidden sm:inline">{detail.isActive ? 'Inativar' : 'Ativar'}</span>
          </Button>
          <Button
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={busy || isSelf}
            aria-label="Excluir usuário"
            title="Excluir usuário"
          >
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline">Excluir usuário</span>
          </Button>
        </div>
      </section>

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onOpenChange={(open) => !busy && setConfirmDelete(open)}>
        <DialogContent className="max-w-md" aria-describedby="delete-user">
          <DialogHeader>
            <DialogTitle>Excluir este usuário?</DialogTitle>
            <DialogDescription id="delete-user">
              O login de {detail.fullName} será removido em definitivo e não poderá ser
              recuperado. Os registros criados por ele continuam no sistema.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toggle confirmation */}
      <Dialog open={confirmToggle} onOpenChange={(open) => !busy && setConfirmToggle(open)}>
        <DialogContent className="max-w-md" aria-describedby="toggle-user">
          <DialogHeader>
            <DialogTitle>
              {detail.isActive ? 'Inativar este usuário?' : 'Ativar este usuário?'}
            </DialogTitle>
            <DialogDescription id="toggle-user">
              {detail.isActive
                ? 'O login será bloqueado imediatamente até você ativar a conta de novo.'
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
              {detail.isActive ? 'Inativar' : 'Ativar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TrocarSenhaDialog
        user={changingPassword ? { id, fullName: detail.fullName } : null}
        onClose={() => setChangingPassword(false)}
      />
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
