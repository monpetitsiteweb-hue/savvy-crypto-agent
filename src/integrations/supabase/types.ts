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
          user_id: string | null
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
          user_id?: string | null
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
          user_id?: string | null
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
      calibration_metrics: {
        Row: {
          computed_at: string
          confidence_band: string
          coverage_pct: number
          created_at: string
          horizon: string
          id: string
          mean_expectation_error_pct: number | null
          mean_realized_pnl_pct: number | null
          median_mae_pct: number | null
          median_mfe_pct: number | null
          median_realized_pnl_pct: number | null
          missed_opportunity_pct: number
          reliability_correlation: number | null
          sample_count: number
          sl_hit_rate_pct: number
          strategy_id: string
          symbol: string
          time_window: string
          tp_hit_rate_pct: number
          updated_at: string
          user_id: string
          volatility_regime: string | null
          win_rate_pct: number
          window_days: number
          window_end_ts: string
          window_start_ts: string
        }
        Insert: {
          computed_at?: string
          confidence_band: string
          coverage_pct?: number
          created_at?: string
          horizon: string
          id?: string
          mean_expectation_error_pct?: number | null
          mean_realized_pnl_pct?: number | null
          median_mae_pct?: number | null
          median_mfe_pct?: number | null
          median_realized_pnl_pct?: number | null
          missed_opportunity_pct?: number
          reliability_correlation?: number | null
          sample_count?: number
          sl_hit_rate_pct?: number
          strategy_id: string
          symbol: string
          time_window?: string
          tp_hit_rate_pct?: number
          updated_at?: string
          user_id: string
          volatility_regime?: string | null
          win_rate_pct?: number
          window_days?: number
          window_end_ts?: string
          window_start_ts?: string
        }
        Update: {
          computed_at?: string
          confidence_band?: string
          coverage_pct?: number
          created_at?: string
          horizon?: string
          id?: string
          mean_expectation_error_pct?: number | null
          mean_realized_pnl_pct?: number | null
          median_mae_pct?: number | null
          median_mfe_pct?: number | null
          median_realized_pnl_pct?: number | null
          missed_opportunity_pct?: number
          reliability_correlation?: number | null
          sample_count?: number
          sl_hit_rate_pct?: number
          strategy_id?: string
          symbol?: string
          time_window?: string
          tp_hit_rate_pct?: number
          updated_at?: string
          user_id?: string
          volatility_regime?: string | null
          win_rate_pct?: number
          window_days?: number
          window_end_ts?: string
          window_start_ts?: string
        }
        Relationships: []
      }
      calibration_suggestions: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          based_on_window: string
          confidence_score: number
          created_at: string
          current_value: number | null
          dismissed_at: string | null
          dismissed_by: string | null
          expected_impact_pct: number | null
          horizon: string
          id: string
          reason: string
          sample_size: number
          status: string
          strategy_id: string
          suggested_value: number | null
          suggestion_type: string
          symbol: string
          updated_at: string
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          based_on_window: string
          confidence_score?: number
          created_at?: string
          current_value?: number | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          expected_impact_pct?: number | null
          horizon: string
          id?: string
          reason: string
          sample_size?: number
          status?: string
          strategy_id: string
          suggested_value?: number | null
          suggestion_type: string
          symbol: string
          updated_at?: string
          user_id: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          based_on_window?: string
          confidence_score?: number
          created_at?: string
          current_value?: number | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          expected_impact_pct?: number | null
          horizon?: string
          id?: string
          reason?: string
          sample_size?: number
          status?: string
          strategy_id?: string
          suggested_value?: number | null
          suggestion_type?: string
          symbol?: string
          updated_at?: string
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
      decision_events: {
        Row: {
          confidence: number | null
          created_at: string
          decision_ts: string
          entry_price: number | null
          expected_pnl_pct: number | null
          id: string
          metadata: Json | null
          qty_suggested: number | null
          raw_intent: Json | null
          reason: string | null
          side: string
          sl_pct: number | null
          source: string
          strategy_id: string
          symbol: string
          tp_pct: number | null
          trade_id: string | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          decision_ts?: string
          entry_price?: number | null
          expected_pnl_pct?: number | null
          id?: string
          metadata?: Json | null
          qty_suggested?: number | null
          raw_intent?: Json | null
          reason?: string | null
          side: string
          sl_pct?: number | null
          source: string
          strategy_id: string
          symbol: string
          tp_pct?: number | null
          trade_id?: string | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          decision_ts?: string
          entry_price?: number | null
          expected_pnl_pct?: number | null
          id?: string
          metadata?: Json | null
          qty_suggested?: number | null
          raw_intent?: Json | null
          reason?: string | null
          side?: string
          sl_pct?: number | null
          source?: string
          strategy_id?: string
          symbol?: string
          tp_pct?: number | null
          trade_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      decision_events_backup_all: {
        Row: {
          confidence: number | null
          created_at: string | null
          decision_ts: string | null
          entry_price: number | null
          expected_pnl_pct: number | null
          id: string | null
          metadata: Json | null
          qty_suggested: number | null
          raw_intent: Json | null
          reason: string | null
          side: string | null
          sl_pct: number | null
          source: string | null
          strategy_id: string | null
          symbol: string | null
          tp_pct: number | null
          trade_id: string | null
          user_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          decision_ts?: string | null
          entry_price?: number | null
          expected_pnl_pct?: number | null
          id?: string | null
          metadata?: Json | null
          qty_suggested?: number | null
          raw_intent?: Json | null
          reason?: string | null
          side?: string | null
          sl_pct?: number | null
          source?: string | null
          strategy_id?: string | null
          symbol?: string | null
          tp_pct?: number | null
          trade_id?: string | null
          user_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          decision_ts?: string | null
          entry_price?: number | null
          expected_pnl_pct?: number | null
          id?: string | null
          metadata?: Json | null
          qty_suggested?: number | null
          raw_intent?: Json | null
          reason?: string | null
          side?: string | null
          sl_pct?: number | null
          source?: string | null
          strategy_id?: string | null
          symbol?: string | null
          tp_pct?: number | null
          trade_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      decision_events_backup_legacy: {
        Row: {
          confidence: number | null
          created_at: string | null
          decision_ts: string | null
          entry_price: number | null
          expected_pnl_pct: number | null
          id: string | null
          metadata: Json | null
          qty_suggested: number | null
          raw_intent: Json | null
          reason: string | null
          side: string | null
          sl_pct: number | null
          source: string | null
          strategy_id: string | null
          symbol: string | null
          tp_pct: number | null
          trade_id: string | null
          user_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          decision_ts?: string | null
          entry_price?: number | null
          expected_pnl_pct?: number | null
          id?: string | null
          metadata?: Json | null
          qty_suggested?: number | null
          raw_intent?: Json | null
          reason?: string | null
          side?: string | null
          sl_pct?: number | null
          source?: string | null
          strategy_id?: string | null
          symbol?: string | null
          tp_pct?: number | null
          trade_id?: string | null
          user_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          decision_ts?: string | null
          entry_price?: number | null
          expected_pnl_pct?: number | null
          id?: string | null
          metadata?: Json | null
          qty_suggested?: number | null
          raw_intent?: Json | null
          reason?: string | null
          side?: string | null
          sl_pct?: number | null
          source?: string | null
          strategy_id?: string | null
          symbol?: string | null
          tp_pct?: number | null
          trade_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      decision_events_legacy: {
        Row: {
          confidence: number | null
          created_at: string | null
          decision_ts: string | null
          entry_price: number | null
          expected_pnl_pct: number | null
          id: string | null
          metadata: Json | null
          qty_suggested: number | null
          raw_intent: Json | null
          reason: string | null
          side: string | null
          sl_pct: number | null
          source: string | null
          strategy_id: string | null
          symbol: string | null
          tp_pct: number | null
          trade_id: string | null
          user_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          decision_ts?: string | null
          entry_price?: number | null
          expected_pnl_pct?: number | null
          id?: string | null
          metadata?: Json | null
          qty_suggested?: number | null
          raw_intent?: Json | null
          reason?: string | null
          side?: string | null
          sl_pct?: number | null
          source?: string | null
          strategy_id?: string | null
          symbol?: string | null
          tp_pct?: number | null
          trade_id?: string | null
          user_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          decision_ts?: string | null
          entry_price?: number | null
          expected_pnl_pct?: number | null
          id?: string | null
          metadata?: Json | null
          qty_suggested?: number | null
          raw_intent?: Json | null
          reason?: string | null
          side?: string | null
          sl_pct?: number | null
          source?: string | null
          strategy_id?: string | null
          symbol?: string | null
          tp_pct?: number | null
          trade_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      decision_outcomes: {
        Row: {
          created_at: string
          decision_id: string
          evaluated_at: string
          expectation_error_pct: number | null
          hit_sl: boolean | null
          hit_tp: boolean | null
          horizon: string
          id: string
          mae_pct: number | null
          mfe_pct: number | null
          missed_opportunity: boolean | null
          realized_pnl_pct: number | null
          symbol: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decision_id: string
          evaluated_at?: string
          expectation_error_pct?: number | null
          hit_sl?: boolean | null
          hit_tp?: boolean | null
          horizon: string
          id?: string
          mae_pct?: number | null
          mfe_pct?: number | null
          missed_opportunity?: boolean | null
          realized_pnl_pct?: number | null
          symbol: string
          user_id: string
        }
        Update: {
          created_at?: string
          decision_id?: string
          evaluated_at?: string
          expectation_error_pct?: number | null
          hit_sl?: boolean | null
          hit_tp?: boolean | null
          horizon?: string
          id?: string
          mae_pct?: number | null
          mfe_pct?: number | null
          missed_opportunity?: boolean | null
          realized_pnl_pct?: number | null
          symbol?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_outcomes_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decision_events"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_circuit_breakers: {
        Row: {
          activated_at: string | null
          breaker: string
          cleared_at: string | null
          created_at: string
          current_value: number
          id: string
          is_active: boolean
          last_reason: string | null
          last_reset_at: string | null
          strategy_id: string
          symbol: string
          threshold_value: number
          thresholds: Json | null
          trip_count: number
          trip_reason: string | null
          tripped: boolean
          tripped_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          breaker: string
          cleared_at?: string | null
          created_at?: string
          current_value?: number
          id?: string
          is_active?: boolean
          last_reason?: string | null
          last_reset_at?: string | null
          strategy_id: string
          symbol: string
          threshold_value?: number
          thresholds?: Json | null
          trip_count?: number
          trip_reason?: string | null
          tripped?: boolean
          tripped_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          breaker?: string
          cleared_at?: string | null
          created_at?: string
          current_value?: number
          id?: string
          is_active?: boolean
          last_reason?: string | null
          last_reset_at?: string | null
          strategy_id?: string
          symbol?: string
          threshold_value?: number
          thresholds?: Json | null
          trip_count?: number
          trip_reason?: string | null
          tripped?: boolean
          tripped_at?: string | null
          updated_at?: string
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
      execution_jobs: {
        Row: {
          amount: number
          confirmed_at: string | null
          created_at: string
          error_message: string | null
          execution_mode: string
          execution_target: string
          id: string
          idempotency_key: string | null
          kind: string
          locked_at: string | null
          payload: Json
          side: string
          status: string
          strategy_id: string
          submitted_at: string | null
          symbol: string
          tx_hash: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          confirmed_at?: string | null
          created_at?: string
          error_message?: string | null
          execution_mode: string
          execution_target: string
          id?: string
          idempotency_key?: string | null
          kind: string
          locked_at?: string | null
          payload?: Json
          side: string
          status?: string
          strategy_id: string
          submitted_at?: string | null
          symbol: string
          tx_hash?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          confirmed_at?: string | null
          created_at?: string
          error_message?: string | null
          execution_mode?: string
          execution_target?: string
          id?: string
          idempotency_key?: string | null
          kind?: string
          locked_at?: string | null
          payload?: Json
          side?: string
          status?: string
          strategy_id?: string
          submitted_at?: string | null
          symbol?: string
          tx_hash?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_jobs_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "trading_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_locks: {
        Row: {
          acquired_at: string
          expires_at: string
          lock_key: string
          request_id: string | null
          strategy_id: string
          symbol: string
          user_id: string
        }
        Insert: {
          acquired_at?: string
          expires_at?: string
          lock_key: string
          request_id?: string | null
          strategy_id: string
          symbol: string
          user_id: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          lock_key?: string
          request_id?: string | null
          strategy_id?: string
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      execution_quality_log: {
        Row: {
          context: string | null
          created_at: string
          executed_at: string
          executed_price: number
          execution_latency_ms: number
          fee_pct: number | null
          fill_ms: number | null
          filled_amount: number
          id: string
          liquidity_score: number | null
          meta: Json | null
          metadata: Json | null
          partial_fill: boolean
          requested_amount: number
          requested_price: number | null
          side: string
          slippage_bps: number
          spread_pct: number | null
          status: string | null
          strategy_id: string
          symbol: string
          ts: string
          user_id: string
        }
        Insert: {
          context?: string | null
          created_at?: string
          executed_at?: string
          executed_price: number
          execution_latency_ms?: number
          fee_pct?: number | null
          fill_ms?: number | null
          filled_amount: number
          id?: string
          liquidity_score?: number | null
          meta?: Json | null
          metadata?: Json | null
          partial_fill?: boolean
          requested_amount: number
          requested_price?: number | null
          side: string
          slippage_bps?: number
          spread_pct?: number | null
          status?: string | null
          strategy_id: string
          symbol: string
          ts: string
          user_id: string
        }
        Update: {
          context?: string | null
          created_at?: string
          executed_at?: string
          executed_price?: number
          execution_latency_ms?: number
          fee_pct?: number | null
          fill_ms?: number | null
          filled_amount?: number
          id?: string
          liquidity_score?: number | null
          meta?: Json | null
          metadata?: Json | null
          partial_fill?: boolean
          requested_amount?: number
          requested_price?: number | null
          side?: string
          slippage_bps?: number
          spread_pct?: number | null
          status?: string | null
          strategy_id?: string
          symbol?: string
          ts?: string
          user_id?: string
        }
        Relationships: []
      }
      execution_wallet_balance_snapshots: {
        Row: {
          balance: number
          balance_raw: string
          chain_id: number
          created_at: string
          decimals: number
          id: string
          observed_at: string
          source: string
          symbol: string
          token_address: string | null
          user_id: string
          wallet_address: string
        }
        Insert: {
          balance: number
          balance_raw: string
          chain_id?: number
          created_at?: string
          decimals?: number
          id?: string
          observed_at?: string
          source?: string
          symbol: string
          token_address?: string | null
          user_id: string
          wallet_address: string
        }
        Update: {
          balance?: number
          balance_raw?: string
          chain_id?: number
          created_at?: string
          decimals?: number
          id?: string
          observed_at?: string
          source?: string
          symbol?: string
          token_address?: string | null
          user_id?: string
          wallet_address?: string
        }
        Relationships: []
      }
      execution_wallet_secrets: {
        Row: {
          auth_tag_b64: string
          dek_auth_tag_b64: string
          dek_iv_b64: string
          encrypted_dek_b64: string
          encrypted_private_key_b64: string
          iv_b64: string
          kek_version: number
          wallet_id: string
        }
        Insert: {
          auth_tag_b64: string
          dek_auth_tag_b64: string
          dek_iv_b64: string
          encrypted_dek_b64: string
          encrypted_private_key_b64: string
          iv_b64: string
          kek_version?: number
          wallet_id: string
        }
        Update: {
          auth_tag_b64?: string
          dek_auth_tag_b64?: string
          dek_iv_b64?: string
          encrypted_dek_b64?: string
          encrypted_private_key_b64?: string
          iv_b64?: string
          kek_version?: number
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_wallet_secrets_wallet_id_fkey1"
            columns: ["wallet_id"]
            isOneToOne: true
            referencedRelation: "execution_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_wallet_secrets_old: {
        Row: {
          auth_tag: string
          auth_tag_b64: string | null
          created_at: string
          dek_auth_tag: string
          dek_auth_tag_b64: string | null
          dek_iv: string
          dek_iv_b64: string | null
          encrypted_dek: string
          encrypted_dek_b64: string | null
          encrypted_private_key: string
          encrypted_private_key_b64: string | null
          id: string
          iv: string
          iv_b64: string | null
          kek_version: number
          secrets_format: string | null
          wallet_id: string
        }
        Insert: {
          auth_tag: string
          auth_tag_b64?: string | null
          created_at?: string
          dek_auth_tag: string
          dek_auth_tag_b64?: string | null
          dek_iv: string
          dek_iv_b64?: string | null
          encrypted_dek: string
          encrypted_dek_b64?: string | null
          encrypted_private_key: string
          encrypted_private_key_b64?: string | null
          id?: string
          iv: string
          iv_b64?: string | null
          kek_version?: number
          secrets_format?: string | null
          wallet_id: string
        }
        Update: {
          auth_tag?: string
          auth_tag_b64?: string | null
          created_at?: string
          dek_auth_tag?: string
          dek_auth_tag_b64?: string | null
          dek_iv?: string
          dek_iv_b64?: string | null
          encrypted_dek?: string
          encrypted_dek_b64?: string | null
          encrypted_private_key?: string
          encrypted_private_key_b64?: string | null
          id?: string
          iv?: string
          iv_b64?: string | null
          kek_version?: number
          secrets_format?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_wallet_secrets_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: true
            referencedRelation: "execution_wallets_old"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_wallet_secrets_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: true
            referencedRelation: "user_wallet_info"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_wallets: {
        Row: {
          chain_id: number
          created_at: string
          funded_amount_wei: string | null
          funded_at: string | null
          id: string
          is_active: boolean
          is_funded: boolean
          updated_at: string
          user_id: string
          wallet_address: string
        }
        Insert: {
          chain_id?: number
          created_at?: string
          funded_amount_wei?: string | null
          funded_at?: string | null
          id?: string
          is_active?: boolean
          is_funded?: boolean
          updated_at?: string
          user_id: string
          wallet_address: string
        }
        Update: {
          chain_id?: number
          created_at?: string
          funded_amount_wei?: string | null
          funded_at?: string | null
          id?: string
          is_active?: boolean
          is_funded?: boolean
          updated_at?: string
          user_id?: string
          wallet_address?: string
        }
        Relationships: []
      }
      execution_wallets_old: {
        Row: {
          chain_id: number
          created_at: string
          funded_amount_wei: string | null
          funded_at: string | null
          funding_tx_hash: string | null
          id: string
          is_active: boolean
          is_funded: boolean
          updated_at: string
          user_id: string
          wallet_address: string
        }
        Insert: {
          chain_id?: number
          created_at?: string
          funded_amount_wei?: string | null
          funded_at?: string | null
          funding_tx_hash?: string | null
          id?: string
          is_active?: boolean
          is_funded?: boolean
          updated_at?: string
          user_id: string
          wallet_address: string
        }
        Update: {
          chain_id?: number
          created_at?: string
          funded_amount_wei?: string | null
          funded_at?: string | null
          funding_tx_hash?: string | null
          id?: string
          is_active?: boolean
          is_funded?: boolean
          updated_at?: string
          user_id?: string
          wallet_address?: string
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
      knowledge_documents: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata: Json | null
          source_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata?: Json | null
          source_id: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          source_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "ai_data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_embeddings: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          metadata: Json | null
        }
        Insert: {
          chunk_index?: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_embeddings_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
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
      market_data_health: {
        Row: {
          coverage_pct_90d: number | null
          error_count_24h: number | null
          granularity: string
          last_backfill_at: string | null
          last_live_ingest_at: string | null
          last_ts_utc: string | null
          max_staleness_min: number | null
          symbol: string
          updated_at: string | null
        }
        Insert: {
          coverage_pct_90d?: number | null
          error_count_24h?: number | null
          granularity: string
          last_backfill_at?: string | null
          last_live_ingest_at?: string | null
          last_ts_utc?: string | null
          max_staleness_min?: number | null
          symbol: string
          updated_at?: string | null
        }
        Update: {
          coverage_pct_90d?: number | null
          error_count_24h?: number | null
          granularity?: string
          last_backfill_at?: string | null
          last_live_ingest_at?: string | null
          last_ts_utc?: string | null
          max_staleness_min?: number | null
          symbol?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      market_features_v0: {
        Row: {
          created_at: string | null
          ema_20: number | null
          ema_200: number | null
          ema_50: number | null
          granularity: string
          macd_hist: number | null
          macd_line: number | null
          macd_signal: number | null
          ret_1h: number | null
          ret_24h: number | null
          ret_4h: number | null
          ret_7d: number | null
          rsi_14: number | null
          symbol: string
          ts_utc: string
          updated_at: string | null
          vol_1h: number | null
          vol_24h: number | null
          vol_4h: number | null
          vol_7d: number | null
        }
        Insert: {
          created_at?: string | null
          ema_20?: number | null
          ema_200?: number | null
          ema_50?: number | null
          granularity: string
          macd_hist?: number | null
          macd_line?: number | null
          macd_signal?: number | null
          ret_1h?: number | null
          ret_24h?: number | null
          ret_4h?: number | null
          ret_7d?: number | null
          rsi_14?: number | null
          symbol: string
          ts_utc: string
          updated_at?: string | null
          vol_1h?: number | null
          vol_24h?: number | null
          vol_4h?: number | null
          vol_7d?: number | null
        }
        Update: {
          created_at?: string | null
          ema_20?: number | null
          ema_200?: number | null
          ema_50?: number | null
          granularity?: string
          macd_hist?: number | null
          macd_line?: number | null
          macd_signal?: number | null
          ret_1h?: number | null
          ret_24h?: number | null
          ret_4h?: number | null
          ret_7d?: number | null
          rsi_14?: number | null
          symbol?: string
          ts_utc?: string
          updated_at?: string | null
          vol_1h?: number | null
          vol_24h?: number | null
          vol_4h?: number | null
          vol_7d?: number | null
        }
        Relationships: []
      }
      market_ohlcv_raw: {
        Row: {
          close: number
          created_at: string | null
          granularity: string
          high: number
          low: number
          open: number
          symbol: string
          ts_utc: string
          volume: number | null
        }
        Insert: {
          close: number
          created_at?: string | null
          granularity: string
          high: number
          low: number
          open: number
          symbol: string
          ts_utc: string
          volume?: number | null
        }
        Update: {
          close?: number
          created_at?: string | null
          granularity?: string
          high?: number
          low?: number
          open?: number
          symbol?: string
          ts_utc?: string
          volume?: number | null
        }
        Relationships: []
      }
      mock_trades: {
        Row: {
          amount: number
          amount_in_wei: number | null
          amount_out_wei: number | null
          buy_fees: number | null
          chain_id: number | null
          cryptocurrency: string
          effective_bps_cost: number | null
          executed_at: string
          execution_confirmed: boolean | null
          execution_mode: string | null
          execution_source: string | null
          execution_ts: string | null
          exit_value: number | null
          fee_native_wei: number | null
          fees: number | null
          gas_cost_eth: number | null
          gas_cost_eur: number | null
          gas_cost_pct: number | null
          gas_estimate_wei: number | null
          gas_used_wei: number | null
          id: string
          idempotency_key: string | null
          integrity_reason: string | null
          is_corrupted: boolean
          is_system_operator: boolean
          is_test_mode: boolean
          market_conditions: Json | null
          mev_route: string | null
          notes: string | null
          original_purchase_amount: number | null
          original_purchase_price: number | null
          original_purchase_value: number | null
          original_trade_id: string | null
          pnl_at_decision_pct: number | null
          price: number
          price_impact_bps: number | null
          price_quoted: number | null
          price_realized: number | null
          profit_loss: number | null
          provider: string | null
          quote_age_ms: number | null
          realized_pnl: number | null
          realized_pnl_pct: number | null
          route_source: string | null
          router: string | null
          sell_fees: number | null
          slippage_bps: number | null
          strategy_id: string | null
          strategy_trigger: string | null
          token_in: string | null
          token_out: string | null
          total_value: number
          trade_type: string
          tx_hash: string | null
          user_id: string
        }
        Insert: {
          amount: number
          amount_in_wei?: number | null
          amount_out_wei?: number | null
          buy_fees?: number | null
          chain_id?: number | null
          cryptocurrency: string
          effective_bps_cost?: number | null
          executed_at?: string
          execution_confirmed?: boolean | null
          execution_mode?: string | null
          execution_source?: string | null
          execution_ts?: string | null
          exit_value?: number | null
          fee_native_wei?: number | null
          fees?: number | null
          gas_cost_eth?: number | null
          gas_cost_eur?: number | null
          gas_cost_pct?: number | null
          gas_estimate_wei?: number | null
          gas_used_wei?: number | null
          id?: string
          idempotency_key?: string | null
          integrity_reason?: string | null
          is_corrupted?: boolean
          is_system_operator?: boolean
          is_test_mode?: boolean
          market_conditions?: Json | null
          mev_route?: string | null
          notes?: string | null
          original_purchase_amount?: number | null
          original_purchase_price?: number | null
          original_purchase_value?: number | null
          original_trade_id?: string | null
          pnl_at_decision_pct?: number | null
          price: number
          price_impact_bps?: number | null
          price_quoted?: number | null
          price_realized?: number | null
          profit_loss?: number | null
          provider?: string | null
          quote_age_ms?: number | null
          realized_pnl?: number | null
          realized_pnl_pct?: number | null
          route_source?: string | null
          router?: string | null
          sell_fees?: number | null
          slippage_bps?: number | null
          strategy_id?: string | null
          strategy_trigger?: string | null
          token_in?: string | null
          token_out?: string | null
          total_value: number
          trade_type: string
          tx_hash?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          amount_in_wei?: number | null
          amount_out_wei?: number | null
          buy_fees?: number | null
          chain_id?: number | null
          cryptocurrency?: string
          effective_bps_cost?: number | null
          executed_at?: string
          execution_confirmed?: boolean | null
          execution_mode?: string | null
          execution_source?: string | null
          execution_ts?: string | null
          exit_value?: number | null
          fee_native_wei?: number | null
          fees?: number | null
          gas_cost_eth?: number | null
          gas_cost_eur?: number | null
          gas_cost_pct?: number | null
          gas_estimate_wei?: number | null
          gas_used_wei?: number | null
          id?: string
          idempotency_key?: string | null
          integrity_reason?: string | null
          is_corrupted?: boolean
          is_system_operator?: boolean
          is_test_mode?: boolean
          market_conditions?: Json | null
          mev_route?: string | null
          notes?: string | null
          original_purchase_amount?: number | null
          original_purchase_price?: number | null
          original_purchase_value?: number | null
          original_trade_id?: string | null
          pnl_at_decision_pct?: number | null
          price?: number
          price_impact_bps?: number | null
          price_quoted?: number | null
          price_realized?: number | null
          profit_loss?: number | null
          provider?: string | null
          quote_age_ms?: number | null
          realized_pnl?: number | null
          realized_pnl_pct?: number | null
          route_source?: string | null
          router?: string | null
          sell_fees?: number | null
          slippage_bps?: number | null
          strategy_id?: string | null
          strategy_trigger?: string | null
          token_in?: string | null
          token_out?: string | null
          total_value?: number
          trade_type?: string
          tx_hash?: string | null
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
      portfolio_capital: {
        Row: {
          cash_balance_eur: number
          created_at: string
          reserved_eur: number
          starting_capital_eur: number
          updated_at: string
          user_id: string
        }
        Insert: {
          cash_balance_eur?: number
          created_at?: string
          reserved_eur?: number
          starting_capital_eur?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          cash_balance_eur?: number
          created_at?: string
          reserved_eur?: number
          starting_capital_eur?: number
          updated_at?: string
          user_id?: string
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
          wallet_address: string | null
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
          wallet_address?: string | null
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
          wallet_address?: string | null
        }
        Relationships: []
      }
      real_trades: {
        Row: {
          amount: number
          block_number: number | null
          block_timestamp: string | null
          chain_id: number
          created_at: string
          cryptocurrency: string
          decode_method: string | null
          error_reason: string | null
          execution_authority: string
          execution_status: string
          execution_target: string
          fees: number | null
          gas_used: number | null
          id: string
          is_system_operator: boolean
          price: number | null
          provider: string | null
          raw_receipt: Json | null
          receipt_status: boolean | null
          side: string
          strategy_id: string | null
          total_value: number | null
          trade_id: string
          tx_hash: string
          user_id: string | null
        }
        Insert: {
          amount: number
          block_number?: number | null
          block_timestamp?: string | null
          chain_id?: number
          created_at?: string
          cryptocurrency: string
          decode_method?: string | null
          error_reason?: string | null
          execution_authority: string
          execution_status: string
          execution_target?: string
          fees?: number | null
          gas_used?: number | null
          id?: string
          is_system_operator: boolean
          price?: number | null
          provider?: string | null
          raw_receipt?: Json | null
          receipt_status?: boolean | null
          side: string
          strategy_id?: string | null
          total_value?: number | null
          trade_id: string
          tx_hash: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          block_number?: number | null
          block_timestamp?: string | null
          chain_id?: number
          created_at?: string
          cryptocurrency?: string
          decode_method?: string | null
          error_reason?: string | null
          execution_authority?: string
          execution_status?: string
          execution_target?: string
          fees?: number | null
          gas_used?: number | null
          id?: string
          is_system_operator?: boolean
          price?: number | null
          provider?: string | null
          raw_receipt?: Json | null
          receipt_status?: boolean | null
          side?: string
          strategy_id?: string | null
          total_value?: number | null
          trade_id?: string
          tx_hash?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_real_trades_mock"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "mock_trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_real_trades_mock"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "past_positions_view"
            referencedColumns: ["sell_trade_id"]
          },
          {
            foreignKeyName: "fk_real_trades_mock"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "strategy_open_positions"
            referencedColumns: ["lot_id"]
          },
        ]
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
          ip_address: unknown
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
          ip_address?: unknown
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
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      signal_registry: {
        Row: {
          category: string
          created_at: string
          default_weight: number
          description: string | null
          direction_hint: string
          id: string
          is_enabled: boolean
          key: string
          max_weight: number
          min_weight: number
          timeframe_hint: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          default_weight?: number
          description?: string | null
          direction_hint?: string
          id?: string
          is_enabled?: boolean
          key: string
          max_weight?: number
          min_weight?: number
          timeframe_hint?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          default_weight?: number
          description?: string | null
          direction_hint?: string
          id?: string
          is_enabled?: boolean
          key?: string
          max_weight?: number
          min_weight?: number
          timeframe_hint?: string
          updated_at?: string
        }
        Relationships: []
      }
      strategy_parameters: {
        Row: {
          ai_weight: number
          created_at: string
          id: string
          last_optimizer_run_at: string | null
          last_updated_by: string
          metadata: Json
          min_confidence: number
          optimization_iteration: number
          sl_pct: number
          strategy_id: string
          symbol: string
          technical_weight: number
          tp_pct: number
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_weight?: number
          created_at?: string
          id?: string
          last_optimizer_run_at?: string | null
          last_updated_by?: string
          metadata?: Json
          min_confidence?: number
          optimization_iteration?: number
          sl_pct?: number
          strategy_id: string
          symbol: string
          technical_weight?: number
          tp_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_weight?: number
          created_at?: string
          id?: string
          last_optimizer_run_at?: string | null
          last_updated_by?: string
          metadata?: Json
          min_confidence?: number
          optimization_iteration?: number
          sl_pct?: number
          strategy_id?: string
          symbol?: string
          technical_weight?: number
          tp_pct?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strategy_parameters_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "trading_strategies"
            referencedColumns: ["id"]
          },
        ]
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
      strategy_signal_weights: {
        Row: {
          created_at: string
          id: string
          is_enabled: boolean
          signal_key: string
          strategy_id: string
          updated_at: string
          weight: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          signal_key: string
          strategy_id: string
          updated_at?: string
          weight?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          signal_key?: string
          strategy_id?: string
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "strategy_signal_weights_signal_key_fkey"
            columns: ["signal_key"]
            isOneToOne: false
            referencedRelation: "signal_registry"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "strategy_signal_weights_strategy_id_fkey"
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
      trade_events: {
        Row: {
          created_at: string
          id: number
          payload: Json | null
          phase: string
          severity: string
          trade_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          payload?: Json | null
          phase: string
          severity?: string
          trade_id: string
        }
        Update: {
          created_at?: string
          id?: number
          payload?: Json | null
          phase?: string
          severity?: string
          trade_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_events_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          amount: number
          base: string
          chain_id: number
          created_at: string
          effective_price: number | null
          gas_quote: number | null
          gas_wei: number | null
          id: string
          is_system_operator: boolean
          min_out: string | null
          mode: string
          notes: string | null
          price: number | null
          provider: string
          quote: string
          raw_quote: Json | null
          receipts: Json | null
          side: string
          simulate_only: boolean
          slippage_bps: number
          status: string
          strategy_id: string | null
          taker: string | null
          total_network_fee: string | null
          tx_hash: string | null
          tx_payload: Json | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount: number
          base: string
          chain_id: number
          created_at?: string
          effective_price?: number | null
          gas_quote?: number | null
          gas_wei?: number | null
          id?: string
          is_system_operator?: boolean
          min_out?: string | null
          mode?: string
          notes?: string | null
          price?: number | null
          provider?: string
          quote: string
          raw_quote?: Json | null
          receipts?: Json | null
          side: string
          simulate_only?: boolean
          slippage_bps?: number
          status?: string
          strategy_id?: string | null
          taker?: string | null
          total_network_fee?: string | null
          tx_hash?: string | null
          tx_payload?: Json | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          base?: string
          chain_id?: number
          created_at?: string
          effective_price?: number | null
          gas_quote?: number | null
          gas_wei?: number | null
          id?: string
          is_system_operator?: boolean
          min_out?: string | null
          mode?: string
          notes?: string | null
          price?: number | null
          provider?: string
          quote?: string
          raw_quote?: Json | null
          receipts?: Json | null
          side?: string
          simulate_only?: boolean
          slippage_bps?: number
          status?: string
          strategy_id?: string | null
          taker?: string | null
          total_network_fee?: string | null
          tx_hash?: string | null
          tx_payload?: Json | null
          updated_at?: string
          user_id?: string | null
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
          chain_id: number | null
          configuration: Json
          created_at: string
          description: string | null
          execution_mode: string | null
          execution_target: string
          id: string
          is_active: boolean
          is_active_live: boolean | null
          is_active_test: boolean | null
          liquidation_batch_id: string | null
          liquidation_requested_at: string | null
          max_gas_cost_pct: number | null
          max_price_impact_bps: number | null
          max_quote_age_ms: number | null
          mev_policy: string | null
          on_disable_policy: string | null
          panic_activated_at: string | null
          panic_active: boolean
          panic_trigger_strategy_id: string | null
          preferred_providers: string[] | null
          slippage_bps_default: number | null
          state: string
          strategy_name: string
          test_mode: boolean | null
          unified_config: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          chain_id?: number | null
          configuration: Json
          created_at?: string
          description?: string | null
          execution_mode?: string | null
          execution_target?: string
          id?: string
          is_active?: boolean
          is_active_live?: boolean | null
          is_active_test?: boolean | null
          liquidation_batch_id?: string | null
          liquidation_requested_at?: string | null
          max_gas_cost_pct?: number | null
          max_price_impact_bps?: number | null
          max_quote_age_ms?: number | null
          mev_policy?: string | null
          on_disable_policy?: string | null
          panic_activated_at?: string | null
          panic_active?: boolean
          panic_trigger_strategy_id?: string | null
          preferred_providers?: string[] | null
          slippage_bps_default?: number | null
          state?: string
          strategy_name: string
          test_mode?: boolean | null
          unified_config?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          chain_id?: number | null
          configuration?: Json
          created_at?: string
          description?: string | null
          execution_mode?: string | null
          execution_target?: string
          id?: string
          is_active?: boolean
          is_active_live?: boolean | null
          is_active_test?: boolean | null
          liquidation_batch_id?: string | null
          liquidation_requested_at?: string | null
          max_gas_cost_pct?: number | null
          max_price_impact_bps?: number | null
          max_quote_age_ms?: number | null
          mev_policy?: string | null
          on_disable_policy?: string | null
          panic_activated_at?: string | null
          panic_active?: boolean
          panic_trigger_strategy_id?: string | null
          preferred_providers?: string[] | null
          slippage_bps_default?: number | null
          state?: string
          strategy_name?: string
          test_mode?: boolean | null
          unified_config?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trading_strategies_panic_trigger_strategy_id_fkey"
            columns: ["panic_trigger_strategy_id"]
            isOneToOne: false
            referencedRelation: "trading_strategies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trading_strategies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_allowlist: {
        Row: {
          address: string
          chain_id: number
          created_at: string
          id: string
          is_active: boolean
          label: string | null
          max_amount_wei: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          chain_id?: number
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          max_amount_wei?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          chain_id?: number
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          max_amount_wei?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      user_onboarding_status: {
        Row: {
          coinbase_connected: boolean
          completed_at: string | null
          created_at: string
          current_step: string
          funding_confirmed: boolean
          funding_initiated: boolean
          id: string
          rules_accepted: boolean
          rules_accepted_at: string | null
          updated_at: string
          user_id: string
          wallet_created: boolean
        }
        Insert: {
          coinbase_connected?: boolean
          completed_at?: string | null
          created_at?: string
          current_step?: string
          funding_confirmed?: boolean
          funding_initiated?: boolean
          id?: string
          rules_accepted?: boolean
          rules_accepted_at?: string | null
          updated_at?: string
          user_id: string
          wallet_created?: boolean
        }
        Update: {
          coinbase_connected?: boolean
          completed_at?: string | null
          created_at?: string
          current_step?: string
          funding_confirmed?: boolean
          funding_initiated?: boolean
          id?: string
          rules_accepted?: boolean
          rules_accepted_at?: string | null
          updated_at?: string
          user_id?: string
          wallet_created?: boolean
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
      wallet_funding_requests: {
        Row: {
          block_number: number | null
          chain_id: number
          coinbase_withdrawal_id: string | null
          confirmed_at: string | null
          created_at: string
          execution_wallet_id: string
          expected_amount_wei: string | null
          id: string
          idempotency_key: string
          initiated_at: string | null
          received_amount_wei: string | null
          requested_amount: string
          requested_amount_wei: string | null
          source_asset: string
          status: string
          status_message: string | null
          tx_hash: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          block_number?: number | null
          chain_id?: number
          coinbase_withdrawal_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          execution_wallet_id: string
          expected_amount_wei?: string | null
          id?: string
          idempotency_key: string
          initiated_at?: string | null
          received_amount_wei?: string | null
          requested_amount: string
          requested_amount_wei?: string | null
          source_asset: string
          status?: string
          status_message?: string | null
          tx_hash?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          block_number?: number | null
          chain_id?: number
          coinbase_withdrawal_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          execution_wallet_id?: string
          expected_amount_wei?: string | null
          id?: string
          idempotency_key?: string
          initiated_at?: string | null
          received_amount_wei?: string | null
          requested_amount?: string
          requested_amount_wei?: string | null
          source_asset?: string
          status?: string
          status_message?: string | null
          tx_hash?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_funding_requests_execution_wallet_id_fkey"
            columns: ["execution_wallet_id"]
            isOneToOne: false
            referencedRelation: "execution_wallets_old"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_funding_requests_execution_wallet_id_fkey"
            columns: ["execution_wallet_id"]
            isOneToOne: false
            referencedRelation: "user_wallet_info"
            referencedColumns: ["id"]
          },
        ]
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
      withdrawal_audit_log: {
        Row: {
          amount: number
          asset: string
          created_at: string
          id: string
          status: string
          to_address: string
          tx_hash: string | null
          user_id: string
          wallet_id: string
        }
        Insert: {
          amount: number
          asset: string
          created_at?: string
          id?: string
          status?: string
          to_address: string
          tx_hash?: string | null
          user_id: string
          wallet_id: string
        }
        Update: {
          amount?: number
          asset?: string
          created_at?: string
          id?: string
          status?: string
          to_address?: string
          tx_hash?: string | null
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_audit_log_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "execution_wallets_old"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_audit_log_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "user_wallet_info"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      execution_quality_metrics_24h: {
        Row: {
          avg_abs_slippage_bps: number | null
          latency_p95_ms: number | null
          partial_fill_rate_pct: number | null
          strategy_id: string | null
          symbol: string | null
          trade_count: number | null
          user_id: string | null
        }
        Relationships: []
      }
      execution_quality_onchain_24h: {
        Row: {
          avg_gas_cost_pct: number | null
          avg_price_impact_bps: number | null
          avg_quote_age_ms: number | null
          avg_slippage_bps: number | null
          chain_id: number | null
          high_slippage_count: number | null
          provider: string | null
          slippage_p95_bps: number | null
          strategy_id: string | null
          trade_count: number | null
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
      real_positions_view: {
        Row: {
          chain_id: number | null
          last_trade_at: string | null
          position_size: number | null
          strategy_id: string | null
          symbol: string | null
          user_id: string | null
        }
        Relationships: []
      }
      real_trade_history_view: {
        Row: {
          block_number: number | null
          block_timestamp: string | null
          chain_id: number | null
          decode_method: string | null
          effective_price: number | null
          error_reason: string | null
          execution_authority: string | null
          execution_recorded_at: string | null
          execution_status: string | null
          execution_target: string | null
          fees: number | null
          filled_quantity: number | null
          gas_used: number | null
          intent_ts: string | null
          is_system_operator: boolean | null
          mock_trade_id: string | null
          provider: string | null
          real_trade_id: string | null
          side: string | null
          strategy_id: string | null
          symbol: string | null
          total_value: number | null
          tx_hash: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_real_trades_mock"
            columns: ["mock_trade_id"]
            isOneToOne: false
            referencedRelation: "mock_trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_real_trades_mock"
            columns: ["mock_trade_id"]
            isOneToOne: false
            referencedRelation: "past_positions_view"
            referencedColumns: ["sell_trade_id"]
          },
          {
            foreignKeyName: "fk_real_trades_mock"
            columns: ["mock_trade_id"]
            isOneToOne: false
            referencedRelation: "strategy_open_positions"
            referencedColumns: ["lot_id"]
          },
        ]
      }
      strategy_open_positions: {
        Row: {
          entry_price: number | null
          execution_target: string | null
          is_test_mode: boolean | null
          lot_id: string | null
          managed_by_strategy: boolean | null
          opened_at: string | null
          remaining_qty: number | null
          strategy_id: string | null
          symbol: string | null
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
          {
            foreignKeyName: "trading_strategies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      user_wallet_info: {
        Row: {
          chain_id: number | null
          created_at: string | null
          funded_amount_wei: string | null
          funded_at: string | null
          id: string | null
          is_active: boolean | null
          is_funded: boolean | null
          updated_at: string | null
          user_id: string | null
          wallet_address: string | null
        }
        Insert: {
          chain_id?: number | null
          created_at?: string | null
          funded_amount_wei?: string | null
          funded_at?: string | null
          id?: string | null
          is_active?: boolean | null
          is_funded?: boolean | null
          updated_at?: string | null
          user_id?: string | null
          wallet_address?: string | null
        }
        Update: {
          chain_id?: number | null
          created_at?: string | null
          funded_amount_wei?: string | null
          funded_at?: string | null
          id?: string | null
          is_active?: boolean | null
          is_funded?: boolean | null
          updated_at?: string | null
          user_id?: string | null
          wallet_address?: string | null
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
      acquire_execution_lock: {
        Args: {
          p_lock_key: string
          p_request_id?: string
          p_strategy_id: string
          p_symbol: string
          p_ttl_seconds?: number
          p_user_id: string
        }
        Returns: boolean
      }
      activate_execution_wallet: {
        Args: { p_user_id: string; p_wallet_id: string }
        Returns: Json
      }
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
      admin_reset_learning_loop: { Args: { p_user_id: string }; Returns: Json }
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
      check_capital_access: { Args: { p_user_id: string }; Returns: boolean }
      check_live_trading_prerequisites:
        | { Args: never; Returns: Json }
        | { Args: { p_user_id: string }; Returns: Json }
      check_real_trading_prerequisites: { Args: never; Returns: Json }
      check_strategy_can_delete: {
        Args: { p_strategy_id: string }
        Returns: Json
      }
      claim_next_execution_job: {
        Args: never
        Returns: {
          amount: number
          confirmed_at: string | null
          created_at: string
          error_message: string | null
          execution_mode: string
          execution_target: string
          id: string
          idempotency_key: string | null
          kind: string
          locked_at: string | null
          payload: Json
          side: string
          status: string
          strategy_id: string
          submitted_at: string | null
          symbol: string
          tx_hash: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "execution_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clear_panic_state: {
        Args: { p_batch_id: string; p_user_id: string }
        Returns: Json
      }
      create_execution_wallet: { Args: { p_chain_id: number }; Returns: Json }
      dearmor: { Args: { "": string }; Returns: string }
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
      force_mock_trade_insert:
        | {
            Args: {
              p_amount: number
              p_original_purchase_amount?: number
              p_original_trade_id?: string
              p_price: number
              p_strategy_id: string
              p_symbol: string
              p_trade_type: string
              p_user_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_amount: number
              p_fees?: number
              p_original_purchase_amount?: number
              p_original_trade_id?: string
              p_price: number
              p_strategy_id: string
              p_symbol: string
              p_trade_type: string
              p_user_id: string
            }
            Returns: Json
          }
      gen_random_uuid: { Args: never; Returns: string }
      gen_salt: { Args: { "": string }; Returns: string }
      get_active_oauth_credentials: {
        Args: never
        Returns: {
          client_id_encrypted: string
          is_sandbox: boolean
        }[]
      }
      get_coinbase_connection_status: { Args: never; Returns: boolean }
      get_execution_wallet_balance_snapshots: {
        Args: { p_from?: string; p_to?: string; p_wallet_address: string }
        Returns: {
          balance: number
          decimals: number
          observed_at: string
          symbol: string
          token_address: string
        }[]
      }
      get_execution_wallet_for_trading: {
        Args: { p_user_id: string }
        Returns: {
          auth_tag: string
          chain_id: number
          dek_auth_tag: string
          dek_iv: string
          encrypted_dek: string
          encrypted_private_key: string
          iv: string
          kek_version: number
          wallet_address: string
          wallet_id: string
        }[]
      }
      get_execution_wallet_latest_snapshot: {
        Args: { p_wallet_address: string }
        Returns: {
          balance: number
          decimals: number
          observed_at: string
          symbol: string
          token_address: string
        }[]
      }
      get_features_for_engine: {
        Args: { p_granularity: string; p_symbol: string }
        Returns: {
          created_at: string | null
          ema_20: number | null
          ema_200: number | null
          ema_50: number | null
          granularity: string
          macd_hist: number | null
          macd_line: number | null
          macd_signal: number | null
          ret_1h: number | null
          ret_24h: number | null
          ret_4h: number | null
          ret_7d: number | null
          rsi_14: number | null
          symbol: string
          ts_utc: string
          updated_at: string | null
          vol_1h: number | null
          vol_24h: number | null
          vol_4h: number | null
          vol_7d: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "market_features_v0"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_gas_spent_eur: {
        Args: {
          p_is_test_mode?: boolean
          p_mock_gas_rate_pct?: number
          p_user_id: string
        }
        Returns: Json
      }
      get_open_lots: {
        Args: { p_user_id: string }
        Returns: {
          buy_fee: number
          buy_price: number
          buy_total_value: number
          buy_trade_id: string
          cryptocurrency: string
          executed_at: string
          remaining_amount: number
          strategy_id: string
        }[]
      }
      get_pending_decisions_for_horizon: {
        Args: { horizon_key: string }
        Returns: {
          decision_ts: string
          entry_price: number
          expected_pnl_pct: number
          id: string
          metadata: Json
          raw_intent: Json
          side: string
          sl_pct: number
          symbol: string
          tp_pct: number
          user_id: string
        }[]
      }
      get_portfolio_metrics: {
        Args: { p_is_test_mode: boolean; p_user_id: string }
        Returns: Json
      }
      get_strategy_open_position_count: {
        Args: { p_strategy_id: string }
        Returns: number
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
      get_wallet_portfolio_latest: {
        Args: { p_user_id: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      initiate_liquidation: { Args: { p_strategy_id: string }; Returns: Json }
      legacy_bytea_jsonmap_to_bytea: {
        Args: { input: string }
        Returns: string
      }
      log_connection_access: {
        Args: { access_type?: string; connection_id: string }
        Returns: undefined
      }
      pg_advisory_unlock: { Args: { key: number }; Returns: boolean }
      pg_try_advisory_lock: { Args: { key: number }; Returns: boolean }
      pgp_armor_headers: {
        Args: { "": string }
        Returns: Record<string, unknown>[]
      }
      promote_strategy_to_live: {
        Args: { p_strategy_id: string; p_user_id: string }
        Returns: Json
      }
      recalculate_cash_from_trades: {
        Args: { p_is_test_mode: boolean; p_user_id: string }
        Returns: Json
      }
      refresh_data_health_metrics: { Args: never; Returns: undefined }
      release_execution_lock: { Args: { p_lock_key: string }; Returns: boolean }
      release_reservation: {
        Args: { p_amount_eur: number; p_user_id: string }
        Returns: Json
      }
      reserve_capital: {
        Args: { p_amount_eur: number; p_user_id: string }
        Returns: Json
      }
      reset_breaker: {
        Args: {
          p_breaker: string
          p_strategy_id: string
          p_symbol: string
          p_user_id: string
        }
        Returns: boolean
      }
      reset_breaker_dbg: {
        Args: {
          p_breaker: string
          p_strategy_id: string
          p_symbol: string
          p_user_id: string
        }
        Returns: string
      }
      reset_mock_wallet_balances: {
        Args: { target_balance?: number }
        Returns: undefined
      }
      reset_portfolio_capital: {
        Args: { p_amount_eur?: number; p_user_id: string }
        Returns: Json
      }
      reset_user_test_portfolio: {
        Args: { target_balance?: number }
        Returns: undefined
      }
      settle_buy_trade: {
        Args: {
          p_actual_spent: number
          p_reserved_amount?: number
          p_user_id: string
        }
        Returns: Json
      }
      settle_sell_trade: {
        Args: { p_proceeds_eur: number; p_user_id: string }
        Returns: Json
      }
      trigger_panic_liquidation: {
        Args: { p_reason?: string; p_strategy_id?: string; p_user_id: string }
        Returns: Json
      }
      unwrap_legacy_buffer_to_bytea: { Args: { v: Json }; Returns: string }
      update_strategy_state: {
        Args: {
          p_new_state: string
          p_on_disable_policy?: string
          p_strategy_id: string
        }
        Returns: Json
      }
      user_has_execution_wallet: {
        Args: { p_user_id: string }
        Returns: boolean
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
