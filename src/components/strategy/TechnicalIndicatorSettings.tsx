import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TrendingUp, BarChart3, Info } from 'lucide-react';

export interface TechnicalIndicatorConfig {
  rsi: {
    enabled: boolean;
    period: number;
    buyThreshold: number;
    sellThreshold: number;
  };
  macd: {
    enabled: boolean;
    fast: number;
    slow: number;
    signal: number;
  };
  ema: {
    enabled: boolean;
    shortPeriod: number;
    longPeriod: number;
  };
  sma: {
    enabled: boolean;
    period: number;
  };
  maCrossover: {
    enabled: boolean;
    shortPeriod: number;
    longPeriod: number;
    minDivergenceThreshold: number;
    strengthMultiplier: number;
  };
  bollinger: {
    enabled: boolean;
    period: number;
    stdDev: number;
  };
  adx: {
    enabled: boolean;
    period: number;
    threshold: number;
  };
  stochasticRSI: {
    enabled: boolean;
    rsiPeriod: number;
    stochPeriod: number;
    kPeriod: number;
    dPeriod: number;
  };
}

interface TechnicalIndicatorSettingsProps {
  config: TechnicalIndicatorConfig;
  onConfigChange: (config: TechnicalIndicatorConfig) => void;
}

const defaultConfig: TechnicalIndicatorConfig = {
  rsi: {
    enabled: true,
    period: 14,
    buyThreshold: 30,
    sellThreshold: 70,
  },
  macd: {
    enabled: true,
    fast: 12,
    slow: 26,
    signal: 9,
  },
  ema: {
    enabled: true,
    shortPeriod: 12,
    longPeriod: 26,
  },
  sma: {
    enabled: false,
    period: 20,
  },
  maCrossover: {
    enabled: true,
    shortPeriod: 5,
    longPeriod: 10,
    minDivergenceThreshold: 0.5,
    strengthMultiplier: 20,
  },
  bollinger: {
    enabled: false,
    period: 20,
    stdDev: 2,
  },
  adx: {
    enabled: false,
    period: 14,
    threshold: 25,
  },
  stochasticRSI: {
    enabled: false,
    rsiPeriod: 14,
    stochPeriod: 14,
    kPeriod: 3,
    dPeriod: 3,
  },
};

const TooltipField = ({ 
  children, 
  description 
}: { 
  children: React.ReactNode; 
  description: string;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <div className="flex items-center gap-2">
        {children}
        <Info className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help" />
      </div>
    </TooltipTrigger>
    <TooltipContent className="max-w-sm p-4">
      <p className="text-sm">{description}</p>
    </TooltipContent>
  </Tooltip>
);

export const TechnicalIndicatorSettings: React.FC<TechnicalIndicatorSettingsProps> = ({
  config = defaultConfig,
  onConfigChange
}) => {
  const updateConfig = (indicator: keyof TechnicalIndicatorConfig, updates: any) => {
    onConfigChange({
      ...config,
      [indicator]: { ...config[indicator], ...updates }
    });
  };

  return (
    <div className="space-y-6">
      {/* RSI Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            RSI (Relative Strength Index)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <TooltipField description="RSI measures price momentum. Values below 30 = oversold (buy signal), above 70 = overbought (sell signal)">
              <Label htmlFor="rsi-enabled">Enable RSI</Label>
            </TooltipField>
            <Switch
              id="rsi-enabled"
              checked={config.rsi.enabled}
              onCheckedChange={(enabled) => updateConfig('rsi', { enabled })}
            />
          </div>

          {config.rsi.enabled && (
            <div className="space-y-4 border-l-2 border-primary/20 pl-4">
              <div className="space-y-2">
                <Label>RSI Period: {config.rsi.period}</Label>
                <Slider
                  value={[config.rsi.period]}
                  onValueChange={([period]) => updateConfig('rsi', { period })}
                  min={5}
                  max={30}
                  step={1}
                  className="w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Buy Threshold (Oversold): {config.rsi.buyThreshold}</Label>
                  <Slider
                    value={[config.rsi.buyThreshold]}
                    onValueChange={([buyThreshold]) => updateConfig('rsi', { buyThreshold })}
                    min={10}
                    max={50}
                    step={5}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Sell Threshold (Overbought): {config.rsi.sellThreshold}</Label>
                  <Slider
                    value={[config.rsi.sellThreshold]}
                    onValueChange={([sellThreshold]) => updateConfig('rsi', { sellThreshold })}
                    min={50}
                    max={90}
                    step={5}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* MACD Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            MACD (Moving Average Convergence Divergence)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <TooltipField description="MACD shows trend changes and momentum. Buy when MACD crosses above signal line, sell when it crosses below.">
              <Label htmlFor="macd-enabled">Enable MACD</Label>
            </TooltipField>
            <Switch
              id="macd-enabled"
              checked={config.macd.enabled}
              onCheckedChange={(enabled) => updateConfig('macd', { enabled })}
            />
          </div>

          {config.macd.enabled && (
            <div className="space-y-4 border-l-2 border-primary/20 pl-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Fast EMA: {config.macd.fast}</Label>
                  <Slider
                    value={[config.macd.fast]}
                    onValueChange={([fast]) => updateConfig('macd', { fast })}
                    min={5}
                    max={20}
                    step={1}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Slow EMA: {config.macd.slow}</Label>
                  <Slider
                    value={[config.macd.slow]}
                    onValueChange={([slow]) => updateConfig('macd', { slow })}
                    min={20}
                    max={40}
                    step={1}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Signal Line: {config.macd.signal}</Label>
                  <Slider
                    value={[config.macd.signal]}
                    onValueChange={([signal]) => updateConfig('macd', { signal })}
                    min={5}
                    max={15}
                    step={1}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* EMA Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            EMA (Exponential Moving Average)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <TooltipField description="EMA crossover strategy: Buy when short EMA crosses above long EMA, sell when it crosses below.">
              <Label htmlFor="ema-enabled">Enable EMA</Label>
            </TooltipField>
            <Switch
              id="ema-enabled"
              checked={config.ema.enabled}
              onCheckedChange={(enabled) => updateConfig('ema', { enabled })}
            />
          </div>

          {config.ema.enabled && (
            <div className="space-y-4 border-l-2 border-primary/20 pl-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Short Period: {config.ema.shortPeriod}</Label>
                  <Slider
                    value={[config.ema.shortPeriod]}
                    onValueChange={([shortPeriod]) => updateConfig('ema', { shortPeriod })}
                    min={5}
                    max={20}
                    step={1}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Long Period: {config.ema.longPeriod}</Label>
                  <Slider
                    value={[config.ema.longPeriod]}
                    onValueChange={([longPeriod]) => updateConfig('ema', { longPeriod })}
                    min={20}
                    max={50}
                    step={1}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SMA Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            SMA (Simple Moving Average)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <TooltipField description="SMA smooths price action. Buy when price is above SMA, sell when below.">
              <Label htmlFor="sma-enabled">Enable SMA</Label>
            </TooltipField>
            <Switch
              id="sma-enabled"
              checked={config.sma.enabled}
              onCheckedChange={(enabled) => updateConfig('sma', { enabled })}
            />
          </div>

          {config.sma.enabled && (
            <div className="space-y-4 border-l-2 border-primary/20 pl-4">
              <div className="space-y-2">
                <Label>SMA Period: {config.sma.period}</Label>
                <Slider
                  value={[config.sma.period]}
                  onValueChange={([period]) => updateConfig('sma', { period })}
                  min={10}
                  max={50}
                  step={1}
                  className="w-full"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Moving Average Crossover Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Moving Average Crossover
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <TooltipField description="MA crossover generates buy/sell signals when short MA crosses above/below long MA. Threshold prevents noise trades.">
              <Label htmlFor="ma-crossover-enabled">Enable MA Crossover</Label>
            </TooltipField>
            <Switch
              id="ma-crossover-enabled"
              checked={config.maCrossover.enabled}
              onCheckedChange={(enabled) => updateConfig('maCrossover', { enabled })}
            />
          </div>

          {config.maCrossover.enabled && (
            <div className="space-y-4 border-l-2 border-primary/20 pl-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Short MA Period: {config.maCrossover.shortPeriod}</Label>
                  <Slider
                    value={[config.maCrossover.shortPeriod]}
                    onValueChange={([shortPeriod]) => updateConfig('maCrossover', { shortPeriod })}
                    min={3}
                    max={15}
                    step={1}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Long MA Period: {config.maCrossover.longPeriod}</Label>
                  <Slider
                    value={[config.maCrossover.longPeriod]}
                    onValueChange={([longPeriod]) => updateConfig('maCrossover', { longPeriod })}
                    min={5}
                    max={25}
                    step={1}
                    className="w-full"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Min Divergence Threshold: {config.maCrossover.minDivergenceThreshold}%</Label>
                  <Slider
                    value={[config.maCrossover.minDivergenceThreshold]}
                    onValueChange={([minDivergenceThreshold]) => updateConfig('maCrossover', { minDivergenceThreshold })}
                    min={0.1}
                    max={2.0}
                    step={0.1}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Strength Multiplier: {config.maCrossover.strengthMultiplier}</Label>
                  <Slider
                    value={[config.maCrossover.strengthMultiplier]}
                    onValueChange={([strengthMultiplier]) => updateConfig('maCrossover', { strengthMultiplier })}
                    min={5}
                    max={50}
                    step={5}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bollinger Bands Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Bollinger Bands
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <TooltipField description="Bollinger Bands show volatility. Buy near lower band, sell near upper band.">
              <Label htmlFor="bollinger-enabled">Enable Bollinger Bands</Label>
            </TooltipField>
            <Switch
              id="bollinger-enabled"
              checked={config.bollinger.enabled}
              onCheckedChange={(enabled) => updateConfig('bollinger', { enabled })}
            />
          </div>

          {config.bollinger.enabled && (
            <div className="space-y-4 border-l-2 border-primary/20 pl-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Period: {config.bollinger.period}</Label>
                  <Slider
                    value={[config.bollinger.period]}
                    onValueChange={([period]) => updateConfig('bollinger', { period })}
                    min={10}
                    max={30}
                    step={1}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Standard Deviation: {config.bollinger.stdDev}</Label>
                  <Slider
                    value={[config.bollinger.stdDev]}
                    onValueChange={([stdDev]) => updateConfig('bollinger', { stdDev })}
                    min={1}
                    max={3}
                    step={0.1}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ADX Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            ADX (Average Directional Index)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <TooltipField description="ADX measures trend strength. Values above 25 indicate strong trend, below 20 indicates weak trend.">
              <Label htmlFor="adx-enabled">Enable ADX</Label>
            </TooltipField>
            <Switch
              id="adx-enabled"
              checked={config.adx.enabled}
              onCheckedChange={(enabled) => updateConfig('adx', { enabled })}
            />
          </div>

          {config.adx.enabled && (
            <div className="space-y-4 border-l-2 border-primary/20 pl-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Period: {config.adx.period}</Label>
                  <Slider
                    value={[config.adx.period]}
                    onValueChange={([period]) => updateConfig('adx', { period })}
                    min={10}
                    max={20}
                    step={1}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Trend Threshold: {config.adx.threshold}</Label>
                  <Slider
                    value={[config.adx.threshold]}
                    onValueChange={([threshold]) => updateConfig('adx', { threshold })}
                    min={15}
                    max={35}
                    step={5}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stochastic RSI Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Stochastic RSI
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <TooltipField description="Stochastic RSI combines Stochastic and RSI. More sensitive than regular RSI for early signals.">
              <Label htmlFor="stoch-rsi-enabled">Enable Stochastic RSI</Label>
            </TooltipField>
            <Switch
              id="stoch-rsi-enabled"
              checked={config.stochasticRSI.enabled}
              onCheckedChange={(enabled) => updateConfig('stochasticRSI', { enabled })}
            />
          </div>

          {config.stochasticRSI.enabled && (
            <div className="space-y-4 border-l-2 border-primary/20 pl-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>RSI Period: {config.stochasticRSI.rsiPeriod}</Label>
                  <Slider
                    value={[config.stochasticRSI.rsiPeriod]}
                    onValueChange={([rsiPeriod]) => updateConfig('stochasticRSI', { rsiPeriod })}
                    min={10}
                    max={20}
                    step={1}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Stoch Period: {config.stochasticRSI.stochPeriod}</Label>
                  <Slider
                    value={[config.stochasticRSI.stochPeriod]}
                    onValueChange={([stochPeriod]) => updateConfig('stochasticRSI', { stochPeriod })}
                    min={10}
                    max={20}
                    step={1}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label>%K Period: {config.stochasticRSI.kPeriod}</Label>
                  <Slider
                    value={[config.stochasticRSI.kPeriod]}
                    onValueChange={([kPeriod]) => updateConfig('stochasticRSI', { kPeriod })}
                    min={2}
                    max={5}
                    step={1}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label>%D Period: {config.stochasticRSI.dPeriod}</Label>
                  <Slider
                    value={[config.stochasticRSI.dPeriod]}
                    onValueChange={([dPeriod]) => updateConfig('stochasticRSI', { dPeriod })}
                    min={2}
                    max={5}
                    step={1}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};