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
  Check,
  Trash2,
  MessageCircle,
  X
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

// Create Strategy Mode Options
const CREATE_MODES = {
  MANUAL: 'manual',
  AI_AGENT: 'ai_agent'
} as const;

type CreateMode = typeof CREATE_MODES[keyof typeof CREATE_MODES];

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

export const ComprehensiveStrategyConfig: React.FC<ComprehensiveStrategyConfigProps> = ({ 
  onBack, 
  existingStrategy, 
  isEditing = false,
  isCollapsed = false
}) => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState('basic-settings');
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [showLiveConfirmation, setShowLiveConfirmation] = useState(false);
  const [showActivateTestModal, setShowActivateTestModal] = useState(false);
  const [createdStrategyId, setCreatedStrategyId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>(CREATE_MODES.MANUAL);
  const [showModeSelection, setShowModeSelection] = useState(!isEditing);
  const [currentView, setCurrentView] = useState<'list' | 'create' | 'comprehensive'>('create');

  const [formData, setFormData] = useState<StrategyFormData>({
    strategyName: existingStrategy?.strategy_name || '',
    riskProfile: 'medium',
    maxWalletExposure: 50,
    enableLiveTrading: false, // Strategies must be created in Test Mode first
    enableTestTrading: true,  // Always start in Test Mode
    
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

    // Validation
    if (!formData.strategyName?.trim()) {
      toast({
        title: "Validation Error",
        description: "Strategy name is required",
        variant: "destructive",
      });
      return;
    }

    try {
      const strategyData = {
        user_id: user.id,
        strategy_name: formData.strategyName,
        description: formData.notes || null,
        configuration: formData as any,
        test_mode: true, // Always create in test mode
        is_active: false, // Keep for backward compatibility
        is_active_test: false, // Created but not activated
        is_active_live: false, // Never allow direct creation in live mode
        updated_at: new Date().toISOString()
      };

      if (isEditing && existingStrategy) {
        const { error } = await supabase
          .from('trading_strategies')
          .update(strategyData)
          .eq('id', existingStrategy.id)
          .eq('user_id', user.id);

        if (error) throw error;
        
        toast({
          title: "Strategy updated",
          description: `Your strategy "${formData.strategyName}" has been updated successfully.`,
        });
        
        onBack();
      } else {
        const { data, error } = await supabase
          .from('trading_strategies')
          .insert({
            ...strategyData,
            test_mode: true // Ensure all new strategies are created as test strategies
          })
          .select()
          .single();

        if (error) throw error;

        toast({
          title: "Strategy created",
          description: `Your strategy "${formData.strategyName}" has been created.`,
        });

        // Store the created strategy ID and show activation modal
        setCreatedStrategyId(data.id);
        setShowActivateTestModal(true);
      }
    } catch (error) {
      console.error('Error saving strategy:', error);
      toast({
        title: "Error",
        description: "Failed to save strategy. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleActivateInTestMode = async () => {
    if (!user || !createdStrategyId) return;

    try {
      // Deactivate any existing test strategies
      await supabase
        .from('trading_strategies')
        .update({ is_active_test: false })
        .eq('user_id', user.id)
        .neq('id', createdStrategyId);

      // Activate the new strategy in test mode
      await supabase
        .from('trading_strategies')
        .update({ is_active_test: true })
        .eq('id', createdStrategyId)
        .eq('user_id', user.id);

      toast({
        title: "Strategy activated",
        description: `${formData.strategyName} is now active in Test Mode`,
      });

      setShowActivateTestModal(false);
      onBack();
    } catch (error) {
      console.error('Error activating strategy:', error);
      toast({
        title: "Error",
        description: "Failed to activate strategy in Test Mode",
        variant: "destructive",
      });
    }
  };

  const handleSkipActivation = () => {
    setShowActivateTestModal(false);
    onBack();
  };

  const handleDelete = async () => {
    if (!user || !existingStrategy) return;

    try {
      const { error } = await supabase
        .from('trading_strategies')
        .delete()
        .eq('id', existingStrategy.id)
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: "Strategy deleted",
        description: "Your strategy has been deleted successfully.",
      });
      
      onBack();
    } catch (error) {
      console.error('Error deleting strategy:', error);
      toast({
        title: "Error",
        description: "Failed to delete strategy. Please try again.",
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
      // When disabling live, automatically enable test mode
      updateFormData('enableTestTrading', true);
    }
  };

  const handleTestToggle = (value: boolean) => {
    if (value) {
      // When enabling test, disable live mode
      updateFormData('enableTestTrading', true);
      updateFormData('enableLiveTrading', false);
    } else {
      // Prevent disabling test mode if live mode is also disabled
      if (!formData.enableLiveTrading) {
        toast({
          title: "Invalid Configuration",
          description: "Strategy must have either Test Mode or Live Mode enabled",
          variant: "destructive",
        });
        return;
      }
      updateFormData('enableTestTrading', false);
    }
  };

  const confirmLiveTrading = () => {
    updateFormData('enableLiveTrading', true);
    updateFormData('enableTestTrading', false); // Disable test when enabling live
    setShowLiveConfirmation(false);
  };

  const renderSidebar = () => (
    <div className="w-80 bg-background border-r border-border p-4 overflow-y-auto transition-all duration-300">
      <div className="space-y-6">
        {MENU_SECTIONS.map((section) => (
          <div key={section.id}>
            <h3 className="text-sm font-bold text-primary mb-3 uppercase tracking-wider border-b border-border pb-2">
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

  const renderStrategyDetails = () => (
    <div className="space-y-6">
      <Card className="border-primary/20 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-primary/5 to-primary/10 border-b border-primary/20">
          <CardTitle className="flex items-center gap-2 text-xl font-bold text-primary">
            <BarChart3 className="h-6 w-6" />
            Strategy Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {/* Key Performance Indicators */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-background border border-border rounded-lg p-4 shadow-sm">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Risk Level</Label>
              <div className="mt-2">
                <Badge variant={formData.riskProfile === 'high' ? 'destructive' : formData.riskProfile === 'medium' ? 'default' : 'secondary'} className="font-bold">
                  {formData.riskProfile.toUpperCase()}
                </Badge>
              </div>
            </div>
            
            <div className="bg-background border border-border rounded-lg p-4 shadow-sm">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Allocation</Label>
              <div className="mt-2">
                <span className="text-lg font-bold text-foreground">
                  {formData.allocationUnit === 'euro' ? `€${formData.perTradeAllocation}` : `${formData.perTradeAllocation}%`}
                </span>
              </div>
            </div>
            
            <div className="bg-background border border-border rounded-lg p-4 shadow-sm">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Max Positions</Label>
              <div className="mt-2">
                <span className="text-lg font-bold text-foreground">{formData.maxOpenPositions}</span>
              </div>
            </div>
            
            <div className="bg-background border border-border rounded-lg p-4 shadow-sm">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Coins Selected</Label>
              <div className="mt-2">
                <span className="text-lg font-bold text-foreground">{formData.selectedCoins.length}</span>
              </div>
            </div>
          </div>

          {/* Strategy Configuration Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="font-semibold text-foreground border-b border-border pb-2">Risk Management</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stop Loss:</span>
                  <span className="font-medium text-red-400">{formData.stopLossPercentage}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Take Profit:</span>
                  <span className="font-medium text-green-400">{formData.takeProfitPercentage}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Wallet Exposure:</span>
                  <span className="font-medium">{formData.maxWalletExposure}%</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-4">
              <h4 className="font-semibold text-foreground border-b border-border pb-2">Trading Behavior</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Buy Frequency:</span>
                  <span className="font-medium capitalize">{formData.buyFrequency.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Order Type:</span>
                  <span className="font-medium capitalize">{formData.buyOrderType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">DCA Enabled:</span>
                  <span className="font-medium">{formData.enableDCA ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Mode Selection Modal */}
      {showModeSelection && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl mx-4">
            <CardHeader>
              <CardTitle className="text-center text-2xl">Choose Creation Method</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card 
                  className={`cursor-pointer transition-all duration-200 hover:shadow-lg ${
                    createMode === CREATE_MODES.MANUAL 
                      ? 'ring-2 ring-primary bg-primary/5' 
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setCreateMode(CREATE_MODES.MANUAL)}
                >
                  <CardContent className="p-6 text-center">
                    <Settings className="h-12 w-12 mx-auto mb-4 text-primary" />
                    <h3 className="text-lg font-semibold mb-2">Manual Configuration</h3>
                    <p className="text-sm text-muted-foreground">
                      Configure all strategy parameters manually with full control over every setting
                    </p>
                  </CardContent>
                </Card>
                
                <Card 
                  className={`cursor-pointer transition-all duration-200 hover:shadow-lg ${
                    createMode === CREATE_MODES.AI_AGENT 
                      ? 'ring-2 ring-primary bg-primary/5' 
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setCreateMode(CREATE_MODES.AI_AGENT)}
                >
                  <CardContent className="p-6 text-center">
                    <MessageCircle className="h-12 w-12 mx-auto mb-4 text-primary" />
                    <h3 className="text-lg font-semibold mb-2">AI Agent Assistant</h3>
                    <p className="text-sm text-muted-foreground">
                      Let AI help you create and optimize your strategy based on your goals
                    </p>
                  </CardContent>
                </Card>
              </div>
              
              <div className="flex justify-center gap-4">
                <Button variant="outline" onClick={onBack}>
                  Cancel
                </Button>
                <Button onClick={() => setShowModeSelection(false)}>
                  Continue with {createMode === CREATE_MODES.MANUAL ? 'Manual' : 'AI Agent'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="hover:bg-primary/10"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Strategies
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {isEditing ? 'Edit Strategy' : 'Create Strategy'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isEditing ? 'Modify your existing trading strategy' : 'Design your automated trading strategy'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {isEditing && (
            <AlertDialog open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-red-500 border-red-500 hover:bg-red-500/10">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Strategy</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this strategy? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                    Delete Strategy
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          
          <Button 
            onClick={handleSubmit}
            className="px-6"
            disabled={!formData.strategyName?.trim()}
          >
            <Save className="h-4 w-4 mr-2" />
            {isEditing ? 'Update Strategy' : 'Save Strategy'}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {renderSidebar()}
        
        {/* Content Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            <form onSubmit={handleSubmit} className="max-w-4xl space-y-8">
              
              {/* Basic Settings Section */}
              {activeSection === 'basic-settings' && (
                <div className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Settings className="h-5 w-5" />
                        Basic Strategy Settings
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* Strategy Name */}
                      <div className="space-y-2">
                        <TooltipField tooltip="Choose a descriptive name for your trading strategy">
                          <Label htmlFor="strategyName">Strategy Name *</Label>
                        </TooltipField>
                        <Input
                          id="strategyName"
                          value={formData.strategyName}
                          onChange={(e) => updateFormData('strategyName', e.target.value)}
                          placeholder="e.g., BTC Conservative Growth"
                          className="text-base"
                        />
                      </div>

                      {/* Strategy Notes */}
                      <div className="space-y-2">
                        <TooltipField tooltip="Add notes about your strategy approach, market conditions, or goals">
                          <Label htmlFor="notes">Strategy Notes</Label>
                        </TooltipField>
                        <Textarea
                          id="notes"
                          value={formData.notes}
                          onChange={(e) => updateFormData('notes', e.target.value)}
                          placeholder="Describe your strategy, market outlook, or any special considerations..."
                          rows={4}
                        />
                      </div>

                      {/* Risk Profile */}
                      <div className="space-y-4">
                        <TooltipField tooltip="Risk profile automatically adjusts multiple settings. Choose 'Custom' to manually configure all parameters">
                          <Label>Risk Profile</Label>
                        </TooltipField>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                          {(['low', 'medium', 'high', 'custom'] as const).map((risk) => (
                            <Card 
                              key={risk}
                              className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
                                formData.riskProfile === risk 
                                  ? 'ring-2 ring-primary bg-primary/5' 
                                  : 'hover:bg-muted/50'
                              }`}
                              onClick={() => updateFormData('riskProfile', risk)}
                            >
                              <CardContent className="p-4 text-center">
                                <div className="mb-2">
                                  <Badge 
                                    variant={risk === 'high' ? 'destructive' : risk === 'medium' ? 'default' : risk === 'low' ? 'secondary' : 'outline'}
                                    className="font-bold"
                                  >
                                    {risk.toUpperCase()}
                                  </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground space-y-1">
                                  {risk === 'low' && (
                                    <>
                                      <div>Stop Loss: 2%</div>
                                      <div>Take Profit: 1.5%</div>
                                      <div>Max Positions: 3</div>
                                    </>
                                  )}
                                  {risk === 'medium' && (
                                    <>
                                      <div>Stop Loss: 3%</div>
                                      <div>Take Profit: 2.5%</div>
                                      <div>Max Positions: 5</div>
                                    </>
                                  )}
                                  {risk === 'high' && (
                                    <>
                                      <div>Stop Loss: 5%</div>
                                      <div>Take Profit: 4%</div>
                                      <div>Max Positions: 8</div>
                                    </>
                                  )}
                                  {risk === 'custom' && (
                                    <div>Manual configuration</div>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Strategy Performance Preview */}
                  {renderStrategyDetails()}
                </div>
              )}

              {/* Coins and Amounts Panel */}
              {activeSection === 'coins-amounts' && (
                <CoinsAmountsPanel 
                  formData={formData} 
                  updateFormData={updateFormData} 
                />
              )}

              {/* Sell Settings Panel */}
              {activeSection === 'sell-settings' && (
                <SellSettingsPanel 
                  formData={formData} 
                  updateFormData={updateFormData} 
                />
              )}
            </form>
          </div>
        </div>
      </div>

      {/* Confirmation Dialogs */}
      <AlertDialog open={showLiveConfirmation} onOpenChange={setShowLiveConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Enable Live Trading
            </AlertDialogTitle>
            <AlertDialogDescription>
              ⚠️ <strong>Warning:</strong> Live trading will use real money from your connected Coinbase account. 
              Make sure you've thoroughly tested this strategy before enabling live trading.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowLiveConfirmation(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmLiveTrading} className="bg-red-600 hover:bg-red-700">
              I Understand - Enable Live Trading
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Test Mode Activation Dialog */}
      <AlertDialog open={showActivateTestModal} onOpenChange={setShowActivateTestModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-600" />
              Strategy Created Successfully
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Your strategy has been created and is ready to use.
              <br /><br />
              <strong>Would you like to activate this strategy in Test Mode now?</strong>
              <br /><br />
              <span className="text-sm text-muted-foreground">
                Test Mode uses simulated trading to validate your strategy before going live.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleSkipActivation}>
              Skip - Keep Inactive
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleActivateInTestMode} className="bg-green-600 hover:bg-green-700">
              Yes, Activate in Test Mode
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};