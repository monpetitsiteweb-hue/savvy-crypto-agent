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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
  X,
  Brain
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import NaturalLanguageStrategy from './NaturalLanguageStrategy';
import AIIntelligenceSettings, { AIIntelligenceConfig } from './AIIntelligenceSettings';

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
  // NOTE: enableAI removed - using aiIntelligenceConfig.enableAIOverride as single source of truth
  
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
  maxTradesPerDay: number;
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
  resetStopLossAfterFail: boolean;
  useTrailingStopOnly: boolean;
  // Tags and categories
  category: string;
  tags: string[];
  // AI Intelligence settings - enableAIOverride is the single source of truth
  aiIntelligenceConfig: AIIntelligenceConfig;
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
    id: 'intelligence',
    title: 'AI INTELLIGENCE',
    items: [
      { id: 'ai-intelligence', label: 'AI Intelligence Settings', icon: MessageCircle }
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
      { id: 'shorting-settings', label: 'Shorting settings', icon: TrendingDown },
      { id: 'dollar-cost-averaging', label: 'Dollar Cost Averaging', icon: DollarSign }
    ]
  }
];

// Define TooltipField outside the component to prevent recreation on every render
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
    // NOTE: AI enable state now in aiIntelligenceConfig.enableAIOverride
    
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
    maxTradesPerDay: 50,
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
    resetStopLossAfterFail: false,
    useTrailingStopOnly: false,
    category: 'trend',
    tags: ['automated', 'scalping'],
    aiIntelligenceConfig: {
      enableAIOverride: false,
      aiAutonomyLevel: 30,
      aiConfidenceThreshold: 70,
      enablePatternRecognition: true,
      patternLookbackHours: 168,
      crossAssetCorrelation: true,
      marketStructureAnalysis: true,
      enableExternalSignals: true,
      whaleActivityWeight: 25,
      sentimentWeight: 20,
      newsImpactWeight: 30,
      socialSignalsWeight: 15,
      decisionMode: 'balanced' as const,
      escalationThreshold: 80,
      riskOverrideAllowed: false,
      enableLearning: true,
      adaptToPerformance: true,
      learningRate: 50,
      explainDecisions: true,
      alertOnAnomalies: true,
      alertOnOverrides: true,
      customInstructions: ''
    }
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
      setFormData(prev => ({ 
        ...prev, 
        ...config,
        // Properly merge the nested aiIntelligenceConfig with existing enableAIOverride
        aiIntelligenceConfig: {
          ...prev.aiIntelligenceConfig,
          ...config.aiIntelligenceConfig
        }
      }));
    }
  }, [existingStrategy]);

  // Quick update for High Risk Momentum Trader strategy
  const quickUpdateStrategy = async () => {
    if (!user) return;
    
    try {
      const { error } = await supabase
        .from('trading_strategies')
        .update({
          configuration: {
            ...formData,
            takeProfitPercentage: 1,
            dailyProfitTarget: 1,
            selectedCoins: ["BTC","ETH","ADA","DOGE","XRP","LTC","BCH","LINK","DOT","UNI","SOL","MATIC","AVAX","ICP","XLM","VET","ALGO","ATOM","FIL","TRX","ETC","THETA","XMR","XTZ","COMP","AAVE","MKR","SNX","CRV","YFI"]
          } as any,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id)
        .eq('strategy_name', 'High Risk Momentum Trader');

      if (error) throw error;
      
      toast({
        title: "Strategy Updated",
        description: "High Risk Momentum Trader updated to 1% take profit with daily sell target.",
      });
    } catch (error: any) {
      console.error('Error updating strategy:', error);
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

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
      // Debug: Log what we're about to save
      console.log('🚨 STRATEGY_SAVE_DEBUG: About to save strategy with formData:', formData);
      console.log('🚨 STRATEGY_SAVE_DEBUG: AI Intelligence Config being saved:', formData.aiIntelligenceConfig);
      console.log('🚨 STRATEGY_SAVE_DEBUG: Confidence threshold value:', formData.aiIntelligenceConfig.aiConfidenceThreshold);
      
      // Use aiIntelligenceConfig.enableAIOverride as single source of truth - no sync needed
      const syncedFormData = {
        ...formData
        // aiIntelligenceConfig already contains enableAIOverride directly
      };

      const strategyData = {
        user_id: user.id,
        strategy_name: formData.strategyName,
        description: formData.notes || null,
        configuration: syncedFormData as any,
        test_mode: true, // Always create in test mode
        is_active: false, // Keep for backward compatibility
        is_active_test: false, // Created but not activated
        is_active_live: false, // Never allow direct creation in live mode
        updated_at: new Date().toISOString()
      };

      console.log('🚨 STRATEGY_SAVE_DEBUG: Full strategyData being sent to database:', strategyData);

      if (isEditing && existingStrategy) {
        console.log('🚨 STRATEGY_SAVE_DEBUG: Updating existing strategy with ID:', existingStrategy.id);
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
    <div className="hidden lg:block w-80 bg-background border-r border-border p-4 overflow-y-auto transition-all duration-300 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
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
                const hasGreenDot = ['strategy', 'trailing-stop-buy', 'shorting-settings', 'dollar-cost-averaging'].includes(item.id);
                
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

  const renderMobileTabs = () => (
    <div className="lg:hidden border-b border-border bg-background/95 backdrop-blur-sm sticky top-[73px] z-10 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
      <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
        <div className="flex gap-1 p-2 min-w-max">
          {MENU_SECTIONS.map((section) => (
            <div key={section.id} className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                const hasGreenDot = ['strategy', 'trailing-stop-buy', 'shorting-settings', 'dollar-cost-averaging'].includes(item.id);
                
                return (
                  <Button
                    key={item.id}
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    className={`whitespace-nowrap ${
                      isActive 
                        ? 'bg-primary text-primary-foreground' 
                        : 'hover:bg-muted'
                    }`}
                    onClick={() => setActiveSection(item.id)}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    <span className="text-xs font-medium">{item.label}</span>
                    {hasGreenDot && (
                      <div className="w-2 h-2 bg-green-500 rounded-full ml-2" />
                    )}
                  </Button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mode Selection Modal */}
      {showModeSelection && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start md:items-center justify-center z-50 p-4 pt-8 md:pt-4">
          <Card className="w-full max-w-2xl bg-card border shadow-lg">
            <CardHeader>
              <CardTitle className="text-center text-2xl">Choose Creation Method</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card 
                  className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
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
                  className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
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
      
      <div className="h-full flex flex-col bg-background">
        {/* AI Agent Interface */}
        {createMode === CREATE_MODES.AI_AGENT && (
          <div className="flex-1 p-6">
            <NaturalLanguageStrategy
              onStrategyParsed={(parsedStrategy) => {
                const config = parsedStrategy.configuration || {};
                setFormData(prev => ({
                  ...prev,
                  strategyName: parsedStrategy.strategy_name,
                  notes: parsedStrategy.parsing_metadata.original_prompt,
                  selectedCoins: config.selectedCoins || prev.selectedCoins,
                  buyOrderType: config.buyOrderType || prev.buyOrderType,
                  sellOrderType: config.sellOrderType || prev.sellOrderType,
                  takeProfitPercentage: config.takeProfitPercentage || prev.takeProfitPercentage,
                  stopLossPercentage: config.stopLossPercentage || prev.stopLossPercentage,
                  maxOpenPositions: config.maxOpenPositions || prev.maxOpenPositions,
                  perTradeAllocation: config.perTradeAllocation || prev.perTradeAllocation,
                  allocationUnit: config.allocationUnit || prev.allocationUnit,
                  maxWalletExposure: config.maxWalletExposure || prev.maxWalletExposure,
                  buyFrequency: config.buyFrequency || prev.buyFrequency,
                  enableDCA: config.enableDCA || prev.enableDCA,
                  dcaIntervalHours: config.dcaIntervalHours || prev.dcaIntervalHours,
                  dcaSteps: config.dcaSteps || prev.dcaSteps,
                  category: parsedStrategy.required_categories?.[0] || prev.category,
                  riskProfile: parsedStrategy.risk_level?.toLowerCase() === 'low' ? 'low' : 
                             parsedStrategy.risk_level?.toLowerCase() === 'high' ? 'high' : 'medium'
                }));
                setCreateMode(CREATE_MODES.MANUAL);
                toast({
                  title: "Strategy Generated!",
                  description: "AI has created your strategy. Review and adjust the settings as needed.",
                });
              }}
              onCancel={() => {
                setShowModeSelection(true);
                setCreateMode(CREATE_MODES.MANUAL);
              }}
            />
          </div>
        )}

        {/* Manual Configuration Interface */}
        {createMode === CREATE_MODES.MANUAL && (
        <>
          {/* Header */}
          <div className="p-4 md:p-6 border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-10">
            {/* Mobile: Stack everything vertically */}
            <div className="flex flex-col gap-4 md:hidden">
              {/* Back button and title row */}
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
              </div>
              
              {/* Title and subtitle row */}
              <div>
                <h1 className="text-xl font-bold text-foreground">
                  {isEditing ? 'Edit Strategy' : 'Create Strategy'}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {isEditing ? 'Modify your existing trading strategy' : 'Design your automated trading strategy'}
                </p>
              </div>
              
              {/* Action buttons row */}
              <div className="flex items-center gap-3 flex-wrap">
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

            {/* Desktop: Original horizontal layout */}
            <div className="hidden md:flex items-center justify-between">
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
          </div>

          {/* Mobile Tabs */}
          {renderMobileTabs()}

          {/* Main Content */}
          <div className="flex-1 flex overflow-hidden">
            {/* Desktop Sidebar */}
            {renderSidebar()}
            
            {/* Content Area */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
              <div className="p-4 lg:p-6">
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
                            <TooltipField 
                              description="Name your strategy to recognize it later."
                              examples={["Call this my scalping strategy", "Name it medium test bot"]}
                            >
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
                            <TooltipField 
                              description="Describe your strategy goals, ideas, or market assumptions."
                              examples={["Note that this strategy follows bullish breakouts", "This is my DCA swing bot"]}
                            >
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
                            <TooltipField 
                              description="Choose a risk level to set your default stop-loss, take-profit, and position limits."
                              examples={["I want a medium-risk setup", "Make it aggressive", "Use a conservative approach"]}
                            >
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

                  {/* Notifications Section */}
                  {activeSection === 'notifications' && (
                    <div className="space-y-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Bell className="h-5 w-5" />
                            Notification Settings
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            Configure when and how you'll be notified about trading activities. Smart notifications help you stay informed without overwhelming you.
                          </p>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <TooltipField 
                                  description="Get alerts when your strategy buys or sells."
                                  examples={["Let me know when a trade happens", "Notify me on every execution"]}
                                >
                                  <Label>Trade Notifications</Label>
                                </TooltipField>
                                <p className="text-sm text-muted-foreground">Notify on buy/sell executions</p>
                              </div>
                              <Switch
                                checked={formData.notifyOnTrade}
                                onCheckedChange={(checked) => updateFormData('notifyOnTrade', checked)}
                              />
                            </div>

                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <TooltipField 
                                  description="Be alerted if there's a problem with order execution or system logic."
                                  examples={["Tell me if something fails", "Warn me if a trade can't go through"]}
                                >
                                  <Label>Error Notifications</Label>
                                </TooltipField>
                                <p className="text-sm text-muted-foreground">Alert on trading errors or issues</p>
                              </div>
                              <Switch
                                checked={formData.notifyOnError}
                                onCheckedChange={(checked) => updateFormData('notifyOnError', checked)}
                              />
                            </div>

                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <TooltipField 
                                  description="Receive alerts when profit or loss targets are hit."
                                  examples={["Notify me when I hit my profit goal", "Let me know if a stop-loss triggers"]}
                                >
                                  <Label>Target Notifications</Label>
                                </TooltipField>
                                <p className="text-sm text-muted-foreground">Alert on profit/loss targets hit</p>
                              </div>
                              <Switch
                                checked={formData.notifyOnTargets}
                                onCheckedChange={(checked) => updateFormData('notifyOnTargets', checked)}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* AI Intelligence Section */}
                  {activeSection === 'ai-intelligence' && (
                    <div className="space-y-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Brain className="h-5 w-5" />
                            AI Intelligence Settings
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          <div className="flex items-center justify-between">
                            <div>
                              <Label htmlFor="enable-ai">Enable AI Intelligence</Label>
                              <p className="text-sm text-muted-foreground mt-1">
                                Allow AI to analyze market data and provide trading signals
                              </p>
                            </div>
                            <Switch
                              id="enable-ai"
                              checked={formData.aiIntelligenceConfig.enableAIOverride}
                              onCheckedChange={(value) => {
                                // Use single source of truth - update aiIntelligenceConfig.enableAIOverride directly
                                updateFormData('aiIntelligenceConfig', { 
                                  ...formData.aiIntelligenceConfig, 
                                  enableAIOverride: value 
                                });
                              }}
                            />
                          </div>
                          
                          {formData.aiIntelligenceConfig.enableAIOverride && (
                            <div className="space-y-4 border-l-2 border-primary/20 pl-4">
                              <AIIntelligenceSettings
                                config={formData.aiIntelligenceConfig}
                                onConfigChange={(newConfig) => updateFormData('aiIntelligenceConfig', newConfig)}
                              />
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Buy Settings Section */}
                  {activeSection === 'buy-settings' && (
                    <div className="space-y-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <TrendingUp className="h-5 w-5" />
                            Buy Settings
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            Control how your strategy enters positions. These settings determine order types, timing, and execution behavior for buy orders.
                          </p>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          <div className="space-y-4">
                            <TooltipField 
                              description="Decide how buy orders are placed — instantly, at a fixed price, or after a price drop."
                              examples={["Buy instantly", "Use trailing buy", "Set a limit to enter at a lower price"]}
                            >
                              <Label>Buy Order Type</Label>
                            </TooltipField>
                            <Select value={formData.buyOrderType} onValueChange={(value: any) => updateFormData('buyOrderType', value)}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="market">Market Order</SelectItem>
                                <SelectItem value="limit">Limit Order</SelectItem>
                                <SelectItem value="trailing_buy">Trailing Buy</SelectItem>
                              </SelectContent>
                            </Select>

                            <div className="space-y-2">
                              <TooltipField 
                                description="Choose how often your strategy should buy — on signals, schedules, or once."
                                examples={["Buy on signals only", "Buy every 15 minutes", "Just buy once"]}
                              >
                                <Label>Buy Frequency</Label>
                              </TooltipField>
                              <Select value={formData.buyFrequency} onValueChange={(value: any) => updateFormData('buyFrequency', value)}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="once">One-time purchase</SelectItem>
                                  <SelectItem value="daily">Daily</SelectItem>
                                  <SelectItem value="interval">Custom interval</SelectItem>
                                  <SelectItem value="signal_based">Signal-based</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            {formData.buyFrequency === 'interval' && (
                              <div className="space-y-2">
                                <TooltipField 
                                  description="Minutes between buy attempts when using interval-based buying."
                                  examples={["Buy every 15 minutes", "Set interval to 60 minutes"]}
                                >
                                  <Label>Buy Interval (minutes)</Label>
                                </TooltipField>
                                <Input
                                  type="number"
                                  value={formData.buyIntervalMinutes}
                                  onChange={(e) => updateFormData('buyIntervalMinutes', parseInt(e.target.value) || 60)}
                                  min={1}
                                  max={1440}
                                />
                              </div>
                            )}

                            <div className="space-y-2">
                                <TooltipField 
                                  description="Add a delay between buys to prevent overtrading."
                                  examples={["Wait 30 minutes before buying again", "Add a cooldown of 1 hour"]}
                                >
                                  <Label>Buy Cooldown (minutes)</Label>
                                </TooltipField>
                              <Input
                                type="number"
                                value={formData.buyCooldownMinutes}
                                onChange={(e) => updateFormData('buyCooldownMinutes', parseInt(e.target.value) || 60)}
                                min={0}
                                max={1440}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Strategy Section */}
                  {activeSection === 'strategy' && (
                    <div className="space-y-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Target className="h-5 w-5" />
                            Strategy Configuration
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            Core strategy parameters that define your trading approach, risk management, and position sizing. These settings form the foundation of your automated trading behavior.
                          </p>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <TooltipField 
                                  description="Cap how much of your capital this strategy is allowed to use."
                                  examples={["Use up to 50% of my funds", "Don't go over 20%"]}
                                >
                                  <Label>Max Wallet Exposure (%)</Label>
                                </TooltipField>
                                <Slider
                                  value={[formData.maxWalletExposure]}
                                  onValueChange={([value]) => updateFormData('maxWalletExposure', value)}
                                  max={100}
                                  min={1}
                                  step={1}
                                  className="w-full"
                                />
                                <div className="text-sm text-muted-foreground">
                                  Current: {formData.maxWalletExposure}%
                                </div>
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="space-y-2">
                                <TooltipField 
                                  description="Stop trading once this daily profit level is reached."
                                  examples={["Stop trading after 3% gain", "Pause the bot when it earns enough for the day"]}
                                >
                                  <Label>Daily Profit Target (%)</Label>
                                </TooltipField>
                                <Input
                                  type="number"
                                  step="0.1"
                                  value={formData.dailyProfitTarget}
                                  onChange={(e) => updateFormData('dailyProfitTarget', parseFloat(e.target.value) || 0)}
                                  min={0}
                                  max={100}
                                />
                              </div>

                              <div className="space-y-2">
                                <TooltipField 
                                  description="Pause trading if this loss threshold is hit in a day."
                                  examples={["Limit daily loss to 2%", "Shut it down if I lose 5%"]}
                                >
                                  <Label>Daily Loss Limit (%)</Label>
                                </TooltipField>
                                <Input
                                  type="number"
                                  step="0.1"
                                  value={formData.dailyLossLimit}
                                  onChange={(e) => updateFormData('dailyLossLimit', parseFloat(e.target.value) || 0)}
                                  min={0}
                                  max={100}
                                />
                              </div>

                              <div className="space-y-2">
                                <TooltipField 
                                  description="Maximum number of trades allowed per day. Helps prevent overtrading and manage risk."
                                  examples={["Limit to 20 trades per day", "Allow maximum 10 trades daily", "Set daily trade limit to 50"]}
                                >
                                  <Label>Max Trades Per Day</Label>
                                </TooltipField>
                                <Input
                                  type="number"
                                  step="1"
                                  value={formData.maxTradesPerDay}
                                  onChange={(e) => updateFormData('maxTradesPerDay', parseInt(e.target.value) || 50)}
                                  min={1}
                                  max={200}
                                />
                              </div>

                              <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                  <TooltipField 
                                    description="Run the strategy on past market data to validate performance before going live."
                                    examples={["Test this on historical charts", "Backtest it first"]}
                                  >
                                    <Label>Backtesting Mode</Label>
                                  </TooltipField>
                                  <p className="text-sm text-muted-foreground">Test on historical data</p>
                                </div>
                                <Switch
                                  checked={formData.backtestingMode}
                                  onCheckedChange={(checked) => updateFormData('backtestingMode', checked)}
                                />
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Trailing Stop-Buy Section */}
                  {activeSection === 'trailing-stop-buy' && (
                    <div className="space-y-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Timer className="h-5 w-5" />
                            Trailing Stop-Buy
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            Configure trailing buy orders that follow the price downward, helping you enter positions at better prices during market dips.
                          </p>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <TooltipField 
                                description="Percentage below the lowest price seen that the trailing buy order will trigger."
                                examples={["Trail by 1.5%", "Set trailing buy at 2%"]}
                              >
                                <Label>Trailing Buy Percentage (%)</Label>
                              </TooltipField>
                              <Slider
                                value={[formData.trailingBuyPercentage]}
                                onValueChange={([value]) => updateFormData('trailingBuyPercentage', value)}
                                max={10}
                                min={0.1}
                                step={0.1}
                                className="w-full"
                              />
                              <div className="text-sm text-muted-foreground">
                                Current: {formData.trailingBuyPercentage}%
                              </div>
                            </div>

                            <div className="bg-muted/30 p-4 rounded-lg">
                              <h4 className="font-medium mb-2">How Trailing Buy Works:</h4>
                              <ul className="text-sm text-muted-foreground space-y-1">
                                <li>• Monitors price as it falls from the initial trigger point</li>
                                <li>• Adjusts buy order to stay {formData.trailingBuyPercentage}% below the lowest price seen</li>
                                <li>• Executes when price starts rising again</li>
                                <li>• Helps catch better entry points during market dips</li>
                              </ul>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Sell Strategy Section */}
                  {activeSection === 'sell-strategy' && (
                    <div className="space-y-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <BarChart3 className="h-5 w-5" />
                            Sell Strategy
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            Advanced selling configuration that defines when and how positions are closed. These settings work together with your basic sell settings to optimize exit timing.
                          </p>
                        </CardHeader>
                         <CardContent className="space-y-6">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <TooltipField 
                                  description="Only use trailing stops, ignore regular stop losses."
                                  examples={["Use only trailing stops", "Disable regular stop losses"]}
                                >
                                  <Label>Use Trailing Stop Only</Label>
                                </TooltipField>
                                <p className="text-sm text-muted-foreground">Ignore regular stop-losses, use trailing only</p>
                              </div>
                              <Switch
                                checked={formData.useTrailingStopOnly || false}
                                onCheckedChange={(checked) => updateFormData('useTrailingStopOnly', checked)}
                              />
                            </div>

                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <TooltipField 
                                  description="Reset stop-loss to original level if it fails to execute."
                                  examples={["Reset stops if they fail", "Retry failed stop orders"]}
                                >
                                  <Label>Reset Stop-Loss After Fail</Label>
                                </TooltipField>
                                <p className="text-sm text-muted-foreground">Retry failed stop-losses</p>
                              </div>
                              <Switch
                                checked={formData.resetStopLossAfterFail}
                                onCheckedChange={(checked) => updateFormData('resetStopLossAfterFail', checked)}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}



                  {/* Shorting Settings Section */}
                  {activeSection === 'shorting-settings' && (
                    <div className="space-y-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <TrendingDown className="h-5 w-5" />
                            Shorting Settings
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            Configure short selling capabilities to profit from declining markets. Advanced feature requiring careful risk management and market knowledge.
                          </p>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <TooltipField 
                                  description="Enable short selling to profit from declining prices."
                                  examples={["Allow shorting", "Enable betting against price"]}
                                >
                                  <Label>Enable Shorting</Label>
                                </TooltipField>
                                <p className="text-sm text-muted-foreground">Allow short positions</p>
                              </div>
                              <Switch
                                checked={formData.enableShorting}
                                onCheckedChange={(checked) => updateFormData('enableShorting', checked)}
                              />
                            </div>

                            {formData.enableShorting && (
                              <>
                                <div className="space-y-2">
                                  <TooltipField 
                                    description="Maximum number of short positions that can be open simultaneously."
                                    examples={["Allow 3 short positions max", "Limit shorts to 2"]}
                                  >
                                    <Label>Max Short Positions</Label>
                                  </TooltipField>
                                  <Input
                                    type="number"
                                    value={formData.maxShortPositions}
                                    onChange={(e) => updateFormData('maxShortPositions', parseInt(e.target.value) || 1)}
                                    min={1}
                                    max={10}
                                  />
                                </div>

                                <div className="space-y-2">
                                  <TooltipField 
                                    description="Minimum profit percentage to target when shorting."
                                    examples={["Target 2% profit on shorts", "Set short profit goal"]}
                                  >
                                    <Label>Shorting Min Profit (%)</Label>
                                  </TooltipField>
                                  <Slider
                                    value={[formData.shortingMinProfitPercentage]}
                                    onValueChange={([value]) => updateFormData('shortingMinProfitPercentage', value)}
                                    max={10}
                                    min={0.5}
                                    step={0.1}
                                    className="w-full"
                                  />
                                  <div className="text-sm text-muted-foreground">
                                    Current: {formData.shortingMinProfitPercentage}%
                                  </div>
                                </div>

                                <div className="flex items-center justify-between">
                                  <div className="space-y-1">
                                    <TooltipField 
                                      description="Automatically close short positions when conditions are met."
                                      examples={["Auto-close when profitable", "Exit shorts automatically"]}
                                    >
                                      <Label>Auto-Close Shorts</Label>
                                    </TooltipField>
                                    <p className="text-sm text-muted-foreground">Automatic short position closing</p>
                                  </div>
                                  <Switch
                                    checked={formData.autoCloseShorts}
                                    onCheckedChange={(checked) => updateFormData('autoCloseShorts', checked)}
                                  />
                                </div>

                                <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border border-red-200 dark:border-red-800">
                                  <h4 className="font-medium text-red-800 dark:text-red-200 mb-2">⚠️ Shorting Risks:</h4>
                                  <ul className="text-sm text-red-700 dark:text-red-300 space-y-1">
                                    <li>• Unlimited loss potential (prices can rise indefinitely)</li>
                                    <li>• Requires borrowing fees and margin requirements</li>
                                    <li>• Higher complexity and risk than long positions</li>
                                    <li>• Not suitable for beginners</li>
                                  </ul>
                                </div>
                              </>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Dollar Cost Averaging Section */}
                  {activeSection === 'dollar-cost-averaging' && (
                    <div className="space-y-6">
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <DollarSign className="h-5 w-5" />
                            Dollar Cost Averaging (DCA)
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            Reduce timing risk by splitting purchases into smaller, regular intervals. DCA helps smooth out market volatility and potentially improve average entry prices.
                          </p>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <TooltipField 
                                  description="Enable Dollar Cost Averaging to spread purchases over time."
                                  examples={["Use DCA to average down", "Enable dollar cost averaging"]}
                                >
                                  <Label>Enable DCA</Label>
                                </TooltipField>
                                <p className="text-sm text-muted-foreground">Spread purchases over time</p>
                              </div>
                              <Switch
                                checked={formData.enableDCA}
                                onCheckedChange={(checked) => updateFormData('enableDCA', checked)}
                              />
                            </div>

                            {formData.enableDCA && (
                              <>
                                <div className="space-y-2">
                                  <TooltipField 
                                    description="Hours between each DCA purchase."
                                    examples={["Buy every 12 hours", "DCA every 24 hours"]}
                                  >
                                    <Label>DCA Interval (hours)</Label>
                                  </TooltipField>
                                  <Select 
                                    value={formData.dcaIntervalHours.toString()} 
                                    onValueChange={(value) => updateFormData('dcaIntervalHours', parseInt(value))}
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="1">1 hour</SelectItem>
                                      <SelectItem value="4">4 hours</SelectItem>
                                      <SelectItem value="8">8 hours</SelectItem>
                                      <SelectItem value="12">12 hours</SelectItem>
                                      <SelectItem value="24">24 hours (daily)</SelectItem>
                                      <SelectItem value="72">72 hours (3 days)</SelectItem>
                                      <SelectItem value="168">168 hours (weekly)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="space-y-2">
                                  <TooltipField 
                                    description="Number of DCA steps to complete the full position."
                                    examples={["Use 5 DCA steps", "Complete in 3 purchases"]}
                                  >
                                    <Label>DCA Steps</Label>
                                  </TooltipField>
                                  <Input
                                    type="number"
                                    value={formData.dcaSteps}
                                    onChange={(e) => updateFormData('dcaSteps', parseInt(e.target.value) || 3)}
                                    min={2}
                                    max={20}
                                  />
                                  <div className="text-sm text-muted-foreground">
                                    Each step will be {(100 / formData.dcaSteps).toFixed(1)}% of the total allocation
                                  </div>
                                </div>

                                <div className="bg-muted/30 p-4 rounded-lg">
                                  <h4 className="font-medium mb-2">DCA Schedule Preview:</h4>
                                  <div className="text-sm text-muted-foreground space-y-1">
                                    <p>• Total steps: {formData.dcaSteps}</p>
                                    <p>• Per step: {(100 / formData.dcaSteps).toFixed(1)}% of allocation</p>
                                    <p>• Interval: Every {formData.dcaIntervalHours} hours</p>
                                    <p>• Total duration: {(formData.dcaSteps - 1) * formData.dcaIntervalHours} hours</p>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
                                    <h5 className="font-medium text-green-800 dark:text-green-200 mb-1">DCA Benefits:</h5>
                                    <ul className="text-sm text-green-700 dark:text-green-300 space-y-1">
                                      <li>• Reduces timing risk</li>
                                      <li>• Smooths out volatility</li>
                                      <li>• Disciplined approach</li>
                                      <li>• Lower average cost in choppy markets</li>
                                    </ul>
                                  </div>
                                  
                                  <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                                    <h5 className="font-medium text-blue-800 dark:text-blue-200 mb-1">Best For:</h5>
                                    <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                                      <li>• Long-term accumulation</li>
                                      <li>• Volatile markets</li>
                                      <li>• Large position sizes</li>
                                      <li>• Risk-averse strategies</li>
                                    </ul>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
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
        </>
        )}
      </div>
    </>
  );
};