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
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      ai_category_performance: {
        Row: {
          accuracy_score: number
          category_id: string
          created_at: string
          id: string
          influence_weight: number
          market_condition: string | null
          period_end: string
          period_start: string
          profit_impact: number
          total_trades: number
          user_id: string
          winning_trades: number
        }
        Insert: {
          accuracy_score?: number
          category_id: string
          created_at?: string
          id?: string
          influence_weight?: number
          market_condition?: string | null
          period_end: string
          period_start: string
          profit_impact?: number
          total_trades?: number
          user_id: string
          winning_trades?: number
        }
        Update: {
          accuracy_score?: number
          category_id?: string
          created_at?: string
          id?: string
          influence_weight?: number
          market_condition?: string | null
          period_end?: string
          period_start?: string
          profit_impact?: number
          total_trades?: number
          user_id?: string
          winning_trades?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_category_performance_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "ai_data_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_data_categories: {
        Row: {
          category_name: string
          category_type: string
          confidence_level: number
          created_at: string
          description: string | null
          id: string
          importance_score: number
          is_enabled: boolean
          last_performance_update: string | null
          updated_at: string
        }
        Insert: {
          category_name: string
          category_type: string
          confidence_level?: number
          created_at?: string
          description?: string | null
          id?: string
          importance_score?: number
          is_enabled?: boolean
          last_performance_update?: string | null
          updated_at?: string
        }
        Update: {
          category_name?: string
          category_type?: string
          confidence_level?: number
          created_at?: string
          description?: string | null
          id?: string
          importance_score?: number
          is_enabled?: boolean
          last_performance_update?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_data_sources: {
        Row: {
          api_endpoint: string | null
          blockchain_networks: string[] | null
          category_id: string | null
          configuration: Json | null
          created_at: string
          filter_config: Json | null
          id: string
          is_active: boolean
          last_sync: string | null
          source_name: string
          source_type: string
          threshold_amount: number | null
          update_frequency: string
          updated_at: string
          user_id: string
          webhook_secret: string | null
          webhook_url: string | null
        }
        Insert: {
          api_endpoint?: string | null
          blockchain_networks?: string[] | null
          category_id?: string | null
          configuration?: Json | null
          created_at?: string
          filter_config?: Json | null
          id?: string
          is_active?: boolean
          last_sync?: string | null
          source_name: string
          source_type: string
          threshold_amount?: number | null
          update_frequency?: string
          updated_at?: string
          user_id: string
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Update: {
          api_endpoint?: string | null
          blockchain_networks?: string[] | null
          category_id?: string | null
          configuration?: Json | null
          created_at?: string
          filter_config?: Json | null
          id?: string
          is_active?: boolean
          last_sync?: string | null
          source_name?: string
          source_type?: string
          threshold_amount?: number | null
          update_frequency?: string
          updated_at?: string
          user_id?: string
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_data_sources_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "ai_data_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_knowledge_base: {
        Row: {
          confidence_score: number
          content: string
          created_at: string
          data_points: number
          id: string
          knowledge_type: string
          last_validated_at: string | null
          metadata: Json | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence_score?: number
          content: string
          created_at?: string
          data_points?: number
          id?: string
          knowledge_type: string
          last_validated_at?: string | null
          metadata?: Json | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence_score?: number
          content?: string
          created_at?: string
          data_points?: number
          id?: string
          knowledge_type?: string
          last_validated_at?: string | null
          metadata?: Json | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_learning_metrics: {
        Row: {
          created_at: string
          id: string
          insights_generated: number
          metric_type: string
          metric_value: number
          period_end: string
          period_start: string
          trades_analyzed: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          insights_generated?: number
          metric_type: string
          metric_value: number
          period_end: string
          period_start: string
          trades_analyzed?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          insights_generated?: number
          metric_type?: string
          metric_value?: number
          period_end?: string
          period_start?: string
          trades_analyzed?: number
          user_id?: string
        }
        Relationships: []
      }
      coin_pool_states: {
        Row: {
          config_snapshot: Json
          created_at: string
          high_water_price: number | null
          id: string
          is_armed: boolean
          last_trailing_stop_price: number | null
          runner_remaining_qty: number
          secure_filled_qty: number
          secure_target_qty: number
          strategy_id: string
          symbol: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config_snapshot?: Json
          created_at?: string
          high_water_price?: number | null
          id?: string
          is_armed?: boolean
          last_trailing_stop_price?: number | null
          runner_remaining_qty?: number
          secure_filled_qty?: number
          secure_target_qty?: number
          strategy_id: string
          symbol: string
          updated_at?: string
          user_id: string
        }
        Update: {
          config_snapshot?: Json
          created_at?: string
          high_water_price?: number | null
          id?: string
          is_armed?: boolean
          last_trailing_stop_price?: number | null
          runner_remaining_qty?: number
          secure_filled_qty?: number
          secure_target_qty?: number
          strategy_id?: string
          symbol?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      coinbase_oauth_credentials: {
        Row: {
          app_name: string
          client_id_encrypted: string | null
          client_secret_encrypted: string | null
          created_at: string
          id: string
          is_active: boolean
          is_sandbox: boolean
          updated_at: string
        }
        Insert: {
          app_name?: string
          client_id_encrypted?: string | null
          client_secret_encrypted?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_sandbox?: boolean
          updated_at?: string
        }
        Update: {
          app_name?: string
          client_id_encrypted?: string | null
          client_secret_encrypted?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_sandbox?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      coinbase_sandbox_credentials: {
        Row: {
          api_key_encrypted: string | null
          api_secret_encrypted: string | null
          created_at: string
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          api_key_encrypted?: string | null
          api_secret_encrypted?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string | null
          api_secret_encrypted?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      conversation_history: {
        Row: {
          content: string
          created_at: string
          id: string
          message_type: string
          metadata: Json | null
          strategy_id: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          message_type: string
          metadata?: Json | null
          strategy_id?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          message_type?: string
          metadata?: Json | null
          strategy_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      crypto_news: {
        Row: {
          author: string | null
          content: string | null
          created_at: string
          headline: string
          id: string
          metadata: Json | null
          news_type: string | null
          sentiment_score: number | null
          source_id: string
          source_name: string | null
          symbol: string | null
          timestamp: string
          url: string | null
          user_id: string
        }
        Insert: {
          author?: string | null
          content?: string | null
          created_at?: string
          headline: string
          id?: string
          metadata?: Json | null
          news_type?: string | null
          sentiment_score?: number | null
          source_id: string
          source_name?: string | null
          symbol?: string | null
          timestamp: string
          url?: string | null
          user_id: string
        }
        Update: {
          author?: string | null
          content?: string | null
          created_at?: string
          headline?: string
          id?: string
          metadata?: Json | null
          news_type?: string | null
          sentiment_score?: number | null
          source_id?: string
          source_name?: string | null
          symbol?: string | null
          timestamp?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      data_sources: {
        Row: {
          content: string | null
          created_at: string
          id: string
          is_active: boolean
          last_updated: string | null
          metadata: Json | null
          name: string
          type: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_updated?: string | null
          metadata?: Json | null
          name: string
          type: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_updated?: string | null
          metadata?: Json | null
          name?: string
          type?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      execution_holds: {
        Row: {
          created_at: string | null
          hold_until: string
          reason: string | null
          symbol: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          hold_until: string
          reason?: string | null
          symbol: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          hold_until?: string
          reason?: string | null
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      external_market_data: {
        Row: {
          category_context: Json | null
          created_at: string
          cryptocurrency: string | null
          data_type: string
          data_value: number | null
          entity: string | null
          id: string
          metadata: Json | null
          source_id: string
          timestamp: string
        }
        Insert: {
          category_context?: Json | null
          created_at?: string
          cryptocurrency?: string | null
          data_type: string
          data_value?: number | null
          entity?: string | null
          id?: string
          metadata?: Json | null
          source_id: string
          timestamp?: string
        }
        Update: {
          category_context?: Json | null
          created_at?: string
          cryptocurrency?: string | null
          data_type?: string
          data_value?: number | null
          entity?: string | null
          id?: string
          metadata?: Json | null
          source_id?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_market_data_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "ai_data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_market_data: {
        Row: {
          created_at: string
          exchange: string | null
          id: string
          market_cap: number | null
          metadata: Json | null
          price: number
          source: string
          source_id: string
          symbol: string
          timestamp: string
          user_id: string
          volume: number | null
        }
        Insert: {
          created_at?: string
          exchange?: string | null
          id?: string
          market_cap?: number | null
          metadata?: Json | null
          price: number
          source?: string
          source_id: string
          symbol: string
          timestamp: string
          user_id: string
          volume?: number | null
        }
        Update: {
          created_at?: string
          exchange?: string | null
          id?: string
          market_cap?: number | null
          metadata?: Json | null
          price?: number
          source?: string
          source_id?: string
          symbol?: string
          timestamp?: string
          user_id?: string
          volume?: number | null
        }
        Relationships: []
      }
      live_signals: {
        Row: {
          created_at: string
          data: Json | null
          id: string
          processed: boolean | null
          signal_strength: number
          signal_type: string
          source: string
          source_id: string
          symbol: string
          timestamp: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json | null
          id?: string
          processed?: boolean | null
          signal_strength?: number
          signal_type: string
          source: string
          source_id: string
          symbol: string
          timestamp: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json | null
          id?: string
          processed?: boolean | null
          signal_strength?: number
          signal_type?: string
          source?: string
          source_id?: string
          symbol?: string
          timestamp?: string
          user_id?: string
        }
        Relationships: []
      }
      llm_configurations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          max_tokens: number
          model: string
          provider: string
          system_prompt: string
          temperature: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_tokens?: number
          model?: string
          provider?: string
          system_prompt?: string
          temperature?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_tokens?: number
          model?: string
          provider?: string
          system_prompt?: string
          temperature?: number
          updated_at?: string
        }
        Relationships: []
      }
      mock_trades: {
        Row: {
          amount: number
          buy_fees: number | null
          cryptocurrency: string
          executed_at: string
          exit_value: number | null
          fees: number | null
          id: string
          integrity_reason: string | null
          is_corrupted: boolean
          is_test_mode: boolean | null
          market_conditions: Json | null
          notes: string | null
          original_purchase_amount: number | null
          original_purchase_price: number | null
          original_purchase_value: number | null
          price: number
          profit_loss: number | null
          realized_pnl: number | null
          realized_pnl_pct: number | null
          sell_fees: number | null
          strategy_id: string
          strategy_trigger: string | null
          total_value: number
          trade_type: string
          user_id: string
        }
        Insert: {
          amount: number
          buy_fees?: number | null
          cryptocurrency: string
          executed_at?: string
          exit_value?: number | null
          fees?: number | null
          id?: string
          integrity_reason?: string | null
          is_corrupted?: boolean
          is_test_mode?: boolean | null
          market_conditions?: Json | null
          notes?: string | null
          original_purchase_amount?: number | null
          original_purchase_price?: number | null
          original_purchase_value?: number | null
          price: number
          profit_loss?: number | null
          realized_pnl?: number | null
          realized_pnl_pct?: number | null
          sell_fees?: number | null
          strategy_id: string
          strategy_trigger?: string | null
          total_value: number
          trade_type: string
          user_id: string
        }
        Update: {
          amount?: number
          buy_fees?: number | null
          cryptocurrency?: string
          executed_at?: string
          exit_value?: number | null
          fees?: number | null
          id?: string
          integrity_reason?: string | null
          is_corrupted?: boolean
          is_test_mode?: boolean | null
          market_conditions?: Json | null
          notes?: string | null
          original_purchase_amount?: number | null
          original_purchase_price?: number | null
          original_purchase_value?: number | null
          price?: number
          profit_loss?: number | null
          realized_pnl?: number | null
          realized_pnl_pct?: number | null
          sell_fees?: number | null
          strategy_id?: string
          strategy_trigger?: string | null
          total_value?: number
          trade_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mock_trades_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "trading_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_trades_fix_audit: {
        Row: {
          created_at: string
          id: string
          new_amount: number | null
          new_price: number | null
          old_amount: number | null
          old_price: number | null
          reason: string
          source: string
          strategy_id: string | null
          symbol: string | null
          trade_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          new_amount?: number | null
          new_price?: number | null
          old_amount?: number | null
          old_price?: number | null
          reason: string
          source: string
          strategy_id?: string | null
          symbol?: string | null
          trade_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          new_amount?: number | null
          new_price?: number | null
          old_amount?: number | null
          old_price?: number | null
          reason?: string
          source?: string
          strategy_id?: string | null
          symbol?: string | null
          trade_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      price_data: {
        Row: {
          close_price: number
          created_at: string
          high_price: number
          id: string
          interval_type: string
          low_price: number
          metadata: Json | null
          open_price: number
          source: string
          source_id: string
          symbol: string
          timestamp: string
          user_id: string
          volume: number | null
        }
        Insert: {
          close_price: number
          created_at?: string
          high_price: number
          id?: string
          interval_type: string
          low_price: number
          metadata?: Json | null
          open_price: number
          source?: string
          source_id: string
          symbol: string
          timestamp: string
          user_id: string
          volume?: number | null
        }
        Update: {
          close_price?: number
          created_at?: string
          high_price?: number
          id?: string
          interval_type?: string
          low_price?: number
          metadata?: Json | null
          open_price?: number
          source?: string
          source_id?: string
          symbol?: string
          timestamp?: string
          user_id?: string
          volume?: number | null
        }
        Relationships: []
      }
      price_snapshots: {
        Row: {
          price: number
          symbol: string
          ts: string
        }
        Insert: {
          price: number
          symbol: string
          ts: string
        }
        Update: {
          price?: number
          symbol?: string
          ts?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_type: string
          avatar_url: string | null
          created_at: string
          fee_rate: number | null
          full_name: string | null
          id: string
          updated_at: string
          username: string | null
        }
        Insert: {
          account_type?: string
          avatar_url?: string | null
          created_at?: string
          fee_rate?: number | null
          full_name?: string | null
          id: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          account_type?: string
          avatar_url?: string | null
          created_at?: string
          fee_rate?: number | null
          full_name?: string | null
          id?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      scheduler_execution_log: {
        Row: {
          created_at: string
          error_message: string | null
          execution_duration_ms: number | null
          execution_time: string
          function_name: string
          id: string
          response_data: Json | null
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          execution_duration_ms?: number | null
          execution_time?: string
          function_name: string
          id?: string
          response_data?: Json | null
          status: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          execution_duration_ms?: number | null
          execution_time?: string
          function_name?: string
          id?: string
          response_data?: Json | null
          status?: string
        }
        Relationships: []
      }
      security_audit_log: {
        Row: {
          action_type: string
          created_at: string | null
          id: string
          ip_address: unknown | null
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          table_name: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string | null
          id?: string
          ip_address?: unknown | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string | null
          id?: string
          ip_address?: unknown | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      strategy_performance: {
        Row: {
          average_gain: number | null
          average_loss: number | null
          created_at: string
          execution_date: string
          id: string
          is_test_mode: boolean | null
          losing_trades: number | null
          max_drawdown: number | null
          portfolio_value: number | null
          strategy_id: string
          total_fees: number | null
          total_profit_loss: number | null
          total_trades: number | null
          updated_at: string
          user_id: string
          win_rate: number | null
          winning_trades: number | null
        }
        Insert: {
          average_gain?: number | null
          average_loss?: number | null
          created_at?: string
          execution_date?: string
          id?: string
          is_test_mode?: boolean | null
          losing_trades?: number | null
          max_drawdown?: number | null
          portfolio_value?: number | null
          strategy_id: string
          total_fees?: number | null
          total_profit_loss?: number | null
          total_trades?: number | null
          updated_at?: string
          user_id: string
          win_rate?: number | null
          winning_trades?: number | null
        }
        Update: {
          average_gain?: number | null
          average_loss?: number | null
          created_at?: string
          execution_date?: string
          id?: string
          is_test_mode?: boolean | null
          losing_trades?: number | null
          max_drawdown?: number | null
          portfolio_value?: number | null
          strategy_id?: string
          total_fees?: number | null
          total_profit_loss?: number | null
          total_trades?: number | null
          updated_at?: string
          user_id?: string
          win_rate?: number | null
          winning_trades?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "strategy_performance_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "trading_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_decisions_log: {
        Row: {
          confidence: number
          created_at: string
          decision_action: string
          decision_reason: string | null
          id: string
          intent_side: string
          intent_source: string
          metadata: Json
          strategy_id: string
          symbol: string
          user_id: string
        }
        Insert: {
          confidence: number
          created_at?: string
          decision_action: string
          decision_reason?: string | null
          id?: string
          intent_side: string
          intent_source: string
          metadata?: Json
          strategy_id: string
          symbol: string
          user_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          decision_action?: string
          decision_reason?: string | null
          id?: string
          intent_side?: string
          intent_source?: string
          metadata?: Json
          strategy_id?: string
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      trading_history: {
        Row: {
          amount: number
          coinbase_order_id: string | null
          cryptocurrency: string
          executed_at: string
          fees: number | null
          id: string
          is_sandbox: boolean | null
          notes: string | null
          price: number
          strategy_id: string | null
          total_value: number
          trade_environment: string | null
          trade_type: string
          user_coinbase_connection_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          coinbase_order_id?: string | null
          cryptocurrency: string
          executed_at?: string
          fees?: number | null
          id?: string
          is_sandbox?: boolean | null
          notes?: string | null
          price: number
          strategy_id?: string | null
          total_value: number
          trade_environment?: string | null
          trade_type: string
          user_coinbase_connection_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          coinbase_order_id?: string | null
          cryptocurrency?: string
          executed_at?: string
          fees?: number | null
          id?: string
          is_sandbox?: boolean | null
          notes?: string | null
          price?: number
          strategy_id?: string | null
          total_value?: number
          trade_environment?: string | null
          trade_type?: string
          user_coinbase_connection_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trading_history_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "trading_strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trading_history_user_coinbase_connection_id_fkey"
            columns: ["user_coinbase_connection_id"]
            isOneToOne: false
            referencedRelation: "user_coinbase_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trading_history_user_coinbase_connection_id_fkey"
            columns: ["user_coinbase_connection_id"]
            isOneToOne: false
            referencedRelation: "user_connections_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trading_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trading_strategies: {
        Row: {
          configuration: Json
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_active_live: boolean | null
          is_active_test: boolean | null
          strategy_name: string
          test_mode: boolean | null
          unified_config: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          configuration: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_active_live?: boolean | null
          is_active_test?: boolean | null
          strategy_name: string
          test_mode?: boolean | null
          unified_config?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          configuration?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_active_live?: boolean | null
          is_active_test?: boolean | null
          strategy_name?: string
          test_mode?: boolean | null
          unified_config?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trading_strategies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_coinbase_connections: {
        Row: {
          access_token_encrypted: string | null
          api_identifier_encrypted: string | null
          api_name_encrypted: string | null
          api_private_key_encrypted: string | null
          coinbase_user_id: string | null
          connected_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          last_sync: string | null
          refresh_token_encrypted: string | null
          user_id: string
        }
        Insert: {
          access_token_encrypted?: string | null
          api_identifier_encrypted?: string | null
          api_name_encrypted?: string | null
          api_private_key_encrypted?: string | null
          coinbase_user_id?: string | null
          connected_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_sync?: string | null
          refresh_token_encrypted?: string | null
          user_id: string
        }
        Update: {
          access_token_encrypted?: string | null
          api_identifier_encrypted?: string | null
          api_name_encrypted?: string | null
          api_private_key_encrypted?: string | null
          coinbase_user_id?: string | null
          connected_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_sync?: string | null
          refresh_token_encrypted?: string | null
          user_id?: string
        }
        Relationships: []
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
          role?: Database["public"]["Enums"]["app_role"]
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
      whale_signal_events: {
        Row: {
          amount: number | null
          blockchain: string | null
          created_at: string
          event_type: string
          from_address: string | null
          id: string
          processed: boolean | null
          raw_data: Json | null
          source_id: string
          timestamp: string
          to_address: string | null
          token_symbol: string | null
          transaction_hash: string | null
          user_id: string
        }
        Insert: {
          amount?: number | null
          blockchain?: string | null
          created_at?: string
          event_type: string
          from_address?: string | null
          id?: string
          processed?: boolean | null
          raw_data?: Json | null
          source_id: string
          timestamp?: string
          to_address?: string | null
          token_symbol?: string | null
          transaction_hash?: string | null
          user_id: string
        }
        Update: {
          amount?: number | null
          blockchain?: string | null
          created_at?: string
          event_type?: string
          from_address?: string | null
          id?: string
          processed?: boolean | null
          raw_data?: Json | null
          source_id?: string
          timestamp?: string
          to_address?: string | null
          token_symbol?: string | null
          transaction_hash?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whale_signal_events_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "ai_data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      mock_coverage: {
        Row: {
          available: number | null
          is_test_mode: boolean | null
          strategy_id: string | null
          symbol: string | null
          total_bought: number | null
          total_sold: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mock_trades_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "trading_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      past_positions_view: {
        Row: {
          amount: number | null
          buy_fees: number | null
          exit_at: string | null
          exit_price: number | null
          exit_value: number | null
          pnl: number | null
          pnl_pct: number | null
          purchase_price: number | null
          purchase_value: number | null
          sell_fees: number | null
          sell_trade_id: string | null
          strategy_id: string | null
          symbol: string | null
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          buy_fees?: number | null
          exit_at?: string | null
          exit_price?: number | null
          exit_value?: never
          pnl?: number | null
          pnl_pct?: number | null
          purchase_price?: number | null
          purchase_value?: number | null
          sell_fees?: number | null
          sell_trade_id?: string | null
          strategy_id?: string | null
          symbol?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          buy_fees?: number | null
          exit_at?: string | null
          exit_price?: number | null
          exit_value?: never
          pnl?: number | null
          pnl_pct?: number | null
          purchase_price?: number | null
          purchase_value?: number | null
          sell_fees?: number | null
          sell_trade_id?: string | null
          strategy_id?: string | null
          symbol?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mock_trades_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "trading_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      price_data_with_indicators: {
        Row: {
          close_price: number | null
          created_at: string | null
          has_indicators: boolean | null
          high_price: number | null
          id: string | null
          interval_type: string | null
          low_price: number | null
          metadata: Json | null
          open_price: number | null
          source: string | null
          source_id: string | null
          symbol: string | null
          timestamp: string | null
          user_id: string | null
          volume: number | null
        }
        Insert: {
          close_price?: number | null
          created_at?: string | null
          has_indicators?: never
          high_price?: number | null
          id?: string | null
          interval_type?: string | null
          low_price?: number | null
          metadata?: Json | null
          open_price?: number | null
          source?: string | null
          source_id?: string | null
          symbol?: string | null
          timestamp?: string | null
          user_id?: string | null
          volume?: number | null
        }
        Update: {
          close_price?: number | null
          created_at?: string | null
          has_indicators?: never
          high_price?: number | null
          id?: string | null
          interval_type?: string | null
          low_price?: number | null
          metadata?: Json | null
          open_price?: number | null
          source?: string | null
          source_id?: string | null
          symbol?: string | null
          timestamp?: string | null
          user_id?: string | null
          volume?: number | null
        }
        Relationships: []
      }
      user_connections_safe: {
        Row: {
          coinbase_user_id: string | null
          connected_at: string | null
          connection_type: string | null
          expires_at: string | null
          has_credentials: boolean | null
          id: string | null
          is_active: boolean | null
          last_sync: string | null
          user_id: string | null
        }
        Insert: {
          coinbase_user_id?: string | null
          connected_at?: string | null
          connection_type?: never
          expires_at?: string | null
          has_credentials?: never
          id?: string | null
          is_active?: boolean | null
          last_sync?: string | null
          user_id?: string | null
        }
        Update: {
          coinbase_user_id?: string | null
          connected_at?: string | null
          connection_type?: never
          expires_at?: string | null
          has_credentials?: never
          id?: string | null
          is_active?: boolean | null
          last_sync?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      v_decision_mix_24h: {
        Row: {
          cnt: number | null
          decision_action: string | null
          decision_reason: string | null
        }
        Relationships: []
      }
      v_decisions_timeseries_24h: {
        Row: {
          bucket: string | null
          cnt: number | null
          decision_action: string | null
        }
        Relationships: []
      }
      v_defer_health_15m: {
        Row: {
          defer_count: number | null
          defer_rate_pct: number | null
          total_count: number | null
          window_end: string | null
          window_start: string | null
        }
        Relationships: []
      }
      v_internal_errors_1h: {
        Row: {
          internal_error_count: number | null
          window_end: string | null
          window_start: string | null
        }
        Relationships: []
      }
      v_unexpected_reasons_24h: {
        Row: {
          cnt: number | null
          decision_action: string | null
          decision_reason: string | null
        }
        Relationships: []
      }
      vw_trade_decision_linkage_60m: {
        Row: {
          cryptocurrency: string | null
          decision_time: string | null
          executed_at: string | null
          intent_side: string | null
          request_id: string | null
          seconds_apart: number | null
          strategy_trigger: string | null
          trade_type: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_get_connection_name: {
        Args: { connection_id: string }
        Returns: string
      }
      admin_list_past_positions: {
        Args: { p_user: string }
        Returns: {
          amount: number
          buy_fees: number
          exit_at: string
          exit_price: number
          exit_value: number
          pnl: number
          pnl_pct: number
          purchase_price: number
          purchase_value: number
          sell_fees: number
          sell_trade_id: string
          symbol: string
        }[]
      }
      admin_seed_sequence: {
        Args: {
          p_account_type: string
          p_amount: number
          p_buy_price: number
          p_fee_rate: number
          p_sell_price: number
          p_symbol: string
          p_user: string
        }
        Returns: {
          amount: number
          buy_fees: number
          executed_at: string
          exit_price: number
          exit_value: number
          purchase_price: number
          purchase_value: number
          realized_pnl: number
          realized_pnl_pct: number
          sell_fees: number
          sell_id: string
          symbol: string
          user_id: string
        }[]
      }
      armor: {
        Args: { "": string }
        Returns: string
      }
      dearmor: {
        Args: { "": string }
        Returns: string
      }
      debug_decision_logs: {
        Args: { minutes_back?: number; my_user: string }
        Returns: {
          confidence: number
          created_at: string
          decision_action: string
          decision_reason: string
          intent_side: string
          symbol: string
        }[]
      }
      fetch_coinbase_connection_name: {
        Args: { connection_id: string }
        Returns: string
      }
      gen_random_bytes: {
        Args: { "": number }
        Returns: string
      }
      gen_random_uuid: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      gen_salt: {
        Args: { "": string }
        Returns: string
      }
      get_active_oauth_credentials: {
        Args: Record<PropertyKey, never>
        Returns: {
          client_id_encrypted: string
          is_sandbox: boolean
        }[]
      }
      get_user_connection_status: {
        Args: { connection_id: string }
        Returns: {
          connected_at: string
          connection_type: string
          expires_at: string
          has_credentials: boolean
          id: string
          is_active: boolean
          last_sync: string
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      log_connection_access: {
        Args: { access_type?: string; connection_id: string }
        Returns: undefined
      }
      pg_advisory_unlock: {
        Args: { key: number }
        Returns: boolean
      }
      pg_try_advisory_lock: {
        Args: { key: number }
        Returns: boolean
      }
      pgp_armor_headers: {
        Args: { "": string }
        Returns: Record<string, unknown>[]
      }
      pgp_key_id: {
        Args: { "": string }
        Returns: string
      }
      reset_mock_wallet_balances: {
        Args: { target_balance?: number }
        Returns: undefined
      }
      reset_user_test_portfolio: {
        Args: { target_balance?: number }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
