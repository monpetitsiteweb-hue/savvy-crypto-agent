// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logger } from '../_shared/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LiveIngestRequest {
  symbols: string[];
  granularities: string[];
}

interface CoinbaseCandle {
  0: number; // timestamp
  1: number; // open
  2: number; // high
  3: number; // low
  4: number; // close
  5: number; // volume
}

// Rate limiting configuration
const RATE_LIMIT = {
  requestsPerSecond: 10,
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  circuitBreakerThreshold: 5,
};

class RateLimiter {
  private lastRequestTime = 0;
  private failureCount = 0;
  private circuitOpen = false;
  private circuitOpenTime = 0;

  async throttle(): Promise<void> {
    // Circuit breaker check
    if (this.circuitOpen) {
      const timeSinceOpen = Date.now() - this.circuitOpenTime;
      if (timeSinceOpen < 60000) { // 1 minute circuit breaker
        throw new Error('Circuit breaker open - too many failures');
      }
      this.circuitOpen = false;
      this.failureCount = 0;
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minInterval = 1000 / RATE_LIMIT.requestsPerSecond;

    if (timeSinceLastRequest < minInterval) {
      const delay = minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    this.lastRequestTime = Date.now();
  }

  recordSuccess(): void {
    this.failureCount = 0;
  }

  recordFailure(): void {
    this.failureCount++;
    if (this.failureCount >= RATE_LIMIT.circuitBreakerThreshold) {
      this.circuitOpen = true;
      this.circuitOpenTime = Date.now();
    }
  }
}

async function getHighWaterMark(
  supabase: any,
  symbol: string,
  granularity: string
): Promise<Date> {
  const { data, error } = await supabase
    .from('market_ohlcv_raw')
    .select('ts_utc')
    .eq('symbol', symbol)
    .eq('granularity', granularity)
    .order('ts_utc', { ascending: false })
    .limit(1);

  if (error) {
    logger.warn(`Could not get high water mark for ${symbol} ${granularity}: ${error.message}`);
    // Default to 7 days ago if no data exists
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  if (!data || data.length === 0) {
    // No existing data, start from 7 days ago
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  return new Date(data[0].ts_utc);
}

async function fetchLatestCandles(
  symbol: string,
  granularity: string,
  since: Date,
  rateLimiter: RateLimiter
): Promise<CoinbaseCandle[]> {
  const granularitySeconds = granularity === '1h' ? 3600 : granularity === '4h' ? 14400 : 86400;
  const now = new Date();
  
  for (let attempt = 0; attempt < RATE_LIMIT.maxRetries; attempt++) {
    try {
      await rateLimiter.throttle();

      const url = `https://api.exchange.coinbase.com/products/${symbol}/candles?start=${since.toISOString()}&end=${now.toISOString()}&granularity=${granularitySeconds}`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'ScalpSmart/1.0',
        },
      });

      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited - exponential backoff with jitter
          const delay = Math.min(
            RATE_LIMIT.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
            RATE_LIMIT.maxDelayMs
          );
          logger.warn(`Rate limited on ${symbol}, retrying in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      rateLimiter.recordSuccess();
      
      // Filter out candles older than our high water mark
      const sinceTimestamp = since.getTime() / 1000;
      return (data as CoinbaseCandle[]).filter(candle => candle[0] > sinceTimestamp);

    } catch (error) {
      rateLimiter.recordFailure();
      
      if (attempt === RATE_LIMIT.maxRetries - 1) {
        throw error;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        RATE_LIMIT.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        RATE_LIMIT.maxDelayMs
      );
      
      logger.warn(`Attempt ${attempt + 1} failed for ${symbol}, retrying in ${delay}ms: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Failed to fetch ${symbol} after ${RATE_LIMIT.maxRetries} attempts`);
}

async function upsertCandles(
  supabase: any,
  symbol: string,
  granularity: string,
  candles: CoinbaseCandle[]
): Promise<number> {
  if (candles.length === 0) return 0;

  const rows = candles.map(candle => ({
    symbol,
    granularity,
    ts_utc: new Date(candle[0] * 1000).toISOString(),
    open: candle[3],  // Correct Coinbase order: [time, low, high, open, close, volume]
    high: candle[2],
    low: candle[1],
    close: candle[4],
    volume: candle[5],
  }));

  // Batch upsert with conflict resolution (idempotent)
  const { data, error } = await supabase
    .from('market_ohlcv_raw')
    .upsert(rows, {
      onConflict: 'symbol,granularity,ts_utc',
      ignoreDuplicates: true
    })
    .select();

  if (error) {
    throw new Error(`Failed to upsert candles: ${error.message}`);
  }

  return data?.length || 0;
}

async function computeFeatures(
  supabase: any,
  symbol: string,
  granularity: string,
  latestTimestamp: Date
): Promise<void> {
  // Get the last 168 candles (7 days worth for 1h granularity) to compute rolling features
  const step = { '1h': 1, '4h': 4, '24h': 24 }[granularity] || 1;
  const lookbackCandles = Math.max(168 / step, 50); // At least 50 candles for computation
  const lookbackStart = new Date(latestTimestamp.getTime() - (lookbackCandles * step * 3600000));

  const { data: candles, error } = await supabase
    .from('market_ohlcv_raw')
    .select('ts_utc, close')
    .eq('symbol', symbol)
    .eq('granularity', granularity)
    .gte('ts_utc', lookbackStart.toISOString())
    .lte('ts_utc', latestTimestamp.toISOString())
    .order('ts_utc', { ascending: true });

  if (error || !candles || candles.length < 2) {
    logger.warn(`Insufficient data to compute features for ${symbol} ${granularity}`);
    return;
  }

  // Scale windows by granularity
  const ret_1h_window = Math.max(1, Math.floor(1 / step));
  const ret_4h_window = Math.max(1, Math.floor(4 / step));
  const ret_24h_window = Math.max(1, Math.floor(24 / step));
  const ret_7d_window = Math.max(1, Math.floor(168 / step));

  // Compute rolling returns and volatility for the latest candle
  const prices = candles.map(c => parseFloat(c.close));
  const lastIndex = prices.length - 1;

  if (lastIndex < 1) return;

  // Calculate log returns using scaled windows
  const ret_1h = lastIndex >= ret_1h_window ? Math.log(prices[lastIndex] / prices[lastIndex - ret_1h_window]) : null;
  const ret_4h = lastIndex >= ret_4h_window ? Math.log(prices[lastIndex] / prices[lastIndex - ret_4h_window]) : null;
  const ret_24h = lastIndex >= ret_24h_window ? Math.log(prices[lastIndex] / prices[lastIndex - ret_24h_window]) : null;
  const ret_7d = lastIndex >= ret_7d_window ? Math.log(prices[lastIndex] / prices[lastIndex - ret_7d_window]) : null;

  // Calculate rolling volatility using scaled windows
  const getVolatility = (windowSize: number) => {
    if (lastIndex < windowSize || windowSize < 2) return null;
    
    const returns = [];
    for (let i = lastIndex - windowSize + 1; i <= lastIndex; i++) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    return Math.sqrt(variance);
  };

  const vol_1h = getVolatility(ret_1h_window);
  const vol_4h = getVolatility(ret_4h_window);
  const vol_24h = getVolatility(ret_24h_window);
  const vol_7d = getVolatility(ret_7d_window);

  const features = {
    symbol,
    granularity,
    ts_utc: latestTimestamp.toISOString(),
    ret_1h,
    ret_4h,
    ret_24h,
    ret_7d,
    vol_1h,
    vol_4h,
    vol_24h,
    vol_7d
  };

  // Upsert features (idempotent)
  const { error: featuresError } = await supabase
    .from('market_features_v0')
    .upsert(features, {
      onConflict: 'symbol,granularity,ts_utc',
      ignoreDuplicates: false // We want to update if computation changes
    });

  if (featuresError) {
    throw new Error(`Failed to upsert features: ${featuresError.message}`);
  }
}

async function updateHealthMetrics(
  supabase: any,
  symbol: string,
  granularity: string,
  success: boolean,
  latestCandleTs?: string
): Promise<void> {
  const updateData: any = {
    last_live_ingest_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    error_count_24h: success ? 0 : 1
  };

  if (success && latestCandleTs) {
    updateData.last_ts_utc = latestCandleTs;
  }

  await supabase
    .from('market_data_health')
    .upsert({
      symbol,
      granularity,
      ...updateData
    }, {
      onConflict: 'symbol,granularity'
    });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Cron secret authentication
    const cronSecret = req.headers.get('x-cron-secret');
    const expectedSecret = Deno.env.get('CRON_SECRET');
    
    if (!cronSecret || cronSecret.trim() !== expectedSecret?.trim()) {
      logger.error('Invalid cron secret provided');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body with defaults
    const body = await req.json().catch(() => ({}));
    
    // Default symbols and granularities for scheduled runs
    const DEFAULT_SYMBOLS = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'ADA-EUR', 'SOL-EUR', 'AVAX-EUR', 'DOT-EUR', 'LINK-EUR', 'LTC-EUR', 'BCH-EUR'];
    const DEFAULT_GRANULARITIES = ['1h', '4h', '24h'];
    
    const symbols: string[] = body.symbols || DEFAULT_SYMBOLS;
    const granularities: string[] = body.granularities || DEFAULT_GRANULARITIES;
    
    logger.info(`Starting live ingest for ${symbols.length} symbols × ${granularities.length} granularities`);

    const rateLimiter = new RateLimiter();
    const results: any[] = [];

    // Process each symbol-granularity combination
    for (const symbol of symbols) {
      for (const granularity of granularities) {
        try {
          logger.info(`Live ingesting ${symbol} ${granularity}`);
          
          // Get high water mark (last known timestamp)
          const highWaterMark = await getHighWaterMark(supabase, symbol, granularity);
          
          // Fetch only new candles since high water mark
          const candles = await fetchLatestCandles(symbol, granularity, highWaterMark, rateLimiter);
          
          if (candles.length === 0) {
            logger.info(`No new candles for ${symbol} ${granularity}`);
            await updateHealthMetrics(supabase, symbol, granularity, true);
            
            results.push({
              symbol,
              granularity,
              candles_fetched: 0,
              candles_upserted: 0,
              features_computed: false,
              success: true,
              message: 'No new candles'
            });
            continue;
          }

          // Sort candles by time ascending
          candles.sort((a, b) => a[0] - b[0]);

          // Upsert new candles
          const upsertedCount = await upsertCandles(supabase, symbol, granularity, candles);
          
          // Get latest candle timestamp from fetched data
          let latestCandleTs: string | undefined;
          if (candles.length > 0) {
            const sortedCandles = candles.sort((a, b) => b[0] - a[0]);
            latestCandleTs = new Date(sortedCandles[0][0] * 1000).toISOString();
          }
          
          // Compute features for the latest candle
          const latestCandle = candles.reduce((latest, current) => 
            current[0] > latest[0] ? current : latest
          );
          const latestTimestamp = new Date(latestCandle[0] * 1000);
          
          await computeFeatures(supabase, symbol, granularity, latestTimestamp);
          
          await updateHealthMetrics(supabase, symbol, granularity, true, latestCandleTs);
          
          results.push({
            symbol,
            granularity,
            candles_fetched: candles.length,
            candles_upserted: upsertedCount,
            features_computed: true,
            latest_timestamp: latestTimestamp.toISOString(),
            success: true
          });

          logger.info(`✓ ${symbol} ${granularity}: ${candles.length} fetched, ${upsertedCount} upserted, features computed`);

        } catch (error) {
          logger.error(`✗ ${symbol} ${granularity}: ${error.message}`);
          
          await updateHealthMetrics(supabase, symbol, granularity, false);
          
          results.push({
            symbol,
            granularity,
            success: false,
            error: error.message
          });
        }
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;
    const totalCandles = results.reduce((sum, r) => sum + (r.candles_upserted || 0), 0);

    logger.info(`Live ingest complete: ${successCount}/${totalCount} successful, ${totalCandles} total candles`);

    return new Response(JSON.stringify({
      success: true,
      summary: {
        total_series: totalCount,
        successful_series: successCount,
        failed_series: totalCount - successCount,
        total_candles_ingested: totalCandles
      },
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    logger.error(`Live ingest error: ${error.message}`);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});