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
  aiAutonomyLevel: number; // 0-100: How much freedom the AI has
  aiConfidenceThreshold: number; // 0-100: Minimum confidence to act
  
  // Pattern Recognition
  enablePatternRecognition: boolean;
  patternLookbackHours: number;
  crossAssetCorrelation: boolean;
  marketStructureAnalysis: boolean;
  
  // External Signal Processing
  enableExternalSignals: boolean;
  whaleActivityWeight: number;
  sentimentWeight: number;
  newsImpactWeight: number;
  socialSignalsWeight: number;
  
  // Decision Making
  decisionMode: 'conservative' | 'balanced' | 'aggressive';
  escalationThreshold: number; // When to alert vs act
  riskOverrideAllowed: boolean;
  
  // Learning & Adaptation
  enableLearning: boolean;
  adaptToPerformance: boolean;
  learningRate: number;
  
  // Alerts & Communication
  explainDecisions: boolean;
  alertOnAnomalies: boolean;
  alertOnOverrides: boolean;
  customInstructions: string;
}

interface AIIntelligenceSettingsProps {
  config: AIIntelligenceConfig;
  onConfigChange: (config: AIIntelligenceConfig) => void;
}

const defaultConfig: AIIntelligenceConfig = {
  enableAIOverride: false,
  aiAutonomyLevel: 30,
  aiConfidenceThreshold: 70,
  enablePatternRecognition: true,
  patternLookbackHours: 168, // 7 days
  crossAssetCorrelation: true,
  marketStructureAnalysis: true,
  enableExternalSignals: true,
  whaleActivityWeight: 25,
  sentimentWeight: 20,
  newsImpactWeight: 30,
  socialSignalsWeight: 15,
  decisionMode: 'balanced',
  escalationThreshold: 80,
  riskOverrideAllowed: false,
  enableLearning: true,
  adaptToPerformance: true,
  learningRate: 50,
  explainDecisions: true,
  alertOnAnomalies: true,
  alertOnOverrides: true,
  customInstructions: ''
};

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
                  <Label>AI Autonomy Level: {config.aiAutonomyLevel}%</Label>
                </TooltipField>
                <Slider
                  value={[config.aiAutonomyLevel]}
                  onValueChange={([value]) => updateConfig({ aiAutonomyLevel: value })}
                  max={100}
                  step={5}
                  className="w-full"
                />
                <p className="text-sm text-muted-foreground">
                  {getAutonomyDescription(config.aiAutonomyLevel)}
                </p>
              </div>

              <div className="space-y-2">
                <TooltipField 
                  description="Minimum confidence level required for AI to take action. Higher values = AI only acts when very confident." 
                  examples={["Be more confident before acting", "Only act when you're sure", "Be more/less cautious", "Increase/decrease confidence threshold"]}
                >
                  <Label>Confidence Threshold: {config.aiConfidenceThreshold}%</Label>
                </TooltipField>
                <Slider
                  value={[config.aiConfidenceThreshold]}
                  onValueChange={([value]) => updateConfig({ aiConfidenceThreshold: value })}
                  max={100}
                  step={5}
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <TooltipField 
                  description="When AI should escalate vs act independently. Below this threshold: AI acts alone. Above: AI asks for approval." 
                  examples={["Ask me before big decisions", "Only escalate important things", "Handle more things yourself"]}
                >
                  <Label>Escalation Threshold: {config.escalationThreshold}%</Label>
                </TooltipField>
                <Slider
                  value={[config.escalationThreshold]}
                  onValueChange={([value]) => updateConfig({ escalationThreshold: value })}
                  max={100}
                  step={5}
                  className="w-full"
                />
                <p className="text-sm text-muted-foreground">
                  Below this threshold: AI acts independently | Above: AI alerts for approval
                </p>
              </div>

              <div className="flex items-center justify-between">
                <TooltipField 
                  description="Allow AI to override risk parameters (stop-loss, position size) when opportunity justifies it." 
                  examples={["Override risk settings when needed", "Break risk rules for good opportunities", "Strict risk management only"]}
                >
                  <Label htmlFor="risk-override">Allow Risk Parameter Override</Label>
                </TooltipField>
                <Switch
                  id="risk-override"
                  checked={config.riskOverrideAllowed}
                  onCheckedChange={(value) => updateConfig({ riskOverrideAllowed: value })}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <TooltipField 
              description="AI decision-making style and risk approach. Conservative: safety first. Balanced: moderate risk. Aggressive: opportunity focused." 
              examples={["Be more conservative/aggressive", "Take more/fewer risks", "Focus on safety/opportunities"]}
            >
              <Label>Decision Making Mode</Label>
            </TooltipField>
            <Select
              value={config.decisionMode}
              onValueChange={(value: any) => updateConfig({ decisionMode: value })}
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
              {getDecisionModeDescription(config.decisionMode)}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Pattern Recognition */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Pattern Recognition & Market Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <TooltipField 
              description="Enable AI to recognize and act on historical patterns" 
              examples={["Use pattern recognition", "Analyze historical trends", "Find market patterns"]}
            >
              <Label htmlFor="pattern-recognition">Enable Pattern Recognition</Label>
            </TooltipField>
            <Switch
              id="pattern-recognition"
              checked={config.enablePatternRecognition}
              onCheckedChange={(value) => updateConfig({ enablePatternRecognition: value })}
            />
          </div>

          {config.enablePatternRecognition && (
            <div className="space-y-4 border-l-2 border-primary/20 pl-4">
              <div className="space-y-2">
                <TooltipField 
                  description="How far back to analyze for patterns (in hours)" 
                  examples={["Look back 7 days", "Analyze past week patterns", "Use 2 weeks of data"]}
                >
                  <Label>Pattern Analysis Lookback: {config.patternLookbackHours} hours</Label>
                </TooltipField>
                <Slider
                  value={[config.patternLookbackHours]}
                  onValueChange={([value]) => updateConfig({ patternLookbackHours: value })}
                  min={24}
                  max={720} // 30 days
                  step={24}
                  className="w-full"
                />
              </div>

              <div className="flex items-center justify-between">
                <TooltipField 
                  description="Analyze correlations between different assets" 
                  examples={["Check how BTC affects altcoins", "Analyze asset correlations", "Find related movements"]}
                >
                  <Label htmlFor="cross-asset">Cross-Asset Correlation Analysis</Label>
                </TooltipField>
                <Switch
                  id="cross-asset"
                  checked={config.crossAssetCorrelation}
                  onCheckedChange={(value) => updateConfig({ crossAssetCorrelation: value })}
                />
              </div>

              <div className="flex items-center justify-between">
                <TooltipField 
                  description="Analyze market structure and liquidity patterns" 
                  examples={["Check market depth", "Analyze order book patterns", "Monitor liquidity changes"]}
                >
                  <Label htmlFor="market-structure">Market Structure Analysis</Label>
                </TooltipField>
                <Switch
                  id="market-structure"
                  checked={config.marketStructureAnalysis}
                  onCheckedChange={(value) => updateConfig({ marketStructureAnalysis: value })}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* External Signals */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            External Signal Processing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <TooltipField 
              description="Process and act on external market signals" 
              examples={["Use whale alerts", "Monitor news signals", "Process external data"]}
            >
              <Label htmlFor="external-signals">Enable External Signal Processing</Label>
            </TooltipField>
            <Switch
              id="external-signals"
              checked={config.enableExternalSignals}
              onCheckedChange={(value) => updateConfig({ enableExternalSignals: value })}
            />
          </div>

          {config.enableExternalSignals && (
            <div className="space-y-4 border-l-2 border-primary/20 pl-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <TooltipField 
                    description="Weight given to whale activity signals" 
                    examples={["Focus on whale movements", "Weight whale signals higher", "Ignore whale activity"]}
                  >
                    <Label>Whale Activity: {config.whaleActivityWeight}%</Label>
                  </TooltipField>
                  <Slider
                    value={[config.whaleActivityWeight]}
                    onValueChange={([value]) => updateConfig({ whaleActivityWeight: value })}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <TooltipField 
                    description="Weight given to market sentiment signals" 
                    examples={["Track market sentiment", "Use sentiment indicators", "Monitor fear and greed"]}
                  >
                    <Label>Market Sentiment: {config.sentimentWeight}%</Label>
                  </TooltipField>
                  <Slider
                    value={[config.sentimentWeight]}
                    onValueChange={([value]) => updateConfig({ sentimentWeight: value })}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <TooltipField 
                    description="Weight given to news impact signals" 
                    examples={["React to breaking news", "Consider news impact", "Follow financial news"]}
                  >
                    <Label>News Impact: {config.newsImpactWeight}%</Label>
                  </TooltipField>
                  <Slider
                    value={[config.newsImpactWeight]}
                    onValueChange={([value]) => updateConfig({ newsImpactWeight: value })}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <TooltipField 
                    description="Weight given to social media signals" 
                    examples={["Monitor social trends", "Use Twitter sentiment", "Follow social signals"]}
                  >
                    <Label>Social Signals: {config.socialSignalsWeight}%</Label>
                  </TooltipField>
                  <Slider
                    value={[config.socialSignalsWeight]}
                    onValueChange={([value]) => updateConfig({ socialSignalsWeight: value })}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded">
                <strong>Total Weight:</strong> {config.whaleActivityWeight + config.sentimentWeight + config.newsImpactWeight + config.socialSignalsWeight}%
                {(config.whaleActivityWeight + config.sentimentWeight + config.newsImpactWeight + config.socialSignalsWeight) > 100 && (
                  <div className="flex items-center gap-2 mt-2 text-yellow-600">
                    <AlertTriangle className="h-4 w-4" />
                    Total weight exceeds 100% - signals will be normalized
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Learning & Adaptation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Learning & Adaptation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <TooltipField 
              description="Allow AI to learn from trading results and adapt strategies" 
              examples={["Enable AI learning", "Adapt from results", "Learn from mistakes"]}
            >
              <Label htmlFor="learning">Enable AI Learning</Label>
            </TooltipField>
            <Switch
              id="learning"
              checked={config.enableLearning}
              onCheckedChange={(value) => updateConfig({ enableLearning: value })}
            />
          </div>

          {config.enableLearning && (
            <div className="space-y-4 border-l-2 border-primary/20 pl-4">
              <div className="flex items-center justify-between">
                <TooltipField 
                  description="Adapt strategy parameters based on performance" 
                  examples={["Adjust based on performance", "Learn from wins/losses", "Adapt strategy parameters"]}
                >
                  <Label htmlFor="adapt-performance">Adapt to Performance</Label>
                </TooltipField>
                <Switch
                  id="adapt-performance"
                  checked={config.adaptToPerformance}
                  onCheckedChange={(value) => updateConfig({ adaptToPerformance: value })}
                />
              </div>

              <div className="space-y-2">
                <TooltipField 
                  description="How quickly AI adapts to new information" 
                  examples={["Learn faster", "Adapt quickly", "Slower learning rate"]}
                >
                  <Label>Learning Rate: {config.learningRate}%</Label>
                </TooltipField>
                <Slider
                  value={[config.learningRate]}
                  onValueChange={([value]) => updateConfig({ learningRate: value })}
                  max={100}
                  step={5}
                  className="w-full"
                />
                <p className="text-sm text-muted-foreground">
                  {config.learningRate <= 30 ? "Slow adaptation, high stability" : 
                   config.learningRate <= 70 ? "Balanced adaptation rate" : 
                   "Fast adaptation, may be volatile"}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Communication & Alerts */}
      <Card>
        <CardHeader>
          <CardTitle>AI Communication & Alerts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <TooltipField 
              description="AI explains its decisions and reasoning" 
              examples={["Explain your decisions", "Tell me why you acted", "Provide reasoning"]}
            >
              <Label htmlFor="explain-decisions">Explain AI Decisions</Label>
            </TooltipField>
            <Switch
              id="explain-decisions"
              checked={config.explainDecisions}
              onCheckedChange={(value) => updateConfig({ explainDecisions: value })}
            />
          </div>

          <div className="flex items-center justify-between">
            <TooltipField 
              description="Alert when AI detects market anomalies" 
              examples={["Alert on strange market behavior", "Notify about anomalies", "Warn about unusual patterns"]}
            >
              <Label htmlFor="alert-anomalies">Alert on Anomalies</Label>
            </TooltipField>
            <Switch
              id="alert-anomalies"
              checked={config.alertOnAnomalies}
              onCheckedChange={(value) => updateConfig({ alertOnAnomalies: value })}
            />
          </div>

          <div className="flex items-center justify-between">
            <TooltipField 
              description="Alert when AI overrides strategy rules" 
              examples={["Notify when you override rules", "Alert when breaking strategy", "Tell me when you deviate"]}
            >
              <Label htmlFor="alert-overrides">Alert on Rule Overrides</Label>
            </TooltipField>
            <Switch
              id="alert-overrides"
              checked={config.alertOnOverrides}
              onCheckedChange={(value) => updateConfig({ alertOnOverrides: value })}
            />
          </div>

          <div className="space-y-2">
            <TooltipField 
              description="Custom instructions for AI behavior and decision-making" 
              examples={["Be extra cautious during news", "Focus on BTC signals", "Prioritize safety over profits"]}
            >
              <Label>Custom AI Instructions</Label>
            </TooltipField>
            <Textarea
              placeholder="e.g., 'Be extra cautious during major news events' or 'Prioritize BTC signals over altcoins'"
              value={config.customInstructions}
              onChange={(e) => updateConfig({ customInstructions: e.target.value })}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AIIntelligenceSettings;