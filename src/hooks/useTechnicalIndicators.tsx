import { useState, useEffect } from 'react';
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

export const useTechnicalIndicators = (strategyConfig?: any) => {
  console.log('🔧 useTechnicalIndicators hook initialized with config:', strategyConfig);
  
  const [indicatorConfig, setIndicatorConfig] = useState<IndicatorConfig>(DEFAULT_CONFIG);
  const [indicators, setIndicators] = useState<Record<string, IndicatorValues>>({});
  const [priceHistory, setPriceHistory] = useState<Record<string, number[]>>({});
  const [isLoadingHistoricalData, setIsLoadingHistoricalData] = useState(true);
  const { marketData } = useRealTimeMarketData();

  // Bootstrap price history from existing price_data table on mount
  useEffect(() => {
    const loadHistoricalPriceData = async () => {
      try {
        setIsLoadingHistoricalData(true);
        const symbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR'];
        
        console.log('🔍 Loading cached indicators first...');
        
        // Check for cached indicators first for instant loading
        const { data: existingIndicators } = await supabase
          .from('price_data')
          .select('symbol, metadata')
          .in('symbol', symbols)
          .not('metadata->indicators', 'is', null)
          .order('timestamp', { ascending: false })
          .limit(symbols.length);
        
        // Load cached indicators instantly
        if (existingIndicators && existingIndicators.length > 0) {
          console.log('📊 Found cached indicators, loading instantly...');
          const cachedIndicators: Record<string, any> = {};
          existingIndicators.forEach(item => {
            if (item.metadata && typeof item.metadata === 'object' && 'indicators' in item.metadata) {
              cachedIndicators[item.symbol] = (item.metadata as any).indicators;
            }
          });
          
          if (Object.keys(cachedIndicators).length > 0) {
            setIndicators(cachedIndicators);
            setIsLoadingHistoricalData(false); // Stop loading state immediately
            console.log('✅ Loaded cached indicators for:', Object.keys(cachedIndicators));
          }
        }
        
        // Fetch fresh price data in background for recalculation
        console.log('🔍 Loading fresh price data for recalculation...');
        const pricePromises = symbols.map(async (symbol) => {
          const { data } = await supabase
            .from('price_data')
            .select('symbol, close_price, timestamp')
            .eq('symbol', symbol)
            .order('timestamp', { ascending: false })
            .limit(50);
          return data || [];
        });
        
        const allPriceData = (await Promise.all(pricePromises)).flat();
        console.log(`📊 Fetched ${allPriceData.length} fresh price data points`);
        
        if (allPriceData.length > 0) {
          const historyBySymbol: Record<string, number[]> = {};
          
          // Group data by symbol and sort by timestamp
          symbols.forEach(symbol => {
            const symbolData = allPriceData
              .filter(d => d.symbol === symbol)
              .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
              .map(d => parseFloat(d.close_price.toString()));
            
            if (symbolData.length > 0) {
              historyBySymbol[symbol] = symbolData; // Use all fetched data (50 points max)
            }
          });
          
          setPriceHistory(historyBySymbol);
          console.log(`✅ Fast-loaded indicators with data:`, Object.keys(historyBySymbol).map(s => `${s}: ${historyBySymbol[s].length} prices`));
        } else {
          console.log('⚠️ No price data found in database');
        }
      } catch (error) {
        console.error('❌ Failed to load historical price data:', error);
      } finally {
        setIsLoadingHistoricalData(false);
      }
    };
    
    loadHistoricalPriceData();
  }, []);

  // Update indicator config from strategy configuration
  useEffect(() => {
    if (strategyConfig?.technicalIndicators) {
      setIndicatorConfig(prev => ({
        ...prev,
        ...strategyConfig.technicalIndicators
      }));
    }
  }, [strategyConfig]);

  // Update price history when new market data arrives  
  useEffect(() => {
    if (marketData) {
      setPriceHistory(prev => {
        const updated = { ...prev };
        Object.entries(marketData).forEach(([symbol, data]: [string, any]) => {
          if (data.price) {
            if (!updated[symbol]) updated[symbol] = [];
            // Add new price and keep last 200 prices for calculation
            const newPrices = [...updated[symbol], data.price].slice(-200);
            updated[symbol] = newPrices;
          }
        });
        return updated;
      });
    }
  }, [marketData]);

  // Calculate indicators when price history updates
  useEffect(() => {
    const newIndicators: Record<string, IndicatorValues> = {};

    Object.entries(priceHistory).forEach(([symbol, prices]) => {
      if (prices.length < 26) return; // Need minimum data for indicators

      const symbolIndicators: IndicatorValues = {};

      // RSI Calculation
      if (indicatorConfig.rsi.enabled && prices.length >= indicatorConfig.rsi.period) {
        try {
          const rsiValues = RSI.calculate({
            values: prices,
            period: indicatorConfig.rsi.period
          });
          
          if (rsiValues.length > 0) {
            const currentRSI = rsiValues[rsiValues.length - 1];
            let signal: 'oversold' | 'overbought' | 'neutral' = 'neutral';
            
            if (currentRSI < indicatorConfig.rsi.buyThreshold) signal = 'oversold';
            else if (currentRSI > indicatorConfig.rsi.sellThreshold) signal = 'overbought';
            
            symbolIndicators.RSI = { value: Number(currentRSI.toFixed(2)), signal };
          }
        } catch (error) {
          console.error('Error calculating RSI:', error);
        }
      }

      // MACD Calculation
      if (indicatorConfig.macd.enabled && prices.length >= indicatorConfig.macd.slow + indicatorConfig.macd.signal) {
        try {
          const macdValues = MACD.calculate({
            values: prices,
            fastPeriod: indicatorConfig.macd.fast,
            slowPeriod: indicatorConfig.macd.slow,
            signalPeriod: indicatorConfig.macd.signal,
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
            
            symbolIndicators.MACD = {
              macd: Number(current.MACD.toFixed(4)),
              signal: Number(current.signal.toFixed(4)),
              histogram: Number(current.histogram.toFixed(4)),
              crossover
            };
          }
        } catch (error) {
          console.error('Error calculating MACD:', error);
        }
      }

      // EMA Calculation
      if (indicatorConfig.ema.enabled) {
        try {
          const shortEMA = EMA.calculate({
            values: prices,
            period: indicatorConfig.ema.shortPeriod
          });
          
          const longEMA = EMA.calculate({
            values: prices,
            period: indicatorConfig.ema.longPeriod
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
            
            symbolIndicators.EMA = {
              short: Number(currentShort.toFixed(2)),
              long: Number(currentLong.toFixed(2)),
              crossover,
              direction
            };
          }
        } catch (error) {
          console.error('Error calculating EMA:', error);
        }
      }

      // SMA Calculation
      if (indicatorConfig.sma.enabled && prices.length >= indicatorConfig.sma.period) {
        try {
          const smaValues = SMA.calculate({
            values: prices,
            period: indicatorConfig.sma.period
          });
          
          if (smaValues.length > 0) {
            symbolIndicators.SMA = {
              value: Number(smaValues[smaValues.length - 1].toFixed(2))
            };
          }
        } catch (error) {
          console.error('Error calculating SMA:', error);
        }
      }

      // Bollinger Bands Calculation
      if (indicatorConfig.bollinger.enabled && prices.length >= indicatorConfig.bollinger.period) {
        try {
          const bbValues = BollingerBands.calculate({
            values: prices,
            period: indicatorConfig.bollinger.period,
            stdDev: indicatorConfig.bollinger.stdDev
          });
          
          if (bbValues.length > 0) {
            const current = bbValues[bbValues.length - 1];
            const currentPrice = prices[prices.length - 1];
            
            let position: 'above' | 'below' | 'middle' | 'near_upper' | 'near_lower' = 'middle';
            const upperDistance = Math.abs(currentPrice - current.upper) / current.upper;
            const lowerDistance = Math.abs(currentPrice - current.lower) / current.lower;
            
            if (currentPrice > current.upper) position = 'above';
            else if (currentPrice < current.lower) position = 'below';
            else if (upperDistance < 0.02) position = 'near_upper';
            else if (lowerDistance < 0.02) position = 'near_lower';
            
            const width = ((current.upper - current.lower) / current.middle) * 100;
            
            symbolIndicators.Bollinger = {
              upper: Number(current.upper.toFixed(2)),
              middle: Number(current.middle.toFixed(2)),
              lower: Number(current.lower.toFixed(2)),
              position,
              width: Number(width.toFixed(2))
            };
          }
        } catch (error) {
          console.error('Error calculating Bollinger Bands:', error);
        }
      }

      // ADX Calculation
      if (indicatorConfig.adx.enabled && prices.length >= indicatorConfig.adx.period + 14) {
        try {
          // ADX needs high, low, close data - using price as close, estimating high/low
          const input = prices.map(price => ({
            high: price * 1.001, // Rough estimation
            low: price * 0.999,
            close: price
          }));
          
          const adxValues = ADX.calculate({
            high: input.map(i => i.high),
            low: input.map(i => i.low),
            close: input.map(i => i.close),
            period: indicatorConfig.adx.period
          });
          
          if (adxValues.length > 0) {
            // ADX returns simple number values
            const currentADX = adxValues[adxValues.length - 1] as unknown as number;
            
            let trendStrength: 'weak' | 'moderate' | 'strong' | 'very_strong' = 'weak';
            
            if (currentADX > 50) trendStrength = 'very_strong';
            else if (currentADX > 25) trendStrength = 'strong';
            else if (currentADX > 20) trendStrength = 'moderate';
            
            symbolIndicators.ADX = {
              value: Number(currentADX.toFixed(2)),
              trendStrength
            };
          }
        } catch (error) {
          console.error('Error calculating ADX:', error);
        }
      }

      // Stochastic RSI Calculation
      if (indicatorConfig.stochasticRSI.enabled && prices.length >= indicatorConfig.stochasticRSI.rsiPeriod + indicatorConfig.stochasticRSI.stochasticPeriod) {
        try {
          const stochRSIValues = StochasticRSI.calculate({
            values: prices,
            rsiPeriod: indicatorConfig.stochasticRSI.rsiPeriod,
            stochasticPeriod: indicatorConfig.stochasticRSI.stochasticPeriod,
            kPeriod: indicatorConfig.stochasticRSI.kPeriod,
            dPeriod: indicatorConfig.stochasticRSI.dPeriod
          });
          
          if (stochRSIValues.length > 0) {
            const current = stochRSIValues[stochRSIValues.length - 1];
            let signal: 'oversold' | 'overbought' | 'neutral' = 'neutral';
            
            if (current.k < 20 && current.d < 20) signal = 'oversold';
            else if (current.k > 80 && current.d > 80) signal = 'overbought';
            
            symbolIndicators.StochasticRSI = {
              k: Number(current.k.toFixed(2)),
              d: Number(current.d.toFixed(2)),
              signal
            };
          }
        } catch (error) {
          console.error('Error calculating Stochastic RSI:', error);
        }
      }

      newIndicators[symbol] = symbolIndicators;
    });

    setIndicators(newIndicators);
  }, [priceHistory, indicatorConfig]);

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
    
    if (symbolIndicators.Bollinger) {
      signals.push(`Bollinger: ${symbolIndicators.Bollinger.position}`);
    }
    
    return signals.join(', ') || 'No active indicators';
  };

  return {
    indicators,
    indicatorConfig,
    updateIndicatorConfig,
    getIndicatorSummary,
    priceHistory,
    isLoadingHistoricalData
  };
};