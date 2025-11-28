// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logger } from '../_shared/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ============================================================================
// TECHNICAL INDICATOR CALCULATIONS
// ============================================================================

/**
 * Calculate Exponential Moving Average (EMA)
 * @param prices Array of prices (oldest first)
 * @param period EMA period (e.g., 12, 26, 20, 50, 200)
 * @returns Array of EMA values (same length as prices, first `period-1` values are null)
 */
function calculateEMA(prices: number[], period: number): (number | null)[] {
  if (prices.length < period) {
    return prices.map(() => null);
  }
  
  const k = 2 / (period + 1); // smoothing factor
  const emaValues: (number | null)[] = [];
  
  // First EMA value is the SMA of first `period` prices
  let sma = 0;
  for (let i = 0; i < period; i++) {
    sma += prices[i];
  }
  sma /= period;
  
  // Fill nulls for first period-1 values
  for (let i = 0; i < period - 1; i++) {
    emaValues.push(null);
  }
  emaValues.push(sma);
  
  // Calculate EMA for remaining values
  let prevEma = sma;
  for (let i = period; i < prices.length; i++) {
    const ema = prices[i] * k + prevEma * (1 - k);
    emaValues.push(ema);
    prevEma = ema;
  }
  
  return emaValues;
}

/**
 * Calculate RSI (Relative Strength Index) using Wilder's smoothing
 * @param prices Array of close prices (oldest first)
 * @param period RSI period (typically 14)
 * @returns Array of RSI values (same length as prices)
 */
function calculateRSI(prices: number[], period: number = 14): (number | null)[] {
  if (prices.length < period + 1) {
    return prices.map(() => null);
  }
  
  const rsiValues: (number | null)[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  // Calculate price changes
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  // First value is null
  rsiValues.push(null);
  
  // First `period` values are null (need enough data)
  for (let i = 0; i < period - 1; i++) {
    rsiValues.push(null);
  }
  
  // Calculate first average gain/loss using SMA
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;
  
  // First RSI
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsi = 100 - (100 / (1 + rs));
  rsiValues.push(rsi);
  
  // Calculate remaining RSI values using Wilder's smoothing
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi = 100 - (100 / (1 + rs));
    rsiValues.push(rsi);
  }
  
  return rsiValues;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param prices Array of close prices (oldest first)
 * @param fastPeriod Fast EMA period (typically 12)
 * @param slowPeriod Slow EMA period (typically 26)
 * @param signalPeriod Signal EMA period (typically 9)
 * @returns Object with arrays for macd_line, macd_signal, macd_hist
 */
function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd_line: (number | null)[]; macd_signal: (number | null)[]; macd_hist: (number | null)[] } {
  const emaFast = calculateEMA(prices, fastPeriod);
  const emaSlow = calculateEMA(prices, slowPeriod);
  
  // MACD line = EMA(fast) - EMA(slow)
  const macdLine: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) {
      macdLine.push(emaFast[i]! - emaSlow[i]!);
    } else {
      macdLine.push(null);
    }
  }
  
  // Filter out nulls for signal calculation, keeping track of indices
  const validMacdValues: number[] = [];
  const validIndices: number[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null) {
      validMacdValues.push(macdLine[i]!);
      validIndices.push(i);
    }
  }
  
  // Calculate signal line (EMA of MACD line)
  const signalEma = calculateEMA(validMacdValues, signalPeriod);
  
  // Map signal values back to original indices
  const macdSignal: (number | null)[] = prices.map(() => null);
  for (let i = 0; i < validIndices.length; i++) {
    macdSignal[validIndices[i]] = signalEma[i];
  }
  
  // MACD histogram = MACD line - Signal line
  const macdHist: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (macdLine[i] !== null && macdSignal[i] !== null) {
      macdHist.push(macdLine[i]! - macdSignal[i]!);
    } else {
      macdHist.push(null);
    }
  }
  
  return { macd_line: macdLine, macd_signal: macdSignal, macd_hist: macdHist };
}

// ============================================================================
// FEATURE COMPUTATION
// ============================================================================

async function computeFeatures(
  supabase: any,
  symbol: string,
  granularity: string,
  lookbackDays: number
): Promise<number> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - (lookbackDays * 24 * 60 * 60 * 1000));

  // Get OHLCV data for feature computation (need 300 candles for EMA-200 + buffer)
  const { data: candles, error } = await supabase
    .from('market_ohlcv_raw')
    .select('ts_utc, open, high, low, close, volume')
    .eq('symbol', symbol)
    .eq('granularity', granularity)
    .gte('ts_utc', startTime.toISOString())
    .order('ts_utc')
    .limit(500);

  if (error) {
    throw new Error(`Failed to fetch candles for features: ${error.message}`);
  }

  if (!candles || candles.length < 2) {
    logger.warn(`Insufficient data for ${symbol} ${granularity}: ${candles?.length || 0} candles`);
    return 0;
  }

  logger.info(`📊 Processing ${candles.length} candles for ${symbol} ${granularity}`);

  // Extract close prices for indicator calculations
  const closePrices = candles.map((c: any) => parseFloat(c.close));

  // Calculate technical indicators
  const rsi14 = calculateRSI(closePrices, 14);
  const macd = calculateMACD(closePrices, 12, 26, 9);
  const ema20 = calculateEMA(closePrices, 20);
  const ema50 = calculateEMA(closePrices, 50);
  const ema200 = calculateEMA(closePrices, 200);

  // Scale windows by granularity for returns/volatility
  const step = { '1h': 1, '4h': 4, '24h': 24 }[granularity] || 1;
  const ret_1h_window = Math.max(1, Math.floor(1 / step));
  const ret_4h_window = Math.max(1, Math.floor(4 / step));  
  const ret_24h_window = Math.max(1, Math.floor(24 / step));
  const ret_7d_window = Math.max(1, Math.floor(168 / step));

  // Compute features for each candle
  const features = [];
  
  for (let i = 1; i < candles.length; i++) {
    const currentCandle = candles[i];
    const ts_utc = currentCandle.ts_utc;
    const currentPrice = parseFloat(currentCandle.close);
    
    // Calculate returns (log returns)
    const ret_1h = i >= ret_1h_window ? Math.log(currentPrice / parseFloat(candles[i - ret_1h_window].close)) : null;
    const ret_4h = i >= ret_4h_window ? Math.log(currentPrice / parseFloat(candles[i - ret_4h_window].close)) : null;
    const ret_24h = i >= ret_24h_window ? Math.log(currentPrice / parseFloat(candles[i - ret_24h_window].close)) : null;
    const ret_7d = i >= ret_7d_window ? Math.log(currentPrice / parseFloat(candles[i - ret_7d_window].close)) : null;
    
    // Calculate rolling volatility (std dev of log returns)
    const getVolatility = (startIdx: number, endIdx: number) => {
      if (startIdx >= endIdx || endIdx - startIdx < 2) return null;
      
      const returns = [];
      for (let j = startIdx + 1; j <= endIdx; j++) {
        returns.push(Math.log(parseFloat(candles[j].close) / parseFloat(candles[j-1].close)));
      }
      
      if (returns.length < 2) return null;
      
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
      return Math.sqrt(variance);
    };
    
    const vol_1h = i >= ret_1h_window ? getVolatility(Math.max(0, i - ret_1h_window), i) : null;
    const vol_4h = i >= ret_4h_window ? getVolatility(Math.max(0, i - ret_4h_window), i) : null;
    const vol_24h = i >= ret_24h_window ? getVolatility(Math.max(0, i - ret_24h_window), i) : null;
    const vol_7d = i >= ret_7d_window ? getVolatility(Math.max(0, i - ret_7d_window), i) : null;
    
    features.push({
      symbol,
      granularity,
      ts_utc,
      // Returns
      ret_1h: Number.isFinite(ret_1h) ? ret_1h : null,
      ret_4h: Number.isFinite(ret_4h) ? ret_4h : null,
      ret_24h: Number.isFinite(ret_24h) ? ret_24h : null,
      ret_7d: Number.isFinite(ret_7d) ? ret_7d : null,
      // Volatility
      vol_1h: Number.isFinite(vol_1h) ? vol_1h : null,
      vol_4h: Number.isFinite(vol_4h) ? vol_4h : null,
      vol_24h: Number.isFinite(vol_24h) ? vol_24h : null,
      vol_7d: Number.isFinite(vol_7d) ? vol_7d : null,
      // Technical indicators
      rsi_14: Number.isFinite(rsi14[i]) ? rsi14[i] : null,
      macd_line: Number.isFinite(macd.macd_line[i]) ? macd.macd_line[i] : null,
      macd_signal: Number.isFinite(macd.macd_signal[i]) ? macd.macd_signal[i] : null,
      macd_hist: Number.isFinite(macd.macd_hist[i]) ? macd.macd_hist[i] : null,
      ema_20: Number.isFinite(ema20[i]) ? ema20[i] : null,
      ema_50: Number.isFinite(ema50[i]) ? ema50[i] : null,
      ema_200: Number.isFinite(ema200[i]) ? ema200[i] : null,
      updated_at: new Date().toISOString(),
    });
  }

  if (features.length === 0) {
    return 0;
  }

  // Upsert features (no .select() to reduce memory)
  const { error: upsertError } = await supabase
    .from('market_features_v0')
    .upsert(features, {
      onConflict: 'symbol,granularity,ts_utc',
      ignoreDuplicates: false  // Update existing rows with new indicator values
    });

  if (upsertError) {
    throw new Error(`Failed to upsert features: ${upsertError.message}`);
  }

  return features.length;
}

async function updateHealthMetrics(supabase: any): Promise<void> {
  // Update coverage and staleness metrics
  const { error } = await supabase.rpc('refresh_data_health_metrics');
  
  if (error) {
    logger.warn(`Failed to refresh health metrics: ${error.message}`);
  }
}

// ============================================================================
// EDGE FUNCTION HANDLER
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const cronHeader = (req.headers.get("x-cron-secret") ?? "").trim();
    const cronEnv = (Deno.env.get("CRON_SECRET") ?? "").trim();
    const isScheduledRun = cronHeader && cronHeader === cronEnv;

    logger.info(`📊 Features refresh triggered (scheduled: ${isScheduledRun})`);

    // Allow both scheduled (cron) and manual (debug) invocations
    // For manual: check if Authorization header is present (authenticated user)
    const authHeader = req.headers.get("authorization") ?? "";
    const hasAuth = authHeader.startsWith("Bearer ");
    
    if (!isScheduledRun && !hasAuth) {
      return new Response(JSON.stringify({ error: "Unauthorized - provide x-cron-secret or Bearer token" }), { 
        status: 403, 
        headers: corsHeaders 
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Payload hardening
    let payload: any = {};
    try { 
      payload = await req.json(); 
    } catch { 
      payload = {}; 
    }
    
    // Default symbols - all supported EUR pairs
    const defaultSymbols = [
      "BTC-EUR", "ETH-EUR", "XRP-EUR", "ADA-EUR", "SOL-EUR",
      "DOT-EUR", "AVAX-EUR", "LINK-EUR", "LTC-EUR"
    ];
    
    const symbols = Array.isArray(payload.symbols) && payload.symbols.length 
      ? payload.symbols 
      : defaultSymbols;
    const granularitiesDefault = ["1h", "4h", "24h"];
    const granularities = Array.isArray(payload.granularities) && payload.granularities.length 
      ? payload.granularities 
      : granularitiesDefault;
    const lookback_days = Number.isFinite(payload.lookback_days) && payload.lookback_days > 0 
      ? payload.lookback_days 
      : 30;

    if (!Array.isArray(symbols) || !Array.isArray(granularities)) {
      return new Response(JSON.stringify({ 
        error: "Invalid payload: symbols[] and granularities[] required" 
      }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }
    
    logger.info(`📊 Computing features for ${symbols.length} symbols × ${granularities.length} granularities (lookback: ${lookback_days} days)`);

    const results: any[] = [];
    let totalFeaturesComputed = 0;

    // Process each symbol-granularity combination
    for (const symbol of symbols) {
      for (const granularity of granularities) {
        try {
          const featuresCount = await computeFeatures(supabase, symbol, granularity, lookback_days);
          totalFeaturesComputed += featuresCount;
          
          results.push({
            symbol,
            granularity,
            features_computed: featuresCount,
            success: true
          });

          logger.info(`✅ ${symbol} ${granularity}: ${featuresCount} features computed`);
        } catch (error) {
          logger.error(`❌ ${symbol} ${granularity} features: ${error.message}`);
          
          results.push({
            symbol,
            granularity,
            success: false,
            error: error.message
          });
        }
      }
    }

    // Update health metrics
    await updateHealthMetrics(supabase);

    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    logger.info(`📊 Features computation complete: ${successCount}/${totalCount} series, ${totalFeaturesComputed} total rows`);

    return new Response(JSON.stringify({
      success: true,
      summary: {
        total_series: totalCount,
        successful_series: successCount,
        failed_series: totalCount - successCount,
        total_features_computed: totalFeaturesComputed,
      },
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    logger.error(`❌ Features computation error: ${error.message}`);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
