import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useTestMode } from './useTestMode';
import { useAuth } from './useAuth';
import { supabase } from '@/integrations/supabase/client';

interface WalletBalance {
  currency: string;
  amount: number;
  value_in_base: number; // EUR value
}

interface MockWalletContextType {
  balances: WalletBalance[];
  initializeWallet: () => void;
  updateBalance: (currency: string, amount: number) => void;
  getBalance: (currency: string) => number;
  getTotalValue: () => number;
  refreshFromDatabase: () => Promise<void>;
  isLoading: boolean;
}

const MockWalletContext = createContext<MockWalletContextType | undefined>(undefined);

export const MockWalletProvider = ({ children }: { children: ReactNode }) => {
  const { testMode } = useTestMode();
  const { user } = useAuth();
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Current market prices (mock values)
  const mockPrices = {
    BTC: 60000,
    ETH: 3000, 
    XRP: 2.5,
    EUR: 1
  };

  const refreshFromDatabase = async () => {
    if (!testMode || !user) return;
    
    setIsLoading(true);
    try {
      // Get all mock trades for this user
      const { data: trades, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_test_mode', true);

      if (error) {
        console.error('Error fetching mock trades:', error);
        return;
      }

      // Calculate balances from trades
      const calculatedBalances: { [key: string]: number } = {
        EUR: 5000, // Starting amount
        BTC: 0.02,  // Starting amount  
        ETH: 0.3,   // Starting amount
        XRP: 1500   // Starting amount
      };

      // Process each trade to update balances
      trades?.forEach(trade => {
        const currency = trade.cryptocurrency.toUpperCase();
        const amount = parseFloat(trade.amount.toString());
        const totalValue = parseFloat(trade.total_value.toString());
        const fees = parseFloat(trade.fees?.toString() || '0');

        if (trade.trade_type === 'buy') {
          // Buying crypto: reduce EUR, increase crypto
          calculatedBalances.EUR -= (totalValue + fees);
          calculatedBalances[currency] = (calculatedBalances[currency] || 0) + amount;
        } else if (trade.trade_type === 'sell') {
          // Selling crypto: increase EUR, decrease crypto  
          calculatedBalances.EUR += (totalValue - fees);
          calculatedBalances[currency] = Math.max(0, (calculatedBalances[currency] || 0) - amount);
        }
      });

      // Convert to WalletBalance format with current market values
      const walletBalances: WalletBalance[] = Object.entries(calculatedBalances)
        .filter(([currency, amount]) => amount > 0 || currency === 'EUR')
        .map(([currency, amount]) => ({
          currency,
          amount: Math.max(0, amount),
          value_in_base: currency === 'EUR' ? amount : amount * (mockPrices[currency as keyof typeof mockPrices] || 1)
        }));

      setBalances(walletBalances);
      
      // Also save to localStorage for backup
      localStorage.setItem(`mock-wallet-${user.id}`, JSON.stringify(walletBalances));
      
    } catch (error) {
      console.error('Error refreshing wallet from database:', error);
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

  const getTotalValue = (): number => {
    return balances.reduce((total, balance) => total + balance.value_in_base, 0);
  };

  useEffect(() => {
    if (testMode && user) {
      // Always refresh from database to get latest trades
      refreshFromDatabase();
      
      // Set up real-time subscription to mock_trades table
      const channel = supabase
        .channel('mock-trades-changes')
        .on(
          'postgres_changes',
          {
            event: '*', // Listen to all changes (INSERT, UPDATE, DELETE)
            schema: 'public',
            table: 'mock_trades',
            filter: `user_id=eq.${user.id}`
          },
          () => {
            console.log('Mock trades changed, refreshing wallet...');
            refreshFromDatabase();
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

  return (
    <MockWalletContext.Provider value={{ 
      balances, 
      initializeWallet, 
      updateBalance, 
      getBalance, 
      getTotalValue,
      refreshFromDatabase,
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