'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Controller,
  useForm,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Copy, Loader2, RefreshCw, Save } from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import { useToast } from '@/hooks/use-toast'
import {
  createUser,
  listUnits,
  updateUser,
  type UnitOption,
  type UserListItem,
} from '@/lib/usuarios/data'
import {
  USER_ROLE_OPTIONS,
  emptyUserCreateForm,
  generateProvisionalPassword,
  userCreateSchema,
  userEditSchema,
  type UserCreateValues,
  type UserEditValues,
} from '@/lib/usuarios/form'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
} from '@/components/ui'

export interface FormUsuarioProps {
  mode: 'create' | 'edit'
  /** Required in edit mode. */
  userId?: string
  /** Pre-loaded row for edit mode (avoids a second fetch). */
  initialValues?: UserListItem
  onSaved?: (id: string) => void
  onCancel?: () => void
}

export function FormUsuario(props: FormUsuarioProps) {
  const [units, setUnits] = React.useState<UnitOption[]>([])

  React.useEffect(() => {
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]))
  }, [])

  return props.mode === 'create' ? (
    <CreateForm units={units} {...props} />
  ) : (
    <EditForm units={units} {...props} />
  )
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
function CreateForm({
  units,
  onSaved,
  onCancel,
}: FormUsuarioProps & { units: UnitOption[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [submitting, setSubmitting] = React.useState(false)
  const [created, setCreated] = React.useState<{ id: string; email: string; password: string } | null>(
    null,
  )

  const form = useForm<UserCreateValues>({
    resolver: zodResolver(userCreateSchema),
    defaultValues: emptyUserCreateForm(),
    mode: 'onBlur',
  })
  const { control, register, formState, handleSubmit, setValue } = form
  const errors = formState.errors

  const onSubmit = handleSubmit(
    async (values) => {
      setSubmitting(true)
      try {
        const { id } = await createUser({
          full_name: values.full_name,
          email: values.email,
          password: values.password,
          role: values.role,
          badge_number: values.badge_number || null,
          unit_id: values.unit_id || null,
        })
        setCreated({ id, email: values.email, password: values.password })
      } catch (error) {
        toast({
          title: 'Não foi possível criar o usuário',
          description: error instanceof Error ? error.message : 'Tente novamente.',
          variant: 'destructive',
        })
      } finally {
        setSubmitting(false)
      }
    },
    () =>
      toast({
        title: 'Revise o formulário',
        description: 'Há campos obrigatórios ou inválidos destacados em vermelho.',
        variant: 'destructive',
      }),
  )

  const handleCancel = () => (onCancel ? onCancel() : router.back())

  return (
    <div className="mx-auto max-w-2xl space-y-8 pb-28">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink">Novo usuário</h1>
        <p className="text-sm text-ink-secondary">
          O usuário entra com o e-mail e a senha provisória abaixo e pode trocá-la depois.
        </p>
      </header>

      <section className="space-y-4">
        <SectionTitle index={1}>Identificação</SectionTitle>

        <Field label="Nome completo" required error={errors.full_name?.message}>
          <Input placeholder="Nome completo" {...register('full_name')} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="E-mail" required error={errors.email?.message}>
            <Input type="email" inputMode="email" placeholder="pessoa@orgao.gov.br" {...register('email')} />
          </Field>
          <Field label="Matrícula" error={errors.badge_number?.message}>
            <Input placeholder="Opcional" {...register('badge_number')} />
          </Field>
        </div>

        <Field label="Senha provisória" required error={errors.password?.message}>
          <div className="flex gap-2">
            <Input
              type="text"
              autoComplete="off"
              placeholder="Mínimo de 8 caracteres"
              {...register('password')}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setValue('password', generateProvisionalPassword(), { shouldValidate: true })
              }
            >
              <RefreshCw className="h-4 w-4" />
              Gerar
            </Button>
          </div>
        </Field>
      </section>

      <Separator />

      <section className="space-y-4">
        <SectionTitle index={2}>Acesso</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Papel" required error={errors.role?.message}>
            <RoleSelect control={control} name="role" />
          </Field>
          <Field label="Unidade" error={errors.unit_id?.message}>
            <UnitSelect control={control} name="unit_id" units={units} />
          </Field>
        </div>
      </section>

      <StickyFooter
        submitting={submitting}
        label="Criar usuário"
        onCancel={handleCancel}
        onSubmit={onSubmit}
      />

      <Dialog open={created !== null} onOpenChange={() => undefined}>
        <DialogContent className="max-w-md" aria-describedby="created-user">
          <DialogHeader>
            <DialogTitle>Usuário criado</DialogTitle>
            <DialogDescription id="created-user">
              Anote e repasse a senha provisória — ela não será exibida de novo.
            </DialogDescription>
          </DialogHeader>
          {created && (
            <div className="space-y-3 text-sm">
              <CopyRow label="E-mail" value={created.email} />
              <CopyRow label="Senha provisória" value={created.password} mono />
            </div>
          )}
          <DialogFooter>
            <Button
              variant="primary"
              onClick={() => {
                if (!created) return
                if (onSaved) onSaved(created.id)
                else router.push(`/usuarios/${created.id}`)
              }}
            >
              Abrir usuário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------
function EditForm({
  units,
  userId,
  initialValues,
  onSaved,
  onCancel,
}: FormUsuarioProps & { units: UnitOption[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [submitting, setSubmitting] = React.useState(false)

  const form = useForm<UserEditValues>({
    resolver: zodResolver(userEditSchema),
    defaultValues: {
      full_name: initialValues?.fullName ?? '',
      role: (initialValues?.role as UserEditValues['role']) ?? 'agent',
      badge_number: initialValues?.badgeNumber ?? '',
      unit_id: initialValues?.unitId ?? '',
      is_active: initialValues?.isActive ?? true,
    },
    mode: 'onBlur',
  })
  const { control, register, formState, handleSubmit } = form
  const errors = formState.errors

  const onSubmit = handleSubmit(
    async (values) => {
      if (!userId) return
      setSubmitting(true)
      try {
        await updateUser(userId, {
          full_name: values.full_name,
          role: values.role,
          badge_number: values.badge_number || null,
          unit_id: values.unit_id || null,
          is_active: values.is_active,
        })
        toast({ title: 'Usuário atualizado' })
        if (onSaved) onSaved(userId)
        else router.refresh()
      } catch (error) {
        toast({
          title: 'Não foi possível salvar',
          description: error instanceof Error ? error.message : 'Tente novamente.',
          variant: 'destructive',
        })
      } finally {
        setSubmitting(false)
      }
    },
    () =>
      toast({
        title: 'Revise o formulário',
        description: 'Há campos inválidos destacados em vermelho.',
        variant: 'destructive',
      }),
  )

  const handleCancel = () => (onCancel ? onCancel() : router.back())

  return (
    <div className="mx-auto max-w-2xl space-y-8 pb-28">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink">Editar usuário</h1>
        {initialValues?.email && (
          <p className="text-sm text-ink-secondary">{initialValues.email}</p>
        )}
      </header>

      <section className="space-y-4">
        <SectionTitle index={1}>Identificação</SectionTitle>
        <Field label="Nome completo" required error={errors.full_name?.message}>
          <Input {...register('full_name')} />
        </Field>
        <Field label="Matrícula" error={errors.badge_number?.message} className="sm:max-w-xs">
          <Input placeholder="Opcional" {...register('badge_number')} />
        </Field>
      </section>

      <Separator />

      <section className="space-y-4">
        <SectionTitle index={2}>Acesso</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Papel" required error={errors.role?.message}>
            <RoleSelect control={control} name="role" />
          </Field>
          <Field label="Unidade" error={errors.unit_id?.message}>
            <UnitSelect control={control} name="unit_id" units={units} />
          </Field>
        </div>

        <Controller
          control={control}
          name="is_active"
          render={({ field }) => (
            <label className="flex items-center justify-between gap-4 rounded-input border border-content-border px-4 py-3">
              <span>
                <span className="block text-sm font-medium text-ink">Acesso ativo</span>
                <span className="block text-xs text-ink-secondary">
                  Ao desativar, o login é bloqueado até ser reativado.
                </span>
              </span>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </label>
          )}
        />
      </section>

      <StickyFooter
        submitting={submitting}
        label="Salvar alterações"
        onCancel={handleCancel}
        onSubmit={onSubmit}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared presentational helpers (mirrors components/meliantes/FormMeliante.tsx)
// ---------------------------------------------------------------------------
function SectionTitle({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
        {index}
      </span>
      <h2 className="text-lg font-semibold text-ink">{children}</h2>
    </div>
  )
}

function Field({
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label>
        {label}
        {required && <span className="text-danger"> *</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-secondary">{hint}</p>
      ) : null}
    </div>
  )
}

function RoleSelect<T extends FieldValues>({
  control,
  name,
}: {
  control: Control<T>
  name: FieldPath<T>
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select value={(field.value as string) || undefined} onValueChange={field.onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {USER_ROLE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  )
}

const NO_UNIT = '__none__'

function UnitSelect<T extends FieldValues>({
  control,
  name,
  units,
}: {
  control: Control<T>
  name: FieldPath<T>
  units: UnitOption[]
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select
          value={(field.value as string) || NO_UNIT}
          onValueChange={(value) => field.onChange(value === NO_UNIT ? '' : value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Sem unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_UNIT}>Sem unidade</SelectItem>
            {units.map((unit) => (
              <SelectItem key={unit.id} value={unit.id}>
                {unit.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  )
}

function StickyFooter({
  submitting,
  label,
  onCancel,
  onSubmit,
}: {
  submitting: boolean
  label: string
  onCancel: () => void
  onSubmit: () => void
}) {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-content-border bg-white/95 backdrop-blur lg:pl-sidebar">
      <div className="mx-auto flex max-w-2xl items-center justify-end gap-2 px-4 py-3">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="button" variant="primary" onClick={onSubmit} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {label}
        </Button>
      </div>
    </footer>
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
