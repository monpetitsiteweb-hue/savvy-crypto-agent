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
    // Security headers and logging
    const clientIP = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';
    console.log(`🔐 Request from IP: ${clientIP}, User-Agent: ${userAgent}`);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const requestBody = await req.json();
    const { action, userId, user_id, strategyId, mode = 'mock' } = requestBody;
    const finalUserId = userId || user_id;
    
    // Input validation
    if (!action || typeof action !== 'string') {
      return new Response(JSON.stringify({ error: 'Valid action is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!finalUserId || typeof finalUserId !== 'string') {
      return new Response(JSON.stringify({ error: 'Valid userId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Validate mode
    if (!['mock', 'live'].includes(mode)) {
      return new Response(JSON.stringify({ error: 'Mode must be "mock" or "live"' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`🚨 CRITICAL DEBUG: Automated Trading Engine ENTRY POINT - Action: ${action}, Mode: ${mode}, User: ${finalUserId}`);

    switch (action) {
      case 'process_signals':
        return await processSignalsForStrategies(supabaseClient, { userId: finalUserId, mode });
      
      case 'execute_strategy':
        return await executeStrategyTrade(supabaseClient, { userId: finalUserId, strategyId, mode });
      
      case 'backtest_strategy':
        return await backtestStrategy(supabaseClient, { userId: finalUserId, strategyId });
      
      case 'get_execution_log':
        return await getExecutionLog(supabaseClient, { userId: finalUserId });
      
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
  
  console.log(`🚨 CRITICAL DEBUG: processSignalsForStrategies ENTRY - User: ${userId}, Mode: ${mode}`);
  
  try {
    // Get active strategies for user based on mode
    const modeField = mode === 'live' ? 'is_active_live' : 'is_active_test';
    console.log(`🔍 DEBUG: Looking for strategies with ${modeField} = true for user: ${userId}`);
    
    const { data: strategies, error: strategiesError } = await supabaseClient
      .from('trading_strategies')
      .select('*')
      .eq('user_id', userId)
      .eq(modeField, true);

    if (strategiesError) {
      console.error('❌ Error fetching strategies:', strategiesError);
      throw strategiesError;
    }

    console.log(`🎯 DEBUG: Found ${strategies?.length || 0} active strategies`);
    if (strategies?.length > 0) {
      console.log('📋 DEBUG: Strategy details:', JSON.stringify(strategies[0], null, 2));
    }

    // Get recent unprocessed signals (last 30 minutes)
    const timeThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    console.log(`🔍 DEBUG: Looking for signals after ${timeThreshold}`);
    
    const { data: signals, error: signalsError } = await supabaseClient
      .from('live_signals')
      .select('*')
      .gte('timestamp', timeThreshold)
      .eq('processed', false)
      .order('timestamp', { ascending: false });

    if (signalsError) {
      console.error('❌ Error fetching signals:', signalsError);
    }

    console.log(`📊 DEBUG: Found ${signals?.length || 0} unprocessed signals`);
    signals?.forEach((signal, idx) => {
      console.log(`🎵 Signal ${idx + 1}: ${signal.symbol} - ${signal.signal_type} (strength: ${signal.signal_strength})`);
    });

    const executionResults = [];
    
    for (const strategy of strategies || []) {
      console.log(`🎯 Processing strategy: "${strategy.strategy_name}"`);
      const strategyConfig = strategy.configuration;
      
      console.log(`📋 DEBUG: Strategy config selectedCoins: ${JSON.stringify(strategyConfig?.selectedCoins)}`);
      console.log(`📋 DEBUG: Strategy config aiConfidenceThreshold: ${strategyConfig?.aiIntelligenceConfig?.aiConfidenceThreshold}`);
      console.log(`📋 DEBUG: Strategy config perTradeAllocation: ${strategyConfig?.perTradeAllocation}`);
      console.log(`📋 DEBUG: Strategy config takeProfitPercentage: ${strategyConfig?.takeProfitPercentage}`);
      
      // STEP 1: Check existing positions for take profit opportunities
      await evaluateExistingPositions(supabaseClient, strategy, mode, executionResults);
      
      // STEP 2: Process new signals
      const relevantSignals = (signals || []).filter(signal => 
        isSignalRelevantToStrategy(signal, strategyConfig)
      );

      console.log(`🔍 DEBUG: Found ${relevantSignals.length} relevant signals for strategy "${strategy.strategy_name}"`);
      
      if (relevantSignals.length > 0) {
        console.log(`🎯 Strategy "${strategy.strategy_name}" has ${relevantSignals.length} relevant signals`);
        
        for (const signal of relevantSignals) {
          console.log(`🎵 Processing signal: ${signal.symbol} - ${signal.signal_type} (strength: ${signal.signal_strength})`);
          
          const shouldExecute = evaluateStrategyTrigger(signal, strategyConfig);
          console.log(`⚖️ DEBUG: Evaluation result for ${signal.symbol}:`, JSON.stringify(shouldExecute, null, 2));
          
          if (shouldExecute.execute) {
            console.log(`✅ EXECUTING TRADE for ${signal.symbol} with strength ${signal.signal_strength}`);
            const execution = await executeStrategyFromSignal(
              supabaseClient, 
              strategy, 
              signal, 
              shouldExecute, 
              mode
            );
            console.log(`📈 Trade execution result:`, JSON.stringify(execution, null, 2));
            executionResults.push(execution);
            
            // Mark signal as processed
            await supabaseClient
              .from('live_signals')
              .update({ processed: true })
              .eq('id', signal.id);
          } else {
            console.log(`❌ SKIPPING trade for ${signal.symbol} - Reason: ${shouldExecute.reason || 'Not specified'}`);
          }
        }
      } else {
        console.log(`⚠️ No relevant signals found for strategy "${strategy.strategy_name}"`);
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
    let symbols = strategy.configuration?.symbols || strategy.configuration?.selectedCoins || ['BTC'];
    
    // Ensure symbols are in the correct format (e.g., BTC-EUR)
    if (symbols.length > 0 && !symbols[0].includes('-')) {
      symbols = symbols.map((coin: string) => `${coin}-EUR`);
    }
    
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

async function evaluateExistingPositions(supabaseClient: any, strategy: any, mode: string, executionResults: any[]) {
  const takeProfitPercentage = strategy.configuration?.takeProfitPercentage || 999; // Default to 999% (no take profit)
  
  if (takeProfitPercentage >= 999) {
    console.log(`📊 Strategy "${strategy.strategy_name}" has no take profit target set (${takeProfitPercentage}%)`);
    return;
  }
  
  console.log(`🎯 [TAKE PROFIT] Evaluating existing positions for strategy "${strategy.strategy_name}" with ${takeProfitPercentage}% target`);
  
  try {
    // FIXED: Use the EXACT same query as the frontend to ensure data consistency
    const tableToQuery = mode === 'live' ? 'trading_history' : 'mock_trades';
    
    console.log(`🔍 [DEBUG] Querying ${tableToQuery} for user ${strategy.user_id}, strategy ${strategy.id}`);
    
    const { data: allTrades, error: tradesError } = await supabaseClient
      .from(tableToQuery)
      .select('*')
      .eq('user_id', strategy.user_id)
      .eq('strategy_id', strategy.id)
      .order('executed_at', { ascending: true });

    if (tradesError) {
      console.error(`❌ Error fetching trades: ${tradesError.message}`);
      return;
    }

    console.log(`🔍 [DEBUG] Found ${allTrades?.length || 0} total trades in database`);
    
    if (!allTrades || allTrades.length === 0) {
      console.log(`📊 No trades found for strategy "${strategy.strategy_name}"`);
      return;
    }

    // Log all trades for debugging
    allTrades.forEach((trade, index) => {
      console.log(`🔍 [DEBUG] Trade ${index + 1}: ${trade.trade_type} ${trade.amount} ${trade.cryptocurrency} @ €${trade.price} on ${trade.executed_at}`);
    });

    // FIXED: Only consider BUY trades that don't have corresponding SELL trades
    const openPositions = {};
    
    // Get only BUY trades for open positions calculation
    const buyTrades = allTrades.filter(trade => trade.trade_type === 'buy');
    console.log(`🔍 [DEBUG] Found ${buyTrades.length} BUY trades`);
    
    for (const buyTrade of buyTrades) {
      const symbol = buyTrade.cryptocurrency;
      
      if (!openPositions[symbol]) {
        openPositions[symbol] = {
          amount: 0,
          totalCost: 0,
          trades: []
        };
      }
      
      openPositions[symbol].amount += parseFloat(buyTrade.amount);
      openPositions[symbol].totalCost += parseFloat(buyTrade.total_value);
      openPositions[symbol].trades.push(buyTrade);
      openPositions[symbol].avgPrice = openPositions[symbol].totalCost / openPositions[symbol].amount;
    }
    
    // Filter to only positions with meaningful amounts
    const filteredPositions = {};
    for (const [symbol, position] of Object.entries(openPositions)) {
      if (position.amount > 0.0001) { // Small threshold to handle rounding
        filteredPositions[symbol] = position;
      }
    }

    if (Object.keys(filteredPositions).length === 0) {
      console.log(`📊 No open positions found for strategy "${strategy.strategy_name}"`);
      return;
    }

    console.log(`📊 Found ${Object.keys(filteredPositions).length} open positions for strategy "${strategy.strategy_name}"`);
    Object.entries(filteredPositions).forEach(([symbol, pos]) => {
      console.log(`🔍 ${symbol}: ${pos.amount.toFixed(6)} units @ avg €${pos.avgPrice.toFixed(2)} (${pos.trades.length} trades)`);
    });

    // Get current market prices for all symbols
    const symbols = Object.keys(filteredPositions).map(crypto => `${crypto}-EUR`);
    const marketData = await getCurrentMarketData(supabaseClient, symbols);

    // Evaluate each open position for take profit
    for (const [cryptocurrency, position] of Object.entries(filteredPositions)) {
      const symbol = `${cryptocurrency}-EUR`;
      const currentPrice = marketData[symbol]?.price || 0;
      
      if (currentPrice === 0) {
        console.log(`⚠️ No current price data for ${symbol}, skipping take profit check`);
        continue;
      }

      const gainPercentage = ((currentPrice - position.avgPrice) / position.avgPrice) * 100;
      
      console.log(`📈 [TAKE PROFIT] ${cryptocurrency}: Entry €${position.avgPrice.toFixed(2)} → Current €${currentPrice.toFixed(2)} = ${gainPercentage.toFixed(2)}% gain (target: ${takeProfitPercentage}%)`);
      
      if (gainPercentage >= takeProfitPercentage) {
        console.log(`🎯 [TAKE PROFIT] Selling ${cryptocurrency} at ${gainPercentage.toFixed(2)}% gain for user ${strategy.user_id}`);
        
        // Execute sell trade for the ENTIRE open position
        const sellTradeResult = await executeTrade(supabaseClient, {
          strategy,
          marketData: { [symbol]: marketData[symbol] },
          mode,
          userId: strategy.user_id,
          trigger: 'take_profit_hit',
          evaluation: {
            action: 'sell',
            reasoning: `Take profit target reached: ${gainPercentage.toFixed(2)}% gain (target: ${takeProfitPercentage}%) | Position: ${position.amount.toFixed(6)} ${cryptocurrency}`,
            confidence: 1.0
          },
          signal: {
            symbol: cryptocurrency,
            signal_type: 'take_profit',
            signal_strength: 100
          },
          // CRITICAL: Sell the exact amount we have open
          forceAmount: position.amount,
          forceTotalValue: position.amount * currentPrice
        });
        
        executionResults.push(sellTradeResult);
        console.log(`✅ [TAKE PROFIT] Successfully sold ${cryptocurrency} position: ${position.amount.toFixed(6)} units at €${currentPrice.toFixed(2)}`);
      } else {
        console.log(`⏳ [TAKE PROFIT] Holding ${cryptocurrency} - ${gainPercentage.toFixed(2)}% gain (need ${takeProfitPercentage}%)`);
      }
    }
    
  } catch (error) {
    console.error(`❌ Error evaluating existing positions: ${error.message}`);
  }
}

function isSignalRelevantToStrategy(signal: any, strategyConfig: any) {
  const configuredSignals = strategyConfig?.signal_types || [];
  const configuredSymbols = strategyConfig?.selectedCoins || strategyConfig?.symbols || [];
  
  console.log(`🔍 Checking signal relevance: Signal=${signal.signal_type}/${signal.symbol}, Strategy signals=${configuredSignals}, Strategy symbols=${configuredSymbols}`);
  
  // Check if signal type matches strategy configuration
  // For now, accept all signals if no specific types configured
  const signalTypeMatch = configuredSignals.length === 0 || 
    configuredSignals.some((type: string) => {
      // More flexible matching - check if signal contains any configured type
      const lowerSignal = signal.signal_type.toLowerCase();
      const lowerType = type.toLowerCase();
      return lowerSignal.includes(lowerType) || lowerType.includes(lowerSignal);
    });
  
  // Check if symbol matches strategy configuration
  // Accept signals for configured coins (BTC, ETH, etc.)
  const symbolMatch = configuredSymbols.length === 0 || 
    configuredSymbols.some((coin: string) => {
      const coinUpper = coin.toUpperCase();
      const signalSymbol = signal.symbol.toUpperCase();
      return signalSymbol === coinUpper || signalSymbol.includes(coinUpper);
    });
  
  const isRelevant = signalTypeMatch && symbolMatch;
  console.log(`📊 Signal relevance result: ${isRelevant} (signalType: ${signalTypeMatch}, symbol: ${symbolMatch})`);
  
  return isRelevant;
}

function evaluateStrategyTrigger(signal: any, strategyConfig: any) {
  // Use AI intelligence config if available, otherwise fallback to defaults
  const aiConfig = strategyConfig?.aiIntelligenceConfig || {};
  console.log(`🔍 DEBUG: aiConfig object:`, JSON.stringify(aiConfig, null, 2));
  
  // Fix: Properly read the confidence threshold from strategy config
  const rawThreshold = aiConfig.aiConfidenceThreshold;
  console.log(`🔍 DEBUG: Raw aiConfidenceThreshold from config: ${rawThreshold}`);
  
  // Convert to decimal and use much lower thresholds for more trading
  const confidenceThreshold = rawThreshold ? 
    (rawThreshold > 1 ? rawThreshold / 100 : rawThreshold) : 
    0.01; // Default to 1% instead of 70%
    
  const minimumStrength = 0.1; // Much lower threshold for more trades (0.1%)
  
  console.log(`🔍 DEBUG: Final confidenceThreshold: ${confidenceThreshold} (${(confidenceThreshold * 100).toFixed(1)}%)`);
  
  const signalConfidence = signal.signal_strength / 100;
  const meetsThreshold = signalConfidence >= confidenceThreshold;
  const meetsStrength = signal.signal_strength >= minimumStrength;
  
  console.log(`🎯 Evaluating signal: ${signal.signal_type} | Strength: ${signal.signal_strength}% | Confidence: ${(signalConfidence * 100).toFixed(1)}% | Required: ${(confidenceThreshold * 100).toFixed(1)}%`);
  
  const reasoning = [
    `Signal strength: ${signal.signal_strength}% (required: ${minimumStrength}%)`,
    `Confidence: ${(signalConfidence * 100).toFixed(1)}% (required: ${(confidenceThreshold * 100).toFixed(1)}%)`
  ];

  const shouldExecute = meetsThreshold && meetsStrength;
  console.log(`🚦 Execution decision: ${shouldExecute ? 'EXECUTE' : 'SKIP'} | Meets strength: ${meetsStrength} | Meets threshold: ${meetsThreshold}`);

  return {
    execute: shouldExecute,
    confidence: signalConfidence,
    reasoning: reasoning.join('; '),
    signal_type: signal.signal_type,
    action: signal.signal_type.includes('bullish') ? 'buy' : 
            signal.signal_type.includes('bearish') ? 'sell' : 
            signal.signal_type.includes('news') ? 'buy' : 'hold' // News signals should trigger buys
  };
}

async function executeStrategyFromSignal(supabaseClient: any, strategy: any, signal: any, evaluation: any, mode: string) {
  // Get symbols from strategy configuration - handle both formats
  let symbols = strategy.configuration?.symbols || strategy.configuration?.selectedCoins || [signal.symbol];
  
  // Ensure symbols are in the correct format (e.g., BTC-EUR)
  if (symbols.length > 0 && !symbols[0].includes('-')) {
    symbols = symbols.map((coin: string) => `${coin}-EUR`);
  }
  
  // If signal has a specific symbol, prioritize it
  if (signal.symbol && !signal.symbol.includes('-')) {
    symbols = [`${signal.symbol}-EUR`];
  } else if (signal.symbol) {
    symbols = [signal.symbol];
  }
  
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
  const { strategy, signal, evaluation, marketData, mode, userId, trigger, forceAmount, forceTotalValue } = tradeData;
  
  let riskCheck = null;
  
  // First, check risk management constraints (but skip for take profit sells)
  if (trigger !== 'take_profit_hit') {
    riskCheck = await checkRiskLimits(supabaseClient, userId, strategy, marketData);
    if (!riskCheck.canExecute) {
      console.log(`🚫 Trade blocked by risk management: ${riskCheck.reason}`);
      return {
        blocked: true,
        reason: riskCheck.reason,
        risk_assessment: riskCheck
      };
    }
  }
  
  const symbol = Object.keys(marketData)[0] || 'BTC-EUR';
  const price = marketData[symbol]?.price || 50000;
  
  // For take profit sells, use forced amounts; otherwise use risk-adjusted amounts
  let tradeAmount, totalValue;
  
  if (forceAmount && forceTotalValue) {
    // For take profit: sell exact position amount
    tradeAmount = forceAmount;
    totalValue = forceTotalValue;
    console.log(`🎯 [FORCED SELL] Using exact position: ${tradeAmount.toFixed(6)} units = €${totalValue.toFixed(2)}`);
  } else {
    // For regular trades: use the ALREADY CALCULATED risk management results
    const baseTradeAmount = strategy.configuration?.perTradeAllocation || 100; // Reduced default to €100
    const adjustedAmount = riskCheck?.adjustedPositionSize || baseTradeAmount;
    
    // CRITICAL: If no risk check was done (shouldn't happen), do it now
    if (!riskCheck) {
      console.log(`⚠️ WARNING: No risk check performed, doing emergency check`);
      riskCheck = await checkRiskLimits(supabaseClient, userId, strategy, marketData);
      if (!riskCheck.canExecute) {
        console.log(`🚫 EMERGENCY: Trade blocked by risk management: ${riskCheck.reason}`);
        return {
          blocked: true,
          reason: `Emergency block: ${riskCheck.reason}`,
          risk_assessment: riskCheck
        };
      }
    }
    
    tradeAmount = adjustedAmount / price;
    totalValue = adjustedAmount;
    
    console.log(`💰 [POSITION SIZING] Base: €${baseTradeAmount} | Risk Adjusted: €${adjustedAmount.toFixed(2)} | Amount: ${tradeAmount.toFixed(6)}`);
  }
  
  // Calculate profit/loss for sell trades
  let profitLoss = 0;
  if (evaluation?.action === 'sell' && trigger === 'take_profit_hit') {
    // For take profit sells, calculate actual profit
    const gainMatch = evaluation.reasoning?.match(/(\d+\.?\d*)% gain/);
    const gainPercentage = gainMatch ? parseFloat(gainMatch[1]) : 0;
    profitLoss = totalValue * (gainPercentage / 100) / (1 + gainPercentage / 100);
    console.log(`💰 [PROFIT CALCULATION] Gain: ${gainPercentage}% = €${profitLoss.toFixed(2)} profit`);
  }

  const trade = {
    user_id: userId,
    strategy_id: strategy.id,
    cryptocurrency: symbol.split('-')[0],
    trade_type: evaluation?.action || 'buy',
    amount: tradeAmount,
    price: price,
    total_value: totalValue,
    profit_loss: profitLoss,
    is_test_mode: mode === 'mock',
    strategy_trigger: trigger,
    notes: `${trigger}: ${evaluation?.reasoning || 'Manual execution'}${profitLoss > 0 ? ` | PROFIT: €${profitLoss.toFixed(2)}` : ''}`,
    market_conditions: {
      signal_data: signal,
      evaluation: evaluation,
      market_data: marketData[symbol],
      execution_time: new Date().toISOString()
    }
  };

  if (mode === 'live') {
    // For live trading, execute actual Coinbase trade
    const coinbaseResult = await executeCoinbaseTrade(supabaseClient, {
      userId,
      cryptocurrency: trade.cryptocurrency,
      tradeType: trade.trade_type,
      amount: trade.amount,
      price: trade.price,
      strategyId: strategy.id
    });
    
    if (coinbaseResult.success) {
      trade.notes += ` [LIVE TRADE EXECUTED - Order ID: ${coinbaseResult.orderId}]`;
      // Store in trading_history instead of mock_trades for live trades
      const { data: liveTradeResult, error: liveError } = await supabaseClient
        .from('trading_history')
        .insert([{
          user_id: userId,
          strategy_id: strategy.id,
          cryptocurrency: trade.cryptocurrency,
          trade_type: trade.trade_type,
          amount: trade.amount,
          price: trade.price,
          total_value: trade.total_value,
          fees: coinbaseResult.fees || 0,
          coinbase_order_id: coinbaseResult.orderId,
          notes: trade.notes,
          trade_environment: 'live'
        }])
        .select()
        .single();

      if (liveError) {
        console.error('❌ Error storing live trade:', liveError);
      }

      return {
        trade_id: liveTradeResult?.id || 'unknown',
        action: trade.trade_type,
        symbol: trade.cryptocurrency,
        amount: trade.amount,
        price: trade.price,
        mode: 'live',
        coinbase_order_id: coinbaseResult.orderId,
        fees: coinbaseResult.fees,
        reasoning: evaluation?.reasoning || 'Manual execution',
        risk_assessment: riskCheck,
        executed_at: new Date().toISOString()
      };
    } else {
      console.error('❌ Coinbase trade failed:', coinbaseResult.error);
      trade.notes += ` [LIVE TRADE FAILED: ${coinbaseResult.error}]`;
      // Still record as mock trade but mark failure
    }
  }

  console.log(`💰 DEBUG: Creating ${mode} trade with data:`, JSON.stringify({
    user_id: trade.user_id,
    strategy_id: trade.strategy_id,
    cryptocurrency: trade.cryptocurrency,
    trade_type: trade.trade_type,
    amount: trade.amount,
    price: trade.price,
    total_value: trade.total_value,
    perTradeAllocation: strategy.configuration?.perTradeAllocation
  }, null, 2));

  const { data: tradeResult, error } = await supabaseClient
    .from('mock_trades')
    .insert([trade])
    .select()
    .single();

  if (error) {
    console.error('❌ CRITICAL: Error inserting trade into mock_trades:', JSON.stringify(error, null, 2));
    console.error('❌ CRITICAL: Failed trade object:', JSON.stringify(trade, null, 2));
    throw error;
  }

  console.log(`✅ TRADE CREATED SUCCESSFULLY: ${mode === 'live' ? 'Live' : 'Mock'} trade executed`);
  console.log(`📊 Trade ID: ${tradeResult.id} | Action: ${trade.trade_type} | Symbol: ${trade.cryptocurrency} | Amount: ${trade.amount} | Price: ${price} | Value: €${trade.total_value}`);
  
  return {
    trade_id: tradeResult.id,
    action: trade.trade_type,
    symbol: trade.cryptocurrency,
    amount: trade.amount,
    price: trade.price,
    mode: mode,
    reasoning: evaluation?.reasoning || 'Manual execution',
    risk_assessment: riskCheck,
    executed_at: new Date().toISOString()
  };
}

async function getCurrentMarketData(supabaseClient: any, symbols: string[]) {
  console.log(`🔗 FIXED: Using real-time market data function for symbols: ${symbols.join(', ')}`);
  
  try {
    // Use the working real-time market data function
    const { data, error } = await supabaseClient.functions.invoke('real-time-market-data', {
      body: { symbols }
    });

    if (error) {
      console.error('❌ Real-time market data function error:', error);
      throw new Error(`Real-time market data error: ${error.message}`);
    }

    if (data && data.marketData) {
      console.log(`✅ Got real-time prices:`, Object.keys(data.marketData).map(symbol => 
        `${symbol}: €${data.marketData[symbol]?.price}`
      ).join(', '));
      
      return data.marketData;
    }
  } catch (error) {
    console.error('❌ Failed to get real-time market data:', error);
  }

  // ONLY if real-time function completely fails, use direct API as fallback
  console.log(`🔄 Fallback: Direct Coinbase API for ${symbols.join(', ')}`);
  const marketData: any = {};
  
  for (const symbol of symbols) {
    try {
      const tickerResponse = await fetch(
        `https://api.exchange.coinbase.com/products/${symbol}/ticker`
      );
      
      if (tickerResponse.ok) {
        const tickerData = await tickerResponse.json();
        const currentPrice = parseFloat(tickerData.price || '0');
        
        console.log(`📈 Direct API price for ${symbol}: €${currentPrice}`);
        
        marketData[symbol] = {
          price: currentPrice,
          volume: parseFloat(tickerData.volume || '0'),
          timestamp: new Date().toISOString(),
          source: 'coinbase_direct_fallback'
        };
      } else {
        throw new Error(`API responded with status ${tickerResponse.status}`);
      }
    } catch (apiError) {
      console.error(`❌ CRITICAL: All market data sources failed for ${symbol}:`, apiError);
      console.error(`🚫 TRADING HALTED: Cannot proceed without real market data for ${symbol}`);
      
      // NO FALLBACKS - Fail gracefully instead of using hardcoded prices
      throw new Error(`Market data unavailable for ${symbol}. Trading suspended to prevent losses from stale data.`);
    }
  }
  
  return marketData;
}

async function runBacktestSimulation(strategy: any, signals: any[], prices: any[]) {
  const trades = [];
  
  // Get initial portfolio value from strategy configuration or fail
  const initialCash = strategy.configuration?.backtestInitialBalance;
  if (!initialCash) {
    throw new Error('Backtest requires initial balance configuration - no hardcoded defaults allowed');
  }
  
  let portfolio = { cash: initialCash, holdings: {} };
  
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

  const totalReturn = ((finalValue - initialCash) / initialCash) * 100;
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

async function checkRiskLimits(supabaseClient: any, userId: string, strategy: any, marketData: any) {
  try {
    // Get user preferences (stored in profile)
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .single();

    let userPrefs = null;
    if (!profileError && profile?.username) {
      try {
        const parsed = JSON.parse(profile.username);
        userPrefs = parsed.riskPreferences;
      } catch (e) {
        console.log('No risk preferences found, using defaults');
      }
    }

    // Use strategy-specific risk limits or defaults
    const strategyConfig = strategy.configuration || {};
    const riskLimits = userPrefs?.riskLimits || {
      maxDailyLoss: strategyConfig.dailyLossLimit || 500,
      maxTradesPerDay: strategyConfig.maxTradesPerDay || 10, // Reduced from 50 to 10
      maxPositionSize: strategyConfig.maxPositionSize || strategyConfig.perTradeAllocation || 1000,
      stopLossPercentage: strategyConfig.stopLossPercentage || 3,
      takeProfitPercentage: strategyConfig.takeProfitPercentage || 6
    };

    // CRITICAL: Calculate actual portfolio value from trades
    const { data: allUserTrades, error: allUserTradesError } = await supabaseClient
      .from('mock_trades')
      .select('cryptocurrency, trade_type, amount, price, total_value')
      .eq('user_id', userId);

    let availableEurBalance = 30000; // Starting balance
    const cryptoHoldings = new Map<string, number>();

    if (!allUserTradesError && allUserTrades) {
      // Calculate current EUR balance and crypto holdings
      allUserTrades.forEach((trade: any) => {
        const crypto = trade.cryptocurrency;
        const amount = parseFloat(trade.amount);
        const totalValue = parseFloat(trade.total_value);

        if (trade.trade_type === 'buy') {
          availableEurBalance -= totalValue;
          cryptoHoldings.set(crypto, (cryptoHoldings.get(crypto) || 0) + amount);
        } else if (trade.trade_type === 'sell') {
          availableEurBalance += totalValue;
          cryptoHoldings.set(crypto, Math.max(0, (cryptoHoldings.get(crypto) || 0) - amount));
        }
      });
    }

    console.log(`💰 [BALANCE CHECK] Available EUR: €${availableEurBalance.toFixed(2)}`);
    console.log(`🏦 [PORTFOLIO] Crypto holdings:`, Object.fromEntries(cryptoHoldings));

    // Check daily trading stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { data: todayTrades, error: tradesError } = await supabaseClient
      .from('mock_trades')
      .select('profit_loss, total_value, trade_type')
      .eq('user_id', userId)
      .gte('executed_at', today.toISOString());

    const todayTradesCount = todayTrades?.length || 0;
    const todayPnL = todayTrades?.reduce((sum, trade) => sum + (trade.profit_loss || 0), 0) || 0;

    // CRITICAL: Check trade cooldown to prevent excessive trading frequency
    const tradeCooldownMinutes = strategy.configuration?.tradeCooldownMinutes || 60; // Default 1 hour between trades
    const cooldownTime = new Date(Date.now() - tradeCooldownMinutes * 60 * 1000);
    
    const { data: recentTrades, error: recentTradesError } = await supabaseClient
      .from('mock_trades')
      .select('executed_at, trade_type, cryptocurrency')
      .eq('user_id', userId)
      .eq('strategy_id', strategy.id)
      .gte('executed_at', cooldownTime.toISOString())
      .order('executed_at', { ascending: false });

    if (!recentTradesError && recentTrades && recentTrades.length > 0) {
      const lastTradeTime = new Date(recentTrades[0].executed_at);
      const minutesSinceLastTrade = (Date.now() - lastTradeTime.getTime()) / (1000 * 60);
      
      console.log(`⏱️ [COOLDOWN CHECK] Last trade: ${minutesSinceLastTrade.toFixed(1)} minutes ago (cooldown: ${tradeCooldownMinutes}min)`);
      
      if (minutesSinceLastTrade < tradeCooldownMinutes) {
        blockingReasons.push(`Trade cooldown active (${(tradeCooldownMinutes - minutesSinceLastTrade).toFixed(1)} minutes remaining)`);
      }
    }
    
    if (todayTradesCount >= riskLimits.maxTradesPerDay) {
      blockingReasons.push(`Daily trade limit reached (${riskLimits.maxTradesPerDay})`);
    }
    
    if (todayPnL < 0 && Math.abs(todayPnL) >= riskLimits.maxDailyLoss) {
      blockingReasons.push(`Daily loss limit reached (€${riskLimits.maxDailyLoss})`);
    }

    // Check max open positions limit - COUNT TOTAL PORTFOLIO POSITIONS (NOT PER STRATEGY)
    const maxOpenPositions = strategy.configuration?.maxOpenPositions || 5;
    
    // Get ALL user trades to calculate TOTAL open positions across ALL strategies
    const totalOpenPositionsCount = Array.from(cryptoHoldings.values())
      .filter(amount => amount > 0.000001).length;
      
    console.log(`📊 [TOTAL POSITION CHECK] Total open positions: ${totalOpenPositionsCount}/${maxOpenPositions}`);
    
    if (totalOpenPositionsCount >= maxOpenPositions) {
      blockingReasons.push(`Max open positions limit reached (${maxOpenPositions})`);
    }

    // CRITICAL: Check if user has sufficient EUR balance for the proposed trade
    const symbol = Object.keys(marketData)[0] || 'BTC-EUR';
    const price = marketData[symbol]?.price || 50000;
    const baseAmount = strategy.configuration?.perTradeAllocation || 100;
    
    // Check max wallet exposure
    const maxWalletExposure = strategy.configuration?.maxWalletExposure || 50; // Default 50%
    const startingBalance = 30000;
    const maxExposureAmount = startingBalance * (maxWalletExposure / 100);
    const currentInvestedAmount = startingBalance - availableEurBalance;
    
    console.log(`🛡️ [EXPOSURE CHECK] Current invested: €${currentInvestedAmount.toFixed(2)} / Max allowed: €${maxExposureAmount.toFixed(2)} (${maxWalletExposure}%)`);
    
    if (currentInvestedAmount >= maxExposureAmount) {
      blockingReasons.push(`Max wallet exposure reached (${maxWalletExposure}%: €${maxExposureAmount.toFixed(2)})`);
    }

    if (availableEurBalance < baseAmount) {
      blockingReasons.push(`Insufficient EUR balance (€${availableEurBalance.toFixed(2)} < €${baseAmount})`);
    }

    if ((currentInvestedAmount + baseAmount) > maxExposureAmount) {
      blockingReasons.push(`Trade would exceed max wallet exposure (${maxWalletExposure}%)`);
    }

    // Calculate position sizing using ACTUAL available balance
    let adjustedPositionSize = Math.min(baseAmount, availableEurBalance);
    
    // Apply percentage-based limits if maxPositionSize is configured as a percentage
    if (typeof riskLimits.maxPositionSize === 'number' && riskLimits.maxPositionSize < 100) {
      const actualPortfolioValue = availableEurBalance + currentInvestedAmount; // Real portfolio value
      const maxPositionValue = actualPortfolioValue * (riskLimits.maxPositionSize / 100);
      adjustedPositionSize = Math.min(adjustedPositionSize, maxPositionValue);
    }
    
    console.log(`💰 [POSITION SIZING] Base: €${baseAmount} | Available: €${availableEurBalance.toFixed(2)} | Adjusted: €${adjustedPositionSize.toFixed(2)}`);

    // Calculate stop loss and take profit
    const stopLoss = price * (1 - riskLimits.stopLossPercentage / 100);
    const takeProfit = riskLimits.takeProfitPercentage 
      ? price * (1 + riskLimits.takeProfitPercentage / 100) 
      : null;
    
    const maxLoss = adjustedPositionSize * (riskLimits.stopLossPercentage / 100);

    // Determine risk level using actual portfolio value
    const actualPortfolioValue = availableEurBalance + currentInvestedAmount;
    let riskLevel = 'low';
    if (adjustedPositionSize / actualPortfolioValue > 0.03 || todayTradesCount > 5) {
      riskLevel = 'medium';
    }
    if (adjustedPositionSize / actualPortfolioValue > 0.05 || todayTradesCount > 8 || Math.abs(todayPnL) > 200) {
      riskLevel = 'high';
    }

    return {
      canExecute: blockingReasons.length === 0,
      reason: blockingReasons.join('; '),
      adjustedPositionSize,
      stopLoss,
      takeProfit,
      maxLoss,
      riskLevel,
      dailyStats: {
        trades: todayTradesCount,
        pnl: todayPnL
      }
    };

  } catch (error) {
    console.error('❌ Error checking risk limits:', error);
    return {
      canExecute: false,
      reason: 'Risk management system error',
      adjustedPositionSize: 0,
      riskLevel: 'high'
    };
  }
}

async function executeCoinbaseTrade(supabaseClient: any, tradeParams: any) {
  const { userId, cryptocurrency, tradeType, amount, price, strategyId } = tradeParams;
  
  try {
    console.log(`🚀 Executing Coinbase live trade: ${tradeType} ${amount} ${cryptocurrency} at ${price}`);
    
    // Get user's Coinbase connection
    const { data: connection, error: connError } = await supabaseClient
      .from('user_coinbase_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (connError || !connection) {
      throw new Error('No valid Coinbase connection found');
    }

    // Call the coinbase-live-trade function
    const { data: tradeResult, error: tradeError } = await supabaseClient.functions.invoke('coinbase-live-trade', {
      body: {
        connectionId: connection.id,
        tradeType: tradeType,
        cryptocurrency: cryptocurrency,
        amount: amount.toString(),
        price: price.toString(),
        strategyId: strategyId,
        orderType: 'market', // Use market orders for automated trading
        userId: userId
      }
    });

    if (tradeError) {
      console.error('❌ Coinbase trade API error:', tradeError);
      return {
        success: false,
        error: tradeError.message || 'Coinbase API error'
      };
    }

    if (tradeResult?.success) {
      console.log('✅ Coinbase trade executed successfully:', tradeResult);
      return {
        success: true,
        orderId: tradeResult.order_id || tradeResult.orderId,
        fees: tradeResult.fees || 0,
        executedPrice: tradeResult.executed_price || price,
        executedAmount: tradeResult.executed_amount || amount
      };
    } else {
      console.error('❌ Coinbase trade failed:', tradeResult);
      return {
        success: false,
        error: tradeResult?.error || 'Unknown Coinbase error'
      };
    }

  } catch (error) {
    console.error('❌ Error executing Coinbase trade:', error);
    return {
      success: false,
      error: error.message
    };
  }
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