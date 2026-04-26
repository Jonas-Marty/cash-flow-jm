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
      accounts: {
        Row: {
          archived: boolean
          color: string | null
          created_at: string
          emoji: string | null
          icon: string | null
          id: string
          image_url: string | null
          name: string
          opening_balance: number
          pin_order: number | null
          pinned: boolean
          type: Database["public"]["Enums"]["account_type"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          archived?: boolean
          color?: string | null
          created_at?: string
          emoji?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          name: string
          opening_balance?: number
          pin_order?: number | null
          pinned?: boolean
          type: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          archived?: boolean
          color?: string | null
          created_at?: string
          emoji?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          name?: string
          opening_balance?: number
          pin_order?: number | null
          pinned?: boolean
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      auth_providers: {
        Row: {
          client_id: string | null
          created_at: string
          discovery_url: string | null
          display_name: string | null
          enabled: boolean
          id: string
          metadata: Json
          provider: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          discovery_url?: string | null
          display_name?: string | null
          enabled?: boolean
          id?: string
          metadata?: Json
          provider: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          discovery_url?: string | null
          display_name?: string | null
          enabled?: boolean
          id?: string
          metadata?: Json
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          allocated_budget: number
          archived: boolean
          color: string | null
          created_at: string
          emoji: string | null
          group_id: string | null
          icon: string | null
          id: string
          image_url: string | null
          is_savings: boolean
          name: string
          pin_order: number | null
          pinned: boolean
          sort_order: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          allocated_budget?: number
          archived?: boolean
          color?: string | null
          created_at?: string
          emoji?: string | null
          group_id?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_savings?: boolean
          name: string
          pin_order?: number | null
          pinned?: boolean
          sort_order?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          allocated_budget?: number
          archived?: boolean
          color?: string | null
          created_at?: string
          emoji?: string | null
          group_id?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_savings?: boolean
          name?: string
          pin_order?: number | null
          pinned?: boolean
          sort_order?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "category_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      category_budgets: {
        Row: {
          amount: number
          category_id: string
          created_at: string
          month: string
          updated_at: string
        }
        Insert: {
          amount?: number
          category_id: string
          created_at?: string
          month: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string
          month?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "category_savings_balance"
            referencedColumns: ["category_id"]
          },
        ]
      }
      category_groups: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["category_group_kind"]
          name: string
          sort_order: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["category_group_kind"]
          name: string
          sort_order?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["category_group_kind"]
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      recurring_occurrences: {
        Row: {
          created_at: string
          due_on: string
          effective_on: string
          id: string
          posted_at: string | null
          rule_id: string
          status: Database["public"]["Enums"]["occurrence_status"]
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          due_on: string
          effective_on: string
          id?: string
          posted_at?: string | null
          rule_id: string
          status?: Database["public"]["Enums"]["occurrence_status"]
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          due_on?: string
          effective_on?: string
          id?: string
          posted_at?: string | null
          rule_id?: string
          status?: Database["public"]["Enums"]["occurrence_status"]
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_occurrences_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "recurring_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_occurrences_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_rules: {
        Row: {
          amount: number | null
          archived: boolean
          auto_post: boolean
          category_id: string | null
          created_at: string
          day_of_month: number | null
          day_rule: Database["public"]["Enums"]["recurring_day_rule"]
          destination_account_id: string | null
          ends_on: string | null
          estimated_amount: number | null
          frequency: Database["public"]["Enums"]["recurring_frequency"]
          id: string
          is_variable_amount: boolean
          name: string
          note: string | null
          payee: string | null
          source_account_id: string
          starts_on: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string | null
          weekend_adjust: Database["public"]["Enums"]["weekend_adjust"]
        }
        Insert: {
          amount?: number | null
          archived?: boolean
          auto_post?: boolean
          category_id?: string | null
          created_at?: string
          day_of_month?: number | null
          day_rule?: Database["public"]["Enums"]["recurring_day_rule"]
          destination_account_id?: string | null
          ends_on?: string | null
          estimated_amount?: number | null
          frequency?: Database["public"]["Enums"]["recurring_frequency"]
          id?: string
          is_variable_amount?: boolean
          name: string
          note?: string | null
          payee?: string | null
          source_account_id: string
          starts_on: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string | null
          weekend_adjust?: Database["public"]["Enums"]["weekend_adjust"]
        }
        Update: {
          amount?: number | null
          archived?: boolean
          auto_post?: boolean
          category_id?: string | null
          created_at?: string
          day_of_month?: number | null
          day_rule?: Database["public"]["Enums"]["recurring_day_rule"]
          destination_account_id?: string | null
          ends_on?: string | null
          estimated_amount?: number | null
          frequency?: Database["public"]["Enums"]["recurring_frequency"]
          id?: string
          is_variable_amount?: boolean
          name?: string
          note?: string | null
          payee?: string | null
          source_account_id?: string
          starts_on?: string
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string | null
          weekend_adjust?: Database["public"]["Enums"]["weekend_adjust"]
        }
        Relationships: []
      }
      settings: {
        Row: {
          created_at: string
          currency_code: string
          currency_symbol: string
          date_format: string
          day_heatmap_threshold: number
          id: string
          language: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          currency_code?: string
          currency_symbol?: string
          date_format?: string
          day_heatmap_threshold?: number
          id?: string
          language?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          currency_code?: string
          currency_symbol?: string
          date_format?: string
          day_heatmap_threshold?: number
          id?: string
          language?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      transaction_tags: {
        Row: {
          tag: string
          transaction_id: string
        }
        Insert: {
          tag: string
          transaction_id: string
        }
        Update: {
          tag?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_tags_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          category_id: string | null
          created_at: string
          destination_account_id: string | null
          id: string
          note: string | null
          occurred_on: string
          payee: string | null
          recurring_rule_id: string | null
          source_account_id: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount: number
          category_id?: string | null
          created_at?: string
          destination_account_id?: string | null
          id?: string
          note?: string | null
          occurred_on?: string
          payee?: string | null
          recurring_rule_id?: string | null
          source_account_id: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          category_id?: string | null
          created_at?: string
          destination_account_id?: string | null
          id?: string
          note?: string | null
          occurred_on?: string
          payee?: string | null
          recurring_rule_id?: string | null
          source_account_id?: string
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "category_savings_balance"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "transactions_destination_account_id_fkey"
            columns: ["destination_account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_destination_account_id_fkey"
            columns: ["destination_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_source_account_id_fkey"
            columns: ["source_account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_source_account_id_fkey"
            columns: ["source_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      account_balances: {
        Row: {
          archived: boolean | null
          balance: number | null
          id: string | null
          name: string | null
          opening_balance: number | null
          type: Database["public"]["Enums"]["account_type"] | null
        }
        Insert: {
          archived?: boolean | null
          balance?: never
          id?: string | null
          name?: string | null
          opening_balance?: number | null
          type?: Database["public"]["Enums"]["account_type"] | null
        }
        Update: {
          archived?: boolean | null
          balance?: never
          id?: string | null
          name?: string | null
          opening_balance?: number | null
          type?: Database["public"]["Enums"]["account_type"] | null
        }
        Relationships: []
      }
      category_savings_balance: {
        Row: {
          allocated_total: number | null
          balance: number | null
          category_id: string | null
          group_id: string | null
          name: string | null
          spent_total: number | null
        }
        Insert: {
          allocated_total?: never
          balance?: never
          category_id?: string | null
          group_id?: string | null
          name?: string | null
          spent_total?: never
        }
        Update: {
          allocated_total?: never
          balance?: never
          category_id?: string | null
          group_id?: string | null
          name?: string | null
          spent_total?: never
        }
        Relationships: [
          {
            foreignKeyName: "categories_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "category_groups"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      account_balances_as_of: {
        Args: { p_date: string }
        Returns: {
          archived: boolean
          balance: number
          id: string
          name: string
          opening_balance: number
          type: Database["public"]["Enums"]["account_type"]
        }[]
      }
      apply_recurring_rule_backfill: {
        Args: { p_mode: string; p_rule_id: string; p_today: string }
        Returns: undefined
      }
      archive_recurring_rule: {
        Args: { p_delete_pending?: boolean; p_id: string }
        Returns: undefined
      }
      category_month_spending: {
        Args: { p_month: string }
        Returns: {
          allocated: number
          category_id: string
          group_id: string
          group_name: string
          group_sort_order: number
          is_savings: boolean
          kind: Database["public"]["Enums"]["category_group_kind"]
          name: string
          sort_order: number
          spent_or_received: number
          variance: number
        }[]
      }
      compute_due_date: {
        Args: {
          p_dom: number
          p_month: string
          p_rule: Database["public"]["Enums"]["recurring_day_rule"]
        }
        Returns: string
      }
      compute_effective_date: {
        Args: {
          p_adjust: Database["public"]["Enums"]["weekend_adjust"]
          p_due: string
        }
        Returns: string
      }
      ensure_month_budgets: { Args: { p_month: string }; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      preview_recurring_rule: {
        Args: {
          p_day_of_month: number
          p_day_rule: Database["public"]["Enums"]["recurring_day_rule"]
          p_ends_on: string
          p_from: string
          p_starts_on: string
          p_to: string
          p_weekend_adjust: Database["public"]["Enums"]["weekend_adjust"]
        }
        Returns: {
          due_on: string
          effective_on: string
          in_past: boolean
        }[]
      }
      process_recurring_rules: { Args: { p_today: string }; Returns: undefined }
    }
    Enums: {
      account_type: "asset" | "liability"
      app_role: "admin" | "user"
      category_group_kind: "income" | "expense" | "savings"
      occurrence_status: "pending" | "posted" | "skipped"
      recurring_day_rule: "fixed_day" | "end_of_month" | "first_of_month"
      recurring_frequency: "monthly"
      transaction_type: "expense" | "income" | "transfer"
      weekend_adjust: "none" | "before" | "after"
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
    Enums: {
      account_type: ["asset", "liability"],
      app_role: ["admin", "user"],
      category_group_kind: ["income", "expense", "savings"],
      occurrence_status: ["pending", "posted", "skipped"],
      recurring_day_rule: ["fixed_day", "end_of_month", "first_of_month"],
      recurring_frequency: ["monthly"],
      transaction_type: ["expense", "income", "transfer"],
      weekend_adjust: ["none", "before", "after"],
    },
  },
} as const
