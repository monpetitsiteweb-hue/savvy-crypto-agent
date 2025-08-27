import { useEffect, useRef } from 'react';
import { useTestMode } from './useTestMode';
import { useAuth } from './useAuth';
import { useMockWallet } from './useMockWallet';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from './use-toast';
import { useRealTimeMarketData } from './useRealTimeMarketData';
import { usePoolExitManager } from './usePoolExitManager';
import { useCoordinatorToast } from './useCoordinatorToast';

// Import and expose pool tests for console access
import '../utils/poolExitTests';

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
  const coordinatorToast = useCoordinatorToast();
  
  // Initialize pool exit manager
  const { processAllPools } = usePoolExitManager({ 
    isEnabled: true, 
    testMode 
  });
  
  console.log('🚨 INTELLIGENT_ENGINE: Hook called with testMode:', testMode, 'user:', !!user, 'loading:', loading, 'user email:', user?.email);
  console.log('🚨 INTELLIGENT_ENGINE: DETAILED DEBUG', {
    testMode,
    testModeType: typeof testMode,
    user: user ? { id: user.id, email: user.email } : null,
    userExists: !!user,
    loading,
    loadingType: typeof loading,
    localStorage_testMode: localStorage.getItem('global-test-mode')
  });

  // FIXED: Auto-run trading engine when authentication becomes available - but prevent infinite loops
  useEffect(() => {
    console.log('🚨 INTELLIGENT_ENGINE: Auth state changed - user:', !!user, 'loading:', loading, 'testMode:', testMode);
    
    if (!loading && user && testMode) {
      console.log('🚨 INTELLIGENT_ENGINE: ✅ AUTH ESTABLISHED - Starting trading engine automatically!');
      // Small delay to ensure all hooks are initialized
      const timer = setTimeout(() => {
        checkStrategiesAndExecute();
      }, 1000);
      
      // Cleanup timer on unmount or dependency change
      return () => clearTimeout(timer);
    } else {
      console.log('🚨 INTELLIGENT_ENGINE: ❌ Waiting for auth - loading:', loading, 'user:', !!user, 'testMode:', testMode);
    }
  }, [user, loading, testMode]); // Removed function from deps to prevent circular dependency
  
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
    console.log('🚨🚨🚨 EARLY EXIT CHECK: testMode:', testMode, 'user exists:', !!user, 'loading:', loading);
    
    if (!user || loading) {
      console.log('🚨 ENGINE: Skipping - user:', !!user, 'loading:', loading);
      return;
    }
    
    if (!testMode) {
      console.log('🚨🚨🚨 TEST MODE IS OFF! You need to enable Test Mode to use the trading engine!');
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
        // Try to match symbol with market data (handle both "XRP" and "XRP-EUR" formats)
        const symbol = position.cryptocurrency;
        const symbolWithEUR = symbol.includes('-EUR') ? symbol : `${symbol}-EUR`;
        const symbolWithoutEUR = symbol.replace('-EUR', '');
        
        const currentPrice = marketData[symbol]?.price || marketData[symbolWithEUR]?.price || marketData[symbolWithoutEUR]?.price;
        console.log('🚨 DEBUG SELL: Processing position:', symbol, 'trying symbols:', [symbol, symbolWithEUR, symbolWithoutEUR]);
        console.log('🚨 DEBUG SELL: Found price:', currentPrice, 'for symbol matching');
        
        if (!currentPrice) {
          console.log('🚨 DEBUG SELL: NO PRICE DATA for any variant of', symbol);
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
      console.log('🚨 DEBUG SELL: sellDecision JSON:', JSON.stringify(sellDecision));
      console.log('🚨 DEBUG SELL: sellDecision typeof:', typeof sellDecision);
      console.log('🚨 DEBUG SELL: sellDecision truthiness:', !!sellDecision, Boolean(sellDecision));
      
      if (sellDecision) {
        console.log('🚨 DEBUG SELL: EXECUTING SELL ORDER! Decision:', JSON.stringify(sellDecision));
        console.log('🚨 DEBUG SELL: Position cryptocurrency before executeSellOrder:', position.cryptocurrency);
        console.log('🚨 DEBUG SELL: Current price used:', currentPrice);
        await executeSellOrder(strategy, position, currentPrice, sellDecision);
      } else {
        console.log('🚨 DEBUG SELL: NO SELL DECISION - position will remain open');
        console.log('🚨 DEBUG SELL: sellDecision value:', sellDecision);
        console.log('🚨 DEBUG SELL: sellDecision type:', typeof sellDecision);
      }
    }
  };

  const getSellDecision = async (config: any, position: Position, currentPrice: number, pnlPercentage: number, hoursSincePurchase: number): Promise<{reason: string, orderType?: string} | null> => {
    console.log('🚨 SELL DECISION DEBUG: Checking sell conditions for', position.cryptocurrency);
    console.log('🚨 SELL DECISION DEBUG: Current price:', currentPrice, 'P&L%:', pnlPercentage, 'Hours held:', hoursSincePurchase);
    console.log('🚨 SELL DECISION DEBUG: Config:', {
      autoCloseAfterHours: config.autoCloseAfterHours,
      stopLossPercentage: config.stopLossPercentage,
      takeProfitPercentage: config.takeProfitPercentage,
      trailingStopLossPercentage: config.trailingStopLossPercentage
    });
    
    // 1. AUTO CLOSE AFTER HOURS (overrides everything)
    if (config.autoCloseAfterHours && hoursSincePurchase >= config.autoCloseAfterHours) {
      console.log('🚨 SELL DECISION: AUTO CLOSE TRIGGERED!', hoursSincePurchase, '>=', config.autoCloseAfterHours);
      return { reason: 'AUTO_CLOSE_TIME', orderType: 'market' };
    }

    // 2. STOP LOSS CHECK
    if (config.stopLossPercentage && pnlPercentage <= -Math.abs(config.stopLossPercentage)) {
      console.log('🚨 SELL DECISION: STOP LOSS TRIGGERED!', pnlPercentage, '<=', -Math.abs(config.stopLossPercentage));
      return { 
        reason: 'STOP_LOSS', 
        orderType: config.sellOrderType || 'market' 
      };
    }

    // 3. TAKE PROFIT CHECK
    if (config.takeProfitPercentage && pnlPercentage >= config.takeProfitPercentage) {
      console.log('🚨 SELL DECISION: TAKE PROFIT TRIGGERED!', pnlPercentage, '>=', config.takeProfitPercentage);
      return { 
        reason: 'TAKE_PROFIT', 
        orderType: config.sellOrderType || 'market' 
      };
    }

    console.log('🚨 SELL DECISION: NO SELL CONDITIONS MET - keeping position open');
    console.log('🚨 SELL DECISION: Auto close check:', config.autoCloseAfterHours ? `${hoursSincePurchase} < ${config.autoCloseAfterHours}` : 'disabled');
    console.log('🚨 SELL DECISION: Stop loss check:', config.stopLossPercentage ? `${pnlPercentage} > ${-Math.abs(config.stopLossPercentage)}` : 'disabled');
    console.log('🚨 SELL DECISION: Take profit check:', config.takeProfitPercentage ? `${pnlPercentage} < ${config.takeProfitPercentage}` : 'disabled');

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
    console.log('💸 ENGINE: executeSellOrder called!');
    console.log('💸 ENGINE: Position:', position.cryptocurrency, 'Amount:', position.remaining_amount);
    console.log('💸 ENGINE: Market price:', marketPrice, 'Reason:', sellDecision.reason);
    console.log('💸 ENGINE: Strategy:', strategy?.id);
    
    try {
      console.log('💸 ENGINE: About to call executeTrade...');
      await executeTrade(strategy, 'sell', position.cryptocurrency, marketPrice, position.remaining_amount, sellDecision.reason);
      console.log('💸 ENGINE: executeTrade completed successfully!');
    } catch (error) {
      console.error('💸 ENGINE: Error in executeTrade:', error);
    }
  };

  const checkTrailingStopLoss = async (config: any, position: Position, currentPrice: number, pnlPercentage: number): Promise<boolean> => {
    const trailingPercentage = config.trailingStopLossPercentage;
    
    // FIXED: Trailing stop should ONLY activate when position is actually profitable
    // Don't trigger trailing stop unless we're in profit
    if (!trailingPercentage || pnlPercentage <= 0) {
      console.log('🚫 TRAILING_STOP: Not in profit (', pnlPercentage.toFixed(2), '%) - trailing stop disabled');
      return false;
    }

    // Only activate trailing stop if we've reached a minimum profit threshold
    const minProfitForTrailing = config.trailingStopMinProfitThreshold || 1.0;
    if (pnlPercentage < minProfitForTrailing) {
      console.log('🚫 TRAILING_STOP: Below minimum profit threshold (', pnlPercentage.toFixed(2), '% <', minProfitForTrailing, '%) - trailing stop disabled');
      return false;
    }

    // For now, we need to track the actual peak price over time
    // Since we don't have peak tracking yet, let's disable trailing stop completely
    // until we implement proper peak tracking
    console.log('🚫 TRAILING_STOP: Peak tracking not implemented yet - trailing stop disabled');
    console.log('💡 TRAILING_STOP: Use regular take-profit (', config.takeProfitPercentage, '%) instead');
    
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

    console.log('🧮 POSITIONS: Starting position calculation for user:', user.id);

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

    console.log('🧮 POSITIONS: Buy trades found:', buyTrades?.length || 0);
    console.log('🧮 POSITIONS: Sell trades found:', sellTrades?.length || 0);
    
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
        toast({
          title: "Trade Intent Failed",
          description: `Network error processing ${action} for ${cryptocurrency}: ${error.message}`,
          variant: "destructive",
        });
        return;
      }

      // Handle coordinator responses
      if (!decision) {
        console.error('❌ INTELLIGENT: No decision returned from coordinator');
        toast({
          title: "Trade Intent Failed", 
          description: `No response from trading coordinator for ${action} on ${cryptocurrency}`,
          variant: "destructive",
        });
        return;
      }

      console.log('📋 INTELLIGENT: Coordinator decision:', JSON.stringify(decision, null, 2));

      // STEP 1: Use standardized coordinator toast handler
      if (coordinatorToast) {
        coordinatorToast.handleCoordinatorResponse(decision, { side: action.toUpperCase(), symbol: cryptocurrency });
      } else {
        // Fallback - should rarely happen
        const decisionData = decision?.decision;
        if (decisionData) {
          toast({
            title: decisionData.action === 'HOLD' || decisionData.action === 'DEFER' ? "Trade Held" : "Trade Executed",
            description: `${decisionData.action} ${cryptocurrency}: ${decisionData.reason}`,
            variant: "default",
          });
        } else {
          toast({
            title: "System Error",
            description: `Invalid coordinator response format`,
            variant: "destructive",
          });
        }
      }

    } catch (error) {
      console.error('❌ INTELLIGENT: Error executing trade intent:', error);
      toast({
        title: "Trade Error",
        description: `Error processing ${action} for ${cryptocurrency}`,
        variant: "destructive",
      });
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
      toast({
        title: "Trade Blocked",
        description: `Suspicious price detected: €${price}. Trade prevented by security guard.`,
        variant: "destructive",
      });
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

      // Calculate buy amount with safe defaults (no more €100 hardcode)
      const defaultAllocation = 50; // Reduced from €100 to €50 minimum
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

        toast({
          title: "REAL Signal Trade Executed",
          description: `Bought ${tradeAmount.toFixed(6)} ${normalizedSymbol} at €${price.toFixed(2)} (${trigger})`,
        });
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

        toast({
          title: "REAL Signal Trade Executed",
          description: `Sold ${tradeAmount.toFixed(6)} ${normalizedSymbol} at €${price.toFixed(2)} (${trigger})`,
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

  // Hook effect
  useEffect(() => {
    console.log('🚀 INTELLIGENT_ENGINE: Starting with REAL signal integration');
    console.log('🚀 INTELLIGENT_ENGINE: Current state - testMode:', testMode, 'user:', !!user, 'user email:', user?.email, 'loading:', loading);
    
    if (testMode && user && !loading) {
      console.log('🚀 INTELLIGENT_ENGINE: ✅ ALL CONDITIONS MET - Starting REAL signal monitoring');
      marketMonitorRef.current = setInterval(checkStrategiesAndExecute, 30000); // Reduced to 30 seconds
      setTimeout(checkStrategiesAndExecute, 2000);
    } else {
      console.log('🚀 INTELLIGENT_ENGINE: ❌ CONDITIONS NOT MET - Stopping trading engine', {
        testMode,
        hasUser: !!user,
        loading,
        reason: !testMode ? 'Test mode disabled' : !user ? 'Not authenticated' : loading ? 'Still loading' : 'Unknown'
      });
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
  }, [testMode, user?.id, loading]); // CRITICAL: Only depend on user.id not full user object

  return { checkStrategiesAndExecute };
};