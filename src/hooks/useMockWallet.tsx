import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useTestMode } from './useTestMode';
import { useAuth } from './useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useRealTimeMarketData } from './useRealTimeMarketData';

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
  const { marketData, getCurrentData } = useRealTimeMarketData();
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [realPrices, setRealPrices] = useState<{[key: string]: number}>({
    BTC: 60000,
    ETH: 3000, 
    XRP: 0.6,
    EUR: 1
  });

  // Fetch real market prices on mount and when marketData updates
  useEffect(() => {
    const updatePrices = async () => {
      try {
        // Get current market data
        const data = await getCurrentData(['BTC-USD', 'ETH-USD', 'XRP-USD']);
        
        const newPrices: {[key: string]: number} = { EUR: 1 };
        
        // Convert USD prices to EUR (assuming 1 USD = 0.85 EUR for now)
        const usdToEur = 0.85;
        
        if (data['BTC-USD']?.price) {
          newPrices.BTC = data['BTC-USD'].price * usdToEur;
        }
        if (data['ETH-USD']?.price) {
          newPrices.ETH = data['ETH-USD'].price * usdToEur;
        }
        if (data['XRP-USD']?.price) {
          newPrices.XRP = data['XRP-USD'].price * usdToEur;
        }
        
        console.log('📈 Updated real market prices:', newPrices);
        setRealPrices(prev => ({ ...prev, ...newPrices }));
      } catch (error) {
        console.error('Error fetching real prices:', error);
      }
    };

    if (testMode) {
      updatePrices();
    }
  }, [testMode, marketData, getCurrentData]);

  const refreshFromDatabase = async () => {
    if (!testMode || !user) return;
    
    setIsLoading(true);
    try {
      console.log('🔄 Refreshing wallet from database for user:', user.id);
      
      // Get all mock trades for this user
      const { data: trades, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_test_mode', true)
        .order('executed_at', { ascending: true });

      if (error) {
        console.error('Error fetching mock trades:', error);
        return;
      }

      console.log('📊 Found trades:', trades?.length || 0, trades);

      // Calculate balances from trades
      const calculatedBalances: { [key: string]: number } = {
        EUR: 100000, // Starting amount (realistic for testing)
        BTC: 0,      // Start with 0 crypto
        ETH: 0,      // Start with 0 crypto
        XRP: 0       // Start with 0 crypto
      };

      console.log('💰 Starting balances:', calculatedBalances);

      // Process each trade to update balances
      trades?.forEach(trade => {
        const currency = trade.cryptocurrency.toUpperCase();
        const amount = parseFloat(trade.amount.toString());
        const totalValue = parseFloat(trade.total_value.toString());
        const fees = parseFloat(trade.fees?.toString() || '0');

        console.log('🔄 Processing trade:', {
          id: trade.id,
          currency,
          trade_type: trade.trade_type,
          amount,
          totalValue,
          fees,
          executed_at: trade.executed_at,
          currentEUR: calculatedBalances.EUR,
          currentCrypto: calculatedBalances[currency]
        });

        if (trade.trade_type === 'buy') {
          // Buying crypto: reduce EUR, increase crypto
          // For BTC: if buying 2000 EUR worth, we spend 2000 EUR and get BTC amount
          calculatedBalances.EUR = Math.max(0, calculatedBalances.EUR - totalValue);
          calculatedBalances[currency] = (calculatedBalances[currency] || 0) + amount;
        } else if (trade.trade_type === 'sell') {
          // Selling crypto: increase EUR, decrease crypto  
          calculatedBalances.EUR += totalValue;
          calculatedBalances[currency] = Math.max(0, (calculatedBalances[currency] || 0) - amount);
        }

        console.log('✅ After trade processing:', {
          newEUR: calculatedBalances.EUR,
          newCrypto: calculatedBalances[currency]
        });
      });

      console.log('🏁 Final calculated balances:', calculatedBalances);

      // Convert to WalletBalance format with current market values
      const walletBalances: WalletBalance[] = Object.entries(calculatedBalances)
        .filter(([currency, amount]) => amount > 0 || currency === 'EUR')
        .map(([currency, amount]) => {
          // For EUR, value_in_base is just the amount
          // For crypto, multiply by real-time market price
          const valueInBase = currency === 'EUR' ? amount : amount * (realPrices[currency] || 0);
          return {
            currency,
            amount: Math.max(0, amount),
            value_in_base: valueInBase
          };
        });

      console.log('💼 Final wallet balances:', walletBalances);
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
    const total = balances.reduce((sum, balance) => sum + balance.value_in_base, 0);
    console.log('💰 Portfolio total value calculation:', { balances, total });
    return total;
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