export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          entity_id: string
          entity_type: string
          id: string
          new_data: Json | null
          new_version: number | null
          operation: string
          performed_at: string | null
          performed_by: string | null
          previous_data: Json | null
          previous_version: number | null
          source_ip: string | null
          user_agent: string | null
        }
        Insert: {
          entity_id: string
          entity_type: string
          id?: string
          new_data?: Json | null
          new_version?: number | null
          operation: string
          performed_at?: string | null
          performed_by?: string | null
          previous_data?: Json | null
          previous_version?: number | null
          source_ip?: string | null
          user_agent?: string | null
        }
        Update: {
          entity_id?: string
          entity_type?: string
          id?: string
          new_data?: Json | null
          new_version?: number | null
          operation?: string
          performed_at?: string | null
          performed_by?: string | null
          previous_data?: Json | null
          previous_version?: number | null
          source_ip?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_offenders: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          incident_id: string
          offender_id: string
          role: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          incident_id: string
          offender_id: string
          role?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          incident_id?: string
          offender_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_offenders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_offenders_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_offenders_offender_id_fkey"
            columns: ["offender_id"]
            isOneToOne: false
            referencedRelation: "offenders"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          address_city: string | null
          address_district: string | null
          address_number: string | null
          address_state: string | null
          address_street: string | null
          address_zip: string | null
          created_at: string | null
          created_by: string
          deleted_at: string | null
          description: string
          gmaps_link: string | null
          id: string
          internal_number: string | null
          latitude: number | null
          longitude: number | null
          occurred_at: string
          status: string
          subtype: string | null
          synced_at: string | null
          type: string
          unit_id: string | null
          updated_at: string | null
          updated_by: string | null
          version: number
        }
        Insert: {
          address_city?: string | null
          address_district?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          created_at?: string | null
          created_by: string
          deleted_at?: string | null
          description: string
          gmaps_link?: string | null
          id?: string
          internal_number?: string | null
          latitude?: number | null
          longitude?: number | null
          occurred_at: string
          status?: string
          subtype?: string | null
          synced_at?: string | null
          type: string
          unit_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number
        }
        Update: {
          address_city?: string | null
          address_district?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          created_at?: string | null
          created_by?: string
          deleted_at?: string | null
          description?: string
          gmaps_link?: string | null
          id?: string
          internal_number?: string | null
          latitude?: number | null
          longitude?: number | null
          occurred_at?: string
          status?: string
          subtype?: string | null
          synced_at?: string | null
          type?: string
          unit_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "incidents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offenders: {
        Row: {
          birth_date: string | null
          cpf: string | null
          created_at: string | null
          created_by: string
          deleted_at: string | null
          distinguishing_marks: string | null
          eye_color: string | null
          full_name: string | null
          gender: string | null
          hair_color: string | null
          height_m: number | null
          id: string
          main_photo_url: string | null
          nickname: string | null
          physical_description: string | null
          rg: string | null
          skin_color: string | null
          social_name: string | null
          updated_at: string | null
          updated_by: string | null
          version: number
          weight_kg: number | null
        }
        Insert: {
          birth_date?: string | null
          cpf?: string | null
          created_at?: string | null
          created_by: string
          deleted_at?: string | null
          distinguishing_marks?: string | null
          eye_color?: string | null
          full_name?: string | null
          gender?: string | null
          hair_color?: string | null
          height_m?: number | null
          id?: string
          main_photo_url?: string | null
          nickname?: string | null
          physical_description?: string | null
          rg?: string | null
          skin_color?: string | null
          social_name?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number
          weight_kg?: number | null
        }
        Update: {
          birth_date?: string | null
          cpf?: string | null
          created_at?: string | null
          created_by?: string
          deleted_at?: string | null
          distinguishing_marks?: string | null
          eye_color?: string | null
          full_name?: string | null
          gender?: string | null
          hair_color?: string | null
          height_m?: number | null
          id?: string
          main_photo_url?: string | null
          nickname?: string | null
          physical_description?: string | null
          rg?: string | null
          skin_color?: string | null
          social_name?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "offenders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offenders_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          entity_id: string
          entity_type: string
          id: string
          mime_type: string | null
          public_url: string | null
          size_bytes: number | null
          sort_order: number | null
          storage_path: string
          thumbnail_path: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          entity_id: string
          entity_type: string
          id?: string
          mime_type?: string | null
          public_url?: string | null
          size_bytes?: number | null
          sort_order?: number | null
          storage_path: string
          thumbnail_path?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          mime_type?: string | null
          public_url?: string | null
          size_bytes?: number | null
          sort_order?: number | null
          storage_path?: string
          thumbnail_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          badge_number: string | null
          created_at: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean | null
          photo_url: string | null
          role: string
          unit_id: string | null
          updated_at: string | null
        }
        Insert: {
          badge_number?: string | null
          created_at?: string | null
          email?: string | null
          full_name: string
          id: string
          is_active?: boolean | null
          photo_url?: string | null
          role?: string
          unit_id?: string | null
          updated_at?: string | null
        }
        Update: {
          badge_number?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          photo_url?: string | null
          role?: string
          unit_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      stop_offenders: {
        Row: {
          created_at: string | null
          id: string
          offender_id: string
          stop_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          offender_id: string
          stop_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          offender_id?: string
          stop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stop_offenders_offender_id_fkey"
            columns: ["offender_id"]
            isOneToOne: false
            referencedRelation: "offenders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stop_offenders_stop_id_fkey"
            columns: ["stop_id"]
            isOneToOne: false
            referencedRelation: "stops"
            referencedColumns: ["id"]
          },
        ]
      }
      stops: {
        Row: {
          address_city: string | null
          address_district: string | null
          address_street: string | null
          created_at: string | null
          created_by: string
          deleted_at: string | null
          description: string
          id: string
          incident_id: string | null
          latitude: number | null
          longitude: number | null
          notes: string | null
          outcome: string | null
          stopped_at: string
          type: string
          unit_id: string | null
          updated_at: string | null
          updated_by: string | null
          version: number
        }
        Insert: {
          address_city?: string | null
          address_district?: string | null
          address_street?: string | null
          created_at?: string | null
          created_by: string
          deleted_at?: string | null
          description: string
          id?: string
          incident_id?: string | null
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          outcome?: string | null
          stopped_at: string
          type: string
          unit_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number
        }
        Update: {
          address_city?: string | null
          address_district?: string | null
          address_street?: string | null
          created_at?: string | null
          created_by?: string
          deleted_at?: string | null
          description?: string
          id?: string
          incident_id?: string | null
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          outcome?: string | null
          stopped_at?: string
          type?: string
          unit_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "stops_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stops_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stops_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stops_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          code: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          code?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      dashboard_stats: {
        Args: { p_date_end?: string; p_date_start?: string; p_unit_id?: string }
        Returns: Json
      }
      my_role: { Args: never; Returns: string }
      my_unit: { Args: never; Returns: string }
      search_offenders: {
        Args: { term: string }
        Returns: {
          birth_date: string | null
          cpf: string | null
          created_at: string | null
          created_by: string
          deleted_at: string | null
          distinguishing_marks: string | null
          eye_color: string | null
          full_name: string | null
          gender: string | null
          hair_color: string | null
          height_m: number | null
          id: string
          main_photo_url: string | null
          nickname: string | null
          physical_description: string | null
          rg: string | null
          skin_color: string | null
          social_name: string | null
          updated_at: string | null
          updated_by: string | null
          version: number
          weight_kg: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "offenders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
