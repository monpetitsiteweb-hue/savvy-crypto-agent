import { supabase } from '@/integrations/supabase/client';

/**
 * Feature vector returned by get_features_for_engine RPC
 * Matches exactly the columns from public.market_features_v0
 */
export interface EngineFeatures {
  symbol: string;
  granularity: string;
  ts_utc: string;
  ret_1h: number | null;
  ret_4h: number | null;
  ret_24h: number | null;
  ret_7d: number | null;
  vol_1h: number | null;
  vol_4h: number | null;
  vol_24h: number | null;
  vol_7d: number | null;
  rsi_14: number | null;
  macd_line: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  ema_20: number | null;
  ema_50: number | null;
  ema_200: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fetch the latest feature vector for a given symbol + granularity
 * Calls the public.get_features_for_engine RPC
 * 
 * @param symbol - e.g. 'BTC-EUR'
 * @param granularity - e.g. '1h', '4h', '24h'
 * @returns The latest EngineFeatures row, or null if none found
 * @throws Error if RPC call fails
 */
export async function getFeaturesForEngine(
  symbol: string,
  granularity: string
): Promise<EngineFeatures | null> {
  // Cast to any because the RPC is not in the auto-generated types yet
  const { data, error } = await (supabase as any).rpc('get_features_for_engine', {
    p_symbol: symbol,
    p_granularity: granularity,
  });

  if (error) {
    console.error('[getFeaturesForEngine] RPC error:', error);
    throw new Error(`Failed to fetch features: ${error.message}`);
  }

  // RPC returns an array (setof), take first row or null
  if (!data || (Array.isArray(data) && data.length === 0)) {
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;

  return {
    symbol: row.symbol,
    granularity: row.granularity,
    ts_utc: row.ts_utc,
    ret_1h: row.ret_1h,
    ret_4h: row.ret_4h,
    ret_24h: row.ret_24h,
    ret_7d: row.ret_7d,
    vol_1h: row.vol_1h,
    vol_4h: row.vol_4h,
    vol_24h: row.vol_24h,
    vol_7d: row.vol_7d,
    rsi_14: row.rsi_14,
    macd_line: row.macd_line,
    macd_signal: row.macd_signal,
    macd_hist: row.macd_hist,
    ema_20: row.ema_20,
    ema_50: row.ema_50,
    ema_200: row.ema_200,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
