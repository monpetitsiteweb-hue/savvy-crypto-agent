import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Settings, GripVertical, X } from 'lucide-react';

interface ExecutionSettings {
  execution_mode: 'COINBASE' | 'ONCHAIN';
  chain_id: number;
  slippage_bps_default: number;
  preferred_providers: string[];
  mev_policy: 'auto' | 'force_private' | 'cow_only';
  max_gas_cost_pct: number;
  max_price_impact_bps: number;
  max_quote_age_ms: number;
}

interface ExecutionSettingsPanelProps {
  settings: ExecutionSettings;
  onChange: (settings: ExecutionSettings) => void;
}

const CHAIN_OPTIONS = [
  { value: 8453, label: 'Base' },
  { value: 42161, label: 'Arbitrum' },
  { value: 1, label: 'Ethereum' }
];

const PROVIDER_OPTIONS = [
  { value: '0x', label: '0x Protocol' },
  { value: 'cow', label: 'CoW Protocol' },
  { value: '1inch', label: '1inch' },
  { value: 'uniswap', label: 'Uniswap' }
];

const MEV_POLICY_OPTIONS = [
  { value: 'auto', label: 'Auto (Smart routing)' },
  { value: 'force_private', label: 'Force Private' },
  { value: 'cow_only', label: 'CoW Only' }
];

// Helper component for draggable provider chips
const ProviderChip: React.FC<{
  provider: string;
  index: number;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
}> = ({ provider, index, onRemove, onDragStart, onDragOver, onDrop }) => {
  const providerLabel = PROVIDER_OPTIONS.find(p => p.value === provider)?.label || provider;

  return (
    <Badge
      variant="secondary"
      className="flex items-center gap-2 px-3 py-1 cursor-move select-none"
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, index)}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground" />
      <span>{providerLabel}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-4 w-4 p-0 hover:bg-destructive/20"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </Button>
    </Badge>
  );
};

export const ExecutionSettingsPanel: React.FC<ExecutionSettingsPanelProps> = ({
  settings,
  onChange
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const updateSettings = (updates: Partial<ExecutionSettings>) => {
    onChange({ ...settings, ...updates });
  };

  const handleProviderAdd = (provider: string) => {
    if (!settings.preferred_providers.includes(provider)) {
      updateSettings({
        preferred_providers: [...settings.preferred_providers, provider]
      });
    }
  };

  const handleProviderRemove = (index: number) => {
    const newProviders = settings.preferred_providers.filter((_, i) => i !== index);
    updateSettings({ preferred_providers: newProviders });
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    
    if (draggedIndex === null || draggedIndex === dropIndex) return;

    const newProviders = [...settings.preferred_providers];
    const draggedProvider = newProviders[draggedIndex];
    
    // Remove from old position
    newProviders.splice(draggedIndex, 1);
    
    // Insert at new position
    const insertIndex = draggedIndex < dropIndex ? dropIndex - 1 : dropIndex;
    newProviders.splice(insertIndex, 0, draggedProvider);
    
    updateSettings({ preferred_providers: newProviders });
    setDraggedIndex(null);
  };

  const availableProviders = PROVIDER_OPTIONS.filter(
    p => !settings.preferred_providers.includes(p.value)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Execution Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Execution Mode */}
        <div className="space-y-2">
          <Label htmlFor="execution-mode">Execution Mode</Label>
          <Select
            value={settings.execution_mode}
            onValueChange={(value: 'COINBASE' | 'ONCHAIN') =>
              updateSettings({ execution_mode: value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="COINBASE">Coinbase (CEX)</SelectItem>
              <SelectItem value="ONCHAIN">On-Chain (DEX)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* On-Chain Settings - Only shown when ONCHAIN mode is selected */}
        {settings.execution_mode === 'ONCHAIN' && (
          <div className="space-y-6 border-l-2 border-primary/20 pl-4">
            {/* Chain Selection */}
            <div className="space-y-2">
              <Label htmlFor="chain-id">Blockchain Network</Label>
              <Select
                value={settings.chain_id.toString()}
                onValueChange={(value) => updateSettings({ chain_id: parseInt(value) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHAIN_OPTIONS.map(chain => (
                    <SelectItem key={chain.value} value={chain.value.toString()}>
                      {chain.label} (Chain ID: {chain.value})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preferred Providers */}
            <div className="space-y-3">
              <Label>Preferred Providers (Drag to reorder)</Label>
              <div className="flex flex-wrap gap-2 min-h-[40px]">
                {settings.preferred_providers.map((provider, index) => (
                  <ProviderChip
                    key={`${provider}-${index}`}
                    provider={provider}
                    index={index}
                    onRemove={() => handleProviderRemove(index)}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                  />
                ))}
              </div>
              {availableProviders.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Add provider:</Label>
                  <div className="flex flex-wrap gap-2">
                    {availableProviders.map(provider => (
                      <Button
                        key={provider.value}
                        variant="outline"
                        size="sm"
                        onClick={() => handleProviderAdd(provider.value)}
                      >
                        + {provider.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Slippage Tolerance */}
            <div className="space-y-2">
              <Label htmlFor="slippage">Default Slippage Tolerance (Basis Points)</Label>
              <Input
                id="slippage"
                type="number"
                value={settings.slippage_bps_default}
                onChange={(e) => updateSettings({ slippage_bps_default: parseInt(e.target.value) || 50 })}
                min="1"
                max="1000"
              />
              <p className="text-xs text-muted-foreground">
                {settings.slippage_bps_default} bps = {(settings.slippage_bps_default / 100).toFixed(2)}%
              </p>
            </div>

            {/* MEV Policy */}
            <div className="space-y-2">
              <Label htmlFor="mev-policy">MEV Protection Policy</Label>
              <Select
                value={settings.mev_policy}
                onValueChange={(value: 'auto' | 'force_private' | 'cow_only') =>
                  updateSettings({ mev_policy: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEV_POLICY_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Guardrails */}
            <div className="space-y-4">
              <Label className="text-base font-semibold">Trading Guardrails</Label>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="max-gas-cost">Max Gas Cost (%)</Label>
                  <Input
                    id="max-gas-cost"
                    type="number"
                    step="0.01"
                    value={settings.max_gas_cost_pct}
                    onChange={(e) => updateSettings({ max_gas_cost_pct: parseFloat(e.target.value) || 0.35 })}
                    min="0"
                    max="5"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max-price-impact">Max Price Impact (bps)</Label>
                  <Input
                    id="max-price-impact"
                    type="number"
                    value={settings.max_price_impact_bps}
                    onChange={(e) => updateSettings({ max_price_impact_bps: parseInt(e.target.value) || 40 })}
                    min="1"
                    max="1000"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max-quote-age">Max Quote Age (ms)</Label>
                  <Input
                    id="max-quote-age"
                    type="number"
                    value={settings.max_quote_age_ms}
                    onChange={(e) => updateSettings({ max_quote_age_ms: parseInt(e.target.value) || 1500 })}
                    min="100"
                    max="30000"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};