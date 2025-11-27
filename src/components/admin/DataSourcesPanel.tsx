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
import { Youtube, Twitter, Globe, FileText, MessageSquare, Plus, Edit, RefreshCw, Trash2, Circle } from "lucide-react";

interface DataSource {
  id: string;
  source_name: string;
  source_type: string;
  is_active: boolean;
  update_frequency: string;
  configuration: any;
  last_sync?: string;
  created_at: string;
}

interface SourceStatus {
  color: 'green' | 'yellow' | 'red';
  label: string;
}

type RefreshMode = 'static' | 'feed';

interface SourceTemplate {
  name: string;
  type: string;
  description: string;
  refresh_mode: RefreshMode;
  icon: any;
  fields: string[];
  default_frequency?: string;
}

// Knowledge Base templates (for labels/descriptions only)
const KNOWLEDGE_SOURCE_TEMPLATES: Record<string, SourceTemplate> = {
  youtube_channels: {
    name: "YouTube Channels",
    type: "knowledge_base",
    description: "📺 Monitor YouTube channels for recurring new video updates",
    refresh_mode: "feed",
    icon: Youtube,
    fields: ["channel_url", "youtube_api_key", "update_frequency", "tags"],
    default_frequency: "daily"
  },
  website_page: {
    name: "Website Page",
    type: "knowledge_base",
    description: "🌐 Single website page for static content extraction",
    refresh_mode: "static",
    icon: Globe,
    fields: ["url", "custom_name"],
    default_frequency: "manual"
  },
  document_upload: {
    name: "Document Upload",
    type: "knowledge_base",
    description: "📄 Upload documents (PDF, etc.) for knowledge extraction",
    refresh_mode: "static",
    icon: FileText,
    fields: ["title", "tags"],
    default_frequency: "manual"
  },
  bigquery: {
    name: "BigQuery",
    type: "knowledge_base",
    description: "🗄️ Query BigQuery datasets for structured data",
    refresh_mode: "feed",
    icon: Globe,
    fields: ["project_id", "dataset_id", "query", "update_frequency"],
    default_frequency: "daily"
  },
  custom_website: {
    name: "Custom Website",
    type: "knowledge_base",
    description: "🌐 Custom website scraping configuration",
    refresh_mode: "feed",
    icon: Globe,
    fields: ["url", "custom_name", "update_frequency", "filters"],
    default_frequency: "daily"
  }
};

// API source templates (for labels/descriptions only)
const API_SOURCE_TEMPLATES: Record<string, { name: string; type: string; description: string; fields: string[]; default_frequency: string }> = {
  eodhd: { name: "EODHD API", type: "api", description: "Stock & crypto intraday data", fields: ["api_key"], default_frequency: "5min" },
  eodhd_api: { name: "EODHD API", type: "api", description: "Stock & crypto intraday data (legacy)", fields: ["api_key"], default_frequency: "5min" },
  whale_alert_api: { name: "Whale Alert API", type: "api", description: "Whale transactions via API", fields: ["api_key"], default_frequency: "30min" },
  cryptonews_api: { name: "Crypto News API", type: "api", description: "News & sentiment analysis", fields: ["api_key"], default_frequency: "15min" },
  fear_greed_index: { name: "Fear & Greed Index", type: "api", description: "Market sentiment index", fields: [], default_frequency: "1h" },
  coinbase_institutional: { name: "Coinbase Institutional", type: "api", description: "Institutional flow analysis", fields: [], default_frequency: "1h" }
};

// Webhook source templates (for labels/descriptions only)
const WEBHOOK_SOURCE_TEMPLATES: Record<string, { name: string; type: string; description: string; fields: string[]; default_frequency: string }> = {
  whale_alert: { name: "Whale Alert Webhook", type: "webhook", description: "Real-time tracked wallet events", fields: ["webhook_url"], default_frequency: "manual" },
  quicknode_webhooks: { name: "QuickNode Webhooks", type: "webhook", description: "On-chain event webhooks", fields: ["webhook_url"], default_frequency: "manual" }
};

export function DataSourcesPanel() {
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [formData, setFormData] = useState<any>({});
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
        .from("ai_data_sources")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Store ALL rows from Supabase - no frontend filtering
      const loaded = data || [];
      console.log("[DataSourcesPanel] Loaded ai_data_sources:", loaded);
      setDataSources(loaded);
    } catch (error) {
      console.error("[DataSourcesPanel] Error:", error);
      toast({
        title: "Error",
        description: "Failed to load data sources",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // SIMPLE FILTERING: Signals = everything that is NOT knowledge_base
  const signalSources = useMemo(() => {
    if (!dataSources) return [];
    return dataSources.filter((s) => s.source_type !== "knowledge_base");
  }, [dataSources]);

  // SIMPLE FILTERING: Knowledge Base = source_type === "knowledge_base"
  const knowledgeBaseSources = useMemo(() => {
    if (!dataSources) return [];
    return dataSources.filter((s) => s.source_type === "knowledge_base");
  }, [dataSources]);

  const getSourceStatus = (source: DataSource): SourceStatus => {
    if (!source.is_active) {
      return { color: 'red', label: 'Inactive' };
    }
    if (!source.last_sync) {
      return { color: 'yellow', label: 'Pending' };
    }
    return { color: 'green', label: 'Active' };
  };

  const syncSource = async (sourceId: string, sourceName: string) => {
    setSyncingSource(sourceId);
    try {
      const isKnowledgeBase = knowledgeBaseSources.some(s => s.id === sourceId);
      const functionName = isKnowledgeBase ? 'knowledge-collector' : 'external-data-collector';
      const body = isKnowledgeBase 
        ? { sourceId } 
        : { action: 'sync_source', sourceId };

      const { data, error } = await supabase.functions.invoke(functionName, { body });

      if (error) throw error;

      toast({
        title: "Sync triggered",
        description: `${sourceName} sync has been initiated.`,
      });
      
      await loadDataSources();
    } catch (error) {
      console.error('Sync error:', error);
      toast({
        title: "Sync failed",
        description: `Failed to sync ${sourceName}`,
        variant: "destructive",
      });
    } finally {
      setSyncingSource(null);
    }
  };

  const addDataSource = async () => {
    try {
      const template = KNOWLEDGE_SOURCE_TEMPLATES[selectedTemplate] || 
                       API_SOURCE_TEMPLATES[selectedTemplate] || 
                       WEBHOOK_SOURCE_TEMPLATES[selectedTemplate];
      
      if (!template) {
        toast({ title: "Error", description: "Please select a source type", variant: "destructive" });
        return;
      }

      const { error } = await supabase.from('ai_data_sources').insert({
        source_name: selectedTemplate,
        source_type: template.type,
        is_active: true,
        update_frequency: formData.update_frequency || template.default_frequency || 'daily',
        configuration: formData
      } as any);

      if (error) throw error;

      toast({ title: "Success", description: "Data source added successfully" });
      setShowAddDialog(false);
      setSelectedTemplate('');
      setFormData({});
      await loadDataSources();
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
        .eq('id', editingSource.id);

      if (error) throw error;

      toast({ title: "Success", description: "Data source updated" });
      setEditingSource(null);
      setEditFormData({});
      await loadDataSources();
    } catch (error) {
      console.error('Update error:', error);
      toast({ title: "Error", description: "Failed to update", variant: "destructive" });
    }
  };

  const deleteDataSource = async (id: string) => {
    if (!confirm('Are you sure you want to delete this data source?')) return;
    
    try {
      const { error } = await supabase.from('ai_data_sources').delete().eq('id', id);
      if (error) throw error;
      toast({ title: "Deleted", description: "Data source removed" });
      await loadDataSources();
    } catch (error) {
      console.error('Delete error:', error);
      toast({ title: "Error", description: "Failed to delete", variant: "destructive" });
    }
  };

  const openEditDialog = (source: DataSource) => {
    setEditingSource(source);
    setEditFormData({ ...source.configuration, is_active: source.is_active });
  };

  const renderSourceCard = (source: DataSource) => {
    const template = KNOWLEDGE_SOURCE_TEMPLATES[source.source_name];
    const apiTemplate = API_SOURCE_TEMPLATES[source.source_name];
    const webhookTemplate = WEBHOOK_SOURCE_TEMPLATES[source.source_name];
    const status = getSourceStatus(source);
    const Icon = template?.icon || Globe;

    // Get display name from templates or format source_name
    const displayTitle = template?.name || apiTemplate?.name || webhookTemplate?.name ||
      source.source_name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    // Type badge
    let typeBadge = source.source_type;
    if (source.source_type === 'webhook' || source.source_name.includes('webhook')) {
      typeBadge = 'Webhook';
    } else if (source.source_type === 'knowledge_base') {
      typeBadge = 'Knowledge';
    } else {
      typeBadge = 'API';
    }

    const isWebhook = source.source_type === 'webhook' || source.source_name.includes('webhook');

    return (
      <Card key={source.id}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5" />
              <CardTitle className="text-base">{displayTitle}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Circle className={`h-2 w-2 fill-current ${
                status.color === 'green' ? 'text-green-500' :
                status.color === 'yellow' ? 'text-yellow-500' : 'text-red-500'
              }`} />
              <Badge variant="outline" className="text-xs">{typeBadge}</Badge>
            </div>
          </div>
          <CardDescription className="text-xs">
            {template?.description || apiTemplate?.description || webhookTemplate?.description || source.source_type}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
            <span>Frequency: {source.update_frequency || 'N/A'}</span>
            <span>Last sync: {source.last_sync ? new Date(source.last_sync).toLocaleDateString() : 'Never'}</span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncSource(source.id, displayTitle)}
              disabled={syncingSource === source.id || isWebhook}
              title={isWebhook ? "Webhook sources receive data in real time" : "Sync now"}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${syncingSource === source.id ? 'animate-spin' : ''}`} />
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
                  <DialogTitle>Edit {displayTitle}</DialogTitle>
                </DialogHeader>
                {editingSource?.id === source.id && (
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
            <Button variant="ghost" size="sm" onClick={() => deleteDataSource(source.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

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
          <p className="text-muted-foreground">Manage signals and knowledge sources</p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Source
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Data Source</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              {/* API Sources */}
              <div>
                <h3 className="text-lg font-semibold mb-2">API Sources</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(API_SOURCE_TEMPLATES).filter(([key]) => key !== 'eodhd_api').map(([key, template]) => (
                    <Card
                      key={key}
                      className={`cursor-pointer transition-colors hover:border-primary/50 ${
                        selectedTemplate === key ? 'border-primary bg-primary/5' : ''
                      }`}
                      onClick={() => setSelectedTemplate(key)}
                    >
                      <CardContent className="p-4">
                        <h4 className="font-medium">{template.name}</h4>
                        <p className="text-sm text-muted-foreground">{template.description}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
              {/* Webhook Sources */}
              <div>
                <h3 className="text-lg font-semibold mb-2">Webhook Sources</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(WEBHOOK_SOURCE_TEMPLATES).map(([key, template]) => (
                    <Card
                      key={key}
                      className={`cursor-pointer transition-colors hover:border-primary/50 ${
                        selectedTemplate === key ? 'border-primary bg-primary/5' : ''
                      }`}
                      onClick={() => setSelectedTemplate(key)}
                    >
                      <CardContent className="p-4">
                        <h4 className="font-medium">{template.name}</h4>
                        <p className="text-sm text-muted-foreground">{template.description}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
              {/* Knowledge Base Sources */}
              <div>
                <h3 className="text-lg font-semibold mb-2">Knowledge Base</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(KNOWLEDGE_SOURCE_TEMPLATES).map(([key, template]) => (
                    <Card
                      key={key}
                      className={`cursor-pointer transition-colors hover:border-primary/50 ${
                        selectedTemplate === key ? 'border-primary bg-primary/5' : ''
                      }`}
                      onClick={() => setSelectedTemplate(key)}
                    >
                      <CardContent className="p-4">
                        <h4 className="font-medium">{template.name}</h4>
                        <p className="text-sm text-muted-foreground">{template.description}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowAddDialog(false);
                setSelectedTemplate('');
                setFormData({});
              }}>
                Cancel
              </Button>
              <Button onClick={addDataSource} disabled={!selectedTemplate}>
                Add Source
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {dataSources.length === 0 ? (
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
            <TabsTrigger value="signals">Signals (API / Webhook) ({signalSources.length})</TabsTrigger>
            <TabsTrigger value="knowledge">Knowledge Base ({knowledgeBaseSources.length})</TabsTrigger>
          </TabsList>
          
          <TabsContent value="signals" className="space-y-4">
            {/* Debug: raw ai_data_sources rows */}
            <details className="mb-4">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Debug: raw ai_data_sources rows ({dataSources.length} total, {signalSources.length} signals)
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-[10px] leading-tight">
                {JSON.stringify(signalSources, null, 2)}
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
