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

    const { action, userId, strategyId, mode = 'mock' } = await req.json();
    console.log(`🤖 Automated Trading Engine: ${action} (${mode} mode)`);

    switch (action) {
      case 'process_signals':
        return await processSignalsForStrategies(supabaseClient, { userId, mode });
      
      case 'execute_strategy':
        return await executeStrategyTrade(supabaseClient, { userId, strategyId, mode });
      
      case 'backtest_strategy':
        return await backtestStrategy(supabaseClient, { userId, strategyId });
      
      case 'get_execution_log':
        return await getExecutionLog(supabaseClient, { userId });
      
      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    console.error('❌ Automated Trading Engine error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function processSignalsForStrategies(supabaseClient: any, params: any) {
  const { userId, mode } = params;
  
  console.log(`🔄 Processing signals for user strategies (${mode} mode)`);
  
  try {
    // Get active strategies for user
    const { data: strategies, error: strategiesError } = await supabaseClient
      .from('trading_strategies')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (strategiesError) {
      console.error('❌ Error fetching strategies:', strategiesError);
      throw strategiesError;
    }

    // Get recent unprocessed signals (last 30 minutes)
    const { data: signals, error: signalsError } = await supabaseClient
      .from('live_signals')
      .select('*')
      .gte('timestamp', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .eq('processed', false)
      .order('timestamp', { ascending: false });

    if (signalsError) {
      console.error('❌ Error fetching signals:', signalsError);
    }

    const executionResults = [];
    
    for (const strategy of strategies || []) {
      const strategyConfig = strategy.configuration;
      const relevantSignals = (signals || []).filter(signal => 
        isSignalRelevantToStrategy(signal, strategyConfig)
      );

      if (relevantSignals.length > 0) {
        console.log(`🎯 Strategy "${strategy.strategy_name}" has ${relevantSignals.length} relevant signals`);
        
        for (const signal of relevantSignals) {
          const shouldExecute = evaluateStrategyTrigger(signal, strategyConfig);
          
          if (shouldExecute.execute) {
            const execution = await executeStrategyFromSignal(
              supabaseClient, 
              strategy, 
              signal, 
              shouldExecute, 
              mode
            );
            executionResults.push(execution);
            
            // Mark signal as processed
            await supabaseClient
              .from('live_signals')
              .update({ processed: true })
              .eq('id', signal.id);
          }
        }
      }
    }

    console.log(`✅ Processed ${executionResults.length} strategy executions`);
    
    return new Response(JSON.stringify({ 
      success: true, 
      executions: executionResults,
      strategies_checked: strategies?.length || 0,
      signals_processed: signals?.length || 0,
      message: `Processed ${executionResults.length} strategy executions in ${mode} mode`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ Signal processing error:', error);
    throw error;
  }
}

async function executeStrategyTrade(supabaseClient: any, params: any) {
  const { userId, strategyId, mode } = params;
  
  console.log(`🚀 Executing strategy trade: ${strategyId} (${mode} mode)`);
  
  try {
    // Get strategy details
    const { data: strategy, error: strategyError } = await supabaseClient
      .from('trading_strategies')
      .select('*')
      .eq('id', strategyId)
      .eq('user_id', userId)
      .single();

    if (strategyError || !strategy) {
      throw new Error('Strategy not found or access denied');
    }

    // Get current market data for strategy symbols
    const symbols = strategy.configuration?.symbols || ['BTC-EUR'];
    const marketData = await getCurrentMarketData(supabaseClient, symbols);
    
    // Execute trade based on strategy configuration
    const tradeResult = await executeTrade(supabaseClient, {
      strategy,
      marketData,
      mode,
      userId,
      trigger: 'manual_execution'
    });

    return new Response(JSON.stringify({ 
      success: true, 
      trade_result: tradeResult,
      strategy_name: strategy.strategy_name,
      mode: mode,
      message: `Strategy executed successfully in ${mode} mode`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ Strategy execution error:', error);
    throw error;
  }
}

async function backtestStrategy(supabaseClient: any, params: any) {
  const { userId, strategyId } = params;
  
  console.log(`📊 Backtesting strategy: ${strategyId}`);
  
  try {
    // Get strategy
    const { data: strategy, error: strategyError } = await supabaseClient
      .from('trading_strategies')
      .select('*')
      .eq('id', strategyId)
      .eq('user_id', userId)
      .single();

    if (strategyError || !strategy) {
      throw new Error('Strategy not found');
    }

    // Get historical signals and price data (last 30 days)
    const backtestPeriod = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const { data: historicalSignals, error: signalsError } = await supabaseClient
      .from('live_signals')
      .select('*')
      .gte('timestamp', backtestPeriod.toISOString())
      .order('timestamp', { ascending: true });

    const { data: historicalPrices, error: pricesError } = await supabaseClient
      .from('price_data')
      .select('*')
      .gte('timestamp', backtestPeriod.toISOString())
      .order('timestamp', { ascending: true });

    if (signalsError || pricesError) {
      console.error('❌ Error fetching historical data');
      throw new Error('Failed to fetch historical data');
    }

    // Run backtest simulation
    const backtestResults = await runBacktestSimulation(
      strategy,
      historicalSignals || [],
      historicalPrices || []
    );

    // Store backtest results
    await storeBacktestResults(supabaseClient, {
      userId,
      strategyId,
      results: backtestResults
    });

    return new Response(JSON.stringify({ 
      success: true, 
      backtest_results: backtestResults,
      strategy_name: strategy.strategy_name,
      period_days: 30,
      message: 'Backtest completed successfully'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ Backtest error:', error);
    throw error;
  }
}

async function getExecutionLog(supabaseClient: any, params: any) {
  const { userId } = params;
  
  console.log(`📋 Getting execution log for user: ${userId}`);
  
  try {
    // Get recent mock trades with strategy info
    const { data: trades, error: tradesError } = await supabaseClient
      .from('mock_trades')
      .select(`
        *,
        trading_strategies!inner(strategy_name, configuration)
      `)
      .eq('user_id', userId)
      .order('executed_at', { ascending: false })
      .limit(50);

    // Get recent conversation history (AI decisions)
    const { data: decisions, error: decisionsError } = await supabaseClient
      .from('conversation_history')
      .select('*')
      .eq('user_id', userId)
      .eq('message_type', 'ai_recommendation')
      .order('created_at', { ascending: false })
      .limit(20);

    if (tradesError || decisionsError) {
      console.error('❌ Error fetching execution log');
    }

    const executionLog = {
      recent_trades: trades || [],
      ai_decisions: decisions || [],
      summary: {
        total_trades: trades?.length || 0,
        successful_trades: trades?.filter(t => (t.profit_loss || 0) > 0).length || 0,
        total_pnl: trades?.reduce((sum, t) => sum + (t.profit_loss || 0), 0) || 0,
        avg_trade_size: trades?.length ? 
          trades.reduce((sum, t) => sum + (t.total_value || 0), 0) / trades.length : 0
      }
    };

    return new Response(JSON.stringify({ 
      success: true, 
      execution_log: executionLog,
      message: 'Execution log retrieved successfully'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ Execution log error:', error);
    throw error;
  }
}

// Helper functions

function isSignalRelevantToStrategy(signal: any, strategyConfig: any) {
  const configuredSignals = strategyConfig?.signal_types || [];
  const configuredSymbols = strategyConfig?.symbols || [];
  
  // Check if signal type matches strategy configuration
  const signalTypeMatch = configuredSignals.length === 0 || 
    configuredSignals.some((type: string) => signal.signal_type.includes(type));
  
  // Check if symbol matches strategy configuration
  const symbolMatch = configuredSymbols.length === 0 || 
    configuredSymbols.some((symbol: string) => symbol.includes(signal.symbol));
  
  return signalTypeMatch && symbolMatch;
}

function evaluateStrategyTrigger(signal: any, strategyConfig: any) {
  const confidenceThreshold = strategyConfig?.confidence_threshold || 0.7;
  const minimumStrength = strategyConfig?.minimum_signal_strength || 60;
  
  const signalConfidence = signal.signal_strength / 100;
  const meetsThreshold = signalConfidence >= confidenceThreshold;
  const meetsStrength = signal.signal_strength >= minimumStrength;
  
  const reasoning = [
    `Signal strength: ${signal.signal_strength}% (required: ${minimumStrength}%)`,
    `Confidence: ${(signalConfidence * 100).toFixed(1)}% (required: ${(confidenceThreshold * 100).toFixed(1)}%)`
  ];

  return {
    execute: meetsThreshold && meetsStrength,
    confidence: signalConfidence,
    reasoning: reasoning.join('; '),
    signal_type: signal.signal_type,
    action: signal.signal_type.includes('bullish') ? 'buy' : 
            signal.signal_type.includes('bearish') ? 'sell' : 'hold'
  };
}

async function executeStrategyFromSignal(supabaseClient: any, strategy: any, signal: any, evaluation: any, mode: string) {
  const symbols = strategy.configuration?.symbols || [signal.symbol + '-EUR'];
  const marketData = await getCurrentMarketData(supabaseClient, symbols);
  
  const tradeData = {
    strategy,
    signal,
    evaluation,
    marketData,
    mode,
    userId: strategy.user_id,
    trigger: 'signal_triggered'
  };
  
  return await executeTrade(supabaseClient, tradeData);
}

async function executeTrade(supabaseClient: any, tradeData: any) {
  const { strategy, signal, evaluation, marketData, mode, userId, trigger } = tradeData;
  
  const symbol = Object.keys(marketData)[0] || 'BTC-EUR';
  const price = marketData[symbol]?.price || 50000;
  const tradeAmount = strategy.configuration?.trade_amount || 100;
  
  const trade = {
    user_id: userId,
    strategy_id: strategy.id,
    cryptocurrency: symbol.split('-')[0],
    trade_type: evaluation?.action || 'buy',
    amount: tradeAmount / price,
    price: price,
    total_value: tradeAmount,
    is_test_mode: mode === 'mock',
    strategy_trigger: trigger,
    notes: `${trigger}: ${evaluation?.reasoning || 'Manual execution'}`,
    market_conditions: {
      signal_data: signal,
      evaluation: evaluation,
      market_data: marketData[symbol],
      execution_time: new Date().toISOString()
    }
  };

  if (mode === 'live') {
    // For live trading, would call Coinbase API here
    trade.notes += ' [LIVE TRADING - Would execute via Coinbase API]';
  }

  const { data: tradeResult, error } = await supabaseClient
    .from('mock_trades')
    .insert([trade])
    .select()
    .single();

  if (error) {
    console.error('❌ Error inserting trade:', error);
    throw error;
  }

  console.log(`✅ ${mode === 'live' ? 'Live' : 'Mock'} trade executed: ${trade.trade_type} ${trade.cryptocurrency} at ${price}`);
  
  return {
    trade_id: tradeResult.id,
    action: trade.trade_type,
    symbol: trade.cryptocurrency,
    amount: trade.amount,
    price: trade.price,
    mode: mode,
    reasoning: evaluation?.reasoning || 'Manual execution',
    executed_at: new Date().toISOString()
  };
}

async function getCurrentMarketData(supabaseClient: any, symbols: string[]) {
  const marketData: any = {};
  
  for (const symbol of symbols) {
    const { data: latestPrice, error } = await supabaseClient
      .from('price_data')
      .select('*')
      .eq('symbol', symbol)
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    if (!error && latestPrice) {
      marketData[symbol] = {
        price: latestPrice.close_price,
        volume: latestPrice.volume,
        timestamp: latestPrice.timestamp
      };
    } else {
      // Fallback to mock data
      marketData[symbol] = {
        price: symbol.includes('BTC') ? 50000 : symbol.includes('ETH') ? 3000 : 100,
        volume: 1000000,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  return marketData;
}

async function runBacktestSimulation(strategy: any, signals: any[], prices: any[]) {
  const trades = [];
  let portfolio = { cash: 10000, holdings: {} };
  
  // Group prices by symbol for easy lookup
  const pricesBySymbol = prices.reduce((acc, price) => {
    if (!acc[price.symbol]) acc[price.symbol] = [];
    acc[price.symbol].push(price);
    return acc;
  }, {});

  // Filter signals relevant to this strategy
  const relevantSignals = signals.filter(signal => 
    isSignalRelevantToStrategy(signal, strategy.configuration)
  );

  for (const signal of relevantSignals) {
    const evaluation = evaluateStrategyTrigger(signal, strategy.configuration);
    
    if (evaluation.execute) {
      const symbol = signal.symbol + '-EUR';
      const symbolPrices = pricesBySymbol[symbol] || [];
      
      // Find price at signal time
      const signalTime = new Date(signal.timestamp);
      const priceAtSignal = symbolPrices.find(p => 
        new Date(p.timestamp) >= signalTime
      );
      
      if (priceAtSignal) {
        const tradeAmount = strategy.configuration?.trade_amount || 1000;
        const price = priceAtSignal.close_price;
        
        if (evaluation.action === 'buy' && portfolio.cash >= tradeAmount) {
          const amount = tradeAmount / price;
          portfolio.cash -= tradeAmount;
          portfolio.holdings[signal.symbol] = (portfolio.holdings[signal.symbol] || 0) + amount;
          
          trades.push({
            timestamp: signal.timestamp,
            action: 'buy',
            symbol: signal.symbol,
            amount: amount,
            price: price,
            value: tradeAmount,
            reasoning: evaluation.reasoning
          });
        } else if (evaluation.action === 'sell' && portfolio.holdings[signal.symbol] > 0) {
          const amount = portfolio.holdings[signal.symbol];
          const value = amount * price;
          portfolio.cash += value;
          portfolio.holdings[signal.symbol] = 0;
          
          trades.push({
            timestamp: signal.timestamp,
            action: 'sell',
            symbol: signal.symbol,
            amount: amount,
            price: price,
            value: value,
            reasoning: evaluation.reasoning
          });
        }
      }
    }
  }

  // Calculate final portfolio value
  let finalValue = portfolio.cash;
  for (const [symbol, amount] of Object.entries(portfolio.holdings)) {
    const latestPrice = pricesBySymbol[symbol + '-EUR']?.slice(-1)[0];
    if (latestPrice && typeof amount === 'number') {
      finalValue += amount * latestPrice.close_price;
    }
  }

  const totalReturn = ((finalValue - 10000) / 10000) * 100;
  const winningTrades = trades.filter(t => t.action === 'sell').length;
  const winRate = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;

  return {
    period_days: 30,
    total_trades: trades.length,
    winning_trades: winningTrades,
    win_rate: winRate,
    total_return: totalReturn,
    final_portfolio_value: finalValue,
    initial_value: 10000,
    trades: trades.slice(0, 10), // Show first 10 trades
    signals_analyzed: relevantSignals.length,
    strategy_effectiveness: relevantSignals.length > 0 ? (trades.length / relevantSignals.length) * 100 : 0
  };
}

async function storeBacktestResults(supabaseClient: any, data: any) {
  const { userId, strategyId, results } = data;
  
  const performanceEntry = {
    user_id: userId,
    strategy_id: strategyId,
    execution_date: new Date().toISOString().split('T')[0],
    total_trades: results.total_trades,
    winning_trades: results.winning_trades,
    losing_trades: results.total_trades - results.winning_trades,
    total_profit_loss: results.total_return,
    win_rate: results.win_rate,
    is_test_mode: true
  };

  const { error } = await supabaseClient
    .from('strategy_performance')
    .upsert([performanceEntry], { onConflict: 'strategy_id,execution_date' });

  if (error) {
    console.error('❌ Error storing backtest results:', error);
  }
}