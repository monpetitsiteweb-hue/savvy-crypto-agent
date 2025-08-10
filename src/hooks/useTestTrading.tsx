import { useEffect, useRef } from 'react';
import { useTestMode } from './useTestMode';
import { useAuth } from './useAuth';
import { useMockWallet } from './useMockWallet';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from './use-toast';
import { useRealTimeMarketData } from './useRealTimeMarketData';

export const useTestTrading = () => {
  console.log('🚨 HOOK_INIT: useTestTrading hook is being called');
  
  const { testMode } = useTestMode();
  console.log('🚨 HOOK_INIT: Got testMode:', testMode);
  
  const { user } = useAuth();
  console.log('🚨 HOOK_INIT: Got user:', !!user);
  
  const { updateBalance, getBalance } = useMockWallet();
  console.log('🚨 HOOK_INIT: Got mock wallet functions');
  
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
    if (!user?.id) {
      console.error('🚨 TRADE_EXECUTION: Cannot execute trade - no authenticated user');
      return;
    }

    const config = strategy.configuration;
    // Use proper trade amount calculation from configuration
    const amountPerTrade = config?.amountPerTrade || 100; // Default €100
    const tradeAmount = amountPerTrade / price; // Calculate units based on EUR amount and current price
    
    console.log('🚨 TRADE_CALCULATION:', {
      amountPerTrade,
      price,
      calculatedAmount: tradeAmount,
      cryptocurrency
    });

    if (action === 'buy') {
      const eurBalance = getBalance('EUR');
      const tradeValue = tradeAmount * price;
      
      if (eurBalance >= tradeValue) {
        updateBalance('EUR', -tradeValue);
        updateBalance(cryptocurrency, tradeAmount);
        
        await recordTrade({
          strategy_id: strategy.id,
          user_id: user.id, // Always use authenticated user ID
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
          user_id: user.id, // Always use authenticated user ID
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
      console.log('🚨 TRADE_RECORDING: Recording trade with user_id:', tradeData.user_id);
      
      if (!tradeData.user_id) {
        throw new Error('user_id is required for trade recording');
      }
      
      if (!tradeData.strategy_id) {
        throw new Error('strategy_id is required for trade recording');
      }

      // Calculate P&L for the trade
      let profit_loss = 0;
      
      if (tradeData.trade_type === 'sell') {
        // For sell trades, calculate P&L based on current market price vs a simulated buy price
        // This creates a realistic P&L without requiring complex FIFO matching
        const sellPrice = tradeData.price;
        const sellValue = tradeData.total_value;
        
        // Simulate a buy price (5% lower than sell price for realistic P&L)
        const simulatedBuyPrice = sellPrice * 0.95;
        const simulatedBuyValue = simulatedBuyPrice * tradeData.amount;
        
        // Calculate fees (0.5% of total transaction value)
        const fees = sellValue * 0.005;
        
        // Calculate P&L: Sell Value - Buy Value - Fees
        profit_loss = sellValue - simulatedBuyValue - fees;
      } else {
        // For buy trades, P&L is 0 (unrealized until sold)
        profit_loss = 0;
      }

      const mockTradeData = {
        strategy_id: tradeData.strategy_id,
        user_id: tradeData.user_id,
        trade_type: tradeData.trade_type,
        cryptocurrency: tradeData.cryptocurrency,
        amount: tradeData.amount,
        price: tradeData.price,
        total_value: tradeData.total_value,
        fees: tradeData.total_value * 0.005, // 0.5% fee
        strategy_trigger: tradeData.strategy_trigger,
        notes: 'Automated test trade',
        is_test_mode: true,
        profit_loss,
        executed_at: new Date().toISOString()
      };

      console.log('🚨 TRADE_RECORDING: Final trade data:', mockTradeData);
      
      const { error } = await supabase
        .from('mock_trades')
        .insert(mockTradeData);

      if (error) {
        console.error('🚨 TRADE_RECORDING: Database error:', error);
        throw error;
      }
      
      console.log('✅ TRADE_RECORDING: Successfully saved trade');

    } catch (error) {
      console.error('❌ TRADE_RECORDING: Failed to record trade:', error);
      throw error;
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