// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// =============================================================================
// TECHNICAL SIGNAL GENERATOR (P2 FIX - Dec 2024)
// 
// CHANGES:
// 1. user_id = NULL for all signals (system-wide, not per-user)
// 2. ai_data_sources lookup: filter by user_id IS NULL for system sources
// 3. MACD calculation FIXED: build macdSeries across prices, then EMA(macdSeries, 9)
// 4. Symbol normalization: always use base symbol (BTC not BTC-EUR)
// 5. NO random user fallbacks, NO hardcoded user IDs
// =============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('📊 Technical Signal Generator triggered (P2 FIX)');
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body with explicit error logging
    let parsedBody: { symbols?: string[]; sourceId?: string } = {};
    try {
      parsedBody = await req.json();
      console.log('📋 Received body:', JSON.stringify(parsedBody));
    } catch (parseErr) {
      console.error('⚠️ Failed to parse request JSON, using defaults:', parseErr);
    }
    
    // CRITICAL: Use ALL tracked symbols if none provided
    const symbols = parsedBody.symbols ?? ['BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'SOL-EUR', 'ADA-EUR', 'AVAX-EUR', 'DOT-EUR'];
    const sourceId = parsedBody.sourceId;

    // P2 FIX: Query SYSTEM source (user_id IS NULL) only
    const { data: dataSources, error: sourceError } = await supabaseClient
      .from('ai_data_sources')
      .select('id')
      .eq('source_name', 'technical_analysis')
      .is('user_id', null)  // SYSTEM source only
      .eq('is_active', true)
      .limit(1);

    if (sourceError) {
      console.error('❌ Error fetching system source:', sourceError);
    }

    let dataSource = dataSources?.[0];

    // Create system source if it doesn't exist
    if (!dataSource) {
      console.log('📝 Creating system-wide technical_analysis data source...');
      const { data: newSource, error: createError } = await supabaseClient
        .from('ai_data_sources')
        .insert({
          source_name: 'technical_analysis',
          source_type: 'price_analysis',
          api_endpoint: 'internal',
          is_active: true,
          update_frequency: '5min',
          configuration: { symbols, indicators: ['rsi', 'macd', 'price_change', 'volume_spike'] },
          user_id: null  // SYSTEM source
        })
        .select()
        .single();
      
      if (createError) {
        console.error('❌ Error creating source:', createError);
      } else {
        dataSource = newSource;
      }
    }

    const actualSourceId = sourceId || dataSource?.id;
    
    // P2 FIX: All signals will have user_id = NULL (system-wide)
    const resolvedUserId = null;

    console.log(`🔍 Analyzing technical indicators for symbols: ${symbols.join(', ')}`);
    console.log(`📊 System-wide signals (user_id = NULL), sourceId: ${actualSourceId}`);

    const signals = [];
    const now = new Date();
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    for (const symbol of symbols) {
      try {
        // Get recent price data (last 4 hours for technical analysis)
        const { data: priceData, error: priceError } = await supabaseClient
          .from('price_data')
          .select('*')
          .eq('symbol', symbol)
          .gte('timestamp', fourHoursAgo.toISOString())
          .order('timestamp', { ascending: true });

        if (priceError) {
          console.error(`❌ Error fetching price data for ${symbol}:`, priceError);
          continue;
        }

        if (!priceData || priceData.length < 2) {
          console.log(`⚠️ Insufficient price data for ${symbol} (${priceData?.length || 0} points)`);
          continue;
        }

        console.log(`📈 Analyzing ${priceData.length} price points for ${symbol}`);

        // Generate technical signals with NULL user_id (system-wide)
        const technicalSignals = await generateTechnicalSignals(symbol, priceData, resolvedUserId, actualSourceId);
        signals.push(...technicalSignals);

        // Cache calculated indicators in price_data metadata
        await cacheIndicators(symbol, priceData, supabaseClient);

      } catch (error) {
        console.error(`❌ Error analyzing ${symbol}:`, error);
      }
    }

    // Insert all generated signals
    if (signals.length > 0) {
      const { data: insertedSignals, error: signalError } = await supabaseClient
        .from('live_signals')
        .insert(signals);

      if (signalError) {
        console.error('❌ Error inserting technical signals:', signalError);
      } else {
        console.log(`✅ Generated ${signals.length} system-wide technical signals`);
      }
    } else {
      console.log('ℹ️ No technical signals generated this cycle');
    }

    // Update last sync timestamp
    if (actualSourceId) {
      await supabaseClient
        .from('ai_data_sources')
        .update({ last_sync: new Date().toISOString() })
        .eq('id', actualSourceId);
    }

    return new Response(JSON.stringify({
      success: true,
      signals_generated: signals.length,
      symbols_analyzed: symbols.length,
      user_id: null, // System-wide signals
      timestamp: new Date().toISOString(),
      message: `Generated ${signals.length} system-wide technical signals`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Technical Signal Generator error:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function generateTechnicalSignals(symbol: string, priceData: any[], userId: string | null, sourceId: string) {
  const signals = [];
  const latest = priceData[priceData.length - 1];
  const previous = priceData[priceData.length - 2];
  const earlier = priceData[0];
  
  // P2 FIX: Always use base symbol (BTC, not BTC-EUR)
  const baseSymbol = symbol.split('-')[0];

  console.log(`🔬 Calculating indicators for ${symbol}: Latest=${latest.close_price}, Previous=${previous.close_price}`);

  // 1. Price Change Analysis
  const shortTermChange = ((latest.close_price - previous.close_price) / previous.close_price) * 100;
  const longerTermChange = ((latest.close_price - earlier.close_price) / earlier.close_price) * 100;

  console.log(`📊 ${symbol} - Short-term: ${shortTermChange.toFixed(2)}%, Longer-term: ${longerTermChange.toFixed(2)}%`);

  // Generate price movement signals (lower threshold for more signals)
  if (Math.abs(shortTermChange) > 0.5) { // 0.5% threshold
    const signalType = shortTermChange > 0 ? 'price_breakout_bullish' : 'price_breakout_bearish';
    const strength = Math.min(100, Math.abs(shortTermChange) * 40);

    signals.push({
      source_id: sourceId,
      user_id: userId, // NULL for system-wide
      timestamp: new Date().toISOString(),
      symbol: baseSymbol,
      signal_type: signalType,
      signal_strength: strength,
      source: 'technical_analysis',
      data: {
        price_change_short: shortTermChange,
        price_change_longer: longerTermChange,
        current_price: latest.close_price,
        indicator: 'price_movement',
        threshold_triggered: '0.5%'
      },
      processed: false
    });
  }

  // 2. RSI Calculation
  if (priceData.length >= 15) {
    const rsi = calculateRSI(priceData.slice(-15));
    console.log(`📈 ${symbol} RSI: ${rsi.toFixed(2)}`);

    if (rsi <= 35) {
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: baseSymbol,
        signal_type: 'rsi_oversold_bullish',
        signal_strength: Math.min(100, (35 - rsi) * 3),
        source: 'technical_analysis',
        data: {
          rsi_value: rsi,
          rsi_level: 'oversold',
          current_price: latest.close_price,
          indicator: 'rsi'
        },
        processed: false
      });
    } else if (rsi >= 65) {
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: baseSymbol,
        signal_type: 'rsi_overbought_bearish',
        signal_strength: Math.min(100, (rsi - 65) * 3),
        source: 'technical_analysis',
        data: {
          rsi_value: rsi,
          rsi_level: 'overbought',
          current_price: latest.close_price,
          indicator: 'rsi'
        },
        processed: false
      });
    }
    
    // Add neutral RSI signal for momentum tracking
    if (rsi > 45 && rsi < 55) {
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: baseSymbol,
        signal_type: 'momentum_neutral',
        signal_strength: 50,
        source: 'technical_analysis',
        data: {
          rsi_value: rsi,
          rsi_level: 'neutral',
          current_price: latest.close_price,
          indicator: 'rsi'
        },
        processed: false
      });
    }
  }

  // 3. Volume Spike Analysis
  if (priceData.length >= 5) {
    const avgVolume = priceData.slice(-5).reduce((sum, p) => sum + (p.volume || 0), 0) / 5;
    const volumeSpike = (latest.volume || 0) > avgVolume * 1.5;

    if (volumeSpike && avgVolume > 0) {
      const volumeRatio = (latest.volume || 0) / avgVolume;
      console.log(`📊 ${symbol} Volume spike detected: ${volumeRatio.toFixed(2)}x average`);

      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: baseSymbol,
        signal_type: 'volume_spike',
        signal_strength: Math.min(100, (volumeRatio - 1) * 50),
        source: 'technical_analysis',
        data: {
          current_volume: latest.volume,
          average_volume: avgVolume,
          volume_ratio: volumeRatio,
          price_change: shortTermChange,
          indicator: 'volume'
        },
        processed: false
      });
    }
  }

  // 4. EMA Analysis (EMA9/EMA21 to match UI)
  if (priceData.length >= 21) {
    const prices = priceData.map(p => p.close_price);
    const ema9 = calculateEMA(prices, 9);
    const ema21 = calculateEMA(prices, 21);
    const currentPrice = latest.close_price;
    
    // Calculate the EMA spread for signal strength
    const emaSpreadPct = ((ema9 - ema21) / ema21) * 100;

    console.log(`📊 ${symbol} - Price: ${currentPrice.toFixed(2)}, EMA9: ${ema9.toFixed(2)}, EMA21: ${ema21.toFixed(2)}, Spread: ${emaSpreadPct.toFixed(4)}%`);

    // EMA Crossover Detection
    if (ema9 > ema21) {
      const strength = Math.min(100, Math.abs(emaSpreadPct) * 500);
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: baseSymbol,
        signal_type: 'ma_cross_bullish',
        signal_strength: Math.max(10, strength),
        source: 'technical_analysis',
        data: {
          ema_short: ema9,
          ema_long: ema21,
          spread_pct: emaSpreadPct,
          current_price: currentPrice,
          cross_type: 'ema_bullish',
          indicator: 'ema_crossover'
        },
        processed: false
      });
      console.log(`✅ ${symbol} EMA BULLISH: EMA9 ${ema9.toFixed(2)} > EMA21 ${ema21.toFixed(2)}`);
    } else if (ema9 < ema21) {
      const strength = Math.min(100, Math.abs(emaSpreadPct) * 500);
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: baseSymbol,
        signal_type: 'ma_cross_bearish',
        signal_strength: Math.max(10, strength),
        source: 'technical_analysis',
        data: {
          ema_short: ema9,
          ema_long: ema21,
          spread_pct: emaSpreadPct,
          current_price: currentPrice,
          cross_type: 'ema_bearish',
          indicator: 'ema_crossover'
        },
        processed: false
      });
      console.log(`🔻 ${symbol} EMA BEARISH: EMA9 ${ema9.toFixed(2)} < EMA21 ${ema21.toFixed(2)}`);
    }
    
    // Add trend signal based on price vs longer EMA
    const trendStrength = ((currentPrice - ema21) / ema21) * 100;
    if (Math.abs(trendStrength) > 0.1) {
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: baseSymbol,
        signal_type: trendStrength > 0 ? 'trend_bullish' : 'trend_bearish',
        signal_strength: Math.min(100, Math.abs(trendStrength) * 30),
        source: 'technical_analysis',
        data: {
          trend_strength: trendStrength,
          current_price: currentPrice,
          ema_reference: ema21,
          indicator: 'trend'
        },
        processed: false
      });
    }
  }

  console.log(`✨ Generated ${signals.length} technical signals for ${symbol}`);
  return signals;
}

function calculateRSI(prices: any[], period = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period && i < prices.length; i++) {
    const current = prices[i]?.close_price;
    const previous = prices[i - 1]?.close_price;
    
    if (current !== undefined && previous !== undefined) {
      const change = current - previous;
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

function calculateSMA(data: any[], field: string): number {
  if (data.length === 0) return 0;
  const sum = data.reduce((acc, item) => acc + (item[field] || 0), 0);
  return sum / data.length;
}

async function cacheIndicators(symbol: string, priceData: any[], supabaseClient: any) {
  if (priceData.length < 14) return;
  
  console.log(`💾 Caching indicators for ${symbol}`);
  const latest = priceData[priceData.length - 1];
  
  try {
    const indicators: any = {};
    
    if (priceData.length >= 15) {
      const rsi = calculateRSI(priceData.slice(-15));
      let signal = 'neutral';
      if (rsi < 30) signal = 'oversold';
      else if (rsi > 70) signal = 'overbought';
      
      indicators.RSI = {
        value: Number(rsi.toFixed(2)),
        signal
      };
    }
    
    // P2 FIX: Correct MACD calculation
    // Build macdSeries across prices, then calculate signal line from that series
    if (priceData.length >= 26) {
      const prices = priceData.map(p => p.close_price);
      
      // Build MACD series: for each point, compute EMA12 - EMA26 up to that point
      const macdSeries: number[] = [];
      for (let i = 25; i < prices.length; i++) {
        const slice = prices.slice(0, i + 1);
        const ema12 = calculateEMA(slice, 12);
        const ema26 = calculateEMA(slice, 26);
        macdSeries.push(ema12 - ema26);
      }
      
      // Current MACD line
      const macdLine = macdSeries[macdSeries.length - 1] || 0;
      
      // Signal line = EMA(macdSeries, 9)
      const signalLine = macdSeries.length >= 9 ? calculateEMA(macdSeries, 9) : macdLine;
      
      // Histogram
      const histogram = macdLine - signalLine;
      
      indicators.MACD = {
        macd: Number(macdLine.toFixed(4)),
        signal: Number(signalLine.toFixed(4)),
        histogram: Number(histogram.toFixed(4)),
        crossover: histogram > 0 ? 'bullish' : histogram < 0 ? 'bearish' : 'neutral'
      };
    }
    
    if (priceData.length >= 21) {
      const prices = priceData.map(p => p.close_price);
      const ema9 = calculateEMA(prices, 9);
      const ema21 = calculateEMA(prices, 21);
      
      indicators.EMA = {
        short: Number(ema9.toFixed(2)),
        long: Number(ema21.toFixed(2)),
        crossover: false,
        direction: ema9 > ema21 ? 'bullish' : 'bearish'
      };
    }
    
    const { error } = await supabaseClient
      .from('price_data')
      .update({
        metadata: {
          ...latest.metadata,
          indicators: indicators,
          calculated_at: new Date().toISOString()
        }
      })
      .eq('id', latest.id);
    
    if (error) {
      console.error(`❌ Error caching indicators for ${symbol}:`, error);
    } else {
      console.log(`✅ Cached indicators for ${symbol}:`, Object.keys(indicators));
    }
  } catch (error) {
    console.error(`❌ Error calculating indicators for ${symbol}:`, error);
  }
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) return prices[prices.length - 1];
  
  const multiplier = 2 / (period + 1);
  let ema = prices[0];
  
  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
  }
  
  return ema;
}
