import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/types/app.types'

/**
 * Data layer for the user-management screens (`app/(app)/usuarios`).
 *
 * Reads go straight to `profiles` through an untyped client (the generated
 * `Database` types collapse dynamic access to unusable unions — same reason as
 * `lib/records/data.ts`). The `profiles_admin_all` RLS policy already grants a
 * full SELECT to administrators, and these screens are admin-only.
 *
 * Writes never touch Supabase directly: they POST/PATCH the `app/api/usuarios`
 * Route Handlers, which use the service-role key + Auth Admin API.
 */

export const USERS_PAGE_SIZE = 20

function untyped(): SupabaseClient {
  return createClient() as unknown as SupabaseClient
}

/** Strip characters that would break a PostgREST `or` filter. */
function sanitize(term: string): string {
  return term
    .trim()
    .replace(/[%,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface UserFilters {
  search: string
  role?: UserRole
  status?: 'active' | 'inactive'
  page: number
}

export interface UserListItem {
  id: string
  fullName: string
  email: string | null
  role: string
  isActive: boolean
  badgeNumber: string | null
  unitId: string | null
  unitName: string | null
  createdAt: string | null
}

export interface UsersPage {
  items: UserListItem[]
  total: number
}

interface ProfileRow {
  id: string
  full_name: string
  email: string | null
  role: string
  is_active: boolean | null
  badge_number: string | null
  unit_id: string | null
  created_at: string | null
  units: { name: string | null } | { name: string | null }[] | null
}

const SELECT_COLUMNS =
  'id,full_name,email,role,is_active,badge_number,unit_id,created_at,units(name)'

function unitName(units: ProfileRow['units']): string | null {
  if (!units) return null
  if (Array.isArray(units)) return units[0]?.name ?? null
  return units.name ?? null
}

function rowToItem(row: ProfileRow): UserListItem {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    isActive: row.is_active ?? true,
    badgeNumber: row.badge_number,
    unitId: row.unit_id,
    unitName: unitName(row.units),
    createdAt: row.created_at,
  }
}

export async function listUsers(filters: UserFilters): Promise<UsersPage> {
  let query = untyped()
    .from('profiles')
    .select(SELECT_COLUMNS, { count: 'exact' })

  if (filters.role) query = query.eq('role', filters.role)
  if (filters.status) query = query.eq('is_active', filters.status === 'active')

  const term = sanitize(filters.search)
  if (term) {
    query = query.or(
      ['full_name', 'email', 'badge_number']
        .map((column) => `${column}.ilike.%${term}%`)
        .join(','),
    )
  }

  const start = (filters.page - 1) * USERS_PAGE_SIZE
  const { data, count, error } = await query
    .order('full_name', { ascending: true })
    .range(start, start + USERS_PAGE_SIZE - 1)

  if (error) throw new Error(error.message)

  return {
    items: ((data ?? []) as unknown as ProfileRow[]).map(rowToItem),
    total: count ?? 0,
  }
}

export async function getUserDetail(id: string): Promise<UserListItem | null> {
  const { data, error } = await untyped()
    .from('profiles')
    .select(SELECT_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data ? rowToItem(data as unknown as ProfileRow) : null
}

export interface UnitOption {
  id: string
  name: string
}

export async function listUnits(): Promise<UnitOption[]> {
  const { data, error } = await untyped()
    .from('units')
    .select('id,name')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as UnitOption[]
}

// ---------------------------------------------------------------------------
// Writes — via the Route Handlers
// ---------------------------------------------------------------------------
async function callApi<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    credentials: 'same-origin',
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error((body.error as string) || 'Não foi possível concluir a operação.')
  }
  return body as T
}

export interface CreateUserInput {
  full_name: string
  email: string
  password: string
  role: UserRole
  badge_number?: string | null
  unit_id?: string | null
}

export function createUser(input: CreateUserInput): Promise<{ id: string }> {
  return callApi('/api/usuarios', { method: 'POST', body: JSON.stringify(input) })
}

export interface UpdateUserInput {
  full_name?: string
  role?: UserRole
  badge_number?: string | null
  unit_id?: string | null
  is_active?: boolean
}

export function updateUser(id: string, input: UpdateUserInput): Promise<{ id: string }> {
  return callApi(`/api/usuarios/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function resetUserPassword(id: string): Promise<{ password: string }> {
  return callApi(`/api/usuarios/${id}/reset-password`, { method: 'POST' })
}
