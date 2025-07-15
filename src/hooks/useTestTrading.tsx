import { useEffect, useRef } from 'react';
import { useTestMode } from './useTestMode';
import { useAuth } from './useAuth';
import { useMockWallet } from './useMockWallet';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from './use-toast';

export const useTestTrading = () => {
  const { testMode } = useTestMode();
  const { user } = useAuth();
  const { updateBalance, getBalance } = useMockWallet();
  const { toast } = useToast();
  const tradingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const executeTestTrade = async () => {
    if (!testMode || !user) return;

    try {
      // Fetch active strategies
      const { data: strategies, error: strategiesError } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .eq('test_mode', true);

      if (strategiesError) throw strategiesError;
      if (!strategies || strategies.length === 0) return;

      // Execute trades for each active strategy
      for (const strategy of strategies) {
        await simulateTradeForStrategy(strategy);
      }
    } catch (error) {
      console.error('Error executing test trade:', error);
    }
  };

  const simulateTradeForStrategy = async (strategy: any) => {
    // Get real market data simulation
    const marketData = await getMarketData();
    const decision = analyzeStrategy(strategy, marketData);

    if (decision.shouldTrade) {
      const { cryptocurrency, action, amount } = decision;
      const price = marketData[cryptocurrency]?.price || 1000;

      // Check if we have enough balance
      if (action === 'buy') {
        const eurBalance = getBalance('EUR');
        const tradeValue = amount * price;
        
        if (eurBalance >= tradeValue) {
          // Execute buy order
          updateBalance('EUR', -tradeValue);
          updateBalance(cryptocurrency, amount);
          
          await recordTrade({
            strategy_id: strategy.id,
            trade_type: 'buy',
            cryptocurrency,
            amount,
            price,
            total_value: tradeValue
          });

          toast({
            title: "Test Trade Executed",
            description: `Bought ${amount} ${cryptocurrency} at €${price.toFixed(2)}`,
          });
        }
      } else if (action === 'sell') {
        const cryptoBalance = getBalance(cryptocurrency);
        
        if (cryptoBalance >= amount) {
          // Execute sell order
          const tradeValue = amount * price;
          updateBalance(cryptocurrency, -amount);
          updateBalance('EUR', tradeValue);
          
          await recordTrade({
            strategy_id: strategy.id,
            trade_type: 'sell',
            cryptocurrency,
            amount,
            price,
            total_value: tradeValue
          });

          toast({
            title: "Test Trade Executed",
            description: `Sold ${amount} ${cryptocurrency} at €${price.toFixed(2)}`,
          });
        }
      }
    }
  };

  const getMarketData = async () => {
    // Simulate real market data with some volatility
    const baseData = {
      BTC: { price: 45000 + (Math.random() - 0.5) * 2000, change: (Math.random() - 0.5) * 10 },
      ETH: { price: 3000 + (Math.random() - 0.5) * 300, change: (Math.random() - 0.5) * 8 },
      XRP: { price: 0.6 + (Math.random() - 0.5) * 0.1, change: (Math.random() - 0.5) * 15 }
    };
    
    return baseData;
  };

  const analyzeStrategy = (strategy: any, marketData: any) => {
    const config = strategy.configuration;
    const cryptocurrencies = ['BTC', 'ETH', 'XRP'];
    const selectedCrypto = cryptocurrencies[Math.floor(Math.random() * cryptocurrencies.length)];
    const market = marketData[selectedCrypto];
    
    // Simple strategy simulation based on price changes
    const shouldTrade = Math.random() < 0.3; // 30% chance to trade
    
    if (!shouldTrade) {
      return { shouldTrade: false };
    }

    const action = market.change > 2 ? 'sell' : market.change < -2 ? 'buy' : Math.random() > 0.5 ? 'buy' : 'sell';
    const amount = selectedCrypto === 'BTC' ? 0.001 + Math.random() * 0.002 :
                  selectedCrypto === 'ETH' ? 0.01 + Math.random() * 0.02 :
                  10 + Math.random() * 20; // XRP

    return {
      shouldTrade: true,
      action,
      cryptocurrency: selectedCrypto,
      amount: parseFloat(amount.toFixed(selectedCrypto === 'XRP' ? 0 : 4)),
      reason: `Market ${action} signal detected`
    };
  };

  const recordTrade = async (tradeData: any) => {
    try {
      const { error } = await supabase
        .from('trading_history')
        .insert({
          ...tradeData,
          user_id: user?.id,
          trade_environment: 'test',
          is_sandbox: true,
          notes: 'Automated test trade'
        });

      if (error) throw error;

      // Also record in mock_trades for performance tracking
      await supabase
        .from('mock_trades')
        .insert({
          ...tradeData,
          user_id: user?.id,
          is_test_mode: true,
          profit_loss: 0 // Will be calculated later
        });

    } catch (error) {
      console.error('Error recording trade:', error);
    }
  };

  useEffect(() => {
    if (testMode && user) {
      // Start automated trading every 30 seconds
      tradingIntervalRef.current = setInterval(executeTestTrade, 30000);
      
      // Execute first trade immediately
      setTimeout(executeTestTrade, 2000);
    } else {
      // Stop automated trading
      if (tradingIntervalRef.current) {
        clearInterval(tradingIntervalRef.current);
        tradingIntervalRef.current = null;
      }
    }

    return () => {
      if (tradingIntervalRef.current) {
        clearInterval(tradingIntervalRef.current);
      }
    };
  }, [testMode, user]);

  return { executeTestTrade };
};