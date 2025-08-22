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
  const { user, loading } = useAuth();
  const { updateBalance, getBalance } = useMockWallet();
  const { toast } = useToast();
  const { marketData, getCurrentData } = useRealTimeMarketData();
  
  console.log('🚨 INTELLIGENT_ENGINE: Hook called with testMode:', testMode, 'user:', !!user, 'loading:', loading, 'user email:', user?.email);
  
  const marketMonitorRef = useRef<NodeJS.Timeout | null>(null);
  const tradingStateRef = useRef<TradingState>({
    dailyTrades: 0,
    dailyPnL: 0,
    lastTradeTime: '',
    openPositions: [],
    dailyResetDate: new Date().toDateString()
  });

  const checkStrategiesAndExecute = async () => {
    console.log('🚨 ENGINE: checkStrategiesAndExecute called with testMode:', testMode, 'user:', !!user, 'loading:', loading, 'user email:', user?.email);
    if (!testMode || !user || loading) {
      console.log('🚨 ENGINE: Skipping - testMode:', testMode, 'user:', !!user, 'loading:', loading);
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
        const config = strategy.configuration as any;
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

    return false;
  };

  const manageExistingPositions = async (strategy: any, marketData: any) => {
    const config = strategy.configuration as any;
    const positions = await calculateOpenPositions();
    
    console.log('📊 ENGINE: Managing', positions.length, 'open positions');
    console.log('🚨 DEBUG SELL: Full positions data:', JSON.stringify(positions, null, 2));
    console.log('🚨 DEBUG SELL: Market data available:', Object.keys(marketData));
    console.log('🚨 DEBUG SELL: Strategy config sell settings:', {
      stopLossPercentage: config.stopLossPercentage,
      takeProfitPercentage: config.takeProfitPercentage,
      trailingStopLossPercentage: config.trailingStopLossPercentage,
      autoCloseAfterHours: config.autoCloseAfterHours,
      sellOrderType: config.sellOrderType
    });

    for (const position of positions) {
      const currentPrice = marketData[position.cryptocurrency]?.price;
      console.log('🚨 DEBUG SELL: Processing position:', position.cryptocurrency, 'current price:', currentPrice);
      
      if (!currentPrice) {
        console.log('🚨 DEBUG SELL: NO PRICE DATA for', position.cryptocurrency);
        continue;
      }

      const purchasePrice = position.average_price;
      const pnlPercentage = ((currentPrice - purchasePrice) / purchasePrice) * 100;
      const hoursSincePurchase = (Date.now() - new Date(position.oldest_purchase_date).getTime()) / (1000 * 60 * 60);

      console.log('🎯 ENGINE: Position analysis:', {
        symbol: position.cryptocurrency,
        pnlPercentage: pnlPercentage.toFixed(2) + '%',
        hoursSincePurchase: hoursSincePurchase.toFixed(1),
        amount: position.remaining_amount,
        purchasePrice,
        currentPrice
      });

      // Execute sell based on sell order type and conditions
      const sellDecision = await getSellDecision(config, position, currentPrice, pnlPercentage, hoursSincePurchase);
      console.log('🚨 DEBUG SELL: Sell decision for', position.cryptocurrency, ':', sellDecision);
      
      if (sellDecision) {
        console.log('🚨 DEBUG SELL: EXECUTING SELL ORDER!');
        await executeSellOrder(strategy, position, currentPrice, sellDecision);
      } else {
        console.log('🚨 DEBUG SELL: NO SELL DECISION - position will remain open');
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
    console.log('💸 ENGINE: Executing sell order for', position.cryptocurrency, 'reason:', sellDecision.reason);
    await executeTrade(strategy, 'sell', position.cryptocurrency, marketPrice, position.remaining_amount, sellDecision.reason);
  };

  const checkTrailingStopLoss = async (config: any, position: Position, currentPrice: number, pnlPercentage: number): Promise<boolean> => {
    const trailingPercentage = config.trailingStopLossPercentage;
    if (!trailingPercentage || pnlPercentage <= 0) return false;

    // Simplified trailing stop logic
    const simulatedPeak = position.average_price * 1.1;
    const dropFromPeak = ((simulatedPeak - currentPrice) / simulatedPeak) * 100;
    
    if (dropFromPeak >= trailingPercentage) {
      console.log('📉 ENGINE: Trailing stop triggered - dropped', dropFromPeak.toFixed(2) + '% from peak');
      return true;
    }

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

      console.log('🔍 ENGINE: REAL sell signals for', symbol, '- found:', liveSignals?.length || 0, 'technical signals');

      if (liveSignals?.length) {
        // Check for strong bearish signals from REAL data
        const bearishSignals = liveSignals.filter(s => s.signal_strength < -0.4);
        if (bearishSignals.length >= 2) {
          console.log('📊 ENGINE: Multiple REAL bearish technical signals:', bearishSignals.length);
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
            console.log('📊 ENGINE: REAL RSI sell signal from live data');
            return true;
          }
        }
      }

    } catch (error) {
      console.error('❌ ENGINE: Error fetching REAL technical indicators:', error);
    }

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

    // Get coins to analyze
    const coinsToAnalyze = config.selectedCoins || ['BTC', 'ETH', 'XRP'];
    
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

      console.log('🐋 ENGINE: Checking REAL whale signals for', cryptoSymbol, '- found:', whaleSignals?.length || 0);

      if (whaleSignals?.length) {
        // Check for significant whale activity (large amounts)
        const largeTransactions = whaleSignals.filter(signal => 
          signal.amount > 100000 // Large whale transactions
        );

        if (largeTransactions.length > 0) {
          console.log('🐋 ENGINE: REAL large whale transactions detected for', symbol, '- count:', largeTransactions.length);
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
          console.log('🐋 ENGINE: REAL live whale signals detected for', symbol, '- count:', strongWhaleSignals.length);
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

      console.log('📰 ENGINE: Checking REAL news/sentiment signals for', cryptoSymbol, '- found:', newsSignals?.length || 0);

      if (newsSignals?.length) {
        // Calculate average sentiment from REAL signals
        const sentimentScores = newsSignals.map(signal => signal.signal_strength);
        const avgSentiment = sentimentScores.reduce((sum, score) => sum + score, 0) / sentimentScores.length;
        
        // Count positive signals
        const positiveSignals = newsSignals.filter(signal => signal.signal_strength > 0.3);
        const sentimentThreshold = 0.3 + (newsWeight / 200);
        
        console.log('📰 ENGINE: REAL news analysis for', symbol, '- avg sentiment:', avgSentiment.toFixed(3), 'positive signals:', positiveSignals.length);

        if (avgSentiment > sentimentThreshold && positiveSignals.length >= 2) {
          console.log('📰 ENGINE: REAL positive news sentiment signal for', symbol);
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
          console.log('📰 ENGINE: REAL external news sentiment signal for', symbol, '- score:', avgExternalSentiment);
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

  // Trade Execution
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
      // Calculate buy amount
      if (config.allocationUnit === 'percentage') {
        const totalBalance = getBalance('EUR');
        tradeAmount = (totalBalance * config.perTradeAllocation / 100) / price;
      } else {
        tradeAmount = (config.perTradeAllocation || 100) / price;
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
          strategy_trigger: trigger || 'REAL_SIGNALS'
        });

        tradingStateRef.current.dailyTrades++;
        tradingStateRef.current.lastTradeTime = new Date().toISOString();

        toast({
          title: "REAL Signal Trade Executed",
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
          strategy_trigger: trigger || 'REAL_SIGNALS'
        });

        tradingStateRef.current.dailyTrades++;
        tradingStateRef.current.lastTradeTime = new Date().toISOString();

        toast({
          title: "REAL Signal Trade Executed",
          description: `Sold ${tradeAmount.toFixed(6)} ${cryptocurrency} at €${price.toFixed(2)} (${trigger})`,
        });
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

      const { error } = await supabase
        .from('mock_trades')
        .insert(mockTradeData);

      if (error) {
        console.error('❌ ENGINE: Database error:', error);
        throw error;
      }
      
      console.log('✅ ENGINE: Successfully recorded REAL signal trade');

    } catch (error) {
      console.error('❌ ENGINE: Failed to record trade:', error);
      throw error;
    }
  };

  // Hook effect
  useEffect(() => {
    console.log('🚀 INTELLIGENT_ENGINE: Starting with REAL signal integration');
    
    if (testMode && user) {
      console.log('🚀 INTELLIGENT_ENGINE: Starting REAL signal monitoring');
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