// ✅ ALL imports first
import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, ArrowDownLeft, Clock, Activity, RefreshCw, TrendingUp, DollarSign, PieChart, ChevronLeft, ChevronRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useMockWallet } from '@/hooks/useMockWallet';
import { NoActiveStrategyState } from './NoActiveStrategyState';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { calculateOpenPosition, processPastPosition } from '@/utils/valuationService';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle } from 'lucide-react';
import { toBaseSymbol, toPairSymbol } from '@/utils/symbols';
import { sharedPriceCache } from '@/utils/SharedPriceCache';
import { useToast } from '@/hooks/use-toast';

// ✅ After imports: version beacon + WeakMap
const TH_VERSION = 'v14.1';
(window as any).__TH_VERSION = TH_VERSION;

// v13 helpers
function mark(step: string) {
  (window as any).__THv14_step = step;
  try {
    const el = document.getElementById('th-beacon');
    if (el) el.textContent = `TH v14 • ${step}`;
  } catch {}
}

async function withTimeout<T>(promise: Promise<T>, label: string, ms = 8000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms)),
  ]);
}

// 10s watchdog: if we don't reach "invoke-done", force a mock sell so you're not blocked
function startWatchdog(userId: string, trade: Trade, pair: string) {
  const stop = setTimeout(async () => {
    const cached = sharedPriceCache.get(pair);
    if (!cached) { 
      return; 
    }
    try {
      await emergencyMockSellInsert(userId, trade, cached.price);
      (window as any).__THv14_watchdogFired = true;
    } catch {}
  }, 10000);
  return () => clearTimeout(stop);
}

// Emergency client-side mock sell fallback
async function emergencyMockSellInsert(userId: string, trade: Trade, currentPrice: number) {
  const purchaseValue = trade.amount * trade.price;
  const exitValue = trade.amount * currentPrice;
  const realized_pnl = exitValue - purchaseValue;
  const realized_pnl_pct = purchaseValue > 0 ? (realized_pnl / purchaseValue) * 100 : 0;

  const payload = {
    user_id: userId,
    trade_type: 'sell',
    cryptocurrency: trade.cryptocurrency,
    amount: trade.amount,
    price: currentPrice,
    total_value: exitValue,
    executed_at: new Date().toISOString(),
    // snapshot / fifo fields:
    original_purchase_amount: trade.amount,
    original_purchase_price: trade.price,
    original_purchase_value: purchaseValue,
    exit_value: exitValue,
    realized_pnl,
    realized_pnl_pct,
    notes: (trade.notes ? trade.notes + ' • ' : '') + 'EMERGENCY MOCK SELL (client-side watchdog)',
    is_test_mode: true,
    strategy_id: trade.strategy_id || null,
  };

  const { data, error } = await supabase.from('mock_trades').insert([payload]).select();
  if (error) throw error;
  return data;
}

// Map each SELL button element to its Trade (no leaks, survives re-renders)
const sellBtnMap = new WeakMap<HTMLButtonElement, Trade>();

const PAGE_SIZE = 20;

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
  original_trade_id?: string; // Link to the specific BUY this SELL closes
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

export function TradingHistory({ hasActiveStrategy, onCreateStrategy }: TradingHistoryProps) {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { getTotalValue, balances } = useMockWallet();
  const { toast } = useToast();
  
  // Mount beacon + global error handler
  useEffect(() => {
    const onErr = (e: ErrorEvent) => {
      // Silent error handling
      (window as any).NotificationSink?.log({ message: 'TH window error', error: e.message });
    };
    window.addEventListener('error', onErr);
    return () => {
      window.removeEventListener('error', onErr);
    };
  }, []);
  
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [openPage, setOpenPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'open' | 'past'>('open');
  const [sellConfirmation, setSellConfirmation] = useState<{ open: boolean; trade: Trade | null }>({ 
    open: false, 
    trade: null 
  });
  const [stats, setStats] = useState({
    totalTrades: 0,
    totalVolume: 0,
    netProfitLoss: 0,
    openPositions: 0,
    totalInvested: 0,
    currentPL: 0,
    totalPL: 0,
    currentlyInvested: 0,
    pastInvestments: 0,
    realizedPL: 0
  });

  // Initialize shared price cache on mount
  useEffect(() => {
    return () => {
      sharedPriceCache.clear();
    };
  }, []);

  // Price cache is now managed by MarketDataContext
  // TradingHistory just reads from it - no symbol management needed

  // Calculate trade performance using shared cache
  const calculateTradePerformance = (trade: Trade): TradePerformance => {
    if (trade.trade_type === 'sell') {
      // Past positions - use snapshot fields only
      const pastPosition = processPastPosition({
        original_purchase_amount: trade.original_purchase_amount,
        original_purchase_value: trade.original_purchase_value,
        original_purchase_price: trade.original_purchase_price,
        price: trade.price,
        exit_value: trade.exit_value,
        realized_pnl: trade.realized_pnl,
        realized_pnl_pct: trade.realized_pnl_pct
      });
      
      // Calculate P&L if missing from database
      let gainLoss = pastPosition.realizedPnL;
      let gainLossPercentage = pastPosition.realizedPnLPct;
      
      if (gainLoss === null && pastPosition.exitValue !== null && pastPosition.purchaseValue !== null) {
        gainLoss = pastPosition.exitValue - pastPosition.purchaseValue;
      }
      
      if (gainLossPercentage === null && gainLoss !== null && pastPosition.purchaseValue !== null && pastPosition.purchaseValue > 0) {
        gainLossPercentage = (gainLoss / pastPosition.purchaseValue) * 100;
      }
      
      return {
        currentPrice: pastPosition.exitPrice,
        currentValue: pastPosition.exitValue,
        purchaseValue: pastPosition.purchaseValue,
        purchasePrice: pastPosition.entryPrice,
        gainLoss: gainLoss,
        gainLossPercentage: gainLossPercentage,
        isAutomatedWithoutPnL: false
      };
    }
    
    // Open positions - use shared price cache
    const baseSymbol = toBaseSymbol(trade.cryptocurrency);
    const pairSymbol = toPairSymbol(baseSymbol);
    const cached = sharedPriceCache.get(pairSymbol);
    const currentPrice = cached?.price || 0;
    
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
      corruptionReasons: currentPrice === null ? ['Current price not available'] : []
    };
  };

  // FIFO helper functions - FIXED to match database logic with targeted manual SELL support
  const buildFifoLots = (allTrades: Trade[]) => {
    const sorted = [...allTrades].sort((a,b)=> new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime());
    const lotsBySymbol = new Map<string, { trade: Trade; remaining: number }[]>();
    for (const t of sorted) {
      const sym = toBaseSymbol(t.cryptocurrency); // Normalize symbol to match database trigger logic
      if (!lotsBySymbol.has(sym)) lotsBySymbol.set(sym, []);
      if (t.trade_type === 'buy') {
        lotsBySymbol.get(sym)!.push({ trade: t, remaining: t.amount });
      } else if (t.trade_type === 'sell' && t.original_purchase_amount) {
        const lots = lotsBySymbol.get(sym)!;
        let sellRemaining = t.original_purchase_amount;

        // TARGETED MANUAL SELL: Match to specific BUY if original_trade_id is present
        if (t.original_trade_id) {
          const targetLot = lots.find(l => l.trade.id === t.original_trade_id);
          if (targetLot) {
            const used = Math.min(targetLot.remaining, sellRemaining);
            targetLot.remaining -= used;
            sellRemaining -= used;
          }
          // If something is still remaining (edge case), fall back to FIFO
          if (sellRemaining > 1e-12) {
            // Fallback FIFO for remaining amount
            for (let i = 0; i < lots.length && sellRemaining > 1e-12; i++) {
              const lot = lots[i];
              const used = Math.min(lot.remaining, sellRemaining);
              lot.remaining -= used;
              sellRemaining -= used;
            }
          }
        } else {
          // STANDARD FIFO: No original_trade_id, use global FIFO
          for (let i = 0; i < lots.length && sellRemaining > 1e-12; i++) {
            const lot = lots[i];
            const used = Math.min(lot.remaining, sellRemaining);
            lot.remaining -= used;
            sellRemaining -= used;
          }
        }
      }
    }
    const openLots: Trade[] = [];
    let closedCount = 0;
    lotsBySymbol.forEach((lots) => {
      lots.forEach(({ trade, remaining }) => {
        if (remaining > 1e-8) {  // Increased threshold to match database precision
          const ratio = remaining / trade.amount;
          openLots.push({
            ...trade,
            amount: remaining, // Show actual remaining amount
            total_value: trade.total_value * ratio,
            fees: 0,
            notes: remaining < trade.amount ? 
              `Partial: ${remaining.toFixed(8)} of ${trade.amount.toFixed(8)} remaining` : 
              trade.notes
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
    
    // Log open lots for debugging (UI level)
    console.log('[UI][OPEN_POSITIONS] Open lots:', {
      lotsCount: openLots.length,
      symbols: [...new Set(openLots.map(t => t.cryptocurrency))],
      totalsPerSymbol: openLots.reduce((acc, lot) => {
        const sym = toBaseSymbol(lot.cryptocurrency);
        acc[sym] = (acc[sym] || 0) + lot.amount;
        return acc;
      }, {} as Record<string, number>)
    });
    
    return openLots.sort((a, b) => new Date(b.executed_at).getTime() - new Date(a.executed_at).getTime());
  };

  // Fetch trading history
  const fetchTradingHistory = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .order('executed_at', { ascending: false });

      if (error) throw error;

      setTrades(data || []);

        // Calculate stats
      if (data && data.length > 0) {
        const openPositions = getOpenPositionsList();
        let realizedPL = 0;
        let unrealizedPL = 0;
        let invested = 0;
        let pastInvestments = 0;

        // Calculate realized P&L from sell trades
        const sellTrades = data.filter(t => t.trade_type === 'sell');
        realizedPL = sellTrades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);

        // Calculate past investments (purchase values of sold positions)
        pastInvestments = sellTrades.reduce((sum, t) => sum + (t.original_purchase_value || 0), 0);

        // Calculate unrealized P&L from open positions
        for (const trade of openPositions) {
          const performance = calculateTradePerformance(trade);
          if (!performance.isCorrupted) {
            unrealizedPL += performance.gainLoss || 0;
            invested += performance.purchaseValue || 0;
          }
        }

        // Total Volume = purchase values only (current + past investments)
        const totalInvestmentVolume = invested + pastInvestments;

        setStats({
          totalTrades: openPositions.length + sellTrades.length,
          totalVolume: totalInvestmentVolume,
          netProfitLoss: realizedPL + unrealizedPL,
          openPositions: openPositions.length,
          totalInvested: invested,
          currentPL: unrealizedPL,
          totalPL: realizedPL + unrealizedPL,
          currentlyInvested: invested,
          pastInvestments: pastInvestments,
          realizedPL: realizedPL
        });
      }
    } catch (error) {
      // Silent error handling - no UI toasts
      (window as any).NotificationSink?.log({ message: 'Error fetching trading history', error });
    } finally {
      setLoading(false);
    }
  };

  // Load data on component mount and when user changes  
  useEffect(() => {
    if (user) {
      fetchTradingHistory();
    }
  }, [user, testMode]);

  // Real-time subscription to mock_trades changes
  useEffect(() => {
    if (!user) return;

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
        () => {
          // Throttle updates to prevent constant blinking
          setTimeout(() => {
            fetchTradingHistory();
          }, 1000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Component mount tracking
  useEffect(() => {
    // Silent mount tracking
  }, []);

  // Delegated SELL button handler (survives re-renders)
  useEffect(() => {
    const delegate = (e: Event) => {
      const t = e.target as HTMLElement | null;
      const btn = t?.closest('button[data-testid="sell-now"]') as HTMLButtonElement | null;
      if (!btn) return;

      const id = btn.dataset.sellId || '';
      let resolved: Trade | undefined;

      // 1) WeakMap first
      resolved = sellBtnMap.get(btn);

      // 2) Fallback to trades state by id
      if (!resolved && id) {
        resolved = trades.find(tr => tr.id === id);
      }

      // 3) Fallback to embedded JSON on the button
      if (!resolved) {
        const json = btn.getAttribute('data-trade-json');
        if (json) {
          try { resolved = JSON.parse(decodeURIComponent(json)); } catch {}
        }
      }

      // Open confirmation modal instead of calling handleDirectSell directly
      if (resolved) {
        setSellConfirmation({ open: true, trade: resolved });
      } else {
        toast({
          title: "Error",
          description: "Could not resolve trade data for sell operation",
          variant: "destructive"
        });
      }
    };
    ['pointerdown','click'].forEach(type => document.addEventListener(type, delegate, true));
    return () => {
      ['pointerdown','click'].forEach(type => document.removeEventListener(type, delegate, true));
    };
  }, [trades]);

  // Handle direct sell - executes manual sell
  const handleDirectSell = async (trade: Trade) => {
    mark('entered');

    if (!user) {
      toast({ title: 'Sell Failed', description: 'User not authenticated', variant: 'destructive' });
      return;
    }

    try {
      // === Symbols & price (sync) ===
      mark('symbols-start');
      const base = toBaseSymbol(trade.cryptocurrency);
      const pair = toPairSymbol(base);
      mark('symbols-ok');

      const cached = sharedPriceCache.get(pair);
      const price = cached?.price;
      if (!price) {
        toast({ title: 'Sell Failed', description: `Current price not available for ${pair}`, variant: 'destructive' });
        return;
      }
      mark('price-ok');

      // start watchdog now that we have everything needed for a fallback
      const stopWatchdog = startWatchdog(user.id, trade, pair);

      // Perf (sync)
      const perf = calculateTradePerformance(trade);
      mark('perf-ok');

      // === Strategy lookup (async + timeout) ===
      mark('strategies-start');
      const { data: strategies, error: stratError } = await supabase
        .from('trading_strategies')
        .select('id, strategy_name')
        .eq('user_id', user.id);
      if (stratError) throw stratError;
      const strategyId = trade.strategy_id || (strategies && strategies[0]?.id);
      if (!strategyId) {
        stopWatchdog();
        toast({ title: 'Sell Failed', description: 'No valid strategy found for manual sell', variant: 'destructive' });
        return;
      }
      mark('strategies-ok');

      // === Build payload (sync) ===
      const sellPayload = {
        userId: user.id,
        strategyId,
        symbol: base,
        side: 'SELL' as const,
        source: 'manual',
        confidence: 0.95,
        reason: 'Manual sell from Trading History UI',
        qtySuggested: trade.amount,
        mode: 'mock',
        metadata: {
          context: 'MANUAL',
          origin: 'UI',
          manualOverride: true,
          originalTradeId: trade.id,
          uiTimestamp: new Date().toISOString(),
          currentPrice: price,
          expectedPnl: perf.gainLoss || 0,
          expectedPnlPct: perf.gainLossPercentage || 0,
          force: true,
        },
        idempotencyKey: `idem_${Math.random().toString(36).slice(2,10)}`,
      };
      mark('payload-ok');

      // === Invoke function (async + timeout) ===
      mark('invoke-start');
      const { data: result, error } = await withTimeout(
        supabase.functions.invoke('trading-decision-coordinator', { body: { intent: sellPayload } }),
        'edge-function-invoke',
        8000
      );
      mark('invoke-done');
      stopWatchdog();

      if (error) throw new Error(`Network error: ${error.message}`);

      if (result?.ok === true && result?.decision?.action === 'SELL') {
        mark('sell-success');
        toast({ title: 'Position Sold', description: `Sold ${trade.cryptocurrency}`, variant: 'default' });
        fetchTradingHistory();
        return;
      }

      mark('decision-not-sell');
      toast({ title: 'Sell Not Executed', description: result?.decision?.reason || 'No decision reason', variant: 'destructive' });
    } catch (err:any) {
      mark('error');

      // Final emergency fallback (in case the watchdog didn't fire yet)
      try {
        const base = toBaseSymbol(trade.cryptocurrency);
        const pair = toPairSymbol(base);
        const cached = sharedPriceCache.get(pair);
        if (cached) {
          await emergencyMockSellInsert(user!.id, trade, cached.price);
          mark('fallback-sell-inserted');
          toast({ title: 'Emergency Mock Sell', description: `Inserted SELL for ${trade.cryptocurrency}`, variant: 'default' });
          fetchTradingHistory();
        } else {
          toast({ title: 'Sell Failed', description: 'No price available for emergency fallback', variant: 'destructive' });
        }
      } catch (fbErr:any) {
        mark('fallback-failed');
        toast({ title: 'Sell Failed', description: fbErr?.message || 'Unknown error', variant: 'destructive' });
      }
    }
  };

  // TradeCard component for rendering individual trades
  const TradeCard = ({ trade, showSellButton = false, onRequestSell }: { 
    trade: Trade; 
    showSellButton?: boolean;
    onRequestSell?: (t: Trade) => void;
  }) => {
    const [performance, setPerformance] = useState<TradePerformance | null>(null);
    const [cardLoading, setCardLoading] = useState(true);
    const sellBtnRef = useRef<HTMLButtonElement | null>(null);

    // Map button to trade (no direct click listener - handled by delegation)
    useEffect(() => {
      const el = sellBtnRef.current;
      if (!el) return;
      sellBtnMap.set(el, trade);
      return () => {
        sellBtnMap.delete(el);
      };
    }, [trade.id]);
    
    useEffect(() => {
      const loadPerformance = () => {
        try {
          const perf = calculateTradePerformance(trade);
          setPerformance(perf);
        } catch (error) {
          (window as any).NotificationSink?.log({ message: 'Error calculating trade performance', error });
        } finally {
          setCardLoading(false);
        }
      };

      loadPerformance();
    }, [trade.id]);

    if (cardLoading || !performance) {
      return (
        <Card className="p-4">
          <div className="h-4 bg-muted rounded w-1/3 mb-2"></div>
          <div className="h-3 bg-muted rounded w-1/2"></div>
        </Card>
      );
    }

    const isProfit = (performance.gainLoss || 0) > 0;
    const isLoss = (performance.gainLoss || 0) < 0;

    return (
      <Card className="p-4 hover:shadow-md transition-shadow" data-testid="past-position-card">
        {/* Lot-Linked Indicator for SELL trades */}
        {trade.trade_type === 'sell' && (
          <div className="flex gap-2 mb-2">
            {trade.original_trade_id ? (
              <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                Lot-Linked
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                Legacy (FIFO)
              </Badge>
            )}
          </div>
        )}
        
        {trade.is_corrupted && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="text-xs mb-2">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Corrupted
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-sm">
                  <strong>Data Integrity Issue:</strong><br />
                  {trade.integrity_reason || 'Unknown corruption detected'}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        
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
            <p className="font-medium">
              {trade.trade_type === 'sell' 
                ? (trade.original_purchase_amount || trade.amount).toFixed(8)
                : trade.amount.toFixed(8)
              }
            </p>
          </div>
          
          <div>
            <p className="text-muted-foreground">Purchase Price</p>
            <p className="font-medium" data-testid="purchase-price">
              {trade.trade_type === 'sell' 
                ? formatEuro(performance.purchasePrice || 0)
                : formatEuro(trade.price)
              }
            </p>
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
          
          {trade.trade_type === 'buy' && (
            <>
              <div>
                <p className="text-muted-foreground">Current Price</p>
                <p className="font-medium">
                  {performance.currentPrice !== null ? formatEuro(performance.currentPrice) : "—"}
                </p>
              </div>
              
              <div>
                <p className="text-muted-foreground">Current Value</p>
                <p className="font-medium">
                  {performance.currentValue !== null ? formatEuro(performance.currentValue) : "—"}
                </p>
              </div>
            </>
          )}
          
          {trade.trade_type === 'sell' && (
            <>
              <div>
                <p className="text-muted-foreground">Exit Price</p>
                <p className="font-medium" data-testid="exit-price">{formatEuro(performance.currentPrice || trade.price)}</p>
              </div>
              
              <div>
                <p className="text-muted-foreground">Exit Value</p>
                <p className="font-medium">
                  {formatEuro(trade.exit_value || trade.total_value)}
                </p>
              </div>
            </>
          )}
          
          {trade.trade_type === 'sell' ? (
              <div>
                <p className="text-muted-foreground">P&L (€)</p>
                <p className={`font-medium ${
                  (performance.gainLoss || 0) > 0 ? 'text-emerald-600' : 
                (performance.gainLoss || 0) < -0.01 ? 'text-red-600' : ''
              }`} data-testid="realized-pnl">
                {formatEuro(performance.gainLoss || 0)}
              </p>
            </div>
          ) : performance.gainLoss !== null && performance.gainLossPercentage !== null && (
            <>
              <div>
                <p className="text-muted-foreground">P&L (€)</p>
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
          <div className="flex items-center justify-between">
            <div>
              <p>Executed: {new Date(trade.executed_at).toLocaleString()}</p>
              {trade.notes && <p className="mt-1">Note: {trade.notes}</p>}
            </div>
            
            {showSellButton && trade.trade_type === 'buy' && (
              <button
                        data-testid="sell-now"
                        data-sell-id={trade.id}
                        data-sell-sym={trade.cryptocurrency}
                        data-trade-json={encodeURIComponent(JSON.stringify(trade))}
                        data-th-version="v14.1"
                        ref={sellBtnRef}
                        type="button"
                        className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (onRequestSell) {
                            onRequestSell(trade);
                          }
                        }}
                      >
                        SELL NOW (v14)
              </button>
            )}
            
          </div>
        </div>
      </Card>
    );
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <Activity className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Trading History</h2>
          <RefreshCw className="w-4 h-4 ml-auto animate-spin" />
        </div>
        <div className="animate-pulse">
          <div className="h-4 bg-muted rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (!hasActiveStrategy) {
    return <NoActiveStrategyState onCreateStrategy={onCreateStrategy} />;
  }

  const openPositions = getOpenPositionsList();
  const pastPositions = trades.filter(t => t.trade_type === 'sell');
  
  // Log past positions lot-linking status for debugging
  const pastWithLotId = pastPositions.filter(t => t.original_trade_id).length;
  const pastWithoutLotId = pastPositions.filter(t => !t.original_trade_id).length;
  console.log('[UI][PAST_POSITIONS] Sells:', {
    total: pastPositions.length,
    withOriginalTradeId: pastWithLotId,
    withoutOriginalTradeId: pastWithoutLotId,
    lotLinkingPct: pastPositions.length > 0 ? Math.round((pastWithLotId / pastPositions.length) * 100) : 0
  });
  
  // Pagination for both open and past positions  
  const totalPastPages = Math.ceil(pastPositions.length / PAGE_SIZE);
  const totalOpenPages = Math.ceil(openPositions.length / PAGE_SIZE);
  
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedPastPositions = pastPositions.slice(startIndex, endIndex);
  
  const openStartIndex = (openPage - 1) * PAGE_SIZE;
  const openEndIndex = openStartIndex + PAGE_SIZE;
  const paginatedOpenPositions = openPositions.slice(openStartIndex, openEndIndex);

  return (
    <div className="space-y-6">
      {/* Fixed beacon for visual proof */}
      <div
        id="th-beacon"
        style={{
          position: 'fixed',
          top: 6,
          right: 6,
          zIndex: 99999,
          background: '#111',
          color: '#0f0',
          fontSize: 12,
          padding: '4px 8px',
          borderRadius: 6,
          boxShadow: '0 0 0 2px #0f0 inset'
        }}
      >
        TH v13 ACTIVE
      </div>

      <Card className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Trading History (TH v13)</h2>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchTradingHistory}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

      {/* Portfolio Summary */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <PieChart className="w-5 h-5" />
          Portfolio Summary
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Positions */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium text-muted-foreground">Positions</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Open Positions</span>
                <span className="text-lg font-bold">{stats.openPositions}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Past Positions</span>
                <span className="text-sm">{pastPositions.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Total Trades</span>
                <span className="text-sm">{stats.totalTrades}</span>
              </div>
            </div>
          </Card>
          
          {/* Investment */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-medium text-muted-foreground">Investment</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Currently Invested</span>
                <span className="text-lg font-bold">{formatEuro(stats.currentlyInvested)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Past Investments</span>
                <span className="text-sm">{formatEuro(stats.pastInvestments)}</span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="text-xs text-muted-foreground font-medium">Total</span>
                <span className="text-sm font-semibold">{formatEuro(stats.totalVolume)}</span>
              </div>
            </div>
          </Card>
          
          {/* Performance */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-muted-foreground">Performance</span>
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
                <span className={`text-sm ${stats.realizedPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatEuro(stats.realizedPL)}
                </span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="text-xs text-muted-foreground font-medium">Total P&L</span>
                <span className={`text-sm font-semibold ${stats.totalPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatEuro(stats.totalPL)}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value: any) => setActiveTab(value)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="open" className="flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4" />
            Open Positions ({openPositions.length})
          </TabsTrigger>
          <TabsTrigger value="past" className="flex items-center gap-2" data-testid="past-positions-tab">
            <ArrowDownLeft className="w-4 h-4" />
            Past Positions ({pastPositions.length})
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="open" className="mt-4">
          {openPositions.length > 0 ? (
            <>
              <div className="space-y-4">
                {paginatedOpenPositions.map(trade => (
                  <TradeCard
                    key={trade.id}
                    trade={trade}
                    showSellButton={true}
                    onRequestSell={(t) => setSellConfirmation({ open: true, trade: t })}
                  />
                ))}
              </div>
              
              {/* Pagination for Open Positions */}
              {totalOpenPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenPage(p => Math.max(1, p - 1))}
                    disabled={openPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </Button>
                  
                  <span className="text-sm text-muted-foreground mx-4">
                    Page {openPage} of {totalOpenPages}
                  </span>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenPage(p => Math.min(totalOpenPages, p + 1))}
                    disabled={openPage === totalOpenPages}
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No open positions</p>
              <p className="text-sm mt-2">Your open positions will appear here when you make trades</p>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="past" className="mt-4">
          {pastPositions.length > 0 ? (
            <>
              <div className="space-y-4" data-testid="past-positions-list">
                {paginatedPastPositions.map(trade => (
                  <TradeCard
                    key={trade.id}
                    trade={trade}
                    showSellButton={false}
                  />
                ))}
              </div>
              
              {/* Pagination Controls */}
              {totalPastPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </Button>
                  
                  <span className="text-sm text-muted-foreground mx-4">
                    Page {currentPage} of {totalPastPages}
                  </span>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPastPages, p + 1))}
                    disabled={currentPage === totalPastPages}
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No past positions</p>
              <p className="text-sm mt-2">Your completed trades will appear here</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Confirmation Modal */}
      <Dialog open={sellConfirmation.open} onOpenChange={(open) => setSellConfirmation(prev => ({ open, trade: open ? prev.trade : null }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Sell</DialogTitle>
            <DialogDescription>
              {sellConfirmation.trade ? (
                <div className="space-y-2 mt-2 text-sm">
                  <div><span className="text-muted-foreground">Asset:</span> <span className="font-medium">{sellConfirmation.trade.cryptocurrency}</span></div>
                  <div><span className="text-muted-foreground">Amount:</span> <span className="font-medium">{sellConfirmation.trade.amount}</span></div>
                  <div><span className="text-muted-foreground">Entry Price:</span> <span className="font-medium">€{sellConfirmation.trade.price.toFixed(2)}</span></div>
                  <div className="text-xs text-muted-foreground mt-2">
                    This will submit a mock/manual sell immediately with FIFO profit/loss calculation.
                  </div>
                </div>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setSellConfirmation({ open: false, trade: null })}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!sellConfirmation.trade) return;
                const t = sellConfirmation.trade;
                setSellConfirmation({ open: false, trade: null });
                await handleDirectSell(t);
              }}
            >
              Confirm Sell
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </Card>
    </div>
  );
}

// Expose utilities globally for debugging (silent)
if (typeof window !== 'undefined') {
  (window as any).toBaseSymbol = toBaseSymbol;
  (window as any).toPairSymbol = toPairSymbol;
  (window as any).sharedPriceCache = sharedPriceCache;
}