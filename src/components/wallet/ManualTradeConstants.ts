/**
 * Constants for manual trading on the operator wallet drill page.
 * These are used to identify manual trades in the mock_trades ledger.
 */

// Existing REAL strategy used for manual trades
// This strategy has execution_target = 'REAL' in the database
export const MANUAL_STRATEGY_ID = '31aeb45a-bc44-48a1-8090-8a706129653f';

// Tokens available for manual trading on Base (chain_id = 8453)
export const TRADEABLE_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
  { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
] as const;

// Default slippage options (in percentage)
export const SLIPPAGE_OPTIONS = [0.5, 1.0, 2.0, 3.0] as const;

// Supabase project URL for edge functions
export const SUPABASE_URL = 'https://fuieplftlcxdfkxyqzlt.supabase.co';
