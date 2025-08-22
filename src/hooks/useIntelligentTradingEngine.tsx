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

    // 2. TECHNICAL INDICATOR BUY SIGNALS
    if (await checkTechnicalBuySignals(config, symbol, marketData)) {
      return { reason: 'TECHNICAL_SIGNAL' };
    }

    // 3. AI BUY DECISION
    if (config.aiIntelligenceConfig?.enableAIOverride && await checkAIBuySignal(config, symbol, marketData)) {
      return { reason: 'AI_SIGNAL' };
    }

    // 4. SIMPLE PRICE-BASED SIGNALS (fallback)
    if (await checkSimpleBuySignals(config, symbol, marketData)) {
      return { reason: 'PRICE_SIGNAL' };
    }

    return null;
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

  // Technical Analysis Functions
  const checkTechnicalBuySignals = async (config: any, symbol: string, marketData: any): Promise<boolean> => {
    const techConfig = config.technicalIndicatorConfig;
    if (!techConfig) return false;

    let signals = 0;
    let totalIndicators = 0;

    // RSI Check
    if (techConfig.rsi?.enabled) {
      totalIndicators++;
      // TODO: Calculate actual RSI from price data
      // For now, simulate based on recent price action
      const mockRSI = Math.random() * 100;
      if (mockRSI <= techConfig.rsi.buyThreshold) {
        signals++;
        console.log('📊 ENGINE: RSI buy signal:', mockRSI, '<=', techConfig.rsi.buyThreshold);
      }
    }

    // MACD Check
    if (techConfig.macd?.enabled) {
      totalIndicators++;
      // TODO: Implement MACD calculation
      // Simulate MACD bullish signal
      if (Math.random() < 0.3) {
        signals++;
        console.log('📊 ENGINE: MACD buy signal');
      }
    }

    // EMA Crossover
    if (techConfig.ema?.enabled) {
      totalIndicators++;
      // TODO: Implement EMA crossover logic
      // Simulate EMA crossover
      if (Math.random() < 0.2) {
        signals++;
        console.log('📊 ENGINE: EMA crossover buy signal');
      }
    }

    // Require at least 50% of enabled indicators to signal buy
    const signalThreshold = Math.ceil(totalIndicators * 0.5);
    return signals >= signalThreshold;
  };

  // AI Decision Functions
  const checkAIBuySignal = async (config: any, symbol: string, marketData: any): Promise<boolean> => {
    const aiConfig = config.aiIntelligenceConfig;
    if (!aiConfig?.enableAIOverride) return false;

    // TODO: Implement comprehensive AI analysis
    // - Pattern recognition
    // - External signals (whale activity, sentiment, news)
    // - Cross-asset correlation
    // For now, simulate based on confidence threshold
    
    const aiConfidence = Math.random() * 100;
    const meetsThreshold = aiConfidence >= aiConfig.aiConfidenceThreshold;
    
    if (meetsThreshold) {
      console.log('🤖 ENGINE: AI buy confidence:', aiConfidence, '>=', aiConfig.aiConfidenceThreshold);
    }
    
    return meetsThreshold;
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