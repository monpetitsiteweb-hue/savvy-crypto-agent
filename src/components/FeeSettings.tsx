import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export const FeeSettings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [feeRate, setFeeRate] = useState<number>(0.0000);
  const [customFeeRate, setCustomFeeRate] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const feePresets = [
    { label: "Coinbase Advanced (0%)", value: 0.0000 },
    { label: "Coinbase Pro (0.5%)", value: 0.005 },
    { label: "Regular Coinbase (1.5%)", value: 0.015 },
    { label: "Custom", value: "custom" }
  ];

  useEffect(() => {
    if (user) {
      loadUserFeeRate();
    }
  }, [user]);

  const loadUserFeeRate = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('fee_rate')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('Error loading fee rate:', error);
        toast({
          title: "Error",
          description: "Failed to load fee settings",
          variant: "destructive"
        });
        return;
      }

      const userFeeRate = data?.fee_rate || 0.0000;
      setFeeRate(userFeeRate);
      
      // Check if it matches a preset
      const matchingPreset = feePresets.find(preset => 
        typeof preset.value === 'number' && Math.abs(preset.value - userFeeRate) < 0.0001
      );
      
      if (!matchingPreset) {
        setCustomFeeRate((userFeeRate * 100).toFixed(4));
      }
    } catch (error) {
      console.error('Error loading fee rate:', error);
      toast({
        title: "Error",
        description: "Failed to load fee settings",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const saveFeeRate = async () => {
    if (!user) return;
    
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ fee_rate: feeRate })
        .eq('id', user.id);

      if (error) {
        console.error('Error saving fee rate:', error);
        toast({
          title: "Error",
          description: "Failed to save fee settings",
          variant: "destructive"
        });
        return;
      }

      toast({
        title: "Success",
        description: `Fee rate updated to ${(feeRate * 100).toFixed(4)}%`,
      });
    } catch (error) {
      console.error('Error saving fee rate:', error);
      toast({
        title: "Error",
        description: "Failed to save fee settings",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePresetChange = (value: string) => {
    if (value === "custom") {
      setCustomFeeRate((feeRate * 100).toFixed(4));
    } else {
      const selectedPreset = feePresets.find(preset => preset.value.toString() === value);
      if (selectedPreset && typeof selectedPreset.value === 'number') {
        setFeeRate(selectedPreset.value);
        setCustomFeeRate("");
      }
    }
  };

  const handleCustomFeeChange = (value: string) => {
    setCustomFeeRate(value);
    const numericValue = parseFloat(value);
    if (!isNaN(numericValue) && numericValue >= 0 && numericValue <= 10) {
      setFeeRate(numericValue / 100); // Convert percentage to decimal
    }
  };

  const getCurrentPresetValue = () => {
    const matchingPreset = feePresets.find(preset => 
      typeof preset.value === 'number' && Math.abs(preset.value - feeRate) < 0.0001
    );
    return matchingPreset ? matchingPreset.value.toString() : "custom";
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trading Fee Settings</CardTitle>
        <CardDescription>
          Configure your trading fee rate based on your Coinbase account type. 
          This affects how fees are calculated for all trades.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="fee-preset">Account Type</Label>
          <Select value={getCurrentPresetValue()} onValueChange={handlePresetChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select your account type" />
            </SelectTrigger>
            <SelectContent>
              {feePresets.map((preset) => (
                <SelectItem key={preset.value} value={preset.value.toString()}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {getCurrentPresetValue() === "custom" && (
          <div className="space-y-2">
            <Label htmlFor="custom-fee">Custom Fee Rate (%)</Label>
            <Input
              id="custom-fee"
              type="number"
              min="0"
              max="10"
              step="0.0001"
              value={customFeeRate}
              onChange={(e) => handleCustomFeeChange(e.target.value)}
              placeholder="Enter fee percentage (e.g., 0.25 for 0.25%)"
            />
          </div>
        )}

        <div className="p-3 bg-muted rounded-md">
          <p className="text-sm text-muted-foreground">
            <strong>Current Fee Rate:</strong> {(feeRate * 100).toFixed(4)}%
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            On a €1000 trade, you would pay €{(feeRate * 1000).toFixed(2)} in fees.
          </p>
        </div>

        <Button 
          onClick={saveFeeRate} 
          disabled={isSaving}
          className="w-full"
        >
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Fee Settings
        </Button>
      </CardContent>
    </Card>
  );
};