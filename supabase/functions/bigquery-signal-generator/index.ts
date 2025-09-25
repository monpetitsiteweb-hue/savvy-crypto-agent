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
    console.log('🧠 BigQuery Signal Generator triggered');
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { symbols = ['BTC', 'ETH', 'XRP'], userId, sourceId } = await req.json().catch(() => ({}));

    // Get BigQuery data source
    let { data: dataSource } = await supabaseClient
      .from('ai_data_sources')
      .select('id, user_id')
      .eq('source_name', 'bigquery')
      .eq('is_active', true)
      .single();

    if (!dataSource) {
      console.log('❌ No active BigQuery data source found');
      return new Response(JSON.stringify({ error: 'No BigQuery data source found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const actualUserId = userId || dataSource.user_id;
    const actualSourceId = sourceId || dataSource.id;

    console.log(`🔍 Analyzing BigQuery historical data for signals`);

    const signals = [];
    const now = new Date();

    for (const symbol of symbols) {
      try {
        // Get historical market data from BigQuery for pattern analysis
        const { data: historicalData, error: histError } = await supabaseClient
          .from('historical_market_data')
          .select('*')
          .eq('symbol', symbol)
          .eq('source', 'bigquery')
          .gte('timestamp', new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()) // Last 7 days
          .order('timestamp', { ascending: true });

        if (histError) {
          console.error(`❌ Error fetching BigQuery data for ${symbol}:`, histError);
          continue;
        }

        if (!historicalData || historicalData.length < 3) {
          console.log(`⚠️ Insufficient BigQuery data for ${symbol} (${historicalData?.length || 0} points)`);
          continue;
        }

        console.log(`📊 Analyzing ${historicalData.length} BigQuery data points for ${symbol}`);

        // Generate signals from BigQuery historical patterns
        const bigQuerySignals = await generateBigQuerySignals(symbol, historicalData, actualUserId, actualSourceId);
        signals.push(...bigQuerySignals);

      } catch (error) {
        console.error(`❌ Error analyzing BigQuery data for ${symbol}:`, error);
      }
    }

    // Insert all generated signals
    if (signals.length > 0) {
      const { data: insertedSignals, error: signalError } = await supabaseClient
        .from('live_signals')
        .insert(signals);

      if (signalError) {
        console.error('❌ Error inserting BigQuery signals:', signalError);
      } else {
        console.log(`✅ Generated ${signals.length} BigQuery signals`);
      }
    } else {
      console.log('ℹ️ No BigQuery signals generated this cycle');
    }

    // Update last sync timestamp
    await supabaseClient
      .from('ai_data_sources')
      .update({ last_sync: new Date().toISOString() })
      .eq('id', actualSourceId);

    return new Response(JSON.stringify({
      success: true,
      signals_generated: signals.length,
      symbols_analyzed: symbols.length,
      timestamp: new Date().toISOString(),
      message: `Generated ${signals.length} BigQuery historical signals`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ BigQuery Signal Generator error:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function generateBigQuerySignals(symbol: string, historicalData: any[], userId: string, sourceId: string) {
  const signals = [];
  const latest = historicalData[historicalData.length - 1];
  const oldest = historicalData[0];

  console.log(`🔬 Analyzing BigQuery patterns for ${symbol}: ${historicalData.length} historical points`);

  // 1. 7-Day Trend Analysis
  if (historicalData.length >= 3) {
    const weeklyChange = ((latest.price - oldest.price) / oldest.price) * 100;
    console.log(`📊 ${symbol} - 7-day change: ${weeklyChange.toFixed(2)}%`);

    // Strong weekly breakout (>10% move)
    if (Math.abs(weeklyChange) > 10) {
      const signalType = weeklyChange > 0 ? 'weekly_breakout_bullish' : 'weekly_breakdown_bearish';
      const strength = Math.min(100, Math.abs(weeklyChange) * 5);

      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: symbol,
        signal_type: signalType,
        signal_strength: strength,
        source: 'bigquery_historical',
        data: {
          weekly_change: weeklyChange,
          start_price: oldest.price,
          end_price: latest.price,
          timeframe: '7_days',
          indicator: 'weekly_trend',
          data_points: historicalData.length
        },
        processed: false
      });
    }
  }

  // 2. Volume Pattern Analysis
  const avgVolume = historicalData.reduce((sum, d) => sum + (d.volume || 0), 0) / historicalData.length;
  const recentVolume = latest.volume || 0;

  if (avgVolume > 0 && recentVolume > avgVolume * 2) {
    console.log(`📊 ${symbol} Historical volume spike: ${(recentVolume / avgVolume).toFixed(2)}x average`);

    signals.push({
      source_id: sourceId,
      user_id: userId,
      timestamp: new Date().toISOString(),
      symbol: symbol,
      signal_type: 'historical_volume_surge',
      signal_strength: Math.min(100, (recentVolume / avgVolume) * 25),
      source: 'bigquery_historical',
      data: {
        current_volume: recentVolume,
        average_volume: avgVolume,
        volume_ratio: recentVolume / avgVolume,
        timeframe: '7_days',
        indicator: 'volume_pattern'
      },
      processed: false
    });
  }

  // 3. Market Cap Momentum
  if (historicalData.every(d => d.market_cap)) {
    const marketCapData = historicalData.map(d => d.market_cap).filter(mc => mc > 0);
    if (marketCapData.length >= 3) {
      const mcChange = ((latest.market_cap - marketCapData[0]) / marketCapData[0]) * 100;
      
      console.log(`📊 ${symbol} Market cap change: ${mcChange.toFixed(2)}%`);

      if (Math.abs(mcChange) > 15) { // Significant market cap shift
        const signalType = mcChange > 0 ? 'market_cap_expansion' : 'market_cap_contraction';
        
        signals.push({
          source_id: sourceId,
          user_id: userId,
          timestamp: new Date().toISOString(),
          symbol: symbol,
          signal_type: signalType,
          signal_strength: Math.min(100, Math.abs(mcChange) * 4),
          source: 'bigquery_historical',
          data: {
            market_cap_change: mcChange,
            start_market_cap: marketCapData[0],
            end_market_cap: latest.market_cap,
            timeframe: '7_days',
            indicator: 'market_cap_momentum'
          },
          processed: false
        });
      }
    }
  }

  // 4. Historical Support/Resistance Levels
  if (historicalData.length >= 5) {
    const prices = historicalData.map(d => d.price);
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const currentPrice = latest.price;
    const priceRange = maxPrice - minPrice;

    // Check if current price is near historical extremes
    const nearResistance = (maxPrice - currentPrice) / priceRange < 0.05; // Within 5% of high
    const nearSupport = (currentPrice - minPrice) / priceRange < 0.05; // Within 5% of low

    if (nearResistance) {
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: symbol,
        signal_type: 'historical_resistance_test',
        signal_strength: 75,
        source: 'bigquery_historical',
        data: {
          current_price: currentPrice,
          resistance_level: maxPrice,
          distance_to_resistance: ((maxPrice - currentPrice) / currentPrice) * 100,
          timeframe: '7_days',
          indicator: 'support_resistance'
        },
        processed: false
      });
    }

    if (nearSupport) {
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: symbol,
        signal_type: 'historical_support_test',
        signal_strength: 75,
        source: 'bigquery_historical',
        data: {
          current_price: currentPrice,
          support_level: minPrice,
          distance_to_support: ((currentPrice - minPrice) / currentPrice) * 100,
          timeframe: '7_days',
          indicator: 'support_resistance'
        },
        processed: false
      });
    }
  }

  console.log(`✨ Generated ${signals.length} BigQuery signals for ${symbol}`);
  return signals;
}