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

// Check if autorun is disabled
const isAutorunDisabled = () => {
  if (typeof window === "undefined") return false;
  return (window as any).__INTELLIGENT_DISABLE_AUTORUN === true;
};

// Suppressible console log for engine - COMPLETELY SILENT
const engineConsoleLog = (..._args: any[]) => {
  // All engine logs suppressed
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
  
  // INTELLIGENT ENGINE MONITORING INTERVAL
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
        data: { user: !!user, loading, testMode }
      });
    }
    
    if (!loading && user && testMode) {
      // Silent log for auth conditions met
      if (!isLogSuppressed()) {
        (window as any).NotificationSink?.log({
          message: 'INTELLIGENT_ENGINE: Auth conditions check - starting engine with recurring loop',
          data: { user: !!user, loading, testMode, intervalMs: MONITORING_INTERVAL_MS }
        });
      }
      
      engineConsoleLog('🚀 INTELLIGENT ENGINE: Starting recurring monitoring loop (interval:', MONITORING_INTERVAL_MS, 'ms)');
      
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
      // Stop monitoring if conditions not met
      if (marketMonitorRef.current) {
        clearInterval(marketMonitorRef.current);
        marketMonitorRef.current = null;
        engineConsoleLog('🛑 INTELLIGENT ENGINE: Monitoring loop stopped (conditions not met)');
      }
      // Silent log for auth waiting
      if (!isLogSuppressed()) {
        (window as any).NotificationSink?.log({ 
          message: 'INTELLIGENT_ENGINE: Waiting for auth or testMode', 
          data: { loading, user: !!user, testMode }
        });
      }
    }
  }, [user, loading, testMode]);

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
      writeDebugStage('early_exit_user_or_loading', { testMode, userPresent: !!user, loading });
      Toast.info(`INTELLIGENT ENGINE: early exit – missing user or still loading | user=${!!user}, loading=${loading}, testMode=${testMode}`);
      engineLog('ENGINE: Skipping - user: ' + !!user + ' loading: ' + loading);
      return;
    }
    
    if (!testMode) {
      // DEBUG STAGE: early_exit_testmode_off
      writeDebugStage('early_exit_testmode_off', { testMode, userPresent: !!user, loading });
      Toast.info(`INTELLIGENT ENGINE: early exit – testMode is OFF | user=${!!user}, loading=${loading}, testMode=${testMode}`);
      engineLog('TEST MODE IS OFF! You need to enable Test Mode to use the trading engine!');
      return;
    }

    // NOTE: Forced debug trade block moved below strategy fetch - see after activeTestStrategies filter

    Toast.success(`INTELLIGENT ENGINE: passed guards, entering strategy evaluation | user=${!!user}, loading=${loading}, testMode=${testMode}`);

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
      
      // DEBUG: Log normalized strategies (same fields Debug Panel shows)
      engineConsoleLog("ENGINE: normalized strategies", strategies.map(s => ({
        id: s.id,
        name: s.strategy_name ?? (s as any).strategyName,
        is_active: s.is_active,
        test_mode: s.test_mode,
        is_active_test: s.is_active_test,
        is_active_live: s.is_active_live,
        config_is_test_mode: (s.configuration as any)?.is_test_mode,
        enableTestTrading: (s.configuration as any)?.enableTestTrading,
      })));
      
      // CANONICAL FILTER: Match Debug Panel's detection logic exactly
      // A strategy is a "test strategy" if:
      //   1. is_active = true (already filtered in query)
      //   2. AND (test_mode = true OR is_active_test = true OR config flags)
      const activeTestStrategies = strategies.filter((s) => {
        const rawRow = strategyRows.find(r => r.id === s.id) as any;
        
        // Check DB columns directly (same as Debug Panel)
        const dbTestMode = rawRow?.test_mode === true;
        const dbIsActiveTest = rawRow?.is_active_test === true;
        
        // Check normalized fields (from normalizeStrategy)
        const normalizedTestMode = s.test_mode === true;
        const normalizedIsActiveTest = s.is_active_test === true;
        
        // Check configuration nested flags
        const configIsTestMode = (s.configuration as any)?.is_test_mode === true;
        const configEnableTestTrading = (s.configuration as any)?.enableTestTrading === true;
        
        // Match if ANY test indicator is true
        const match = dbTestMode || dbIsActiveTest || normalizedTestMode || normalizedIsActiveTest || configIsTestMode || configEnableTestTrading;
        
        engineConsoleLog("ENGINE: STRATEGY FILTER", {
          id: s.id,
          strategy_name: rawRow?.strategy_name,
          dbTestMode,
          dbIsActiveTest,
          normalizedTestMode,
          normalizedIsActiveTest,
          configIsTestMode,
          configEnableTestTrading,
          MATCH: match
        });
        
        return match;
      });

      // DEBUG STAGE: after_test_filter
      writeDebugStage('after_test_filter', {
        normalizedCount: strategies.length,
        testStrategiesCount: activeTestStrategies.length,
        testStrategyIds: activeTestStrategies.map(s => s.id),
      });

      engineLog(`ENGINE: testStrategies.length = ${activeTestStrategies.length}`);
      Toast.info(`ENGINE: ${strategies.length} total, ${activeTestStrategies.length} test strategies`);

      if (!activeTestStrategies?.length) {
        // DEBUG STAGE: early_exit_no_test_strategies
        writeDebugStage('early_exit_no_test_strategies', {
          normalizedCount: strategies.length,
        });
        engineLog('ENGINE: No active test strategies found');
        Toast.warn(`INTELLIGENT ENGINE: No test strategies found | Check DB flags (test_mode, is_active_test) or config (is_test_mode, enableTestTrading)`);
        return;
      }

      // FORCED DEBUG TRADE PATH (test-mode only)
      // Set window.__INTELLIGENT_FORCE_DEBUG_TRADE = true in console to trigger
      // This block is placed AFTER strategy fetch so we have a valid strategyId
      if (typeof window !== 'undefined' && window.__INTELLIGENT_FORCE_DEBUG_TRADE) {
        const firstTestStrategy = activeTestStrategies[0];
        const forcedSymbol = 'BTC-EUR';
        const forcedBaseSymbol = 'BTC';
        const forcedQty = 0.001;
        
        writeDebugStage('forced_debug_trade_entry', { 
          userId: user.id, 
          testMode, 
          strategyId: firstTestStrategy.id,
          strategyName: firstTestStrategy.strategy_name 
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
          
          const debugIntent = {
            userId: user.id,
            strategyId: firstTestStrategy.id,  // Use real strategy ID from DB
            symbol: forcedSymbol,
            side: 'BUY' as const,
            source: 'intelligent' as const,
            confidence: 0.99,
            reason: 'FORCED_DEBUG_TRADE',
            qtySuggested: forcedQty,
            metadata: {
              mode: 'mock',
              debug: true,
              debugTag: 'forced_debug_trade',
              engine: 'intelligent',
              is_test_mode: true,
              forced_price: forcedPrice,
            },
            ts: new Date().toISOString(),
            idempotencyKey: `forced_debug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          };

          console.log('🧪 FORCED DEBUG TRADE: Emitting intent to coordinator:', JSON.stringify(debugIntent, null, 2));

          const { data: decision, error } = await supabase.functions.invoke('trading-decision-coordinator', {
            body: { intent: debugIntent }
          });

          writeDebugStage('forced_debug_trade_emitted', { 
            symbol: forcedSymbol, 
            strategyId: firstTestStrategy.id,
            qtySuggested: forcedQty,
            price: forcedPrice,
            coordinatorResponse: decision,
            coordinatorError: error?.message 
          });

          console.log('🧪 FORCED DEBUG TRADE: Coordinator response:', JSON.stringify(decision), 'error:', error);
          
          // STEP 2: Parse coordinator response - handle both string and object formats
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawAny: any = decision;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let raw: any;
          
          try {
            if (typeof rawAny === 'string') {
              raw = JSON.parse(rawAny);
            } else {
              raw = rawAny ?? {};
            }
          } catch (e) {
            console.error('🧪 FORCED DEBUG TRADE: Failed to parse coordinator response as JSON', { rawAny, error: e });
            raw = {};
          }
          
          // Debug the actual shape coming back from the Edge Function
          console.log('🧪 FORCED DEBUG TRADE: Raw coordinator shape:', {
            typeofRaw: typeof raw,
            keys: typeof raw === 'object' && raw != null ? Object.keys(raw) : null,
            nestedDecisionKeys:
              raw && typeof raw === 'object' && raw.decision && typeof raw.decision === 'object'
                ? Object.keys(raw.decision)
                : null
          });
          
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const inner: any = (raw && typeof raw === 'object' && raw.decision) ? raw.decision : {};
          
          const coordinatorAction: string | null =
            inner.action ?? raw.action ?? null;
          
          const coordinatorReason: string | null =
            inner.reason ?? raw.reason ?? null;
          
          const coordinatorRequestId: string | null =
            inner.request_id ?? raw.request_id ?? null;
          
          const isApproved: boolean =
            raw.ok === true && coordinatorAction === 'BUY';
          
          console.log('🧪 FORCED DEBUG TRADE: Coordinator response (normalized):', {
            ok: raw.ok,
            action: coordinatorAction,
            reason: coordinatorReason,
            requestId: coordinatorRequestId,
          });
          
          if (isApproved) {
            console.log('🧪 FORCED DEBUG TRADE: Coordinator APPROVED - executing mock trade insertion');
            
            writeDebugStage('forced_debug_trade_approved', {
              ok: raw.ok,
              action: coordinatorAction,
              reason: coordinatorReason,
              requestId: coordinatorRequestId
            });
            
            // Run spread/liquidity gates in test mode (they will bypass but log)
            const config = firstTestStrategy.configuration || {};
            const isTestModeConfig = true; // Forced debug is always test mode
            
            // Gate checks (will bypass in test mode)
            const configAny = config as any;
            const spreadThreshold = configAny?.spreadThresholdBps || 15;
            const minDepthRatio = configAny?.minDepthRatio || 0.3;
            
            const spreadCheck = await checkSpreadGate(forcedSymbol, spreadThreshold, isTestModeConfig);
            const liquidityCheck = await checkLiquidityGate(forcedSymbol, minDepthRatio, isTestModeConfig);
            
            console.log('🧪 FORCED DEBUG TRADE: Gates passed', { 
              spreadBlocked: spreadCheck.blocked, 
              spreadBypassed: spreadCheck.bypassed,
              liquidityBlocked: liquidityCheck.blocked,
              liquidityBypassed: liquidityCheck.bypassed
            });
            
            // Calculate total value
            const totalValue = forcedQty * forcedPrice;
            
            // Insert into mock_trades
            const mockTradeData = {
              strategy_id: firstTestStrategy.id,
              user_id: user.id,
              trade_type: 'buy',
              cryptocurrency: forcedBaseSymbol, // Use base symbol without -EUR
              amount: Math.round(forcedQty * 1e8) / 1e8,
              price: Math.round(forcedPrice * 1e6) / 1e6,
              total_value: Math.round(totalValue * 100) / 100,
              fees: 0,
              strategy_trigger: 'FORCED_DEBUG_TRADE',
              notes: 'Forced debug trade via __INTELLIGENT_FORCE_DEBUG_TRADE',
              is_test_mode: true,
              profit_loss: 0,
              executed_at: new Date().toISOString(),
              market_conditions: {
                debugTag: 'forced_debug_trade',
                coordinator_request_id: coordinatorRequestId,
                coordinator_reason: coordinatorReason,
                spread_bps: spreadCheck.spreadBps,
                depth_ratio: liquidityCheck.depthRatio,
                gates_bypassed: {
                  spread: spreadCheck.bypassed || false,
                  liquidity: liquidityCheck.bypassed || false
                }
              }
            };
            
            console.log('🧪 FORCED DEBUG TRADE: Inserting mock_trade:', mockTradeData);
            
            const { data: insertedTrade, error: insertError } = await supabase
              .from('mock_trades')
              .insert(mockTradeData)
              .select();
            
            if (insertError) {
              console.error('🧪 FORCED DEBUG TRADE: Database insert error:', insertError);
              writeDebugStage('forced_debug_trade_insert_error', { error: insertError.message });
            } else {
              console.log('🧪 FORCED DEBUG TRADE: SUCCESS! mock_trade inserted:', insertedTrade?.[0]?.id);
              writeDebugStage('forced_debug_trade_success', { 
                tradeId: insertedTrade?.[0]?.id,
                symbol: forcedBaseSymbol,
                amount: forcedQty,
                price: forcedPrice,
                totalValue
              });
              
              // Update local wallet balances (for UI consistency)
              const eurBalance = getBalance('EUR');
              if (eurBalance >= totalValue) {
                updateBalance('EUR', -totalValue);
                updateBalance(forcedBaseSymbol, forcedQty);
                console.log('🧪 FORCED DEBUG TRADE: Updated local balances');
              }
              
              Toast.success(`🧪 Debug BUY executed: ${forcedQty} ${forcedBaseSymbol} @ €${forcedPrice.toFixed(2)}`);
            }
          } else {
            console.log('🧪 FORCED DEBUG TRADE: Coordinator did NOT approve BUY', { 
              ok: raw.ok, 
              action: coordinatorAction, 
              reason: coordinatorReason 
            });
            writeDebugStage('forced_debug_trade_declined', { 
              ok: raw.ok, 
              action: coordinatorAction, 
              reason: coordinatorReason 
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
        testStrategiesCount: activeTestStrategies.length,
        testStrategyIds: activeTestStrategies.map(s => s.id),
      });
      
      Toast.success(`INTELLIGENT ENGINE: Processing ${activeTestStrategies.length} test strategies...`);

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
      
      // Process each strategy with comprehensive logic
      for (const strategy of activeTestStrategies) {
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
  const checkBuyOpportunitiesInstrumented = async (strategy: any, marketData: any, actionsPlanned: { buy: number; sell: number; hold: number }): Promise<number> => {
    const config = strategy.configuration as any;
    
    writeDebugStage('buy_opportunities_fetch_positions', {});
    const positions = await calculateOpenPositions();
    writeDebugStage('buy_opportunities_positions_fetched', { 
      positionCount: positions.length,
      maxActiveCoins: config.maxActiveCoins,
    });
    
    // Check position limits
    if (config.maxActiveCoins && positions.length >= config.maxActiveCoins) {
      writeDebugStage('buy_opportunities_max_positions_reached', { 
        positions: positions.length,
        maxActiveCoins: config.maxActiveCoins,
      });
      return 0;
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
    
    for (const coin of coinsToAnalyze) {
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

      // Skip if already have position in this coin (unless DCA enabled)
      const hasPosition = positions.some(p => p.cryptocurrency === symbol);
      writeDebugStage('buy_opportunity_position_check', { 
        symbol, 
        hasPosition,
        enableDCA: config.enableDCA,
      });
      
      if (hasPosition && !config.enableDCA) {
        writeDebugStage('buy_opportunity_skip_has_position', { symbol });
        continue;
      }

      // Check if we should buy this coin using REAL signals
      writeDebugStage('buy_opportunity_get_signal', { symbol, before: true });
      const buySignal = await getBuySignal(config, symbol, marketData, hasPosition);
      writeDebugStage('buy_opportunity_get_signal', { 
        symbol, 
        after: true,
        hasBuySignal: !!buySignal,
        signalReason: buySignal?.reason || 'none',
      });
      
      if (!buySignal) {
        writeDebugStage('buy_opportunity_no_signal', { symbol });
        continue;
      }

      // Execute buy
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
    
    // --- TEST MODE: force BUY if engine reached this point and no buys executed ---
    // This confirms the pipe to the coordinator is working even if signals fail
    if ((config?.is_test_mode || config?.enableTestTrading) && buysExecuted === 0) {
      const forceBuySymbol = coinsToAnalyze.length > 0 ? `${coinsToAnalyze[0]}-EUR` : 'BTC-EUR';
      const forceBuyPrice = marketData[forceBuySymbol]?.price || marketData.currentPrice || 0;
      writeDebugStage('test_force_buy_path_triggered', { 
        symbol: forceBuySymbol, 
        price: forceBuyPrice,
        reason: 'no_normal_buys_executed_forcing_test_buy'
      });
      
      await executeTrade(
        strategy,
        'buy',                    // action
        forceBuySymbol,           // cryptocurrency
        forceBuyPrice,            // price
        undefined,                // customAmount
        'debug_force_buy',        // trigger
        'ENTRY'                   // context
      );
      buysExecuted++;
      actionsPlanned.buy++;
    }
    
    writeDebugStage('buy_opportunities_summary', { 
      coinsAnalyzed: coinsToAnalyze.length,
      buysExecuted,
    });
    
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
    if (config.autoCloseAfterHours && hoursSincePurchase >= config.autoCloseAfterHours) {
      logContext.reasonChosen = 'auto_close_time_hit';
      engineLog('SELL DECISION: AUTO CLOSE TRIGGERED - ' + hoursSincePurchase + ' >= ' + config.autoCloseAfterHours, logContext);
      return { reason: 'AUTO_CLOSE_TIME', orderType: 'market', decisionData: logContext };
    }

    // 2. STOP LOSS CHECK with epsilon buffer (Phase 5)
    const adjustedStopLoss = Math.abs(config.stopLossPercentage || 0) + epsilonPnLBufferPct;
    if (config.stopLossPercentage && pnlPercentage <= -adjustedStopLoss) {
      logContext.reasonChosen = 'sl_hit';
      engineLog('SELL DECISION: STOP LOSS TRIGGERED with buffer - ' + pnlPercentage + ' <= ' + (-adjustedStopLoss), logContext);
      return { 
        reason: 'STOP_LOSS', 
        orderType: config.sellOrderType || 'market',
        decisionData: logContext
      };
    }

    // 3. TAKE PROFIT CHECK with epsilon buffer (Phase 5)
    const adjustedTakeProfit = (config.takeProfitPercentage || 0) + epsilonPnLBufferPct;
    if (config.takeProfitPercentage && pnlPercentage >= adjustedTakeProfit) {
      logContext.reasonChosen = 'tp_hit';
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
      // Map sell decision reasons to proper context
      const context = sellDecision.reason === 'TAKE_PROFIT' ? 'TP' : 
                     sellDecision.reason === 'STOP_LOSS' ? 'SL' : 'MANUAL';
      
      engineConsoleLog('🎯 SELL ORDER: Executing with context:', context, 'reason:', sellDecision.reason);
      await executeTrade(strategy, 'sell', position.cryptocurrency, marketPrice, position.remaining_amount, sellDecision.reason, context);
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
      // 🚀 HOTFIX: TP exits bypass liquidity and whale conflict gates
      // 🧪 Option B: Test mode bypasses spread gate blocking
      const isTestModeConfig = config?.is_test_mode === true || 
                               config?.enableTestTrading === true ||
                               testMode === true;
      
      if (gatesConfig) {
        // Gate 1: Spread check (bypassed in test mode via Option B)
        const spread = await checkSpreadGate(symbol, effectiveConfigWithSources.spreadThresholdBps, isTestModeConfig);
        if (spread.blocked) {
          gateBlocks.push('spread_too_wide');
        }
        // Log bypass for debugging
        if (spread.bypassed) {
          console.log('🧪 [FUSION] Spread gate bypassed in test mode', { symbol, spreadBps: spread.spreadBps });
        }
        
        // Gate 2: Liquidity/Depth check - BYPASS for TP exits (bypassed in test mode via isTestModeConfig)
        const enforceLiquidity = context !== 'TP';
        if (enforceLiquidity) {
          const liquidity = await checkLiquidityGate(symbol, effectiveConfigWithSources.minDepthRatio, isTestModeConfig);
          if (liquidity.blocked) {
            gateBlocks.push('blocked_by_liquidity');
            engineConsoleLog(`🚫 LIQUIDITY GATE: Blocked ${side} for ${symbol} (context: ${context}) - depth ratio: ${liquidity.depthRatio} < ${effectiveConfigWithSources.minDepthRatio}`);
          }
          // Log bypass for debugging
          if (liquidity.bypassed) {
            console.log('🧪 [FUSION] Liquidity gate bypassed in test mode', { symbol, depthRatio: liquidity.depthRatio });
          }
        } else {
          engineConsoleLog(`✅ LIQUIDITY GATE: Bypassed for ${side} ${symbol} (context: ${context})`);
        }
        
        // Gate 3: Whale conflict check - BYPASS for TP exits  
        const enforceWhaleConflict = context !== 'TP';
        if (enforceWhaleConflict) {
          const whaleConflict = await checkWhaleConflictGate(symbol, side, effectiveConfigWithSources.whaleConflictWindowMs);
          if (whaleConflict.blocked) {
            gateBlocks.push('blocked_by_whale_conflict');
          }
        } else {
          engineConsoleLog(`✅ WHALE GATE: Bypassed for ${side} ${symbol} (context: ${context})`);
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
      
      // Hysteresis: Different thresholds for enter vs exit
      const enterThreshold = fusionConfig.enterThreshold || 0.65;
      const exitThreshold = fusionConfig.exitThreshold || 0.35;
      
      let decision: 'ENTER' | 'EXIT' | 'HOLD' | 'DEFER' = 'HOLD';
      let reason = 'low_signal_confidence';
      
      if (side === 'BUY' && adjustedScore >= enterThreshold) {
        decision = 'ENTER';
        reason = 'fusion_signal_strong';
      } else if (side === 'SELL' && adjustedScore <= -exitThreshold) {
        decision = 'EXIT';
        reason = 'fusion_exit_signal';
      } else if (Math.abs(adjustedScore) < 0.2) {
        decision = 'HOLD';
        reason = 'signal_too_weak';
      } else {
        decision = 'DEFER';
        reason = adjustedScore > 0 ? 'trend_misalignment' : 'bearish_trend_defer';
      }
      
      return {
        sTotalScore: adjustedScore,
        bucketScores,
        decision,
        reason,
        gateBlocks: [],
        effectiveConfig: effectiveConfigWithSources,
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
  // NOTE: checkSpreadGate now accepts isTestMode to bypass blocking in test mode (Option B)
  const checkSpreadGate = async (symbol: string, maxSpreadBps: number, isTestMode: boolean = false): Promise<{ blocked: boolean; spreadBps: number; bypassed?: boolean }> => {
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
        
        const wouldBeBlocked = spreadBps > maxSpreadBps;
        
        // TEST MODE BYPASS (Option B): In test mode, never block but log the actual spread
        if (isTestMode && wouldBeBlocked) {
          console.log('🧪 [SPREAD_GATE_BYPASS] fusion_spread_gate_bypassed_test_mode', {
            symbol: pairSymbol,
            bid,
            ask,
            mid,
            spreadBps: spreadBps.toFixed(2),
            thresholdBps: maxSpreadBps,
            wouldHaveBlocked: true,
            bypassed: true,
            reason: 'test_mode_enabled'
          });
          return {
            blocked: false, // BYPASSED - do not block in test mode
            spreadBps,
            bypassed: true
          };
        }
        
        return {
          blocked: wouldBeBlocked,
          spreadBps,
          bypassed: false
        };
      }
      
      return { blocked: false, spreadBps: 0, bypassed: false }; // Default to not blocked if can't fetch
    } catch (error) {
      console.error('❌ SPREAD GATE: Error checking spread:', error);
      return { blocked: false, spreadBps: 0, bypassed: false };
    }
  };
  
  // NOTE: checkLiquidityGate now accepts isTestMode to bypass blocking in test mode (like spread gate)
  const checkLiquidityGate = async (symbol: string, minDepthRatio: number, isTestMode: boolean = false): Promise<{ blocked: boolean; depthRatio: number; bypassed?: boolean }> => {
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
        
        const wouldBeBlocked = depthRatio < minDepthRatio;
        
        // TEST MODE BYPASS: In test mode, never block but log the actual depth ratio
        if (isTestMode && wouldBeBlocked) {
          console.log('🧪 [LIQUIDITY_GATE_BYPASS] fusion_liquidity_gate_bypassed_test_mode', {
            symbol: pairSymbol,
            bidDepth: bidDepth.toFixed(4),
            askDepth: askDepth.toFixed(4),
            depthRatio: depthRatio.toFixed(4),
            thresholdRatio: minDepthRatio,
            wouldHaveBlocked: true,
            bypassed: true,
            reason: 'test_mode_enabled'
          });
          return {
            blocked: false, // BYPASSED - do not block in test mode
            depthRatio,
            bypassed: true
          };
        }
        
        return {
          blocked: wouldBeBlocked,
          depthRatio,
          bypassed: false
        };
      }
      
      return { blocked: false, depthRatio: 10, bypassed: false }; // Default to good depth if can't fetch
    } catch (error) {
      console.error('❌ LIQUIDITY GATE: Error checking depth:', error);
      return { blocked: false, depthRatio: 10, bypassed: false };
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
  const calculateTrendScore = async (symbol: string, side: 'BUY' | 'SELL'): Promise<number> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      
      // Use existing live_signals table for trend indicators
      const { data: signals } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', baseSymbol)
        .in('signal_type', ['ma_cross_bullish', 'ma_cross_bearish', 'trend_bullish', 'trend_bearish'])
        .gte('timestamp', new Date(Date.now() - 3600000).toISOString()) // Last hour
        .order('timestamp', { ascending: false })
        .limit(10);
      
      if (!signals || signals.length === 0) return 0;
      
      // Score based on recent trend signals
      let trendScore = 0;
      signals.forEach(signal => {
        const weight = 1 / (signals.indexOf(signal) + 1); // Recent signals weighted higher
        const strength = signal.signal_strength || 0;
        if (signal.signal_type.includes('bullish')) {
          trendScore += side === 'BUY' ? weight * strength : -weight * strength;
        } else if (signal.signal_type.includes('bearish')) {
          trendScore += side === 'SELL' ? weight * strength : -weight * strength;
        }
      });
      
      return Math.max(-1, Math.min(1, trendScore / 3)); // Normalize to [-1, 1]
      
    } catch (error) {
      console.error('❌ TREND SCORE: Error calculating trend score:', error);
      return 0;
    }
  };
  
  const calculateVolatilityScore = async (symbol: string): Promise<number> => {
    try {
      // Mock volatility calculation - use price data variance as proxy
      const baseSymbol = symbol.replace('-EUR', '');
      const currentData = await getCurrentData([baseSymbol]);
      const priceData = currentData[baseSymbol];
      if (!priceData?.price) return 0.5;
      
      // Simple volatility proxy: score based on price level and time
      const volatilityProxy = Math.sin(Date.now() / 100000) * 0.3 + 0.5;
      return Math.max(-1, Math.min(1, volatilityProxy * 2 - 1)); // Convert to [-1, 1]
      
    } catch (error) {
      console.error('❌ VOLATILITY SCORE: Error calculating volatility score:', error);
      return 0;
    }
  };
  
  const calculateMomentumScore = async (symbol: string, side: 'BUY' | 'SELL'): Promise<number> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      
      // Use existing live_signals for momentum indicators
      const { data: momentum } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', baseSymbol)
        .in('signal_type', ['momentum_bullish', 'momentum_bearish', 'rsi_oversold', 'rsi_overbought'])
        .order('timestamp', { ascending: false })
        .limit(5);
      
      if (!momentum || momentum.length === 0) return 0;
      
      let momentumScore = 0;
      momentum.forEach((signal, index) => {
        const weight = 1 / (index + 1);
        const strength = signal.signal_strength || 0;
        
        if (signal.signal_type.includes('bullish') || signal.signal_type === 'rsi_oversold') {
          momentumScore += side === 'BUY' ? weight * strength : -weight * strength;
        } else if (signal.signal_type.includes('bearish') || signal.signal_type === 'rsi_overbought') {
          momentumScore += side === 'SELL' ? weight * strength : -weight * strength;
        }
      });
      
      return Math.max(-1, Math.min(1, momentumScore)); // Normalize to [-1, 1]
      
    } catch (error) {
      console.error('❌ MOMENTUM SCORE: Error calculating momentum score:', error);
      return 0;
    }
  };
  
  const calculateWhaleScore = async (symbol: string, side: 'BUY' | 'SELL'): Promise<number> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      
      // Use existing live_signals for whale-related activity
      const { data: whaleActivity } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', baseSymbol)
        .in('signal_type', ['whale_movement', 'large_volume', 'unusual_activity'])
        .gte('timestamp', new Date(Date.now() - 1800000).toISOString()) // Last 30 min
        .order('timestamp', { ascending: false })
        .limit(5);
      
      if (!whaleActivity || whaleActivity.length === 0) return 0;
      
      let whaleScore = 0;
      whaleActivity.forEach((activity, index) => {
        const weight = 1 / (index + 1);
        const strength = activity.signal_strength || 0;
        
        // Positive strength = bullish activity, negative = bearish
        if (strength > 0 && side === 'BUY') {
          whaleScore += weight * Math.abs(strength);
        } else if (strength < 0 && side === 'SELL') {
          whaleScore += weight * Math.abs(strength);
        } else {
          whaleScore -= weight * Math.abs(strength) * 0.5; // Opposing flow penalty
        }
      });
      
      return Math.max(-1, Math.min(1, whaleScore));
      
    } catch (error) {
      console.error('❌ WHALE SCORE: Error calculating whale score:', error);
      return 0;
    }
  };
  
  const calculateSentimentScore = async (symbol: string, side: 'BUY' | 'SELL'): Promise<number> => {
    try {
      const baseSymbol = symbol.replace('-EUR', '');
      
      // Use existing live_signals for sentiment and news
      const { data: sentimentSignals } = await supabase
        .from('live_signals')
        .select('*')
        .eq('symbol', baseSymbol)
        .in('signal_type', ['sentiment_bullish_strong', 'sentiment_bearish_strong', 'news_volume_spike'])
        .gte('timestamp', new Date(Date.now() - 3600000).toISOString()) // Last hour
        .order('timestamp', { ascending: false })
        .limit(10);
      
      if (!sentimentSignals || sentimentSignals.length === 0) return 0;
      
      let sentimentScore = 0;
      sentimentSignals.forEach((signal, index) => {
        const weight = 1 / (index + 1);
        const strength = signal.signal_strength || 0;
        
        if (signal.signal_type === 'sentiment_bullish_strong') {
          sentimentScore += side === 'BUY' ? weight * Math.abs(strength) : -weight * Math.abs(strength) * 0.7;
        } else if (signal.signal_type === 'sentiment_bearish_strong') {
          sentimentScore += side === 'SELL' ? weight * Math.abs(strength) : -weight * Math.abs(strength) * 0.7;
        } else if (signal.signal_type === 'news_volume_spike') {
          // News volume alone is neutral - combine with recent sentiment
          const hasPositiveSentiment = sentimentSignals.some(s => 
            s.signal_type === 'sentiment_bullish_strong' && 
            Math.abs(new Date(s.timestamp).getTime() - new Date(signal.timestamp).getTime()) < 300000
          );
          const hasNegativeSentiment = sentimentSignals.some(s => 
            s.signal_type === 'sentiment_bearish_strong' && 
            Math.abs(new Date(s.timestamp).getTime() - new Date(signal.timestamp).getTime()) < 300000
          );
          
          if (hasPositiveSentiment) {
            sentimentScore += side === 'BUY' ? weight * 0.5 : -weight * 0.8;
          } else if (hasNegativeSentiment) {
            sentimentScore += side === 'SELL' ? weight * 0.5 : -weight * 0.8;
          }
        }
      });
      
      return Math.max(-1, Math.min(1, sentimentScore / 2));
      
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
      const threshold = 0.3; // LOWERED threshold - any bullish signal should trigger

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
      const confidenceThreshold = aiConfig.aiConfidenceThreshold || 60;

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
    engineConsoleLog('💰 ENGINE: Executing buy order for', symbol, 'reason:', reason);
    await executeTrade(strategy, 'buy', symbol, marketPrice, undefined, reason);
  };

  // Position Management
  const calculateOpenPositions = async (): Promise<Position[]> => {
    if (!user?.id) return [];

    engineLog('POSITIONS: Starting position calculation for user: ' + user.id);

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

    engineLog('POSITIONS: Buy trades found: ' + (buyTrades?.length || 0));
    engineLog('POSITIONS: Sell trades found: ' + (sellTrades?.length || 0));
    
    if (buyTrades?.length) {
      engineConsoleLog('🧮 POSITIONS: Sample buy trades:', buyTrades.slice(0, 3).map(t => ({
        symbol: t.cryptocurrency,
        amount: t.amount,
        executed_at: t.executed_at
      })));
    }
    
    if (sellTrades?.length) {
      engineConsoleLog('🧮 POSITIONS: Sample sell trades:', sellTrades.slice(0, 3).map(t => ({
        symbol: t.cryptocurrency,
        amount: t.amount,
        executed_at: t.executed_at
      })));
    }

    if (!buyTrades) return [];

    const positions: Record<string, Position> = {};

    // Add buy trades with normalized symbols
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

    engineConsoleLog('🧮 POSITIONS: Positions after buy trades:', Object.keys(positions).length);

    // Subtract sell trades with normalized symbols
    if (sellTrades) {
      sellTrades.forEach(trade => {
        // Normalize symbol - remove -EUR suffix if present
        const symbol = trade.cryptocurrency.replace('-EUR', '');
        engineConsoleLog('🧮 POSITIONS: Processing sell trade for', symbol, 'amount:', trade.amount);
        if (positions[symbol]) {
          const beforeAmount = positions[symbol].remaining_amount;
          positions[symbol].remaining_amount -= trade.amount;
          engineConsoleLog('🧮 POSITIONS: Updated', symbol, 'from', beforeAmount, 'to', positions[symbol].remaining_amount);
          
          // Remove position if completely sold
          if (positions[symbol].remaining_amount <= 0.000001) {
            engineConsoleLog('🧮 POSITIONS: Removing position', symbol, 'due to zero balance');
            delete positions[symbol];
          }
        } else {
          engineConsoleLog('🧮 POSITIONS: Warning - sell trade for', symbol, 'but no position found!');
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

    engineConsoleLog('🧮 POSITIONS: Final open positions:', finalPositions.length);
    return finalPositions;
  };

  const executeTrade = async (
    strategy: any, 
    action: 'buy' | 'sell', 
    cryptocurrency: string, 
    price: number, 
    customAmount?: number,
    trigger?: string,
    context?: 'ENTRY' | 'TP' | 'SL' | 'MANUAL'
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
    
    // NEW: AI signal fusion evaluation
    if (isAIEnabled) {
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
    return await emitTradeIntentToCoordinator(strategy, action, cryptocurrency, price, customAmount, trigger);
  };

  // NEW: Emit trade intent to coordinator
  const emitTradeIntentToCoordinator = async (
    strategy: any, 
    action: 'buy' | 'sell', 
    cryptocurrency: string, 
    price: number, 
    customAmount?: number,
    trigger?: string
  ) => {
    writeDebugStage('emit_coordinator_start', { action, cryptocurrency, price, trigger });
    console.log('[DEBUG][emitTradeIntentToCoordinator] START:', { action, cryptocurrency, price });
    
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
          is_test_mode: testMode // Include test mode flag in metadata
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