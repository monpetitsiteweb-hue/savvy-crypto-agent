// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// Granularity mapping for EODHD intervals
const GRANULARITY_MAP: Record<string, string> = {
  '1m': '1h',   // Map 1min to 1h granularity bucket
  '5m': '1h',   // Map 5min to 1h granularity bucket
  '15m': '1h',  // Map 15min to 1h granularity bucket
  '1h': '1h',
  '4h': '4h',
  '1d': '24h',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate cron secret for scheduled invocations (optional for manual testing)
    const cronSecret = req.headers.get('x-cron-secret');
    const expectedSecret = Deno.env.get('CRON_SECRET');
    const isScheduledRun = cronSecret && cronSecret.trim() === expectedSecret?.trim();
    
    console.log(`📊 EODHD Collector triggered (scheduled: ${isScheduledRun})`);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get active eodhd data sources (supports both 'eodhd' and 'eodhd_api')
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

      // Get symbols from configuration - support EUR symbols
      const rawSymbols = source.configuration?.symbols || ['BTC-EUR', 'ETH-EUR'];
      const symbols: string[] = Array.isArray(rawSymbols) ? rawSymbols : [rawSymbols];
      const interval = source.configuration?.interval || '1h';

      console.log(`🔍 Processing source ${source.id}: ${symbols.length} symbols, interval: ${interval}`);
      processedSources.push(source.id);

      for (const symbol of symbols) {
        try {
          // Convert symbol format for EODHD API
          // BTC-EUR -> BTC-EUR.CC, BTC-USD -> BTC-USD.CC, BTC -> BTC.CC
          let eodhSymbol: string;
          if (symbol.includes('-')) {
            eodhSymbol = `${symbol}.CC`;
          } else {
            eodhSymbol = `${symbol}.CC`;
          }
          
          const url = `https://eodhd.com/api/intraday/${eodhSymbol}?api_token=${apiKey}&interval=${interval}&fmt=json`;
          
          console.log(`📡 Fetching ${symbol} from EODHD...`);
          const response = await fetch(url);
          
          if (!response.ok) {
            console.error(`❌ EODHD API error for ${symbol}: ${response.status} ${response.statusText}`);
            continue;
          }

          const data = await response.json();
          if (!Array.isArray(data) || data.length === 0) {
            console.log(`⚠️ No data returned for ${symbol}`);
            continue;
          }

          console.log(`📈 Received ${data.length} candles for ${symbol}`);

          // ============================================================
          // PART 1: Store OHLCV data into market_ohlcv_raw
          // ============================================================
          const granularity = GRANULARITY_MAP[interval] || '1h';
          
          // Map EODHD response to market_ohlcv_raw format
          const ohlcvRows = data.map((candle: any) => ({
            symbol: symbol, // Keep original symbol format (e.g., BTC-EUR)
            granularity: granularity,
            ts_utc: new Date(candle.datetime || candle.timestamp * 1000).toISOString(),
            open: parseFloat(candle.open),
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            close: parseFloat(candle.close),
            volume: parseFloat(candle.volume || 0),
          }));

          // Upsert OHLCV data (idempotent - no duplicates)
          const { data: upsertedOhlcv, error: ohlcvError } = await supabaseClient
            .from('market_ohlcv_raw')
            .upsert(ohlcvRows, {
              onConflict: 'symbol,granularity,ts_utc',
              ignoreDuplicates: true
            })
            .select();

          if (ohlcvError) {
            console.error(`❌ Error upserting OHLCV for ${symbol}:`, ohlcvError.message);
          } else {
            const insertedCount = upsertedOhlcv?.length || 0;
            totalOhlcvRowsInserted += insertedCount;
            console.log(`✅ Upserted ${insertedCount} OHLCV rows for ${symbol} (${granularity})`);
          }

          // ============================================================
          // PART 2: Generate trading signals (existing behavior)
          // ============================================================
          if (data.length >= 20) {
            const recentData = data.slice(-20);
            const latest = recentData[recentData.length - 1];
            const prices = recentData.map((d: any) => parseFloat(d.close));
            const volumes = recentData.map((d: any) => parseFloat(d.volume || 0));

            // Calculate metrics
            const avgVolume = volumes.reduce((a: number, b: number) => a + b, 0) / volumes.length;
            const latestVolume = parseFloat(latest.volume || 0);
            const priceChangePct = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
            
            // Calculate volatility (standard deviation of price changes)
            const priceChanges = prices.slice(1).map((p: number, i: number) => (p - prices[i]) / prices[i]);
            const avgChange = priceChanges.reduce((a: number, b: number) => a + b, 0) / priceChanges.length;
            const volatility = Math.sqrt(
              priceChanges.reduce((sum: number, change: number) => sum + Math.pow(change - avgChange, 2), 0) / priceChanges.length
            );

            const signals: any[] = [];

            // Detect volume spike
            if (latestVolume > avgVolume * 2.0) {
              signals.push({
                source_id: source.id,
                user_id: source.user_id,
                timestamp: new Date(latest.datetime || latest.timestamp * 1000).toISOString(),
                symbol: symbol,
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

            // Detect unusual volatility
            if (volatility > 0.01) {
              signals.push({
                source_id: source.id,
                user_id: source.user_id,
                timestamp: new Date(latest.datetime || latest.timestamp * 1000).toISOString(),
                symbol: symbol,
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

            // Detect price breakouts
            if (priceChangePct > 3) {
              signals.push({
                source_id: source.id,
                user_id: source.user_id,
                timestamp: new Date(latest.datetime || latest.timestamp * 1000).toISOString(),
                symbol: symbol,
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
                user_id: source.user_id,
                timestamp: new Date(latest.datetime || latest.timestamp * 1000).toISOString(),
                symbol: symbol,
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

            // Insert signals into live_signals
            if (signals.length > 0) {
              const { error: signalError } = await supabaseClient
                .from('live_signals')
                .insert(signals);

              if (signalError) {
                console.error('❌ Error inserting EODHD signals:', signalError);
              } else {
                totalSignalsCreated += signals.length;
                console.log(`✅ Inserted ${signals.length} signals for ${symbol}`);
              }
            }
          }

        } catch (error) {
          console.error(`❌ Error processing ${symbol}:`, error);
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
