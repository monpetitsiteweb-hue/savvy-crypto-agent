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
import { StrategyData, normalizeStrategy } from '@/types/strategy';

interface PoolExitManagerProps {
  isEnabled: boolean;
  testMode: boolean;
}

export const usePoolExitManager = ({ isEnabled, testMode }: PoolExitManagerProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { getCurrentData } = useRealTimeMarketData();
  
  const lastTrailingUpdateRef = useRef<Map<string, number>>(new Map());
  const processingRef = useRef<Set<string>>(new Set());

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
        return [];
      }

      return (data || []).map(trade => ({
        ...trade,
        trade_type: trade.trade_type as 'buy' | 'sell'
      }));
    } catch {
      return [];
    }
  };

  const executeSellOrder = async (
    symbol: string, 
    qty: number, 
    price: number, 
    strategyId: string,
    orderType: 'secure' | 'runner'
  ): Promise<boolean> => {
    if (!user || !testMode) return false;

    try {
      const { data: strategy, error: strategyError } = await supabase
        .from('trading_strategies')
        .select('unified_config, configuration')
        .eq('id', strategyId)
        .eq('user_id', user.id)
        .single();

      if (strategyError || !strategy) {
        return false;
      }

      const unifiedConfig = {
        enableUnifiedDecisions: false,
        minHoldPeriodMs: 300000,
        cooldownBetweenOppositeActionsMs: 180000,
        confidenceOverrideThreshold: 0.7,
      };

      if ((unifiedConfig as any)?.enableUnifiedDecisions) {
        const intent = {
          userId: user.id,
          strategyId: strategyId,
          symbol: symbol.includes('-EUR') ? symbol : `${symbol}-EUR`,
          side: 'SELL' as const,
          source: 'pool' as const,
          confidence: 0.90,
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

        const { data: decision, error } = await supabase.functions.invoke('trading-decision-coordinator', {
          body: { intent }
        });

        if (error) {
          toast({
            title: "Pool Exit Intent Failed",
            description: `Failed to process ${orderType} exit intent for ${symbol}: ${error.message}`,
            variant: "destructive",
          });
          return false;
        }

        if (decision.approved && decision.action === 'SELL') {
          toast({
            title: "Pool Exit Executed",
            description: `${orderType} exit for ${symbol} approved: ${decision.reason}`,
          });
          return true;
        } else {
          toast({
            title: "Pool Exit Blocked",
            description: `${orderType} exit for ${symbol} blocked: ${decision.reason}`,
            variant: "destructive",
          });
          return false;
        }
      } else {
        return await executePoolSellOrderDirectly(symbol, qty, price, strategyId, orderType);
      }

    } catch {
      toast({
        title: "Pool Exit Error",
        description: `Error processing ${orderType} exit for ${symbol}`,
        variant: "destructive",
      });
      return false;
    }
  };

  const executePoolSellOrderDirectly = async (
    symbol: string, 
    qty: number, 
    price: number, 
    strategyId: string,
    orderType: 'secure' | 'runner'
  ): Promise<boolean> => {
    try {
      const sellTrade = {
        user_id: user!.id,
        strategy_id: strategyId,
        trade_type: 'sell',
        cryptocurrency: symbol,
        amount: qty,
        price: price,
        total_value: qty * price,
        executed_at: new Date().toISOString(),
        is_test_mode: true,
        notes: `Pool ${orderType} exit`,
        strategy_trigger: `pool_${orderType}_exit`
      };

      const { error } = await supabase
        .from('mock_trades')
        .insert([sellTrade]);

      if (error) {
        return false;
      }

      toast({
        title: `Pool ${orderType} exit executed`,
        description: `Sold ${qty.toFixed(4)} ${symbol} at €${price.toFixed(2)}`
      });

      return true;
    } catch {
      return false;
    }
  };

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

    const orderValue = sellQty * pool.lastPrice;
    if (orderValue < config.min_order_notional) {
      return updatedState;
    }

    const success = await executeSellOrder(pool.symbol, sellQty, pool.lastPrice, strategyId, 'secure');
    
    if (success) {
      updatedState.secure_filled_qty += sellQty;
      allocateFillProRata(sellQty, openTrades, config.qty_tick);
    }

    return updatedState;
  };

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

    if (shouldArmRunner(pool, config, state.is_armed)) {
      updatedState.is_armed = true;
      updatedState.high_water_price = pool.lastPrice;
      updatedState.last_trailing_stop_price = nextTrailingStop(pool.lastPrice, config, config.price_tick);
      return updatedState;
    }

    if (updatedState.is_armed && updatedState.high_water_price && updatedState.last_trailing_stop_price) {
      if (pool.lastPrice > updatedState.high_water_price) {
        updatedState.high_water_price = pool.lastPrice;
        
        const newStop = nextTrailingStop(pool.lastPrice, config, config.price_tick);
        
        const lastUpdate = lastTrailingUpdateRef.current.get(symbolKey) || 0;
        const cooldownPassed = now - lastUpdate >= 500;
        
        if (newStop > updatedState.last_trailing_stop_price && cooldownPassed) {
          updatedState.last_trailing_stop_price = newStop;
          lastTrailingUpdateRef.current.set(symbolKey, now);
        }
      }

      if (shouldTriggerTrailingStop(pool.lastPrice, updatedState.last_trailing_stop_price)) {
        const runnerQty = pool.totalQty * (1 - config.secure_pct);
        const sellQty = roundToTick(runnerQty, config.qty_tick);
        
        const orderValue = sellQty * pool.lastPrice;
        if (orderValue >= config.min_order_notional) {
          const success = await executeSellOrder(pool.symbol, sellQty, pool.lastPrice, strategyId, 'runner');
          
          if (success) {
            allocateFillProRata(sellQty, openTrades, config.qty_tick);
            
            updatedState.secure_filled_qty = 0;
            updatedState.runner_remaining_qty = 0;
            updatedState.is_armed = false;
            updatedState.high_water_price = null;
            updatedState.last_trailing_stop_price = null;
          }
        }
      }
    }

    return updatedState;
  };

  const processPoolForSymbol = async (
    strategyId: string, 
    symbol: string, 
    config: PoolConfig,
    openTrades: Trade[]
  ) => {
    if (!user || !isEnabled || !config.pool_enabled) return;
    
    const symbolKey = `${symbol}_${strategyId}`;
    
    if (processingRef.current.has(symbolKey)) return;
    
    const releaseLock = await symbolMutex.acquire(symbolKey);
    processingRef.current.add(symbolKey);
    
    try {
      const allMarketData = await getCurrentData([symbol]);
      const marketPrice = allMarketData[symbol]?.price;
      if (!marketPrice || marketPrice <= 0) {
        return;
      }

      const pool = buildCoinPoolView(openTrades, symbol, marketPrice);
      if (pool.totalQty <= 0) {
        return;
      }

      let state = await loadPoolState(user.id, strategyId, symbol);
      if (!state) {
        state = initializePoolState(user.id, strategyId, symbol, config);
      }

      const stateAfterSecure = await processSecureExit(pool, config, state, strategyId, openTrades);
      const finalState = await processRunnerLogic(pool, config, stateAfterSecure, strategyId, openTrades);

      if (JSON.stringify(state) !== JSON.stringify(finalState)) {
        await upsertPoolState(finalState);
      }

    } catch {
      // Silently handle errors
    } finally {
      processingRef.current.delete(symbolKey);
      releaseLock();
    }
  };

  const processAllPools = async () => {
    if (!user || !isEnabled || !testMode) return;

    try {
      const { data: strategyRows, error: strategiesError } = await (supabase as any)
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .eq('test_mode', true);

      if (strategiesError) {
        return;
      }

      const strategies: StrategyData[] = (strategyRows || []).map(normalizeStrategy);
      const activeTestStrategies = strategies.filter(s => s.is_active_test);

      for (const strategy of activeTestStrategies || []) {
        const config = strategy.configuration as any;
        const poolConfig = config?.poolExitConfig;
        
        if (!poolConfig?.pool_enabled) continue;

        const openTrades = await getOpenTrades(user.id, strategy.id);
        if (openTrades.length === 0) continue;

        const tradesBySymbol = new Map<string, Trade[]>();
        for (const trade of openTrades) {
          const symbol = trade.cryptocurrency.replace('-EUR', '').toUpperCase();
          if (!tradesBySymbol.has(symbol)) {
            tradesBySymbol.set(symbol, []);
          }
          tradesBySymbol.get(symbol)!.push(trade);
        }

        for (const [symbol, symbolTrades] of tradesBySymbol) {
          await processPoolForSymbol(strategy.id, symbol, poolConfig, symbolTrades);
        }
      }
    } catch {
      // Silently handle errors
    }
  };

  useEffect(() => {
    if (!isEnabled || !testMode || !user) return;

    // PERFORMANCE FIX: Reduced from 5s to 60s to prevent DB overload
    const POOL_CHECK_INTERVAL_MS = 60000; // 1 minute

    const interval = setInterval(() => {
      processAllPools();
    }, POOL_CHECK_INTERVAL_MS);

    processAllPools();

    return () => {
      clearInterval(interval);
    };
  }, [isEnabled, testMode, user]);

  return {
    processAllPools
  };
};