import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  TrendingDown, 
  Info,
  Target,
  Shield,
  Timer,
  Zap,
  DollarSign
} from 'lucide-react';

interface SellSettingsPanelProps {
  formData: any;
  updateFormData: (field: string, value: any) => void;
}

const TooltipField = ({ children, tooltip }: { children: React.ReactNode; tooltip: string }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2">
          {children}
          <Info className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help" />
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="text-sm">{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const SellSettingsPanel = ({ formData, updateFormData }: SellSettingsPanelProps) => {
  return (
    <div className="space-y-6">
      {/* Sell Order Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Sell Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <TooltipField tooltip="👁 Type of sell order to execute. Say things like: 'Use market orders for quick sells' or 'Set limit orders for better prices'">
                <Label>Sell Order Type</Label>
              </TooltipField>
              <Select 
                value={formData.sellOrderType} 
                onValueChange={(value) => updateFormData('sellOrderType', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="market">Market Order (Instant)</SelectItem>
                  <SelectItem value="limit">Limit Order (Set Price)</SelectItem>
                  <SelectItem value="trailing_stop">Trailing Stop</SelectItem>
                  <SelectItem value="auto_close">Auto Close</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <TooltipField tooltip="👁 Automatically close positions after this many hours. Say things like: 'Close trades after 24 hours' or 'Hold for maximum 48 hours'">
                <Label>Auto Close After (hours)</Label>
              </TooltipField>
              <Input
                type="number"
                value={formData.autoCloseAfterHours}
                onChange={(e) => updateFormData('autoCloseAfterHours', parseInt(e.target.value) || 24)}
                min={1}
                max={168}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Take Profit Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Take Profit Strategy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <TooltipField tooltip="👁 Percentage gain at which to automatically sell and take profits. Say things like: 'Take profits at 5% gain' or 'Sell when up 3%'">
              <Label>Take Profit Percentage (%)</Label>
            </TooltipField>
            <div className="space-y-2">
              <Slider
                min={0.5}
                max={20}
                step={0.1}
                value={[formData.takeProfitPercentage]}
                onValueChange={(value) => updateFormData('takeProfitPercentage', value[0])}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0.5%</span>
                <span className="font-medium">{formData.takeProfitPercentage}%</span>
                <span>20%</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stop Loss Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Stop Loss Protection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <TooltipField tooltip="👁 Percentage loss at which to automatically sell to limit losses. Say things like: 'Stop loss at 3%' or 'Cut losses at 2% down'">
              <Label>Stop Loss Percentage (%)</Label>
            </TooltipField>
            <div className="space-y-2">
              <Slider
                min={0.5}
                max={10}
                step={0.1}
                value={[formData.stopLossPercentage]}
                onValueChange={(value) => updateFormData('stopLossPercentage', value[0])}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0.5%</span>
                <span className="font-medium">{formData.stopLossPercentage}%</span>
                <span>10%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <TooltipField tooltip="👁 Cancel stop loss after a timeout period. Say things like: 'Remove stop loss after 2 hours' or 'Disable timeout protection'">
                <Label>Stop Loss Timeout</Label>
              </TooltipField>
              <Switch 
                checked={formData.enableStopLossTimeout} 
                onCheckedChange={(value) => updateFormData('enableStopLossTimeout', value)}
              />
            </div>

            {formData.enableStopLossTimeout && (
              <div className="space-y-2">
                <Label>Timeout (minutes)</Label>
                <Input
                  type="number"
                  value={formData.stopLossTimeoutMinutes}
                  onChange={(e) => updateFormData('stopLossTimeoutMinutes', parseInt(e.target.value) || 120)}
                  min={1}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Trailing Stop Loss */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Trailing Stop Loss
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <TooltipField tooltip="👁 Dynamic stop loss that follows price upward but stops at a percentage below peak. Say things like: 'Trail stop 2% below peak' or 'Follow price with 1.5% buffer'">
              <Label>Trailing Stop Percentage (%)</Label>
            </TooltipField>
            <div className="space-y-2">
              <Slider
                min={0.5}
                max={10}
                step={0.1}
                value={[formData.trailingStopLossPercentage]}
                onValueChange={(value) => updateFormData('trailingStopLossPercentage', value[0])}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0.5%</span>
                <span className="font-medium">{formData.trailingStopLossPercentage}%</span>
                <span>10%</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="👁 Use only trailing stop loss, disable fixed stop loss. Say things like: 'Only use trailing stops' or 'Disable fixed stop loss'">
              <Label>Use Trailing Stop Only</Label>
            </TooltipField>
            <Switch 
              checked={formData.useTrailingStopOnly} 
              onCheckedChange={(value) => updateFormData('useTrailingStopOnly', value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Position Limits */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Position Management
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <TooltipField tooltip="👁 Maximum number of open positions at the same time. Say things like: 'Hold max 5 positions' or 'Limit to 3 open trades'">
                <Label>Max Open Positions</Label>
              </TooltipField>
              <div className="space-y-2">
                <Slider
                  min={1}
                  max={20}
                  step={1}
                  value={[formData.maxOpenPositions]}
                  onValueChange={(value) => updateFormData('maxOpenPositions', value[0])}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1</span>
                  <span className="font-medium">{formData.maxOpenPositions} positions</span>
                  <span>20</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <TooltipField tooltip="👁 Cooldown period between trades to avoid overtrading. Say things like: 'Wait 30 minutes between trades' or 'Cool down for 1 hour'">
                <Label>Trade Cooldown (minutes)</Label>
              </TooltipField>
              <Input
                type="number"
                value={formData.tradeCooldownMinutes}
                onChange={(e) => updateFormData('tradeCooldownMinutes', parseInt(e.target.value) || 30)}
                min={0}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};