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
  const [realPrices, setRealPrices] = useState<{ [key: string]: number }>({
    BTC: 60000,
    ETH: 3000,
    XRP: 0.6,
    EUR: 1,
  });

  useEffect(() => {
    if (!testMode) return;

    const updatePrices = () => {
      const next: { [key: string]: number } = { EUR: 1 };
      ['BTC-EUR', 'ETH-EUR', 'XRP-EUR'].forEach(symbol => {
        const cached = sharedPriceCache.get(symbol);
        if (cached) next[symbol.split('-')[0]] = cached.price;
      });
      setRealPrices(prev => ({ ...prev, ...next }));
    };

    updatePrices();
    const i = setInterval(updatePrices, 5000);
    return () => clearInterval(i);
  }, [testMode]);

  const refreshFromDatabase = async () => {
    if (!testMode || !user) return;

    setIsLoading(true);
    try {
      const { data: metrics, error: metricsError } = await supabase.rpc(
        'get_portfolio_metrics' as any,
        {
          p_user_id: user.id,
          p_is_test_mode: true, // ✅ FIX
        }
      );

      if (metricsError) {
        console.error('[refreshFromDatabase] get_portfolio_metrics error:', metricsError);
      }

      const eur = metrics?.success === true ? metrics.cash_balance_eur : 0;

      const { data: trades, error: tradesError } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_test_mode', true)
        .order('executed_at', { ascending: true });

      if (tradesError) {
        console.error('[refreshFromDatabase] trades error:', tradesError);
      }

      const crypto: Record<string, number> = {};

      trades?.forEach(t => {
        const c = t.cryptocurrency.toUpperCase().replace('-EUR', '');
        if (c === 'EUR') return;
        const a = Number(t.amount);
        crypto[c] = (crypto[c] || 0) + (t.trade_type === 'buy' ? a : -a);
      });

      const next: WalletBalance[] = [{ currency: 'EUR', amount: eur, value_in_base: eur }];

      Object.entries(crypto)
        .filter(([, a]) => a > 0)
        .forEach(([c, a]) => {
          next.push({ currency: c, amount: a, value_in_base: a * (realPrices[c] || 0) });
        });

      setBalances(next);
      localStorage.setItem(`mock-wallet-${user.id}`, JSON.stringify(next));
    } finally {
      setIsLoading(false);
    }
  };

  const resetPortfolio = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      await supabase.rpc('reset_portfolio_capital' as any, { p_user_id: user.id });

      const { data: metrics, error: metricsError } = await supabase.rpc(
        'get_portfolio_metrics' as any,
        {
          p_user_id: user.id,
          p_is_test_mode: true, // ✅ FIX
        }
      );

      if (metricsError) {
        console.error('[resetPortfolio] get_portfolio_metrics error:', metricsError);
      }

      const eur = metrics?.success === true ? metrics.cash_balance_eur : 0;
      const wallet = [{ currency: 'EUR', amount: eur, value_in_base: eur }];
      setBalances(wallet);
      localStorage.setItem(`mock-wallet-${user.id}`, JSON.stringify(wallet));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <MockWalletContext.Provider
      value={{
        balances,
        initializeWallet: refreshFromDatabase,
        updateBalance: () => {},
        getBalance: c => balances.find(b => b.currency === c)?.amount || 0,
        getTotalValue: () => balances.reduce((s, b) => s + b.value_in_base, 0),
        refreshFromDatabase,
        forceReset: () => resetPortfolio(),
        resetPortfolio,
        isLoading,
      }}
    >
      {children}
    </MockWalletContext.Provider>
  );
};

export const useMockWallet = () => {
  const ctx = useContext(MockWalletContext);
  if (!ctx) throw new Error('useMockWallet must be used within MockWalletProvider');
  return ctx;
};
