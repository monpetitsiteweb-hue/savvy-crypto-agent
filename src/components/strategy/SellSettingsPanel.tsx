import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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

const TooltipField = ({ 
  children, 
  description, 
  examples 
}: { 
  children: React.ReactNode; 
  description: string;
  examples?: string[];
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <div className="flex items-center gap-2">
        {children}
        <Info className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help" />
      </div>
    </TooltipTrigger>
    <TooltipContent className="max-w-sm p-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">{description}</p>
        {examples && examples.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Say:</p>
            <div className="space-y-1">
              {examples.map((example, index) => (
                <p key={index} className="text-xs text-muted-foreground italic">
                  "{example}"
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </TooltipContent>
  </Tooltip>
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
              <TooltipField 
                description="Choose how the strategy should close a trade — instantly, at a target, or using price trailing."
                examples={["Sell at market price", "Use a trailing stop to exit", "Set a profit target"]}
              >
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
              <TooltipField 
                description="Closes the trade after a fixed time, no matter the result."
                examples={["Exit after 6 hours", "Close trades after 1 day", "Don't hold for too long"]}
              >
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
            <TooltipField 
              description="The gain percentage at which the trade should close to secure profits."
              examples={["Take profits at 5%", "Sell once I make 3%", "Close when I hit my target"]}
            >
              <Label>Take Profit Percentage: {formData.takeProfitPercentage}%</Label>
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
            <TooltipField 
              description="Automatically closes a trade when the price drops by this percentage — protects you from big losses."
              examples={["Cut my losses at 2%", "Don't let it drop more than 1.5%", "Add a stop-loss"]}
            >
              <Label>Stop Loss Percentage: {formData.stopLossPercentage}%</Label>
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
                <span>10%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <TooltipField 
                description="Cancel stop loss after a timeout period."
                examples={["Remove stop loss after 2 hours", "Disable timeout protection"]}
              >
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
            <TooltipField 
              description="Tracks price as it rises and closes the trade if it drops by this percentage from the peak."
              examples={["Let the profits ride", "Use a trailing stop of 2%", "Sell if it drops after going up"]}
            >
              <Label>Trailing Stop Percentage: {formData.trailingStopLossPercentage}%</Label>
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
                <span>10%</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField 
              description="Use only trailing stop loss, disable fixed stop loss."
              examples={["Only use trailing stops", "Disable fixed stop loss"]}
            >
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
              <TooltipField 
                description="Maximum number of open positions at the same time."
                examples={["Hold max 5 positions", "Limit to 3 open trades"]}
              >
                <Label>Max Open Positions: {formData.maxOpenPositions}</Label>
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
                  <span>20</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <TooltipField 
                description="Cooldown period between trades to avoid overtrading."
                examples={["Wait 30 minutes between trades", "Cool down for 1 hour"]}
              >
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