// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`📊 EODHD Collector triggered`);

    // Get active eodhd data sources
    const { data: sources, error: sourcesError } = await supabaseClient
      .from('ai_data_sources')
      .select('*')
      .eq('source_name', 'eodhd')
      .eq('is_active', true);

    if (sourcesError) throw sourcesError;
    if (!sources || sources.length === 0) {
      console.log('⚠️ No active EODHD sources configured');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No active EODHD sources configured' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let totalSignalsCreated = 0;

    for (const source of sources) {
      const apiKey = source.configuration?.api_key;
      if (!apiKey || apiKey === 'TO_UPDATE_BY_USER') {
        console.log(`⚠️ Skipping source ${source.id}: invalid API key`);
        continue;
      }

      const symbols = source.configuration?.symbols || ['BTC-USD', 'ETH-USD'];
      const interval = source.configuration?.interval || '5m';

      console.log(`🔍 Fetching EODHD intraday data for ${symbols.join(', ')} (interval: ${interval})`);

      for (const symbol of symbols) {
        try {
          // Convert symbol format for EODHD (BTC-USD -> BTC.CC)
          const eodhSymbol = symbol.replace('-', '.CC');
          const url = `https://eodhd.com/api/intraday/${eodhSymbol}?api_token=${apiKey}&interval=${interval}&fmt=json`;
          
          const response = await fetch(url);
          if (!response.ok) {
            console.error(`❌ EODHD API error for ${symbol}: ${response.status} ${response.statusText}`);
            continue;
          }

          const data = await response.json();
          if (!Array.isArray(data) || data.length < 20) {
            console.log(`⚠️ Insufficient data for ${symbol}, skipping analysis`);
            continue;
          }

          // Take last 20 intervals for analysis
          const recentData = data.slice(-20);
          const latest = recentData[recentData.length - 1];
          const prices = recentData.map(d => parseFloat(d.close));
          const volumes = recentData.map(d => parseFloat(d.volume || 0));

          // Calculate metrics
          const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
          const latestVolume = parseFloat(latest.volume || 0);
          const priceChangePct = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
          
          // Calculate volatility (standard deviation of price changes)
          const priceChanges = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
          const avgChange = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
          const volatility = Math.sqrt(
            priceChanges.reduce((sum, change) => sum + Math.pow(change - avgChange, 2), 0) / priceChanges.length
          );

          const signals = [];

          // Detect volume spike
          if (latestVolume > avgVolume * 2.0) {
            signals.push({
              source_id: source.id,
              user_id: source.user_id,
              timestamp: new Date(latest.datetime || latest.timestamp).toISOString(),
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
              timestamp: new Date(latest.datetime || latest.timestamp).toISOString(),
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
              timestamp: new Date(latest.datetime || latest.timestamp).toISOString(),
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
              timestamp: new Date(latest.datetime || latest.timestamp).toISOString(),
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
              console.log(`[EODHD] Inserted ${signals.length} signals into live_signals for ${symbol}`);
            }
          }

        } catch (error) {
          console.error(`❌ Error processing ${symbol}:`, error);
        }
      }

      // Update last_sync
      await supabaseClient
        .from('ai_data_sources')
        .update({ last_sync: new Date().toISOString() })
        .eq('id', source.id);
    }

    console.log(`[EODHD] Inserted ${totalSignalsCreated} signals into live_signals (source: eodhd)`);

    return new Response(JSON.stringify({ 
      success: true, 
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
