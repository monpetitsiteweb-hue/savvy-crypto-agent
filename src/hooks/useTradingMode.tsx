/**
 * TradingMode Hook - Single Entry Point for Mode Resolution
 * 
 * This hook provides a unified trading mode that determines which data source to use:
 * - TEST: Uses mock_trades (simulated trading)
 * - REAL: Uses real_trade_history_view / real_positions_view (on-chain truth)
 * 
 * IMPORTANT: This is a UI-ONLY concept. Backend execution mode is driven by
 * trading_strategies.execution_target ('MOCK' | 'REAL'), NOT this hook.
 */
import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { TradingMode } from '@/types/trading';

interface TradingModeContextType {
  /** Current trading mode: 'TEST' or 'REAL' */
  mode: TradingMode;
  /** Set the trading mode */
  setMode: (mode: TradingMode) => void;
  /** Toggle between TEST and REAL */
  toggleMode: () => void;
  /** Whether currently in TEST mode (convenience) */
  isTestMode: boolean;
  /** Whether currently in REAL mode (convenience) */
  isRealMode: boolean;
}

const TradingModeContext = createContext<TradingModeContextType | undefined>(undefined);

const STORAGE_KEY = 'trading-mode';

export function TradingModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<TradingMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'REAL' || saved === 'TEST') {
        return saved;
      }
      // Migration: check old global-test-mode key
      const oldKey = localStorage.getItem('global-test-mode');
      if (oldKey !== null) {
        const wasTestMode = JSON.parse(oldKey);
        return wasTestMode ? 'TEST' : 'REAL';
      }
      return 'TEST'; // Default to TEST mode
    } catch {
      return 'TEST';
    }
  });

  const setMode = useCallback((newMode: TradingMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
    // Keep old key in sync for backward compatibility
    localStorage.setItem('global-test-mode', JSON.stringify(newMode === 'TEST'));
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'TEST' ? 'REAL' : 'TEST');
  }, [mode, setMode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  return (
    <TradingModeContext.Provider
      value={{
        mode,
        setMode,
        toggleMode,
        isTestMode: mode === 'TEST',
        isRealMode: mode === 'REAL',
      }}
    >
      {children}
    </TradingModeContext.Provider>
  );
}

export function useTradingMode(): TradingModeContextType {
  const context = useContext(TradingModeContext);
  if (context === undefined) {
    throw new Error('useTradingMode must be used within a TradingModeProvider');
  }
  return context;
}
