import React, { useState, useEffect } from 'react';
import { useRenderCounter } from '@/hooks/useRenderCounter';
import { useRenderCauseTracer } from '@/hooks/useRenderCauseTracer';
import { useListRebuildDetector } from '@/hooks/useListRebuildDetector';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock } from 'lucide-react';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';

interface PastListProps {
  trades: any[];
  marketData: any;
}

export const PastList: React.FC<PastListProps> = ({ trades, marketData }) => {
  useRenderCounter('PastList');
  
  // Step 13: Add render-cause tracer and list rebuild detector
  useRenderCauseTracer('PastList', {
    marketData,
    trades,
    loading: false
  });
  
  useListRebuildDetector(trades, 'PastList');
  
  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No past positions</p>
        <p className="text-sm mt-2">Your completed trades will appear here</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {trades.map((trade) => (
        <PastTradeCard key={trade.id} trade={trade} />
      ))}
    </div>
  );
};

const PastTradeCard: React.FC<{ trade: any }> = ({ trade }) => {
  const [performance, setPerformance] = useState<any>(null);
  const [cardLoading, setCardLoading] = useState(true);

  // Calculate performance for completed trades
  useEffect(() => {
    if (trade.trade_type === 'sell') {
      const exitValue = trade.total_value;
      const purchaseValue = trade.original_purchase_value || 0;
      const gainLoss = exitValue - purchaseValue;
      const gainLossPercentage = purchaseValue > 0 ? (gainLoss / purchaseValue) * 100 : 0;
      
      setPerformance({
        purchasePrice: trade.original_purchase_price || trade.price,
        currentPrice: trade.price, // Exit price
        purchaseValue,
        currentValue: exitValue,
        gainLoss,
        gainLossPercentage
      });
    }
    setCardLoading(false);
  }, [trade]);

  if (cardLoading) {
    return (
      <Card className="p-4 animate-pulse">
        <div className="h-4 bg-muted rounded w-1/3 mb-2"></div>
        <div className="h-3 bg-muted rounded w-1/2"></div>
      </Card>
    );
  }

  const isProfit = (performance?.gainLoss || 0) > 0;
  const isLoss = (performance?.gainLoss || 0) < 0;

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span className="font-semibold text-lg">{trade.cryptocurrency}</span>
        </div>
        <Badge variant="secondary">SOLD</Badge>
      </div>
      
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Amount</p>
          <p className="font-medium">{trade.amount.toFixed(8)}</p>
        </div>
        
        <div>
          <p className="text-muted-foreground">Purchase Value</p>
          <p className="font-medium">{formatEuro(performance?.purchaseValue || 0)}</p>
        </div>
        
        <div>
          <p className="text-muted-foreground">Exit Price</p>
          <p className="font-medium">{formatEuro(trade.price)}</p>
        </div>
        
        <div>
          <p className="text-muted-foreground">Exit Value</p>
          <p className="font-medium">{formatEuro(trade.total_value)}</p>
        </div>
        
        {performance && (
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
                {formatPercentage(performance.gainLossPercentage)}
              </p>
            </div>
          </>
        )}
      </div>
      
      <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
        <p>Executed: {new Date(trade.executed_at).toLocaleString()}</p>
        {trade.notes && <p className="mt-1">Note: {trade.notes}</p>}
      </div>
    </Card>
  );
};