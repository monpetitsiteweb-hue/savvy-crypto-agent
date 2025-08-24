import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Shield, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface SafeModeToggleProps {
  strategyId: string;
}

export const SafeModeToggle: React.FC<SafeModeToggleProps> = ({ strategyId }) => {
  const [safeMode, setSafeMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  const toggleSafeMode = async (enabled: boolean) => {
    if (!user) return;
    
    setLoading(true);
    try {
      // Log the safe mode change
      await supabase
        .from('trade_decisions_log')
        .insert({
          user_id: user.id,
          strategy_id: strategyId,
          symbol: 'ALL',
          intent_side: 'HOLD',
          intent_source: 'manual',
          confidence: 1.0,
          decision_action: 'HOLD_ALL',
          decision_reason: enabled ? 'safe_mode_enabled' : 'safe_mode_disabled',
          metadata: {
            safe_mode_toggle: true,
            timestamp: new Date().toISOString()
          }
        });

      setSafeMode(enabled);
      
      toast({
        title: enabled ? "Safe Mode Enabled" : "Safe Mode Disabled",
        description: enabled 
          ? "All trading decisions will be blocked until disabled"
          : "Normal trading operations resumed",
        variant: enabled ? "default" : "default"
      });
      
    } catch (error) {
      console.error('Safe mode toggle failed:', error);
      toast({
        title: "Toggle Failed",
        description: "Could not change safe mode status",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className={safeMode ? "border-orange-500 bg-orange-50" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          {safeMode ? (
            <AlertTriangle className="h-5 w-5 text-orange-500" />
          ) : (
            <Shield className="h-5 w-5 text-green-500" />
          )}
          Trading Safe Mode
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {safeMode ? "Protected Mode Active" : "Normal Operations"}
            </p>
            <p className="text-xs text-muted-foreground">
              {safeMode 
                ? "All trading decisions blocked - manual approval required"
                : "Automated trading decisions enabled per strategy configuration"
              }
            </p>
          </div>
          <Switch
            checked={safeMode}
            onCheckedChange={toggleSafeMode}
            disabled={loading}
          />
        </div>

        {safeMode && (
          <div className="p-3 bg-orange-100 rounded-lg border border-orange-200">
            <p className="text-sm text-orange-800">
              <AlertTriangle className="inline h-4 w-4 mr-1" />
              Safe mode is active. All buy/sell decisions will return HOLD until disabled.
            </p>
          </div>
        )}

        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground">
            Safe mode changes are logged in the decisions audit trail
          </p>
        </div>
      </CardContent>
    </Card>
  );
};