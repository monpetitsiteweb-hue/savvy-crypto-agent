import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { StatusBadges } from './StatusBadges';

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
  original_purchase_value?: number;
  original_purchase_price?: number;
  is_corrupted?: boolean;
  integrity_reason?: string;
}

interface TradePerformance {
  currentPrice: number;
  currentValue: number;
  purchaseValue: number | null;
  purchasePrice: number | null;
  gainLoss: number | null;
  gainLossPercentage: number | null;
  isAutomatedWithoutPnL?: boolean;
  isCorrupted?: boolean;
}

interface TradeCardProps {
  trade: Trade;
  showSellButton?: boolean;
  onSell?: (trade: Trade) => void;
  performance: TradePerformance | null;
  coordinatorReason?: string;
}

export const TradeCard: React.FC<TradeCardProps> = ({ 
  trade, 
  showSellButton = false, 
  onSell, 
  performance,
  coordinatorReason 
}) => {
  if (!performance) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-muted animate-pulse" />
          <div className="h-4 bg-muted rounded w-24 animate-pulse" />
        </div>
        <div className="h-3 bg-muted rounded w-32 animate-pulse" />
      </Card>
    );
  }

  const isProfit = (performance.gainLoss || 0) > 0;
  const isLoss = (performance.gainLoss || 0) < 0;

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <StatusBadges trade={trade} coordinatorReason={coordinatorReason} />
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
              <p className="font-medium">{formatEuro(performance.currentValue)}</p>
            </div>
            
            <div>
              <p className="text-muted-foreground">Current Price</p>
              <p className="font-medium">{formatEuro(performance.currentPrice)}</p>
            </div>
          </>
        )}
        
        {trade.trade_type === 'sell' && (
          <div>
            <p className="text-muted-foreground">Exit Value</p>
            <p className="font-medium">{formatEuro(performance.currentValue)}</p>
          </div>
        )}
        
        {!performance.isAutomatedWithoutPnL && performance.gainLoss !== null && (
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
      
      {showSellButton && trade.trade_type === 'buy' && !performance.isCorrupted && onSell && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSell(trade)}
          className="w-full mt-3"
        >
          Sell Position
        </Button>
      )}
    </Card>
  );
};