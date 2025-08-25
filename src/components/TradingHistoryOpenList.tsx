import React, { useState, useEffect, useRef } from 'react';
import { useRenderCounter } from '@/hooks/useRenderCounter';
import { useRenderCauseTracer } from '@/hooks/useRenderCauseTracer';
import { useListRebuildDetector } from '@/hooks/useListRebuildDetector';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock } from 'lucide-react';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';

interface OpenListProps {
  trades: any[];
  marketData: any;
  onCancelOrder: (orderId: string, symbol: string) => void;
}

export const OpenList: React.FC<OpenListProps> = ({ trades, marketData, onCancelOrder }) => {
  useRenderCounter('OpenList');
  
  // Step 13: Add render-cause tracer and list rebuild detector
  useRenderCauseTracer('OpenList', {
    marketData,
    trades,
    loading: false
  });
  
  useListRebuildDetector(trades, 'OpenList');
  
  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No open positions</p>
        <p className="text-sm mt-2">Your open positions will appear here when you make trades</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {trades.map((trade) => (
        <OpenTradeCard key={trade.id} trade={trade} marketData={marketData} />
      ))}
    </div>
  );
};

const OpenTradeCard: React.FC<{ trade: any; marketData: any }> = ({ trade, marketData }) => {
  const [performance, setPerformance] = useState<any>(null);
  const [cardLoading, setCardLoading] = useState(true);

  // Simple performance calculation for open positions
  useEffect(() => {
    const currentPrice = marketData[trade.cryptocurrency]?.price;
    if (currentPrice && trade.trade_type === 'buy') {
      const currentValue = trade.amount * currentPrice;
      const gainLoss = currentValue - trade.total_value;
      const gainLossPercentage = (gainLoss / trade.total_value) * 100;
      
      setPerformance({
        currentPrice,
        currentValue,
        purchasePrice: trade.price,
        purchaseValue: trade.total_value,
        gainLoss,
        gainLossPercentage
      });
    }
    setCardLoading(false);
  }, [trade, marketData]);

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
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="font-semibold text-lg">{trade.cryptocurrency}</span>
        </div>
        <Badge variant="default">OPEN</Badge>
      </div>
      
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Amount</p>
          <p className="font-medium">{trade.amount.toFixed(8)}</p>
        </div>
        
        <div>
          <p className="text-muted-foreground">Purchase Value</p>
          <p className="font-medium">{formatEuro(trade.total_value)}</p>
        </div>
        
        <div>
          <p className="text-muted-foreground">Purchase Price</p>
          <p className="font-medium">{formatEuro(trade.price)}</p>
        </div>
        
        {performance && (
          <>
            <div>
              <p className="text-muted-foreground">Current Value</p>
              <p className="font-medium">{formatEuro(performance.currentValue)}</p>
            </div>
            
            <div>
              <p className="text-muted-foreground">Current Price</p>
              <p className="font-medium">{formatEuro(performance.currentPrice)}</p>
            </div>
            
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
      
      <Button
        variant="outline"
        size="sm"
        onClick={() => {/* Placeholder for sell action */}}
        className="w-full mt-3"
      >
        Sell Position
      </Button>
    </Card>
  );
};