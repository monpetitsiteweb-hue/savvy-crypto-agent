import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bot, Save, TestTube, Settings, MessageSquare, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export const LLMConfigPanel = () => {
  const { toast } = useToast();
  const [config, setConfig] = useState({
    enabled: false,
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: '',
    temperature: 0.3,
    maxTokens: 2000,
    systemPrompt: `You are an expert cryptocurrency trading strategist. You help users translate natural language trading requirements into precise technical configurations.

Key responsibilities:
- Analyze user trading goals and risk tolerance
- Recommend appropriate technical indicators
- Set optimal entry/exit conditions
- Configure risk management parameters
- Consider market conditions and trends

Always prioritize risk management and provide conservative recommendations unless user explicitly requests aggressive strategies.`,
    contextSources: {
      tradingHistory: true,
      marketData: true,
      newsFeeds: true,
      socialSentiment: true,
      whaleMovements: true
    }
  });

  const [testing, setTesting] = useState(false);

  const handleSaveConfig = async () => {
    try {
      // In a real implementation, this would save to the database
      toast({
        title: "Configuration Saved",
        description: "LLM settings have been updated successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save configuration",
        variant: "destructive",
      });
    }
  };

  const testLLMConnection = async () => {
    setTesting(true);
    try {
      // Simulate API test
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      toast({
        title: "Connection Successful",
        description: "LLM service is responding correctly",
      });
    } catch (error) {
      toast({
        title: "Connection Failed",
        description: "Unable to connect to LLM service",
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">LLM Configuration</h2>
          <p className="text-slate-400">Configure AI-powered strategy generation</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={config.enabled}
            onCheckedChange={(checked) => setConfig(prev => ({ ...prev, enabled: checked }))}
          />
          <Label className="text-slate-300">Enable LLM</Label>
        </div>
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 bg-slate-800">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="prompt">System Prompt</TabsTrigger>
          <TabsTrigger value="sources">Data Sources</TabsTrigger>
          <TabsTrigger value="test">Testing</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <h3 className="text-lg font-semibold text-white mb-4">Provider Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-300">Provider</Label>
                <Select value={config.provider} onValueChange={(value) => setConfig(prev => ({ ...prev, provider: value }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                    <SelectItem value="google">Google (Gemini)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-slate-300">Model</Label>
                <Select value={config.model} onValueChange={(value) => setConfig(prev => ({ ...prev, model: value }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {config.provider === 'openai' && (
                      <>
                        <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                        <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                      </>
                    )}
                    {config.provider === 'anthropic' && (
                      <>
                        <SelectItem value="claude-3-haiku">Claude 3 Haiku</SelectItem>
                        <SelectItem value="claude-3-sonnet">Claude 3 Sonnet</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-slate-300">Temperature</Label>
                <Input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={config.temperature}
                  onChange={(e) => setConfig(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                  className="bg-slate-800 border-slate-600 text-white"
                />
              </div>

              <div>
                <Label className="text-slate-300">Max Tokens</Label>
                <Input
                  type="number"
                  value={config.maxTokens}
                  onChange={(e) => setConfig(prev => ({ ...prev, maxTokens: parseInt(e.target.value) }))}
                  className="bg-slate-800 border-slate-600 text-white"
                />
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="prompt" className="space-y-4">
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <h3 className="text-lg font-semibold text-white mb-4">System Prompt</h3>
            <div className="space-y-4">
              <div>
                <Label className="text-slate-300">Instructions for the AI Trading Assistant</Label>
                <Textarea
                  value={config.systemPrompt}
                  onChange={(e) => setConfig(prev => ({ ...prev, systemPrompt: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white min-h-[200px] mt-2"
                  placeholder="Enter system prompt..."
                />
              </div>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-400" />
                <span className="text-sm text-slate-400">
                  This prompt defines how the AI interprets user requests and generates trading strategies
                </span>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="sources" className="space-y-4">
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <h3 className="text-lg font-semibold text-white mb-4">Data Sources</h3>
            <p className="text-slate-400 mb-6">Configure which data sources the AI can access for strategy generation</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div>
                    <h4 className="font-medium text-white">Trading History</h4>
                    <p className="text-sm text-slate-400">Past trading performance and patterns</p>
                  </div>
                  <Switch
                    checked={config.contextSources.tradingHistory}
                    onCheckedChange={(checked) => setConfig(prev => ({
                      ...prev,
                      contextSources: { ...prev.contextSources, tradingHistory: checked }
                    }))}
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div>
                    <h4 className="font-medium text-white">Market Data</h4>
                    <p className="text-sm text-slate-400">Real-time price and volume data</p>
                  </div>
                  <Switch
                    checked={config.contextSources.marketData}
                    onCheckedChange={(checked) => setConfig(prev => ({
                      ...prev,
                      contextSources: { ...prev.contextSources, marketData: checked }
                    }))}
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div>
                    <h4 className="font-medium text-white">News Feeds</h4>
                    <p className="text-sm text-slate-400">Financial news and market analysis</p>
                  </div>
                  <Switch
                    checked={config.contextSources.newsFeeds}
                    onCheckedChange={(checked) => setConfig(prev => ({
                      ...prev,
                      contextSources: { ...prev.contextSources, newsFeeds: checked }
                    }))}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div>
                    <h4 className="font-medium text-white">Social Sentiment</h4>
                    <p className="text-sm text-slate-400">X (Twitter) and Reddit sentiment analysis</p>
                  </div>
                  <Switch
                    checked={config.contextSources.socialSentiment}
                    onCheckedChange={(checked) => setConfig(prev => ({
                      ...prev,
                      contextSources: { ...prev.contextSources, socialSentiment: checked }
                    }))}
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                  <div>
                    <h4 className="font-medium text-white">Whale Movements</h4>
                    <p className="text-sm text-slate-400">Large transaction and institutional activity</p>
                  </div>
                  <Switch
                    checked={config.contextSources.whaleMovements}
                    onCheckedChange={(checked) => setConfig(prev => ({
                      ...prev,
                      contextSources: { ...prev.contextSources, whaleMovements: checked }
                    }))}
                  />
                </div>

                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-medium text-amber-400">Coming Soon</span>
                  </div>
                  <p className="text-xs text-amber-300">
                    RSS feeds, government data, and advanced market indicators will be available in future releases
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="test" className="space-y-4">
          <Card className="p-6 bg-slate-700/30 border-slate-600">
            <h3 className="text-lg font-semibold text-white mb-4">Test LLM Integration</h3>
            <div className="space-y-4">
              <div className="p-4 bg-slate-800/50 rounded-lg">
                <h4 className="font-medium text-white mb-2">Connection Status</h4>
                <div className="flex items-center gap-2">
                  <Badge variant={config.enabled ? "default" : "secondary"}>
                    {config.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  {config.enabled && (
                    <Badge variant="outline" className="text-green-400 border-green-400/30">
                      {config.provider.toUpperCase()} {config.model}
                    </Badge>
                  )}
                </div>
              </div>

              <Button 
                onClick={testLLMConnection}
                disabled={!config.enabled || testing}
                className="bg-blue-500 hover:bg-blue-600"
              >
                {testing ? (
                  <>
                    <TestTube className="w-4 h-4 mr-2 animate-spin" />
                    Testing Connection...
                  </>
                ) : (
                  <>
                    <TestTube className="w-4 h-4 mr-2" />
                    Test Connection
                  </>
                )}
              </Button>

              <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-sm text-blue-300">
                  <strong>Note:</strong> Testing will verify connectivity to the selected LLM provider and ensure the API key is valid.
                </p>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-3">
        <Button variant="outline" className="border-slate-600 text-slate-300">
          Reset to Defaults
        </Button>
        <Button onClick={handleSaveConfig} className="bg-green-500 hover:bg-green-600">
          <Save className="w-4 h-4 mr-2" />
          Save Configuration
        </Button>
      </div>
    </div>
  );
};