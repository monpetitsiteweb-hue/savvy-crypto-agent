export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
      }
      execution_circuit_breakers: {
        Row: {
          breaker_type: string
          created_at: string
          id: string
          is_active: boolean
          last_trip_at: string | null
          strategy_id: string
          symbol: string
          threshold_value: number
          trip_count: number
          trip_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          breaker_type: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_trip_at?: string | null
          strategy_id: string
          symbol: string
          threshold_value: number
          trip_count?: number
          trip_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          breaker_type?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_trip_at?: string | null
          strategy_id?: string
          symbol?: string
          threshold_value?: number
          trip_count?: number
          trip_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      execution_quality_log: {
        Row: {
          created_at: string
          decision_at: string
          decision_price: number
          decision_qty: number
          executed_at: string
          executed_price: number
          executed_qty: number
          execution_latency_ms: number
          id: string
          market_depth: number | null
          partial_fill: boolean
          side: string
          slippage_bps: number
          spread_bps: number | null
          strategy_id: string
          symbol: string
          trade_id: string | null
          user_id: string
          volatility_regime: string | null
        }
        Insert: {
          created_at?: string
          decision_at: string
          decision_price: number
          decision_qty: number
          executed_at: string
          executed_price: number
          executed_qty: number
          execution_latency_ms: number
          id?: string
          market_depth?: number | null
          partial_fill: boolean
          side: string
          slippage_bps: number
          spread_bps?: number | null
          strategy_id: string
          symbol: string
          trade_id?: string | null
          user_id: string
          volatility_regime?: string | null
        }
        Update: {
          created_at?: string
          decision_at?: string
          decision_price?: number
          decision_qty?: number
          executed_at?: string
          executed_price?: number
          executed_qty?: number
          execution_latency_ms?: number
          id?: string
          market_depth?: number | null
          partial_fill?: boolean
          side?: string
          slippage_bps?: number
          spread_bps?: number | null
          strategy_id?: string
          symbol?: string
          trade_id?: string | null
          user_id?: string
          volatility_regime?: string | null
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
        Relationships: []
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
          granularity: string
          ret_1h: number | null
          ret_24h: number | null
          ret_4h: number | null
          ret_7d: number | null
          symbol: string
          ts_utc: string
          vol_1h: number | null
          vol_24h: number | null
          vol_4h: number | null
          vol_7d: number | null
        }
        Insert: {
          created_at?: string | null
          granularity: string
          ret_1h?: number | null
          ret_24h?: number | null
          ret_4h?: number | null
          ret_7d?: number | null
          symbol: string
          ts_utc: string
          vol_1h?: number | null
          vol_24h?: number | null
          vol_4h?: number | null
          vol_7d?: number | null
        }
        Update: {
          created_at?: string | null
          granularity?: string
          ret_1h?: number | null
          ret_24h?: number | null
          ret_4h?: number | null
          ret_7d?: number | null
          symbol?: string
          ts_utc?: string
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
        Insert: {
          available?: number | null
          is_test_mode?: boolean | null
          strategy_id?: string | null
          symbol?: string | null
          total_bought?: number | null
          total_sold?: number | null
          user_id?: string | null
        }
        Update: {
          available?: number | null
          is_test_mode?: boolean | null
          strategy_id?: string | null
          symbol?: string | null
          total_bought?: number | null
          total_sold?: number | null
          user_id?: string | null
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
        Relationships: []
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
          exit_value?: number | null
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
          exit_value?: number | null
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
          has_indicators?: boolean | null
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
          has_indicators?: boolean | null
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
        Relationships: []
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
        Relationships: []
      }
      trading_strategies: {
        Row: {
          configuration: Json
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_test_mode: boolean
          last_activated_at: string | null
          strategy_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          configuration?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_test_mode?: boolean
          last_activated_at?: string | null
          strategy_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          configuration?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_test_mode?: boolean
          last_activated_at?: string | null
          strategy_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_coinbase_connections: {
        Row: {
          access_token_encrypted: string | null
          api_name_encrypted: string | null
          api_private_key_encrypted: string | null
          connected_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          last_sync: string
          refresh_token_encrypted: string | null
          user_id: string
        }
        Insert: {
          access_token_encrypted?: string | null
          api_name_encrypted?: string | null
          api_private_key_encrypted?: string | null
          connected_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_sync?: string
          refresh_token_encrypted?: string | null
          user_id: string
        }
        Update: {
          access_token_encrypted?: string | null
          api_name_encrypted?: string | null
          api_private_key_encrypted?: string | null
          connected_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_sync?: string
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
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      execution_quality_metrics_24h: {
        Row: {
          avg_abs_slippage_bps: number | null
          latency_p95_ms: number | null
          partial_fill_rate_pct: number | null
          strategy_id: string | null
          trade_count: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_get_connection_name: {
        Args: {
          connection_id: string
        }
        Returns: string
      }
      admin_list_past_positions: {
        Args: {
          p_user: string
        }
        Returns: {
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
          symbol: string | null
        }[]
      }
      admin_seed_sequence: {
        Args: {
          p_user: string
          p_symbol: string
          p_amount: number
          p_buy_price: number
          p_sell_price: number
          p_account_type: string
          p_fee_rate: number
        }
        Returns: {
          amount: number | null
          executed_at: string | null
          exit_price: number | null
          exit_value: number | null
          purchase_price: number | null
          purchase_value: number | null
          realized_pnl: number | null
          realized_pnl_pct: number | null
          sell_fees: number | null
          sell_id: string | null
          symbol: string | null
          user_id: string | null
        }[]
      }
      armor: {
        Args: {
          "": unknown
        }
        Returns: string
      }
      dearmor: {
        Args: {
          "": string
        }
        Returns: unknown
      }
      debug_decision_logs: {
        Args: {
          my_user: string
          minutes_back?: number
        }
        Returns: {
          confidence: number | null
          created_at: string | null
          decision_action: string | null
          decision_reason: string | null
          intent_side: string | null
          symbol: string | null
        }[]
      }
      fetch_coinbase_connection_name: {
        Args: {
          connection_id: string
        }
        Returns: string
      }
      gen_random_bytes: {
        Args: {
          "": number
        }
        Returns: string
      }
      get_active_oauth_credentials: {
        Args: Record<PropertyKey, never>
        Returns: {
          client_id_encrypted: string | null
          is_sandbox: boolean | null
        }[]
      }
      get_pending_decisions_for_horizon: {
        Args: {
          horizon_key: string
        }
        Returns: {
          decision_ts: string | null
          entry_price: number | null
          expected_pnl_pct: number | null
          id: string | null
          side: string | null
          sl_pct: number | null
          symbol: string | null
          tp_pct: number | null
          user_id: string | null
        }[]
      }
      get_user_connection_status: {
        Args: {
          connection_id: string
        }
        Returns: {
          connected_at: string | null
          connection_type: string | null
          expires_at: string | null
          has_credentials: boolean | null
          id: string | null
          is_active: boolean | null
          last_sync: string | null
        }[]
      }
      get_user_role: {
        Args: {
          _user_id: string
        }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _user_id: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      log_connection_access: {
        Args: {
          connection_id: string
          access_type?: string
        }
        Returns: undefined
      }
      pg_advisory_unlock: {
        Args: {
          key: number
        }
        Returns: boolean
      }
      pg_try_advisory_lock: {
        Args: {
          key: number
        }
        Returns: boolean
      }
      refresh_data_health_metrics: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      reset_breaker: {
        Args: {
          p_user: string
          p_strategy: string
          p_symbol: string
          p_type: string
        }
        Returns: undefined
      }
      reset_mock_wallet_balances: {
        Args: {
          target_balance?: number
        }
        Returns: undefined
      }
      reset_user_test_portfolio: {
        Args: {
          target_balance?: number
        }
        Returns: undefined
      }
      trip_breaker: {
        Args: {
          p_user: string
          p_strategy: string
          p_symbol: string
          p_type: string
          p_threshold: number
          p_reason: string
        }
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

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never