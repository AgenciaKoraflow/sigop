import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

/**
 * Data layer for the incident form's operational-geography selects
 * (`components/ocorrencias/FormOcorrencia.tsx`).
 *
 * Reads go through an untyped client — same reason as `lib/records/data.ts`:
 * the generated `Database` types collapse dynamic-table access to unusable
 * unions here. Both lookup tables are readable by any signed-in user
 * (`municipalities_select_all` / `territorial_areas_select_all` in sql/007).
 */

function untyped(): SupabaseClient {
  return createClient() as unknown as SupabaseClient
}

export interface MunicipalityOption {
  id: string
  name: string
  state: string | null
}

export interface TerritorialAreaOption {
  id: string
  name: string
  /** Parent municipality — the AT select is filtered by the chosen município. */
  municipalityId: string
}

interface MunicipalityRow {
  id: string
  name: string
  state: string | null
}

interface TerritorialAreaRow {
  id: string
  name: string
  municipality_id: string
}

export async function listMunicipalities(): Promise<MunicipalityOption[]> {
  const { data, error } = await untyped()
    .from('municipalities')
    .select('id,name,state')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as MunicipalityRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    state: row.state ?? null,
  }))
}

export async function listTerritorialAreas(): Promise<TerritorialAreaOption[]> {
  const { data, error } = await untyped()
    .from('territorial_areas')
    .select('id,name,municipality_id')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as TerritorialAreaRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    municipalityId: row.municipality_id,
  }))
}

/** Resolve a single municipality name (used by the detail screen). */
export async function getMunicipalityName(id: string): Promise<string | null> {
  const { data, error } = await untyped()
    .from('municipalities')
    .select('name')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as { name: string } | null)?.name ?? null
}

/** Resolve a single territorial-area name (used by the detail screen). */
export async function getTerritorialAreaName(id: string): Promise<string | null> {
  const { data, error } = await untyped()
    .from('territorial_areas')
    .select('name')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as { name: string } | null)?.name ?? null
}
