// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// =============================================================================
// EODHD COLLECTOR
// Fetches OHLCV data from EODHD API, stores in market_ohlcv_raw, and generates
// trading signals (volume spikes, volatility, breakouts) into live_signals.
//
// FIX (Dec 2024): Added fallback user_id resolution when source.user_id is NULL.
// System-level sources have user_id = NULL but live_signals requires NOT NULL.
// =============================================================================

const EODHD_CRYPTO_SYMBOL_MAP: Record<string, string> = {
  'AAVE-EUR': 'AAVE-USD.CC',
  'ADA-EUR': 'ADA-USD.CC',
  'ALGO-EUR': 'ALGO-USD.CC',
  'ATOM-EUR': 'ATOM-USD.CC',
  'AVAX-EUR': 'AVAX-USD.CC',
  'BCH-EUR': 'BCH-USD.CC',
  'BTC-EUR': 'BTC-USD.CC',
  'CRV-EUR': 'CRV-USD.CC',
  'DOT-EUR': 'DOT-USD.CC',
  'ETH-EUR': 'ETH-USD.CC',
  'FIL-EUR': 'FIL-USD.CC',
  'ICP-EUR': 'ICP-USD.CC',
  'LINK-EUR': 'LINK-USD.CC',
  'LTC-EUR': 'LTC-USD.CC',
  'SOL-EUR': 'SOL-USD.CC',
  'UNI-EUR': 'UNI-USD.CC',
  'USDC-EUR': 'USDC-USD.CC',
  'USDT-EUR': 'USDT-USD.CC',
  'XLM-EUR': 'XLM-USD.CC',
  'XRP-EUR': 'XRP-USD.CC',
  'APT-EUR': 'APT-USD.CC',
  'ARB-EUR': 'ARB-USD.CC',
  'DOGE-EUR': 'DOGE-USD.CC',
  'EOS-EUR': 'EOS-USD.CC',
  'FLOW-EUR': 'FLOW-USD.CC',
  'GRT-EUR': 'GRT-USD.CC',
  'HBAR-EUR': 'HBAR-USD.CC',
  'IMX-EUR': 'IMX-USD.CC',
  'MATIC-EUR': 'MATIC-USD.CC',
  'NEAR-EUR': 'NEAR-USD.CC',
  'OP-EUR': 'OP-USD.CC',
  'SHIB-EUR': 'SHIB-USD.CC',
  'SUI-EUR': 'SUI-USD.CC',
  'VET-EUR': 'VET-USD.CC',
  'XTZ-EUR': 'XTZ-USD.CC',
};

function toEodhdCryptoSymbol(localSymbol: string): string {
  if (EODHD_CRYPTO_SYMBOL_MAP[localSymbol]) {
    return EODHD_CRYPTO_SYMBOL_MAP[localSymbol];
  }
  const base = localSymbol.split('-')[0];
  return `${base}-USD.CC`;
}

const GRANULARITY_MAP: Record<string, string> = {
  '1m': '1h',
  '5m': '1h',
  '15m': '1h',
  '1h': '1h',
  '4h': '4h',
  '1d': '24h',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cronSecret = req.headers.get('x-cron-secret');
    const expectedSecret = Deno.env.get('CRON_SECRET');
    const isScheduledRun = cronSecret && cronSecret.trim() === expectedSecret?.trim();
    
    console.log(`📊 EODHD Collector triggered (scheduled: ${isScheduledRun})`);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get active eodhd data sources
    const { data: sources, error: sourcesError } = await supabaseClient
      .from('ai_data_sources')
      .select('*')
      .in('source_name', ['eodhd', 'eodhd_api'])
      .eq('is_active', true);

    if (sourcesError) throw sourcesError;
    if (!sources || sources.length === 0) {
      console.log('⚠️ No active EODHD sources configured');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No active EODHD sources configured',
        sources_processed: 0,
        ohlcv_rows_inserted: 0,
        signals_created: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // FIX: Resolve fallback user_id for system sources
    let fallbackUserId: string | null = null;
    const { data: activeUsers } = await supabaseClient
      .from('trading_strategies')
      .select('user_id')
      .or('is_active_test.eq.true,is_active.eq.true')
      .limit(1);
    
    if (activeUsers && activeUsers.length > 0) {
      fallbackUserId = activeUsers[0].user_id;
      console.log(`📋 Fallback user for signals: ${fallbackUserId}`);
    } else {
      fallbackUserId = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'; // Known system user
      console.log(`⚠️ Using hardcoded fallback user: ${fallbackUserId}`);
    }

    console.log(`📊 Found ${sources.length} active EODHD source(s)`);

    let totalSignalsCreated = 0;
    let totalOhlcvRowsInserted = 0;
    const processedSources: string[] = [];

    for (const source of sources) {
      const apiKey = source.configuration?.api_key;
      if (!apiKey || apiKey === 'TO_UPDATE_BY_USER') {
        console.log(`⚠️ Skipping source ${source.id}: invalid API key`);
        continue;
      }

      // FIX: Use source.user_id if available, otherwise fallback
      const effectiveUserId = source.user_id || fallbackUserId;
      console.log(`👤 Using userId for source ${source.id}: ${effectiveUserId}`);

      const rawSymbols = source.configuration?.symbols || ['BTC-EUR', 'ETH-EUR'];
      const symbols: string[] = Array.isArray(rawSymbols) ? rawSymbols : [rawSymbols];
      const interval = source.configuration?.interval || '1h';

      console.log(`🔍 Processing source ${source.id}: ${symbols.length} symbols, interval: ${interval}`);
      processedSources.push(source.id);

      for (const symbol of symbols) {
        const localSymbol = symbol;
        
        try {
          const eodhdSymbol = toEodhdCryptoSymbol(localSymbol);
          const baseUrl = (source.configuration?.base_url ?? 'https://eodhd.com/api/').replace(/\/$/, '');
          const url = `${baseUrl}/intraday/${encodeURIComponent(eodhdSymbol)}?api_token=${encodeURIComponent(apiKey)}&interval=${encodeURIComponent(interval)}&fmt=json`;
          
          console.log(`📡 Fetching ${localSymbol} (EODHD: ${eodhdSymbol}) from EODHD...`);
          const response = await fetch(url);
          
          if (!response.ok) {
            console.error(`❌ EODHD API error for ${localSymbol} (remote: ${eodhdSymbol}) – status ${response.status}`);
            continue;
          }

          let data;
          try {
            data = await response.json();
          } catch (jsonErr) {
            console.error(`❌ Invalid JSON from EODHD for ${localSymbol}`);
            continue;
          }

          const MAX_CANDLES = 300;
          if (Array.isArray(data) && data.length > MAX_CANDLES) {
            data = data.slice(-MAX_CANDLES);
          }

          if (!Array.isArray(data) || data.length === 0) {
            console.log(`⚠️ No data returned for ${localSymbol} (remote: ${eodhdSymbol})`);
            continue;
          }

          console.log(`📈 Received ${data.length} candles for ${localSymbol}`);

          // Store OHLCV data - filter out invalid candles
          const granularity = GRANULARITY_MAP[interval] || '1h';
          const ohlcvRows = data
            .filter((candle: any) => {
              const open = parseFloat(candle.open);
              const high = parseFloat(candle.high);
              const low = parseFloat(candle.low);
              const close = parseFloat(candle.close);
              return !isNaN(open) && !isNaN(high) && !isNaN(low) && !isNaN(close) &&
                     open > 0 && high > 0 && low > 0 && close > 0;
            })
            .map((candle: any) => ({
              symbol: localSymbol,
              granularity: granularity,
              ts_utc: new Date(candle.datetime || candle.timestamp * 1000).toISOString(),
              open: parseFloat(candle.open),
              high: parseFloat(candle.high),
              low: parseFloat(candle.low),
              close: parseFloat(candle.close),
              volume: parseFloat(candle.volume || 0),
            }));

          if (ohlcvRows.length > 0) {
            const { error: ohlcvError } = await supabaseClient
              .from('market_ohlcv_raw')
              .upsert(ohlcvRows, {
                onConflict: 'symbol,granularity,ts_utc',
                ignoreDuplicates: true
              });

            if (ohlcvError) {
              console.error(`❌ Error upserting OHLCV for ${localSymbol}:`, ohlcvError.message);
            } else {
              totalOhlcvRowsInserted += ohlcvRows.length;
              console.log(`✅ Upserted ${ohlcvRows.length} OHLCV rows for ${localSymbol} (${granularity})`);
            }
          }

          // Generate trading signals with VALID user_id
          if (data.length >= 20 && effectiveUserId) {
            const recentData = data.slice(-20);
            const latest = recentData[recentData.length - 1];
            const prices = recentData.map((d: any) => parseFloat(d.close));
            const volumes = recentData.map((d: any) => parseFloat(d.volume || 0));

            const avgVolume = volumes.reduce((a: number, b: number) => a + b, 0) / volumes.length;
            const latestVolume = parseFloat(latest.volume || 0);
            const priceChangePct = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
            
            const priceChanges = prices.slice(1).map((p: number, i: number) => (p - prices[i]) / prices[i]);
            const avgChange = priceChanges.reduce((a: number, b: number) => a + b, 0) / priceChanges.length;
            const volatility = Math.sqrt(
              priceChanges.reduce((sum: number, change: number) => sum + Math.pow(change - avgChange, 2), 0) / priceChanges.length
            );

            const signals: any[] = [];

            // Volume spike
            if (latestVolume > avgVolume * 2.0) {
              signals.push({
                source_id: source.id,
                user_id: effectiveUserId, // FIX: Use resolved user_id
                timestamp: new Date(latest.datetime || latest.timestamp * 1000).toISOString(),
                symbol: localSymbol,
                signal_type: 'eodhd_intraday_volume_spike',
                signal_strength: Math.min(100, (latestVolume / avgVolume - 1) * 50),
                source: 'eodhd',
                data: {
                  current_volume: latestVolume,
                  avg_volume: avgVolume,
                  volume_ratio: latestVolume / avgVolume,
                  price: parseFloat(latest.close),
                  interval: interval
                },
                processed: false
              });
            }

            // Unusual volatility
            if (volatility > 0.01) {
              signals.push({
                source_id: source.id,
                user_id: effectiveUserId,
                timestamp: new Date(latest.datetime || latest.timestamp * 1000).toISOString(),
                symbol: localSymbol,
                signal_type: 'eodhd_unusual_volatility',
                signal_strength: Math.min(100, volatility * 5000),
                source: 'eodhd',
                data: {
                  volatility: volatility,
                  price_change_pct: priceChangePct,
                  price: parseFloat(latest.close),
                  interval: interval
                },
                processed: false
              });
            }

            // Price breakouts
            if (priceChangePct > 3) {
              signals.push({
                source_id: source.id,
                user_id: effectiveUserId,
                timestamp: new Date(latest.datetime || latest.timestamp * 1000).toISOString(),
                symbol: localSymbol,
                signal_type: 'eodhd_price_breakout_bullish',
                signal_strength: Math.min(100, Math.abs(priceChangePct) * 10),
                source: 'eodhd',
                data: {
                  price_change_pct: priceChangePct,
                  current_price: parseFloat(latest.close),
                  start_price: prices[0],
                  interval: interval
                },
                processed: false
              });
            } else if (priceChangePct < -3) {
              signals.push({
                source_id: source.id,
                user_id: effectiveUserId,
                timestamp: new Date(latest.datetime || latest.timestamp * 1000).toISOString(),
                symbol: localSymbol,
                signal_type: 'eodhd_price_breakdown_bearish',
                signal_strength: Math.min(100, Math.abs(priceChangePct) * 10),
                source: 'eodhd',
                data: {
                  price_change_pct: priceChangePct,
                  current_price: parseFloat(latest.close),
                  start_price: prices[0],
                  interval: interval
                },
                processed: false
              });
            }

            if (signals.length > 0) {
              const { error: signalError } = await supabaseClient
                .from('live_signals')
                .insert(signals);

              if (signalError) {
                console.error('❌ Error inserting EODHD signals:', signalError);
              } else {
                totalSignalsCreated += signals.length;
                console.log(`✅ Inserted ${signals.length} signals for ${localSymbol}`);
              }
            }
          }

        } catch (error) {
          console.error(`❌ Error processing ${localSymbol}:`, error);
        }
      }

      // Update last_sync timestamp
      await supabaseClient
        .from('ai_data_sources')
        .update({ last_sync: new Date().toISOString() })
        .eq('id', source.id);
    }

    console.log(`📊 EODHD Collection complete:`);
    console.log(`   - Sources processed: ${processedSources.length}`);
    console.log(`   - OHLCV rows inserted: ${totalOhlcvRowsInserted}`);
    console.log(`   - Signals created: ${totalSignalsCreated}`);

    return new Response(JSON.stringify({ 
      success: true, 
      sources_processed: processedSources.length,
      source_ids: processedSources,
      ohlcv_rows_inserted: totalOhlcvRowsInserted,
      signals_created: totalSignalsCreated,
      message: 'EODHD collection completed'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ EODHD Collector error:', error);
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});