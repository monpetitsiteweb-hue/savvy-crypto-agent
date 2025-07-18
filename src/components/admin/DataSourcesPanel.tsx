import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Database, ExternalLink, Plus, Settings, Trash2, Activity, TrendingUp, Shield, BarChart3, AlertTriangle, Zap } from "lucide-react";

interface DataSource {
  id: string;
  source_name: string;
  source_type: string;
  api_endpoint?: string;
  is_active: boolean;
  update_frequency: string;
  configuration: any;
  last_sync?: string;
  created_at: string;
}

const DATA_SOURCE_TEMPLATES = {
  arkham_intelligence: {
    name: "Arkham Intelligence",
    type: "blockchain_analytics",
    endpoint: "https://api.arkhamintelligence.com",
    description: "Track whale movements, institutional flows, and major wallet activities from BlackRock, Trump, MicroStrategy, etc.",
    fields: ["api_key"],
    entities: ["blackrock", "microstrategy", "tesla", "trump", "biden"],
    icon: Shield,
    needsApiKey: true
  },
  fear_greed_index: {
    name: "Fear & Greed Index",
    type: "sentiment",
    endpoint: "https://api.alternative.me/fng",
    description: "Market sentiment analysis based on Fear & Greed Index - free API",
    fields: [],
    entities: ["market_sentiment"],
    icon: TrendingUp,
    needsApiKey: false
  },
  coinbase_institutional: {
    name: "Coinbase Institutional Flows",
    type: "institutional_tracking",
    endpoint: "https://api.exchange.coinbase.com/products",
    description: "Track large institutional trades and volume patterns - free API",
    fields: [],
    entities: ["institutional_flows"],
    icon: BarChart3,
    needsApiKey: false
  },
  whale_alerts: {
    name: "Whale Alert",
    type: "blockchain_analytics", 
    endpoint: "https://api.whale-alert.io",
    description: "Real-time large transaction monitoring across blockchains",
    fields: ["api_key"],
    entities: ["whale_transactions"],
    icon: Activity,
    needsApiKey: true
  },
  twitter_sentiment: {
    name: "Twitter/X Sentiment",
    type: "social_sentiment",
    endpoint: "https://api.twitter.com/2",
    description: "Monitor crypto sentiment on X/Twitter from influencers and retail",
    fields: ["api_key", "bearer_token"],
    entities: ["social_sentiment", "influencer_activity"],
    icon: TrendingUp,
    needsApiKey: true
  },
  youtube_channels: {
    name: "YouTube Crypto Channels",
    type: "social_sentiment",
    endpoint: "https://www.googleapis.com/youtube/v3",
    description: "Track videos from major crypto YouTubers and analysts",
    fields: ["api_key", "channel_ids"],
    entities: ["video_content", "channel_sentiment"],
    icon: Activity,
    needsApiKey: true
  },
  reddit_crypto: {
    name: "Reddit Crypto Communities",
    type: "social_sentiment",
    endpoint: "https://www.reddit.com/r/cryptocurrency",
    description: "Monitor r/cryptocurrency, r/bitcoin, and other crypto subreddits",
    fields: ["client_id", "client_secret"],
    entities: ["reddit_sentiment", "community_discussions"],
    icon: TrendingUp,
    needsApiKey: true
  },
  custom_website: {
    name: "Custom Website/Blog",
    type: "custom_content",
    endpoint: "",
    description: "Add any website URL for content monitoring and analysis",
    fields: ["website_url", "content_selectors"],
    entities: ["custom_content"],
    icon: ExternalLink,
    needsApiKey: false
  }
};

export function DataSourcesPanel() {
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadDataSources();
  }, []);

  const loadDataSources = async () => {
    try {
      const { data, error } = await supabase
        .from('ai_data_sources')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDataSources(data || []);
    } catch (error) {
      console.error('Error loading data sources:', error);
      toast({
        title: "Error",
        description: "Failed to load data sources",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const addDataSource = async () => {
    if (!selectedTemplate) {
      toast({
        title: "Error",
        description: "Please select a data source template",
        variant: "destructive",
      });
      return;
    }

    const template = DATA_SOURCE_TEMPLATES[selectedTemplate as keyof typeof DATA_SOURCE_TEMPLATES];
    
    if (template.needsApiKey && !apiKey) {
      toast({
        title: "Error",
        description: "API key is required for this data source",
        variant: "destructive",
      });
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const config = template.needsApiKey ? { api_key: apiKey } : {};

      const { error } = await supabase
        .from('ai_data_sources')
        .insert({
          user_id: user.id,
          source_name: selectedTemplate,
          source_type: template.type,
          api_endpoint: template.endpoint,
          update_frequency: 'daily',
          configuration: config,
          is_active: true
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: `${template.name} added successfully`,
      });

      setShowAddForm(false);
      setSelectedTemplate('');
      setApiKey('');
      loadDataSources();
    } catch (error) {
      console.error('Error adding data source:', error);
      toast({
        title: "Error",
        description: "Failed to add data source",
        variant: "destructive",
      });
    }
  };

  const toggleDataSource = async (id: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('ai_data_sources')
        .update({ is_active: isActive })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Data source ${isActive ? 'enabled' : 'disabled'}`,
      });

      loadDataSources();
    } catch (error) {
      console.error('Error updating data source:', error);
      toast({
        title: "Error",
        description: "Failed to update data source",
        variant: "destructive",
      });
    }
  };

  const deleteDataSource = async (id: string) => {
    try {
      const { error } = await supabase
        .from('ai_data_sources')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Data source deleted",
      });

      loadDataSources();
    } catch (error) {
      console.error('Error deleting data source:', error);
      toast({
        title: "Error",
        description: "Failed to delete data source",
        variant: "destructive",
      });
    }
  };

  const syncAllSources = async () => {
    setSyncing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.functions.invoke('external-data-collector', {
        body: { action: 'sync_all_sources', userId: user.id }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "All data sources synced successfully",
      });

      loadDataSources();
    } catch (error) {
      console.error('Error syncing data sources:', error);
      toast({
        title: "Error",
        description: "Failed to sync data sources",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const getSourceTemplate = (sourceName: string) => {
    return DATA_SOURCE_TEMPLATES[sourceName as keyof typeof DATA_SOURCE_TEMPLATES];
  };

  const getSourceIcon = (sourceName: string) => {
    const template = getSourceTemplate(sourceName);
    const IconComponent = template?.icon || Database;
    return <IconComponent className="h-4 w-4" />;
  };

  const getSourceColor = (sourceType: string) => {
    switch (sourceType) {
      case 'blockchain_analytics': return 'bg-blue-500/10 text-blue-700';
      case 'sentiment': return 'bg-green-500/10 text-green-700';
      case 'institutional_tracking': return 'bg-purple-500/10 text-purple-700';
      default: return 'bg-gray-500/10 text-gray-700';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            External Data Sources
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">External Data Sources</h2>
          <p className="text-muted-foreground">Connect to external APIs to enhance AI learning with market intelligence</p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={syncAllSources} 
            disabled={syncing || dataSources.length === 0}
            variant="outline"
          >
            {syncing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                Syncing...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Sync All
              </>
            )}
          </Button>
          <Button onClick={() => setShowAddForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Source
          </Button>
        </div>
      </div>

      {/* Current Sources */}
      {dataSources.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {dataSources.map((source) => {
            const template = getSourceTemplate(source.source_name);
            return (
              <Card key={source.id} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {getSourceIcon(source.source_name)}
                    <h3 className="font-semibold">{template?.name || source.source_name}</h3>
                  </div>
                  <Switch
                    checked={source.is_active}
                    onCheckedChange={(checked) => toggleDataSource(source.id, checked)}
                  />
                </div>

                <div className="space-y-2 mb-4">
                  <Badge 
                    variant="secondary" 
                    className={getSourceColor(source.source_type)}
                  >
                    {source.source_type.replace('_', ' ')}
                  </Badge>
                  
                  <p className="text-sm text-muted-foreground">
                    {template?.description || 'External data source'}
                  </p>
                  
                  <p className="text-xs text-muted-foreground">
                    Updates: {source.update_frequency}
                  </p>
                  
                  {source.last_sync && (
                    <p className="text-xs text-muted-foreground">
                      Last sync: {new Date(source.last_sync).toLocaleString()}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      supabase.functions.invoke('external-data-collector', {
                        body: { action: 'sync_source', sourceId: source.id }
                      });
                      toast({
                        title: "Sync Started",
                        description: `Syncing ${template?.name}...`,
                      });
                    }}
                  >
                    Sync Now
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteDataSource(source.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Data Sources Connected</h3>
            <p className="text-muted-foreground mb-4">
              Connect to external APIs to give your AI agent access to market intelligence
            </p>
            <Button onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Source
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Add New Source Modal/Form */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Add External Data Source</CardTitle>
            <CardDescription>
              Connect to external APIs to enhance your AI agent's market knowledge
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Templates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(DATA_SOURCE_TEMPLATES).map(([key, template]) => {
                const IconComponent = template.icon;
                return (
                  <div
                    key={key}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      selectedTemplate === key 
                        ? 'border-primary bg-primary/5' 
                        : 'border-border hover:border-primary/50'
                    }`}
                    onClick={() => setSelectedTemplate(key)}
                  >
                    <div className="flex items-start gap-3">
                      <IconComponent className="h-6 w-6 text-primary mt-1" />
                      <div>
                        <h4 className="font-semibold">{template.name}</h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          {template.description}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline" className={getSourceColor(template.type)}>
                            {template.type.replace('_', ' ')}
                          </Badge>
                          {template.needsApiKey && (
                            <Badge variant="outline" className="text-orange-600">
                              Requires API Key
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* API Key Input */}
            {selectedTemplate && DATA_SOURCE_TEMPLATES[selectedTemplate as keyof typeof DATA_SOURCE_TEMPLATES]?.needsApiKey && (
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your API key"
                />
                <p className="text-sm text-muted-foreground">
                  Get your API key from the provider's dashboard. It will be stored securely.
                </p>
              </div>
            )}

            {/* Special Instructions */}
            {selectedTemplate === 'arkham_intelligence' && (
              <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-blue-800 dark:text-blue-200">Arkham Intelligence Setup</h4>
                    <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                      This will track major players like BlackRock, Trump, MicroStrategy movements. 
                      Get your API key from <ExternalLink className="h-3 w-3 inline" /> arkham.com/api
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
              <Button onClick={addDataSource} disabled={!selectedTemplate}>
                Add Data Source
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}