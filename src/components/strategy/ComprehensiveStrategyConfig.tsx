import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { CoinsAmountsPanel } from './CoinsAmountsPanel';
import { PerformancePanel } from './PerformancePanel';
import { SellSettingsPanel } from './SellSettingsPanel';
import { 
  Save, 
  ArrowLeft, 
  Info, 
  Settings, 
  DollarSign, 
  TrendingUp, 
  TrendingDown,
  Shield, 
  BarChart3,
  Coins,
  TestTube,
  Bell,
  Target,
  Timer,
  Zap,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Check
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
  enableLiveTrading: boolean;
  enableTestTrading: boolean;
  
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
  // Notification settings
  notifyOnTrade: boolean;
  notifyOnError: boolean;
  notifyOnTargets: boolean;
  // Shorting settings
  enableShorting: boolean;
  maxShortPositions: number;
  shortingMinProfitPercentage: number;
  autoCloseShorts: boolean;
  // Advanced settings
  enableStopLossTimeout: boolean;
  stopLossTimeoutMinutes: number;
  useTrailingStopOnly: boolean;
  resetStopLossAfterFail: boolean;
  // Tags and categories
  category: string;
  tags: string[];
}

interface ComprehensiveStrategyConfigProps {
  onBack: () => void;
  existingStrategy?: any;
  isEditing?: boolean;
  isCollapsed?: boolean;
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

const MENU_SECTIONS = [
  {
    id: 'general',
    title: 'GENERAL',
    items: [
      { id: 'basic-settings', label: 'Basic settings', icon: Settings },
      { id: 'notifications', label: 'Notifications', icon: Bell }
    ]
  },
  {
    id: 'buying',
    title: 'BUYING',
    items: [
      { id: 'buy-settings', label: 'Buy settings', icon: TrendingUp },
      { id: 'coins-amounts', label: 'Coins and amounts', icon: Coins },
      { id: 'strategy', label: 'Strategy', icon: Target },
      { id: 'trailing-stop-buy', label: 'Trailing stop-buy', icon: Timer }
    ]
  },
  {
    id: 'selling',
    title: 'SELLING',
    items: [
      { id: 'sell-settings', label: 'Sell settings', icon: TrendingDown },
      { id: 'sell-strategy', label: 'Sell strategy', icon: BarChart3 },
      { id: 'stop-loss', label: 'Stop-loss', icon: Shield },
      { id: 'trailing-stop-loss', label: 'Trailing stop-loss', icon: Timer },
      { id: 'auto-close', label: 'Auto close', icon: Zap },
      { id: 'shorting-settings', label: 'Shorting settings', icon: TrendingDown },
      { id: 'dollar-cost-averaging', label: 'Dollar Cost Averaging', icon: DollarSign }
    ]
  }
];

export const ComprehensiveStrategyConfig = ({ 
  onBack, 
  existingStrategy, 
  isEditing = false,
  isCollapsed = false
}: ComprehensiveStrategyConfigProps) => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { toast } = useToast();
  
  const [activeSection, setActiveSection] = useState('basic-settings');
  const [showLiveConfirmation, setShowLiveConfirmation] = useState(false);
  
  const [formData, setFormData] = useState<StrategyFormData>({
    strategyName: existingStrategy?.strategy_name || '',
    riskProfile: 'medium',
    maxWalletExposure: 50,
    enableLiveTrading: false,
    enableTestTrading: true,
    
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
    dcaSteps: 3,
    notifyOnTrade: true,
    notifyOnError: true,
    notifyOnTargets: true,
    enableShorting: false,
    maxShortPositions: 2,
    shortingMinProfitPercentage: 1.5,
    autoCloseShorts: true,
    enableStopLossTimeout: false,
    stopLossTimeoutMinutes: 120,
    useTrailingStopOnly: false,
    resetStopLossAfterFail: false,
    category: 'trend',
    tags: ['automated', 'scalping']
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
        configuration: formData as any,
        test_mode: testMode,
        is_active: false, // Keep for backward compatibility
        is_active_test: false,
        is_active_live: false,
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
            <Info className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help" />
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  const handleLiveToggle = (value: boolean) => {
    if (value) {
      setShowLiveConfirmation(true);
    } else {
      updateFormData('enableLiveTrading', false);
    }
  };

  const confirmLiveTrading = () => {
    updateFormData('enableLiveTrading', true);
    updateFormData('enableTestTrading', false); // Disable test when enabling live
    setShowLiveConfirmation(false);
  };

  const renderSidebar = () => (
    <div className={`${isCollapsed ? 'w-0 overflow-hidden' : 'w-80'} bg-background border-r border-border p-4 overflow-y-auto transition-all duration-300`}>
      <div className="space-y-6">
        {MENU_SECTIONS.map((section) => (
          <div key={section.id}>
            <h3 className="text-xs font-bold text-foreground mb-3 uppercase tracking-wider">
              {section.title}
            </h3>
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                const hasGreenDot = ['strategy', 'trailing-stop-buy', 'stop-loss', 'trailing-stop-loss', 'auto-close', 'shorting-settings', 'dollar-cost-averaging'].includes(item.id);
                
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg text-sm font-semibold transition-all duration-200 border ${
                      isActive 
                        ? 'bg-primary text-primary-foreground border-primary shadow-lg transform scale-[1.02]' 
                        : 'text-foreground hover:text-primary hover:bg-primary/5 border-transparent hover:border-primary/20 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </div>
                    {hasGreenDot && (
                      <div className="w-2 h-2 rounded-full bg-green-500 shadow-sm" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderBasicSettings = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Basic Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <TooltipField tooltip="Name your strategy for easy reference">
                <Label>Strategy Name</Label>
              </TooltipField>
              <Input 
                value={formData.strategyName}
                onChange={(e) => updateFormData('strategyName', e.target.value)}
                placeholder="My Strategy Carlos" 
                required
              />
            </div>

            <div className="space-y-2">
              <TooltipField tooltip="Choose a risk level; presets will be applied, or customize manually">
                <Label>Risk Profile</Label>
              </TooltipField>
              <Select value={formData.riskProfile} onValueChange={(value: any) => updateFormData('riskProfile', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low (Balanced)</SelectItem>
                  <SelectItem value="medium">Medium (Balanced)</SelectItem>
                  <SelectItem value="high">High (Aggressive)</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <TooltipField tooltip="Percentage of your wallet this strategy can use">
              <Label>Max Wallet Exposure (%)</Label>
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
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1%</span>
                <span className="font-medium">{formData.maxWalletExposure}%</span>
                <span>100%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <TooltipField tooltip="Enable trading in live mode with real funds">
                <Label>Enable Live Trading</Label>
              </TooltipField>
              <Switch 
                checked={formData.enableLiveTrading} 
                onCheckedChange={handleLiveToggle}
              />
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg">
              <TooltipField tooltip="Enable trading in test mode for practice">
                <Label>Enable Test Trading</Label>
              </TooltipField>
              <Switch 
                checked={formData.enableTestTrading} 
                onCheckedChange={(value) => updateFormData('enableTestTrading', value)}
              />
            </div>
          </div>


          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <TooltipField tooltip="Categorize your strategy type. Say things like: 'This is a scalping strategy' or 'Make this a trend following bot'">
                <Label>Strategy Category</Label>
              </TooltipField>
              <Select value={formData.category || ''} onValueChange={(value) => updateFormData('category', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scalping">Scalping</SelectItem>
                  <SelectItem value="trend">Trend Following</SelectItem>
                  <SelectItem value="swing">Swing Trading</SelectItem>
                  <SelectItem value="dca">Dollar Cost Averaging</SelectItem>
                  <SelectItem value="arbitrage">Arbitrage</SelectItem>
                  <SelectItem value="momentum">Momentum</SelectItem>
                  <SelectItem value="reversal">Mean Reversion</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <TooltipField tooltip="Add tags for easy filtering. Say things like: 'Tag this as high-frequency' or 'Add automated tag'">
                <Label>Tags (comma-separated)</Label>
              </TooltipField>
              <Input 
                value={formData.tags?.join(', ') || ''}
                onChange={(e) => updateFormData('tags', e.target.value.split(',').map(tag => tag.trim()).filter(Boolean))}
                placeholder="e.g., automated, high-frequency, conservative"
              />
            </div>
          </div>

          <div className="space-y-2">
            <TooltipField tooltip="Optional: Describe your strategy goals or logic. Say things like: 'Explain my strategy logic' or 'Add notes about risk tolerance'">
              <Label>Notes</Label>
            </TooltipField>
            <Textarea 
              value={formData.notes}
              onChange={(e) => updateFormData('notes', e.target.value)}
              placeholder="Describe your strategy goals or logic..."
              className="min-h-[80px]"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderNotifications = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifications
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Get notified by email about your bot trades.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Receive notifications when trades are executed">
              <Label>Notification on trade</Label>
            </TooltipField>
            <Switch 
              checked={formData.notifyOnTrade} 
              onCheckedChange={(value) => updateFormData('notifyOnTrade', value)}
            />
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Receive notifications when trade errors occur">
              <Label>Notification on trade error</Label>
            </TooltipField>
            <Switch 
              checked={formData.notifyOnError} 
              onCheckedChange={(value) => updateFormData('notifyOnError', value)}
            />
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Receive notifications when profit/loss targets are reached">
              <Label>Notify on target reached</Label>
            </TooltipField>
            <Switch 
              checked={formData.notifyOnTargets} 
              onCheckedChange={(value) => updateFormData('notifyOnTargets', value)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderBuySettings = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Buy Settings
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Configure the buy settings for your hopper.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <TooltipField tooltip="Choose how buy orders are placed">
                <Label>Order Type</Label>
              </TooltipField>
              <Select value={formData.buyOrderType} onValueChange={(value: any) => updateFormData('buyOrderType', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="market">Market</SelectItem>
                  <SelectItem value="limit">Limit</SelectItem>
                  <SelectItem value="trailing_buy">Trailing Buy</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <TooltipField tooltip="Amount invested per trade">
                <Label>Per-Trade Allocation (€)</Label>
              </TooltipField>
              <Input 
                type="number"
                value={formData.perTradeAllocation}
                onChange={(e) => updateFormData('perTradeAllocation', parseFloat(e.target.value) || 0)}
                min="1"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <TooltipField tooltip="Max number of concurrent trades">
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
                  <span className="font-medium">{formData.maxOpenPositions}</span>
                  <span>20</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <TooltipField tooltip="Minimum wait time after a buy before next buy">
                <Label>Buy Cooldown (minutes)</Label>
              </TooltipField>
              <Input 
                type="number"
                value={formData.buyCooldownMinutes}
                onChange={(e) => updateFormData('buyCooldownMinutes', parseInt(e.target.value) || 0)}
                min="0"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Only allow one open buy order per coin">
              <Label>Only 1 open buy order per coin</Label>
            </TooltipField>
            <Switch defaultChecked />
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Only buy when there are positive pairs in the timeframe">
              <Label>Only buy when there are positive pairs</Label>
            </TooltipField>
            <Switch defaultChecked />
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Only buy if not already in positions">
              <Label>Only buy if not already in positions</Label>
            </TooltipField>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderCoinsAndAmounts = () => (
    <CoinsAmountsPanel 
      formData={formData} 
      updateFormData={updateFormData} 
    />
  );

  const renderSellSettings = () => (
    <SellSettingsPanel 
      formData={formData} 
      updateFormData={updateFormData} 
    />
  );

  const renderStopLoss = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Stop-Loss
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Enable stop-loss orders.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Enable stop-loss protection">
              <Label>Enable</Label>
            </TooltipField>
            <Switch defaultChecked />
          </div>

          <div className="space-y-2">
            <TooltipField tooltip="Stop-loss percentage (negative value)">
              <Label>Stop-loss Percentage</Label>
            </TooltipField>
            <Input 
              type="number"
              value={formData.stopLossPercentage}
              onChange={(e) => updateFormData('stopLossPercentage', parseFloat(e.target.value) || 0)}
              step="0.1"
              min="0"
            />
          </div>

          <div className="space-y-2">
            <TooltipField tooltip="Stop-loss timeout in minutes">
              <Label>Stop-loss Timeout</Label>
            </TooltipField>
            <Select defaultValue="minute">
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minute">Minute(s)</SelectItem>
                <SelectItem value="hour">Hour(s)</SelectItem>
                <SelectItem value="day">Day(s)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between">
                Advanced Settings
                <ChevronRight className="h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 mt-4">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <TooltipField tooltip="Enable stop-loss timeout">
                  <Label>Enable Stop-loss Timeout</Label>
                </TooltipField>
                <Switch 
                  checked={formData.enableStopLossTimeout}
                  onCheckedChange={(value) => updateFormData('enableStopLossTimeout', value)}
                />
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg">
                <TooltipField tooltip="Reset stop-loss after failed orders">
                  <Label>Reset Stop-loss After Failed Orders</Label>
                </TooltipField>
                <Switch 
                  checked={formData.resetStopLossAfterFail}
                  onCheckedChange={(value) => updateFormData('resetStopLossAfterFail', value)}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </div>
  );

  const renderShortingSettings = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Shorting Settings
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Configure the settings for your short positions.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Enable shorting functionality">
              <Label>Enable Shorting</Label>
            </TooltipField>
            <Switch 
              checked={formData.enableShorting}
              onCheckedChange={(value) => updateFormData('enableShorting', value)}
            />
          </div>

          {formData.enableShorting && (
            <>
              <div className="space-y-2">
                <TooltipField tooltip="Maximum number of short positions">
                  <Label>Max Short Positions</Label>
                </TooltipField>
                <Input 
                  type="number"
                  value={formData.maxShortPositions}
                  onChange={(e) => updateFormData('maxShortPositions', parseInt(e.target.value) || 0)}
                  min="1"
                  max="10"
                />
              </div>

              <div className="space-y-2">
                <TooltipField tooltip="Minimum profit percentage for short positions">
                  <Label>Shorting Percentage Profit</Label>
                </TooltipField>
                <Input 
                  type="number"
                  value={formData.shortingMinProfitPercentage}
                  onChange={(e) => updateFormData('shortingMinProfitPercentage', parseFloat(e.target.value) || 0)}
                  step="0.1"
                  min="0"
                />
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg">
                <TooltipField tooltip="Automatically close short positions after time limit">
                  <Label>Auto Close Shorts</Label>
                </TooltipField>
                <Switch 
                  checked={formData.autoCloseShorts}
                  onCheckedChange={(value) => updateFormData('autoCloseShorts', value)}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderDCA = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Dollar Cost Averaging
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Configure DCA settings to average down positions.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Enable Dollar Cost Averaging">
              <Label>Enable DCA</Label>
            </TooltipField>
            <Switch 
              checked={formData.enableDCA}
              onCheckedChange={(value) => updateFormData('enableDCA', value)}
            />
          </div>

          {formData.enableDCA && (
            <>
              <div className="space-y-2">
                <TooltipField tooltip="Interval between DCA orders in hours">
                  <Label>DCA Interval (hours)</Label>
                </TooltipField>
                <Input 
                  type="number"
                  value={formData.dcaIntervalHours}
                  onChange={(e) => updateFormData('dcaIntervalHours', parseInt(e.target.value) || 0)}
                  min="1"
                />
              </div>

              <div className="space-y-2">
                <TooltipField tooltip="Number of DCA steps">
                  <Label>DCA Steps</Label>
                </TooltipField>
                <Input 
                  type="number"
                  value={formData.dcaSteps}
                  onChange={(e) => updateFormData('dcaSteps', parseInt(e.target.value) || 0)}
                  min="1"
                  max="10"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderSummary = () => {
    const riskLevel = formData.riskProfile === 'low' ? 'Conservative' : 
                     formData.riskProfile === 'medium' ? 'Moderate' : 
                     formData.riskProfile === 'high' ? 'Aggressive' : 'Custom';
    
    const selectedCoinsCount = formData.selectedCoins?.length || 0;
    const currentMode = formData.enableLiveTrading ? 'Live Trading' : 'Test Mode';
    
    return (
      <div className="bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/20 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Strategy Summary
          </h3>
          <Badge variant={formData.enableLiveTrading ? "destructive" : "secondary"} className="px-3 py-1">
            {currentMode}
          </Badge>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-4">
          <div className="space-y-1">
            <span className="text-sm text-muted-foreground">Strategy Name</span>
            <p className="font-semibold text-foreground">{formData.strategyName || 'Unnamed Strategy'}</p>
          </div>
          <div className="space-y-1">
            <span className="text-sm text-muted-foreground">Risk Profile</span>
            <p className="font-semibold text-foreground">{riskLevel}</p>
          </div>
          <div className="space-y-1">
            <span className="text-sm text-muted-foreground">Selected Coins</span>
            <p className="font-semibold text-foreground">{selectedCoinsCount} coins</p>
          </div>
          <div className="space-y-1">
            <span className="text-sm text-muted-foreground">Wallet Exposure</span>
            <p className="font-semibold text-foreground">{formData.maxWalletExposure}%</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">
          <div className="space-y-1">
            <span className="text-sm text-muted-foreground">Take Profit</span>
            <p className="font-semibold text-green-600">{formData.takeProfitPercentage}%</p>
          </div>
          <div className="space-y-1">
            <span className="text-sm text-muted-foreground">Stop Loss</span>
            <p className="font-semibold text-red-600">{formData.stopLossPercentage}%</p>
          </div>
          <div className="space-y-1">
            <span className="text-sm text-muted-foreground">DCA Settings</span>
            <p className="font-semibold text-foreground">
              {formData.enableDCA ? `Every ${formData.dcaIntervalHours}h` : 'Disabled'}
            </p>
          </div>
        </div>
        
        <div className="p-4 bg-muted/50 rounded-lg border-l-4 border-l-primary">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Strategy Logic:</span> {riskLevel} risk approach using {formData.sellOrderType === 'trailing_stop' ? 'trailing stops to maximize gains while protecting profits' : 'fixed profit targets for consistent returns'}. 
            {formData.enableDCA && ' Dollar-cost averaging is enabled to reduce market timing risk.'} 
            {!formData.enableLiveTrading && ' Currently in test mode using simulated funds.'}
          </p>
        </div>
      </div>
    );
  };

  const renderStrategySettings = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Strategy Settings
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose a strategy for your bot.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <TooltipField tooltip="Choose your strategy type">
              <Label>Strategy</Label>
            </TooltipField>
            <Select defaultValue="bollinger-bands">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bollinger-bands">Bollinger Bands Advanced</SelectItem>
                <SelectItem value="rsi">RSI Strategy</SelectItem>
                <SelectItem value="macd">MACD Strategy</SelectItem>
                <SelectItem value="custom">Custom Strategy</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Only execute signals">
              <Label>Signals only</Label>
            </TooltipField>
            <Switch />
          </div>

          <div className="space-y-2">
            <TooltipField tooltip="Number of targets to buy">
              <Label>Number of targets to buy</Label>
            </TooltipField>
            <Input type="number" defaultValue="5" min="1" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <TooltipField tooltip="Bollinger Bands candle size">
                <Label>Bollinger Bands Candle Size</Label>
              </TooltipField>
              <Select defaultValue="5min">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1min">1 minute</SelectItem>
                  <SelectItem value="5min">5 minutes</SelectItem>
                  <SelectItem value="15min">15 minutes</SelectItem>
                  <SelectItem value="30min">30 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <TooltipField tooltip="Bollinger Bands period">
                <Label>Bollinger Bands Period</Label>
              </TooltipField>
              <Input type="number" defaultValue="20" min="1" />
            </div>
          </div>

          <div className="space-y-2">
            <TooltipField tooltip="Bollinger Bands deviation">
              <Label>Bollinger Bands Deviation</Label>
            </TooltipField>
            <Input type="number" defaultValue="2.0" step="0.1" min="0" />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderTrailingStopBuy = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Trailing Stop-Buy
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Trailing stop-buy will track the currency price downwards.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Enable trailing stop-buy">
              <Label>Enable</Label>
            </TooltipField>
            <Switch />
          </div>

          <div className="space-y-2">
            <TooltipField tooltip="Trailing stop-buy percentage">
              <Label>Trailing stop-buy percentage</Label>
            </TooltipField>
            <Input 
              type="number"
              value={formData.trailingBuyPercentage}
              onChange={(e) => updateFormData('trailingBuyPercentage', parseFloat(e.target.value) || 0)}
              step="0.1"
              min="0"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderSellStrategy = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Sell Strategy
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Configure your hopper to sell based on your strategy.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <TooltipField tooltip="Sell based on strategy">
              <Label>Sell based on strategy</Label>
            </TooltipField>
            <Switch />
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Only sell in profit">
              <Label>Only sell in profit</Label>
            </TooltipField>
            <Switch defaultChecked />
          </div>

          <div className="space-y-2">
            <TooltipField tooltip="Minimum profit percentage">
              <Label>Minimum profit %</Label>
            </TooltipField>
            <Input 
              type="number"
              defaultValue="1"
              step="0.1"
              min="0"
            />
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Hold assets when new target is the same">
              <Label>Hold assets when new target is the same</Label>
            </TooltipField>
            <Switch />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderTrailingStopLoss = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Trailing Stop-Loss
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Enabling trailing stop-loss will trail the profit percentage upwards.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Enable trailing stop-loss">
              <Label>Enable</Label>
            </TooltipField>
            <Switch />
          </div>

          <div className="space-y-2">
            <TooltipField tooltip="Trailing stop-loss percentage">
              <Label>Trailing stop-loss percentage</Label>
            </TooltipField>
            <Input 
              type="number"
              value={formData.trailingStopLossPercentage}
              onChange={(e) => updateFormData('trailingStopLossPercentage', parseFloat(e.target.value) || 0)}
              step="0.1"
              min="0"
            />
          </div>

          <div className="space-y-2">
            <TooltipField tooltip="Arm trailing stop-loss at percentage">
              <Label>Arm trailing stop-loss at</Label>
            </TooltipField>
            <Input 
              type="number"
              defaultValue="2.5"
              step="0.1"
              min="0"
            />
          </div>

          <div className="space-y-2">
            <TooltipField tooltip="Trailing stop-loss timeout">
              <Label>Trailing stop-loss timeout</Label>
            </TooltipField>
            <Select defaultValue="minute">
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minute">Minute(s)</SelectItem>
                <SelectItem value="hour">Hour(s)</SelectItem>
                <SelectItem value="day">Day(s)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Use trailing stop-loss only (disable take profit & sell-based on strategy)">
              <Label>Use trailing stop-loss only</Label>
            </TooltipField>
            <Switch 
              checked={formData.useTrailingStopOnly}
              onCheckedChange={(value) => updateFormData('useTrailingStopOnly', value)}
            />
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Reset stop-loss after failed orders">
              <Label>Reset stop-loss after failed orders</Label>
            </TooltipField>
            <Switch 
              checked={formData.resetStopLossAfterFail}
              onCheckedChange={(value) => updateFormData('resetStopLossAfterFail', value)}
            />
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Only sell with profit">
              <Label>Only sell with profit</Label>
            </TooltipField>
            <Switch />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderAutoClose = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Auto Close
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            With Auto Close you can automatically close positions after X amount of time.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <TooltipField tooltip="Enable auto close">
              <Label>Enable</Label>
            </TooltipField>
            <Switch />
          </div>

          <div className="space-y-2">
            <TooltipField tooltip="Close positions after X time open">
              <Label>Close positions after X time open</Label>
            </TooltipField>
            <Select defaultValue="6days">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6days">After 6 days</SelectItem>
                <SelectItem value="12hours">After 12 hours</SelectItem>
                <SelectItem value="24hours">After 24 hours</SelectItem>
                <SelectItem value="3days">After 3 days</SelectItem>
                <SelectItem value="1week">After 1 week</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderCurrentSection = () => {
    switch (activeSection) {
      case 'basic-settings': return renderBasicSettings();
      case 'notifications': return renderNotifications();
      case 'buy-settings': return renderBuySettings();
      case 'coins-amounts': return renderCoinsAndAmounts();
      case 'strategy': return renderStrategySettings();
      case 'trailing-stop-buy': return renderTrailingStopBuy();
      case 'sell-settings': return renderSellSettings();
      case 'sell-strategy': return renderSellStrategy();
      case 'stop-loss': return renderStopLoss();
      case 'trailing-stop-loss': return renderTrailingStopLoss();
      case 'auto-close': return renderAutoClose();
      case 'shorting-settings': return renderShortingSettings();
      case 'dollar-cost-averaging': return renderDCA();
      default: return renderBasicSettings();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Overview
          </Button>
          <div>
            <h2 className="text-2xl font-bold">
              {isEditing ? 'Edit Strategy' : 'Create Strategy'}
            </h2>
            <p className="text-muted-foreground">Configure your comprehensive trading strategy</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <Button onClick={handleSubmit} className="bg-green-500 hover:bg-green-600 text-white px-8">
            <Save className="h-4 w-4 mr-2" />
            {isEditing ? 'Update Strategy' : 'Save Strategy'}
          </Button>
          <Button variant="outline" onClick={onBack} className="px-6">
            Cancel
          </Button>
        </div>
      </div>

      {/* Strategy Summary at the top */}
      <div className="p-6 border-b bg-muted/30">
        {renderSummary()}
      </div>

      <div className="flex">
        {renderSidebar()}
        
        <div className="flex-1 p-6 overflow-auto">
          <form onSubmit={handleSubmit} className="space-y-6">
            {renderCurrentSection()}
          </form>
        </div>
      </div>

      {/* Live Trading Confirmation Dialog */}
      <AlertDialog open={showLiveConfirmation} onOpenChange={setShowLiveConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Enable Live Trading
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will place real trades using your actual funds. Are you sure you want to enable live trading?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowLiveConfirmation(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmLiveTrading} className="bg-red-600 hover:bg-red-700">
              Yes, Enable Live Trading
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};