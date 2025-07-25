import { useTechnicalIndicators } from '@/hooks/useTechnicalIndicators';
import { useActiveStrategy } from '@/hooks/useActiveStrategy';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';

export const LiveIndicatorKPI = () => {
  console.log('🚀 LiveIndicatorKPI component is rendering');
  
  const { activeStrategy } = useActiveStrategy();
  console.log('📋 Active strategy:', activeStrategy);
  
  const { indicators, indicatorConfig } = useTechnicalIndicators(activeStrategy?.configuration);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Auto-refresh timestamp every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdated(new Date());
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Update timestamp when indicators change
  useEffect(() => {
    if (Object.keys(indicators).length > 0) {
      setLastUpdated(new Date());
    }
  }, [indicators]);

  const hasEnabledIndicators = Object.values(indicatorConfig).some(config => config.enabled);
  const hasIndicatorData = Object.keys(indicators).length > 0;

  console.log('🔍 Component state - activeStrategy:', !!activeStrategy, 'hasEnabledIndicators:', hasEnabledIndicators, 'hasIndicatorData:', hasIndicatorData);
  
  if (!activeStrategy) {
    console.log('⚠️ No active strategy, showing placeholder');
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Live Technical Indicators
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No active strategy. Enable a strategy to see live indicators.</p>
        </CardContent>
      </Card>
    );
  }

  if (!hasEnabledIndicators) {
    console.log('⚠️ No indicators enabled, showing placeholder');
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Live Technical Indicators
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No indicators enabled. Ask the AI assistant to enable RSI, MACD, or other indicators.</p>
        </CardContent>
      </Card>
    );
  }

  const getSignalBadge = (signal: string) => {
    switch (signal.toLowerCase()) {
      case 'oversold':
      case 'bullish':
      case 'buy':
        return <Badge variant="default" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">✅ {signal}</Badge>;
      case 'overbought':
      case 'bearish':
      case 'sell':
        return <Badge variant="destructive" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">❌ {signal}</Badge>;
      default:
        return <Badge variant="outline" className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{signal}</Badge>;
    }
  };

  const getDirectionIcon = (direction: string) => {
    switch (direction.toLowerCase()) {
      case 'bullish':
      case 'uptrend':
        return <TrendingUp className="h-4 w-4 text-green-600" />;
      case 'bearish':
      case 'downtrend':
        return <TrendingDown className="h-4 w-4 text-red-600" />;
      default:
        return <Minus className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Live Technical Indicators
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Clock className="h-3 w-3" />
            {lastUpdated.toLocaleTimeString()}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasIndicatorData ? (
          <p className="text-muted-foreground">Loading indicator data...</p>
        ) : (
          Object.entries(indicators).map(([symbol, symbolIndicators]) => (
            <div key={symbol} className="border rounded-lg p-3 space-y-2">
              <h4 className="font-semibold text-lg">{symbol}</h4>
              
              <div className="grid gap-2">
                {/* RSI */}
                {indicatorConfig.rsi.enabled && symbolIndicators.RSI && (
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div>
                      <span className="font-medium">RSI</span>
                      <p className="text-sm text-muted-foreground">
                        Buy &lt; {indicatorConfig.rsi.buyThreshold}, Sell &gt; {indicatorConfig.rsi.sellThreshold}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg">{symbolIndicators.RSI.value}</span>
                      {getSignalBadge(symbolIndicators.RSI.signal)}
                    </div>
                  </div>
                )}

                {/* MACD */}
                {indicatorConfig.macd.enabled && symbolIndicators.MACD && (
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div>
                      <span className="font-medium">MACD</span>
                      <p className="text-sm text-muted-foreground">
                        {indicatorConfig.macd.fast}/{indicatorConfig.macd.slow}/{indicatorConfig.macd.signal}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="font-mono text-sm">{symbolIndicators.MACD.macd}</div>
                        <div className="text-xs text-muted-foreground">H: {symbolIndicators.MACD.histogram}</div>
                      </div>
                      {getSignalBadge(symbolIndicators.MACD.crossover)}
                    </div>
                  </div>
                )}

                {/* EMA */}
                {indicatorConfig.ema.enabled && symbolIndicators.EMA && (
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div>
                      <span className="font-medium">EMA</span>
                      <p className="text-sm text-muted-foreground">
                        {indicatorConfig.ema.shortPeriod}/{indicatorConfig.ema.longPeriod} period
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right font-mono text-sm">
                        <div>{symbolIndicators.EMA.short}/{symbolIndicators.EMA.long}</div>
                        {symbolIndicators.EMA.crossover && <div className="text-xs text-blue-600">Crossover!</div>}
                      </div>
                      <div className="flex items-center gap-1">
                        {getDirectionIcon(symbolIndicators.EMA.direction)}
                        {getSignalBadge(symbolIndicators.EMA.direction)}
                      </div>
                    </div>
                  </div>
                )}

                {/* SMA */}
                {indicatorConfig.sma.enabled && symbolIndicators.SMA && (
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div>
                      <span className="font-medium">SMA</span>
                      <p className="text-sm text-muted-foreground">
                        {indicatorConfig.sma.period} period
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg">{symbolIndicators.SMA.value}</span>
                    </div>
                  </div>
                )}

                {/* Bollinger Bands */}
                {indicatorConfig.bollinger.enabled && symbolIndicators.Bollinger && (
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div>
                      <span className="font-medium">Bollinger Bands</span>
                      <p className="text-sm text-muted-foreground">
                        Period {indicatorConfig.bollinger.period}, StdDev {indicatorConfig.bollinger.stdDev}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right font-mono text-sm">
                        <div>U: {symbolIndicators.Bollinger.upper}</div>
                        <div>M: {symbolIndicators.Bollinger.middle}</div>
                        <div>L: {symbolIndicators.Bollinger.lower}</div>
                        <div className="text-xs">Width: {symbolIndicators.Bollinger.width}%</div>
                      </div>
                      {getSignalBadge(symbolIndicators.Bollinger.position)}
                    </div>
                  </div>
                )}

                {/* ADX */}
                {indicatorConfig.adx.enabled && symbolIndicators.ADX && (
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div>
                      <span className="font-medium">ADX</span>
                      <p className="text-sm text-muted-foreground">
                        Trend strength threshold: {indicatorConfig.adx.threshold}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg">{symbolIndicators.ADX.value}</span>
                      {getSignalBadge(symbolIndicators.ADX.trendStrength)}
                    </div>
                  </div>
                )}

                {/* Stochastic RSI */}
                {indicatorConfig.stochasticRSI.enabled && symbolIndicators.StochasticRSI && (
                  <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div>
                      <span className="font-medium">Stochastic RSI</span>
                      <p className="text-sm text-muted-foreground">
                        K: {indicatorConfig.stochasticRSI.kPeriod}, D: {indicatorConfig.stochasticRSI.dPeriod}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right font-mono text-sm">
                        <div>K: {symbolIndicators.StochasticRSI.k}</div>
                        <div>D: {symbolIndicators.StochasticRSI.d}</div>
                      </div>
                      {getSignalBadge(symbolIndicators.StochasticRSI.signal)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};