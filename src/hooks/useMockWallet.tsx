import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useTestMode } from './useTradeViewFilter';
import { useAuth } from './useAuth';
import { supabase } from '@/integrations/supabase/client';
import { sharedPriceCache } from '@/utils/SharedPriceCache';

interface WalletBalance {
  currency: string;
  amount: number;
  value_in_base: number;
}

interface MockWalletContextType {
  balances: WalletBalance[];
  initializeWallet: () => void;
  updateBalance: (currency: string, amount: number) => void;
  getBalance: (currency: string) => number;
  getTotalValue: () => number;
  refreshFromDatabase: () => Promise<void>;
  forceReset: () => void;
  resetPortfolio: () => Promise<void>;
  isLoading: boolean;
}

const MockWalletContext = createContext<MockWalletContextType | undefined>(undefined);

export const MockWalletProvider = ({ children }: { children: ReactNode }) => {
  const { testMode } = useTestMode();
  const { user } = useAuth();
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [realPrices, setRealPrices] = useState<{[key: string]: number}>({
    BTC: 60000,
    ETH: 3000, 
    XRP: 0.6,
    EUR: 1
  });

  useEffect(() => {
    const updatePrices = () => {
      if (!testMode) return;
      
      const newPrices: {[key: string]: number} = { EUR: 1 };
      
      const symbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR'];
      for (const symbol of symbols) {
        const cached = sharedPriceCache.get(symbol);
        if (cached) {
          const baseSymbol = symbol.split('-')[0];
          newPrices[baseSymbol] = cached.price;
        }
      }
      
      setRealPrices(prev => ({ ...prev, ...newPrices }));
    };

    if (testMode) {
      updatePrices();
      const interval = setInterval(updatePrices, 5000);
      return () => clearInterval(interval);
    }
  }, [testMode]);

  const refreshFromDatabase = async () => {
    if (!testMode || !user) return;
    
    localStorage.removeItem(`mock-wallet-${user.id}`);
    
    setIsLoading(true);
    try {
      // Fetch EUR balance from portfolio_capital via get_portfolio_metrics
      // NO fallback - if RPC fails or returns !success, EUR = 0 (not initialized)
      let eurBalance = 0;
      
      const { data: metrics, error: metricsError } = await supabase.rpc('get_portfolio_metrics' as any, {
        p_user_id: user.id,
        p_is_test_mode: testMode,
      });
      
      console.log('[refreshFromDatabase] metrics:', metrics, 'error:', metricsError);
      
      if (!metricsError && metrics?.success === true && metrics?.cash_balance_eur !== undefined) {
        eurBalance = metrics.cash_balance_eur;
      }
      
      // Fetch trades to compute crypto balances only
      const { data: trades, error: tradesError } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_test_mode', true)
        .order('executed_at', { ascending: true });

      console.log('[refreshFromDatabase] trades_count:', trades?.length ?? 0, 'error:', tradesError);

      // Calculate crypto balances from trades (EUR comes from portfolio_capital)
      const cryptoBalances: { [key: string]: number } = {
        BTC: 0,
        ETH: 0,
        XRP: 0,
        SOL: 0,
        ADA: 0,
        AVAX: 0,
        DOT: 0
      };

      trades?.forEach(trade => {
        const currency = trade.cryptocurrency.toUpperCase().replace('-EUR', '');
        if (currency === 'EUR') return; // Skip EUR, it's from portfolio_capital
        
        const amount = parseFloat(trade.amount.toString());

        if (trade.trade_type === 'buy') {
          cryptoBalances[currency] = (cryptoBalances[currency] || 0) + amount;
        } else if (trade.trade_type === 'sell') {
          cryptoBalances[currency] = Math.max(0, (cryptoBalances[currency] || 0) - amount);
        }
      });

      // Build wallet balances: EUR from metrics, crypto from trades
      const walletBalances: WalletBalance[] = [
        { currency: 'EUR', amount: eurBalance, value_in_base: eurBalance }
      ];
      
      // Add crypto balances with non-zero amounts
      Object.entries(cryptoBalances)
        .filter(([, amount]) => amount > 0.00001)
        .forEach(([currency, amount]) => {
          const valueInBase = amount * (realPrices[currency] || 0);
          walletBalances.push({
            currency,
            amount: Math.max(0, amount),
            value_in_base: valueInBase
          });
        });

      console.log('[refreshFromDatabase] final balances:', walletBalances);

      setBalances(walletBalances);
      localStorage.setItem(`mock-wallet-${user.id}`, JSON.stringify(walletBalances));
      
    } catch (err) {
      console.error('[refreshFromDatabase] Error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // initializeWallet: In test mode, just refresh from database (no hardcoded EUR)
  const initializeWallet = () => {
    if (!testMode || !user) return;
    // Simply trigger a refresh - EUR comes from portfolio_capital, crypto from trades
    refreshFromDatabase();
  };

  const updateBalance = (currency: string, amount: number) => {
    setBalances(prev => {
      const updated = prev.map(balance => 
        balance.currency === currency 
          ? { ...balance, amount: Math.max(0, balance.amount + amount) }
          : balance
      );
      
      if (user) {
        localStorage.setItem(`mock-wallet-${user.id}`, JSON.stringify(updated));
      }
      
      return updated;
    });
  };

  const getBalance = (currency: string): number => {
    const balance = balances.find(b => b.currency === currency);
    return balance?.amount || 0;
  };

  // forceReset: Now calls resetPortfolio instead of local-only reset
  const forceReset = () => {
    if (!user) return;
    // Call the async resetPortfolio - fire and forget with error handling
    resetPortfolio().catch(err => {
      console.error('[forceReset] resetPortfolio failed:', err);
    });
  };

  const resetPortfolio = async () => {
    setIsLoading(true);
    try {
      // Fetch authenticated user
      const { data: { user: authUser }, error: userError } = await supabase.auth.getUser();
      
      if (userError || !authUser?.id) {
        console.error('[resetPortfolio] Failed to get authenticated user:', userError);
        throw new Error('Failed to get authenticated user');
      }
      
      console.log('[resetPortfolio] Authenticated user.id:', authUser.id);
      
      // Call reset_portfolio_capital RPC
      const { data: resetData, error: resetError } = await supabase.rpc('reset_portfolio_capital' as any, {
        p_user_id: authUser.id,
        p_is_test_mode: true,
      });
      
      console.log('[resetPortfolio] reset_portfolio_capital result:', { resetData, resetError });
      
      if (resetError) {
        throw resetError;
      }
      
      // Immediately refresh metrics
      const { data: metrics, error: metricsError } = await supabase.rpc('get_portfolio_metrics' as any, {
        p_user_id: authUser.id,
        p_is_test_mode: true,
      });
      
      console.log('[resetPortfolio] get_portfolio_metrics result:', { metrics, metricsError });
      
      if (metricsError) {
        console.error('[resetPortfolio] Failed to fetch metrics:', metricsError);
      }
      
      // Clear local storage
      localStorage.removeItem(`mock-wallet-${authUser.id}`);
      
      // Get cash balance from RPC - NO fallback
      const cashBalance = (metrics?.success === true && metrics?.cash_balance_eur !== undefined) 
        ? metrics.cash_balance_eur 
        : 0;
      
      // After reset, only EUR balance (no crypto positions)
      setBalances([{
        currency: 'EUR',
        amount: cashBalance,
        value_in_base: cashBalance
      }]);
      
      localStorage.setItem(`mock-wallet-${authUser.id}`, JSON.stringify([{
        currency: 'EUR',
        amount: cashBalance,
        value_in_base: cashBalance
      }]));
      
    } catch (error) {
      console.error('[resetPortfolio] Error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const getTotalValue = (): number => {
    return balances.reduce((sum, balance) => sum + balance.value_in_base, 0);
  };

  useEffect(() => {
    if (testMode && user) {
      refreshFromDatabase();
      
      const channel = supabase
        .channel('mock-trades-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'mock_trades',
            filter: `user_id=eq.${user.id}`
          },
          () => {
            setTimeout(() => {
              refreshFromDatabase();
            }, 1000);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      setBalances([]);
    }
  }, [testMode, user]);

  useEffect(() => {
    if (testMode && user) {
      const stored = localStorage.getItem(`mock-wallet-${user.id}`);
      if (!stored) {
        // No local storage - refresh from DB (which uses portfolio_capital)
        refreshFromDatabase();
      }
    }
  }, [user]);

  return (
    <MockWalletContext.Provider value={{ 
      balances, 
      initializeWallet, 
      updateBalance, 
      getBalance, 
      getTotalValue,
      refreshFromDatabase,
      forceReset,
      resetPortfolio,
      isLoading
    }}>
      {children}
    </MockWalletContext.Provider>
  );
};

export const useMockWallet = () => {
  const context = useContext(MockWalletContext);
  if (context === undefined) {
    throw new Error('useMockWallet must be used within a MockWalletProvider');
  }
  return context;
};
