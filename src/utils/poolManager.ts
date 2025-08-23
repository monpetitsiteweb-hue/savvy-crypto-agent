import { supabase } from '@/integrations/supabase/client';

export interface PoolConfig {
  pool_enabled: boolean;
  secure_pct: number;
  secure_tp_pct: number;
  secure_sl_pct?: number;
  runner_trail_pct: number;
  runner_arm_pct: number;
  qty_tick: number;
  price_tick: number;
  min_order_notional: number;
}

export interface Trade {
  id: string;
  cryptocurrency: string;
  amount: number;
  price: number;
  total_value: number;
  executed_at: string;
  trade_type: 'buy' | 'sell';
  user_id: string;
  strategy_id: string;
}

export interface CoinPoolView {
  symbol: string;
  totalQty: number;
  avgEntry: number;
  lastPrice: number;
  poolPnlPct: number;
  currentValue: number;
  totalCostBasis: number;
}

export interface PoolState {
  id?: string;
  user_id: string;
  strategy_id: string;
  symbol: string;
  secure_target_qty: number;
  secure_filled_qty: number;
  runner_remaining_qty: number;
  is_armed: boolean;
  high_water_price: number | null;
  last_trailing_stop_price: number | null;
  config_snapshot: PoolConfig;
  created_at?: string;
  updated_at?: string;
}

export interface AllocationRecord {
  trade_id: string;
  allocated_qty: number;
  remaining_qty: number;
}

/**
 * Build coin pool view from open trades for a specific symbol
 */
export function buildCoinPoolView(openTrades: Trade[], symbol: string, lastPrice: number): CoinPoolView {
  // Filter trades for this symbol (normalize symbol by removing -EUR suffix)
  const normalizedSymbol = symbol.replace('-EUR', '').toUpperCase();
  const symbolTrades = openTrades.filter(trade => {
    const tradeSymbol = trade.cryptocurrency.replace('-EUR', '').toUpperCase();
    return tradeSymbol === normalizedSymbol && trade.trade_type === 'buy';
  });

  if (symbolTrades.length === 0) {
    return {
      symbol: normalizedSymbol,
      totalQty: 0,
      avgEntry: 0,
      lastPrice,
      poolPnlPct: 0,
      currentValue: 0,
      totalCostBasis: 0
    };
  }

  // Calculate aggregate metrics
  const totalQty = symbolTrades.reduce((sum, trade) => sum + trade.amount, 0);
  const totalCostBasis = symbolTrades.reduce((sum, trade) => sum + trade.total_value, 0);
  const avgEntry = totalCostBasis / totalQty;
  const currentValue = totalQty * lastPrice;
  const poolPnlPct = ((currentValue - totalCostBasis) / totalCostBasis) * 100;

  return {
    symbol: normalizedSymbol,
    totalQty,
    avgEntry,
    lastPrice,
    poolPnlPct,
    currentValue,
    totalCostBasis
  };
}

/**
 * Calculate how much of the secure portion should be targeted
 */
export function computeSecureTargetQty(totalQty: number, secure_pct: number, secure_filled_qty: number): number {
  const targetQty = totalQty * secure_pct;
  return Math.max(0, targetQty - secure_filled_qty);
}

/**
 * Check if secure portion should trigger (TP hit and not fully filled)
 */
export function shouldTriggerSecure(pool: CoinPoolView, cfg: PoolConfig, secure_filled_qty: number): boolean {
  if (!cfg.pool_enabled || pool.totalQty === 0) return false;
  
  // Check if we've hit the secure take-profit threshold
  const hitTakeProfit = pool.poolPnlPct >= cfg.secure_tp_pct;
  
  // Check if we still have secure quantity to fill
  const secureTarget = pool.totalQty * cfg.secure_pct;
  const hasRemainingSecure = secure_filled_qty < secureTarget;
  
  return hitTakeProfit && hasRemainingSecure;
}

/**
 * Check if runner portion should be armed (profit threshold reached)
 */
export function shouldArmRunner(pool: CoinPoolView, cfg: PoolConfig, is_armed: boolean): boolean {
  if (!cfg.pool_enabled || pool.totalQty === 0 || is_armed) return false;
  
  // Arm when we hit the runner arm profit threshold
  return pool.poolPnlPct >= cfg.runner_arm_pct;
}

/**
 * Calculate next trailing stop price
 */
export function nextTrailingStop(highWater: number, cfg: PoolConfig, price_tick: number): number {
  const trailDistance = cfg.runner_trail_pct / 100;
  const rawStop = highWater * (1 - trailDistance);
  
  // Round to price tick
  return Math.floor(rawStop / price_tick) * price_tick;
}

/**
 * Check if trailing stop should trigger (price hit stop level)
 */
export function shouldTriggerTrailingStop(currentPrice: number, stopPrice: number | null): boolean {
  return stopPrice !== null && currentPrice <= stopPrice;
}

/**
 * Round quantity to tick size
 */
export function roundToTick(value: number, tick: number): number {
  return Math.floor(value / tick) * tick;
}

/**
 * Load pool state from database
 */
export async function loadPoolState(user_id: string, strategy_id: string, symbol: string): Promise<PoolState | null> {
  try {
    const normalizedSymbol = symbol.replace('-EUR', '').toUpperCase();
    
    const { data, error } = await supabase
      .from('coin_pool_states')
      .select('*')
      .eq('user_id', user_id)
      .eq('strategy_id', strategy_id)
      .eq('symbol', normalizedSymbol)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error loading pool state:', error);
      return null;
    }

    if (!data) return null;

    // Parse config_snapshot from Json to PoolConfig
    return {
      ...data,
      config_snapshot: (data.config_snapshot as unknown) as PoolConfig
    };
  } catch (error) {
    console.error('Error in loadPoolState:', error);
    return null;
  }
}

/**
 * Upsert pool state to database
 */
export async function upsertPoolState(state: PoolState): Promise<boolean> {
  try {
    // Convert PoolConfig to Json for database storage
    const dbState = {
      ...state,
      config_snapshot: state.config_snapshot as any // Cast to Json type
    };

    const { error } = await supabase
      .from('coin_pool_states')
      .upsert(dbState, {
        onConflict: 'user_id,strategy_id,symbol'
      });

    if (error) {
      console.error('Error upserting pool state:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in upsertPoolState:', error);
    return false;
  }
}

/**
 * Allocate fill quantity pro-rata across open trades
 */
export function allocateFillProRata(fillQty: number, openTrades: Trade[], qty_tick: number): AllocationRecord[] {
  if (openTrades.length === 0 || fillQty <= 0) return [];

  const totalQty = openTrades.reduce((sum, trade) => sum + trade.amount, 0);
  if (totalQty === 0) return [];

  const allocations: AllocationRecord[] = [];
  let remainingFill = fillQty;

  // Calculate raw allocations
  const rawAllocations = openTrades.map(trade => ({
    trade_id: trade.id,
    raw_allocation: (fillQty * trade.amount) / totalQty,
    trade_qty: trade.amount
  }));

  // Round down to tick size and track remainders
  const roundedAllocations = rawAllocations.map(item => ({
    ...item,
    allocated_qty: roundToTick(item.raw_allocation, qty_tick),
    remainder: item.raw_allocation % qty_tick
  }));

  // Distribute remaining quantity to largest remainders
  let totalAllocated = roundedAllocations.reduce((sum, item) => sum + item.allocated_qty, 0);
  remainingFill = fillQty - totalAllocated;

  // Sort by remainder descending and allocate remaining ticks
  const sortedByRemainder = [...roundedAllocations].sort((a, b) => b.remainder - a.remainder);
  
  for (let i = 0; i < sortedByRemainder.length && remainingFill >= qty_tick; i++) {
    const item = sortedByRemainder[i];
    if (item.allocated_qty + qty_tick <= item.trade_qty) {
      item.allocated_qty += qty_tick;
      remainingFill -= qty_tick;
    }
  }

  // Build final allocation records
  for (const item of roundedAllocations) {
    const finalItem = sortedByRemainder.find(sorted => sorted.trade_id === item.trade_id)!;
    allocations.push({
      trade_id: item.trade_id,
      allocated_qty: finalItem.allocated_qty,
      remaining_qty: item.trade_qty - finalItem.allocated_qty
    });
  }

  return allocations;
}

/**
 * Initialize default pool state
 */
export function initializePoolState(user_id: string, strategy_id: string, symbol: string, config: PoolConfig): PoolState {
  const normalizedSymbol = symbol.replace('-EUR', '').toUpperCase();
  
  return {
    user_id,
    strategy_id,
    symbol: normalizedSymbol,
    secure_target_qty: 0,
    secure_filled_qty: 0,
    runner_remaining_qty: 0,
    is_armed: false,
    high_water_price: null,
    last_trailing_stop_price: null,
    config_snapshot: { ...config }
  };
}

/**
 * Per-symbol mutex for preventing concurrent pool operations
 */
class SymbolMutex {
  private locks = new Map<string, Promise<void>>();

  async acquire(symbol: string): Promise<() => void> {
    const normalizedSymbol = symbol.replace('-EUR', '').toUpperCase();
    
    // Wait for any existing lock
    const existingLock = this.locks.get(normalizedSymbol);
    if (existingLock) {
      await existingLock;
    }

    // Create new lock
    let releaseLock: () => void;
    const lockPromise = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    this.locks.set(normalizedSymbol, lockPromise);

    return () => {
      this.locks.delete(normalizedSymbol);
      releaseLock!();
    };
  }
}

export const symbolMutex = new SymbolMutex();