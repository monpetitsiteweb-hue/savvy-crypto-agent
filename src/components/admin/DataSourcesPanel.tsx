import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Youtube, Twitter, Globe, FileText, MessageSquare, Plus, Edit, RefreshCw, Trash2, Circle, Database, Activity, Bell } from "lucide-react";

// ============================================================================
// CANONICAL SOURCE DEFINITIONS - SINGLE SOURCE OF TRUTH
// ============================================================================

// Fixed mapping for categorization - DO NOT USE source_type from DB
const KNOWLEDGE_BASE_SOURCE_NAMES = [
  "document_upload",
  "website_page",
  "youtube_channels",
  "bigquery",
];

// All canonical sources with their metadata
const CANONICAL_SOURCES: Record<string, {
  name: string;
  category: "knowledge_base" | "signals";
  description: string;
  icon: any;
  configFields: string[];
  defaultFrequency: string;
}> = {
  // Knowledge Base Sources
  document_upload: {
    name: "Document Upload",
    category: "knowledge_base",
    description: "📄 Upload documents (PDF, etc.) for knowledge extraction",
    icon: FileText,
    configFields: ["title", "tags"],
    defaultFrequency: "manual",
  },
  website_page: {
    name: "Website Page",
    category: "knowledge_base",
    description: "🌐 Single website page for static content extraction",
    icon: Globe,
    configFields: ["url", "custom_name"],
    defaultFrequency: "manual",
  },
  youtube_channels: {
    name: "YouTube Channels",
    category: "knowledge_base",
    description: "📺 Monitor YouTube channels for recurring new video updates",
    icon: Youtube,
    configFields: ["channel_url", "youtube_api_key", "update_frequency", "tags"],
    defaultFrequency: "daily",
  },
  bigquery: {
    name: "BigQuery",
    category: "knowledge_base",
    description: "🗄️ Query BigQuery datasets for structured data",
    icon: Database,
    configFields: ["project_id", "dataset_id", "query", "update_frequency"],
    defaultFrequency: "daily",
  },
  // Signal Sources
  coinbase_realtime: {
    name: "Coinbase Realtime",
    category: "signals",
    description: "Real-time market data from Coinbase",
    icon: Activity,
    configFields: ["symbols"],
    defaultFrequency: "realtime",
  },
  eodhd: {
    name: "EODHD API",
    category: "signals",
    description: "Stock & crypto intraday data",
    icon: Activity,
    configFields: ["api_key", "symbols"],
    defaultFrequency: "5min",
  },
  eodhd_api: {
    name: "EODHD API (Legacy)",
    category: "signals",
    description: "Stock & crypto intraday data (legacy)",
    icon: Activity,
    configFields: ["api_key", "symbols"],
    defaultFrequency: "5min",
  },
  fear_greed_index: {
    name: "Fear & Greed Index",
    category: "signals",
    description: "Market sentiment index",
    icon: Activity,
    configFields: [],
    defaultFrequency: "1h",
  },
  cryptonews_api: {
    name: "Crypto News API",
    category: "signals",
    description: "News & sentiment analysis",
    icon: MessageSquare,
    configFields: ["api_key"],
    defaultFrequency: "15min",
  },
  whale_alert: {
    name: "Whale Alert Webhook",
    category: "signals",
    description: "Real-time tracked wallet events via webhook",
    icon: Bell,
    configFields: ["webhook_url", "webhook_secret"],
    defaultFrequency: "realtime",
  },
  whale_alert_api: {
    name: "Whale Alert API",
    category: "signals",
    description: "Whale transactions via API polling",
    icon: Bell,
    configFields: ["api_key"],
    defaultFrequency: "30min",
  },
  quicknode_webhooks: {
    name: "QuickNode Webhooks",
    category: "signals",
    description: "On-chain event webhooks",
    icon: Bell,
    configFields: ["webhook_url"],
    defaultFrequency: "realtime",
  },
  technical_analysis: {
    name: "Technical Analysis",
    category: "signals",
    description: "Technical indicators (RSI, MACD, etc.)",
    icon: Activity,
    configFields: ["symbols", "indicators"],
    defaultFrequency: "5min",
  },
  x_accounts: {
    name: "X (Twitter) Accounts",
    category: "signals",
    description: "Social sentiment from X/Twitter accounts",
    icon: Twitter,
    configFields: ["accounts", "api_key", "update_frequency", "filters"],
    defaultFrequency: "15min",
  },
  coinbase_institutional: {
    name: "Coinbase Institutional",
    category: "signals",
    description: "Institutional flow analysis",
    icon: Activity,
    configFields: [],
    defaultFrequency: "1h",
  },
};

// Interface for deduplicated source from DB
interface DeduplicatedSource {
  source_name: string;
  source_type: string;
  is_active: boolean;
  api_endpoint: string | null;
  update_frequency: string;
  configuration: any;
  webhook_url: string | null;
  webhook_secret: string | null;
}

// Interface for individual instance
interface SourceInstance {
  id: string;
  source_name: string;
  source_type: string;
  is_active: boolean;
  api_endpoint: string | null;
  update_frequency: string;
  configuration: any;
  webhook_url: string | null;
  webhook_secret: string | null;
  created_at: string;
  updated_at: string;
}

interface SourceStatus {
  color: 'green' | 'yellow' | 'red';
  label: string;
}

export function DataSourcesPanel() {
  const [sources, setSources] = useState<DeduplicatedSource[]>([]);
  const [allInstances, setAllInstances] = useState<SourceInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<"" | "signals" | "knowledge_base">("");
  const [selectedSourceName, setSelectedSourceName] = useState<string>("");
  const [formData, setFormData] = useState<any>({});
  const [syncingSource, setSyncingSource] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<DeduplicatedSource | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
  const { toast } = useToast();

  // Reset source when category changes
  const handleCategoryChange = (value: "signals" | "knowledge_base") => {
    setSelectedCategory(value);
    setSelectedSourceName("");
    setFormData({});
  };

  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = async () => {
    try {
      // Fetch all rows (including all instances)
      const { data: rawData, error } = await supabase
        .from("ai_data_sources")
        .select("id, source_name, source_type, is_active, api_endpoint, update_frequency, configuration, webhook_url, webhook_secret, created_at, updated_at")
        .order("updated_at", { ascending: false });

      if (error) throw error;

      // Store all instances
      setAllInstances(rawData || []);

      // Client-side DISTINCT ON simulation - one row per source_name (for card display)
      const seen = new Set<string>();
      const dedupedData: DeduplicatedSource[] = [];
      for (const row of rawData || []) {
        if (!seen.has(row.source_name)) {
          seen.add(row.source_name);
          dedupedData.push({
            source_name: row.source_name,
            source_type: row.source_type,
            is_active: row.is_active,
            api_endpoint: row.api_endpoint,
            update_frequency: row.update_frequency,
            configuration: row.configuration,
            webhook_url: row.webhook_url,
            webhook_secret: row.webhook_secret,
          });
        }
      }
      console.log("[DataSourcesPanel] Loaded deduplicated sources:", dedupedData.map(s => s.source_name));
      console.log("[DataSourcesPanel] Total instances:", rawData?.length);
      setSources(dedupedData);
    } catch (error) {
      console.error("[DataSourcesPanel] Error loading sources:", error);
      toast({
        title: "Error",
        description: "Failed to load data sources",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Categorize using FIXED MAPPING (not source_type from DB)
  const signalSources = useMemo(() => {
    return sources.filter((s) => !KNOWLEDGE_BASE_SOURCE_NAMES.includes(s.source_name));
  }, [sources]);

  const knowledgeBaseSources = useMemo(() => {
    return sources.filter((s) => KNOWLEDGE_BASE_SOURCE_NAMES.includes(s.source_name));
  }, [sources]);

  const getSourceStatus = (source: DeduplicatedSource): SourceStatus => {
    if (!source.is_active) {
      return { color: 'red', label: 'Inactive' };
    }
    return { color: 'green', label: 'Active' };
  };

  const getSourceMeta = (sourceName: string) => {
    return CANONICAL_SOURCES[sourceName] || {
      name: sourceName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      category: KNOWLEDGE_BASE_SOURCE_NAMES.includes(sourceName) ? "knowledge_base" : "signals",
      description: `Data source: ${sourceName}`,
      icon: Globe,
      configFields: [],
      defaultFrequency: "daily",
    };
  };

  const syncSource = async (sourceName: string) => {
    setSyncingSource(sourceName);
    try {
      const isKnowledgeBase = KNOWLEDGE_BASE_SOURCE_NAMES.includes(sourceName);
      const functionName = isKnowledgeBase ? 'knowledge-collector' : 'external-data-collector';
      
      // Find source ID for the sync
      const { data: sourceData } = await supabase
        .from("ai_data_sources")
        .select("id")
        .eq("source_name", sourceName)
        .limit(1)
        .single();

      if (!sourceData) {
        throw new Error("Source not found");
      }

      const body = isKnowledgeBase 
        ? { sourceId: sourceData.id } 
        : { action: 'sync_source', sourceId: sourceData.id };

      const { error } = await supabase.functions.invoke(functionName, { body });

      if (error) throw error;

      toast({
        title: "Sync triggered",
        description: `${getSourceMeta(sourceName).name} sync has been initiated.`,
      });
      
      await loadSources();
    } catch (error) {
      console.error('Sync error:', error);
      toast({
        title: "Sync failed",
        description: `Failed to sync ${getSourceMeta(sourceName).name}`,
        variant: "destructive",
      });
    } finally {
      setSyncingSource(null);
    }
  };

  const addDataSource = async () => {
    try {
      const meta = getSourceMeta(selectedSourceName);
      
      if (!selectedSourceName) {
        toast({ title: "Error", description: "Please select a source type", variant: "destructive" });
        return;
      }

      const { error } = await supabase.from('ai_data_sources').insert({
        source_name: selectedSourceName,
        source_type: meta.category === "knowledge_base" ? "knowledge_base" : "api",
        is_active: true,
        update_frequency: formData.update_frequency || meta.defaultFrequency,
        configuration: formData,
      } as any);

      if (error) throw error;

      toast({ title: "Success", description: "Data source added successfully" });
      setShowAddDialog(false);
      setSelectedCategory("");
      setSelectedSourceName("");
      setFormData({});
      await loadSources();
    } catch (error) {
      console.error('Add error:', error);
      toast({ title: "Error", description: "Failed to add data source", variant: "destructive" });
    }
  };

  const updateDataSource = async () => {
    if (!editingSource) return;
    
    try {
      const { error } = await supabase
        .from('ai_data_sources')
        .update({
          configuration: editFormData,
          update_frequency: editFormData.update_frequency || editingSource.update_frequency,
          is_active: editFormData.is_active !== undefined ? editFormData.is_active : editingSource.is_active
        })
        .eq('source_name', editingSource.source_name);

      if (error) throw error;

      toast({ title: "Success", description: "Data source updated" });
      setEditingSource(null);
      setEditFormData({});
      await loadSources();
    } catch (error) {
      console.error('Update error:', error);
      toast({ title: "Error", description: "Failed to update", variant: "destructive" });
    }
  };

  const deleteDataSource = async (sourceName: string) => {
    if (!confirm('Are you sure you want to delete this data source? This will delete ALL entries for this source.')) return;
    
    try {
      const { error } = await supabase.from('ai_data_sources').delete().eq('source_name', sourceName);
      if (error) throw error;
      toast({ title: "Deleted", description: "Data source removed" });
      await loadSources();
    } catch (error) {
      console.error('Delete error:', error);
      toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
    }
  };

  const openEditDialog = (source: DeduplicatedSource) => {
    setEditingSource(source);
    setEditFormData({ ...source.configuration, is_active: source.is_active });
  };

  const isWebhookSource = (sourceName: string) => {
    return sourceName.includes('webhook') || sourceName === 'whale_alert' || sourceName === 'quicknode_webhooks';
  };

  // Get display text for an instance
  const getInstanceDisplayText = (instance: SourceInstance): string => {
    const meta = getSourceMeta(instance.source_name);
    const config = instance.configuration || {};
    
    // Knowledge base sources
    if (instance.source_name === 'website_page' && config.url) {
      return config.url;
    }
    if (instance.source_name === 'youtube_channels' && config.channel_url) {
      return config.channel_url;
    }
    if (instance.source_name === 'document_upload' && config.title) {
      return config.title;
    }
    if (instance.source_name === 'bigquery' && config.dataset_id) {
      return `${config.project_id || 'project'}/${config.dataset_id}`;
    }
    
    // Signal sources
    if (instance.source_name === 'x_accounts' && config.accounts) {
      return Array.isArray(config.accounts) ? config.accounts.join(', ') : config.accounts;
    }
    if (config.symbols) {
      return `Symbols: ${Array.isArray(config.symbols) ? config.symbols.join(', ') : config.symbols}`;
    }
    if (instance.api_endpoint) {
      return instance.api_endpoint;
    }
    if (config.api_key) {
      return `API Key: ${config.api_key.substring(0, 8)}...`;
    }
    
    // Fallback
    return `Instance #${instance.id.substring(0, 8)}`;
  };

  const renderSourceCard = (source: DeduplicatedSource) => {
    const meta = getSourceMeta(source.source_name);
    const status = getSourceStatus(source);
    const Icon = meta.icon;
    const isWebhook = isWebhookSource(source.source_name);
    
    // Get all instances for this source
    const instances = allInstances.filter(i => i.source_name === source.source_name);

    return (
      <Card key={source.source_name}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5" />
              <CardTitle className="text-base">{meta.name}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Circle className={`h-2 w-2 fill-current ${
                status.color === 'green' ? 'text-green-500' :
                status.color === 'yellow' ? 'text-yellow-500' : 'text-red-500'
              }`} />
              <Badge variant="outline" className="text-xs">
                {meta.category === "knowledge_base" ? "Knowledge" : isWebhook ? "Webhook" : "API"}
              </Badge>
            </div>
          </div>
          <CardDescription className="text-xs">{meta.description}</CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          {/* Instances section */}
          <div className="mb-3 p-2 bg-muted/50 rounded-md">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">Instances: {instances.length}</span>
            </div>
            {instances.length > 0 && (
              <div className="space-y-1 mt-2 max-h-32 overflow-y-auto">
                {instances.map((instance) => (
                  <div key={instance.id} className="text-xs text-muted-foreground truncate">
                    • {getInstanceDisplayText(instance)}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
            <span>Frequency: {source.update_frequency || meta.defaultFrequency}</span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncSource(source.source_name)}
              disabled={syncingSource === source.source_name || isWebhook}
              title={isWebhook ? "Webhook sources receive data in real time" : "Sync now"}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${syncingSource === source.source_name ? 'animate-spin' : ''}`} />
              Sync
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" onClick={() => openEditDialog(source)}>
                  <Edit className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit {meta.name}</DialogTitle>
                </DialogHeader>
                {editingSource?.source_name === source.source_name && (
                  <>
                    <div className="space-y-4">
                      <div>
                        <Label>Status</Label>
                        <Select
                          value={editFormData.is_active ? "active" : "inactive"}
                          onValueChange={(value) =>
                            setEditFormData((prev: any) => ({ ...prev, is_active: value === "active" }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Update Frequency</Label>
                        <Select
                          value={editFormData.update_frequency || source.update_frequency || "daily"}
                          onValueChange={(value) =>
                            setEditFormData((prev: any) => ({ ...prev, update_frequency: value }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="realtime">Realtime</SelectItem>
                            <SelectItem value="manual">Manual</SelectItem>
                            <SelectItem value="5min">Every 5 minutes</SelectItem>
                            <SelectItem value="15min">Every 15 minutes</SelectItem>
                            <SelectItem value="30min">Every 30 minutes</SelectItem>
                            <SelectItem value="1h">Hourly</SelectItem>
                            <SelectItem value="daily">Daily</SelectItem>
                            <SelectItem value="weekly">Weekly</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setEditingSource(null)}>
                        Cancel
                      </Button>
                      <Button onClick={updateDataSource}>
                        Save Changes
                      </Button>
                    </DialogFooter>
                  </>
                )}
              </DialogContent>
            </Dialog>
            <Button variant="ghost" size="sm" onClick={() => deleteDataSource(source.source_name)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderConfigFields = (sourceName: string) => {
    const meta = getSourceMeta(sourceName);
    if (!meta.configFields.length) return null;

    return (
      <div className="space-y-4 mt-4">
        {meta.configFields.map((field) => (
          <div key={field}>
            <Label className="capitalize">{field.replace(/_/g, ' ')}</Label>
            <Input
              value={formData[field] || ''}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, [field]: e.target.value }))}
              placeholder={`Enter ${field.replace(/_/g, ' ')}`}
            />
          </div>
        ))}
      </div>
    );
  };

  // Get ALL canonical sources (allow multiple instances)
  const availableSourcesForAdd = useMemo(() => {
    return Object.entries(CANONICAL_SOURCES)
      .map(([name, meta]) => ({ name, ...meta }));
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>External Data Sources</CardTitle>
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">External Data Sources</h2>
          <p className="text-muted-foreground">Manage signals and knowledge sources ({sources.length} unique sources)</p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Source
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add Data Source</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Step 1: Select Category */}
              <div>
                <Label>Source Category</Label>
                <Select value={selectedCategory} onValueChange={(v) => handleCategoryChange(v as "signals" | "knowledge_base")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="signals">Live Signals</SelectItem>
                    <SelectItem value="knowledge_base">Knowledge Base</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Step 2: Select Source (filtered by category) */}
              {selectedCategory && (
                <div>
                  <Label>Source</Label>
                  <Select value={selectedSourceName} onValueChange={setSelectedSourceName}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a source" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSourcesForAdd
                        .filter(s => s.category === selectedCategory)
                        .map(s => (
                          <SelectItem key={s.name} value={s.name}>
                            {CANONICAL_SOURCES[s.name]?.name || s.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Step 3: Show description + config fields */}
              {selectedSourceName && (
                <>
                  <div className="p-3 bg-muted rounded-md">
                    <p className="text-sm font-medium">{getSourceMeta(selectedSourceName).name}</p>
                    <p className="text-xs text-muted-foreground">{getSourceMeta(selectedSourceName).description}</p>
                    <Badge variant="outline" className="mt-2 text-xs">
                      Category: {getSourceMeta(selectedSourceName).category === "knowledge_base" ? "Knowledge Base" : "Live Signals"}
                    </Badge>
                  </div>
                  {renderConfigFields(selectedSourceName)}
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowAddDialog(false);
                setSelectedCategory("");
                setSelectedSourceName("");
                setFormData({});
              }}>
                Cancel
              </Button>
              <Button onClick={addDataSource} disabled={!selectedCategory || !selectedSourceName}>
                Add Source
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {sources.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No data sources configured yet.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Click "Add Source" to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="signals" className="space-y-4">
          <TabsList>
            <TabsTrigger value="signals">Live Signals ({signalSources.length})</TabsTrigger>
            <TabsTrigger value="knowledge">Knowledge Base ({knowledgeBaseSources.length})</TabsTrigger>
          </TabsList>
          
          <TabsContent value="signals" className="space-y-4">
            {/* Debug panel */}
            <details className="mb-4">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Debug: deduplicated sources ({sources.length} total, {signalSources.length} signals)
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-[10px] leading-tight">
                {JSON.stringify(signalSources.map(s => s.source_name), null, 2)}
              </pre>
            </details>

            {signalSources.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No signal data sources found. Try adding a new API or webhook source.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {signalSources.map(renderSourceCard)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="knowledge" className="space-y-4">
            {knowledgeBaseSources.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No knowledge base sources found. Try adding a new knowledge source.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {knowledgeBaseSources.map(renderSourceCard)}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

export default DataSourcesPanel;
