/**
 * Core trading types shared across the application
 */

/**
 * TradingMode determines whether to show TEST (mock) or REAL (on-chain) data.
 * This is a UI-ONLY concept. Execution mode is driven by trading_strategies.execution_target.
 */
export type TradingMode = 'TEST' | 'REAL';

/**
 * Real trade from real_trade_history_view
 * Contains on-chain execution facts, NOT business logic
 */
export interface RealTradeHistoryRow {
  real_trade_id: string;
  mock_trade_id: string;
  trade_id: string; // alias for real_trade_id
  user_id: string;
  strategy_id: string | null;
  symbol: string;
  side: 'BUY' | 'SELL';
  filled_quantity: number;
  effective_price: number;
  total_value: number | null;
  fees: number | null;
  tx_hash: string;
  chain_id: number;
  provider: string;
  execution_status: 'SUBMITTED' | 'MINED' | 'CONFIRMED' | 'REVERTED' | 'DROPPED';
  execution_target: string;
  execution_authority: string;
  is_system_operator: boolean;
  gas_used: number | null;
  block_number: number | null;
  block_timestamp: string | null;
  decode_method: string | null;
  error_reason: string | null;
  intent_ts: string;
  execution_recorded_at: string;
}

/**
 * Real position from real_positions_view
 * Quantity-only aggregation, NO P&L
 */
export interface RealPositionRow {
  user_id: string;
  strategy_id: string | null;
  symbol: string;
  chain_id: number;
  position_size: number;
  last_trade_at: string;
}
