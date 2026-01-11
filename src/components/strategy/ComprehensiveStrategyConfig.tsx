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
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { logger } from '@/utils/logger';
import { UnifiedDecisionsConfig } from './UnifiedDecisionsConfig';
import { CoinsAmountsPanel } from './CoinsAmountsPanel';
import { PerformancePanel } from './PerformancePanel';
import { SellSettingsPanel } from './SellSettingsPanel';
import { AdvancedSymbolOverridesPanel } from './AdvancedSymbolOverridesPanel';
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
  Brain,
  Lock,
  Download
} from 'lucide-react';
import { serializeStrategy, generateExportFilename, downloadStrategyAsJson } from '@/utils/strategySerializer';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTradeViewFilter';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import NaturalLanguageStrategy from './NaturalLanguageStrategy';
import { AIIntelligenceSettings, AIIntelligenceConfig } from './AIIntelligenceSettings';
import { TechnicalIndicatorSettings, TechnicalIndicatorConfig } from './TechnicalIndicatorSettings';
import { PoolExitManagementPanel } from './PoolExitManagementPanel';
import { ExecutionSettingsPanel } from './ExecutionSettingsPanel';
import { DeprecatedFieldsPanel } from './DeprecatedFieldsPanel';

import { getAllSymbols } from '@/data/coinbaseCoins';
import { getUnsupportedSymbols } from '@/utils/marketAvailability';
import { 
  getPresetByRiskProfile, 
  applyPresetToFormData, 
  RISK_PROFILE_DESCRIPTIONS,
  LOW_RISK_PRESET,
  MEDIUM_RISK_PRESET,
  HIGH_RISK_PRESET,
  PRESET_RISK_FIELDS,
  isFieldLocked,
  SECTION_DESCRIPTIONS,
  formatDuration,
  type StrategyPreset
} from '@/utils/strategyPresets';
import { RiskFieldLabel, SectionHeader } from './DimensionBadge';

// ScalpSmart Strategy Configuration
const SCALPSMART_PRESET = {
  signalFusion: {
    enabled: true,
    enterThreshold: 0.65,
    exitThreshold: 0.35,
    conflictPenalty: 0.3,
    weights: {
      trend: 0.30,
      volatility: 0.15,
      momentum: 0.25,
      whale: 0.15,
      sentiment: 0.15
    }
  },
  contextGates: {
    spread: { enabled: true, maxBps: 12 },
    liquidity: { enabled: true, minDepthRatio: 3.0 },
    whaleConflict: { enabled: true, windowMinutes: 5 }
  },
  brackets: {
    stopLossPctWhenNotAtr: 0.40,
    trailBufferPct: 0.4,
    enforceRiskReward: true,
    minTpSlRatio: 1.2,
    atrScaled: false,
    atrMultipliers: { tp: 2.6, sl: 2.0 }
  }
};

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
  trailingStopMinProfitThreshold: number;
  autoCloseAfterHours: number;
  maxTotalTrades: number;
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
  resetStopLossAfterFail: boolean;
  useTrailingStopOnly: boolean;
  // Tags and categories
  category: string;
  tags: string[];
  // AI Intelligence settings - enableAIOverride is the single source of truth
  aiIntelligenceConfig: AIIntelligenceConfig;
  // Technical Indicators settings
  technicalIndicatorConfig: TechnicalIndicatorConfig;
  // Minimum confidence threshold for trading decisions (0-1)
  min_confidence: number;
  // Signal Fusion (Phase 1B telemetry)
  enableSignalFusion?: boolean;
  // Test Mode (per-strategy)
  is_test_mode?: boolean;
  // ScalpSmart settings
  signalFusion?: {
    enabled: boolean;
    enterThreshold?: number;
    exitThreshold?: number;
    conflictPenalty?: number;
    weights?: {
      trend: number;
      volatility: number;
      momentum: number;
      whale: number;
      sentiment: number;
    };
  };
  contextGates?: {
    spread?: { enabled: boolean; maxBps: number };
    liquidity?: { enabled: boolean; minDepthRatio: number };
    whaleConflict?: { enabled: boolean; windowMinutes: number };
  };
  brackets?: {
    stopLossPctWhenNotAtr?: number;
    trailBufferPct?: number;
    enforceRiskReward?: boolean;
    minTpSlRatio?: number;
    atrScaled?: boolean;
    atrMultipliers?: { tp: number; sl: number };
  };
  // Pool Exit Management settings (Agent-aware)
  poolExitConfig: {
    pool_enabled: boolean;
    secure_pct: number;
    secure_tp_pct: number;
    secure_sl_pct?: number;
    runner_trail_pct: number;
    runner_arm_pct: number;
    qty_tick: number;
    price_tick: number;
    min_order_notional: number;
  };
  // Unified Decisions configuration
  unifiedConfig?: {
    enableUnifiedDecisions: boolean;
    minHoldPeriodMs: number;
    cooldownBetweenOppositeActionsMs: number;
    confidenceOverrideThreshold: number;
  };
  // Market Quality Gates (USER-CONTROLLED - not AI override)
  spreadThresholdBps: number;    // Max allowed spread in basis points (0.1 - 200)
  priceStaleMaxMs: number;       // Max allowed price staleness in milliseconds (1000 - 60000)
  minDepthRatio: number;         // Min liquidity depth ratio (0 - 3)
  
  // === STABILIZATION GATES (consumed by coordinator) ===
  minTrendScoreForBuy: number;       // 0-1, minimum trend score for BUY
  minMomentumScoreForBuy: number;    // 0-1, minimum momentum score for BUY
  maxVolatilityScoreForBuy: number;  // 0-1, maximum volatility score for BUY
  stopLossCooldownMs: number;        // ms to wait after SL exit before re-entry
  minEntrySpacingMs: number;         // ms minimum between entries on same symbol
  
  // Execution Settings
  executionSettings: {
    execution_mode: 'COINBASE' | 'ONCHAIN';
    chain_id: number;
    slippage_bps_default: number;
    preferred_providers: string[];
    mev_policy: 'auto' | 'force_private' | 'cow_only';
    max_gas_cost_pct: number;
    max_price_impact_bps: number;
    max_quote_age_ms: number;
  };
}

interface ComprehensiveStrategyConfigProps {
  onBack: () => void;
  existingStrategy?: any;
  isEditing?: boolean;
  isCollapsed?: boolean;
  initialFormData?: Record<string, any>; // For import functionality
}

// Create Strategy Mode Options
const CREATE_MODES = {
  MANUAL: 'manual',
  AI_AGENT: 'ai_agent'
} as const;

type CreateMode = typeof CREATE_MODES[keyof typeof CREATE_MODES];

// Risk presets now imported from strategyPresets.ts
// Using the real 11 effective levers that actually control backend behavior

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
    id: 'signals',
    title: 'SIGNALS',
    items: [
      { id: 'ai-intelligence', label: 'AI Intelligence Settings', icon: MessageCircle },
      { id: 'technical-indicators', label: 'Technical Indicators', icon: BarChart3 }
    ]
  },
  {
    id: 'risk',
    title: 'RISK (Preset-driven)',
    items: [
      { id: 'coins-amounts', label: 'Coins & Amounts', icon: Coins },
      { id: 'strategy', label: 'Risk & Limits', icon: Target },
      { id: 'sell-settings', label: 'Sell Settings', icon: TrendingDown }
    ]
  },
  {
    id: 'execution',
    title: 'EXECUTION',
    items: [
      { id: 'pool-exit-management', label: 'Pool Exit Management', icon: Shield },
      { id: 'unified-decisions', label: 'Unified Decisions', icon: Shield },
      { id: 'execution-settings', label: 'Execution Settings', icon: Settings }
    ]
  },
  {
    id: 'advanced',
    title: 'ADVANCED',
    items: [
      { id: 'advanced-overrides', label: 'Per-Symbol Overrides & Safety', icon: Shield },
      { id: 'deprecated-features', label: 'Deprecated / Inactive Features', icon: AlertTriangle }
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
  isCollapsed = false,
  initialFormData
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
    trailingStopMinProfitThreshold: 1,
    autoCloseAfterHours: 24,
    maxTotalTrades: 200,
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
    resetStopLossAfterFail: false,
    useTrailingStopOnly: false,
    category: 'trend',
    tags: ['automated', 'scalping'],
    aiIntelligenceConfig: {
      enableAIOverride: false,
      autonomy: { level: 25 },
      features: {
        fusion: {
          enabled: false,
          weights: {
            trend: 0.25,
            volatility: 0.20,
            momentum: 0.25,
            whale: 0.15,
            sentiment: 0.15
          },
          enterThreshold: 0.65,
          exitThreshold: 0.35,
          conflictPenalty: 0.30
        },
        contextGates: {
          spreadThresholdBps: 20,
          minDepthRatio: 2.0,
          whaleConflictWindowMs: 600000
        },
        bracketPolicy: {
          atrScaled: false,
          stopLossPctWhenNotAtr: 0.40,
          trailBufferPct: 0.40,
          enforceRiskReward: true,
          minTpSlRatio: 1.2,
          atrMultipliers: { tp: 2.6, sl: 2.0 }
        },
        overridesPolicy: {
          allowedKeys: ["tpPct", "slPct", "enterThreshold", "exitThreshold"],
          bounds: { slPct: [0.15, 1.00], tpOverSlMin: 1.2 },
          ttlMs: 900000
        }
      },
      aiConfidenceThreshold: 70,
      enablePatternRecognition: true,
      patternLookbackHours: 24,
      crossAssetCorrelation: false,
      marketStructureAnalysis: false,
      enableExternalSignals: true,
      whaleActivityWeight: 0.3,
      sentimentWeight: 0.2,
      newsImpactWeight: 0.25,
      socialSignalsWeight: 0.15,
      decisionMode: 'balanced',
      escalationThreshold: 80,
      riskOverrideAllowed: false,
      enableLearning: false,
      adaptToPerformance: true,
      learningRate: 0.1,
      explainDecisions: true,
      alertOnAnomalies: true,
      alertOnOverrides: true,
      customInstructions: ""
    },
    poolExitConfig: {
      pool_enabled: false,
      secure_pct: 0.4, // 40% secure portion
      secure_tp_pct: 0.7, // +0.7% target
      secure_sl_pct: 0.6, // -0.6% floor until TP (optional)
      runner_trail_pct: 1.0, // 1% trailing distance
      runner_arm_pct: 0.5, // arm at +0.5% profit
      qty_tick: 0.00000001, // default precision
      price_tick: 0.01, // default price precision
      min_order_notional: 10 // minimum order size in EUR
    },
    min_confidence: 0.65, // Default minimum confidence threshold (0-1)
    enableSignalFusion: false, // Phase 1B: Signal fusion telemetry (read-only, no behavior change)
    technicalIndicatorConfig: {
      rsi: {
        enabled: true,
        period: 14,
        buyThreshold: 30,
        sellThreshold: 70,
      },
      macd: {
        enabled: true,
        fast: 12,
        slow: 26,
        signal: 9,
      },
      ema: {
        enabled: true,
        shortPeriod: 12,
        longPeriod: 26,
      },
      sma: {
        enabled: false,
        period: 20,
      },
      bollinger: {
        enabled: false,
        period: 20,
        stdDev: 2,
      },
      adx: {
        enabled: false,
        period: 14,
        threshold: 25,
      },
      stochasticRSI: {
        enabled: false,
        rsiPeriod: 14,
        stochPeriod: 14,
        kPeriod: 3,
        dPeriod: 3,
      },
    },
    executionSettings: {
      execution_mode: 'COINBASE',
      chain_id: 8453,
      slippage_bps_default: 50,
      preferred_providers: ['0x', 'cow', '1inch', 'uniswap'],
      mev_policy: 'auto',
      max_gas_cost_pct: 0.35,
      max_price_impact_bps: 40,
      max_quote_age_ms: 1500
    },
    // Market Quality Gates - USER CONTROLLED (default: permissive but safe)
    spreadThresholdBps: 25,      // 25 bps = 0.25% max spread
    priceStaleMaxMs: 15000,      // 15 seconds max price staleness
    minDepthRatio: 0.2,          // Low depth requirement
    
    // === STABILIZATION GATES (consumed by coordinator) ===
    // These are the effective risk levers that control entry quality
    minTrendScoreForBuy: MEDIUM_RISK_PRESET.minTrendScoreForBuy,       // 0-1 scale
    minMomentumScoreForBuy: MEDIUM_RISK_PRESET.minMomentumScoreForBuy, // 0-1 scale
    maxVolatilityScoreForBuy: MEDIUM_RISK_PRESET.maxVolatilityScoreForBuy, // 0-1 scale
    stopLossCooldownMs: MEDIUM_RISK_PRESET.stopLossCooldownMs,         // 10 minutes
    minEntrySpacingMs: MEDIUM_RISK_PRESET.minEntrySpacingMs,           // 15 minutes
  });

  // Apply risk profile presets - uses ALL effective risk levers
  const handleRiskProfileChange = (riskProfile: 'low' | 'medium' | 'high' | 'custom') => {
    const preset = getPresetByRiskProfile(riskProfile);
    
    if (preset) {
      // Apply ALL effective risk levers from preset
      setFormData(prev => ({
        ...prev,
        riskProfile: preset.riskProfile,
        // Position Sizing
        maxWalletExposure: preset.maxWalletExposure,
        perTradeAllocation: preset.perTradeAllocation,
        maxActiveCoins: preset.maxActiveCoins,
        // Exit Thresholds
        takeProfitPercentage: preset.takeProfitPercentage,
        stopLossPercentage: preset.stopLossPercentage,
        trailingStopLossPercentage: preset.trailingStopLossPercentage,
        // Confidence
        min_confidence: preset.min_confidence,
        // Signal Gates (CRITICAL - these are enforced by coordinator)
        minTrendScoreForBuy: preset.minTrendScoreForBuy,
        minMomentumScoreForBuy: preset.minMomentumScoreForBuy,
        maxVolatilityScoreForBuy: preset.maxVolatilityScoreForBuy,
        // Timing Gates
        stopLossCooldownMs: preset.stopLossCooldownMs,
        minEntrySpacingMs: preset.minEntrySpacingMs,
      }));
    } else {
      // Custom mode - just update the profile, keep all other values
      setFormData(prev => ({ ...prev, riskProfile }));
    }
  };

  // Load initial form data from import (if provided)
  useEffect(() => {
    if (initialFormData && !existingStrategy) {
      setFormData(prev => ({
        ...prev,
        ...initialFormData,
        // Ensure nested configs are merged properly
        aiIntelligenceConfig: {
          ...prev.aiIntelligenceConfig,
          ...initialFormData.aiIntelligenceConfig
        },
        technicalIndicatorConfig: {
          ...prev.technicalIndicatorConfig,
          ...initialFormData.technicalIndicatorConfig
        },
        poolExitConfig: {
          ...prev.poolExitConfig,
          ...initialFormData.poolExitConfig
        },
        executionSettings: {
          ...prev.executionSettings,
          ...initialFormData.executionSettings
        },
        unifiedConfig: {
          ...prev.unifiedConfig,
          ...initialFormData.unifiedConfig
        },
      }));
    }
  }, [initialFormData, existingStrategy]);

  // Load existing strategy data
  useEffect(() => {
    if (existingStrategy?.configuration) {
      const config = existingStrategy.configuration;
      
      // Load execution settings from database columns (not configuration JSON)
      const executionSettingsFromDb = {
        execution_mode: (existingStrategy as any).execution_mode || 'COINBASE',
        chain_id: (existingStrategy as any).chain_id || 8453,
        slippage_bps_default: (existingStrategy as any).slippage_bps_default || 50,
        preferred_providers: (existingStrategy as any).preferred_providers || ['0x', 'cow', '1inch', 'uniswap'],
        mev_policy: (existingStrategy as any).mev_policy || 'auto',
        max_gas_cost_pct: (existingStrategy as any).max_gas_cost_pct || 0.35,
        max_price_impact_bps: (existingStrategy as any).max_price_impact_bps || 40,
        max_quote_age_ms: (existingStrategy as any).max_quote_age_ms || 1500
      };
      
      setFormData(prev => ({ 
        ...prev, 
        ...config,
        // Market Quality Gates - use config values or safe defaults
        spreadThresholdBps: config.spreadThresholdBps ?? prev.spreadThresholdBps ?? 25,
        minDepthRatio: config.minDepthRatio ?? prev.minDepthRatio ?? 0.2,
        // Properly merge the nested aiIntelligenceConfig with existing enableAIOverride
        aiIntelligenceConfig: {
          ...prev.aiIntelligenceConfig,
          ...config.aiIntelligenceConfig
        },
        // Properly merge technical indicator config
        technicalIndicatorConfig: {
          ...prev.technicalIndicatorConfig,
          ...config.technicalIndicatorConfig
        },
        // Load execution settings from database columns
        executionSettings: executionSettingsFromDb
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
            selectedCoins: formData.selectedCoins || getAllSymbols().slice(0, 5) // Use strategy's selected coins or sensible default
          } as any,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id)
        .eq('strategy_name', 'High Risk Momentum Trader');

      if (error) throw error;
    } catch (error: any) {
      logger.error('Error updating strategy:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    // Validation: strategy name required
    if (!formData.strategyName?.trim()) {
      toast({
        title: "Validation Error",
        description: "Strategy name is required.",
        variant: "destructive"
      });
      return;
    }

    // =========================================================================
    // CANONICAL CONFIG ENFORCEMENT
    // These 7 keys MUST exist at the root level of configuration for coordinator.
    // If UI values are missing, use sensible defaults.
    // =========================================================================
    const canonicalMinHoldPeriodMs = 
      formData.unifiedConfig?.minHoldPeriodMs ?? 
      formData.aiIntelligenceConfig?.features?.contextGates?.whaleConflictWindowMs ?? 
      120000; // Default: 2 minutes

    const canonicalCooldownMs = 
      formData.unifiedConfig?.cooldownBetweenOppositeActionsMs ?? 
      30000; // Default: 30 seconds

    const canonicalAiConfidenceThreshold = 
      formData.aiIntelligenceConfig?.aiConfidenceThreshold ?? 
      50; // Default: 50%

    // Market quality gates (CANONICAL - must be at root)
    const canonicalPriceStaleMaxMs = 
      formData.priceStaleMaxMs ?? 15000; // Default: 15 seconds
    
    const canonicalSpreadThresholdBps = 
      formData.spreadThresholdBps ?? 30; // Default: 30 bps (0.30%)

    // Validate ranges
    if (canonicalMinHoldPeriodMs < 0 || canonicalCooldownMs < 0 || canonicalAiConfidenceThreshold < 0 || canonicalAiConfidenceThreshold > 100) {
      toast({
        title: "Validation Error",
        description: "Invalid config values: minHoldPeriodMs and cooldownMs must be >= 0, aiConfidenceThreshold must be 0-100.",
        variant: "destructive"
      });
      return;
    }

    try {
      // Build configuration with ALL 7 CANONICAL ROOT KEYS enforced
      const configurationWithCanonicalKeys = {
        ...formData,
        // ======= CANONICAL ROOT KEYS (always written at root for coordinator) =======
        // Timing
        minHoldPeriodMs: canonicalMinHoldPeriodMs,
        cooldownBetweenOppositeActionsMs: canonicalCooldownMs,
        // Confidence
        aiConfidenceThreshold: canonicalAiConfidenceThreshold,
        // TP/SL
        takeProfitPercentage: formData.takeProfitPercentage,
        stopLossPercentage: formData.stopLossPercentage,
        // Market quality gates (NEW CANONICAL KEYS)
        priceStaleMaxMs: canonicalPriceStaleMaxMs,
        spreadThresholdBps: canonicalSpreadThresholdBps,
      };

      const strategyData = {
        user_id: user.id,
        strategy_name: formData.strategyName,
        description: formData.notes || null,
        configuration: configurationWithCanonicalKeys as any,
        test_mode: true, // Always create in test mode
        is_active: false, // Keep for backward compatibility
        updated_at: new Date().toISOString(),
        // Execution settings
        execution_mode: formData.executionSettings.execution_mode,
        chain_id: formData.executionSettings.chain_id,
        slippage_bps_default: formData.executionSettings.slippage_bps_default,
        preferred_providers: formData.executionSettings.preferred_providers,
        mev_policy: formData.executionSettings.mev_policy,
        max_gas_cost_pct: formData.executionSettings.max_gas_cost_pct,
        max_price_impact_bps: formData.executionSettings.max_price_impact_bps,
        max_quote_age_ms: formData.executionSettings.max_quote_age_ms
      };

      if (isEditing && existingStrategy) {
        const { error } = await (supabase as any)
          .from('trading_strategies')
          .update(strategyData)
          .eq('id', existingStrategy.id)
          .eq('user_id', user.id);

        if (error) throw error;
        
        toast({
          title: "Strategy saved",
          description: "Your strategy configuration has been updated successfully.",
        });
        
        onBack();
      } else {
        const { data, error } = await (supabase as any)
          .from('trading_strategies')
          .insert({
            ...strategyData,
            test_mode: true
          })
          .select()
          .single();

        if (error) throw error;

        toast({
          title: "Strategy created",
          description: "Your strategy has been created successfully.",
        });

        setCreatedStrategyId(data.id);
        setShowActivateTestModal(true);
      }
    } catch (error) {
      logger.error('Error saving strategy:', error);
      toast({
        title: "Save Failed",
        description: "Failed to save strategy. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleActivateInTestMode = async () => {
    if (!user || !createdStrategyId) return;

    try {
      // Deactivate any existing test strategies
      await supabase
        .from('trading_strategies')
        .update({ is_active: false })
        .eq('user_id', user.id)
        .neq('id', createdStrategyId);

      // Activate the new strategy in test mode
      await supabase
        .from('trading_strategies')
        .update({ is_active: true })
        .eq('id', createdStrategyId)
        .eq('user_id', user.id);

      setShowActivateTestModal(false);
      onBack();
    } catch (error) {
      logger.error('Error activating strategy:', error);
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

      onBack();
    } catch (error) {
      logger.error('Error deleting strategy:', error);
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
                <span className="text-lg font-bold text-foreground">{formData.maxActiveCoins}</span>
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
                  maxTotalTrades: config.maxTotalTrades || prev.maxTotalTrades,
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
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const exported = serializeStrategy({
                          strategy_name: formData.strategyName,
                          description: formData.notes,
                          configuration: formData as Record<string, any>,
                        });
                        const filename = generateExportFilename(formData.strategyName);
                        downloadStrategyAsJson(exported, filename);
                        toast({ title: "Strategy exported", description: `Downloaded ${filename}` });
                      }}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Export
                    </Button>
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
                  </>
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
                              examples={["I want a low-risk setup", "Make it aggressive", "Use a balanced approach"]}
                            >
                              <Label>Risk Profile</Label>
                            </TooltipField>
                            <p className="text-sm text-muted-foreground mb-2">
                              Select a preset to configure all risk parameters, or choose Custom to manually configure each setting.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                              {(['low', 'medium', 'high', 'custom'] as const).map((risk) => {
                                const desc = RISK_PROFILE_DESCRIPTIONS[risk];
                                const preset = risk !== 'custom' ? getPresetByRiskProfile(risk) : null;
                                
                                return (
                                  <Card 
                                    key={risk}
                                    className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
                                      formData.riskProfile === risk 
                                        ? 'ring-2 ring-primary bg-primary/5' 
                                        : 'hover:bg-muted/50'
                                    }`}
                                    onClick={() => handleRiskProfileChange(risk)}
                                  >
                                    <CardContent className="p-4 text-center">
                                      <div className="mb-2">
                                        <Badge 
                                          variant={risk === 'high' ? 'destructive' : risk === 'medium' ? 'default' : risk === 'low' ? 'secondary' : 'outline'}
                                          className="font-bold"
                                        >
                                          {desc.title.toUpperCase()}
                                        </Badge>
                                      </div>
                                      <p className="text-xs text-muted-foreground mb-2">{desc.description}</p>
                                      {preset && (
                                        <div className="text-xs text-muted-foreground space-y-1 border-t border-border pt-2 mt-2">
                                          <div className="flex justify-between">
                                            <span>TP/SL:</span>
                                            <span className="font-medium">{preset.takeProfitPercentage}% / {preset.stopLossPercentage}%</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span>Exposure:</span>
                                            <span className="font-medium">{preset.maxWalletExposure}%</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span>Per Trade:</span>
                                            <span className="font-medium">€{preset.perTradeAllocation}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span>Confidence:</span>
                                            <span className="font-medium">{(preset.min_confidence * 100).toFixed(0)}%</span>
                                          </div>
                                        </div>
                                      )}
                                      {risk === 'custom' && (
                                        <div className="text-xs text-muted-foreground border-t border-border pt-2 mt-2">
                                          <div>Edit all parameters manually</div>
                                        </div>
                                      )}
                                    </CardContent>
                                  </Card>
                                );
                              })}
                            </div>
                            {formData.riskProfile !== 'custom' && (
                              <p className="text-xs text-muted-foreground mt-2">
                                ✓ Preset applied. To customize individual settings, select "Custom".
                              </p>
                            )}
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
                          
                          {/* Minimum Confidence Threshold */}
                          <div className="mt-6 pt-6 border-t border-border">
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <Label htmlFor="min-confidence">Minimum Confidence Threshold</Label>
                                  <Info className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  Minimum confidence score (0 to 1) required before the coordinator will execute a trade.
                                  Lower values = more trades, higher values = more selective.
                                </p>
                              </div>
                              <div className="flex items-center gap-4">
                                <Input
                                  id="min-confidence"
                                  type="number"
                                  min={0}
                                  max={1}
                                  step={0.01}
                                  value={formData.min_confidence ?? 0.65}
                                  onChange={(e) => updateFormData('min_confidence', parseFloat(e.target.value) || 0)}
                                  className="w-32"
                                />
                                <Slider
                                  value={[formData.min_confidence ?? 0.65]}
                                  onValueChange={([value]) => updateFormData('min_confidence', value)}
                                  min={0}
                                  max={1}
                                  step={0.01}
                                  className="flex-1"
                                />
                                <span className="text-sm text-muted-foreground w-16 text-right">
                                  {((formData.min_confidence ?? 0.65) * 100).toFixed(0)}%
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Common values: 0 = accept all signals, 0.5 = moderate filtering, 0.7+ = high selectivity
                              </p>
                            </div>
                          </div>
                          
                          {/* Test Mode Toggle */}
                          <div className="mt-6 pt-6 border-t border-border">
                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Label htmlFor="enable-test-mode">Test Mode (No Real Orders)</Label>
                                  <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-500 border-orange-500/30">Test Only</Badge>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  When enabled, this strategy runs in TEST mode: only mock trades / simulated orders, no live execution.
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Decisions are logged to decision_events with metadata.is_test_mode = true for learning loop analysis.
                                </p>
                              </div>
                              <Switch
                                id="enable-test-mode"
                                checked={formData.is_test_mode === true}
                                onCheckedChange={(value) => updateFormData('is_test_mode', value)}
                                className="data-[state=checked]:bg-orange-500"
                              />
                            </div>
                          </div>
                          
                          {/* Signal Fusion Toggle (Phase 1B) */}
                          <div className="mt-6 pt-6 border-t border-border">
                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Label htmlFor="enable-signal-fusion">Enable Signal Fusion Telemetry</Label>
                                  <Badge variant="outline" className="text-xs">Beta</Badge>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  When enabled, the engine logs a fused score of all active signals for this strategy (for Dev/Learning and analysis). <strong>It does NOT change trading decisions yet.</strong>
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Only active in Test Mode. Fusion data appears in decision_events.metadata.signalFusion.
                                </p>
                              </div>
                              <Switch
                                id="enable-signal-fusion"
                                checked={formData.enableSignalFusion === true}
                                onCheckedChange={(value) => updateFormData('enableSignalFusion', value)}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Technical Indicators Section */}
                  {activeSection === 'technical-indicators' && (
                    <div className="space-y-6">
                      <TooltipProvider>
                        <TechnicalIndicatorSettings 
                          config={formData.technicalIndicatorConfig}
                          onConfigChange={(config) => setFormData(prev => ({ ...prev, technicalIndicatorConfig: config }))}
                        />
                      </TooltipProvider>
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

                  {/* Strategy Section - Risk & Limits (ALL 12 EFFECTIVE PARAMETERS) */}
                  {activeSection === 'strategy' && (
                    <div className="space-y-6">
                      <Card>
                        <CardHeader>
                          <SectionHeader
                            title="Risk & Limits"
                            description={SECTION_DESCRIPTIONS['strategy']?.description || 'Core risk parameters that control position sizing and exposure.'}
                            dimension="risk"
                            isActive={true}
                          />
                          {formData.riskProfile !== 'custom' && (
                            <div className="flex items-center gap-2 mt-3 p-3 bg-muted/50 rounded-lg border">
                              <Lock className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground">
                                Using <strong>{formData.riskProfile.toUpperCase()}</strong> preset — switch to <strong>Custom</strong> to edit these fields.
                              </span>
                            </div>
                          )}
                        </CardHeader>
                        <CardContent className="space-y-8">
                          {/* SECTION: Position Sizing */}
                          <div className="space-y-4">
                            <div className="flex items-center gap-2 pb-2 border-b">
                              <h4 className="font-medium">Position Sizing</h4>
                              <span className="text-xs text-muted-foreground">(3 of 12 Risk Profile fields)</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="space-y-2">
                                <RiskFieldLabel fieldName="maxWalletExposure" riskProfile={formData.riskProfile}>
                                  <Label>Max Wallet Exposure (%)</Label>
                                </RiskFieldLabel>
                                <Slider
                                  value={[formData.maxWalletExposure]}
                                  onValueChange={([value]) => updateFormData('maxWalletExposure', value)}
                                  max={100}
                                  min={1}
                                  step={1}
                                  disabled={formData.riskProfile !== 'custom'}
                                />
                                <div className="text-sm text-muted-foreground">{formData.maxWalletExposure}%</div>
                              </div>

                              <div className="space-y-2">
                                <RiskFieldLabel fieldName="perTradeAllocation" riskProfile={formData.riskProfile}>
                                  <Label>Per Trade (€)</Label>
                                </RiskFieldLabel>
                                <Input
                                  type="number"
                                  step="10"
                                  value={formData.perTradeAllocation}
                                  onChange={(e) => updateFormData('perTradeAllocation', parseFloat(e.target.value) || 100)}
                                  min={10}
                                  max={10000}
                                  disabled={formData.riskProfile !== 'custom'}
                                />
                              </div>

                              <div className="space-y-2">
                                <RiskFieldLabel fieldName="maxActiveCoins" riskProfile={formData.riskProfile}>
                                  <Label>Max Active Coins</Label>
                                </RiskFieldLabel>
                                <Input
                                  type="number"
                                  step="1"
                                  value={formData.maxActiveCoins}
                                  onChange={(e) => updateFormData('maxActiveCoins', parseInt(e.target.value) || 4)}
                                  min={1}
                                  max={10}
                                  disabled={formData.riskProfile !== 'custom'}
                                />
                              </div>
                            </div>
                          </div>

                          {/* SECTION: Exit Thresholds */}
                          <div className="space-y-4">
                            <div className="flex items-center gap-2 pb-2 border-b">
                              <h4 className="font-medium">Exit Thresholds</h4>
                              <span className="text-xs text-muted-foreground">(3 of 12 Risk Profile fields)</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="space-y-2">
                                <RiskFieldLabel fieldName="takeProfitPercentage" riskProfile={formData.riskProfile}>
                                  <Label>Take Profit (%)</Label>
                                </RiskFieldLabel>
                                <Input
                                  type="number"
                                  step="0.1"
                                  value={formData.takeProfitPercentage}
                                  onChange={(e) => updateFormData('takeProfitPercentage', parseFloat(e.target.value) || 2)}
                                  min={0.1}
                                  max={50}
                                  disabled={formData.riskProfile !== 'custom'}
                                />
                              </div>

                              <div className="space-y-2">
                                <RiskFieldLabel fieldName="stopLossPercentage" riskProfile={formData.riskProfile}>
                                  <Label>Stop Loss (%)</Label>
                                </RiskFieldLabel>
                                <Input
                                  type="number"
                                  step="0.1"
                                  value={formData.stopLossPercentage}
                                  onChange={(e) => updateFormData('stopLossPercentage', parseFloat(e.target.value) || 2)}
                                  min={0.1}
                                  max={50}
                                  disabled={formData.riskProfile !== 'custom'}
                                />
                              </div>

                              <div className="space-y-2">
                                <RiskFieldLabel fieldName="trailingStopLossPercentage" riskProfile={formData.riskProfile}>
                                  <Label>Trailing Stop (%)</Label>
                                </RiskFieldLabel>
                                <Input
                                  type="number"
                                  step="0.1"
                                  value={formData.trailingStopLossPercentage}
                                  onChange={(e) => updateFormData('trailingStopLossPercentage', parseFloat(e.target.value) || 2)}
                                  min={0.1}
                                  max={50}
                                  disabled={formData.riskProfile !== 'custom'}
                                />
                              </div>
                            </div>
                          </div>

                          {/* SECTION: Signal Gates */}
                          <div className="space-y-4">
                            <div className="flex items-center gap-2 pb-2 border-b">
                              <h4 className="font-medium">Signal Gates</h4>
                              <span className="text-xs text-muted-foreground">(4 of 12 Risk Profile fields)</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              These thresholds control which market conditions qualify for trade entry.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <RiskFieldLabel fieldName="min_confidence" riskProfile={formData.riskProfile}>
                                  <Label>Min Confidence</Label>
                                </RiskFieldLabel>
                                <div className="flex items-center gap-4">
                                  <Slider
                                    value={[formData.min_confidence ?? 0.65]}
                                    onValueChange={([value]) => updateFormData('min_confidence', value)}
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    className="flex-1"
                                    disabled={formData.riskProfile !== 'custom'}
                                  />
                                  <span className="text-sm font-medium w-12 text-right">
                                    {((formData.min_confidence ?? 0.65) * 100).toFixed(0)}%
                                  </span>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <RiskFieldLabel fieldName="minTrendScoreForBuy" riskProfile={formData.riskProfile}>
                                  <Label>Min Trend Score</Label>
                                </RiskFieldLabel>
                                <div className="flex items-center gap-4">
                                  <Slider
                                    value={[formData.minTrendScoreForBuy ?? 0.3]}
                                    onValueChange={([value]) => updateFormData('minTrendScoreForBuy', value)}
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    className="flex-1"
                                    disabled={formData.riskProfile !== 'custom'}
                                  />
                                  <span className="text-sm font-medium w-12 text-right">
                                    {((formData.minTrendScoreForBuy ?? 0.3) * 100).toFixed(0)}%
                                  </span>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <RiskFieldLabel fieldName="minMomentumScoreForBuy" riskProfile={formData.riskProfile}>
                                  <Label>Min Momentum Score</Label>
                                </RiskFieldLabel>
                                <div className="flex items-center gap-4">
                                  <Slider
                                    value={[formData.minMomentumScoreForBuy ?? 0.25]}
                                    onValueChange={([value]) => updateFormData('minMomentumScoreForBuy', value)}
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    className="flex-1"
                                    disabled={formData.riskProfile !== 'custom'}
                                  />
                                  <span className="text-sm font-medium w-12 text-right">
                                    {((formData.minMomentumScoreForBuy ?? 0.25) * 100).toFixed(0)}%
                                  </span>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <RiskFieldLabel fieldName="maxVolatilityScoreForBuy" riskProfile={formData.riskProfile}>
                                  <Label>Max Volatility Score</Label>
                                </RiskFieldLabel>
                                <div className="flex items-center gap-4">
                                  <Slider
                                    value={[formData.maxVolatilityScoreForBuy ?? 0.65]}
                                    onValueChange={([value]) => updateFormData('maxVolatilityScoreForBuy', value)}
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    className="flex-1"
                                    disabled={formData.riskProfile !== 'custom'}
                                  />
                                  <span className="text-sm font-medium w-12 text-right">
                                    {((formData.maxVolatilityScoreForBuy ?? 0.65) * 100).toFixed(0)}%
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* SECTION: Timing Gates (2 of 12 fields, minHoldPeriodMs is EXECUTION, not Risk Profile) */}
                          <div className="space-y-4">
                            <div className="flex items-center gap-2 pb-2 border-b">
                              <h4 className="font-medium">Timing Gates (Anti-Churn)</h4>
                              <span className="text-xs text-muted-foreground">(2 of 12 Risk Profile fields)</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              These cooldowns prevent rapid-fire trading and death spirals.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <RiskFieldLabel fieldName="stopLossCooldownMs" riskProfile={formData.riskProfile}>
                                  <Label>SL Cooldown</Label>
                                </RiskFieldLabel>
                                <Select
                                  value={String(formData.stopLossCooldownMs ?? 600000)}
                                  onValueChange={(value) => updateFormData('stopLossCooldownMs', parseInt(value))}
                                  disabled={formData.riskProfile !== 'custom'}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="60000">1 min</SelectItem>
                                    <SelectItem value="300000">5 min</SelectItem>
                                    <SelectItem value="600000">10 min</SelectItem>
                                    <SelectItem value="900000">15 min</SelectItem>
                                    <SelectItem value="1200000">20 min</SelectItem>
                                    <SelectItem value="1800000">30 min</SelectItem>
                                  </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">Wait after stop-loss before re-entry</p>
                              </div>

                              <div className="space-y-2">
                                <RiskFieldLabel fieldName="minEntrySpacingMs" riskProfile={formData.riskProfile}>
                                  <Label>Entry Spacing</Label>
                                </RiskFieldLabel>
                                <Select
                                  value={String(formData.minEntrySpacingMs ?? 900000)}
                                  onValueChange={(value) => updateFormData('minEntrySpacingMs', parseInt(value))}
                                  disabled={formData.riskProfile !== 'custom'}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="60000">1 min</SelectItem>
                                    <SelectItem value="300000">5 min</SelectItem>
                                    <SelectItem value="600000">10 min</SelectItem>
                                    <SelectItem value="900000">15 min</SelectItem>
                                    <SelectItem value="1800000">30 min</SelectItem>
                                    <SelectItem value="3600000">1 hour</SelectItem>
                                  </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">Min time between buys on same symbol</p>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                              Note: Min Hold Period is in EXECUTION → Unified Decisions (not a Risk Profile field).
                            </p>
                          </div>

                          {/* Daily Loss Limit - Coming Soon */}
                          <div className="space-y-2 p-4 bg-muted/30 rounded-lg border border-dashed">
                            <div className="flex items-center gap-2">
                              <Label className="text-muted-foreground">Daily Loss Limit (%)</Label>
                              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                                Coming Soon
                              </Badge>
                            </div>
                            <Input
                              type="number"
                              step="0.1"
                              value={formData.dailyLossLimit}
                              onChange={(e) => updateFormData('dailyLossLimit', parseFloat(e.target.value) || 0)}
                              min={0}
                              max={100}
                              disabled={true}
                              className="cursor-not-allowed max-w-32"
                            />
                            <p className="text-xs text-muted-foreground">
                              Planned feature — currently not enforced by trading engine.
                            </p>
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

                            {/* ScalpSmart Strategy Toggle */}
                            <div className="p-4 border rounded-lg space-y-4">
                              <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                  <TooltipField 
                                    description="Enable ScalpSmart strategy with advanced signal fusion, context gates, and enhanced risk management. Uses multi-signal analysis with trend, volatility, momentum, whale, and sentiment scoring."
                                    examples={["Enable ScalpSmart trading", "Use advanced signal fusion", "Activate intelligent trading engine"]}
                                  >
                                    <Label>ScalpSmart Strategy</Label>
                                  </TooltipField>
                                  <p className="text-sm text-muted-foreground">Advanced signal fusion and intelligent risk management</p>
                                </div>
                                <Switch
                                  checked={formData.signalFusion?.enabled || false}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      updateFormData('signalFusion', SCALPSMART_PRESET.signalFusion);
                                      updateFormData('contextGates', SCALPSMART_PRESET.contextGates);
                                      updateFormData('brackets', SCALPSMART_PRESET.brackets);
                                    } else {
                                      updateFormData('signalFusion', { enabled: false });
                                    }
                                  }}
                                />
                              </div>

                              {formData.signalFusion?.enabled && (
                                <div className="space-y-4 pl-4 border-l-2 border-primary/20">
                                  <div className="text-sm text-muted-foreground bg-secondary/50 p-3 rounded">
                                    <strong>ScalpSmart Active:</strong>
                                    <div className="mt-1 space-y-1">
                                      <div>• Signal Fusion: 5-bucket analysis (trend, volatility, momentum, whale, sentiment)</div>
                                      <div>• Context Gates: Spread ≤12bps, Liquidity depth ≥3.0x, Whale conflict detection</div>
                                      <div>• Risk Management: TP≥1.2×SL enforcement, 0.4% stop loss, 0.65% take profit</div>
                                      <div>• Hysteresis: Enter≥65%, Exit≤35% to prevent flip-flopping</div>
                                    </div>
                                  </div>
                                </div>
                              )}
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

                  {/* Pool Exit Management Panel */}
                  {activeSection === 'pool-exit-management' && (
                    <PoolExitManagementPanel 
                      formData={formData} 
                      updateFormData={updateFormData} 
                    />
                  )}

                  {/* Unified Decisions Panel */}
                  {activeSection === 'unified-decisions' && (
                    <>
                      <UnifiedDecisionsConfig 
                        config={formData.unifiedConfig || {
                          enableUnifiedDecisions: false,
                          minHoldPeriodMs: 120000,
                          cooldownBetweenOppositeActionsMs: 30000,
                          confidenceOverrideThreshold: 0.70
                        }}
                        onChange={(unifiedConfig) => updateFormData('unifiedConfig', unifiedConfig)}
                        isActive={formData.enableTestTrading || formData.enableLiveTrading}
                      />
                      
                      {/* Market Quality Gates - USER CONTROLLED */}
                      <Card className="mt-6">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5" />
                            Market Quality Gates
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            Control when trades are allowed based on market conditions. These settings are user-controlled and never overridden by AI.
                          </p>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          {/* Spread Threshold */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <TooltipField
                                description="Maximum allowed bid-ask spread in basis points (bps). 1 bps = 0.01%. Lower values = stricter quality requirement. 25 bps is a safe default for most liquid pairs."
                                examples={["Set spread to 25 bps", "Allow up to 50 bps spread", "Use tight spread of 10 bps"]}
                              >
                                <Label>Max Spread (BPS): {formData.spreadThresholdBps}</Label>
                              </TooltipField>
                              <Badge variant="outline" className="text-xs">
                                {(formData.spreadThresholdBps / 100).toFixed(2)}%
                              </Badge>
                            </div>
                            <Slider
                              value={[formData.spreadThresholdBps]}
                              onValueChange={([value]) => updateFormData('spreadThresholdBps', value)}
                              min={0.1}
                              max={200}
                              step={0.5}
                              className="w-full"
                            />
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>0.1 bps (strict)</span>
                              <span>200 bps (loose)</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Recommended: 15-30 bps for liquid pairs, 50-100 bps for less liquid pairs
                            </p>
                          </div>

                          {/* Min Depth Ratio */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <TooltipField
                                description="Minimum liquidity depth ratio required. Higher values = more liquidity required. 0 = disabled, 0.2 is a safe default."
                                examples={["Set depth ratio to 0.2", "Require more liquidity", "Disable depth check"]}
                              >
                                <Label>Min Depth Ratio: {formData.minDepthRatio.toFixed(2)}</Label>
                              </TooltipField>
                              <Badge variant="outline" className="text-xs">
                                {formData.minDepthRatio === 0 ? 'Disabled' : 'Active'}
                              </Badge>
                            </div>
                            <Slider
                              value={[formData.minDepthRatio]}
                              onValueChange={([value]) => updateFormData('minDepthRatio', value)}
                              min={0}
                              max={3}
                              step={0.05}
                              className="w-full"
                            />
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>0 (disabled)</span>
                              <span>3 (strict)</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Recommended: 0.1-0.3 for normal trading, 0 to disable
                            </p>
                          </div>

                          {/* Quick Presets */}
                          <div className="pt-4 border-t border-border">
                            <Label className="text-sm font-medium mb-3 block">Quick Presets</Label>
                            <div className="flex gap-2 flex-wrap">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  updateFormData('spreadThresholdBps', 15);
                                  updateFormData('minDepthRatio', 0.3);
                                }}
                              >
                                Conservative
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  updateFormData('spreadThresholdBps', 25);
                                  updateFormData('minDepthRatio', 0.2);
                                }}
                              >
                                Balanced (Recommended)
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  updateFormData('spreadThresholdBps', 50);
                                  updateFormData('minDepthRatio', 0.1);
                                }}
                              >
                                Permissive
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  updateFormData('spreadThresholdBps', 200);
                                  updateFormData('minDepthRatio', 0);
                                }}
                              >
                                Disabled (Testing)
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </>
                  )}

                  {/* Execution Settings Panel */}
                  {activeSection === 'execution-settings' && (
                    <ExecutionSettingsPanel
                      settings={formData.executionSettings}
                      onChange={(executionSettings) => updateFormData('executionSettings', executionSettings)}
                    />
                  )}

                  {/* Advanced Symbol Overrides Panel */}
                  {activeSection === 'advanced-overrides' && (
                    <AdvancedSymbolOverridesPanel 
                      strategyId={existingStrategy?.id || null}
                      isTestStrategy={existingStrategy?.test_mode ?? true}
                      isActive={existingStrategy?.is_active ?? false}
                      executionModeFromDb={(existingStrategy as any)?.execution_mode}
                      selectedCoins={formData.selectedCoins}
                      defaultTpPct={formData.takeProfitPercentage}
                      defaultSlPct={formData.stopLossPercentage}
                      defaultMinConfidence={formData.aiIntelligenceConfig.aiConfidenceThreshold ? formData.aiIntelligenceConfig.aiConfidenceThreshold / 100 : 0.70}
                    />
                  )}

                  {/* Deprecated / Inactive Features Panel */}
                  {activeSection === 'deprecated-features' && (
                    <DeprecatedFieldsPanel />
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