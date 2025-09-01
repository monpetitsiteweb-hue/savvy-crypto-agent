import { useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import { useRealTimeMarketData } from './useRealTimeMarketData';
import { useToast } from './use-toast';
import { 
  PoolConfig, 
  CoinPoolView, 
  PoolState,
  Trade,
  AllocationRecord,
  buildCoinPoolView,
  shouldTriggerSecure,
  shouldArmRunner,
  shouldTriggerTrailingStop,
  nextTrailingStop,
  computeSecureTargetQty,
  loadPoolState,
  upsertPoolState,
  initializePoolState,
  allocateFillProRata,
  symbolMutex,
  roundToTick
} from '@/utils/poolManager';
import { supabase } from '@/integrations/supabase/client';

interface PoolExitManagerProps {
  isEnabled: boolean;
  testMode: boolean;
}

export const usePoolExitManager = ({ isEnabled, testMode }: PoolExitManagerProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { getCurrentData } = useRealTimeMarketData();
  
  // Throttling state for trailing stop updates
  const lastTrailingUpdateRef = useRef<Map<string, number>>(new Map());
  const processingRef = useRef<Set<string>>(new Set());

  /**
   * Get open trades for a user and strategy
   */
  const getOpenTrades = async (userId: string, strategyId: string): Promise<Trade[]> => {
    try {
      const { data, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('strategy_id', strategyId)
        .eq('trade_type', 'buy')
        .order('executed_at', { ascending: true });

      if (error) {
        console.error('❌ POOL_MANAGER: Error fetching open trades:', error);
        return [];
      }

      // Cast trade_type to proper type since database returns string
      return (data || []).map(trade => ({
        ...trade,
        trade_type: trade.trade_type as 'buy' | 'sell'
      }));
    } catch (error) {
      console.error('❌ POOL_MANAGER: Error in getOpenTrades:', error);
      return [];
    }
  };

  /**
   * Execute a sell order for pool exit - EMIT INTENT TO COORDINATOR
   */
  const executeSellOrder = async (
    symbol: string, 
    qty: number, 
    price: number, 
    strategyId: string,
    orderType: 'secure' | 'runner'
  ): Promise<boolean> => {
    if (!user || !testMode) return false;

    try {
      console.log(`🔄 POOL_MANAGER: Emitting ${orderType} sell intent for ${symbol}:`, {
        qty: qty.toFixed(8),
        price: price.toFixed(2),
        value: (qty * price).toFixed(2)
      });

      // Check if strategy has unified decisions enabled
      const { data: strategy, error: strategyError } = await supabase
        .from('trading_strategies')
        .select('unified_config, configuration')
        .eq('id', strategyId)
        .eq('user_id', user.id)
        .single();

      if (strategyError || !strategy) {
        console.error('❌ POOL_MANAGER: Cannot fetch strategy for unified decision check');
        return false;
      }

      const unifiedConfig = (strategy.unified_config as any) || { enableUnifiedDecisions: false };

      if ((unifiedConfig as any)?.enableUnifiedDecisions) {
        // NEW: Emit intent to coordinator
        console.log('🎯 POOL_MANAGER: Using unified decision system');
        
        const intent = {
          userId: user.id,
          strategyId: strategyId,
          symbol: symbol.includes('-EUR') ? symbol : `${symbol}-EUR`,
          side: 'SELL' as const,
          source: 'pool' as const,
          confidence: 0.90, // High confidence for pool exits
          reason: `Pool ${orderType} exit`,
          qtySuggested: qty,
          metadata: {
            engine: 'pool_manager',
            order_type: orderType,
            price: price,
            pool_logic: true
          },
          ts: new Date().toISOString()
        };

        console.log('🎯 POOL_MANAGER: Emitting intent to coordinator:', JSON.stringify(intent, null, 2));

        const { data: decision, error } = await supabase.functions.invoke('trading-decision-coordinator', {
          body: { intent }
        });

        if (error) {
          console.error('❌ POOL_MANAGER: Coordinator call failed:', error);
          toast({
            title: "Pool Exit Intent Failed",
            description: `Failed to process ${orderType} exit intent for ${symbol}: ${error.message}`,
            variant: "destructive",
          });
          return false;
        }

        console.log('📋 POOL_MANAGER: Coordinator decision:', JSON.stringify(decision, null, 2));

        if (decision.approved && decision.action === 'SELL') {
          toast({
            title: "Pool Exit Executed",
            description: `${orderType} exit for ${symbol} approved: ${decision.reason}`,
          });
          console.log(`✅ POOL_MANAGER: Pool exit intent approved and executed`);
          return true;
        } else {
          toast({
            title: "Pool Exit Blocked",
            description: `${orderType} exit for ${symbol} blocked: ${decision.reason}`,
            variant: "destructive",
          });
          console.log(`❌ POOL_MANAGER: Pool exit intent blocked: ${decision.reason}`);
          return false;
        }
      } else {
        // Legacy direct execution (backward compatibility)
        console.log('🔄 POOL_MANAGER: Unified decisions disabled, executing pool exit directly');
        return await executePoolSellOrderDirectly(symbol, qty, price, strategyId, orderType);
      }

    } catch (error) {
      console.error('❌ POOL_MANAGER: Error in pool exit intent:', error);
      toast({
        title: "Pool Exit Error",
        description: `Error processing ${orderType} exit for ${symbol}`,
        variant: "destructive",
      });
      return false;
    }
  };

  // Legacy pool exit execution (backward compatibility)
  const executePoolSellOrderDirectly = async (
    symbol: string, 
    qty: number, 
    price: number, 
    strategyId: string,
    orderType: 'secure' | 'runner'
  ): Promise<boolean> => {
    try {
      // UNIFIED PATH: Route pool exit through coordinator  
      const tradeIntent = {
        userId: user!.id,
        strategyId: strategyId,
        symbol: symbol,
        side: 'SELL' as const,
        source: 'pool' as const,
        confidence: 0.95,
        reason: `pool_${orderType}_exit`,
        qtySuggested: qty,
        metadata: {
          pool_exit: true,
          order_type: orderType
        }
      };

      const response = await supabase.functions.invoke('trading-decision-coordinator', {
        body: { intent: tradeIntent }
      });

      if (response.error) {
        console.error(`❌ POOL_MANAGER: Coordinator error:`, response.error);
        return false;
      }

      toast({
        title: `Pool ${orderType} exit executed`,
        description: `Sold ${qty.toFixed(4)} ${symbol} at €${price.toFixed(2)}`
      });

      return true;
    } catch (error) {
      console.error(`❌ POOL_MANAGER: Error in executeSellOrder (${orderType}):`, error);
      return false;
    }
  };

  /**
   * Process secure portion exit logic
   */
  const processSecureExit = async (
    pool: CoinPoolView,
    config: PoolConfig,
    state: PoolState,
    strategyId: string,
    openTrades: Trade[]
  ): Promise<PoolState> => {
    const updatedState = { ...state };

    if (!shouldTriggerSecure(pool, config, state.secure_filled_qty)) {
      return updatedState;
    }

    const remainingSecureQty = computeSecureTargetQty(pool.totalQty, config.secure_pct, state.secure_filled_qty);
    const sellQty = roundToTick(remainingSecureQty, config.qty_tick);

    // Check minimum order notional
    const orderValue = sellQty * pool.lastPrice;
    if (orderValue < config.min_order_notional) {
      console.log('🔶 POOL_MANAGER: Secure order below minimum notional, skipping');
      return updatedState;
    }

    // Execute secure sell order
    const success = await executeSellOrder(pool.symbol, sellQty, pool.lastPrice, strategyId, 'secure');
    
    if (success) {
      updatedState.secure_filled_qty += sellQty;
      
      // Allocate pro-rata to underlying trades
      const allocations = allocateFillProRata(sellQty, openTrades, config.qty_tick);
      console.log('📊 POOL_MANAGER: Secure allocation:', allocations);
      
      console.log(`✅ POOL_MANAGER: Secure portion filled: ${updatedState.secure_filled_qty.toFixed(8)}/${(pool.totalQty * config.secure_pct).toFixed(8)}`);
    }

    return updatedState;
  };

  /**
   * Process runner portion logic (arming and trailing)
   */
  const processRunnerLogic = async (
    pool: CoinPoolView,
    config: PoolConfig,
    state: PoolState,
    strategyId: string,
    openTrades: Trade[]
  ): Promise<PoolState> => {
    const updatedState = { ...state };
    const now = Date.now();
    const symbolKey = `${pool.symbol}_${strategyId}`;

    // Check if we should arm the runner
    if (shouldArmRunner(pool, config, state.is_armed)) {
      updatedState.is_armed = true;
      updatedState.high_water_price = pool.lastPrice;
      updatedState.last_trailing_stop_price = nextTrailingStop(pool.lastPrice, config, config.price_tick);
      
      console.log(`🎯 POOL_MANAGER: Runner armed for ${pool.symbol} at ${pool.lastPrice.toFixed(4)}, stop at ${updatedState.last_trailing_stop_price?.toFixed(4)}`);
      return updatedState;
    }

    // Process trailing logic if armed
    if (updatedState.is_armed && updatedState.high_water_price && updatedState.last_trailing_stop_price) {
      // Update high water mark
      if (pool.lastPrice > updatedState.high_water_price) {
        updatedState.high_water_price = pool.lastPrice;
        
        // Calculate new trailing stop
        const newStop = nextTrailingStop(pool.lastPrice, config, config.price_tick);
        
        // Only update if stop goes higher and cooldown passed (≥500ms)
        const lastUpdate = lastTrailingUpdateRef.current.get(symbolKey) || 0;
        const cooldownPassed = now - lastUpdate >= 500;
        
        if (newStop > updatedState.last_trailing_stop_price && cooldownPassed) {
          updatedState.last_trailing_stop_price = newStop;
          lastTrailingUpdateRef.current.set(symbolKey, now);
          
          console.log(`📈 POOL_MANAGER: Trailing stop updated for ${pool.symbol}: ${newStop.toFixed(4)} (HW: ${updatedState.high_water_price.toFixed(4)})`);
        }
      }

      // Check if stop was hit
      if (shouldTriggerTrailingStop(pool.lastPrice, updatedState.last_trailing_stop_price)) {
        const runnerQty = pool.totalQty * (1 - config.secure_pct);
        const sellQty = roundToTick(runnerQty, config.qty_tick);
        
        // Check minimum order notional
        const orderValue = sellQty * pool.lastPrice;
        if (orderValue >= config.min_order_notional) {
          const success = await executeSellOrder(pool.symbol, sellQty, pool.lastPrice, strategyId, 'runner');
          
          if (success) {
            // Allocate pro-rata to underlying trades
            const allocations = allocateFillProRata(sellQty, openTrades, config.qty_tick);
            console.log('📊 POOL_MANAGER: Runner allocation:', allocations);
            
            // Reset pool state after runner exit
            updatedState.secure_filled_qty = 0;
            updatedState.runner_remaining_qty = 0;
            updatedState.is_armed = false;
            updatedState.high_water_price = null;
            updatedState.last_trailing_stop_price = null;
            
            console.log(`🎯 POOL_MANAGER: Runner exited for ${pool.symbol}, pool reset`);
          }
        }
      }
    }

    return updatedState;
  };

  /**
   * Process pool exit logic for a specific strategy and symbol
   */
  const processPoolForSymbol = async (
    strategyId: string, 
    symbol: string, 
    config: PoolConfig,
    openTrades: Trade[]
  ) => {
    if (!user || !isEnabled || !config.pool_enabled) return;
    
    const symbolKey = `${symbol}_${strategyId}`;
    
    // Prevent concurrent processing for same symbol
    if (processingRef.current.has(symbolKey)) return;
    
    const releaseLock = await symbolMutex.acquire(symbolKey);
    processingRef.current.add(symbolKey);
    
    try {
      // Get current market price
      const allMarketData = await getCurrentData([symbol]);
      const marketPrice = allMarketData[symbol]?.price;
      if (!marketPrice || marketPrice <= 0) {
        console.log(`🔶 POOL_MANAGER: No market data for ${symbol}`);
        return;
      }

      // Build pool view
      const pool = buildCoinPoolView(openTrades, symbol, marketPrice);
      if (pool.totalQty <= 0) {
        console.log(`🔶 POOL_MANAGER: No open positions for ${symbol}`);
        return;
      }

      // Load or initialize pool state
      let state = await loadPoolState(user.id, strategyId, symbol);
      if (!state) {
        state = initializePoolState(user.id, strategyId, symbol, config);
        console.log(`🆕 POOL_MANAGER: Initialized new pool state for ${symbol}`);
      }

      console.log(`📊 POOL_MANAGER: Processing ${symbol} pool:`, {
        totalQty: pool.totalQty.toFixed(8),
        avgEntry: pool.avgEntry.toFixed(4),
        lastPrice: pool.lastPrice.toFixed(4),
        poolPnlPct: pool.poolPnlPct.toFixed(2) + '%',
        secureTarget: (pool.totalQty * config.secure_pct).toFixed(8),
        secureFilled: state.secure_filled_qty.toFixed(8),
        isArmed: state.is_armed
      });

      // Process secure portion
      const stateAfterSecure = await processSecureExit(pool, config, state, strategyId, openTrades);

      // Process runner portion
      const finalState = await processRunnerLogic(pool, config, stateAfterSecure, strategyId, openTrades);

      // Update pool state if changed
      if (JSON.stringify(state) !== JSON.stringify(finalState)) {
        await upsertPoolState(finalState);
        console.log(`💾 POOL_MANAGER: Pool state updated for ${symbol}`);
      }

    } catch (error) {
      console.error(`❌ POOL_MANAGER: Error processing pool for ${symbol}:`, error);
    } finally {
      processingRef.current.delete(symbolKey);
      releaseLock();
    }
  };

  /**
   * Main pool processing function
   */
  const processAllPools = async () => {
    if (!user || !isEnabled || !testMode) return;

    try {
      // Get all active strategies for the user
      const { data: strategies, error: strategiesError } = await supabase
        .from('trading_strategies')
        .select('id, configuration')
        .eq('user_id', user.id)
        .eq('is_active_test', true);

      if (strategiesError) {
        console.error('❌ POOL_MANAGER: Error fetching strategies:', strategiesError);
        return;
      }

      for (const strategy of strategies || []) {
        const config = strategy.configuration as any;
        const poolConfig = config?.poolExitConfig;
        
        if (!poolConfig?.pool_enabled) continue;

        // Get open trades for this strategy
        const openTrades = await getOpenTrades(user.id, strategy.id);
        if (openTrades.length === 0) continue;

        // Group trades by symbol
        const tradesBySymbol = new Map<string, Trade[]>();
        for (const trade of openTrades) {
          const symbol = trade.cryptocurrency.replace('-EUR', '').toUpperCase();
          if (!tradesBySymbol.has(symbol)) {
            tradesBySymbol.set(symbol, []);
          }
          tradesBySymbol.get(symbol)!.push(trade);
        }

        // Process each symbol pool
        for (const [symbol, symbolTrades] of tradesBySymbol) {
          await processPoolForSymbol(strategy.id, symbol, poolConfig, symbolTrades);
        }
      }
    } catch (error) {
      console.error('❌ POOL_MANAGER: Error in processAllPools:', error);
    }
  };

  // Set up periodic processing
  useEffect(() => {
    if (!isEnabled || !testMode || !user) return;

    console.log('🚀 POOL_MANAGER: Starting pool exit manager');

    // Process pools every 5 seconds
    const interval = setInterval(() => {
      processAllPools();
    }, 5000);

    // Initial run
    processAllPools();

    return () => {
      clearInterval(interval);
      console.log('🛑 POOL_MANAGER: Stopped pool exit manager');
    };
  }, [isEnabled, testMode, user]);

  return {
    processAllPools
  };
};