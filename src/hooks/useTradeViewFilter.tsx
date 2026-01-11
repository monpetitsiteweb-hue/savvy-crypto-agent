import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

/**
 * Trade View Filter Hook
 * 
 * This is a UI-ONLY filter for viewing Test vs Live trades.
 * It has ZERO impact on backend execution logic.
 * 
 * Backend execution mode is driven EXCLUSIVELY by:
 *   trading_strategies.execution_target ('MOCK' | 'REAL')
 */
interface TradeViewFilterContextType {
  /** True = show test trades, False = show live trades (UI filter only) */
  showTestTrades: boolean;
  setShowTestTrades: (enabled: boolean) => void;
  toggleViewFilter: () => void;
  /** @deprecated Use showTestTrades instead */
  testMode: boolean;
  /** @deprecated Use setShowTestTrades instead */
  setTestMode: (enabled: boolean) => void;
  /** @deprecated Use toggleViewFilter instead */
  toggleTestMode: () => void;
}

const TradeViewFilterContext = createContext<TradeViewFilterContextType | undefined>(undefined);

export const TestModeProvider = ({ children }: { children: ReactNode }) => {
  const [showTestTrades, setShowTestTradesState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('global-test-mode');
      return saved ? JSON.parse(saved) : true; // Default to showing test trades
    } catch (error) {
      return true;
    }
  });

  const setShowTestTrades = (enabled: boolean) => {
    setShowTestTradesState(enabled);
    localStorage.setItem('global-test-mode', JSON.stringify(enabled));
  };

  const toggleViewFilter = () => {
    const newMode = !showTestTrades;
    setShowTestTrades(newMode);
    return newMode;
  };

  useEffect(() => {
    localStorage.setItem('global-test-mode', JSON.stringify(showTestTrades));
  }, [showTestTrades]);

  return (
    <TradeViewFilterContext.Provider value={{ 
      showTestTrades, 
      setShowTestTrades, 
      toggleViewFilter,
      // Backward compatibility aliases
      testMode: showTestTrades,
      setTestMode: setShowTestTrades,
      toggleTestMode: toggleViewFilter
    }}>
      {children}
    </TradeViewFilterContext.Provider>
  );
};

/** @deprecated Use useTradeViewFilter instead */
export const useTestMode = () => {
  const context = useContext(TradeViewFilterContext);
  if (context === undefined) {
    throw new Error('useTestMode must be used within a TestModeProvider');
  }
  return context;
};

export const useTradeViewFilter = useTestMode;