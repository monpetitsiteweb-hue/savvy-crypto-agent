import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InfoIcon, AlertCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';

interface UnifiedConfig {
  enableUnifiedDecisions: boolean;
  minHoldPeriodMs: number;
  cooldownBetweenOppositeActionsMs: number;
  confidenceOverrideThreshold: number;
}

interface UnifiedDecisionsConfigProps {
  config: UnifiedConfig;
  onChange: (config: UnifiedConfig) => void;
  isActive?: boolean;
}

export const UnifiedDecisionsConfig = ({ 
  config: initialConfig, 
  onChange,
  isActive = false 
}: UnifiedDecisionsConfigProps) => {
  const { toast } = useToast();
  const [config, setConfig] = useState<UnifiedConfig>({
    enableUnifiedDecisions: false,
    minHoldPeriodMs: 120000,
    cooldownBetweenOppositeActionsMs: 30000,
    confidenceOverrideThreshold: 0.70,
    ...initialConfig
  });

  useEffect(() => {
    setConfig(prev => ({ ...prev, ...initialConfig }));
  }, [initialConfig]);

  const handleConfigChange = (key: keyof UnifiedConfig, value: any) => {
    const updatedConfig = { ...config, [key]: value };
    setConfig(updatedConfig);
    onChange(updatedConfig);
  };

  const formatDuration = (ms: number) => {
    if (ms >= 60000) {
      return `${ms / 60000} min`;
    }
    return `${ms / 1000} sec`;
  };

  const validateConfig = () => {
    const warnings = [];
    
    if (config.minHoldPeriodMs < 60000) {
      warnings.push('Minimum hold period below 1 minute may cause excessive trading');
    }
    
    if (config.cooldownBetweenOppositeActionsMs < 10000) {
      warnings.push('Very short cooldown may not prevent flip-flopping effectively');
    }
    
    if (config.confidenceOverrideThreshold > 0.95) {
      warnings.push('Very high confidence threshold may block most override opportunities');
    }
    
    return warnings;
  };

  const warnings = validateConfig();

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>Unified Trade Decisions</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <InfoIcon className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-md">
                <p>
                  Prevents contradictory trades by coordinating all buy/sell decisions. 
                  When enabled, all trading engines (automated, intelligent, pool exits) 
                  emit intents to a central coordinator that applies precedence rules 
                  and anti-flip-flop logic.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
        <CardDescription>
          Coordinate trade decisions across all engines to prevent contradictory actions
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="enable-unified">Enable Unified Decisions</Label>
            <p className="text-sm text-muted-foreground">
              Coordinate all trade decisions through a central coordinator
            </p>
          </div>
          <Switch
            id="enable-unified"
            checked={config.enableUnifiedDecisions}
            onCheckedChange={(value) => handleConfigChange('enableUnifiedDecisions', value)}
          />
        </div>

        {/* Configuration options - only show when enabled */}
        {config.enableUnifiedDecisions && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Minimum Hold Period */}
              <div className="space-y-2">
                <Label htmlFor="min-hold">
                  <span className="flex items-center gap-2">
                    Minimum Hold Period
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <InfoIcon className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Minimum time to hold a position before allowing opposite action (prevents quick flip-flopping)</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </span>
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="min-hold"
                    type="number"
                    value={config.minHoldPeriodMs / 1000}
                    onChange={(e) => handleConfigChange('minHoldPeriodMs', parseInt(e.target.value) * 1000)}
                    min={10}
                    max={3600}
                    step={10}
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    seconds ({formatDuration(config.minHoldPeriodMs)})
                  </span>
                </div>
              </div>

              {/* Cooldown Period */}
              <div className="space-y-2">
                <Label htmlFor="cooldown">
                  <span className="flex items-center gap-2">
                    Opposite Action Cooldown
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <InfoIcon className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Cooldown period between opposite actions (e.g., SELL after BUY)</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </span>
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="cooldown"
                    type="number"
                    value={config.cooldownBetweenOppositeActionsMs / 1000}
                    onChange={(e) => handleConfigChange('cooldownBetweenOppositeActionsMs', parseInt(e.target.value) * 1000)}
                    min={5}
                    max={300}
                    step={5}
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    seconds ({formatDuration(config.cooldownBetweenOppositeActionsMs)})
                  </span>
                </div>
              </div>

              {/* Confidence Override Threshold */}
              <div className="space-y-2">
                <Label htmlFor="confidence">
                  <span className="flex items-center gap-2">
                    Confidence Override Threshold
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <InfoIcon className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Minimum confidence required to override cooldown restrictions</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </span>
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="confidence"
                    type="number"
                    value={(config.confidenceOverrideThreshold * 100).toFixed(0)}
                    onChange={(e) => handleConfigChange('confidenceOverrideThreshold', parseInt(e.target.value) / 100)}
                    min={50}
                    max={99}
                    step={1}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </div>

            {/* Warnings */}
            {warnings.length > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="list-disc list-inside space-y-1">
                    {warnings.map((warning, index) => (
                      <li key={index} className="text-sm">{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Status Information */}
            <div className="rounded-lg bg-muted/50 p-4 space-y-2">
              <h4 className="font-medium text-sm">Decision Precedence (High → Low)</h4>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Manual overrides</li>
                <li>Hard risk (stop-loss)</li>
                <li>Pool exits (secure TP, trailing stops)</li>
                <li>Technical SELL signals</li>
                <li>AI/News/Whale BUY signals</li>
                <li>Scheduler BUY signals</li>
              </ol>
              
              <div className="mt-3 pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  {config.enableUnifiedDecisions ? (
                    isActive ? (
                      <span className="text-green-600">✅ Active - All trades coordinated</span>
                    ) : (
                      <span className="text-yellow-600">⏳ Configured - Activate strategy to apply</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">⚪ Disabled - Engines operate independently</span>
                  )}
                </p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};