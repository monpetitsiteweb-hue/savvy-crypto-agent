import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting automated trading engine...');
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get all active strategies
    const { data: activeStrategies, error: strategiesError } = await supabase
      .from('trading_strategies')
      .select(`
        *,
        user_coinbase_connections!inner(*)
      `)
      .eq('is_active', true);

    if (strategiesError) {
      console.error('Error fetching active strategies:', strategiesError);
      throw strategiesError;
    }

    if (!activeStrategies || activeStrategies.length === 0) {
      console.log('No active strategies found');
      return new Response(JSON.stringify({ 
        message: 'No active strategies to process',
        processedStrategies: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Processing ${activeStrategies.length} active strategies`);
    const results = [];

    for (const strategy of activeStrategies) {
      try {
        console.log(`Processing strategy: ${strategy.strategy_name} (${strategy.id})`);
        
        const config = strategy.configuration;
        const isTestMode = strategy.test_mode || config.testMode;
        
        // Skip if no Coinbase connection
        if (!strategy.user_coinbase_connections || strategy.user_coinbase_connections.length === 0) {
          console.log(`No Coinbase connection for strategy ${strategy.id}`);
          continue;
        }

        // Get market data for decision making
        const marketData = await getMarketData('BTC-USD'); // Default to BTC for now
        
        // Analyze strategy and make trading decision
        const tradingDecision = await analyzeStrategyAndMarket(config, marketData);
        
        if (tradingDecision.shouldTrade) {
          console.log(`Trading decision for ${strategy.id}: ${tradingDecision.action} ${tradingDecision.amount} ${tradingDecision.cryptocurrency}`);
          
          // Execute the trade
          const tradeResult = await executeTrade({
            connectionId: strategy.user_coinbase_connections[0].id,
            tradeType: tradingDecision.action,
            cryptocurrency: tradingDecision.cryptocurrency,
            amount: tradingDecision.amount,
            strategyId: strategy.id,
            isTestMode
          });

          results.push({
            strategyId: strategy.id,
            strategyName: strategy.strategy_name,
            action: tradingDecision.action,
            cryptocurrency: tradingDecision.cryptocurrency,
            amount: tradingDecision.amount,
            success: tradeResult.success,
            message: tradeResult.message
          });
        } else {
          console.log(`No trading action needed for strategy ${strategy.id}: ${tradingDecision.reason}`);
          results.push({
            strategyId: strategy.id,
            strategyName: strategy.strategy_name,
            action: 'hold',
            reason: tradingDecision.reason
          });
        }
      } catch (error) {
        console.error(`Error processing strategy ${strategy.id}:`, error);
        results.push({
          strategyId: strategy.id,
          strategyName: strategy.strategy_name,
          action: 'error',
          message: error.message
        });
      }
    }

    return new Response(JSON.stringify({ 
      message: 'Automated trading cycle completed',
      processedStrategies: activeStrategies.length,
      results 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in automated trading engine:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      details: 'Failed to run automated trading engine'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function getMarketData(symbol: string) {
  try {
    // Simulate market data - in production, this would fetch from Coinbase Pro API or similar
    const mockPrice = 45000 + (Math.random() - 0.5) * 2000; // BTC price around $45k
    const mockVolume = Math.random() * 1000000;
    const priceChange24h = (Math.random() - 0.5) * 0.1; // -5% to +5%
    
    return {
      symbol,
      price: mockPrice,
      volume24h: mockVolume,
      priceChange24h,
      timestamp: new Date().toISOString(),
      // Technical indicators (simplified)
      rsi: 30 + Math.random() * 40, // RSI between 30-70
      macd: Math.random() - 0.5,
      ma20: mockPrice * (0.98 + Math.random() * 0.04),
      ma50: mockPrice * (0.95 + Math.random() * 0.08)
    };
  } catch (error) {
    console.error('Error fetching market data:', error);
    throw error;
  }
}

async function analyzeStrategyAndMarket(config: any, marketData: any) {
  try {
    console.log('Analyzing strategy config:', config);
    console.log('Market data:', marketData);

    // Extract strategy parameters
    const stopLossPercentage = config.stopLossPercentage || 3;
    const takeProfit = config.takeProfit || 1.3;
    const riskLevel = config.riskLevel || 'medium';
    const strategyType = config.strategyType || 'trend-following';
    
    // Risk-based position sizing
    const riskMultipliers = { low: 0.5, medium: 1.0, high: 2.0 };
    const baseAmount = 100; // Base amount in USD
    const positionSize = baseAmount * (riskMultipliers[riskLevel] || 1);

    // Simple trading logic based on RSI and price trends
    let shouldTrade = false;
    let action = 'hold';
    let reason = 'No clear signal';

    // Buy signals
    if (marketData.rsi < 30 && marketData.price < marketData.ma20) {
      shouldTrade = true;
      action = 'buy';
      reason = 'Oversold condition (RSI < 30) and price below MA20';
    }
    // Sell signals  
    else if (marketData.rsi > 70 && marketData.price > marketData.ma20) {
      shouldTrade = true;
      action = 'sell';
      reason = 'Overbought condition (RSI > 70) and price above MA20';
    }
    // Trend following
    else if (strategyType === 'trend-following') {
      if (marketData.priceChange24h > 0.02 && marketData.price > marketData.ma50) {
        shouldTrade = true;
        action = 'buy';
        reason = 'Strong uptrend detected (>2% daily gain, price above MA50)';
      } else if (marketData.priceChange24h < -0.02 && marketData.price < marketData.ma50) {
        shouldTrade = true;
        action = 'sell';
        reason = 'Strong downtrend detected (<-2% daily loss, price below MA50)';
      }
    }

    return {
      shouldTrade,
      action,
      reason,
      cryptocurrency: 'BTC',
      amount: shouldTrade ? (positionSize / marketData.price).toFixed(6) : 0
    };
  } catch (error) {
    console.error('Error analyzing strategy:', error);
    return {
      shouldTrade: false,
      action: 'hold',
      reason: `Analysis error: ${error.message}`,
      cryptocurrency: 'BTC',
      amount: 0
    };
  }
}

async function executeTrade(params: {
  connectionId: string;
  tradeType: string;
  cryptocurrency: string;
  amount: string;
  strategyId: string;
  isTestMode: boolean;
}) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    console.log('Executing trade:', params);
    
    // Call the existing coinbase-sandbox-trade function
    const { data, error } = await supabase.functions.invoke('coinbase-sandbox-trade', {
      body: {
        connectionId: params.connectionId,
        tradeType: params.tradeType,
        cryptocurrency: params.cryptocurrency,
        amount: params.amount,
        strategyId: params.strategyId
      }
    });

    if (error) {
      console.error('Trade execution error:', error);
      return { success: false, message: error.message };
    }

    console.log('Trade executed successfully:', data);
    return { success: true, message: 'Trade executed successfully', data };
  } catch (error) {
    console.error('Error executing trade:', error);
    return { success: false, message: error.message };
  }
}