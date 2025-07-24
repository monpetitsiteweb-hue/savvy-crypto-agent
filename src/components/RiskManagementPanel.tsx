import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Shield, AlertTriangle, TrendingUp, DollarSign, BarChart3 } from 'lucide-react';
import { useRiskManagement, UserPreferences } from "@/hooks/useRiskManagement";
import { useToast } from "@/hooks/use-toast";

export const RiskManagementPanel: React.FC = () => {
  const { preferences, dailyStats, saveUserPreferences, loadDailyStats } = useRiskManagement();
  const { toast } = useToast();
  const [localPrefs, setLocalPrefs] = useState<UserPreferences | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (preferences) {
      setLocalPrefs(preferences);
    }
  }, [preferences]);

  useEffect(() => {
    loadDailyStats();
  }, []);

  const handleSave = async () => {
    if (!localPrefs) return;
    
    await saveUserPreferences(localPrefs);
    setHasChanges(false);
  };

  const updatePreference = (key: string, value: any) => {
    if (!localPrefs) return;
    
    setLocalPrefs(prev => {
      if (!prev) return prev;
      
      if (key.includes('.')) {
        const [parent, child] = key.split('.');
        const parentObj = prev[parent as keyof UserPreferences];
        return {
          ...prev,
          [parent]: {
            ...(typeof parentObj === 'object' && parentObj !== null ? parentObj : {}),
            [child]: value
          }
        };
      }
      
      return {
        ...prev,
        [key]: value
      };
    });
    setHasChanges(true);
  };

  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case 'conservative': return 'bg-green-100 text-green-800';
      case 'moderate': return 'bg-yellow-100 text-yellow-800';
      case 'aggressive': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getDailyStatusColor = () => {
    if (dailyStats.pnl > 0) return 'text-green-600';
    if (dailyStats.pnl < -200) return 'text-red-600';
    return 'text-yellow-600';
  };

  if (!localPrefs) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">Loading risk management settings...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Daily Status Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Daily Trading Status
          </CardTitle>
          <CardDescription>
            Current trading activity and risk exposure
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Trades Today</span>
              </div>
              <div className="text-2xl font-bold">
                {dailyStats.trades}
                <span className="text-sm text-muted-foreground ml-2">
                  / {localPrefs.riskLimits.maxTradesPerDay}
                </span>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Daily P&L</span>
              </div>
              <div className={`text-2xl font-bold ${getDailyStatusColor()}`}>
                €{dailyStats.pnl.toFixed(2)}
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Risk Level</span>
              </div>
              <Badge className={getRiskLevelColor(localPrefs.riskLevel)}>
                {localPrefs.riskLevel.toUpperCase()}
              </Badge>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Status</span>
              </div>
              <Badge variant={
                dailyStats.trades >= localPrefs.riskLimits.maxTradesPerDay ||
                Math.abs(dailyStats.pnl) >= localPrefs.riskLimits.maxDailyLoss 
                  ? 'destructive' : 'secondary'
              }>
                {dailyStats.trades >= localPrefs.riskLimits.maxTradesPerDay ||
                 Math.abs(dailyStats.pnl) >= localPrefs.riskLimits.maxDailyLoss 
                  ? 'BLOCKED' : 'ACTIVE'}
              </Badge>
            </div>
          </div>

          {/* Risk Warnings */}
          {(dailyStats.trades >= localPrefs.riskLimits.maxTradesPerDay * 0.8 ||
            Math.abs(dailyStats.pnl) >= localPrefs.riskLimits.maxDailyLoss * 0.8) && (
            <div className="mt-4 p-3 rounded-lg bg-orange-50 border border-orange-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-600" />
                <span className="text-sm text-orange-800">
                  {dailyStats.trades >= localPrefs.riskLimits.maxTradesPerDay * 0.8 && 
                    "Approaching daily trade limit. "}
                  {Math.abs(dailyStats.pnl) >= localPrefs.riskLimits.maxDailyLoss * 0.8 && 
                    "Approaching daily loss limit."}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Risk Management Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Risk Management Settings
          </CardTitle>
          <CardDescription>
            Configure your trading risk parameters and safety limits
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Trading Mode & Risk Level */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Trading Mode</Label>
              <Select 
                value={localPrefs.tradingMode} 
                onValueChange={(value: 'mock' | 'live') => updatePreference('tradingMode', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mock">Mock Trading</SelectItem>
                  <SelectItem value="live">Live Trading</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Risk Level</Label>
              <Select 
                value={localPrefs.riskLevel} 
                onValueChange={(value: 'conservative' | 'moderate' | 'aggressive') => 
                  updatePreference('riskLevel', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conservative">Conservative</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="aggressive">Aggressive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Trade Limits */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Trade Limits</h3>
            
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Max Trade Size (EUR)</Label>
                <Input
                  type="number"
                  value={localPrefs.maxTradeSize}
                  onChange={(e) => updatePreference('maxTradeSize', parseInt(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label>Daily Trade Cap</Label>
                <Input
                  type="number"
                  value={localPrefs.dailyTradeCap}
                  onChange={(e) => updatePreference('dailyTradeCap', parseInt(e.target.value))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Confidence Threshold: {localPrefs.confidenceThreshold}</Label>
              <Slider
                value={[localPrefs.confidenceThreshold]}
                onValueChange={([value]) => updatePreference('confidenceThreshold', value)}
                max={1}
                min={0.1}
                step={0.1}
                className="w-full"
              />
              <div className="text-xs text-muted-foreground">
                Higher values require more confident signals to trigger trades
              </div>
            </div>
          </div>

          <Separator />

          {/* Risk Limits */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Risk Limits</h3>
            
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Max Daily Loss (EUR)</Label>
                <Input
                  type="number"
                  value={localPrefs.riskLimits.maxDailyLoss}
                  onChange={(e) => updatePreference('riskLimits.maxDailyLoss', parseInt(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label>Max Trades Per Day</Label>
                <Input
                  type="number"
                  value={localPrefs.riskLimits.maxTradesPerDay}
                  onChange={(e) => updatePreference('riskLimits.maxTradesPerDay', parseInt(e.target.value))}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Stop Loss (%)</Label>
                <Input
                  type="number"
                  value={localPrefs.riskLimits.stopLossPercentage}
                  onChange={(e) => updatePreference('riskLimits.stopLossPercentage', parseFloat(e.target.value))}
                  step="0.1"
                />
              </div>

              <div className="space-y-2">
                <Label>Take Profit (%)</Label>
                <Input
                  type="number"
                  value={localPrefs.riskLimits.takeProfitPercentage || ''}
                  onChange={(e) => updatePreference('riskLimits.takeProfitPercentage', 
                    e.target.value ? parseFloat(e.target.value) : undefined)}
                  step="0.1"
                  placeholder="Optional"
                />
              </div>

              <div className="space-y-2">
                <Label>Max Position Size (%)</Label>
                <Input
                  type="number"
                  value={localPrefs.riskLimits.maxPositionSize}
                  onChange={(e) => updatePreference('riskLimits.maxPositionSize', parseFloat(e.target.value))}
                  step="0.1"
                />
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-4">
            <Button 
              onClick={handleSave} 
              disabled={!hasChanges}
              variant={hasChanges ? "default" : "secondary"}
            >
              {hasChanges ? "Save Changes" : "Settings Saved"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};