import { useState, useEffect, useRef, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, ArrowDownLeft, Clock, Activity, RefreshCw, TrendingUp, DollarSign, PieChart, Target } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useMockWallet } from '@/hooks/useMockWallet';
import { NoActiveStrategyState } from './NoActiveStrategyState';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { useRealTimeMarketData } from '@/hooks/useRealTimeMarketData';
import { checkIntegrity, calculateOpenPosition, processPastPosition } from '@/utils/valuationService';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, Lock } from 'lucide-react';
import { useCoordinatorToast } from '@/hooks/useCoordinatorToast';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
import { getDebugFlags } from '@/utils/debugFlags';
import { initPriceCache, setSymbols, getPriceMap, getPrice } from '@/price/PriceCache';
import { initNotificationSink, NotificationSink } from '@/notifications/NotificationSink';

// Safe debug flags using utils parser
const Flags = getDebugFlags(window.location.search);
// global OFF if safe
const effective = Flags.safe ? { 
  ...Flags, 
  mutePriceLogs: false, 
  disableRowPriceLookups: false, 
  limitRows: 0, 
  debugHistory: false 
} : Flags;

// Feature flags for price cache and silent notifications
const ENABLE_PRICE_CACHE = (() => {
  try {
    const envFlag = import.meta.env.VITE_HISTORY_PRICE_CACHE === '1';
    const urlFlag = new URLSearchParams(window.location.search).get('priceCache') === '1';
    return envFlag || urlFlag;
  } catch { return false; }
})();

const DISABLE_UI_TOASTS = (() => {
  try {
    const urlFlag = new URLSearchParams(window.location.search).get('muteToasts') === '1';
    return ENABLE_PRICE_CACHE && urlFlag; // Only when price cache is enabled
  } catch { return false; }
})();

const DEBUG_HISTORY_BLINK = effective.debugHistory;

// Step 3: Props fingerprinting helper
const fp = (v: any): string => {
  if (v == null) return 'null';
  if (Array.isArray(v)) return `arr(len=${v.length})`;
  if (typeof v === 'object') {
    const keys = Object.keys(v).slice(0, 4).join(',');
    return `obj(${keys})`;
  }
  if (typeof v === 'function') return 'fn';
  return String(v);
};

// Step 2B: Runtime isolation toggles
const DEBUG_NO_REALTIME = 
  (() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.has('noRealtime') || sessionStorage.getItem('DEBUG_NO_REALTIME') === 'true';
    } catch { return false; }
  })();

const DEBUG_NO_REFETCH = 
  (() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.has('noRefetch') || sessionStorage.getItem('DEBUG_NO_REFETCH') === 'true';
    } catch { return false; }
  })();

// Fast-track toggles (only active when debug=history present)
const FREEZE_HISTORY_UPDATES = DEBUG_HISTORY_BLINK && 
  (() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('freezeHistoryUpdates') === '1' || sessionStorage.getItem('freezeHistoryUpdates') === '1';
    } catch { return false; }
  })();

// Step 6: Price decouple and throttle toggles (only active when debug=history present)
const DISCONNECT_HISTORY_FROM_PRICES = DEBUG_HISTORY_BLINK && 
  (() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('disconnectHistoryFromPrices') === '1';
    } catch { return false; }
  })();

// Step 8: Hard-freeze switches (diagnosis only)
const FORCE_FREEZE_HISTORY = DEBUG_HISTORY_BLINK && 
  (() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('forceFreezeHistory') === '1';
    } catch { return false; }
  })();

const MUTE_HISTORY_LOADING = DEBUG_HISTORY_BLINK && 
  (() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('muteHistoryLoading') === '1' || sessionStorage.getItem('muteHistoryLoading') === '1';
    } catch { return false; }
  })();

const LOCK_HISTORY_SORT = DEBUG_HISTORY_BLINK && 
  (() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('lockHistorySort') === '1' || sessionStorage.getItem('lockHistorySort') === '1';
    } catch { return false; }
  })();

// Step 3: noPrice isolator
const DEBUG_NO_PRICE = DEBUG_HISTORY_BLINK && 
  (() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('noPrice') === '1' || sessionStorage.getItem('DEBUG_NO_PRICE') === '1';
    } catch { return false; }
  })();

// Missing hold constants
const HOLD_POSITIONS = false;
const HOLD_LOADING = false;
const HOLD_FILTERS = false;
const HOLD_PRICE = false;

// New prod-safe runtime toggles for reducing churn
const MUTE_PRICE_LOGS = DEBUG_HISTORY_BLINK && effective.mutePriceLogs;
const DISABLE_ROW_PRICE_LOOKUPS = DEBUG_HISTORY_BLINK && effective.disableRowPriceLookups;
const LIMIT_ROWS = DEBUG_HISTORY_BLINK && effective.limitRows > 0 ? effective.limitRows : null;

// Rate-limited price logging aggregator
const priceLogAggregator = (() => {
  let rowLookups = 0;
  let symbols = new Set<string>();
  let requests = 0;
  let lastReport = 0;
  const REPORT_INTERVAL = 1000; // 1 second

  return {
    recordRowLookup: (symbol: string) => {
      rowLookups++;
      symbols.add(symbol);
    },
    recordRequest: () => {
      requests++;
    },
    maybeReport: () => {
      const now = performance.now();
      if (now - lastReport > REPORT_INTERVAL) {
        if (rowLookups > 0 || requests > 0) {
          console.info(`[HistoryBlink] prices: rowLookups=${rowLookups}/s symbols=${symbols.size} req=${requests}/s`);
        }
        rowLookups = 0;
        symbols.clear();
        requests = 0;
        lastReport = now;
      }
    }
  };
})();

// Missing helper functions
// Position update funnel with tagging and blocking (diagnosis only)
const applyPositionsUpdate = (() => {
  let lastSignature = '';
  let lastLogTime = 0;
  const RATE_LIMIT_MS = 500;

  return (
    tag: 'initial' | 'supabase' | 'priceTick' | 'strategyEvent' | 'notif' | 'manualRefresh' | 'filters' | 'parentProps' | 'unknown',
    next: Trade[],
    setStateCallback: (trades: Trade[]) => void
  ) => {
    // Compute cheap signature: len|firstId|lastId|minTs|maxTs
    let sig = `${next.length}`;
    if (next.length > 0) {
      const sorted = [...next].sort((a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime());
      const firstId = sorted[0]?.id?.slice(-4) || '';
      const lastId = sorted[sorted.length - 1]?.id?.slice(-4) || '';
      const minTs = sorted[0]?.executed_at?.slice(-8) || '';
      const maxTs = sorted[sorted.length - 1]?.executed_at?.slice(-8) || '';
      sig = `${next.length}|${firstId}|${lastId}|${minTs}|${maxTs}`;
    }

    // Check for debug blocking (only when ?debug=history is present)
    if (DEBUG_HISTORY_BLINK) {
      try {
        const url = new URL(window.location.href);
        const blockApply = url.searchParams.get('blockApply');
        if (blockApply && blockApply.split(',').includes(tag)) {
          const now = performance.now();
          if (now - lastLogTime > RATE_LIMIT_MS) {
            console.info(`[HistoryBlink] applyPositions: BLOCKED tag=${tag} (debug)`);
            lastLogTime = now;
          }
          return; // Block this update
        }
      } catch {}
    }

    // Check if signature is identical to previous
    if (sig === lastSignature) {
      const now = performance.now();
      if (now - lastLogTime > RATE_LIMIT_MS) {
        console.info(`[HistoryBlink] applyPositions: suppressed identical update (tag=${tag})`);
        lastLogTime = now;
      }
      return; // Skip identical update
    }

    // Update state and log
    lastSignature = sig;
    setStateCallback(next);
    
    if (DEBUG_HISTORY_BLINK) {
      console.info(`[HistoryBlink] applyPositions: tag=${tag} len=${next.length} sig=${sig}`);
      console.info(`[HistoryBlink] list-replace: by=${tag} len=${next.length} reason=contentChanged`);
    }
  };
})();

const simpleIdsHash = (trades: Trade[]) => {
  return trades.slice(0,3).map(t => t.id.slice(-4)).join(',');
};

const simpleFiltersHash = (filters: any) => {
  return Object.keys(filters).length;
};

interface Trade {
  id: string;
  trade_type: string;
  cryptocurrency: string;
  amount: number;
  price: number;
  total_value: number;
  executed_at: string;
  fees?: number;
  notes?: string;
  strategy_id?: string;
  strategy_trigger?: string;
  is_test_mode?: boolean;
  profit_loss?: number;
  // PHASE 2: New snapshot fields for SELL trades
  original_purchase_amount?: number;
  original_purchase_price?: number;
  original_purchase_value?: number;
  exit_value?: number;
  realized_pnl?: number;
  realized_pnl_pct?: number;
  buy_fees?: number;
  sell_fees?: number;
  is_corrupted?: boolean;
  integrity_reason?: string;
}

interface TradePerformance {
  currentPrice: number | null;
  currentValue: number | null;
  purchaseValue: number | null;
  purchasePrice: number | null;
  gainLoss: number | null;
  gainLossPercentage: number | null;
  isAutomatedWithoutPnL?: boolean;
  isCorrupted?: boolean;
  corruptionReasons?: string[];
}

interface TradingHistoryProps {
  hasActiveStrategy: boolean;
  onCreateStrategy?: () => void;
}

// Step 8: Hard-freeze implementation
let frozenRenderRef: React.ReactElement | null = null;
let freezeLoggedRef = false;

function TradingHistoryInternal({ hasActiveStrategy, onCreateStrategy }: TradingHistoryProps) {
  // Log safe mode activation once
  useEffect(() => {
    if (effective.safe && effective.debugHistory) {
      console.info('[HistoryBlink] SAFE MODE active — debug flags ignored');
    }
    if (DISABLE_ROW_PRICE_LOOKUPS) {
      console.info('[HistoryBlink] prices: row lookups DISABLED (debug)');
    }
    if (LIMIT_ROWS && LIMIT_ROWS > 0) {
      console.info(`[HistoryBlink] rows: limitRows=${LIMIT_ROWS}`);
    }
  }, []);

  // Step 3: Component mount counter + rate limiting
  const mountCountRef = useRef(0);
  const lastLogRef = useRef(0);
  const noPriceLoggedRef = useRef(false);
  
  // Increment mount counter
  mountCountRef.current += 1;
  
  // Step 3: Log mount + props (rate-limited to 1/sec)
  useEffect(() => {
    if (DEBUG_HISTORY_BLINK) {
      const now = performance.now();
      if (now - lastLogRef.current > 1000) {
        console.info(`[HistoryBlink] <TradingHistory> mount ${mountCountRef.current} | key=undefined`);
        console.info(`[HistoryBlink] <TradingHistory> props: { hasActiveStrategy=${fp(hasActiveStrategy)}, onCreateStrategy=${fp(onCreateStrategy)} }`);
        lastLogRef.current = now;
      }
    }
  });

  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { toast } = useToast();
  const { handleCoordinatorResponse } = useCoordinatorToast();
  
  // Check if contexts should be frozen
  const shouldFreezeContexts = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get('debug') === 'history' && url.searchParams.get('freezeContexts') === '1';
    } catch {
      return false;
    }
  }, []);
  
  // Step 1: Debug instrumentation refs
  const debugHeaderLogged = useRef(false);
  const loggedKeysRef = useRef(false);
  const openMounts = useRef(0);
  const pastMounts = useRef(0);
  const openRenders = useRef(0);
  const pastRenders = useRef(0);
  const openLastLog = useRef(0);
  const pastLastLog = useRef(0);
  
  // Step 3: Additional refs for safe logging
  const tabsLastLog = useRef(0);
  
  // Step 4: Prop fingerprint refs
  const tradingHistoryLastPropLog = useRef(0);
  const openListLastPropLog = useRef(0);
  const pastListLastPropLog = useRef(0);
  
  // Step 4: Hold state refs
  const frozenPositionsRef = useRef<Trade[]>([]);
  const frozenLoadingRef = useRef<boolean>(false);
  const frozenFiltersRef = useRef<any>({});
  const holdLoggedRefs = useRef({
    positions: false,
    loading: false,
    filters: false,
    price: false
  });
  
  // Fast-track toggle refs
  const freezeLoggedRef = useRef(false);
  const muteLoggedRef = useRef(false);
  const lockLoggedRef = useRef(false);
  const lastTradesRef = useRef<Trade[]>([]);
  
  // RESTORED: useMockWallet provides real portfolio data (not related to blinking issue)
  const { getTotalValue, balances } = useMockWallet();
  
  // Step 6: Price disconnect mechanism - capture snapshot and disconnect when toggle is active
  const realMarketData = useRealTimeMarketData();
  const snapshotMarketDataRef = useRef<Record<string, any>>({});
  const priceTickLogRef = useRef(0);
  
  // Price cache state (when enabled)
  const [priceMap, setPriceMap] = useState(getPriceMap());
  const priceCacheInitRef = useRef(false);
  
  // Initialize snapshot on first load
  useEffect(() => {
    if (Object.keys(snapshotMarketDataRef.current).length === 0 && Object.keys(realMarketData.marketData).length > 0) {
      snapshotMarketDataRef.current = { ...realMarketData.marketData };
    }
  }, [realMarketData.marketData]);
  
  // Step 6: Apply price disconnection
  let marketData: Record<string, any>;
  let getCurrentData: any;
  
  if (DISCONNECT_HISTORY_FROM_PRICES) {
    // Use snapshot instead of live data
    marketData = snapshotMarketDataRef.current;
    getCurrentData = () => Promise.resolve(snapshotMarketDataRef.current);
    
    // Log disconnection once
    if (!noPriceLoggedRef.current) {
      console.info('[HistoryBlink] price: disconnected for History panel (using snapshot)');
      noPriceLoggedRef.current = true;
    }
    
    // Log suppressed price ticks (rate-limited)
    const now = performance.now();
    if (now - priceTickLogRef.current > 1000) {
      console.info('[HistoryBlink] price-tick -> would update history (suppressed=true)');
      priceTickLogRef.current = now;
    }
  } else {
    // Step 3: noPrice isolator - freeze price context updates for this panel
    marketData = DEBUG_NO_PRICE ? {} : realMarketData.marketData;
    getCurrentData = DEBUG_NO_PRICE ? () => null : realMarketData.getCurrentData;
    
    // Log active price ticks (rate-limited) 
    const now = performance.now();
    if (now - priceTickLogRef.current > 1000 && Object.keys(realMarketData.marketData).length > 0) {
      console.info('[HistoryBlink] price-tick -> would update history (suppressed=false)');
      priceTickLogRef.current = now;
    }
  }
  
  // Log noPrice isolator activation (once)
  useEffect(() => {
    if (DEBUG_NO_PRICE && !noPriceLoggedRef.current) {
      console.info('[HistoryBlink] isolator active: noPrice (history panel ignores price ticks)');
      noPriceLoggedRef.current = true;
    }
  }, []);
  
  const [feeRate, setFeeRate] = useState<number>(0);
  
  // Wrap debug logging in try/catch and use safe flags
  let dbg: any = { active: false };
  try {
    dbg = { active: effective.debugHistory, ...effective };
    
    if (MUTE_PRICE_LOGS) {
      priceLogAggregator.maybeReport();
    } else if (dbg.active) {
      console.log('🔍 HISTORY: MarketData from context:', marketData);
      console.log('🔍 HISTORY: MarketData keys:', Object.keys(marketData));
      console.log('🔍 HISTORY: Sample prices:', Object.entries(marketData).slice(0,3).map(([k,v]) => `${k}: €${v.price}`));
    }
  } catch (e) {
    console.warn("[HistoryBlink] debug block error:", e);
    dbg = { active: false, safe: true };
  }
  
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Initialize price cache and notification sink when enabled
  useEffect(() => {
    if (ENABLE_PRICE_CACHE && !priceCacheInitRef.current) {
      initPriceCache();
      priceCacheInitRef.current = true;
      const intervalMs = new URLSearchParams(window.location.search).get('priceIntervalMs') || '30000';
      console.log(`[HistoryPerf] priceCache=on intervalMs=${intervalMs}`);
    } else {
      console.log(`[HistoryPerf] priceCache=off`);
    }
    
    if (DISABLE_UI_TOASTS) {
      initNotificationSink();
      console.log(`[HistoryPerf] toasts=muted`);
    } else {
      console.log(`[HistoryPerf] toasts=ui`);
    }
  }, []);
  
  // Subscribe to price cache updates when enabled
  useEffect(() => {
    if (!ENABLE_PRICE_CACHE) return;
    
    const interval = setInterval(() => {
      const newPriceMap = getPriceMap();
      setPriceMap(newPriceMap);
    }, 1000); // Check for updates every second
    
    return () => clearInterval(interval);
  }, []);
  
  // Update symbols for price cache when trades change
  useEffect(() => {
    if (!ENABLE_PRICE_CACHE || !trades.length) return;
    
    const pairsNeeded = Array.from(new Set(
      trades
        .filter(t => t.trade_type === 'buy') // Only open positions need current prices
        .map(t => toPairSymbol(toBaseSymbol(t.cryptocurrency)))
    ));
    
    if (pairsNeeded.length > 0) {
      setSymbols(pairsNeeded);
      console.log(`[HistoryPerf] symbols=${pairsNeeded.length}`);
    }
  }, [trades]);
  
  // Step 4: Apply holds locally before passing to children
  let processedTrades = trades;
  let processedLoading = loading;
  const filters = {}; // No filters currently implemented, but ready for future
  
  // Step 4: Hold positions - freeze first loaded positions array
  if (HOLD_POSITIONS) {
    if (frozenPositionsRef.current.length === 0 && trades.length > 0) {
      frozenPositionsRef.current = [...trades]; // Capture first load
    }
    if (frozenPositionsRef.current.length > 0) {
      processedTrades = frozenPositionsRef.current; // Use frozen data
    }
    if (!holdLoggedRefs.current.positions) {
      console.info('[HistoryBlink] holdPositions: active (positions updates ignored)');
      holdLoggedRefs.current.positions = true;
    }
  }
  
  // Step 4: Hold loading - force loading=false
  if (HOLD_LOADING) {
    processedLoading = false;
    if (!holdLoggedRefs.current.loading) {
      console.info('[HistoryBlink] holdLoading: active');
      holdLoggedRefs.current.loading = true;
    }
  }
  
  // Step 4: Hold filters - freeze current filters object
  if (HOLD_FILTERS) {
    if (Object.keys(frozenFiltersRef.current).length === 0) {
      frozenFiltersRef.current = { ...filters }; // Capture first state
    }
    if (!holdLoggedRefs.current.filters) {
      console.info('[HistoryBlink] holdFilters: active');
      holdLoggedRefs.current.filters = true;
    }
  }
  
  // Step 4: Hold price - alias for noPrice isolator
  if (HOLD_PRICE && !holdLoggedRefs.current.price) {
    console.info('[HistoryBlink] holdPrice: active (alias noPrice)');
    holdLoggedRefs.current.price = true;
  }
  
  // Fast-track toggle: Shallow-equal checker for freeze updates
  const isShallowEqual = (newTrades: Trade[], oldTrades: Trade[]) => {
    if (newTrades.length !== oldTrades.length) return false;
    return newTrades.every((trade, index) => trade.id === oldTrades[index]?.id);
  };

  // Fast-track toggle: Wrapped setTrades with freeze logic
  const setTradesWithFreeze = (newTrades: Trade[], tag: 'initial' | 'supabase' | 'priceTick' | 'strategyEvent' | 'notif' | 'manualRefresh' | 'filters' | 'parentProps' | 'unknown' = 'unknown') => {
    if (FREEZE_HISTORY_UPDATES) {
      if (isShallowEqual(newTrades, lastTradesRef.current)) {
        if (!freezeLoggedRef.current) {
          console.info('[HistoryBlink] freeze: suppressed identical update');
          freezeLoggedRef.current = true;
        }
        return; // Suppress update
      }
    }
    lastTradesRef.current = newTrades;
    setTrades(newTrades);
  };

  // Fast-track toggle: Override loading state for history panel
  const historyLoading = MUTE_HISTORY_LOADING ? false : loading;
  const [connections, setConnections] = useState<any[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<string>('');
  const [fetching, setFetching] = useState(false);
  const [portfolioValue, setPortfolioValue] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'open' | 'past'>('open');
  const [stats, setStats] = useState({
    totalTrades: 0,
    totalVolume: 0,
    netProfitLoss: 0,
    openPositions: 0,
    totalInvested: 0,
    currentPL: 0,
    totalPL: 0,
    currentlyInvested: 0
  });
  // Removed direct edge function calls - using MarketDataProvider only

  // Step 5: Open positions calculation using MarketDataProvider only
  const calculateTradePerformance = async (trade: Trade): Promise<TradePerformance> => {
    
    if (trade.trade_type === 'sell') {
      // Step 5B: Past Positions - Use snapshot fields only, no recomputation
      const pastPosition = processPastPosition({
        original_purchase_amount: trade.original_purchase_amount,
        original_purchase_value: trade.original_purchase_value,
        original_purchase_price: trade.original_purchase_price,
        price: trade.price, // Exit price
        exit_value: trade.exit_value,
        realized_pnl: trade.realized_pnl,
        realized_pnl_pct: trade.realized_pnl_pct
      });
      
      return {
        currentPrice: pastPosition.exitPrice, // Exit price from snapshot
        currentValue: pastPosition.exitValue, // Exit value from snapshot
        purchaseValue: pastPosition.purchaseValue,
        purchasePrice: pastPosition.entryPrice,
        gainLoss: pastPosition.realizedPnL,
        gainLossPercentage: pastPosition.realizedPnLPct,
        isAutomatedWithoutPnL: false
      };
    }
    
    // Step 5A: Open Positions - Aggregated calculation with MarketDataProvider only
    const baseSymbol = toBaseSymbol(trade.cryptocurrency);
    const pairSymbol = toPairSymbol(baseSymbol);
    
    if (MUTE_PRICE_LOGS) {
      priceLogAggregator.recordRowLookup(baseSymbol);
      priceLogAggregator.maybeReport();
    } else {
      console.log('🔄 SYMBOLS: base=', baseSymbol, 'pair=', pairSymbol, 'providerKey=', pairSymbol);
    }
    
    // Get current price from cache (when enabled) or MarketDataProvider
    let currentPrice: number | null;
    
    if (ENABLE_PRICE_CACHE) {
      // Use price cache - block any per-row price codepaths
      const cacheEntry = priceMap[pairSymbol];
      currentPrice = cacheEntry?.price || null;
      
      if (!currentPrice) {
        console.warn(`[HistoryPerf] PriceCache: no price for ${pairSymbol}`);
      }
      
      // Defensive block against per-row hooks when cache is enabled
      if (effective.debugHistory) {
        console.log(`[HistoryPerf] priceCache: blocked per-row lookup for ${baseSymbol}`);
      }
    } else if (DISABLE_ROW_PRICE_LOOKUPS) {
      // Use shared snapshot from market context instead of individual lookups
      currentPrice = marketData[pairSymbol]?.price || null;
      if (MUTE_PRICE_LOGS) {
        priceLogAggregator.recordRowLookup(baseSymbol);
      }
    } else {
      // Original behavior
      currentPrice = marketData[pairSymbol]?.price || null;
      if (MUTE_PRICE_LOGS) {
        priceLogAggregator.recordRequest();
      } else {
        console.log('🔍 HISTORY: Current price for', baseSymbol, ':', currentPrice);
      }
    }
    
    // Calculate open position performance
    const openPositionInputs = {
      symbol: baseSymbol,
      amount: trade.amount,
      purchaseValue: trade.amount * trade.price,
      entryPrice: trade.price
    };
    
    const performance = calculateOpenPosition(openPositionInputs, currentPrice);
    
    return {
      currentPrice: performance.currentPrice,
      currentValue: performance.currentValue,
      purchaseValue: openPositionInputs.purchaseValue,
      purchasePrice: openPositionInputs.entryPrice,
      gainLoss: performance.pnlEur,
      gainLossPercentage: performance.pnlPct,
      isCorrupted: false,
      corruptionReasons: currentPrice === null ? ['Current price not available from MarketDataProvider'] : []
    };
  };

  // Helper functions: FIFO per-trade lots and counts
  const buildFifoLots = (allTrades: Trade[]) => {
    const sorted = [...allTrades].sort((a,b)=> new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime());
    const lotsBySymbol = new Map<string, { trade: Trade; remaining: number }[]>();
    for (const t of sorted) {
      const sym = t.cryptocurrency;
      if (!lotsBySymbol.has(sym)) lotsBySymbol.set(sym, []);
      if (t.trade_type === 'buy') {
        lotsBySymbol.get(sym)!.push({ trade: t, remaining: t.amount });
      } else if (t.trade_type === 'sell') {
        let sellRemaining = t.amount;
        const lots = lotsBySymbol.get(sym)!;
        for (let i = 0; i < lots.length && sellRemaining > 1e-12; i++) {
          const lot = lots[i];
          const used = Math.min(lot.remaining, sellRemaining);
          lot.remaining -= used;
          sellRemaining -= used;
        }
      }
    }
    const openLots: Trade[] = [];
    let closedCount = 0;
    lotsBySymbol.forEach((lots) => {
      lots.forEach(({ trade, remaining }) => {
        if (remaining > 1e-12) {
          const ratio = remaining / trade.amount;
          openLots.push({
            ...trade,
            amount: remaining,
            total_value: trade.total_value * ratio,
            fees: 0, // Zero fees for all transactions
          });
        } else {
          closedCount += 1;
        }
      });
    });
    return { openLots, closedCount };
  };

  const getOpenPositionsList = () => {
    if (trades.length === 0) return [] as Trade[];
    const { openLots } = buildFifoLots(trades);
    
    // Fast-track toggle: Lock sort to stable comparator
    if (LOCK_HISTORY_SORT) {
      if (!lockLoggedRef.current) {
        console.info('[HistoryBlink] lock: sort pinned to stable comparator');
        lockLoggedRef.current = true;
      }
      return openLots.sort((a, b) => a.id.localeCompare(b.id)); // Stable by ID
    }
    
    return openLots.sort((a, b) => new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime());
  };

  // Realized P&L using strict FIFO 
  const computeRealizedPLFIFO = (allTrades: Trade[]) => {
    const sorted = [...allTrades].sort((a,b)=> new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime());
    const lotsBySymbol = new Map<string, { price: number; remaining: number }[]>();
    let realized = 0;
    for (const t of sorted) {
      const sym = t.cryptocurrency;
      if (!lotsBySymbol.has(sym)) lotsBySymbol.set(sym, []);
      if (t.trade_type === 'buy') {
        lotsBySymbol.get(sym)!.push({ price: t.price, remaining: t.amount });
      } else if (t.trade_type === 'sell') {
        let q = t.amount;
        const lots = lotsBySymbol.get(sym)!;
        for (let i = 0; i < lots.length && q > 1e-12; i++) {
          const lot = lots[i];
          const used = Math.min(lot.remaining, q);
          realized += (t.price - lot.price) * used;
          lot.remaining -= used;
          q -= used;
        }
      }
    }
    return realized;
  };

  // Unrealized P&L from open lots - EXCLUDES CORRUPTED
  const computeUnrealizedPLFromOpenLots = async (openLots: Trade[]) => {
    let unrealizedPL = 0;
    let invested = 0;
    let corruptedCount = 0;
    
    for (const lot of openLots) {
      // Check position integrity and exclude corrupted positions from KPIs
      const performance = await calculateTradePerformance(lot);
      
      if (performance.isCorrupted) {
        corruptedCount++;
        // Skip corrupted positions in KPI calculations (logging removed to prevent spam)
        continue;
      }

      // Use ValuationService for consistent calculations
      unrealizedPL += performance.gainLoss || 0;
      invested += performance.purchaseValue || 0;
    }

    if (corruptedCount > 0) {
      // Corrupted positions excluded from KPI calculations (logging reduced)
    }

    return { unrealizedPL, invested };
  };

  const sellPosition = async (trade: Trade) => {
    if (!user) return;
    
    try {
      // CRITICAL FIX: Apply regression guards and use deterministic pricing
      const { validateTradePrice, validatePurchaseValue, logValidationFailure } = await import('../utils/regressionGuards');
      
      // Get current price from MarketDataProvider only - guard with disable flag
      const baseSymbol = toBaseSymbol(trade.cryptocurrency);
      const pairSymbol = toPairSymbol(baseSymbol);
      let currentPrice = DISABLE_ROW_PRICE_LOOKUPS ? null : marketData[pairSymbol]?.price;
      
      // Try to get deterministic price from snapshots first
      try {
        const baseSymbol = toBaseSymbol(trade.cryptocurrency);
        const { data: snapshot } = await supabase
          .from('price_snapshots')
          .select('price')
          .eq('symbol', baseSymbol)
          .order('ts', { ascending: false })
          .limit(1);
        
        if (snapshot?.[0]?.price) {
          currentPrice = snapshot[0].price;
          console.log('🎯 HISTORY: Using snapshot price for sell:', currentPrice, 'for', baseSymbol);
        }
      } catch (error) {
        console.warn('⚠️ HISTORY: Could not fetch price snapshot for sell, using market price');
      }

      // Apply price validation guard - Block €100 exactly
      const priceValidation = validateTradePrice(currentPrice, trade.cryptocurrency);
      if (!priceValidation.isValid) {
        logValidationFailure('sell_price_corruption_guard', priceValidation.errors, { currentPrice, symbol: trade.cryptocurrency });
        if (DISABLE_UI_TOASTS) {
          NotificationSink.error("sell_blocked_price", `Suspicious price detected: €${currentPrice}. Contact support.`);
        } else {
          toast({
            title: "Sell Blocked",
            description: `Suspicious price detected: €${currentPrice}. Contact support.`,
            variant: "destructive",
          });
        }
        return;
      }

      // Calculate sell value and validate consistency
      const sellAmount = trade.amount * currentPrice;
      const valueValidation = validatePurchaseValue(trade.amount, currentPrice, sellAmount);
      if (!valueValidation.isValid) {
        logValidationFailure('sell_value_consistency_guard', valueValidation.errors, { 
          amount: trade.amount, 
          price: currentPrice, 
          sellValue: sellAmount 
        });
        if (DISABLE_UI_TOASTS) {
          NotificationSink.error("sell_blocked_value", "Trade value inconsistency detected. Contact support.");
        } else {
          toast({
            title: "Sell Blocked",
            description: "Trade value inconsistency detected. Contact support.",
            variant: "destructive",
          });
        }
        return;
      }

      // Insert the sell trade with proper validation
      const sellTrade = {
        user_id: user.id,
        strategy_id: trade.strategy_id,
        trade_type: 'sell',
        cryptocurrency: trade.cryptocurrency,
        amount: trade.amount,
        price: currentPrice,
        total_value: sellAmount,
        fees: 0, // Zero fees for all transactions
        executed_at: new Date().toISOString(),
        is_test_mode: true,
        notes: `Manual sell from History panel`
      };

      const { error } = await supabase
        .from('mock_trades')
        .insert(sellTrade);

      if (error) {
        console.error('Error selling position:', error);
        if (DISABLE_UI_TOASTS) {
          NotificationSink.error("sell_failed", error.message);
        } else {
          toast({
            title: "Sell Failed",
            description: error.message,
            variant: "destructive",
          });
        }
        return;
      }

      if (DISABLE_UI_TOASTS) {
        NotificationSink.success("trade_executed", `Sold ${trade.amount} ${trade.cryptocurrency} at ${formatEuro(currentPrice)}`);
      } else {
        toast({
          title: "Trade Executed",
          description: `Sold ${trade.amount} ${trade.cryptocurrency} at ${formatEuro(currentPrice)}`,
          variant: "default",
        });
      }

      // Refresh data
      fetchTradingHistory('strategyEvent');
    } catch (error) {
      console.error('Error in sellPosition:', error);
      if (DISABLE_UI_TOASTS) {
        NotificationSink.error("sell_position_error", "Failed to sell position");
      } else {
        toast({
          title: "Error",
          description: "Failed to sell position",
          variant: "destructive",
        });
      }
    }
  };

  // Fetch trading history with proper error handling
  const fetchTradingHistory = async (source: 'initial' | 'supabase' | 'manualRefresh' | 'strategyEvent' = 'manualRefresh') => {
    if (!user) return;

    try {
      setLoading(true);
      console.log('🔍 HISTORY: Fetching trading history for user:', user.id);

      const { data, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .order('executed_at', { ascending: false });

      if (error) throw error;

      console.log('✅ HISTORY: Fetched', data?.length || 0, 'trades');
      
      // Step 2B: Source-tagged setter with freeze wrapper
      applyPositionsUpdate(source, data || [], setTradesWithFreeze);

      // Calculate stats with ValuationService
      if (data && data.length > 0) {
        const openPositions = getOpenPositionsList();
        const realizedPL = computeRealizedPLFIFO(data);
        const { unrealizedPL, invested } = await computeUnrealizedPLFromOpenLots(openPositions);

        setStats({
          totalTrades: data.length,
          totalVolume: data.reduce((sum, t) => sum + t.total_value, 0),
          netProfitLoss: realizedPL + unrealizedPL,
          openPositions: openPositions.length,
          totalInvested: invested,
          currentPL: unrealizedPL,
          totalPL: realizedPL + unrealizedPL,
          currentlyInvested: invested
        });
      }
    } catch (error) {
      console.error('❌ HISTORY: Error fetching trading history:', error);
      if (DISABLE_UI_TOASTS) {
        NotificationSink.error("fetch_history_error", "Failed to fetch trading history");
      } else {
        toast({
          title: "Error",
          description: "Failed to fetch trading history",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // Fetch user profile data
  const fetchUserProfile = async () => {
    if (!user) return;

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('fee_rate, account_type')
        .eq('id', user.id)
        .single();

      if (profile) {
        setFeeRate(0); // Always zero fees
        console.log('📊 HISTORY: Fees set to 0.00 for all transactions');
      }
    } catch (error) {
      console.error('❌ HISTORY: Error fetching user profile:', error);
    }
  };

  // Step 2B: Isolator logging and fixed noRefetch semantics
  useEffect(() => {
    if (DEBUG_HISTORY_BLINK) {
      // Log isolator states
      if (DEBUG_NO_REALTIME) {
        console.info('[HistoryBlink] isolator active: noRealtime (history channel disabled)');
      }
      if (DEBUG_NO_REFETCH) {
        console.info('[HistoryBlink] isolator active: noRefetch (initial fetch allowed, repeat disabled)');
      }
    }
  }, []);

  // Load data on component mount and when user changes  
  useEffect(() => {
    if (user) {
      // Step 2B: Allow initial fetch always, only block if explicitly isolated
      fetchTradingHistory('initial');
      fetchUserProfile();
    }
  }, [user, testMode]);

  // Fast-track toggle logging
  useEffect(() => {
    if (MUTE_HISTORY_LOADING && !muteLoggedRef.current) {
      console.info('[HistoryBlink] mute: loading/animations suppressed');
      muteLoggedRef.current = true;
    }
  }, []);

  // Step 2B: Wire manual debug handler
  useEffect(() => {
    if (DEBUG_HISTORY_BLINK && typeof window !== 'undefined') {
      (window as any).__historyDebug?._setHandler?.(fetchTradingHistory);
    }
  }, []);

  // Step 2: Print debug header for Step 2
  useEffect(() => {
    if (DEBUG_HISTORY_BLINK && !debugHeaderLogged.current) {
      console.info('[HistoryBlink] STEP 2 — Source-tagged setter logs + runtime isolators');
      debugHeaderLogged.current = true;
    }
  }, []);

  // Step 4: Prop fingerprint logging for TradingHistory (rate-limited)
  useEffect(() => {
    if (DEBUG_HISTORY_BLINK) {
      const now = performance.now();
      if (now - tradingHistoryLastPropLog.current > 1000) {
        console.info(`[HistoryBlink] props: {
  positionsRefChanged: ${processedTrades !== trades},
  len: ${processedTrades.length},
  idsHash: ${simpleIdsHash(processedTrades)},
  loading: ${processedLoading},
  filtersHash: ${simpleFiltersHash(filters)},
  priceCtxTick: ${Object.keys(marketData).length}
}`);
        tradingHistoryLastPropLog.current = now;
      }
    }
  }, [processedTrades, processedLoading, filters, marketData]);

  // Real-time subscription to mock_trades changes (throttled to prevent blinking)
  useEffect(() => {
    if (!user) return;
    
    // Step 2: Runtime isolation - skip realtime if disabled
    if (DEBUG_NO_REALTIME) {
      if (DEBUG_HISTORY_BLINK) {
        console.info('[HistoryBlink] realtime disabled by toggle');
      }
      return;
    }

    console.log('🔄 HISTORY: Setting up real-time subscription for user:', user.id);

    let refreshTimeout: NodeJS.Timeout;

    const channel = supabase
      .channel('mock_trades_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mock_trades',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          // Step 2B: Respect noRefetch for repeat fetches (not initial)
          if (DEBUG_NO_REFETCH) {
            if (DEBUG_HISTORY_BLINK) {
              console.info('[HistoryBlink] realtime fetch blocked by noRefetch toggle');
            }
            return;
          }
          
          // Throttle updates to prevent constant blinking
          clearTimeout(refreshTimeout);
          refreshTimeout = setTimeout(() => {
            fetchTradingHistory('supabase'); // This will use applyPositionsUpdate with 'supabase' tag
          }, 1000); // Wait 1 second before refreshing
        }
      )
      .subscribe();

    return () => {
      console.log('🔄 HISTORY: Cleaning up real-time subscription');
      clearTimeout(refreshTimeout);
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Badge component with single strip layout and tooltips
  const StatusBadges = ({ trade, coordinatorReason }: { trade: Trade; coordinatorReason?: string }) => {
    const isCorrupted = trade.is_corrupted;
    const isDeferred = coordinatorReason === 'atomic_section_busy_defer';
    
    if (!isCorrupted && !isDeferred) return null;

    return (
      <TooltipProvider>
        <div className="flex gap-1 mb-1">
          {isCorrupted && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="text-xs">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Corrupted
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-sm">
                  <strong>Data Integrity Issue:</strong><br />
                  {trade.integrity_reason || 'Unknown corruption detected'}
                  <br /><br />
                  This position has corrupted data and needs manual review.
                </p>
              </TooltipContent>
            </Tooltip>
          )}
          {isDeferred && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-xs">
                  <Lock className="w-3 h-3 mr-1" />
                  Deferred
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-sm">
                  <strong>Atomic Section Busy:</strong><br />
                  Concurrent trading activity detected for this symbol.
                  <br />
                  Request deferred with retry time.
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>
    );
  };

  // TradeCard component for rendering individual trades
  const TradeCard = ({ trade, showSellButton = false }: { trade: Trade; showSellButton?: boolean }) => {
    const [performance, setPerformance] = useState<TradePerformance | null>(null);
    const [cardLoading, setCardLoading] = useState(true);
    
    // Step 1: Row mount counter + stable id
    const mountRef = useRef(false);
    useEffect(() => {
      if (DEBUG_HISTORY_BLINK && !mountRef.current) {
        console.info('[HistoryBlink] row mount', trade.id);
        mountRef.current = true;
        return () => { 
          if (DEBUG_HISTORY_BLINK) console.info('[HistoryBlink] row unmount', trade.id); 
        };
      }
    }, [trade.id]);

    // FIXED: Extract only the specific price values to prevent infinite re-renders
    // Guard with disable flag for safe mode
    const specificTradePrice = DISABLE_ROW_PRICE_LOOKUPS ? null : marketData[trade.cryptocurrency]?.price;
    
    useEffect(() => {
      const loadPerformance = async () => {
        try {
          const perf = await calculateTradePerformance(trade);
          setPerformance(perf);
        } catch (error) {
          console.error('Error calculating trade performance:', error);
        } finally {
          setCardLoading(false);
        }
      };

      loadPerformance();
    }, [trade.id, specificTradePrice]); // Only use MarketDataProvider price

    if (cardLoading || !performance) {
      // Fast-track toggle: Remove animations when muted
      const pulseClass = MUTE_HISTORY_LOADING ? "" : "animate-pulse";
      return (
        <Card className={`p-4 ${pulseClass}`} data-position-row data-trade-id={trade.id}>
          <div className="h-4 bg-muted rounded w-1/3 mb-2"></div>
          <div className="h-3 bg-muted rounded w-1/2"></div>
        </Card>
      );
    }

    const isProfit = (performance.gainLoss || 0) > 0;
    const isLoss = (performance.gainLoss || 0) < 0;

    return (
      <Card className="p-4 hover:shadow-md transition-shadow" data-position-row data-trade-id={trade.id}>
        <StatusBadges trade={trade} />
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              trade.trade_type === 'buy' ? 'bg-emerald-500' : 'bg-red-500'
            }`} />
            <span className="font-semibold text-lg">{trade.cryptocurrency}</span>
          </div>
          <Badge variant={trade.trade_type === 'buy' ? 'default' : 'secondary'}>
            {trade.trade_type.toUpperCase()}
          </Badge>
        </div>
        
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Amount</p>
            <p className="font-medium">{trade.amount.toFixed(8)}</p>
          </div>
          
          <div>
            <p className="text-muted-foreground">Purchase Value</p>
            <p className="font-medium">
              {trade.trade_type === 'buy' 
                ? formatEuro(trade.total_value) 
                : formatEuro(trade.original_purchase_value || 0)
              }
            </p>
          </div>
          
          <div>
            <p className="text-muted-foreground">
              {trade.trade_type === 'buy' ? 'Purchase Price' : 'Exit Price'}
            </p>
            <p className="font-medium">{formatEuro(performance.purchasePrice || performance.currentPrice)}</p>
          </div>
          
          {trade.trade_type === 'buy' && (
            <>
              <div>
                <p className="text-muted-foreground">Current Value</p>
                <p className="font-medium">
                  {performance.currentValue !== null ? formatEuro(performance.currentValue) : "—"}
                </p>
              </div>
              
              <div>
                <p className="text-muted-foreground">Current Price</p>
                <p className="font-medium">
                  {performance.currentPrice !== null ? formatEuro(performance.currentPrice) : "—"}
                </p>
              </div>
            </>
          )}
          
          {trade.trade_type === 'sell' && (
            <div>
              <p className="text-muted-foreground">Exit Value</p>
              <p className="font-medium">{formatEuro(performance.currentValue)}</p>
            </div>
          )}
          
          {performance.gainLoss !== null && performance.gainLossPercentage !== null && (
            <>
              <div>
                <p className="text-muted-foreground">P&L (EUR)</p>
                <p className={`font-medium ${isProfit ? 'text-emerald-600' : isLoss ? 'text-red-600' : ''}`}>
                  {formatEuro(performance.gainLoss)}
                </p>
              </div>
              
              <div>
                <p className="text-muted-foreground">P&L (%)</p>
                <p className={`font-medium ${isProfit ? 'text-emerald-600' : isLoss ? 'text-red-600' : ''}`}>
                  {formatPercentage(performance.gainLossPercentage || 0)}
                </p>
              </div>
            </>
          )}
        </div>
        
        <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
          <p>Executed: {new Date(trade.executed_at).toLocaleString()}</p>
          {trade.notes && <p className="mt-1">Note: {trade.notes}</p>}
        </div>
        
        {showSellButton && trade.trade_type === 'buy' && !performance.isCorrupted && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => sellPosition(trade)}
            className="w-full mt-3"
          >
            Sell Position
          </Button>
        )}
      </Card>
    );
  };

  if (historyLoading) {
    // Fast-track toggle: Remove animations when muted
    const spinClass = MUTE_HISTORY_LOADING ? "" : "animate-spin";
    const pulseClass = MUTE_HISTORY_LOADING ? "" : "animate-pulse";
    
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <Activity className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Trading History</h2>
          <RefreshCw className={`w-4 h-4 ml-auto ${spinClass}`} />
        </div>
        <div className={pulseClass}>
          <div className="h-4 bg-muted rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3].map(i => {
              if (DEBUG_HISTORY_BLINK) console.warn('[HistoryBlink] skeleton keys: static integers detected');
              return <div key={i} className="h-16 bg-muted rounded"></div>;
            })}
          </div>
        </div>
      </Card>
    );
  }

  // Log once when debug flags are enabled - removed duplicate logging

  if (!hasActiveStrategy) {
    return <NoActiveStrategyState onCreateStrategy={onCreateStrategy} />;
  }

  const openPositions = getOpenPositionsList();
  const pastPositions = trades.filter(t => t.trade_type === 'sell');
  
  // Apply row limiting when debug flag is present - safe array handling
  const displayOpenPositions = LIMIT_ROWS && LIMIT_ROWS > 0 ? 
    (Array.isArray(openPositions) ? openPositions.slice(0, LIMIT_ROWS) : []) : 
    (Array.isArray(openPositions) ? openPositions : []);
  const displayPastPositions = LIMIT_ROWS && LIMIT_ROWS > 0 ? 
    (Array.isArray(pastPositions) ? pastPositions.slice(0, LIMIT_ROWS) : []) : 
    (Array.isArray(pastPositions) ? pastPositions : []);
  
  // Step 1: Debug header (once per session)
  if (DEBUG_HISTORY_BLINK && !debugHeaderLogged.current) {
    console.info('[HistoryBlink] STEP 1 — Mount/Key visibility (Open/Past)');
    debugHeaderLogged.current = true;
  }

  return (
    <Card className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Trading History</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchTradingHistory('manualRefresh')}
          disabled={historyLoading}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${historyLoading && !MUTE_HISTORY_LOADING ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Strategy KPIs Overview */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Strategy KPIs Overview
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Positions Summary */}
          <Card className="p-4 bg-card/50 border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <PieChart className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium text-muted-foreground">Positions Summary</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Open Positions</span>
                <span className="text-lg font-bold">{stats.openPositions}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Total Positions</span>
                <span className="text-sm text-muted-foreground">Open + Closed</span>
              </div>
            </div>
          </Card>
          
          {/* Investment Metrics */}
          <Card className="p-4 bg-card/50 border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-medium text-muted-foreground">Investment Metrics</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Currently Invested</span>
                <span className="text-lg font-bold">{formatEuro(stats.currentlyInvested)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Total Invested</span>
                <span className="text-sm">{formatEuro(stats.totalInvested)}</span>
              </div>
            </div>
          </Card>
          
          {/* Performance Metrics */}
          <Card className="p-4 bg-card/50 border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-muted-foreground">Performance Metrics</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Unrealized P&L</span>
                <span className={`text-lg font-bold ${stats.currentPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatEuro(stats.currentPL)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Realized P&L</span>
                <span className={`text-sm ${(stats.totalPL - stats.currentPL) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatEuro(stats.totalPL - stats.currentPL)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Total P&L</span>
                <span className={`text-sm ${stats.totalPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatEuro(stats.totalPL)}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value: any) => setActiveTab(value)}>
        {(() => {
          // Step 3: Tabs mount logging (rate-limited) - FIXED: no useRef in closure
          if (DEBUG_HISTORY_BLINK) {
            const now = performance.now();
            if (now - tabsLastLog.current > 1000) {
              console.info(`[HistoryBlink] <Tabs> mount 1 | value=${activeTab}`);
              tabsLastLog.current = now;
            }
          }
          return null;
        })()}
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="open" className="flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4" />
            Open Positions ({displayOpenPositions.length})
          </TabsTrigger>
          <TabsTrigger value="past" className="flex items-center gap-2">
            <ArrowDownLeft className="w-4 h-4" />
            Past Positions ({displayPastPositions.length})
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="open" className="mt-4">
          {(() => {
            // Step 3: OpenList mount counter
            openMounts.current += 1;
            if (DEBUG_HISTORY_BLINK) {
              const now = performance.now();
              if (now - openLastLog.current > 1000) {
                console.info(`[HistoryBlink] <OpenList> mount ${openMounts.current} | len=${displayOpenPositions.length} loading=${historyLoading}`);
                openLastLog.current = now;
              }
              
              // Step 4: OpenList prop fingerprint logging (rate-limited)
              if (now - openListLastPropLog.current > 1000) {
                console.info(`[HistoryBlink] <OpenList> props: {
  len: ${displayOpenPositions.length},
  idsHash: ${simpleIdsHash(displayOpenPositions)},
  loading: ${processedLoading}
}`);
                openListLastPropLog.current = now;
              }
            }
            
            // Step 1: Parent remount detector (rate-limited)
            openRenders.current++;
            
            // Step 1: Log actual React key values (once)
            if (DEBUG_HISTORY_BLINK && !loggedKeysRef.current && displayOpenPositions.length > 0) {
              const sampleKeys = displayOpenPositions.slice(0, 10).map(t => t.id);
              console.info('[HistoryBlink] keys sample (first 10)', sampleKeys);
              loggedKeysRef.current = true;
            }
            
            return null;
          })()}
          {displayOpenPositions.length > 0 ? (
            <div className="space-y-4">
              {displayOpenPositions.map(trade => (
                <TradeCard
                  key={trade.id}
                  trade={trade}
                  showSellButton={true}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No open positions</p>
              <p className="text-sm mt-2">Your open positions will appear here when you make trades</p>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="past" className="mt-4">
          {(() => {
            // Step 3: PastList mount counter  
            pastMounts.current += 1;
            if (DEBUG_HISTORY_BLINK) {
              const now = performance.now();
              if (now - pastLastLog.current > 1000) {
                console.info(`[HistoryBlink] <PastList> mount ${pastMounts.current} | len=${displayPastPositions.length} loading=${historyLoading}`);
                pastLastLog.current = now;
              }
              
              // Step 4: PastList prop fingerprint logging (rate-limited)
              if (now - pastListLastPropLog.current > 1000) {
                console.info(`[HistoryBlink] <PastList> props: {
  len: ${displayPastPositions.length},
  idsHash: ${simpleIdsHash(displayPastPositions)},
  loading: ${processedLoading}
}`);
                pastListLastPropLog.current = now;
              }
            }
            
            // Step 1: Parent remount detector (rate-limited)
            pastRenders.current++;
            
            return null;
          })()}
          {displayPastPositions.length > 0 ? (
            <div className="space-y-4">
              {displayPastPositions.map(trade => (
                <TradeCard
                  key={trade.id}
                  trade={trade}
                  showSellButton={false}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No past positions</p>
              <p className="text-sm mt-2">Your completed trades will appear here</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}

// Step 8: Export with force freeze wrapper
export function TradingHistory({ hasActiveStrategy, onCreateStrategy }: TradingHistoryProps) {
  if (FORCE_FREEZE_HISTORY) {
    if (frozenRenderRef === null) {
      frozenRenderRef = <TradingHistoryInternal hasActiveStrategy={hasActiveStrategy} onCreateStrategy={onCreateStrategy} />;
      if (!freezeLoggedRef) {
        console.info('[HistoryBlink] forceFreezeHistory active (child subtree reused)');
        freezeLoggedRef = true;
      }
    }
    return frozenRenderRef;
  }
  
  return <TradingHistoryInternal hasActiveStrategy={hasActiveStrategy} onCreateStrategy={onCreateStrategy} />;
}
