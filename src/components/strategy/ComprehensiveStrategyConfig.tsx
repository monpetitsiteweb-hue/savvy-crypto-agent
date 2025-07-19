import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Save, 
  ArrowLeft, 
  Info, 
  Settings, 
  DollarSign, 
  TrendingUp, 
  Shield, 
  AlertTriangle,
  Target,
  Timer,
  BarChart3,
  Coins,
  Activity,
  Eye,
  TestTube
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// Coinbase-compatible coins list (this would ideally be fetched from API)
const COINBASE_COINS = [
  'BTC', 'ETH', 'ADA', 'DOGE', 'XRP', 'LTC', 'BCH', 'LINK', 'DOT', 'UNI',
  'SOL', 'MATIC', 'AVAX', 'ICP', 'XLM', 'VET', 'ALGO', 'ATOM', 'FIL', 'TRX',
  'ETC', 'THETA', 'XMR', 'XTZ', 'COMP', 'AAVE', 'MKR', 'SNX', 'CRV', 'YFI'
];

// Validation schema
const strategySchema = z.object({
  strategyName: z.string().min(1, "Strategy name is required"),
  riskProfile: z.enum(['low', 'medium', 'high', 'custom']),
  maxWalletExposure: z.number().min(1).max(100),
  enableAutoTrading: z.boolean(),
  simulationMode: z.boolean(),
  notes: z.string().optional(),
  selectedCoins: z.array(z.string()).min(1, "Select at least one coin"),
  maxActiveCoins: z.number().min(1),
  enableAutoCoinSelection: z.boolean(),
  buyOrderType: z.enum(['market', 'limit', 'trailing_buy']),
  trailingBuyPercentage: z.number().optional(),
  perTradeAllocation: z.number().min(1),
  allocationUnit: z.enum(['euro', 'percentage']),
  buyFrequency: z.enum(['once', 'daily', 'interval', 'signal_based']),
  buyIntervalMinutes: z.number().optional(),
  buyCooldownMinutes: z.number().min(0),
  sellOrderType: z.enum(['market', 'limit', 'trailing_stop', 'auto_close']),
  takeProfitPercentage: z.number().optional(),
  stopLossPercentage: z.number().min(0.1),
  trailingStopLossPercentage: z.number().optional(),
  autoCloseAfterHours: z.number().optional(),
  maxOpenPositions: z.number().min(1),
  dailyProfitTarget: z.number().optional(),
  dailyLossLimit: z.number().optional(),
  tradeCooldownMinutes: z.number().min(0),
  backtestingMode: z.boolean(),
  enableDCA: z.boolean(),
  dcaIntervalHours: z.number().optional(),
  dcaSteps: z.number().optional(),
}).refine((data) => {
  if (data.buyOrderType === 'trailing_buy' && !data.trailingBuyPercentage) {
    return false;
  }
  if ((data.sellOrderType === 'limit' || data.sellOrderType === 'auto_close') && !data.takeProfitPercentage) {
    return false;
  }
  if (data.sellOrderType === 'trailing_stop' && !data.trailingStopLossPercentage) {
    return false;
  }
  if (data.buyFrequency === 'interval' && !data.buyIntervalMinutes) {
    return false;
  }
  if (data.enableDCA && (!data.dcaIntervalHours || !data.dcaSteps)) {
    return false;
  }
  return true;
}, {
  message: "Please fill all required conditional fields"
});

type StrategyFormData = z.infer<typeof strategySchema>;

interface ComprehensiveStrategyConfigProps {
  onBack: () => void;
  existingStrategy?: any;
  isEditing?: boolean;
}

const RISK_PRESETS = {
  low: {
    stopLossPercentage: 2,
    takeProfitPercentage: 1.5,
    maxOpenPositions: 3,
    maxWalletExposure: 20,
    dcaIntervalHours: 24
  },
  medium: {
    stopLossPercentage: 3,
    takeProfitPercentage: 2.5,
    maxOpenPositions: 5,
    maxWalletExposure: 50,
    dcaIntervalHours: 12
  },
  high: {
    stopLossPercentage: 5,
    takeProfitPercentage: 4,
    maxOpenPositions: 8,
    maxWalletExposure: 80,
    dcaIntervalHours: 6
  }
};

export const ComprehensiveStrategyConfig = ({ 
  onBack, 
  existingStrategy, 
  isEditing = false 
}: ComprehensiveStrategyConfigProps) => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { toast } = useToast();
  
  const form = useForm<StrategyFormData>({
    resolver: zodResolver(strategySchema),
    defaultValues: {
      strategyName: existingStrategy?.strategy_name || '',
      riskProfile: 'medium',
      maxWalletExposure: 50,
      enableAutoTrading: false,
      simulationMode: true,
      notes: '',
      selectedCoins: ['BTC', 'ETH'],
      maxActiveCoins: 5,
      enableAutoCoinSelection: false,
      buyOrderType: 'market',
      perTradeAllocation: 100,
      allocationUnit: 'euro',
      buyFrequency: 'signal_based',
      buyCooldownMinutes: 60,
      sellOrderType: 'limit',
      takeProfitPercentage: 2.5,
      stopLossPercentage: 3,
      maxOpenPositions: 5,
      tradeCooldownMinutes: 30,
      backtestingMode: false,
      enableDCA: false,
      dcaIntervalHours: 12,
      dcaSteps: 3
    }
  });

  const watchedValues = form.watch();

  // Apply risk profile presets
  useEffect(() => {
    if (watchedValues.riskProfile !== 'custom') {
      const preset = RISK_PRESETS[watchedValues.riskProfile as keyof typeof RISK_PRESETS];
      form.setValue('stopLossPercentage', preset.stopLossPercentage);
      form.setValue('takeProfitPercentage', preset.takeProfitPercentage);
      form.setValue('maxOpenPositions', preset.maxOpenPositions);
      form.setValue('maxWalletExposure', preset.maxWalletExposure);
      form.setValue('dcaIntervalHours', preset.dcaIntervalHours);
    }
  }, [watchedValues.riskProfile]);

  // Load existing strategy data
  useEffect(() => {
    if (existingStrategy?.configuration) {
      const config = existingStrategy.configuration;
      Object.keys(config).forEach(key => {
        if (key in form.getValues()) {
          form.setValue(key as keyof StrategyFormData, config[key]);
        }
      });
    }
  }, [existingStrategy]);

  const onSubmit = async (data: StrategyFormData) => {
    if (!user) return;

    try {
      const strategyData = {
        user_id: user.id,
        strategy_name: data.strategyName,
        description: data.notes || null,
        configuration: data,
        test_mode: testMode,
        is_active: false,
        updated_at: new Date().toISOString()
      };

      if (isEditing && existingStrategy) {
        const { error } = await supabase
          .from('trading_strategies')
          .update(strategyData)
          .eq('id', existingStrategy.id)
          .eq('user_id', user.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('trading_strategies')
          .insert(strategyData);

        if (error) throw error;
      }

      toast({
        title: "Strategy saved",
        description: `Your strategy "${data.strategyName}" has been saved successfully.`,
      });
      
      onBack();
    } catch (error) {
      console.error('Error saving strategy:', error);
      toast({
        title: "Error",
        description: "Failed to save strategy. Please try again.",
        variant: "destructive",
      });
    }
  };

  const TooltipField = ({ children, tooltip }: { children: React.ReactNode; tooltip: string }) => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2">
            {children}
            <Info className="h-4 w-4 text-slate-400 hover:text-slate-300 cursor-help" />
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs bg-slate-900 border-slate-700">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  const renderSummary = () => {
    const riskLevel = watchedValues.riskProfile === 'low' ? 'Conservative' : 
                     watchedValues.riskProfile === 'medium' ? 'Moderate' : 
                     watchedValues.riskProfile === 'high' ? 'Aggressive' : 'Custom';
    
    const selectedCoinsCount = watchedValues.selectedCoins?.length || 0;
    
    return (
      <Card className="p-6 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Strategy Summary
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-slate-400">Name:</span>
            <span className="ml-2 text-white font-medium">{watchedValues.strategyName || 'Unnamed Strategy'}</span>
          </div>
          <div>
            <span className="text-slate-400">Risk Level:</span>
            <span className="ml-2 text-white font-medium">{riskLevel}</span>
          </div>
          <div>
            <span className="text-slate-400">Coins:</span>
            <span className="ml-2 text-white font-medium">{selectedCoinsCount} selected</span>
          </div>
          <div>
            <span className="text-slate-400">Wallet Exposure:</span>
            <span className="ml-2 text-white font-medium">{watchedValues.maxWalletExposure}%</span>
          </div>
          <div>
            <span className="text-slate-400">Take Profit:</span>
            <span className="ml-2 text-green-400 font-medium">{watchedValues.takeProfitPercentage}%</span>
          </div>
          <div>
            <span className="text-slate-400">Stop Loss:</span>
            <span className="ml-2 text-red-400 font-medium">{watchedValues.stopLossPercentage}%</span>
          </div>
          <div>
            <span className="text-slate-400">Mode:</span>
            <span className="ml-2 text-white font-medium">
              {watchedValues.simulationMode ? 'Simulation' : 'Live Trading'}
              {watchedValues.backtestingMode && ' + Backtest'}
            </span>
          </div>
          <div>
            <span className="text-slate-400">DCA:</span>
            <span className="ml-2 text-white font-medium">
              {watchedValues.enableDCA ? `Every ${watchedValues.dcaIntervalHours}h` : 'Disabled'}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Frequency:</span>
            <span className="ml-2 text-white font-medium">
              {watchedValues.buyFrequency === 'signal_based' ? 'Signal-based' : 
               watchedValues.buyFrequency === 'daily' ? 'Daily' : 
               watchedValues.buyFrequency === 'interval' ? `Every ${watchedValues.buyIntervalMinutes}min` : 'Once'}
            </span>
          </div>
        </div>
        
        {/* Logic explanation */}
        <div className="mt-4 p-3 bg-slate-800/50 rounded-lg border border-slate-600">
          <p className="text-xs text-slate-300">
            <strong>Strategy Logic:</strong> {riskLevel} approach with {watchedValues.sellOrderType === 'trailing_stop' ? 'trailing stops to let gains run while protecting profits' : 'fixed targets for consistent gains'}. 
            {watchedValues.enableDCA && ' Dollar-cost averaging enabled to reduce timing risk.'} 
            {watchedValues.enableAutoCoinSelection && ' Auto-coin selection will adapt to market conditions.'}
          </p>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="text-slate-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Overview
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-white">
              {isEditing ? 'Edit Strategy' : 'Create Strategy'}
            </h2>
            <p className="text-slate-400">Configure your comprehensive trading strategy</p>
          </div>
        </div>
        {testMode && (
          <Badge variant="secondary" className="bg-orange-500/20 text-orange-400 border-orange-500/30">
            <TestTube className="h-3 w-3 mr-1" />
            Test Mode
          </Badge>
        )}
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          
          {/* General Strategy Settings */}
          <Card className="p-6 bg-slate-800/50 border-slate-700">
            <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
              <Settings className="h-5 w-5" />
              🧱 General Strategy Settings
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="strategyName"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="Name your strategy for easy reference and identification">
                      <FormLabel className="text-white">Strategy Name</FormLabel>
                    </TooltipField>
                    <FormControl>
                      <Input {...field} placeholder="My Trading Strategy" className="bg-slate-700 border-slate-600" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="riskProfile"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="Choose a risk level; presets will be applied for stop-loss, take-profit, and max positions, or customize manually">
                      <FormLabel className="text-white">Risk Profile</FormLabel>
                    </TooltipField>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-slate-700 border-slate-600">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="low">Low (Conservative)</SelectItem>
                        <SelectItem value="medium">Medium (Balanced)</SelectItem>
                        <SelectItem value="high">High (Aggressive)</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="maxWalletExposure"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="Percentage of your wallet this strategy can use - caps total capital allocated to this strategy">
                      <FormLabel className="text-white">Max Wallet Exposure (%)</FormLabel>
                    </TooltipField>
                    <FormControl>
                      <div className="space-y-2">
                        <Slider
                          min={1}
                          max={100}
                          step={1}
                          value={[field.value || 50]}
                          onValueChange={(value) => field.onChange(value[0])}
                          className="w-full"
                        />
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>1%</span>
                          <span className="text-white font-medium">{field.value}%</span>
                          <span>100%</span>
                        </div>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="enableAutoTrading"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border border-slate-600 p-4">
                      <div className="space-y-0.5">
                        <TooltipField tooltip="When ON, live orders are placed using real funds - enables or disables live execution">
                          <FormLabel className="text-white">Enable Auto-Trading</FormLabel>
                        </TooltipField>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="simulationMode"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border border-slate-600 p-4">
                      <div className="space-y-0.5">
                        <TooltipField tooltip="Use virtual balance for backtesting or demo trading - prevents real trades and uses sandbox">
                          <FormLabel className="text-white">Simulation Mode</FormLabel>
                        </TooltipField>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem className="mt-6">
                  <TooltipField tooltip="Optional: Describe your strategy goals, logic, or any important notes">
                    <FormLabel className="text-white">Notes</FormLabel>
                  </TooltipField>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      placeholder="Describe your strategy goals or logic..."
                      className="bg-slate-700 border-slate-600 min-h-[80px]"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </Card>

          {/* Coins & Assets */}
          <Card className="p-6 bg-slate-800/50 border-slate-700">
            <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
              <Coins className="h-5 w-5" />
              🪙 Coins & Assets
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="selectedCoins"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="Pick from coins available in your Coinbase account - limits tradable assets to selected ones">
                      <FormLabel className="text-white">Select Coins</FormLabel>
                    </TooltipField>
                    <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 border border-slate-600 rounded-lg bg-slate-700/30">
                      {COINBASE_COINS.map((coin) => (
                        <div key={coin} className="flex items-center space-x-2">
                          <Checkbox
                            checked={field.value?.includes(coin)}
                            onCheckedChange={(checked) => {
                              const current = field.value || [];
                              if (checked) {
                                field.onChange([...current, coin]);
                              } else {
                                field.onChange(current.filter(c => c !== coin));
                              }
                            }}
                          />
                          <label className="text-xs text-white">{coin}</label>
                        </div>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="maxActiveCoins"
                  render={({ field }) => (
                    <FormItem>
                      <TooltipField tooltip="Max number of different coins to trade at once - controls diversification and risk exposure">
                        <FormLabel className="text-white">Max Active Coins</FormLabel>
                      </TooltipField>
                      <FormControl>
                        <Input 
                          type="number" 
                          min={1} 
                          max={20}
                          {...field} 
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          className="bg-slate-700 border-slate-600" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="enableAutoCoinSelection"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border border-slate-600 p-4">
                      <div className="space-y-0.5">
                        <TooltipField tooltip="Allow the system to auto-select top liquid or trending coins - overrides manual coin list when ON">
                          <FormLabel className="text-white">Enable Auto-Coin Selection</FormLabel>
                        </TooltipField>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </Card>

          {/* Buy Configuration */}
          <Card className="p-6 bg-slate-800/50 border-slate-700">
            <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-400" />
              📈 Buy Configuration
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="buyOrderType"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="Choose how buy orders are placed - market for immediate execution, limit for specific price, trailing for dip-buying">
                      <FormLabel className="text-white">Buy Order Type</FormLabel>
                    </TooltipField>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-slate-700 border-slate-600">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="market">Market</SelectItem>
                        <SelectItem value="limit">Limit</SelectItem>
                        <SelectItem value="trailing_buy">Trailing Buy</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchedValues.buyOrderType === 'trailing_buy' && (
                <FormField
                  control={form.control}
                  name="trailingBuyPercentage"
                  render={({ field }) => (
                    <FormItem>
                      <TooltipField tooltip="Buy when price dips by this percentage - automates dip-entry strategy">
                        <FormLabel className="text-white">Trailing Buy (%)</FormLabel>
                      </TooltipField>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.1" 
                          min="0.1"
                          {...field} 
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          className="bg-slate-700 border-slate-600" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="perTradeAllocation"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="Amount invested per trade - determines trade size and risk exposure">
                      <FormLabel className="text-white">Per-Trade Allocation</FormLabel>
                    </TooltipField>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input 
                          type="number" 
                          min="1"
                          {...field} 
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          className="bg-slate-700 border-slate-600" 
                        />
                      </FormControl>
                      <FormField
                        control={form.control}
                        name="allocationUnit"
                        render={({ field: unitField }) => (
                          <Select onValueChange={unitField.onChange} defaultValue={unitField.value}>
                            <SelectTrigger className="w-24 bg-slate-700 border-slate-600">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-slate-700">
                              <SelectItem value="euro">€</SelectItem>
                              <SelectItem value="percentage">%</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="buyFrequency"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="How often to execute buy orders - controls activity level and momentum capture">
                      <FormLabel className="text-white">Buy Frequency</FormLabel>
                    </TooltipField>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-slate-700 border-slate-600">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="once">Once</SelectItem>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="interval">Every X minutes</SelectItem>
                        <SelectItem value="signal_based">Signal-based</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchedValues.buyFrequency === 'interval' && (
                <FormField
                  control={form.control}
                  name="buyIntervalMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <TooltipField tooltip="Minutes between automated buy orders when using interval frequency">
                        <FormLabel className="text-white">Buy Interval (minutes)</FormLabel>
                      </TooltipField>
                      <FormControl>
                        <Input 
                          type="number" 
                          min="1"
                          {...field} 
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          className="bg-slate-700 border-slate-600" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="buyCooldownMinutes"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="Wait time after a buy before next buy - throttles trading frequency to prevent overtrading">
                      <FormLabel className="text-white">Buy Cooldown (minutes)</FormLabel>
                    </TooltipField>
                    <FormControl>
                      <Input 
                        type="number" 
                        min="0"
                        {...field} 
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        className="bg-slate-700 border-slate-600" 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </Card>

          {/* Sell Configuration */}
          <Card className="p-6 bg-slate-800/50 border-slate-700">
            <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-red-400" />
              💰 Sell Configuration
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="sellOrderType"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="Choose how positions are exited - market for immediate, limit for target price, trailing stop for profit protection">
                      <FormLabel className="text-white">Sell Order Type</FormLabel>
                    </TooltipField>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-slate-700 border-slate-600">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="market">Market</SelectItem>
                        <SelectItem value="limit">Limit</SelectItem>
                        <SelectItem value="trailing_stop">Trailing Stop</SelectItem>
                        <SelectItem value="auto_close">Auto-Close</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {(watchedValues.sellOrderType === 'limit' || watchedValues.sellOrderType === 'auto_close') && (
                <FormField
                  control={form.control}
                  name="takeProfitPercentage"
                  render={({ field }) => (
                    <FormItem>
                      <TooltipField tooltip="Target gain before selling - locks in gains at predetermined profit level">
                        <FormLabel className="text-white">Take-Profit (%)</FormLabel>
                      </TooltipField>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.1" 
                          min="0.1"
                          {...field} 
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          className="bg-slate-700 border-slate-600" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="stopLossPercentage"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="Max acceptable loss before exit - capital preservation mechanism to limit downside">
                      <FormLabel className="text-white">Stop-Loss (%)</FormLabel>
                    </TooltipField>
                    <FormControl>
                      <Input 
                        type="number" 
                        step="0.1" 
                        min="0.1"
                        {...field} 
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        className="bg-slate-700 border-slate-600" 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchedValues.sellOrderType === 'trailing_stop' && (
                <FormField
                  control={form.control}
                  name="trailingStopLossPercentage"
                  render={({ field }) => (
                    <FormItem>
                      <TooltipField tooltip="Sell when price drops by this % from peak - protects profits while allowing run-ups">
                        <FormLabel className="text-white">Trailing Stop-Loss (%)</FormLabel>
                      </TooltipField>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.1" 
                          min="0.1"
                          {...field} 
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          className="bg-slate-700 border-slate-600" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {watchedValues.sellOrderType === 'auto_close' && (
                <FormField
                  control={form.control}
                  name="autoCloseAfterHours"
                  render={({ field }) => (
                    <FormItem>
                      <TooltipField tooltip="Force close if position open too long - prevents stale trades and reduces overnight risk">
                        <FormLabel className="text-white">Auto-Close After (hours)</FormLabel>
                      </TooltipField>
                      <FormControl>
                        <Input 
                          type="number" 
                          min="1"
                          {...field} 
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          className="bg-slate-700 border-slate-600" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          </Card>

          {/* Strategy Limits & Controls */}
          <Card className="p-6 bg-slate-800/50 border-slate-700">
            <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
              <Shield className="h-5 w-5" />
              ⚙️ Strategy Limits & Controls
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="maxOpenPositions"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="Max concurrent trades - limits total exposure and helps manage risk concentration">
                      <FormLabel className="text-white">Max Open Positions</FormLabel>
                    </TooltipField>
                    <FormControl>
                      <Input 
                        type="number" 
                        min="1"
                        {...field} 
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        className="bg-slate-700 border-slate-600" 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dailyProfitTarget"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="Stop trading after this profit is reached - locks in daily gains and prevents overtrading">
                      <FormLabel className="text-white">Daily Profit Target (€)</FormLabel>
                    </TooltipField>
                    <FormControl>
                      <Input 
                        type="number" 
                        min="0"
                        {...field} 
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        className="bg-slate-700 border-slate-600" 
                        placeholder="Optional"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dailyLossLimit"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="Halt trading if losses exceed this - safeguard against significant drawdown">
                      <FormLabel className="text-white">Daily Loss Limit (€)</FormLabel>
                    </TooltipField>
                    <FormControl>
                      <Input 
                        type="number" 
                        min="0"
                        {...field} 
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        className="bg-slate-700 border-slate-600" 
                        placeholder="Optional"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tradeCooldownMinutes"
                render={({ field }) => (
                  <FormItem>
                    <TooltipField tooltip="Min wait between trades - slows trading pace and avoids overtrading in volatile conditions">
                      <FormLabel className="text-white">Trade Cooldown (minutes)</FormLabel>
                    </TooltipField>
                    <FormControl>
                      <Input 
                        type="number" 
                        min="0"
                        {...field} 
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        className="bg-slate-700 border-slate-600" 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="backtestingMode"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border border-slate-600 p-4">
                    <div className="space-y-0.5">
                      <TooltipField tooltip="Test strategy on historical data - for research only, no live orders are placed">
                        <FormLabel className="text-white">Backtesting Mode</FormLabel>
                      </TooltipField>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="enableDCA"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border border-slate-600 p-4">
                    <div className="space-y-0.5">
                      <TooltipField tooltip="Enable auto-scaling into positions over time - reduces entry timing risk through averaged cost basis">
                        <FormLabel className="text-white">Dollar-Cost Averaging (DCA)</FormLabel>
                      </TooltipField>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            {/* DCA Settings */}
            {watchedValues.enableDCA && (
              <div className="mt-6 p-4 bg-slate-900/50 rounded-lg border border-slate-600">
                <h4 className="text-md font-medium text-white mb-4">DCA Configuration</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="dcaIntervalHours"
                    render={({ field }) => (
                      <FormItem>
                        <TooltipField tooltip="Hours between DCA purchases - frequency of additional position scaling">
                          <FormLabel className="text-white">DCA Interval (hours)</FormLabel>
                        </TooltipField>
                        <FormControl>
                          <Input 
                            type="number" 
                            min="1"
                            {...field} 
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            className="bg-slate-700 border-slate-600" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="dcaSteps"
                    render={({ field }) => (
                      <FormItem>
                        <TooltipField tooltip="Number of DCA steps to execute - total number of scaled entries">
                          <FormLabel className="text-white">DCA Steps</FormLabel>
                        </TooltipField>
                        <FormControl>
                          <Input 
                            type="number" 
                            min="2" 
                            max="10"
                            {...field} 
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            className="bg-slate-700 border-slate-600" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}
          </Card>

          {/* Summary Panel */}
          {renderSummary()}

          {/* Action Buttons */}
          <div className="flex justify-end gap-4">
            <Button 
              type="button" 
              variant="outline" 
              onClick={onBack}
              className="border-slate-600 text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </Button>
            <Button 
              type="submit"
              className="bg-cyan-500 hover:bg-cyan-600 text-white"
            >
              <Save className="h-4 w-4 mr-2" />
              {isEditing ? 'Update Strategy' : 'Save Strategy'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};