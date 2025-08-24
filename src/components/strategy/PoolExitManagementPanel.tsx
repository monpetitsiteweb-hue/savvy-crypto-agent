import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Target, TrendingUp, Settings } from 'lucide-react';

const TooltipField = ({ 
  children, 
  description, 
  examples 
}: { 
  children: React.ReactNode; 
  description: string;
  examples?: string[];
}) => (
  <div className="group relative">
    {children}
    <div className="invisible group-hover:visible absolute z-10 w-64 p-2 mt-1 text-sm bg-popover border rounded-md shadow-lg">
      <p className="font-medium">{description}</p>
      {examples && (
        <div className="mt-1 text-xs text-muted-foreground">
          Examples: {examples.join(', ')}
        </div>
      )}
    </div>
  </div>
);

interface PoolExitManagementPanelProps {
  formData: any;
  updateFormData: (field: string, value: any) => void;
}

export const PoolExitManagementPanel = ({ formData, updateFormData }: PoolExitManagementPanelProps) => {
  const poolConfig = formData.poolExitConfig;

  const updatePoolConfig = (field: string, value: any) => {
    updateFormData('poolExitConfig', {
      ...poolConfig,
      [field]: value
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 mb-4">
        <Shield className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Pool Exit Management</h3>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Pool Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Pool Enable Toggle */}
          <div className="flex items-center justify-between">
            <TooltipField 
              description="Enable pool-based exit management. All positions of the same coin are treated as one pool with split exit strategies."
              examples={["Aggregate BTC positions", "Split exits: secure + runner", "Pro-rata allocation"]}
            >
              <Label htmlFor="pool-enabled">Enable Pool Exit Management</Label>
            </TooltipField>
            <Switch
              id="pool-enabled"
              checked={poolConfig.pool_enabled}
              onCheckedChange={(value) => updatePoolConfig('pool_enabled', value)}
            />
          </div>

          {poolConfig.pool_enabled && (
            <>
              {/* Secure Portion Settings */}
              <Card className="border-l-4 border-l-green-500">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Target className="h-4 w-4 text-green-500" />
                    Secure Portion (Lock in Profits)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <TooltipField 
                      description="Percentage of total pool to secure at fixed take-profit. This portion closes once profit target is hit."
                      examples={["40% = secure 40% of pool", "60% = secure majority", "20% = keep most running"]}
                    >
                      <Label>Secure Portion: {(poolConfig.secure_pct * 100).toFixed(0)}%</Label>
                    </TooltipField>
                    <Slider
                      min={10}
                      max={90}
                      step={5}
                      value={[poolConfig.secure_pct * 100]}
                      onValueChange={(value) => updatePoolConfig('secure_pct', value[0] / 100)}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>10%</span>
                      <span>90%</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <TooltipField 
                      description="Profit percentage at which to close the secure portion. This locks in guaranteed daily gains."
                      examples={["0.7% = close at +0.7% profit", "1.0% = target 1% gain", "0.5% = quick secure"]}
                    >
                      <Label>Secure Take-Profit: {poolConfig.secure_tp_pct.toFixed(1)}%</Label>
                    </TooltipField>
                    <Slider
                      min={0.1}
                      max={3.0}
                      step={0.1}
                      value={[poolConfig.secure_tp_pct]}
                      onValueChange={(value) => updatePoolConfig('secure_tp_pct', value[0])}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0.1%</span>
                      <span>3.0%</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <TooltipField 
                      description="Optional stop-loss for secure portion until take-profit is reached. Leave empty to disable."
                      examples={["0.6% = -0.6% stop until TP", "Empty = no stop loss", "1.0% = wider stop"]}
                    >
                      <Label>Secure Stop-Loss (Optional): {poolConfig.secure_sl_pct ? poolConfig.secure_sl_pct.toFixed(1) + '%' : 'Disabled'}</Label>
                    </TooltipField>
                    <div className="flex items-center space-x-2">
                      <Input
                        type="number"
                        placeholder="0.6"
                        step="0.1"
                        min="0.1"
                        max="5.0"
                        value={poolConfig.secure_sl_pct || ''}
                        onChange={(e) => updatePoolConfig('secure_sl_pct', e.target.value ? parseFloat(e.target.value) : undefined)}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">% (empty to disable)</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Runner Portion Settings */}
              <Card className="border-l-4 border-l-blue-500">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="h-4 w-4 text-blue-500" />
                    Runner Portion (Trailing Strategy)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <TooltipField 
                      description="Profit percentage required before trailing stop activates for runner portion. Prevents premature exits."
                      examples={["0.5% = arm after +0.5% profit", "1.0% = wait for more profit", "0.2% = aggressive arming"]}
                    >
                      <Label>Arm Trailing At: {poolConfig.runner_arm_pct.toFixed(1)}%</Label>
                    </TooltipField>
                    <Slider
                      min={0.1}
                      max={2.0}
                      step={0.1}
                      value={[poolConfig.runner_arm_pct]}
                      onValueChange={(value) => updatePoolConfig('runner_arm_pct', value[0])}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0.1%</span>
                      <span>2.0%</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <TooltipField 
                      description="Trailing stop distance. Stop moves up as price rises but never down. Triggers when price drops by this amount from peak."
                      examples={["1.0% = 1% trailing distance", "2.0% = wider trail", "0.5% = tight trail"]}
                    >
                      <Label>Trailing Distance: {poolConfig.runner_trail_pct.toFixed(1)}%</Label>
                    </TooltipField>
                    <Slider
                      min={0.2}
                      max={5.0}
                      step={0.1}
                      value={[poolConfig.runner_trail_pct]}
                      onValueChange={(value) => updatePoolConfig('runner_trail_pct', value[0])}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>0.2%</span>
                      <span>5.0%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Trading Parameters */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Trading Parameters</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <TooltipField 
                      description="Minimum quantity precision for orders. Depends on the exchange and trading pair."
                      examples={["0.00000001 for BTC", "0.000001 for ETH", "0.01 for large coins"]}
                    >
                      <Label>Quantity Tick Size</Label>
                    </TooltipField>
                    <Input
                      type="number"
                      step="0.00000001"
                      min="0.00000001"
                      value={poolConfig.qty_tick}
                      onChange={(e) => updatePoolConfig('qty_tick', parseFloat(e.target.value))}
                    />
                  </div>

                  <div className="space-y-2">
                    <TooltipField 
                      description="Minimum price precision for orders. Usually 0.01 for EUR pairs."
                      examples={["0.01 for EUR pairs", "0.001 for USD pairs", "0.0001 for high precision"]}
                    >
                      <Label>Price Tick Size</Label>
                    </TooltipField>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.0001"
                      value={poolConfig.price_tick}
                      onChange={(e) => updatePoolConfig('price_tick', parseFloat(e.target.value))}
                    />
                  </div>

                  <div className="space-y-2">
                    <TooltipField 
                      description="Minimum order value in EUR. Exchange minimum to place valid orders."
                      examples={["10 EUR minimum", "25 EUR for some pairs", "5 EUR for small orders"]}
                    >
                      <Label>Min Order Value (EUR)</Label>
                    </TooltipField>
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      value={poolConfig.min_order_notional}
                      onChange={(e) => updatePoolConfig('min_order_notional', parseFloat(e.target.value))}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Information Panel */}
              <div className="bg-muted p-4 rounded-lg">
                <h4 className="font-medium mb-2">How Pool Exit Management Works:</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• All positions of the same coin are aggregated into one pool</li>
                  <li>• <span className="text-green-600 font-medium">{(poolConfig.secure_pct * 100).toFixed(0)}%</span> closes at <span className="text-green-600 font-medium">+{poolConfig.secure_tp_pct.toFixed(1)}%</span> profit to lock in gains</li>
                  <li>• <span className="text-blue-600 font-medium">{((1 - poolConfig.secure_pct) * 100).toFixed(0)}%</span> uses trailing stop (arms at <span className="text-blue-600 font-medium">+{poolConfig.runner_arm_pct.toFixed(1)}%</span>, trails by <span className="text-blue-600 font-medium">{poolConfig.runner_trail_pct.toFixed(1)}%</span>)</li>
                  <li>• Exits are allocated proportionally back to underlying trades</li>
                  <li>• Per-symbol mutex prevents conflicting orders</li>
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};