import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Database, ExternalLink, Plus, Settings, Trash2, Activity, TrendingUp, Shield, BarChart3, AlertTriangle, Zap, CheckCircle, XCircle, Clock, ExternalLinkIcon, Wrench, Edit, RefreshCw } from "lucide-react";

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
  // Existing sources with potential premium upgrades
  arkham_intelligence: {
    name: "Arkham Intelligence",
    type: "blockchain_analytics",
    endpoint: "https://api.arkhamintelligence.com",
    description: "🐋 Track whale movements and institutional flows from BlackRock, Trump, MicroStrategy (Premium: $99+/month)",
    fields: ["api_key", "threshold_amount", "entities"],
    entities: ["blackrock", "microstrategy", "tesla", "trump", "biden"],
    icon: Shield,
    needsApiKey: true,
    cost: "Premium ($99+/month)",
    setupUrl: "https://app.arkhamintelligence.com/api",
    priority: "critical",
    supportsWebhooks: false,
    premiumUpgrade: true
  },
  fear_greed_index: {
    name: "Fear & Greed Index",
    type: "sentiment",
    endpoint: "https://api.alternative.me/fng",
    description: "📊 Market sentiment analysis (0-100 scale) - FREE, no API key required ✅",
    fields: [],
    entities: ["market_sentiment"],
    icon: TrendingUp,
    needsApiKey: false,
    cost: "Free",
    setupUrl: "https://alternative.me/crypto/fear-and-greed-index/",
    priority: "ready",
    supportsWebhooks: false,
    premiumUpgrade: false
  },
  coinbase_institutional: {
    name: "Coinbase Institutional Flows",
    type: "institutional_tracking",
    endpoint: "https://api.exchange.coinbase.com/products",
    description: "💼 Track institutional trading volumes and patterns - FREE, no API key ✅",
    fields: [],
    entities: ["institutional_flows"],
    icon: BarChart3,
    needsApiKey: false,
    cost: "Free",
    setupUrl: "https://docs.cloud.coinbase.com/exchange/docs",
    priority: "ready",
    supportsWebhooks: false,
    premiumUpgrade: false
  },
  whale_alerts: {
    name: "Whale Alert",
    type: "blockchain_analytics", 
    endpoint: "https://api.whale-alert.io",
    description: "🚨 Real-time large transactions (>$100K) monitoring (Premium: $50+/month)",
    fields: ["api_key", "threshold_amount", "blockchain_networks"],
    entities: ["whale_transactions"],
    icon: Activity,
    needsApiKey: true,
    cost: "Premium ($50+/month)",
    setupUrl: "https://whale-alert.io/api",
    priority: "high",
    supportsWebhooks: false,
    premiumUpgrade: true
  },
  
  // New Whale Signal Providers
  cryptocurrency_alerting: {
    name: "Cryptocurrency Alerting",
    type: "whale_signals",
    endpoint: "https://cryptocurrencyalerting.com/api",
    description: "🔔 Webhook-based whale alerts with custom thresholds (Free tier + Premium features)",
    fields: ["webhook_url", "threshold_amount", "blockchain_networks", "api_key"],
    entities: ["whale_webhooks", "threshold_alerts"],
    icon: AlertTriangle,
    needsApiKey: true,
    cost: "Free tier available",
    setupUrl: "https://cryptocurrencyalerting.com/webhook-setup",
    priority: "high",
    supportsWebhooks: true,
    premiumUpgrade: false
  },
  
  bitquery_api: {
    name: "Bitquery API",
    type: "whale_signals",
    endpoint: "https://graphql.bitquery.io",
    description: "📊 Advanced blockchain data queries with whale detection (Free tier: 1000 queries/month)",
    fields: ["api_key", "threshold_amount", "blockchain_networks", "query_config"],
    entities: ["blockchain_queries", "whale_data"],
    icon: BarChart3,
    needsApiKey: true,
    cost: "Free tier (1000 queries/month)",
    setupUrl: "https://bitquery.io/docs/start/",
    priority: "high",
    supportsWebhooks: false,
    premiumUpgrade: false
  },
  
  quicknode_webhooks: {
    name: "QuickNode Webhooks",
    type: "whale_signals", 
    endpoint: "https://api.quicknode.com",
    description: "⚡ Real-time blockchain webhooks with expression filters (Pay-per-use pricing)",
    fields: ["webhook_url", "webhook_secret"],
    entities: ["realtime_webhooks", "expression_alerts"],
    icon: Zap,
    needsApiKey: false,
    cost: "Pay-per-use",
    setupUrl: "https://www.quicknode.com/guides/quicknode-streams/how-to-use-quicknode-streams",
    priority: "high", 
    supportsWebhooks: true,
    premiumUpgrade: false
  },
  twitter_sentiment: {
    name: "Twitter/X Account",
    type: "social_sentiment",
    endpoint: "https://api.twitter.com/2",
    description: "🐦 Monitor crypto sentiment from key influencers (X API Premium: $100+/month)",
    fields: ["account_username", "api_key", "bearer_token"],
    entities: ["social_sentiment", "influencer_activity"],
    icon: TrendingUp,
    needsApiKey: true,
    cost: "Premium",
    setupUrl: "https://developer.twitter.com/en/portal/dashboard",
    priority: "medium",
    supportsWebhooks: false,
    premiumUpgrade: true
  },
  youtube_channels: {
    name: "YouTube Channel",
    type: "social_sentiment",
    endpoint: "https://www.googleapis.com/youtube/v3",
    description: "📺 Track crypto analysis videos and sentiment (YouTube Data API v3 required)",
    fields: ["channel_url", "channel_name", "youtube_api_key"],
    entities: ["video_content", "channel_sentiment"],
    icon: Activity,
    needsApiKey: true,
    cost: "Free tier available",
    setupUrl: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    priority: "medium",
    supportsWebhooks: false,
    premiumUpgrade: false
  },
  reddit_crypto: {
    name: "Reddit Community",
    type: "social_sentiment",
    endpoint: "https://www.reddit.com/api/v1",
    description: "💬 Monitor r/cryptocurrency, r/bitcoin sentiment (Reddit API credentials required)",
    fields: ["subreddit_name", "reddit_client_id", "reddit_client_secret"],
    entities: ["reddit_sentiment", "community_discussions"],
    icon: TrendingUp,
    needsApiKey: true,
    cost: "Free tier available",
    setupUrl: "https://www.reddit.com/prefs/apps",
    priority: "medium",
    supportsWebhooks: false,
    premiumUpgrade: false
  },
  custom_website: {
    name: "Custom Website",
    type: "custom_content",
    endpoint: "",
    description: "🌐 Monitor any website for trading insights and market news - FREE ✅",
    fields: ["website_url", "website_name"],
    entities: ["custom_content"],
    icon: ExternalLink,
    needsApiKey: false,
    cost: "Free",
    setupUrl: "",
    priority: "ready",
    supportsWebhooks: false,
    premiumUpgrade: false
  },
  document_upload: {
    name: "Document Upload",
    type: "knowledge_base",
    endpoint: "local",
    description: "📄 Upload trading strategies, market analysis PDFs for AI knowledge - FREE ✅",
    fields: ["document_file"],
    entities: ["document_content"],
    icon: Database,
    needsApiKey: false,
    cost: "Free",
    setupUrl: "",
    priority: "ready",
    supportsWebhooks: false,
    premiumUpgrade: false
  }
};

export function DataSourcesPanel() {
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [formData, setFormData] = useState<any>({});
  const [syncing, setSyncing] = useState(false);
  const [syncingSource, setSyncingSource] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
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
    
    // Validate required fields
    const requiredFields = template.fields.filter(field => field !== 'document_file');
    const missingFields = requiredFields.filter(field => !formData[field]?.trim());
    
    if (missingFields.length > 0) {
      toast({
        title: "Error",
        description: `Please fill in: ${missingFields.join(', ')}`,
        variant: "destructive",
      });
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const config = { ...formData };
      
      // Auto-generate name if not provided
      if (selectedTemplate === 'youtube_channels' && !config.channel_name && config.channel_url) {
        config.channel_name = `Channel from ${config.channel_url}`;
      }
      if (selectedTemplate === 'custom_website' && !config.website_name && config.website_url) {
        config.website_name = new URL(config.website_url).hostname;
      }

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
      setFormData({});
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

  const openEditDialog = (source: DataSource) => {
    setEditingSource(source);
    setEditFormData({ 
      ...source.configuration,
      is_active: source.is_active,
      update_frequency: source.update_frequency 
    });
  };

  const updateDataSource = async () => {
    if (!editingSource) return;

    try {
      const { is_active, update_frequency, ...configuration } = editFormData;
      
      const { error } = await supabase
        .from('ai_data_sources')
        .update({
          configuration: configuration,
          is_active: is_active ?? editingSource.is_active,
          update_frequency: update_frequency ?? editingSource.update_frequency,
        })
        .eq('id', editingSource.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Data source updated successfully",
      });

      setEditingSource(null);
      setEditFormData({});
      loadDataSources();
    } catch (error) {
      console.error('Error updating source:', error);
      toast({
        title: "Error",
        description: "Failed to update data source",
        variant: "destructive",
      });
    }
  };

  const syncDataSource = async (sourceId: string, sourceName: string) => {
    setSyncingSource(sourceId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.functions.invoke('external-data-collector', {
        body: { 
          action: 'sync_source', 
          sourceId: sourceId,
          userId: user.id
        }
      });

      if (error) throw error;

      toast({
        title: "✅ Synchronized",
        description: `${sourceName} synced successfully`,
      });

      loadDataSources();
    } catch (error) {
      console.error('Error syncing source:', error);
      toast({
        title: "Error",
        description: `Failed to sync ${sourceName}`,
        variant: "destructive",
      });
    } finally {
      setSyncingSource(null);
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
      case 'social_sentiment': return 'bg-orange-500/10 text-orange-700';
      case 'custom_content': return 'bg-indigo-500/10 text-indigo-700';
      case 'knowledge_base': return 'bg-blue-500/10 text-blue-700';
      case 'whale_signals': return 'bg-purple-500/10 text-purple-700';
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
      {/* Header with Status Overview */}
      <div className="space-y-4">
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

        {/* Add Source Modal/Form */}
        {showAddForm && (
          <Card className="border-2 border-primary/20">
            <CardHeader>
              <CardTitle>Add New Data Source</CardTitle>
              <CardDescription>Select a template and configure your data source</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="template">Select Data Source Template</Label>
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a data source..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DATA_SOURCE_TEMPLATES).map(([key, template]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <template.icon className="h-4 w-4" />
                          {template.name}
                          <Badge variant="outline" className="ml-auto">
                            {template.cost}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedTemplate && (
                <div className="space-y-4 border-t pt-4">
                  {DATA_SOURCE_TEMPLATES[selectedTemplate as keyof typeof DATA_SOURCE_TEMPLATES].fields.map((field) => (
                    <div key={field}>
                      <Label htmlFor={field}>{field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</Label>
                      <Input
                        id={field}
                        type={field.includes('secret') || field.includes('token') ? 'password' : 'text'}
                        placeholder={`Enter ${field.replace(/_/g, ' ')}`}
                        value={formData[field] || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, [field]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <Button onClick={addDataSource} disabled={!selectedTemplate}>
                  Add Data Source
                </Button>
                <Button variant="outline" onClick={() => {
                  setShowAddForm(false);
                  setSelectedTemplate('');
                  setFormData({});
                }}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Data Source Status Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold text-green-600">
                  {dataSources.filter(s => ['fear_greed_index', 'coinbase_institutional', 'custom_website', 'document_upload'].includes(s.source_name) && s.is_active).length}
                </div>
                <div className="text-sm text-muted-foreground">Ready Sources</div>
              </div>
            </div>
          </Card>
          
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-500" />
              <div>
                <div className="text-2xl font-bold text-orange-600">
                  {dataSources.filter(s => !['fear_greed_index', 'coinbase_institutional', 'custom_website', 'document_upload'].includes(s.source_name) && s.is_active).length}
                </div>
                <div className="text-sm text-muted-foreground">Need Setup</div>
              </div>
            </div>
          </Card>
          
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" />
              <div>
                <div className="text-2xl font-bold text-red-600">
                  {dataSources.filter(s => !s.is_active).length}
                </div>
                <div className="text-sm text-muted-foreground">Inactive</div>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-500" />
              <div>
                <div className="text-2xl font-bold text-blue-600">{dataSources.length}</div>
                <div className="text-sm text-muted-foreground">Total Sources</div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Tabs for Knowledge Base Organization */}
      <Tabs defaultValue="sources" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="sources">Data Sources</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>
          <TabsTrigger value="all">All Items</TabsTrigger>
        </TabsList>
        
        <TabsContent value="sources" className="space-y-4">
          {dataSources.filter(s => s.source_type !== 'knowledge_base').length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {dataSources.filter(s => s.source_type !== 'knowledge_base').map((source) => {
                const template = getSourceTemplate(source.source_name);
                return (
                  <Card key={source.id} className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {getSourceIcon(source.source_name)}
                        <h3 className="font-semibold">{template?.name || source.source_name}</h3>
                        {template?.priority === 'ready' && <CheckCircle className="h-4 w-4 text-green-500" />}
                        {template?.priority === 'critical' && <AlertTriangle className="h-4 w-4 text-red-500" />}
                        {template?.priority === 'high' && <Clock className="h-4 w-4 text-orange-500" />}
                        {template?.supportsWebhooks && <Zap className="h-4 w-4 text-purple-500" />}
                        {template?.needsApiKey && !template?.priority?.includes('ready') && <Wrench className="h-4 w-4 text-blue-500" />}
                      </div>
                      <Switch
                        checked={source.is_active}
                        onCheckedChange={(checked) => toggleDataSource(source.id, checked)}
                      />
                    </div>

                    <div className="space-y-2 mb-4">
                      <div className="flex flex-wrap gap-2">
                        <Badge 
                          variant="secondary" 
                          className={getSourceColor(source.source_type)}
                        >
                          {source.source_type.replace('_', ' ')}
                        </Badge>
                        {template?.cost && (
                          <Badge variant={template.cost === 'Free' ? 'default' : 'outline'}>
                            {template.cost}
                          </Badge>
                        )}
                        {template?.setupUrl && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 px-2"
                            onClick={() => window.open(template.setupUrl, '_blank')}
                          >
                            <ExternalLinkIcon className="h-3 w-3" />
                            Setup
                          </Button>
                        )}
                      </div>
                      
                      <p className="text-sm text-muted-foreground">
                        {template?.description || 'External data source'}
                      </p>
                      
                      {source.configuration?.channel_name && (
                        <p className="text-xs font-medium">
                          {source.configuration.channel_name}
                        </p>
                      )}
                      
                      {source.configuration?.website_name && (
                        <p className="text-xs font-medium">
                          {source.configuration.website_name}
                        </p>
                      )}
                      
                      {source.configuration?.website_url && (
                        <p className="text-xs text-muted-foreground">
                          {source.configuration.website_url}
                        </p>
                      )}
                      
                      {source.configuration?.account_username && (
                        <p className="text-xs font-medium">
                          @{source.configuration.account_username}
                        </p>
                      )}
                      
                      {/* Hide frequency for webhook sources */}
                      {!template?.supportsWebhooks && (
                        <p className="text-xs text-muted-foreground">
                          Updates: {source.update_frequency}
                        </p>
                      )}
                      
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
                        onClick={() => syncDataSource(source.id, template?.name || source.source_name)}
                        disabled={syncingSource === source.id}
                        className="flex-1"
                      >
                        {syncingSource === source.id ? (
                          <>
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary mr-2"></div>
                            Syncing...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-3 w-3 mr-1" />
                            Sync Now
                          </>
                        )}
                      </Button>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditDialog(source)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                          <DialogHeader>
                            <DialogTitle>Edit: {template?.name || source.source_name}</DialogTitle>
                          </DialogHeader>
                          {editingSource && (
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <Label htmlFor="is_active">Active</Label>
                                  <Switch
                                    id="is_active"
                                    checked={editFormData.is_active ?? editingSource.is_active}
                                    onCheckedChange={(checked) => 
                                      setEditFormData({ ...editFormData, is_active: checked })
                                    }
                                  />
                                </div>
                                <div>
                                  <Label htmlFor="update_frequency">Update Frequency</Label>
                                  <Select
                                    value={editFormData.update_frequency ?? editingSource.update_frequency}
                                    onValueChange={(value) => 
                                      setEditFormData({ ...editFormData, update_frequency: value })
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="realtime">Real-time</SelectItem>
                                      <SelectItem value="hourly">Hourly</SelectItem>
                                      <SelectItem value="daily">Daily</SelectItem>
                                      <SelectItem value="weekly">Weekly</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              {/* Dynamic form fields based on source configuration */}
                              <div className="space-y-3">
                                {Object.entries(editingSource.configuration || {}).map(([key, value]) => (
                                  <div key={key}>
                                    <Label htmlFor={key}>{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</Label>
                                    <Input
                                      id={key}
                                      type={key.includes('secret') || key.includes('token') ? 'password' : 'text'}
                                      value={editFormData[key] ?? value}
                                      onChange={(e) => 
                                        setEditFormData({ ...editFormData, [key]: e.target.value })
                                      }
                                      placeholder={`Enter ${key.replace(/_/g, ' ')}`}
                                    />
                                  </div>
                                ))}
                              </div>

                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setEditingSource(null);
                                    setEditFormData({});
                                  }}
                                >
                                  Cancel
                                </Button>
                                <Button onClick={updateDataSource}>
                                  Save Changes
                                </Button>
                              </div>
                            </div>
                          )}
                        </DialogContent>
                      </Dialog>
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
        </TabsContent>
        
        <TabsContent value="knowledge" className="space-y-4">
          {dataSources.filter(s => s.source_type === 'knowledge_base').length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {dataSources.filter(s => s.source_type === 'knowledge_base').map((source) => (
                <Card key={source.id} className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      <h3 className="font-semibold">{source.configuration?.document_name || source.source_name}</h3>
                    </div>
                    <Switch
                      checked={source.is_active}
                      onCheckedChange={(checked) => toggleDataSource(source.id, checked)}
                    />
                  </div>

                  <div className="space-y-2 mb-4">
                    <Badge variant="secondary" className="bg-blue-500/10 text-blue-700">
                      Document
                    </Badge>
                    
                    <p className="text-sm text-muted-foreground">
                      Uploaded document for AI knowledge base
                    </p>
                    
                    <p className="text-xs text-muted-foreground">
                      Added: {new Date(source.created_at).toLocaleDateString()}
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteDataSource(source.id)}
                    className="w-full text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Remove Document
                  </Button>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="text-center py-12">
                <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Documents in Knowledge Base</h3>
                <p className="text-muted-foreground mb-4">
                  Upload documents to enhance your AI agent's knowledge
                </p>
                <Button onClick={() => setShowAddForm(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Upload Document
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        
        <TabsContent value="all" className="space-y-4">
          {dataSources.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {dataSources.map((source) => {
                const template = getSourceTemplate(source.source_name);
                const isDocument = source.source_type === 'knowledge_base';
                return (
                  <Card key={source.id} className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {isDocument ? <Database className="h-4 w-4" /> : getSourceIcon(source.source_name)}
                        <h3 className="font-semibold">
                          {isDocument 
                            ? (source.configuration?.document_name || source.source_name)
                            : (template?.name || source.source_name)
                          }
                        </h3>
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
                        {isDocument ? "Document" : source.source_type.replace('_', ' ')}
                      </Badge>
                      
                      <p className="text-sm text-muted-foreground">
                        {isDocument ? "Uploaded document for AI knowledge base" : (template?.description || 'External data source')}
                      </p>
                      
                      {source.configuration?.channel_name && (
                        <p className="text-xs font-medium">
                          {source.configuration.channel_name}
                        </p>
                      )}
                      
                      {source.configuration?.website_name && (
                        <p className="text-xs font-medium">
                          {source.configuration.website_name}
                        </p>
                      )}
                      
                      {source.configuration?.account_username && (
                        <p className="text-xs font-medium">
                          @{source.configuration.account_username}
                        </p>
                      )}
                      
                      <p className="text-xs text-muted-foreground">
                        {isDocument ? `Added: ${new Date(source.created_at).toLocaleDateString()}` : `Updates: ${source.update_frequency}`}
                      </p>
                      
                      {source.last_sync && !isDocument && (
                        <p className="text-xs text-muted-foreground">
                          Last sync: {new Date(source.last_sync).toLocaleString()}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2">
                      {!isDocument && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => syncDataSource(source.id, template?.name || source.source_name)}
                          disabled={syncingSource === source.id}
                          className="flex-1"
                        >
                          {syncingSource === source.id ? (
                            <>
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary mr-2"></div>
                              Syncing...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-3 w-3 mr-1" />
                              Sync Now
                            </>
                          )}
                        </Button>
                      )}
                      {!isDocument && (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditDialog(source)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>Edit: {template?.name || source.source_name}</DialogTitle>
                            </DialogHeader>
                            {editingSource && (
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <Label htmlFor="is_active">Active</Label>
                                    <Switch
                                      id="is_active"
                                      checked={editFormData.is_active ?? editingSource.is_active}
                                      onCheckedChange={(checked) => 
                                        setEditFormData({ ...editFormData, is_active: checked })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <Label htmlFor="update_frequency">Update Frequency</Label>
                                    <Select
                                      value={editFormData.update_frequency ?? editingSource.update_frequency}
                                      onValueChange={(value) => 
                                        setEditFormData({ ...editFormData, update_frequency: value })
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="realtime">Real-time</SelectItem>
                                        <SelectItem value="hourly">Hourly</SelectItem>
                                        <SelectItem value="daily">Daily</SelectItem>
                                        <SelectItem value="weekly">Weekly</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>

                                {/* Dynamic form fields based on source configuration */}
                                <div className="space-y-3">
                                  {Object.entries(editingSource.configuration || {}).map(([key, value]) => (
                                    <div key={key}>
                                      <Label htmlFor={key}>{key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</Label>
                                      <Input
                                        id={key}
                                        type={key.includes('secret') || key.includes('token') ? 'password' : 'text'}
                                        value={editFormData[key] ?? value}
                                        onChange={(e) => 
                                          setEditFormData({ ...editFormData, [key]: e.target.value })
                                        }
                                        placeholder={`Enter ${key.replace(/_/g, ' ')}`}
                                      />
                                    </div>
                                  ))}
                                </div>

                                <div className="flex justify-end gap-2">
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      setEditingSource(null);
                                      setEditFormData({});
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                  <Button onClick={updateDataSource}>
                                    Save Changes
                                  </Button>
                                </div>
                              </div>
                            )}
                          </DialogContent>
                        </Dialog>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteDataSource(source.id)}
                        className={`${isDocument ? 'w-full' : ''} text-red-600 hover:text-red-700`}
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
                <h3 className="text-lg font-semibold mb-2">No Items Added</h3>
                <p className="text-muted-foreground mb-4">
                  Add data sources or upload documents to enhance your AI agent
                </p>
                <Button onClick={() => setShowAddForm(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Items
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

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
                    onClick={() => {
                      setSelectedTemplate(key);
                      setFormData({});
                    }}
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

            {/* Dynamic Input Fields */}
            {selectedTemplate && (
              <div className="space-y-4">
                {DATA_SOURCE_TEMPLATES[selectedTemplate as keyof typeof DATA_SOURCE_TEMPLATES]?.fields.map((field) => (
                  <div key={field} className="space-y-2">
                    <Label>{field.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</Label>
                    {field === 'document_file' ? (
                      <Input
                        type="file"
                        accept=".pdf,.doc,.docx,.txt"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setFormData({ ...formData, document_name: file.name });
                          }
                        }}
                      />
                    ) : (
                      <Input
                        type={field.includes('password') || field.includes('secret') || field.includes('key') ? 'password' : 'text'}
                        value={formData[field] || ''}
                        onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
                        placeholder={
                          field === 'account_username' ? '@username' :
                          field === 'channel_url' ? 'https://youtube.com/channel/...' :
                          field === 'channel_name' ? 'Channel Name' :
                          field === 'subreddit_name' ? 'cryptocurrency' :
                          field === 'website_url' ? 'https://example.com' :
                          field === 'website_name' ? 'Website Name' :
                          `Enter ${field.replace('_', ' ')}`
                        }
                      />
                    )}
                    <p className="text-sm text-muted-foreground">
                      {field === 'account_username' && 'Twitter/X username without the @ symbol'}
                      {field === 'channel_url' && 'Full YouTube channel URL'}
                      {field === 'channel_name' && 'Name for this channel (editable)'}
                      {field === 'subreddit_name' && 'Subreddit name without r/'}
                      {field === 'website_url' && 'Complete website URL including https://'}
                      {field === 'website_name' && 'Custom name for this website (editable)'}
                      {field === 'document_file' && 'Upload PDF, DOC, or TXT files for AI analysis'}
                      {field.includes('api_key') && 'Get your API key from the provider\'s dashboard'}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setShowAddForm(false);
                setSelectedTemplate('');
                setFormData({});
              }}>
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