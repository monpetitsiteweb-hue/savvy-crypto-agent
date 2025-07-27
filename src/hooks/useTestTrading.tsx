import { useEffect, useRef } from 'react';
import { useTestMode } from './useTestMode';
import { useAuth } from './useAuth';
import { useMockWalletSafe } from './useMockWallet';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from './use-toast';
import { useRealTimeMarketData } from './useRealTimeMarketData';

export const useTestTrading = () => {
  console.log('🚨 HOOK_INIT: useTestTrading hook is being called');
  
  const { testMode } = useTestMode();
  console.log('🚨 HOOK_INIT: Got testMode:', testMode);
  
  const { user } = useAuth();
  console.log('🚨 HOOK_INIT: Got user:', !!user);
  
  // Use safe version that doesn't throw when context is unavailable
  const mockWallet = useMockWalletSafe();
  const updateBalance = mockWallet?.updateBalance || (() => {});
  const getBalance = mockWallet?.getBalance || (() => 0);
  
  if (mockWallet) {
    console.log('🚨 HOOK_INIT: Got mock wallet functions');
  } else {
    console.log('🚨 HOOK_INIT: Mock wallet context not available, using fallbacks');
  }
  
  const { toast } = useToast();
  console.log('🚨 HOOK_INIT: Got toast function');
  
  const { marketData, getCurrentData } = useRealTimeMarketData();
  console.log('🚨 HOOK_INIT: Got real time market data');
  
  const marketMonitorRef = useRef<NodeJS.Timeout | null>(null);
  const lastPricesRef = useRef<any>({});

  console.log('🚨 HOOK_INIT: Hook values - testMode:', testMode, 'user exists:', !!user);

  const checkStrategiesAndExecute = async () => {
    if (!testMode || !user) {
      console.log('🚨 STRATEGY_DEBUG: Skipping - testMode:', testMode, 'user:', !!user);
      return;
    }

    try {
      console.log('🚨 STRATEGY_DEBUG: Fetching strategies for user:', user.id);
      
      // Fetch active strategies
      const { data: strategies, error: strategiesError } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active_test', true); // Changed from is_active to is_active_test

      if (strategiesError) {
        console.error('🚨 STRATEGY_DEBUG: Error fetching strategies:', strategiesError);
        throw strategiesError;
      }
      
      console.log('🚨 STRATEGY_DEBUG: Found strategies:', strategies?.length || 0, strategies);
      
      if (!strategies || strategies.length === 0) {
        console.log('🚨 STRATEGY_DEBUG: No active test strategies found');
        return;
      }

      // Get real market data - prioritize real-time data, fallback to API call
      const realTimeData = Object.keys(marketData).length > 0 ? marketData : null;
      const currentMarketData = realTimeData || await getCurrentData(['BTC-EUR', 'ETH-EUR', 'XRP-EUR']); // Changed to EUR
      console.log('🚨 STRATEGY_DEBUG: Current market data:', currentMarketData);
      
      // Check each strategy against current market conditions
      for (const strategy of strategies) {
        console.log('🚨 STRATEGY_DEBUG: Processing strategy:', strategy.strategy_name);
        await checkStrategyConditions(strategy, currentMarketData);
      }
    } catch (error) {
      console.error('Error checking strategies:', error);
    }
  };

  const checkStrategyConditions = async (strategy: any, marketData: any) => {
    const config = strategy.configuration;
    const currentPrices = marketData;
    const lastPrices = lastPricesRef.current;

    // Check strategy conditions based on configuration
    for (const [symbol, data] of Object.entries(currentPrices) as [string, any][]) {
      const lastPrice = lastPrices[symbol]?.price || data.price;
      const priceChange = ((data.price - lastPrice) / lastPrice) * 100;

      // Example strategy condition checks based on common patterns
      const shouldBuy = checkBuyConditions(config, data, priceChange);
      const shouldSell = checkSellConditions(config, data, priceChange);

      if (shouldBuy) {
        await executeTrade(strategy, 'buy', symbol, data.price);
      } else if (shouldSell) {
        await executeTrade(strategy, 'sell', symbol, data.price);
      }
    }

    // Update last prices
    lastPricesRef.current = currentPrices;
  };

  const checkBuyConditions = (config: any, data: any, priceChange: number) => {
    console.log('🚨 BUY_CHECK: Checking buy conditions', { priceChange, config });
    
    // Simple test condition: buy when price changes by any amount (for testing)
    if (Math.abs(priceChange) > 0.1) { // Even 0.1% change triggers a buy for testing
      console.log('🚨 BUY_CHECK: Buy condition met - price change:', priceChange);
      return true;
    }
    
    // Original condition as fallback
    const buyThreshold = config.buyThreshold || -2; // Default -2% (less aggressive)
    return priceChange <= buyThreshold;
  };

  const checkSellConditions = (config: any, data: any, priceChange: number) => {
    // Example: Sell when price rises by threshold percentage
    const sellThreshold = config.sellThreshold || 5; // Default 5%
    return priceChange >= sellThreshold;
  };

  const executeTrade = async (strategy: any, action: 'buy' | 'sell', cryptocurrency: string, price: number) => {
    const config = strategy.configuration;
    const tradeAmount = config.tradeAmount || 0.001; // Default trade amount

    if (action === 'buy') {
      const eurBalance = getBalance('EUR');
      const tradeValue = tradeAmount * price;
      
      if (eurBalance >= tradeValue) {
        updateBalance('EUR', -tradeValue);
        updateBalance(cryptocurrency, tradeAmount);
        
        await recordTrade({
          strategy_id: strategy.id,
          trade_type: 'buy',
          cryptocurrency,
          amount: tradeAmount,
          price,
          total_value: tradeValue,
          strategy_trigger: `Price drop condition met`
        });

        toast({
          title: "Strategy Trade Executed",
          description: `Bought ${tradeAmount} ${cryptocurrency} at €${price.toFixed(2)}`,
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
          trade_type: 'sell',
          cryptocurrency,
          amount: tradeAmount,
          price,
          total_value: tradeValue,
          strategy_trigger: `Price rise condition met`
        });

        toast({
          title: "Strategy Trade Executed",
          description: `Sold ${tradeAmount} ${cryptocurrency} at €${price.toFixed(2)}`,
        });
      }
    }
  };

  const getRealMarketData = async () => {
    try {
      // Use Coinbase public API - no authentication required
      const symbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR'];
      const promises = symbols.map(symbol => 
        fetch(`https://api.exchange.coinbase.com/products/${symbol}/ticker`)
          .then(res => res.json())
      );

      const responses = await Promise.all(promises);
      
      const marketData: any = {};
      symbols.forEach((symbol, index) => {
        const crypto = symbol.split('-')[0];
        const data = responses[index];
        marketData[crypto] = {
          price: parseFloat(data.price),
          volume: parseFloat(data.volume),
          bid: parseFloat(data.bid),
          ask: parseFloat(data.ask),
          time: data.time
        };
      });

      return marketData;
    } catch (error) {
      console.error('Error fetching real market data:', error);
      // Fallback to mock data if API fails
      return {
        BTC: { price: 45000, volume: 100, bid: 44990, ask: 45010 },
        ETH: { price: 3000, volume: 500, bid: 2995, ask: 3005 },
        XRP: { price: 0.6, volume: 1000, bid: 0.599, ask: 0.601 }
      };
    }
  };


  const recordTrade = async (tradeData: any) => {
    try {
      console.log('🚨 TRADE_DEBUG: Attempting to record trade:', tradeData);
      console.log('🚨 TRADE_DEBUG: User ID:', user?.id);
      
      const { error } = await supabase
        .from('trading_history')
        .insert({
          ...tradeData,
          user_id: user?.id,
          trade_environment: 'test',
          is_sandbox: true,
          notes: 'Automated test trade',
          fees: tradeData.total_value * 0.005, // 0.5% fee
          executed_at: new Date().toISOString()
        });

      if (error) {
        console.error('🚨 TRADE_DEBUG: Error inserting into trading_history:', error);
        throw error;
      }
      console.log('🚨 TRADE_DEBUG: Successfully inserted into trading_history');

      // Also record in mock_trades for performance tracking with calculated P&L
      const profit_loss = tradeData.trade_type === 'sell' 
        ? (tradeData.total_value * 0.02) // Simulate 2% profit for sells
        : -(tradeData.total_value * 0.01); // Simulate 1% loss for buys initially

      const mockTradeData = {
        ...tradeData,
        user_id: user?.id,
        is_test_mode: true,
        profit_loss,
        fees: tradeData.total_value * 0.005,
        executed_at: new Date().toISOString()
      };

      console.log('🚨 TRADE_DEBUG: Attempting to insert mock trade:', mockTradeData);
      const { error: mockError } = await supabase
        .from('mock_trades')
        .insert(mockTradeData);

      if (mockError) {
        console.error('🚨 TRADE_DEBUG: Error inserting into mock_trades:', mockError);
        throw mockError;
      }
      console.log('🚨 TRADE_DEBUG: Successfully inserted into mock_trades');

    } catch (error) {
      console.error('Error recording trade:', error);
    }
  };

  useEffect(() => {
    console.log('🔧 useTestTrading useEffect triggered', { testMode, user: !!user });
    console.log('🔧 Test mode value:', testMode);
    console.log('🔧 User object:', user ? 'exists' : 'null');
    
    if (testMode && user) {
      console.log('🔧 Starting test trading monitoring');
      // Monitor market data every 10 seconds to check strategy conditions
      marketMonitorRef.current = setInterval(checkStrategiesAndExecute, 10000);
      
      // Check immediately
      setTimeout(checkStrategiesAndExecute, 2000);
    } else {
      console.log('🔧 Stopping test trading monitoring');
      // Stop market monitoring
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