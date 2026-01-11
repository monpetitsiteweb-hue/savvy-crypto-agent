import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Clock, TrendingDown, Brain, Repeat, DollarSign } from 'lucide-react';

/**
 * Static list of deprecated fields - these are NOT part of form state
 * and exist only for transparency. They have no effect on trading behavior.
 */
export const DEPRECATED_FIELDS = {
  orderTypes: {
    title: 'Order Types',
    icon: Clock,
    fields: [
      { key: 'buyOrderType', label: 'Buy Order Type', type: 'select', options: ['market', 'limit', 'trailing_buy'], defaultValue: 'market' },
      { key: 'sellOrderType', label: 'Sell Order Type', type: 'select', options: ['market', 'limit', 'trailing_stop', 'auto_close'], defaultValue: 'market' },
      { key: 'trailingBuyPercentage', label: 'Trailing Buy %', type: 'number', defaultValue: 1.0 },
    ]
  },
  dca: {
    title: 'DCA Settings',
    icon: Repeat,
    fields: [
      { key: 'enableDCA', label: 'Enable DCA', type: 'boolean', defaultValue: false },
      { key: 'dcaIntervalHours', label: 'DCA Interval (hours)', type: 'number', defaultValue: 24 },
      { key: 'dcaSteps', label: 'DCA Steps', type: 'number', defaultValue: 3 },
    ]
  },
  shorting: {
    title: 'Shorting Settings',
    icon: TrendingDown,
    fields: [
      { key: 'enableShorting', label: 'Enable Shorting', type: 'boolean', defaultValue: false },
      { key: 'maxShortPositions', label: 'Max Short Positions', type: 'number', defaultValue: 2 },
      { key: 'shortingMinProfitPercentage', label: 'Shorting Min Profit %', type: 'number', defaultValue: 2.0 },
      { key: 'autoCloseShorts', label: 'Auto Close Shorts', type: 'boolean', defaultValue: true },
    ]
  },
  legacyAI: {
    title: 'Legacy AI Settings',
    icon: Brain,
    fields: [
      { key: 'learningRate', label: 'Learning Rate', type: 'number', defaultValue: 0.01 },
      { key: 'patternRecognition', label: 'Pattern Recognition', type: 'boolean', defaultValue: false },
      { key: 'sentimentWeight', label: 'Sentiment Weight', type: 'number', defaultValue: 0.15 },
      { key: 'whaleWeight', label: 'Whale Weight', type: 'number', defaultValue: 0.15 },
    ]
  },
  tradingLimits: {
    title: 'Legacy Trading Limits',
    icon: DollarSign,
    fields: [
      { key: 'dailyProfitTarget', label: 'Daily Profit Target (€)', type: 'number', defaultValue: 100 },
      { key: 'maxTradesPerDay', label: 'Max Trades Per Day', type: 'number', defaultValue: 10 },
      { key: 'maxTotalTrades', label: 'Max Total Trades', type: 'number', defaultValue: 100 },
      { key: 'tradeCooldownMinutes', label: 'Trade Cooldown (min)', type: 'number', defaultValue: 5 },
      { key: 'autoCloseAfterHours', label: 'Auto Close After (hours)', type: 'number', defaultValue: 24 },
    ]
  },
  buyScheduling: {
    title: 'Buy Scheduling (Legacy)',
    icon: Clock,
    fields: [
      { key: 'buyFrequency', label: 'Buy Frequency', type: 'select', options: ['once', 'daily', 'interval', 'signal_based'], defaultValue: 'signal_based' },
      { key: 'buyIntervalMinutes', label: 'Buy Interval (min)', type: 'number', defaultValue: 60 },
      { key: 'buyCooldownMinutes', label: 'Buy Cooldown (min)', type: 'number', defaultValue: 5 },
    ]
  },
  advanced: {
    title: 'Advanced Legacy Settings',
    icon: AlertTriangle,
    fields: [
      { key: 'resetStopLossAfterFail', label: 'Reset SL After Fail', type: 'boolean', defaultValue: false },
      { key: 'useTrailingStopOnly', label: 'Use Trailing Stop Only', type: 'boolean', defaultValue: false },
      { key: 'backtestingMode', label: 'Backtesting Mode', type: 'boolean', defaultValue: false },
    ]
  }
} as const;

interface DeprecatedFieldsPanelProps {
  className?: string;
}

const InactiveBadge = () => (
  <Badge variant="outline" className="text-xs bg-muted text-muted-foreground border-muted-foreground/30">
    Inactive
  </Badge>
);

const DeprecatedFieldGroup: React.FC<{
  title: string;
  icon: React.ElementType;
  fields: readonly { key: string; label: string; type: string; defaultValue: any; options?: readonly string[] }[];
}> = ({ title, icon: Icon, fields }) => (
  <Card className="bg-muted/30 border-muted">
    <CardHeader className="py-3 px-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </div>
    </CardHeader>
    <CardContent className="px-4 pb-4 space-y-3">
      {fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">{field.label}</Label>
            <InactiveBadge />
          </div>
          
          {field.type === 'boolean' ? (
            <Switch disabled checked={field.defaultValue} className="opacity-50" />
          ) : field.type === 'select' && field.options ? (
            <Select disabled value={field.defaultValue}>
              <SelectTrigger className="h-8 text-xs opacity-50 cursor-not-allowed">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {field.options.map((opt) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input 
              type="number" 
              disabled 
              value={field.defaultValue} 
              className="h-8 text-xs opacity-50 cursor-not-allowed"
            />
          )}
          
          <p className="text-[10px] text-muted-foreground/70 italic">
            This setting is not used by the current trading engine.
          </p>
        </div>
      ))}
    </CardContent>
  </Card>
);

export const DeprecatedFieldsPanel: React.FC<DeprecatedFieldsPanelProps> = ({ className }) => {
  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <CardTitle>Deprecated / Inactive Features</CardTitle>
          </div>
          <CardDescription>
            These settings exist for transparency but are <strong>not used</strong> by the current trading engine. 
            Changing them has no effect on trading behavior.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(DEPRECATED_FIELDS).map(([key, group]) => (
            <DeprecatedFieldGroup 
              key={key}
              title={group.title}
              icon={group.icon}
              fields={group.fields}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default DeprecatedFieldsPanel;
