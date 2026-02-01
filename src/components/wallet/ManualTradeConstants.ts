/**
 * Constants for manual trading on the operator wallet drill page.
 * These are used to identify manual trades in the mock_trades ledger.
 */

// Existing REAL strategy used for manual trades
// This strategy has execution_target = 'REAL' in the database
export const MANUAL_STRATEGY_ID = '31aeb45a-bc44-48a1-8090-8a706129653f';

// The user_id that owns the MANUAL_STRATEGY_ID
// All trades for this strategy MUST use this user_id for FIFO BUY coverage to work
export const MANUAL_STRATEGY_OWNER_ID = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3';

// Tokens available for manual trading on Base (chain_id = 8453)
export const TRADEABLE_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
  { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
] as const;

// Slippage options (in percentage) - Builder max is 50 bps (0.5%)
export const SLIPPAGE_OPTIONS = [0.1, 0.2, 0.3, 0.4, 0.5] as const;

// Supabase project URL for edge functions
export const SUPABASE_URL = 'https://fuieplftlcxdfkxyqzlt.supabase.co';
