import { useEffect, useRef } from 'react';
import { useTestMode } from './useTestMode';
import { useAuth } from './useAuth';
import { useMockWallet } from './useMockWallet';
import { supabase } from '@/integrations/supabase/client';
import { Toast } from '@/ui/ToastService';
import { useRealTimeMarketData } from './useRealTimeMarketData';
import { usePoolExitManager } from './usePoolExitManager';
import { engineLog } from '@/utils/silentLogger';
import { logger } from '@/utils/logger';
import { getAllSymbols } from '@/data/coinbaseCoins';
import { checkMarketAvailability } from '@/utils/marketAvailability';

interface Position {
  cryptocurrency: string;
  total_amount: number;
  total_value: number;
  remaining_amount: number;
  average_price: number;
  oldest_purchase_date: string;
}

interface TradingState {
  dailyTrades: number;
  dailyPnL: number;
  lastTradeTime: string;
  openPositions: Position[];
  dailyResetDate: string;
}

export const useIntelligentTradingEngine = () => {
  const { testMode } = useTestMode();
  const { user, loading } = useAuth();
  const { updateBalance, getBalance } = useMockWallet();
  const { marketData, getCurrentData } = useRealTimeMarketData();
  
  // Initialize pool exit manager
  const { processAllPools } = usePoolExitManager({ 
    isEnabled: true, 
    testMode 
  });
  
  // Silent log for intelligent engine debug
  window.NotificationSink?.log({ 
    message: 'INTELLIGENT_ENGINE: Hook called', 
    data: { testMode, user: !!user, loading }
  });

  useEffect(() => {
    // Silent log for auth state change
    window.NotificationSink?.log({ 
      message: 'INTELLIGENT_ENGINE: Auth state changed', 
      data: { user: !!user, loading, testMode }
    });
    
    if (!loading && user && testMode) {
      // Silent log for auth conditions met
      window.NotificationSink?.log({
        message: 'INTELLIGENT_ENGINE: Auth conditions check - starting engine',
        data: { user: !!user, loading, testMode }
      });
      // Small delay to ensure all hooks are initialized
      const timer = setTimeout(() => {
        checkStrategiesAndExecute();
      }, 1000);
      
      // Cleanup timer on unmount or dependency change
      return () => clearTimeout(timer);
    } else {
      // Silent log for auth waiting
      window.NotificationSink?.log({ 
        message: 'INTELLIGENT_ENGINE: Waiting for auth', 
        data: { loading, user: !!user, testMode }
      });
    }
  }, [user, loading, testMode]);
  
  const marketMonitorRef = useRef<NodeJS.Timeout | null>(null);
  const tradingStateRef = useRef<TradingState>({
    dailyTrades: 0,
    dailyPnL: 0,
    lastTradeTime: '',
    openPositions: [],
    dailyResetDate: new Date().toDateString()
  });

  const checkStrategiesAndExecute = async () => {
    // Silent log for engine state
    window.NotificationSink?.log({
      message: 'ENGINE: checkStrategiesAndExecute called',
      data: { testMode, user: !!user, loading }
    });
    
    if (!user || loading) {
      engineLog('ENGINE: Skipping - user: ' + !!user + ' loading: ' + loading);
      return;
    }
    
    if (!testMode) {
      engineLog('TEST MODE IS OFF! You need to enable Test Mode to use the trading engine!');
      return;
    }

    try {
      engineLog('INTELLIGENT_ENGINE: Starting comprehensive strategy check');
      
      // Fetch active strategies
      const { data: strategies, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active_test', true);

      if (error || !strategies?.length) {
        engineLog('ENGINE: No active strategies found:', error);
        return;
      }

      // Get market data for all coins
      const allCoins = new Set<string>();
      strategies.forEach(strategy => {
        const config = strategy.configuration as any;
        const selectedCoins = config?.selectedCoins || getAllSymbols().slice(0, 3); // Use central list as fallback
        selectedCoins.forEach((coin: string) => allCoins.add(`${coin}-EUR`));
      });
      
      const symbolsToFetch = Array.from(allCoins);
      const currentMarketData = Object.keys(marketData).length > 0 ? marketData : await getCurrentData(symbolsToFetch);
      
      // Process each strategy with comprehensive logic
      for (const strategy of strategies) {
        await processStrategyComprehensively(strategy, currentMarketData);
      }
    } catch (error) {
      console.error('❌ ENGINE: Error in comprehensive strategy check:', error);
    }
  };

  const processStrategyComprehensively = async (strategy: any, marketData: any) => {
    const config = strategy.configuration;
    engineLog('ENGINE: Processing strategy with full config:', config);

    // Reset daily counters if needed
    resetDailyCountersIfNeeded();

    // 1. CHECK DAILY LIMITS FIRST
    if (isDailyLimitReached(config)) {
      engineLog('ENGINE: Daily limits reached, skipping strategy');
      return;
    }

    // 2. MANAGE EXISTING POSITIONS (Stop Loss, Take Profit, Trailing Stops)
    await manageExistingPositions(strategy, marketData);

    // 3. CHECK FOR NEW BUY OPPORTUNITIES
    await checkBuyOpportunities(strategy, marketData);
  };

  const resetDailyCountersIfNeeded = () => {
    const today = new Date().toDateString();
    if (tradingStateRef.current.dailyResetDate !== today) {
      engineLog('ENGINE: Resetting daily counters for new day');
      tradingStateRef.current = {
        ...tradingStateRef.current,
        dailyTrades: 0,
        dailyPnL: 0,
        dailyResetDate: today
      };
    }
  };

  const isDailyLimitReached = (config: any): boolean => {
    const state = tradingStateRef.current;
    
    // Check daily trade limit
    if (config.maxTradesPerDay && state.dailyTrades >= config.maxTradesPerDay) {
      engineLog('ENGINE: Daily trade limit reached: ' + state.dailyTrades + ' >= ' + config.maxTradesPerDay);
      return true;
    }

    // Check daily loss limit
    if (config.dailyLossLimit && state.dailyPnL <= -Math.abs(config.dailyLossLimit)) {
      engineLog('ENGINE: Daily loss limit reached: ' + state.dailyPnL + ' <= ' + (-config.dailyLossLimit));
      return true;
    }

    return false;
  };

  const manageExistingPositions = async (strategy: any, marketData: any) => {
    const config = strategy.configuration as any;
    const positions = await calculateOpenPositions();
    
    engineLog('ENGINE: Managing ' + positions.length + ' open positions');
    if (positions.length > 0) {
      engineLog('DEBUG SELL: Full positions data available');
      engineLog('DEBUG SELL: Market data available for: ' + Object.keys(marketData).join(', '));
    }

    for (const position of positions) {
        // Try to match symbol with market data (handle both "XRP" and "XRP-EUR" formats)
        const symbol = position.cryptocurrency;
        const symbolWithEUR = symbol.includes('-EUR') ? symbol : `${symbol}-EUR`;
        const symbolWithoutEUR = symbol.replace('-EUR', '');
        
        const currentPrice = marketData[symbol]?.price || marketData[symbolWithEUR]?.price || marketData[symbolWithoutEUR]?.price;
        engineLog('DEBUG SELL: Processing position: ' + symbol);
        
        if (!currentPrice) {
          engineLog('DEBUG SELL: NO PRICE DATA for: ' + symbol);
          continue;
        }

      const purchasePrice = position.average_price;
      const pnlPercentage = ((currentPrice - purchasePrice) / purchasePrice) * 100;
      const hoursSincePurchase = (Date.now() - new Date(position.oldest_purchase_date).getTime()) / (1000 * 60 * 60);

      engineLog('ENGINE: Position analysis for ' + position.cryptocurrency + ' P&L: ' + pnlPercentage.toFixed(2) + '%');

      // Execute sell based on sell order type and conditions
      const sellDecision = await getSellDecision(config, position, currentPrice, pnlPercentage, hoursSincePurchase);
      engineLog('DEBUG SELL: Sell decision for ' + position.cryptocurrency + ': ' + (sellDecision ? sellDecision.reason : 'none'));
      
      if (sellDecision) {
        engineLog('DEBUG SELL: EXECUTING SELL ORDER - ' + position.cryptocurrency + ' at ' + currentPrice);
        await executeSellOrder(strategy, position, currentPrice, sellDecision);
      } else {
        engineLog('DEBUG SELL: NO SELL DECISION - position remains open: ' + position.cryptocurrency);
      }
    }
  };

  const getSellDecision = async (config: any, position: Position, currentPrice: number, pnlPercentage: number, hoursSincePurchase: number): Promise<{reason: string, orderType?: string} | null> => {
    engineLog('SELL DECISION DEBUG: Checking sell conditions for ' + position.cryptocurrency + ' price: ' + currentPrice + ' P&L: ' + pnlPercentage + '%');
    
    // 1. AUTO CLOSE AFTER HOURS (overrides everything)
    if (config.autoCloseAfterHours && hoursSincePurchase >= config.autoCloseAfterHours) {
      engineLog('SELL DECISION: AUTO CLOSE TRIGGERED - ' + hoursSincePurchase + ' >= ' + config.autoCloseAfterHours);
      return { reason: 'AUTO_CLOSE_TIME', orderType: 'market' };
    }

    // 2. STOP LOSS CHECK
    if (config.stopLossPercentage && pnlPercentage <= -Math.abs(config.stopLossPercentage)) {
      engineLog('SELL DECISION: STOP LOSS TRIGGERED - ' + pnlPercentage + ' <= ' + (-Math.abs(config.stopLossPercentage)));
      return { 
        reason: 'STOP_LOSS', 
        orderType: config.sellOrderType || 'market' 
      };
    }

    // 3. TAKE PROFIT CHECK
    if (config.takeProfitPercentage && pnlPercentage >= config.takeProfitPercentage) {
      engineLog('SELL DECISION: TAKE PROFIT TRIGGERED - ' + pnlPercentage + ' >= ' + config.takeProfitPercentage);
      return { 
        reason: 'TAKE_PROFIT', 
        orderType: config.sellOrderType || 'market' 
      };
    }

    engineLog('SELL DECISION: NO SELL CONDITIONS MET - keeping position open');

    // 4. TRAILING STOP LOSS
    if (config.trailingStopLossPercentage) {
      const trailingStopTriggered = await checkTrailingStopLoss(config, position, currentPrice, pnlPercentage);
      if (trailingStopTriggered) {
        return { 
          reason: 'TRAILING_STOP', 
          orderType: 'trailing_stop' 
        };
      }
    }

    // 5. TECHNICAL INDICATOR SELL SIGNALS
    if (await checkTechnicalSellSignals(config, position.cryptocurrency, currentPrice)) {
      return { 
        reason: 'TECHNICAL_SIGNAL', 
        orderType: config.sellOrderType || 'market' 
      };
    }

    return null;
  };

  const executeSellOrder = async (strategy: any, position: Position, marketPrice: number, sellDecision: {reason: string, orderType?: string}) => {
    try {
      await executeTrade(strategy, 'sell', position.cryptocurrency, marketPrice, position.remaining_amount, sellDecision.reason);
    } catch (error) {
      logger.error('ENGINE: Error in executeTrade:', error);
    }
  };

  // Unified AI Signal Fusion and Context Gates
  const evaluateSignalFusion = async (strategy: any, symbol: string, side: 'BUY' | 'SELL'): Promise<{
    sTotalScore: number;
    bucketScores: { trend: number; volatility: number; momentum: number; whale: number; sentiment: number };
    decision: 'ENTER' | 'EXIT' | 'HOLD' | 'DEFER';
    reason: string;
    gateBlocks: string[];
    effectiveConfig: any;
    valueSources: Record<string, any>;
  }> => {
    const { computeEffectiveConfig, isAIFusionEnabled, getFusionConfig, getContextGatesConfig } = await import('@/utils/aiConfigHelpers');
    
    const config = strategy.configuration;
    const effectiveConfigWithSources = computeEffectiveConfig(config);
    const fusionConfig = getFusionConfig(config);
    const gatesConfig = getContextGatesConfig(config);
    const isAIEnabled = isAIFusionEnabled(config);
    
    // Default to legacy behavior if AI fusion not enabled
    if (!isAIEnabled) {
      return {
        sTotalScore: 0.5,
        bucketScores: { trend: 0, volatility: 0, momentum: 0, whale: 0, sentiment: 0 },
        decision: 'ENTER',
        reason: 'legacy_evaluation',
        gateBlocks: [],
        effectiveConfig: effectiveConfigWithSources,
        valueSources: effectiveConfigWithSources.value_sources
      };
    }
    
    const weights = fusionConfig.weights;
    const bucketScores = { trend: 0, volatility: 0, momentum: 0, whale: 0, sentiment: 0 };
    const gateBlocks: string[] = [];
    
    try {
      // Context Gates - Check blocking conditions first using effective config
      if (gatesConfig) {
        // Gate 1: Spread check
        const spread = await checkSpreadGate(symbol, effectiveConfigWithSources.spreadThresholdBps);
        if (spread.blocked) {
          gateBlocks.push('blocked_by_spread');
        }
        
        // Gate 2: Liquidity/Depth check
        const liquidity = await checkLiquidityGate(symbol, effectiveConfigWithSources.minDepthRatio);
        if (liquidity.blocked) {
          gateBlocks.push('blocked_by_liquidity');
        }
        
        // Gate 3: Whale conflict check
        const whaleConflict = await checkWhaleConflictGate(symbol, side, effectiveConfigWithSources.whaleConflictWindowMs);
        if (whaleConflict.blocked) {
          gateBlocks.push('blocked_by_whale_conflict');
        }
        
        // If any gate blocks, return immediately
        if (gateBlocks.length > 0) {
          return {
            sTotalScore: 0,
            bucketScores,
            decision: 'DEFER',
            reason: gateBlocks[0], // Use first blocking reason
            gateBlocks,
            effectiveConfig: effectiveConfigWithSources,
            valueSources: effectiveConfigWithSources.value_sources
          };
        }
      }
      
      // Signal Fusion - Calculate bucket scores
      // 1. Trend/Structure bucket (multi-timeframe bias)
      bucketScores.trend = await calculateTrendScore(symbol, side);
      
      // 2. Volatility/Liquidity bucket (ATR, spread context)
      bucketScores.volatility = await calculateVolatilityScore(symbol);
      
      // 3. Momentum/Patterns bucket (technical indicators + candles)
      bucketScores.momentum = await calculateMomentumScore(symbol, side);
      
      // 4. Whale/Flow bucket (directional flow)
      bucketScores.whale = await calculateWhaleScore(symbol, side);
      
      // 5. News/Sentiment bucket (direction + intensity)
      bucketScores.sentiment = await calculateSentimentScore(symbol, side);
      
      // Calculate composite score S_total ∈ [-1, +1]
      const sTotalScore = 
        (bucketScores.trend * weights.trend) +
        (bucketScores.volatility * weights.volatility) +
        (bucketScores.momentum * weights.momentum) +
        (bucketScores.whale * weights.whale) +
        (bucketScores.sentiment * weights.sentiment);
      
      // Apply conflict penalty - reduce score if buckets strongly disagree
      const conflictPenalty = calculateConflictPenalty(bucketScores, fusionConfig.conflictPenalty);
      const adjustedScore = Math.max(-1, Math.min(1, sTotalScore - conflictPenalty));
      
      // Hysteresis: Different thresholds for enter vs exit
      const enterThreshold = fusionConfig.enterThreshold || 0.65;
      const exitThreshold = fusionConfig.exitThreshold || 0.35;
      
      let decision: 'ENTER' | 'EXIT' | 'HOLD' | 'DEFER' = 'HOLD';
      let reason = 'low_signal_confidence';
      
      if (side === 'BUY' && adjustedScore >= enterThreshold) {
        decision = 'ENTER';
        reason = 'fusion_signal_strong';
      } else if (side === 'SELL' && adjustedScore <= -exitThreshold) {
        decision = 'EXIT';
        reason = 'fusion_exit_signal';
      } else if (Math.abs(adjustedScore) < 0.2) {
        decision = 'HOLD';
        reason = 'signal_too_weak';
      } else {
        decision = 'DEFER';
        reason = adjustedScore > 0 ? 'trend_misalignment' : 'bearish_trend_defer';
      }
      
      return {
        sTotalScore: adjustedScore,
        bucketScores,
        decision,
        reason,
        gateBlocks: []
      };
      
    } catch (error) {
      console.error('❌ SIGNAL FUSION: Evaluation error:', error);
      return {
        sTotalScore: 0,
        bucketScores,
        decision: 'DEFER',
        reason: 'fusion_evaluation_error',
        gateBlocks: []
      };
    }
  };
  
  // Context Gates Implementation
  const checkSpreadGate = async (symbol: string, maxSpreadBps: number): Promise<{ blocked: boolean; spreadBps: number }> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      const pairSymbol = `${baseSymbol}-EUR`;
      
      const response = await fetch(`https://api.exchange.coinbase.com/products/${pairSymbol}/ticker`);
      const data = await response.json();
      
      if (response.ok && data.bid && data.ask) {
        const bid = parseFloat(data.bid);
        const ask = parseFloat(data.ask);
        const mid = (bid + ask) / 2;
        const spreadBps = ((ask - bid) / mid) * 10000; // Convert to basis points
        
        return {
          blocked: spreadBps > maxSpreadBps,
          spreadBps
        };
      }
      
      return { blocked: false, spreadBps: 0 }; // Default to not blocked if can't fetch
    } catch (error) {
      console.error('❌ SPREAD GATE: Error checking spread:', error);
      return { blocked: false, spreadBps: 0 };
    }
  };
  
  const checkLiquidityGate = async (symbol: string, minDepthRatio: number): Promise<{ blocked: boolean; depthRatio: number }> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      const pairSymbol = `${baseSymbol}-EUR`;
      
      const response = await fetch(`https://api.exchange.coinbase.com/products/${pairSymbol}/book?level=2`);
      const data = await response.json();
      
      if (response.ok && data.bids && data.asks) {
        // Calculate simple depth metric: ratio of top 5 levels total volume
        const bidDepth = data.bids.slice(0, 5).reduce((sum: number, bid: any) => sum + parseFloat(bid[1]), 0);
        const askDepth = data.asks.slice(0, 5).reduce((sum: number, ask: any) => sum + parseFloat(ask[1]), 0);
        
        const totalDepth = bidDepth + askDepth;
        const averageDepth = totalDepth / 2;
        const depthRatio = averageDepth > 0 ? Math.min(bidDepth, askDepth) / averageDepth : 0;
        
        return {
          blocked: depthRatio < minDepthRatio,
          depthRatio
        };
      }
      
      return { blocked: false, depthRatio: 10 }; // Default to good depth if can't fetch
    } catch (error) {
      console.error('❌ LIQUIDITY GATE: Error checking depth:', error);
      return { blocked: false, depthRatio: 10 };
    }
  };
  
  const checkWhaleConflictGate = async (symbol: string, side: 'BUY' | 'SELL', windowMs: number): Promise<{ blocked: boolean; conflictData: any }> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      const windowStart = new Date(Date.now() - windowMs).toISOString();
      
      // Use existing live_signals table with whale-related signals
      const { data: whaleSignals } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', baseSymbol)
        .in('signal_type', ['whale_movement', 'large_volume'])
        .gte('timestamp', windowStart)
        .order('timestamp', { ascending: false })
        .limit(5);
      
      if (!whaleSignals || whaleSignals.length === 0) {
        return { blocked: false, conflictData: null };
      }
      
      // Mock whale conflict logic for now - block on strong opposing signals
      const recentWhaleActivity = whaleSignals[0];
      const isLargeSignal = Math.abs(recentWhaleActivity.signal_strength || 0) > 0.7;
      
      // Simple mock: block if recent strong signal opposes our direction
      const signalDirection = (recentWhaleActivity.signal_strength || 0) > 0 ? 'BUY' : 'SELL';
      const isConflict = side !== signalDirection && isLargeSignal;
      
      return {
        blocked: isConflict,
        conflictData: recentWhaleActivity
      };
      
    } catch (error) {
      console.error('❌ WHALE CONFLICT GATE: Error checking whale activity:', error);
      return { blocked: false, conflictData: null };
    }
  };
  
  // Signal Bucket Calculations (using existing data sources)
  const calculateTrendScore = async (symbol: string, side: 'BUY' | 'SELL'): Promise<number> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      
      // Use existing live_signals table for trend indicators
      const { data: signals } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', baseSymbol)
        .in('signal_type', ['ma_cross_bullish', 'ma_cross_bearish', 'trend_bullish', 'trend_bearish'])
        .gte('timestamp', new Date(Date.now() - 3600000).toISOString()) // Last hour
        .order('timestamp', { ascending: false })
        .limit(10);
      
      if (!signals || signals.length === 0) return 0;
      
      // Score based on recent trend signals
      let trendScore = 0;
      signals.forEach(signal => {
        const weight = 1 / (signals.indexOf(signal) + 1); // Recent signals weighted higher
        const strength = signal.signal_strength || 0;
        if (signal.signal_type.includes('bullish')) {
          trendScore += side === 'BUY' ? weight * strength : -weight * strength;
        } else if (signal.signal_type.includes('bearish')) {
          trendScore += side === 'SELL' ? weight * strength : -weight * strength;
        }
      });
      
      return Math.max(-1, Math.min(1, trendScore / 3)); // Normalize to [-1, 1]
      
    } catch (error) {
      console.error('❌ TREND SCORE: Error calculating trend score:', error);
      return 0;
    }
  };
  
  const calculateVolatilityScore = async (symbol: string): Promise<number> => {
    try {
      // Mock volatility calculation - use price data variance as proxy
      const baseSymbol = symbol.replace('-EUR', '');
      const currentData = await getCurrentData([baseSymbol]);
      const priceData = currentData[baseSymbol];
      if (!priceData?.price) return 0.5;
      
      // Simple volatility proxy: score based on price level and time
      const volatilityProxy = Math.sin(Date.now() / 100000) * 0.3 + 0.5;
      return Math.max(-1, Math.min(1, volatilityProxy * 2 - 1)); // Convert to [-1, 1]
      
    } catch (error) {
      console.error('❌ VOLATILITY SCORE: Error calculating volatility score:', error);
      return 0;
    }
  };
  
  const calculateMomentumScore = async (symbol: string, side: 'BUY' | 'SELL'): Promise<number> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      
      // Use existing live_signals for momentum indicators
      const { data: momentum } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', baseSymbol)
        .in('signal_type', ['momentum_bullish', 'momentum_bearish', 'rsi_oversold', 'rsi_overbought'])
        .order('timestamp', { ascending: false })
        .limit(5);
      
      if (!momentum || momentum.length === 0) return 0;
      
      let momentumScore = 0;
      momentum.forEach((signal, index) => {
        const weight = 1 / (index + 1);
        const strength = signal.signal_strength || 0;
        
        if (signal.signal_type.includes('bullish') || signal.signal_type === 'rsi_oversold') {
          momentumScore += side === 'BUY' ? weight * strength : -weight * strength;
        } else if (signal.signal_type.includes('bearish') || signal.signal_type === 'rsi_overbought') {
          momentumScore += side === 'SELL' ? weight * strength : -weight * strength;
        }
      });
      
      return Math.max(-1, Math.min(1, momentumScore)); // Normalize to [-1, 1]
      
    } catch (error) {
      console.error('❌ MOMENTUM SCORE: Error calculating momentum score:', error);
      return 0;
    }
  };
  
  const calculateWhaleScore = async (symbol: string, side: 'BUY' | 'SELL'): Promise<number> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      
      // Use existing live_signals for whale-related activity
      const { data: whaleActivity } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', baseSymbol)
        .in('signal_type', ['whale_movement', 'large_volume', 'unusual_activity'])
        .gte('timestamp', new Date(Date.now() - 1800000).toISOString()) // Last 30 min
        .order('timestamp', { ascending: false })
        .limit(5);
      
      if (!whaleActivity || whaleActivity.length === 0) return 0;
      
      let whaleScore = 0;
      whaleActivity.forEach((activity, index) => {
        const weight = 1 / (index + 1);
        const strength = activity.signal_strength || 0;
        
        // Positive strength = bullish activity, negative = bearish
        if (strength > 0 && side === 'BUY') {
          whaleScore += weight * Math.abs(strength);
        } else if (strength < 0 && side === 'SELL') {
          whaleScore += weight * Math.abs(strength);
        } else {
          whaleScore -= weight * Math.abs(strength) * 0.5; // Opposing flow penalty
        }
      });
      
      return Math.max(-1, Math.min(1, whaleScore));
      
    } catch (error) {
      console.error('❌ WHALE SCORE: Error calculating whale score:', error);
      return 0;
    }
  };
  
  const calculateSentimentScore = async (symbol: string, side: 'BUY' | 'SELL'): Promise<number> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      
      // Use existing live_signals for sentiment and news
      const { data: sentimentSignals } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', baseSymbol)
        .in('signal_type', ['sentiment_bullish_strong', 'sentiment_bearish_strong', 'news_volume_spike'])
        .gte('timestamp', new Date(Date.now() - 3600000).toISOString()) // Last hour
        .order('timestamp', { ascending: false })
        .limit(10);
      
      if (!sentimentSignals || sentimentSignals.length === 0) return 0;
      
      let sentimentScore = 0;
      sentimentSignals.forEach((signal, index) => {
        const weight = 1 / (index + 1);
        const strength = signal.signal_strength || 0;
        
        if (signal.signal_type === 'sentiment_bullish_strong') {
          sentimentScore += side === 'BUY' ? weight * Math.abs(strength) : -weight * Math.abs(strength) * 0.7;
        } else if (signal.signal_type === 'sentiment_bearish_strong') {
          sentimentScore += side === 'SELL' ? weight * Math.abs(strength) : -weight * Math.abs(strength) * 0.7;
        } else if (signal.signal_type === 'news_volume_spike') {
          // News volume alone is neutral - combine with recent sentiment
          const hasPositiveSentiment = sentimentSignals.some(s => 
            s.signal_type === 'sentiment_bullish_strong' && 
            Math.abs(new Date(s.timestamp).getTime() - new Date(signal.timestamp).getTime()) < 300000
          );
          const hasNegativeSentiment = sentimentSignals.some(s => 
            s.signal_type === 'sentiment_bearish_strong' && 
            Math.abs(new Date(s.timestamp).getTime() - new Date(signal.timestamp).getTime()) < 300000
          );
          
          if (hasPositiveSentiment) {
            sentimentScore += side === 'BUY' ? weight * 0.5 : -weight * 0.8;
          } else if (hasNegativeSentiment) {
            sentimentScore += side === 'SELL' ? weight * 0.5 : -weight * 0.8;
          }
        }
      });
      
      return Math.max(-1, Math.min(1, sentimentScore / 2));
      
    } catch (error) {
      console.error('❌ SENTIMENT SCORE: Error calculating sentiment score:', error);
      return 0;
    }
  };
  
  const calculateConflictPenalty = (bucketScores: any, conflictPenalty: number): number => {
    const scores = Object.values(bucketScores) as number[];
    const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    
    // Calculate variance - higher variance = more conflict
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / scores.length;
    const conflict = Math.sqrt(variance);
    
    return conflict * conflictPenalty;
  };
  
  // Enhanced Decision Snapshot Logging with Value Sources
  const logDecisionSnapshot = async (
    strategy: any,
    symbol: string,
    side: 'BUY' | 'SELL',
    fusionResult: any,
    finalDecision: string,
    finalReason: string,
    brackets: any,
    additionalData?: any
  ) => {
    try {
      const { isAIFusionEnabled } = await import('@/utils/aiConfigHelpers');
      const config = strategy.configuration;
      const isAIEnabled = isAIFusionEnabled(config);
      
      const snapshot = {
        user_id: user!.id,
        strategy_id: strategy.id,
        symbol: symbol.replace('-EUR', ''),
        intent_side: side,
        decision_action: finalDecision,
        decision_reason: finalReason,
        confidence: fusionResult.sTotalScore || 0.5,
        intent_source: isAIEnabled ? 'ai_fusion_engine' : 'standard_engine',
        metadata: {
          // Core AI fusion fields
          s_total: fusionResult.sTotalScore,
          bucket_scores: fusionResult.bucketScores,
          thresholds: {
            enter: fusionResult.effectiveConfig?.enterThreshold || 0.65,
            exit: fusionResult.effectiveConfig?.exitThreshold || 0.35
          },
          spread_bps: additionalData?.spreadBps || 0,
          depth_ratio: additionalData?.depthRatio || 0,
          atr_entry: additionalData?.atr || 0,
          brackets: brackets,
          gate_blocks: fusionResult.gateBlocks || [],
          fusion_enabled: isAIEnabled,
          
          // NEW: Value sources tracking
          value_sources: fusionResult.valueSources || {},
          effective_config_snapshot: fusionResult.effectiveConfig || {},
          
          // Allocation tracking
          allocation_unit: additionalData?.allocationUnit || config?.allocationUnit || 'euro',
          per_trade_allocation: additionalData?.perTradeAllocation || config?.perTradeAllocation || 50,
          notional: additionalData?.notional || 0,
          
          // Preset info
          preset: config?.riskProfile || 'unknown',
          ts: new Date().toISOString(),
          ...additionalData
        }
      };
      
      await supabase
        .from('trade_decisions_log')
        .insert(snapshot);
      
      console.log('📊 DECISION SNAPSHOT:', JSON.stringify(snapshot, null, 2));
      
    } catch (error) {
      console.error('❌ DECISION SNAPSHOT: Failed to log:', error);
    }
  };
  
  const checkTrailingStopLoss = async (config: any, position: Position, currentPrice: number, pnlPercentage: number): Promise<boolean> => {
    const trailingPercentage = config.trailingStopLossPercentage;
    
    // FIXED: Trailing stop should ONLY activate when position is actually profitable
    // Don't trigger trailing stop unless we're in profit
    if (!trailingPercentage || pnlPercentage <= 0) {
      return false;
    }

    // Only activate trailing stop if we've reached a minimum profit threshold
    const minProfitForTrailing = config.trailingStopMinProfitThreshold || 1.0;
    if (pnlPercentage < minProfitForTrailing) {
      return false;
    }

    // For now, we need to track the actual peak price over time
    // Since we don't have peak tracking yet, let's disable trailing stop completely
    // until we implement proper peak tracking
    
    return false;
  };

  // REAL TECHNICAL INDICATORS FROM DATABASE
  const checkTechnicalSellSignals = async (config: any, symbol: string, currentPrice: number): Promise<boolean> => {
    const techConfig = config.technicalIndicatorConfig;
    if (!techConfig) return false;

    try {
      // Get REAL technical signals from live_signals table (this exists!)
      const { data: liveSignals } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', symbol)
        .eq('signal_type', 'technical')
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 10).toISOString())
        .order('timestamp', { ascending: false })
        .limit(20);

      if (liveSignals?.length) {
        // Check for strong bearish signals from REAL data
        const bearishSignals = liveSignals.filter(s => s.signal_strength < -0.4);
        if (bearishSignals.length >= 2) {
          return true;
        }

        // Check for RSI overbought from signal data
        if (techConfig.rsi?.enabled) {
          const rsiSignals = liveSignals.filter(s => 
            s.data && 
            typeof s.data === 'object' && 
            'RSI' in s.data &&
            (s.data as any).RSI >= techConfig.rsi.sellThreshold
          );
          
          if (rsiSignals.length > 0) {
            return true;
          }
        }
      }

    } catch (error) {
      logger.error('ENGINE: Error fetching REAL technical indicators:', error);
    }

    return false;
  };

  const checkBuyOpportunities = async (strategy: any, marketData: any) => {
    const config = strategy.configuration as any;
    const positions = await calculateOpenPositions();
    
    // Check position limits
    if (config.maxActiveCoins && positions.length >= config.maxActiveCoins) {
      return;
    }

    // Get coins to analyze - SOURCE OF TRUTH: strategy.configuration.selectedCoins
    const coinsToAnalyze = config.selectedCoins || getAllSymbols().slice(0, 3);
    
    for (const coin of coinsToAnalyze) {
      const symbol = `${coin}-EUR`;
      
      // MARKET AVAILABILITY PREFLIGHT CHECK - Prevent API errors
      const availability = checkMarketAvailability(symbol);
      if (!availability.isSupported) {
        // Log skip reason and continue to next symbol
        await logDecisionSnapshot(
          strategy,
          symbol,
          'BUY',
          { sTotalScore: 0, bucketScores: { trend: 0, volatility: 0, momentum: 0, whale: 0, sentiment: 0 }, gateBlocks: [] },
          'DEFER',
          availability.reason || 'market_unavailable',
          {},
          { 
            allocationUnit: config.allocationUnit || 'euro',
            perTradeAllocation: config.perTradeAllocation || 50,
            notional: 0
          }
        );
        continue;
      }
      
      const currentData = marketData[symbol];
      if (!currentData) continue;

      // Skip if already have position in this coin (unless DCA enabled)
      const hasPosition = positions.some(p => p.cryptocurrency === symbol);
      if (hasPosition && !config.enableDCA) {
        continue;
      }

      // Check if we should buy this coin using REAL signals
      const buySignal = await getBuySignal(config, symbol, marketData, hasPosition);
      if (!buySignal) continue;

      // Execute buy
      await executeBuyOrder(strategy, symbol, currentData.price, buySignal.reason);
    }
  };

  const getBuySignal = async (config: any, symbol: string, marketData: any, hasPosition: boolean): Promise<{reason: string} | null> => {
    // 1. WHALE SIGNALS CHECK - REAL DATA
    if (await checkWhaleSignals(symbol)) {
      return { reason: 'WHALE_SIGNAL' };
    }

    // 2. NEWS SENTIMENT SIGNALS - REAL DATA
    if (await checkNewsSentimentSignals(config, symbol)) {
      return { reason: 'NEWS_SENTIMENT_SIGNAL' };
    }

    // 3. SOCIAL SIGNALS CHECK - REAL DATA
    if (await checkSocialSignals(config, symbol)) {
      return { reason: 'SOCIAL_SIGNAL' };
    }

    // 4. TECHNICAL INDICATOR BUY SIGNALS - REAL DATA
    if (await checkTechnicalBuySignals(config, symbol, marketData)) {
      return { reason: 'TECHNICAL_SIGNAL' };
    }

    // 5. AI BUY DECISION (combines all signals) - REAL DATA
    if (config.aiIntelligenceConfig?.enableAIOverride && await checkAIBuySignal(config, symbol, marketData)) {
      return { reason: 'AI_COMPREHENSIVE_SIGNAL' };
    }

    return null;
  };

  // WHALE SIGNALS from whale_signal_events table - REAL IMPLEMENTATION
  const checkWhaleSignals = async (symbol: string): Promise<boolean> => {
    try {
      const cryptoSymbol = symbol.split('-')[0];
      
      // Check for whale signals in the whale_signal_events table (this exists!)
      const { data: whaleSignals } = await supabase
        .from('whale_signal_events')
        .select('*')
        .eq('token_symbol', cryptoSymbol)
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString())
        .order('timestamp', { ascending: false })
        .limit(10);

      // Check whale signals for symbol

      if (whaleSignals?.length) {
        // Check for significant whale activity (large amounts)
        const largeTransactions = whaleSignals.filter(signal => 
          signal.amount > 100000 // Large whale transactions
        );

        if (largeTransactions.length > 0) {
          return true;
        }
      }

      // Also check live_signals for whale-related signals
      const { data: liveWhaleSignals } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', symbol)
        .eq('signal_type', 'whale')
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString())
        .order('timestamp', { ascending: false })
        .limit(5);

      if (liveWhaleSignals?.length) {
        const strongWhaleSignals = liveWhaleSignals.filter(s => s.signal_strength > 0.6);
        if (strongWhaleSignals.length > 0) {
          return true;
        }
      }

    } catch (error) {
      console.error('❌ ENGINE: Error checking REAL whale signals:', error);
    }
    return false;
  };

  // NEWS SENTIMENT from existing data sources - REAL IMPLEMENTATION
  const checkNewsSentimentSignals = async (config: any, symbol: string): Promise<boolean> => {
    try {
      const newsWeight = config.aiIntelligenceConfig?.newsImpactWeight || 30;
      if (newsWeight === 0) return false;

      const cryptoSymbol = symbol.split('-')[0];
      
      // Check live_signals for news/sentiment signals (this exists!)
      const { data: newsSignals } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', symbol)
        .in('signal_type', ['news', 'sentiment'])
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString())
        .order('timestamp', { ascending: false })
        .limit(20);

      

      if (newsSignals?.length) {
        // Calculate average sentiment from REAL signals
        const sentimentScores = newsSignals.map(signal => signal.signal_strength);
        const avgSentiment = sentimentScores.reduce((sum, score) => sum + score, 0) / sentimentScores.length;
        
        // Count positive signals
        const positiveSignals = newsSignals.filter(signal => signal.signal_strength > 0.3);
        const sentimentThreshold = 0.3 + (newsWeight / 200);
        
        

        if (avgSentiment > sentimentThreshold && positiveSignals.length >= 2) {
          
          return true;
        }
      }

      // Also check external_market_data for news-related data
      const { data: externalNews } = await supabase
        .from('external_market_data')
        .select('*')
        .eq('cryptocurrency', cryptoSymbol)
        .in('data_type', ['news_sentiment', 'sentiment_analysis'])
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString())
        .order('timestamp', { ascending: false })
        .limit(10);

      if (externalNews?.length) {
        const avgExternalSentiment = externalNews.reduce((sum, data) => sum + (data.data_value || 0), 0) / externalNews.length;
        if (avgExternalSentiment > 0.6) {
          
          return true;
        }
      }

    } catch (error) {
      console.error('❌ ENGINE: Error checking REAL news sentiment:', error);
    }
    return false;
  };

  // SOCIAL SIGNALS from external_market_data table - REAL IMPLEMENTATION
  const checkSocialSignals = async (config: any, symbol: string): Promise<boolean> => {
    try {
      const socialWeight = config.aiIntelligenceConfig?.socialSignalsWeight || 15;
      if (socialWeight === 0) return false;

      const { data: socialData } = await supabase
        .from('external_market_data')
        .select('data_value, data_type, metadata')
        .eq('cryptocurrency', symbol.split('-')[0])
        .in('data_type', ['social_volume', 'social_sentiment', 'reddit_mentions'])
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString())
        .order('timestamp', { ascending: false })
        .limit(20);

      console.log('📱 ENGINE: Checking REAL social signals for', symbol, '- found:', socialData?.length || 0);

      if (socialData?.length) {
        const socialScores = socialData.map(data => data.data_value || 0);
        const avgSocialScore = socialScores.reduce((sum, score) => sum + score, 0) / socialScores.length;
        
        if (avgSocialScore > 0.7) {
          console.log('📱 ENGINE: REAL strong social signal for', symbol, '- score:', avgSocialScore);
          return true;
        }
      }
    } catch (error) {
      console.error('❌ ENGINE: Error checking REAL social signals:', error);
    }
    return false;
  };

  // TECHNICAL INDICATORS - REAL IMPLEMENTATION
  const checkTechnicalBuySignals = async (config: any, symbol: string, marketData: any): Promise<boolean> => {
    const techConfig = config.technicalIndicatorConfig;
    if (!techConfig) return false;

    let signals = 0;
    let totalIndicators = 0;

    try {
      // Get REAL technical signals from live_signals table (this exists!)
      const { data: liveSignals } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', symbol)
        .eq('signal_type', 'technical')
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 10).toISOString())
        .order('timestamp', { ascending: false })
        .limit(20);

      console.log('🔍 ENGINE: Analyzing REAL technical signals for', symbol);
      console.log('📊 ENGINE: Live technical signals count:', liveSignals?.length || 0);

      if (liveSignals?.length) {
        // Check for multiple bullish signals from REAL data
        const bullishSignals = liveSignals.filter(s => s.signal_strength > 0.3);
        if (bullishSignals.length >= 2) {
          console.log('📊 ENGINE: Multiple REAL bullish technical signals:', bullishSignals.length);
          signals++;
          totalIndicators++;
        }

        // Check for very strong individual signals
        const strongBullishSignals = liveSignals.filter(s => s.signal_strength > 0.6);
        if (strongBullishSignals.length >= 1) {
          console.log('📊 ENGINE: Strong REAL bullish signal detected:', strongBullishSignals[0].signal_strength);
          signals++;
          totalIndicators++;
        }

        // RSI Oversold Check from signal data
        if (techConfig.rsi?.enabled) {
          totalIndicators++;
          const rsiSignals = liveSignals.filter(s => 
            s.data && 
            typeof s.data === 'object' && 
            'RSI' in s.data &&
            (s.data as any).RSI <= techConfig.rsi.buyThreshold
          );
          
          if (rsiSignals.length > 0) {
            console.log('📊 ENGINE: REAL RSI buy signal from live data');
            signals++;
          }
        }

        // MACD Bullish signals
        if (techConfig.macd?.enabled) {
          totalIndicators++;
          const macdSignals = liveSignals.filter(s => 
            s.data && 
            typeof s.data === 'object' && 
            ('MACD' in s.data || 'macd' in s.data) &&
            s.signal_strength > 0.4
          );
          
          if (macdSignals.length > 0) {
            console.log('📊 ENGINE: REAL MACD bullish buy signal from live data');
            signals++;
          }
        }
      }

      // Also check overall market momentum from technical signals
      const recentSignals = liveSignals?.filter(s => 
        new Date(s.timestamp).getTime() > (Date.now() - 1000 * 60 * 5)
      ) || [];

      if (recentSignals.length >= 3) {
        const avgRecentStrength = recentSignals.reduce((sum, s) => sum + s.signal_strength, 0) / recentSignals.length;
        if (avgRecentStrength > 0.4) {
          console.log('📊 ENGINE: REAL technical momentum detected - avg strength:', avgRecentStrength);
          signals++;
          totalIndicators++;
        }
      }

      const signalStrength = totalIndicators > 0 ? (signals / totalIndicators) : 0;
      const threshold = 0.5; // Lowered threshold for better signal detection

      console.log('📊 ENGINE: REAL technical signal strength:', signalStrength, 'threshold:', threshold);
      return signalStrength >= threshold;

    } catch (error) {
      console.error('❌ ENGINE: Error fetching REAL technical indicators:', error);
      return false;
    }
  };

  // AI COMPREHENSIVE SIGNAL - REAL IMPLEMENTATION
  const checkAIBuySignal = async (config: any, symbol: string, marketData: any): Promise<boolean> => {
    try {
      const aiConfig = config.aiIntelligenceConfig;
      if (!aiConfig?.enableAIOverride) return false;

      let signalStrength = 0;
      let maxSignalStrength = 0;

      // Weight different signals based on AI config
      const weights = {
        technical: 0.4,
        news: (aiConfig.newsImpactWeight || 30) / 100,
        social: (aiConfig.socialSignalsWeight || 15) / 100,
        whale: (aiConfig.whaleActivityWeight || 25) / 100
      };

      // Technical indicators
      if (await checkTechnicalBuySignals(config, symbol, marketData)) {
        signalStrength += weights.technical;
      }
      maxSignalStrength += weights.technical;

      // News sentiment
      if (await checkNewsSentimentSignals(config, symbol)) {
        signalStrength += weights.news;
      }
      maxSignalStrength += weights.news;

      // Social signals
      if (await checkSocialSignals(config, symbol)) {
        signalStrength += weights.social;
      }
      maxSignalStrength += weights.social;

      // Whale activity
      if (await checkWhaleSignals(symbol)) {
        signalStrength += weights.whale;
      }
      maxSignalStrength += weights.whale;

      const aiConfidence = maxSignalStrength > 0 ? (signalStrength / maxSignalStrength) * 100 : 0;
      const confidenceThreshold = aiConfig.aiConfidenceThreshold || 60;

      if (aiConfidence >= confidenceThreshold) {
        console.log('🤖 ENGINE: REAL AI comprehensive buy signal for', symbol, '- confidence:', aiConfidence + '%');
        return true;
      }

      console.log('🤖 ENGINE: AI signal below threshold for', symbol, '- confidence:', aiConfidence + '%');
    } catch (error) {
      console.error('❌ ENGINE: Error in REAL AI buy signal analysis:', error);
    }
    return false;
  };

  const executeBuyOrder = async (strategy: any, symbol: string, marketPrice: number, reason: string) => {
    console.log('💰 ENGINE: Executing buy order for', symbol, 'reason:', reason);
    await executeTrade(strategy, 'buy', symbol, marketPrice, undefined, reason);
  };

  // Position Management
  const calculateOpenPositions = async (): Promise<Position[]> => {
    if (!user?.id) return [];

    engineLog('POSITIONS: Starting position calculation for user: ' + user.id);

    const { data: buyTrades } = await supabase
      .from('mock_trades')
      .select('*')
      .eq('user_id', user.id)
      .eq('trade_type', 'buy')
      .eq('is_test_mode', true)
      .order('executed_at', { ascending: true });

    const { data: sellTrades } = await supabase
      .from('mock_trades')
      .select('*')
      .eq('user_id', user.id)
      .eq('trade_type', 'sell')
      .eq('is_test_mode', true);

    engineLog('POSITIONS: Buy trades found: ' + (buyTrades?.length || 0));
    engineLog('POSITIONS: Sell trades found: ' + (sellTrades?.length || 0));
    
    if (buyTrades?.length) {
      console.log('🧮 POSITIONS: Sample buy trades:', buyTrades.slice(0, 3).map(t => ({
        symbol: t.cryptocurrency,
        amount: t.amount,
        executed_at: t.executed_at
      })));
    }
    
    if (sellTrades?.length) {
      console.log('🧮 POSITIONS: Sample sell trades:', sellTrades.slice(0, 3).map(t => ({
        symbol: t.cryptocurrency,
        amount: t.amount,
        executed_at: t.executed_at
      })));
    }

    if (!buyTrades) return [];

    const positions: Record<string, Position> = {};

    // Add buy trades with normalized symbols
    buyTrades.forEach(trade => {
      // Normalize symbol - remove -EUR suffix if present
      const symbol = trade.cryptocurrency.replace('-EUR', '');
      if (!positions[symbol]) {
        positions[symbol] = {
          cryptocurrency: symbol,
          total_amount: 0,
          total_value: 0,
          remaining_amount: 0,
          average_price: 0,
          oldest_purchase_date: trade.executed_at
        };
      }
      positions[symbol].total_amount += trade.amount;
      positions[symbol].total_value += trade.total_value;
      positions[symbol].remaining_amount += trade.amount;
      
      if (trade.executed_at < positions[symbol].oldest_purchase_date) {
        positions[symbol].oldest_purchase_date = trade.executed_at;
      }
    });

    console.log('🧮 POSITIONS: Positions after buy trades:', Object.keys(positions).length);

    // Subtract sell trades with normalized symbols
    if (sellTrades) {
      sellTrades.forEach(trade => {
        // Normalize symbol - remove -EUR suffix if present
        const symbol = trade.cryptocurrency.replace('-EUR', '');
        console.log('🧮 POSITIONS: Processing sell trade for', symbol, 'amount:', trade.amount);
        if (positions[symbol]) {
          const beforeAmount = positions[symbol].remaining_amount;
          positions[symbol].remaining_amount -= trade.amount;
          console.log('🧮 POSITIONS: Updated', symbol, 'from', beforeAmount, 'to', positions[symbol].remaining_amount);
          
          // Remove position if completely sold
          if (positions[symbol].remaining_amount <= 0.000001) {
            console.log('🧮 POSITIONS: Removing position', symbol, 'due to zero balance');
            delete positions[symbol];
          }
        } else {
          console.log('🧮 POSITIONS: Warning - sell trade for', symbol, 'but no position found!');
        }
      });
    }

    // Filter and calculate averages
    const finalPositions = Object.values(positions).filter(pos => {
      if (pos.remaining_amount > 0.00000001) {
        pos.average_price = pos.total_value / pos.total_amount;
        return true;
      }
      return false;
    });

    console.log('🧮 POSITIONS: Final open positions:', finalPositions.length);
    return finalPositions;
  };

  const executeTrade = async (
    strategy: any, 
    action: 'buy' | 'sell', 
    cryptocurrency: string, 
    price: number, 
    customAmount?: number,
    trigger?: string
  ) => {
    console.log('🔧 ENGINE: executeTrade called with action:', action, 'symbol:', cryptocurrency);
    
    const { isAIFusionEnabled } = await import('@/utils/aiConfigHelpers');
    const config = strategy.configuration;
    const isAIEnabled = isAIFusionEnabled(config);
    
    // NEW: AI signal fusion evaluation
    if (isAIEnabled) {
      console.log('🧠 AI-FUSION: Evaluating signal fusion for', action, cryptocurrency);
      
      const fusionResult = await evaluateSignalFusion(strategy, cryptocurrency, action.toUpperCase() as 'BUY' | 'SELL');
      
      // Enhanced brackets for ScalpSmart
      const brackets = calculateScalpSmartBrackets(config, price);
      
      // Log decision snapshot (all attempts, even deferred)
      await logDecisionSnapshot(
        strategy, 
        cryptocurrency, 
        action.toUpperCase() as 'BUY' | 'SELL',
        fusionResult,
        fusionResult.decision,
        fusionResult.reason,
        brackets,
        { price, trigger, atr: 0 } // TODO: Add real ATR
      );
      
      // Check fusion decision
      if (fusionResult.decision === 'DEFER') {
        console.log('🚫 SCALPSMART: Trade deferred -', fusionResult.reason);
        Toast.info(`${cryptocurrency} ${action} deferred: ${fusionResult.reason}`);
        return;
      }
      
      if (fusionResult.decision === 'HOLD') {
        console.log('⏸️ SCALPSMART: Signal too weak -', fusionResult.reason);
        return;
      }
      
      // Proceed with fusion-approved trade
      console.log('✅ SCALPSMART: Signal fusion approved -', fusionResult.reason, 'Score:', fusionResult.sTotalScore);
    }
    
    // Use coordinator if unified decisions enabled, otherwise direct execution
    const shouldUseCoordinator = strategy?.unified_config?.enableUnifiedDecisions;
    
    if (!user?.id) {
      console.error('❌ ENGINE: Cannot execute trade - no authenticated user');
      return;
    }

    // Check if strategy has unified decisions enabled
    const unifiedConfig = strategy?.configuration?.unifiedConfig || { enableUnifiedDecisions: false };
    
    if (unifiedConfig.enableUnifiedDecisions) {
      // NEW: Emit intent to coordinator
      console.log('🎯 INTELLIGENT: Using unified decision system');
      return await emitTradeIntentToCoordinator(strategy, action, cryptocurrency, price, customAmount, trigger);
    } else {
      // Legacy direct execution (backward compatibility)
      console.log('🔄 INTELLIGENT: Unified decisions disabled, executing trade directly');
      return await executeTradeDirectly(strategy, action, cryptocurrency, price, customAmount, trigger);
    }
  };

  // NEW: Emit trade intent to coordinator
  const emitTradeIntentToCoordinator = async (
    strategy: any, 
    action: 'buy' | 'sell', 
    cryptocurrency: string, 
    price: number, 
    customAmount?: number,
    trigger?: string
  ) => {
    try {
      const intent = {
        userId: user!.id,
        strategyId: strategy.id,
        symbol: cryptocurrency.includes('-EUR') ? cryptocurrency : `${cryptocurrency}-EUR`,
        side: action.toUpperCase() as 'BUY' | 'SELL',
        source: trigger?.includes('whale') ? 'whale' : 
               trigger?.includes('news') ? 'news' : 
               trigger?.includes('ai') ? 'intelligent' : 'intelligent',
        confidence: 0.75, // Default confidence for intelligent engine
        reason: trigger || `Intelligent engine ${action}`,
        qtySuggested: customAmount || Math.max(10, (strategy.configuration?.perTradeAllocation || 50)) / price,
        metadata: {
          engine: 'intelligent',
          price: price,
          symbol_normalized: cryptocurrency.replace('-EUR', ''),
          trigger: trigger
        },
        ts: new Date().toISOString()
      };

      console.log('🎯 INTELLIGENT: Emitting intent to coordinator:', JSON.stringify(intent, null, 2));

      const { data: decision, error } = await supabase.functions.invoke('trading-decision-coordinator', {
        body: { intent }
      });

      // Handle Supabase client errors (network, auth, etc.)
      if (error) {
        console.error('❌ INTELLIGENT: Coordinator call failed:', error);
        Toast.error(`Network error processing ${action} for ${cryptocurrency}: ${error.message}`);
        return;
      }

      // Handle coordinator responses
      if (!decision) {
        console.error('❌ INTELLIGENT: No decision returned from coordinator');
        Toast.error(`No response from trading coordinator for ${action} on ${cryptocurrency}`);
        return;
      }

      console.log('📋 INTELLIGENT: Coordinator decision:', JSON.stringify(decision, null, 2));

      // STEP 1: Use standardized coordinator toast handler
      // Toast handling removed - silent mode

    } catch (error) {
      console.error('❌ INTELLIGENT: Error executing trade intent:', error);
      Toast.error(`Error processing ${action} for ${cryptocurrency}`);
    }
  };

  // Legacy direct execution function (backward compatibility) 
  const executeTradeDirectly = async (
    strategy: any, 
    action: 'buy' | 'sell', 
    cryptocurrency: string, 
    price: number, 
    customAmount?: number,
    trigger?: string
  ) => {
    // CRITICAL FIX: Apply regression guards before trade execution
    const { validateTradePrice, validatePurchaseValue, logValidationFailure } = await import('../utils/regressionGuards');
    
    // GUARD 1: Price corruption prevention
    const priceValidation = validateTradePrice(price, cryptocurrency);
    if (!priceValidation.isValid) {
      logValidationFailure('price_corruption_guard', priceValidation.errors, { price, cryptocurrency, trigger });
      Toast.error(`Suspicious price detected: €${price}. Trade prevented by security guard.`);
      return;
    }

    // CRITICAL FIX: Normalize symbol format - remove -EUR suffix for database storage
    const normalizedSymbol = cryptocurrency.replace('-EUR', '');
    console.log('🔧 ENGINE: Symbol normalization:', cryptocurrency, '->', normalizedSymbol);

    const config = strategy.configuration;
    let tradeAmount: number;
    
    if (action === 'sell' && customAmount !== undefined) {
      tradeAmount = customAmount;
    } else {
      // CRITICAL FIX: Use deterministic price and remove €100 default
      let deterministicPrice = price;
      
      // Fetch price snapshot for deterministic pricing
      try {
        const { data: snapshot } = await supabase
          .from('price_snapshots')
          .select('price')
          .eq('symbol', normalizedSymbol)
          .order('ts', { ascending: false })
          .limit(1);
        
        if (snapshot?.[0]?.price) {
          deterministicPrice = snapshot[0].price;
          console.log('🎯 ENGINE: Using snapshot price:', deterministicPrice, 'for', normalizedSymbol);
        }
      } catch (error) {
        console.warn('⚠️ ENGINE: Could not fetch price snapshot, using market price:', price);
      }

      // Calculate buy amount with safe defaults (no more hardcoded values)
      const defaultAllocation = 50; // Reduced from hardcoded €100 to €50 minimum
      if (config.allocationUnit === 'percentage') {
        const totalBalance = getBalance('EUR');
        const allocationAmount = Math.max(defaultAllocation, totalBalance * (config.perTradeAllocation || 5) / 100);
        tradeAmount = allocationAmount / deterministicPrice;
      } else {
        const allocationAmount = config.perTradeAllocation || defaultAllocation;
        tradeAmount = allocationAmount / deterministicPrice;
      }

      // GUARD 2: Purchase value consistency validation
      const totalValue = tradeAmount * deterministicPrice;
      const purchaseValidation = validatePurchaseValue(tradeAmount, deterministicPrice, totalValue);
      if (!purchaseValidation.isValid) {
        logValidationFailure('purchase_value_guard', purchaseValidation.errors, { tradeAmount, price: deterministicPrice, totalValue });
        console.error('❌ ENGINE: Purchase value validation failed, aborting trade');
        return;
      }

      price = deterministicPrice; // Use validated price for trade execution
    }

    // Execute the trade
    if (action === 'buy') {
      const eurBalance = getBalance('EUR');
      const tradeValue = tradeAmount * price;
      
      if (eurBalance >= tradeValue) {
        updateBalance('EUR', -tradeValue);
        updateBalance(normalizedSymbol, tradeAmount);
        
        await recordTrade({
          strategy_id: strategy.id,
          user_id: user.id,
          trade_type: 'buy',
          cryptocurrency: normalizedSymbol,
          amount: tradeAmount,
          price,
          total_value: tradeValue,
          strategy_trigger: trigger || 'REAL_SIGNALS'
        });

        tradingStateRef.current.dailyTrades++;
        tradingStateRef.current.lastTradeTime = new Date().toISOString();

        // Silent success - no toast
      }
    } else if (action === 'sell') {
      const cryptoBalance = getBalance(normalizedSymbol);
      
      if (cryptoBalance >= tradeAmount) {
        const tradeValue = tradeAmount * price;
        updateBalance(normalizedSymbol, -tradeAmount);
        updateBalance('EUR', tradeValue);
        
        await recordTrade({
          strategy_id: strategy.id,
          user_id: user.id,
          trade_type: 'sell',
          cryptocurrency: normalizedSymbol,
          amount: tradeAmount,
          price,
          total_value: tradeValue,
          strategy_trigger: trigger || 'REAL_SIGNALS'
        });

        tradingStateRef.current.dailyTrades++;
        tradingStateRef.current.lastTradeTime = new Date().toISOString();

        // Silent success - no toast
      }
    }
  };

  // Trade Recording
  const recordTrade = async (tradeData: any) => {
    try {
      console.log('📝 ENGINE: Recording REAL signal trade:', tradeData);
      
      let mockTradeData: any = {
        strategy_id: tradeData.strategy_id,
        user_id: tradeData.user_id,
        trade_type: tradeData.trade_type,
        cryptocurrency: tradeData.cryptocurrency,
        amount: Math.round(tradeData.amount * 1e8) / 1e8,
        price: Math.round(tradeData.price * 1e6) / 1e6,
        total_value: Math.round(tradeData.total_value * 100) / 100,
        fees: 0,
        strategy_trigger: tradeData.strategy_trigger,
        notes: 'REAL signals automated trade',
        is_test_mode: true,
        profit_loss: 0,
        executed_at: new Date().toISOString()
      };

      console.log('📝 ENGINE: About to insert trade into database:', mockTradeData);
      console.log('📝 ENGINE: Calling supabase.from(mock_trades).insert...');

      const { data, error } = await supabase
        .from('mock_trades')
        .insert(mockTradeData)
        .select();

      console.log('📝 ENGINE: Supabase response - data:', data, 'error:', error);

      if (error) {
        console.error('❌ ENGINE: Database error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          mockTradeData
        });
        throw error;
      }
      
      console.log('✅ ENGINE: Successfully recorded REAL signal trade, DB ID:', data?.[0]?.id, 'Type:', tradeData.trade_type, 'Symbol:', tradeData.cryptocurrency);

    } catch (error) {
      console.error('❌ ENGINE: Catch block error:', error);
      console.error('❌ ENGINE: Error details:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack
      });
      throw error;
    }
  };

  // ScalpSmart bracket calculation (enforces risk/reward)
  const calculateScalpSmartBrackets = (config: any, currentPrice: number) => {
    const brackets = config.brackets || {};
    const isATRScaled = brackets.atrScaled || false;
    
    if (isATRScaled) {
      // ATR-based brackets with safety fallback
      const atrMultipliers = brackets.atrMultipliers || { tp: 2.6, sl: 2.0 };
      const atr = 0.02; // Mock ATR value - in real implementation would calculate from price data
      
      return {
        stopLossPct: atr * atrMultipliers.sl,
        takeProfitPct: atr * atrMultipliers.tp,
        trailBufferPct: brackets.trailBufferPct || 0.4
      };
    } else {
      // Fixed percentage with risk/reward enforcement
      const stopLossPct = brackets.stopLossPctWhenNotAtr || 0.40;
      const takeProfitPct = brackets.takeProfitPct || 0.65;
      const minTpSlRatio = brackets.minTpSlRatio || 1.2;
      
      // Enforce minimum TP/SL ratio
      const enforcedTP = Math.max(takeProfitPct, stopLossPct * minTpSlRatio);
      
      return {
        stopLossPct,
        takeProfitPct: enforcedTP,
        trailBufferPct: brackets.trailBufferPct || 0.4
      };
    }
  };

  // Hook effect
  // Remove console spam
  return { checkStrategiesAndExecute };
};