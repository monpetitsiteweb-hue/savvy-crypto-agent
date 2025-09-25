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
    console.log('📊 Technical Signal Generator triggered');
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { symbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR'], userId, sourceId } = await req.json().catch(() => ({}));

    // Get or create technical analysis data source
    let { data: dataSource } = await supabaseClient
      .from('ai_data_sources')
      .select('id, user_id')
      .eq('source_name', 'technical_analysis')
      .eq('is_active', true)
      .single();

    if (!dataSource) {
      // If no data source exists, we need a user ID to create one
      if (!userId) {
        throw new Error('No userId provided and no existing technical analysis data source found');
      }
      
      const { data: newSource } = await supabaseClient
        .from('ai_data_sources')
        .insert({
          source_name: 'technical_analysis',
          source_type: 'price_analysis',
          api_endpoint: 'internal',
          is_active: true,
          update_frequency: '5min',
          configuration: { symbols, indicators: ['rsi', 'macd', 'price_change', 'volume_spike'] },
          user_id: userId
        })
        .select()
        .single();
      
      dataSource = newSource;
    }

    // CRITICAL FIX: Always use the provided userId, or the userId from existing dataSource
    const actualUserId = userId || dataSource.user_id;
    
    // If still no userId, get all active users with strategies and generate signals for them
    if (!actualUserId) {
      const { data: activeUsers } = await supabaseClient
        .from('trading_strategies')
        .select('user_id')
        .eq('is_active_test', true)
        .or('is_active.eq.true');
      
      if (activeUsers && activeUsers.length > 0) {
        // Generate signals for each active user
        for (const user of activeUsers) {
          await generateSignalsForUser(user.user_id, symbols, dataSource.id, supabaseClient);
        }
        return new Response(JSON.stringify({
          success: true,
          message: `Generated signals for ${activeUsers.length} active users`,
          users_processed: activeUsers.length
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    const actualSourceId = sourceId || dataSource.id;

    console.log(`🔍 Analyzing technical indicators for symbols: ${symbols.join(', ')}`);

    const signals = [];
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

    for (const symbol of symbols) {
      try {
        // Get recent price data (last 30 minutes for technical analysis)
        const { data: priceData, error: priceError } = await supabaseClient
          .from('price_data')
          .select('*')
          .eq('symbol', symbol)
          .gte('timestamp', thirtyMinutesAgo.toISOString())
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

        // Calculate technical indicators and cache them
        const technicalSignals = await generateTechnicalSignals(symbol, priceData, actualUserId, actualSourceId);
        signals.push(...technicalSignals);

        // Cache calculated indicators in price_data metadata for faster loading
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
        console.log(`✅ Generated ${signals.length} technical signals`);
      }
    } else {
      console.log('ℹ️ No technical signals generated this cycle');
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
      message: `Generated ${signals.length} technical signals`
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

async function generateSignalsForUser(userId: string, symbols: string[], sourceId: string, supabaseClient: any) {
  console.log(`📊 Generating signals for user: ${userId}`);
  
  const signals = [];
  const now = new Date();
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

  for (const symbol of symbols) {
    try {
      // Get recent price data
      const { data: priceData, error: priceError } = await supabaseClient
        .from('price_data')
        .select('*')
        .eq('symbol', symbol)
        .gte('timestamp', thirtyMinutesAgo.toISOString())
        .order('timestamp', { ascending: true });

      if (priceError || !priceData || priceData.length < 2) {
        continue;
      }

      // Generate signals for this user
      const technicalSignals = await generateTechnicalSignals(symbol, priceData, userId, sourceId);
      signals.push(...technicalSignals);

    } catch (error) {
      console.error(`❌ Error generating signals for user ${userId}, symbol ${symbol}:`, error);
    }
  }

  // Insert signals for this user
  if (signals.length > 0) {
    const { error: signalError } = await supabaseClient
      .from('live_signals')
      .insert(signals);

    if (!signalError) {
      console.log(`✅ Generated ${signals.length} signals for user ${userId}`);
    }
  }

  return signals;
}

async function generateTechnicalSignals(symbol: string, priceData: any[], userId: string, sourceId: string) {
  const signals = [];
  const latest = priceData[priceData.length - 1];
  const previous = priceData[priceData.length - 2];
  const earlier = priceData[0];

  console.log(`🔬 Calculating indicators for ${symbol}: Latest=${latest.close_price}, Previous=${previous.close_price}`);

  // 1. Price Change Analysis
  const shortTermChange = ((latest.close_price - previous.close_price) / previous.close_price) * 100;
  const longerTermChange = ((latest.close_price - earlier.close_price) / earlier.close_price) * 100;

  console.log(`📊 ${symbol} - Short-term: ${shortTermChange.toFixed(2)}%, Longer-term: ${longerTermChange.toFixed(2)}%`);

  // Generate price movement signals
  if (Math.abs(shortTermChange) > 1.5) { // 1.5% threshold for significant moves
    const signalType = shortTermChange > 0 ? 'price_breakout_bullish' : 'price_breakout_bearish';
    const strength = Math.min(100, Math.abs(shortTermChange) * 30); // Scale to 0-100

    signals.push({
      source_id: sourceId,
      user_id: userId,
      timestamp: new Date().toISOString(),
      symbol: symbol.split('-')[0], // Remove -EUR suffix
      signal_type: signalType,
      signal_strength: strength,
      source: 'technical_analysis',
      data: {
        price_change_short: shortTermChange,
        price_change_longer: longerTermChange,
        current_price: latest.close_price,
        indicator: 'price_movement',
        threshold_triggered: '1.5%'
      },
      processed: false
    });
  }

  // 2. RSI Calculation (simplified)
  if (priceData.length >= 15) {
    const rsi = calculateRSI(priceData.slice(-15)); // Need period + 1 points
    console.log(`📈 ${symbol} RSI: ${rsi.toFixed(2)}`);

    if (rsi <= 30) {
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: symbol.split('-')[0],
        signal_type: 'rsi_oversold_bullish',
        signal_strength: Math.min(100, (30 - rsi) * 3),
        source: 'technical_analysis',
        data: {
          rsi_value: rsi,
          rsi_level: 'oversold',
          current_price: latest.close_price,
          indicator: 'rsi'
        },
        processed: false
      });
    } else if (rsi >= 70) {
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: symbol.split('-')[0],
        signal_type: 'rsi_overbought_bearish',
        signal_strength: Math.min(100, (rsi - 70) * 3),
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
  }

  // 3. Volume Spike Analysis
  if (priceData.length >= 5) {
    const avgVolume = priceData.slice(-5).reduce((sum, p) => sum + (p.volume || 0), 0) / 5;
    const volumeSpike = (latest.volume || 0) > avgVolume * 1.8; // 80% above average

    if (volumeSpike && avgVolume > 0) {
      const volumeRatio = (latest.volume || 0) / avgVolume;
      console.log(`📊 ${symbol} Volume spike detected: ${volumeRatio.toFixed(2)}x average`);

      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: symbol.split('-')[0],
        signal_type: 'volume_spike',
        signal_strength: Math.min(100, (volumeRatio - 1) * 40),
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

  // 4. Moving Average Analysis (if enough data)
  if (priceData.length >= 10) {
    const shortMA = calculateSMA(priceData.slice(-5), 'close_price');
    const longMA = calculateSMA(priceData.slice(-10), 'close_price');
    const currentPrice = latest.close_price;

    console.log(`📊 ${symbol} - Price: ${currentPrice}, Short MA: ${shortMA.toFixed(2)}, Long MA: ${longMA.toFixed(2)}`);

    // Golden Cross (bullish) or Death Cross (bearish)
    if (shortMA > longMA && currentPrice > shortMA) {
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: symbol.split('-')[0],
        signal_type: 'ma_cross_bullish',
        signal_strength: Math.min(100, ((shortMA - longMA) / longMA) * 500),
        source: 'technical_analysis',
        data: {
          short_ma: shortMA,
          long_ma: longMA,
          current_price: currentPrice,
          cross_type: 'golden_cross',
          indicator: 'moving_average'
        },
        processed: false
      });
    } else if (shortMA < longMA && currentPrice < shortMA) {
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: symbol.split('-')[0],
        signal_type: 'ma_cross_bearish',
        signal_strength: Math.min(100, ((longMA - shortMA) / longMA) * 500),
        source: 'technical_analysis',
        data: {
          short_ma: shortMA,
          long_ma: longMA,
          current_price: currentPrice,
          cross_type: 'death_cross',
          indicator: 'moving_average'
        },
        processed: false
      });
    }
  }

  console.log(`✨ Generated ${signals.length} technical signals for ${symbol}`);
  return signals;
}

function calculateRSI(prices: any[], period = 14): number {
  if (prices.length < period + 1) return 50; // Need at least period + 1 points for differences

  let gains = 0;
  let losses = 0;

  // Calculate initial gains and losses - fix the loop bounds
  for (let i = 1; i <= period && i < prices.length; i++) {
    const current = prices[i]?.close_price;
    const previous = prices[i - 1]?.close_price;
    
    // Ensure both values exist
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

  if (avgLoss === 0) return 100; // All gains
  
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
  if (priceData.length < 14) return; // Need minimum data for indicators
  
  console.log(`💾 Caching indicators for ${symbol}`);
  const latest = priceData[priceData.length - 1];
  
  try {
    // Calculate the same indicators as the frontend hook
    const indicators: any = {};
    
    // RSI
    if (priceData.length >= 15) {
      const rsi = calculateRSI(priceData.slice(-15)); // Need period + 1 points
      let signal = 'neutral';
      if (rsi < 30) signal = 'oversold';
      else if (rsi > 70) signal = 'overbought';
      
      indicators.RSI = {
        value: Number(rsi.toFixed(2)),
        signal
      };
    }
    
    // MACD (simplified)
    if (priceData.length >= 26) {
      const prices = priceData.map(p => p.close_price);
      const ema12 = calculateEMA(prices, 12);
      const ema26 = calculateEMA(prices, 26);
      const macd = ema12 - ema26;
      const signal = calculateEMA([macd], 9); // Simplified signal line
      
      indicators.MACD = {
        macd: Number(macd.toFixed(4)),
        signal: Number(signal.toFixed(4)),
        histogram: Number((macd - signal).toFixed(4)),
        crossover: 'neutral'
      };
    }
    
    // EMA
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
    
    // Update the latest price record with calculated indicators
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