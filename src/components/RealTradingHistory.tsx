/**
 * RealTradingHistory - REAL mode version of TradingHistory
 * 
 * Shows REAL on-chain data from real_trade_history_view and real_positions_view.
 * 
 * WHAT THIS SHOWS:
 * - Trade history with status (CONFIRMED/REVERTED), tx_hash, timestamps
 * - Positions with quantity ONLY
 * 
 * WHAT THIS DOES NOT SHOW (TEST-only):
 * - Unrealized P&L
 * - Realized P&L
 * - Win rate
 * - Performance stats
 * - Learning metrics
 */
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { useRealTradeHistory } from '@/hooks/useRealTradeHistory';
import { useRealPositions } from '@/hooks/useRealPositions';
import { RealTradeHistoryTable } from '@/components/trading/RealTradeHistoryTable';
import { RealPositionsTable } from '@/components/trading/RealPositionsTable';
import { NoActiveStrategyState } from '@/components/NoActiveStrategyState';

interface RealTradingHistoryProps {
  hasActiveStrategy: boolean;
  onCreateStrategy?: () => void;
}

export function RealTradingHistory({ hasActiveStrategy, onCreateStrategy }: RealTradingHistoryProps) {
  const { trades, isLoading: tradesLoading, refresh: refreshTrades } = useRealTradeHistory();
  const { positions, isLoading: positionsLoading, refresh: refreshPositions } = useRealPositions();

  // If no active strategy, show the same prompt as TEST mode
  if (!hasActiveStrategy) {
    return <NoActiveStrategyState onCreateStrategy={onCreateStrategy} />;
  }

  // Count by side
  const buyTrades = trades.filter(t => t.side === 'BUY');
  const sellTrades = trades.filter(t => t.side === 'SELL');

  return (
    <div className="space-y-4">
      <Card className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">Trading History</h2>
            <Badge variant="outline" className="text-xs">
              REAL
            </Badge>
          </div>
        </div>

        {/* Summary cards - matching TEST mode styling */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card className="p-4">
            <p className="text-sm text-muted-foreground mb-1">Open Positions</p>
            <p className="text-2xl font-bold">{positions.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground mb-1">Total BUY Trades</p>
            <p className="text-2xl font-bold">{buyTrades.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground mb-1">Total SELL Trades</p>
            <p className="text-2xl font-bold">{sellTrades.length}</p>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="positions">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="positions" className="flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4" />
              Positions ({positions.length})
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <ArrowDownLeft className="w-4 h-4" />
              Trade History ({trades.length})
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="positions" className="mt-4">
            <RealPositionsTable
              positions={positions}
              isLoading={positionsLoading}
              onRefresh={refreshPositions}
            />
          </TabsContent>
          
          <TabsContent value="history" className="mt-4">
            <RealTradeHistoryTable
              trades={trades}
              isLoading={tradesLoading}
              onRefresh={refreshTrades}
            />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
