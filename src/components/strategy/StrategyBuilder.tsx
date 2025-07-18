import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Bot, Settings, TrendingUp, Target, AlertTriangle, ArrowLeft, MessageSquare } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import NaturalLanguageStrategy from './NaturalLanguageStrategy';

interface StrategyBuilderProps {
  onCancel: () => void;
}

export const StrategyBuilder = ({ onCancel }: StrategyBuilderProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeMode, setActiveMode] = useState<'manual' | 'ai' | 'natural'>('manual');
  const [aiPrompt, setAiPrompt] = useState('');
  const [strategyConfig, setStrategyConfig] = useState({
    name: '',
    description: '',
    riskLevel: 'medium',
    maxPosition: 1000,
    stopLoss: 2,
    takeProfit: 3,
    indicators: {
      rsi: { enabled: false, oversold: 30, overbought: 70 },
      macd: { enabled: false },
      sma: { enabled: false, period: 20 },
      bollinger: { enabled: false }
    },
    triggers: {
      priceChange: { enabled: false, threshold: 5 },
      volume: { enabled: false, multiplier: 2 },
      news: { enabled: false }
    },
    parsedConfiguration: null as any,
    requiredCategories: [] as string[]
  });

  const generateAIStrategy = async () => {
    if (!aiPrompt.trim()) {
      toast({
        title: "Missing Prompt",
        description: "Please enter your trading strategy requirements",
        variant: "destructive"
      });
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('generate-ai-strategy', {
        body: { prompt: aiPrompt }
      });

      if (error) throw error;

      if (data.strategy) {
        setStrategyConfig(prev => ({
          ...prev,
          ...data.strategy
        }));
        
        toast({
          title: "AI Strategy Generated",
          description: "Your strategy configuration has been updated with AI recommendations",
        });
      }
    } catch (error) {
      console.error('Error generating AI strategy:', error);
      toast({
        title: "Error",
        description: "Failed to generate AI strategy. Please check admin configuration.",
        variant: "destructive",
      });
    }
  };

  const saveStrategy = async () => {
    if (!user) return;
    
    if (!strategyConfig.name.trim()) {
      toast({
        title: "Missing Name",
        description: "Please enter a strategy name",
        variant: "destructive"
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('trading_strategies')
        .insert({
          user_id: user.id,
          strategy_name: strategyConfig.name,
          description: strategyConfig.description,
          configuration: strategyConfig,
          is_active: false
        });

      if (error) throw error;

      toast({
        title: "Strategy Created",
        description: "Your trading strategy has been saved successfully",
      });
      
      onCancel(); // Go back to strategy list
    } catch (error) {
      console.error('Error saving strategy:', error);
      toast({
        title: "Error",
        description: "Failed to save strategy",
        variant: "destructive",
      });
    }
  };

  const handleStrategyParsed = (parsedStrategy: any) => {
    // Convert parsed strategy to our strategy config format
    setStrategyConfig({
      name: parsedStrategy.strategy_name,
      description: parsedStrategy.description,
      riskLevel: parsedStrategy.risk_level || 'medium',
      maxPosition: parsedStrategy.configuration?.amount?.value || 1000,
      stopLoss: parsedStrategy.configuration?.risk_management?.stop_loss || 2,
      takeProfit: parsedStrategy.configuration?.risk_management?.take_profit || 3,
      indicators: {
        rsi: { enabled: false, oversold: 30, overbought: 70 },
        macd: { enabled: false },
        sma: { enabled: false, period: 20 },
        bollinger: { enabled: false }
      },
      triggers: {
        priceChange: { enabled: false, threshold: 5 },
        volume: { enabled: false, multiplier: 2 },
        news: { enabled: false }
      },
      // Store the full parsed configuration for reference
      parsedConfiguration: parsedStrategy.configuration,
      requiredCategories: parsedStrategy.required_categories
    });
    
    // Switch to manual mode to show the generated config
    setActiveMode('manual');
    
    toast({
      title: "Strategy Parsed Successfully",
      description: `${parsedStrategy.strategy_name} is ready for review and customization`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel} className="text-slate-400 hover:text-white">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Strategies
          </Button>
          <h2 className="text-2xl font-bold text-white">Strategy Builder</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={activeMode === 'manual' ? 'default' : 'outline'}
            onClick={() => setActiveMode('manual')}
            size="sm"
            className="transition-colors hover:bg-primary/20"
          >
            <Settings className="w-4 h-4 mr-2" />
            Manual
          </Button>
          <Button
            variant={activeMode === 'natural' ? 'default' : 'outline'}
            onClick={() => setActiveMode('natural')}
            size="sm"
            className="transition-colors hover:bg-primary/20"
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Natural Language
          </Button>
          <Button
            variant={activeMode === 'ai' ? 'default' : 'outline'}
            onClick={() => setActiveMode('ai')}
            size="sm"
            className="transition-colors hover:bg-primary/20"
          >
            <Bot className="w-4 h-4 mr-2" />
            AI Assistant
          </Button>
        </div>
      </div>

      {activeMode === 'natural' ? (
        <NaturalLanguageStrategy 
          onStrategyParsed={handleStrategyParsed}
          onCancel={onCancel}
        />
      ) : activeMode === 'ai' ? (
        <Card className="p-6 bg-slate-700/30 border-slate-600">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Bot className="w-6 h-6 text-blue-400 mt-1" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white mb-2">AI Strategy Assistant</h3>
                <p className="text-sm text-slate-400 mb-4">
                  Describe your trading strategy in natural language and our AI will generate the optimal configuration for you.
                </p>
                
                <Textarea
                  placeholder="e.g., 'I want a conservative strategy that buys Bitcoin when it dips 5% and sells when it gains 3%. Use RSI indicators and never risk more than 2% of my portfolio.'"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  className="mb-4 bg-slate-800 border-slate-600 text-white"
                  rows={4}
                />
                
                <Button onClick={generateAIStrategy} className="bg-blue-500 hover:bg-blue-600">
                  <Bot className="w-4 h-4 mr-2" />
                  Generate Strategy
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Tabs defaultValue="basic" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4 bg-slate-800">
            <TabsTrigger value="basic">Basic Settings</TabsTrigger>
            <TabsTrigger value="indicators">Indicators</TabsTrigger>
            <TabsTrigger value="triggers">Triggers</TabsTrigger>
            <TabsTrigger value="risk">Risk Management</TabsTrigger>
          </TabsList>
          
          <TabsContent value="basic" className="space-y-4">
            <Card className="p-6 bg-slate-700/30 border-slate-600">
              <h3 className="text-lg font-semibold text-white mb-4">Basic Configuration</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name" className="text-slate-300">Strategy Name</Label>
                  <Input
                    id="name"
                    value={strategyConfig.name}
                    onChange={(e) => setStrategyConfig(prev => ({ ...prev, name: e.target.value }))}
                    className="bg-slate-800 border-slate-600 text-white"
                    placeholder="My Trading Strategy"
                  />
                </div>
                
                <div>
                  <Label htmlFor="risk" className="text-slate-300">Risk Level</Label>
                  <Select value={strategyConfig.riskLevel} onValueChange={(value) => setStrategyConfig(prev => ({ ...prev, riskLevel: value }))}>
                    <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low Risk</SelectItem>
                      <SelectItem value="medium">Medium Risk</SelectItem>
                      <SelectItem value="high">High Risk</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="md:col-span-2">
                  <Label htmlFor="description" className="text-slate-300">Description</Label>
                  <Textarea
                    id="description"
                    value={strategyConfig.description}
                    onChange={(e) => setStrategyConfig(prev => ({ ...prev, description: e.target.value }))}
                    className="bg-slate-800 border-slate-600 text-white"
                    placeholder="Describe your strategy..."
                  />
                </div>
              </div>
            </Card>
          </TabsContent>
          
          <TabsContent value="indicators" className="space-y-4">
            <Card className="p-6 bg-slate-700/30 border-slate-600">
              <h3 className="text-lg font-semibold text-white mb-4">Technical Indicators</h3>
              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg">
                  <div>
                    <h4 className="font-medium text-white">RSI (Relative Strength Index)</h4>
                    <p className="text-sm text-slate-400">Momentum oscillator measuring speed and change of price movements</p>
                  </div>
                  <Switch
                    checked={strategyConfig.indicators.rsi.enabled}
                    onCheckedChange={(checked) => setStrategyConfig(prev => ({
                      ...prev,
                      indicators: { ...prev.indicators, rsi: { ...prev.indicators.rsi, enabled: checked }}
                    }))}
                  />
                </div>
                
                <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg">
                  <div>
                    <h4 className="font-medium text-white">MACD</h4>
                    <p className="text-sm text-slate-400">Moving Average Convergence Divergence</p>
                  </div>
                  <Switch
                    checked={strategyConfig.indicators.macd.enabled}
                    onCheckedChange={(checked) => setStrategyConfig(prev => ({
                      ...prev,
                      indicators: { ...prev.indicators, macd: { enabled: checked }}
                    }))}
                  />
                </div>
                
                <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg">
                  <div>
                    <h4 className="font-medium text-white">Simple Moving Average (SMA)</h4>
                    <p className="text-sm text-slate-400">Average price over a specific number of periods</p>
                  </div>
                  <Switch
                    checked={strategyConfig.indicators.sma.enabled}
                    onCheckedChange={(checked) => setStrategyConfig(prev => ({
                      ...prev,
                      indicators: { ...prev.indicators, sma: { ...prev.indicators.sma, enabled: checked }}
                    }))}
                  />
                </div>
              </div>
            </Card>
          </TabsContent>
          
          <TabsContent value="triggers" className="space-y-4">
            <Card className="p-6 bg-slate-700/30 border-slate-600">
              <h3 className="text-lg font-semibold text-white mb-4">Trading Triggers</h3>
              <div className="space-y-6">
                <div className="p-4 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="font-medium text-white">Price Change Trigger</h4>
                      <p className="text-sm text-slate-400">Execute trades based on price movements</p>
                    </div>
                    <Switch
                      checked={strategyConfig.triggers.priceChange.enabled}
                      onCheckedChange={(checked) => setStrategyConfig(prev => ({
                        ...prev,
                        triggers: { ...prev.triggers, priceChange: { ...prev.triggers.priceChange, enabled: checked }}
                      }))}
                    />
                  </div>
                  {strategyConfig.triggers.priceChange.enabled && (
                    <div>
                      <Label className="text-slate-300">Threshold (%)</Label>
                      <Slider
                        value={[strategyConfig.triggers.priceChange.threshold]}
                        onValueChange={([value]) => setStrategyConfig(prev => ({
                          ...prev,
                          triggers: { ...prev.triggers, priceChange: { ...prev.triggers.priceChange, threshold: value }}
                        }))}
                        max={20}
                        min={1}
                        step={0.5}
                        className="mt-2"
                      />
                    </div>
                  )}
                </div>
                
                <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg">
                  <div>
                    <h4 className="font-medium text-white">Volume Spike</h4>
                    <p className="text-sm text-slate-400">React to unusual trading volume</p>
                  </div>
                  <Switch
                    checked={strategyConfig.triggers.volume.enabled}
                    onCheckedChange={(checked) => setStrategyConfig(prev => ({
                      ...prev,
                      triggers: { ...prev.triggers, volume: { ...prev.triggers.volume, enabled: checked }}
                    }))}
                  />
                </div>
                
                <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg">
                  <div>
                    <h4 className="font-medium text-white">News Events</h4>
                    <p className="text-sm text-slate-400">Execute based on news sentiment</p>
                  </div>
                  <Switch
                    checked={strategyConfig.triggers.news.enabled}
                    onCheckedChange={(checked) => setStrategyConfig(prev => ({
                      ...prev,
                      triggers: { ...prev.triggers, news: { enabled: checked }}
                    }))}
                  />
                </div>
              </div>
            </Card>
          </TabsContent>
          
          <TabsContent value="risk" className="space-y-4">
            <Card className="p-6 bg-slate-700/30 border-slate-600">
              <h3 className="text-lg font-semibold text-white mb-4">Risk Management</h3>
              <div className="space-y-6">
                <div>
                  <Label className="text-slate-300">Maximum Position Size (€)</Label>
                  <Slider
                    value={[strategyConfig.maxPosition]}
                    onValueChange={([value]) => setStrategyConfig(prev => ({ ...prev, maxPosition: value }))}
                    max={5000}
                    min={100}
                    step={50}
                    className="mt-2"
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>€100</span>
                    <span>€{strategyConfig.maxPosition}</span>
                    <span>€5,000</span>
                  </div>
                </div>
                
                <div>
                  <Label className="text-slate-300">Stop Loss (%)</Label>
                  <Slider
                    value={[strategyConfig.stopLoss]}
                    onValueChange={([value]) => setStrategyConfig(prev => ({ ...prev, stopLoss: value }))}
                    max={10}
                    min={0.5}
                    step={0.5}
                    className="mt-2"
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>0.5%</span>
                    <span>{strategyConfig.stopLoss}%</span>
                    <span>10%</span>
                  </div>
                </div>
                
                <div>
                  <Label className="text-slate-300">Take Profit (%)</Label>
                  <Slider
                    value={[strategyConfig.takeProfit]}
                    onValueChange={([value]) => setStrategyConfig(prev => ({ ...prev, takeProfit: value }))}
                    max={20}
                    min={1}
                    step={0.5}
                    className="mt-2"
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>1%</span>
                    <span>{strategyConfig.takeProfit}%</span>
                    <span>20%</span>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      )}
      
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onCancel} className="border-slate-600 text-slate-300">
          Cancel
        </Button>
        <Button onClick={saveStrategy} className="bg-green-500 hover:bg-green-600">
          Save Strategy
        </Button>
      </div>
    </div>
  );
};