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
  const [createMode, setCreateMode] = useState<CreateMode>(CREATE_MODES.MANUAL);
  const [showModeSelection, setShowModeSelection] = useState(!isEditing);
  const [currentView, setCurrentView] = useState<'list' | 'create' | 'comprehensive'>('create');

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
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Max Exposure</Label>
              <p className="text-2xl font-bold text-primary mt-1">{formData.maxWalletExposure}%</p>
            </div>
            
            <div className="bg-background border border-border rounded-lg p-4 shadow-sm">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</Label>
              <div className="mt-2">
                <Badge variant={formData.enableLiveTrading ? 'default' : formData.enableTestTrading ? 'secondary' : 'outline'} className="font-bold">
                  {formData.enableLiveTrading ? 'LIVE' : formData.enableTestTrading ? 'TEST' : 'INACTIVE'}
                </Badge>
              </div>
            </div>
            
            <div className="bg-background border border-border rounded-lg p-4 shadow-sm">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Coins</Label>
              <p className="text-2xl font-bold text-primary mt-1">{formData.selectedCoins.length}</p>
            </div>
          </div>
          
          {/* Trading Parameters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <Label className="text-xs font-semibold text-green-700 dark:text-green-300 uppercase tracking-wider">Take Profit</Label>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{formData.takeProfitPercentage}%</p>
            </div>
            
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <Label className="text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wider">Stop Loss</Label>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">{formData.stopLossPercentage}%</p>
            </div>
            
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <Label className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider">Max Positions</Label>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">{formData.maxOpenPositions}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  if (currentView === 'comprehensive') {
    return <PerformancePanel />;
  }

  // Mode Selection Screen (only for create, not edit)
  if (!isEditing && showModeSelection) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted/20 flex items-center justify-center p-6">
        <Card className="w-full max-w-2xl border-primary/20 shadow-xl relative">
          <CardHeader className="text-center pb-8">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onBack}
              className="absolute top-4 left-4 hover:bg-muted"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onBack}
              className="absolute top-4 right-4 hover:bg-muted p-2"
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
            <CardTitle className="text-3xl font-bold text-primary mb-2">Create New Strategy</CardTitle>
            <p className="text-muted-foreground text-lg">Choose how you'd like to build your trading strategy</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card 
                className="cursor-pointer border-2 border-transparent hover:border-primary/50 transition-all duration-300 hover:shadow-lg"
                onClick={() => {
                  setCreateMode(CREATE_MODES.MANUAL);
                  setShowModeSelection(false);
                }}
              >
                <CardContent className="p-8 text-center space-y-4">
                  <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
                    <Settings className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground">Manual Configuration</h3>
                  <p className="text-muted-foreground">
                    Build your strategy step-by-step with detailed configuration options
                  </p>
                  <Button className="w-full">
                    Configure Manually
                  </Button>
                </CardContent>
              </Card>

              <Card 
                className="cursor-pointer border-2 border-transparent hover:border-primary/50 transition-all duration-300 hover:shadow-lg bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20 relative overflow-hidden"
                onClick={() => {
                  setCreateMode(CREATE_MODES.AI_AGENT);
                  setShowModeSelection(false);
                }}
              >
                <div className="absolute top-3 right-3">
                  <Badge variant="secondary" className="bg-primary/20 text-primary border-primary/30 font-semibold">
                    AI Powered
                  </Badge>
                </div>
                <CardContent className="p-8 text-center space-y-4">
                  <div className="w-16 h-16 mx-auto bg-gradient-to-br from-primary/20 to-primary/30 rounded-full flex items-center justify-center shadow-lg">
                    <MessageCircle className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground">Talk to an Agent</h3>
                  <p className="text-muted-foreground">
                    Describe your strategy in natural language and let AI configure it for you
                  </p>
                  <div className="text-xs text-primary font-medium bg-primary/10 px-3 py-1 rounded-full inline-block">
                    ✨ Simple • Fast • Intelligent
                  </div>
                  <Button className="w-full bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg">
                    Talk Normally
                  </Button>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // AI Agent Mode
  if (!isEditing && createMode === CREATE_MODES.AI_AGENT) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted/20 flex items-center justify-center p-6">
        <Card className="w-full max-w-4xl border-primary/20 shadow-xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowModeSelection(true)}
                className="hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Options
              </Button>
              <Badge variant="secondary">AI Strategy Builder</Badge>
            </div>
            <CardTitle className="text-2xl font-bold text-primary text-center">
              Describe Your Trading Strategy
            </CardTitle>
            <p className="text-muted-foreground text-center">
              Tell me what kind of strategy you want to create and I'll configure it for you
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-muted/50 rounded-lg p-6">
              <h3 className="font-semibold text-foreground mb-4">Examples you can say:</h3>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>• "Create a conservative Bitcoin strategy with 2% stop loss"</p>
                <p>• "I want to scalp ETH and BTC with quick 1% profits"</p>
                <p>• "Build a DCA strategy for top 10 coins, buying every 4 hours"</p>
                <p>• "Make a high-risk strategy with trailing stops for altcoins"</p>
              </div>
            </div>
            
            <Textarea
              placeholder="Describe your trading strategy here..."
              className="min-h-[120px] text-base"
              rows={6}
            />
            
            <div className="flex gap-4">
              <Button className="flex-1" size="lg">
                <MessageCircle className="h-4 w-4 mr-2" />
                Generate Strategy
              </Button>
              <Button 
                variant="outline" 
                onClick={() => {
                  setCreateMode(CREATE_MODES.MANUAL);
                  setShowModeSelection(false);
                }}
              >
                Manual Setup Instead
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main configuration view
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20 flex">
      <div className="w-full flex">
        {renderSidebar()}
        
        <div className="flex-1 bg-background overflow-hidden">
          {/* Header */}
          <div className="bg-background border-b border-border p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={onBack}
                  className="hover:bg-muted"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">
                    {isEditing ? 'Edit Strategy' : 'Create Strategy'}
                  </h1>
                  <p className="text-foreground/70 font-medium">
                    {isEditing ? 'Modify your trading strategy configuration' : 'Build your automated trading strategy'}
                  </p>
                </div>
              </div>
              
              <div className="flex gap-3">
                <Button 
                  type="submit" 
                  className="px-6 py-2 max-w-xs"
                  disabled={!formData.strategyName?.trim()}
                  onClick={handleSubmit}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isEditing ? 'Update Strategy' : 'Save Strategy'}
                </Button>
                
                {isEditing && (
                  <AlertDialog open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm">
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
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          Delete Strategy
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          </div>
          
          {/* Content */}
          <div className="p-6 overflow-y-auto">
            <form onSubmit={handleSubmit} className="space-y-6">
              {activeSection === 'basic-settings' && (
                <div className="space-y-6">
                  {renderStrategyDetails()}
                  
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-xl font-bold text-foreground">
                        <Settings className="h-6 w-6" />
                        Basic Settings
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <TooltipField tooltip="Name your strategy for easy reference. Say things like: 'Name this My Bitcoin Bot' or 'Call it Scalping Strategy'">
                            <Label className="text-sm font-semibold text-foreground">Strategy Name</Label>
                          </TooltipField>
                          <Input 
                            value={formData.strategyName}
                            onChange={(e) => updateFormData('strategyName', e.target.value)}
                            placeholder="My Strategy Carlos" 
                            required
                            className={!formData.strategyName?.trim() ? 'border-destructive' : ''}
                          />
                          {!formData.strategyName?.trim() && (
                            <p className="text-sm text-destructive">Strategy name is required</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <TooltipField tooltip="Choose a risk level; presets will be applied, or customize manually. Say things like: 'Make this high risk' or 'Set to conservative mode'">
                            <Label className="text-sm font-semibold text-foreground">Risk Profile</Label>
                          </TooltipField>
                          <Select value={formData.riskProfile} onValueChange={(value: any) => updateFormData('riskProfile', value)}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">Low (Conservative)</SelectItem>
                              <SelectItem value="medium">Medium (Balanced)</SelectItem>
                              <SelectItem value="high">High (Aggressive)</SelectItem>
                              <SelectItem value="custom">Custom</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <TooltipField tooltip="Percentage of your wallet this strategy can use. Say things like: 'Only use 25% of my funds' or 'Limit exposure to 50%'">
                          <Label className="text-sm font-semibold text-foreground">Max Wallet Exposure (%)</Label>
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
                          <TooltipField tooltip="Enable trading in live mode with real funds. Say things like: 'Go live with this strategy' or 'Enable real trading'">
                            <Label className="text-sm font-semibold text-foreground">Enable Live Trading</Label>
                          </TooltipField>
                          <Switch 
                            checked={formData.enableLiveTrading} 
                            onCheckedChange={handleLiveToggle}
                          />
                        </div>

                        <div className="flex items-center justify-between p-4 border rounded-lg">
                          <TooltipField tooltip="Enable trading in test mode for practice. Say things like: 'Start testing this strategy' or 'Enable simulation mode'">
                            <Label className="text-sm font-semibold text-foreground">Enable Test Trading</Label>
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
                            <Label className="text-sm font-semibold text-foreground">Strategy Category</Label>
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
                            <Label className="text-sm font-semibold text-foreground">Tags (comma-separated)</Label>
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
                          <Label className="text-sm font-semibold text-foreground">Notes</Label>
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
              )}
              
              {activeSection === 'notifications' && (
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
              )}

              {activeSection === 'buy-settings' && (
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
              )}

              {activeSection === 'coins-amounts' && (
                <CoinsAmountsPanel 
                  formData={formData} 
                  updateFormData={updateFormData} 
                />
              )}
              
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
