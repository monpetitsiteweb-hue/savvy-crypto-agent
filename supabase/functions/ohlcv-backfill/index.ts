import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logger } from '../_shared/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BackfillRequest {
  symbols: string[];
  granularities: string[];
  lookback_days: number;
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

async function fetchCoinbaseCandles(
  symbol: string,
  granularity: string,
  start: string,
  end: string,
  rateLimiter: RateLimiter
): Promise<CoinbaseCandle[]> {
  const granularitySeconds = granularity === '1h' ? 3600 : granularity === '4h' ? 14400 : 86400;
  
  for (let attempt = 0; attempt < RATE_LIMIT.maxRetries; attempt++) {
    try {
      await rateLimiter.throttle();

      const url = `https://api.exchange.coinbase.com/products/${symbol}/candles?start=${start}&end=${end}&granularity=${granularitySeconds}`;
      
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
      return data as CoinbaseCandle[];

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
    open: candle[1],
    high: candle[2],
    low: candle[3],
    close: candle[4],
    volume: candle[5],
  }));

  // Batch upsert with conflict resolution (idempotent)
  const { error, count } = await supabase
    .from('market_ohlcv_raw')
    .upsert(rows, {
      onConflict: 'symbol,granularity,ts_utc',
      ignoreDuplicates: true
    });

  if (error) {
    throw new Error(`Failed to upsert candles: ${error.message}`);
  }

  return count || 0;
}

async function updateHealthMetrics(
  supabase: any,
  symbol: string,
  granularity: string,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  const now = new Date().toISOString();
  
  const healthData = {
    symbol,
    granularity,
    last_backfill_at: success ? now : undefined,
    last_error_at: success ? undefined : now,
    error_message: success ? null : errorMessage,
    ...(success && { last_successful_ts: now })
  };

  await supabase
    .from('market_data_health')
    .upsert(healthData, {
      onConflict: 'symbol,granularity'
    });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { symbols, granularities, lookback_days }: BackfillRequest = await req.json();
    
    logger.info(`Starting backfill for ${symbols.length} symbols × ${granularities.length} granularities, ${lookback_days} days`);

    const rateLimiter = new RateLimiter();
    const results: any[] = [];
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (lookback_days * 24 * 60 * 60 * 1000));

    // Process each symbol-granularity combination
    for (const symbol of symbols) {
      for (const granularity of granularities) {
        try {
          logger.info(`Backfilling ${symbol} ${granularity}`);
          
          const candles = await fetchCoinbaseCandles(
            symbol,
            granularity,
            startTime.toISOString(),
            endTime.toISOString(),
            rateLimiter
          );

          const upsertedCount = await upsertCandles(supabase, symbol, granularity, candles);
          
          await updateHealthMetrics(supabase, symbol, granularity, true);
          
          results.push({
            symbol,
            granularity,
            candles_fetched: candles.length,
            candles_upserted: upsertedCount,
            success: true
          });

          logger.info(`✓ ${symbol} ${granularity}: ${candles.length} fetched, ${upsertedCount} upserted`);

        } catch (error) {
          logger.error(`✗ ${symbol} ${granularity}: ${error.message}`);
          
          await updateHealthMetrics(supabase, symbol, granularity, false, error.message);
          
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

    logger.info(`Backfill complete: ${successCount}/${totalCount} successful`);

    return new Response(JSON.stringify({
      success: true,
      summary: {
        total_series: totalCount,
        successful_series: successCount,
        failed_series: totalCount - successCount,
        lookback_days
      },
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    logger.error(`Backfill error: ${error.message}`);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});