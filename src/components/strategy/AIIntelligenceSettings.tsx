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
    enterThreshold: 0.02,
    exitThreshold: 0.01,
      conflictPenalty: 0.30
    },
    contextGates: {
      spreadThresholdBps: 12,
      minDepthRatio: 3.0,
      whaleConflictWindowMs: 300000
    },
    bracketPolicy: {
      atrScaled: false,
      stopLossPctWhenNotAtr: 0.40,
      trailBufferPct: 0.40,
      enforceRiskReward: true,
      minTpSlRatio: 1.2,
      atrMultipliers: {
        tp: 2.6,
        sl: 2.0
      }
    },
    overridesPolicy: {
      allowedKeys: ["tpPct", "slPct", "enterThreshold", "exitThreshold"],
      bounds: {
        slPct: [0.15, 1.00],
        tpOverSlMin: 1.2
      },
      ttlMs: 900000
    }
  },
  
  // Legacy defaults
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
      contextGates: { ...defaultConfig.features.contextGates, spreadThresholdBps: 8, minDepthRatio: 4.0 }
    },
    microScalp: {
      name: "Micro-Scalp 0.5%", // Formerly ScalpSmart
      fusion: { 
        enabled: true,
        weights: { trend: 0.25, volatility: 0.20, momentum: 0.25, whale: 0.15, sentiment: 0.15 },
        enterThreshold: 0.02,
        exitThreshold: 0.01,
        conflictPenalty: 0.30
      },
      contextGates: { spreadThresholdBps: 12, minDepthRatio: 3.0, whaleConflictWindowMs: 300000 }
    },
    aggressive: {
      name: "Aggressive Growth",
      fusion: {
        enabled: true,
        weights: { trend: 0.30, volatility: 0.15, momentum: 0.30, whale: 0.10, sentiment: 0.15 },
        enterThreshold: 0.03,
        exitThreshold: 0.015,
        conflictPenalty: 0.20
      },
      contextGates: { spreadThresholdBps: 18, minDepthRatio: 2.5, whaleConflictWindowMs: 180000 }
    }
  };

  const applyPreset = (presetKey: keyof typeof presets) => {
    const preset = presets[presetKey];
    updateConfig({
      features: {
        ...config.features,
        fusion: preset.fusion,
        contextGates: preset.contextGates
      }
    });
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
      <Card>
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
                <Select onValueChange={(value) => applyPreset(value as keyof typeof presets)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose preset..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(presets).map(([key, preset]) => (
                      <SelectItem key={key} value={key}>{preset.name}</SelectItem>
                    ))}
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
                  <Label>Enter Threshold: {config.features.fusion.enterThreshold.toFixed(3)}</Label>
                  <Slider
                    value={[config.features.fusion.enterThreshold]}
                    onValueChange={([value]) => updateConfig({
                      features: {
                        ...config.features,
                        fusion: { ...config.features.fusion, enterThreshold: value }
                      }
                    })}
                    min={0.01}
                    max={0.20}
                    step={0.005}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">Lower = more trades (0.01-0.20)</p>
                </div>
                <div className="space-y-2">
                  <Label>Exit Threshold: {config.features.fusion.exitThreshold.toFixed(3)}</Label>
                  <Slider
                    value={[config.features.fusion.exitThreshold]}
                    onValueChange={([value]) => updateConfig({
                      features: {
                        ...config.features,
                        fusion: { ...config.features.fusion, exitThreshold: value }
                      }
                    })}
                    min={0.005}
                    max={0.10}
                    step={0.005}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">Lower = earlier exits (0.005-0.10)</p>
                </div>
              </div>

              {/* Context Gates - REMOVED from AI section */}
              {/* spreadThresholdBps and minDepthRatio are now in main strategy config */}
              <div className="space-y-4">
                <Label className="text-base font-medium">Context Gates (AI-Controlled)</Label>
                <p className="text-xs text-muted-foreground">
                  Note: Spread and Depth gates are now configured in the main Risk Settings tab for direct user control.
                </p>

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