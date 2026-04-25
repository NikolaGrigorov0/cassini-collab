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
      crop_growth_log: {
        Row: {
          created_at: string
          date: string
          gdd_cumulative: number | null
          id: string
          kc_adjusted: number | null
          ndvi_value: number | null
          notes: string | null
          parcel_id: string
          phase_id: string | null
        }
        Insert: {
          created_at?: string
          date?: string
          gdd_cumulative?: number | null
          id?: string
          kc_adjusted?: number | null
          ndvi_value?: number | null
          notes?: string | null
          parcel_id: string
          phase_id?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          gdd_cumulative?: number | null
          id?: string
          kc_adjusted?: number | null
          ndvi_value?: number | null
          notes?: string | null
          parcel_id?: string
          phase_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crop_growth_log_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phenophases"
            referencedColumns: ["id"]
          },
        ]
      }
      deficit_schedules: {
        Row: {
          created_at: string | null
          crop_stress_risk: string | null
          deficit_period_id: string
          dose_mm: number
          id: string
          parcel_id: string
          priority: string | null
          scheduled_date: string
        }
        Insert: {
          created_at?: string | null
          crop_stress_risk?: string | null
          deficit_period_id: string
          dose_mm: number
          id?: string
          parcel_id: string
          priority?: string | null
          scheduled_date: string
        }
        Update: {
          created_at?: string | null
          crop_stress_risk?: string | null
          deficit_period_id?: string
          dose_mm?: number
          id?: string
          parcel_id?: string
          priority?: string | null
          scheduled_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "deficit_schedules_deficit_period_id_fkey"
            columns: ["deficit_period_id"]
            isOneToOne: false
            referencedRelation: "water_deficit_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deficit_schedules_parcel_id_fkey"
            columns: ["parcel_id"]
            isOneToOne: false
            referencedRelation: "parcels"
            referencedColumns: ["id"]
          },
        ]
      }
      irrigation_events: {
        Row: {
          amount_mm: number
          created_at: string
          date: string
          id: string
          method: string
          notes: string | null
          parcel_id: string
          soil_moisture_after: number | null
        }
        Insert: {
          amount_mm: number
          created_at?: string
          date?: string
          id?: string
          method?: string
          notes?: string | null
          parcel_id: string
          soil_moisture_after?: number | null
        }
        Update: {
          amount_mm?: number
          created_at?: string
          date?: string
          id?: string
          method?: string
          notes?: string | null
          parcel_id?: string
          soil_moisture_after?: number | null
        }
        Relationships: []
      }
      irrigation_recommendations: {
        Row: {
          confidence_pct: number | null
          created_at: string
          data_source: string | null
          dose_mm: number
          forecast_json: Json | null
          id: string
          parcel_id: string
          reason: string
          status: string
          valid_until: string
        }
        Insert: {
          confidence_pct?: number | null
          created_at?: string
          data_source?: string | null
          dose_mm: number
          forecast_json?: Json | null
          id?: string
          parcel_id: string
          reason: string
          status: string
          valid_until: string
        }
        Update: {
          confidence_pct?: number | null
          created_at?: string
          data_source?: string | null
          dose_mm?: number
          forecast_json?: Json | null
          id?: string
          parcel_id?: string
          reason?: string
          status?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "irrigation_recommendations_parcel_id_fkey"
            columns: ["parcel_id"]
            isOneToOne: false
            referencedRelation: "parcels"
            referencedColumns: ["id"]
          },
        ]
      }
      ndmi_readings: {
        Row: {
          cloud_coverage: number | null
          confidence_pct: number | null
          data_source: string | null
          eto_value: number | null
          id: string
          ndmi_value: number
          ndvi_value: number
          parcel_id: string
          rainfall_mm: number | null
          recorded_at: string
          source: string
        }
        Insert: {
          cloud_coverage?: number | null
          confidence_pct?: number | null
          data_source?: string | null
          eto_value?: number | null
          id?: string
          ndmi_value: number
          ndvi_value: number
          parcel_id: string
          rainfall_mm?: number | null
          recorded_at?: string
          source?: string
        }
        Update: {
          cloud_coverage?: number | null
          confidence_pct?: number | null
          data_source?: string | null
          eto_value?: number | null
          id?: string
          ndmi_value?: number
          ndvi_value?: number
          parcel_id?: string
          rainfall_mm?: number | null
          recorded_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "ndmi_readings_parcel_id_fkey"
            columns: ["parcel_id"]
            isOneToOne: false
            referencedRelation: "parcels"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          body: string | null
          created_at: string
          id: string
          kind: string
          parcel_id: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          parcel_id?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          parcel_id?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      parcel_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          new_area_ha: number
          new_geometry: string
          old_area_ha: number
          old_geometry: string
          parcel_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_area_ha: number
          new_geometry: string
          old_area_ha: number
          old_geometry: string
          parcel_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_area_ha?: number
          new_geometry?: string
          old_area_ha?: number
          old_geometry?: string
          parcel_id?: string
        }
        Relationships: []
      }
      parcels: {
        Row: {
          area_hectares: number
          aspect_deg: number | null
          awc_mm: number | null
          created_at: string
          crop_type: string
          elevation_m: number | null
          geometry: string
          growth_phase: string
          id: string
          name: string
          pump_flow_m3h: number | null
          slope_deg: number | null
          soil_clay_pct: number | null
          soil_enriched_at: string | null
          soil_sand_pct: number | null
          soil_silt_pct: number | null
          user_id: string
        }
        Insert: {
          area_hectares: number
          aspect_deg?: number | null
          awc_mm?: number | null
          created_at?: string
          crop_type: string
          elevation_m?: number | null
          geometry: string
          growth_phase: string
          id?: string
          name: string
          pump_flow_m3h?: number | null
          slope_deg?: number | null
          soil_clay_pct?: number | null
          soil_enriched_at?: string | null
          soil_sand_pct?: number | null
          soil_silt_pct?: number | null
          user_id: string
        }
        Update: {
          area_hectares?: number
          aspect_deg?: number | null
          awc_mm?: number | null
          created_at?: string
          crop_type?: string
          elevation_m?: number | null
          geometry?: string
          growth_phase?: string
          id?: string
          name?: string
          pump_flow_m3h?: number | null
          slope_deg?: number | null
          soil_clay_pct?: number | null
          soil_enriched_at?: string | null
          soil_sand_pct?: number | null
          soil_silt_pct?: number | null
          user_id?: string
        }
        Relationships: []
      }
      phenophases: {
        Row: {
          created_at: string
          crop_type: string
          id: string
          kc_base: number
          mad_threshold: number
          order_index: number
          phase_name: string
          typical_duration_days: number
        }
        Insert: {
          created_at?: string
          crop_type: string
          id?: string
          kc_base: number
          mad_threshold?: number
          order_index: number
          phase_name: string
          typical_duration_days: number
        }
        Update: {
          created_at?: string
          crop_type?: string
          id?: string
          kc_base?: number
          mad_threshold?: number
          order_index?: number
          phase_name?: string
          typical_duration_days?: number
        }
        Relationships: []
      }
      soil_moisture_daily: {
        Row: {
          balance_mm: number | null
          created_at: string
          date: string
          et_mm: number | null
          id: string
          moisture_pct: number | null
          parcel_id: string
          rain_mm: number | null
        }
        Insert: {
          balance_mm?: number | null
          created_at?: string
          date?: string
          et_mm?: number | null
          id?: string
          moisture_pct?: number | null
          parcel_id: string
          rain_mm?: number | null
        }
        Update: {
          balance_mm?: number | null
          created_at?: string
          date?: string
          et_mm?: number | null
          id?: string
          moisture_pct?: number | null
          parcel_id?: string
          rain_mm?: number | null
        }
        Relationships: []
      }
      water_deficit_periods: {
        Row: {
          affected_parcels: string[] | null
          available_pct: number
          created_at: string | null
          date_from: string
          date_to: string
          id: string
          notes: string | null
          user_id: string
        }
        Insert: {
          affected_parcels?: string[] | null
          available_pct: number
          created_at?: string | null
          date_from: string
          date_to: string
          id?: string
          notes?: string | null
          user_id: string
        }
        Update: {
          affected_parcels?: string[] | null
          available_pct?: number
          created_at?: string | null
          date_from?: string
          date_to?: string
          id?: string
          notes?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
