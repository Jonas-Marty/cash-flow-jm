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
      account_statements: {
        Row: {
          account_id: string
          as_of: string
          compensation_transaction_id: string | null
          created_at: string
          external_ref: string | null
          id: string
          note: string | null
          source: string
          statement_balance: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          as_of: string
          compensation_transaction_id?: string | null
          created_at?: string
          external_ref?: string | null
          id?: string
          note?: string | null
          source?: string
          statement_balance: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          account_id?: string
          as_of?: string
          compensation_transaction_id?: string | null
          created_at?: string
          external_ref?: string | null
          id?: string
          note?: string | null
          source?: string
          statement_balance?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_statements_compensation_transaction_id_fkey"
            columns: ["compensation_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          archived: boolean
          color: string | null
          created_at: string
          currency_code: string
          currency_symbol: string
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
          currency_code?: string
          currency_symbol?: string
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
          currency_code?: string
          currency_symbol?: string
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
      ai_audit_logs: {
        Row: {
          conversation_id: string | null
          duration_ms: number | null
          error_message: string | null
          id: string
          kind: string
          model: string | null
          occurred_at: string
          ok: boolean | null
          payload: Json
          provider_host: string | null
          tool_name: string | null
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          kind: string
          model?: string | null
          occurred_at?: string
          ok?: boolean | null
          payload?: Json
          provider_host?: string | null
          tool_name?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          kind?: string
          model?: string | null
          occurred_at?: string
          ok?: boolean | null
          payload?: Json
          provider_host?: string | null
          tool_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_credentials: {
        Row: {
          api_token: string | null
          base_url: string | null
          created_at: string
          enabled: boolean
          model: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_token?: string | null
          base_url?: string | null
          created_at?: string
          enabled?: boolean
          model?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_token?: string | null
          base_url?: string | null
          created_at?: string
          enabled?: boolean
          model?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_messages: {
        Row: {
          content: Json
          conversation_id: string
          created_at: string
          id: string
          role: string
          tool_calls: Json | null
          user_id: string
        }
        Insert: {
          content?: Json
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          tool_calls?: Json | null
          user_id: string
        }
        Update: {
          content?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          tool_calls?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_tokens: {
        Row: {
          created_at: string
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          token_hash: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          diff: Json | null
          id: number
          metadata: Json | null
          occurred_at: string
          row_id: string | null
          table_name: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          diff?: Json | null
          id?: number
          metadata?: Json | null
          occurred_at?: string
          row_id?: string | null
          table_name?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          diff?: Json | null
          id?: number
          metadata?: Json | null
          occurred_at?: string
          row_id?: string | null
          table_name?: string | null
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
          closed_at: string | null
          color: string | null
          created_at: string
          emoji: string | null
          funding_category_id: string | null
          group_id: string | null
          icon: string | null
          id: string
          image_url: string | null
          is_savings: boolean
          is_scope: boolean
          name: string
          pin_order: number | null
          pinned: boolean
          sort_order: number
          sweep_target_category_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          allocated_budget?: number
          archived?: boolean
          closed_at?: string | null
          color?: string | null
          created_at?: string
          emoji?: string | null
          funding_category_id?: string | null
          group_id?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_savings?: boolean
          is_scope?: boolean
          name: string
          pin_order?: number | null
          pinned?: boolean
          sort_order?: number
          sweep_target_category_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          allocated_budget?: number
          archived?: boolean
          closed_at?: string | null
          color?: string | null
          created_at?: string
          emoji?: string | null
          funding_category_id?: string | null
          group_id?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_savings?: boolean
          is_scope?: boolean
          name?: string
          pin_order?: number | null
          pinned?: boolean
          sort_order?: number
          sweep_target_category_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_funding_category_id_fkey"
            columns: ["funding_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_funding_category_id_fkey"
            columns: ["funding_category_id"]
            isOneToOne: false
            referencedRelation: "category_savings_balance"
            referencedColumns: ["category_id"]
          },
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
          sweep_target_category_id: string | null
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
          sweep_target_category_id?: string | null
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
          sweep_target_category_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      category_reallocations: {
        Row: {
          amount: number
          created_at: string
          from_category_id: string
          id: string
          note: string | null
          occurred_on: string
          to_category_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          from_category_id: string
          id?: string
          note?: string | null
          occurred_on?: string
          to_category_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          amount?: number
          created_at?: string
          from_category_id?: string
          id?: string
          note?: string | null
          occurred_on?: string
          to_category_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nextcloud_connections: {
        Row: {
          access_token: string | null
          base_url: string
          client_id: string
          client_secret: string
          created_at: string
          nextcloud_user: string | null
          refresh_token: string | null
          scope: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          base_url: string
          client_id: string
          client_secret: string
          created_at?: string
          nextcloud_user?: string | null
          refresh_token?: string | null
          scope?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          access_token?: string | null
          base_url?: string
          client_id?: string
          client_secret?: string
          created_at?: string
          nextcloud_user?: string | null
          refresh_token?: string | null
          scope?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_transactions: {
        Row: {
          amount: number
          category_id: string | null
          confirmed_at: string | null
          confirmed_transaction_id: string | null
          created_at: string
          description: string | null
          destination_account_id: string | null
          destination_amount: number | null
          external_info: string | null
          external_ref: string | null
          external_source: string | null
          id: string
          note: string | null
          occurred_on: string
          reject_reason: string | null
          rejected_at: string | null
          source_account_id: string
          status: Database["public"]["Enums"]["pending_transaction_status"]
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category_id?: string | null
          confirmed_at?: string | null
          confirmed_transaction_id?: string | null
          created_at?: string
          description?: string | null
          destination_account_id?: string | null
          destination_amount?: number | null
          external_info?: string | null
          external_ref?: string | null
          external_source?: string | null
          id?: string
          note?: string | null
          occurred_on?: string
          reject_reason?: string | null
          rejected_at?: string | null
          source_account_id: string
          status?: Database["public"]["Enums"]["pending_transaction_status"]
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string
        }
        Update: {
          amount?: number
          category_id?: string | null
          confirmed_at?: string | null
          confirmed_transaction_id?: string | null
          created_at?: string
          description?: string | null
          destination_account_id?: string | null
          destination_amount?: number | null
          external_info?: string | null
          external_ref?: string | null
          external_source?: string | null
          id?: string
          note?: string | null
          occurred_on?: string
          reject_reason?: string | null
          rejected_at?: string | null
          source_account_id?: string
          status?: Database["public"]["Enums"]["pending_transaction_status"]
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_transactions_confirmed_transaction_id_fkey"
            columns: ["confirmed_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
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
      recurring_rule_slices: {
        Row: {
          amount: number | null
          amount_ratio: number | null
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          is_reimbursable: boolean
          note: string | null
          reimbursable_counterparty: string | null
          reimbursable_reason: string | null
          rule_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          amount?: number | null
          amount_ratio?: number | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_reimbursable?: boolean
          note?: string | null
          reimbursable_counterparty?: string | null
          reimbursable_reason?: string | null
          rule_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          amount?: number | null
          amount_ratio?: number | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_reimbursable?: boolean
          note?: string | null
          reimbursable_counterparty?: string | null
          reimbursable_reason?: string | null
          rule_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_rule_slices_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "recurring_rules"
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
          description: string | null
          destination_account_id: string | null
          ends_on: string | null
          estimated_amount: number | null
          frequency: Database["public"]["Enums"]["recurring_frequency"]
          id: string
          is_split: boolean
          is_variable_amount: boolean
          is_variable_date: boolean
          name: string
          note: string | null
          reporting_offset_months: number
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
          description?: string | null
          destination_account_id?: string | null
          ends_on?: string | null
          estimated_amount?: number | null
          frequency?: Database["public"]["Enums"]["recurring_frequency"]
          id?: string
          is_split?: boolean
          is_variable_amount?: boolean
          is_variable_date?: boolean
          name: string
          note?: string | null
          reporting_offset_months?: number
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
          description?: string | null
          destination_account_id?: string | null
          ends_on?: string | null
          estimated_amount?: number | null
          frequency?: Database["public"]["Enums"]["recurring_frequency"]
          id?: string
          is_split?: boolean
          is_variable_amount?: boolean
          is_variable_date?: boolean
          name?: string
          note?: string | null
          reporting_offset_months?: number
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
          active_scope_id: string | null
          created_at: string
          currency_code: string
          currency_symbol: string
          date_format: string
          day_heatmap_threshold: number
          default_sweep_category_id: string | null
          format_locale: string
          id: string
          language: string
          net_worth_show_converted: boolean
          theme: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active_scope_id?: string | null
          created_at?: string
          currency_code?: string
          currency_symbol?: string
          date_format?: string
          day_heatmap_threshold?: number
          default_sweep_category_id?: string | null
          format_locale?: string
          id?: string
          language?: string
          net_worth_show_converted?: boolean
          theme?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active_scope_id?: string | null
          created_at?: string
          currency_code?: string
          currency_symbol?: string
          date_format?: string
          day_heatmap_threshold?: number
          default_sweep_category_id?: string | null
          format_locale?: string
          id?: string
          language?: string
          net_worth_show_converted?: boolean
          theme?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settings_active_scope_id_fkey"
            columns: ["active_scope_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settings_active_scope_id_fkey"
            columns: ["active_scope_id"]
            isOneToOne: false
            referencedRelation: "category_savings_balance"
            referencedColumns: ["category_id"]
          },
        ]
      }
      transaction_attachments: {
        Row: {
          added_at: string
          created_at: string
          display_name: string
          id: string
          link_url: string
          source: string
          statement_id: string | null
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          added_at?: string
          created_at?: string
          display_name: string
          id?: string
          link_url: string
          source?: string
          statement_id?: string | null
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          added_at?: string
          created_at?: string
          display_name?: string
          id?: string
          link_url?: string
          source?: string
          statement_id?: string | null
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_reimbursements: {
        Row: {
          amount: number
          created_at: string
          id: string
          original_transaction_id: string
          settling_transaction_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          original_transaction_id: string
          settling_transaction_id: string
          user_id?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          original_transaction_id?: string
          settling_transaction_id?: string
          user_id?: string
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
          description: string | null
          destination_account_id: string | null
          destination_amount: number | null
          fee_amount: number | null
          fee_category_id: string | null
          fee_transaction_id: string | null
          id: string
          is_reimbursable: boolean
          note: string | null
          occurred_on: string
          recurring_rule_id: string | null
          reimbursable_cancel_reason: string | null
          reimbursable_counterparty: string | null
          reimbursable_reason: string | null
          reimbursable_status: string | null
          reimbursable_writeoff_category_id: string | null
          reimbursable_writeoff_transaction_id: string | null
          source_account_id: string
          split_group_id: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          destination_account_id?: string | null
          destination_amount?: number | null
          fee_amount?: number | null
          fee_category_id?: string | null
          fee_transaction_id?: string | null
          id?: string
          is_reimbursable?: boolean
          note?: string | null
          occurred_on?: string
          recurring_rule_id?: string | null
          reimbursable_cancel_reason?: string | null
          reimbursable_counterparty?: string | null
          reimbursable_reason?: string | null
          reimbursable_status?: string | null
          reimbursable_writeoff_category_id?: string | null
          reimbursable_writeoff_transaction_id?: string | null
          source_account_id: string
          split_group_id?: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          destination_account_id?: string | null
          destination_amount?: number | null
          fee_amount?: number | null
          fee_category_id?: string | null
          fee_transaction_id?: string | null
          id?: string
          is_reimbursable?: boolean
          note?: string | null
          occurred_on?: string
          recurring_rule_id?: string | null
          reimbursable_cancel_reason?: string | null
          reimbursable_counterparty?: string | null
          reimbursable_reason?: string | null
          reimbursable_status?: string | null
          reimbursable_writeoff_category_id?: string | null
          reimbursable_writeoff_transaction_id?: string | null
          source_account_id?: string
          split_group_id?: string | null
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
            foreignKeyName: "transactions_fee_category_id_fkey"
            columns: ["fee_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_fee_category_id_fkey"
            columns: ["fee_category_id"]
            isOneToOne: false
            referencedRelation: "category_savings_balance"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "transactions_fee_transaction_id_fkey"
            columns: ["fee_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
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
      webhooks: {
        Row: {
          active: boolean
          auth_header_name: string | null
          auth_header_value: string | null
          created_at: string
          events: string[]
          id: string
          name: string
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          active?: boolean
          auth_header_name?: string | null
          auth_header_value?: string | null
          created_at?: string
          events?: string[]
          id?: string
          name: string
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          active?: boolean
          auth_header_name?: string | null
          auth_header_value?: string | null
          created_at?: string
          events?: string[]
          id?: string
          name?: string
          updated_at?: string
          url?: string
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
          currency_code: string | null
          currency_symbol: string | null
          id: string | null
          name: string | null
          opening_balance: number | null
          type: Database["public"]["Enums"]["account_type"] | null
        }
        Insert: {
          archived?: boolean | null
          balance?: never
          currency_code?: string | null
          currency_symbol?: string | null
          id?: string | null
          name?: string | null
          opening_balance?: number | null
          type?: Database["public"]["Enums"]["account_type"] | null
        }
        Update: {
          archived?: boolean | null
          balance?: never
          currency_code?: string | null
          currency_symbol?: string | null
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
          currency_code: string
          currency_symbol: string
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
      archive_savings_envelope: {
        Args: { p_id: string; p_move_remaining_to: string }
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
      category_savings_balance_v2: {
        Args: { p_as_of: string }
        Returns: {
          archived: boolean
          category_id: string
          cumulative_balance: number
          from_reallocations: number
          from_sweeps: number
          from_transactions: number
          month_activity: number
          name: string
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
      format_date_token: {
        Args: { p_date: string; p_fmt: string; p_locale: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      interpolate_template:
        | {
            Args: {
              p_date: string
              p_due: string
              p_locale: string
              p_next: string
              p_prev: string
              p_run: number
              p_template: string
              p_today: string
            }
            Returns: string
          }
        | {
            Args: {
              p_date: string
              p_due: string
              p_frequency?: string
              p_locale: string
              p_next: string
              p_prev: string
              p_reporting_offset_months?: number
              p_run: number
              p_starts_on?: string
              p_template: string
              p_today: string
            }
            Returns: string
          }
      log_audit_event: {
        Args: { p_action: string; p_metadata?: Json }
        Returns: number
      }
      preview_recurring_rule:
        | {
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
        | {
            Args: {
              p_day_of_month: number
              p_day_rule: Database["public"]["Enums"]["recurring_day_rule"]
              p_ends_on: string
              p_frequency?: Database["public"]["Enums"]["recurring_frequency"]
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
      process_recurring_rules_for_all_users: {
        Args: { p_today: string }
        Returns: number
      }
      prune_audit_logs: { Args: { p_keep_days: number }; Returns: number }
      recompute_reimbursable_status: {
        Args: { p_orig: string }
        Returns: undefined
      }
      reconciliation_summary: {
        Args: { p_as_of: string }
        Returns: {
          accounts_total: number
          drift: number
          savings_total: number
          unswept_current_month: number
        }[]
      }
      recurring_month_step: {
        Args: { p_freq: Database["public"]["Enums"]["recurring_frequency"] }
        Returns: number
      }
    }
    Enums: {
      account_type: "asset" | "liability"
      app_role: "admin" | "user"
      category_group_kind: "income" | "expense" | "savings"
      occurrence_status: "pending" | "posted" | "skipped"
      pending_transaction_status: "pending" | "confirmed" | "rejected"
      recurring_day_rule: "fixed_day" | "end_of_month" | "first_of_month"
      recurring_frequency: "monthly" | "quarterly" | "yearly"
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
      pending_transaction_status: ["pending", "confirmed", "rejected"],
      recurring_day_rule: ["fixed_day", "end_of_month", "first_of_month"],
      recurring_frequency: ["monthly", "quarterly", "yearly"],
      transaction_type: ["expense", "income", "transfer"],
      weekend_adjust: ["none", "before", "after"],
    },
  },
} as const
