import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logger } from '../_shared/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  if (!candles || candles.length < 168) { // Need at least 7 days of hourly data
    logger.warn(`Insufficient data for ${symbol} ${granularity}: ${candles?.length || 0} candles`);
    return 0;
  }

  // Compute rolling returns and volatility features
  const features = [];
  
  for (let i = 167; i < candles.length; i++) { // Start after 7 days for full lookbacks
    const currentCandle = candles[i];
    const ts_utc = currentCandle.ts_utc;
    const currentPrice = currentCandle.close;
    
    // Get lookback windows
    const lookback1h = Math.max(0, i - 1);
    const lookback4h = Math.max(0, i - 4);
    const lookback24h = Math.max(0, i - 24);
    const lookback7d = Math.max(0, i - 168);
    
    // Calculate returns (log returns for better properties)
    const ret_1h = lookback1h < i ? Math.log(currentPrice / candles[lookback1h].close) : null;
    const ret_4h = lookback4h < i ? Math.log(currentPrice / candles[lookback4h].close) : null;
    const ret_24h = lookback24h < i ? Math.log(currentPrice / candles[lookback24h].close) : null;
    const ret_7d = lookback7d < i ? Math.log(currentPrice / candles[lookback7d].close) : null;
    
    // Calculate rolling volatility (std dev of log returns)
    const getVolatility = (startIdx: number, endIdx: number) => {
      if (startIdx >= endIdx) return null;
      
      const returns = [];
      for (let j = startIdx + 1; j <= endIdx; j++) {
        returns.push(Math.log(candles[j].close / candles[j-1].close));
      }
      
      if (returns.length < 2) return null;
      
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
      return Math.sqrt(variance);
    };
    
    const vol_1h = getVolatility(Math.max(0, i - 1), i);
    const vol_4h = getVolatility(Math.max(0, i - 4), i);
    const vol_24h = getVolatility(Math.max(0, i - 24), i);
    const vol_7d = getVolatility(Math.max(0, i - 168), i);
    
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