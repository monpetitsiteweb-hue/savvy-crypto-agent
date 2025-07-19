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
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Save, 
  ArrowLeft, 
  Info, 
  Settings, 
  DollarSign, 
  TrendingUp, 
  Shield, 
  BarChart3,
  Coins,
  TestTube
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// Coinbase-compatible coins list
const COINBASE_COINS = [
  'BTC', 'ETH', 'ADA', 'DOGE', 'XRP', 'LTC', 'BCH', 'LINK', 'DOT', 'UNI',
  'SOL', 'MATIC', 'AVAX', 'ICP', 'XLM', 'VET', 'ALGO', 'ATOM', 'FIL', 'TRX',
  'ETC', 'THETA', 'XMR', 'XTZ', 'COMP', 'AAVE', 'MKR', 'SNX', 'CRV', 'YFI'
];

interface StrategyFormData {
  strategyName: string;
  riskProfile: 'low' | 'medium' | 'high' | 'custom';
  maxWalletExposure: number;
  enableAutoTrading: boolean;
  simulationMode: boolean;
  notes: string;
  selectedCoins: string[];
  maxActiveCoins: number;
  enableAutoCoinSelection: boolean;
  buyOrderType: 'market' | 'limit' | 'trailing_buy';
  trailingBuyPercentage: number;
  perTradeAllocation: number;
  allocationUnit: 'euro' | 'percentage';
  buyFrequency: 'once' | 'daily' | 'interval' | 'signal_based';
  buyIntervalMinutes: number;
  buyCooldownMinutes: number;
  sellOrderType: 'market' | 'limit' | 'trailing_stop' | 'auto_close';
  takeProfitPercentage: number;
  stopLossPercentage: number;
  trailingStopLossPercentage: number;
  autoCloseAfterHours: number;
  maxOpenPositions: number;
  dailyProfitTarget: number;
  dailyLossLimit: number;
  tradeCooldownMinutes: number;
  backtestingMode: boolean;
  enableDCA: boolean;
  dcaIntervalHours: number;
  dcaSteps: number;
}

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
  
  const [formData, setFormData] = useState<StrategyFormData>({
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
    trailingBuyPercentage: 1.5,
    perTradeAllocation: 100,
    allocationUnit: 'euro',
    buyFrequency: 'signal_based',
    buyIntervalMinutes: 60,
    buyCooldownMinutes: 60,
    sellOrderType: 'limit',
    takeProfitPercentage: 2.5,
    stopLossPercentage: 3,
    trailingStopLossPercentage: 2,
    autoCloseAfterHours: 24,
    maxOpenPositions: 5,
    dailyProfitTarget: 0,
    dailyLossLimit: 0,
    tradeCooldownMinutes: 30,
    backtestingMode: false,
    enableDCA: false,
    dcaIntervalHours: 12,
    dcaSteps: 3
  });

  // Apply risk profile presets
  useEffect(() => {
    if (formData.riskProfile !== 'custom') {
      const preset = RISK_PRESETS[formData.riskProfile as keyof typeof RISK_PRESETS];
      setFormData(prev => ({
        ...prev,
        stopLossPercentage: preset.stopLossPercentage,
        takeProfitPercentage: preset.takeProfitPercentage,
        maxOpenPositions: preset.maxOpenPositions,
        maxWalletExposure: preset.maxWalletExposure,
        dcaIntervalHours: preset.dcaIntervalHours
      }));
    }
  }, [formData.riskProfile]);

  // Load existing strategy data
  useEffect(() => {
    if (existingStrategy?.configuration) {
      const config = existingStrategy.configuration;
      setFormData(prev => ({ ...prev, ...config }));
    }
  }, [existingStrategy]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      const strategyData = {
        user_id: user.id,
        strategy_name: formData.strategyName,
        description: formData.notes || null,
        configuration: formData as any, // Cast to any to satisfy JSON type
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
        description: `Your strategy "${formData.strategyName}" has been saved successfully.`,
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

  const updateFormData = (field: keyof StrategyFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
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
    const riskLevel = formData.riskProfile === 'low' ? 'Conservative' : 
                     formData.riskProfile === 'medium' ? 'Moderate' : 
                     formData.riskProfile === 'high' ? 'Aggressive' : 'Custom';
    
    const selectedCoinsCount = formData.selectedCoins?.length || 0;
    
    return (
      <Card className="p-6 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-cyan-500/30">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Strategy Summary
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-slate-400">Name:</span>
            <span className="ml-2 text-white font-medium">{formData.strategyName || 'Unnamed Strategy'}</span>
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
            <span className="ml-2 text-white font-medium">{formData.maxWalletExposure}%</span>
          </div>
          <div>
            <span className="text-slate-400">Take Profit:</span>
            <span className="ml-2 text-green-400 font-medium">{formData.takeProfitPercentage}%</span>
          </div>
          <div>
            <span className="text-slate-400">Stop Loss:</span>
            <span className="ml-2 text-red-400 font-medium">{formData.stopLossPercentage}%</span>
          </div>
          <div>
            <span className="text-slate-400">Mode:</span>
            <span className="ml-2 text-white font-medium">
              {formData.simulationMode ? 'Simulation' : 'Live Trading'}
              {formData.backtestingMode && ' + Backtest'}
            </span>
          </div>
          <div>
            <span className="text-slate-400">DCA:</span>
            <span className="ml-2 text-white font-medium">
              {formData.enableDCA ? `Every ${formData.dcaIntervalHours}h` : 'Disabled'}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Frequency:</span>
            <span className="ml-2 text-white font-medium">
              {formData.buyFrequency === 'signal_based' ? 'Signal-based' : 
               formData.buyFrequency === 'daily' ? 'Daily' : 
               formData.buyFrequency === 'interval' ? `Every ${formData.buyIntervalMinutes}min` : 'Once'}
            </span>
          </div>
        </div>
        
        <div className="mt-4 p-3 bg-slate-800/50 rounded-lg border border-slate-600">
          <p className="text-xs text-slate-300">
            <strong>Strategy Logic:</strong> {riskLevel} approach with {formData.sellOrderType === 'trailing_stop' ? 'trailing stops to let gains run while protecting profits' : 'fixed targets for consistent gains'}. 
            {formData.enableDCA && ' Dollar-cost averaging enabled to reduce timing risk.'} 
            {formData.enableAutoCoinSelection && ' Auto-coin selection will adapt to market conditions.'}
          </p>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
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

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* General Strategy Settings */}
        <Card className="p-6 bg-slate-800/50 border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <Settings className="h-5 w-5" />
            🧱 General Strategy Settings
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <TooltipField tooltip="Name your strategy for easy reference and identification">
                <Label className="text-white">Strategy Name</Label>
              </TooltipField>
              <Input 
                value={formData.strategyName}
                onChange={(e) => updateFormData('strategyName', e.target.value)}
                placeholder="My Trading Strategy" 
                className="bg-slate-700 border-slate-600" 
                required
              />
            </div>

            <div className="space-y-2">
              <TooltipField tooltip="Choose a risk level; presets will be applied for stop-loss, take-profit, and max positions, or customize manually">
                <Label className="text-white">Risk Profile</Label>
              </TooltipField>
              <Select value={formData.riskProfile} onValueChange={(value: any) => updateFormData('riskProfile', value)}>
                <SelectTrigger className="bg-slate-700 border-slate-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="low">Low (Conservative)</SelectItem>
                  <SelectItem value="medium">Medium (Balanced)</SelectItem>
                  <SelectItem value="high">High (Aggressive)</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <TooltipField tooltip="Percentage of your wallet this strategy can use - caps total capital allocated to this strategy">
                <Label className="text-white">Max Wallet Exposure (%)</Label>
              </TooltipField>
              <div className="space-y-2">
                <Slider
                  min={1}
                  max={100}
                  step={1}
                  value={[formData.maxWalletExposure]}
                  onValueChange={(value) => updateFormData('maxWalletExposure', value[0])}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-slate-400">
                  <span>1%</span>
                  <span className="text-white font-medium">{formData.maxWalletExposure}%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-slate-600 p-4">
                <TooltipField tooltip="When ON, live orders are placed using real funds - enables or disables live execution">
                  <Label className="text-white">Enable Auto-Trading</Label>
                </TooltipField>
                <Switch 
                  checked={formData.enableAutoTrading} 
                  onCheckedChange={(value) => updateFormData('enableAutoTrading', value)} 
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-600 p-4">
                <TooltipField tooltip="Use virtual balance for backtesting or demo trading - prevents real trades and uses sandbox">
                  <Label className="text-white">Simulation Mode</Label>
                </TooltipField>
                <Switch 
                  checked={formData.simulationMode} 
                  onCheckedChange={(value) => updateFormData('simulationMode', value)} 
                />
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-2">
            <TooltipField tooltip="Optional: Describe your strategy goals, logic, or any important notes">
              <Label className="text-white">Notes</Label>
            </TooltipField>
            <Textarea 
              value={formData.notes}
              onChange={(e) => updateFormData('notes', e.target.value)}
              placeholder="Describe your strategy goals or logic..."
              className="bg-slate-700 border-slate-600 min-h-[80px]"
            />
          </div>
        </Card>

        {/* Coins & Assets */}
        <Card className="p-6 bg-slate-800/50 border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <Coins className="h-5 w-5" />
            🪙 Coins & Assets
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <TooltipField tooltip="Pick from coins available in your Coinbase account - limits tradable assets to selected ones">
                <Label className="text-white">Select Coins</Label>
              </TooltipField>
              <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 border border-slate-600 rounded-lg bg-slate-700/30">
                {COINBASE_COINS.map((coin) => (
                  <div key={coin} className="flex items-center space-x-2">
                    <Checkbox
                      checked={formData.selectedCoins.includes(coin)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          updateFormData('selectedCoins', [...formData.selectedCoins, coin]);
                        } else {
                          updateFormData('selectedCoins', formData.selectedCoins.filter(c => c !== coin));
                        }
                      }}
                    />
                    <label className="text-xs text-white">{coin}</label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <TooltipField tooltip="Max number of different coins to trade at once - controls diversification and risk exposure">
                  <Label className="text-white">Max Active Coins</Label>
                </TooltipField>
                <Input 
                  type="number" 
                  min={1} 
                  max={20}
                  value={formData.maxActiveCoins}
                  onChange={(e) => updateFormData('maxActiveCoins', Number(e.target.value))}
                  className="bg-slate-700 border-slate-600" 
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-600 p-4">
                <TooltipField tooltip="Allow the system to auto-select top liquid or trending coins - overrides manual coin list when ON">
                  <Label className="text-white">Enable Auto-Coin Selection</Label>
                </TooltipField>
                <Switch 
                  checked={formData.enableAutoCoinSelection} 
                  onCheckedChange={(value) => updateFormData('enableAutoCoinSelection', value)} 
                />
              </div>
            </div>
          </div>
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
    </div>
  );
};