// TRADE-BASED MODEL: Each open BUY trade is one position
// Per-trade LIVE P&L displayed (indicative only, not affecting accounting)
// Final realized P&L is computed on SELL and stored in DB
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatEuro, formatPercentage } from '@/utils/currencyFormatter';
import { useMarketData } from '@/contexts/MarketDataContext';
import { toPairSymbol, toBaseSymbol } from '@/utils/symbols';
import { OpenTrade } from '@/hooks/useOpenTrades';
import { TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';

interface OpenTradeCardProps {
  trade: OpenTrade;
  onRequestSell?: (trade: OpenTrade) => void;
}

export function OpenTradeCard({ trade, onRequestSell }: OpenTradeCardProps) {
  const { marketData } = useMarketData();
  
  // Get live price from shared market data
  const pairSymbol = toPairSymbol(toBaseSymbol(trade.cryptocurrency));
  const liveData = marketData[pairSymbol];
  const livePrice = liveData?.price || null;
  
  // Cost basis (what we paid)
  const costBasis = trade.total_value;
  
  // Current value and P&L (live calculation for display only)
  const currentValue = livePrice ? trade.amount * livePrice : null;
  const unrealizedPnl = currentValue !== null ? currentValue - costBasis : null;
  const unrealizedPnlPct = unrealizedPnl !== null && costBasis > 0 
    ? (unrealizedPnl / costBasis) * 100 
    : null;
  
  const isProfit = unrealizedPnl !== null && unrealizedPnl > 0;
  const isLoss = unrealizedPnl !== null && unrealizedPnl < 0;
  
  // P&L indicator icon
  const PnlIcon = isProfit ? TrendingUp : isLoss ? TrendingDown : Minus;
  const pnlColor = isProfit ? 'text-emerald-500' : isLoss ? 'text-red-500' : 'text-muted-foreground';
  const pnlBgColor = isProfit ? 'bg-emerald-500/10' : isLoss ? 'bg-red-500/10' : 'bg-muted';

  return (
    <Card className="p-4 hover:shadow-md transition-shadow" data-testid="open-trade-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="font-semibold text-lg">{toBaseSymbol(trade.cryptocurrency)}</span>
        </div>
        <Badge variant="default">OPEN</Badge>
      </div>
      
      <div className="grid grid-cols-2 gap-4 text-sm">
        {/* Amount */}
        <div>
          <p className="text-muted-foreground">Amount</p>
          <p className="font-medium">{trade.amount.toFixed(8)}</p>
        </div>
        
        {/* Entry Price */}
        <div>
          <p className="text-muted-foreground">Entry Price</p>
          <p className="font-medium">{formatEuro(trade.price)}</p>
        </div>
        
        {/* Cost Basis */}
        <div>
          <p className="text-muted-foreground">Cost Basis</p>
          <p className="font-medium">{formatEuro(costBasis)}</p>
        </div>
        
        {/* Live Price */}
        <div>
          <p className="text-muted-foreground">Current Price</p>
          <p className="font-medium">
            {livePrice !== null ? formatEuro(livePrice) : '—'}
          </p>
        </div>
        
        {/* Current Value */}
        <div>
          <p className="text-muted-foreground">Current Value</p>
          <p className="font-medium">
            {currentValue !== null ? formatEuro(currentValue) : '—'}
          </p>
        </div>
        
        {/* Fee */}
        <div>
          <p className="text-muted-foreground">Fee</p>
          <p className="font-medium">{formatEuro(trade.fees)}</p>
        </div>
      </div>
      
      {/* Live P&L Section - Indicative only */}
      <div className={`mt-4 p-3 rounded-lg ${pnlBgColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PnlIcon className={`w-4 h-4 ${pnlColor}`} />
            <span className="text-sm font-medium">Unrealized P&L</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-48">
                    Live P&L — indicative, based on live market prices. 
                    Final P&L is computed and recorded on SELL.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="text-right">
            {unrealizedPnl !== null ? (
              <>
                <p className={`font-bold ${pnlColor}`}>
                  {unrealizedPnl >= 0 ? '+' : ''}{formatEuro(unrealizedPnl)}
                </p>
                <p className={`text-xs ${pnlColor}`}>
                  {unrealizedPnlPct !== null && (
                    <>{unrealizedPnlPct >= 0 ? '+' : ''}{formatPercentage(unrealizedPnlPct)}</>
                  )}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">—</p>
            )}
          </div>
        </div>
        {liveData && (
          <p className="text-xs text-muted-foreground mt-1">
            Live price • Updated {new Date(liveData.timestamp).toLocaleTimeString()}
          </p>
        )}
      </div>
      
      {/* Footer with timestamp and sell button */}
      <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <div>
            <p>Opened: {new Date(trade.executed_at).toLocaleString()}</p>
          </div>
          
          <Button
            variant="destructive"
            size="sm"
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onRequestSell) {
                onRequestSell(trade);
              }
            }}
          >
            SELL
          </Button>
        </div>
      </div>
    </Card>
  );
}
