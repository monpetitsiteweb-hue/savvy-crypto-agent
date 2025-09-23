import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logger } from '../_shared/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface FeaturesRequest {
  symbols: string[];
  granularities: string[];
  lookback_days: number;
}

async function computeFeatures(
  supabase: any,
  symbol: string,
  granularity: string,
  lookbackDays: number
): Promise<number> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - (lookbackDays * 24 * 60 * 60 * 1000));

  // Get OHLCV data for feature computation
  const { data: candles, error } = await supabase
    .from('market_ohlcv_raw')
    .select('ts_utc, open, high, low, close, volume')
    .eq('symbol', symbol)
    .eq('granularity', granularity)
    .gte('ts_utc', startTime.toISOString())
    .order('ts_utc');

  if (error) {
    throw new Error(`Failed to fetch candles for features: ${error.message}`);
  }

  if (!candles || candles.length < 2) {
    logger.warn(`Insufficient data for ${symbol} ${granularity}: ${candles?.length || 0} candles`);
    return 0;
  }

  // Scale windows by granularity
  const step = { '1h': 1, '4h': 4, '24h': 24 }[granularity] || 1;
  const ret_1h_window = Math.max(1, Math.floor(1 / step));
  const ret_4h_window = Math.max(1, Math.floor(4 / step));  
  const ret_24h_window = Math.max(1, Math.floor(24 / step));
  const ret_7d_window = Math.max(1, Math.floor(168 / step));

  // Compute rolling returns and volatility features
  const features = [];
  
  for (let i = 1; i < candles.length; i++) {
    const currentCandle = candles[i];
    const ts_utc = currentCandle.ts_utc;
    const currentPrice = currentCandle.close;
    
    // Calculate returns (log returns for better properties) using scaled windows
    const ret_1h = i >= ret_1h_window ? Math.log(currentPrice / candles[i - ret_1h_window].close) : null;
    const ret_4h = i >= ret_4h_window ? Math.log(currentPrice / candles[i - ret_4h_window].close) : null;
    const ret_24h = i >= ret_24h_window ? Math.log(currentPrice / candles[i - ret_24h_window].close) : null;
    const ret_7d = i >= ret_7d_window ? Math.log(currentPrice / candles[i - ret_7d_window].close) : null;
    
    // Calculate rolling volatility (std dev of log returns) using scaled windows
    const getVolatility = (startIdx: number, endIdx: number) => {
      if (startIdx >= endIdx || endIdx - startIdx < 2) return null;
      
      const returns = [];
      for (let j = startIdx + 1; j <= endIdx; j++) {
        returns.push(Math.log(candles[j].close / candles[j-1].close));
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
      ret_1h,
      ret_4h,
      ret_24h,
      ret_7d,
      vol_1h,
      vol_4h,
      vol_24h,
      vol_7d,
    });
  }

  if (features.length === 0) {
    return 0;
  }

  // Upsert features
  const { data, error: upsertError } = await supabase
    .from('market_features_v0')
    .upsert(features, {
      onConflict: 'symbol,granularity,ts_utc',
      ignoreDuplicates: true
    })
    .select();

  if (upsertError) {
    throw new Error(`Failed to upsert features: ${upsertError.message}`);
  }

  return data?.length || 0;
}

async function updateHealthMetrics(supabase: any): Promise<void> {
  // Update coverage and staleness metrics
  const { error } = await supabase.rpc('refresh_data_health_metrics');
  
  if (error) {
    logger.warn(`Failed to refresh health metrics: ${error.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Diagnostic probe
    const auth = req.headers.get("authorization") ?? "";
    const apikey = req.headers.get("apikey") ?? "";
    const cronHeader = (req.headers.get("x-cron-secret") ?? "").trim();
    const cronEnv = (Deno.env.get("CRON_SECRET") ?? "").trim();

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

    // Cron secret authentication
    if (!cronEnv || cronHeader !== cronEnv) {
      console.error("[data-ingest] invalid x-cron-secret (mismatch)", {
        cronEnvLen: cronEnv.length,
        cronHeaderLen: cronHeader.length
      });
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
    }

    console.log('[data-ingest] cron auth ok');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { symbols, granularities, lookback_days }: FeaturesRequest = await req.json();
    
    logger.info(`Computing features for ${symbols.length} symbols × ${granularities.length} granularities`);

    const results: any[] = [];

    // Process each symbol-granularity combination
    for (const symbol of symbols) {
      for (const granularity of granularities) {
        try {
          const featuresCount = await computeFeatures(supabase, symbol, granularity, lookback_days);
          
          results.push({
            symbol,
            granularity,
            features_computed: featuresCount,
            success: true
          });

          logger.info(`✓ ${symbol} ${granularity}: ${featuresCount} features computed`);
        } catch (error) {
          logger.error(`✗ ${symbol} ${granularity} features: ${error.message}`);
          
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

    logger.info(`Features computation complete: ${successCount}/${totalCount} successful`);

    return new Response(JSON.stringify({
      success: true,
      summary: {
        total_series: totalCount,
        successful_series: successCount,
        failed_series: totalCount - successCount,
      },
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    logger.error(`Features computation error: ${error.message}`);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});