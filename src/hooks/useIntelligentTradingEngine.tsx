import { useEffect, useRef } from 'react';
import { useTestMode } from './useTestMode';
import { useAuth } from './useAuth';
import { useMockWallet } from './useMockWallet';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from './use-toast';
import { useRealTimeMarketData } from './useRealTimeMarketData';

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
  const { user } = useAuth();
  const { updateBalance, getBalance } = useMockWallet();
  const { toast } = useToast();
  const { marketData, getCurrentData } = useRealTimeMarketData();
  
  const marketMonitorRef = useRef<NodeJS.Timeout | null>(null);
  const tradingStateRef = useRef<TradingState>({
    dailyTrades: 0,
    dailyPnL: 0,
    lastTradeTime: '',
    openPositions: [],
    dailyResetDate: new Date().toDateString()
  });

  const checkStrategiesAndExecute = async () => {
    if (!testMode || !user) {
      console.log('🚨 ENGINE: Skipping - testMode:', testMode, 'user:', !!user);
      return;
    }

    try {
      console.log('🚨 INTELLIGENT_ENGINE: Starting comprehensive strategy check');
      
      // Fetch active strategies
      const { data: strategies, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active_test', true);

      if (error || !strategies?.length) {
        console.log('🚨 ENGINE: No active strategies found:', error);
        return;
      }

      // Get market data for all coins
      const allCoins = new Set<string>();
      strategies.forEach(strategy => {
        const config = strategy.configuration as any; // Cast to any to access properties
        const selectedCoins = config?.selectedCoins || ['BTC', 'ETH', 'XRP'];
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
    console.log('🎯 ENGINE: Processing strategy with full config:', config);

    // Reset daily counters if needed
    resetDailyCountersIfNeeded();

    // 1. CHECK DAILY LIMITS FIRST
    if (isDailyLimitReached(config)) {
      console.log('🛑 ENGINE: Daily limits reached, skipping strategy');
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
      console.log('🔄 ENGINE: Resetting daily counters for new day');
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
      console.log('🛑 ENGINE: Daily trade limit reached:', state.dailyTrades, '>=', config.maxTradesPerDay);
      return true;
    }

    // Check daily loss limit
    if (config.dailyLossLimit && state.dailyPnL <= -Math.abs(config.dailyLossLimit)) {
      console.log('🛑 ENGINE: Daily loss limit reached:', state.dailyPnL, '<=', -config.dailyLossLimit);
      return true;
    }

    // Check daily profit target (optional stop)
    if (config.dailyProfitTarget && state.dailyPnL >= config.dailyProfitTarget) {
      console.log('🎯 ENGINE: Daily profit target reached:', state.dailyPnL, '>=', config.dailyProfitTarget);
      // Note: This could be configurable - some users might want to continue trading after hitting profit target
    }

    return false;
  };

  const manageExistingPositions = async (strategy: any, marketData: any) => {
    const config = strategy.configuration as any;
    const positions = await calculateOpenPositions();
    
    console.log('📊 ENGINE: Managing', positions.length, 'open positions');

    for (const position of positions) {
      const currentPrice = marketData[position.cryptocurrency]?.price;
      if (!currentPrice) continue;

      const purchasePrice = position.average_price;
      const pnlPercentage = ((currentPrice - purchasePrice) / purchasePrice) * 100;
      const hoursSincePurchase = (Date.now() - new Date(position.oldest_purchase_date).getTime()) / (1000 * 60 * 60);

      console.log('🎯 ENGINE: Position analysis:', {
        symbol: position.cryptocurrency,
        pnlPercentage: pnlPercentage.toFixed(2) + '%',
        hoursSincePurchase: hoursSincePurchase.toFixed(1),
        amount: position.remaining_amount
      });

      // Execute sell based on sell order type and conditions
      const sellDecision = await getSellDecision(config, position, currentPrice, pnlPercentage, hoursSincePurchase);
      
      if (sellDecision) {
        await executeSellOrder(strategy, position, currentPrice, sellDecision);
      }
    }
  };

  const getSellDecision = async (config: any, position: Position, currentPrice: number, pnlPercentage: number, hoursSincePurchase: number): Promise<{reason: string, orderType?: string} | null> => {
    // 1. AUTO CLOSE AFTER HOURS (overrides everything)
    if (config.autoCloseAfterHours && hoursSincePurchase >= config.autoCloseAfterHours) {
      return { reason: 'AUTO_CLOSE_TIME', orderType: 'market' };
    }

    // 2. STOP LOSS CHECK
    if (config.stopLossPercentage && pnlPercentage <= -Math.abs(config.stopLossPercentage)) {
      // Check if we should reset stop loss after fail
      if (config.resetStopLossAfterFail && await wasStopLossTriggeredBefore(position.cryptocurrency)) {
        console.log('🔄 ENGINE: Stop loss was triggered before, resetting threshold');
        // TODO: Implement reset logic - maybe adjust stop loss percentage
      }
      
      return { 
        reason: 'STOP_LOSS', 
        orderType: config.sellOrderType || 'market' 
      };
    }

    // 3. TAKE PROFIT CHECK
    if (config.takeProfitPercentage && pnlPercentage >= config.takeProfitPercentage) {
      return { 
        reason: 'TAKE_PROFIT', 
        orderType: config.sellOrderType || 'market' 
      };
    }

    // 4. TRAILING STOP LOSS
    if (config.trailingStopLossPercentage) {
      const trailingStopTriggered = await checkTrailingStopLoss(config, position, currentPrice, pnlPercentage);
      if (trailingStopTriggered) {
        if (config.useTrailingStopOnly) {
          // Only use trailing stop, ignore regular stop loss
          return { 
            reason: 'TRAILING_STOP_ONLY', 
            orderType: 'trailing_stop' 
          };
        } else {
          // Use trailing stop in addition to regular stop loss
          return { 
            reason: 'TRAILING_STOP', 
            orderType: 'trailing_stop' 
          };
        }
      }
    }

    // 5. TECHNICAL INDICATOR SELL SIGNALS
    if (await checkTechnicalSellSignals(config, position.cryptocurrency, currentPrice)) {
      return { 
        reason: 'TECHNICAL_SIGNAL', 
        orderType: config.sellOrderType || 'market' 
      };
    }

    // 6. AI OVERRIDE SELL DECISION
    if (config.aiIntelligenceConfig?.enableAIOverride && await checkAISellSignal(config, position, currentPrice)) {
      return { 
        reason: 'AI_OVERRIDE', 
        orderType: config.sellOrderType || 'market' 
      };
    }

    return null;
  };

  const executeSellOrder = async (strategy: any, position: Position, marketPrice: number, sellDecision: {reason: string, orderType?: string}) => {
    const config = strategy.configuration as any;
    const orderType = sellDecision.orderType || config.sellOrderType || 'market';

    console.log('💸 ENGINE: Executing', orderType, 'sell order for', position.cryptocurrency, 'reason:', sellDecision.reason);

    switch (orderType) {
      case 'market':
        await executeTrade(strategy, 'sell', position.cryptocurrency, marketPrice, position.remaining_amount, sellDecision.reason);
        break;

      case 'limit':
        // TODO: Implement limit sell order logic
        console.log('📝 ENGINE: Limit sell orders not yet implemented, using market order');
        await executeTrade(strategy, 'sell', position.cryptocurrency, marketPrice, position.remaining_amount, sellDecision.reason + '_LIMIT_AS_MARKET');
        break;

      case 'trailing_stop':
        await executeTrailingStopOrder(strategy, position, marketPrice, sellDecision.reason);
        break;

      case 'auto_close':
        await executeTrade(strategy, 'sell', position.cryptocurrency, marketPrice, position.remaining_amount, sellDecision.reason + '_AUTO_CLOSE');
        break;

      default:
        console.log('❌ ENGINE: Unknown sell order type:', orderType, 'using market order');
        await executeTrade(strategy, 'sell', position.cryptocurrency, marketPrice, position.remaining_amount, sellDecision.reason);
    }
  };

  const checkTrailingStopLoss = async (config: any, position: Position, currentPrice: number, pnlPercentage: number): Promise<boolean> => {
    const trailingPercentage = config.trailingStopLossPercentage;
    if (!trailingPercentage) return false;

    // TODO: Implement proper trailing stop loss logic
    // This requires tracking the highest price since purchase and triggering when price drops by trailing percentage from peak
    
    // For now, simplified logic: trigger if we're profitable but dropped by trailing percentage from some peak
    if (pnlPercentage > 0) {
      // Simulate that we had a peak and now we're trailing down
      // In real implementation, this would track actual price peaks
      const simulatedPeak = position.average_price * 1.1; // Assume we peaked at 10% profit
      const dropFromPeak = ((simulatedPeak - currentPrice) / simulatedPeak) * 100;
      
      if (dropFromPeak >= trailingPercentage) {
        console.log('📉 ENGINE: Trailing stop triggered - dropped', dropFromPeak.toFixed(2) + '% from peak');
        return true;
      }
    }

    return false;
  };

  const executeTrailingStopOrder = async (strategy: any, position: Position, marketPrice: number, reason: string) => {
    // TODO: Implement proper trailing stop order logic
    // For now, execute as market order
    console.log('📉 ENGINE: Trailing stop sell order (simplified as market order)');
    await executeTrade(strategy, 'sell', position.cryptocurrency, marketPrice, position.remaining_amount, reason + '_TRAILING_STOP');
  };

  const wasStopLossTriggeredBefore = async (cryptocurrency: string): Promise<boolean> => {
    // Check if we previously had a stop loss triggered for this crypto
    const { data: previousStopLoss } = await supabase
      .from('mock_trades')
      .select('strategy_trigger')
      .eq('user_id', user?.id)
      .eq('cryptocurrency', cryptocurrency)
      .eq('trade_type', 'sell')
      .eq('is_test_mode', true)
      .ilike('strategy_trigger', '%STOP_LOSS%')
      .limit(1);
    
    return !!previousStopLoss?.length;
  };

  const checkTechnicalSellSignals = async (config: any, symbol: string, currentPrice: number): Promise<boolean> => {
    const techConfig = config.technicalIndicatorConfig;
    if (!techConfig) return false;

    // RSI Overbought
    if (techConfig.rsi?.enabled) {
      const mockRSI = Math.random() * 100;
      if (mockRSI >= techConfig.rsi.sellThreshold) {
        console.log('📊 ENGINE: RSI sell signal:', mockRSI, '>=', techConfig.rsi.sellThreshold);
        return true;
      }
    }

    // TODO: Implement other technical indicators for sell signals
    // - MACD bearish crossover
    // - EMA crossover downward
    // - Bollinger Band upper band touch
    // - ADX trending down

    return false;
  };

  const checkBuyOpportunities = async (strategy: any, marketData: any) => {
    const config = strategy.configuration as any;
    const positions = await calculateOpenPositions();
    
    // Check position limits
    if (config.maxOpenPositions && positions.length >= config.maxOpenPositions) {
      console.log('🛑 ENGINE: Max open positions reached:', positions.length, '>=', config.maxOpenPositions);
      return;
    }

    // Check BUY frequency and timing
    if (!await shouldBuyBasedOnFrequency(config)) {
      console.log('⏰ ENGINE: Buy frequency/timing conditions not met');
      return;
    }

    // Check buy cooldown (separate from trade cooldown)
    if (config.buyCooldownMinutes && await isInBuyCooldown(config.buyCooldownMinutes)) {
      console.log('⏳ ENGINE: Buy cooldown active');
      return;
    }

    // Get coins to analyze
    let coinsToAnalyze: string[];
    if (config.enableAutoCoinSelection) {
      // TODO: Implement smart coin selection based on market conditions, AI signals, etc.
      coinsToAnalyze = await getAutoSelectedCoins(config, marketData);
    } else {
      coinsToAnalyze = config.selectedCoins || ['BTC', 'ETH', 'XRP'];
    }
    
    for (const coin of coinsToAnalyze) {
      const symbol = `${coin}-EUR`;
      const currentData = marketData[symbol];
      if (!currentData) continue;

      // Skip if already have position in this coin (unless DCA enabled)
      const hasPosition = positions.some(p => p.cryptocurrency === symbol);
      if (hasPosition && !config.enableDCA) {
        console.log('📝 ENGINE: Already have position in', symbol, '(DCA disabled)');
        continue;
      }

      // Check if we should buy this coin
      const buySignal = await getBuySignal(config, symbol, marketData, hasPosition);
      if (!buySignal) continue;

      // Execute buy based on order type
      await executeBuyOrder(strategy, symbol, currentData.price, buySignal.reason);
    }
  };

  const shouldBuyBasedOnFrequency = async (config: any): Promise<boolean> => {
    const frequency = config.buyFrequency || 'signal_based';
    
    switch (frequency) {
      case 'once':
        // Check if we've already bought any of the selected coins
        const { data: existingBuys } = await supabase
          .from('mock_trades')
          .select('cryptocurrency')
          .eq('user_id', user?.id)
          .eq('trade_type', 'buy')
          .eq('is_test_mode', true);
        
        const selectedCoins = config.selectedCoins || ['BTC', 'ETH', 'XRP'];
        const hasExistingBuys = existingBuys?.some(trade => 
          selectedCoins.some(coin => trade.cryptocurrency.includes(coin))
        );
        
        if (hasExistingBuys) {
          console.log('🛑 ENGINE: "Once" frequency - already have buys');
          return false;
        }
        return true;

      case 'daily':
        // Check if we've bought today
        const today = new Date().toDateString();
        const { data: todayBuys } = await supabase
          .from('mock_trades')
          .select('executed_at')
          .eq('user_id', user?.id)
          .eq('trade_type', 'buy')
          .eq('is_test_mode', true)
          .gte('executed_at', new Date(today).toISOString());
        
        if (todayBuys?.length) {
          console.log('🛑 ENGINE: Daily frequency - already bought today');
          return false;
        }
        return true;

      case 'interval':
        // Check if enough time has passed since last buy
        const intervalMinutes = config.buyIntervalMinutes || 60;
        const { data: lastBuy } = await supabase
          .from('mock_trades')
          .select('executed_at')
          .eq('user_id', user?.id)
          .eq('trade_type', 'buy')
          .eq('is_test_mode', true)
          .order('executed_at', { ascending: false })
          .limit(1);
        
        if (lastBuy?.length) {
          const lastBuyTime = new Date(lastBuy[0].executed_at);
          const nextBuyTime = new Date(lastBuyTime.getTime() + intervalMinutes * 60 * 1000);
          
          if (Date.now() < nextBuyTime.getTime()) {
            console.log('🛑 ENGINE: Interval frequency - too soon since last buy');
            return false;
          }
        }
        return true;

      case 'signal_based':
      default:
        return true; // Always allow signal-based buys
    }
  };

  const isInBuyCooldown = async (buyCooldownMinutes: number): Promise<boolean> => {
    const { data: lastBuy } = await supabase
      .from('mock_trades')
      .select('executed_at')
      .eq('user_id', user?.id)
      .eq('trade_type', 'buy')
      .eq('is_test_mode', true)
      .order('executed_at', { ascending: false })
      .limit(1);
    
    if (!lastBuy?.length) return false;
    
    const lastBuyTime = new Date(lastBuy[0].executed_at);
    const cooldownEnd = new Date(lastBuyTime.getTime() + buyCooldownMinutes * 60 * 1000);
    
    return Date.now() < cooldownEnd.getTime();
  };

  const getAutoSelectedCoins = async (config: any, marketData: any): Promise<string[]> => {
    // TODO: Implement intelligent coin selection based on:
    // - Market momentum
    // - Technical indicators
    // - AI signals
    // - Volume analysis
    // - Correlation analysis
    
    console.log('🤖 ENGINE: Auto coin selection (TODO: implement smart logic)');
    
    // For now, return top performing coins or fallback to selected coins
    const allCoins = Object.keys(marketData);
    const topCoins = allCoins.slice(0, Math.min(3, config.maxActiveCoins || 3));
    
    return topCoins.map(symbol => symbol.split('-')[0]); // Remove -EUR suffix
  };

  const getBuySignal = async (config: any, symbol: string, marketData: any, hasPosition: boolean): Promise<{reason: string} | null> => {
    // 1. DCA BUY (if enabled and have position)
    if (config.enableDCA && hasPosition && await shouldDCABuy(config, symbol)) {
      return { reason: 'DCA_SIGNAL' };
    }

    // 2. WHALE SIGNALS CHECK
    if (await checkWhaleSignals(symbol)) {
      return { reason: 'WHALE_SIGNAL' };
    }

    // 3. NEWS SENTIMENT SIGNALS
    if (await checkNewsSentimentSignals(config, symbol)) {
      return { reason: 'NEWS_SENTIMENT_SIGNAL' };
    }

    // 4. SOCIAL SIGNALS CHECK  
    if (await checkSocialSignals(config, symbol)) {
      return { reason: 'SOCIAL_SIGNAL' };
    }

    // 5. TECHNICAL INDICATOR BUY SIGNALS
    if (await checkTechnicalBuySignals(config, symbol, marketData)) {
      return { reason: 'TECHNICAL_SIGNAL' };
    }

    // 6. AI BUY DECISION (combines all signals)
    if (config.aiIntelligenceConfig?.enableAIOverride && await checkAIBuySignal(config, symbol, marketData)) {
      return { reason: 'AI_COMPREHENSIVE_SIGNAL' };
    }

    // 7. SIMPLE PRICE-BASED SIGNALS (fallback)
    if (await checkSimpleBuySignals(config, symbol, marketData)) {
      return { reason: 'PRICE_SIGNAL' };
    }

    return null;
  };

  // WHALE SIGNALS - Check for large transaction alerts
  const checkWhaleSignals = async (symbol: string): Promise<boolean> => {
    try {
      const { data: whaleEvents } = await supabase
        .from('whale_signal_events')
        .select('*')
        .eq('token_symbol', symbol.split('-')[0]) // Remove -EUR suffix
        .eq('processed', false)
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 30).toISOString()) // Last 30 minutes
        .order('timestamp', { ascending: false })
        .limit(5);

      if (whaleEvents?.length) {
        const significantEvents = whaleEvents.filter(event => 
          event.amount && event.amount > 50000 && // Large transactions
          (event.event_type === 'transfer' || event.event_type === 'buy')
        );
        
        if (significantEvents.length > 0) {
          console.log('🐋 ENGINE: Whale buy signal detected for', symbol, '- events:', significantEvents.length);
          return true;
        }
      }
    } catch (error) {
      console.error('❌ ENGINE: Error checking whale signals:', error);
    }
    return false;
  };

  // NEWS SENTIMENT SIGNALS
  const checkNewsSentimentSignals = async (config: any, symbol: string): Promise<boolean> => {
    try {
      const newsWeight = config.aiIntelligenceConfig?.newsImpactWeight || 30;
      if (newsWeight === 0) return false;

      const { data: newsData } = await supabase
        .from('crypto_news')
        .select('sentiment_score, headline')
        .eq('symbol', symbol.split('-')[0])
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString()) // Last 2 hours
        .order('timestamp', { ascending: false })
        .limit(10);

      if (newsData?.length) {
        const avgSentiment = newsData.reduce((sum, news) => 
          sum + (news.sentiment_score || 0), 0) / newsData.length;
        
        // Positive sentiment above threshold
        const sentimentThreshold = 0.6; // Positive sentiment
        if (avgSentiment > sentimentThreshold) {
          console.log('📰 ENGINE: Positive news sentiment signal for', symbol, '- score:', avgSentiment);
          return true;
        }
      }
    } catch (error) {
      console.error('❌ ENGINE: Error checking news sentiment:', error);
    }
    return false;
  };

  // SOCIAL SIGNALS from external market data
  const checkSocialSignals = async (config: any, symbol: string): Promise<boolean> => {
    try {
      const socialWeight = config.aiIntelligenceConfig?.socialSignalsWeight || 15;
      if (socialWeight === 0) return false;

      const { data: socialData } = await supabase
        .from('external_market_data')
        .select('data_value, data_type, metadata')
        .eq('cryptocurrency', symbol.split('-')[0])
        .in('data_type', ['social_volume', 'social_sentiment', 'reddit_mentions'])
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString()) // Last 4 hours
        .order('timestamp', { ascending: false })
        .limit(20);

      if (socialData?.length) {
        const socialScores = socialData.map(data => data.data_value || 0);
        const avgSocialScore = socialScores.reduce((sum, score) => sum + score, 0) / socialScores.length;
        
        // High social activity threshold
        if (avgSocialScore > 0.7) {
          console.log('📱 ENGINE: Strong social signal for', symbol, '- score:', avgSocialScore);
          return true;
        }
      }
    } catch (error) {
      console.error('❌ ENGINE: Error checking social signals:', error);
    }
    return false;
  };

  // AI COMPREHENSIVE SIGNAL (combines all data sources)
  const checkAIBuySignal = async (config: any, symbol: string, marketData: any): Promise<boolean> => {
    try {
      const aiConfig = config.aiIntelligenceConfig;
      if (!aiConfig?.enableAIOverride) return false;

      let signalStrength = 0;
      let maxSignalStrength = 0;

      // Weight different signals based on AI config
      const weights = {
        technical: 0.4,
        sentiment: (aiConfig.sentimentWeight || 30) / 100,
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
        console.log('🤖 ENGINE: AI comprehensive buy signal for', symbol, '- confidence:', aiConfidence + '%');
        return true;
      }

      console.log('🤖 ENGINE: AI signal below threshold for', symbol, '- confidence:', aiConfidence + '%', 'threshold:', confidenceThreshold + '%');
    } catch (error) {
      console.error('❌ ENGINE: Error in AI buy signal analysis:', error);
    }
    return false;
  };

  const checkSimpleBuySignals = async (config: any, symbol: string, marketData: any): Promise<boolean> => {
    // Simple fallback logic if no technical indicators or AI enabled
    const currentPrice = marketData[symbol]?.price;
    if (!currentPrice) return false;

    // Very basic logic - can be enhanced
    // Buy on slight dips or randomly for testing
    return Math.random() < 0.05; // 5% chance for testing
  };

  const executeBuyOrder = async (strategy: any, symbol: string, marketPrice: number, reason: string) => {
    const config = strategy.configuration as any;
    const orderType = config.buyOrderType || 'market';

    console.log('💰 ENGINE: Executing', orderType, 'buy order for', symbol, 'reason:', reason);

    switch (orderType) {
      case 'market':
        await executeTrade(strategy, 'buy', symbol, marketPrice, undefined, reason);
        break;

      case 'limit':
        // TODO: Implement limit order logic
        // For now, execute as market order
        console.log('📝 ENGINE: Limit buy orders not yet implemented, using market order');
        await executeTrade(strategy, 'buy', symbol, marketPrice, undefined, reason + '_LIMIT_AS_MARKET');
        break;

      case 'trailing_buy':
        await executeTrailingBuyOrder(strategy, symbol, marketPrice, reason);
        break;

      default:
        console.log('❌ ENGINE: Unknown buy order type:', orderType);
    }
  };

  const executeTrailingBuyOrder = async (strategy: any, symbol: string, currentPrice: number, reason: string) => {
    const config = strategy.configuration as any;
    const trailingPercentage = config.trailingBuyPercentage || 2; // Default 2%

    // TODO: Implement proper trailing buy logic
    // This requires tracking price movements and buying when price starts recovering
    // For now, simulate trailing buy by waiting for a small dip
    
    console.log('📈 ENGINE: Trailing buy for', symbol, 'at', trailingPercentage + '% trail');
    
    // Simplified trailing buy: Buy if price dropped recently
    // In real implementation, this would track highest price and buy when it recovers
    const trailingBuyPrice = currentPrice * (1 - trailingPercentage / 100);
    
    console.log('📈 ENGINE: Trailing buy triggered at', trailingBuyPrice, '(current:', currentPrice, ')');
    await executeTrade(strategy, 'buy', symbol, currentPrice, undefined, reason + '_TRAILING_BUY');
  };

  // Technical Analysis Functions - REAL IMPLEMENTATION
  const checkTechnicalBuySignals = async (config: any, symbol: string, marketData: any): Promise<boolean> => {
    const techConfig = config.technicalIndicatorConfig;
    if (!techConfig) return false;

    let signals = 0;
    let totalIndicators = 0;

    try {
      // Get real technical indicators from price_data metadata and live_signals
      const [priceDataResponse, liveSignalsResponse] = await Promise.all([
        supabase
          .from('price_data')
          .select('metadata')
          .eq('symbol', symbol)
          .order('timestamp', { ascending: false })
          .limit(1),
        supabase
          .from('live_signals')
          .select('*')
          .eq('symbol', symbol)
          .eq('processed', false)
          .order('timestamp', { ascending: false })
          .limit(10)
      ]);

      const latestPriceData = priceDataResponse.data?.[0];
      const liveSignals = liveSignalsResponse.data || [];

      // RSI Check from cached indicators
      if (techConfig.rsi?.enabled && latestPriceData?.metadata) {
        const metadata = latestPriceData.metadata as any;
        if (metadata.RSI) {
          totalIndicators++;
          const rsi = metadata.RSI;
          if (rsi <= techConfig.rsi.buyThreshold) {
            signals++;
            console.log('📊 ENGINE: RSI buy signal:', rsi, '<=', techConfig.rsi.buyThreshold);
          }
        }
      }

      // MACD Check from cached indicators
      if (techConfig.macd?.enabled && latestPriceData?.metadata) {
        const metadata = latestPriceData.metadata as any;
        if (metadata.MACD) {
          totalIndicators++;
          const macd = metadata.MACD;
          // MACD bullish when line crosses above signal line
          if (macd.MACD > macd.signal) {
            signals++;
            console.log('📊 ENGINE: MACD buy signal - MACD above signal line');
          }
        }
      }

      // EMA Check from cached indicators
      if (techConfig.ema?.enabled && latestPriceData?.metadata) {
        const metadata = latestPriceData.metadata as any;
        if (metadata.EMA) {
          totalIndicators++;
          const ema = metadata.EMA;
          const currentPrice = marketData[symbol]?.price;
          // Buy when price is above short EMA and short EMA > long EMA
          if (currentPrice > ema.short && ema.short > ema.long) {
            signals++;
            console.log('📊 ENGINE: EMA buy signal - bullish trend');
          }
        }
      }

      // SMA Check from cached indicators
      if (techConfig.sma?.enabled && latestPriceData?.metadata) {
        const metadata = latestPriceData.metadata as any;
        if (metadata.SMA) {
          totalIndicators++;
          const sma = metadata.SMA;
          const currentPrice = marketData[symbol]?.price;
          // Buy when price is above SMA
          if (currentPrice > sma) {
            signals++;
            console.log('📊 ENGINE: SMA buy signal - price above SMA');
          }
        }
      }

      // Bollinger Bands Check
      if (techConfig.bollinger?.enabled && latestPriceData?.metadata) {
        const metadata = latestPriceData.metadata as any;
        if (metadata.BollingerBands) {
          totalIndicators++;
          const bb = metadata.BollingerBands;
          const currentPrice = marketData[symbol]?.price;
          // Buy when price touches lower band (oversold)
          if (currentPrice <= bb.lower) {
            signals++;
            console.log('📊 ENGINE: Bollinger Bands buy signal - oversold condition');
          }
        }
      }

      // ADX Check for trend strength
      if (techConfig.adx?.enabled && latestPriceData?.metadata) {
        const metadata = latestPriceData.metadata as any;
        if (metadata.ADX) {
          totalIndicators++;
          const adx = metadata.ADX;
          // Strong trend when ADX > threshold
          if (adx > techConfig.adx.threshold) {
            signals++;
            console.log('📊 ENGINE: ADX buy signal - strong trend detected:', adx);
          }
        }
      }

      // Process live signals from technical-signal-generator
      liveSignals.forEach(signal => {
        if (signal.signal_type.includes('bullish') || signal.signal_type.includes('buy')) {
          totalIndicators++;
          if (signal.signal_strength > 0.5) {
            signals++;
            console.log('📊 ENGINE: Live signal buy:', signal.signal_type, 'strength:', signal.signal_strength);
          }
        }
      });

    } catch (error) {
      console.error('❌ ENGINE: Error fetching technical indicators:', error);
    }

    // Need at least 50% of indicators to agree
    const signalStrength = totalIndicators > 0 ? signals / totalIndicators : 0;
    const threshold = 0.5; // 50% of indicators must agree
    
    console.log('📊 ENGINE: Technical signals:', signals, '/', totalIndicators, '=', signalStrength);
    return signalStrength >= threshold;
  };


  const checkAISellSignal = async (config: any, position: Position, marketData: any): Promise<boolean> => {
    const aiConfig = config.aiIntelligenceConfig;
    if (!aiConfig?.enableAIOverride) return false;

    // TODO: Implement AI sell logic based on:
    // - Pattern recognition
    // - Risk override conditions
    // - Market structure analysis
    
    return false; // Placeholder
  };

  const isInCooldown = async (cooldownMinutes: number): Promise<boolean> => {
    if (!tradingStateRef.current.lastTradeTime) return false;
    
    const lastTrade = new Date(tradingStateRef.current.lastTradeTime);
    const cooldownEnd = new Date(lastTrade.getTime() + cooldownMinutes * 60 * 1000);
    
    return Date.now() < cooldownEnd.getTime();
  };

  const shouldDCABuy = async (config: any, symbol: string): Promise<boolean> => {
    // TODO: Implement DCA logic based on:
    // - dcaIntervalHours
    // - dcaSteps
    // - Current position size
    return false;
  };

  // Position Management
  const calculateOpenPositions = async (): Promise<Position[]> => {
    if (!user?.id) return [];

    // Get all trades
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

    if (!buyTrades) return [];

    const positions: Record<string, Position> = {};

    // Add buy trades
    buyTrades.forEach(trade => {
      const symbol = trade.cryptocurrency;
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
      
      // Track oldest purchase for auto-close timing
      if (trade.executed_at < positions[symbol].oldest_purchase_date) {
        positions[symbol].oldest_purchase_date = trade.executed_at;
      }
    });

    // Subtract sell trades
    if (sellTrades) {
      sellTrades.forEach(trade => {
        const symbol = trade.cryptocurrency;
        if (positions[symbol]) {
          positions[symbol].remaining_amount -= trade.amount;
        }
      });
    }

    // Filter and calculate averages
    return Object.values(positions).filter(pos => {
      if (pos.remaining_amount > 0.00000001) {
        pos.average_price = pos.total_value / pos.total_amount;
        return true;
      }
      return false;
    });
  };

  // Trade Execution (Enhanced)
  const executeTrade = async (
    strategy: any, 
    action: 'buy' | 'sell', 
    cryptocurrency: string, 
    price: number, 
    customAmount?: number,
    trigger?: string
  ) => {
    if (!user?.id) {
      console.error('❌ ENGINE: Cannot execute trade - no authenticated user');
      return;
    }

    const config = strategy.configuration;
    let tradeAmount: number;
    
    if (action === 'sell' && customAmount !== undefined) {
      tradeAmount = customAmount;
    } else {
      // Calculate buy amount based on allocation settings
      if (config.allocationUnit === 'percentage') {
        const totalBalance = getBalance('EUR');
        tradeAmount = (totalBalance * config.perTradeAllocation / 100) / price;
      } else {
        // Euro amount
        tradeAmount = (config.perTradeAllocation || 100) / price;
      }
    }

    // Check wallet exposure limits
    if (action === 'buy' && config.maxWalletExposure) {
      const totalBalance = getBalance('EUR');
      const tradeValue = tradeAmount * price;
      const exposurePercentage = (tradeValue / totalBalance) * 100;
      
      if (exposurePercentage > config.maxWalletExposure) {
        console.log('🛑 ENGINE: Trade would exceed wallet exposure limit:', exposurePercentage, '>', config.maxWalletExposure);
        return;
      }
    }

    // Execute the trade
    if (action === 'buy') {
      const eurBalance = getBalance('EUR');
      const tradeValue = tradeAmount * price;
      
      if (eurBalance >= tradeValue) {
        updateBalance('EUR', -tradeValue);
        updateBalance(cryptocurrency, tradeAmount);
        
        await recordTrade({
          strategy_id: strategy.id,
          user_id: user.id,
          trade_type: 'buy',
          cryptocurrency,
          amount: tradeAmount,
          price,
          total_value: tradeValue,
          strategy_trigger: trigger || 'Unknown trigger'
        });

        // Update trading state
        tradingStateRef.current.dailyTrades++;
        tradingStateRef.current.lastTradeTime = new Date().toISOString();

        toast({
          title: "Intelligent Trade Executed",
          description: `Bought ${tradeAmount.toFixed(6)} ${cryptocurrency} at €${price.toFixed(2)} (${trigger})`,
        });
      }
    } else if (action === 'sell') {
      const cryptoBalance = getBalance(cryptocurrency);
      
      if (cryptoBalance >= tradeAmount) {
        const tradeValue = tradeAmount * price;
        updateBalance(cryptocurrency, -tradeAmount);
        updateBalance('EUR', tradeValue);
        
        await recordTrade({
          strategy_id: strategy.id,
          user_id: user.id,
          trade_type: 'sell',
          cryptocurrency,
          amount: tradeAmount,
          price,
          total_value: tradeValue,
          strategy_trigger: trigger || 'Unknown trigger'
        });

        // Update trading state
        tradingStateRef.current.dailyTrades++;
        tradingStateRef.current.lastTradeTime = new Date().toISOString();
        
        // Update daily P&L (simplified)
        const estimatedPnL = tradeValue - (tradeAmount * 50000); // TODO: Use actual purchase price
        tradingStateRef.current.dailyPnL += estimatedPnL;

        toast({
          title: "Intelligent Trade Executed",
          description: `Sold ${tradeAmount.toFixed(6)} ${cryptocurrency} at €${price.toFixed(2)} (${trigger})`,
        });
      }
    }
  };

  // Trade Recording (same as before but with enhanced trigger info)
  const recordTrade = async (tradeData: any) => {
    try {
      console.log('📝 ENGINE: Recording intelligent trade:', tradeData);
      
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
        notes: 'Intelligent automated trade',
        is_test_mode: true,
        profit_loss: 0,
        executed_at: new Date().toISOString()
      };

      // Handle sell trades with FIFO matching (same logic as before)
      if (tradeData.trade_type === 'sell') {
        const allocation = await allocateSellToBuysFifo(
          tradeData.user_id, 
          tradeData.cryptocurrency, 
          tradeData.amount
        );

        const original_purchase_amount = allocation.reduce((sum: number, a: any) => sum + a.matchedAmount, 0);
        const original_purchase_value = Math.round(allocation.reduce((sum: number, a: any) => sum + a.buyValuePortion, 0) * 100) / 100;
        const original_purchase_price = original_purchase_amount > 0 
          ? Math.round((original_purchase_value / original_purchase_amount) * 1e6) / 1e6
          : 0;

        const exit_value = Math.round(tradeData.price * tradeData.amount * 100) / 100;
        const realized_pnl = Math.round((exit_value - original_purchase_value) * 100) / 100;
        const realized_pnl_pct = original_purchase_value > 0
          ? Math.round((realized_pnl / original_purchase_value) * 10000) / 100
          : 0;

        mockTradeData = {
          ...mockTradeData,
          original_purchase_amount: Math.round(original_purchase_amount * 1e8) / 1e8,
          original_purchase_price,
          original_purchase_value,
          exit_value,
          buy_fees: 0,
          sell_fees: 0,
          realized_pnl,
          realized_pnl_pct
        };
      }

      const { error } = await supabase
        .from('mock_trades')
        .insert(mockTradeData);

      if (error) {
        console.error('❌ ENGINE: Database error:', error);
        throw error;
      }
      
      console.log('✅ ENGINE: Successfully recorded intelligent trade');

    } catch (error) {
      console.error('❌ ENGINE: Failed to record trade:', error);
      throw error;
    }
  };

  // FIFO allocation (same as before)
  const allocateSellToBuysFifo = async (userId: string, cryptocurrency: string, sellAmount: number) => {
    const { data: trades, error } = await supabase
      .from('mock_trades')
      .select('*')
      .eq('user_id', userId)
      .eq('cryptocurrency', cryptocurrency)
      .order('executed_at', { ascending: true });

    if (error) throw error;

    const buyLots: Array<{
      id: string;
      amount: number;
      price: number;
      total_value: number;
      executed_at: string;
      remaining: number;
    }> = [];

    for (const trade of trades || []) {
      if (trade.trade_type === 'buy') {
        buyLots.push({
          id: trade.id,
          amount: trade.amount,
          price: trade.price,
          total_value: trade.total_value,
          executed_at: trade.executed_at,
          remaining: trade.amount
        });
      } else if (trade.trade_type === 'sell') {
        let remainingToSell = trade.amount;
        for (const lot of buyLots) {
          if (remainingToSell <= 0) break;
          
          const allocated = Math.min(lot.remaining, remainingToSell);
          lot.remaining -= allocated;
          remainingToSell -= allocated;
        }
      }
    }

    const allocation: Array<{
      lotId: string;
      matchedAmount: number;
      buyPrice: number;
      buyValuePortion: number;
    }> = [];

    let remainingToSell = sellAmount;
    
    for (const lot of buyLots) {
      if (remainingToSell <= 0) break;
      if (lot.remaining <= 0) continue;
      
      const allocated = Math.min(lot.remaining, remainingToSell);
      const buyValuePortion = (allocated / lot.amount) * lot.total_value;
      
      allocation.push({
        lotId: lot.id,
        matchedAmount: allocated,
        buyPrice: lot.price,
        buyValuePortion: buyValuePortion
      });
      
      remainingToSell -= allocated;
    }

    return allocation;
  };

  // Hook effect
  useEffect(() => {
    console.log('🚀 INTELLIGENT_ENGINE: Starting with testMode:', testMode, 'user:', !!user);
    
    if (testMode && user) {
      console.log('🚀 INTELLIGENT_ENGINE: Starting comprehensive trading monitoring');
      marketMonitorRef.current = setInterval(checkStrategiesAndExecute, 10000);
      setTimeout(checkStrategiesAndExecute, 2000);
    } else {
      if (marketMonitorRef.current) {
        clearInterval(marketMonitorRef.current);
        marketMonitorRef.current = null;
      }
    }

    return () => {
      if (marketMonitorRef.current) {
        clearInterval(marketMonitorRef.current);
      }
    };
  }, [testMode, user]);

  return { checkStrategiesAndExecute };
};