import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Brain, Info, AlertTriangle, TrendingUp, Eye, Zap } from 'lucide-react';
import { DEFAULT_VALUES } from '@/utils/configDefaults';
import { detectPreset } from '@/utils/aiConfigHelpers';

export interface AIIntelligenceConfig {
  // Core AI Settings
  enableAIOverride: boolean;
  autonomy: { level: number }; // 0-100: How much freedom the AI has
  
  // Unified Features (formerly ScalpSmart)
  features: {
    fusion: {
      enabled: boolean;
      weights: {
        trend: number;
        volatility: number;
        momentum: number;
        whale: number;
        sentiment: number;
      };
      enterThreshold: number;
      exitThreshold: number;
      conflictPenalty: number;
    };
    contextGates: {
      spreadThresholdBps: number;
      minDepthRatio: number;
      whaleConflictWindowMs: number;
    };
    bracketPolicy: {
      atrScaled: boolean;
      stopLossPctWhenNotAtr: number;
      trailBufferPct: number;
      enforceRiskReward: boolean;
      minTpSlRatio: number;
      atrMultipliers: {
        tp: number;
        sl: number;
      };
    };
    overridesPolicy: {
      allowedKeys: string[];
      bounds: {
        slPct: [number, number];
        tpOverSlMin: number;
      };
      ttlMs: number;
    };
  };
  
  // Legacy fields (kept for compatibility)
  aiConfidenceThreshold?: number;
  enablePatternRecognition?: boolean;
  patternLookbackHours?: number;
  crossAssetCorrelation?: boolean;
  marketStructureAnalysis?: boolean;
  enableExternalSignals?: boolean;
  whaleActivityWeight?: number;
  sentimentWeight?: number;
  newsImpactWeight?: number;
  socialSignalsWeight?: number;
  decisionMode?: 'conservative' | 'balanced' | 'aggressive';
  escalationThreshold?: number;
  riskOverrideAllowed?: boolean;
  enableLearning?: boolean;
  adaptToPerformance?: boolean;
  learningRate?: number;
  explainDecisions?: boolean;
  alertOnAnomalies?: boolean;
  alertOnOverrides?: boolean;
  customInstructions?: string;
}

interface AIIntelligenceSettingsProps {
  config: AIIntelligenceConfig;
  onConfigChange: (config: AIIntelligenceConfig) => void;
}

const defaultConfig: AIIntelligenceConfig = {
  enableAIOverride: false,
  autonomy: { level: DEFAULT_VALUES.AUTONOMY_LEVEL },
  
  features: {
    fusion: {
      enabled: false,
      weights: DEFAULT_VALUES.FUSION_WEIGHTS,
      enterThreshold: DEFAULT_VALUES.ENTER_THRESHOLD,
      exitThreshold: DEFAULT_VALUES.EXIT_THRESHOLD,
      conflictPenalty: DEFAULT_VALUES.CONFLICT_PENALTY
    },
    contextGates: {
      spreadThresholdBps: DEFAULT_VALUES.SPREAD_THRESHOLD_BPS,
      minDepthRatio: DEFAULT_VALUES.MIN_DEPTH_RATIO,
      whaleConflictWindowMs: DEFAULT_VALUES.WHALE_CONFLICT_WINDOW_MS
    },
    bracketPolicy: DEFAULT_VALUES.BRACKET_POLICY,
    overridesPolicy: {
      allowedKeys: ["tpPct", "slPct", "enterThreshold", "exitThreshold"],
      bounds: DEFAULT_VALUES.OVERRIDE_BOUNDS,
      ttlMs: DEFAULT_VALUES.OVERRIDE_TTL_MS
    }
  },
  
  // Legacy defaults
  aiConfidenceThreshold: DEFAULT_VALUES.CONFIDENCE_THRESHOLD,
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
};

const TooltipField: React.FC<{ 
  children: React.ReactNode; 
  description: string; 
  examples?: string[] 
}> = ({ children, description, examples }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <div className="flex items-center gap-2 cursor-help">
        {children}
        <Info className="h-4 w-4 text-muted-foreground" />
      </div>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs">
      <div className="space-y-2">
        <p className="text-sm">{description}</p>
        {examples && examples.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Example phrases:</p>
            <ul className="text-xs text-muted-foreground list-disc list-inside">
              {examples.slice(0, 3).map((example, idx) => (
                <li key={idx}>"{example}"</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </TooltipContent>
  </Tooltip>
);

export const AIIntelligenceSettings: React.FC<AIIntelligenceSettingsProps> = ({
  config = defaultConfig,
  onConfigChange
}) => {
  const updateConfig = (updates: Partial<AIIntelligenceConfig>) => {
    onConfigChange({ ...config, ...updates });
  };

  const getAutonomyDescription = (level: number) => {
    if (level <= 20) return "Conservative: AI only suggests, never acts independently";
    if (level <= 40) return "Cautious: AI can make minor adjustments within strict parameters";
    if (level <= 60) return "Balanced: AI can modify trades and timing with approval";
    if (level <= 80) return "Adaptive: AI can override rules when high confidence signals detected";
    return "Autonomous: AI makes independent decisions based on market conditions";
  };

  const presets = {
    conservative: {
      name: "Conservative",
      fusion: { ...defaultConfig.features.fusion, enabled: false },
      contextGates: { 
        ...defaultConfig.features.contextGates, 
        spreadThresholdBps: DEFAULT_VALUES.PRESETS.CONSERVATIVE.SPREAD_THRESHOLD_BPS, 
        minDepthRatio: DEFAULT_VALUES.PRESETS.CONSERVATIVE.MIN_DEPTH_RATIO 
      }
    },
    microScalp: {
      name: "Micro-Scalp 0.5%", // Formerly ScalpSmart
      fusion: { 
        enabled: true,
        weights: DEFAULT_VALUES.FUSION_WEIGHTS,
        enterThreshold: DEFAULT_VALUES.ENTER_THRESHOLD,
        exitThreshold: DEFAULT_VALUES.EXIT_THRESHOLD,
        conflictPenalty: DEFAULT_VALUES.CONFLICT_PENALTY
      },
      contextGates: { 
        spreadThresholdBps: DEFAULT_VALUES.SPREAD_THRESHOLD_BPS, 
        minDepthRatio: DEFAULT_VALUES.MIN_DEPTH_RATIO, 
        whaleConflictWindowMs: DEFAULT_VALUES.WHALE_CONFLICT_WINDOW_MS 
      }
    },
    aggressive: {
      name: "Aggressive Growth",
      fusion: {
        enabled: true,
        weights: DEFAULT_VALUES.PRESETS.AGGRESSIVE.FUSION_WEIGHTS,
        enterThreshold: DEFAULT_VALUES.PRESETS.AGGRESSIVE.ENTER_THRESHOLD,
        exitThreshold: DEFAULT_VALUES.PRESETS.AGGRESSIVE.EXIT_THRESHOLD,
        conflictPenalty: DEFAULT_VALUES.PRESETS.AGGRESSIVE.CONFLICT_PENALTY
      },
      contextGates: { 
        spreadThresholdBps: DEFAULT_VALUES.PRESETS.AGGRESSIVE.SPREAD_THRESHOLD_BPS, 
        minDepthRatio: DEFAULT_VALUES.PRESETS.AGGRESSIVE.MIN_DEPTH_RATIO, 
        whaleConflictWindowMs: DEFAULT_VALUES.PRESETS.AGGRESSIVE.WHALE_CONFLICT_WINDOW_MS 
      }
    }
  };

  const applyPreset = (presetKey: keyof typeof presets) => {
    const preset = presets[presetKey];
    
    // Apply the complete preset configuration to aiIntelligenceConfig
    const updatedConfig: AIIntelligenceConfig = {
      ...config,
      enableAIOverride: true, // Enable AI when applying preset
      features: {
        ...config.features,
        fusion: {
          ...config.features.fusion,
          ...preset.fusion
        },
        contextGates: {
          ...config.features.contextGates,
          ...preset.contextGates
        },
        // Apply bracket policy from preset if it exists (for micro-scalp)
        ...(presetKey === 'microScalp' && {
          bracketPolicy: DEFAULT_VALUES.BRACKET_POLICY
        })
      }
    };
    
    // Debug logging
    console.log(`[AIPreset] Applying preset "${presetKey}":`, {
      preset,
      updatedConfig: updatedConfig.features
    });
    
    updateConfig(updatedConfig);
  };

  const getCurrentPreset = (): string => {
    return detectPreset(config);
  };

  const getDecisionModeDescription = (mode: string) => {
    switch (mode) {
      case 'conservative': return "Prioritizes capital preservation, requires multiple confirmations";
      case 'balanced': return "Balances opportunity and risk, standard decision-making";
      case 'aggressive': return "Prioritizes opportunities, faster decision-making";
      default: return "";
    }
  };

  return (
    <div className="space-y-6">
      {/* AI Core Settings */}
      <Card data-testid="ai-intelligence-section">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Intelligence Core
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <TooltipField 
              description="Master switch: Allow AI to override strategy rules when market conditions warrant it. When enabled, AI can modify trades, timing, and parameters beyond the basic strategy rules." 
              examples={["Give the AI more control", "Let AI make decisions", "Enable AI override", "Allow AI independence"]}
            >
              <Label htmlFor="ai-override">Enable AI Decision Override</Label>
            </TooltipField>
            <Switch
              id="ai-override"
              data-testid="ai-override-switch"
              checked={config.enableAIOverride}
              onCheckedChange={(value) => updateConfig({ enableAIOverride: value })}
            />
          </div>

          {config.enableAIOverride && (
            <div className="space-y-4 border-l-2 border-primary/20 pl-4">
              <div className="space-y-2">
                <TooltipField 
                  description="How much autonomy the AI has to make decisions independently. Higher values = more AI freedom." 
                  examples={["Give you more autonomy", "I want you to be more independent", "Make your own decisions", "Be more/less autonomous", "Take more control"]}
                >
                  <Label>AI Autonomy Level: {config.autonomy.level}%</Label>
                </TooltipField>
                <Slider
                  value={[config.autonomy.level]}
                  onValueChange={([value]) => updateConfig({ autonomy: { level: value } })}
                  max={100}
                  step={5}
                  className="w-full"
                />
                <p className="text-sm text-muted-foreground">
                  {getAutonomyDescription(config.autonomy.level)}
                </p>
              </div>

              <div className="space-y-2">
                <TooltipField 
                  description="Select a predefined AI configuration preset or customize your own settings below."
                  examples={["Use conservative settings", "Apply micro-scalp preset", "Set to aggressive mode"]}
                >
                   <Label>AI Preset</Label>
                </TooltipField>
                <Select 
                  value={getCurrentPreset()}
                  onValueChange={(value) => value !== 'custom' && applyPreset(value as keyof typeof presets)}
                  data-testid="ai-preset-select"
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose preset..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(presets).map(([key, preset]) => (
                      <SelectItem key={key} value={key} data-value={key}>{preset.name}</SelectItem>
                    ))}
                    <SelectItem value="custom" disabled>Custom (modified)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Fusion & Context Gates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            AI Fusion & Context Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <TooltipField 
              description="Enable advanced signal fusion that combines multiple market signals (trend, volatility, momentum, whale activity, sentiment) with context gates for intelligent entry/exit decisions." 
              examples={["Enable signal fusion", "Use advanced AI analysis", "Turn on context gates"]}
            >
              <Label htmlFor="fusion-enabled">Enable AI Signal Fusion</Label>
            </TooltipField>
            <Switch
              id="fusion-enabled"
              data-testid="fusion-enabled-switch"
              checked={config.features.fusion.enabled}
              onCheckedChange={(value) => updateConfig({ 
                features: { ...config.features, fusion: { ...config.features.fusion, enabled: value } }
              })}
            />
          </div>

          {config.features.fusion.enabled && (
            <div className="space-y-6 border-l-2 border-primary/20 pl-4">
              
              {/* Signal Weights */}
              <div className="space-y-4">
                <Label className="text-base font-medium">Signal Weights</Label>
                {Object.entries(config.features.fusion.weights).map(([signal, weight]) => (
                  <div key={signal} className="space-y-2">
                    <Label className="capitalize">{signal}: {(weight * 100).toFixed(0)}%</Label>
                    <Slider
                      value={[weight]}
                      onValueChange={([value]) => updateConfig({
                        features: {
                          ...config.features,
                          fusion: {
                            ...config.features.fusion,
                            weights: { ...config.features.fusion.weights, [signal]: value }
                          }
                        }
                      })}
                      max={1}
                      step={0.05}
                      className="w-full"
                    />
                  </div>
                ))}
              </div>

              {/* Thresholds */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Enter Threshold: {config.features.fusion.enterThreshold}</Label>
                  <Slider
                    data-testid="enter-threshold-slider"
                    value={[config.features.fusion.enterThreshold]}
                    onValueChange={([value]) => updateConfig({
                      features: {
                        ...config.features,
                        fusion: { ...config.features.fusion, enterThreshold: value }
                      }
                    })}
                    min={0.1}
                    max={1}
                    step={0.05}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Exit Threshold: {config.features.fusion.exitThreshold}</Label>
                  <Slider
                    data-testid="exit-threshold-slider"
                    value={[config.features.fusion.exitThreshold]}
                    onValueChange={([value]) => updateConfig({
                      features: {
                        ...config.features,
                        fusion: { ...config.features.fusion, exitThreshold: value }
                      }
                    })}
                    min={0.1}
                    max={1}
                    step={0.05}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Context Gates */}
              <div className="space-y-4">
                <Label className="text-base font-medium">Context Gates (Market Filters)</Label>
                
                <div className="space-y-2">
                  <Label>Max Spread (BPS): {config.features.contextGates.spreadThresholdBps}</Label>
                  <Slider
                    data-testid="spread-threshold-slider"
                    value={[config.features.contextGates.spreadThresholdBps]}
                    onValueChange={([value]) => updateConfig({
                      features: {
                        ...config.features,
                        contextGates: { ...config.features.contextGates, spreadThresholdBps: value }
                      }
                    })}
                    min={5}
                    max={50}
                    step={1}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Min Depth Ratio: {config.features.contextGates.minDepthRatio}</Label>
                  <Slider
                    data-testid="min-depth-ratio-slider"
                    value={[config.features.contextGates.minDepthRatio]}
                    onValueChange={([value]) => updateConfig({
                      features: {
                        ...config.features,
                        contextGates: { ...config.features.contextGates, minDepthRatio: value }
                      }
                    })}
                    min={1}
                    max={10}
                    step={0.1}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Whale Conflict Window: {Math.round(config.features.contextGates.whaleConflictWindowMs / 60000)} min</Label>
                  <Slider
                    value={[config.features.contextGates.whaleConflictWindowMs]}
                    onValueChange={([value]) => updateConfig({
                      features: {
                        ...config.features,
                        contextGates: { ...config.features.contextGates, whaleConflictWindowMs: value }
                      }
                    })}
                    min={60000}
                    max={900000}
                    step={60000}
                    className="w-full"
                  />
                </div>
              </div>

            </div>
          )}
        </CardContent>
      </Card>

      {/* Legacy Settings - Collapsed by default */}
      {config.enableAIOverride && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Legacy AI Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              These settings are maintained for compatibility but may be deprecated in future versions.
            </p>
            
            <div className="space-y-2">
              <Label>Decision Mode</Label>
              <Select
                value={config.decisionMode || 'balanced'}
                onValueChange={(value: 'conservative' | 'balanced' | 'aggressive') => 
                  updateConfig({ decisionMode: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conservative">Conservative</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="aggressive">Aggressive</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {getDecisionModeDescription(config.decisionMode || 'balanced')}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Custom Instructions</Label>
              <Textarea
                value={config.customInstructions || ''}
                onChange={(e) => updateConfig({ customInstructions: e.target.value })}
                placeholder="Provide specific instructions for AI behavior..."
                className="min-h-[100px]"
              />
            </div>
            
          </CardContent>
        </Card>
      )}
    </div>
  );
};