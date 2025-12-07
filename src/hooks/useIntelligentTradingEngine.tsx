import { useEffect, useRef } from 'react';
import { useTestMode } from './useTestMode';
import { useAuth } from './useAuth';
import { useMockWallet } from './useMockWallet';
import { supabase } from '@/integrations/supabase/client';
import { fromTable } from '@/utils/supa';
import { StrategyData, normalizeStrategy } from '@/types/strategy';
import { Toast } from '@/ui/ToastService';
import { useRealTimeMarketData } from './useRealTimeMarketData';
import { usePoolExitManager } from './usePoolExitManager';
import { DEFAULT_VALUES } from '@/utils/configDefaults';
import { engineLog } from '@/utils/silentLogger';
import { logger } from '@/utils/logger';
import { getAllSymbols } from '@/data/coinbaseCoins';
import { checkMarketAvailability, filterSupportedSymbols } from '@/utils/marketAvailability';
import { sharedPriceCache } from '@/utils/SharedPriceCache';
import { getFeaturesForEngine } from '@/lib/api/features';
// PHASE 1-4 REFACTOR: Exposure-based risk management
import { calculateExposure, canBuySymbol, findBestSymbolForTrade } from '@/utils/exposureCalculator';
import { isSymbolInCooldown, recordTradeForCooldown, getCooldownMs } from '@/utils/symbolCooldown';
// Debug utilities - registers global functions for console access
import '@/utils/signalSeeder';
import { logEngineCycle, createSymbolDecision, CycleLog, SymbolDecisionLog } from '@/utils/engineDebugLogger';

// Global debug object declaration
declare global {
  interface Window {
    __INTELLIGENT?: {
      checkStrategiesAndExecute?: () => Promise<void>;
    };
    __INTELLIGENT_DEBUG?: {
      stage: string;
      timestamp: string;
      details?: any;
    };
    __INTELLIGENT_DEBUG_HISTORY?: Array<{
      stage: string;
      timestamp: string;
      details?: any;
    }>;
    __INTELLIGENT_FORCE_DEBUG_TRADE?: boolean;
    __INTELLIGENT_SUPPRESS_LOGS?: boolean;
    __INTELLIGENT_DISABLE_AUTORUN?: boolean;
    __INTELLIGENT_FORCE_NORMAL_INTENT?: boolean; // TEST-ONLY: force normal intelligent intent
    __INTELLIGENT_DEBUG_LAST_INTENT?: any; // TEST-ONLY: last emitted intent for inspection
  }
}

// Check if engine logs should be suppressed
const isLogSuppressed = () => {
  if (typeof window === "undefined") return false;
  return (window as any).__INTELLIGENT_SUPPRESS_LOGS === true;
};

// ============= PHASE D: FRONTEND ENGINE BUY DISABLED =============
// The frontend intelligent engine is NO LONGER allowed to generate automatic BUYs.
// Only the backend engine (backend-shadow-engine) can create BUY orders.
// 
// Frontend is still allowed to:
//   - Process manual SELLs (via UI)
//   - Process manual BUYs (user explicitly clicks BUY in UI)
//   - TP/SL pool exit manager SELLs (via usePoolExitManager)
// 
// This flag is ALWAYS TRUE in production. It cannot be disabled.
// =================================================================
const FRONTEND_ENGINE_DISABLED = true;

// ============= FRONTEND ENGINE KILL-SWITCH =============
// PHASE A (Cutover Prep): This flag allows disabling the 60s frontend intelligent
// engine loop WITHOUT affecting manual SELLs or other UI-triggered actions.
// 
// Usage: Set window.__INTELLIGENT_DISABLE_AUTORUN = true in browser console
// 
// When enabled:
//   - The 60s recurring loop is NOT started
//   - Manual SELLs via UI still work (they go directly to coordinator)
//   - The app loads normally, no crashes
// 
// This is a temporary kill-switch for the frontend engine during backend cutover.
// Once backend LIVE mode is fully validated, this flag will be used to disable
// frontend automation for users migrated to backend engine.
// =============================================================================
const isAutorunDisabled = () => {
  if (typeof window === "undefined") return false;
  return (window as any).__INTELLIGENT_DISABLE_AUTORUN === true;
};

// Suppressible console log for engine - ENABLED for debugging
const engineConsoleLog = (...args: any[]) => {
  if (isLogSuppressed()) return;
  console.log('[IntelligentEngine]', ...args);
};

// Helper to write debug stage and push to history
const writeDebugStage = (stage: string, details?: any) => {
  if (typeof window !== 'undefined') {
    const entry = {
      stage,
      timestamp: new Date().toISOString(),
      details: details ?? null,
    };
    window.__INTELLIGENT_DEBUG = entry;
    if (!window.__INTELLIGENT_DEBUG_HISTORY) {
      window.__INTELLIGENT_DEBUG_HISTORY = [];
    }
    window.__INTELLIGENT_DEBUG_HISTORY.push(entry);
  }
};

// Initialize debug object at module load
if (typeof window !== 'undefined') {
  if (!window.__INTELLIGENT_DEBUG) {
    window.__INTELLIGENT_DEBUG = {
      stage: 'init',
      timestamp: new Date().toISOString(),
      details: null,
    };
  }
  if (!window.__INTELLIGENT_DEBUG_HISTORY) {
    window.__INTELLIGENT_DEBUG_HISTORY = [];
  }
}

interface Position {
  cryptocurrency: string;
  total_amount: number;
  total_value: number;
  remaining_amount: number;
  average_price: number;
  oldest_purchase_date: string;
}

interface TradingState {
  dailyTrades: number;
  dailyPnL: number;
  lastTradeTime: string;
  openPositions: Position[];
  dailyResetDate: string;
}

// Track if we've logged initialization (module-level to prevent re-logging on HMR)
let hasLoggedInit = false;

export const useIntelligentTradingEngine = () => {
  const { testMode } = useTestMode();
  const { user, loading } = useAuth();
  const { updateBalance, getBalance } = useMockWallet();
  const { marketData, getCurrentData } = useRealTimeMarketData();
  
  // Initialize pool exit manager
  const { processAllPools } = usePoolExitManager({ 
    isEnabled: true, 
    testMode 
  });
  
  // ============= LEGACY FRONTEND INTELLIGENT ENGINE =============
  // This 60s loop is the legacy frontend intelligent engine (browser-only).
  // It runs ONLY when the browser tab is open and active.
  // 
  // A backend engine is being introduced (backend-shadow-engine) that will
  // eventually replace this loop for 24/7 operation. During cutover, this
  // loop can be disabled via window.__INTELLIGENT_DISABLE_AUTORUN = true.
  // 
  // Manual SELLs and UI-triggered actions are NOT affected by this loop -
  // they go directly to the coordinator via separate code paths.
  // =================================================================
  // PERFORMANCE FIX: Increased from 30s to 60s to reduce DB load
  const MONITORING_INTERVAL_MS = 60000; // 1 minute
  
  // IMPORTANT: Declare refs BEFORE the useEffect that uses them
  const marketMonitorRef = useRef<NodeJS.Timeout | null>(null);
  const hasLoggedInitRef = useRef(false);
  const tradingStateRef = useRef<TradingState>({
    dailyTrades: 0,
    dailyPnL: 0,
    lastTradeTime: '',
    openPositions: [],
    dailyResetDate: new Date().toDateString()
  });
  
  // Log initialization ONLY ONCE per mount (not on every render)
  if (!hasLoggedInitRef.current && !hasLoggedInit) {
    hasLoggedInitRef.current = true;
    hasLoggedInit = true;
    engineConsoleLog('🧠 INTELLIGENT_ENGINE: Hook initialized', { testMode, user: !!user, loading });
  }

  useEffect(() => {
    // Check if autorun is disabled via kill switch
    if (isAutorunDisabled()) {
      engineConsoleLog('🛑 ENGINE: autorun disabled via __INTELLIGENT_DISABLE_AUTORUN');
      // Stop any existing interval
      if (marketMonitorRef.current) {
        clearInterval(marketMonitorRef.current);
        marketMonitorRef.current = null;
      }
      return;
    }

    // Silent log for auth state change
    if (!isLogSuppressed()) {
      (window as any).NotificationSink?.log({ 
        message: 'INTELLIGENT_ENGINE: Auth state changed', 
        data: { user: !!user, loading }
      });
    }
    
    // ========================================================================
    // UNIFIED ENGINE: Runs for any authenticated user
    // ========================================================================
    // The engine runs the SAME logic for test and prod. Strategy-level config
    // (e.g., selectedCoins, TP/SL thresholds, fusion settings) controls behavior,
    // NOT a global UI toggle.
    // ========================================================================
    if (!loading && user) {
      if (!isLogSuppressed()) {
        (window as any).NotificationSink?.log({
          message: 'INTELLIGENT_ENGINE: Starting unified engine loop',
          data: { user: !!user, loading, intervalMs: MONITORING_INTERVAL_MS }
        });
      }
      
      engineConsoleLog('🚀 INTELLIGENT ENGINE: Starting unified monitoring loop (interval:', MONITORING_INTERVAL_MS, 'ms)');
      
      // Initial run after short delay
      const initialTimer = setTimeout(() => {
        checkStrategiesAndExecute();
      }, 1000);
      
      // Set up recurring monitoring interval
      if (marketMonitorRef.current) {
        clearInterval(marketMonitorRef.current);
      }
      marketMonitorRef.current = setInterval(() => {
        engineConsoleLog('🔄 INTELLIGENT ENGINE: Recurring check triggered');
        checkStrategiesAndExecute();
      }, MONITORING_INTERVAL_MS);
      
      // Cleanup on unmount or dependency change
      return () => {
        clearTimeout(initialTimer);
        if (marketMonitorRef.current) {
          clearInterval(marketMonitorRef.current);
          marketMonitorRef.current = null;
          engineConsoleLog('🛑 INTELLIGENT ENGINE: Monitoring loop stopped');
        }
      };
    } else {
      // Stop monitoring if not authenticated
      if (marketMonitorRef.current) {
        clearInterval(marketMonitorRef.current);
        marketMonitorRef.current = null;
        engineConsoleLog('🛑 INTELLIGENT ENGINE: Monitoring loop stopped (not authenticated)');
      }
      if (!isLogSuppressed()) {
        (window as any).NotificationSink?.log({ 
          message: 'INTELLIGENT_ENGINE: Waiting for auth', 
          data: { loading, user: !!user }
        });
      }
    }
  }, [user, loading]); // REMOVED testMode dependency - engine runs for all authenticated users

  const checkStrategiesAndExecute = async () => {
    // DEBUG STAGE: start
    writeDebugStage('start', { testMode, userPresent: !!user, loading });
    
    // Explicit debug log for acceptance test
    engineConsoleLog('🧪 ENGINE: checkStrategiesAndExecute called', {
      testMode,
      user: !!user,
      loading,
    });
    
    // Silent log for engine state
    if (!isLogSuppressed()) {
      (window as any).NotificationSink?.log({
        message: 'ENGINE: checkStrategiesAndExecute called',
        data: { testMode, user: !!user, loading }
      });
    }
    
    if (!user || loading) {
      // DEBUG STAGE: early_exit_user_or_loading
      writeDebugStage('early_exit_user_or_loading', { userPresent: !!user, loading });
      engineLog('ENGINE: Skipping - user: ' + !!user + ' loading: ' + loading);
      return;
    }
    
    // ========================================================================
    // UNIFIED ENGINE: NO testMode check here - same path for test and prod
    // ========================================================================

    try {
      engineLog('INTELLIGENT_ENGINE: Starting comprehensive strategy check');
      
      // Fetch active strategies
      const { data: strategyRows, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true);

      // DEBUG STAGE: after_fetch_strategies
      writeDebugStage('after_fetch_strategies', {
        rowCount: strategyRows?.length ?? 0,
        hasError: !!error,
      });

      if (error || !strategyRows?.length) {
        engineLog('ENGINE: No active strategies found:', error);
        Toast.info(`INTELLIGENT ENGINE: No active strategies | error=${!!error}, count=${strategyRows?.length ?? 0}`);
        return;
      }

      // DEBUG LOGGING: Log raw strategy rows with ALL relevant fields (matching Debug Panel)
      engineLog(`ENGINE: fetched ${strategyRows.length} strategies from DB`);
      strategyRows.forEach((row) => {
        const rawRow = row as any;
        engineConsoleLog("ENGINE: raw strategy flags", {
          id: rawRow.id,
          strategy_name: rawRow.strategy_name,
          is_active: rawRow.is_active,
          test_mode: rawRow.test_mode,
          is_active_test: rawRow.is_active_test,
          is_active_live: rawRow.is_active_live,
          config_is_test_mode: rawRow.configuration?.is_test_mode,
          enableTestTrading: rawRow.configuration?.enableTestTrading,
        });
      });

      // Normalize strategies using the same normalizeStrategy() as Debug Panel
      const strategies: StrategyData[] = (strategyRows || []).map(normalizeStrategy);
      
      // ========================================================================
      // UNIFIED ENGINE: Evaluate ALL active strategies, not just "test" ones
      // ========================================================================
      // The strategy's execution_mode or is_test_mode can determine whether
      // trades go to mock_trades or real execution, but the engine logic is SAME.
      // ========================================================================
      engineConsoleLog("ENGINE: Evaluating", strategies.length, "active strategies");
      
      if (!strategies?.length) {
        writeDebugStage('early_exit_no_active_strategies', { count: 0 });
        engineLog('ENGINE: No active strategies found');
        return;
      }

      // FORCED DEBUG TRADE PATH (test-mode only)
      // Set window.__INTELLIGENT_FORCE_DEBUG_TRADE = true in console to trigger
      // This block is placed AFTER strategy fetch so we have a valid strategyId
      // 
      // PHASE D: Even forced debug trades are blocked when FRONTEND_ENGINE_DISABLED
      if (typeof window !== 'undefined' && window.__INTELLIGENT_FORCE_DEBUG_TRADE) {
        if (FRONTEND_ENGINE_DISABLED) {
          console.warn('[FRONTEND_BUY_BLOCKED] Frontend BUY disabled during backend cutover - forced debug BUY blocked');
          window.__INTELLIGENT_FORCE_DEBUG_TRADE = false;
          return;
        }
        const firstStrategy = strategies[0];
        const forcedSymbol = 'BTC-EUR';
        const forcedBaseSymbol = 'BTC';
        const forcedQty = 0.001;
        
        writeDebugStage('forced_debug_trade_entry', { 
          userId: user.id, 
          strategyId: firstStrategy.id,
          strategyName: firstStrategy.strategy_name 
        });

        try {
          // STEP 1: Get current price for BTC-EUR from shared cache or Coinbase
          let forcedPrice = 0;
          const cachedPrice = sharedPriceCache.get(forcedSymbol);
          if (cachedPrice?.price) {
            forcedPrice = cachedPrice.price;
            console.log('🧪 FORCED DEBUG TRADE: Using cached price:', forcedPrice);
          } else {
            // Fallback: fetch from Coinbase ticker
            try {
              const tickerResponse = await fetch(`https://api.exchange.coinbase.com/products/${forcedSymbol}/ticker`);
              const tickerData = await tickerResponse.json();
              if (tickerResponse.ok && tickerData.price) {
                forcedPrice = parseFloat(tickerData.price);
                console.log('🧪 FORCED DEBUG TRADE: Fetched live price:', forcedPrice);
              }
            } catch (priceErr) {
              console.error('🧪 FORCED DEBUG TRADE: Price fetch error:', priceErr);
            }
          }
          
          if (forcedPrice <= 0) {
            console.error('🧪 FORCED DEBUG TRADE: Could not get valid price, aborting');
            window.__INTELLIGENT_FORCE_DEBUG_TRADE = false;
            return;
          }
          
          // Log params that will be passed to the helper (no separate debugIntent needed)
          console.log('🧪 FORCED DEBUG TRADE: Calling runCoordinatorApprovedMockBuy with params:', {
            userId: user.id,
            strategyId: firstStrategy.id,
            symbol: forcedSymbol,
            baseSymbol: forcedBaseSymbol,
            qty: forcedQty,
            price: forcedPrice,
            reason: 'FORCED_DEBUG_TRADE',
            confidence: 0.99,
            strategyTrigger: 'FORCED_DEBUG_TRADE'
          });

          writeDebugStage('forced_debug_trade_before_helper', { 
            symbol: forcedSymbol, 
            strategyId: firstStrategy.id,
            qtySuggested: forcedQty,
            price: forcedPrice
          });

          // Use the helper for forced debug BUY - it will call coordinator and execute the trade
          const result = await runCoordinatorApprovedMockBuy({
            userId: user.id,
            strategyId: firstStrategy.id,
            symbol: forcedSymbol,
            baseSymbol: forcedBaseSymbol,
            qty: forcedQty,
            price: forcedPrice,
            reason: 'FORCED_DEBUG_TRADE',
            confidence: 0.99,
            strategyTrigger: 'FORCED_DEBUG_TRADE',
            extraMetadata: {
              debugTag: 'forced_debug_trade',
              forced_price: forcedPrice
            }
          });
          
          if (result.success) {
            writeDebugStage('forced_debug_trade_success', {
              tradeId: result.mockTradeId,
              symbol: forcedBaseSymbol,
              amount: forcedQty,
              price: forcedPrice,
              totalValue: forcedQty * forcedPrice
            });
            Toast.success(`🧪 Debug BUY executed: ${forcedQty} ${forcedBaseSymbol} @ €${forcedPrice.toFixed(2)}`);
          } else {
            writeDebugStage('forced_debug_trade_declined', {
              reason: result.reason,
              normalizedDecision: result.normalizedDecision
            });
          }
          
        } catch (err) {
          writeDebugStage('forced_debug_trade_error', { error: String(err) });
          console.error('🧪 FORCED DEBUG TRADE: Error:', err);
        }

        // Clear the flag after use
        window.__INTELLIGENT_FORCE_DEBUG_TRADE = false;
        return;
      }
      
      // DEBUG STAGE: before_process_strategies
      writeDebugStage('before_process_strategies', {
        strategiesCount: strategies.length,
        strategyIds: strategies.map(s => s.id),
      });
      
      engineConsoleLog(`INTELLIGENT ENGINE: Processing ${strategies.length} strategies...`);

      // Get market data from shared cache (no polling)
      const allCoins = new Set<string>();
      strategies.forEach(strategy => {
        const config = strategy.configuration as any;
        const selectedCoins = config?.selectedCoins || [];
        const coinsToUse = selectedCoins.length > 0 
          ? selectedCoins 
          : filterSupportedSymbols(getAllSymbols()).slice(0, 3); // Use filtered fallback
        coinsToUse.forEach((coin: string) => allCoins.add(`${coin}-EUR`));
      });
      
      const symbolsToFetch = Array.from(allCoins);
      
      // Read from shared cache instead of polling
      const currentMarketData: any = {};
      symbolsToFetch.forEach(symbol => {
        const cached = sharedPriceCache.get(symbol);
        if (cached) {
          currentMarketData[symbol] = {
            symbol,
            price: cached.price,
            bid: cached.bid,
            ask: cached.ask,
            timestamp: new Date(cached.timestamp).toISOString(),
            source: 'shared_cache'
          };
        }
      });
      
      // Fallback to context data if cache is empty
      const finalMarketData = Object.keys(currentMarketData).length > 0 
        ? currentMarketData 
        : (Object.keys(marketData).length > 0 ? marketData : await getCurrentData(symbolsToFetch));
      
      // Process each strategy with unified logic
      for (const strategy of strategies) {
        await processStrategyComprehensively(strategy, finalMarketData);
      }
    } catch (error) {
      console.error('❌ ENGINE: Error in comprehensive strategy check:', error);
    }
  };

  const processStrategyComprehensively = async (strategy: any, marketData: any) => {
    // Debug actions planned counter - shared reference so child functions can update it
    const debugActionsPlanned = { buy: 0, sell: 0, hold: 0 };
    
    // DEBUG STAGE: process_strategy_start
    writeDebugStage('process_strategy_start', {
      strategyId: strategy.id,
      strategyName: strategy.strategyName ?? strategy.configuration?.strategyName,
      marketDataSymbols: Object.keys(marketData),
    });
    
    try {
      const config = strategy.configuration;
      writeDebugStage('process_config_loaded', {
        strategyId: strategy.id,
        hasConfig: !!config,
        configKeys: config ? Object.keys(config) : [],
        selectedCoins: config?.selectedCoins || [],
        maxActiveCoins: config?.maxActiveCoins,
        maxTradesPerDay: config?.maxTradesPerDay,
      });

      // Reset daily counters if needed
      writeDebugStage('process_reset_daily_check', { before: true });
      resetDailyCountersIfNeeded();
      writeDebugStage('process_reset_daily_check', { after: true, dailyState: { ...tradingStateRef.current } });

      // 1. CHECK DAILY LIMITS FIRST
      writeDebugStage('process_daily_limits_check', { before: true });
      let dailyLimitsReached = isDailyLimitReached(config);
      writeDebugStage('process_daily_limits_check', { 
        after: true, 
        dailyLimitsReached,
        dailyTrades: tradingStateRef.current.dailyTrades,
        dailyPnL: tradingStateRef.current.dailyPnL,
        maxTradesPerDay: config?.maxTradesPerDay,
      });
      
      // TEST MODE BYPASS: Force dailyLimitsReached = false in test mode so we can debug end-to-end
      const isTestModeEnabled = config?.is_test_mode === true || config?.enableTestTrading === true || testMode;
      if (dailyLimitsReached && isTestModeEnabled) {
        writeDebugStage('buy_opportunity_daily_limits_bypassed_test_mode', {
          originalDailyLimitsReached: dailyLimitsReached,
          dailyTrades: tradingStateRef.current.dailyTrades,
          maxTradesPerDay: config?.maxTradesPerDay,
          reason: 'TEST_MODE_BYPASS',
        });
        dailyLimitsReached = false; // BYPASS for test mode debugging
      }
      
      if (dailyLimitsReached) {
        writeDebugStage('buy_opportunity_blocked_by_daily_limits', {
          dailyTrades: tradingStateRef.current.dailyTrades,
          maxTradesPerDay: config?.maxTradesPerDay,
          dailyPnL: tradingStateRef.current.dailyPnL,
          dailyLossLimit: config?.dailyLossLimit,
        });
        writeDebugStage('process_strategy_early_exit', {
          reason: 'daily_limits_reached',
          strategyId: strategy.id,
        });
        debugActionsPlanned.hold = 1;
        writeDebugStage('process_strategy_actions_planned', { ...debugActionsPlanned, exitReason: 'daily_limits_reached' });
        writeDebugStage('process_strategy_completed', {
          strategyId: strategy.id,
          strategyName: strategy.strategyName ?? strategy.configuration?.strategyName,
          actionsPlanned: debugActionsPlanned,
          exitReason: 'daily_limits_reached',
        });
        return;
      }

      // 2. MANAGE EXISTING POSITIONS (Stop Loss, Take Profit, Trailing Stops)
      writeDebugStage('process_manage_positions_start', { strategyId: strategy.id });
      let sellActions = 0;
      try {
        sellActions = await manageExistingPositionsInstrumented(strategy, marketData, debugActionsPlanned);
        writeDebugStage('process_manage_positions_complete', { 
          sellActionsCount: sellActions,
          debugActionsPlanned: { ...debugActionsPlanned },
        });
      } catch (error: any) {
        writeDebugStage('process_manage_positions_error', {
          error: error?.message || String(error),
          stack: error?.stack,
          strategyId: strategy.id,
        });
      }

      // 3. CHECK FOR NEW BUY OPPORTUNITIES - Always continue even if manage positions failed
      writeDebugStage('process_buy_opportunities_start', { strategyId: strategy.id });
      const buyActions = await checkBuyOpportunitiesInstrumented(strategy, marketData, debugActionsPlanned);
      writeDebugStage('process_buy_opportunities_complete', { 
        buyActionsCount: buyActions,
        debugActionsPlanned: { ...debugActionsPlanned },
      });
      
      // TEST-ONLY: Force normal intelligent intent when flag is set and no trades planned
      if (typeof window !== 'undefined' && 
          window.__INTELLIGENT_FORCE_NORMAL_INTENT === true &&
          debugActionsPlanned.buy === 0 && 
          debugActionsPlanned.sell === 0) {
        
        writeDebugStage('forced_normal_intent_entry', {
          strategyId: strategy.id,
          userId: user!.id,
          testMode,
        });
        
        const intent = {
          userId: user!.id,
          strategyId: strategy.id,
          symbol: 'BTC-EUR',
          side: 'BUY' as const,
          source: 'intelligent' as const,
          confidence: 0.77,
          reason: 'INTELLIGENT_FORCE_NORMAL_INTENT',
          qtySuggested: 0.001,
          metadata: {
            mode: testMode ? 'mock' : 'live',
            engine: 'intelligent',
            is_test_mode: testMode,
          },
          ts: new Date().toISOString(),
        };
        
        // Store for inspection
        (window as any).__INTELLIGENT_DEBUG_LAST_INTENT = intent;
        
        try {
          const { data: decision, error } = await supabase.functions.invoke('trading-decision-coordinator', {
            body: { intent }
          });
          
          writeDebugStage('forced_normal_intent_emitted', {
            symbol: 'BTC-EUR',
            strategyId: strategy.id,
            coordinatorResponse: decision,
            coordinatorError: error?.message,
          });
          debugActionsPlanned.buy = 1;
        } catch (err) {
          writeDebugStage('forced_normal_intent_error', { error: String(err) });
        }
        
        // Clear flag after use
        window.__INTELLIGENT_FORCE_NORMAL_INTENT = false;
      }
      
      // Final breadcrumb with all actions planned
      writeDebugStage('process_strategy_actions_planned', { ...debugActionsPlanned });
      
      // DEBUG STAGE: process_strategy_completed
      writeDebugStage('process_strategy_completed', {
        strategyId: strategy.id,
        strategyName: strategy.strategyName ?? strategy.configuration?.strategyName,
        actionsPlanned: debugActionsPlanned,
      });
      
    } catch (error: any) {
      writeDebugStage('process_strategy_error', { 
        error: error?.message || String(error),
        stack: error?.stack,
        strategyId: strategy.id,
      });
      throw error; // Re-throw so caller sees it
    }
  };
  
  // Instrumented version of manageExistingPositions
  const manageExistingPositionsInstrumented = async (strategy: any, marketData: any, actionsPlanned: { buy: number; sell: number; hold: number }): Promise<number> => {
    const config = strategy.configuration as any;
    
    writeDebugStage('manage_positions_fetch_start', {});
    const positions = await calculateOpenPositions();
    writeDebugStage('manage_positions_fetched', { 
      positionCount: positions.length,
      positions: positions.map(p => ({ symbol: p.cryptocurrency, amount: p.remaining_amount, avgPrice: p.average_price })),
    });
    
    if (positions.length === 0) {
      writeDebugStage('manage_positions_no_positions', { message: 'No open positions to manage' });
      return 0;
    }
    
    let sellsExecuted = 0;
    
    for (const position of positions) {
      const symbol = position.cryptocurrency;
      const symbolWithEUR = symbol.includes('-EUR') ? symbol : `${symbol}-EUR`;
      const symbolWithoutEUR = symbol.replace('-EUR', '');
      
      const currentPrice = marketData[symbol]?.price || marketData[symbolWithEUR]?.price || marketData[symbolWithoutEUR]?.price;
      
      writeDebugStage('manage_position_check', {
        symbol,
        hasPrice: !!currentPrice,
        currentPrice,
        avgPrice: position.average_price,
        remainingAmount: position.remaining_amount,
      });
      
      if (!currentPrice) {
        writeDebugStage('manage_position_skip_no_price', { symbol });
        continue;
      }

      const purchasePrice = position.average_price;
      const pnlPercentage = ((currentPrice - purchasePrice) / purchasePrice) * 100;
      const hoursSincePurchase = (Date.now() - new Date(position.oldest_purchase_date).getTime()) / (1000 * 60 * 60);

      writeDebugStage('manage_position_analysis', {
        symbol,
        purchasePrice,
        currentPrice,
        pnlPercentage: pnlPercentage.toFixed(2),
        hoursSincePurchase: hoursSincePurchase.toFixed(2),
      });

      writeDebugStage('manage_position_get_sell_decision', { symbol, before: true });
      const sellDecision = await getSellDecision(config, position, currentPrice, pnlPercentage, hoursSincePurchase);
      writeDebugStage('manage_position_get_sell_decision', { 
        symbol, 
        after: true, 
        hasSellDecision: !!sellDecision,
        sellReason: sellDecision?.reason || 'none',
      });
      
      if (sellDecision) {
        writeDebugStage('manage_position_executing_sell', { 
          symbol, 
          reason: sellDecision.reason,
          orderType: sellDecision.orderType,
        });
        await executeSellOrder(strategy, position, currentPrice, sellDecision);
        actionsPlanned.sell++;
        sellsExecuted++;
        writeDebugStage('manage_position_sell_executed', { symbol, sellsExecuted });
      } else {
        actionsPlanned.hold++;
        writeDebugStage('manage_position_holding', { symbol, reason: 'no_sell_conditions_met' });
      }
    }
    
    return sellsExecuted;
  };
  
  // Instrumented version of checkBuyOpportunities
  // ============================================================================
  // PHASE 1-4 REFACTOR: Exposure-based risk management replaces hasPosition gate
  // ============================================================================
  const checkBuyOpportunitiesInstrumented = async (strategy: any, marketData: any, actionsPlanned: { buy: number; sell: number; hold: number }): Promise<number> => {
    // ============= PHASE D: BLOCK ALL AUTOMATIC FRONTEND BUYs =============
    // This function is the main entry point for automatic BUY decisions.
    // With FRONTEND_ENGINE_DISABLED=true, we exit immediately.
    // ======================================================================
    if (FRONTEND_ENGINE_DISABLED) {
      console.warn('[FRONTEND_BUY_BLOCKED] Frontend BUY disabled during backend cutover - automatic BUYs blocked');
      return 0;
    }
    
    const config = strategy.configuration as any;
    
    writeDebugStage('buy_opportunities_fetch_positions', {});
    const positions = await calculateOpenPositions();
    writeDebugStage('buy_opportunities_positions_fetched', { 
      positionCount: positions.length,
      maxActiveCoins: config.maxActiveCoins,
    });
    
    // PHASE 1-3: Calculate exposure metrics (replaces hasPosition gate)
    const exposure = calculateExposure({
      positions,
      marketData,
      config: {
        maxWalletExposure: config.maxWalletExposure,
        riskManagement: config.riskManagement,
        maxActiveCoins: config.maxActiveCoins,
        perTradeAllocation: config.perTradeAllocation || 50,
        selectedCoins: config.selectedCoins,
        walletValueEUR: config.walletValueEUR || 30000, // Test mode default
      },
    });
    
    writeDebugStage('buy_opportunities_exposure_calculated', {
      totalExposureEUR: exposure.totalExposureEUR.toFixed(2),
      maxWalletExposureEUR: exposure.maxWalletExposureEUR.toFixed(2),
      uniqueCoinsWithExposure: exposure.uniqueCoinsWithExposure,
      maxActiveCoins: exposure.maxActiveCoins,
      canAddNewCoin: exposure.canAddNewCoin,
      perTradeAllocation: exposure.perTradeAllocation,
      maxExposurePerCoinEUR: exposure.maxExposurePerCoinEUR.toFixed(2),
    });
    
    // ========================================================================
    // REMOVED: TEST_ALWAYS_BUY automatic BUY bypass (v2 architecture)
    // ========================================================================
    // Previously, this block would automatically emit BUY intents in test mode
    // without going through the normal signal evaluation path. This created
    // INCONSISTENT behavior where:
    //   - BUYs bypassed fusion checks
    //   - SELLs (TP/SL) were blocked by fusion with "signal_too_weak"
    //
    // Now in v2:
    //   - ALL BUYs go through the normal signal-based path below
    //   - The engine will only BUY when real signals are detected
    //   - TP/SL/timeout exits ALWAYS bypass fusion (they're hard risk rules)
    //
    // To force a debug BUY manually (for testing), use console:
    //   window.__INTELLIGENT_FORCE_DEBUG_TRADE = true
    // ========================================================================
    
    // PHASE 3: Check UNIQUE COINS limit (not positions.length)
    if (exposure.uniqueCoinsWithExposure >= exposure.maxActiveCoins && !exposure.canAddNewCoin) {
      // Only block if trying to add a NEW coin - existing coins can still get more trades
      writeDebugStage('buy_opportunities_max_unique_coins_reached', { 
        uniqueCoinsWithExposure: exposure.uniqueCoinsWithExposure,
        maxActiveCoins: exposure.maxActiveCoins,
        note: 'Can still add trades to existing coins if within per-coin limits',
      });
      // Don't return 0 here - we may still be able to add to existing coins
    }

    // Get coins to analyze
    const selectedCoins = config.selectedCoins || [];
    const coinsToAnalyze = selectedCoins.length > 0 
      ? selectedCoins 
      : filterSupportedSymbols(getAllSymbols()).slice(0, 3);
    
    // TASK 1: Log exactly which symbols are analyzed
    writeDebugStage('buy_opportunity_coins_to_analyze', { 
      coinsToAnalyze,
      selectedCoins: config?.selectedCoins || [],
      fallbackUsed: selectedCoins.length === 0,
      strategyId: strategy.id,
      marketDataKeys: Object.keys(marketData),
    });
    
    let buysExecuted = 0;
    const symbolDecisions: SymbolDecisionLog[] = []; // Collect per-symbol decisions for cycle log
    
    for (const coin of coinsToAnalyze) {
      const baseSymbol = coin; // BTC, ETH, etc.
      const symbol = `${coin}-EUR`;
      
      writeDebugStage('buy_opportunity_check_coin', { coin, symbol });
      
      // MARKET AVAILABILITY PREFLIGHT CHECK
      const availability = checkMarketAvailability(symbol);
      writeDebugStage('buy_opportunity_market_availability', { 
        symbol, 
        isSupported: availability.isSupported,
        reason: availability.reason,
      });
      
      if (!availability.isSupported) {
        writeDebugStage('buy_opportunity_skip_unavailable', { symbol, reason: availability.reason });
        continue;
      }
      
      const currentData = marketData[symbol];
      writeDebugStage('buy_opportunity_market_data', { 
        symbol, 
        hasData: !!currentData,
        price: currentData?.price,
      });
      
      if (!currentData) {
        writeDebugStage('buy_opportunity_skip_no_data', { symbol });
        continue;
      }

      // =====================================================================
      // PHASE 2: Replace hasPosition gate with EXPOSURE-BASED check
      // DCA is now controlled by exposure limits, not enableDCA flag
      // =====================================================================
      const exposureCheck = canBuySymbol(symbol, exposure);
      writeDebugStage('buy_opportunity_exposure_check', { 
        symbol, 
        allowed: exposureCheck.allowed,
        reason: exposureCheck.reason,
        details: exposureCheck.details,
      });
      
      if (!exposureCheck.allowed) {
        symbolDecisions.push(createSymbolDecision(symbol, {
          blockedByExposure: true,
          exposureCurrent: exposureCheck.details?.currentExposure || 0,
          exposureLimit: exposureCheck.details?.maxExposure || 0,
          blockedByMaxActiveCoins: exposureCheck.reason.includes('max_active_coins'),
          activeCoins: exposure.uniqueCoinsWithExposure,
          maxActiveCoins: exposure.maxActiveCoins,
        }, 'blocked_by_exposure', exposureCheck.reason));
        writeDebugStage('buy_opportunity_skip_exposure_limit', { 
          symbol, 
          reason: exposureCheck.reason,
          details: exposureCheck.details,
        });
        continue;
      }
      
      // PHASE 4: Check per-symbol cooldown
      const cooldownMs = getCooldownMs(config, 'buy');
      const cooldownCheck = isSymbolInCooldown(symbol, 'buy', cooldownMs);
      
      if (cooldownCheck.inCooldown) {
        symbolDecisions.push(createSymbolDecision(symbol, {
          blockedByCooldown: true,
          cooldownRemainingMs: cooldownCheck.remainingMs,
        }, 'blocked_by_cooldown', `Cooldown: ${Math.ceil(cooldownCheck.remainingMs / 1000)}s remaining`));
        writeDebugStage('buy_opportunity_skip_cooldown', { 
          symbol, 
          remainingMs: cooldownCheck.remainingMs,
          cooldownMs,
        });
        continue;
      }

      // Check if we should buy this coin using REAL signals
      writeDebugStage('buy_opportunity_get_signal', { symbol, before: true });
      const buySignal = await getBuySignal(config, symbol, marketData, false); // PHASE 2: hasPosition no longer blocks
      writeDebugStage('buy_opportunity_get_signal', { 
        symbol, 
        after: true,
        hasBuySignal: !!buySignal,
        signalReason: buySignal?.reason || 'none',
      });
      
      if (!buySignal) {
        symbolDecisions.push(createSymbolDecision(symbol, {
          signalFusionResult: 'no_signals',
        }, 'no_buy_signal', 'No valid bullish signal found in live_signals'));
        writeDebugStage('buy_opportunity_no_signal', { symbol });
        continue;
      }

      // Execute buy - signal exists
      symbolDecisions.push(createSymbolDecision(symbol, {
        hasValidBullishSignal: true,
        signalFusionResult: 'bullish',
      }, 'eligible_for_intelligent_auto_buy', buySignal.reason));
      writeDebugStage('buy_opportunity_executing', { 
        symbol,
        price: currentData.price,
        reason: buySignal.reason,
      });
      await executeBuyOrder(strategy, symbol, currentData.price, buySignal.reason);
      actionsPlanned.buy++;
      buysExecuted++;
      writeDebugStage('buy_opportunity_executed', { symbol, buysExecuted });
    }
    
    // ========================================================================
    // UNIFIED ENGINE PATH - SAME LOGIC FOR TEST AND PROD
    // ========================================================================
    // NO test-mode shortcuts, NO auto-buy, NO bootstrap hacks.
    // The engine will only BUY when real signals justify it.
    // 
    // If no BUYs executed, log structured diagnostics so we can trace why.
    // ========================================================================
    
    if (buysExecuted === 0) {
      // Log summary of why no buys happened
      const summary = {
        coinsAnalyzed: coinsToAnalyze.length,
        symbolDecisionsSummary: symbolDecisions.map(d => ({
          symbol: d.symbol,
          decision: d.finalDecision,
          reason: d.reason,
          blockers: {
            exposure: d.blockedByExposure,
            cooldown: d.blockedByCooldown,
            maxActiveCoins: d.blockedByMaxActiveCoins,
          },
          signalResult: d.signalFusionResult,
        })),
      };
      
      console.log('[INTELLIGENT_AUTO] No BUYs this cycle - decision summary:', JSON.stringify(summary, null, 2));
      writeDebugStage('cycle_no_buys', summary);
    }
    
    writeDebugStage('buy_opportunities_summary', { 
      coinsAnalyzed: coinsToAnalyze.length,
      buysExecuted,
    });
    
    // Log structured cycle for easy debugging
    const cycleLog: CycleLog = {
      cycleId: `cycle_${Date.now()}`,
      timestamp: new Date().toISOString(),
      mode: 'INTELLIGENT_AUTO', // UNIFIED: always the same mode
      symbolDecisions,
      intentEmitted: buysExecuted > 0,
      intentSymbol: buysExecuted > 0 ? coinsToAnalyze.find(c => symbolDecisions.find(d => d.symbol === `${c}-EUR` && d.finalDecision.includes('eligible'))) + '-EUR' : undefined,
      intentSide: buysExecuted > 0 ? 'BUY' : undefined,
    };
    logEngineCycle(cycleLog);
    
    return buysExecuted;
  };

  const resetDailyCountersIfNeeded = () => {
    const today = new Date().toDateString();
    if (tradingStateRef.current.dailyResetDate !== today) {
      engineLog('ENGINE: Resetting daily counters for new day');
      tradingStateRef.current = {
        ...tradingStateRef.current,
        dailyTrades: 0,
        dailyPnL: 0,
        dailyResetDate: today
      };
    }
  };

  const isDailyLimitReached = (config: any): boolean => {
    const state = tradingStateRef.current;
    
    // Check daily trade limit
    if (config.maxTradesPerDay && state.dailyTrades >= config.maxTradesPerDay) {
      engineLog('ENGINE: Daily trade limit reached: ' + state.dailyTrades + ' >= ' + config.maxTradesPerDay);
      return true;
    }

    // Check daily loss limit
    if (config.dailyLossLimit && state.dailyPnL <= -Math.abs(config.dailyLossLimit)) {
      engineLog('ENGINE: Daily loss limit reached: ' + state.dailyPnL + ' <= ' + (-config.dailyLossLimit));
      return true;
    }

    return false;
  };

  const manageExistingPositions = async (strategy: any, marketData: any) => {
    const config = strategy.configuration as any;
    const positions = await calculateOpenPositions();
    
    engineLog('ENGINE: Managing ' + positions.length + ' open positions');
    if (positions.length > 0) {
      engineLog('DEBUG SELL: Full positions data available');
      engineLog('DEBUG SELL: Market data available for: ' + Object.keys(marketData).join(', '));
    }

    for (const position of positions) {
        // Try to match symbol with market data (handle both "XRP" and "XRP-EUR" formats)
        const symbol = position.cryptocurrency;
        const symbolWithEUR = symbol.includes('-EUR') ? symbol : `${symbol}-EUR`;
        const symbolWithoutEUR = symbol.replace('-EUR', '');
        
        const currentPrice = marketData[symbol]?.price || marketData[symbolWithEUR]?.price || marketData[symbolWithoutEUR]?.price;
        engineLog('DEBUG SELL: Processing position: ' + symbol);
        
        if (!currentPrice) {
          engineLog('DEBUG SELL: NO PRICE DATA for: ' + symbol);
          continue;
        }

      const purchasePrice = position.average_price;
      const pnlPercentage = ((currentPrice - purchasePrice) / purchasePrice) * 100;
      const hoursSincePurchase = (Date.now() - new Date(position.oldest_purchase_date).getTime()) / (1000 * 60 * 60);

      engineLog('ENGINE: Position analysis for ' + position.cryptocurrency + ' P&L: ' + pnlPercentage.toFixed(2) + '%');

      // Execute sell based on sell order type and conditions
      const sellDecision = await getSellDecision(config, position, currentPrice, pnlPercentage, hoursSincePurchase);
      engineLog('DEBUG SELL: Sell decision for ' + position.cryptocurrency + ': ' + (sellDecision ? sellDecision.reason : 'none'));
      
      if (sellDecision) {
        engineLog('DEBUG SELL: EXECUTING SELL ORDER - ' + position.cryptocurrency + ' at ' + currentPrice);
        await executeSellOrder(strategy, position, currentPrice, sellDecision);
      } else {
        engineLog('DEBUG SELL: NO SELL DECISION - position remains open: ' + position.cryptocurrency);
      }
    }
  };

  const getSellDecision = async (config: any, position: Position, currentPrice: number, pnlPercentage: number, hoursSincePurchase: number): Promise<{reason: string, orderType?: string, decisionData?: any} | null> => {
    const positionAgeMs = Date.now() - new Date(position.oldest_purchase_date).getTime();
    const timeSinceLastActionMs = Date.now() - new Date(position.oldest_purchase_date).getTime(); // Simplified for now
    
    // Read strategy config with safe defaults (Phase 2)
    const minHoldPeriodMs = config.minHoldPeriodMs || 300000; // 5 min default
    const cooldownBetweenOppositeActionsMs = config.cooldownBetweenOppositeActionsMs || 180000; // 3 min default
    const spreadThresholdBps = config.spreadThresholdBps || 15; // 0.15% default
    const priceStaleMaxMs = config.priceStaleMaxMs || 15000; // 15s default
    const epsilonPnLBufferPct = config.epsilonPnLBufferPct || 0.03; // 0.03% buffer
    
    // Phase 1: Structured logging with canonical decision tracking
    const logContext = {
      symbol: position.cryptocurrency,
      positionAgeMs,
      timeSinceLastActionMs,
      pnlPct: pnlPercentage,
      currentPrice,
      entryPrice: position.average_price,
      spreadBps: 0, // Will be calculated
      lastTickAgeMs: 0, // Fresh price for now
      reasonChosen: 'evaluating'
    };
    
    engineLog('SELL DECISION DEBUG: Enhanced evaluation', logContext);
    
    // Phase 4: Hold period check (hard block)
    if (positionAgeMs < minHoldPeriodMs) {
      logContext.reasonChosen = 'hold_min_period_not_met';
      engineLog('SELL DECISION: BLOCKED - Hold period not met', { 
        required: minHoldPeriodMs, 
        actual: positionAgeMs,
        ...logContext 
      });
      
      // Log to trade_decisions_log with correct schema
      try {
        await supabase.from('trade_decisions_log').insert({
          user_id: user!.id,
          strategy_id: config?.strategyId,
          symbol: position.cryptocurrency.replace('-EUR', ''),
          intent_side: 'SELL',
          intent_source: 'intelligent_engine', 
          decision_action: 'DEFER',
          decision_reason: 'hold_min_period_not_met',
          confidence: 0,
          metadata: logContext
        });
      } catch (e) { /* Silent fail on logging */ }
      
      return null;
    }

    // 1. AUTO CLOSE AFTER HOURS (overrides everything)
    // PHASE 1 FIX: Make AUTO_CLOSE_TIME explicit opt-in only
    // - Must be a valid positive number (not null, undefined, 0, or negative)
    // - This prevents silent auto-close when config is missing or invalid
    const autoCloseHours = config.autoCloseAfterHours;
    const isAutoCloseConfigured = 
      typeof autoCloseHours === 'number' &&
      Number.isFinite(autoCloseHours) &&
      autoCloseHours > 0;
    
    if (isAutoCloseConfigured && hoursSincePurchase >= autoCloseHours) {
      logContext.reasonChosen = 'auto_close_time_hit';
      // PHASE 1: Enhanced logging for observability
      console.log('[EngineSellDecision]', {
        symbol: position.cryptocurrency,
        trigger: 'AUTO_CLOSE_TIME',
        reason: `Position held ${hoursSincePurchase.toFixed(2)}h >= configured ${autoCloseHours}h`,
        pnlPct: pnlPercentage.toFixed(2),
        autoCloseAfterHours: autoCloseHours,
      });
      engineLog('SELL DECISION: AUTO CLOSE TRIGGERED - ' + hoursSincePurchase + ' >= ' + autoCloseHours, logContext);
      return { reason: 'AUTO_CLOSE_TIME', orderType: 'market', decisionData: logContext };
    }

    // 2. STOP LOSS CHECK - STRICT ENFORCEMENT
    // =========================================================================
    // CRITICAL FIX: STOP_LOSS should ONLY trigger when:
    //   1. stopLossPercentage is configured (truthy, > 0)
    //   2. Actual P&L percentage is at or below the negative SL threshold
    // 
    // Example: If SL = 0.7%, only trigger when pnlPercentage <= -0.7%
    // Previously, STOP_LOSS was being triggered incorrectly for small losses.
    // =========================================================================
    const configuredSL = config.stopLossPercentage;
    const hasSLConfigured = typeof configuredSL === 'number' && configuredSL > 0;
    const adjustedStopLoss = hasSLConfigured ? Math.abs(configuredSL) + epsilonPnLBufferPct : 0;
    const slThresholdMet = hasSLConfigured && pnlPercentage <= -adjustedStopLoss;
    
    // Log SL evaluation for debugging
    console.log('[EngineSellDecision][SL_CHECK]', {
      symbol: position.cryptocurrency,
      configuredSL,
      hasSLConfigured,
      adjustedStopLoss: adjustedStopLoss.toFixed(4),
      pnlPercentage: pnlPercentage.toFixed(4),
      slThresholdMet,
      comparison: `${pnlPercentage.toFixed(4)} <= -${adjustedStopLoss.toFixed(4)} = ${slThresholdMet}`,
    });
    
    if (slThresholdMet) {
      logContext.reasonChosen = 'sl_hit';
      console.log('[EngineSellDecision]', {
        symbol: position.cryptocurrency,
        trigger: 'STOP_LOSS',
        reason: `P&L ${pnlPercentage.toFixed(2)}% <= -${adjustedStopLoss.toFixed(2)}% (SL + buffer)`,
        pnlPct: pnlPercentage.toFixed(2),
      });
      engineLog('SELL DECISION: STOP LOSS TRIGGERED with buffer - ' + pnlPercentage + ' <= ' + (-adjustedStopLoss), logContext);
      return { 
        reason: 'STOP_LOSS', 
        orderType: config.sellOrderType || 'market',
        decisionData: logContext
      };
    }

    // 3. TAKE PROFIT CHECK - STRICT ENFORCEMENT
    // =========================================================================
    // CRITICAL FIX: TAKE_PROFIT should ONLY trigger when:
    //   1. takeProfitPercentage is configured (truthy, > 0)
    //   2. Actual P&L percentage is at or above the positive TP threshold
    // =========================================================================
    const configuredTP = config.takeProfitPercentage;
    const hasTPConfigured = typeof configuredTP === 'number' && configuredTP > 0;
    const adjustedTakeProfit = hasTPConfigured ? Math.abs(configuredTP) + epsilonPnLBufferPct : 0;
    const tpThresholdMet = hasTPConfigured && pnlPercentage >= adjustedTakeProfit;
    
    // Log TP evaluation for debugging
    console.log('[EngineSellDecision][TP_CHECK]', {
      symbol: position.cryptocurrency,
      configuredTP,
      hasTPConfigured,
      adjustedTakeProfit: adjustedTakeProfit.toFixed(4),
      pnlPercentage: pnlPercentage.toFixed(4),
      tpThresholdMet,
      comparison: `${pnlPercentage.toFixed(4)} >= ${adjustedTakeProfit.toFixed(4)} = ${tpThresholdMet}`,
    });
    
    if (tpThresholdMet) {
      logContext.reasonChosen = 'tp_hit';
      console.log('[EngineSellDecision]', {
        symbol: position.cryptocurrency,
        trigger: 'TAKE_PROFIT',
        reason: `P&L ${pnlPercentage.toFixed(2)}% >= ${adjustedTakeProfit.toFixed(2)}% (TP + buffer)`,
        pnlPct: pnlPercentage.toFixed(2),
      });
      engineLog('SELL DECISION: TAKE PROFIT TRIGGERED with buffer - ' + pnlPercentage + ' >= ' + adjustedTakeProfit, logContext);
      return { 
        reason: 'TAKE_PROFIT', 
        orderType: config.sellOrderType || 'market',
        decisionData: logContext
      };
    }

    logContext.reasonChosen = 'no_exit_conditions_met';
    engineLog('SELL DECISION: NO SELL CONDITIONS MET - keeping position open', logContext);

    // 4. TRAILING STOP LOSS
    if (config.trailingStopLossPercentage) {
      const trailingStopTriggered = await checkTrailingStopLoss(config, position, currentPrice, pnlPercentage);
      if (trailingStopTriggered) {
        return { 
          reason: 'TRAILING_STOP', 
          orderType: 'trailing_stop' 
        };
      }
    }

    // 5. SAFETY GUARD: Weak exit protection (temporary stopgap)
    const realizedPnlEur = (currentPrice - position.average_price) * position.remaining_amount;
    
    // Check if this is a weak bearish signal with negative P&L
    if (realizedPnlEur < -0.05) {
      // This is a preliminary check - we need to check the actual signal confidence
      // when the SELL intent is generated. For now, we'll check technical signals.
      const technicalSellSignal = await checkTechnicalSellSignals(config, position.cryptocurrency, currentPrice);
      
      if (technicalSellSignal) {
        // If technical sell signal exists, allow it even with negative P&L
        logContext.reasonChosen = 'technical_signal_override';
        return { 
          reason: 'TECHNICAL_SIGNAL', 
          orderType: config.sellOrderType || 'market',
          decisionData: logContext
        };
      } else {
        // Block weak exit with negative P&L
        logContext.reasonChosen = 'preblocked_negative_pnl';
        engineLog('SELL DECISION: BLOCKED - Weak exit with negative P&L', { 
          realizedPnlEur,
          pnlPercentage,
          ...logContext 
        });
        
        // Log to trade_decisions_log
        try {
          await supabase.from('trade_decisions_log').insert({
            user_id: user!.id,
            strategy_id: config?.strategyId,
            symbol: position.cryptocurrency.replace('-EUR', ''),
            intent_side: 'SELL',
            intent_source: 'intelligent_engine', 
            decision_action: 'DEFER',
            decision_reason: 'preblocked_negative_pnl',
            confidence: 0,
            metadata: { ...logContext, realizedPnlEur }
          });
        } catch (e) { /* Silent fail on logging */ }
        
        return null;
      }
    }

    // 6. TECHNICAL INDICATOR SELL SIGNALS
    if (await checkTechnicalSellSignals(config, position.cryptocurrency, currentPrice)) {
      return { 
        reason: 'TECHNICAL_SIGNAL', 
        orderType: config.sellOrderType || 'market' 
      };
    }

    return null;
  };

  const executeSellOrder = async (strategy: any, position: Position, marketPrice: number, sellDecision: {reason: string, orderType?: string}) => {
    try {
      // Map sell decision reasons to proper context and closeMode
      const context = sellDecision.reason === 'TAKE_PROFIT' ? 'TP' : 
                     sellDecision.reason === 'STOP_LOSS' ? 'SL' : 
                     sellDecision.reason === 'AUTO_CLOSE_TIME' ? 'MANUAL' : 'MANUAL';
      
      // Determine closeMode based on sell reason (hybrid model)
      // TP_SELECTIVE: Only close profitable lots meeting TP threshold
      // SL_FULL_FLUSH: Close ALL lots (stop loss)
      // AUTO_CLOSE_ALL: Close ALL lots (time-based)
      const closeMode = 
        sellDecision.reason === 'TAKE_PROFIT' ? 'TP_SELECTIVE' :
        sellDecision.reason === 'STOP_LOSS' ? 'SL_FULL_FLUSH' :
        sellDecision.reason === 'AUTO_CLOSE_TIME' ? 'AUTO_CLOSE_ALL' : 
        'MANUAL_SYMBOL';
      
      // Get TP threshold from config for selective close
      const config = strategy.configuration || {};
      const tpThresholdPct = config.takeProfitPercentage || 3;
      const minHoldMs = config.minHoldPeriodMs || 300000;
      
      engineConsoleLog('🎯 SELL ORDER: Executing with context:', context, 'closeMode:', closeMode, 'reason:', sellDecision.reason);
      await executeTrade(strategy, 'sell', position.cryptocurrency, marketPrice, position.remaining_amount, sellDecision.reason, context, {
        closeMode,
        tpThresholdPct,
        minHoldMs
      });
    } catch (error) {
      logger.error('ENGINE: Error in executeTrade:', error);
    }
  };

  // Unified AI Signal Fusion and Context Gates
  const evaluateSignalFusion = async (strategy: any, symbol: string, side: 'BUY' | 'SELL', context: 'ENTRY' | 'TP' | 'SL' | 'MANUAL' = 'ENTRY'): Promise<{
    sTotalScore: number;
    bucketScores: { trend: number; volatility: number; momentum: number; whale: number; sentiment: number };
    decision: 'ENTER' | 'EXIT' | 'HOLD' | 'DEFER';
    reason: string;
    gateBlocks: string[];
    effectiveConfig: any;
    valueSources: Record<string, any>;
    context: string;
  }> => {
    const { computeEffectiveConfig, isAIFusionEnabled, getFusionConfig, getContextGatesConfig } = await import('@/utils/aiConfigHelpers');
    
    const config = strategy.configuration;
    const effectiveConfigWithSources = computeEffectiveConfig(config);
    const fusionConfig = getFusionConfig(config);
    const gatesConfig = getContextGatesConfig(config);
    const isAIEnabled = isAIFusionEnabled(config);
    
    // Log effective config for debugging - shows user values vs AI overrides
    engineConsoleLog(`[EFFECTIVE_CONFIG] Market Gates: spreadThresholdBps=${effectiveConfigWithSources.spreadThresholdBps} (source: ${effectiveConfigWithSources.value_sources.spreadThresholdBps?.source}), minDepthRatio=${effectiveConfigWithSources.minDepthRatio} (source: ${effectiveConfigWithSources.value_sources.minDepthRatio?.source})`);
    
    // Default to legacy behavior if AI fusion not enabled
    if (!isAIEnabled) {
      return {
        sTotalScore: 0.5,
        bucketScores: { trend: 0, volatility: 0, momentum: 0, whale: 0, sentiment: 0 },
        decision: 'ENTER',
        reason: 'legacy_evaluation',
        gateBlocks: [],
        effectiveConfig: effectiveConfigWithSources,
        valueSources: effectiveConfigWithSources.value_sources,
        context
      };
    }
    
    const weights = fusionConfig.weights;
    const bucketScores = { trend: 0, volatility: 0, momentum: 0, whale: 0, sentiment: 0 };
    const gateBlocks: string[] = [];
    
    try {
      // Context Gates - Check blocking conditions first using effective config
      // 🚀 TP exits bypass liquidity and whale conflict gates (hard risk rules)
      // ⚠️ UNIFIED: Same logic for test AND production - NO MORE BYPASSES
      
      if (gatesConfig) {
        // Gate 1: Spread check - SAME for test and prod
        const spread = await checkSpreadGate(symbol, effectiveConfigWithSources.spreadThresholdBps);
        if (spread.blocked) {
          gateBlocks.push('spread_too_wide');
        }
        
        // Gate 2: Liquidity/Depth check - BYPASS only for TP exits (hard risk)
        const enforceLiquidity = context !== 'TP';
        if (enforceLiquidity) {
          const liquidity = await checkLiquidityGate(symbol, effectiveConfigWithSources.minDepthRatio);
          if (liquidity.blocked) {
            gateBlocks.push('blocked_by_liquidity');
            engineConsoleLog(`🚫 LIQUIDITY GATE: Blocked ${side} for ${symbol} (context: ${context}) - depth ratio: ${liquidity.depthRatio} < ${effectiveConfigWithSources.minDepthRatio}`);
          }
        } else {
          engineConsoleLog(`✅ LIQUIDITY GATE: Bypassed for ${side} ${symbol} (context: ${context}) - TP exit`);
        }
        
        // Gate 3: Whale conflict check - BYPASS only for TP exits (hard risk)
        const enforceWhaleConflict = context !== 'TP';
        if (enforceWhaleConflict) {
          const whaleConflict = await checkWhaleConflictGate(symbol, side, effectiveConfigWithSources.whaleConflictWindowMs);
          if (whaleConflict.blocked) {
            gateBlocks.push('blocked_by_whale_conflict');
          }
        } else {
          engineConsoleLog(`✅ WHALE GATE: Bypassed for ${side} ${symbol} (context: ${context}) - TP exit`);
        }
        
        // If any gate blocks, return immediately
        if (gateBlocks.length > 0) {
          return {
            sTotalScore: 0,
            bucketScores,
            decision: 'DEFER',
            reason: gateBlocks[0], // Use first blocking reason
            gateBlocks,
            effectiveConfig: effectiveConfigWithSources,
            valueSources: effectiveConfigWithSources.value_sources,
            context
          };
        }
      }
      
      // Signal Fusion - Calculate bucket scores
      // 1. Trend/Structure bucket (multi-timeframe bias)
      bucketScores.trend = await calculateTrendScore(symbol, side);
      
      // 2. Volatility/Liquidity bucket (ATR, spread context)
      bucketScores.volatility = await calculateVolatilityScore(symbol);
      
      // 3. Momentum/Patterns bucket (technical indicators + candles)
      bucketScores.momentum = await calculateMomentumScore(symbol, side);
      
      // 4. Whale/Flow bucket (directional flow)
      bucketScores.whale = await calculateWhaleScore(symbol, side);
      
      // 5. News/Sentiment bucket (direction + intensity)
      bucketScores.sentiment = await calculateSentimentScore(symbol, side);
      
      // Calculate composite score S_total ∈ [-1, +1]
      const sTotalScore = 
        (bucketScores.trend * weights.trend) +
        (bucketScores.volatility * weights.volatility) +
        (bucketScores.momentum * weights.momentum) +
        (bucketScores.whale * weights.whale) +
        (bucketScores.sentiment * weights.sentiment);
      
      // Apply conflict penalty - reduce score if buckets strongly disagree
      const conflictPenalty = calculateConflictPenalty(bucketScores, fusionConfig.conflictPenalty);
      const adjustedScore = Math.max(-1, Math.min(1, sTotalScore - conflictPenalty));
      
      // ========================================================================
      // DECISION LOGIC - UNIFIED FOR TEST AND PRODUCTION
      // ========================================================================
      // When enterThreshold = 0, ANY positive score triggers BUY
      // When exitThreshold = 0, ANY negative score triggers SELL
      // NO hidden neutral bands - thresholds are respected exactly
      // ========================================================================
      
      // Use ?? to respect 0 values (|| would treat 0 as falsy → bad!)
      const enterThreshold = fusionConfig?.enterThreshold ?? effectiveConfigWithSources.enterThreshold ?? 0;
      const exitThreshold = fusionConfig?.exitThreshold ?? effectiveConfigWithSources.exitThreshold ?? 0;
      
      // Log thresholds for transparency
      console.log(`📊 [FUSION] Decision thresholds for ${symbol} (${side}):`, {
        enterThreshold,
        exitThreshold,
        adjustedScore: adjustedScore.toFixed(4),
        bucketScores
      });
      
      let decision: 'ENTER' | 'EXIT' | 'HOLD' | 'DEFER' = 'HOLD';
      let reason = 'no_action_needed';
      
      // BUY DECISION: score >= enterThreshold (when threshold=0, any score >= 0 triggers)
      if (side === 'BUY') {
        if (adjustedScore >= enterThreshold) {
          decision = 'ENTER';
          reason = `fusion_signal_strong (score=${adjustedScore.toFixed(3)} >= threshold=${enterThreshold})`;
        } else {
          decision = 'HOLD';
          reason = `signal_below_threshold (score=${adjustedScore.toFixed(3)} < threshold=${enterThreshold})`;
        }
      }
      
      // SELL DECISION: score <= -exitThreshold (when threshold=0, any score <= 0 triggers)
      if (side === 'SELL') {
        if (adjustedScore <= -exitThreshold) {
          decision = 'EXIT';
          reason = `fusion_exit_signal (score=${adjustedScore.toFixed(3)} <= -threshold=${-exitThreshold})`;
        } else {
          decision = 'HOLD';
          reason = `exit_signal_not_strong (score=${adjustedScore.toFixed(3)} > -threshold=${-exitThreshold})`;
        }
      }
      
      return {
        sTotalScore: adjustedScore,
        bucketScores,
        decision,
        reason,
        gateBlocks: [],
        effectiveConfig: { ...effectiveConfigWithSources, enterThreshold, exitThreshold },
        valueSources: effectiveConfigWithSources.value_sources,
        context
      };
      
    } catch (error) {
      console.error('❌ SIGNAL FUSION: Evaluation error:', error);
      return {
        sTotalScore: 0,
        bucketScores,
        decision: 'DEFER',
        reason: 'fusion_evaluation_error',
        gateBlocks: [],
        effectiveConfig: effectiveConfigWithSources,
        valueSources: effectiveConfigWithSources.value_sources,
        context
      };
    }
  };
  
  // Context Gates Implementation
  // ⚠️ UNIFIED: Same logic for test AND production - NO MORE BYPASSES
  const checkSpreadGate = async (symbol: string, maxSpreadBps: number): Promise<{ blocked: boolean; spreadBps: number }> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      const pairSymbol = `${baseSymbol}-EUR`;
      
      const response = await fetch(`https://api.exchange.coinbase.com/products/${pairSymbol}/ticker`);
      const data = await response.json();
      
      if (response.ok && data.bid && data.ask) {
        const bid = parseFloat(data.bid);
        const ask = parseFloat(data.ask);
        const mid = (bid + ask) / 2;
        const spreadBps = ((ask - bid) / mid) * 10000; // Convert to basis points
        
        const blocked = spreadBps > maxSpreadBps;
        
        console.log(`📊 [SPREAD_GATE] ${symbol}: spread=${spreadBps.toFixed(2)} bps, threshold=${maxSpreadBps} bps, blocked=${blocked}`);
        
        return { blocked, spreadBps };
      }
      
      return { blocked: false, spreadBps: 0 }; // Default to not blocked if can't fetch
    } catch (error) {
      console.error('❌ SPREAD GATE: Error checking spread:', error);
      return { blocked: false, spreadBps: 0 };
    }
  };
  
  // ⚠️ UNIFIED: Same logic for test AND production - NO MORE BYPASSES
  const checkLiquidityGate = async (symbol: string, minDepthRatio: number): Promise<{ blocked: boolean; depthRatio: number }> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      const pairSymbol = `${baseSymbol}-EUR`;
      
      const response = await fetch(`https://api.exchange.coinbase.com/products/${pairSymbol}/book?level=2`);
      const data = await response.json();
      
      if (response.ok && data.bids && data.asks) {
        // Calculate simple depth metric: ratio of top 5 levels total volume
        const bidDepth = data.bids.slice(0, 5).reduce((sum: number, bid: any) => sum + parseFloat(bid[1]), 0);
        const askDepth = data.asks.slice(0, 5).reduce((sum: number, ask: any) => sum + parseFloat(ask[1]), 0);
        
        const totalDepth = bidDepth + askDepth;
        const averageDepth = totalDepth / 2;
        const depthRatio = averageDepth > 0 ? Math.min(bidDepth, askDepth) / averageDepth : 0;
        
        const blocked = depthRatio < minDepthRatio;
        
        console.log(`📊 [LIQUIDITY_GATE] ${symbol}: depthRatio=${depthRatio.toFixed(4)}, threshold=${minDepthRatio}, blocked=${blocked}`);
        
        return { blocked, depthRatio };
      }
      
      return { blocked: false, depthRatio: 10 }; // Default to good depth if can't fetch
    } catch (error) {
      console.error('❌ LIQUIDITY GATE: Error checking depth:', error);
      return { blocked: false, depthRatio: 10 };
    }
  };
  
  const checkWhaleConflictGate = async (symbol: string, side: 'BUY' | 'SELL', windowMs: number): Promise<{ blocked: boolean; conflictData: any }> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      const windowStart = new Date(Date.now() - windowMs).toISOString();
      
      // Use existing live_signals table with whale-related signals
      const { data: whaleSignals } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', baseSymbol)
        .in('signal_type', ['whale_movement', 'large_volume'])
        .gte('timestamp', windowStart)
        .order('timestamp', { ascending: false })
        .limit(5);
      
      if (!whaleSignals || whaleSignals.length === 0) {
        return { blocked: false, conflictData: null };
      }
      
      // Mock whale conflict logic for now - block on strong opposing signals
      const recentWhaleActivity = whaleSignals[0];
      const isLargeSignal = Math.abs(recentWhaleActivity.signal_strength || 0) > 0.7;
      
      // Simple mock: block if recent strong signal opposes our direction
      const signalDirection = (recentWhaleActivity.signal_strength || 0) > 0 ? 'BUY' : 'SELL';
      const isConflict = side !== signalDirection && isLargeSignal;
      
      return {
        blocked: isConflict,
        conflictData: recentWhaleActivity
      };
      
    } catch (error) {
      console.error('❌ WHALE CONFLICT GATE: Error checking whale activity:', error);
      return { blocked: false, conflictData: null };
    }
  };
  
  // Signal Bucket Calculations (using existing data sources)
  // ============================================================================
  // SIGNAL BUCKET CALCULATIONS - Using REAL data from market_features_v0 and live_signals
  // These functions query actual database tables with correct signal type names
  // ============================================================================
  
  const calculateTrendScore = async (symbol: string, side: 'BUY' | 'SELL'): Promise<number> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      const fullSymbol = symbol.includes('-EUR') ? symbol : `${symbol}-EUR`;
      
      // PRIMARY: Use market_features_v0 for real EMA/MACD trend data
      // NOTE: Casting to any because Supabase types are out of sync with actual schema
      const { data: featuresRaw } = await supabase
        .from('market_features_v0')
        .select('*')
        .eq('symbol', fullSymbol)
        .order('ts_utc', { ascending: false })
        .limit(1);
      
      const features = featuresRaw as any[] | null;
      let trendScore = 0;
      
      if (features && features.length > 0) {
        const f = features[0];
        // EMA trend: EMA20 > EMA50 = bullish, EMA20 < EMA50 = bearish
        if (f.ema_20 && f.ema_50) {
          const emaTrend = (f.ema_20 - f.ema_50) / f.ema_50; // % above/below
          trendScore += emaTrend * 2; // Scale up
        }
        // MACD: Positive = bullish, Negative = bearish
        if (f.macd_line && f.macd_signal) {
          const macdDiff = (f.macd_line - f.macd_signal) / Math.abs(f.macd_signal || 1);
          trendScore += macdDiff * 0.5;
        }
        // 24h return as trend indicator
        if (f.ret_24h) {
          trendScore += f.ret_24h * 3; // 10% return = +0.3 score
        }
      }
      
      // SECONDARY: Also check live_signals for MA cross signals (extended window: 24h)
      const { data: signals } = await supabase
        .from('live_signals')
        .select('*')
        .in('symbol', [baseSymbol, fullSymbol, 'ALL'])
        .in('signal_type', ['ma_cross_bullish', 'ma_cross_bearish', 'price_breakout_bullish', 'price_breakout_bearish'])
        .gte('timestamp', new Date(Date.now() - 86400000).toISOString()) // Last 24h
        .order('timestamp', { ascending: false })
        .limit(10);
      
      if (signals && signals.length > 0) {
        signals.forEach((signal, idx) => {
          const recency = 1 / (idx + 1); // More recent = higher weight
          const strength = Math.min(1, (signal.signal_strength || 0) / 100); // Normalize 0-100 to 0-1
          if (signal.signal_type.includes('bullish')) {
            trendScore += recency * strength * 0.3;
          } else if (signal.signal_type.includes('bearish')) {
            trendScore -= recency * strength * 0.3;
          }
        });
      }
      
      // Adjust for side: BUY wants positive trend, SELL wants negative trend
      const finalScore = side === 'BUY' ? trendScore : -trendScore;
      
      console.log(`📊 [FUSION] Trend score for ${symbol} (${side}): ${finalScore.toFixed(3)} | features: ${features?.length || 0}, signals: ${signals?.length || 0}`);
      
      return Math.max(-1, Math.min(1, finalScore));
      
    } catch (error) {
      console.error('❌ TREND SCORE: Error calculating trend score:', error);
      return 0;
    }
  };
  
  const calculateVolatilityScore = async (symbol: string): Promise<number> => {
    try {
      const fullSymbol = symbol.includes('-EUR') ? symbol : `${symbol}-EUR`;
      
      // Use REAL volatility data from market_features_v0
      // PRIORITIZE: vol_1h > vol_4h > vol_24h > vol_7d > ret_24h
      const { data: features } = await supabase
        .from('market_features_v0')
        .select('vol_1h, vol_4h, vol_24h, vol_7d, ret_1h, ret_24h')
        .eq('symbol', fullSymbol)
        .order('ts_utc', { ascending: false })
        .limit(1);
      
      if (features && features.length > 0) {
        const f = features[0] as any;
        
        // PRIORITIZATION CHAIN: vol_1h > vol_4h > vol_24h > vol_7d > ret_24h
        let avgVol = 0;
        let volSource = 'none';
        
        if (f.vol_1h && f.vol_1h > 0) {
          avgVol = f.vol_1h;
          volSource = 'vol_1h';
        } else if (f.vol_4h && f.vol_4h > 0) {
          avgVol = f.vol_4h;
          volSource = 'vol_4h';
        } else if (f.vol_24h && f.vol_24h > 0) {
          avgVol = f.vol_24h;
          volSource = 'vol_24h';
        } else if (f.vol_7d && f.vol_7d > 0) {
          avgVol = f.vol_7d;
          volSource = 'vol_7d';
        } else if (f.ret_24h) {
          avgVol = Math.abs(f.ret_24h);
          volSource = 'ret_24h';
        }
        
        // Higher volatility = neutral to slightly negative (riskier)
        // Score: Low vol (<2%) = +0.3, Medium (2-5%) = 0, High (>5%) = -0.3
        let volScore = 0;
        if (avgVol > 0.05) {
          volScore = -0.3; // High volatility = risky
        } else if (avgVol > 0.02) {
          volScore = 0;    // Medium volatility = neutral
        } else if (avgVol > 0) {
          volScore = 0.3;  // Low volatility = favorable
        }
        
        console.log(`📊 [FUSION] Volatility score for ${symbol}: ${volScore.toFixed(3)} | source: ${volSource}, value: ${avgVol?.toFixed(4)}`);
        return volScore;
      }
      
      // Fallback: neutral (no data)
      console.log(`📊 [FUSION] Volatility score for ${symbol}: 0 (no data)`);
      return 0;
      
    } catch (error) {
      console.error('❌ VOLATILITY SCORE: Error calculating volatility score:', error);
      return 0;
    }
  };
  
  const calculateMomentumScore = async (symbol: string, side: 'BUY' | 'SELL'): Promise<number> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      const fullSymbol = symbol.includes('-EUR') ? symbol : `${symbol}-EUR`;
      
      let momentumScore = 0;
      
      // PRIMARY: Use RSI from market_features_v0
      // NOTE: Casting to any because Supabase types are out of sync with actual schema
      const { data: featuresRaw } = await supabase
        .from('market_features_v0')
        .select('*')
        .eq('symbol', fullSymbol)
        .order('ts_utc', { ascending: false })
        .limit(1);
      
      const features = featuresRaw as any[] | null;
      if (features && features.length > 0) {
        const f = features[0];
        // RSI: < 30 = oversold (bullish), > 70 = overbought (bearish)
        if (f.rsi_14) {
          if (f.rsi_14 < 30) {
            momentumScore += 0.5; // Oversold = bullish momentum
          } else if (f.rsi_14 > 70) {
            momentumScore -= 0.5; // Overbought = bearish momentum
          } else {
            momentumScore += (50 - f.rsi_14) / 100; // Neutral zone: slight bias
          }
        }
        // Short-term returns as momentum
        if (f.ret_1h) {
          momentumScore += f.ret_1h * 5; // 1% 1h return = +0.05
        }
      }
      
      // SECONDARY: Check live_signals for RSI signals (CORRECT signal type names!)
      const { data: momentum } = await supabase
        .from('live_signals')
        .select('*')
        .in('symbol', [baseSymbol, fullSymbol, 'ALL'])
        .in('signal_type', [
          'rsi_oversold_bullish',     // CORRECT name from DB
          'rsi_overbought_bearish',   // CORRECT name from DB
          'momentum_bullish', 
          'momentum_bearish'
        ])
        .gte('timestamp', new Date(Date.now() - 86400000).toISOString()) // Last 24h
        .order('timestamp', { ascending: false })
        .limit(10);
      
      if (momentum && momentum.length > 0) {
        momentum.forEach((signal, index) => {
          const weight = 1 / (index + 1);
          const strength = Math.min(1, (signal.signal_strength || 0) / 100); // Normalize
          
          if (signal.signal_type.includes('bullish') || signal.signal_type.includes('oversold')) {
            momentumScore += weight * strength * 0.3;
          } else if (signal.signal_type.includes('bearish') || signal.signal_type.includes('overbought')) {
            momentumScore -= weight * strength * 0.3;
          }
        });
      }
      
      // Adjust for side
      const finalScore = side === 'BUY' ? momentumScore : -momentumScore;
      
      console.log(`📊 [FUSION] Momentum score for ${symbol} (${side}): ${finalScore.toFixed(3)} | features: ${features?.length || 0}, signals: ${momentum?.length || 0}`);
      
      return Math.max(-1, Math.min(1, finalScore));
      
    } catch (error) {
      console.error('❌ MOMENTUM SCORE: Error calculating momentum score:', error);
      return 0;
    }
  };
  
  const calculateWhaleScore = async (symbol: string, side: 'BUY' | 'SELL'): Promise<number> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      
      // Check live_signals for whale-related activity from BOTH sources
      const { data: whaleActivity } = await supabase
        .from('live_signals')
        .select('*')
        .in('symbol', [baseSymbol, 'ALL']) // Whale signals often use 'ALL' for market-wide
        .in('source', ['whale_alert_ws', 'whale_alert_tracked', 'whale_alert']) // ALL whale sources
        .in('signal_type', [
          'whale_exchange_inflow',    // From whale_alert_ws
          'whale_exchange_outflow',   // From whale_alert_ws
          'whale_large_movement',     // From whale_alert_ws
          'whale_movement',           // Generic
          'whale_transfer',           // From QuickNode webhook
          'whale_usdt_injection',
          'whale_usdc_injection'
        ])
        .gte('timestamp', new Date(Date.now() - 3600000).toISOString()) // Last hour
        .order('timestamp', { ascending: false })
        .limit(10);
      
      if (!whaleActivity || whaleActivity.length === 0) {
        console.log(`📊 [FUSION] Whale score for ${symbol}: 0 (no whale signals)`);
        return 0; // No whale data = neutral
      }
      
      let whaleScore = 0;
      whaleActivity.forEach((activity, index) => {
        const weight = 1 / (index + 1);
        const strength = Math.min(1, (activity.signal_strength || 0) / 100);
        
        // Exchange inflow = bearish (selling), outflow = bullish (accumulating)
        if (activity.signal_type.includes('outflow') || activity.signal_type.includes('injection')) {
          whaleScore += weight * strength; // Bullish
        } else if (activity.signal_type.includes('inflow')) {
          whaleScore -= weight * strength; // Bearish
        } else {
          // Generic movement - slightly positive bias
          whaleScore += weight * strength * 0.2;
        }
      });
      
      const finalScore = side === 'BUY' ? whaleScore : -whaleScore;
      
      console.log(`📊 [FUSION] Whale score for ${symbol} (${side}): ${finalScore.toFixed(3)} | signals: ${whaleActivity.length}`);
      
      return Math.max(-1, Math.min(1, finalScore));
      
    } catch (error) {
      console.error('❌ WHALE SCORE: Error calculating whale score:', error);
      return 0;
    }
  };
  
  const calculateSentimentScore = async (symbol: string, side: 'BUY' | 'SELL'): Promise<number> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      
      // Check live_signals for sentiment - INCLUDES news_volume_spike from crypto_news collector!
      const { data: sentimentSignals } = await supabase
        .from('live_signals')
        .select('*')
        .in('symbol', [baseSymbol, 'ALL'])
        .in('signal_type', [
          // Legacy sentiment signal types (rarely used)
          'sentiment_bullish_strong',
          'sentiment_bullish_moderate',
          'sentiment_bearish_strong',
          'sentiment_bearish_moderate',
          'sentiment_mixed_bullish',
          // Fear & Greed index signals - ACTUAL TYPES FROM DB!
          'fear_index_extreme',       // fgValue <= 20 → bullish opportunity
          'fear_index_moderate',      // fgValue > 20 && <= 40 → accumulation
          'greed_index_moderate',     // fgValue >= 60 && < 80 → caution
          'greed_index_extreme',      // fgValue >= 80 → sell opportunity
          'fear_greed_status',        // ADDED: Generic fear/greed status signal
          // NEWS SIGNALS - This is what crypto_news collector actually produces!
          'news_volume_spike',        // Has data.avg_sentiment field!
          'news_volume_high',         // High news volume
          'news_sentiment_bullish',
          'news_sentiment_bearish'
        ])
        .gte('timestamp', new Date(Date.now() - 86400000).toISOString()) // Last 24h
        .order('timestamp', { ascending: false })
        .limit(20);
      
      if (!sentimentSignals || sentimentSignals.length === 0) {
        console.log(`📊 [FUSION] Sentiment score for ${symbol}: 0 (no sentiment signals)`);
        return 0;
      }
      
      let sentimentScore = 0;
      let signalsProcessed = 0;
      
      sentimentSignals.forEach((signal, index) => {
        const weight = 1 / (index + 1);
        const signalData = signal.data as any;
        
        // SPECIAL HANDLING for news_volume_spike - extract avg_sentiment from data field
        if (signal.signal_type === 'news_volume_spike' && signalData?.avg_sentiment !== undefined) {
          // avg_sentiment is 0-1 where 0.5 = neutral, >0.5 = bullish, <0.5 = bearish
          const avgSentiment = signalData.avg_sentiment;
          const sentimentBias = (avgSentiment - 0.5) * 2; // Convert to -1 to +1 range
          sentimentScore += weight * sentimentBias * 0.4; // 0.4 weight for news sentiment
          signalsProcessed++;
          return;
        }
        
        // SPECIAL HANDLING for fear_greed_status - extract value from data field
        if (signal.signal_type === 'fear_greed_status' && signalData?.fear_greed_value !== undefined) {
          const fgValue = signalData.fear_greed_value;
          // Fear/Greed: < 30 = fear (bullish contrarian), > 70 = greed (bearish contrarian)
          let fgScore = 0;
          if (fgValue < 30) {
            fgScore = 0.3; // Extreme fear = bullish opportunity
          } else if (fgValue < 45) {
            fgScore = 0.15; // Fear = moderate bullish
          } else if (fgValue > 70) {
            fgScore = -0.3; // Extreme greed = bearish warning
          } else if (fgValue > 55) {
            fgScore = -0.15; // Greed = moderate bearish
          }
          sentimentScore += weight * fgScore;
          signalsProcessed++;
          return;
        }
        
        // Standard signal processing
        const strength = Math.min(1, (signal.signal_strength || 50) / 100);
        
        if (signal.signal_type.includes('bullish') || signal.signal_type === 'fear_index_extreme' || signal.signal_type === 'fear_index_moderate') {
          // Bullish sentiment OR fear = contrarian bullish
          sentimentScore += weight * strength * 0.5;
          signalsProcessed++;
        } else if (signal.signal_type.includes('bearish') || signal.signal_type === 'greed_index_moderate' || signal.signal_type === 'greed_index_extreme') {
          // Bearish sentiment OR greed = contrarian bearish
          sentimentScore -= weight * strength * 0.5;
          signalsProcessed++;
        }
      });
      
      const finalScore = side === 'BUY' ? sentimentScore : -sentimentScore;
      
      console.log(`📊 [FUSION] Sentiment score for ${symbol} (${side}): ${finalScore.toFixed(3)} | signals: ${sentimentSignals.length}, processed: ${signalsProcessed}`);
      
      return Math.max(-1, Math.min(1, finalScore));
      
    } catch (error) {
      console.error('❌ SENTIMENT SCORE: Error calculating sentiment score:', error);
      return 0;
    }
  };
  
  const calculateConflictPenalty = (bucketScores: any, conflictPenalty: number): number => {
    const scores = Object.values(bucketScores) as number[];
    const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    
    // Calculate variance - higher variance = more conflict
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / scores.length;
    const conflict = Math.sqrt(variance);
    
    return conflict * conflictPenalty;
  };
  
  // Enhanced Decision Snapshot Logging with Value Sources
  const logDecisionSnapshot = async (
    strategy: any,
    symbol: string,
    side: 'BUY' | 'SELL',
    fusionResult: any,
    finalDecision: string,
    finalReason: string,
    brackets: any,
    additionalData?: any
  ) => {
    try {
      const { isAIFusionEnabled } = await import('@/utils/aiConfigHelpers');
      const config = strategy.configuration;
      const isAIEnabled = isAIFusionEnabled(config);
      
      const snapshot = {
        user_id: user!.id,
        strategy_id: strategy.id,
        symbol: symbol.replace('-EUR', ''),
        intent_side: side,
        decision_action: finalDecision,
        decision_reason: finalReason,
        confidence: fusionResult.sTotalScore || 0.5,
        intent_source: isAIEnabled ? 'ai_fusion_engine' : 'standard_engine',
        metadata: {
          // Core AI fusion fields
          s_total: fusionResult.sTotalScore,
          bucket_scores: fusionResult.bucketScores,
          thresholds: {
            enter: fusionResult.effectiveConfig?.enterThreshold || DEFAULT_VALUES.ENTER_THRESHOLD,
            exit: fusionResult.effectiveConfig?.exitThreshold || DEFAULT_VALUES.EXIT_THRESHOLD
          },
          spread_bps: additionalData?.spreadBps || 0,
          depth_ratio: additionalData?.depthRatio || 0,
          atr_entry: additionalData?.atr || 0,
          brackets: brackets,
          gate_blocks: fusionResult.gateBlocks || [],
          fusion_enabled: isAIEnabled,
          
          // NEW: Value sources tracking
          value_sources: fusionResult.valueSources || {},
          effective_config_snapshot: fusionResult.effectiveConfig || {},
          
          // Allocation tracking
          allocation_unit: additionalData?.allocationUnit || config?.allocationUnit || DEFAULT_VALUES.ALLOCATION_UNIT,
          per_trade_allocation: additionalData?.perTradeAllocation || config?.perTradeAllocation || DEFAULT_VALUES.PER_TRADE_ALLOCATION,
          notional: additionalData?.notional || 0,
          
          // Preset info
          preset: config?.riskProfile || 'unknown',
          ts: new Date().toISOString(),
          ...additionalData
        }
      };
      
      await supabase
        .from('trade_decisions_log')
        .insert(snapshot);
      
      engineConsoleLog('📊 DECISION SNAPSHOT:', JSON.stringify(snapshot, null, 2));
      
    } catch (error) {
      console.error('❌ DECISION SNAPSHOT: Failed to log:', error);
    }
  };
  
  const checkTrailingStopLoss = async (config: any, position: Position, currentPrice: number, pnlPercentage: number): Promise<boolean> => {
    const trailingPercentage = config.trailingStopLossPercentage;
    
    // FIXED: Trailing stop should ONLY activate when position is actually profitable
    // Don't trigger trailing stop unless we're in profit
    if (!trailingPercentage || pnlPercentage <= 0) {
      return false;
    }

    // Only activate trailing stop if we've reached a minimum profit threshold
    const minProfitForTrailing = config.trailingStopMinProfitThreshold || 1.0;
    if (pnlPercentage < minProfitForTrailing) {
      return false;
    }

    // For now, we need to track the actual peak price over time
    // Since we don't have peak tracking yet, let's disable trailing stop completely
    // until we implement proper peak tracking
    
    return false;
  };

  // REAL TECHNICAL INDICATORS FROM DATABASE
  const checkTechnicalSellSignals = async (config: any, symbol: string, currentPrice: number): Promise<boolean> => {
    const techConfig = config.technicalIndicatorConfig;
    if (!techConfig) return false;

    try {
      // Get REAL technical signals from live_signals table (this exists!)
      const { data: liveSignals } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', symbol)
        .eq('signal_type', 'technical')
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 10).toISOString())
        .order('timestamp', { ascending: false })
        .limit(20);

      if (liveSignals?.length) {
        // Check for strong bearish signals from REAL data
        const bearishSignals = liveSignals.filter(s => s.signal_strength < -0.4);
        if (bearishSignals.length >= 2) {
          return true;
        }

        // Check for RSI overbought from signal data
        if (techConfig.rsi?.enabled) {
          const rsiSignals = liveSignals.filter(s => 
            s.data && 
            typeof s.data === 'object' && 
            'RSI' in s.data &&
            (s.data as any).RSI >= techConfig.rsi.sellThreshold
          );
          
          if (rsiSignals.length > 0) {
            return true;
          }
        }
      }

    } catch (error) {
      logger.error('ENGINE: Error fetching REAL technical indicators:', error);
    }

    return false;
  };

  const checkBuyOpportunities = async (strategy: any, marketData: any) => {
    const config = strategy.configuration as any;
    const positions = await calculateOpenPositions();
    
    // Check position limits
    if (config.maxActiveCoins && positions.length >= config.maxActiveCoins) {
      return;
    }

    // Get coins to analyze - SOURCE OF TRUTH: strategy.configuration.selectedCoins
    const selectedCoins = config.selectedCoins || [];
    const coinsToAnalyze = selectedCoins.length > 0 
      ? selectedCoins 
      : filterSupportedSymbols(getAllSymbols()).slice(0, 3);
    
    for (const coin of coinsToAnalyze) {
      const symbol = `${coin}-EUR`;
      
      // MARKET AVAILABILITY PREFLIGHT CHECK - Prevent API errors
      const availability = checkMarketAvailability(symbol);
      if (!availability.isSupported) {
        // Log skip reason and continue to next symbol
        await logDecisionSnapshot(
          strategy,
          symbol,
          'BUY',
          { sTotalScore: 0, bucketScores: { trend: 0, volatility: 0, momentum: 0, whale: 0, sentiment: 0 }, gateBlocks: [] },
          'DEFER',
          availability.reason || 'market_unavailable',
          {},
          { 
            allocationUnit: config.allocationUnit || 'euro',
            perTradeAllocation: config.perTradeAllocation || 50,
            notional: 0
          }
        );
        continue;
      }
      
      const currentData = marketData[symbol];
      if (!currentData) continue;

      // Skip if already have position in this coin (unless DCA enabled)
      const hasPosition = positions.some(p => p.cryptocurrency === symbol);
      if (hasPosition && !config.enableDCA) {
        continue;
      }

      // Check if we should buy this coin using REAL signals
      const buySignal = await getBuySignal(config, symbol, marketData, hasPosition);
      if (!buySignal) continue;

      // Execute buy
      await executeBuyOrder(strategy, symbol, currentData.price, buySignal.reason);
    }
  };

  const getBuySignal = async (config: any, symbol: string, marketData: any, hasPosition: boolean): Promise<{reason: string} | null> => {
    const baseSymbol = symbol.replace('-EUR', '');
    
    writeDebugStage('buy_signal_evaluation_start', { 
      symbol, 
      baseSymbol,
      hasPosition,
      hasAIOverride: !!config.aiIntelligenceConfig?.enableAIOverride,
    });
    
    // 1. WHALE SIGNALS CHECK - REAL DATA
    const whaleResult = await checkWhaleSignals(symbol);
    writeDebugStage('buy_signal_whale_check', { symbol, result: whaleResult });
    if (whaleResult) {
      writeDebugStage('buy_signal_found', { symbol, reason: 'WHALE_SIGNAL' });
      return { reason: 'WHALE_SIGNAL' };
    }

    // 2. NEWS SENTIMENT SIGNALS - REAL DATA
    const newsResult = await checkNewsSentimentSignals(config, symbol);
    writeDebugStage('buy_signal_news_check', { symbol, result: newsResult });
    if (newsResult) {
      writeDebugStage('buy_signal_found', { symbol, reason: 'NEWS_SENTIMENT_SIGNAL' });
      return { reason: 'NEWS_SENTIMENT_SIGNAL' };
    }

    // 3. SOCIAL SIGNALS CHECK - REAL DATA
    const socialResult = await checkSocialSignals(config, symbol);
    writeDebugStage('buy_signal_social_check', { symbol, result: socialResult });
    if (socialResult) {
      writeDebugStage('buy_signal_found', { symbol, reason: 'SOCIAL_SIGNAL' });
      return { reason: 'SOCIAL_SIGNAL' };
    }

    // 4. TECHNICAL INDICATOR BUY SIGNALS - REAL DATA (MOST IMPORTANT!)
    const technicalResult = await checkTechnicalBuySignals(config, symbol, marketData);
    writeDebugStage('buy_signal_technical_check', { symbol, result: technicalResult });
    if (technicalResult) {
      writeDebugStage('buy_signal_found', { symbol, reason: 'TECHNICAL_SIGNAL' });
      return { reason: 'TECHNICAL_SIGNAL' };
    }

    // 5. AI BUY DECISION (combines all signals) - REAL DATA
    if (config.aiIntelligenceConfig?.enableAIOverride) {
      const aiResult = await checkAIBuySignal(config, symbol, marketData);
      writeDebugStage('buy_signal_ai_check', { symbol, result: aiResult });
      if (aiResult) {
        writeDebugStage('buy_signal_found', { symbol, reason: 'AI_COMPREHENSIVE_SIGNAL' });
        return { reason: 'AI_COMPREHENSIVE_SIGNAL' };
      }
    }

    writeDebugStage('buy_signal_none_found', { 
      symbol, 
      checkedSources: ['whale', 'news', 'social', 'technical', config.aiIntelligenceConfig?.enableAIOverride ? 'ai' : 'ai_disabled'],
    });
    return null;
  };

  // WHALE SIGNALS from whale_signal_events table - REAL IMPLEMENTATION
  // Table schema: id, source_id, user_id, event_type, transaction_hash, amount, 
  //               from_address, to_address, token_symbol, blockchain, timestamp, raw_data, processed, created_at
  const checkWhaleSignals = async (symbol: string): Promise<boolean> => {
    try {
      const cryptoSymbol = symbol.split('-')[0];
      
      type WhaleSignalEvent = {
        id: string;
        created_at: string;
        token_symbol: string;  // FIXED: correct column name
        event_type?: string;
        amount?: number;       // FIXED: correct column name (was 'size')
        timestamp?: string;
        processed?: boolean;
        raw_data?: any;
      };

      // Check for whale signals in the whale_signal_events table
      // Using correct column name: token_symbol (not 'symbol')
      const whaleRows = await fromTable('whale_signal_events')
        .select('*')
        .eq('token_symbol', cryptoSymbol)  // FIXED: use token_symbol
        .gte('created_at', new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString())
        .order('created_at', { ascending: false })
        .limit(10);

      const whaleSignals: WhaleSignalEvent[] = Array.isArray(whaleRows.data) ? whaleRows.data as any : [];

      if (whaleSignals?.length) {
        // Check for significant whale activity (large amounts)
        // Using correct column name: amount (not 'size')
        function hasAmount(x: any): x is { amount: number } {
          return x && typeof x.amount === 'number';
        }
        
        const largeTransactions = whaleSignals.filter(hasAmount).filter(signal => 
          signal.amount > 100000 // Large whale transactions
        );

        if (largeTransactions.length > 0) {
          return true;
        }
      }

      // Also check live_signals for whale-related signals
      const { data: liveWhaleSignals } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', symbol)
        .eq('signal_type', 'whale')
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString())
        .order('timestamp', { ascending: false })
        .limit(5);

      if (liveWhaleSignals?.length) {
        const strongWhaleSignals = liveWhaleSignals.filter(s => s.signal_strength > 0.6);
        if (strongWhaleSignals.length > 0) {
          return true;
        }
      }

    } catch (error) {
      console.error('❌ ENGINE: Error checking REAL whale signals:', error);
    }
    return false;
  };

  // NEWS SENTIMENT from existing data sources - REAL IMPLEMENTATION
  const checkNewsSentimentSignals = async (config: any, symbol: string): Promise<boolean> => {
    try {
      const newsWeight = config.aiIntelligenceConfig?.newsImpactWeight || 30;
      if (newsWeight === 0) return false;

      const cryptoSymbol = symbol.split('-')[0];
      
      // Check live_signals for news/sentiment signals (this exists!)
      const { data: newsSignals } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', symbol)
        .in('signal_type', ['news', 'sentiment'])
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString())
        .order('timestamp', { ascending: false })
        .limit(20);


      if (newsSignals?.length) {
        // Calculate average sentiment from REAL signals
        const sentimentScores = newsSignals.map(signal => signal.signal_strength);
        const avgSentiment = sentimentScores.reduce((sum, score) => sum + score, 0) / sentimentScores.length;
        
        // Count positive signals
        const positiveSignals = newsSignals.filter(signal => signal.signal_strength > 0.3);
        const sentimentThreshold = 0.3 + (newsWeight / 200);
        
        

        if (avgSentiment > sentimentThreshold && positiveSignals.length >= 2) {
          
          return true;
        }
      }

      // Also check external_market_data for news-related data
      const { data: externalNews } = await supabase
        .from('external_market_data')
        .select('*')
        .eq('cryptocurrency', cryptoSymbol)
        .in('data_type', ['news_sentiment', 'sentiment_analysis'])
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString())
        .order('timestamp', { ascending: false })
        .limit(10);

      if (externalNews?.length) {
        const avgExternalSentiment = externalNews.reduce((sum, data) => sum + (data.data_value || 0), 0) / externalNews.length;
        if (avgExternalSentiment > 0.6) {
          
          return true;
        }
      }

    } catch (error) {
      console.error('❌ ENGINE: Error checking REAL news sentiment:', error);
    }
    return false;
  };

  // SOCIAL SIGNALS from external_market_data table - REAL IMPLEMENTATION
  const checkSocialSignals = async (config: any, symbol: string): Promise<boolean> => {
    try {
      const socialWeight = config.aiIntelligenceConfig?.socialSignalsWeight || 15;
      if (socialWeight === 0) return false;

      const { data: socialData } = await supabase
        .from('external_market_data')
        .select('data_value, data_type, metadata')
        .eq('cryptocurrency', symbol.split('-')[0])
        .in('data_type', ['social_volume', 'social_sentiment', 'reddit_mentions'])
        .gte('timestamp', new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString())
        .order('timestamp', { ascending: false })
        .limit(20);

      engineConsoleLog('📱 ENGINE: Checking REAL social signals for', symbol, '- found:', socialData?.length || 0);

      if (socialData?.length) {
        const socialScores = socialData.map(data => data.data_value || 0);
        const avgSocialScore = socialScores.reduce((sum, score) => sum + score, 0) / socialScores.length;
        
        if (avgSocialScore > 0.7) {
          engineConsoleLog('📱 ENGINE: REAL strong social signal for', symbol, '- score:', avgSocialScore);
          return true;
        }
      }
    } catch (error) {
      console.error('❌ ENGINE: Error checking REAL social signals:', error);
    }
    return false;
  };

  // TECHNICAL INDICATORS - REAL IMPLEMENTATION
  // FIXED: Query for ACTUAL signal types in live_signals table:
  // - ma_cross_bullish, ma_cross_bearish
  // - rsi_oversold_bullish, rsi_overbought_bearish
  // - momentum_bullish, momentum_bearish
  // - trend_bullish, trend_bearish
  const checkTechnicalBuySignals = async (config: any, symbol: string, marketData: any): Promise<boolean> => {
    // REMOVED: techConfig check - allow signals even without explicit config
    // This was blocking all signal detection when technicalIndicatorConfig was undefined

    let signals = 0;
    let totalIndicators = 0;
    const baseSymbol = symbol.replace('-EUR', '');

    try {
      // FIXED: Query for ACTUAL signal types that exist in the database
      // The old code queried for signal_type='technical' which doesn't exist!
      const bullishSignalTypes = [
        'ma_cross_bullish',
        'rsi_oversold_bullish', 
        'momentum_bullish',
        'trend_bullish',
        'macd_bullish'
      ];

      // EXTENDED: 24h lookback in Test Mode to validate pipe with older signals; 4h default otherwise
      const baseLookbackMs = 1000 * 60 * 60 * 4;      // 4h default
      const testModeLookbackMs = 1000 * 60 * 60 * 24; // 24h in test mode
      const lookbackMs = (config?.is_test_mode || config?.enableTestTrading)
        ? testModeLookbackMs
        : baseLookbackMs;
      const { data: liveSignals, error: queryError } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', baseSymbol)
        .in('signal_type', bullishSignalTypes)
        .gte('timestamp', new Date(Date.now() - lookbackMs).toISOString())
        .order('timestamp', { ascending: false })
        .limit(20);

      // TASK 2: Log exactly what checkTechnicalBuySignals sees from Supabase
      writeDebugStage('buy_opportunity_technical_query_result', {
        symbol: baseSymbol,
        signalTypes: bullishSignalTypes,
        windowMs: lookbackMs,
        rowsCount: liveSignals?.length ?? 0,
        rowsSample: (liveSignals || []).slice(0, 3).map(s => ({
          signal_type: s.signal_type,
          signal_strength: s.signal_strength,
          timestamp: s.timestamp,
          source: s.source,
        })),
        queryError: queryError?.message || null,
      });

      engineConsoleLog('🔍 ENGINE: Analyzing REAL technical signals for', baseSymbol);
      engineConsoleLog('📊 ENGINE: Live bullish signals count:', liveSignals?.length || 0);

      if (liveSignals && liveSignals.length > 0) {
        // Count bullish signals with positive strength
        const validBullishSignals = liveSignals.filter(s => s.signal_strength > 0);
        
        writeDebugStage('technical_signals_analysis', {
          symbol: baseSymbol,
          totalBullish: liveSignals.length,
          validBullish: validBullishSignals.length,
        });

        // ANY bullish signal with positive strength is a buy signal
        if (validBullishSignals.length >= 1) {
          engineConsoleLog('📊 ENGINE: Found', validBullishSignals.length, 'bullish signals for', baseSymbol);
          signals++;
          totalIndicators++;
        }

        // Check for RSI oversold specifically (strong buy signal)
        const rsiOversold = liveSignals.filter(s => s.signal_type === 'rsi_oversold_bullish');
        if (rsiOversold.length > 0) {
          engineConsoleLog('📊 ENGINE: RSI oversold signal detected for', baseSymbol);
          signals++;
          totalIndicators++;
        }

        // Check for MA cross bullish
        const maCrossBullish = liveSignals.filter(s => s.signal_type === 'ma_cross_bullish');
        if (maCrossBullish.length > 0) {
          engineConsoleLog('📊 ENGINE: MA cross bullish signal detected for', baseSymbol);
          signals++;
          totalIndicators++;
        }
      }

      // If no bullish signals found, check if there are ANY recent signals at all
      if (!liveSignals || liveSignals.length === 0) {
        // Also query for recent signals of any type to understand signal flow
        const { data: anySignals } = await supabase
          .from('live_signals')
          .select('signal_type, signal_strength, timestamp')
          .eq('symbol', baseSymbol)
          .gte('timestamp', new Date(Date.now() - 1000 * 60 * 60).toISOString()) // Last hour
          .order('timestamp', { ascending: false })
          .limit(5);

        writeDebugStage('technical_signals_fallback_query', {
          symbol: baseSymbol,
          anySignalsFound: anySignals?.length || 0,
          sampleSignals: anySignals?.map(s => ({ type: s.signal_type, strength: s.signal_strength })) || [],
        });
      }

      // Ensure we always have at least 1 indicator counted to avoid division by zero
      if (totalIndicators === 0) {
        totalIndicators = 1;
      }

      const signalStrength = signals / totalIndicators;
      const threshold = 0.0; // TESTING: zero threshold - any signal triggers

      writeDebugStage('technical_signals_decision', {
        symbol: baseSymbol,
        signals,
        totalIndicators,
        signalStrength,
        threshold,
        shouldBuy: signalStrength >= threshold,
      });

      engineConsoleLog('📊 ENGINE: Technical signal strength:', signalStrength, 'threshold:', threshold, 'result:', signalStrength >= threshold);
      return signalStrength >= threshold;

    } catch (error) {
      console.error('❌ ENGINE: Error fetching REAL technical indicators:', error);
      return false;
    }
  };

  // AI COMPREHENSIVE SIGNAL - REAL IMPLEMENTATION
  const checkAIBuySignal = async (config: any, symbol: string, marketData: any): Promise<boolean> => {
    try {
      const aiConfig = config.aiIntelligenceConfig;
      if (!aiConfig?.enableAIOverride) return false;

      let signalStrength = 0;
      let maxSignalStrength = 0;

      // Weight different signals based on AI config
      const weights = {
        technical: 0.4,
        news: (aiConfig.newsImpactWeight || 30) / 100,
        social: (aiConfig.socialSignalsWeight || 15) / 100,
        whale: (aiConfig.whaleActivityWeight || 25) / 100
      };

      // Technical indicators
      if (await checkTechnicalBuySignals(config, symbol, marketData)) {
        signalStrength += weights.technical;
      }
      maxSignalStrength += weights.technical;

      // News sentiment
      if (await checkNewsSentimentSignals(config, symbol)) {
        signalStrength += weights.news;
      }
      maxSignalStrength += weights.news;

      // Social signals
      if (await checkSocialSignals(config, symbol)) {
        signalStrength += weights.social;
      }
      maxSignalStrength += weights.social;

      // Whale activity
      if (await checkWhaleSignals(symbol)) {
        signalStrength += weights.whale;
      }
      maxSignalStrength += weights.whale;

      const aiConfidence = maxSignalStrength > 0 ? (signalStrength / maxSignalStrength) * 100 : 0;
      const confidenceThreshold = aiConfig.aiConfidenceThreshold || 0; // TESTING: zero threshold

      if (aiConfidence >= confidenceThreshold) {
        engineConsoleLog('🤖 ENGINE: REAL AI comprehensive buy signal for', symbol, '- confidence:', aiConfidence + '%');
        return true;
      }

      engineConsoleLog('🤖 ENGINE: AI signal below threshold for', symbol, '- confidence:', aiConfidence + '%');
    } catch (error) {
      console.error('❌ ENGINE: Error in REAL AI buy signal analysis:', error);
    }
    return false;
  };

  const executeBuyOrder = async (strategy: any, symbol: string, marketPrice: number, reason: string) => {
    // ============= PHASE D: BLOCK ALL AUTOMATIC FRONTEND BUYs =============
    if (FRONTEND_ENGINE_DISABLED) {
      console.warn('[FRONTEND_BUY_BLOCKED] Frontend BUY disabled during backend cutover -', symbol, 'BUY blocked');
      return;
    }
    // ======================================================================
    engineConsoleLog('💰 ENGINE: Executing buy order for', symbol, 'reason:', reason);
    await executeTrade(strategy, 'buy', symbol, marketPrice, undefined, reason);
  };

  // Position Management
  // NOTE: This calculates POOLED positions per symbol (Σ BUYs - Σ SELLs)
  // For lot-level tracking, see lotEngine.ts
  const calculateOpenPositions = async (): Promise<Position[]> => {
    if (!user?.id) return [];

    engineLog('POSITIONS: Starting POOLED position calculation for user: ' + user.id);

    const { data: buyTrades } = await supabase
      .from('mock_trades')
      .select('*')
      .eq('user_id', user.id)
      .eq('trade_type', 'buy')
      .eq('is_test_mode', true)
      .order('executed_at', { ascending: true });

    const { data: sellTrades } = await supabase
      .from('mock_trades')
      .select('*')
      .eq('user_id', user.id)
      .eq('trade_type', 'sell')
      .eq('is_test_mode', true);

    engineLog('POSITIONS: Buy trades (lots) found: ' + (buyTrades?.length || 0));
    engineLog('POSITIONS: Sell trades found: ' + (sellTrades?.length || 0));
    
    // Count sells with/without original_trade_id for debugging
    // Cast to any to access original_trade_id which exists in DB but not in strict types
    const sellsWithLotId = sellTrades?.filter(t => (t as any).original_trade_id)?.length || 0;
    const sellsWithoutLotId = sellTrades?.filter(t => !(t as any).original_trade_id)?.length || 0;
    engineLog(`POSITIONS: Sells with original_trade_id: ${sellsWithLotId}, without: ${sellsWithoutLotId}`);

    if (!buyTrades) return [];

    const positions: Record<string, Position> = {};

    // Add buy trades with normalized symbols (POOLED aggregation)
    buyTrades.forEach(trade => {
      // Normalize symbol - remove -EUR suffix if present
      const symbol = trade.cryptocurrency.replace('-EUR', '');
      if (!positions[symbol]) {
        positions[symbol] = {
          cryptocurrency: symbol,
          total_amount: 0,
          total_value: 0,
          remaining_amount: 0,
          average_price: 0,
          oldest_purchase_date: trade.executed_at
        };
      }
      positions[symbol].total_amount += trade.amount;
      positions[symbol].total_value += trade.total_value;
      positions[symbol].remaining_amount += trade.amount;
      
      if (trade.executed_at < positions[symbol].oldest_purchase_date) {
        positions[symbol].oldest_purchase_date = trade.executed_at;
      }
    });

    // Subtract sell trades with normalized symbols (POOLED deduction)
    if (sellTrades) {
      sellTrades.forEach(trade => {
        // Normalize symbol - remove -EUR suffix if present
        const symbol = trade.cryptocurrency.replace('-EUR', '');
        if (positions[symbol]) {
          positions[symbol].remaining_amount -= trade.amount;
          
          // Remove position if completely sold
          if (positions[symbol].remaining_amount <= 0.000001) {
            delete positions[symbol];
          }
        }
      });
    }

    // Filter and calculate averages
    const finalPositions = Object.values(positions).filter(pos => {
      if (pos.remaining_amount > 0.00000001) {
        pos.average_price = pos.total_value / pos.total_amount;
        return true;
      }
      return false;
    });

    // Log pooled summary for debugging (ENGINE level)
    console.log('[ENGINE][POSITIONS] Pooled positions summary:', {
      totalSymbols: finalPositions.length,
      positions: finalPositions.map(p => ({
        symbol: p.cryptocurrency,
        remaining: p.remaining_amount.toFixed(8),
        avgPrice: p.average_price.toFixed(2),
        oldestDate: p.oldest_purchase_date
      }))
    });

    return finalPositions;
  };

  const executeTrade = async (
    strategy: any, 
    action: 'buy' | 'sell', 
    cryptocurrency: string, 
    price: number, 
    customAmount?: number,
    trigger?: string,
    context?: 'ENTRY' | 'TP' | 'SL' | 'MANUAL',
    sellMetadata?: { closeMode?: string; tpThresholdPct?: number; minHoldMs?: number }
  ) => {
    // DEBUG INSTRUMENTATION: Track BUY execution pipeline
    writeDebugStage('execute_trade_called', {
      action,
      cryptocurrency,
      price,
      customAmount,
      trigger,
      context,
      strategyId: strategy?.id,
      userId: user?.id,
      timestamp: new Date().toISOString()
    });
    console.log('[DEBUG][executeTrade] CALLED:', { action, cryptocurrency, price, trigger, context });
    
    engineConsoleLog('🔧 ENGINE: executeTrade called with action:', action, 'symbol:', cryptocurrency, 'context:', context);
    
    const { isAIFusionEnabled } = await import('@/utils/aiConfigHelpers');
    const config = strategy.configuration;
    const isAIEnabled = isAIFusionEnabled(config);
    
    // Determine context based on trigger if not explicitly provided
    const tradeContext = context || (
      trigger === 'TAKE_PROFIT' ? 'TP' :
      trigger === 'STOP_LOSS' ? 'SL' :
      action === 'buy' ? 'ENTRY' : 'MANUAL'
    );
    
    // ========================================================================
    // FUSION BYPASS LOGIC - CRITICAL ARCHITECTURE DECISION
    // ========================================================================
    // 
    // RULE 1: HARD RISK EXITS (TP/SL/timeout) NEVER go through fusion.
    //         Fusion is AI intelligence; risk rules are protection.
    //         Fusion can NEVER override hard risk exits.
    //
    // RULE 2: BUY entries ALWAYS go through fusion (no hidden test bypasses).
    //         This ensures consistent behavior between test and production.
    //
    // RULE 3: Only explicit debug triggers bypass fusion for BUYs.
    //         These are clearly marked and disabled by default.
    // ========================================================================
    
    // HARD RISK EXITS: Always bypass fusion (TP/SL/timeout are non-negotiable)
    const isHardRiskExit = 
      trigger === 'TAKE_PROFIT' ||
      trigger === 'STOP_LOSS' ||
      trigger === 'TRAILING_STOP' ||
      trigger === 'AUTO_CLOSE_TIME';
    
    // DEBUG-ONLY BYPASSES: Explicit debug triggers (disabled by default, manual activation only)
    const isDebugBypass = 
      trigger === 'debug_force_buy' ||
      trigger === 'FORCED_DEBUG_TRADE';
    
    // Determine if we should skip fusion
    const shouldSkipFusion = isHardRiskExit || isDebugBypass;
    
    if (isAIEnabled && !shouldSkipFusion) {
      // NORMAL PATH: All BUYs and discretionary SELLs go through fusion
      engineConsoleLog('🧠 AI-FUSION: Evaluating signal fusion for', action, cryptocurrency, 'context:', tradeContext);
      
      writeDebugStage('execute_trade_ai_fusion_start', { action, cryptocurrency, tradeContext });
      
      const fusionResult = await evaluateSignalFusion(strategy, cryptocurrency, action.toUpperCase() as 'BUY' | 'SELL', tradeContext);
      
      // Enhanced brackets for ScalpSmart
      const brackets = calculateScalpSmartBrackets(config, price);
      
      // Log decision snapshot (all attempts, even deferred)
      await logDecisionSnapshot(
        strategy, 
        cryptocurrency, 
        action.toUpperCase() as 'BUY' | 'SELL',
        fusionResult,
        fusionResult.decision,
        fusionResult.reason,
        brackets,
        { price, trigger, atr: 0 } // TODO: Add real ATR
      );
      
      // Check fusion decision
      if (fusionResult.decision === 'DEFER') {
        writeDebugStage('execute_trade_deferred_by_fusion', { reason: fusionResult.reason });
        console.log('[DEBUG][executeTrade] DEFERRED by fusion:', fusionResult.reason);
        engineConsoleLog('🚫 SCALPSMART: Trade deferred -', fusionResult.reason);
        Toast.info(`${cryptocurrency} ${action} deferred: ${fusionResult.reason}`);
        return;
      }
      
      if (fusionResult.decision === 'HOLD') {
        writeDebugStage('execute_trade_held_by_fusion', { reason: fusionResult.reason });
        console.log('[DEBUG][executeTrade] HELD by fusion:', fusionResult.reason);
        engineConsoleLog('⏸️ SCALPSMART: Signal too weak -', fusionResult.reason);
        return;
      }
      
      // Proceed with fusion-approved trade
      writeDebugStage('execute_trade_fusion_approved', { score: fusionResult.sTotalScore, reason: fusionResult.reason });
      engineConsoleLog('✅ SCALPSMART: Signal fusion approved -', fusionResult.reason, 'Score:', fusionResult.sTotalScore);
      
    } else if (isHardRiskExit) {
      // HARD RISK EXIT PATH: TP/SL/timeout bypass fusion unconditionally
      console.log(`🛡️ [RISK_EXIT] Hard risk exit bypasses fusion: ${trigger}`, {
        action,
        cryptocurrency,
        tradeContext,
        trigger,
        reason: 'hard_risk_rule_always_executes'
      });
      writeDebugStage('execute_trade_hard_risk_exit_bypass', { 
        trigger, 
        action, 
        cryptocurrency,
        reason: 'TP/SL/timeout are hard risk rules - fusion cannot block' 
      });
      
    } else if (isDebugBypass) {
      // DEBUG PATH: Explicit debug triggers only (for development)
      console.log(`🧪 [DEBUG_BYPASS] Debug trigger bypasses fusion: ${trigger}`, {
        action,
        cryptocurrency,
        tradeContext,
        trigger
      });
      writeDebugStage('execute_trade_debug_bypass', { 
        trigger, 
        action, 
        cryptocurrency,
        reason: 'explicit_debug_trigger' 
      });
    }
    
    if (!user?.id) {
      writeDebugStage('execute_trade_no_user', { reason: 'no_authenticated_user' });
      console.error('[DEBUG][executeTrade] NO USER - cannot execute');
      console.error('❌ ENGINE: Cannot execute trade - no authenticated user');
      return;
    }

    // INTELLIGENT ENGINE: Always use coordinator path to produce source: 'intelligent'
    // This ensures all intelligent engine decisions are routed through the coordinator
    // with proper metadata (engine, engineFeatures, etc.) for learning loop visibility.
    
    // DEBUG STAGE: before_emit_trade_intent
    writeDebugStage('before_emit_trade_intent', {
      side: action,
      reason: trigger || `Intelligent engine ${action}`,
      symbol: cryptocurrency,
      strategyId: strategy.id,
    });
    
    writeDebugStage('execute_trade_calling_coordinator', {
      action,
      cryptocurrency,
      price,
      strategyId: strategy.id,
      userId: user.id
    });
    console.log('[DEBUG][executeTrade] Calling emitTradeIntentToCoordinator...');
    
    engineConsoleLog('🎯 INTELLIGENT ENGINE: Using coordinator path (source: intelligent)');
    return await emitTradeIntentToCoordinator(strategy, action, cryptocurrency, price, customAmount, trigger, sellMetadata);
  };

  // Helper: Run coordinator-approved mock BUY (gates + mock_trades insert)
  // If preApprovedDecision is provided, skips the coordinator call and uses it directly
  const runCoordinatorApprovedMockBuy = async (params: {
    userId: string;
    strategyId: string;
    symbol: string;         // e.g. 'BTC-EUR'
    baseSymbol: string;     // e.g. 'BTC'
    qty: number;
    price: number;
    reason: string;
    confidence: number;
    strategyTrigger: string;  // 'FORCED_DEBUG_TRADE' | 'INTELLIGENT_AUTO'
    extraMetadata?: Record<string, any>;
    preApprovedDecision?: any; // Optional: reuse existing coordinator decision (skip second call)
  }) => {
    const {
      userId,
      strategyId,
      symbol,
      baseSymbol,
      qty,
      price,
      reason,
      confidence,
      strategyTrigger,
      extraMetadata = {},
      preApprovedDecision
    } = params;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let raw: any;
    let coordinatorAction: string | null;
    let coordinatorReason: string | null;
    let coordinatorRequestId: string | null;

    if (preApprovedDecision) {
      // REUSE existing coordinator decision (no second call)
      console.log(`[${strategyTrigger}] Using preApprovedDecision (no new coordinator call)`, {
        action: preApprovedDecision?.action,
        reason: preApprovedDecision?.reason,
      });
      
      raw = { ok: true, decision: preApprovedDecision };
      coordinatorAction = preApprovedDecision?.action ?? null;
      coordinatorReason = preApprovedDecision?.reason ?? null;
      coordinatorRequestId = preApprovedDecision?.request_id ?? null;
    } else {
      // Build coordinator intent and call (for forced debug path)
      const intent = {
        userId,
        strategyId,
        symbol,
        side: 'BUY' as const,
        source: 'intelligent' as const,
        confidence,
        reason,
        qtySuggested: qty,
        metadata: {
          mode: 'mock',
          engine: 'intelligent',
          is_test_mode: true,
          ...extraMetadata,
        },
        ts: new Date().toISOString(),
        idempotencyKey: `${strategyTrigger.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      console.log(`[${strategyTrigger}] Emitting intent to coordinator:`, JSON.stringify(intent, null, 2));

      // Call coordinator
      const { data: decision, error } = await supabase.functions.invoke('trading-decision-coordinator', {
        body: { intent }
      });

      console.log(`[${strategyTrigger}] Coordinator response:`, JSON.stringify(decision), 'error:', error);

      // Parse response - handle both string and object formats
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawAny: any = decision;

      try {
        if (typeof rawAny === 'string') {
          raw = JSON.parse(rawAny);
        } else {
          raw = rawAny ?? {};
        }
      } catch (e) {
        console.error(`[${strategyTrigger}] Failed to parse coordinator response as JSON`, { rawAny, error: e });
        raw = {};
      }

      console.log(`[${strategyTrigger}] Raw coordinator shape:`, {
        typeofRaw: typeof raw,
        keys: typeof raw === 'object' && raw != null ? Object.keys(raw) : null,
        nestedDecisionKeys:
          raw && typeof raw === 'object' && raw.decision && typeof raw.decision === 'object'
            ? Object.keys(raw.decision)
            : null
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inner: any = (raw && typeof raw === 'object' && raw.decision) ? raw.decision : {};

      coordinatorAction = inner.action ?? raw.action ?? null;
      coordinatorReason = inner.reason ?? raw.reason ?? null;
      coordinatorRequestId = inner.request_id ?? raw.request_id ?? null;
    }

    const isApproved: boolean = raw.ok === true && coordinatorAction === 'BUY';

    console.log(`[${strategyTrigger}] Coordinator response (normalized):`, {
      ok: raw.ok,
      action: coordinatorAction,
      reason: coordinatorReason,
      requestId: coordinatorRequestId,
    });

    if (!isApproved) {
      console.log(`[${strategyTrigger}] Coordinator did NOT approve BUY`, {
        ok: raw.ok,
        action: coordinatorAction,
        reason: coordinatorReason
      });
      return { success: false, reason: coordinatorReason || 'not_approved', normalizedDecision: { action: coordinatorAction, reason: coordinatorReason } };
    }

    // =========================================================================
    // PHASE 1 FIX: REMOVE FRONTEND TRADE INSERTION
    // =========================================================================
    // The coordinator is the ONLY component allowed to insert into mock_trades.
    // Frontend should NOT insert trades directly - coordinator already did this.
    // 
    // Previously, this block would insert a duplicate trade row with notes like
    // "Automatic intelligent engine trade via coordinator".
    // 
    // Now we simply return success and trust the coordinator's insertion.
    // =========================================================================
    
    console.log(`[${strategyTrigger}] Coordinator APPROVED - trade already inserted by coordinator (no frontend insert)`);

    // Extract trade ID from coordinator response if available
    const coordinatorTradeId = raw?.decision?.trade_id || raw?.trade_id || null;

    // Update local wallet balances (for UI consistency only)
    const totalValue = qty * price;
    const eurBalance = getBalance('EUR');
    if (eurBalance >= totalValue) {
      updateBalance('EUR', -totalValue);
      updateBalance(baseSymbol, qty);
      console.log(`[${strategyTrigger}] Updated local balances (UI only)`);
    }

    return {
      success: true,
      mockTradeId: coordinatorTradeId,
      normalizedDecision: { action: coordinatorAction, reason: coordinatorReason, requestId: coordinatorRequestId }
    };
  };

  // NEW: Emit trade intent to coordinator
  const emitTradeIntentToCoordinator = async (
    strategy: any, 
    action: 'buy' | 'sell', 
    cryptocurrency: string, 
    price: number, 
    customAmount?: number,
    trigger?: string,
    sellMetadata?: { closeMode?: string; tpThresholdPct?: number; minHoldMs?: number }
  ) => {
    writeDebugStage('emit_coordinator_start', { action, cryptocurrency, price, trigger, sellMetadata });
    console.log('[DEBUG][emitTradeIntentToCoordinator] START:', { action, cryptocurrency, price, sellMetadata });
    
    try {
      // Fetch latest technical features for this symbol (hardcode 1h granularity for now)
      const normalizedSymbol = cryptocurrency.includes('-EUR') ? cryptocurrency : `${cryptocurrency}-EUR`;
      let engineFeatures = null;
      try {
        engineFeatures = await getFeaturesForEngine(normalizedSymbol, '1h');
        if (engineFeatures) {
          engineConsoleLog('[Engine] Features attached for', normalizedSymbol, '| RSI:', engineFeatures.rsi_14, '| granularity: 1h');
        } else {
          engineConsoleLog('[Engine] No features found for', normalizedSymbol, '/ 1h');
        }
      } catch (featErr) {
        if (!isLogSuppressed()) console.warn('[Engine] Failed to fetch features for', normalizedSymbol, featErr);
      }

      const intent = {
        userId: user!.id,
        strategyId: strategy.id,
        symbol: normalizedSymbol,
        side: action.toUpperCase() as 'BUY' | 'SELL',
        source: 'intelligent' as const, // Always 'intelligent' for frontend engine decisions
        confidence: 0.75, // Default confidence for intelligent engine
        reason: trigger || `Intelligent engine ${action}`,
        qtySuggested: customAmount || Math.max(10, (strategy.configuration?.perTradeAllocation || 50)) / price,
        metadata: {
          engine: 'intelligent',
          price: price,
          symbol_normalized: cryptocurrency.replace('-EUR', ''),
          trigger: trigger,
          engineFeatures: engineFeatures, // can be null if fetch failed
          is_test_mode: testMode, // Include test mode flag in metadata
          // SELL-specific metadata for hybrid lot model
          ...(action === 'sell' && sellMetadata ? {
            closeMode: sellMetadata.closeMode || 'MANUAL_SYMBOL',
            tpThresholdPct: sellMetadata.tpThresholdPct || 3,
            minHoldMs: sellMetadata.minHoldMs || 300000
          } : {})
        },
        ts: new Date().toISOString(),
        idempotencyKey: `idem_${Math.floor(Date.now() / 1000)}_${Math.random().toString(36).substr(2, 9)}`
      };

      writeDebugStage('emit_coordinator_payload_ready', {
        userId: intent.userId,
        strategyId: intent.strategyId,
        symbol: intent.symbol,
        side: intent.side,
        source: intent.source,
        qtySuggested: intent.qtySuggested,
        is_test_mode: intent.metadata.is_test_mode
      });
      console.log('[DEBUG][emitTradeIntentToCoordinator] PAYLOAD READY:', JSON.stringify(intent, null, 2));

      engineConsoleLog('🎯 INTELLIGENT: Emitting intent to coordinator:', JSON.stringify(intent, null, 2));

      writeDebugStage('emit_coordinator_before_fetch', { timestamp: new Date().toISOString() });
      console.log('[DEBUG][emitTradeIntentToCoordinator] CALLING supabase.functions.invoke...');
      
      const { data: decision, error } = await supabase.functions.invoke('trading-decision-coordinator', {
        body: { intent }
      });

      writeDebugStage('emit_coordinator_after_fetch', {
        hasError: !!error,
        errorMessage: error?.message || null,
        hasDecision: !!decision,
        decisionAction: decision?.decision?.action || decision?.action || null,
        decisionReason: decision?.decision?.reason || decision?.reason || null,
        rawResponse: decision
      });
      console.log('[DEBUG][emitTradeIntentToCoordinator] RESPONSE:', { error, decision: JSON.stringify(decision) });

      // Handle Supabase client errors (network, auth, etc.)
      if (error) {
        writeDebugStage('emit_coordinator_error', { errorMessage: error.message });
        console.error('[DEBUG][emitTradeIntentToCoordinator] ERROR from coordinator:', error);
        console.error('❌ INTELLIGENT: Coordinator call failed:', error);
        Toast.error(`Network error processing ${action} for ${cryptocurrency}: ${error.message}`);
        return;
      }

      // Handle coordinator responses
      if (!decision) {
        writeDebugStage('emit_coordinator_no_decision', { reason: 'null_response' });
        console.error('[DEBUG][emitTradeIntentToCoordinator] NO DECISION returned');
        console.error('❌ INTELLIGENT: No decision returned from coordinator');
        Toast.error(`No response from trading coordinator for ${action} on ${cryptocurrency}`);
        return;
      }

      writeDebugStage('emit_coordinator_complete', {
        action: decision?.decision?.action || decision?.action,
        reason: decision?.decision?.reason || decision?.reason,
        ok: decision?.ok
      });
      console.log('[DEBUG][emitTradeIntentToCoordinator] COMPLETE:', decision);
      
      engineConsoleLog('📋 INTELLIGENT: Coordinator decision:', JSON.stringify(decision, null, 2));

      // NEW: For automatic intelligent BUYs in test mode, execute the mock trade if coordinator approves
      if (testMode && action === 'buy') {
        console.log('[INTELLIGENT_AUTO] Test mode BUY - reusing coordinator decision (no second call)');
        
        // Parse the already-received coordinator decision
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let parsedDecision: any;
        try {
          if (typeof decision === 'string') {
            parsedDecision = JSON.parse(decision);
          } else {
            parsedDecision = decision ?? {};
          }
        } catch {
          parsedDecision = decision ?? {};
        }
        
        // Extract the inner decision object
        const innerDecision = parsedDecision?.decision ?? parsedDecision ?? {};
        
        console.log('[INTELLIGENT_AUTO] Parsed coordinator decision:', {
          ok: parsedDecision?.ok,
          action: innerDecision?.action,
          reason: innerDecision?.reason
        });
        
        // Early return if coordinator did not approve BUY (avoid unnecessary second call)
        if (parsedDecision?.ok !== true || innerDecision?.action !== 'BUY') {
          console.log('[INTELLIGENT_AUTO] Coordinator did not approve BUY, skipping execution', {
            ok: parsedDecision?.ok,
            action: innerDecision?.action,
            reason: innerDecision?.reason,
          });
          return;
        }
        
        const baseSymbol = cryptocurrency.replace('-EUR', '');
        const qty = intent.qtySuggested;
        
        // Pass preApprovedDecision (coordinator already approved above)
        const result = await runCoordinatorApprovedMockBuy({
          userId: user!.id,
          strategyId: strategy.id,
          symbol: normalizedSymbol,
          baseSymbol,
          qty,
          price,
          reason: trigger || 'INTELLIGENT_AUTO',
          confidence: intent.confidence,
          strategyTrigger: 'INTELLIGENT_AUTO',
          extraMetadata: {
            fusion_source: 'intelligent_engine',
            fusion_reason: trigger,
            fusion_confidence: intent.confidence,
            engineFeatures: engineFeatures
          },
          preApprovedDecision: innerDecision
        });
        
        if (result.success) {
          Toast.success(`✅ Intelligent BUY executed: ${qty.toFixed(4)} ${baseSymbol} @ €${price.toFixed(2)}`);
        } else {
          console.log('[INTELLIGENT_AUTO] Coordinator declined or execution failed:', result.reason);
        }
      }

      // STEP 1: Use standardized coordinator toast handler
      // Toast handling removed - silent mode

    } catch (error) {
      writeDebugStage('emit_coordinator_exception', { error: String(error) });
      console.error('[DEBUG][emitTradeIntentToCoordinator] EXCEPTION:', error);
      console.error('❌ INTELLIGENT: Error executing trade intent:', error);
      Toast.error(`Error processing ${action} for ${cryptocurrency}`);
    }
  };

  // Legacy direct execution function (backward compatibility) 
  const executeTradeDirectly = async (
    strategy: any, 
    action: 'buy' | 'sell', 
    cryptocurrency: string, 
    price: number, 
    customAmount?: number,
    trigger?: string
  ) => {
    // CRITICAL FIX: Apply regression guards before trade execution
    const { validateTradePrice, validatePurchaseValue, logValidationFailure } = await import('../utils/regressionGuards');
    
    // GUARD 1: Price corruption prevention
    const priceValidation = validateTradePrice(price, cryptocurrency);
    if (!priceValidation.isValid) {
      logValidationFailure('price_corruption_guard', priceValidation.errors, { price, cryptocurrency, trigger });
      Toast.error(`Suspicious price detected: €${price}. Trade prevented by security guard.`);
      return;
    }

    // CRITICAL FIX: Normalize symbol format - remove -EUR suffix for database storage
    const normalizedSymbol = cryptocurrency.replace('-EUR', '');
    engineConsoleLog('🔧 ENGINE: Symbol normalization:', cryptocurrency, '->', normalizedSymbol);

    const config = strategy.configuration;
    let tradeAmount: number;
    
    if (action === 'sell' && customAmount !== undefined) {
      tradeAmount = customAmount;
    } else {
      // CRITICAL FIX: Use deterministic price and remove €100 default
      let deterministicPrice = price;
      
      // Fetch price snapshot for deterministic pricing
      try {
        const { data: snapshot } = await supabase
          .from('price_snapshots')
          .select('price')
          .eq('symbol', normalizedSymbol)
          .order('ts', { ascending: false })
          .limit(1);
        
        if (snapshot?.[0]?.price) {
          deterministicPrice = snapshot[0].price;
          engineConsoleLog('🎯 ENGINE: Using snapshot price:', deterministicPrice, 'for', normalizedSymbol);
        }
      } catch (error) {
        if (!isLogSuppressed()) console.warn('⚠️ ENGINE: Could not fetch price snapshot, using market price:', price);
      }

      // Calculate buy amount with safe defaults (no more hardcoded values)
      const defaultAllocation = 50; // Reduced from hardcoded €100 to €50 minimum
      if (config.allocationUnit === 'percentage') {
        const totalBalance = getBalance('EUR');
        const allocationAmount = Math.max(defaultAllocation, totalBalance * (config.perTradeAllocation || 5) / 100);
        tradeAmount = allocationAmount / deterministicPrice;
      } else {
        const allocationAmount = config.perTradeAllocation || defaultAllocation;
        tradeAmount = allocationAmount / deterministicPrice;
      }

      // GUARD 2: Purchase value consistency validation
      const totalValue = tradeAmount * deterministicPrice;
      const purchaseValidation = validatePurchaseValue(tradeAmount, deterministicPrice, totalValue);
      if (!purchaseValidation.isValid) {
        logValidationFailure('purchase_value_guard', purchaseValidation.errors, { tradeAmount, price: deterministicPrice, totalValue });
        console.error('❌ ENGINE: Purchase value validation failed, aborting trade');
        return;
      }

      price = deterministicPrice; // Use validated price for trade execution
    }

    // Execute the trade
    if (action === 'buy') {
      const eurBalance = getBalance('EUR');
      const tradeValue = tradeAmount * price;
      
      if (eurBalance >= tradeValue) {
        updateBalance('EUR', -tradeValue);
        updateBalance(normalizedSymbol, tradeAmount);
        
        await recordTrade({
          strategy_id: strategy.id,
          user_id: user.id,
          trade_type: 'buy',
          cryptocurrency: normalizedSymbol,
          amount: tradeAmount,
          price,
          total_value: tradeValue,
          strategy_trigger: trigger || 'REAL_SIGNALS'
        });

        tradingStateRef.current.dailyTrades++;
        tradingStateRef.current.lastTradeTime = new Date().toISOString();

        // Silent success - no toast
      }
    } else if (action === 'sell') {
      const cryptoBalance = getBalance(normalizedSymbol);
      
      if (cryptoBalance >= tradeAmount) {
        const tradeValue = tradeAmount * price;
        updateBalance(normalizedSymbol, -tradeAmount);
        updateBalance('EUR', tradeValue);
        
        await recordTrade({
          strategy_id: strategy.id,
          user_id: user.id,
          trade_type: 'sell',
          cryptocurrency: normalizedSymbol,
          amount: tradeAmount,
          price,
          total_value: tradeValue,
          strategy_trigger: trigger || 'REAL_SIGNALS'
        });

        tradingStateRef.current.dailyTrades++;
        tradingStateRef.current.lastTradeTime = new Date().toISOString();

        // Silent success - no toast
      }
    }
  };

  // Trade Recording
  const recordTrade = async (tradeData: any) => {
    try {
      engineConsoleLog('📝 ENGINE: Recording REAL signal trade:', tradeData);
      
      let mockTradeData: any = {
        strategy_id: tradeData.strategy_id,
        user_id: tradeData.user_id,
        trade_type: tradeData.trade_type,
        cryptocurrency: tradeData.cryptocurrency,
        amount: Math.round(tradeData.amount * 1e8) / 1e8,
        price: Math.round(tradeData.price * 1e6) / 1e6,
        total_value: Math.round(tradeData.total_value * 100) / 100,
        fees: 0,
        strategy_trigger: tradeData.strategy_trigger,
        notes: 'REAL signals automated trade',
        is_test_mode: true,
        profit_loss: 0,
        executed_at: new Date().toISOString()
      };

      engineConsoleLog('📝 ENGINE: About to insert trade into database:', mockTradeData);
      engineConsoleLog('📝 ENGINE: Calling supabase.from(mock_trades).insert...');

      const { data, error } = await supabase
        .from('mock_trades')
        .insert(mockTradeData)
        .select();

      engineConsoleLog('📝 ENGINE: Supabase response - data:', data, 'error:', error);

      if (error) {
        console.error('❌ ENGINE: Database error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          mockTradeData
        });
        throw error;
      }
      
      engineConsoleLog('✅ ENGINE: Successfully recorded REAL signal trade, DB ID:', data?.[0]?.id, 'Type:', tradeData.trade_type, 'Symbol:', tradeData.cryptocurrency);

    } catch (error) {
      console.error('❌ ENGINE: Catch block error:', error);
      console.error('❌ ENGINE: Error details:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack
      });
      throw error;
    }
  };

  // ScalpSmart bracket calculation (enforces risk/reward)
  const calculateScalpSmartBrackets = (config: any, currentPrice: number) => {
    const brackets = config.brackets || {};
    const isATRScaled = brackets.atrScaled || false;
    
    if (isATRScaled) {
      // ATR-based brackets with safety fallback
      const atrMultipliers = brackets.atrMultipliers || { tp: 2.6, sl: 2.0 };
      const atr = 0.02; // Mock ATR value - in real implementation would calculate from price data
      
      return {
        stopLossPct: atr * atrMultipliers.sl,
        takeProfitPct: atr * atrMultipliers.tp,
        trailBufferPct: brackets.trailBufferPct || 0.4
      };
    } else {
      // Fixed percentage with risk/reward enforcement
      const stopLossPct = brackets.stopLossPctWhenNotAtr || 0.40;
      const takeProfitPct = brackets.takeProfitPct || 0.65;
      const minTpSlRatio = brackets.minTpSlRatio || 1.2;
      
      // Enforce minimum TP/SL ratio
      const enforcedTP = Math.max(takeProfitPct, stopLossPct * minTpSlRatio);
      
      return {
        stopLossPct,
        takeProfitPct: enforcedTP,
        trailBufferPct: brackets.trailBufferPct || 0.4
      };
    }
  };

  // Debugging API for manual triggering from browser console
  if (typeof window !== 'undefined') {
    (window as any).__INTELLIGENT = {
      ...(window as any).__INTELLIGENT,
      checkStrategiesAndExecute: async () => {
        // DEBUG STAGE: manual_trigger_from_console
        writeDebugStage('manual_trigger_from_console', null);
        await checkStrategiesAndExecute();
      },
    };
  }

  return { checkStrategiesAndExecute };
};