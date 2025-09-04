import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useTestMode } from "@/hooks/useTestMode";
import { useRealTimeMarketData } from "@/hooks/useRealTimeMarketData";
import { supabase } from '@/integrations/supabase/client';
import { Wallet, TrendingUp, TrendingDown, RefreshCw, TestTube, RotateCcw } from "lucide-react";
import { logger } from '@/utils/logger';
import { getAllTradingPairs } from '@/data/coinbaseCoins';

interface OpenPosition {
  symbol: string;
  amount: number;
  avg_purchase_price: number;
  purchase_value: number;
  current_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
}

interface PastPosition {
  sell_trade_id: string;
  symbol: string;
  amount: number;
  purchase_price: number;
  purchase_value: number;
  exit_price: number;
  exit_value: number;
  buy_fees: number;
  sell_fees: number;
  realized_pnl: number;
  realized_pnl_pct: number;
  exit_at: string;
}

export const MergedPortfolioDisplay = () => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { getCurrentData } = useRealTimeMarketData();
  
  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([]);
  const [pastPositions, setPastPositions] = useState<PastPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [realTimePrices, setRealTimePrices] = useState<{[key: string]: number}>({});
  const [selectedStrategyId, setSelectedStrategyId] = useState<string>('');
  const [strategies, setStrategies] = useState<any[]>([]);

  // Fetch strategies
  useEffect(() => {
    if (user) {
      fetchStrategies();
    }
  }, [user]);

  // Fetch portfolio data when strategy changes
  useEffect(() => {
    if (user && selectedStrategyId) {
      fetchPortfolioData();
    }
  }, [user, selectedStrategyId, testMode]);

  // Update real-time prices
  useEffect(() => {
    const updatePrices = async () => {
      try {
        const commonSymbols = getAllTradingPairs();
        const data = await getCurrentData(commonSymbols);
        
        const prices: {[key: string]: number} = {};
        
        commonSymbols.forEach(symbol => {
          const crypto = symbol.split('-')[0];
          if (data[symbol]?.price && data[symbol].price > 0) {
            prices[crypto] = data[symbol].price;
          }
        });
        
        setRealTimePrices(prices);
      } catch (error) {
        logger.error('Error fetching real-time prices:', error);
      }
    };

    updatePrices();
    const interval = setInterval(updatePrices, 30000);
    
    return () => clearInterval(interval);
  }, [getCurrentData]);

  const fetchStrategies = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('id, strategy_name, is_active_test')
        .eq('user_id', user.id)
        .eq('is_active_test', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setStrategies(data || []);
      
      // Auto-select first strategy if none selected
      if (data && data.length > 0 && !selectedStrategyId) {
        setSelectedStrategyId(data[0].id);
      }
    } catch (error) {
      logger.error('Error fetching strategies:', error);
    }
  };

  const fetchPortfolioData = async () => {
    if (!user || !selectedStrategyId) return;
    
    setLoading(true);
    try {
      // Fetch open positions from coverage view
      const { data: coverage, error: coverageError } = await supabase
        .from('mock_coverage')
        .select('*')
        .eq('user_id', user.id)
        .eq('strategy_id', selectedStrategyId)
        .eq('is_test_mode', testMode)
        .gt('available', 0.000000001); // Use same tolerance as trigger

      if (coverageError) throw coverageError;

      // Transform coverage to open positions
      const openPositions = (coverage || []).map(pos => {
        const currentPrice = realTimePrices[pos.symbol] || 0;
        // For mock_coverage, we need to calculate average price differently
        // since we don't have total_bought_value in the view
        const avgPrice = pos.available > 0 ? pos.total_bought / pos.available : 0;
        const purchaseValue = pos.available * avgPrice;
        const currentValue = pos.available * currentPrice;
        const unrealizedPnl = currentValue - purchaseValue;
        const unrealizedPnlPct = purchaseValue > 0 ? (unrealizedPnl / purchaseValue) * 100 : 0;

        return {
          symbol: pos.symbol,
          amount: pos.available,
          avg_purchase_price: avgPrice,
          purchase_value: purchaseValue,
          current_value: currentValue,
          unrealized_pnl: unrealizedPnl,
          unrealized_pnl_pct: unrealizedPnlPct
        };
      });

      setOpenPositions(openPositions);

      // Fetch past positions from sell trades
      const { data: sells, error: sellsError } = await supabase
        .from('mock_trades')
        .select(`
          id,
          cryptocurrency,
          original_purchase_amount,
          original_purchase_price,
          original_purchase_value,
          price,
          exit_value,
          buy_fees,
          sell_fees,
          realized_pnl,
          realized_pnl_pct,
          executed_at
        `)
        .eq('user_id', user.id)
        .eq('strategy_id', selectedStrategyId)
        .eq('trade_type', 'sell')
        .eq('is_test_mode', testMode)
        .not('original_purchase_value', 'is', null)
        .order('executed_at', { ascending: false })
        .limit(50);

      if (sellsError) throw sellsError;

      const pastPositions = (sells || []).map(sell => ({
        sell_trade_id: sell.id,
        symbol: sell.cryptocurrency,
        amount: sell.original_purchase_amount || 0,
        purchase_price: sell.original_purchase_price || 0,
        purchase_value: sell.original_purchase_value || 0,
        exit_price: sell.price,
        exit_value: sell.exit_value || sell.price * (sell.original_purchase_amount || 0),
        buy_fees: sell.buy_fees || 0,
        sell_fees: sell.sell_fees || 0,
        realized_pnl: sell.realized_pnl || 0,
        realized_pnl_pct: sell.realized_pnl_pct || 0,
        exit_at: sell.executed_at
      }));

      setPastPositions(pastPositions);

    } catch (error) {
      logger.error('Error fetching portfolio data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPortfolio = async () => {
    if (!user) return;
    
    try {
      const { error } = await supabase.rpc('reset_user_test_portfolio', { 
        target_balance: 30000 
      });
      
      if (error) throw error;
      
      // Refresh portfolio data
      await fetchPortfolioData();
    } catch (error) {
      logger.error('Failed to reset portfolio:', error);
    }
  };

  // Calculate totals
  const currentlyInvested = openPositions.reduce((sum, pos) => sum + pos.purchase_value, 0);
  const realizedPnL = pastPositions.reduce((sum, pos) => sum + pos.realized_pnl, 0);
  const unrealizedPnL = openPositions.reduce((sum, pos) => sum + pos.unrealized_pnl, 0);
  const totalPnL = realizedPnL + unrealizedPnL;

  const renderOpenPosition = (position: OpenPosition) => (
    <Card key={position.symbol} className="p-4 bg-slate-700/50 border-slate-600">
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-slate-300">{position.symbol}</span>
          <div className="text-right">
            <div className="text-lg font-bold text-white">
              €{position.current_value.toLocaleString()}
            </div>
            <div className="text-xs text-slate-400">
              {position.amount.toLocaleString(undefined, {
                maximumFractionDigits: position.symbol === 'XRP' ? 0 : 6
              })} {position.symbol}
            </div>
          </div>
        </div>
        
        <div className="flex justify-between items-center pt-2 border-t border-slate-600/50">
          <span className="text-xs text-slate-400">Unrealized P&L:</span>
          <div className="text-right">
            <div className={`text-sm font-medium ${
              position.unrealized_pnl >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              €{position.unrealized_pnl.toLocaleString()} ({position.unrealized_pnl_pct.toFixed(2)}%)
            </div>
          </div>
        </div>
        
        <div className="flex justify-between items-center text-xs text-slate-500">
          <span>Avg Entry: €{position.avg_purchase_price.toFixed(2)}</span>
          <span>Current: €{realTimePrices[position.symbol]?.toFixed(2) || 'N/A'}</span>
        </div>
      </div>
    </Card>
  );

  const renderPastPosition = (position: PastPosition) => (
    <Card key={position.sell_trade_id} className="p-4 bg-slate-700/50 border-slate-600">
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-slate-300">{position.symbol}</span>
          <div className="text-right">
            <div className="text-lg font-bold text-white">
              €{position.exit_value.toLocaleString()}
            </div>
            <div className="text-xs text-slate-400">
              {position.amount.toLocaleString(undefined, {
                maximumFractionDigits: position.symbol === 'XRP' ? 0 : 6
              })} {position.symbol}
            </div>
          </div>
        </div>
        
        <div className="flex justify-between items-center pt-2 border-t border-slate-600/50">
          <span className="text-xs text-slate-400">Realized P&L:</span>
          <div className="text-right">
            <div className={`text-sm font-medium ${
              position.realized_pnl >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              €{position.realized_pnl.toLocaleString()} ({position.realized_pnl_pct.toFixed(2)}%)
            </div>
          </div>
        </div>
        
        <div className="flex justify-between items-center text-xs text-slate-500">
          <span>Entry: €{position.purchase_price.toFixed(2)}</span>
          <span>Exit: €{position.exit_price.toFixed(2)}</span>
        </div>
        
        <div className="text-xs text-slate-500">
          {new Date(position.exit_at).toLocaleDateString()}
        </div>
      </div>
    </Card>
  );

  return (
    <Card className={`${testMode ? 'border-orange-500/20' : 'border-blue-500/20'} bg-slate-800/50 border-slate-600`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {testMode ? (
              <TestTube className="h-5 w-5 text-orange-400" />
            ) : (
              <Wallet className="h-5 w-5 text-blue-400" />
            )}
            <span className="text-white">
              {testMode ? 'Test Portfolio' : 'Live Portfolio'}
            </span>
            {testMode && (
              <Badge variant="outline" className="text-orange-400 border-orange-400/50">
                Test Mode
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchPortfolioData}
              disabled={loading}
              className="text-slate-300 border-slate-600 hover:bg-slate-700"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {testMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetPortfolio}
                className="text-orange-400 border-orange-400/50 hover:bg-orange-400/10"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Strategy Selection */}
        <div className="space-y-2">
          <label className="text-sm text-slate-300">Strategy:</label>
          <select
            value={selectedStrategyId}
            onChange={(e) => setSelectedStrategyId(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 rounded text-white"
          >
            <option value="">Select a strategy...</option>
            {strategies.map(strategy => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.strategy_name}
              </option>
            ))}
          </select>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-slate-700/50 border-slate-600 p-3">
            <div className="text-center">
              <div className="text-lg font-bold text-blue-400">
                €{currentlyInvested.toLocaleString()}
              </div>
              <div className="text-xs text-slate-400">Currently Invested</div>
            </div>
          </Card>
          
          <Card className="bg-slate-700/50 border-slate-600 p-3">
            <div className="text-center">
              <div className={`text-lg font-bold ${realizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                €{realizedPnL.toLocaleString()}
              </div>
              <div className="text-xs text-slate-400">Realized P&L</div>
            </div>
          </Card>
          
          <Card className="bg-slate-700/50 border-slate-600 p-3">
            <div className="text-center">
              <div className={`text-lg font-bold ${unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                €{unrealizedPnL.toLocaleString()}
              </div>
              <div className="text-xs text-slate-400">Unrealized P&L</div>
            </div>
          </Card>
          
          <Card className="bg-slate-700/50 border-slate-600 p-3">
            <div className="text-center">
              <div className={`text-lg font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                €{totalPnL.toLocaleString()}
              </div>
              <div className="text-xs text-slate-400">Total P&L</div>
            </div>
          </Card>
        </div>

        {/* Open Positions */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-400" />
            Open Positions ({openPositions.length})
          </h3>
          
          {openPositions.length === 0 ? (
            <Card className="p-8 bg-slate-700/50 border-slate-600">
              <div className="text-center text-slate-400">
                <Wallet className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No open positions</p>
                <p className="text-xs mt-1">Start trading to see your positions here</p>
              </div>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {openPositions.map(renderOpenPosition)}
            </div>
          )}
        </div>

        {/* Past Positions */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-slate-400" />
            Past Positions ({pastPositions.length})
          </h3>
          
          {pastPositions.length === 0 ? (
            <Card className="p-8 bg-slate-700/50 border-slate-600">
              <div className="text-center text-slate-400">
                <TrendingDown className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No past positions</p>
                <p className="text-xs mt-1">Closed positions will appear here</p>
              </div>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {pastPositions.slice(0, 12).map(renderPastPosition)}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};