import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useTestMode } from './useTestMode';
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
      const { data: trades, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_test_mode', true)
        .order('executed_at', { ascending: true });

      if (error) {
        return;
      }

      const calculatedBalances: { [key: string]: number } = {
        EUR: 30000,
        BTC: 0,
        ETH: 0,
        XRP: 0
      };

      trades?.forEach(trade => {
        const currency = trade.cryptocurrency.toUpperCase();
        const amount = parseFloat(trade.amount.toString());
        const totalValue = parseFloat(trade.total_value.toString());

        if (trade.trade_type === 'buy') {
          calculatedBalances.EUR = Math.max(0, calculatedBalances.EUR - totalValue);
          calculatedBalances[currency] = (calculatedBalances[currency] || 0) + amount;
        } else if (trade.trade_type === 'sell') {
          calculatedBalances.EUR += totalValue;
          calculatedBalances[currency] = Math.max(0, (calculatedBalances[currency] || 0) - amount);
        }
      });

      const walletBalances: WalletBalance[] = Object.entries(calculatedBalances)
        .filter(([currency, amount]) => {
          if (currency === 'EUR') return true;
          return amount > 0.001;
        })
        .map(([currency, amount]) => {
          const valueInBase = currency === 'EUR' ? amount : amount * (realPrices[currency] || 0);
          return {
            currency,
            amount: Math.max(0, amount),
            value_in_base: valueInBase
          };
        });

      setBalances(walletBalances);
      localStorage.setItem(`mock-wallet-${user.id}`, JSON.stringify(walletBalances));
      
    } catch {
      // Silently handle errors
    } finally {
      setIsLoading(false);
    }
  };

  const initializeWallet = () => {
    if (!testMode || !user) return;

    const initialBalances: WalletBalance[] = [
      { currency: 'EUR', amount: 5000, value_in_base: 5000 },
      { currency: 'BTC', amount: 0.02, value_in_base: 1000 },
      { currency: 'ETH', amount: 0.3, value_in_base: 1000 },
      { currency: 'XRP', amount: 1500, value_in_base: 1000 }
    ];

    setBalances(initialBalances);
    localStorage.setItem(`mock-wallet-${user.id}`, JSON.stringify(initialBalances));
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

  const forceReset = () => {
    if (!user) return;
    localStorage.removeItem(`mock-wallet-${user.id}`);
    setBalances([{
      currency: 'EUR',
      amount: 30000,
      value_in_base: 30000
    }]);
    refreshFromDatabase();
  };

  const resetPortfolio = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const { error } = await supabase.rpc('reset_user_test_portfolio', {
        target_balance: 30000
      });

      if (error) {
        throw error;
      }
      
      localStorage.removeItem(`mock-wallet-${user.id}`);
      
      setBalances([{
        currency: 'EUR',
        amount: 30000,
        value_in_base: 30000
      }]);
      
      localStorage.setItem(`mock-wallet-${user.id}`, JSON.stringify([{
        currency: 'EUR',
        amount: 30000,
        value_in_base: 30000
      }]));
      
    } catch (error) {
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
        forceReset();
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