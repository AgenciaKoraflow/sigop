'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Search } from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { useUsers } from '@/hooks/use-users'
import { USERS_PAGE_SIZE, type UserFilters } from '@/lib/usuarios/data'
import { USER_ROLE_OPTIONS, roleOptionLabel } from '@/lib/usuarios/form'
import type { UserRole } from '@/types/app.types'
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui'

const ALL = '__all__'

const DEFAULT_FILTERS: UserFilters = {
  search: '',
  role: undefined,
  status: undefined,
  page: 1,
}

export function UsuariosListView() {
  const router = useRouter()
  const [filters, setFilters] = useState<UserFilters>(DEFAULT_FILTERS)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((current) =>
        current.search === search ? current : { ...current, search, page: 1 },
      )
    }, 300)
    return () => clearTimeout(id)
  }, [search])

  const { data, isLoading, isFetching, isError } = useUsers(filters)

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE))
  const items = data?.items ?? []

  const patch = (next: Partial<UserFilters>) =>
    setFilters((current) => ({ ...current, ...next, page: next.page ?? 1 }))

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-ink">
          Usuários <span className="font-semibold text-ink-muted">({total})</span>
        </h1>
        <Button asChild variant="primary" size="lg" className="w-full justify-center sm:w-auto">
          <Link href="/usuarios/novo">
            <Plus />
            Novo usuário
          </Link>
        </Button>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome, e-mail ou matrícula…"
            className="pl-9"
          />
        </div>

        <Select
          value={filters.role ?? ALL}
          onValueChange={(value) =>
            patch({ role: value === ALL ? undefined : (value as UserRole) })
          }
        >
          <SelectTrigger className="sm:w-44">
            <SelectValue placeholder="Papel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os papéis</SelectItem>
            {USER_ROLE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.status ?? ALL}
          onValueChange={(value) =>
            patch({ status: value === ALL ? undefined : (value as 'active' | 'inactive') })
          }
        >
          <SelectTrigger className="sm:w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="inactive">Inativos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isError && (
        <p className="rounded-input border border-danger/20 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
          Não foi possível carregar os usuários. Tente novamente em instantes.
        </p>
      )}

      <div className="overflow-x-auto rounded-card border border-content-border bg-content-surface shadow-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs">Nome</TableHead>
              <TableHead className="text-xs">E-mail</TableHead>
              <TableHead className="text-xs">Papel</TableHead>
              <TableHead className="text-xs">Unidade</TableHead>
              <TableHead className="text-xs">Matrícula</TableHead>
              <TableHead className="text-xs">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, index) => (
                <TableRow key={index} className="hover:bg-transparent">
                  {Array.from({ length: 6 }).map((__, cell) => (
                    <TableCell key={cell}>
                      <Skeleton className="h-4 w-full max-w-[140px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-16 text-center text-sm text-ink-secondary">
                  Nenhum usuário encontrado.
                </TableCell>
              </TableRow>
            ) : (
              items.map((user) => (
                <TableRow
                  key={user.id}
                  onClick={() => router.push(`/usuarios/${user.id}`)}
                  className={cn('cursor-pointer', !user.isActive && 'opacity-60')}
                >
                  <TableCell className="font-medium text-ink">
                    <Link
                      href={`/usuarios/${user.id}`}
                      onClick={(event) => event.stopPropagation()}
                      className="hover:underline"
                    >
                      {user.fullName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-ink-secondary">{user.email ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{roleOptionLabel(user.role)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-ink-secondary">
                    {user.unitName ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-ink-secondary">
                    {user.badgeNumber ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? 'synced' : 'error'}>
                      {user.isActive ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!isLoading && items.length > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm text-ink-secondary">
          <span>
            Página {filters.page} de {totalPages}
            {isFetching && <span className="ml-2 text-ink-muted">atualizando…</span>}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page <= 1}
              onClick={() => patch({ page: filters.page - 1 })}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page >= totalPages}
              onClick={() => patch({ page: filters.page + 1 })}
            >
              Próximo
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
