import type { Tables, TablesInsert, TablesUpdate } from './database.types'

// Row/Insert/Update aliases for the generated Supabase schema types.
export type Unit = Tables<'units'>
export type Municipality = Tables<'municipalities'>
export type TerritorialArea = Tables<'territorial_areas'>
export type Profile = Tables<'profiles'>
export type Incident = Tables<'incidents'>
export type Offender = Tables<'offenders'>
export type Photo = Tables<'photos'>
export type IncidentOffender = Tables<'incident_offenders'>
export type AuditLog = Tables<'audit_log'>

export type IncidentInsert = TablesInsert<'incidents'>
export type IncidentUpdate = TablesUpdate<'incidents'>
export type OffenderInsert = TablesInsert<'offenders'>
export type OffenderUpdate = TablesUpdate<'offenders'>

export type SyncStatus = 'draft' | 'pending' | 'syncing' | 'synced' | 'error' | 'conflict'
export type EntityType = 'incident' | 'offender' | 'link' | 'photo'
export type Operation = 'create' | 'update' | 'delete' | 'upload'
export type UserRole = 'agent' | 'supervisor' | 'administrator'
export type IncidentType =
  | 'theft'
  | 'robbery'
  | 'vandalism'
  | 'in_flagrante'
  | 'suspicious'
  | 'other'
  | 'stop'
