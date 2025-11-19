// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logger } from '../_shared/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface BackfillRequest {
  symbols: string[];
  granularities: string[];
  lookback_days: number;
}

interface CoinbaseCandle {
  0: number; // timestamp
  1: number; // low  
  2: number; // high
  3: number; // open
  4: number; // close
  5: number; // volume
}

// Rate limiting configuration
const RATE_LIMIT = {
  requestsPerSecond: 8,         // More conservative than 10 rps
  maxRetries: 5,                // More retry attempts
  baseDelayMs: 150,             // Increased base delay
  maxDelayMs: 10000,            // Longer max delay for severe rate limiting
  circuitBreakerThreshold: 7,   // More tolerance before circuit breaking
};

const MAX_CANDLES_PER_REQUEST = 300;

class RateLimiter {
  private lastRequestTime = 0;
  private failureCount = 0;
  private circuitOpen = false;
  private circuitOpenTime = 0;

  async throttle(): Promise<void> {
    if (this.circuitOpen) {
      const timeSinceOpen = Date.now() - this.circuitOpenTime;
      if (timeSinceOpen < 60000) {
        throw new Error('Circuit breaker open - too many failures');
      }
      this.circuitOpen = false;
      this.failureCount = 0;
    }

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

async function fetchCoinbaseCandlesPaginated(
  symbol: string,
  granularity: string,
  startTime: Date,
  endTime: Date,
  rateLimiter: RateLimiter
): Promise<CoinbaseCandle[]> {
  const granularitySeconds = granularity === '1h' ? 3600 : 86400; // Only native 1h and 24h
  const allCandles: CoinbaseCandle[] = [];
  
  let currentStart = new Date(startTime);
  
  while (currentStart < endTime) {
    // Calculate window end (300 candles max per request)
    const windowMs = (MAX_CANDLES_PER_REQUEST - 1) * granularitySeconds * 1000;
    const currentEnd = new Date(Math.min(
      currentStart.getTime() + windowMs,
      endTime.getTime()
    ));
    
    try {
      await rateLimiter.throttle();

      const url = `https://api.exchange.coinbase.com/products/${symbol}/candles?start=${currentStart.toISOString()}&end=${currentEnd.toISOString()}&granularity=${granularitySeconds}`;
      
      logger.info(`📡 Fetching Coinbase: ${url.substring(0, 100)}...`);
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'ScalpSmart/1.0',
        },
      });

      logger.info(`📊 Coinbase response: ${symbol} ${granularity} - Status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        if (response.status === 429) {
          // More aggressive rate limit handling with exponential backoff
          const attemptDelay = Math.min(RATE_LIMIT.baseDelayMs * Math.pow(2, rateLimiter.failureCount), RATE_LIMIT.maxDelayMs);
          logger.warn(`Rate limited on ${symbol} (attempt ${rateLimiter.failureCount + 1}), retrying in ${attemptDelay}ms`);
          rateLimiter.recordFailure();
          await new Promise(resolve => setTimeout(resolve, attemptDelay));
          
          // Reset window start to retry this exact same request
          continue;
        }
        
        const errorBody = await response.text().catch(() => 'Unable to read body');
        logger.error(`❌ Coinbase API error ${response.status} for ${symbol}: ${errorBody}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const candles = await response.json() as CoinbaseCandle[];
      rateLimiter.recordSuccess();
      
      if (candles.length > 0) {
        allCandles.push(...candles);
        logger.info(`Fetched ${candles.length} candles for ${symbol} ${granularity} (${currentStart.toISOString()} to ${currentEnd.toISOString()})`);
      }
      
      // Advance window
      currentStart = new Date(currentEnd.getTime() + 1000); // +1s to avoid overlap
    } catch (error) {
      rateLimiter.recordFailure();
      logger.error(`Failed to fetch ${symbol} ${granularity} window: ${error.message}`);
      throw error;
    }
  }
  
  return allCandles;
}

async function synthesize4hCandles(
  supabase: any,
  symbol: string,
  startTime: Date,
  endTime: Date
): Promise<number> {
  // Synthesize 4h candles from 1h candles
  const { data: hourlyCandles, error } = await supabase
    .from('market_ohlcv_raw')
    .select('*')
    .eq('symbol', symbol)
    .eq('granularity', '1h')
    .gte('ts_utc', startTime.toISOString())
    .lte('ts_utc', endTime.toISOString())
    .order('ts_utc');

  if (error) {
    throw new Error(`Failed to fetch 1h candles for 4h synthesis: ${error.message}`);
  }

  if (!hourlyCandles || hourlyCandles.length === 0) {
    return 0;
  }

  // Group by 4-hour buckets (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC)
  const grouped = new Map<string, typeof hourlyCandles>();
  
  for (const candle of hourlyCandles) {
    const ts = new Date(candle.ts_utc);
    const hour = ts.getUTCHours();
    const bucket = Math.floor(hour / 4) * 4;
    const bucketTime = new Date(ts);
    bucketTime.setUTCHours(bucket, 0, 0, 0);
    const bucketKey = bucketTime.toISOString();
    
    if (!grouped.has(bucketKey)) {
      grouped.set(bucketKey, []);
    }
    grouped.get(bucketKey)!.push(candle);
  }

  // Synthesize 4h candles
  const synthetic4h = [];
  for (const [bucketTime, candles] of grouped) {
    if (candles.length >= 1) { // Allow synthesis with at least 1 candle
      const sortedCandles = candles.sort((a, b) => new Date(a.ts_utc).getTime() - new Date(b.ts_utc).getTime());
      
      synthetic4h.push({
        symbol,
        granularity: '4h',
        ts_utc: bucketTime,
        open: sortedCandles[0].open,
        high: Math.max(...sortedCandles.map(c => c.high)),
        low: Math.min(...sortedCandles.map(c => c.low)),
        close: sortedCandles[sortedCandles.length - 1].close,
        volume: sortedCandles.reduce((sum, c) => sum + (c.volume || 0), 0),
      });
    }
  }

  if (synthetic4h.length === 0) {
    return 0;
  }

  // Upsert synthetic 4h candles
  const { data, error: upsertError } = await supabase
    .from('market_ohlcv_raw')
    .upsert(synthetic4h, {
      onConflict: 'symbol,granularity,ts_utc',
      ignoreDuplicates: true
    })
    .select();

  if (upsertError) {
    throw new Error(`Failed to upsert synthetic 4h candles: ${upsertError.message}`);
  }

  return data?.length || 0;
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
    open: Number.isFinite(candle[3]) ? candle[3] : 0,
    high: Number.isFinite(candle[2]) ? candle[2] : 0,
    low: Number.isFinite(candle[1]) ? candle[1] : 0,
    close: Number.isFinite(candle[4]) ? candle[4] : 0,
    volume: Number.isFinite(candle[5]) && candle[5] >= 0 ? candle[5] : 0,
  }));

  const { data, error } = await supabase
    .from('market_ohlcv_raw')
    .upsert(rows, {
      onConflict: 'symbol,granularity,ts_utc',
      ignoreDuplicates: true
    })
    .select();

  if (error) {
    logger.error(`❌ Failed to upsert candles for ${symbol} ${granularity}: ${error.message}`);
    throw new Error(`Failed to upsert candles: ${error.message}`);
  }

  const rowsWritten = data?.length || 0;
  
  if (rowsWritten > 0 && candles.length > 0) {
    const firstTs = new Date(candles[0][0] * 1000).toISOString();
    const lastTs = new Date(candles[candles.length - 1][0] * 1000).toISOString();
    logger.info(`✅ Upserted ${rowsWritten} candles for ${symbol} ${granularity} (${firstTs} to ${lastTs})`);
  } else {
    logger.info(`✅ Upserted ${rowsWritten} candles for ${symbol} ${granularity}`);
  }
  
  return rowsWritten;
}

async function updateHealthMetrics(
  supabase: any,
  symbol: string,
  granularity: string,
  success: boolean,
  latestCandleTs?: string
): Promise<void> {
  const updateData: any = {
    last_backfill_at: new Date().toISOString(),
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

const name = "ohlcv-backfill";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const cronHeader = (req.headers.get("x-cron-secret") ?? "").trim();
    const cronEnv = (Deno.env.get("CRON_SECRET") ?? "").trim();
    const hasAuth = !!req.headers.get("authorization");
    const hasApiKey = !!req.headers.get("apikey");

    // DEBUG: Log function entry
    logger.info(`🔍 OHLCV Backfill invoked - Method: ${req.method}, Has x-cron-secret: ${!!cronHeader}, Has auth: ${hasAuth}, Has apikey: ${hasApiKey}`);
    logger.info(`🔍 CRON_SECRET present in env: ${!!cronEnv}, Lengths: header=${cronHeader.length}, env=${cronEnv.length}`);

    // Diagnostic probe (only when DEBUG_PROBE=1)
    if (Deno.env.get("DEBUG_PROBE") === "1") {
      const auth = req.headers.get("authorization") ?? "";
      const apikey = req.headers.get("apikey") ?? "";
      
      console.log(JSON.stringify({
        tag: "edge_probe",
        cronEnvPrefix: cronEnv.slice(0, 8),
        cronEnvLen: cronEnv.length,
        cronHeaderPrefix: cronHeader.slice(0, 8),
        cronHeaderLen: cronHeader.length,
        hasCronEnv: !!cronEnv,
        authPrefix: auth.slice(0, 12),
        apikeyPrefix: apikey.slice(0, 12)
      }));
    }

    // Flexible authentication: Accept EITHER cron secret OR JWT
    // - If CRON_SECRET is configured AND x-cron-secret header is provided, validate them
    // - Otherwise, rely on JWT authentication (verify_jwt=true enforced by Supabase)
    // This allows both scheduled runs (GitHub with cron secret) and manual runs (JWT auth)
    const useCronAuth = cronEnv && cronHeader;
    
    if (useCronAuth && cronHeader !== cronEnv) {
      logger.error(`❌ Cron secret mismatch - authentication failed`);
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid cron secret" }), { 
        status: 403, 
        headers: corsHeaders 
      });
    }

    logger.info(`✅ Authentication successful (mode: ${useCronAuth ? 'cron-secret' : 'jwt'})`);


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
    
    const symbols = Array.isArray(payload.symbols) && payload.symbols.length 
      ? payload.symbols 
      : ["BTC-EUR","ETH-EUR","XRP-EUR","ADA-EUR","SOL-EUR"];
    const granularitiesDefault = ["1h","24h","4h"];
    const granularities = Array.isArray(payload.granularities) && payload.granularities.length 
      ? payload.granularities 
      : granularitiesDefault;
    const lookback_days = Number.isFinite(payload.lookback_days) && payload.lookback_days > 0 
      ? payload.lookback_days 
      : 30;

    // Shuffle symbols to prevent systematic rate limit starvation of later symbols
    const shuffledSymbols = [...symbols].sort(() => Math.random() - 0.5);

    if (!Array.isArray(symbols) || !Array.isArray(granularities)) {
      return new Response(JSON.stringify({ 
        error: "Invalid payload: symbols[] and granularities[] required" 
      }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }
    
    logger.info(`Starting paginated backfill for ${symbols.length} symbols × ${granularities.length} granularities, ${lookback_days} days`);
    logger.info(`Processing symbols in random order: ${shuffledSymbols.join(', ')}`);

    const rateLimiter = new RateLimiter();
    const results: any[] = [];
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (lookback_days * 24 * 60 * 60 * 1000));

    // Process each symbol-granularity combination
    for (const symbol of shuffledSymbols) {
      for (const granularity of granularities) {
        try {
          let latestCandleTs: string | undefined;
          
          if (granularity === '4h') {
            // Ensure we have 1h data first, then synthesize 4h
            if (!granularities.includes('1h')) {
              logger.warn(`Skipping 4h synthesis for ${symbol} - 1h not in granularities list`);
              continue;
            }
            
            const synthetic4hCount = await synthesize4hCandles(supabase, symbol, startTime, endTime);
            
            // Get latest 4h candle timestamp
            if (synthetic4hCount > 0) {
              const { data } = await supabase
                .from('market_ohlcv_raw')
                .select('ts_utc')
                .eq('symbol', symbol)
                .eq('granularity', '4h')
                .order('ts_utc', { ascending: false })
                .limit(1);
              latestCandleTs = data?.[0]?.ts_utc;
            }
            
            await updateHealthMetrics(supabase, symbol, granularity, true, latestCandleTs);
            
            results.push({
              symbol,
              granularity,
              candles_fetched: 0,
              candles_synthesized: synthetic4hCount,
              candles_upserted: synthetic4hCount,
              success: true
            });

            logger.info(`✓ ${symbol} ${granularity}: ${synthetic4hCount} synthesized from 1h`);
          } else {
            // Native granularities (1h, 24h)
            logger.info(`🔄 Processing ${symbol} ${granularity} from ${startTime.toISOString()} to ${endTime.toISOString()}`);
            logger.info(`Backfilling ${symbol} ${granularity} with pagination`);
            
            const candles = await fetchCoinbaseCandlesPaginated(
              symbol,
              granularity,
              startTime,
              endTime,
              rateLimiter
            );

            logger.info(`📦 Fetched ${candles.length} candles for ${symbol} ${granularity}`);
            const upsertedCount = await upsertCandles(supabase, symbol, granularity, candles);
            logger.info(`💾 Upserted ${upsertedCount} rows for ${symbol} ${granularity}`);

            
            // Get latest candle timestamp from fetched data  
            if (candles.length > 0) {
              const sortedCandles = candles.sort((a, b) => b[0] - a[0]);
              latestCandleTs = new Date(sortedCandles[0][0] * 1000).toISOString();
            }
            
            await updateHealthMetrics(supabase, symbol, granularity, true, latestCandleTs);
            
            results.push({
              symbol,
              granularity,
              candles_fetched: candles.length,
              candles_upserted: upsertedCount,
              success: true
            });

            logger.info(`✓ ${symbol} ${granularity}: ${candles.length} fetched, ${upsertedCount} upserted`);
          }
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

    logger.info(`Paginated backfill complete: ${successCount}/${totalCount} successful`);

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