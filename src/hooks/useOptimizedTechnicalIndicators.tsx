import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RSI, MACD, EMA, SMA, BollingerBands, ADX, StochasticRSI } from 'technicalindicators';
import { useRealTimeMarketData } from './useRealTimeMarketData';
import { supabase } from '@/integrations/supabase/client';

export interface IndicatorConfig {
  rsi: { enabled: boolean; period: number; buyThreshold: number; sellThreshold: number };
  macd: { enabled: boolean; fast: number; slow: number; signal: number };
  ema: { enabled: boolean; shortPeriod: number; longPeriod: number };
  sma: { enabled: boolean; period: number };
  bollinger: { enabled: boolean; period: number; stdDev: number };
  adx: { enabled: boolean; period: number; threshold: number };
  stochasticRSI: { enabled: boolean; kPeriod: number; dPeriod: number; rsiPeriod: number; stochasticPeriod: number };
}

export interface IndicatorValues {
  RSI?: { value: number; signal: 'oversold' | 'overbought' | 'neutral' };
  MACD?: { macd: number; signal: number; histogram: number; crossover: 'bullish' | 'bearish' | 'neutral' };
  EMA?: { short: number; long: number; crossover: boolean; direction: 'bullish' | 'bearish' | 'neutral' };
  SMA?: { value: number };
  Bollinger?: { upper: number; middle: number; lower: number; position: 'above' | 'below' | 'middle' | 'near_upper' | 'near_lower'; width: number };
  ADX?: { value: number; trendStrength: 'weak' | 'moderate' | 'strong' | 'very_strong' };
  StochasticRSI?: { k: number; d: number; signal: 'oversold' | 'overbought' | 'neutral' };
}

const DEFAULT_CONFIG: IndicatorConfig = {
  rsi: { enabled: true, period: 14, buyThreshold: 30, sellThreshold: 70 },
  macd: { enabled: true, fast: 12, slow: 26, signal: 9 },
  ema: { enabled: true, shortPeriod: 9, longPeriod: 21 },
  sma: { enabled: false, period: 20 },
  bollinger: { enabled: false, period: 20, stdDev: 2 },
  adx: { enabled: false, period: 14, threshold: 25 },
  stochasticRSI: { enabled: false, kPeriod: 3, dPeriod: 3, rsiPeriod: 14, stochasticPeriod: 14 }
};

const SYMBOLS = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR'];

// Fetch cached indicators with React Query for persistent caching
const fetchCachedIndicators = async (): Promise<Record<string, IndicatorValues>> => {
  const startTime = performance.now();
  console.log('🚀 Fetching cached indicators at:', startTime, 'ms');

  try {
    // Try to get cached indicators first (should be instant)
    const { data: cachedData } = await supabase
      .from('price_data')
      .select('symbol, metadata')
      .in('symbol', SYMBOLS)
      .not('metadata->indicators', 'is', null)
      .order('timestamp', { ascending: false })
      .limit(SYMBOLS.length);

    const cacheTime = performance.now();
    console.log(`⚡ Cache query took: ${cacheTime - startTime}ms, found ${cachedData?.length || 0} cached indicators`);

    const cachedIndicators: Record<string, IndicatorValues> = {};
    
    if (cachedData && cachedData.length > 0) {
      cachedData.forEach(item => {
        if (item.metadata && typeof item.metadata === 'object' && 'indicators' in item.metadata) {
          cachedIndicators[item.symbol] = (item.metadata as any).indicators;
          console.log(`📊 Using cached indicators for ${item.symbol}`);
        }
      });
    }

    // If we have cached indicators for all symbols, return them immediately
    if (Object.keys(cachedIndicators).length === SYMBOLS.length) {
      const totalTime = performance.now() - startTime;
      console.log(`✅ All indicators loaded from cache in ${totalTime}ms`);
      return cachedIndicators;
    }

    // If cache is incomplete, fall back to calculation but don't block
    console.log('⚠️ Cache incomplete, falling back to fresh calculation');
    return await calculateFreshIndicators(cachedIndicators);

  } catch (error) {
    console.error('❌ Error fetching cached indicators:', error);
    return await calculateFreshIndicators({});
  }
};

// Calculate indicators from fresh price data (fallback)
const calculateFreshIndicators = async (existingCache: Record<string, IndicatorValues>): Promise<Record<string, IndicatorValues>> => {
  const startTime = performance.now();
  console.log('🔄 Calculating fresh indicators...');

  try {
    // Fetch fresh price data for symbols not in cache
    const missingSymbols = SYMBOLS.filter(symbol => !existingCache[symbol]);
    
    if (missingSymbols.length === 0) {
      return existingCache;
    }

    const pricePromises = missingSymbols.map(async (symbol) => {
      const queryStart = performance.now();
      const { data } = await supabase
        .from('price_data')
        .select('symbol, close_price, timestamp')
        .eq('symbol', symbol)
        .order('timestamp', { ascending: false })
        .limit(50);
      
      const queryEnd = performance.now();
      console.log(`⏱️ Price query for ${symbol}: ${queryEnd - queryStart}ms`);
      return { symbol, data: data || [] };
    });

    const priceResults = await Promise.all(pricePromises);
    const calculatedIndicators = { ...existingCache };

    for (const { symbol, data } of priceResults) {
      if (data.length >= 26) {
        const calcStart = performance.now();
        const prices = data
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
          .map(d => parseFloat(d.close_price.toString()));

        calculatedIndicators[symbol] = calculateIndicatorsForSymbol(prices, DEFAULT_CONFIG);
        
        const calcEnd = performance.now();
        console.log(`📈 Calculated indicators for ${symbol} in ${calcEnd - calcStart}ms`);
      }
    }

    const totalTime = performance.now() - startTime;
    console.log(`🏁 Fresh indicator calculation took: ${totalTime}ms`);
    
    return calculatedIndicators;
  } catch (error) {
    console.error('❌ Error calculating fresh indicators:', error);
    return existingCache;
  }
};

// Calculate indicators for a single symbol
const calculateIndicatorsForSymbol = (prices: number[], config: IndicatorConfig): IndicatorValues => {
  const indicators: IndicatorValues = {};

  try {
    // RSI
    if (config.rsi.enabled && prices.length >= config.rsi.period) {
      const rsiValues = RSI.calculate({
        values: prices,
        period: config.rsi.period
      });
      
      if (rsiValues.length > 0) {
        const currentRSI = rsiValues[rsiValues.length - 1];
        let signal: 'oversold' | 'overbought' | 'neutral' = 'neutral';
        
        if (currentRSI < config.rsi.buyThreshold) signal = 'oversold';
        else if (currentRSI > config.rsi.sellThreshold) signal = 'overbought';
        
        indicators.RSI = { value: Number(currentRSI.toFixed(2)), signal };
      }
    }

    // MACD
    if (config.macd.enabled && prices.length >= config.macd.slow + config.macd.signal) {
      const macdValues = MACD.calculate({
        values: prices,
        fastPeriod: config.macd.fast,
        slowPeriod: config.macd.slow,
        signalPeriod: config.macd.signal,
        SimpleMAOscillator: true,
        SimpleMASignal: true
      });
      
      if (macdValues.length >= 2) {
        const current = macdValues[macdValues.length - 1];
        const previous = macdValues[macdValues.length - 2];
        
        let crossover: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        if (previous.MACD < previous.signal && current.MACD > current.signal) {
          crossover = 'bullish';
        } else if (previous.MACD > previous.signal && current.MACD < current.signal) {
          crossover = 'bearish';
        }
        
        indicators.MACD = {
          macd: Number(current.MACD.toFixed(4)),
          signal: Number(current.signal.toFixed(4)),
          histogram: Number(current.histogram.toFixed(4)),
          crossover
        };
      }
    }

    // EMA
    if (config.ema.enabled) {
      const shortEMA = EMA.calculate({
        values: prices,
        period: config.ema.shortPeriod
      });
      
      const longEMA = EMA.calculate({
        values: prices,
        period: config.ema.longPeriod
      });
      
      if (shortEMA.length >= 2 && longEMA.length >= 2) {
        const currentShort = shortEMA[shortEMA.length - 1];
        const currentLong = longEMA[longEMA.length - 1];
        const previousShort = shortEMA[shortEMA.length - 2];
        const previousLong = longEMA[longEMA.length - 2];
        
        const crossover = (previousShort <= previousLong && currentShort > currentLong) ||
                         (previousShort >= previousLong && currentShort < currentLong);
        
        let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        if (currentShort > currentLong) direction = 'bullish';
        else if (currentShort < currentLong) direction = 'bearish';
        
        indicators.EMA = {
          short: Number(currentShort.toFixed(2)),
          long: Number(currentLong.toFixed(2)),
          crossover,
          direction
        };
      }
    }

    // Add other indicators as needed...

  } catch (error) {
    console.error('Error calculating indicators:', error);
  }

  return indicators;
};

export const useOptimizedTechnicalIndicators = (strategyConfig?: any) => {
  const hookStart = performance.now();
  console.log('🔧 useOptimizedTechnicalIndicators hook initialized at:', hookStart, 'ms');

  const [indicatorConfig, setIndicatorConfig] = useState<IndicatorConfig>(DEFAULT_CONFIG);
  const { marketData } = useRealTimeMarketData();

  // Update indicator config from strategy configuration
  useEffect(() => {
    if (strategyConfig?.technicalIndicators) {
      setIndicatorConfig(prev => ({
        ...prev,
        ...strategyConfig.technicalIndicators
      }));
    }
  }, [strategyConfig]);

  // Use React Query for persistent caching across page navigation
  const {
    data: indicators = {},
    isLoading,
    error,
    dataUpdatedAt,
    refetch
  } = useQuery({
    queryKey: ['technical-indicators', SYMBOLS],
    queryFn: fetchCachedIndicators,
    staleTime: 30 * 1000, // Consider data fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false, // Don't refetch when component mounts if data exists
    refetchOnReconnect: false,
  });

  // Memoize price history for real-time updates
  const priceHistory = useMemo(() => {
    const history: Record<string, number[]> = {};
    if (marketData) {
      Object.entries(marketData).forEach(([symbol, data]: [string, any]) => {
        if (data.price && SYMBOLS.includes(symbol)) {
          // Store minimal real-time price data
          history[symbol] = [data.price];
        }
      });
    }
    return history;
  }, [marketData]);

  const updateIndicatorConfig = (updates: Partial<IndicatorConfig>) => {
    setIndicatorConfig(prev => ({
      ...prev,
      ...updates
    }));
  };

  const getIndicatorSummary = (symbol: string): string => {
    const symbolIndicators = indicators[symbol];
    if (!symbolIndicators) return 'No indicators available';

    const signals: string[] = [];
    
    if (symbolIndicators.RSI) {
      signals.push(`RSI: ${symbolIndicators.RSI.value} (${symbolIndicators.RSI.signal})`);
    }
    
    if (symbolIndicators.MACD) {
      signals.push(`MACD: ${symbolIndicators.MACD.crossover} crossover`);
    }
    
    if (symbolIndicators.EMA) {
      signals.push(`EMA: ${symbolIndicators.EMA.direction} trend`);
    }
    
    return signals.join(', ') || 'No active indicators';
  };

  const hookEnd = performance.now();
  console.log(`⏱️ Hook execution took: ${hookEnd - hookStart}ms, loading: ${isLoading}`);

  return {
    indicators,
    indicatorConfig,
    updateIndicatorConfig,
    getIndicatorSummary,
    priceHistory,
    isLoadingHistoricalData: isLoading,
    lastUpdated: dataUpdatedAt ? new Date(dataUpdatedAt) : new Date(),
    error,
    refresh: refetch
  };
};