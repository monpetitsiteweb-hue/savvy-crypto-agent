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

      // Get all coins from strategies and fetch market data for all of them
      const allCoins = new Set<string>();
      strategies.forEach(strategy => {
        const config = strategy.configuration as any;
        const selectedCoins = config?.selectedCoins || ['BTC', 'ETH', 'XRP'];
        selectedCoins.forEach((coin: string) => allCoins.add(`${coin}-EUR`));
      });
      
      const symbolsToFetch = Array.from(allCoins);
      console.log('🚨 STRATEGY_DEBUG: Fetching market data for all coins:', symbolsToFetch);
      
      // Get real market data - prioritize real-time data, fallback to API call
      const realTimeData = Object.keys(marketData).length > 0 ? marketData : null;
      const currentMarketData = realTimeData || await getCurrentData(symbolsToFetch);
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
        // PHASE 2: GUARDRAIL - Prevent duplicate SELL within 5 seconds
        const { data: recentSells, error: dupError } = await supabase
          .from('mock_trades')
          .select('id')
          .eq('user_id', user.id)
          .eq('trade_type', 'sell')
          .eq('cryptocurrency', cryptocurrency)
          .eq('amount', tradeAmount)
          .eq('price', price)
          .gte('executed_at', new Date(Date.now() - 5000).toISOString())
          .limit(1);
          
        if (dupError) {
          console.error('🚨 DUPLICATE_CHECK: Error checking for duplicates:', dupError);
        } else if (recentSells?.length) {
          console.warn('🚨 DUPLICATE_CHECK: Duplicate sell detected, skipping');
          toast({
            title: "Duplicate Trade Detected",
            description: "A similar sell trade was executed recently. Please wait before trying again.",
            variant: "destructive"
          });
          return;
        }
        
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
      const symbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'ADA-EUR', 'SOL-EUR', 'DOT-EUR', 'MATIC-EUR', 'AVAX-EUR', 'LINK-EUR', 'LTC-EUR'];
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
        XRP: { price: 0.6, volume: 1000, bid: 0.599, ask: 0.601 },
        ADA: { price: 0.8, volume: 2000, bid: 0.799, ask: 0.801 },
        SOL: { price: 150, volume: 300, bid: 149.5, ask: 150.5 },
        DOT: { price: 12, volume: 800, bid: 11.95, ask: 12.05 },
        MATIC: { price: 2.1, volume: 1500, bid: 2.095, ask: 2.105 },
        AVAX: { price: 35, volume: 400, bid: 34.9, ask: 35.1 },
        LINK: { price: 18, volume: 600, bid: 17.95, ask: 18.05 },
        LTC: { price: 180, volume: 200, bid: 179.5, ask: 180.5 }
      };
    }
  };


  // Helper functions for rounding
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const round8 = (n: number) => Math.round(n * 1e8) / 1e8;

  // Fee rate determination based on account type
  const getFeeRate = (accountType: string) => {
    return accountType === 'COINBASE_PRO' ? 0 : 0.05; // 0% or 5%
  };

  // FIFO allocation logic for SELL trades
  const allocateSellToBuysFifo = async (userId: string, cryptocurrency: string, sellAmount: number) => {
    // Fetch all trades for this user and cryptocurrency, ordered chronologically
    const { data: trades, error } = await supabase
      .from('mock_trades')
      .select('*')
      .eq('user_id', userId)
      .eq('cryptocurrency', cryptocurrency)
      .order('executed_at', { ascending: true });

    if (error) throw error;

    // Build FIFO lots from BUY trades
    const buyLots: Array<{
      id: string;
      amount: number;
      price: number;
      total_value: number;
      executed_at: string;
      remaining: number;
    }> = [];

    let currentHolding = 0;

    for (const trade of trades) {
      if (trade.trade_type === 'buy') {
        buyLots.push({
          id: trade.id,
          amount: trade.amount,
          price: trade.price,
          total_value: trade.total_value,
          executed_at: trade.executed_at,
          remaining: trade.amount
        });
        currentHolding += trade.amount;
      } else if (trade.trade_type === 'sell') {
        // Allocate this SELL against existing buy lots (FIFO)
        let remainingToSell = trade.amount;
        for (const lot of buyLots) {
          if (remainingToSell <= 0) break;
          
          const allocated = Math.min(lot.remaining, remainingToSell);
          lot.remaining -= allocated;
          remainingToSell -= allocated;
        }
        currentHolding -= trade.amount;
      }
    }

    // Now allocate the new SELL against remaining buy lots
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

  const recordTrade = async (tradeData: any) => {
    try {
      console.log('🚨 CRITICAL_DEBUG: Recording trade with user_id:', tradeData.user_id);
      console.log('🚨 CRITICAL_DEBUG: Auth user from hook:', user?.id, user?.email);
      console.log('🚨 CRITICAL_DEBUG: Trade data user_id matches auth user:', tradeData.user_id === user?.id);
      
      if (!tradeData.user_id) {
        throw new Error('user_id is required for trade recording');
      }
      
      if (!tradeData.strategy_id) {
        throw new Error('strategy_id is required for trade recording');
      }

      // Get user's profile for account type (fee calculation)
      const { data: profile } = await supabase
        .from('profiles')
        .select('fee_rate, username')
        .eq('id', tradeData.user_id)
        .single();

      // Use the user's actual fee rate from their profile settings
      const feeRate = profile?.fee_rate || 0;
      
      console.log('🔥 TRADE_RECORDING_DEBUG: User profile and fees:', {
        userId: tradeData.user_id,
        profileFeeRate: profile?.fee_rate,
        actualFeeRate: feeRate,
        tradeType: tradeData.trade_type,
        tradeValue: tradeData.total_value
      });

      let mockTradeData: any = {
        strategy_id: tradeData.strategy_id,
        user_id: tradeData.user_id,
        trade_type: tradeData.trade_type,
        cryptocurrency: tradeData.cryptocurrency,
        amount: round8(tradeData.amount),
        price: round6(tradeData.price),
        total_value: round2(tradeData.total_value),
        fees: round2(tradeData.total_value * feeRate), // Legacy fees field
        strategy_trigger: tradeData.strategy_trigger,
        notes: 'Automated test trade',
        is_test_mode: true,
        profit_loss: 0, // Legacy field, will be calculated properly for SELLs
        executed_at: new Date().toISOString()
      };

      // PHASE 2: Enhanced SELL processing with purchase snapshot + fees
      if (tradeData.trade_type === 'sell') {
        console.log('🔥 SELL_PROCESSING: Computing purchase snapshot for SELL trade');
        
        // 1) Allocate SELL -> BUY lots via FIFO
        const allocation = await allocateSellToBuysFifo(
          tradeData.user_id, 
          tradeData.cryptocurrency, 
          tradeData.amount
        );

        // 2) Aggregate purchase snapshot for THIS SELL
        const original_purchase_amount = allocation.reduce((sum, a) => sum + a.matchedAmount, 0);
        const original_purchase_value = round2(allocation.reduce((sum, a) => sum + a.buyValuePortion, 0));
        const original_purchase_price = original_purchase_amount > 0 
          ? round6(original_purchase_value / original_purchase_amount) 
          : 0;

        // 3) Exit values
        const exit_value = round2(tradeData.price * tradeData.amount);

        // 4) Fees (NET P&L policy) — based on account type
        const buy_fees = round2(original_purchase_value * feeRate);
        const sell_fees = round2(exit_value * feeRate);

        // 5) Realized P&L (net of fees)
        const realized_pnl = round2((exit_value - sell_fees) - (original_purchase_value + buy_fees));
        const realized_pnl_pct = original_purchase_value > 0
          ? round2((realized_pnl / original_purchase_value) * 100)
          : 0;

        // 6) Add snapshot columns to SELL trade row
        mockTradeData = {
          ...mockTradeData,
          original_purchase_amount: round8(original_purchase_amount),
          original_purchase_price,
          original_purchase_value,
          exit_value,
          buy_fees,
          sell_fees,
          realized_pnl,
          realized_pnl_pct
        };

        console.log('🔥 SELL_PROCESSING: Purchase snapshot computed:', {
          original_purchase_amount,
          original_purchase_price,
          original_purchase_value,
          exit_value,
          buy_fees,
          sell_fees,
          realized_pnl,
          realized_pnl_pct
        });
      }

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