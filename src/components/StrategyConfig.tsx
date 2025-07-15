import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Pause, Settings, Trash2, Plus, TrendingUp, Activity, ArrowUpDown, DollarSign, Shield, AlertTriangle, BarChart3 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { StrategyBuilder } from './strategy/StrategyBuilder';

type MenuSection = 'general' | 'buying' | 'selling';
type MenuItem = 'basic-settings' | 'exchange' | 'notifications' | 'buy-settings' | 'coins-amounts' | 'strategy' | 'trailing-stop-buy' | 'sell-settings' | 'sell-strategy' | 'stop-loss' | 'trailing-stop-loss' | 'auto-close' | 'shorting-settings' | 'dollar-cost-averaging';

const menuItems = {
  general: [
    { id: 'basic-settings', label: 'Basic settings', icon: Settings },
    { id: 'exchange', label: 'Exchange', icon: ArrowUpDown },
    { id: 'notifications', label: 'Notifications', icon: AlertTriangle },
  ],
  buying: [
    { id: 'buy-settings', label: 'Buy settings', icon: DollarSign },
    { id: 'coins-amounts', label: 'Coins and amounts', icon: BarChart3 },
    { id: 'strategy', label: 'Strategy', icon: TrendingUp },
    { id: 'trailing-stop-buy', label: 'Trailing stop-buy', icon: ArrowUpDown },
  ],
  selling: [
    { id: 'sell-settings', label: 'Sell settings', icon: DollarSign },
    { id: 'sell-strategy', label: 'Sell strategy', icon: TrendingUp },
    { id: 'stop-loss', label: 'Stop-loss', icon: AlertTriangle },
    { id: 'trailing-stop-loss', label: 'Trailing stop-loss', icon: ArrowUpDown },
    { id: 'auto-close', label: 'Auto close', icon: Settings },
    { id: 'shorting-settings', label: 'Shorting settings', icon: ArrowUpDown },
    { id: 'dollar-cost-averaging', label: 'Dollar Cost Averaging', icon: DollarSign },
  ],
};

export const StrategyConfig = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [activeMenuItem, setActiveMenuItem] = useState<MenuItem>('basic-settings');
  const [showBuilder, setShowBuilder] = useState(false);

  if (showBuilder) {
    return (
      <StrategyBuilder onCancel={() => setShowBuilder(false)} />
    );
  }

  const renderConfigPanel = () => {
    switch (activeMenuItem) {
      case 'basic-settings':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Basic settings</h3>
              <p className="text-sm text-slate-400">Configure your general trading parameters.</p>
            </div>
            
            <div className="space-y-6">
              <div>
                <Label className="text-slate-300 mb-2 block">Max Total Position (€)</Label>
                <Input 
                  type="number" 
                  defaultValue="5000" 
                  className="bg-slate-600 border-slate-500 text-white"
                />
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Risk Tolerance</Label>
                <Select defaultValue="medium">
                  <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Conservative</SelectItem>
                    <SelectItem value="medium">Moderate</SelectItem>
                    <SelectItem value="high">Aggressive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch id="auto-trading" />
                <Label htmlFor="auto-trading" className="text-slate-300">Enable auto trading</Label>
              </div>
            </div>
          </Card>
        );

      case 'strategy':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Strategy</h3>
              <p className="text-sm text-slate-400">Configure your trading strategy and AI settings.</p>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-slate-300 block">Enable AI Strategy</Label>
                  <p className="text-xs text-slate-400">Use AI to automatically create and manage strategies</p>
                </div>
                <Switch />
              </div>
              
              <Button 
                onClick={() => setShowBuilder(true)}
                className="bg-cyan-500 hover:bg-cyan-600 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create New Strategy
              </Button>
            </div>
          </Card>
        );

      case 'trailing-stop-buy':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Trailing stop-buy</h3>
              <p className="text-sm text-slate-400">Trailing stop-buy will track the currency price downwards.</p>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center space-x-2">
                <Switch id="trailing-stop-buy" />
                <Label htmlFor="trailing-stop-buy" className="text-slate-300">Enable</Label>
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Trailing stop-buy percentage</Label>
                <Input 
                  type="number" 
                  defaultValue="1.5" 
                  className="bg-slate-600 border-slate-500 text-white"
                />
              </div>
            </div>
          </Card>
        );

      case 'sell-settings':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Sell settings</h3>
              <p className="text-sm text-slate-400">Configure the sell settings of your hopper.</p>
            </div>
            
            <div className="space-y-6">
              <div>
                <Label className="text-slate-300 mb-2 block">Take profit at</Label>
                <Input 
                  type="number" 
                  defaultValue="1.3" 
                  className="bg-slate-600 border-slate-500 text-white"
                />
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Order type</Label>
                <Select defaultValue="limit">
                  <SelectTrigger className="bg-slate-600 border-slate-500 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="limit">Limit</SelectItem>
                    <SelectItem value="market">Market</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>
        );

      case 'stop-loss':
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="mb-6">
              <h3 className="text-xl font-semibold text-white mb-2">Stop-loss</h3>
              <p className="text-sm text-slate-400">Enable stop-loss orders.</p>
            </div>
            
            <div className="space-y-6">
              <div className="flex items-center space-x-2">
                <Switch id="stop-loss" />
                <Label htmlFor="stop-loss" className="text-slate-300">Enable</Label>
              </div>
              
              <div>
                <Label className="text-slate-300 mb-2 block">Stop-loss percentage</Label>
                <Input 
                  type="number" 
                  defaultValue="3" 
                  className="bg-slate-600 border-slate-500 text-white"
                />
                <p className="text-xs text-slate-400 mt-1">(Enter as positive, example: 2.8)</p>
              </div>
            </div>
          </Card>
        );

      default:
        return (
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <div className="text-center text-slate-400">
              <Settings className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <h4 className="text-lg font-medium mb-2">Configuration Panel</h4>
              <p className="text-sm">Select an option from the menu to configure your settings</p>
            </div>
          </Card>
        );
    }
  };

  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <div className="w-80 bg-slate-800/50 border-r border-slate-600 p-4">
        {/* General Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">GENERAL</h3>
          <div className="space-y-1">
            {menuItems.general.map((item) => {
              const Icon = item.icon;
              const isActive = activeMenuItem === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveMenuItem(item.id as MenuItem)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    isActive 
                      ? 'bg-cyan-500 text-white' 
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{item.label}</span>
                  {item.id === 'basic-settings' && isActive && (
                    <div className="ml-auto w-2 h-2 bg-green-400 rounded-full"></div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Buying Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">BUYING</h3>
          <div className="space-y-1">
            {menuItems.buying.map((item) => {
              const Icon = item.icon;
              const isActive = activeMenuItem === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveMenuItem(item.id as MenuItem)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    isActive 
                      ? 'bg-cyan-500 text-white' 
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{item.label}</span>
                  {item.id === 'strategy' && (
                    <div className="ml-auto w-2 h-2 bg-green-400 rounded-full"></div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selling Section */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">SELLING</h3>
          <div className="space-y-1">
            {menuItems.selling.map((item) => {
              const Icon = item.icon;
              const isActive = activeMenuItem === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveMenuItem(item.id as MenuItem)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                    isActive 
                      ? 'bg-cyan-500 text-white' 
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-6">
        {renderConfigPanel()}
      </div>
    </div>
  );
};